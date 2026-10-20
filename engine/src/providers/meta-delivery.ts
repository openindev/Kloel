import type { Entity, Store } from '../store.js';

const states = ['sent', 'failed', 'delivered', 'read'] as const;
type Status = typeof states[number];
type Evidence = { status: Status; statusTimestamp: number };
const phoneId = (value: unknown): value is string => typeof value === 'string' && /^\d{1,40}$/.test(value);
const providerId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\x00-\x1f]/.test(value);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const state = (value: unknown): value is Status => states.includes(value as Status);

// Successful delivery/read proof outranks a contradictory failure. Failure outranks
// sent (acceptance is not delivery). Within one state, keep the latest provider time.
// Every observation remains in the ledger; arrival order never selects the winner.
function stronger(a: Evidence, b: Evidence): Evidence {
  const rank = states.indexOf(a.status) - states.indexOf(b.status);
  return rank > 0 || rank === 0 && a.statusTimestamp >= b.statusTimestamp ? a : b;
}

type Owner = { collection: 'whatsapp-operations' | 'reply-jobs'; id: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function originalBinding(store: Store, tenantId: string, owner: Owner, phoneNumberId: string, providerMessageId: string): { conversationId: string; jobId?: string } | undefined {
  const row = store.get(tenantId, owner.collection, owner.id);
  if (!row || typeof row.conversationId !== 'string' || !row.conversationId) return;
  if (owner.collection === 'whatsapp-operations') {
    if (row.status !== 'succeeded' || row.phoneNumberId !== phoneNumberId || !object(row.result) || row.result.status !== 'accepted' || row.result.messageId !== providerMessageId || row.result.conversationId !== row.conversationId) return;
    return { conversationId: row.conversationId };
  }
  const snapshot = row.channelSnapshot;
  if (row.provider !== 'meta' || row.status !== 'sent' || row.outboundMessageId !== providerMessageId || !object(snapshot) || snapshot.phoneNumberId !== phoneNumberId || snapshot.tenantId !== tenantId || typeof row.channelId !== 'string' || snapshot.channelId !== row.channelId) return;
  return { conversationId: row.conversationId, jobId: row.id };
}

function uniqueOriginalOwner(store: Store, tenantId: string, providerMessageId: string): Owner | undefined {
  const owners = store.db.prepare(`SELECT id,collection FROM entities WHERE tenant_id=? AND (
    (collection='whatsapp-operations' AND json_extract(body,'$.status')='succeeded' AND json_extract(body,'$.result.messageId')=?) OR
    (collection='reply-jobs' AND json_extract(body,'$.provider')='meta' AND json_extract(body,'$.status')='sent' AND json_extract(body,'$.outboundMessageId')=?)
    ) LIMIT 2`).all(tenantId, providerMessageId, providerMessageId);
  return owners.length === 1 ? { id: String(owners[0].id), collection: owners[0].collection as Owner['collection'] } : undefined;
}

export function findMetaOutbound(store: Store, tenantId: string, phoneNumberId: unknown, providerMessageId: unknown, owner?: Owner): Entity | undefined {
  if (!phoneId(phoneNumberId) || !providerId(providerMessageId)) return;
  const binding = owner && originalBinding(store, tenantId, owner, phoneNumberId, providerMessageId);
  if (owner && !binding) return;
  const belongs = (message: Entity) => !binding || message.conversationId === binding.conversationId && (binding.jobId ? message.autoReplyJobId === binding.jobId : message.autoReplyJobId == null);
  const rows = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='messages'
    AND json_extract(body,'$.source')='meta' AND json_extract(body,'$.role')='assistant'
    AND COALESCE(json_extract(body,'$.kind'),'')!='internal_note'
    AND json_extract(body,'$.phoneNumberId')=? AND json_extract(body,'$.providerMessageId')=? LIMIT 2`).all(tenantId, phoneNumberId, providerMessageId);
  // A duplicate local identity is ambiguous; never select an arbitrary message.
  if (rows.length) { const message = JSON.parse(String(rows[0].body)) as Entity; return rows.length === 1 && belongs(message) ? message : undefined; }
  if (!owner || !binding) return;
  // Read-only compatibility for writer1190: the original durable receipt/job,
  // never today's environment or channel, is the phone binding. Conflicting
  // owners or messages make it ambiguous. No field is backfilled by this path.
  const uniqueOwner = uniqueOriginalOwner(store, tenantId, providerMessageId);
  if (uniqueOwner?.id !== owner.id || uniqueOwner.collection !== owner.collection) return;
  const legacy = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='messages'
    AND json_extract(body,'$.source')='meta' AND json_extract(body,'$.role')='assistant'
    AND COALESCE(json_extract(body,'$.kind'),'')!='internal_note' AND json_type(body,'$.phoneNumberId') IS NULL
    AND json_extract(body,'$.providerMessageId')=? LIMIT 2`).all(tenantId, providerMessageId);
  if (legacy.length !== 1) return;
  const message = JSON.parse(String(legacy[0].body)) as Entity;
  return belongs(message) ? message : undefined;
}

/** Local projection only. Call inside the transaction that persists the outbound. */
export function replayMetaDelivery(store: Store, tenantId: string, messageId: string): Entity | undefined {
  const message = store.get(tenantId, 'messages', messageId);
  // No backfill from the current environment/channel, and no adoption of unbound legacy receipts.
  if (!message || message.source !== 'meta' || message.role !== 'assistant' || !phoneId(message.phoneNumberId) || !providerId(message.providerMessageId)) return message;
  if (findMetaOutbound(store, tenantId, message.phoneNumberId, message.providerMessageId)?.id !== message.id) return message;
  return projectMetaDelivery(store, tenantId, message.phoneNumberId, message);
}

// Caller has proved the message binding, either directly or through its original
// receipt/job. This writes only delivery fields, never a legacy phone binding.
function projectMetaDelivery(store: Store, tenantId: string, phoneNumberId: string, message: Entity): Entity | undefined {
  const row = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection='provider-events'
    AND json_extract(body,'$.provider')='meta' AND json_extract(body,'$.deliveryEvidenceVersion')=1
    AND json_extract(body,'$.phoneNumberId')=? AND json_extract(body,'$.providerMessageId')=?
    AND json_extract(body,'$.status') IN ('sent','failed','delivered','read')
    AND json_type(body,'$.statusTimestamp')='integer' AND json_extract(body,'$.statusTimestamp') BETWEEN 1 AND 9007199254740991
    ORDER BY CASE json_extract(body,'$.status') WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'failed' THEN 1 ELSE 0 END DESC,
      json_extract(body,'$.statusTimestamp') DESC LIMIT 1`).get(tenantId, phoneNumberId, String(message.providerMessageId));
  if (!row) return message;
  const evidence = JSON.parse(String(row.body)) as Evidence;
  let winner = evidence;
  if (state(message.providerStatus) && timestamp(message.providerStatusAt)) winner = stronger({ status: message.providerStatus, statusTimestamp: message.providerStatusAt }, evidence);
  const deliveryStatus = winner.status === 'failed' ? 'failed' : 'sent';
  if (message.providerStatus === winner.status && message.providerStatusAt === winner.statusTimestamp && message.deliveryStatus === deliveryStatus) return message;
  return store.update(tenantId, 'messages', message.id, { providerStatus: winner.status, providerStatusAt: winner.statusTimestamp, deliveryStatus });
}

/** Only the authenticated webhook calls this, inside its message/receipt transaction. */
export function recordMetaDelivery(store: Store, tenantId: string, phoneNumberId: string, input: unknown): void {
  if (!phoneId(phoneNumberId) || !input || typeof input !== 'object' || Array.isArray(input)) return;
  const data = input as Record<string, unknown>;
  if (!providerId(data.id) || !state(data.status) || typeof data.timestamp !== 'string' || !/^\d{1,16}$/.test(data.timestamp)) return;
  const at = Number(data.timestamp); if (!timestamp(at)) return;
  const existing = store.db.prepare(`SELECT id FROM entities WHERE tenant_id=? AND collection='provider-events'
    AND json_extract(body,'$.provider')='meta' AND json_extract(body,'$.deliveryEvidenceVersion')=1
    AND json_extract(body,'$.phoneNumberId')=? AND json_extract(body,'$.providerMessageId')=?
    AND json_extract(body,'$.status')=? AND json_extract(body,'$.statusTimestamp')=? LIMIT 1`).get(tenantId, phoneNumberId, data.id, data.status, at);
  if (!existing) store.create(tenantId, 'provider-events', { provider: 'meta', eventId: `${data.id}:${data.status}:${at}`, type: `message.${data.status}`,
    deliveryEvidenceVersion: 1, phoneNumberId, providerMessageId: data.id, status: data.status, statusTimestamp: at });
  let message = findMetaOutbound(store, tenantId, phoneNumberId, data.id);
  if (!message) {
    const owner = uniqueOriginalOwner(store, tenantId, data.id);
    if (owner) message = findMetaOutbound(store, tenantId, phoneNumberId, data.id, owner);
  }
  if (message) projectMetaDelivery(store, tenantId, phoneNumberId, message);
}
