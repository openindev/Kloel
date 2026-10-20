import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { DomainError } from '../domains.js';
import { OAuthError } from '../oauth/client.js';
import { oauthAuthorizationGeneration, scopedConnection, updateOAuthAuthorization, type Actor } from '../oauth/access.js';
import { authorizedOAuthActor } from '../oauth/authorization.js';
import { digest } from '../oauth/crypto.js';
import { remoteId, type MailData } from './adapters.js';
import { authorized, detachedConnections, drafts, encrypt, mailboxes, messageData, messages, operations, publicDraft, publicMessage, replyable, requester, selectedMessage, threads, type EmailOptions } from './service.js';
import { grants } from '../email-automation/authority.js';

/**
 * Organização da caixa conectada (lido/não lido, arquivar, lixeira), descarte de rascunho, resposta escrita
 * pela equipe e remoção da caixa do E-Mail IA. Toda alteração no provedor passa pelo mesmo `requester`
 * autorizado da sincronização/envio e só é refletida localmente depois da confirmação do provedor.
 */
const gmailRoot = 'https://gmail.googleapis.com/gmail/v1/users/me', graphRoot = 'https://graph.microsoft.com/v1.0/me';
const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message); };
const gmailState = z.object({ id: remoteId, labelIds: z.array(z.string().max(200)).max(500).default([]) }).passthrough();
const graphState = z.object({ id: remoteId, isRead: z.boolean().optional() }).passthrough();
function confirmed<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value); if (!parsed.success) throw new OAuthError(502, 'email_provider_response_invalid', 'O provedor não confirmou a alteração.');
  return parsed.data;
}
const gmailFolders = (labels: string[]) => labels.some(v => ['DRAFT', 'TRASH', 'SPAM'].includes(v)) ? [] : labels.filter(v => v === 'INBOX' || v === 'SENT').map(v => v === 'INBOX' ? 'inbox' : 'sent');
const graphHeaders = { 'Content-Type': 'application/json', Prefer: 'IdType="ImmutableId"' };

/** Message selected for an organizing change: same authority as sync plus the organize scope, never during an in-flight reply. */
function organizable(store: Store, actor: Actor, mailboxId: string, messageId: string, options: EmailOptions) {
  const selected = selectedMessage(store, actor, mailboxId, messageId, options);
  authorized(store, actor, mailboxId, options, 'email_modify');
  if (['reply_pending', 'reply_uncertain'].includes(String(selected.message.status))) fail(409, 'email_reply_in_progress', 'Há uma resposta em envio para este e-mail. Aguarde a confirmação.');
  return selected;
}
/** Applies a provider-confirmed state onto the latest local copy (a concurrent sync may have refreshed it). */
function applyLocal(store: Store, box: Entity, message: Entity, change: (data: MailData) => MailData) {
  return store.transaction(() => {
    const row = store.get(box.tenantId, messages, message.id);
    if (!row || row.mailboxId !== box.id || row.remoteId !== message.remoteId) return fail(409, 'email_message_changed', 'A mensagem mudou durante a operação. Sincronize a caixa.');
    const data = change(messageData(row)), deleted = data.folders.length === 0;
    store.update(box.tenantId, messages, row.id, { encryptedContent: encrypt(row, 'message', data), deleted, ...(deleted ? { revision: Number(row.revision ?? 0) + 1 } : {}) });
    if (deleted) for (const draft of store.list(box.tenantId, drafts).filter(d => d.messageId === row.id && d.status === 'draft')) store.update(box.tenantId, drafts, draft.id, { status: 'discarded', encryptedContent: null, discardedAt: new Date().toISOString(), discardReason: 'message_removed' });
    return store.get(box.tenantId, messages, row.id)!;
  });
}

export async function setEmailMessageRead(store: Store, actor: Actor, mailboxId: string, messageId: string, input: unknown, options: EmailOptions = {}) {
  const { read } = z.object({ read: z.boolean() }).strict().parse(input);
  const { box, message, data } = organizable(store, actor, mailboxId, messageId, options);
  if (data.read === read) return publicMessage(message);
  const io = requester(store, actor, box, options), path = encodeURIComponent(data.remoteId);
  let state: boolean;
  if (box.provider === 'google') {
    const result = confirmed(gmailState, await io(`${gmailRoot}/messages/${path}/modify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] }) }, 'email_modify'));
    if (result.id !== data.remoteId) throw new OAuthError(502, 'email_message_identity_changed', 'O provedor retornou outra mensagem.');
    state = !result.labelIds.includes('UNREAD');
  } else {
    const result = confirmed(graphState, await io(`${graphRoot}/messages/${path}`, { method: 'PATCH', headers: graphHeaders, body: JSON.stringify({ isRead: read }) }, 'email_modify'));
    if (result.id !== data.remoteId || result.isRead === undefined) throw new OAuthError(502, 'email_message_identity_changed', 'O provedor não confirmou a mensagem alterada.');
    state = result.isRead;
  }
  if (state !== read) throw new OAuthError(502, 'email_provider_state_mismatch', 'O provedor não confirmou a alteração de leitura.');
  return publicMessage(applyLocal(store, box, message, current => ({ ...current, read: state })));
}

export async function archiveEmailMessage(store: Store, actor: Actor, mailboxId: string, messageId: string, input: unknown, options: EmailOptions = {}) {
  z.object({}).strict().parse(input ?? {});
  const { box, message, data } = organizable(store, actor, mailboxId, messageId, options);
  if (!data.folders.includes('inbox')) fail(409, 'email_message_not_in_inbox', 'Só e-mails da Caixa de entrada podem ser arquivados.');
  const io = requester(store, actor, box, options), path = encodeURIComponent(data.remoteId);
  let folders: string[];
  if (box.provider === 'google') {
    const result = confirmed(gmailState, await io(`${gmailRoot}/messages/${path}/modify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removeLabelIds: ['INBOX'] }) }, 'email_modify'));
    if (result.id !== data.remoteId) throw new OAuthError(502, 'email_message_identity_changed', 'O provedor retornou outra mensagem.');
    folders = gmailFolders(result.labelIds);
    if (folders.includes('inbox')) throw new OAuthError(502, 'email_provider_state_mismatch', 'O provedor não confirmou o arquivamento.');
  } else {
    confirmed(graphState, await io(`${graphRoot}/messages/${path}/move`, { method: 'POST', headers: graphHeaders, body: JSON.stringify({ destinationId: 'archive' }) }, 'email_modify'));
    folders = data.folders.filter(f => f !== 'inbox');
  }
  const row = applyLocal(store, box, message, current => ({ ...current, folders }));
  return { id: row.id, mailboxId, status: 'archived', deleted: row.deleted === true, folders };
}

export async function trashEmailMessage(store: Store, actor: Actor, mailboxId: string, messageId: string, input: unknown, options: EmailOptions = {}) {
  z.object({ confirmed: z.literal(true) }).strict().parse(input);
  const { box, message, data } = organizable(store, actor, mailboxId, messageId, options);
  const io = requester(store, actor, box, options), path = encodeURIComponent(data.remoteId);
  if (box.provider === 'google') {
    const result = confirmed(gmailState, await io(`${gmailRoot}/messages/${path}/trash`, { method: 'POST' }, 'email_modify'));
    if (result.id !== data.remoteId || !result.labelIds.includes('TRASH')) throw new OAuthError(502, 'email_provider_state_mismatch', 'O provedor não confirmou a lixeira.');
  } else confirmed(graphState, await io(`${graphRoot}/messages/${path}/move`, { method: 'POST', headers: graphHeaders, body: JSON.stringify({ destinationId: 'deleteditems' }) }, 'email_modify'));
  const row = applyLocal(store, box, message, current => ({ ...current, folders: [] }));
  // Lixeira do provedor: recuperável lá; nada é excluído definitivamente.
  return { id: row.id, mailboxId, status: 'trashed', deleted: true, recoverableAtProvider: true };
}

/** Discards the reviewed proposal and any older unsent proposal for the same message. Sends in flight cannot be discarded. */
export function discardEmailDraft(store: Store, actor: Actor, mailboxId: string, draftId: string, input: unknown, options: EmailOptions = {}) {
  return store.transaction(() => {
    authorized(store, actor, mailboxId, options);
    const { revision } = z.object({ revision: z.number().int().positive() }).strict().parse(input), draft = store.get(actor.tenantId, drafts, draftId);
    if (!draft || draft.mailboxId !== mailboxId) return fail(404, 'email_draft_not_found', 'Rascunho não encontrado.');
    if (draft.status !== 'draft' || draft.revision !== revision) fail(409, 'email_draft_changed', 'O rascunho mudou ou já está em envio.');
    const now = new Date().toISOString(), discarded: string[] = [];
    for (const row of store.list(actor.tenantId, drafts).filter(d => d.mailboxId === mailboxId && d.messageId === draft.messageId && d.status === 'draft')) {
      store.update(actor.tenantId, drafts, row.id, { status: 'discarded', encryptedContent: null, revision: Number(row.revision) + 1, discardedBy: actor.userId, discardedAt: now, discardReason: row.id === draft.id ? 'human_discard' : 'superseded' });
      discarded.push(row.id);
    }
    return { mailboxId, messageId: draft.messageId, draftId, status: 'discarded', discarded };
  });
}

/** A reply written by the team becomes a regular reviewed draft; sending keeps the same explicit-confirmation path. */
export function createManualEmailDraft(store: Store, actor: Actor, mailboxId: string, messageId: string, input: unknown, key: string, options: EmailOptions = {}) {
  return store.transaction(() => {
    const { box, message, data } = selectedMessage(store, actor, mailboxId, messageId, options); replyable(message, data, box);
    const { text } = z.object({ text: z.string().trim().min(1).max(20000) }).strict().parse(input);
    const keyHash = digest(`${actor.userId}:${mailboxId}:manual:${z.string().min(1).max(200).parse(key)}`), fingerprint = digest(JSON.stringify({ messageId, contentHash: message.contentHash, text }));
    const old = store.list(actor.tenantId, drafts).find(d => d.keyHash === keyHash);
    if (old) { if (old.fingerprint !== fingerprint) fail(409, 'idempotency_conflict', 'Chave já utilizada com outro rascunho.'); if (old.encryptedContent) return publicDraft(old); fail(409, 'email_draft_changed', 'O rascunho já foi usado ou descartado.'); }
    const draft = store.create(actor.tenantId, drafts, { mailboxId, messageId, sourceHash: message.contentHash, mailboxRevision: box.revision, keyHash, fingerprint, status: 'draft', revision: 1, createdBy: actor.userId, authorization: { kind: 'human_authored' } });
    return publicDraft(store.update(actor.tenantId, drafts, draft.id, { encryptedContent: encrypt(draft, 'draft', { text }) })!);
  });
}

/**
 * Remove a caixa do E-Mail IA: apaga a cópia local (mensagens, conversas, rascunhos), revoga automações e a configuração.
 * Conexão só de e-mail é desconectada (como em Configurações da empresa); conexão também usada por Agenda/Planilhas
 * continua intacta (sem mudar sua identidade OAuth, da qual dependem os vínculos de agenda) e fica oculta no E-Mail IA
 * até uma nova autorização. Nada é apagado no Gmail/Outlook.
 */
export function disconnectEmailConnection(store: Store, actor: Actor, connectionId: string, input: unknown, options: EmailOptions = {}) {
  z.object({ confirmed: z.literal(true) }).strict().parse(input);
  return store.transaction(() => {
    options.assertAccess?.();
    actor = authorizedOAuthActor(store, actor);
    const connection = scopedConnection(store, actor, connectionId), capabilities = Array.isArray(connection.capabilities) ? connection.capabilities.map(String) : [];
    if (connection.status !== 'connected' || !capabilities.includes('email')) fail(409, 'email_connection_without_mail', 'Esta conexão não tem uma caixa de e-mail ativa.');
    const boxes = store.list(actor.tenantId, mailboxes).filter(b => b.connectionId === connection.id);
    for (const box of boxes) {
      if (Number(box.syncLeaseUntil) > Date.now()) fail(409, 'email_sync_in_progress', 'Aguarde a sincronização atual terminar.');
      if (store.list(actor.tenantId, operations).some(o => o.mailboxId === box.id && ['pending', 'prepared', 'dispatching'].includes(String(o.status)))) fail(409, 'email_reply_in_progress', 'Há uma resposta sendo enviada nesta caixa. Aguarde a confirmação.');
    }
    const now = Date.now();
    for (const box of boxes) {
      for (const grant of store.list(actor.tenantId, grants).filter(g => g.mailboxId === box.id && g.status !== 'revoked')) store.update(actor.tenantId, grants, grant.id, { status: 'revoked', revision: Number(grant.revision) + 1, reason: 'mailbox_disconnected', stoppedAt: now });
      for (const collection of [drafts, messages, threads]) for (const row of store.list(actor.tenantId, collection).filter(r => r.mailboxId === box.id)) store.remove(actor.tenantId, collection, row.id);
      store.remove(actor.tenantId, mailboxes, box.id);
    }
    const kept = capabilities.filter(c => c !== 'email' && c !== 'email_send');
    for (const row of store.list(actor.tenantId, detachedConnections).filter(r => r.connectionId === connection.id)) store.remove(actor.tenantId, detachedConnections, row.id);
    if (kept.length) store.create(actor.tenantId, detachedConnections, { connectionId: connection.id, authorizationGeneration: oauthAuthorizationGeneration(connection), detachedBy: actor.userId });
    else updateOAuthAuthorization(store, connection, { status: 'disconnected', encryptedTokens: null });
    return { connectionId: connection.id, removedMailboxes: boxes.length, connection: kept.length ? 'kept_for_other_features' : 'disconnected', keptCapabilities: kept, revokedAtProvider: false };
  });
}
