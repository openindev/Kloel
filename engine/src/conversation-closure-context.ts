import type { Entity, Store } from './store.js';
import { metaAutomationBlocked } from './providers/meta-identity-review.js';
import { publicBeforeMessage } from './before-context/operations.js';
import { hash, fail } from './conversation-analysis/authority.js';
export const conversationFence=(c:Entity)=>hash([c.agentId,c.channelId,c.channel,c.phoneNumberId??null,c.externalContact??null,c.contactId??null,c.externalId??null,c.status,c.tags??[],c.metaIdentityPolicy??null,c.metaIdentityStatus??null,c.closureEpoch??null]);
export function channelFor(store:Store,c:Entity) {
 const ch=typeof c.channelId==='string'?store.get(c.tenantId,'channels',c.channelId):undefined;
 if(!ch||ch.enabled!==true||ch.agentId!==c.agentId||ch.type!==c.channel||!['webchat','whatsapp'].includes(String(c.channel))||ch.provider!==(c.channel==='webchat'?'openai':'meta'))return fail('channel_unavailable');
 if(c.channel==='whatsapp'&&(!c.phoneNumberId||(ch.configuration as any)?.externalId!==c.phoneNumberId))return fail('channel_unverified');return ch;
}
export function optedOut(c:Entity) { return metaAutomationBlocked(c)||Array.isArray(c.tags)&&c.tags.some(t=>['no_ai','human_handoff'].includes(String(t))); }
export function transcript(store:Store,c:Entity) {
 const all=store.list(c.tenantId,'messages').filter(m=>m.conversationId===c.id);
 const selected=all.filter(m=>['user','assistant'].includes(String(m.role))&&m.kind!=='internal_note'&&typeof m.content==='string'&&m.content.length>0&&(
 c.channel==='webchat'?publicBeforeMessage(store,c.tenantId,m)!==null:
 m.source==='meta'&&m.phoneNumberId===c.phoneNumberId&&(m.role==='user'&&m.deliveryStatus==='received'||m.role==='assistant'&&m.deliveryStatus==='sent'&&typeof m.providerMessageId==='string')
 )).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 const messages=selected.map(m=>({id:m.id,role:m.role,content:m.content}));return {messages,messageRefs:selected.map(m=>({id:m.id,hash:hash(m)})),allDigest:hash(all.sort((a,b)=>a.id.localeCompare(b.id))),inputDigest:hash(messages)};
}
export function inFlight(store: Store, c: Entity) {
 const messages = store.list(c.tenantId, 'messages').filter(m => m.conversationId === c.id);
 const linkedMeta = (providerId: unknown, phoneId: unknown, localId?: unknown) => typeof providerId === 'string' && messages.some(m => m.source === 'meta' && m.role === 'assistant' && m.providerMessageId === providerId && m.phoneNumberId === phoneId && (!localId || m.id === localId));
 const checks: [string, (r: Entity) => boolean][] = [
  ['provider-operations', r => r.operation === 'openai.chat' && r.chatConversationId === c.id && ['pending','unknown'].includes(String(r.status))],
  ['public-chat-sessions', r => r.conversationId === c.id && !!r.inFlight],
  ['public-chat-operations', r => ['pending','requires_reconciliation'].includes(String(r.status)) && store.get(c.tenantId,'public-chat-sessions',String(r.sessionId))?.conversationId === c.id],
  ['reply-jobs', r => r.conversationId === c.id && (['queued','generating','ready_to_send','preparing_send','sending','unknown','requires_reconciliation'].includes(String(r.status))
    || r.status === 'sent' && !linkedMeta(r.outboundMessageId, (r.channelSnapshot as any)?.phoneNumberId, r.manualOnceMessageId))],
  ['whatsapp-conversation-replies', r => r.conversationId === c.id && (['pending','unknown'].includes(String(r.status))
    || r.status === 'succeeded' && (r.localLink !== 'linked' || !linkedMeta(r.providerMessageId, r.phoneNumberId, r.messageId)))],
  ['whatsapp-operations', r => (r.conversationId === c.id || c.channel === 'whatsapp' && r.phoneNumberId === c.phoneNumberId && r.recipient === c.externalContact)
    && (['pending','unknown'].includes(String(r.status)) || r.status === 'succeeded' && !linkedMeta((r.result as any)?.messageId, r.phoneNumberId))],
 ];
 return checks.some(([collection, predicate]) => store.list(c.tenantId, collection).some(predicate));
}
