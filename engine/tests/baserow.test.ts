import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { digest } from '../src/oauth/crypto.js';
import { Store } from '../src/store.js';
import type { Actor } from '../src/oauth/access.js';
import { seedMember } from './fixtures/membership.js';
import { configureBaserowTable, listBaserowFields, readBaserowRows, createBaserowRow, baserowBindings, baserowOperations, registerBaserowRoutes, baserowAgentTools, executeAgentBaserow } from '../src/integrations/baserow.js';
import { integrationRuntimeMatrix } from '../src/integrations/capabilities.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';

const token = 'fixture-baserow-secret-token';
const address = { address: '93.184.216.34', family: 4 };
const response = (value: unknown, status = 200) => ({ status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });
const schema = [{ id: 1, name: 'Name', type: 'text', primary: true }, { id: 2, name: 'Age', type: 'number' }, { id: 3, name: 'Enabled', type: 'boolean' }, { id: 4, name: 'Date', type: 'date' }, { id: 5, name: 'Email', type: 'email' }, { id: 6, name: 'Select', type: 'single_select', select_options: [{ id: 60, value: 'A' }] }, { id: 7, name: 'Formula', type: 'formula', read_only: true }];
const input = (extra: Record<string, unknown> = {}) => ({ name: 'Fixture CRM', instanceUrl: 'https://database.example.com', tableId: 123, token, allowCreate: true, ...extra });
function fixture(t: any) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), actor: Actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  t.after(() => { store.close(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous; });
  return { store, actor };
}
const transport = (request: NonNullable<IntegrationTransport['request']>): IntegrationTransport => ({ resolve: async () => [address], request });

test('Baserow binding encrypts token, fixes public origin/table, and requires current admin role', async t => {
  const f = fixture(t), binding = configureBaserowTable(f.store, f.actor, input());
  assert.equal(binding.instanceUrl, 'https://database.example.com'); assert.equal(binding.nativeConnector, true); assert.equal(binding.status, 'configured_unverified');
  assert.ok(!JSON.stringify(binding).includes(token)); assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId, baserowBindings)).includes(token));
  for (const instanceUrl of ['http://database.example.com', 'https://127.0.0.1', 'https://localhost', 'https://169.254.169.254', 'https://user:password@database.example.com', 'https://database.example.com/api', 'https://database.example.com?token=x']) assert.throws(() => configureBaserowTable(f.store, f.actor, input({ instanceUrl })));
  assert.throws(() => configureBaserowTable(f.store, f.actor, input({ tableId: '../other' })));
  assert.throws(() => configureBaserowTable(f.store, f.actor, input({ token: undefined, instanceUrl: 'https://other.example.com' }), binding.id));
  const updated = configureBaserowTable(f.store, f.actor, input({ token: undefined, name: 'Kept token' }), binding.id);
  assert.equal(updated.revision, 2);
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('member', f.actor.userId);
  assert.throws(() => configureBaserowTable(f.store, f.actor, input()), (e: any) => e.code === 'forbidden');
});

test('Baserow reads native fields and paginated rows with structured filters, never follows next URL', async t => {
  const f = fixture(t), binding = configureBaserowTable(f.store, f.actor, input()); let calls = 0;
  const net = transport(async (url, pinned, spec) => {
    calls++; assert.deepEqual(pinned, address); assert.equal(spec.method, 'GET'); assert.equal(spec.headers.authorization, `Token ${token}`);
    if (url.pathname.includes('/fields/')) return response(schema);
    assert.equal(url.pathname, '/api/database/rows/table/123/'); assert.equal(url.searchParams.get('size'), '2'); assert.equal(url.searchParams.get('page'), '3');
    assert.equal(url.searchParams.get('order_by'), '-field_2');
    assert.deepEqual(JSON.parse(url.searchParams.get('filters')!), { filter_type: 'AND', filters: [{ field: 1, type: 'contains', value: 'Alice & Bob' }] });
    return response({ count: 8, next: 'https://evil.example.com/steal', previous: null, results: [{ id: 5, field_1: token }, { id: 6, field_1: 'Alice' }] });
  });
  const fields = await listBaserowFields(f.store, f.actor, binding.id, net); assert.equal(fields.items.length, schema.length);
  const rows = await readBaserowRows(f.store, f.actor, binding.id, { page: 3, size: 2, filters: [{ fieldId: 1, operator: 'contains', value: 'Alice & Bob' }], orderBy: [{ fieldId: 2, descending: true }] }, net);
  assert.equal(rows.nextPage, 4); assert.equal(rows.items[0].field_1, '[redacted]'); assert.equal(calls, 2); assert.ok(!JSON.stringify(rows).includes('evil.example.com'));
  assert.equal(f.store.get(f.actor.tenantId, baserowBindings, binding.id)!.lastReadRevision, 1);
  await assert.rejects(readBaserowRows(f.store, f.actor, binding.id, { url: 'https://evil.example.com' }, net)); assert.equal(calls, 2);
});

test('Baserow typed creation uses native fields and persists encrypted idempotent success without duplicating rows', async t => {
  const f = fixture(t), binding = configureBaserowTable(f.store, f.actor, input()); let reads = 0, writes = 0;
  const values = { field_1: 'Private Alice', field_2: '12.30', field_3: true, field_4: '2026-10-18', field_5: 'alice@example.com', field_6: 60 };
  const net = transport(async (url, _address, spec) => {
    if (spec.method === 'GET') { reads++; return response(schema); }
    writes++; assert.equal(url.href, 'https://database.example.com/api/database/rows/table/123/'); assert.deepEqual(JSON.parse(spec.body!.toString()), values);
    return response({ id: 42, ...values }, 201);
  });
  const first: any = await createBaserowRow(f.store, f.actor, binding.id, { values }, 'row-1', net);
  assert.equal(first.ok, true); assert.equal(first.operation.status, 'created'); assert.equal(first.row.id, 42);
  const cached = await createBaserowRow(f.store, f.actor, binding.id, { values }, 'row-1', net);
  assert.deepEqual(cached, first); assert.equal(reads, 1); assert.equal(writes, 1);
  assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId, baserowOperations)).includes('Private Alice'));
  await assert.rejects(createBaserowRow(f.store, f.actor, binding.id, { values: { field_1: 'Changed' } }, 'row-1', net), (e: any) => e.code === 'idempotency_conflict');
});

test('Baserow rejects unknown fields, computed fields and invalid typed values before write', async t => {
  const f = fixture(t), binding = configureBaserowTable(f.store, f.actor, input()); let writes = 0;
  const net = transport(async (_url, _address, spec) => { if (spec.method !== 'GET') writes++; return response(schema); });
  for (const values of [{ Name: 'x' }, { field_99: 'x' }, { field_7: 'x' }, { field_2: 'not-a-number' }, { field_3: 'true' }, { field_4: '2026-99-99' }, { field_4: '2026-02-31' }, { field_5: 'bad' }, { field_6: 999 }, {}]) await assert.rejects(createBaserowRow(f.store, f.actor, binding.id, { values }, randomUUID(), net), (e: any) => e.statusCode === 400);
  assert.equal(writes, 0); assert.equal(f.store.list(f.actor.tenantId, baserowOperations).length, 0);
});

test('Baserow ambiguous writes and concurrent requests never automatically retry', async t => {
  const f = fixture(t), binding = configureBaserowTable(f.store, f.actor, input()); let writes = 0;
  const args = { values: { field_1: 'x' } };
  const uncertain = transport(async (_url, _address, spec) => { if (spec.method === 'GET') return response(schema); writes++; throw new Error('fixture network secret'); });
  const failed: any = await createBaserowRow(f.store, f.actor, binding.id, args, 'uncertain', uncertain);
  assert.equal(failed.ok, false); assert.equal(failed.operation.status, 'uncertain'); assert.equal(failed.operation.requiresReconciliation, true); assert.ok(!JSON.stringify(failed).includes('network secret'));
  await createBaserowRow(f.store, f.actor, binding.id, args, 'uncertain', uncertain); assert.equal(writes, 1);
  let release: (v: ReturnType<typeof response>) => void = () => {};
  const blocked = transport(async (_url, _address, spec) => { if (spec.method === 'GET') return response(schema); writes++; return new Promise(resolve => { release = resolve; }); });
  const first = createBaserowRow(f.store, f.actor, binding.id, args, 'pending', blocked); await new Promise(resolve => setImmediate(resolve));
  const second: any = await createBaserowRow(f.store, f.actor, binding.id, args, 'pending', blocked);
  assert.equal(second.operation.status, 'pending'); release(response({ id: 7 }, 201)); await first; assert.equal(writes, 2);
  const rejected: any = await createBaserowRow(f.store, f.actor, binding.id, args, 'upstream500', transport(async (_url, _address, spec) => spec.method === 'GET' ? response(schema) : response({ secret: token }, 500)));
  assert.equal(rejected.operation.status, 'uncertain'); assert.ok(!JSON.stringify(rejected).includes(token));
});

test('Baserow disallows private DNS, redirects to different endpoints and unbounded provider responses', async t => {
  const f = fixture(t), binding = configureBaserowTable(f.store, f.actor, input()); let requests = 0;
  const privateNet: IntegrationTransport = { resolve: async () => [address, { address: '10.0.0.1', family: 4 }], request: async () => { requests++; return response(schema); } };
  await assert.rejects(listBaserowFields(f.store, f.actor, binding.id, privateNet), (e: any) => e.code === 'unsafe_destination'); assert.equal(requests, 0);
  const redirect = transport(async () => { requests++; return { ...response({}, 307), headers: { location: '/api/database/rows/table/999/' } }; });
  await assert.rejects(listBaserowFields(f.store, f.actor, binding.id, redirect), (e: any) => e.code === 'baserow_redirect_blocked'); assert.equal(requests, 1);
  await assert.rejects(listBaserowFields(f.store, f.actor, binding.id, transport(async () => ({ status: 200, headers: {}, body: Buffer.alloc(65537) }))), (e: any) => e.code === 'response_limit_exceeded');
});

test('Baserow tenant and role isolation persist across cached results and revocation during DNS', async t => {
  const f = fixture(t), viewer: Actor = { ...f.actor, userId: randomUUID(), role: 'viewer' }, foreign: Actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' }; seedMember(f.store, viewer); seedMember(f.store, foreign);
  const binding = configureBaserowTable(f.store, f.actor, input({ allowedRoles: ['owner', 'viewer'] })); let requests = 0;
  const net = transport(async (_url, _address, spec) => { requests++; return response(spec.method === 'GET' ? schema : { id: 1 }); });
  await listBaserowFields(f.store, viewer, binding.id, net);
  await assert.rejects(createBaserowRow(f.store, viewer, binding.id, { values: { field_1: 'x' } }, 'viewer', net), (e: any) => e.code === 'baserow_read_only');
  await assert.rejects(listBaserowFields(f.store, foreign, binding.id, net), (e: any) => e.code === 'baserow_binding_not_found'); assert.equal(requests, 1);
  await createBaserowRow(f.store, f.actor, binding.id, { values: { field_1: 'x' } }, 'cached', net);
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('viewer', f.actor.userId);
  await assert.rejects(createBaserowRow(f.store, f.actor, binding.id, { values: { field_1: 'x' } }, 'cached', net), (e: any) => e.code === 'baserow_read_only');
  const duringDns: IntegrationTransport = { resolve: async () => { f.store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(viewer.userId); return [address]; }, request: async () => { requests++; return response(schema); } };
  await assert.rejects(listBaserowFields(f.store, viewer, binding.id, duringDns)); assert.equal(requests, 3);
});

test('Baserow native routes, receipts and capability matrix are honest and omit credentials', async t => {
  const f = fixture(t), app = Fastify(); t.after(() => app.close()); app.addHook('onRequest', async req => { req.actor = f.actor; });
  await app.register(cookie); const session = randomUUID(), cookies = { kloel_session: session };
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(session), f.actor.userId, f.actor.tenantId, Date.now() + 60000);
  await registerBaserowRoutes(app, f.store, transport(async (_url, _address, spec) => response(spec.method === 'GET' ? schema : { id: 12 }, spec.method === 'GET' ? 200 : 201)));
  const create = await app.inject({ method: 'POST', url: '/api/v1/integrations/baserow/tables', cookies, headers: { 'idempotency-key': randomUUID() }, payload: { expectedTenantId: f.actor.tenantId, configuration: input() } }); assert.equal(create.statusCode, 201); assert.ok(!create.body.includes(token));
  const binding = create.json().operation, prefix = `/api/v1/integrations/baserow/tables/${binding.bindingId}`;
  const payload = { expectedTenantId: f.actor.tenantId, expectedRevision: 1, values: { field_1: 'x' } };
  const missingKey = await app.inject({ method: 'POST', url: `${prefix}/rows`, cookies, payload }); assert.equal(missingKey.statusCode, 400);
  const sent = await app.inject({ method: 'POST', url: `${prefix}/rows`, cookies, headers: { 'idempotency-key': randomUUID() }, payload }); assert.equal(sent.statusCode, 200); assert.equal(sent.json().operation.status, 'created');
  const receipts = (await app.inject('/api/v1/integrations/baserow/operations')).json(); assert.equal(receipts.items.length, 1); assert.equal(receipts.items[0].status, 'created'); assert.equal(receipts.items[0].encryptedResult, undefined);
  const matrix = integrationRuntimeMatrix(f.store, f.actor), entry = matrix.items.find(e => e.name === 'Baserow')!;
  assert.equal(entry.implementation, 'native_partial'); assert.equal(entry.runtime.endToEndValidation, 'not_recorded_by_this_registry');
  const disabled = await app.inject({ method: 'PATCH', url: prefix, cookies, headers: { 'idempotency-key': randomUUID() }, payload: { expectedTenantId: f.actor.tenantId, expectedRevision: 1, enabled: false } }); assert.equal(disabled.statusCode, 200);
  const read = await app.inject(`${prefix}/fields`); assert.equal(read.statusCode, 503);
});

test('Baserow agent tools require current operator, assigned persisted agent and explicit write permission', async t => {
  const f = fixture(t), agent = f.store.create(f.actor.tenantId, 'agents', { name: 'CRM reader' }), binding = configureBaserowTable(f.store, f.actor, input({ agentIds: [agent.id] }));
  const ctx = { actor: f.actor, agent, tenantId: f.actor.tenantId };
  assert.equal(baserowAgentTools(f.store, ctx).length, 3); assert.equal(baserowAgentTools(f.store, { ...ctx, actor: undefined }).length, 0);
  await assert.rejects(executeAgentBaserow(f.store, { ...ctx, actor: undefined }, binding.id, 'read', {}, 'x'), (e: any) => e.code === 'operator_required');
  f.store.update(f.actor.tenantId, baserowBindings, binding.id, { agentIds: [] });
  await assert.rejects(executeAgentBaserow(f.store, ctx, binding.id, 'read', {}, 'x'), (e: any) => e.code === 'action_not_assigned');
});
