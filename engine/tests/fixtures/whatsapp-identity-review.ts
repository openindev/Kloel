import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { whatsappChannelsFixture } from './whatsapp-channels.js';

export async function whatsappIdentityReviewFixture(t: any) {
  const f = await whatsappChannelsFixture(t), channel = await f.change((await f.create()).row, 'enable');
  const sender = '5511999999999';
  const legacy = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'closed', externalContact: '+' + sender, tags: ['no_ai'], subject: 'Private historical subject' });
  f.store.create(f.tenant, 'messages', { conversationId: legacy.id, role: 'user', source: 'meta', content: 'Private historical text', providerMessageId: 'wamid.legacy-only' });
  const inbound = async (options: { id?: string; type?: string; timestamp?: string } = {}) => {
    const id = options.id ?? 'wamid.review-' + randomUUID();
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '12345' }, messages: [{ id, from: sender, timestamp: options.timestamp ?? String(Math.floor(Date.now() / 1000)), type: options.type ?? 'text', text: { body: 'Synthetic new signed entry' } }] } }] }] });
    const r = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', f.env.META_APP_SECRET).update(raw).digest('hex') } });
    assert.equal(r.statusCode, 200, r.body);
    return f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === id)!;
  };
  const source = await inbound(), conversationId = String(source.conversationId), path = '/api/v1/conversations/' + conversationId;
  const contextResponse = (who = 'owner') => f.request('GET', path + '/whatsapp-identity-review', undefined, undefined, who);
  const context = async () => { const r = await contextResponse(); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const input = (c: any, key = randomUUID()) => ({ expectedTenantId: f.tenant, expectedVersion: c.version, key, decision: 'human_only', confirm: true });
  const review = (body: any, who = 'owner') => f.request('POST', path + '/whatsapp-identity-review', body, undefined, who);
  const operation = (key: string, who = 'owner') => f.request('GET', path + '/whatsapp-identity-operations/' + encodeURIComponent(key), undefined, undefined, who);
  const control = async (patch: Record<string, unknown>) => {
    const get = await f.request('GET', path + '/control'); assert.equal(get.statusCode, 200, get.body);
    const r = await f.request('PATCH', path + '/control', { expectedVersion: get.json().version, ...patch }); assert.equal(r.statusCode, 200, r.body); return r.json();
  };
  return { ...f, channel, sender, source, legacy, conversationId, path, inbound, context, contextResponse, input, review, operation, control,
    current: () => f.store.get(f.tenant, 'conversations', conversationId)!, replyContext: () => f.request('GET', '/conversations/' + conversationId + '/reply-context') };
}
