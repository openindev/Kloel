import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recipientAttestationFixture } from './fixtures/recipient-attestation.js';

async function approved(f: Awaited<ReturnType<typeof recipientAttestationFixture>>) {
  const body = f.input(await f.context()), r = await f.attest(body); assert.equal(r.statusCode, 200, r.body);
  return { body, operation: r.json().operation };
}
const accepted = (id = 'wamid.attested-' + randomUUID()) => Response.json({ messages: [{ id }] });
const defer = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

test('recipient context separates the delivered original observation from the current reviewed channel', async t => {
  const f = await recipientAttestationFixture(t), c = await f.context();
  assert.equal(c.canAttest, true); assert.equal(c.evidence.complete, true); assert.equal(c.evidence.items.length, 1);
  const e = c.evidence.items[0]; assert.equal(e.evidenceId, f.evidence.id);
  assert.equal(e.currentChannelRevision, 3); assert.notEqual(e.observedChannelVersion, e.currentChannelVersion);
  assert.equal(c.origin.provenance, 'signed_inbound'); assert.equal(e.destination.provenance, 'meta_send_response_contact');
  assert.equal(f.calls.length, 0);
});

test('one explicit decision sends only the observed input, links the same new conversation, preserves history and is consumed once', async t => {
  const f = await recipientAttestationFixture(t), historical = JSON.stringify(f.store.list(f.tenant, 'messages').filter(r => r.conversationId === f.legacy.id));
  const { body, operation } = await approved(f);
  const exact = await f.replyContext(); assert.equal(exact.json().destination.provenance, 'signed_inbound');
  const selected = await f.replyContext(operation.id); assert.equal(selected.json().canReply, true, selected.body); assert.equal(selected.json().destination.provenance, 'operator_attested');
  f.hooks.provider = (_url, init) => { const payload = JSON.parse(String(init.body)); assert.equal(payload.to, f.destination.slice(1)); assert.equal(payload.context.message_id, f.source.providerMessageId); return accepted(); };
  const input = f.replyInput(selected.json(), operation.id), r = await f.reply(input); assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().operation.localLink, 'linked'); assert.equal(r.json().operation.externalEffect, 'accepted');
  const message = f.store.get(f.tenant, 'messages', r.json().operation.messageId)!;
  assert.equal(message.conversationId, f.conversationId); assert.equal(message.authorType, 'human'); assert.equal(message.recipient, f.destination);
  assert.equal(f.current().externalContact, '+' + f.sender); assert.equal(f.current().metaIdentityPolicy, 'manual_only');
  assert.equal(JSON.stringify(f.store.list(f.tenant, 'messages').filter(r => r.conversationId === f.legacy.id)), historical);
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.calls.length, 1);
  assert.equal((await f.reply(input)).json().replayed, true); assert.equal(f.calls.length, 1);
  assert.equal((await f.operation(body.key)).json().consumedByReplyKey, input.idempotencyKey);
  const second = await f.replyContext(operation.id); assert.equal(second.json().reasonCode, 'attestation_consumed');
  const denied = await f.reply(f.replyInput(second.json(), operation.id)); assert.equal(denied.statusCode, 409); assert.equal(denied.json().error.code, 'whatsapp_reply_not_admitted'); assert.equal(f.calls.length, 1);
});

test('receipt replay remains historical after the current channel, proof and conversation disappear', async t => {
  const f = await recipientAttestationFixture(t), { body, operation } = await approved(f);
  f.store.remove(f.tenant, 'conversations', f.conversationId); f.store.remove(f.tenant, 'channels', f.channel.id); f.store.remove(f.tenant, 'whatsapp-operations', f.evidence.id);
  const read = await f.operation(body.key); assert.equal(read.statusCode, 200); assert.deepEqual(read.json(), operation);
  const replay = await f.attest(body); assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().replayed, true);
  assert.equal(f.calls.length, 0); assert.equal(f.store.list(f.tenant, 'whatsapp-recipient-attestations').length, 1);
});

test('original cookie/member authority is required for historical receipt, replay and consumption', async t => {
  const f = await recipientAttestationFixture(t), { body, operation } = await approved(f);
  for (const who of ['other', 'foreign']) { assert.equal((await f.operation(body.key, who)).statusCode, 404); assert.equal((await f.replyContext(operation.id, who)).statusCode === 404 || (await f.replyContext(operation.id, who)).json().canReply === false, true); }
  assert.equal((await f.attest(body, 'other')).statusCode, 409);
  f.aba(); await f.refreshContext(); assert.equal((await f.operation(body.key)).statusCode, 404); assert.equal((await f.attest(body)).statusCode, 409);
  assert.equal((await f.replyContext(operation.id)).json().reasonCode, 'attestation_unavailable'); assert.equal(f.calls.length, 0);
});

test('read permission masks evidence; write requires manage and all four browser context headers', async t => {
  const f = await recipientAttestationFixture(t), c = await f.context(), body = f.input(c);
  assert.equal((await f.contextResponse('editor')).json().canAttest, false); assert.equal((await f.attest(body, 'editor')).statusCode, 403);
  const missing = await f.app.inject({ method: 'POST', url: '/api/v1/whatsapp/conversations/' + f.conversationId + '/recipient-attestations', headers: { cookie: 'kloel_session=' + f.cookies.owner }, payload: body });
  assert.equal(missing.statusCode, 400); assert.equal(missing.json().error.code, 'expected_context_required');
  assert.equal((await f.attest({ ...body, to: f.destination })).statusCode, 400);
  assert.equal((await f.attest({ ...body, expectedTenantId: 'another' })).statusCode, 409);
  const text = JSON.stringify(c); for (const secret of [f.sender, f.destination, f.wamid, f.env.META_ACCESS_TOKEN, f.env.META_APP_SECRET, 'Synthetic original manual send']) assert.equal(text.includes(secret), false);
  assert.equal(f.store.list(f.tenant, 'whatsapp-recipient-attestations').length, 0);
});

test('CAS and current channel snapshot are checked before registration and before consumption', async t => {
  const f = await recipientAttestationFixture(t), old = await f.context();
  await f.control({ status: 'open' }); await f.control({ status: 'pending' });
  const denied = await f.attest(f.input(old)); assert.equal(denied.statusCode, 409); assert.equal(denied.json().error.code, 'recipient_attestation_not_admitted');
  const { operation } = await approved(f), current = await f.replyContext(operation.id);
  await f.change(f.currentChannel, 'update', { name: 'Changed again' });
  const refused = await f.reply(f.replyInput(current.json(), operation.id)); assert.equal(refused.statusCode, 409); assert.equal(refused.json().error.code, 'whatsapp_reply_not_admitted');
  assert.equal(f.store.list(f.tenant, 'whatsapp-conversation-replies').length, 0); assert.equal(f.calls.length, 0);
});

for (const [name, mutate] of [
  ['response kind', (f: any, c: any) => ({ ...c, kind: 'synthetic_contact' })],
  ['response version', (f: any, c: any) => ({ ...c, version: 2 })],
  ['requested destination', (f: any, c: any) => ({ ...c, requestedDestination: '+' + f.sender })],
  ['input does not match requested destination', (f: any, c: any) => ({ ...c, input: f.sender })],
  ['wa id differs from signed inbound', (f: any, c: any) => ({ ...c, waId: '5511777777777' })],
  ['owner identity', (f: any, c: any) => ({ ...c, ownerId: randomUUID() })],
  ['old channel observation substituted for current', (f: any, c: any) => ({ ...c, channelVersion: f.currentChannel.version })],
  ['different phone', (f: any, c: any) => ({ ...c, phoneNumberId: '99999' })],
  ['expired observation', (f: any, c: any) => ({ ...c, observedAt: new Date(Date.now() - 86400001).toISOString() })],
  ['future observation', (f: any, c: any) => ({ ...c, observedAt: new Date(Date.now() + 120000).toISOString() })],
] as const) test('rejects invalid historical contact proof: ' + name, async t => {
  const f = await recipientAttestationFixture(t), c = await f.context(); f.store.update(f.tenant, 'whatsapp-operations', f.evidence.id, { recipientIdentity: mutate(f, f.evidence.recipientIdentity) });
  assert.equal((await f.context()).canAttest, false); const r = await f.attest(f.input(c)); assert.equal(r.statusCode, 409); assert.equal(f.calls.length, 0);
});

test('delivery proof requires signed exact phone/wamid and unique original outbound binding; local status is insufficient', async t => {
  const f = await recipientAttestationFixture(t), original = await f.context();
  const delivery = f.store.list(f.tenant, 'provider-events').find(r => r.deliveryEvidenceVersion === 1)!;
  f.store.update(f.tenant, 'provider-events', delivery.id, { phoneNumberId: '54321' }); assert.equal((await f.context()).canAttest, false);
  f.store.update(f.tenant, 'provider-events', delivery.id, { phoneNumberId: '12345' });
  const message = f.store.list(f.tenant, 'messages').find(m => m.providerMessageId === f.wamid)!;
  f.store.update(f.tenant, 'messages', message.id, { phoneNumberId: null }); assert.equal((await f.context()).canAttest, false);
  f.store.update(f.tenant, 'messages', message.id, { phoneNumberId: '12345' });
  f.store.create(f.tenant, 'whatsapp-operations', { ...f.evidence, id: undefined });
  assert.equal((await f.context()).canAttest, false); assert.equal((await f.attest(f.input(original))).statusCode, 409); assert.equal(f.calls.length, 0);
});

test('new signed inbound and valid human review remain necessary; historical observation cannot backfill either', async t => {
  const f = await recipientAttestationFixture(t), old = await f.context(), proofs = f.store.list(f.tenant, 'provider-events').filter(r => r.messageId === f.source.id);
  f.store.remove(f.tenant, 'provider-events', proofs[0].id); assert.equal((await f.context()).canAttest, false);
  assert.equal((await f.attest(f.input(old))).statusCode, 409); assert.equal(f.store.list(f.tenant, 'whatsapp-recipient-attestations').length, 0); assert.equal(f.calls.length, 0);
});

test('unknown attested reply blocks legacy sends to both original spellings and never falls back', async t => {
  const f = await recipientAttestationFixture(t), { operation } = await approved(f), c = await f.replyContext(operation.id);
  f.hooks.provider = () => { throw Error('Synthetic lost transport'); };
  const input = f.replyInput(c.json(), operation.id), r = await f.reply(input); assert.equal(r.statusCode, 500);
  for (const to of [f.destination, '+' + f.sender]) { const legacy = await f.request('POST', '/send', { to, channelId: f.channel.id, idempotencyKey: randomUUID(), text: 'Must not dispatch' }); assert.equal(legacy.statusCode, 409); assert.equal(legacy.json().error.code, 'recipient_requires_reconciliation'); }
  const receipt = await f.request('GET', '/conversations/' + f.conversationId + '/reply-operations/' + input.idempotencyKey); assert.equal(receipt.json().status, 'unknown');
  assert.equal((await f.reply(input)).json().replayed, true); assert.equal(f.calls.length, 1);
});

for (const origin of [true, false]) test('legacy template pending blocks attested reservation for ' + (origin ? 'signed from' : 'observed input'), async t => {
  const f = await recipientAttestationFixture(t), { operation } = await approved(f), c = await f.replyContext(operation.id);
  process.env.META_WABA_ID = '7777'; t.after(() => { delete process.env.META_WABA_ID; });
  const entered = defer<void>(), release = defer<Response>();
  f.hooks.provider = () => { entered.resolve(); return release.promise; };
  const pending = f.request('POST', '/templates/send', { to: origin ? '+' + f.sender : f.destination, channelId: f.channel.id, idempotencyKey: randomUUID(), name: 'hello_world', language: 'en_US', bodyParameters: [] });
  const executing = pending.then(r => r); await entered.promise;
  const denied = await f.reply(f.replyInput(c.json(), operation.id)); assert.equal(denied.statusCode, 409); assert.equal(denied.json().error.code, 'whatsapp_reply_not_admitted');
  release.resolve(Response.json({ data: [] })); await executing;
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 0);
});

test('two simultaneous human keys consume only once while provider is pending; bilateral admission sees reservation', async t => {
  const f = await recipientAttestationFixture(t), { operation } = await approved(f), c = await f.replyContext(operation.id), entered = defer<void>(), release = defer<Response>();
  f.hooks.provider = () => { entered.resolve(); return release.promise; };
  const input = f.replyInput(c.json(), operation.id), pending = f.reply(input).then(r => r); await entered.promise;
  assert.equal((await f.reply(f.replyInput(c.json(), operation.id))).statusCode, 409);
  for (const to of [f.destination, '+' + f.sender]) assert.equal((await f.request('POST', '/send', { to, channelId: f.channel.id, idempotencyKey: randomUUID(), text: 'Concurrent' })).statusCode, 409);
  release.resolve(accepted()); assert.equal((await pending).statusCode, 200); assert.equal(f.calls.length, 1);
});

test('accepted response is durable before late authority denial; consumption remains closed and GET never sends', async t => {
  const f = await recipientAttestationFixture(t), { body, operation } = await approved(f), c = await f.replyContext(operation.id);
  f.hooks.provider = () => { f.aba(); return accepted(); };
  const input = f.replyInput(c.json(), operation.id), r = await f.reply(input); assert.equal(r.statusCode, 409);
  const row = f.store.list(f.tenant, 'whatsapp-conversation-replies')[0]; assert.equal(row.status, 'succeeded'); assert.equal(row.localLink, 'not_linked');
  assert.equal(f.store.get(f.tenant, 'whatsapp-recipient-attestations', operation.id)?.consumedByReplyKey, input.idempotencyKey);
  await f.refreshContext(); assert.equal((await f.operation(body.key)).statusCode, 404); assert.equal((await f.attest(body)).statusCode, 409); assert.equal(f.calls.length, 1);
});

test('post-accept channel change preserves accepted original reply; recovery survives offline configuration', async t => {
  const f = await recipientAttestationFixture(t), { operation } = await approved(f), c = await f.replyContext(operation.id);
  f.hooks.provider = () => { f.store.update(f.tenant, 'channels', f.channel.id, { enabled: false, revision: 4 }); return accepted(); };
  const input = f.replyInput(c.json(), operation.id), r = await f.reply(input); assert.equal(r.statusCode, 409);
  delete process.env.META_ACCESS_TOKEN;
  const read = await f.request('GET', '/conversations/' + f.conversationId + '/reply-operations/' + input.idempotencyKey);
  assert.equal(read.statusCode, 200); assert.equal(read.json().externalEffect, 'accepted'); assert.equal(read.json().localLink, 'not_linked'); assert.equal(read.json().requiresReconciliation, true);
  assert.equal((await f.reply(input)).json().replayed, true); assert.equal(f.calls.length, 1);
});

test('no selection retains exact signed destination and legacy recipient equality is never relaxed', async t => {
  const f = await recipientAttestationFixture(t); await approved(f);
  const mismatch = await f.request('POST', '/send', { to: f.destination, conversationId: f.conversationId, channelId: f.channel.id, idempotencyKey: randomUUID(), text: 'Cannot merge' });
  assert.equal(mismatch.statusCode, 409); assert.equal(mismatch.json().error.code, 'recipient_mismatch');
  const c = await f.replyContext(); f.hooks.provider = (_url, init) => { assert.equal(JSON.parse(String(init.body)).to, f.sender); return accepted(); };
  assert.equal((await f.reply(f.replyInput(c.json()))).statusCode, 200); assert.equal(f.calls.length, 1);
});

test('a later delivery read does not invalidate the selected original proof or silently replace its snapshot', async t => {
  const f = await recipientAttestationFixture(t), { operation } = await approved(f); await f.delivery('read');
  const c = await f.replyContext(operation.id); assert.equal(c.json().canReply, true, c.body); assert.equal(f.calls.length, 0);
});

test('registration loses its HTTP envelope after commit but original GET/replay recovers without writes', async t => {
  const f = await recipientAttestationFixture(t), input = f.input(await f.context()), r = await f.attest(input); assert.equal(r.statusCode, 200);
  // Deliberately discard the successful HTTP response, as a transport can do.
  const snapshot = JSON.stringify(f.snapshot()), recovered = await f.operation(input.key); assert.equal(recovered.statusCode, 200);
  assert.equal((await f.attest(input)).json().replayed, true); assert.equal(JSON.stringify(f.snapshot()), snapshot); assert.equal(f.calls.length, 0);
});

test('late authority change inside decision transaction rolls back receipt and audit', async t => {
  const f = await recipientAttestationFixture(t), input = f.input(await f.context()), create = f.store.create.bind(f.store); let changed = false;
  f.store.create = ((tenant: any, collection: any, body: any) => { const r = create(tenant, collection, body); if (collection === 'whatsapp-recipient-attestation-audits') { changed = true; f.aba(); } return r; }) as typeof f.store.create;
  const r = await f.attest(input); assert.equal(changed, true); assert.equal(r.statusCode, 409);
  assert.equal(f.store.list(f.tenant, 'whatsapp-recipient-attestations').length, 0); assert.equal(f.store.list(f.tenant, 'whatsapp-recipient-attestation-audits').length, 0); assert.equal(f.calls.length, 0);
});

test('failed consumption transaction restores the unused decision and sends nothing', async t => {
  const f = await recipientAttestationFixture(t), { operation } = await approved(f), c = await f.replyContext(operation.id), update = f.store.update.bind(f.store); let changed = false;
  f.store.update = ((tenant: any, collection: any, id: any, body: any) => { const r = update(tenant, collection, id, body); if (collection === 'whatsapp-recipient-attestations' && body.consumedByReplyId) { changed = true; throw Error('Synthetic transactional storage failure'); } return r; }) as typeof f.store.update;
  const r = await f.reply(f.replyInput(c.json(), operation.id)); assert.equal(r.statusCode, 500); assert.equal(changed, true);
  assert.equal(f.store.get(f.tenant, 'whatsapp-recipient-attestations', operation.id)?.consumedByReplyId, null); assert.equal(f.store.list(f.tenant, 'whatsapp-conversation-replies').length, 0); assert.equal(f.calls.length, 0);
});

test('definitive rejection consumes the one-use decision but never authorizes fallback or second key', async t => {
  const f = await recipientAttestationFixture(t), { operation } = await approved(f), c = await f.replyContext(operation.id);
  f.hooks.provider = () => Response.json({ error: { code: 131030, message: 'Private remote explanation' } }, { status: 400 });
  const input = f.replyInput(c.json(), operation.id), r = await f.reply(input); assert.equal(r.statusCode, 502);
  assert.equal(f.store.list(f.tenant, 'whatsapp-conversation-replies')[0].status, 'failed'); assert.equal((await f.replyContext(operation.id)).json().reasonCode, 'attestation_consumed');
  assert.equal((await f.reply({ ...input, idempotencyKey: randomUUID() })).statusCode, 409); assert.equal(f.calls.length, 1);
});

test('new signed input or changed collision makes an unused decision stale, without modifying old receipt', async t => {
  const f = await recipientAttestationFixture(t), { body, operation } = await approved(f);
  await f.inbound(); assert.equal((await f.replyContext(operation.id)).json().reasonCode, 'attestation_stale');
  assert.deepEqual((await f.operation(body.key)).json(), operation); assert.equal(f.calls.length, 0);
});

test('active and uncertain jobs for either spelling prevent attestation and consumption', async t => {
  const f = await recipientAttestationFixture(t), { operation } = await approved(f), c = await f.replyContext(operation.id);
  for (const recipient of [f.destination, '+' + f.sender]) {
    const job = f.store.create(f.tenant, 'reply-jobs', { provider: 'meta', status: 'requires_reconciliation', recipient, conversationId: randomUUID(), channelSnapshot: { phoneNumberId: '12345' } });
    assert.equal((await f.context()).reasonCode, 'send_requires_reconciliation'); assert.equal((await f.reply(f.replyInput(c.json(), operation.id))).statusCode, 409);
    f.store.remove(f.tenant, 'reply-jobs', job.id);
  }
  assert.equal(f.calls.length, 0);
});

test('evidence list is bounded and incomplete history cannot be selectively approved', async t => {
  const f = await recipientAttestationFixture(t), c = await f.context();
  for (let i = 0; i < 50; i++) f.store.create(f.tenant, 'whatsapp-operations', { channelId: f.channel.id, phoneNumberId: '12345', recipientIdentity: { waId: f.sender } });
  const read = await f.context(); assert.equal(read.evidence.complete, false); assert.equal(read.canAttest, false); assert.equal(read.reasonCode, 'evidence_incomplete'); assert.equal(read.evidence.items.length <= 20, true);
  assert.equal((await f.attest(f.input(c))).statusCode, 409); assert.equal(f.calls.length, 0);
});

test('two distinct attestations of one snapshot do not authorize concurrent effects or retarget an older receipt', async t => {
  const f = await recipientAttestationFixture(t), a = await approved(f), b = await approved(f);
  const ca = await f.replyContext(a.operation.id), cb = await f.replyContext(b.operation.id), entered = defer<void>(), release = defer<Response>();
  f.hooks.provider = () => { entered.resolve(); return release.promise; };
  const input = f.replyInput(ca.json(), a.operation.id), pending = f.reply(input).then(r => r); await entered.promise;
  const denied = await f.reply(f.replyInput(cb.json(), b.operation.id)); assert.equal(denied.statusCode, 409);
  assert.equal((await f.operation(b.body.key)).json().consumedByReplyKey, null);
  release.resolve(accepted()); assert.equal((await pending).statusCode, 200);
  assert.equal((await f.replyContext(b.operation.id)).json().reasonCode, 'attestation_stale'); assert.equal(f.calls.length, 1);
  assert.equal((await f.operation(a.body.key)).json().consumedByReplyKey, input.idempotencyKey);
});
