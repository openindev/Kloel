import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { whatsappChannelsFixture } from './fixtures/whatsapp-channels.js';
import { createWhatsAppWorker } from '../src/providers/worker.js';

type Fixture = Awaited<ReturnType<typeof whatsappChannelsFixture>>;
const destination = '+5511999999999', sender = '5511999999999', canonical = '551199999999';
function accepted(id: string, contacts: unknown = [{ input: sender, wa_id: canonical }]) { return { messaging_product: 'whatsapp', messages: [{ id }], contacts }; }
async function inbound(f: Fixture, id: string, from = sender, phone = f.env.META_PHONE_NUMBER_ID, altered = false) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: phone }, messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Synthetic input' } }] } }] }] });
  return f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: raw + (altered ? ' ' : ''), headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', f.env.META_APP_SECRET).update(raw).digest('hex') } });
}
async function enabled(f: Fixture) { return f.change((await f.create()).row, 'enable'); }
function operation(f: Fixture, key: string) { return f.store.list(f.tenant, 'whatsapp-operations').find(x => x.key === key)!; }

test('accepted human response preserves optional exact contact observation on original receipt before disclosure', async t => {
  const f = await whatsappChannelsFixture(t), channel = await enabled(f), key = randomUUID();
  f.hooks.provider = () => Response.json(accepted('wamid.identity-human'));
  const body = { to: destination, channelId: channel.id, text: 'Synthetic reply', idempotencyKey: key };
  const r = await f.request('POST', '/send', body); assert.equal(r.statusCode, 200, r.body);
  const receipt = operation(f, key), identity = receipt.recipientIdentity as any;
  assert.ok(identity, 'accepted contact observation must be durable');
  assert.equal(identity.kind, 'meta_send_response_contact'); assert.equal(identity.version, 1);
  assert.equal(identity.tenantId, f.tenant); assert.equal(identity.phoneNumberId, '12345'); assert.equal(identity.channelId, channel.id);
  assert.equal(identity.ownerCollection, 'whatsapp-operations'); assert.equal(identity.ownerId, receipt.id);
  assert.equal(identity.requestedDestination, destination); assert.equal(identity.input, sender); assert.equal(identity.waId, canonical); assert.equal(identity.providerMessageId, 'wamid.identity-human');
  const before = f.snapshot(); assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 200); assert.equal((await f.request('POST', '/send', body)).statusCode, 200);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1); assert.equal(r.body.includes('recipientIdentity'), false);
});

test('new signed inbound never adopts legacy history and reuses only its own proven phone sender route', async t => {
  const f = await whatsappChannelsFixture(t), channel = await enabled(f);
  const legacy = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'open', externalContact: destination });
  const old = f.store.create(f.tenant, 'messages', { conversationId: legacy.id, role: 'user', source: 'meta', providerMessageId: 'wamid.legacy', content: 'Legacy untouched' });
  assert.equal((await inbound(f, 'wamid.identity-inbound1')).statusCode, 200);
  const message = f.store.list(f.tenant, 'messages').find(x => x.providerMessageId === 'wamid.identity-inbound1')!;
  assert.notEqual(message.conversationId, legacy.id, 'legacy history is not evidence of this phone');
  assert.equal(message.phoneNumberId, '12345');
  const proof = f.store.list(f.tenant, 'provider-events').find(x => x.eventId === 'wamid.identity-inbound1')!;
  assert.equal(proof.inboundEvidenceVersion, 1); assert.equal(proof.phoneNumberId, '12345'); assert.equal(proof.from, sender); assert.equal(proof.messageId, message.id); assert.equal(proof.conversationId, message.conversationId); assert.equal(proof.channelId, channel.id);
  assert.equal((await inbound(f, 'wamid.identity-inbound2')).statusCode, 200);
  assert.equal(f.store.list(f.tenant, 'messages').find(x => x.providerMessageId === 'wamid.identity-inbound2')!.conversationId, message.conversationId);
  assert.deepEqual(f.store.get(f.tenant, 'conversations', legacy.id), legacy); assert.deepEqual(f.store.get(f.tenant, 'messages', old.id), old);
  const before = f.snapshot(); assert.equal((await inbound(f, 'wamid.identity-inbound1')).json().messages, 0); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('worker native send preserves optional contact evidence on original job without changing its recipient', async t => {
  const f = await whatsappChannelsFixture(t); await enabled(f); await inbound(f, 'wamid.identity-worker-source');
  const job = f.store.list(f.tenant, 'reply-jobs')[0]; let generated = 0;
  f.hooks.provider = (_url, init) => { assert.equal(JSON.parse(String(init.body)).to, sender); return Response.json(accepted('wamid.identity-worker')); };
  const worker = createWhatsAppWorker(f.store, { generate: async () => { generated++; return { text: 'Synthetic', responseId: 'synthetic', usage: {} }; } }); t.after(() => worker.stop());
  assert.equal((await worker.tick()).status, 'sent'); const saved = f.store.get(f.tenant, 'reply-jobs', job.id)!;
  assert.ok(saved.recipientIdentity, 'native worker must capture actual response contact'); assert.equal((saved.recipientIdentity as any).ownerId, job.id); assert.equal((saved.recipientIdentity as any).ownerCollection, 'reply-jobs'); assert.equal((saved.recipientIdentity as any).waId, canonical); assert.equal(saved.recipient, destination);
  assert.equal((await worker.tick()).status, 'idle'); assert.equal(f.calls.length, 1); assert.equal(generated, 1);
});

test('missing malformed ambiguous or mismatched contacts never invalidate acceptance or authorize a destination change', async t => {
  const f = await whatsappChannelsFixture(t), channel = await enabled(f);
  const cases = [undefined, null, [], [{ input: sender, wa_id: canonical }, { input: sender, wa_id: canonical }], [{ input: '441234567890', wa_id: canonical }], [{ input: sender + ' ', wa_id: canonical }], [{ input: sender, wa_id: canonical + ' ' }], [{ input: sender, wa_id: 123456789 }], [{ input: sender, wa_id: 'not-an-id' }], [{ input: {}, wa_id: canonical }], { input: sender, wa_id: canonical }];
  for (const [i, contacts] of cases.entries()) {
    const key = randomUUID(); f.hooks.provider = (_url, init) => { assert.equal(JSON.parse(String(init.body)).to, sender); return Response.json({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.optional-' + i }], ...(contacts === undefined ? {} : { contacts }) }); };
    const body = { to: destination, text: 'Synthetic', channelId: channel.id, idempotencyKey: key };
    assert.equal((await f.request('POST', '/send', body)).statusCode, 200);
    const row = operation(f, key); assert.equal(row.status, 'succeeded'); assert.equal(Object.hasOwn(row, 'recipientIdentity'), false); assert.equal((row.result as any).status, 'accepted');
    assert.equal((await f.request('POST', '/send', body)).statusCode, 200);
  }
  assert.equal(f.calls.length, cases.length);
});

test('plus-only input equivalence captures just the allowed fields and manual authorship from original authority', async t => {
  const f = await whatsappChannelsFixture(t), channel = await enabled(f), key = randomUUID();
  f.hooks.provider = () => Response.json({ ...accepted('wamid.plus', [{ input: destination, wa_id: canonical, rawSecret: 'untrusted-extra' }]), rawBody: 'untrusted-extra' });
  assert.equal((await f.request('POST', '/send', { to: destination, text: 'Synthetic', channelId: channel.id, idempotencyKey: key })).statusCode, 200);
  const row = operation(f, key), evidence = row.recipientIdentity as any, message = f.store.list(f.tenant, 'messages')[0];
  assert.equal(evidence.input, destination); assert.equal(evidence.requestedDestination, destination); assert.ok(Number.isFinite(Date.parse(evidence.observedAt))); assert.equal(JSON.stringify(row).includes('untrusted-extra'), false);
  assert.equal(message.authorType, 'human'); assert.equal(message.authorUserId, f.actors.owner.userId); assert.equal(message.authorMembershipId, row.membershipId); assert.equal(message.recipient, destination);
});

for (const mutation of ['role_aba', 'phone', 'channel'] as const) test('accepted identity stays bound and durable before late ' + mutation + ' disclosure guard', async t => {
  const f = await whatsappChannelsFixture(t), channel = await enabled(f), key = randomUUID();
  f.hooks.provider = async () => {
    if (mutation === 'role_aba') f.aba();
    if (mutation === 'phone') process.env.META_PHONE_NUMBER_ID = '99999';
    if (mutation === 'channel') await f.change(channel, 'disable');
    return Response.json(accepted('wamid.late-' + mutation));
  };
  const r = await f.request('POST', '/send', { to: destination, channelId: channel.id, text: 'Synthetic', idempotencyKey: key }); assert.notEqual(r.statusCode, 200);
  const row = operation(f, key), evidence = row.recipientIdentity as any;
  assert.equal(row.status, 'succeeded'); assert.equal((row.result as any).messageId, 'wamid.late-' + mutation); assert.equal(evidence.phoneNumberId, '12345'); assert.equal(evidence.channelId, channel.id); assert.equal(evidence.ownerId, row.id); assert.equal(evidence.waId, canonical);
  assert.equal(f.store.list(f.tenant, 'messages').length, 0); assert.equal(r.body.includes(canonical), false); assert.equal(r.body.includes('recipientIdentity'), false); assert.equal(f.calls.length, 1);
});

test('accepted contact and result persist together if local update throws after commit; GET remains pure', async t => {
  const f = await whatsappChannelsFixture(t), channel = await enabled(f), key = randomUUID(), update = f.store.update.bind(f.store); let thrown = false;
  f.hooks.provider = () => Response.json(accepted('wamid.storage'));
  f.store.update = (tenant, collection, id, data) => { const row = update(tenant, collection, id, data); if (!thrown && collection === 'whatsapp-operations' && data.recipientIdentity) { thrown = true; throw Error('synthetic after write'); } return row; };
  const r = await f.request('POST', '/send', { to: destination, text: 'Synthetic', channelId: channel.id, idempotencyKey: key }); assert.notEqual(r.statusCode, 200); assert.equal(thrown, true);
  const receipt = operation(f, key); assert.equal(receipt.status, 'succeeded'); assert.equal((receipt.recipientIdentity as any).providerMessageId, (receipt.result as any).messageId);
  const before = f.snapshot(); assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 200); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1);
});

test('unknown response has no contact evidence and same-key replay never sends again', async t => {
  const f = await whatsappChannelsFixture(t), channel = await enabled(f), key = randomUUID();
  f.hooks.provider = () => { throw Error('Synthetic transport uncertainty'); };
  const body = { to: destination, text: 'Synthetic', channelId: channel.id, idempotencyKey: key };
  assert.equal((await f.request('POST', '/send', body)).statusCode, 502); const row = operation(f, key); assert.equal(row.status, 'unknown'); assert.equal(row.recipientIdentity, undefined);
  assert.equal((await f.request('POST', '/send', body)).statusCode, 409); assert.equal(f.calls.length, 1);
});

test('template send captures the same exact evidence and human author without altering its send contract', async t => {
  const f = await whatsappChannelsFixture(t), channel = await enabled(f), key = randomUUID(), oldWaba = process.env.META_WABA_ID; process.env.META_WABA_ID = '88888'; t.after(() => { if (oldWaba === undefined) delete process.env.META_WABA_ID; else process.env.META_WABA_ID = oldWaba; });
  f.hooks.provider = (_url, init) => (init.method ?? 'GET') === 'GET' ? Response.json({ data: [{ id: '77777', name: 'synthetic', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Synthetic template' }] }] }) : Response.json(accepted('wamid.template'));
  const r = await f.request('POST', '/templates/send', { to: destination, channelId: channel.id, name: 'synthetic', language: 'pt_BR', bodyParameters: [], idempotencyKey: key }); assert.equal(r.statusCode, 200, r.body);
  assert.equal((operation(f, key).recipientIdentity as any).providerMessageId, 'wamid.template'); assert.equal(f.store.list(f.tenant, 'messages')[0].authorType, 'human'); assert.equal(f.calls.filter(x => x.init.method === 'POST').length, 1);
});

test('worker accepted observation uses original snapshot after channel disable and keeps AI author unchanged', async t => {
  const f = await whatsappChannelsFixture(t), channel = await enabled(f); await inbound(f, 'wamid.worker-late-source'); const job = f.store.list(f.tenant, 'reply-jobs')[0];
  f.hooks.provider = async () => { await f.change(channel, 'disable'); return Response.json(accepted('wamid.worker-late')); };
  const worker = createWhatsAppWorker(f.store, { generate: async () => ({ text: 'Synthetic', responseId: 'synthetic', usage: {} }) }); t.after(() => worker.stop());
  assert.equal((await worker.tick()).status, 'sent'); const saved = f.store.get(f.tenant, 'reply-jobs', job.id)!;
  assert.equal((saved.recipientIdentity as any).channelVersion, (job.channelSnapshot as any).version); assert.equal((saved.recipientIdentity as any).phoneNumberId, '12345');
  const message = f.store.list(f.tenant, 'messages').find(m => m.autoReplyJobId === job.id)!; assert.equal(message.authorType, undefined); assert.equal(message.authorUserId, undefined);
  assert.equal((await worker.tick()).status, 'idle'); assert.equal(f.calls.length, 1);
});

test('inbound routing separates exact phone and tenant even for the same sender and provider message ID', async t => {
  const f = await whatsappChannelsFixture(t); await enabled(f); await inbound(f, 'wamid.shared');
  const first = f.store.list(f.tenant, 'messages')[0], proof = f.store.list(f.tenant, 'provider-events')[0];
  process.env.META_PHONE_NUMBER_ID = '99999'; assert.equal((await inbound(f, 'wamid.shared', sender, '99999')).json().messages, 1);
  const second = f.store.list(f.tenant, 'messages').find(m => m.phoneNumberId === '99999')!; assert.notEqual(first.conversationId, second.conversationId);
  process.env.PROVIDER_TENANT_ID = f.actors.foreign.tenantId; assert.equal((await inbound(f, 'wamid.shared', sender, '99999')).json().messages, 1);
  const foreign = f.store.list(f.actors.foreign.tenantId, 'messages')[0]; assert.notEqual(foreign.conversationId, second.conversationId);
  assert.deepEqual(f.store.get(f.tenant, 'provider-events', proof.id), proof); assert.equal(f.calls.length, 0);
});

test('inbound identity never folds digit variants or binds an unbound receipt to a newly enabled channel', async t => {
  const f = await whatsappChannelsFixture(t); assert.equal((await inbound(f, 'wamid.unbound')).statusCode, 200); const unbound = f.store.list(f.tenant, 'messages')[0];
  const unboundProof = f.store.list(f.tenant, 'provider-events')[0]; assert.equal(unboundProof.channelId, null); await enabled(f);
  assert.equal((await inbound(f, 'wamid.bound')).statusCode, 200); const bound = f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === 'wamid.bound')!; assert.notEqual(bound.conversationId, unbound.conversationId);
  assert.equal((await inbound(f, 'wamid.variant', canonical)).statusCode, 200); const variant = f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === 'wamid.variant')!; assert.notEqual(variant.conversationId, bound.conversationId);
  assert.deepEqual(f.store.get(f.tenant, 'provider-events', unboundProof.id), unboundProof); assert.equal(f.calls.length, 0);
});

test('signed ingress guards malformed identity wrong phone and signature before creating proof', async t => {
  const f = await whatsappChannelsFixture(t), before = f.snapshot();
  assert.equal((await inbound(f, 'wamid.bad-signature', sender, '12345', true)).statusCode, 401);
  for (const [id, from, phone] of [['wamid.wrong-phone', sender, '99999'], ['bad id', sender, '12345'], ['wamid.invalid-from', '+5511999999999', '12345'], ['wamid.invalid-from2', 'arbitrary', '12345']] as const) assert.equal((await inbound(f, id, from, phone)).json().messages, 0);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('closed or reassigned conversations and corrupted ingress anchors are never silently adopted', async t => {
  const f = await whatsappChannelsFixture(t); await enabled(f);
  for (const change of ['closed', 'reassigned', 'anchor_removed'] as const) {
    await inbound(f, 'wamid.route-' + change); const old = f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === 'wamid.route-' + change)!;
    if (change === 'closed') f.store.update(f.tenant, 'conversations', String(old.conversationId), { status: 'closed' });
    if (change === 'reassigned') f.store.update(f.tenant, 'conversations', String(old.conversationId), { channelId: 'different-channel' });
    if (change === 'anchor_removed') for (const p of f.store.list(f.tenant, 'provider-events').filter(p => p.conversationId === old.conversationId)) f.store.update(f.tenant, 'provider-events', p.id, { messageId: 'missing' });
    await inbound(f, 'wamid.new-' + change); const fresh = f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === 'wamid.new-' + change)!; assert.notEqual(fresh.conversationId, old.conversationId);
  }
});

test('inbound proof failure rolls back message conversation job and receipt; exact callback retry records once', async t => {
  const f = await whatsappChannelsFixture(t); await enabled(f); const before = f.snapshot(), create = f.store.create.bind(f.store); let failure = true;
  f.store.create = (tenant, collection, data) => { if (failure && collection === 'provider-events' && data.inboundEvidenceVersion === 1) throw Error('Synthetic ingress storage failure'); return create(tenant, collection, data); };
  assert.equal((await inbound(f, 'wamid.rollback')).statusCode, 500); assert.deepEqual(f.snapshot(), before); failure = false;
  assert.equal((await inbound(f, 'wamid.rollback')).json().messages, 1); const after = f.snapshot(); assert.equal((await inbound(f, 'wamid.rollback')).json().messages, 0); assert.deepEqual(f.snapshot(), after);
});

test('old opaque receipt suppresses duplicate without fabricating new provenance or touching legacy message', async t => {
  const f = await whatsappChannelsFixture(t); await enabled(f);
  f.store.create(f.tenant, 'provider-events', { provider: 'meta', eventId: 'wamid.old', type: 'message.received' });
  const before = f.snapshot(); assert.equal((await inbound(f, 'wamid.old')).json().messages, 0); assert.deepEqual(f.snapshot(), before);
});

for (const state of ['open', 'pending', 'closed', 'no_ai', 'human_handoff'] as const) test('legacy collision ' + state + ' cannot acquire a fresh automatic reply route', async t => {
  const f = await whatsappChannelsFixture(t); await enabled(f);
  const legacy = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: ['open', 'pending', 'closed'].includes(state) ? state : 'open', tags: ['no_ai', 'human_handoff'].includes(state) ? [state] : [], externalContact: destination });
  assert.equal((await inbound(f, 'wamid.block-' + state)).statusCode, 200);
  const message = f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === 'wamid.block-' + state)!;
  assert.notEqual(message.conversationId, legacy.id);
  const route = f.store.get(f.tenant, 'conversations', String(message.conversationId))!;
  assert.equal(route.status, 'pending'); assert.deepEqual(route.tags, ['no_ai']); assert.equal(route.metaIdentityStatus, 'requires_review');
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(Number(f.store.db.prepare('SELECT COUNT(*) AS n FROM crm_source_events WHERE tenant_id=?').get(f.tenant)!.n), 0);
  assert.deepEqual(f.store.get(f.tenant, 'conversations', legacy.id), legacy);
  // Reopening the new shell without resolving transport identity is not new authority.
  f.store.update(f.tenant, 'conversations', route.id, { status: 'open', tags: [] });
  assert.equal((await inbound(f, 'wamid.block-repeat-' + state)).statusCode, 200);
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.calls.length, 0);
});

test('proven pending or opted-out routes remain non-automatic; proven closed route cannot bypass opt-out', async t => {
  const f = await whatsappChannelsFixture(t); await enabled(f);
  await inbound(f, 'wamid.proven-start'); const original = f.store.list(f.tenant, 'messages')[0], count = f.store.list(f.tenant, 'reply-jobs').length;
  for (const change of [{ status: 'pending', tags: [] }, { status: 'open', tags: ['no_ai'] }, { status: 'open', tags: ['human_handoff'] }]) {
    f.store.update(f.tenant, 'conversations', String(original.conversationId), change);
    await inbound(f, 'wamid.proven-' + change.status + '-' + change.tags.join('_'));
    assert.equal(f.store.list(f.tenant, 'reply-jobs').length, count);
  }
  f.store.update(f.tenant, 'conversations', String(original.conversationId), { status: 'closed', tags: ['no_ai'] });
  await inbound(f, 'wamid.proven-closed'); const fresh = f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === 'wamid.proven-closed')!;
  assert.notEqual(fresh.conversationId, original.conversationId); assert.equal(f.store.get(f.tenant, 'conversations', String(fresh.conversationId))!.status, 'pending');
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, count); assert.equal(f.calls.length, 0);
});

test('only original proof for a different phone excludes a legacy collision; mutable phone fields do not', async t => {
  const f = await whatsappChannelsFixture(t); await enabled(f); await inbound(f, 'wamid.phone-one');
  process.env.META_PHONE_NUMBER_ID = '99999'; await inbound(f, 'wamid.phone-two', sender, '99999');
  const second = f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === 'wamid.phone-two')!;
  assert.equal(f.store.get(f.tenant, 'conversations', String(second.conversationId))!.status, 'open');
  const other = '5511888888888'; f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'closed', externalContact: '+' + other, phoneNumberId: '12345' });
  await inbound(f, 'wamid.unproved-phone', other, '99999'); const blocked = f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === 'wamid.unproved-phone')!;
  assert.equal(f.store.get(f.tenant, 'conversations', String(blocked.conversationId))!.metaIdentityStatus, 'requires_review');
});
