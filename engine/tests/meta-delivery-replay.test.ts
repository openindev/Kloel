import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { whatsappChannelsFixture } from './fixtures/whatsapp-channels.js';
import { createWhatsAppWorker, enqueueInboundReply } from '../src/providers/worker.js';
import { findMetaOutbound, recordMetaDelivery, replayMetaDelivery } from '../src/providers/meta-delivery.js';
import { Store } from '../src/store.js';

type Fixture = Awaited<ReturnType<typeof whatsappChannelsFixture>>;
async function status(f: Fixture, id: string, state: string, timestamp = 1800000000, phone = f.env.META_PHONE_NUMBER_ID) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: phone }, statuses: [{ id, status: state, timestamp: String(timestamp) }] } }] }] });
  const r = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', f.env.META_APP_SECRET).update(raw).digest('hex') }, payload: raw });
  assert.equal(r.statusCode, 200, r.body);
}

test('human outbound replays delivery received before the send response, without another provider request', async t => {
  const f = await whatsappChannelsFixture(t), row = await f.change((await f.create()).row, 'enable'), key = randomUUID();
  f.hooks.provider = async (url, init) => {
    assert.equal(url, 'https://graph.facebook.com/v25.0/12345/messages'); assert.equal(init.method, 'POST');
    assert.equal(f.store.list(f.tenant, 'messages').length, 0);
    await status(f, 'wamid.early-human', 'read');
    assert.equal(f.store.list(f.tenant, 'messages').length, 0);
    return Response.json({ messages: [{ id: 'wamid.early-human' }] });
  };
  const body = { to: '+5511999999999', text: 'Synthetic only', channelId: row.id, idempotencyKey: key };
  const sent = await f.request('POST', '/send', body); assert.equal(sent.statusCode, 200, sent.body);
  const message = f.store.list(f.tenant, 'messages')[0];
  assert.equal(message.providerStatus, 'read'); assert.equal(message.providerStatusAt, 1800000000);
  const receipt = await f.request('GET', '/operations/' + key); assert.equal(receipt.json().deliveryStatus, 'read');
  const before = f.snapshot(); await status(f, 'wamid.early-human', 'read'); assert.deepEqual(f.snapshot(), before);
  assert.equal((await f.request('POST', '/send', body)).statusCode, 200); assert.equal(f.calls.length, 1);
});

test('worker outbound replays delivery received before local persistence and does not regenerate or resend', async t => {
  const f = await whatsappChannelsFixture(t); await f.change((await f.create()).row, 'enable');
  const conversation = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'open', externalContact: '+5511999999999' });
  const incoming = f.store.create(f.tenant, 'messages', { conversationId: conversation.id, role: 'user', source: 'meta', content: 'Synthetic inbound', externalContact: '+5511999999999', providerMessageId: 'wamid.inbound' });
  const job = enqueueInboundReply(f.store, f.tenant, { message: incoming, conversation, phoneNumberId: '12345', messageType: 'text', providerTimestamp: String(Math.floor(Date.now() / 1000)) })!;
  f.hooks.provider = async (url, init) => {
    assert.equal(url, 'https://graph.facebook.com/v25.0/12345/messages'); assert.equal(init.method, 'POST');
    await status(f, 'wamid.early-worker', 'delivered');
    assert.equal(f.store.list(f.tenant, 'messages').filter(m => m.role === 'assistant').length, 0);
    return Response.json({ messages: [{ id: 'wamid.early-worker' }] });
  };
  let generations = 0;
  const worker = createWhatsAppWorker(f.store, { generate: async () => { generations++; return { text: 'Synthetic answer', responseId: 'synthetic', usage: {} }; } }); t.after(() => worker.stop());
  assert.equal((await worker.tick()).status, 'sent');
  const outbound = f.store.list(f.tenant, 'messages').find(m => m.autoReplyJobId === job.id)!;
  assert.equal(outbound.providerStatus, 'delivered'); assert.equal(outbound.providerStatusAt, 1800000000);
  assert.equal((await f.request('GET', '/jobs')).json().items.find((j: any) => j.id === job.id).deliveryStatus, 'delivered');
  assert.equal((await worker.tick()).status, 'idle'); assert.equal(generations, 1); assert.equal(f.calls.length, 1);
});

function local(t: any) {
  const store = new Store(); t.after(() => store.close());
  const create = (extra: Record<string, unknown> = {}, tenant = 'tenant-a') => store.create(tenant, 'messages', { role: 'assistant', source: 'meta', deliveryStatus: 'sent', phoneNumberId: '12345', providerMessageId: 'wamid.local', ...extra });
  const record = (state: string, at = 100, phone = '12345', id = 'wamid.local', tenant = 'tenant-a') => store.transaction(() => recordMetaDelivery(store, tenant, phone, { id, status: state, timestamp: String(at) }));
  const snapshot = () => store.db.prepare('SELECT * FROM entities ORDER BY rowid').all();
  return { store, create, record, snapshot };
}

test('evidence is scoped by exact tenant, phone, provider ID, source and outbound direction', t => {
  const f = local(t), valid = f.create();
  const unrelated = [f.create({}, 'tenant-b'), f.create({ phoneNumberId: '99999' }), f.create({ providerMessageId: 'wamid.other' }), f.create({ source: 'other' }), f.create({ role: 'user' }), f.create({ phoneNumberId: undefined })];
  const originals = unrelated.map(m => f.store.get(m.tenantId, 'messages', m.id));
  f.record('read');
  assert.equal(f.store.get('tenant-a', 'messages', valid.id)!.providerStatus, 'read');
  assert.deepEqual(unrelated.map(m => f.store.get(m.tenantId, 'messages', m.id)), originals);
  f.record('delivered', 200, '12345', 'wamid.other', 'tenant-b');
  assert.deepEqual(unrelated.map(m => f.store.get(m.tenantId, 'messages', m.id)), originals);
});

test('early evidence cannot be replayed to a different binding or an unbound legacy outbound', t => {
  const f = local(t); f.record('read');
  const rows = [f.create({}, 'tenant-b'), f.create({ phoneNumberId: '99999' }), f.create({ providerMessageId: 'wamid.other' }), f.create({ phoneNumberId: undefined }), f.create({ source: 'other' }), f.create({ role: 'user' })];
  const before = f.snapshot();
  for (const row of rows) f.store.transaction(() => replayMetaDelivery(f.store, row.tenantId, row.id));
  assert.deepEqual(f.snapshot(), before);
  const matching = f.create(); f.store.transaction(() => replayMetaDelivery(f.store, matching.tenantId, matching.id));
  assert.equal(f.store.get(matching.tenantId, 'messages', matching.id)!.providerStatus, 'read');
});

test('legacy status receipt does not confer a phone binding, but a new signed observation can', async t => {
  const f = await whatsappChannelsFixture(t), id = 'wamid.legacy';
  f.store.create(f.tenant, 'provider-events', { provider: 'meta', eventId: `${id}:read:1800000000`, type: 'message.read' });
  const bound = f.store.create(f.tenant, 'messages', { role: 'assistant', source: 'meta', providerMessageId: id, phoneNumberId: '12345', deliveryStatus: 'sent' });
  f.store.transaction(() => replayMetaDelivery(f.store, f.tenant, bound.id)); assert.equal(f.store.get(f.tenant, 'messages', bound.id)!.providerStatus, undefined);
  await status(f, id, 'read'); assert.equal(f.store.get(f.tenant, 'messages', bound.id)!.providerStatus, 'read');
  assert.equal(f.store.list(f.tenant, 'provider-events').length, 2);
  const before = f.snapshot(); await status(f, id, 'read'); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('a webhook for a different configured phone or with an invalid signature never records delivery evidence', async t => {
  const f = await whatsappChannelsFixture(t), before = f.snapshot(); await status(f, 'wamid.wrong', 'read', 100, '99999'); assert.deepEqual(f.snapshot(), before);
  const r = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }, payload: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }) });
  assert.equal(r.statusCode, 401); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

function permutations<T>(items: T[]): T[][] { return items.length ? items.flatMap((item, i) => permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest])) : [[]]; }
test('all 24 arrival orders select the same strongest observed evidence; lower status never regresses delivery', t => {
  const f = local(t), events = [{ s: 'sent', at: 500 }, { s: 'failed', at: 400 }, { s: 'delivered', at: 300 }, { s: 'read', at: 200 }];
  const rank = ['sent', 'failed', 'delivered', 'read'];
  for (const [i, order] of permutations(events).entries()) {
    const id = 'wamid.order-' + i, row = f.create({ providerMessageId: id }); let last = -1;
    for (const event of order) {
      f.record(event.s, event.at, '12345', id);
      const current = f.store.get('tenant-a', 'messages', row.id)!;
      assert.ok(rank.indexOf(String(current.providerStatus)) >= last); last = rank.indexOf(String(current.providerStatus));
    }
    const result = f.store.get('tenant-a', 'messages', row.id)!;
    assert.equal(result.providerStatus, 'read'); assert.equal(result.providerStatusAt, 200); assert.equal(result.deliveryStatus, 'sent');
  }
  assert.equal(f.store.list('tenant-a', 'provider-events').length, 96);
});

test('same-state times are monotonic, equal-time ties are deterministic, replay and duplicates do not write', t => {
  const f = local(t), row = f.create();
  f.record('failed', 100); assert.equal(f.store.get('tenant-a', 'messages', row.id)!.deliveryStatus, 'failed');
  f.record('sent', 100); assert.equal(f.store.get('tenant-a', 'messages', row.id)!.providerStatus, 'failed');
  f.record('delivered', 100); f.record('read', 100); f.record('read', 110); f.record('read', 90);
  assert.equal(f.store.get('tenant-a', 'messages', row.id)!.providerStatusAt, 110);
  const before = f.snapshot(); f.record('read', 110); f.store.transaction(() => replayMetaDelivery(f.store, 'tenant-a', row.id)); assert.deepEqual(f.snapshot(), before);
});

test('malformed status data and corrupt evidence cannot advance a message', t => {
  const f = local(t), row = f.create();
  for (const value of [null, [], {}, { id: 'wamid.local', status: 'invented', timestamp: '100' }, { id: 'wamid.local', status: 'read', timestamp: 100 }, { id: 'wamid.local', status: 'read', timestamp: '-1' }, { id: 'wamid.local', status: 'read', timestamp: '1.5' }, { id: 'wamid.local', status: 'read', timestamp: '9007199254740992' }]) f.store.transaction(() => recordMetaDelivery(f.store, 'tenant-a', '12345', value));
  assert.equal(f.store.list('tenant-a', 'provider-events').length, 0);
  f.store.create('tenant-a', 'provider-events', { provider: 'meta', deliveryEvidenceVersion: 1, phoneNumberId: '12345', providerMessageId: 'wamid.local', status: 'read', statusTimestamp: '999999' });
  f.store.transaction(() => replayMetaDelivery(f.store, 'tenant-a', row.id)); assert.equal(f.store.get('tenant-a', 'messages', row.id)!.providerStatus, undefined);
  f.record('delivered'); assert.equal(f.store.get('tenant-a', 'messages', row.id)!.providerStatus, 'delivered');
});

test('ambiguous duplicate local outbound identity is retained without choosing an arbitrary message', t => {
  const f = local(t), a = f.create(), b = f.create(); f.record('read');
  assert.equal(findMetaOutbound(f.store, 'tenant-a', '12345', 'wamid.local'), undefined);
  for (const row of [a, b]) { f.store.transaction(() => replayMetaDelivery(f.store, 'tenant-a', row.id)); assert.equal(f.store.get('tenant-a', 'messages', row.id)!.providerStatus, undefined); }
  assert.equal(f.store.list('tenant-a', 'provider-events').length, 1);
});

test('delivery receipt and existing message projection rollback together and retry locally on the same callback', t => {
  const f = local(t), row = f.create(), before = f.snapshot(), update = f.store.update.bind(f.store);
  f.store.update = () => { throw Error('synthetic projection storage failure'); };
  assert.throws(() => f.record('read'), /synthetic projection/); assert.deepEqual(f.snapshot(), before);
  f.store.update = update; f.record('read'); assert.equal(f.store.get('tenant-a', 'messages', row.id)!.providerStatus, 'read'); assert.equal(f.store.list('tenant-a', 'provider-events').length, 1);
});

test('durable early evidence survives a failed outbound transaction and applies on persistence re-entry', t => {
  const f = local(t); f.record('read'); const afterCallback = f.snapshot();
  assert.throws(() => f.store.transaction(() => { const row = f.create(); replayMetaDelivery(f.store, 'tenant-a', row.id); throw Error('synthetic crash before commit'); }), /synthetic crash/);
  assert.deepEqual(f.snapshot(), afterCallback);
  const restored = f.store.transaction(() => { const row = f.create(); return replayMetaDelivery(f.store, 'tenant-a', row.id)!; });
  assert.equal(restored.providerStatus, 'read'); assert.equal(f.store.list('tenant-a', 'provider-events').length, 1);
  const before = f.snapshot(); f.record('read'); f.store.transaction(() => replayMetaDelivery(f.store, 'tenant-a', restored.id)); assert.deepEqual(f.snapshot(), before);
});

test('manual operation GET cannot borrow delivery from another phone with the same provider ID', async t => {
  const f = await whatsappChannelsFixture(t), row = await f.change((await f.create()).row, 'enable'), key = randomUUID();
  f.store.create(f.tenant, 'messages', { role: 'assistant', source: 'meta', phoneNumberId: '99999', providerMessageId: 'wamid.collision', providerStatus: 'read', providerStatusAt: 100 });
  f.hooks.provider = () => Response.json({ messages: [{ id: 'wamid.collision' }] });
  assert.equal((await f.request('POST', '/send', { to: '+5511999999999', text: 'Synthetic', channelId: row.id, idempotencyKey: key })).statusCode, 200);
  assert.equal((await f.request('GET', '/operations/' + key)).json().deliveryStatus, 'accepted');
  await status(f, 'wamid.collision', 'delivered'); assert.equal((await f.request('GET', '/operations/' + key)).json().deliveryStatus, 'delivered'); assert.equal(f.calls.length, 1);
});

test('early delivery never converts a lost provider response into a known send or triggers another send', async t => {
  const f = await whatsappChannelsFixture(t), row = await f.change((await f.create()).row, 'enable'), key = randomUUID();
  f.hooks.provider = async () => { await status(f, 'wamid.unbound', 'read'); throw Error('synthetic lost send response'); };
  const body = { to: '+5511999999999', text: 'Synthetic', channelId: row.id, idempotencyKey: key };
  assert.equal((await f.request('POST', '/send', body)).statusCode, 502);
  const receipt = (await f.request('GET', '/operations/' + key)).json(); assert.equal(receipt.status, 'unknown'); assert.equal(receipt.result, undefined); assert.equal(receipt.deliveryStatus, undefined);
  assert.equal(f.store.list(f.tenant, 'messages').length, 0); assert.equal((await f.request('POST', '/send', body)).statusCode, 409); assert.equal(f.calls.length, 1);
});

test('legacy confirmed human delivery is projected from its original receipt without backfill or effects', async t => {
  const f = await whatsappChannelsFixture(t), row = await f.change((await f.create()).row, 'enable'), key = randomUUID();
  f.hooks.provider = () => Response.json({ messages: [{ id: 'wamid.legacy-confirmed' }] });
  assert.equal((await f.request('POST', '/send', { to: '+5511999999999', text: 'Synthetic', channelId: row.id, idempotencyKey: key })).statusCode, 200);
  const message = f.store.list(f.tenant, 'messages')[0];
  // Exact writer1190 persisted shape: no phone field on message; original receipt has it.
  f.store.update(f.tenant, 'messages', message.id, { phoneNumberId: undefined, providerStatus: 'delivered', providerStatusAt: 100 });
  const before = f.snapshot(), calls = f.calls.length;
  const response = await f.request('GET', '/operations/' + key);
  assert.equal(response.statusCode, 200); assert.equal(response.json().deliveryStatus, 'delivered');
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, calls);
});

test('legacy confirmed worker delivery is projected from its captured job without backfill or effects', async t => {
  const f = await whatsappChannelsFixture(t); await f.change((await f.create()).row, 'enable');
  const conversation = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'open', externalContact: '+5511999999999' });
  const incoming = f.store.create(f.tenant, 'messages', { conversationId: conversation.id, role: 'user', source: 'meta', content: 'Synthetic', externalContact: '+5511999999999', providerMessageId: 'wamid.old-inbound' });
  const job = enqueueInboundReply(f.store, f.tenant, { message: incoming, conversation, phoneNumberId: '12345', messageType: 'text', providerTimestamp: String(Math.floor(Date.now() / 1000)) })!;
  const worker = createWhatsAppWorker(f.store, { generate: async () => ({ text: 'Synthetic', responseId: 'synthetic', usage: {} }), send: async () => 'wamid.legacy-worker' }); t.after(() => worker.stop());
  assert.equal((await worker.tick()).status, 'sent');
  const message = f.store.list(f.tenant, 'messages').find(m => m.autoReplyJobId === job.id)!;
  f.store.update(f.tenant, 'messages', message.id, { phoneNumberId: undefined, providerStatus: 'read', providerStatusAt: 100 });
  const before = f.snapshot(), calls = f.calls.length;
  const response = await f.request('GET', '/jobs'); assert.equal(response.statusCode, 200); assert.equal(response.json().items.find((j: any) => j.id === job.id).deliveryStatus, 'read');
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, calls);
});

function historical(t: any, kind: 'human' | 'worker') {
  const f = local(t), conversationId = 'conversation-original';
  const owner = kind === 'human'
    ? f.store.create('tenant-a', 'whatsapp-operations', { status: 'succeeded', phoneNumberId: '12345', conversationId, result: { messageId: 'wamid.local', conversationId, status: 'accepted' } })
    : f.store.create('tenant-a', 'reply-jobs', { status: 'sent', provider: 'meta', conversationId, channelId: 'channel-original', channelSnapshot: { tenantId: 'tenant-a', channelId: 'channel-original', phoneNumberId: '12345' }, outboundMessageId: 'wamid.local' });
  const collection = kind === 'human' ? 'whatsapp-operations' as const : 'reply-jobs' as const;
  const message = f.create({ phoneNumberId: undefined, conversationId, providerStatus: 'delivered', providerStatusAt: 100, ...(kind === 'worker' ? { autoReplyJobId: owner.id } : {}) });
  const lookup = (tenant = 'tenant-a', phone = '12345', providerId = 'wamid.local') => findMetaOutbound(f.store, tenant, phone, providerId, { collection, id: owner.id });
  return { ...f, owner, collection, message, lookup };
}

for (const kind of ['human', 'worker'] as const) test(`legacy ${kind} read requires original tenant, phone, provider ID, conversation and a unique outbound`, t => {
  const f = historical(t, kind); assert.equal(f.lookup()?.id, f.message.id);
  const before = f.snapshot(); assert.equal(f.lookup('tenant-b'), undefined); assert.equal(f.lookup('tenant-a', '99999'), undefined); assert.equal(f.lookup('tenant-a', '12345', 'wamid.other'), undefined); assert.deepEqual(f.snapshot(), before);
  for (const delta of [{ phoneNumberId: '99999' }, { phoneNumberId: null }, { conversationId: 'other-conversation' }, { role: 'user' }, { source: 'other' }, { kind: 'internal_note' }, { autoReplyJobId: kind === 'human' ? 'worker-job' : 'other-job' }]) {
    const saved = f.store.get('tenant-a', 'messages', f.message.id)!;
    f.store.update('tenant-a', 'messages', f.message.id, delta); const changed = f.snapshot(); assert.equal(f.lookup(), undefined, JSON.stringify(delta)); assert.deepEqual(f.snapshot(), changed);
    // Restore only this in-memory fixture, including removed/absent fields.
    f.store.db.prepare("UPDATE entities SET body=? WHERE id=? AND tenant_id='tenant-a' AND collection='messages'").run(JSON.stringify(saved), f.message.id);
  }
  f.create({ ...f.message, id: undefined }); assert.equal(f.lookup(), undefined);
});

test('legacy human binding rejects divergent receipt conversation, failed/unknown receipt and competing captured phones', t => {
  const f = historical(t, 'human');
  for (const delta of [{ status: 'unknown' }, { status: 'failed' }, { phoneNumberId: undefined }, { result: { messageId: 'wamid.local', status: 'accepted' } }, { result: { messageId: 'wamid.local', status: 'accepted', conversationId: 'different' } }]) {
    const original = f.store.get('tenant-a', f.collection, f.owner.id)!;
    f.store.update('tenant-a', f.collection, f.owner.id, delta); const before = f.snapshot(); assert.equal(f.lookup(), undefined); assert.deepEqual(f.snapshot(), before);
    f.store.db.prepare('UPDATE entities SET body=? WHERE id=?').run(JSON.stringify(original), f.owner.id);
  }
  f.store.create('tenant-a', 'whatsapp-operations', { ...f.owner, phoneNumberId: '99999' });
  const before = f.snapshot(); assert.equal(f.lookup(), undefined); assert.deepEqual(f.snapshot(), before);
});

test('legacy worker binding requires original snapshot, job ID and known completed send, not current channel configuration', t => {
  const f = historical(t, 'worker');
  for (const delta of [{ status: 'requires_reconciliation' }, { provider: 'other' }, { outboundMessageId: 'wamid.other' }, { channelSnapshot: undefined }, { channelSnapshot: { tenantId: 'tenant-b', channelId: 'channel-original', phoneNumberId: '12345' } }, { channelSnapshot: { tenantId: 'tenant-a', channelId: 'different-channel', phoneNumberId: '12345' } }, { channelSnapshot: { tenantId: 'tenant-a', channelId: 'channel-original', phoneNumberId: '99999' } }]) {
    const original = f.store.get('tenant-a', f.collection, f.owner.id)!;
    f.store.update('tenant-a', f.collection, f.owner.id, delta); const before = f.snapshot(); assert.equal(f.lookup(), undefined); assert.deepEqual(f.snapshot(), before);
    f.store.db.prepare('UPDATE entities SET body=? WHERE id=?').run(JSON.stringify(original), f.owner.id);
  }
  f.store.create('tenant-a', 'channels', { configuration: { externalId: '99999' }, enabled: false });
  const before = f.snapshot(); assert.equal(f.lookup()?.id, f.message.id); assert.deepEqual(f.snapshot(), before);
});

test('a bound message cannot be projected into another conversation or used as an internal note', t => {
  const f = historical(t, 'human'); f.store.update('tenant-a', 'messages', f.message.id, { phoneNumberId: '12345', conversationId: 'other' });
  assert.equal(f.lookup(), undefined);
  f.store.update('tenant-a', 'messages', f.message.id, { conversationId: f.owner.conversationId, kind: 'internal_note' }); assert.equal(f.lookup(), undefined);
});

test('new signed callback advances a legacy human outbound using only its original owner, GET stays pure', async t => {
  const f = await whatsappChannelsFixture(t), row = await f.change((await f.create()).row, 'enable'), key = randomUUID();
  f.hooks.provider = () => Response.json({ messages: [{ id: 'wamid.legacy-late-human' }] });
  assert.equal((await f.request('POST', '/send', { to: '+5511999999999', text: 'Synthetic', channelId: row.id, idempotencyKey: key })).statusCode, 200);
  const message = f.store.list(f.tenant, 'messages')[0];
  f.store.update(f.tenant, 'messages', message.id, { phoneNumberId: undefined, providerStatus: 'delivered', providerStatusAt: 100 });
  await status(f, 'wamid.legacy-late-human', 'read', 200);
  const changed = f.store.get(f.tenant, 'messages', message.id)!;
  assert.equal(changed.providerStatus, 'read'); assert.equal(changed.providerStatusAt, 200); assert.equal(Object.hasOwn(changed, 'phoneNumberId'), false);
  const before = f.snapshot(); const response = await f.request('GET', '/operations/' + key); assert.equal(response.statusCode, 200); assert.equal(response.json().deliveryStatus, 'read'); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1);
});

test('new signed callback advances a legacy worker outbound using its original job, GET stays pure', async t => {
  const f = await whatsappChannelsFixture(t); await f.change((await f.create()).row, 'enable');
  const conversation = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'open', externalContact: '+5511999999999' });
  const incoming = f.store.create(f.tenant, 'messages', { conversationId: conversation.id, role: 'user', source: 'meta', content: 'Synthetic', externalContact: '+5511999999999', providerMessageId: 'wamid.late-inbound' });
  const job = enqueueInboundReply(f.store, f.tenant, { message: incoming, conversation, phoneNumberId: '12345', messageType: 'text', providerTimestamp: String(Math.floor(Date.now() / 1000)) })!;
  let sends = 0;
  const worker = createWhatsAppWorker(f.store, { generate: async () => ({ text: 'Synthetic', responseId: 'synthetic', usage: {} }), send: async () => { sends++; return 'wamid.legacy-late-worker'; } }); t.after(() => worker.stop()); assert.equal((await worker.tick()).status, 'sent');
  const message = f.store.list(f.tenant, 'messages').find(m => m.autoReplyJobId === job.id)!;
  f.store.update(f.tenant, 'messages', message.id, { phoneNumberId: undefined, providerStatus: 'delivered', providerStatusAt: 100 });
  await status(f, 'wamid.legacy-late-worker', 'read', 200);
  const changed = f.store.get(f.tenant, 'messages', message.id)!;
  assert.equal(changed.providerStatus, 'read'); assert.equal(changed.providerStatusAt, 200); assert.equal(Object.hasOwn(changed, 'phoneNumberId'), false);
  const before = f.snapshot(); const response = await f.request('GET', '/jobs'); assert.equal(response.statusCode, 200); assert.equal(response.json().items.find((j: any) => j.id === job.id).deliveryStatus, 'read'); assert.deepEqual(f.snapshot(), before); assert.equal(sends, 1); assert.equal(f.calls.length, 0);
});

for (const kind of ['human', 'worker'] as const) test(`late legacy ${kind} evidence rejects conflicting or absent owner, tenant, phone, ID, conversation and notes`, t => {
  for (const fault of ['owner_absent', 'owner_duplicate', 'owner_other_tenant', 'owner_phone', 'owner_id', 'message_phone', 'message_null_phone', 'message_id', 'conversation', 'role', 'source', 'note', 'message_duplicate', 'job'] as const) {
    const f = historical(t, kind);
    if (fault === 'owner_absent') f.store.remove('tenant-a', f.collection, f.owner.id);
    if (fault === 'owner_duplicate') f.store.create('tenant-a', f.collection, f.owner);
    if (fault === 'owner_other_tenant') { f.store.remove('tenant-a', f.collection, f.owner.id); f.store.create('tenant-b', f.collection, f.owner); }
    if (fault === 'owner_phone') f.store.update('tenant-a', f.collection, f.owner.id, kind === 'human' ? { phoneNumberId: '99999' } : { channelSnapshot: { ...(f.owner.channelSnapshot as object), phoneNumberId: '99999' } });
    if (fault === 'owner_id') f.store.update('tenant-a', f.collection, f.owner.id, kind === 'human' ? { result: { ...(f.owner.result as object), messageId: 'wamid.other' } } : { outboundMessageId: 'wamid.other' });
    if (fault === 'message_phone') f.store.update('tenant-a', 'messages', f.message.id, { phoneNumberId: '99999' });
    if (fault === 'message_null_phone') f.store.update('tenant-a', 'messages', f.message.id, { phoneNumberId: null });
    if (fault === 'message_id') f.store.update('tenant-a', 'messages', f.message.id, { providerMessageId: 'wamid.other' });
    if (fault === 'conversation') f.store.update('tenant-a', 'messages', f.message.id, { conversationId: 'other' });
    if (fault === 'role') f.store.update('tenant-a', 'messages', f.message.id, { role: 'user' });
    if (fault === 'source') f.store.update('tenant-a', 'messages', f.message.id, { source: 'other' });
    if (fault === 'note') f.store.update('tenant-a', 'messages', f.message.id, { kind: 'internal_note' });
    if (fault === 'message_duplicate') f.store.create('tenant-a', 'messages', f.message);
    if (fault === 'job') f.store.update('tenant-a', 'messages', f.message.id, { autoReplyJobId: 'other-job' });
    const beforeMessages = f.store.list('tenant-a', 'messages'), beforeOwner = f.store.get('tenant-a', f.collection, f.owner.id);
    f.record('read', 200); assert.deepEqual(f.store.list('tenant-a', 'messages'), beforeMessages, fault); assert.deepEqual(f.store.get('tenant-a', f.collection, f.owner.id), beforeOwner, fault);
    assert.equal(f.store.list('tenant-a', 'provider-events').length, 1, 'unassociated evidence is retained');
  }
});

test('late legacy callback preserves rank/time monotonicity, exact duplicate no-write and never backfills phone', t => {
  const f = historical(t, 'human'); f.record('read', 200); const read = f.store.get('tenant-a', 'messages', f.message.id)!;
  assert.equal(read.providerStatus, 'read'); assert.equal(read.providerStatusAt, 200); assert.equal(Object.hasOwn(read, 'phoneNumberId'), false);
  for (const [state, at] of [['sent', 500], ['failed', 400], ['delivered', 300], ['read', 150]] as const) f.record(state, at);
  assert.deepEqual(f.store.get('tenant-a', 'messages', f.message.id), read);
  const before = f.snapshot(); f.record('read', 200); assert.deepEqual(f.snapshot(), before);
  assert.equal(f.lookup()?.providerStatus, 'read'); assert.deepEqual(f.snapshot(), before);
});

test('late legacy webhook projection failure rolls back evidence and retries the same callback without effects', t => {
  const f = historical(t, 'worker'), before = f.snapshot(), update = f.store.update.bind(f.store);
  f.store.update = () => { throw Error('synthetic legacy projection failure'); };
  assert.throws(() => f.record('read', 200), /synthetic legacy/); assert.deepEqual(f.snapshot(), before);
  f.store.update = update; f.record('read', 200);
  const message = f.store.get('tenant-a', 'messages', f.message.id)!; assert.equal(message.providerStatus, 'read'); assert.equal(Object.hasOwn(message, 'phoneNumberId'), false); assert.equal(f.store.list('tenant-a', 'provider-events').length, 1);
  const after = f.snapshot(); f.record('read', 200); assert.deepEqual(f.snapshot(), after);
});
