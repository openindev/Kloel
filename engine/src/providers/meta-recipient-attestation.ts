import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { hasPermission } from '../memberships/permissions.js';
import { MembershipError } from '../memberships/service.js';
import { assertRequestContext, parseExpectedRequestContext, resolveSessionContext } from '../request-context.js';
import { captureWhatsAppChannel } from '../whatsapp-channel-state.js';
import { captureMetaIdentityReview, identityReviewHash as hash } from './meta-identity-review.js';
import { findMetaOutbound } from './meta-delivery.js';
import { WhatsAppSendFault as Fault, unresolvedHumanReply } from './whatsapp-send.js';

export const recipientAttestationCollection = 'whatsapp-recipient-attestations';
export type RecipientAuthority = NonNullable<FastifyRequest['actor']> & { membershipId: string; sessionHash: string; authorityVersion: string };
const owns = (a: RecipientAuthority, r: Entity) => r.operatorUserId === a.userId && r.membershipId === a.membershipId && r.sessionHash === a.sessionHash && r.authorityVersion === a.authorityVersion;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const digits = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{7,14}$/.test(v);
const hex = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), key = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/);
const params = z.object({ id, key: key.optional() }).strict();
const bodySchema = z.object({ expectedTenantId: id, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), key, evidenceId: id, confirm: z.literal(true) }).strict();
export const recipientAttestationReasons = ['forbidden', 'identity_review_required', 'human_takeover_required', 'outside_window', 'evidence_unavailable', 'evidence_incomplete', 'send_requires_reconciliation', 'attestation_unavailable', 'attestation_consumed', 'attestation_stale'] as const;
type Reason = typeof recipientAttestationReasons[number];

/** A contact pair is a historical fact, not a grant. No current channel version is attributed to it. */
export function deliveredObservation(store: Store, tenant: string, row: Entity | undefined, proof: Entity, now: number, deliveryId?: string) {
  const c = row?.recipientIdentity;
  if (!row || !object(c) || c.version !== 1 || c.kind !== 'meta_send_response_contact' || c.ownerCollection !== 'whatsapp-operations' || c.ownerId !== row.id
    || c.tenantId !== tenant || row.tenantId !== tenant || c.phoneNumberId !== proof.phoneNumberId || row.phoneNumberId !== proof.phoneNumberId
    || c.channelId !== proof.channelId || row.channelId !== proof.channelId || !hex(c.channelVersion) || c.channelVersion !== row.channelVersion
    || !['text', 'template'].includes(String(row.kind)) || row.status !== 'succeeded' || !object(row.result) || row.result.status !== 'accepted'
    || c.providerMessageId !== row.result.messageId || typeof c.providerMessageId !== 'string' || !/^wamid\.[A-Za-z0-9_+=/.-]{1,480}$/.test(c.providerMessageId)
    || row.result.conversationId !== row.conversationId || typeof row.conversationId !== 'string'
    || typeof row.operatorUserId !== 'string' || !row.operatorUserId || typeof row.membershipId !== 'string' || !row.membershipId
    || typeof row.recipient !== 'string' || !/^\+[1-9]\d{7,14}$/.test(row.recipient) || c.requestedDestination !== row.recipient
    || typeof c.input !== 'string' || !/^\+?[1-9]\d{7,14}$/.test(c.input) || c.input.replace(/^\+/, '') !== row.recipient.slice(1)
    || !digits(c.waId) || c.waId !== proof.from || c.waId === row.recipient.slice(1)) return;
  const observed = typeof c.observedAt === 'string' ? Date.parse(c.observedAt) : NaN;
  if (!Number.isFinite(observed) || new Date(observed).toISOString() !== c.observedAt || observed > now + 60000 || now - observed >= 86400000) return;
  const owners = store.db.prepare(`SELECT id FROM entities WHERE tenant_id=? AND (
    (collection='whatsapp-operations' AND json_extract(body,'$.result.messageId')=?) OR
    (collection='reply-jobs' AND json_extract(body,'$.outboundMessageId')=?) OR
    (collection='whatsapp-conversation-replies' AND json_extract(body,'$.providerMessageId')=?)) LIMIT 2`).all(tenant, c.providerMessageId, c.providerMessageId, c.providerMessageId);
  if (owners.length !== 1 || owners[0].id !== row.id) return;
  const message = findMetaOutbound(store, tenant, c.phoneNumberId, c.providerMessageId, { collection: 'whatsapp-operations', id: row.id });
  if (!message || message.phoneNumberId !== c.phoneNumberId || message.recipient !== row.recipient || message.authorType !== 'human'
    || message.authorUserId !== row.operatorUserId || message.authorMembershipId !== row.membershipId || message.conversationId !== row.conversationId) return;
  const raw = deliveryId ? undefined : store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='provider-events'
    AND json_extract(body,'$.deliveryEvidenceVersion')=1 AND json_extract(body,'$.phoneNumberId')=?
    AND json_extract(body,'$.providerMessageId')=? AND json_extract(body,'$.status') IN ('delivered','read') ORDER BY rowid LIMIT 1`).get(tenant, c.phoneNumberId, c.providerMessageId);
  const delivery = deliveryId ? store.get(tenant, 'provider-events', deliveryId) : raw ? JSON.parse(String(raw.body)) as Entity : undefined;
  if (!delivery || delivery.provider !== 'meta' || delivery.deliveryEvidenceVersion !== 1 || delivery.phoneNumberId !== c.phoneNumberId || delivery.providerMessageId !== c.providerMessageId
    || !['delivered', 'read'].includes(String(delivery.status)) || !Number.isSafeInteger(delivery.statusTimestamp) || Number(delivery.statusTimestamp) <= 0
    || Number(delivery.statusTimestamp) * 1000 > now + 60000 || Number(delivery.statusTimestamp) * 1000 < observed - 60000
    || delivery.eventId !== `${c.providerMessageId}:${delivery.status}:${delivery.statusTimestamp}` || delivery.type !== 'message.' + delivery.status) return;
  const digest = hash([c, row.id, row.kind, row.operatorUserId, row.membershipId, row.conversationId, row.recipient, row.result,
    message.id, message.phoneNumberId, message.providerMessageId, message.recipient, message.authorType, message.authorUserId, message.authorMembershipId, delivery]);
  return { row, contact: c, digest, delivery, expiresAt: new Date(observed + 86400000).toISOString() };
}

/** Both spellings are excluded while any physical effect is unresolved. This grants no AI authority. */
export function attestedRecipientBusy(store: Store, tenant: string, conversationId: string, phone: string, recipients: string[], excludeReplyId = '', excludeJobId = '') {
  return recipients.some(recipient => unresolvedHumanReply(store, tenant, { conversationId, phoneNumberId: phone, recipient }, excludeReplyId)
    || !!store.db.prepare(`SELECT id FROM entities WHERE tenant_id=? AND collection='whatsapp-operations' AND json_extract(body,'$.phoneNumberId')=?
      AND json_extract(body,'$.recipient')=? AND json_extract(body,'$.status') IN ('pending','unknown') LIMIT 1`).get(tenant, phone, recipient)
    || !!store.db.prepare(`SELECT id FROM entities WHERE tenant_id=? AND collection='reply-jobs' AND id!=? AND json_extract(body,'$.provider')='meta'
      AND (json_extract(body,'$.conversationId')=? OR ((json_extract(body,'$.channelSnapshot.phoneNumberId')=? OR json_extract(body,'$.manualOncePhoneNumberId')=?) AND (json_extract(body,'$.recipient')=? OR json_extract(body,'$.originRecipient')=?)))
      AND json_extract(body,'$.status') IN ('generating','preparing_send','sending','requires_reconciliation') LIMIT 1`).get(tenant, excludeJobId, conversationId, phone, phone, recipient, recipient));
}

export function captureRecipientAttestationContext(store: Store, a: RecipientAuthority, conversation: Entity, now = Date.now()) {
  const review = captureMetaIdentityReview(store, conversation, now), origin = review.view.destination;
  let reason: Reason | null = !review.valid ? 'identity_review_required' : conversation.status !== 'pending' ? 'human_takeover_required'
    : !review.view.windowExpiresAt || Date.parse(review.view.windowExpiresAt) <= now ? 'outside_window' : null;
  const candidates = review.valid && review.view.windowExpiresAt ? store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='whatsapp-operations'
    AND json_extract(body,'$.recipientIdentity.waId')=? AND json_extract(body,'$.phoneNumberId')=? AND json_extract(body,'$.channelId')=? ORDER BY rowid DESC LIMIT 51`)
    .all(a.tenantId, String(review.proof!.from), String(review.proof!.phoneNumberId), String(review.proof!.channelId)).map(r => JSON.parse(String(r.body)) as Entity) : [];
  const evidence = candidates.map(row => deliveredObservation(store, a.tenantId, row, review.proof!, now)).filter(v => v !== undefined);
  const complete = candidates.length <= 50 && evidence.length <= 20;
  if (!reason && !complete) reason = 'evidence_incomplete';
  if (!reason && !evidence.length) reason = 'evidence_unavailable';
  if (!reason && evidence.every(e => attestedRecipientBusy(store, a.tenantId, conversation.id, String(review.proof!.phoneNumberId), ['+' + review.proof!.from, String(e.row.recipient)]))) reason = 'send_requires_reconciliation';
  if (!hasPermission(a.role, 'conversations:write') || !hasPermission(a.role, 'integrations:manage')) reason = 'forbidden';
  const current = review.channel ? captureWhatsAppChannel(review.channel, String(review.proof!.phoneNumberId)) : null;
  const version = hash(['meta-recipient-attestation-v1', conversation, review.view.version, evidence.map(e => [e.row.id, e.digest]), complete]);
  return { review, evidence, current, view: { tenantId: a.tenantId, conversationId: conversation.id, version, canAttest: !reason, reasonCode: reason,
    sourceMessageId: review.view.sourceMessageId, origin, destinationPolicy: 'explicit_attestation_only', evidence: { complete, items: evidence.slice(0, 20).map(e => ({
      evidenceId: e.row.id, observedAt: e.contact.observedAt, expiresAt: new Date(Math.min(Date.parse(e.expiresAt), Date.parse(review.view.windowExpiresAt!))).toISOString(),
      deliveryStatus: e.delivery.status, origin, destination: { display: '••••' + String(e.row.recipient).slice(-4), provenance: 'meta_send_response_contact' },
      observedChannelVersion: e.contact.channelVersion, currentChannelVersion: current!.version, currentChannelRevision: current!.revision,
    })) } } };
}

export function resolveRecipientAttestation(store: Store, a: RecipientAuthority, conversation: Entity, attestationId: string, excludeReplyId = '', now = Date.now()): { reason: Reason | null; row?: Entity; recipient?: string } {
  const row = store.get(a.tenantId, recipientAttestationCollection, attestationId);
  if (!row || !owns(a, row) || row.status !== 'attested' || row.conversationId !== conversation.id) return { reason: 'attestation_unavailable' };
  if (row.consumedByReplyId && row.consumedByReplyId !== excludeReplyId) return { reason: 'attestation_consumed' };
  const review = captureMetaIdentityReview(store, conversation, now), evidence = review.proof ? deliveredObservation(store, a.tenantId, store.get(a.tenantId, 'whatsapp-operations', String(row.evidenceId)), review.proof, now, String(row.deliveryEvidenceId)) : undefined;
  if (!review.valid || row.sourceMessageId !== review.source?.id || row.proofDigest !== hash(review.proof) || row.reviewId !== conversation.metaIdentityReviewId
    || row.reviewVersion !== review.binding || row.collisionDigest !== review.conflicts.digest || row.channelSnapshotHash !== hash(review.proof?.channelSnapshot)
    || (row.consumedByReplyId ? row.reservedConversationVersion : row.conversationVersion) !== hash(conversation)
    || typeof row.expiresAt !== 'string' || Date.parse(row.expiresAt) <= now || !evidence || evidence.digest !== row.evidenceDigest
    || row.recipient !== evidence.row.recipient || row.originRecipient !== '+' + review.proof!.from) return { reason: 'attestation_stale' };
  if (attestedRecipientBusy(store, a.tenantId, conversation.id, String(review.proof!.phoneNumberId), [String(row.originRecipient), String(row.recipient)], excludeReplyId)) return { reason: 'send_requires_reconciliation' };
  return { reason: null, row, recipient: String(row.recipient) };
}

/** Caller holds the same Store transaction as the reply reservation. Never release this consumption. */
export function consumeRecipientAttestation(store: Store, tenant: string, attestationId: string, reply: Entity, reservedConversation: Entity) {
  const row = store.get(tenant, recipientAttestationCollection, attestationId);
  if (!row || row.consumedByReplyId) throw new Fault(409, 'whatsapp_reply_not_admitted');
  store.update(tenant, recipientAttestationCollection, row.id, { consumedByReplyId: reply.id, consumedByReplyKey: reply.key, reservedConversationVersion: hash(reservedConversation) });
}

export async function registerMetaRecipientAttestation(app: FastifyInstance, store: Store) {
  function actor(req: FastifyRequest): RecipientAuthority {
    if (req.apiKey || !req.cookies?.kloel_session) throw new Fault(401, 'unauthorized');
    if (!parseExpectedRequestContext(req)) throw new Fault(400, 'expected_context_required');
    assertRequestContext(store, req);
    const sessionHash = createHash('sha256').update(req.cookies.kloel_session).digest('hex'), s = resolveSessionContext(store, sessionHash);
    if (!s?.actor || s.actor.userId !== req.actor?.userId || s.actor.tenantId !== req.actor?.tenantId || !hasPermission(s.actor.role, 'conversations:read')) throw new Fault(403, 'forbidden');
    return { ...s.actor, membershipId: s.context.membershipId!, sessionHash, authorityVersion: s.context.authorityVersion };
  }
  const authority = (req: FastifyRequest) => { const original = actor(req); return { original, assert() { if (hash(actor(req)) !== hash(original)) throw new Fault(409, 'authority_changed'); } }; };
  const find = (tenant: string, operationKey: string) => { const r = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 1`).get(tenant, recipientAttestationCollection, operationKey); return r ? JSON.parse(String(r.body)) as Entity : undefined; };
  const view = (r: Entity) => ({ id: r.id, key: r.key, kind: 'recipient_attestation', tenantId: r.tenantId, conversationId: r.conversationId, status: 'attested', sourceMessageId: r.sourceMessageId,
    evidenceId: r.evidenceId, originalVersion: r.originalVersion, expiresAt: r.expiresAt, consumedByReplyKey: r.consumedByReplyKey ?? null, automaticRetry: false, createdAt: r.createdAt });
  const route = (fn: (req: FastifyRequest) => unknown) => async (req: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    try { return await fn(req); } catch (e) {
      if (e instanceof MembershipError) return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } });
      if (e instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira a decisão de destinatário.' } });
      if (e instanceof Fault) return reply.code(e.status).send({ error: { code: e.code, message: e.message } });
      return reply.code(500).send({ error: { code: 'recipient_attestation_internal_error', message: 'Consulte o recibo original antes de continuar.' } });
    }
  };
  const prefix = '/api/v1/whatsapp/conversations/:id';
  app.get(prefix + '/recipient-context', route(req => {
    z.object({}).strict().parse(req.query); const a = authority(req), p = params.parse(req.params), conv = store.get(a.original.tenantId, 'conversations', p.id);
    if (!conv) throw new Fault(404, 'not_found'); const result = captureRecipientAttestationContext(store, a.original, conv).view; a.assert(); return result;
  }));
  app.get(prefix + '/recipient-attestations/:key', route(req => {
    z.object({}).strict().parse(req.query); const a = authority(req), p = params.parse(req.params), row = find(a.original.tenantId, p.key!);
    if (!row || row.conversationId !== p.id || !owns(a.original, row)) throw new Fault(404, 'not_found'); const result = view(row); a.assert(); return result;
  }));
  app.post(prefix + '/recipient-attestations', route(req => {
    const a = authority(req), p = params.parse(req.params), body = bodySchema.parse(req.body), tenant = a.original.tenantId;
    if (!hasPermission(a.original.role, 'conversations:write') || !hasPermission(a.original.role, 'integrations:manage')) throw new Fault(403, 'forbidden');
    if (body.expectedTenantId !== tenant) throw new Fault(409, 'context_mismatch');
    const fingerprint = hash([p.id, body]);
    const replay = (row: Entity) => { if (!owns(a.original, row) || row.conversationId !== p.id || row.fingerprint !== fingerprint) throw new Fault(409, 'idempotency_conflict'); a.assert(); return { operation: view(row), replayed: true }; };
    const old = find(tenant, body.key); if (old) return replay(old);
    return store.transaction(() => {
      a.assert(); const existing = find(tenant, body.key); if (existing) return replay(existing);
      const conv = store.get(tenant, 'conversations', p.id), current = conv && captureRecipientAttestationContext(store, a.original, conv);
      const evidence = current?.evidence.find(e => e.row.id === body.evidenceId);
      if (!current?.view.canAttest || current.view.version !== body.expectedVersion || !evidence
        || attestedRecipientBusy(store, tenant, p.id, String(current.review.proof!.phoneNumberId), ['+' + current.review.proof!.from, String(evidence.row.recipient)])) throw new Fault(409, 'recipient_attestation_not_admitted');
      const row = store.create(tenant, recipientAttestationCollection, { key: body.key, fingerprint, operatorUserId: a.original.userId, membershipId: a.original.membershipId, sessionHash: a.original.sessionHash, authorityVersion: a.original.authorityVersion,
        conversationId: p.id, sourceMessageId: current.review.source!.id, proofDigest: hash(current.review.proof), reviewId: conv!.metaIdentityReviewId, reviewVersion: current.review.binding,
        collisionDigest: current.review.conflicts.digest, channelSnapshotHash: hash(current.review.proof!.channelSnapshot), conversationVersion: hash(conv), evidenceId: evidence.row.id, evidenceDigest: evidence.digest,
        deliveryEvidenceId: evidence.delivery.id, originRecipient: '+' + current.review.proof!.from, recipient: evidence.row.recipient, phoneNumberId: current.review.proof!.phoneNumberId,
        originalVersion: body.expectedVersion, status: 'attested', expiresAt: new Date(Math.min(Date.parse(evidence.expiresAt), Date.parse(current.review.view.windowExpiresAt!))).toISOString(), consumedByReplyId: null, consumedByReplyKey: null });
      store.create(tenant, 'whatsapp-recipient-attestation-audits', { conversationId: p.id, operationId: row.id, actorUserId: a.original.userId, membershipId: a.original.membershipId, evidenceId: evidence.row.id });
      if (resolveRecipientAttestation(store, a.original, store.get(tenant, 'conversations', p.id)!, row.id).reason) throw new Fault(409, 'recipient_attestation_not_admitted');
      a.assert(); return { operation: view(row), replayed: false };
    });
  }));
}
