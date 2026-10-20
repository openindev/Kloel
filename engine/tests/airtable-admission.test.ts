import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { CONTEXT_HEADERS, type ExpectedRequestContext } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';
import { airtableBindings, airtableOperations, registerAirtableRoutes } from '../src/integrations/airtable.js';
import { airtableHttpOperations } from '../src/integrations/airtable-http.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';

const prefix = '/api/v1/integrations/airtable';
const baseId = 'app00000000000001', tableId = 'tbl00000000000001', fieldId = 'fld00000000000001', recordId = 'rec00000000000001';
const jsonResponse = (body: unknown) => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify(body)) });
const schemaResponse = () => jsonResponse({ tables: [{ id: tableId, fields: [{ id: fieldId, name: 'Name', type: 'singleLineText' }] }] });
const acceptedResponse = () => jsonResponse({ records: [{ id: recordId, createdTime: '2026-10-18T12:00:00Z', fields: {} }] });

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
  await app.register(cookie); await registerAuth(app, store); await registerAirtableRoutes(app, store, transport);
  const identity = (await app.inject({ url: '/api/v1/auth/me', cookies })).json();
  const headers = Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, identity.context[key as keyof ExpectedRequestContext] ?? '-']));
  const configuration = { name: 'Admission boundary fixture', baseId, tableId, fieldIds: [fieldId], token: 'synthetic-admission-pat', enabled: true, allowCreate: true };
  const configured = await app.inject({ method: 'POST', url: prefix + '/tables', cookies, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { expectedTenantId: actor.tenantId, configuration } });
  assert.equal(configured.statusCode, 201, configured.body);
  const bindingId = configured.json().operation.bindingId as string;
  const send = (key: string, revision = 1, value = 'Synthetic record') => app.inject({ method: 'POST', url: `${prefix}/tables/${bindingId}/records`, cookies, headers: { ...headers, 'idempotency-key': key }, payload: { expectedTenantId: actor.tenantId, expectedRevision: revision, values: { [fieldId]: value } } });
  const get = (key: string) => app.inject({ url: prefix + '/operations/' + key, cookies, headers });
  const snapshot = () => JSON.stringify(store.db.prepare('SELECT * FROM entities ORDER BY id').all());
  t.after(async () => { await app.close(); store.close(); if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; });
  return { app, store, actor, cookies, headers, bindingId, configuration, calls, counters, hooks, send, get, snapshot };
}

test('Airtable admission stale revision has a distinct error before DNS, schema, reservation, audit or POST', async t => {
  const f = await fixture(t), key = randomUUID();
  f.store.update(f.actor.tenantId, airtableBindings, f.bindingId, { revision: 2 });
  const before = f.snapshot();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await f.send(key);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'airtable_admission_revision_conflict');
    assert.equal((await f.get(key)).statusCode, 404);
    assert.equal(f.snapshot(), before, 'known rejected admission produces no receipt or audit');
  }
  assert.equal(f.counters.dns, 0); assert.deepEqual(f.calls, []);
  assert.equal(f.store.list(f.actor.tenantId, airtableOperations).length, 0);
  assert.equal(f.store.list(f.actor.tenantId, airtableHttpOperations).filter(row => row.key === key).length, 0);
});

test('Airtable post-acceptance revision conflict retains generic409 and durable created receipt; replay precedes admission CAS', async t => {
  const f = await fixture(t), key = randomUUID();
  f.hooks.request = async (_url, _address, spec) => {
    if (spec.method === 'GET') return schemaResponse();
    f.store.update(f.actor.tenantId, airtableBindings, f.bindingId, { revision: 2 });
    return acceptedResponse();
  };
  const response = await f.send(key);
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'airtable_configuration_changed', 'accepted effect must not be mistaken for rejected admission');
  const before = f.snapshot(), dns = f.counters.dns, calls = [...f.calls];
  const recovered = await f.get(key);
  assert.equal(recovered.statusCode, 200); assert.equal(recovered.json().status, 'created'); assert.equal(recovered.json().recordId, recordId);
  const replay = await f.send(key);
  assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true); assert.equal(replay.json().operation.recordId, recordId);
  const different = await f.send(key, 1, 'Different payload');
  assert.equal(different.statusCode, 409); assert.equal(different.json().error.code, 'idempotency_conflict');
  assert.equal(f.snapshot(), before); assert.equal(f.counters.dns, dns); assert.deepEqual(f.calls, calls);
  assert.equal(f.calls.filter(method => method === 'POST').length, 1);
});

test('Airtable revision change during preparation retains generic error and existing not_sent receipt', async t => {
  const f = await fixture(t), key = randomUUID();
  f.hooks.request = async (_url, _address, spec) => {
    assert.equal(spec.method, 'GET');
    f.store.update(f.actor.tenantId, airtableBindings, f.bindingId, { revision: 2 });
    return schemaResponse();
  };
  const response = await f.send(key);
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'airtable_configuration_changed');
  const recovered = await f.get(key);
  assert.equal(recovered.statusCode, 200); assert.equal(recovered.json().status, 'not_sent');
  assert.equal(recovered.json().nativeOperationId, null); assert.equal(recovered.json().requiresReconciliation, false);
  assert.deepEqual(f.calls, ['GET']);
});

test('Airtable local configuration CAS keeps its existing error code', async t => {
  const f = await fixture(t);
  f.store.update(f.actor.tenantId, airtableBindings, f.bindingId, { revision: 2 });
  const before = f.snapshot();
  const response = await f.app.inject({ method: 'PUT', url: prefix + '/tables/' + f.bindingId, cookies: f.cookies, headers: { ...f.headers, 'idempotency-key': randomUUID() }, payload: { expectedTenantId: f.actor.tenantId, expectedRevision: 1, configuration: f.configuration } });
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'airtable_configuration_changed');
  assert.equal(f.snapshot(), before); assert.deepEqual(f.calls, []); assert.equal(f.counters.dns, 0);
});
