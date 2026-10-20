import { test } from 'node:test';
import Fastify from 'fastify';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { seedMember } from './fixtures/membership.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { tokenContext, type Actor } from '../src/oauth/access.js';
import { configureEmailMailbox, syncEmailMailbox, generateEmailDraft, sendEmailDraft, messageData, mailContentHash, messages, drafts, type EmailOptions } from '../src/email-agents/service.js';
import { setEmailMessageRead } from '../src/email-agents/mailbox-actions.js';
import { jobs } from '../src/email-automation/authority.js';
import { registerEmailAgents } from '../src/email-agents.js';

/**
 * Mensagens sincronizadas antes da mudança de fórmula guardam contentHash = digest(JSON.stringify(data)), que inclui
 * `read`. Mudar só lido/não lido (na Kloel ou no Gmail) não pode invalidar rascunhos nem jobs criados sobre elas.
 * Gmail e OpenAI simulados por fetch injetado; nenhuma chamada externa real.
 */
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';

function fixture(t: any) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), actor: Actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const agent = store.create(actor.tenantId, 'agents', { name: 'E-mail', status: 'active', prompt: 'Responda com fatos verificados.' });
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider: 'google', remoteId: 'remote-owner', email: 'inbox@example.com', userId: actor.userId, visibility: 'personal', status: 'connected', capabilities: ['email', 'email_send'], scopes: MODIFY, authorizationGeneration: 1 });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'fixture-mail-token', expiresAt: Date.now() + 3600000, scope: MODIFY }, tokenContext(connection)) });
  const box = configureEmailMailbox(store, actor, { name: 'Atendimento', connectionId: connection.id, agentId: agent.id, settings: { signature: 'Equipe' } });
  const labels = new Map<string, string[]>([['in-1', ['INBOX', 'UNREAD']]]), subjects = new Map<string, string>();
  let history: unknown[] = [];
  const hooks: { onSend?: () => Promise<void> } = {};
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET';
    if (url.hostname === 'api.openai.com') return json({ id: 'r', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta da IA.' }] }] });
    assert.equal(url.hostname, 'gmail.googleapis.com', 'only the simulated Gmail is contacted');
    if (url.pathname.endsWith('/profile')) return json({ historyId: '100' });
    if (url.pathname.endsWith('/history')) { const page = json({ historyId: '101', history }); history = []; return page; }
    if (url.pathname.endsWith('/messages/send')) { await hooks.onSend?.(); return json({ id: 'sent-1', threadId: 'thread-in-1' }); }
    if (url.pathname.endsWith('/messages')) return json({ messages: [...labels.keys()].map(id => ({ id })) });
    const parts = url.pathname.split('/'), action = parts.at(-1)!, id = decodeURIComponent(action === 'modify' ? parts.at(-2)! : action);
    if (method === 'POST' && action === 'modify') { const body = JSON.parse(String(init.body)); labels.set(id, [...labels.get(id)!.filter(l => !(body.removeLabelIds ?? []).includes(l)), ...(body.addLabelIds ?? [])]); return json({ id, threadId: `thread-${id}`, labelIds: labels.get(id) }); }
    return json({ id, threadId: `thread-${id}`, internalDate: '1780000000000', labelIds: labels.get(id), payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Cliente <client@example.com>' }, { name: 'To', value: 'inbox@example.com' }, { name: 'Subject', value: subjects.get(id) ?? `Pedido ${id}` }, { name: 'Message-ID', value: `<${id}@example.com>` }], body: { data: Buffer.from(`Texto do pedido ${id}`).toString('base64url') } } });
  }) as typeof fetch;
  const options: EmailOptions = { openaiApiKey: 'fixture-openai-key', openaiModel: 'fixture-model', fetchImpl };
  t.after(() => { store.close(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous; });
  const message = () => store.list(actor.tenantId, messages).find(m => m.remoteId === 'in-1')!;
  /** Rewrites the stored row exactly as the previous deploy persisted it: hash of the whole MailData, `read` included. */
  const legacy = () => { const row = message(), hash = digest(JSON.stringify(messageData(row))); store.update(actor.tenantId, messages, row.id, { contentHash: hash }); return hash; };
  /** Gmail reports a label change on in-1, so the next sync re-reads and re-persists it. */
  const changedInGmail = () => { history = [{ id: '101', labelsRemoved: [{ message: { id: 'in-1' } }] }]; };
  /** Engine start after the deploy (routes registered before any request or worker). */
  const boot = async () => { const app = Fastify(); t.after(() => app.close()); await registerEmailAgents(app, store); };
  return { store, actor, box, options, labels, subjects, message, legacy, changedInGmail, hooks, boot };
}

test('a draft made for a message synced before the hash change still sends after the message is read (Kloel auto-read + next sync)', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const oldHash = f.legacy(), revision = f.message().revision;
  // Opening the e-mail marks it read in Gmail (local copy updated, stored hash untouched) and the user drafts with AI.
  await setEmailMessageRead(f.store, f.actor, f.box.id, f.message().id, { read: true }, f.options);
  const draft = await generateEmailDraft(f.store, f.actor, f.box.id, f.message().id, {}, 'draft-key', f.options);
  assert.equal(f.store.get(f.actor.tenantId, drafts, draft.id)!.sourceHash, oldHash, 'draft bound to the pre-deploy hash');
  // An auto-reply job queued over the same pre-deploy message.
  const job = f.store.create(f.actor.tenantId, jobs, { mailboxId: f.box.id, sourceRemoteId: 'in-1', sourceMessageId: f.message().id, sourceHash: oldHash, action: 'draft', status: 'queued' });
  // Next sync sees the UNREAD label removal and re-persists the message.
  f.changedInGmail(); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const row = f.message();
  assert.equal(messageData(row).read, true);
  assert.equal(row.contentHash, mailContentHash(messageData(row)), 'stored hash migrated to the current formula');
  assert.equal(row.revision, revision, 'read state alone is not a content revision');
  assert.equal(f.store.get(f.actor.tenantId, drafts, draft.id)!.sourceHash, row.contentHash, 'draft follows the migrated hash');
  assert.equal(f.store.get(f.actor.tenantId, jobs, job.id)!.sourceHash, row.contentHash, 'automation job follows the migrated hash');
  const sent = await sendEmailDraft(f.store, f.actor, f.box.id, draft.id, { confirmed: true, revision: draft.revision }, 'send-key', f.options);
  assert.equal(sent.status, 'accepted');
});

test('a draft pending at deploy time still sends when the message is read directly in Gmail', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const draft = await generateEmailDraft(f.store, f.actor, f.box.id, f.message().id, {}, 'draft-key', f.options);
  const oldHash = f.legacy(); f.store.update(f.actor.tenantId, drafts, draft.id, { sourceHash: oldHash });
  f.labels.set('in-1', ['INBOX']); f.changedInGmail(); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  assert.equal(messageData(f.message()).read, true);
  const sent = await sendEmailDraft(f.store, f.actor, f.box.id, draft.id, { confirmed: true, revision: draft.revision }, 'send-key', f.options);
  assert.equal(sent.status, 'accepted');
});

test('a real content change of a pre-deploy message still invalidates its draft', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const draft = await generateEmailDraft(f.store, f.actor, f.box.id, f.message().id, {}, 'draft-key', f.options);
  const oldHash = f.legacy(), revision = f.message().revision; f.store.update(f.actor.tenantId, drafts, draft.id, { sourceHash: oldHash });
  f.subjects.set('in-1', 'Pedido alterado'); f.changedInGmail(); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  assert.equal(f.message().revision, revision + 1);
  await assert.rejects(sendEmailDraft(f.store, f.actor, f.box.id, draft.id, { confirmed: true, revision: draft.revision }, 'send-key', f.options), (e: any) => e.code === 'email_message_changed');
});

/**
 * Revisão: a migração preguiçosa (só no próximo re-persist) corria contra operações já em andamento — um envio que capturou
 * o hash antigo era abortado (e marcado "incerto" se o Gmail já tinha recebido) quando uma sincronização migrava a linha no
 * meio dele. A migração agora roda uma vez na subida do motor, antes de qualquer pedido ou worker.
 */
test('the engine start migrates pre-deploy rows once, so a sync during a send never aborts it', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const draft = await generateEmailDraft(f.store, f.actor, f.box.id, f.message().id, {}, 'draft-key', f.options);
  const oldHash = f.legacy(), revision = f.message().revision; f.store.update(f.actor.tenantId, drafts, draft.id, { sourceHash: oldHash });
  const job = f.store.create(f.actor.tenantId, jobs, { mailboxId: f.box.id, sourceRemoteId: 'in-1', sourceMessageId: f.message().id, sourceHash: oldHash, action: 'draft', status: 'queued' });
  await f.boot();
  const row = f.message();
  assert.equal(row.contentHash, mailContentHash(messageData(row)), 'migrated at start, before any sync');
  assert.equal(row.revision, revision);
  assert.equal(f.store.get(f.actor.tenantId, drafts, draft.id)!.sourceHash, row.contentHash);
  assert.equal(f.store.get(f.actor.tenantId, jobs, job.id)!.sourceHash, row.contentHash);
  // While Gmail is receiving the reply, the sync re-reads the (now read) message.
  f.labels.set('in-1', ['INBOX']);
  f.hooks.onSend = async () => { f.hooks.onSend = undefined; f.changedInGmail(); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options); };
  const sent = await sendEmailDraft(f.store, f.actor, f.box.id, draft.id, { confirmed: true, revision: draft.revision }, 'send-key', f.options);
  assert.equal(messageData(f.message()).read, true, 'the sync ran during the send');
  assert.equal(sent.status, 'accepted', JSON.stringify(sent));
  // A second start does not redo the work.
  const before = f.message().updatedAt; await f.boot(); assert.equal(f.message().updatedAt, before);
});

test('retrying a pre-deploy draft generation with the same key after the migration replays it instead of a conflict', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const draft = await generateEmailDraft(f.store, f.actor, f.box.id, f.message().id, {}, 'draft-key', f.options);
  // As the previous deploy stored it: legacy message hash, and the draft's source hash and idempotency fingerprint over it.
  const oldHash = f.legacy(), stored = f.store.get(f.actor.tenantId, drafts, draft.id)!;
  f.store.update(f.actor.tenantId, drafts, draft.id, { sourceHash: oldHash, fingerprint: digest(JSON.stringify({ messageId: f.message().id, contentHash: oldHash, revision: f.box.revision, instruction: '' })) });
  await f.boot(); f.labels.set('in-1', ['INBOX']); f.changedInGmail(); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const replay = await generateEmailDraft(f.store, f.actor, f.box.id, f.message().id, {}, 'draft-key', f.options);
  assert.equal(replay.id, stored.id);
  // Another instruction with the same key is still a conflict.
  await assert.rejects(generateEmailDraft(f.store, f.actor, f.box.id, f.message().id, { instruction: 'Outra' }, 'draft-key', f.options), (e: any) => e.code === 'idempotency_conflict');
});
