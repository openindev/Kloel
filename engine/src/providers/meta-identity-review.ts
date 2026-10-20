import { createHash } from 'node:crypto';
import type { Entity, Store } from '../store.js';
import { captureWhatsAppChannel } from '../whatsapp-channel-state.js';
import { findMetaInboundConversation, metaInboundMessageId, metaInboundSender } from './meta-identity.js';

export const identityReviewCollection = 'whatsapp-identity-reviews';
export const identityReviewHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const metaAutomationBlocked = (conversation: Entity | undefined) => !!conversation &&
  (conversation.metaIdentityPolicy !== undefined || ['requires_review', 'reviewed_human'].includes(String(conversation.metaIdentityStatus)));
export const identityReviewReasons = ['forbidden', 'unsupported_channel', 'not_required', 'already_reviewed', 'inbound_unverified', 'inbound_ambiguous', 'channel_unavailable', 'channel_changed', 'invalid_timestamp', 'outside_window', 'human_takeover_required', 'quarantine_tag_required', 'collisions_incomplete'] as const;
type Reason = typeof identityReviewReasons[number];

function evidence(store: Store, conversation: Entity, messageId?: string) {
  const row = messageId ? undefined : store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='messages' AND json_extract(body,'$.conversationId')=? AND json_extract(body,'$.source')='meta' AND json_extract(body,'$.role')='user' ORDER BY rowid DESC LIMIT 1`).get(conversation.tenantId, conversation.id);
  const source = messageId ? store.get(conversation.tenantId, 'messages', messageId) : row ? JSON.parse(String(row.body)) as Entity : undefined;
  const proofs = source ? store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='provider-events' AND json_extract(body,'$.messageId')=? AND json_extract(body,'$.inboundEvidenceVersion')=1 LIMIT 2`).all(conversation.tenantId, source.id).map(r => JSON.parse(String(r.body)) as Entity) : [];
  const proof = proofs.length === 1 ? proofs[0] : undefined;
  const bound = !!(source && proof && source.source === 'meta' && source.role === 'user' && source.conversationId === conversation.id
    && proof.provider === 'meta' && proof.type === 'message.received' && proof.conversationId === conversation.id && proof.providerMessageId === source.providerMessageId
    && proof.eventId === source.providerMessageId && metaInboundMessageId(proof.providerMessageId) && metaInboundSender(proof.from)
    && /^\d{1,40}$/.test(String(proof.phoneNumberId)) && source.phoneNumberId === proof.phoneNumberId
    && source.externalContact === '+' + proof.from && conversation.externalContact === source.externalContact);
  return { source, proof, bound, ambiguous: proofs.length > 1 };
}

/** Same conservative collision definition as ingress, excluding only the new reviewed route. */
function collisions(store: Store, conversation: Entity, phone: string, from: string) {
  const rows = store.db.prepare(`SELECT c.body FROM entities c WHERE c.tenant_id=? AND c.collection='conversations' AND c.id!=?
    AND json_extract(c.body,'$.channel')='whatsapp' AND json_extract(c.body,'$.externalContact')=? AND NOT EXISTS (
      SELECT COUNT(*) FROM entities e JOIN entities m ON m.tenant_id=e.tenant_id AND m.collection='messages'
      AND m.id=json_extract(e.body,'$.messageId') AND json_extract(m.body,'$.conversationId')=c.id
      AND json_extract(m.body,'$.source')='meta' AND json_extract(m.body,'$.role')='user'
      AND json_extract(m.body,'$.providerMessageId')=json_extract(e.body,'$.providerMessageId')
      AND json_extract(m.body,'$.phoneNumberId')=json_extract(e.body,'$.phoneNumberId')
      AND json_extract(m.body,'$.externalContact')='+'||json_extract(e.body,'$.from')
      WHERE e.tenant_id=c.tenant_id AND e.collection='provider-events' AND json_extract(e.body,'$.provider')='meta'
      AND json_extract(e.body,'$.type')='message.received' AND json_extract(e.body,'$.inboundEvidenceVersion')=1
      AND json_extract(e.body,'$.conversationId')=c.id AND json_extract(e.body,'$.from')=?
      HAVING COUNT(DISTINCT json_extract(e.body,'$.phoneNumberId'))=1 AND MAX(json_extract(e.body,'$.phoneNumberId'))!=?
    ) ORDER BY c.id LIMIT 51`).all(conversation.tenantId, conversation.id, '+' + from, from, phone).map(r => JSON.parse(String(r.body)) as Entity);
  return { rows, complete: rows.length <= 50, digest: identityReviewHash(rows) };
}

export function captureMetaIdentityReview(store: Store, conversation: Entity, now = Date.now()) {
  const { source, proof, bound, ambiguous } = evidence(store, conversation);
  const channel = bound && typeof proof!.channelId === 'string' ? store.get(conversation.tenantId, 'channels', proof!.channelId) : undefined;
  const conflicts = bound ? collisions(store, conversation, String(proof!.phoneNumberId), String(proof!.from)) : { rows: [], complete: false, digest: identityReviewHash([]) };
  let routeReason: Reason | null = null;
  if (conversation.channel !== 'whatsapp') routeReason = 'unsupported_channel';
  else if (ambiguous) routeReason = 'inbound_ambiguous';
  else if (!bound) routeReason = 'inbound_unverified';
  else if (!channel || channel.type !== 'whatsapp' || channel.provider !== 'meta' || channel.enabled !== true || conversation.channelId !== channel.id || (channel.configuration as any)?.externalId !== proof!.phoneNumberId) routeReason = 'channel_unavailable';
  else { try { if (identityReviewHash(captureWhatsAppChannel(channel, String(proof!.phoneNumberId))) !== identityReviewHash(proof!.channelSnapshot)) routeReason = 'channel_changed'; } catch { routeReason = 'channel_changed'; } }
  if (!routeReason && findMetaInboundConversation(store, conversation.tenantId, String(proof!.phoneNumberId), String(proof!.from), channel)?.id !== conversation.id) routeReason = 'inbound_ambiguous';
  const binding = bound ? identityReviewHash([conversation.id, proof!.phoneNumberId, proof!.from, proof!.channelId, proof!.channelSnapshot]) : null;
  const decision = typeof conversation.metaIdentityReviewId === 'string' ? store.get(conversation.tenantId, identityReviewCollection, conversation.metaIdentityReviewId) : undefined;
  const origin = decision && typeof decision.sourceMessageId === 'string' ? evidence(store, conversation, decision.sourceMessageId) : undefined;
  const valid = !routeReason && conflicts.complete && conversation.metaIdentityStatus === 'reviewed_human' && conversation.metaIdentityPolicy === 'manual_only'
    && decision?.status === 'applied' && decision.policy === 'manual_only' && decision.conversationId === conversation.id && decision.binding === binding
    && decision.collisionDigest === conflicts.digest && origin?.bound === true && identityReviewHash(origin.proof) === decision.proofDigest;
  const reviewState = valid ? 'valid' : conversation.metaIdentityStatus === 'reviewed_human' || conversation.metaIdentityPolicy !== undefined ? 'stale' : conversation.metaIdentityStatus === 'requires_review' ? 'required' : 'not_required';
  const stamp = bound && typeof proof!.providerTimestamp === 'string' && /^\d{1,16}$/.test(proof!.providerTimestamp) ? Number(proof!.providerTimestamp) * 1000 : NaN;
  const timeValid = Number.isSafeInteger(stamp) && stamp > 0 && stamp <= now + 60000 && stamp + 86400000 <= 8640000000000000;
  let reason: Reason | null = routeReason;
  if (!reason && reviewState === 'not_required') reason = 'not_required';
  if (!reason && valid) reason = 'already_reviewed';
  if (!reason && !conflicts.complete) reason = 'collisions_incomplete';
  if (!reason && conversation.status !== 'pending') reason = 'human_takeover_required';
  if (!reason && !(Array.isArray(conversation.tags) && conversation.tags.includes('no_ai'))) reason = 'quarantine_tag_required';
  if (!reason && !timeValid) reason = 'invalid_timestamp';
  if (!reason && now - stamp >= 86400000) reason = 'outside_window';
  const version = identityReviewHash(['meta-identity-review-v1', conversation, source ?? null, proof ?? null, channel ?? null, conflicts.digest, decision ?? null]);
  return { source, proof, channel, binding, conflicts, valid: !!valid, view: {
    tenantId: conversation.tenantId, conversationId: conversation.id, version, reviewState, policy: conversation.metaIdentityPolicy === 'manual_only' ? 'manual_only' : null,
    canReview: !reason, reasonCode: reason as Reason | null, sourceMessageId: bound ? source!.id : null, channelId: bound && channel ? channel.id : null,
    destination: bound ? { display: '••••' + String(proof!.from).slice(-4), provenance: 'signed_inbound' as const } : null,
    windowExpiresAt: timeValid ? new Date(stamp + 86400000).toISOString() : null,
    collisions: { complete: conflicts.complete, items: conflicts.rows.slice(0, 50).map(c => ({ conversationId: c.id, status: ['open', 'pending', 'closed'].includes(String(c.status)) ? c.status : 'unknown', noAi: Array.isArray(c.tags) && c.tags.includes('no_ai'), humanHandoff: Array.isArray(c.tags) && c.tags.includes('human_handoff') })) },
  } };
}

/** A reviewed route is usable by the native human composer only while its decision still matches. */
export function metaIdentityHumanReviewRequired(store: Store, conversation: Entity): boolean {
  if (!metaAutomationBlocked(conversation)) return false;
  return !captureMetaIdentityReview(store, conversation).valid;
}
