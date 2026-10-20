import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { whatsappIdentityReviewFixture } from './whatsapp-identity-review.js';

export async function recipientAttestationFixture(t: any) {
  const f = await whatsappIdentityReviewFixture(t), destination = '+5511988888888', wamid = 'wamid.observed-' + randomUUID();
  process.env.WHATSAPP_AUTOREPLY_ENABLED = 'false';
  f.hooks.provider = () => Response.json({ messaging_product: 'whatsapp', contacts: [{ input: destination.slice(1), wa_id: f.sender }], messages: [{ id: wamid }] });
  const sent = await f.request('POST', '/send', { to: destination, channelId: f.channel.id, idempotencyKey: randomUUID(), text: 'Synthetic original manual send' });
  assert.equal(sent.statusCode, 200, sent.body);
  const evidence = f.store.list(f.tenant, 'whatsapp-operations').find(r => (r.result as any)?.messageId === wamid)!;
  const delivery = async (status = 'delivered', messageId = wamid) => {
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '12345' }, statuses: [{ id: messageId, status, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    const r = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', f.env.META_APP_SECRET).update(raw).digest('hex') } });
    assert.equal(r.statusCode, 200, r.body);
  };
  await delivery();
  const currentChannel = await f.change(f.channel, 'update', { name: 'Current channel revision three' });
  const source = await f.inbound();
  const reviewed = await f.review(f.input(await f.context())); assert.equal(reviewed.statusCode, 200, reviewed.body);
  const path = '/conversations/' + f.conversationId;
  const contextResponse = (who = 'owner') => f.request('GET', path + '/recipient-context', undefined, undefined, who);
  const context = async () => { const r = await contextResponse(); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const input = (c: any, key = randomUUID()) => ({ expectedTenantId: f.tenant, expectedVersion: c.version, key, evidenceId: evidence.id, confirm: true });
  const attest = (body: any, who = 'owner') => f.request('POST', path + '/recipient-attestations', body, undefined, who);
  const operation = (key: string, who = 'owner') => f.request('GET', path + '/recipient-attestations/' + encodeURIComponent(key), undefined, undefined, who);
  const replyContext = (id?: string, who = 'owner') => f.request('GET', path + '/reply-context' + (id ? '?recipientAttestationId=' + id : ''), undefined, undefined, who);
  const replyInput = (c: any, id?: string, key = randomUUID()) => ({ expectedTenantId: f.tenant, expectedVersion: c.version, idempotencyKey: key, text: 'Explicit human answer', confirm: true, ...(id ? { recipientAttestationId: id } : {}) });
  const reply = (body: any, who = 'owner') => f.request('POST', path + '/replies', body, undefined, who);
  f.calls.length = 0;
  return { ...f, destination, wamid, evidence, currentChannel, source, delivery, contextResponse, context, input, attest, operation, replyContext, replyInput, reply };
}
