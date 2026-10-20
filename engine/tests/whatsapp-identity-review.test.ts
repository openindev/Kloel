import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { whatsappIdentityReviewFixture } from './fixtures/whatsapp-identity-review.js';
import { whatsappConversationReplyFixture } from './fixtures/whatsapp-conversation-reply.js';
import { createWhatsAppWorker, enqueueInboundReply, whatsappJobVersion } from '../src/providers/worker.js';
import { resolveSessionContext } from '../src/request-context.js';

const approve = async (f: Awaited<ReturnType<typeof whatsappIdentityReviewFixture>>) => { const input = f.input(await f.context()), r = await f.review(input); assert.equal(r.statusCode, 200, r.body); return { input, operation: r.json().operation }; };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

test('signed quarantined route can be explicitly reviewed for humans without changing historical records or creating jobs', async t => {
  const f = await whatsappIdentityReviewFixture(t), legacy = f.store.get(f.tenant, 'conversations', f.legacy.id), messages = f.store.list(f.tenant, 'messages');
  assert.equal(f.current().metaIdentityStatus, 'requires_review'); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0);
  const c = await f.context(); assert.equal(c.canReview, true); assert.equal(c.destination.provenance, 'signed_inbound');
  const r = await f.review(f.input(c)); assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().operation.policy, 'manual_only'); assert.equal(f.current().status, 'pending'); assert.deepEqual(f.current().tags, ['no_ai']);
  assert.deepEqual(f.store.get(f.tenant, 'conversations', f.legacy.id), legacy); assert.deepEqual(f.store.list(f.tenant, 'messages'), messages);
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.calls.length, 0);
});

test('read context is sanitized, bounded, readonly and marks the exact current collision controls', async t => {
  const f = await whatsappIdentityReviewFixture(t), before = f.snapshot(), c = await f.context();
  assert.deepEqual(f.snapshot(), before); assert.equal(c.reviewState, 'required'); assert.equal(c.policy, null);
  assert.deepEqual(c.collisions, { complete: true, items: [{ conversationId: f.legacy.id, status: 'closed', noAi: true, humanHandoff: false }] });
  assert.deepEqual(Object.keys(c).sort(), ['tenantId', 'conversationId', 'version', 'reviewState', 'policy', 'canReview', 'reasonCode', 'sourceMessageId', 'channelId', 'destination', 'windowExpiresAt', 'collisions'].sort());
  assert.equal(c.destination.display, '••••' + f.sender.slice(-4));
  const text = JSON.stringify(c); for (const privateText of ['Private historical', 'Synthetic new signed entry', 'wamid.', f.env.META_APP_SECRET]) assert.equal(text.includes(privateText), false);
  for (let i = 0; i < 50; i++) f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'closed', externalContact: '+' + f.sender });
  const limit = await f.context(); assert.equal(limit.collisions.complete, false); assert.equal(limit.collisions.items.length, 50); assert.equal(limit.canReview, false); assert.equal(limit.reasonCode, 'collisions_incomplete');
  const snap = f.snapshot(); assert.equal((await f.review(f.input(limit))).statusCode, 409); assert.deepEqual(f.snapshot(), snap);
});

test('receipt survives changed configuration, conversation deletion and missing credentials without adopting current state', async t => {
  const f = await whatsappIdentityReviewFixture(t), a = await approve(f);
  f.store.remove(f.tenant, 'conversations', f.conversationId); f.store.remove(f.tenant, 'channels', f.channel.id); delete process.env.META_ACCESS_TOKEN;
  const before = f.snapshot(), get = await f.operation(a.input.key), replay = await f.review(a.input);
  assert.equal(get.statusCode, 200); assert.deepEqual(get.json(), a.operation); assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('lost HTTP envelope after durable commit is recovered with the original key without another audit or provider call', async t => {
  const f = await whatsappIdentityReviewFixture(t), input = f.input(await f.context()), transaction = f.store.transaction.bind(f.store); let injected = false;
  f.store.transaction = ((fn: () => unknown) => { const r = transaction(fn); if (!injected && f.store.list(f.tenant, 'whatsapp-identity-reviews').length) { injected = true; throw Error('Synthetic lost envelope after commit'); } return r; }) as typeof f.store.transaction;
  assert.equal((await f.review(input)).statusCode, 500); f.store.transaction = transaction;
  const get = await f.operation(input.key); assert.equal(get.statusCode, 200); assert.equal(get.json().status, 'applied');
  assert.equal((await f.review(input)).json().replayed, true); assert.equal(f.store.list(f.tenant, 'whatsapp-identity-review-audits').length, 1); assert.equal(f.calls.length, 0);
});

test('fresh signed inbound keeps manual-only route and records original types without changing legacy receipts', async t => {
  const f = await whatsappIdentityReviewFixture(t), legacyReceipt = f.store.create(f.tenant, 'provider-events', { provider: 'meta', type: 'message.received', eventId: 'wamid.old-no-type' });
  await approve(f); await f.control({ status: 'open', tags: [] });
  const source = await f.inbound({ type: 'image' }), proof = f.store.list(f.tenant, 'provider-events').find(e => e.messageId === source.id)!;
  assert.equal(source.conversationId, f.conversationId); assert.equal(proof.messageType, 'image'); assert.equal(f.current().metaIdentityPolicy, 'manual_only');
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.deepEqual(f.store.get(f.tenant, 'provider-events', legacyReceipt.id), legacyReceipt);
  const first = f.store.list(f.tenant, 'provider-events').find(e => e.messageId === f.source.id)!; assert.equal(first.messageType, 'text');
  await f.inbound({ id: String(f.source.providerMessageId), type: 'video' }); assert.deepEqual(f.store.get(f.tenant, 'provider-events', first.id), first);
  assert.equal(enqueueInboundReply(f.store, f.tenant, { message: source, conversation: { ...f.current(), metaIdentityPolicy: undefined, metaIdentityStatus: undefined }, phoneNumberId: '12345', providerTimestamp: String(Math.floor(Date.now() / 1000)), messageType: 'text' }), undefined);
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.calls.length, 0);
});

test('generic status/tags cannot remove the private policy or admit a field for it', async t => {
  const f = await whatsappIdentityReviewFixture(t); await approve(f);
  const bad = await f.request('PATCH', '/api/v1/conversations/' + f.conversationId, { metaIdentityPolicy: null }); assert.equal(bad.statusCode, 400);
  const patch = await f.request('PATCH', '/api/v1/conversations/' + f.conversationId, { status: 'open', tags: [] }); assert.equal(patch.statusCode, 200, patch.body);
  assert.equal(f.current().metaIdentityPolicy, 'manual_only'); await f.inbound(); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0);
});

test('review enables the native human composer only; stale collisions block it again and do not rewrite history', async t => {
  const f = await whatsappIdentityReviewFixture(t); assert.equal((await f.replyContext()).json().reasonCode, 'identity_requires_review');
  const a = await approve(f); assert.equal((await f.context()).reviewState, 'valid'); assert.equal((await f.replyContext()).json().canReply, true);
  f.store.update(f.tenant, 'conversations', f.legacy.id, { status: 'open', tags: ['human_handoff'], replyRevision: 3 });
  assert.equal((await f.context()).reviewState, 'stale'); assert.equal((await f.replyContext()).json().reasonCode, 'identity_requires_review');
  const b = await approve(f); assert.notEqual(a.input.key, b.input.key); const current = f.current();
  assert.deepEqual((await f.operation(a.input.key)).json(), a.operation); assert.equal((await f.review(a.input)).json().replayed, true); assert.deepEqual(f.current(), current);
  assert.equal((await f.replyContext()).json().canReply, true); assert.equal(f.store.get(f.tenant, 'conversations', f.legacy.id)?.status, 'open');
});

for (const change of ['proof_missing', 'proof_duplicate', 'wrong_phone', 'alias', 'channel_revision', 'expired', 'no_tag', 'open', 'not_quarantined'] as const) test(`review denies ${change} with no commit or provider I/O`, async t => {
  const f = await whatsappIdentityReviewFixture(t), proof = f.store.list(f.tenant, 'provider-events').find(e => e.messageId === f.source.id)!;
  if (change === 'proof_missing') f.store.remove(f.tenant, 'provider-events', proof.id);
  if (change === 'proof_duplicate') { const { id, tenantId, createdAt, updatedAt, ...data } = proof; f.store.create(f.tenant, 'provider-events', data); }
  if (change === 'wrong_phone') f.store.update(f.tenant, 'messages', f.source.id, { phoneNumberId: '98765' });
  if (change === 'alias') f.store.update(f.tenant, 'conversations', f.conversationId, { externalContact: '+551199999999' });
  if (change === 'channel_revision') await f.change(f.channel, 'update', { name: 'Changed' });
  if (change === 'expired') f.store.update(f.tenant, 'provider-events', proof.id, { providerTimestamp: '1' });
  if (change === 'no_tag') await f.control({ tags: [] });
  if (change === 'open') await f.control({ status: 'open' });
  if (change === 'not_quarantined') f.store.update(f.tenant, 'conversations', f.conversationId, { metaIdentityStatus: 'ordinary' });
  const c = await f.context(); assert.equal(c.canReview, false); const before = f.snapshot();
  const r = await f.review(f.input(c)); assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'whatsapp_identity_review_not_admitted'); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('review needs original authority; other users, fresh sessions and role ABA cannot adopt receipts', async t => {
  const f = await whatsappIdentityReviewFixture(t), a = await approve(f);
  assert.equal((await f.operation(a.input.key, 'other')).statusCode, 404); assert.equal((await f.review(a.input, 'other')).statusCode, 409);
  assert.equal((await f.operation(a.input.key, 'foreign')).statusCode, 404);
  const old = f.cookies.owner; f.cookies.owner = 'synthetic-new-owner-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(f.cookies.owner).digest('hex'), f.actors.owner.userId, f.tenant, Date.now() + 60000); await f.refreshContext();
  assert.equal((await f.operation(a.input.key)).statusCode, 404); f.cookies.owner = old; await f.refreshContext(); f.aba(); await f.refreshContext();
  assert.equal((await f.operation(a.input.key)).statusCode, 404); assert.equal((await f.review(a.input)).statusCode, 409); assert.equal(f.calls.length, 0);
});

test('strict body and full cookie context are required, while a reader gets a disabled control', async t => {
  const f = await whatsappIdentityReviewFixture(t), c = await f.context(), body = f.input(c);
  const missing = await f.app.inject({ method: 'POST', url: f.path + '/whatsapp-identity-review', payload: body, headers: { cookie: 'kloel_session=' + f.cookies.owner } }); assert.equal(missing.statusCode, 400);
  for (const extra of [{ destination: f.sender }, { authority: {} }, { decision: 'automatic' }, { confirm: false }]) assert.equal((await f.review({ ...body, ...extra })).statusCode, 400);
  assert.equal((await f.review({ ...body, expectedTenantId: 'other' })).statusCode, 409);
  const reader = await f.contextResponse('editor'); assert.equal(reader.statusCode, 200); assert.equal(reader.json().canReview, false); assert.equal(reader.json().reasonCode, 'forbidden'); assert.equal((await f.review(body, 'editor')).statusCode, 403);
  assert.equal((await f.operation(randomUUID())).statusCode, 404); assert.equal(f.store.list(f.tenant, 'whatsapp-identity-reviews').length, 0);
});

for (const place of ['begin', 'final_guard', 'collision_after_write', 'audit_storage'] as const) test(`atomic ${place} failure rolls back decision, receipt and audit`, async t => {
  const f = await whatsappIdentityReviewFixture(t), input = f.input(await f.context()), before = f.snapshot(), transaction = f.store.transaction.bind(f.store), create = f.store.create.bind(f.store);
  if (place === 'begin') f.store.transaction = ((fn: () => unknown) => transaction(() => { f.aba(); return fn(); })) as typeof f.store.transaction;
  else f.store.create = ((tenant: string, collection: string, data: any) => { const result = create(tenant, collection, data); if (collection === 'whatsapp-identity-review-audits') {
    if (place === 'final_guard') f.aba();
    if (place === 'collision_after_write') f.store.update(f.tenant, 'conversations', f.legacy.id, { tags: ['human_handoff'] });
    if (place === 'audit_storage') throw Error('Synthetic storage failure');
  } return result; }) as typeof f.store.create;
  const r = await f.review(input); assert.ok(r.statusCode >= 400); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('stale CAS and a competing key cannot apply twice; exact original replay precedes current eligibility', async t => {
  const f = await whatsappIdentityReviewFixture(t), c = await f.context(), a = f.input(c), b = f.input(c);
  const first = await f.review(a); assert.equal(first.statusCode, 200); assert.equal((await f.review(b)).json().error.code, 'whatsapp_identity_review_not_admitted');
  assert.equal((await f.review(a)).json().replayed, true); assert.equal((await f.review({ ...a, expectedVersion: 'a'.repeat(64) })).statusCode, 409);
  assert.equal(f.store.list(f.tenant, 'whatsapp-identity-reviews').length, 1); assert.equal(f.store.list(f.tenant, 'whatsapp-identity-review-audits').length, 1);
});

test('manual-only blocks queued claim, both resume routes and one-shot despite status/tags clearing', async t => {
  const f = await whatsappIdentityReviewFixture(t); await approve(f); await f.control({ status: 'open', tags: [] });
  const proof = f.store.list(f.tenant, 'provider-events').find(e => e.messageId === f.source.id)!;
  const job = f.store.create(f.tenant, 'reply-jobs', { provider: 'meta', mode: 'transactional_inbound', conversationId: f.conversationId, sourceMessageId: f.source.id, providerMessageId: f.source.providerMessageId, channelId: f.channel.id, agentId: f.agent.id, channelSnapshot: proof.channelSnapshot, recipient: '+' + f.sender, incomingAt: Number(proof.providerTimestamp) * 1000, status: 'queued', attempts: 0, dueAt: 0 });
  const worker = createWhatsAppWorker(f.store); t.after(() => worker.stop()); assert.equal((await worker.tick()).status, 'identity_manual_only');
  const paused = f.store.get(f.tenant, 'reply-jobs', job.id)!; assert.equal(paused.attempts, 0);
  assert.equal((await f.request('POST', '/jobs/' + job.id + '/resume', { expectedVersion: whatsappJobVersion(paused) })).statusCode, 409);
  assert.equal((await f.request('POST', '/api/v1/providers/jobs/' + job.id + '/resume', {})).statusCode, 409);
  process.env.WHATSAPP_AUTOREPLY_ENABLED = 'false'; const queued = f.store.update(f.tenant, 'reply-jobs', job.id, { status: 'queued' })!, sessionHash = createHash('sha256').update(f.cookies.owner).digest('hex');
  await assert.rejects(worker.runJobOnce({ tenantId: f.tenant, jobId: job.id, expectedVersion: whatsappJobVersion(queued), authority: { sessionHash, context: resolveSessionContext(f.store, sessionHash)!.context }, assertAccess: () => {} }), (e: any) => e.code === 'identity_manual_only');
  assert.equal(f.calls.length, 0); assert.equal(f.store.get(f.tenant, 'reply-jobs', job.id)?.attempts, 0);
});

test('policy installed while generation is held blocks Meta at the post-await recheck', async t => {
  const f = await whatsappConversationReplyFixture(t); await f.control('open'); const entered = deferred(), release = deferred(); let sends = 0;
  const worker = createWhatsAppWorker(f.store, { generate: async () => { entered.resolve(); await release.promise; return { text: 'Synthetic', responseId: 'synthetic', usage: {} }; }, send: async () => { sends++; return 'wamid.never'; } }); t.after(() => worker.stop());
  const running = worker.tick(); await entered.promise;
  f.store.update(f.tenant, 'conversations', f.conversationId, { metaIdentityStatus: 'requires_review', status: 'pending', tags: ['no_ai'] });
  const path = '/api/v1/conversations/' + f.conversationId + '/whatsapp-identity-review'; const c = await f.request('GET', path);
  const applied = await f.request('POST', path, { expectedTenantId: f.tenant, expectedVersion: c.json().version, key: randomUUID(), decision: 'human_only', confirm: true }); assert.equal(applied.statusCode, 200, applied.body);
  await f.control('open'); f.store.update(f.tenant, 'conversations', f.conversationId, { tags: [] }); release.resolve();
  assert.equal((await running).status, 'identity_manual_only'); assert.equal(sends, 0); assert.equal(f.calls.length, 0);
});

test('collision change during accepted human response preserves accepted receipt but blocks local link', async t => {
  const f = await whatsappIdentityReviewFixture(t); await approve(f); const c = (await f.replyContext()).json();
  f.hooks.provider = () => { f.store.update(f.tenant, 'conversations', f.legacy.id, { tags: ['human_handoff'] }); return Response.json({ messages: [{ id: 'wamid.accepted-identity-review' }] }); };
  const key = randomUUID(), r = await f.request('POST', '/conversations/' + f.conversationId + '/replies', { expectedTenantId: f.tenant, expectedVersion: c.version, idempotencyKey: key, text: 'Synthetic human response', confirm: true });
  assert.equal(r.statusCode, 409); assert.equal(f.calls.length, 1);
  const get = await f.request('GET', '/conversations/' + f.conversationId + '/reply-operations/' + key); assert.equal(get.json().externalEffect, 'accepted'); assert.equal(get.json().localLink, 'not_linked'); assert.equal(get.json().requiresReconciliation, true);
});

test('two proven current routes with the same original phone/from/channel are ambiguous, not selectable by approval', async t => {
  const f = await whatsappIdentityReviewFixture(t), original = f.store.list(f.tenant, 'provider-events').find(e => e.messageId === f.source.id)!;
  const other = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'pending', tags: ['no_ai'], externalContact: '+' + f.sender, channelId: f.channel.id, metaIdentityStatus: 'requires_review' });
  const message = f.store.create(f.tenant, 'messages', { conversationId: other.id, source: 'meta', role: 'user', phoneNumberId: '12345', externalContact: '+' + f.sender, providerMessageId: 'wamid.other-proven', content: 'Synthetic separate route' });
  const { id, tenantId, createdAt, updatedAt, ...proof } = original; f.store.create(f.tenant, 'provider-events', { ...proof, eventId: message.providerMessageId, providerMessageId: message.providerMessageId, messageId: message.id, conversationId: other.id });
  const c = await f.context(); assert.equal(c.canReview, false); assert.equal(c.reasonCode, 'inbound_ambiguous'); const before = f.snapshot();
  assert.equal((await f.review(f.input(c))).statusCode, 409); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('future message type is bounded and a duplicate legacy receipt is never backfilled', async t => {
  const f = await whatsappIdentityReviewFixture(t), old = f.store.create(f.tenant, 'provider-events', { provider: 'meta', type: 'message.received', eventId: 'wamid.old-duplicate' });
  await f.inbound({ id: 'wamid.old-duplicate', type: 'text' }); assert.deepEqual(f.store.get(f.tenant, 'provider-events', old.id), old);
  const invalid = await f.inbound({ type: '<private invalid type>' }), receipt = f.store.list(f.tenant, 'provider-events').find(e => e.messageId === invalid.id)!;
  assert.equal(receipt.messageType, null); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.calls.length, 0);
});
