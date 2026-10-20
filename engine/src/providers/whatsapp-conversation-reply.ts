import type { FastifyInstance, FastifyRequest } from 'fastify';
import { metaCreds } from '../meta-tenants.js';
import { createHash } from 'node:crypto';
import { metaIdentityHumanReviewRequired } from './meta-identity-review.js';
import { resolveRecipientAttestation, consumeRecipientAttestation, attestedRecipientBusy } from './meta-recipient-attestation.js';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { MembershipError } from '../memberships/service.js';
import { hasPermission } from '../memberships/permissions.js';
import { assertRequestContext, parseExpectedRequestContext, resolveSessionContext } from '../request-context.js';
import { captureWhatsAppChannel } from '../whatsapp-channel-state.js';
import { chatGeneration } from '../conversation-replies-shared.js';
import { captureMetaContact, metaInboundSender, metaInboundMessageId } from './meta-identity.js';
import { findMetaOutbound, replayMetaDelivery } from './meta-delivery.js';
import { graphSendDiagnostics } from './whatsapp-send-diagnostics.js';
import { WhatsAppSendFault as Fault, sendWhatsAppPayload, conversationReplyCollection as collection, unresolvedHumanReply } from './whatsapp-send.js';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), key = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/);
const params = z.object({ id, key: key.optional() }).strict();
const bodySchema = z.object({ expectedTenantId: id, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), idempotencyKey: key, text: z.string().trim().min(1).max(4096), confirm: z.literal(true), recipientAttestationId: id.optional() }).strict();
export const whatsappReplyReasons = ['forbidden', 'unsupported_channel', 'identity_requires_review', 'inbound_unverified', 'inbound_ambiguous', 'channel_unavailable', 'channel_changed', 'provider_unavailable', 'human_takeover_required', 'invalid_timestamp', 'outside_window', 'job_in_flight', 'send_requires_reconciliation', 'attestation_unavailable', 'attestation_consumed', 'attestation_stale'] as const;
type Reason = typeof whatsappReplyReasons[number];
const config = () => hash(['PROVIDER_TENANT_ID', 'META_PHONE_NUMBER_ID', 'META_ACCESS_TOKEN', 'META_GRAPH_VERSION', 'META_WABA_ID'].map(k => process.env[k] ?? ''));

export async function registerWhatsAppConversationReply(app: FastifyInstance, store: Store, options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = options.fetcher ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a)), now = options.now ?? Date.now, active = new Set<string>();
  function actor(req: FastifyRequest) {
    if (req.apiKey || !req.cookies?.kloel_session) throw new Fault(401, 'unauthorized');
    if (!parseExpectedRequestContext(req)) throw new Fault(400, 'expected_context_required', 'Atualize a sessão antes de responder.');
    assertRequestContext(store, req);
    const sessionHash = createHash('sha256').update(req.cookies.kloel_session).digest('hex'), s = resolveSessionContext(store, sessionHash);
    if (!s?.actor || s.actor.userId !== req.actor?.userId || s.actor.tenantId !== req.actor?.tenantId || !hasPermission(s.actor.role, 'conversations:read')) throw new Fault(403, 'forbidden');
    return { ...s.actor, membershipId: s.context.membershipId!, sessionHash, authorityVersion: s.context.authorityVersion };
  }
  function capture(req: FastifyRequest) {
    const original = actor(req);
    return { original, assert() { if (hash(actor(req)) !== hash(original)) throw new Fault(409, 'authority_changed'); } };
  }
  type Authority = ReturnType<typeof capture>;
  function editable(a: Authority['original']) { return hasPermission(a.role, 'conversations:write') && hasPermission(a.role, 'integrations:manage'); }
  function context(a: Authority['original'], conversationId: string, excludeId = '', attestationId?: string) {
    const conv = store.get(a.tenantId, 'conversations', conversationId);
    if (!conv) throw new Fault(404, 'not_found');
    const raw = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='messages' AND json_extract(body,'$.conversationId')=? AND json_extract(body,'$.source')='meta' AND json_extract(body,'$.role')='user' ORDER BY rowid DESC LIMIT 1`).get(a.tenantId, conv.id);
    const source = raw ? JSON.parse(String(raw.body)) as Entity : undefined;
    const proofs = source ? store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='provider-events' AND json_extract(body,'$.messageId')=? AND json_extract(body,'$.inboundEvidenceVersion')=1 LIMIT 2`).all(a.tenantId, source.id).map(r => JSON.parse(String(r.body)) as Entity) : [];
    const proof = proofs.length === 1 ? proofs[0] : undefined;
    const bound = proof && source && proof.provider === 'meta' && proof.type === 'message.received' && proof.conversationId === conv.id && proof.providerMessageId === source.providerMessageId
      && proof.eventId === source.providerMessageId && metaInboundMessageId(proof.providerMessageId) && metaInboundSender(proof.from)
      && /^\d{1,40}$/.test(String(proof.phoneNumberId)) && source.phoneNumberId === proof.phoneNumberId && source.externalContact === '+' + proof.from && conv.externalContact === source.externalContact;
    const channel = bound && typeof proof.channelId === 'string' ? store.get(a.tenantId, 'channels', proof.channelId) : undefined;
    const stamp = bound && typeof proof.providerTimestamp === 'string' && /^\d{1,16}$/.test(proof.providerTimestamp) ? Number(proof.providerTimestamp) * 1000 : NaN;
    const timeValid = Number.isSafeInteger(stamp) && stamp > 0 && stamp <= now() + 60000 && stamp + 86400000 <= 8640000000000000;
    let reason: Reason | null = null;
    if (conv.channel !== 'whatsapp') reason = 'unsupported_channel';
    else if (metaIdentityHumanReviewRequired(store, conv)) reason = 'identity_requires_review';
    else if (proofs.length > 1) reason = 'inbound_ambiguous';
    else if (!bound) reason = 'inbound_unverified';
    else if (!channel || channel.type !== 'whatsapp' || channel.provider !== 'meta' || channel.enabled !== true || conv.channelId !== channel.id || (channel.configuration as any)?.externalId !== proof.phoneNumberId) reason = 'channel_unavailable';
    else { try { if (hash(captureWhatsAppChannel(channel, String(proof.phoneNumberId))) !== hash(proof.channelSnapshot)) reason = 'channel_changed'; } catch { reason = 'channel_changed'; } }
    if (!reason && (metaCreds(a.tenantId)?.phoneId !== proof!.phoneNumberId || !metaCreds(a.tenantId)?.token || !/^v\d+\.\d+$/.test(metaCreds(a.tenantId)?.version ?? ''))) reason = 'provider_unavailable';
    if (!reason && conv.status !== 'pending') reason = 'human_takeover_required';
    if (!reason && !timeValid) reason = 'invalid_timestamp';
    if (!reason && now() - stamp >= 86400000) reason = 'outside_window';
    if (!reason && store.db.prepare(`SELECT id FROM entities WHERE tenant_id=? AND collection='reply-jobs' AND json_extract(body,'$.provider')='meta' AND json_extract(body,'$.conversationId')=? AND json_extract(body,'$.status') IN ('generating','preparing_send','sending','requires_reconciliation') LIMIT 1`).get(a.tenantId, conv.id)) reason = 'job_in_flight';
    const attestation = attestationId ? resolveRecipientAttestation(store, a, conv, attestationId, excludeId, now()) : undefined;
    if (!reason && attestation?.reason) reason = attestation.reason as Reason;
    const recipient = attestation?.recipient ?? (bound ? '+' + proof.from : null);
    if (!reason && attestedRecipientBusy(store, a.tenantId, conv.id, String(proof!.phoneNumberId), [recipient!], excludeId)) reason = 'send_requires_reconciliation';
    if (!editable(a)) reason = 'forbidden';
    const version = hash(['whatsapp-conversation-reply-v1', conv, source ?? null, proof ?? null, channel ?? null, config(), ...(attestationId ? [attestationId, attestation?.row ?? null] : [])]);
    return { conv, source, proof, channel, recipient, view: { conversationId: conv.id, tenantId: a.tenantId, version, canReply: !reason, reasonCode: reason,
      channelId: bound && channel ? channel.id : null, sourceMessageId: bound ? source!.id : null, windowExpiresAt: bound && timeValid ? new Date(stamp + 86400000).toISOString() : null,
      destination: bound && (!attestationId || !attestation?.reason) ? { display: '••••' + String(recipient).slice(-4), provenance: attestationId ? 'operator_attested' as const : 'signed_inbound' as const } : null,
      ...(attestationId ? { origin: bound ? { display: '••••' + String(proof.from).slice(-4), provenance: 'signed_inbound' as const } : null, recipientAttestationId: attestationId, attestationExpiresAt: attestation?.row?.expiresAt ?? null } : {}) } };
  }
  function owns(a: Authority['original'], row: Entity) { return row.operatorUserId === a.userId && row.membershipId === a.membershipId && row.sessionHash === a.sessionHash && row.authorityVersion === a.authorityVersion; }
  function find(tenant: string, operationKey: string) { const r = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 1`).get(tenant, collection, operationKey); return r ? JSON.parse(String(r.body)) as Entity : undefined; }
  function view(row: Entity) {
    const accepted = row.status === 'succeeded', status = row.status === 'pending' && !active.has(row.id) ? 'unknown' : row.status;
    const candidate = accepted ? findMetaOutbound(store, row.tenantId, row.phoneNumberId, row.providerMessageId) : undefined;
    const message = candidate?.id === row.messageId && candidate?.conversationId === row.conversationId && candidate?.replyOperationId === row.id ? candidate : undefined;
    return { key: row.key, kind: 'conversation_reply' as const, tenantId: row.tenantId, conversationId: row.conversationId, status,
      externalEffect: accepted ? 'accepted' : row.status === 'failed' ? 'not_accepted' : 'unconfirmed', localLink: row.localLink === 'linked' && message ? 'linked' : 'not_linked', messageId: message?.id ?? null,
      deliveryStatus: accepted ? message && ['sent', 'delivered', 'read', 'failed'].includes(String(message.providerStatus)) ? message.providerStatus : 'accepted' : null,
      requiresReconciliation: ['pending', 'unknown'].includes(String(status)) || accepted && !message, automaticRetry: false,
      errorCode: typeof row.errorCode === 'string' && /^[a-z0-9_]{1,100}$/.test(row.errorCode) ? row.errorCode : null, ...(row.status === 'failed' ? graphSendDiagnostics(row) : {}), createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
  const route = (fn: (req: FastifyRequest) => unknown) => async (req: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    try { return await fn(req); }
    catch (e) {
      if (e instanceof MembershipError) return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } });
      if (e instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira a resposta.' } });
      if (e instanceof Fault) return reply.code(e.status).send({ error: { code: e.code, message: e.message, ...graphSendDiagnostics(e.diagnostics) } });
      return reply.code(500).send({ error: { code: 'whatsapp_reply_internal_error', message: 'Consulte o recibo original antes de continuar.' } });
    }
  };
  const prefix = '/api/v1/whatsapp/conversations/:id';
  app.get(prefix + '/reply-context', route(req => { const query = z.object({ recipientAttestationId: id.optional() }).strict().parse(req.query); const a = capture(req), value = context(a.original, params.parse(req.params).id, '', query.recipientAttestationId).view; a.assert(); return value; }));
  app.get(prefix + '/reply-operations/:key', route(req => {
    const a = capture(req), p = params.parse(req.params), row = find(a.original.tenantId, p.key!);
    if (!row || row.conversationId !== p.id || !owns(a.original, row)) throw new Fault(404, 'not_found');
    const result = view(row); a.assert(); return result;
  }));
  app.post(prefix + '/replies', route(async req => {
    const a = capture(req), p = params.parse(req.params), body = bodySchema.parse(req.body), tenant = a.original.tenantId;
    if (!editable(a.original)) throw new Fault(403, 'forbidden');
    if (body.expectedTenantId !== tenant) throw new Fault(409, 'context_mismatch');
    const fingerprint = hash([p.id, body]);
    const replay = (row: Entity) => { if (!owns(a.original, row) || row.conversationId !== p.id || row.fingerprint !== fingerprint) throw new Fault(409, 'idempotency_conflict'); a.assert(); return { operation: view(row), replayed: true }; };
    const old = find(tenant, body.idempotencyKey); if (old) return replay(old);
    const reserved = store.transaction(() => {
      a.assert(); const existing = find(tenant, body.idempotencyKey); if (existing) return { replay: replay(existing) };
      if (store.list(tenant, 'whatsapp-operations').some(r => r.key === body.idempotencyKey) || store.list(tenant, 'provider-operations').some(r => r.key === body.idempotencyKey)) throw new Fault(409, 'idempotency_conflict');
      const current = context(a.original, p.id, '', body.recipientAttestationId);
      if (!current.view.canReply || current.view.version !== body.expectedVersion) throw new Fault(409, 'whatsapp_reply_not_admitted', 'A resposta não foi reservada. Consulte o contexto atual antes de uma nova confirmação.');
      const row = store.create(tenant, collection, { key: body.idempotencyKey, kind: 'conversation_reply', fingerprint, operatorUserId: a.original.userId, membershipId: a.original.membershipId, sessionHash: a.original.sessionHash, authorityVersion: a.original.authorityVersion,
        conversationId: p.id, originalVersion: body.expectedVersion, sourceMessageId: current.source!.id, sourceProviderId: current.source!.providerMessageId,
        phoneNumberId: current.proof!.phoneNumberId, channelId: current.channel!.id, channelSnapshot: current.proof!.channelSnapshot, recipient: current.recipient,
        ...(body.recipientAttestationId ? { recipientAttestationId: body.recipientAttestationId, originRecipient: '+' + current.proof!.from } : {}), status: 'pending', localLink: 'not_linked' });
      const reservedConversation = store.update(tenant, 'conversations', p.id, { replyRevision: chatGeneration(current.conv) + 1 })!;
      if (body.recipientAttestationId) consumeRecipientAttestation(store, tenant, body.recipientAttestationId, row, reservedConversation);
      const captured = context(a.original, p.id, row.id, body.recipientAttestationId);
      if (!captured.view.canReply) throw new Fault(409, 'whatsapp_reply_not_admitted');
      const reservedRow = store.update(tenant, collection, row.id, { reservedVersion: captured.view.version })!;
      a.assert(); return { row: reservedRow };
    });
    if (reserved.replay) return reserved.replay;
    const receipt = reserved.row!, env = { token: metaCreds(receipt.tenantId)!.token, phoneId: String(receipt.phoneNumberId), version: metaCreds(receipt.tenantId)!.version };
    active.add(receipt.id); let attempted = false, accepted = false;
    const assertIntent = () => {
      a.assert(); const current = context(a.original, p.id, receipt.id, body.recipientAttestationId);
      if (!current.view.canReply || current.view.version !== receipt.reservedVersion) throw new Fault(409, 'whatsapp_reply_context_changed', 'O contexto mudou durante a tentativa. Consulte o recibo original.');
    };
    try {
      const { data, messageId } = await sendWhatsAppPayload({ fetcher, env, beforeDispatch: assertIntent, onDispatch: () => { attempted = true; }, onRejected: () => { attempted = false; },
        payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(receipt.recipient).slice(1), type: 'text', context: { message_id: receipt.sourceProviderId }, text: { preview_url: false, body: body.text } } });
      accepted = true;
      const recipientIdentity = captureMetaContact(data, { tenantId: tenant, phoneNumberId: env.phoneId, channelId: String(receipt.channelId), channelVersion: String((receipt.channelSnapshot as any).version), ownerCollection: 'whatsapp-conversation-replies', ownerId: receipt.id, requestedDestination: String(receipt.recipient), providerMessageId: messageId });
      store.update(tenant, collection, receipt.id, { status: 'succeeded', providerMessageId: messageId, ...(recipientIdentity ? { recipientIdentity } : {}) });
      assertIntent();
      store.transaction(() => {
        assertIntent();
        const message = store.create(tenant, 'messages', { conversationId: p.id, role: 'assistant', source: 'meta', content: body.text, deliveryStatus: 'sent', providerMessageId: messageId, phoneNumberId: env.phoneId, recipient: receipt.recipient,
          authorType: 'human', authorUserId: a.original.userId, authorMembershipId: a.original.membershipId, replyOperationId: receipt.id });
        replayMetaDelivery(store, tenant, message.id);
        store.update(tenant, collection, receipt.id, { localLink: 'linked', messageId: message.id });
        store.update(tenant, 'conversations', p.id, { lastMessageAt: message.createdAt }); a.assert();
      });
      a.assert(); return { operation: view(store.get(tenant, collection, receipt.id)!), replayed: false };
    } catch (e) {
      if (!accepted && store.get(tenant, collection, receipt.id)?.status !== 'succeeded') store.update(tenant, collection, receipt.id, { status: attempted ? 'unknown' : 'failed', errorCode: e instanceof Fault ? e.code : attempted ? 'provider_outcome_unknown' : 'whatsapp_reply_not_dispatched', ...(e instanceof Fault ? graphSendDiagnostics(e.diagnostics) : {}) });
      a.assert(); throw e;
    } finally { active.delete(receipt.id); }
  }));
}
