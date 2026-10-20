import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { hasPermission } from '../memberships/permissions.js';
import { MembershipError } from '../memberships/service.js';
import { assertRequestContext, parseExpectedRequestContext, resolveSessionContext, sameRequestContext, type ExpectedRequestContext } from '../request-context.js';
import { agentKnowledgeReferences } from '../knowledge-authority.js';
import { agentTools } from './agent-tools.js';
import { captureRecipientAttestationContext, deliveredObservation, attestedRecipientBusy, type RecipientAuthority } from './meta-recipient-attestation.js';
import { identityReviewHash as hash } from './meta-identity-review.js';
import { WhatsAppSendFault as Fault } from './whatsapp-send.js';

export const manualAdmissionCollection = 'whatsapp-manual-ai-admissions';
export const manualAdmissionReasons = ['forbidden', 'identity_review_required', 'source_unverified', 'source_not_text', 'outside_window', 'conversation_not_open', 'human_handoff', 'collision_automation_blocked', 'channel_unavailable', 'agent_unavailable', 'tools_not_allowed', 'autoreply_must_be_disabled', 'provider_unavailable', 'source_already_admitted', 'send_requires_reconciliation'] as const;
type Reason = typeof manualAdmissionReasons[number];
type OnceAuthority = { sessionHash: string; context: ExpectedRequestContext };
const configFields = ['PROVIDER_TENANT_ID', 'META_PHONE_NUMBER_ID', 'META_ACCESS_TOKEN', 'META_GRAPH_VERSION', 'META_WABA_ID', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'WHATSAPP_AUTOREPLY_ENABLED', 'WHATSAPP_MAX_REPLIES_PER_DAY'];
const jobIdentity = (job: Entity) => Object.fromEntries(['id','tenantId','provider','mode','sourceMessageId','providerMessageId','conversationId','channelId','agentId','channelSnapshot','recipient','originRecipient','incomingAt','admissionMode','manualAdmissionId'].map(k => [k, job[k]]));
const editable = (a: RecipientAuthority) => hasPermission(a.role, 'conversations:write') && hasPermission(a.role, 'integrations:manage');
const blocked = (row: Entity) => !['open', 'closed'].includes(String(row.status)) || Array.isArray(row.tags) && row.tags.some(t => ['no_ai', 'human_handoff'].includes(String(t)));

function context(store: Store, a: RecipientAuthority, conversation: Entity, now = Date.now(), excludeJobId = '') {
  const captured = captureRecipientAttestationContext(store, a, conversation, now), { review } = captured, source = review.source, proof = review.proof, channel = review.channel;
  const agent = channel && typeof channel.agentId === 'string' ? store.get(a.tenantId, 'agents', channel.agentId) : undefined;
  const jobs = source ? store.db.prepare(`SELECT id FROM entities WHERE tenant_id=? AND collection='reply-jobs' AND id!=? AND json_extract(body,'$.sourceMessageId')=? LIMIT 1`).all(a.tenantId, excludeJobId, source.id) : [];
  let reason: Reason | null = !review.valid || conversation.metaIdentityPolicy !== 'manual_only' ? 'identity_review_required' : null;
  if (!reason && (!source || !proof || !captured.current || !review.conflicts.complete)) reason = 'source_unverified';
  if (!reason && proof!.messageType !== 'text') reason = 'source_not_text';
  if (!reason && (!review.view.windowExpiresAt || Date.parse(review.view.windowExpiresAt) <= now)) reason = 'outside_window';
  if (!reason && conversation.status !== 'open') reason = 'conversation_not_open';
  if (!reason && blocked(conversation)) reason = 'human_handoff';
  if (!reason && review.conflicts.rows.some(blocked)) reason = 'collision_automation_blocked';
  if (!reason && (!channel || channel.enabled !== true || conversation.channelId !== channel.id)) reason = 'channel_unavailable';
  if (!reason && (!agent || agent.status !== 'active' || conversation.agentId != null && conversation.agentId !== agent.id)) reason = 'agent_unavailable';
  if (!reason && ((agent!.tools !== undefined && (!Array.isArray(agent!.tools) || agent!.tools.length !== 0)) || agentTools(agent!, false).length)) reason = 'tools_not_allowed';
  if (!reason && process.env.WHATSAPP_AUTOREPLY_ENABLED !== 'false') reason = 'autoreply_must_be_disabled';
  if (!reason && (process.env.PROVIDER_TENANT_ID !== a.tenantId || process.env.META_PHONE_NUMBER_ID?.trim() !== proof!.phoneNumberId || !process.env.META_ACCESS_TOKEN?.trim()
    || !/^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION?.trim() ?? '') || !process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim())) reason = 'provider_unavailable';
  if (!reason && jobs.length) reason = 'source_already_admitted';
  if (!reason && attestedRecipientBusy(store, a.tenantId, conversation.id, String(proof!.phoneNumberId), ['+' + proof!.from], '', excludeJobId)) reason = 'send_requires_reconciliation';
  if (!editable(a)) reason = 'forbidden';
  const history = store.list(a.tenantId, 'messages').filter(m => m.conversationId === conversation.id && ['user', 'assistant'].includes(String(m.role))).slice(-30);
  const knowledge = agent ? agentKnowledgeReferences(store, a.tenantId, agent.id) : [];
  const inputDigest = hash([conversation, source ?? null, proof ?? null, channel ?? null, agent ?? null, history, knowledge, review.binding, conversation.metaIdentityReviewId, review.conflicts.digest, configFields.map(k => process.env[k] ?? '')]);
  const version = hash(['manual-ai-admission-v1', inputDigest, captured.evidence.map(e => [e.row.id, e.digest]), captured.view.evidence.complete, jobs]);
  return { captured, source, proof, channel, agent, inputDigest, view: { tenantId: a.tenantId, conversationId: conversation.id, version, canAdmit: !reason, reasonCode: reason,
    sourceMessageId: review.view.sourceMessageId, windowExpiresAt: review.view.windowExpiresAt, origin: review.view.destination, evidence: captured.view.evidence } };
}

/** Restriction for the native once executor only. No scheduler or resume may use this exception. */
export function validateManualAdmission(store: Store, job: Entity, authority: OnceAuthority, now = Date.now()): string | undefined {
  if (job.admissionMode !== 'manual_only') return 'manual_admission_missing';
  const row = typeof job.manualAdmissionId === 'string' ? store.get(job.tenantId, manualAdmissionCollection, job.manualAdmissionId) : undefined;
  const original = row?.authority as OnceAuthority | undefined;
  if (!row || row.status !== 'admitted' || row.jobId !== job.id || row.conversationId !== job.conversationId || row.sourceMessageId !== job.sourceMessageId
    || !original || original.sessionHash !== authority.sessionHash || !sameRequestContext(original.context, authority.context) || row.jobIdentityDigest !== hash(jobIdentity(job))) return 'manual_admission_invalid';
  const current = resolveSessionContext(store, authority.sessionHash);
  if (!current?.actor || !sameRequestContext(authority.context, current.context)) return 'manual_admission_authority_changed';
  const a = { ...current.actor, membershipId: current.context.membershipId!, sessionHash: authority.sessionHash, authorityVersion: current.context.authorityVersion };
  const conversation = store.get(job.tenantId, 'conversations', String(job.conversationId)); if (!conversation) return 'manual_admission_changed';
  const c = context(store, a, conversation, now, job.id);
  if (!c.view.canAdmit || c.inputDigest !== row.inputDigest || row.originRecipient !== '+' + c.proof?.from || job.originRecipient !== row.originRecipient) return 'manual_admission_changed';
  if (row.recipientEvidenceId !== null) {
    const evidence = deliveredObservation(store, job.tenantId, store.get(job.tenantId, 'whatsapp-operations', String(row.recipientEvidenceId)), c.proof!, now, String(row.deliveryEvidenceId));
    if (!evidence || evidence.digest !== row.evidenceDigest || job.recipient !== evidence.row.recipient) return 'manual_admission_recipient_changed';
  } else if (job.recipient !== row.originRecipient) return 'manual_admission_recipient_changed';
  if (attestedRecipientBusy(store, job.tenantId, conversation.id, String(c.proof!.phoneNumberId), [String(job.originRecipient), String(job.recipient)], '', job.id)) return 'manual_admission_send_requires_reconciliation';
  return;
}

export async function registerMetaManualAdmission(app: FastifyInstance, store: Store) {
  const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), key = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/), version = z.string().regex(/^[a-f0-9]{64}$/);
  const params = z.object({ id, key: key.optional() }).strict();
  const schema = z.object({ expectedTenantId: id, expectedVersion: version, key, sourceMessageId: id, recipientEvidenceId: id.optional(), confirm: z.literal(true) }).strict();
  function capture(req: FastifyRequest) {
    const read = () => {
      if (req.apiKey || !req.cookies?.kloel_session) throw new Fault(401, 'unauthorized');
      if (!parseExpectedRequestContext(req)) throw new Fault(400, 'expected_context_required'); assertRequestContext(store, req);
      const sessionHash = createHash('sha256').update(req.cookies.kloel_session).digest('hex'), current = resolveSessionContext(store, sessionHash);
      if (!current?.actor || current.actor.userId !== req.actor?.userId || current.actor.tenantId !== req.actor?.tenantId || !hasPermission(current.actor.role, 'conversations:read')) throw new Fault(403, 'forbidden');
      return { actor: { ...current.actor, membershipId: current.context.membershipId!, sessionHash, authorityVersion: current.context.authorityVersion }, authority: { sessionHash, context: structuredClone(current.context) } };
    };
    const original = read(); return { ...original, assert() { if (hash(read()) !== hash(original)) throw new Fault(409, 'authority_changed'); } };
  }
  const find = (tenant: string, k: string) => { const r = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 1`).get(tenant, manualAdmissionCollection, k); return r ? JSON.parse(String(r.body)) as Entity : undefined; };
  const owns = (a: OnceAuthority, row: Entity) => { const original = row.authority as OnceAuthority | undefined; return original?.sessionHash === a.sessionHash && sameRequestContext(original.context, a.context); };
  const view = (row: Entity) => ({ id: row.id, key: row.key, kind: 'manual_ai_admission', tenantId: row.tenantId, conversationId: row.conversationId, status: 'admitted', sourceMessageId: row.sourceMessageId,
    recipientEvidenceId: row.recipientEvidenceId, originalVersion: row.originalVersion, jobId: row.jobId, jobVersion: row.jobVersion, executionStarted: false, automaticRetry: false, createdAt: row.createdAt });
  const route = (fn: (req: FastifyRequest) => unknown) => async (req: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store'); try { return await fn(req); } catch (e) {
      if (e instanceof MembershipError) return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } });
      if (e instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira a admissão explícita de IA.' } });
      if (e instanceof Fault) return reply.code(e.status).send({ error: { code: e.code, message: e.message } });
      return reply.code(500).send({ error: { code: 'manual_ai_admission_internal_error', message: 'Consulte o recibo da admissão original antes de continuar.' } });
    }
  };
  const prefix = '/api/v1/whatsapp/conversations/:id';
  app.get(prefix + '/manual-ai-context', route(req => {
    z.object({}).strict().parse(req.query); const a = capture(req), p = params.parse(req.params), conversation = store.get(a.actor.tenantId, 'conversations', p.id);
    if (!conversation) throw new Fault(404, 'not_found'); const result = context(store, a.actor, conversation).view; a.assert(); return result;
  }));
  app.get(prefix + '/manual-ai-admissions/:key', route(req => {
    z.object({}).strict().parse(req.query); const a = capture(req), p = params.parse(req.params), row = find(a.actor.tenantId, p.key!);
    if (!row || row.conversationId !== p.id || !owns(a.authority, row)) throw new Fault(404, 'not_found'); const result = view(row); a.assert(); return result;
  }));
  app.post(prefix + '/manual-ai-admissions', route(req => {
    const a = capture(req), p = params.parse(req.params), body = schema.parse(req.body), tenant = a.actor.tenantId;
    if (!editable(a.actor)) throw new Fault(403, 'forbidden'); if (body.expectedTenantId !== tenant) throw new Fault(409, 'context_mismatch');
    const fingerprint = hash([p.id, body]);
    const replay = (row: Entity) => { if (!owns(a.authority, row) || row.conversationId !== p.id || row.fingerprint !== fingerprint) throw new Fault(409, 'idempotency_conflict'); a.assert(); return { operation: view(row), replayed: true }; };
    const old = find(tenant, body.key); if (old) return replay(old);
    return store.transaction(() => {
      a.assert(); const previous = find(tenant, body.key); if (previous) return replay(previous);
      const conversation = store.get(tenant, 'conversations', p.id), c = conversation && context(store, a.actor, conversation);
      const evidence = body.recipientEvidenceId ? c?.captured.evidence.find(e => e.row.id === body.recipientEvidenceId) : undefined;
      if (!c?.view.canAdmit || c.view.version !== body.expectedVersion || c.source?.id !== body.sourceMessageId
        || body.recipientEvidenceId && (!c.captured.view.evidence.complete || !evidence)) throw new Fault(409, 'whatsapp_manual_ai_not_admitted');
      const originRecipient = '+' + c.proof!.from, recipient = evidence ? String(evidence.row.recipient) : originRecipient;
      if (attestedRecipientBusy(store, tenant, p.id, String(c.proof!.phoneNumberId), [originRecipient, recipient])) throw new Fault(409, 'whatsapp_manual_ai_not_admitted');
      const row = store.create(tenant, manualAdmissionCollection, { key: body.key, fingerprint, authority: a.authority, conversationId: p.id, sourceMessageId: c.source!.id,
        recipientEvidenceId: evidence?.row.id ?? null, evidenceDigest: evidence?.digest ?? null, deliveryEvidenceId: evidence?.delivery.id ?? null, originRecipient, recipient,
        originalVersion: body.expectedVersion, inputDigest: c.inputDigest, status: 'admitted' });
      const job = store.create(tenant, 'reply-jobs', { provider: 'meta', mode: 'transactional_inbound', admissionMode: 'manual_only', manualAdmissionId: row.id,
        sourceMessageId: c.source!.id, providerMessageId: c.source!.providerMessageId, conversationId: p.id, channelId: c.channel!.id, agentId: c.agent!.id,
        channelSnapshot: c.captured.current, originRecipient, recipient, incomingAt: Number(c.proof!.providerTimestamp) * 1000, status: 'queued', attempts: 0, dueAt: Date.now() });
      const saved = store.update(tenant, manualAdmissionCollection, row.id, { jobId: job.id, jobVersion: hash(job), jobIdentityDigest: hash(jobIdentity(job)) })!;
      store.create(tenant, 'whatsapp-manual-ai-admission-audits', { operationId: row.id, jobId: job.id, conversationId: p.id, actorUserId: a.actor.userId, membershipId: a.actor.membershipId });
      if (validateManualAdmission(store, job, a.authority)) throw new Fault(409, 'whatsapp_manual_ai_not_admitted');
      a.assert(); return { operation: view(saved), replayed: false };
    });
  }));
}
