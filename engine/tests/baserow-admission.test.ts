import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { CONTEXT_HEADERS, type ExpectedRequestContext } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';
import { baserowBindings, baserowOperations, registerBaserowRoutes } from '../src/integrations/baserow.js';
import { baserowHttpOperations } from '../src/integrations/baserow-http.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';

const prefix = '/api/v1/integrations/baserow';
const tableId = 123, fieldId = 'field_1', rowId = 1234;
const jsonResponse = (body: unknown) => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify(body)) });
const schemaResponse = () => jsonResponse([{ id: 1, name: 'Name', type: 'text' }]);
const acceptedResponse = () => jsonResponse({ id: rowId, [fieldId]: 'Synthetic row' });

async function fixture(t: TestContext) {
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY;
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(':memory:'), app = Fastify(), actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' as const };
  seedMember(store, actor);
  const sessionToken = randomBytes(32).toString('base64url'), cookies = { kloel_session: sessionToken };
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(sessionToken), actor.userId, actor.tenantId, Date.now() + 3600000);
  const calls: string[] = [], counters = { dns: 0 }, hooks: { request?: NonNullable<IntegrationTransport['request']> } = {};
  const transport: IntegrationTransport = {
    resolve: async () => { counters.dns++; return [{ address: '93.184.216.34', family: 4 }]; },
    request: async (...args) => { calls.push(args[2].method); return hooks.request ? hooks.request(...args) : args[2].method === 'GET' ? schemaResponse() : acceptedResponse(); },
  };
  await app.register(cookie); await registerAuth(app, store); await registerBaserowRoutes(app, store, transport);
  const identity = await app.inject({ url: '/api/v1/auth/me', cookies });
  assert.equal(identity.statusCode, 200, identity.body);
  const context = identity.json().context as ExpectedRequestContext;
  const headers = Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, context[key as keyof ExpectedRequestContext] ?? '-']));
  const configuration = { name: 'Admission boundary fixture', instanceUrl: 'https://database.example.com', tableId, token: 'synthetic-admission-database-token', enabled: true, allowCreate: true };
  const configured = await app.inject({ method: 'POST', url: prefix + '/tables', cookies, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { expectedTenantId: actor.tenantId, configuration } });
  assert.equal(configured.statusCode, 201, configured.body);
  const bindingId = configured.json().operation.bindingId as string;
  const send = (key: string, revision = 1, value = 'Synthetic row') => app.inject({ method: 'POST', url: `${prefix}/tables/${bindingId}/rows`, cookies, headers: { ...headers, 'idempotency-key': key }, payload: { expectedTenantId: actor.tenantId, expectedRevision: revision, values: { [fieldId]: value } } });
  const get = (key: string) => app.inject({ url: prefix + '/operations/' + key, cookies, headers });
  const snapshot = () => JSON.stringify(store.db.prepare('SELECT * FROM entities ORDER BY id').all());
  t.after(async () => { await app.close(); store.close(); if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; });
  return { app, store, actor, cookies, headers, bindingId, configuration, calls, counters, hooks, send, get, snapshot };
}

test('Baserow admission stale revision has a distinct error before DNS, schema, reservation, audit or POST', async t => {
  const f = await fixture(t), key = randomUUID();
  f.store.update(f.actor.tenantId, baserowBindings, f.bindingId, { revision: 2 });
  const before = f.snapshot(), auditCount = f.store.list(f.actor.tenantId, 'baserow-http-audit').length;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await f.send(key);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'baserow_admission_revision_conflict');
    assert.equal((await f.get(key)).statusCode, 404);
    assert.equal(f.snapshot(), before, 'rejected admission leaves binding, receipts and audit unchanged');
  }
  assert.equal(f.counters.dns, 0); assert.deepEqual(f.calls, []);
  assert.equal(f.store.list(f.actor.tenantId, baserowOperations).length, 0);
  assert.equal(f.store.list(f.actor.tenantId, baserowHttpOperations).filter(row => row.key === key).length, 0);
  assert.equal(f.store.list(f.actor.tenantId, 'baserow-http-audit').length, auditCount);
});

test('Baserow post-acceptance revision conflict retains generic409 and durable created receipt; replay precedes admission CAS', async t => {
  const f = await fixture(t), key = randomUUID();
  f.hooks.request = async (_url, _address, spec) => {
    if (spec.method === 'GET') return schemaResponse();
    f.store.update(f.actor.tenantId, baserowBindings, f.bindingId, { revision: 2 });
    return acceptedResponse();
  };
  const response = await f.send(key);
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'baserow_configuration_changed', 'accepted effect must not be mistaken for rejected admission');
  const before = f.snapshot(), dns = f.counters.dns, calls = [...f.calls];
  const recovered = await f.get(key);
  assert.equal(recovered.statusCode, 200); assert.equal(recovered.json().status, 'created'); assert.equal(recovered.json().rowId, rowId);
  assert.equal(recovered.json().revision, 1); assert.equal(recovered.json().requiresReconciliation, false);
  const native = f.store.get(f.actor.tenantId, baserowOperations, recovered.json().nativeOperationId)!;
  assert.equal(native.status, 'created'); assert.equal(native.rowId, rowId); assert.ok(native.encryptedResult);
  const replay = await f.send(key);
  assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true); assert.deepEqual(replay.json().operation, recovered.json());
  const different = await f.send(key, 1, 'Different payload');
  assert.equal(different.statusCode, 409); assert.equal(different.json().error.code, 'idempotency_conflict');
  assert.equal(f.snapshot(), before); assert.equal(f.counters.dns, dns); assert.deepEqual(f.calls, calls);
  assert.deepEqual(f.calls, ['GET', 'POST']);
});

test('Baserow revision change during preparation retains generic error and existing not_sent receipt', async t => {
  const f = await fixture(t), key = randomUUID();
  f.hooks.request = async (_url, _address, spec) => {
    assert.equal(spec.method, 'GET');
    f.store.update(f.actor.tenantId, baserowBindings, f.bindingId, { revision: 2 });
    return schemaResponse();
  };
  const response = await f.send(key);
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'baserow_configuration_changed');
  const recovered = await f.get(key);
  assert.equal(recovered.statusCode, 200); assert.equal(recovered.json().status, 'not_sent');
  assert.equal(recovered.json().errorCode, 'baserow_configuration_changed');
  assert.equal(recovered.json().nativeOperationId, null); assert.equal(recovered.json().rowId, null); assert.equal(recovered.json().requiresReconciliation, false);
  const before = f.snapshot(), dns = f.counters.dns;
  const replay = await f.send(key);
  assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true); assert.deepEqual(replay.json().operation, recovered.json());
  assert.equal(f.snapshot(), before); assert.equal(f.counters.dns, dns); assert.deepEqual(f.calls, ['GET']);
  assert.equal(f.store.list(f.actor.tenantId, baserowOperations).length, 0);
});

test('Baserow local configuration PUT and enabled PATCH retain their existing CAS error code without effects', async t => {
  const f = await fixture(t);
  f.store.update(f.actor.tenantId, baserowBindings, f.bindingId, { revision: 2 });
  const before = f.snapshot();
  for (const method of ['PUT', 'PATCH'] as const) {
    const key = randomUUID();
    const payload = { expectedTenantId: f.actor.tenantId, expectedRevision: 1, ...(method === 'PUT' ? { configuration: f.configuration } : { enabled: false }) };
    const response = await f.app.inject({ method, url: prefix + '/tables/' + f.bindingId, cookies: f.cookies, headers: { ...f.headers, 'idempotency-key': key }, payload });
    assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'baserow_configuration_changed');
    assert.equal((await f.get(key)).statusCode, 404);
    assert.equal(f.snapshot(), before);
  }
  assert.deepEqual(f.calls, []); assert.equal(f.counters.dns, 0);
});
