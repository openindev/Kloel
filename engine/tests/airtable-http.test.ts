import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { CONTEXT_HEADERS, type ExpectedRequestContext } from '../src/request-context.js';
import { MembershipError } from '../src/memberships/service.js';
import { seedMember } from './fixtures/membership.js';
import type { Actor } from '../src/oauth/access.js';
import { airtableBindings, airtableOperations, configureAirtableTable, createAirtableRecord, registerAirtableRoutes } from '../src/integrations/airtable.js';
import { airtableHttpOperations } from '../src/integrations/airtable-http.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';

const prefix = '/api/v1/integrations/airtable';
const baseId = 'app00000000000001', tableId = 'tbl00000000000001', fieldId = 'fld00000000000001', secondField = 'fld00000000000002', recordId = 'rec00000000000001';
const privateToken = 'synthetic-airtable-personal-token', privateValue = 'synthetic-private-row-content';
const configuration = (extra: Record<string, unknown> = {}) => ({ name: 'Synthetic data', baseId, tableId, fieldIds: [fieldId, secondField], token: privateToken, allowCreate: true, ...extra });
const response = (data: unknown, status = 200) => ({ status, headers: {}, body: Buffer.from(JSON.stringify(data)) });
const metadata = () => response({ tables: [{ id: tableId, fields: [{ id: fieldId, name: 'Name', type: 'singleLineText' }, { id: secondField, name: 'Count', type: 'number' }] }] });
const accepted = () => response({ records: [{ id: recordId, createdTime: '2026-10-18T09:00:00.000Z', fields: { [fieldId]: privateValue } }] });
const headerContext = (context: ExpectedRequestContext) => Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, context[key as keyof ExpectedRequestContext] ?? '-']));
async function fixture(t: TestContext) {
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(':memory:'), app = Fastify(), actor: Actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const token = randomBytes(32).toString('base64url'), cookies = { kloel_session: token };
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(token), actor.userId, actor.tenantId, Date.now() + 3600000);
  const calls: string[] = [], hooks: { dns?: () => void; request?: NonNullable<IntegrationTransport['request']> } = {};
  const transport: IntegrationTransport = { resolve: async () => { hooks.dns?.(); return [{ address: '93.184.216.34', family: 4 }]; }, request: async (...args) => { calls.push(args[2].method); return hooks.request ? hooks.request(...args) : args[2].method === 'GET' ? metadata() : accepted(); } };
  app.setErrorHandler((error, _req, reply) => error instanceof MembershipError ? reply.code(error.statusCode).send({ error: { code: error.code } }) : reply.code(500).send({ error: { code: 'fixture_unexpected' } }));
  await app.register(cookie); await registerAuth(app, store); await registerAirtableRoutes(app, store, transport);
  const freshHeaders = async (using = cookies) => { const me = await app.inject({ url: '/api/v1/auth/me', cookies: using }); assert.equal(me.statusCode, 200, me.body); return headerContext(me.json().context); };
  const headers = await freshHeaders();
  const send = (method: 'POST' | 'PUT', path: string, key: string, payload: unknown, using = headers) => app.inject({ method, url: prefix + path, cookies, headers: { ...using, 'idempotency-key': key }, payload });
  const get = (key: string, using = headers) => app.inject({ url: prefix + '/operations/' + key, cookies, headers: using });
  const configBody = (extra = {}) => ({ expectedTenantId: actor.tenantId, configuration: configuration(extra) });
  const create = async () => { const result = await send('POST', '/tables', randomUUID(), configBody()); assert.equal(result.statusCode, 201, result.body); return result.json().operation as { bindingId: string; revision: number }; };
  const values = { [fieldId]: privateValue, [secondField]: 3 };
  const body = (revision = 1) => ({ expectedTenantId: actor.tenantId, expectedRevision: revision, values });
  const aba = () => { store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=? AND tenant_id=?").run(actor.userId, actor.tenantId); store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=? AND tenant_id=?").run(actor.userId, actor.tenantId); };
  const snapshot = () => JSON.stringify(store.db.prepare('SELECT * FROM entities ORDER BY id').all());
  t.after(async () => { await app.close(); store.close(); if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; });
  return { store, app, actor, cookies, headers, freshHeaders, transport, hooks, calls, send, get, create, configBody, body, aba, snapshot };
}
function noSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const forbidden of [privateToken, privateValue, 'encryptedToken', 'encryptedResult', 'sessionHash', 'authorityVersion', 'fingerprint']) assert.ok(!text.includes(forbidden), forbidden);
}

test('Airtable HTTP configuration is canonical, atomic, scoped and recoverable by key without I/O', async t => {
  const f = await fixture(t), key = randomUUID(), payload = f.configBody();
  const first = await f.send('POST', '/tables', key, payload); assert.equal(first.statusCode, 201, first.body);
  const op = first.json().operation; assert.equal(op.kind, 'binding.create'); assert.equal(op.status, 'succeeded'); assert.equal(op.revision, 1); assert.equal(op.nativeOperationId, null); noSecrets(first.json());
  const replay = await f.send('POST', '/tables', key, f.configBody({ fieldIds: [secondField, fieldId, fieldId], allowedRoles: ['admin', 'owner'], enabled: true, agentIds: [] }));
  assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().replayed, true); assert.deepEqual(replay.json().operation, op);
  assert.equal(f.store.list(f.actor.tenantId, airtableBindings).length, 1); assert.equal(f.store.list(f.actor.tenantId, 'airtable-http-audit').length, 1);
  assert.ok(!f.snapshot().includes(privateToken));
  const before = f.snapshot(); assert.deepEqual((await f.get(key)).json(), op); assert.equal(f.snapshot(), before); assert.deepEqual(f.calls, []);
  const current = await f.app.inject({ url: prefix + '/tables/' + op.bindingId, cookies: f.cookies, headers: f.headers }); assert.equal(current.json().revision, 1); noSecrets(current.json());
  assert.equal((await f.send('POST', '/tables', key, f.configBody({ name: 'Different' }))).json().error.code, 'idempotency_conflict');
});

test('Airtable HTTP observed revision rejects stale effects but historical replay precedes CAS and disabled config', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  const body = { ...f.configBody({ name: 'Revision two', token: undefined }), expectedRevision: 1 };
  const changed = await f.send('PUT', '/tables/' + binding.bindingId, key, body); assert.equal(changed.statusCode, 200, changed.body); assert.equal(changed.json().operation.revision, 2);
  const newer = await f.send('PUT', '/tables/' + binding.bindingId, randomUUID(), { ...f.configBody({ enabled: false, token: undefined }), expectedRevision: 2 }); assert.equal(newer.json().operation.revision, 3);
  const replay = await f.send('PUT', '/tables/' + binding.bindingId, key, body); assert.equal(replay.statusCode, 200); assert.equal(replay.json().operation.revision, 2);
  const stale = await f.send('PUT', '/tables/' + binding.bindingId, randomUUID(), body); assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'airtable_configuration_changed');
  const write = await f.send('POST', '/tables/' + binding.bindingId + '/records', randomUUID(), f.body()); assert.equal(write.statusCode, 409); assert.deepEqual(f.calls, []);
  const current = await f.app.inject({ url: prefix + '/tables/' + binding.bindingId, cookies: f.cookies, headers: f.headers }); assert.equal(current.json().enabled, false); assert.equal(current.json().revision, 3);
});

test('Airtable HTTP one key namespace rejects different kinds and another selected tenant before effects', async t => {
  const f = await fixture(t), key = randomUUID(), initial = await f.send('POST', '/tables', key, f.configBody()), id = initial.json().operation.bindingId;
  for (const [method, path, payload] of [['PUT', '/tables/' + id, { ...f.configBody(), expectedRevision: 1 }], ['POST', '/tables/' + id + '/records', f.body()]] as const) {
    const result = await f.send(method, path, key, payload); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'idempotency_conflict');
  }
  const result = await f.send('POST', '/tables', randomUUID(), { ...f.configBody(), expectedTenantId: randomUUID() }); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'tenant_mismatch');
  assert.equal(f.store.list(f.actor.tenantId, airtableBindings).length, 1); assert.deepEqual(f.calls, []);
});

test('Airtable HTTP binding, encrypted credential, audit and receipt roll back together on final context veto', async t => {
  const f = await fixture(t), original = f.store.create.bind(f.store);
  f.store.create = (tenant, collection, data) => { const row = original(tenant, collection, data); if (collection === 'airtable-http-audit') f.aba(); return row; };
  const result = await f.send('POST', '/tables', randomUUID(), f.configBody()); assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'context_changed_in_flight');
  for (const collection of [airtableBindings, airtableHttpOperations, 'airtable-http-audit']) assert.equal(f.store.list(f.actor.tenantId, collection).length, 0);
  assert.deepEqual(f.calls, []);
});

test('Airtable HTTP encryption failure rolls back configuration and receipt and permits explicit same-key retry', async t => {
  const f = await fixture(t), key = randomUUID(), encryptionKey = process.env.OAUTH_ENCRYPTION_KEY; delete process.env.OAUTH_ENCRYPTION_KEY;
  const result = await f.send('POST', '/tables', key, f.configBody()); assert.equal(result.statusCode, 503, result.body);
  assert.equal(f.store.list(f.actor.tenantId, airtableBindings).length, 0); assert.equal((await f.get(key)).statusCode, 404);
  process.env.OAUTH_ENCRYPTION_KEY = encryptionKey;
  assert.equal((await f.send('POST', '/tables', key, f.configBody())).statusCode, 201);
});

test('Airtable HTTP remote intent and native linkage are durable before POST; lost browser response recovers without a second request', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  f.hooks.request = async (_url, _address, spec) => {
    if (spec.method === 'GET') return metadata();
    const http = f.store.list(f.actor.tenantId, airtableHttpOperations).find(row => row.key === key)!;
    assert.equal(http.status, 'pending'); assert.ok(http.nativeOperationId);
    const native = f.store.get(f.actor.tenantId, airtableOperations, String(http.nativeOperationId))!;
    assert.equal(native.httpOperationId, http.id); assert.equal(native.status, 'pending'); assert.ok(native.attemptedAt); return accepted();
  };
  // The first response is deliberately discarded; recovery is a GET of the original key.
  const sent = await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body()); assert.equal(sent.statusCode, 200, sent.body);
  const before = f.snapshot(), calls = [...f.calls], recovered = await f.get(key); assert.equal(recovered.json().status, 'created'); assert.equal(recovered.json().recordId, recordId); noSecrets(recovered.json());
  assert.equal(f.snapshot(), before); assert.deepEqual(f.calls, calls);
  const reordered = { ...f.body(), values: { [secondField]: 3, [fieldId]: privateValue } };
  const replay = await f.send('POST', '/tables/' + binding.bindingId + '/records', key, reordered); assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true); assert.equal(replay.json().operation.recordId, recordId); assert.deepEqual(f.calls, calls);
  f.store.update(f.actor.tenantId, airtableBindings, binding.bindingId, { enabled: false, revision: 2 });
  assert.equal((await f.get(key)).json().status, 'created'); assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body())).json().operation.status, 'created'); assert.deepEqual(f.calls, calls);
});

test('Airtable HTTP concurrent same-key preparation and attempted write both replay pending without sending twice', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  let releaseSchema!: () => void, releaseWrite!: () => void, schemaStarted!: () => void, writeStarted!: () => void;
  const schemaSignal = new Promise<void>(resolve => { schemaStarted = resolve; }), writeSignal = new Promise<void>(resolve => { writeStarted = resolve; });
  f.hooks.request = async (_u, _a, spec) => { if (spec.method === 'GET') { schemaStarted(); await new Promise<void>(resolve => { releaseSchema = resolve; }); return metadata(); } writeStarted(); await new Promise<void>(resolve => { releaseWrite = resolve; }); return accepted(); };
  const first = f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body()); await schemaSignal;
  const preparation = await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body()); assert.equal(preparation.json().operation.status, 'pending'); assert.equal(preparation.json().operation.nativeOperationId, null);
  releaseSchema(); await writeSignal;
  const attempt = await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body()); assert.equal(attempt.json().operation.status, 'pending'); assert.ok(attempt.json().operation.nativeOperationId);
  releaseWrite(); assert.equal((await first).json().operation.status, 'created'); assert.deepEqual(f.calls, ['GET', 'POST']);
});

test('Airtable HTTP native rejected, uncertain and pending states remain faithful and never retry on recovery', async t => {
  const f = await fixture(t), binding = await f.create();
  for (const [label, expected] of [['rejected', 'rejected'], ['lost', 'uncertain'], ['malformed', 'uncertain']] as const) {
    const key = randomUUID(); f.hooks.request = async (_u, _a, spec) => { if (spec.method === 'GET') return metadata(); if (label === 'lost') throw new Error(privateValue); return label === 'rejected' ? response({}, 403) : response({}); };
    const sent = await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body()); assert.equal(sent.statusCode, 200, sent.body); assert.equal(sent.json().operation.status, expected); noSecrets(sent.json());
    const count = f.calls.length; assert.equal((await f.get(key)).json().status, expected); assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body())).json().operation.status, expected); assert.equal(f.calls.length, count);
    if (label === 'lost') { f.store.update(f.actor.tenantId, airtableOperations, sent.json().operation.nativeOperationId, { status: 'pending', encryptedResult: undefined }); const pending = await f.get(key); assert.equal(pending.json().status, 'pending'); assert.equal(pending.json().requiresReconciliation, true); assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body())).json().operation.status, 'pending'); assert.equal(f.calls.length, count); }
  }
});

test('Airtable HTTP schema/type failure is not_sent; config change during schema await blocks mutating transport', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  const invalid = await f.send('POST', '/tables/' + binding.bindingId + '/records', key, { ...f.body(), values: { [secondField]: 'not a number' } }); assert.equal(invalid.statusCode, 400);
  assert.equal((await f.get(key)).json().status, 'not_sent'); assert.equal(f.calls.filter(x => x === 'POST').length, 0);
  const next = randomUUID(); f.hooks.request = async () => { f.store.update(f.actor.tenantId, airtableBindings, binding.bindingId, { revision: 2 }); return metadata(); };
  const changed = await f.send('POST', '/tables/' + binding.bindingId + '/records', next, f.body()); assert.equal(changed.statusCode, 409); assert.equal(changed.json().error.code, 'airtable_configuration_changed'); assert.equal((await f.get(next)).json().status, 'not_sent'); assert.equal(f.calls.filter(x => x === 'POST').length, 0);
});

test('Airtable HTTP role ABA before DNS or during final accepted response denies disclosure without losing receipt', async t => {
  for (const stage of ['dns', 'accepted'] as const) await t.test(stage, async t => {
    const f = await fixture(t), binding = await f.create(), key = randomUUID();
    if (stage === 'dns') f.hooks.dns = () => { delete f.hooks.dns; f.aba(); };
    else f.hooks.request = async (_u, _a, spec) => { if (spec.method === 'GET') return metadata(); f.aba(); return accepted(); };
    const changed = await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body()); assert.equal(changed.statusCode, 409); assert.equal(changed.json().error.code, 'context_changed_in_flight'); assert.ok(!changed.body.includes(recordId)); noSecrets(changed.json());
    const http = f.store.list(f.actor.tenantId, airtableHttpOperations).find(row => row.key === key)!;
    if (stage === 'dns') { assert.equal(http.status, 'not_sent'); assert.equal(http.nativeOperationId, null); assert.deepEqual(f.calls, []); }
    else { const native = f.store.get(f.actor.tenantId, airtableOperations, String(http.nativeOperationId))!; assert.equal(native.status, 'created'); assert.equal(native.recordId, recordId); assert.ok(native.encryptedResult); }
    const fresh = await f.freshHeaders(), calls = f.calls.length; assert.equal((await f.get(key, fresh)).statusCode, 404); assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body(), fresh)).json().error.code, 'idempotency_conflict'); assert.equal(f.calls.length, calls);
  });
});

test('Airtable HTTP receipts never migrate across operators, sessions, membership reinsertion or tenant cookies', async t => {
  for (const mutation of ['operator', 'session', 'membership', 'tenant'] as const) await t.test(mutation, async t => {
    const f = await fixture(t), key = randomUUID(), created = await f.send('POST', '/tables', key, f.configBody()); assert.equal(created.statusCode, 201);
    let userId = f.actor.userId, tenantId = f.actor.tenantId;
    if (mutation === 'operator') { userId = randomUUID(); seedMember(f.store, { ...f.actor, userId }); }
    if (mutation === 'tenant') { tenantId = randomUUID(); seedMember(f.store, { ...f.actor, tenantId }); }
    if (mutation === 'membership') { f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(userId, tenantId); seedMember(f.store, f.actor); }
    if (mutation !== 'membership') { f.cookies.kloel_session = randomBytes(32).toString('base64url'); f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(f.cookies.kloel_session), userId, tenantId, Date.now() + 60000); }
    const fresh = await f.freshHeaders(); assert.equal((await f.get(key, fresh)).statusCode, 404);
    const result = await f.send('POST', '/tables', key, f.configBody(), fresh); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, mutation === 'tenant' ? 'tenant_mismatch' : 'idempotency_conflict'); assert.equal(f.store.list(f.actor.tenantId, airtableBindings).length, 1); assert.deepEqual(f.calls, []);
  });
});

test('Airtable HTTP does not retroactively bind a legacy native receipt to a human session', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  await createAirtableRecord(f.store, { actor: f.actor, assertLive: () => {} }, binding.bindingId, { values: f.body().values }, key, f.transport);
  const before = f.calls.length, result = await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body()); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'legacy_operation_unrecoverable'); assert.equal((await f.get(key)).statusCode, 404);
  assert.equal(f.store.list(f.actor.tenantId, airtableHttpOperations).filter(x => x.kind === 'record.create').length, 0); assert.equal(f.calls.length, before);
});

test('Airtable HTTP malformed/foreign native linkage or contradictory state fails closed without effects', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID(), sent = await f.send('POST', '/tables/' + binding.bindingId + '/records', key, f.body());
  assert.equal(sent.statusCode, 200, sent.body);
  const http = f.store.list(f.actor.tenantId, airtableHttpOperations).find(x => x.key === key)!, native = f.store.get(f.actor.tenantId, airtableOperations, String(http.nativeOperationId))!, count = f.calls.length;
  for (const patch of [{ status: 'fabricated' }, { status: 'rejected', recordId }, { recordId: 'invalid' }, { httpOperationId: randomUUID() }, { revision: 2 }, { userId: randomUUID() }, { errorCode: 'Bearer synthetic-secret-value' }]) {
    f.store.update(f.actor.tenantId, airtableOperations, native.id, { ...native, ...patch }); const before = f.snapshot(), result = await f.get(key); assert.equal(result.statusCode, 409, JSON.stringify(patch)); assert.equal(result.json().error.code, 'airtable_operation_unavailable'); assert.equal(f.snapshot(), before); noSecrets(result.json());
  }
  f.store.update(f.actor.tenantId, airtableOperations, native.id, native);
  const foreign = f.store.create(randomUUID(), airtableOperations, { ...native, httpOperationId: http.id }); f.store.update(f.actor.tenantId, airtableHttpOperations, http.id, { nativeOperationId: foreign.id }); assert.equal((await f.get(key)).statusCode, 409);
  assert.equal(f.calls.length, count);
});

test('Airtable HTTP authorization inside reservation precedes local intent and supports no stale tenant mutation', async t => {
  const f = await fixture(t), binding = await f.create(), beforeCount = f.store.list(f.actor.tenantId, airtableHttpOperations).length;
  const transaction = f.store.transaction.bind(f.store); let changed = false;
  f.store.transaction = fn => { if (!changed) { changed = true; f.aba(); } return transaction(fn); };
  const result = await f.send('POST', '/tables/' + binding.bindingId + '/records', randomUUID(), f.body()); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(f.store.list(f.actor.tenantId, airtableHttpOperations).length, beforeCount); assert.deepEqual(f.calls, []);
});

test('Airtable HTTP original-session receipts survive SQLite restart without schema, credential decryption or POST', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY, directory = mkdtempSync(join(tmpdir(), 'kloel-airtable-http-')), path = join(directory, 'synthetic.sqlite');
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  let store = new Store(path), app = Fastify(); const actor: Actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const token = randomBytes(32).toString('base64url'), cookies = { kloel_session: token }; store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(token), actor.userId, actor.tenantId, Date.now() + 60000);
  let calls = 0;
  const transport: IntegrationTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async (_u, _a, spec) => { calls++; if (spec.method === 'GET') return metadata(); throw new Error('synthetic lost response'); } };
  try {
    await app.register(cookie); await registerAuth(app, store); await registerAirtableRoutes(app, store, transport);
    const me = await app.inject({ url: '/api/v1/auth/me', cookies }), headers = headerContext(me.json().context), configurationKey = randomUUID(), recordKey = randomUUID();
    const configurationBody = { expectedTenantId: actor.tenantId, configuration: configuration() };
    const configured = await app.inject({ method: 'POST', url: prefix + '/tables', cookies, headers: { ...headers, 'idempotency-key': configurationKey }, payload: configurationBody }); assert.equal(configured.statusCode, 201, configured.body);
    const id = configured.json().operation.bindingId, recordBody = { expectedTenantId: actor.tenantId, expectedRevision: 1, values: { [fieldId]: privateValue } };
    const sent = await app.inject({ method: 'POST', url: prefix + '/tables/' + id + '/records', cookies, headers: { ...headers, 'idempotency-key': recordKey }, payload: recordBody }); assert.equal(sent.json().operation.status, 'uncertain'); assert.equal(calls, 2);
    // Simulate a crash after native attemptedAt but before its final outcome was saved.
    store.update(actor.tenantId, airtableOperations, sent.json().operation.nativeOperationId, { status: 'pending', encryptedResult: undefined });
    await app.close(); store.close(); store = new Store(path); app = Fastify();
    delete process.env.OAUTH_ENCRYPTION_KEY; // GET/replay requires no plaintext credential or encrypted result.
    await app.register(cookie); await registerAuth(app, store); await registerAirtableRoutes(app, store, { resolve: async () => { throw new Error('recovery must not resolve'); }, request: async () => { calls++; throw new Error('recovery must not send'); } });
    const snapshot = JSON.stringify(store.db.prepare('SELECT * FROM entities ORDER BY id').all());
    const configReceipt = await app.inject({ url: prefix + '/operations/' + configurationKey, cookies, headers }); assert.equal(configReceipt.json().status, 'succeeded');
    const receipt = await app.inject({ url: prefix + '/operations/' + recordKey, cookies, headers }); assert.equal(receipt.json().status, 'pending'); assert.equal(receipt.json().requiresReconciliation, true); noSecrets(receipt.json());
    const replay = await app.inject({ method: 'POST', url: prefix + '/tables/' + id + '/records', cookies, headers: { ...headers, 'idempotency-key': recordKey }, payload: recordBody }); assert.equal(replay.json().operation.status, 'pending'); assert.equal(replay.json().replayed, true);
    const configReplay = await app.inject({ method: 'POST', url: prefix + '/tables', cookies, headers: { ...headers, 'idempotency-key': configurationKey }, payload: configurationBody }); assert.equal(configReplay.json().operation.bindingId, id); assert.equal(configReplay.json().replayed, true);
    assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM entities ORDER BY id').all()), snapshot); assert.equal(calls, 2);
  } finally { await app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; }
});
