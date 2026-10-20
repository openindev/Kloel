import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { digest } from '../src/oauth/crypto.js';
import { currentActor, type Actor } from '../src/oauth/access.js';
import { seedMember } from './fixtures/membership.js';
import { airtableBindings, airtableOperations, configureAirtableTable, listAirtableFields, readAirtableRecords, createAirtableRecord, registerAirtableRoutes, airtableAgentTools, executeAgentAirtable, type AirtableAccess } from '../src/integrations/airtable.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';

const baseId = 'app12345678901234', tableId = 'tbl12345678901234', token = 'fixture-airtable-secret-token';
const fld = (n: number) => 'fld' + String(n).padStart(14, '0');
const schema = [
  { id: fld(1), name: 'Name', type: 'singleLineText' }, { id: fld(2), name: 'Count', type: 'number' },
  { id: fld(3), name: 'Flag', type: 'checkbox' }, { id: fld(4), name: 'Date', type: 'date' },
  { id: fld(5), name: 'Email', type: 'email' }, { id: fld(6), name: 'Choice', type: 'singleSelect', options: { choices: [{ id: 'sel1', name: 'Ready' }] } },
  { id: fld(7), name: 'Computed', type: 'formula' }, { id: fld(8), name: 'Private excluded', type: 'singleLineText' },
];
const record = (fields: Record<string, unknown> = {}) => ({ id: 'rec12345678901234', createdTime: '2026-10-18T09:00:00.000Z', fields });
const response = (data: unknown, status = 200) => ({ status, headers: {}, body: Buffer.from(JSON.stringify(data)) });
const metadata = () => response({ tables: [{ id: tableId, fields: schema }, { id: 'tbl99999999999999', fields: [{ id: fld(9), name: 'Other private', type: 'singleLineText' }] }] });
const network = (fn: NonNullable<IntegrationTransport['request']>): IntegrationTransport => ({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: fn });
const input = (extra = {}) => ({ name: 'Fixture Airtable', baseId, tableId, token, fieldIds: schema.slice(0, 7).map(f => f.id), allowCreate: true, ...extra });
function fixture(t: TestContext) {
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), actor: Actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' }; seedMember(store, actor); t.after(() => store.close());
  const access: AirtableAccess = { actor, assertLive: () => { currentActor(store, actor); } };
  return { store, actor, access };
}

test('Airtable config encrypts token, pins IDs, enforces CAS and selects only authorized schema', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input());
  assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId, airtableBindings)).includes(token));
  assert.ok(!JSON.stringify(binding).includes(token));
  assert.throws(() => configureAirtableTable(f.store, f.actor, input({ url: 'https://evil.test' })));
  assert.throws(() => configureAirtableTable(f.store, f.actor, input(), binding.id, 8), (e: any) => e.code === 'airtable_configuration_changed');
  const result = await listAirtableFields(f.store, f.access, binding.id, network(async (url, _addr, spec) => {
    assert.equal(url.href, `https://api.airtable.com/v0/meta/bases/${baseId}/tables`); assert.equal(spec.headers.authorization, `Bearer ${token}`); return metadata();
  }));
  assert.equal(result.items.length, 7); assert.ok(!JSON.stringify(result).includes('Private'));
  assert.equal(f.store.get(f.actor.tenantId, airtableBindings, binding.id)!.lastReadRevision, 1);
});

test('Airtable query encodes filters and fields, filters surplus data, seals pagination to actor/binding/query', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input()); let calls = 0;
  const query = { size: 2, filters: [{ fieldId: fld(1), operator: 'equal', value: 'Alice "}),TRUE(),({' }], sort: [{ fieldId: fld(2), direction: 'desc' }] };
  const net = network(async (url, _addr, spec) => {
    calls++; assert.equal(spec.method, 'GET'); assert.equal(url.hostname, 'api.airtable.com');
    assert.equal(url.searchParams.get('filterByFormula'), `AND({${fld(1)}}=${JSON.stringify(query.filters[0].value)})`);
    assert.equal(url.searchParams.get('sort[0][field]'), fld(2)); assert.equal(url.searchParams.get('returnFieldsByFieldId'), 'true'); assert.equal(url.searchParams.getAll('fields[]').length, 7);
    if (calls === 2) assert.equal(url.searchParams.get('offset'), 'remote/opaque-offset');
    return response({ records: [record({ [fld(1)]: token, [fld(2)]: { [token]: { nested: token } }, [fld(8)]: 'Private data' })], offset: 'remote/opaque-offset' });
  });
  const first = await readAirtableRecords(f.store, f.access, binding.id, query, net); assert.ok(first.nextCursor); assert.equal(first.items[0].fields[fld(1)], '[redacted]'); assert.ok(!JSON.stringify(first).includes('Private data')); assert.ok(!JSON.stringify(first).includes(token)); assert.deepEqual(first.items[0].fields[fld(2)], { '[redacted]': { nested: '[redacted]' } }); assert.ok(!first.nextCursor!.includes('opaque-offset'));
  await readAirtableRecords(f.store, f.access, binding.id, { ...query, cursor: first.nextCursor }, net);
  await assert.rejects(readAirtableRecords(f.store, f.access, binding.id, { ...query, size: 3, cursor: first.nextCursor }, net), (e: any) => e.code === 'invalid_airtable_cursor');
  await assert.rejects(readAirtableRecords(f.store, f.access, binding.id, { offset: 'external' }, net));
  await assert.rejects(readAirtableRecords(f.store, f.access, binding.id, { filters: [{ fieldId: fld(8), operator: 'equal', value: 'secret' }] }, net), (e: any) => e.code === 'airtable_field_not_authorized');
  const other = { ...f.actor, userId: randomUUID() }; seedMember(f.store, other);
  await assert.rejects(readAirtableRecords(f.store, { actor: other, assertLive: () => {} }, binding.id, { ...query, cursor: first.nextCursor }, net), (e: any) => e.code === 'invalid_airtable_cursor');
  assert.equal(calls, 2);
});

test('Airtable typed create persists encrypted idempotent receipt and rejects conflicting repeats', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input()); let reads = 0, writes = 0;
  const values = { [fld(1)]: 'Private Alice', [fld(2)]: 0, [fld(3)]: false, [fld(4)]: '2026-10-18', [fld(5)]: 'test@example.test', [fld(6)]: 'Ready' };
  const net = network(async (url, _addr, spec) => { if (spec.method === 'GET') { reads++; return metadata(); } writes++; assert.equal(url.pathname, `/v0/${baseId}/${tableId}`); assert.deepEqual(JSON.parse(spec.body!.toString()), { records: [{ fields: values }], typecast: false, returnFieldsByFieldId: true }); return response({ records: [record(values)] }); });
  const first: any = await createAirtableRecord(f.store, f.access, binding.id, { values }, 'one', net);
  assert.equal(first.ok, true); assert.equal(first.operation.status, 'created');
  assert.deepEqual(await createAirtableRecord(f.store, f.access, binding.id, { values }, 'one', net), first); assert.equal(reads, 1); assert.equal(writes, 1);
  assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId, airtableOperations)).includes('Private Alice'));
  await assert.rejects(createAirtableRecord(f.store, f.access, binding.id, { values: { [fld(1)]: 'Other' } }, 'one', net), (e: any) => e.code === 'idempotency_conflict');
});

test('Airtable rejects invalid, computed, unselected and newly invented choice values before any write', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input()); let writes = 0;
  const net = network(async (_url, _addr, spec) => { if (spec.method !== 'GET') writes++; return metadata(); });
  for (const values of [{}, { Name: 'x' }, { [fld(8)]: 'x' }, { [fld(7)]: 'x' }, { [fld(2)]: '12' }, { [fld(3)]: 'true' }, { [fld(4)]: '2026-02-31' }, { [fld(5)]: 'bad' }, { [fld(6)]: 'New choice' }]) await assert.rejects(createAirtableRecord(f.store, f.access, binding.id, { values }, randomUUID(), net), (e: any) => e.statusCode === 400);
  assert.equal(writes, 0); assert.equal(f.store.list(f.actor.tenantId, airtableOperations).length, 0);
});

test('Airtable concurrent same-key writes and timeout never duplicate remote creation', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input()); let writes = 0, release: (r: ReturnType<typeof response>) => void = () => {};
  const args = { values: { [fld(1)]: 'x' } };
  const net = network(async (_url, _addr, spec) => { if (spec.method === 'GET') return metadata(); writes++; return new Promise(resolve => { release = resolve; }); });
  const first = createAirtableRecord(f.store, f.access, binding.id, args, 'pending', net); await new Promise(resolve => setImmediate(resolve));
  const second: any = await createAirtableRecord(f.store, f.access, binding.id, args, 'pending', net); assert.equal(second.operation.status, 'pending'); release(response({ records: [record()] })); await first; assert.equal(writes, 1);
  const uncertain = network(async (_url, _addr, spec) => { if (spec.method === 'GET') return metadata(); writes++; throw new Error('secret network payload'); });
  const result: any = await createAirtableRecord(f.store, f.access, binding.id, args, 'timeout', uncertain); assert.equal(result.operation.status, 'uncertain'); assert.ok(!JSON.stringify(result).includes('secret network'));
  await createAirtableRecord(f.store, f.access, binding.id, args, 'timeout', uncertain); assert.equal(writes, 2);
});

test('Airtable records definitive rejection separately from malformed, partial and 5xx uncertainty', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input());
  for (const [status, data, expected] of [[401, {}, 'rejected'], [429, {}, 'rejected'], [500, {}, 'uncertain'], [200, {}, 'uncertain'], [200, { records: [record()], details: { message: 'partialSuccess' } }, 'uncertain']] as const) {
    const result: any = await createAirtableRecord(f.store, f.access, binding.id, { values: { [fld(1)]: 'x' } }, randomUUID(), network(async (_u, _a, spec) => spec.method === 'GET' ? metadata() : response(data, status)));
    assert.equal(result.operation.status, expected); assert.equal(result.ok, false);
  }
});

test('Airtable blocks redirects including self redirect after write without resending', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input()); let writes = 0;
  for (const location of [`/v0/${baseId}/${tableId}`, '/v0/app99999999999999/tbl99999999999999', 'https://evil.example.com/']) {
    const result: any = await createAirtableRecord(f.store, f.access, binding.id, { values: { [fld(1)]: 'x' } }, randomUUID(), network(async (_u, _a, spec) => {
      if (spec.method === 'GET') return metadata(); writes++; return { status: 307, headers: { location }, body: Buffer.alloc(0) };
    })); assert.equal(result.operation.status, 'uncertain');
  }
  assert.equal(writes, 3);
});

test('Airtable invalid DNS, oversize data and absent metadata are refused', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input()); let calls = 0;
  await assert.rejects(listAirtableFields(f.store, f.access, binding.id, { resolve: async () => [{ address: '127.0.0.1', family: 4 }], request: async () => { calls++; return metadata(); } }), (e: any) => e.code === 'unsafe_destination'); assert.equal(calls, 0);
  await assert.rejects(listAirtableFields(f.store, f.access, binding.id, network(async () => ({ status: 200, headers: {}, body: Buffer.alloc(65537) }))), (e: any) => e.code === 'response_limit_exceeded');
  await assert.rejects(listAirtableFields(f.store, f.access, binding.id, network(async () => response({ tables: [] }))), (e: any) => e.code === 'airtable_schema_changed');
});

test('Airtable rechecks role/session/config after DNS and after remote response, preserving remote receipt', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input()); let active = true, writes = 0;
  const access = { actor: f.actor, assertLive: () => { if (!active) throw new Error('revoked'); } };
  await assert.rejects(listAirtableFields(f.store, access, binding.id, { resolve: async () => { active = false; return [{ address: '93.184.216.34', family: 4 }]; }, request: async () => { writes++; return metadata(); } })); assert.equal(writes, 0);
  active = true;
  await assert.rejects(createAirtableRecord(f.store, access, binding.id, { values: { [fld(1)]: 'x' } }, 'revoke-write', network(async (_u, _a, spec) => { if (spec.method === 'GET') return metadata(); writes++; active = false; return response({ records: [record()] }); })));
  assert.equal(writes, 1); assert.equal(f.store.list(f.actor.tenantId, airtableOperations)[0].status, 'created');
  active = true;
  await assert.rejects(readAirtableRecords(f.store, access, binding.id, {}, network(async () => { f.store.update(f.actor.tenantId, airtableBindings, binding.id, { enabled: false }); return response({ records: [record()] }); })), (e: any) => e.code === 'airtable_binding_disabled');
});

test('Airtable tenant isolation, role changes and disabled bindings apply to reads and cached writes', async t => {
  const f = fixture(t), binding = configureAirtableTable(f.store, f.actor, input());
  const foreign = { ...f.actor, userId: randomUUID(), tenantId: randomUUID() }; seedMember(f.store, foreign);
  await assert.rejects(listAirtableFields(f.store, { actor: foreign, assertLive: () => {} }, binding.id), (e: any) => e.code === 'airtable_binding_not_found');
  const args = { values: { [fld(1)]: 'x' } }, net = network(async (_u, _a, spec) => spec.method === 'GET' ? metadata() : response({ records: [record()] }));
  await createAirtableRecord(f.store, f.access, binding.id, args, 'cached', net);
  f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(f.actor.userId);
  await assert.rejects(createAirtableRecord(f.store, f.access, binding.id, args, 'cached', net), (e: any) => e.code === 'airtable_not_authorized');
});

test('Airtable native HTTP routes require human session and preserve real errors without secrets', async () => {
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), actor: Actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const app = Fastify(); await app.register(cookie); app.addHook('onRequest', async req => { req.actor = actor; });
  const token = randomUUID(); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(token), actor.userId, actor.tenantId, Date.now() + 60000);
  await registerAirtableRoutes(app, store, network(async (_u, _a, spec) => spec.method === 'GET' ? metadata() : response({ records: [record()] })));
  try {
    assert.equal((await app.inject('/api/v1/integrations/airtable/tables')).statusCode, 401);
    const headers = { cookie: `kloel_session=${token}` }, created = await app.inject({ method: 'POST', url: '/api/v1/integrations/airtable/tables', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { expectedTenantId: actor.tenantId, configuration: input() } }); assert.equal(created.statusCode, 201); assert.ok(!created.body.includes('fixture-airtable-secret-token'));
    const prefix = `/api/v1/integrations/airtable/tables/${created.json().operation.bindingId}`;
    assert.equal((await app.inject({ method: 'GET', url: `${prefix}/fields`, headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `${prefix}/records`, headers, payload: { values: { [fld(1)]: 'x' } } })).statusCode, 400);
    const sent = await app.inject({ method: 'POST', url: `${prefix}/records`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { expectedTenantId: actor.tenantId, expectedRevision: 1, values: { [fld(1)]: 'x' } } }); assert.equal(sent.json().operation.status, 'created');
    store.db.prepare('DELETE FROM sessions').run(); assert.equal((await app.inject({ method: 'GET', url: `${prefix}/fields`, headers })).statusCode, 401);
  } finally { await app.close(); store.close(); }
});

test('Airtable agent tools need assigned current agent and live server authority at every request', async t => {
  const f = fixture(t), agent = f.store.create(f.actor.tenantId, 'agents', { name: 'Reader', status: 'active' });
  const binding = configureAirtableTable(f.store, f.actor, input({ agentIds: [agent.id] })); let live = true;
  const ctx = { tenantId: f.actor.tenantId, agent, actor: f.actor, assertLive: () => { if (!live) throw new Error('revoked'); } };
  assert.equal(airtableAgentTools(f.store, ctx).length, 3); live = false; assert.equal(airtableAgentTools(f.store, ctx).length, 0); live = true;
  let calls = 0;
  await assert.rejects(executeAgentAirtable(f.store, ctx, binding.id, 'read', {}, 'test', network(async () => { calls++; f.store.update(f.actor.tenantId, airtableBindings, binding.id, { agentIds: [] }); return response({ records: [record()] }); })), (e: any) => e.code === 'action_not_assigned'); assert.equal(calls, 1);
});


test('Airtable pending receipts survive SQLite restart without retrying an attempted write', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const dir = mkdtempSync(join(tmpdir(), 'kloel-airtable-test-')), path = join(dir, 'test.sqlite');
  let store = new Store(path); const actor: Actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const access = { actor, assertLive: () => { currentActor(store, actor); } }, binding = configureAirtableTable(store, actor, input());
  const args = { values: { [fld(1)]: 'x' } }; let writes = 0;
  try {
    const net = network(async (_u, _a, spec) => { if (spec.method === 'GET') return metadata(); writes++; throw new Error('lost response'); });
    const result: any = await createAirtableRecord(store, access, binding.id, args, 'restart-key', net); assert.equal(result.operation.status, 'uncertain');
    // Emulate crash after attempting delivery but before recording a final outcome.
    store.update(actor.tenantId, airtableOperations, result.operation.id, { status: 'pending', encryptedResult: undefined });
    store.close(); store = new Store(path);
    const replay: any = await createAirtableRecord(store, access, binding.id, args, 'restart-key', net);
    assert.equal(replay.operation.status, 'pending'); assert.equal(replay.operation.requiresReconciliation, true); assert.equal(writes, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
