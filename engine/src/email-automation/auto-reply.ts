import { randomUUID } from 'node:crypto';
import type { Entity, Store } from '../store.js';
import { DomainError } from '../domains.js';
import { OAuthError } from '../oauth/client.js';
import { accessTokens } from '../oauth/access.js';
import { digest } from '../oauth/crypto.js';
import { decrypt, drafts, json, messages, messageData, operations, requireMailScope, type EmailOptions } from '../email-agents/service.js';
import { parseGmail, parseGraph, sendThreadReply, type MailData, type RemoteRequest } from '../email-agents/adapters.js';
import { fail, inSchedule, jobs, resolveAutomation } from './authority.js';
import { messageEligibility, safeReplyText } from './reply-policy.js';

const errorCode = (error: unknown) => error instanceof OAuthError || error instanceof DomainError ? error.code : 'email_automatic_reply_failed';
const expected = (job: Entity) => ({ revision: job.grantRevision, epoch: job.epoch });
const semanticHash = ({ read: _read, folders: _folders, ...data }: MailData) => digest(JSON.stringify(data));

function context(store: Store, job: Entity, now: number, pending = false) {
  const selected = resolveAutomation(store, job.tenantId, String(job.grantId), now, expected(job));
  if (selected.grant.status !== 'active' || selected.policy.mode !== 'auto_reply' || !selected.policy.replyPolicy) fail('email_automatic_send_not_authorized', 403);
  const source = store.get(job.tenantId, messages, String(job.sourceMessageId)), draft = store.get(job.tenantId, drafts, String(job.draftId));
  if (!source || source.mailboxId !== selected.box.id || source.remoteId !== job.sourceRemoteId || source.contentHash !== job.sourceHash || !draft || draft.mailboxId !== selected.box.id || draft.messageId !== source.id || draft.sourceHash !== source.contentHash || draft.mailboxRevision !== selected.box.revision || draft.revision !== job.draftRevision || draft.status !== (pending ? 'pending' : 'auto_ready')) fail('email_automatic_context_changed');
  const data = messageData(source), reason = messageEligibility(store, selected.grant, selected.box, selected.policy, source, data, now, pending);
  if (reason) fail(`email_automation_${reason}`);
  const content = decrypt<{ text: string }>(draft, 'draft', draft.encryptedContent);
  if (digest(content.text) !== job.draftContentHash || !safeReplyText(content.text, selected.policy)) fail('email_automatic_content_changed');
  return { ...selected, source, draft, data, text: content.text };
}

/** A bounded, current provider view. Incomplete results never authorize a send. */
async function preflight(request: RemoteRequest, provider: string, data: MailData) {
  let current: MailData;
  if (provider === 'google') {
    const thread = await request(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(data.threadId)}?format=full`);
    if (thread.id !== data.threadId || !Array.isArray(thread.messages) || thread.messages.length > 100 || thread.messages.length < 1 || thread.nextPageToken) fail('email_automatic_thread_incomplete');
    const items = thread.messages.map(parseGmail);
    if (items.some((m: MailData) => m.threadId !== data.threadId) || items.filter((m: MailData) => m.remoteId === data.remoteId).length !== 1) fail('email_automatic_thread_changed');
    current = items.find((m: MailData) => m.remoteId === data.remoteId)!;
    if (items.some((m: MailData) => m.folders.includes('sent') && Date.parse(m.receivedAt) >= Date.parse(data.receivedAt))) fail('email_automatic_observed_reply');
  } else {
    const headers = { Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' };
    const inbox = await request('https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id', { headers });
    const raw = await request(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(data.remoteId)}?$select=id,conversationId,parentFolderId,subject,body,from,toRecipients,replyTo,internetMessageId,internetMessageHeaders,receivedDateTime,sentDateTime,isRead,isDraft`, { headers });
    if (typeof inbox.id !== 'string' || raw.id !== data.remoteId || raw.parentFolderId !== inbox.id || raw.isDraft) fail('email_automatic_source_changed');
    current = parseGraph(raw, 'inbox');
    const url = new URL('https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages');
    url.searchParams.set('$filter', `sentDateTime ge ${new Date(data.receivedAt).toISOString()}`); url.searchParams.set('$select', 'id,conversationId,sentDateTime'); url.searchParams.set('$top', '25');
    const sent = await request(url.href, { headers });
    if (!Array.isArray(sent.value) || sent.value.length > 25 || sent['@odata.nextLink'] || sent.value.some((m: any) => typeof m.id !== 'string' || typeof m.conversationId !== 'string' || !Number.isFinite(Date.parse(m.sentDateTime)))) fail('email_automatic_thread_incomplete');
    if (sent.value.some((m: any) => m.conversationId === data.threadId && Date.parse(m.sentDateTime) >= Date.parse(data.receivedAt))) fail('email_automatic_observed_reply');
  }
  if (!current.folders.includes('inbox') || current.folders.includes('sent') || semanticHash(current) !== semanticHash(data)) fail('email_automatic_source_changed');
}

function finish(store: Store, operation: Entity, status: 'accepted' | 'uncertain' | 'not_sent', now: number, extra: Record<string, unknown> = {}) {
  const current = store.get(operation.tenantId, operations, operation.id);
  if (!current || current.claimToken !== operation.claimToken || !['prepared', 'dispatching'].includes(String(current.status))) return false;
  store.update(operation.tenantId, operations, operation.id, { ...extra, status, claimToken: null, finishedAt: now });
  const draft = store.get(operation.tenantId, drafts, String(operation.draftId)), source = store.get(operation.tenantId, messages, String(operation.messageId));
  if (draft?.replyOperationId === operation.id) store.update(operation.tenantId, drafts, draft.id, { status: status === 'not_sent' ? 'draft' : status, replyOperationId: null });
  if (source?.replyOperationId === operation.id) store.update(operation.tenantId, messages, source.id, { status: status === 'not_sent' ? 'new' : status === 'accepted' ? 'reply_accepted' : 'reply_uncertain', replyOperationId: null });
  const job = store.get(operation.tenantId, jobs, String(operation.jobId));
  if (job?.operationId === operation.id) store.update(operation.tenantId, jobs, job.id, { status: status === 'not_sent' ? 'awaiting_review' : status, errorCode: extra.errorCode ?? null, completedAt: now });
  return true;
}

export function recoverAutomaticReplies(store: Store, now: number) {
  const rows = store.db.prepare("SELECT body FROM entities WHERE collection=? AND json_extract(body,'$.automatic')=1 AND json_extract(body,'$.status') IN ('prepared','dispatching') AND json_extract(body,'$.leaseUntil')<=? ORDER BY json_extract(body,'$.leaseUntil'),rowid LIMIT 100").all(operations, now);
  store.transaction(() => { for (const row of rows) { const op = JSON.parse(String(row.body)) as Entity; finish(store, op, op.status === 'dispatching' ? 'uncertain' : 'not_sent', now, { errorCode: 'email_automatic_reply_interrupted' }); } });
}

/** Uses only a persisted automation grant, never a synthetic session or human confirmation. */
export async function sendAutomaticReply(store: Store, tenantId: string, jobId: string, options: EmailOptions & { now?: () => number } = {}) {
  const now = options.now ?? Date.now, job = store.get(tenantId, jobs, jobId);
  if (!job || job.status !== 'ready_to_send') return { skipped: true, automaticSends: 0 };
  let selected: ReturnType<typeof context>;
  try { selected = context(store, job, now()); }
  catch (error) { store.update(tenantId, jobs, job.id, { status: 'superseded', errorCode: errorCode(error) }); throw error; }
  const { policy, box, source, data, draft, text } = selected, limits = policy.replyPolicy!;
  if (!inSchedule(policy, now())) { store.update(tenantId, jobs, job.id, { dueAt: now() + 60000, waitingFor: 'schedule' }); return { skipped: true, automaticSends: 0 }; }
  const recipientHash = digest(`${tenantId}:${data.from}`), threadHash = digest(`${box.id}:${data.threadId}`);
  const operation = store.transaction(() => {
    context(store, job, now()); if (store.get(tenantId, jobs, job.id)?.status !== 'ready_to_send') return undefined;
    const attempts = store.list(tenantId, operations).filter(op => op.automatic === true), recent = attempts.filter(op => Number(op.reservedAt) > now() - 86400000), sameBox = recent.filter(op => op.mailboxId === box.id);
    if (attempts.some(op => op.mailboxId === box.id && (op.messageId === source.id || op.threadHash === threadHash))) { store.update(tenantId, jobs, job.id, { status: 'awaiting_review', errorCode: 'email_automatic_thread_already_reserved' }); store.update(tenantId, drafts, draft.id, { status: 'draft' }); return undefined; }
    if (recent.length >= 100 || sameBox.length >= limits.sendsPerDay || sameBox.filter(op => op.recipientHash === recipientHash).length >= limits.repliesPerRecipientPerDay || sameBox.some(op => Number(op.reservedAt) > now() - limits.minimumIntervalSeconds * 1000)) { store.update(tenantId, jobs, job.id, { dueAt: now() + 60000, waitingFor: 'send_quota' }); return undefined; }
    const op = store.create(tenantId, operations, { automatic: true, mailboxId: box.id, messageId: source.id, draftId: draft.id, jobId: job.id, userId: null, authorization: { kind: 'automation_grant', grantId: job.grantId, revision: job.grantRevision, epoch: job.epoch }, keyHash: digest(`auto:${job.id}`), fingerprint: digest(`${job.id}:${job.sourceHash}:${job.draftContentHash}`), recipientHash, threadHash, status: 'prepared', claimToken: randomUUID(), leaseUntil: now() + 180000, reservedAt: now() });
    store.update(tenantId, jobs, job.id, { status: 'sending', operationId: op.id, waitingFor: null });
    store.update(tenantId, drafts, draft.id, { status: 'pending', replyOperationId: op.id });
    store.update(tenantId, messages, source.id, { status: 'reply_pending', replyOperationId: op.id }); return op;
  });
  if (!operation) return { skipped: true, automaticSends: 0 };
  const deadline = now() + 120000; let calls = 0, started = false;
  const assertClaim = () => {
    const fresh = context(store, job, now(), true), op = store.get(tenantId, operations, operation.id), currentJob = store.get(tenantId, jobs, job.id);
    if (!op || op.claimToken !== operation.claimToken || !['prepared', 'dispatching'].includes(String(op.status)) || Number(op.leaseUntil) <= now() || currentJob?.status !== 'sending' || currentJob.operationId !== op.id || fresh.source.replyOperationId !== op.id || fresh.draft.replyOperationId !== op.id) fail('email_automatic_claim_lost');
    if (!inSchedule(fresh.policy, now())) fail('email_automation_outside_schedule');
    if (now() >= deadline) fail('email_automatic_phase_limit');
    return fresh;
  };
  const io: RemoteRequest = async (url, init = {}, capability = 'email', allowEmpty = false) => {
    const fresh = assertClaim(); if (++calls > 6) fail('email_automatic_phase_limit');
    const target = new URL(url), origin = box.provider === 'google' ? 'https://gmail.googleapis.com' : 'https://graph.microsoft.com';
    const write = init.method === 'POST', writePath = box.provider === 'google' ? '/gmail/v1/users/me/messages/send' : `/v1.0/me/messages/${encodeURIComponent(data.remoteId)}/reply`;
    if (target.origin !== origin || target.username || target.password || target.hash || !target.pathname.startsWith(box.provider === 'google' ? '/gmail/v1/users/me/' : '/v1.0/me/') || (write ? capability !== 'email_send' || target.pathname !== writePath || target.search !== '' : (init.method ?? 'GET') !== 'GET' || capability !== 'email')) fail('email_automatic_destination_invalid');
    const tokens = await accessTokens(store, fresh.connection); assertClaim(); requireMailScope(box.provider, tokens.scope, capability);
    const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${tokens.accessToken}`);
    if (write) store.transaction(() => { assertClaim(); const op = store.get(tenantId, operations, operation.id)!; if (op.status !== 'prepared') fail('email_automatic_write_already_started'); store.update(tenantId, operations, operation.id, { status: 'dispatching', sendStartedAt: now() }); started = true; });
    const result = await json(url, { ...init, headers }, { ...options, signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - now()))) }, allowEmpty);
    assertClaim(); return result;
  };
  try {
    await preflight(io, String(box.provider), data); assertClaim();
    const result = await sendThreadReply(io, String(box.provider), String(box.address), data, text, operation.id, true);
    store.transaction(() => { assertClaim(); if (!finish(store, operation, 'accepted', now(), { providerMessageId: result.messageId, providerThreadId: result.threadId, acceptedAt: new Date(now()).toISOString() })) fail('email_automatic_claim_lost'); });
    return { status: 'accepted', operationId: operation.id, automaticSends: 1 };
  } catch (error) {
    store.transaction(() => { finish(store, operation, started ? 'uncertain' : 'not_sent', now(), { errorCode: errorCode(error) }); });
    return { status: store.get(tenantId, operations, operation.id)?.status, operationId: operation.id, automaticSends: 0 };
  }
}
