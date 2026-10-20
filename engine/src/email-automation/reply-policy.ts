import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import type { MailData } from '../email-agents/adapters.js';
import { mailboxes, messages, messageData } from '../email-agents/service.js';
import type { AutomationPolicy } from './authority.js';

export const autoReplyFormat = { type: 'json_schema', name: 'mailbox_reply', strict: true, schema: { type: 'object', additionalProperties: false, required: ['decision', 'text'], properties: { decision: { type: 'string', enum: ['reply', 'review', 'no_reply'] }, text: { type: 'string' } } } };
const outputSchema = z.object({ decision: z.enum(['reply', 'review', 'no_reply']), text: z.string().max(20000) }).strict();
export function automaticOutput(raw: string, signature: string, policy: AutomationPolicy) {
  const parsed = outputSchema.parse(JSON.parse(raw));
  const text = [parsed.text.trim(), signature.trim()].filter(Boolean).join('\n\n');
  return { text, decision: parsed.decision === 'reply' && safeReplyText(text, policy) ? 'reply' : parsed.decision === 'no_reply' ? 'no_reply' : 'review' };
}
export function safeReplyText(text: string, policy: AutomationPolicy) {
  const normalized = text.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
  // Deliberately conservative: no model-selected addresses/URLs/HTML, including the signature.
  return !!normalized.trim() && normalized.length <= (policy.replyPolicy?.maxReplyChars ?? 0) && !/[<>\x00-\x08\x0B\x0C\x0E-\x1F]/.test(normalized)
    && !/(?:[a-z][a-z\d+.-]*:\/\/|\b(?:https?|mailto|tel|data|javascript):|www\s*\.|@|[\p{L}\p{N}][\p{L}\p{N}-]*\.[\p{L}]{2,}(?:\b|\/)|\]\s*\()/iu.test(normalized);
}
export function messageEligibility(store: Store, grant: Entity, box: Entity, policy: AutomationPolicy, source: Entity, data: MailData, now: number, pending = false): string | null {
  if (grant.status !== 'active' || !Number.isFinite(Number(grant.activatedAt))) return 'activation_baseline';
  const received = Date.parse(data.receivedAt);
  if (!Number.isFinite(received) || source.historical || received <= Number(grant.activatedAt)) return 'historical';
  if (received > now + 300000 || received < now - policy.maxMessageAgeHours * 3600000) return 'message_age';
  if (source.deleted || (pending ? source.status !== 'reply_pending' : ['reply_pending', 'reply_accepted', 'reply_uncertain'].includes(String(source.status))) || !data.folders.includes('inbox') || data.folders.includes('sent') || !data.from || !data.replyTo) return 'not_inbound';
  const own = new Set([String(box.address), ...policy.aliases, ...store.list(box.tenantId, mailboxes).map(b => String(b.address))]);
  if (own.has(data.from) || own.has(data.replyTo)) return 'own_mail';
  if (data.automatic || /^(?:mailer-daemon|postmaster|no[-_.]?reply|do[-_.]?not[-_.]?reply)(?:[+@]|$)/i.test(data.from)) return 'automatic_message';
  if (data.bodyTruncated || !data.text.trim()) return 'incomplete_content';
  if (policy.mode === 'auto_reply' && data.headersComplete !== true) return 'incomplete_safety_headers';
  if (policy.mode === 'auto_reply' && (data.from !== data.replyTo || !data.internetMessageId || !data.to.some(to => to === box.address || policy.aliases.includes(to)))) return 'automatic_recipient_binding';
  if (store.list(box.tenantId, messages).some(m => m.mailboxId === box.id && m.threadId === source.threadId && m.id !== source.id && !m.deleted && messageData(m).folders.includes('sent') && Date.parse(messageData(m).receivedAt) >= received)) return 'observed_reply';
  return null;
}
