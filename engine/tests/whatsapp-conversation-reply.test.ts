import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { whatsappConversationReplyFixture } from './fixtures/whatsapp-conversation-reply.js';
import { createWhatsAppWorker } from '../src/providers/worker.js';
import { seedMember } from './fixtures/membership.js';

const collection = 'whatsapp-conversation-replies';
const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

test('signed inbound context is local masked and requires explicit pending takeover', async t => {
  const f = await whatsappConversationReplyFixture(t), before = f.snapshot(), c = await f.context();
  assert.equal(c.canReply, true); assert.equal(c.reasonCode, null); assert.equal(c.sourceMessageId, f.source.id); assert.equal(c.channelId, f.channel.id);
  assert.equal(c.destination.provenance, 'signed_inbound'); assert.equal(JSON.stringify(c).includes(f.sender), false); assert.equal(f.calls.length, 0); assert.deepEqual(f.snapshot(), before);
  await f.control('open'); assert.equal((await f.context()).reasonCode, 'human_takeover_required');
});

test('explicit human reply has one POST same conversation author and original GET replay', async t => {
  const f = await whatsappConversationReplyFixture(t), c = await f.context(), b = f.body(c), r = await f.send(b);
  assert.equal(r.statusCode, 200, r.body); const op = r.json().operation;
  assert.equal(op.status, 'succeeded'); assert.equal(op.externalEffect, 'accepted'); assert.equal(op.localLink, 'linked'); assert.equal(op.deliveryStatus, 'accepted'); assert.equal(op.automaticRetry, false);
  const message = f.store.get(f.tenant, 'messages', op.messageId)!; assert.equal(message.conversationId, f.conversationId); assert.equal(message.authorType, 'human'); assert.equal(message.phoneNumberId, '12345');
  assert.equal(f.store.list(f.tenant, 'conversations').length, 1); const payload = JSON.parse(String(f.calls[0].init.body)); assert.equal(payload.to, f.sender); assert.equal(payload.context.message_id, f.source.providerMessageId);
  assert.equal(f.calls.length, 1); const before = f.snapshot(); assert.equal((await f.operation(b.idempotencyKey)).statusCode, 200); assert.equal((await f.send(b)).json().replayed, true); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1);
});

test('stale context is rejected before receipt and before physical send', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()); await f.control('open'); await f.control('pending');
  const before = f.snapshot(), r = await f.send(b); assert.equal(r.statusCode, 409, r.body); assert.equal(r.json().error.code, 'whatsapp_reply_not_admitted'); assert.equal(f.calls.length, 0); assert.deepEqual(f.snapshot(), before); assert.equal((await f.operation(b.idempotencyKey)).statusCode, 404);
});

test('human cookie and mandatory expected context cannot be replaced by caller supplied recipient', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()), before = f.snapshot();
  assert.equal((await f.app.inject({ url: '/api/v1/whatsapp' + f.path + '/reply-context' })).statusCode, 401);
  const absent = await f.app.inject({ url: '/api/v1/whatsapp' + f.path + '/reply-context', headers: { cookie: 'kloel_session=' + f.cookies.owner } });
  assert.equal(absent.statusCode, 400); assert.equal(absent.json().error.code, 'expected_context_required');
  for (const who of ['editor', 'member']) { assert.equal((await f.contextResponse(who)).json().reasonCode, 'forbidden'); assert.equal((await f.send(b, who)).statusCode, 403); }
  assert.equal((await f.send(b, 'foreign')).statusCode, 409);
  assert.equal((await f.send({ ...b, to: '+5511000000000' })).statusCode, 400);
  assert.equal((await f.send({ ...b, confirm: false })).statusCode, 400);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

for (const scenario of ['legacy', 'missing_proof', 'duplicate_proof', 'wrong_phone', 'expired', 'future', 'invalid_time', 'channel_aba'] as const) test(`context denies ${scenario} without receipt or provider I/O`, async t => {
  const f = await whatsappConversationReplyFixture(t), original = await f.context(), proof = f.store.list(f.tenant, 'provider-events').find(p => p.messageId === f.source.id)!;
  const expected = { legacy: 'identity_requires_review', missing_proof: 'inbound_unverified', duplicate_proof: 'inbound_ambiguous', wrong_phone: 'inbound_unverified', expired: 'outside_window', future: 'invalid_timestamp', invalid_time: 'invalid_timestamp', channel_aba: 'channel_changed' };
  if (scenario === 'legacy') f.store.update(f.tenant, 'conversations', f.conversationId, { metaIdentityStatus: 'requires_review' });
  if (scenario === 'missing_proof') f.store.db.prepare('DELETE FROM entities WHERE tenant_id=? AND collection=? AND id=?').run(f.tenant, 'provider-events', proof.id);
  if (scenario === 'duplicate_proof') { const { id, createdAt, updatedAt, tenantId, ...data } = proof; f.store.create(f.tenant, 'provider-events', data); }
  if (scenario === 'wrong_phone') f.store.update(f.tenant, 'messages', f.source.id, { phoneNumberId: '99999' });
  if (scenario === 'expired') f.store.update(f.tenant, 'provider-events', proof.id, { providerTimestamp: String(Math.floor(Date.now() / 1000) - 86401) });
  if (scenario === 'future') f.store.update(f.tenant, 'provider-events', proof.id, { providerTimestamp: String(Math.floor(Date.now() / 1000) + 120) });
  if (scenario === 'invalid_time') f.store.update(f.tenant, 'provider-events', proof.id, { providerTimestamp: null });
  if (scenario === 'channel_aba') await f.change(await f.change(f.channel, 'disable'), 'enable');
  const before = f.snapshot(), c = await f.context(); assert.equal(c.reasonCode, expected[scenario]); assert.equal(c.canReply, false);
  const sent = await f.send(f.body(original)); assert.equal(sent.statusCode, 409); assert.equal(sent.json().error.code, 'whatsapp_reply_not_admitted');
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('latest signed inbound invalidates an old draft and its source context, never choosing an alias', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()), next = await f.inbound();
  assert.equal(next.conversationId, f.conversationId); assert.equal((await f.send(b)).json().error.code, 'whatsapp_reply_not_admitted');
  const current = await f.context(); assert.equal(current.sourceMessageId, next.id);
  const sent = await f.send(f.body(current)); assert.equal(sent.statusCode, 200, sent.body);
  const payload = JSON.parse(String(f.calls[0].init.body)); assert.equal(payload.to, f.sender); assert.equal(payload.context.message_id, next.providerMessageId);
  const evidence = f.store.list(f.tenant, collection)[0].recipientIdentity as any; assert.equal(evidence.waId, '551199999999');
  assert.notEqual(payload.to, evidence.waId); assert.equal(f.store.list(f.tenant, 'conversations').length, 1);
});

test('receipt replay is exact-body operator original-session and role-ABA bound', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()); assert.equal((await f.send(b)).statusCode, 200);
  assert.equal((await f.send({ ...b, text: 'Different intention' })).json().error.code, 'idempotency_conflict');
  assert.equal((await f.operation(b.idempotencyKey, 'other')).statusCode, 404); assert.equal((await f.send(b, 'other')).json().error.code, 'idempotency_conflict');
  const before = f.snapshot(); f.aba(); await f.refreshContext();
  assert.equal((await f.operation(b.idempotencyKey)).statusCode, 404); assert.equal((await f.send(b)).json().error.code, 'idempotency_conflict'); assert.deepEqual(f.snapshot(), before);
  assert.equal(f.calls.length, 1);
});

test('a second session for the same member cannot adopt the original receipt', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()); await f.send(b);
  const token = 'second-synthetic-owner-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), f.actors.owner.userId, f.tenant, Date.now() + 60000);
  f.cookies.owner = token; await f.refreshContext();
  assert.equal((await f.operation(b.idempotencyKey)).statusCode, 404); assert.equal((await f.send(b)).json().error.code, 'idempotency_conflict'); assert.equal(f.calls.length, 1);
});

test('authority ABA at BEGIN rolls back reservation and revision with zero effect', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()), before = f.snapshot(), original = f.store.transaction.bind(f.store); let once = true;
  f.store.transaction = ((fn: () => unknown) => original(() => { if (once) { once = false; f.aba(); } return fn(); })) as typeof f.store.transaction;
  const r = await f.send(b); assert.equal(r.statusCode, 409, r.body); assert.equal(r.json().error.code, 'context_changed_in_flight');
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0); assert.equal(f.store.list(f.tenant, collection).length, 0);
});

for (const change of ['logout', 'role_aba', 'rejoin', 'channel', 'config', 'new_inbound'] as const) test(`durable accepted evidence survives ${change} before late guard, without local history merge`, async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context());
  f.hooks.provider = async () => {
    if (change === 'logout') f.store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.actors.owner.userId);
    if (change === 'role_aba') f.aba();
    if (change === 'rejoin') { f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.actors.owner.userId, f.tenant); seedMember(f.store, f.actors.owner); }
    if (change === 'channel') await f.change(f.channel, 'disable');
    if (change === 'config') process.env.META_ACCESS_TOKEN = 'changed-synthetic-token';
    if (change === 'new_inbound') await f.inbound();
    return f.accepted('wamid.accepted-late');
  };
  const r = await f.send(b); assert.ok([401, 403, 409].includes(r.statusCode), r.body); assert.equal(r.body.includes('wamid.accepted-late'), false);
  const receipt = f.store.list(f.tenant, collection)[0]; assert.equal(receipt.status, 'succeeded'); assert.equal(receipt.localLink, 'not_linked'); assert.equal(receipt.providerMessageId, 'wamid.accepted-late');
  assert.equal(f.store.list(f.tenant, 'messages').filter(m => m.role === 'assistant').length, 0);
  if (['channel', 'config', 'new_inbound'].includes(change)) {
    const get = await f.operation(b.idempotencyKey); assert.equal(get.statusCode, 200); assert.equal(get.json().requiresReconciliation, true); assert.equal(get.json().externalEffect, 'accepted'); assert.equal((await f.send(b)).json().replayed, true);
  } else { if (change !== 'logout') await f.refreshContext(); assert.notEqual((await f.operation(b.idempotencyKey)).statusCode, 200); }
  assert.equal(f.calls.length, 1);
});

test('pending replay and different keys never duplicate; unknown blocks manual and worker even after reopening', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()), entered = deferred(), release = deferred();
  f.hooks.provider = async () => { entered.resolve(); await release.promise; throw Error('synthetic response lost'); };
  const first = f.send(b); await entered.promise;
  assert.equal((await f.operation(b.idempotencyKey)).json().status, 'pending'); assert.equal((await f.send(b)).json().operation.status, 'pending');
  assert.equal((await f.send({ ...b, idempotencyKey: randomUUID() })).json().error.code, 'whatsapp_reply_not_admitted');
  release.resolve(); assert.equal((await first).statusCode, 500);
  assert.equal((await f.operation(b.idempotencyKey)).json().status, 'unknown'); assert.equal((await f.send(b)).json().replayed, true);
  assert.equal((await f.context()).reasonCode, 'send_requires_reconciliation');
  const legacy = await f.request('POST', '/send', { idempotencyKey: randomUUID(), to: '+' + f.sender, channelId: f.channel.id, conversationId: f.conversationId, text: 'Legacy manual' });
  assert.equal(legacy.json().error.code, 'recipient_requires_reconciliation');
  await f.control('open'); let generated = 0, sent = 0;
  const worker = createWhatsAppWorker(f.store, { generate: async () => { generated++; return { text: 'AI', responseId: 'x', usage: {} }; }, send: async () => { sent++; return 'wamid.worker'; } }); t.after(() => worker.stop());
  assert.equal((await worker.tick()).status, 'human_handoff'); assert.equal(generated, 0); assert.equal(sent, 0); assert.equal(f.calls.length, 1);
});

test('in-flight generation must settle before human reservation and unknown worker send stays blocked', async t => {
  const f = await whatsappConversationReplyFixture(t); await f.control('open'); const entered = deferred(), release = deferred(); let sent = 0;
  const worker = createWhatsAppWorker(f.store, { generate: async () => { entered.resolve(); await release.promise; return { text: 'AI', responseId: 'x', usage: {} }; }, send: async () => { sent++; return 'wamid.worker'; } }); t.after(() => worker.stop());
  const running = worker.tick(); await entered.promise; await f.control('pending'); assert.equal((await f.context()).reasonCode, 'job_in_flight');
  assert.equal((await f.send(f.body(await f.context()))).json().error.code, 'whatsapp_reply_not_admitted');
  release.resolve(); assert.equal((await running).status, 'human_handoff'); assert.equal(sent, 0); assert.equal((await f.context()).canReply, true);
  const job = f.store.list(f.tenant, 'reply-jobs')[0]; f.store.update(f.tenant, 'reply-jobs', job.id, { status: 'requires_reconciliation' }); assert.equal((await f.context()).reasonCode, 'job_in_flight'); assert.equal(f.calls.length, 0);
});

for (const outcome of ['4xx', '5xx', 'invalid_positive'] as const) test(`provider ${outcome} is sanitized and recovered with no second POST`, async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context());
  f.hooks.provider = () => outcome === '4xx' ? Response.json({ error: { code: 131030, error_subcode: 42, message: 'PRIVATE_REMOTE_MESSAGE', url: 'https://private.invalid', token: 'PRIVATE_TOKEN' } }, { status: 400 })
    : outcome === '5xx' ? new Response('PRIVATE_REMOTE_MESSAGE', { status: 503 }) : Response.json({ messages: [], private: 'PRIVATE_REMOTE_MESSAGE' });
  const r = await f.send(b); assert.equal(r.statusCode, 502, r.body); assert.equal(r.body.includes('PRIVATE_'), false);
  const got = await f.operation(b.idempotencyKey), op = got.json(); assert.equal(op.status, outcome === '4xx' ? 'failed' : 'unknown'); assert.equal(op.externalEffect, outcome === '4xx' ? 'not_accepted' : 'unconfirmed');
  if (outcome === '4xx') { assert.equal(op.graphCode, 131030); assert.equal(op.graphSubcode, 42); assert.equal(op.errorCode, 'provider_recipient_not_allowed'); assert.equal(op.requiresReconciliation, false); }
  for (const text of [f.sender, b.text, 'PRIVATE_', f.env.META_ACCESS_TOKEN, 'providerMessageId']) assert.equal(got.body.includes(text), false);
  const before = f.snapshot(); assert.equal((await f.send(b)).json().replayed, true); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1);
});

test('accepted receipt survives error after durable write and local-link transaction rolls back atomically', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()), update = f.store.update.bind(f.store); let fail = true;
  f.store.update = ((tenant: string, coll: string, id: string, data: any) => { const result = update(tenant, coll, id, data); if (fail && coll === collection && data.localLink === 'linked') { fail = false; throw Error('Synthetic local link storage failure'); } return result; }) as typeof f.store.update;
  const r = await f.send(b); assert.equal(r.statusCode, 500);
  const receipt = f.store.list(f.tenant, collection)[0]; assert.equal(receipt.status, 'succeeded'); assert.equal(receipt.localLink, 'not_linked'); assert.equal(receipt.messageId, undefined);
  assert.equal(f.store.list(f.tenant, 'messages').filter(m => m.role === 'assistant').length, 0);
  const op = (await f.operation(b.idempotencyKey)).json(); assert.equal(op.externalEffect, 'accepted'); assert.equal(op.requiresReconciliation, true); assert.equal(op.messageId, null);
  assert.equal((await f.send(b)).json().replayed, true); assert.equal(f.calls.length, 1);
});

test('exception after the accepted autocommit cannot downgrade acceptance', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()), update = f.store.update.bind(f.store); let fail = true;
  f.store.update = ((tenant: string, coll: string, id: string, data: any) => { const result = update(tenant, coll, id, data); if (fail && coll === collection && data.status === 'succeeded') { fail = false; throw Error('Synthetic post-commit failure'); } return result; }) as typeof f.store.update;
  assert.equal((await f.send(b)).statusCode, 500); const got = (await f.operation(b.idempotencyKey)).json(); assert.equal(got.status, 'succeeded'); assert.equal(got.requiresReconciliation, true);
  assert.equal((await f.send(b)).json().replayed, true); assert.equal(f.calls.length, 1);
});

test('orphan pending after restart is unknown on read without writes or transport', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()); await f.send(b);
  const row = f.store.list(f.tenant, collection)[0]; f.store.update(f.tenant, collection, row.id, { status: 'pending', localLink: 'not_linked', messageId: null });
  const before = f.snapshot(), op = (await f.operation(b.idempotencyKey)).json(); assert.equal(op.status, 'unknown'); assert.equal(op.requiresReconciliation, true); assert.equal(op.externalEffect, 'unconfirmed');
  assert.equal((await f.send(b)).json().operation.status, 'unknown'); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1);
});

test('signed delivery before local message links only exact original phone and never equates accepted to read', async t => {
  const f = await whatsappConversationReplyFixture(t), b = f.body(await f.context()), wamid = 'wamid.early-human-reply';
  f.hooks.provider = async () => {
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '12345' }, statuses: [{ id: wamid, status: 'read', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    const r = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', f.env.META_APP_SECRET).update(raw).digest('hex') } }); assert.equal(r.statusCode, 200); return f.accepted(wamid);
  };
  const r = await f.send(b); assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().operation.deliveryStatus, 'read');
  await f.change(f.channel, 'disable'); delete process.env.META_ACCESS_TOKEN;
  const before = f.snapshot(), get = await f.operation(b.idempotencyKey); assert.equal(get.statusCode, 200); assert.equal(get.json().deliveryStatus, 'read'); assert.equal((await f.send(b)).json().replayed, true);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1); assert.equal(get.body.includes(wamid), false);
});
