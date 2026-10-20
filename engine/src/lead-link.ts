import type { Entity, Store } from './store.js';

/** E.164 variants for Brazilian mobiles (with/without the 9th digit). */
export function phoneVariants(raw: string): string[] {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return [];
  if (!String(raw).trim().startsWith('+') && (d.length === 10 || d.length === 11) && !d.startsWith('55')) d = '55' + d;
  const out = new Set([`+${d}`]);
  if (d.startsWith('55')) {
    const ddd = d.slice(2, 4), rest = d.slice(4);
    if (rest.length === 9 && rest.startsWith('9')) out.add(`+55${ddd}${rest.slice(1)}`);
    if (rest.length === 8 && /^[6-9]/.test(rest)) out.add(`+55${ddd}9${rest}`);
  }
  return [...out];
}
/** Canonical form: Brazilian mobiles with the 9th digit. */
export function normalizePhone(raw: string): string | undefined {
  const v = phoneVariants(raw); if (!v.length) return;
  return v.find(p => /^\+55\d{2}9\d{8}$/.test(p)) ?? v[0];
}
export function findContactByPhone(store: Store, tenant: string, phone: string): Entity | undefined {
  const vs = new Set(phoneVariants(phone));
  return store.list(tenant, 'contacts').find(c => typeof c.phone === 'string' && vs.has(c.phone));
}
/** Links every WhatsApp/phone conversation with this number (and an optional call) to the contact. */
export function linkLeadConversations(store: Store, tenant: string, contactId: string, phone: string, callId?: string) {
  const vs = new Set(phoneVariants(phone));
  for (const c of store.list(tenant, 'conversations')) {
    if ((c.id === callId || (typeof c.externalContact === 'string' && vs.has(c.externalContact))) && c.contactId !== contactId) store.update(tenant, 'conversations', c.id, { contactId });
  }
}
/** Most recent inbound WhatsApp message from any variant of this number. */
export function lastWhatsAppInbound(store: Store, tenant: string, phone: string): Entity | undefined {
  const vs = new Set(phoneVariants(phone));
  return store.list(tenant, 'messages').filter(m => m.source === 'meta' && m.role === 'user' && typeof m.externalContact === 'string' && vs.has(m.externalContact)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).pop();
}
