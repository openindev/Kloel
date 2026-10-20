import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from '../../store.js';
import { seal, unseal } from '../../oauth/crypto.js';
import { crmId, normalizeIdentifier } from '../schema.js';
import { digest, transaction } from '../service.js';
import { channelBinding, resolveCapture } from './authority.js';
import { captureAvailable } from './runtime.js';
import { fail, grants, jobs, kinds } from './schema.js';

const ingressSchema = z.object({ tenantId: crmId, conversationId: crmId, messageId: crmId, channelId: crmId, agentId: crmId,
  kind: z.enum(kinds), receiptId: z.string().min(1).max(300), occurredAt: z.number().finite(), sessionStartedAt: z.number().finite().optional(),
  transportIdentifier: z.string().max(254).optional(),
}).strict();
export type CaptureIngress = z.infer<typeof ingressSchema>;
export type SourceEvent = CaptureIngress & { id: string; sequence: number; acceptedAt: number; contentHash: string; bindingHash: string; conversationContactId: string | null; expiresAt: number; encryptedText: string; dedupKey: string };
const context = (tenant: string, id: string) => `${tenant}:${id}:crm-capture-source`;
export function sourceEvent(store: Store, tenant: string, id: string): SourceEvent {
  const row = store.db.prepare('SELECT sequence,body FROM crm_source_events WHERE tenant_id=? AND id=?').get(tenant, id);
  if (!row) fail('capture_source_missing');
  return { ...JSON.parse(String(row.body)), sequence: Number(row.sequence) };
}
export function sourceText(store: Store, source: SourceEvent, now = Date.now()) {
  if (source.expiresAt <= now) fail('capture_source_expired');
  const message = store.get(source.tenantId, 'messages', source.messageId), conversation = store.get(source.tenantId, 'conversations', source.conversationId);
  if (!message || !conversation || message.conversationId !== source.conversationId || message.role !== 'user' || typeof message.content !== 'string' || digest(message.content) !== source.contentHash) fail('capture_source_changed');
  if (conversation.agentId !== source.agentId || conversation.channelId !== source.channelId || (conversation.contactId ?? null) !== source.conversationContactId) fail('capture_source_binding_changed');
  if (channelBinding(store, source.tenantId, source.channelId).hash !== source.bindingHash) fail('capture_source_binding_changed');
  const text = unseal<string>(source.encryptedText, context(source.tenantId, source.id));
  if (digest(text) !== source.contentHash) fail('capture_source_changed');
  return text;
}
/** Server-only hook. Call inside the authenticated ingress transaction, never from generic CRUD. */
export function recordCaptureIngress(store: Store, raw: CaptureIngress, assertAuthorized: () => void, now = Date.now()) {
  if (!captureAvailable(store)) return { recorded: false, jobs: 0 };
  return transaction(store, () => {
    const input = ingressSchema.parse(raw);
    const eligible = store.list(input.tenantId, grants).filter(g => g.status === 'active').flatMap(grant => {
      try {
        const selected = resolveCapture(store, input.tenantId, grant.id, now);
        return selected.policy.channelIds.includes(input.channelId) && input.occurredAt > Number(grant.activatedAt) && (input.sessionStartedAt === undefined || input.sessionStartedAt > Number(grant.activatedAt)) ? [selected] : [];
      } catch { return []; }
    });
    // Inactive capture neither retains inbound text nor requires its encryption key.
    if (!eligible.length) return { recorded: false, jobs: 0 };
    assertAuthorized(); const binding = channelBinding(store, input.tenantId, input.channelId);
    const message = store.get(input.tenantId, 'messages', input.messageId), conversation = store.get(input.tenantId, 'conversations', input.conversationId);
    const type = input.kind === 'meta_verified_inbound' ? 'whatsapp' : input.kind === 'voice_final_user_transcript' ? 'phone' : 'webchat';
    if (binding.type !== type || binding.agentId !== input.agentId || !message || message.role !== 'user' || message.conversationId !== input.conversationId || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 100000 || !conversation || conversation.agentId !== input.agentId || conversation.channelId !== input.channelId) fail('capture_invalid_ingress');
    if (input.occurredAt > now + 60000 || input.occurredAt < 0 || input.sessionStartedAt !== undefined && (input.sessionStartedAt > input.occurredAt || input.sessionStartedAt < 0)) fail('capture_invalid_source_time');
    if (type === 'phone' && input.sessionStartedAt === undefined) fail('capture_voice_start_required');
    if (input.transportIdentifier) {
      if (type === 'webchat') fail('capture_unverified_chat_identity');
      input.transportIdentifier = normalizeIdentifier('phone', input.transportIdentifier);
      const observed = String(conversation.externalContact ?? '');
      if (!observed || normalizeIdentifier('phone', observed) !== input.transportIdentifier) fail('capture_transport_mismatch');
    }
    const dedupKey = digest({ kind: input.kind, channelId: input.channelId, receiptId: input.receiptId, messageId: input.messageId });
    const old = store.db.prepare('SELECT body FROM crm_source_events WHERE tenant_id=? AND dedup_key=?').get(input.tenantId, dedupKey);
    if (old) { const parsed = JSON.parse(String(old.body)); if (parsed.contentHash !== digest(message.content)) fail('capture_source_changed'); return { recorded: false, eventId: parsed.id as string, jobs: 0 }; }
    const id = randomUUID(), body = { ...input, id, acceptedAt: now, contentHash: digest(message.content), bindingHash: binding.hash, conversationContactId: conversation.contactId ?? null, expiresAt: now + 30 * 86400000, encryptedText: seal(message.content, context(input.tenantId, id)), dedupKey };
    assertAuthorized(); const inserted = store.db.prepare('INSERT INTO crm_source_events(id,tenant_id,dedup_key,body) VALUES(?,?,?,?)').run(id, input.tenantId, dedupKey, JSON.stringify(body));
    const sequence = Number(inserted.lastInsertRowid); let queued = 0;
    for (const selected of eligible) {
      const grant = selected.grant;
      resolveCapture(store, input.tenantId, grant.id, now, { revision: grant.revision, epoch: grant.epoch });
      if (sequence <= Number(grant.sourceBaselineSequence)) fail('capture_source_before_activation');
      if (store.list(input.tenantId, jobs).filter(job => job.status === 'queued').length >= 1000) continue;
      store.create(input.tenantId, jobs, { grantId: grant.id, grantRevision: grant.revision, epoch: grant.epoch, sourceEventId: id, sourceSequence: sequence, conversationId: input.conversationId, status: 'queued', dueAt: now }); queued++;
    }
    return { recorded: true, eventId: id, jobs: queued };
  });
}
export function collectSources(store: Store, job: Entity, selected: ReturnType<typeof resolveCapture>, now: number) {
  const current = sourceEvent(store, job.tenantId, String(job.sourceEventId));
  if (current.sequence <= Number(selected.grant.sourceBaselineSequence) || current.occurredAt <= Number(selected.grant.activatedAt) || current.sessionStartedAt !== undefined && current.sessionStartedAt <= Number(selected.grant.activatedAt) || !selected.policy.channelIds.includes(current.channelId)) fail('capture_source_before_activation');
  const rows = store.db.prepare('SELECT sequence,body FROM crm_source_events WHERE tenant_id=? AND sequence>? AND sequence<=? ORDER BY sequence DESC LIMIT 1000').all(job.tenantId, Number(selected.grant.sourceBaselineSequence), current.sequence).map(row => ({ ...JSON.parse(String(row.body)), sequence: Number(row.sequence) } as SourceEvent));
  const same = rows.filter(row => row.conversationId === current.conversationId && row.conversationContactId === current.conversationContactId && row.channelId === current.channelId && row.agentId === current.agentId && row.transportIdentifier === current.transportIdentifier && row.occurredAt > Number(selected.grant.activatedAt) && (row.sessionStartedAt === undefined || row.sessionStartedAt > Number(selected.grant.activatedAt))).slice(0, selected.policy.maxMessagesPerJob).reverse();
  const sources = same.map(source => ({ source, text: sourceText(store, source, now) }));
  if (!sources.length || sources.reduce((n, s) => n + s.text.length, 0) > selected.policy.maxInputChars) fail('capture_input_limit');
  return sources;
}
