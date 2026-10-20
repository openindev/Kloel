import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { phoneConfigFixture, phone, sid, account } from './fixtures/phone-config.js';
import { createApiKey } from '../src/api-keys/service.js';

test('owned registration uses fixed GET and projects truthful local metadata with opaque receipt', async t => {
  const f = await phoneConfigFixture(t), { row, operation, key, body } = await f.create();
  assert.equal(f.calls.length, 1); const url = new URL(f.calls[0].url);
  assert.equal(url.searchParams.get('PhoneNumber'), phone); assert.equal(url.searchParams.get('PageSize'), '100');
  assert.equal(row.revision, 1); assert.match(row.version, /^[a-f0-9]{64}$/); assert.equal(row.provisioningStatus, 'unverified');
  assert.deepEqual(row.capabilities, ['voice', 'sms']); assert.equal(row.ownership.scope, 'registration');
  const before = f.snapshot(), recovered = await f.request('GET', '/operations/' + key);
  assert.equal(recovered.statusCode, 200); assert.deepEqual(recovered.json(), operation); assert.deepEqual(f.snapshot(), before);
  for (const hidden of [phone, sid, 'Local phone', 'sessionHash', 'fingerprint', 'authorityVersion', 'synthetic-phone-token']) assert.equal(recovered.body.includes(hidden), false, hidden);
  const replay = await f.request('POST', '/numbers', body, key); assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true);
  assert.equal(f.calls.length, 1); assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 1); assert.equal(f.store.list(f.tenant, 'phone-config-audit').length, 1);
});

test('CAS rejects stale PATCH/delete and no-op/ABA never restores the original version', async t => {
  const f = await phoneConfigFixture(t), { row } = await f.create();
  let current = row;
  for (const name of ['B', 'Local phone', 'Local phone']) {
    const result = await f.request('PATCH', '/numbers/' + row.id, f.control(current, { name }), randomUUID()); assert.equal(result.statusCode, 200, result.body);
    const next = (await f.request('GET', '/numbers/' + row.id)).json(); assert.equal(next.revision, current.revision + 1); assert.notEqual(next.version, current.version); current = next;
  }
  const before = f.snapshot();
  for (const method of ['PATCH', 'DELETE'] as const) {
    const result = await f.request(method, '/numbers/' + row.id, f.control(row, method === 'PATCH' ? { name: 'Stale' } : {}), randomUUID());
    assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'phone_configuration_changed');
  }
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1);
});

test('legacy reads are immutable, digest sees out-of-band fields and first local write advances virtual zero', async t => {
  const f = await phoneConfigFixture(t);
  const legacy = f.store.create(f.tenant, 'phone-numbers', { name: 'Legacy', number: phone, provider: 'twilio', capabilities: ['voice'], provisioningStatus: 'unverified', hiddenSecret: 'not-public' });
  const before = f.snapshot(), row = (await f.request('GET', '/numbers/' + legacy.id)).json();
  assert.equal(row.revision, 0); assert.equal(row.ownership, null); assert.equal(JSON.stringify(row).includes('not-public'), false); assert.deepEqual(f.snapshot(), before);
  f.store.update(f.tenant, 'phone-numbers', legacy.id, { hiddenSecret: 'changed', updatedAt: legacy.updatedAt });
  assert.equal((await f.request('PATCH', '/numbers/' + legacy.id, f.control(row, { name: 'Stale' }), randomUUID())).statusCode, 409);
  const latest = (await f.request('GET', '/numbers/' + legacy.id)).json();
  const saved = await f.request('PATCH', '/numbers/' + legacy.id, f.control(latest, { name: 'New' }), randomUUID()); assert.equal(saved.statusCode, 200); assert.equal(saved.json().operation.result.revision, 1); assert.equal(f.calls.length, 0);
});

test('delete receipt and earlier replay survive deletion without recreating the row or repeating proof', async t => {
  const f = await phoneConfigFixture(t), created = await f.create(), key = randomUUID(), body = f.control(created.row);
  const deleted = await f.request('DELETE', '/numbers/' + created.row.id, body, key); assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json().operation.result.deleted, true); assert.equal(deleted.json().operation.result.revision, 2);
  const before = f.snapshot(); assert.equal((await f.request('GET', '/numbers/' + created.row.id)).statusCode, 404);
  assert.deepEqual((await f.request('GET', '/operations/' + key)).json(), deleted.json().operation);
  const again = await f.request('DELETE', '/numbers/' + created.row.id, body, key); assert.equal(again.json().replayed, true);
  const old = await f.request('POST', '/numbers', created.body, created.key); assert.equal(old.json().replayed, true); assert.equal(old.json().operation.result.revision, 1);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1);
});

test('same-key parallel proofs commit once and competing CAS intents permit one winner', async t => {
  const f = await phoneConfigFixture(t), key = randomUUID(), body = f.input();
  const starts = await Promise.all([f.request('POST', '/numbers', body, key), f.request('POST', '/numbers', body, key)]);
  assert.deepEqual(starts.map(r => r.statusCode).sort(), [200, 201]); assert.equal(starts[0].json().operation.numberId, starts[1].json().operation.numberId);
  assert.equal(f.store.list(f.tenant, 'phone-config-operations').length, 1);
  const row = (await f.request('GET', '/numbers/' + starts[0].json().operation.numberId)).json();
  const writes = await Promise.all(['A', 'B'].map(name => f.request('PATCH', '/numbers/' + row.id, f.control(row, { name }), randomUUID())));
  assert.deepEqual(writes.map(r => r.statusCode).sort(), [200, 409]); assert.equal(f.store.list(f.tenant, 'phone-config-operations').length, 2);
});

test('name, complete unlink and deletion work locally without provider environment', async t => {
  const f = await phoneConfigFixture(t), { row } = await f.create({ agentId: f.agent.id, channelId: f.channel.id });
  for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'PROVIDER_TENANT_ID']) delete process.env[key];
  let current = row;
  for (const patch of [{ name: 'Offline rename' }, { agentId: null, channelId: null }]) {
    const res = await f.request('PATCH', '/numbers/' + row.id, f.control(current, patch), randomUUID()); assert.equal(res.statusCode, 200, res.body);
    current = (await f.request('GET', '/numbers/' + row.id)).json();
  }
  assert.equal((await f.request('DELETE', '/numbers/' + row.id, f.control(current), randomUUID())).statusCode, 200);
  assert.equal(f.calls.length, 1);
});

test('routing derives capabilities from proof for legacy sms-only records without trusting input', async t => {
  const f = await phoneConfigFixture(t), legacy = f.store.create(f.tenant, 'phone-numbers', { name: 'SMS legacy', number: phone, provider: 'twilio', providerNumberId: sid, capabilities: ['sms'] });
  const row = (await f.request('GET', '/numbers/' + legacy.id)).json();
  const linked = await f.request('PATCH', '/numbers/' + row.id, f.control(row, { agentId: f.agent.id }), randomUUID()); assert.equal(linked.statusCode, 200, linked.body);
  const current = (await f.request('GET', '/numbers/' + row.id)).json(); assert.deepEqual(current.capabilities, ['voice', 'sms']); assert.equal(current.ownership.scope, 'routing');
  assert.equal((await f.request('PATCH', '/numbers/' + row.id, f.control(current, { capabilities: ['whatsapp'] }), randomUUID())).statusCode, 400);
});

test('strict input and original fingerprint prevent identity, receipt and tenant substitution', async t => {
  const f = await phoneConfigFixture(t), { row, key, body } = await f.create();
  for (const extra of [{ id: 'forged' }, { revision: 22 }, { provider: 'local' }, { capabilities: ['whatsapp'] }, { ownership: {} }, { tenantId: 'foreign' }]) {
    assert.equal((await f.request('POST', '/numbers', f.input(extra), randomUUID())).statusCode, 400);
    assert.equal((await f.request('PATCH', '/numbers/' + row.id, f.control(row, extra), randomUUID())).statusCode, 400);
  }
  assert.equal((await f.request('POST', '/numbers', { ...body, name: 'Altered' }, key)).json().error.code, 'idempotency_conflict');
  assert.equal((await f.request('POST', '/numbers', f.input(), 'unsupported:key')).statusCode, 400);
  assert.equal((await f.request('POST', '/numbers', f.input({ expectedTenantId: 'another' }), randomUUID())).json().error.code, 'tenant_mismatch');
  assert.equal(f.calls.length, 1);
});

test('proof rejects wrong account, SID, number, missing voice, duplicate, paginated and redirect responses', async t => {
  const f = await phoneConfigFixture(t), valid = { sid, account_sid: account, phone_number: phone, capabilities: { voice: true } };
  const answers = [
    { incoming_phone_numbers: [{ ...valid, account_sid: 'AC' + '3'.repeat(32) }], next_page_uri: null },
    { incoming_phone_numbers: [{ ...valid, sid: 'PN' + '3'.repeat(32) }], next_page_uri: null },
    { incoming_phone_numbers: [{ ...valid, phone_number: '+5511999999999' }], next_page_uri: null },
    { incoming_phone_numbers: [{ ...valid, capabilities: { voice: false } }], next_page_uri: null },
    { incoming_phone_numbers: [valid, valid], next_page_uri: null },
    { incoming_phone_numbers: [valid], next_page_uri: 'https://attacker.test' },
  ];
  for (const answer of answers) {
    f.hooks.provider = () => Response.json(answer); const res = await f.request('POST', '/numbers', f.input(), randomUUID()); assert.equal(res.statusCode, 502); assert.equal(res.json().error.code, 'phone_ownership_unconfirmed');
  }
  for (const response of [new Response('', { status: 302, headers: { location: 'https://attacker.test' } }), new Response('x'.repeat(262145)), new Response('not json')]) {
    f.hooks.provider = () => response; assert.equal((await f.request('POST', '/numbers', f.input(), randomUUID())).statusCode, 502);
  }
  assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 0); assert.equal(f.store.list(f.tenant, 'phone-config-operations').length, 0); assert.equal(f.calls.length, 9);
});

test('pagination has a stable upper bound, no secrets, and context/limit-bound authenticated cursors', async t => {
  const f = await phoneConfigFixture(t);
  for (let i = 0; i < 3; i++) f.store.create(f.tenant, 'phone-numbers', { name: 'Legacy ' + i, number: '+551199999000' + i, provider: 'twilio', internalSecret: 'hidden' });
  const before = f.snapshot(), first = await f.request('GET', '/numbers?limit=1'); assert.equal(first.statusCode, 200); assert.equal(first.json().items.length, 1); assert.ok(first.json().nextCursor); assert.equal(first.body.includes('hidden'), false); assert.deepEqual(f.snapshot(), before);
  f.store.create(f.tenant, 'phone-numbers', { name: 'Added later', number: phone, provider: 'twilio' });
  const second = await f.request('GET', '/numbers?limit=1&cursor=' + first.json().nextCursor); assert.equal(second.statusCode, 200); assert.notEqual(second.json().items[0].id, first.json().items[0].id); assert.notEqual(second.json().items[0].name, 'Added later');
  for (const [query, actor] of [['limit=2&cursor=' + first.json().nextCursor, 'owner'], ['limit=1&cursor=' + first.json().nextCursor, 'other'], ['limit=1&cursor=invalid', 'owner']]) assert.equal((await f.request('GET', '/numbers?' + query, undefined, undefined, actor)).statusCode, 400);
  assert.equal(f.calls.length, 0);
});

test('generic writes are explicitly closed; API keys retain allowed CRUD and never gain phone access', async t => {
  const f = await phoneConfigFixture(t), { row } = await f.create();
  for (const [method, path, body] of [
    ['POST', '/api/v1/phone-numbers', { name: 'Bypass', number: phone }],
    ['PATCH', '/api/v1/phone-numbers/' + row.id, { name: 'Bypass' }],
    ['DELETE', '/api/v1/phone-numbers/' + row.id, undefined],
  ] as const) { const r = await f.request(method, path, body); assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'phone_private_route_required'); }
  assert.equal((await f.request('GET', '/api/v1/phone-numbers/' + row.id)).statusCode, 200);
  const created = createApiKey(f.store, f.actors.owner, { name: 'phone compatibility', scopes: ['agents:read'] });
  const bearer = { authorization: 'Bearer ' + created.secret };
  assert.equal((await f.app.inject({ url: '/api/v1/agents', headers: bearer })).statusCode, 200);
  for (const url of ['/api/v1/phone-numbers', '/api/v1/phone-config/numbers', '/api/v1/phone-config/operations/' + randomUUID()]) {
    const result = await f.app.inject({ url, headers: { ...bearer, cookie: 'kloel_session=' + f.cookies.owner } }); assert.equal(result.statusCode, 403, result.body);
  }
  assert.equal(f.calls.length, 1);
});
