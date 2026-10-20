import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { whatsappChannelsFixture } from './whatsapp-channels.js';

export async function whatsappConversationReplyFixture(t: any) {
  const f = await whatsappChannelsFixture(t), channel = await f.change((await f.create()).row, 'enable');
  const sender = '5511999999999';
  const inbound = async (id = 'wamid.inbound-' + randomUUID(), timestamp = String(Math.floor(Date.now() / 1000))) => {
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '12345' }, messages: [{ id, from: sender, timestamp, type: 'text', text: { body: 'Synthetic inbound only' } }] } }] }] });
    const r = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', f.env.META_APP_SECRET).update(raw).digest('hex') } });
    assert.equal(r.statusCode, 200, r.body);
    return f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === id)!;
  };
  const source = await inbound(), conversationId = String(source.conversationId);
  const control = async (status: 'open' | 'pending' | 'closed') => {
    const r = await f.request('GET', '/api/v1/conversations/' + conversationId + '/control'); assert.equal(r.statusCode, 200, r.body);
    const p = await f.request('PATCH', '/api/v1/conversations/' + conversationId + '/control', { expectedVersion: r.json().version, status }); assert.equal(p.statusCode, 200, p.body); return p.json();
  };
  await control('pending');
  const path = '/conversations/' + conversationId;
  const contextResponse = (who = 'owner') => f.request('GET', path + '/reply-context', undefined, undefined, who);
  const context = async () => { const r = await contextResponse(); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const body = (c: any, key = randomUUID()) => ({ expectedTenantId: f.tenant, expectedVersion: c.version, idempotencyKey: key, text: 'Synthetic human reply', confirm: true });
  const send = (b: any, who = 'owner') => f.request('POST', path + '/replies', b, undefined, who);
  const operation = (key: string, who = 'owner') => f.request('GET', path + '/reply-operations/' + encodeURIComponent(key), undefined, undefined, who);
  const accepted = (id = 'wamid.human-' + randomUUID()) => Response.json({ messaging_product: 'whatsapp', messages: [{ id }], contacts: [{ input: sender, wa_id: '551199999999' }] });
  f.hooks.provider = () => accepted();
  return { ...f, channel, sender, source, conversationId, inbound, control, path, context, contextResponse, body, send, operation, accepted };
}
