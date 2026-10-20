import type { Entity, Store } from '../store.js';
import { captureWhatsAppChannel } from '../whatsapp-channel-state.js';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const digits = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{7,14}$/.test(v);
const phoneId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,40}$/.test(v);
export const metaInboundMessageId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_+=/.-]{1,486}$/.test(v);
export const metaInboundSender = digits;
type ContactScope = {
  tenantId: string; phoneNumberId: string; channelId: string | null; channelVersion: string | null;
  ownerCollection: 'whatsapp-operations' | 'reply-jobs' | 'whatsapp-conversation-replies'; ownerId: string; requestedDestination: string; providerMessageId: string;
};
/** Optional observation of the actual send response; never routing authority. */
export function captureMetaContact(response: unknown, scope: ContactScope) {
  const requested = scope.requestedDestination.startsWith('+') ? scope.requestedDestination.slice(1) : scope.requestedDestination;
  if (!digits(requested) || !phoneId(scope.phoneNumberId) || !/^wamid\.[A-Za-z0-9_+=/.-]{1,480}$/.test(scope.providerMessageId) || !scope.tenantId || !scope.ownerId) return;
  if (!object(response) || response.messaging_product !== 'whatsapp' || !Array.isArray(response.contacts) || response.contacts.length !== 1) return;
  if (!Array.isArray(response.messages) || response.messages.length !== 1 || !object(response.messages[0]) || response.messages[0].id !== scope.providerMessageId) return;
  const contact = response.contacts[0];
  if (!object(contact) || typeof contact.input !== 'string' || !digits(contact.wa_id)) return;
  const input = contact.input.startsWith('+') ? contact.input.slice(1) : contact.input;
  if (!digits(input) || input !== requested) return;
  return { version: 1, kind: 'meta_send_response_contact', observedAt: new Date().toISOString(), ...scope, input: contact.input, waId: contact.wa_id };
}

/** Channel association at authenticated ingress; none/ambiguous stays unbound. */
export function metaInboundChannel(store: Store, tenantId: string, phoneNumberId: string): Entity | undefined {
  const rows = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='channels'
    AND json_extract(body,'$.type')='whatsapp' AND json_extract(body,'$.provider')='meta'
    AND json_extract(body,'$.enabled')=1 AND json_extract(body,'$.configuration.externalId')=?
    AND json_type(body,'$.agentId')='text' LIMIT 2`).all(tenantId, phoneNumberId);
  return rows.length === 1 ? JSON.parse(String(rows[0].body)) as Entity : undefined;
}

export function metaInboundRecorded(store: Store, tenantId: string, phoneNumberId: string, providerMessageId: string): boolean {
  // An old opaque receipt still suppresses its duplicate; it never becomes proof.
  return !!store.db.prepare(`SELECT id FROM entities WHERE tenant_id=? AND collection='provider-events'
    AND json_extract(body,'$.provider')='meta' AND json_extract(body,'$.eventId')=?
    AND (json_extract(body,'$.phoneNumberId')=? OR json_extract(body,'$.inboundEvidenceVersion') IS NULL) LIMIT 1`).get(tenantId, providerMessageId, phoneNumberId);
}

/** Only original signed-ingress receipts establish a route. null means ambiguous. */
export function findMetaInboundConversation(store: Store, tenantId: string, phoneNumberId: string, from: string, channel: Entity | undefined): Entity | undefined | null {
  const channelId = channel?.id ?? null;
  const rows = store.db.prepare(`SELECT c.body FROM entities e JOIN entities c
    ON c.tenant_id=e.tenant_id AND c.collection='conversations' AND c.id=json_extract(e.body,'$.conversationId')
    JOIN entities m ON m.tenant_id=e.tenant_id AND m.collection='messages' AND m.id=json_extract(e.body,'$.messageId')
    AND json_extract(m.body,'$.conversationId')=c.id AND json_extract(m.body,'$.source')='meta' AND json_extract(m.body,'$.role')='user'
    AND json_extract(m.body,'$.providerMessageId')=json_extract(e.body,'$.providerMessageId')
    AND json_extract(m.body,'$.phoneNumberId')=json_extract(e.body,'$.phoneNumberId')
    AND json_extract(m.body,'$.externalContact')='+'||json_extract(e.body,'$.from')
    WHERE e.tenant_id=? AND e.collection='provider-events' AND json_extract(e.body,'$.provider')='meta'
    AND json_extract(e.body,'$.type')='message.received' AND json_extract(e.body,'$.inboundEvidenceVersion')=1
    AND json_extract(e.body,'$.phoneNumberId')=? AND json_extract(e.body,'$.from')=?
    AND json_extract(e.body,'$.channelId') IS ? AND json_extract(c.body,'$.channelId') IS ?
    AND json_extract(c.body,'$.channel')='whatsapp' AND json_extract(c.body,'$.status')!='closed'
    AND json_extract(c.body,'$.externalContact')=? GROUP BY c.id LIMIT 2`).all(tenantId, phoneNumberId, from, channelId, channelId, '+' + from);
  return rows.length > 1 ? null : rows.length === 1 ? JSON.parse(String(rows[0].body)) as Entity : undefined;
}

/** A new route must not bypass an old opt-out. Only a proven different phone excludes a collision. */
export function metaInboundNeedsReview(store: Store, tenantId: string, phoneNumberId: string, from: string): boolean {
  return !!store.db.prepare(`SELECT c.id FROM entities c WHERE c.tenant_id=? AND c.collection='conversations'
    AND json_extract(c.body,'$.channel')='whatsapp' AND json_extract(c.body,'$.externalContact')=?
    AND NOT EXISTS (
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
    ) LIMIT 1`).get(tenantId, '+' + from, from, phoneNumberId);
}

/** Called once in the existing inbound message/job/receipt transaction, never GET. */
export function recordMetaInbound(store: Store, tenantId: string, phoneNumberId: string, from: string, message: Entity, channel: Entity | undefined, providerTimestamp: unknown, messageType?: unknown): void {
  store.create(tenantId, 'provider-events', { provider: 'meta', eventId: message.providerMessageId, type: 'message.received',
    inboundEvidenceVersion: 1, phoneNumberId, from, providerMessageId: message.providerMessageId, messageId: message.id,
    conversationId: message.conversationId, channelId: channel?.id ?? null,
    channelSnapshot: channel ? captureWhatsAppChannel(channel, phoneNumberId) : null,
    providerTimestamp: typeof providerTimestamp === 'string' && /^\d{1,16}$/.test(providerTimestamp) ? providerTimestamp : null,
    messageType: typeof messageType === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(messageType) ? messageType : null });
}
