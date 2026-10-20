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
import { baserowBindings, baserowOperations, configureBaserowTable, createBaserowRow, registerBaserowRoutes } from '../src/integrations/baserow.js';
import { baserowHttpOperations } from '../src/integrations/baserow-http.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';

const prefix = '/api/v1/integrations/baserow';
const tableId = 123, fieldId = 'field_1', secondField = 'field_2', rowId = 1234;
const privateToken = 'synthetic-baserow-personal-token', privateValue = 'synthetic-private-row-content';
const configuration = (extra: Record<string, unknown> = {}) => ({ name: 'Synthetic data', instanceUrl: 'https://database.example.com', tableId, token: privateToken, allowCreate: true, ...extra });
const response = (data: unknown, status = 200) => ({ status, headers: {}, body: Buffer.from(JSON.stringify(data)) });
const metadata = () => response([{ id: 1, name: 'Name', type: 'text' }, { id: 2, name: 'Count', type: 'number' }]);
const accepted = () => response({ id: rowId, [fieldId]: privateValue });
const headerContext = (context: ExpectedRequestContext) => Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, context[key as keyof ExpectedRequestContext] ?? '-']));
async function fixture(t: TestContext) {
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(':memory:'), app = Fastify(), actor: Actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const token = randomBytes(32).toString('base64url'), cookies = { kloel_session: token };
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(token), actor.userId, actor.tenantId, Date.now() + 3600000);
  const calls: string[] = [], hooks: { dns?: () => void; request?: NonNullable<IntegrationTransport['request']> } = {};
  const transport: IntegrationTransport = { resolve: async () => { hooks.dns?.(); return [{ address: '93.184.216.34', family: 4 }]; }, request: async (...args) => { calls.push(args[2].method); return hooks.request ? hooks.request(...args) : args[2].method === 'GET' ? metadata() : accepted(); } };
  app.setErrorHandler((error, _req, reply) => error instanceof MembershipError ? reply.code(error.statusCode).send({ error: { code: error.code } }) : reply.code(500).send({ error: { code: 'fixture_unexpected' } }));
  await app.register(cookie); await registerAuth(app, store); await registerBaserowRoutes(app, store, transport);
  const freshHeaders = async (using = cookies) => { const me = await app.inject({ url: '/api/v1/auth/me', cookies: using }); assert.equal(me.statusCode, 200, me.body); return headerContext(me.json().context); };
  const headers = await freshHeaders();
  const send = (method: 'POST' | 'PUT' | 'PATCH', path: string, key: string, payload: unknown, using = headers) => app.inject({ method, url: prefix + path, cookies, headers: { ...using, 'idempotency-key': key }, payload });
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

test('Baserow HTTP configuration is canonical, atomic, scoped and recoverable by key without I/O', async t => {
  const f = await fixture(t), key = randomUUID(), payload = f.configBody();
  const first = await f.send('POST', '/tables', key, payload); assert.equal(first.statusCode, 201, first.body);
  const op = first.json().operation; assert.equal(op.kind, 'binding.create'); assert.equal(op.status, 'succeeded'); assert.equal(op.revision, 1); assert.equal(op.nativeOperationId, null); noSecrets(first.json());
  const replay = await f.send('POST', '/tables', key, f.configBody({ instanceUrl: 'https://DATABASE.example.com:443/', allowedRoles: ['admin', 'owner', 'owner'], enabled: true, agentIds: [] }));
  assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().replayed, true); assert.deepEqual(replay.json().operation, op);
  assert.equal(f.store.list(f.actor.tenantId, baserowBindings).length, 1); assert.equal(f.store.list(f.actor.tenantId, 'baserow-http-audit').length, 1);
  assert.ok(!f.snapshot().includes(privateToken));
  const before = f.snapshot(); assert.deepEqual((await f.get(key)).json(), op); assert.equal(f.snapshot(), before); assert.deepEqual(f.calls, []);
  const current = await f.app.inject({ url: prefix + '/tables/' + op.bindingId, cookies: f.cookies, headers: f.headers }); assert.equal(current.json().revision, 1); noSecrets(current.json());
  assert.equal((await f.send('POST', '/tables', key, f.configBody({ name: 'Different' }))).json().error.code, 'idempotency_conflict');
});

test('Baserow HTTP observed revision rejects stale effects but historical replay precedes CAS and disabled config', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  const body = { ...f.configBody({ name: 'Revision two', token: undefined }), expectedRevision: 1 };
  const changed = await f.send('PUT', '/tables/' + binding.bindingId, key, body); assert.equal(changed.statusCode, 200, changed.body); assert.equal(changed.json().operation.revision, 2);
  const newer = await f.send('PUT', '/tables/' + binding.bindingId, randomUUID(), { ...f.configBody({ enabled: false, token: undefined }), expectedRevision: 2 }); assert.equal(newer.json().operation.revision, 3);
  const replay = await f.send('PUT', '/tables/' + binding.bindingId, key, body); assert.equal(replay.statusCode, 200); assert.equal(replay.json().operation.revision, 2);
  const stale = await f.send('PUT', '/tables/' + binding.bindingId, randomUUID(), body); assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'baserow_configuration_changed');
  const write = await f.send('POST', '/tables/' + binding.bindingId + '/rows', randomUUID(), f.body()); assert.equal(write.statusCode, 409); assert.deepEqual(f.calls, []);
  const current = await f.app.inject({ url: prefix + '/tables/' + binding.bindingId, cookies: f.cookies, headers: f.headers }); assert.equal(current.json().enabled, false); assert.equal(current.json().revision, 3);
});

test('Baserow HTTP one key namespace rejects different kinds and another selected tenant before effects', async t => {
  const f = await fixture(t), key = randomUUID(), initial = await f.send('POST', '/tables', key, f.configBody()), id = initial.json().operation.bindingId;
  for (const [method, path, payload] of [['PUT', '/tables/' + id, { ...f.configBody(), expectedRevision: 1 }], ['POST', '/tables/' + id + '/rows', f.body()]] as const) {
    const result = await f.send(method, path, key, payload); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'idempotency_conflict');
  }
  const result = await f.send('POST', '/tables', randomUUID(), { ...f.configBody(), expectedTenantId: randomUUID() }); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'tenant_mismatch');
  assert.equal(f.store.list(f.actor.tenantId, baserowBindings).length, 1); assert.deepEqual(f.calls, []);
});

test('Baserow HTTP binding, encrypted credential, audit and receipt roll back together on final context veto', async t => {
  const f = await fixture(t), original = f.store.create.bind(f.store);
  f.store.create = (tenant, collection, data) => { const row = original(tenant, collection, data); if (collection === 'baserow-http-audit') f.aba(); return row; };
  const result = await f.send('POST', '/tables', randomUUID(), f.configBody()); assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'context_changed_in_flight');
  for (const collection of [baserowBindings, baserowHttpOperations, 'baserow-http-audit']) assert.equal(f.store.list(f.actor.tenantId, collection).length, 0);
  assert.deepEqual(f.calls, []);
});

test('Baserow HTTP encryption failure rolls back configuration and receipt and permits explicit same-key retry', async t => {
  const f = await fixture(t), key = randomUUID(), encryptionKey = process.env.OAUTH_ENCRYPTION_KEY; delete process.env.OAUTH_ENCRYPTION_KEY;
  const result = await f.send('POST', '/tables', key, f.configBody()); assert.equal(result.statusCode, 503, result.body);
  assert.equal(f.store.list(f.actor.tenantId, baserowBindings).length, 0); assert.equal((await f.get(key)).statusCode, 404);
  process.env.OAUTH_ENCRYPTION_KEY = encryptionKey;
  assert.equal((await f.send('POST', '/tables', key, f.configBody())).statusCode, 201);
});

test('Baserow HTTP remote intent and native linkage are durable before POST; lost browser response recovers without a second request', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  f.hooks.request = async (_url, _address, spec) => {
    if (spec.method === 'GET') return metadata();
    const http = f.store.list(f.actor.tenantId, baserowHttpOperations).find(row => row.key === key)!;
    assert.equal(http.status, 'pending'); assert.ok(http.nativeOperationId);
    const native = f.store.get(f.actor.tenantId, baserowOperations, String(http.nativeOperationId))!;
    assert.equal(native.httpOperationId, http.id); assert.equal(native.status, 'pending'); assert.ok(native.attemptedAt); return accepted();
  };
  // The first response is deliberately discarded; recovery is a GET of the original key.
  const sent = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); assert.equal(sent.statusCode, 200, sent.body);
  const before = f.snapshot(), calls = [...f.calls], recovered = await f.get(key); assert.equal(recovered.json().status, 'created'); assert.equal(recovered.json().rowId, rowId); noSecrets(recovered.json());
  assert.equal(f.snapshot(), before); assert.deepEqual(f.calls, calls);
  const reordered = { ...f.body(), values: { [secondField]: 3, [fieldId]: privateValue } };
  const replay = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, reordered); assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true); assert.equal(replay.json().operation.rowId, rowId); assert.deepEqual(f.calls, calls);
  f.store.update(f.actor.tenantId, baserowBindings, binding.bindingId, { enabled: false, revision: 2 });
  assert.equal((await f.get(key)).json().status, 'created'); assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body())).json().operation.status, 'created'); assert.deepEqual(f.calls, calls);
});

test('Baserow HTTP concurrent same-key preparation and attempted write both replay pending without sending twice', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  let releaseSchema!: () => void, releaseWrite!: () => void, schemaStarted!: () => void, writeStarted!: () => void;
  const schemaSignal = new Promise<void>(resolve => { schemaStarted = resolve; }), writeSignal = new Promise<void>(resolve => { writeStarted = resolve; });
  f.hooks.request = async (_u, _a, spec) => { if (spec.method === 'GET') { schemaStarted(); await new Promise<void>(resolve => { releaseSchema = resolve; }); return metadata(); } writeStarted(); await new Promise<void>(resolve => { releaseWrite = resolve; }); return accepted(); };
  const first = f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); await schemaSignal;
  const preparation = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); assert.equal(preparation.json().operation.status, 'pending'); assert.equal(preparation.json().operation.nativeOperationId, null);
  releaseSchema(); await writeSignal;
  const attempt = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); assert.equal(attempt.json().operation.status, 'pending'); assert.ok(attempt.json().operation.nativeOperationId);
  releaseWrite(); assert.equal((await first).json().operation.status, 'created'); assert.deepEqual(f.calls, ['GET', 'POST']);
});

test('Baserow HTTP native HTTP-error, uncertain and pending states remain faithful and never retry on recovery', async t => {
  const f = await fixture(t), binding = await f.create();
  for (const [label, expected] of [['rejected', 'uncertain'], ['lost', 'uncertain'], ['malformed', 'uncertain']] as const) {
    const key = randomUUID(); f.hooks.request = async (_u, _a, spec) => { if (spec.method === 'GET') return metadata(); if (label === 'lost') throw new Error(privateValue); return label === 'rejected' ? response({}, 403) : response({}); };
    const sent = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); assert.equal(sent.statusCode, 200, sent.body); assert.equal(sent.json().operation.status, expected); noSecrets(sent.json());
    const count = f.calls.length; assert.equal((await f.get(key)).json().status, expected); assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body())).json().operation.status, expected); assert.equal(f.calls.length, count);
    if (label === 'lost') { f.store.update(f.actor.tenantId, baserowOperations, sent.json().operation.nativeOperationId, { status: 'pending', encryptedResult: undefined }); const pending = await f.get(key); assert.equal(pending.json().status, 'pending'); assert.equal(pending.json().requiresReconciliation, true); assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body())).json().operation.status, 'pending'); assert.equal(f.calls.length, count); }
  }
});

test('Baserow HTTP schema/type failure is not_sent; config change during schema await blocks mutating transport', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  const invalid = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, { ...f.body(), values: { [secondField]: 'not a number' } }); assert.equal(invalid.statusCode, 400);
  assert.equal((await f.get(key)).json().status, 'not_sent'); assert.equal(f.calls.filter(x => x === 'POST').length, 0);
  const next = randomUUID(); f.hooks.request = async () => { f.store.update(f.actor.tenantId, baserowBindings, binding.bindingId, { revision: 2 }); return metadata(); };
  const changed = await f.send('POST', '/tables/' + binding.bindingId + '/rows', next, f.body()); assert.equal(changed.statusCode, 409); assert.equal(changed.json().error.code, 'baserow_configuration_changed'); assert.equal((await f.get(next)).json().status, 'not_sent'); assert.equal(f.calls.filter(x => x === 'POST').length, 0);
});

test('Baserow HTTP role ABA before DNS or during final accepted response denies disclosure without losing receipt', async t => {
  for (const stage of ['dns', 'accepted'] as const) await t.test(stage, async t => {
    const f = await fixture(t), binding = await f.create(), key = randomUUID();
    if (stage === 'dns') f.hooks.dns = () => { delete f.hooks.dns; f.aba(); };
    else f.hooks.request = async (_u, _a, spec) => { if (spec.method === 'GET') return metadata(); f.aba(); return accepted(); };
    const changed = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); assert.equal(changed.statusCode, 409); assert.equal(changed.json().error.code, 'context_changed_in_flight'); assert.ok(!changed.body.includes(String(rowId))); noSecrets(changed.json());
    const http = f.store.list(f.actor.tenantId, baserowHttpOperations).find(row => row.key === key)!;
    if (stage === 'dns') { assert.equal(http.status, 'not_sent'); assert.equal(http.nativeOperationId, null); assert.deepEqual(f.calls, []); }
    else { const native = f.store.get(f.actor.tenantId, baserowOperations, String(http.nativeOperationId))!; assert.equal(native.status, 'created'); assert.equal(native.rowId, rowId); assert.ok(native.encryptedResult); }
    const fresh = await f.freshHeaders(), calls = f.calls.length; assert.equal((await f.get(key, fresh)).statusCode, 404); assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body(), fresh)).json().error.code, 'idempotency_conflict'); assert.equal(f.calls.length, calls);
  });
});

test('Baserow HTTP receipts never migrate across operators, sessions, membership reinsertion or tenant cookies', async t => {
  for (const mutation of ['operator', 'session', 'membership', 'tenant'] as const) await t.test(mutation, async t => {
    const f = await fixture(t), key = randomUUID(), created = await f.send('POST', '/tables', key, f.configBody()); assert.equal(created.statusCode, 201);
    let userId = f.actor.userId, tenantId = f.actor.tenantId;
    if (mutation === 'operator') { userId = randomUUID(); seedMember(f.store, { ...f.actor, userId }); }
    if (mutation === 'tenant') { tenantId = randomUUID(); seedMember(f.store, { ...f.actor, tenantId }); }
    if (mutation === 'membership') { f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(userId, tenantId); seedMember(f.store, f.actor); }
    if (mutation !== 'membership') { f.cookies.kloel_session = randomBytes(32).toString('base64url'); f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(f.cookies.kloel_session), userId, tenantId, Date.now() + 60000); }
    const fresh = await f.freshHeaders(); assert.equal((await f.get(key, fresh)).statusCode, 404);
    const result = await f.send('POST', '/tables', key, f.configBody(), fresh); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, mutation === 'tenant' ? 'tenant_mismatch' : 'idempotency_conflict'); assert.equal(f.store.list(f.actor.tenantId, baserowBindings).length, 1); assert.deepEqual(f.calls, []);
  });
});

test('Baserow HTTP does not retroactively bind a legacy native receipt to a human session', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID();
  await createBaserowRow(f.store, f.actor, binding.bindingId, { values: f.body().values }, key, f.transport);
  const before = f.calls.length, result = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'legacy_operation_unrecoverable'); assert.equal((await f.get(key)).statusCode, 404);
  assert.equal(f.store.list(f.actor.tenantId, baserowHttpOperations).filter(x => x.kind === 'row.create').length, 0); assert.equal(f.calls.length, before);
});

test('Baserow HTTP malformed/foreign native linkage or contradictory state fails closed without effects', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID(), sent = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body());
  assert.equal(sent.statusCode, 200, sent.body);
  const http = f.store.list(f.actor.tenantId, baserowHttpOperations).find(x => x.key === key)!, native = f.store.get(f.actor.tenantId, baserowOperations, String(http.nativeOperationId))!, count = f.calls.length;
  for (const patch of [{ status: 'fabricated' }, { status: 'rejected', rowId }, { rowId: 'invalid' }, { httpOperationId: randomUUID() }, { revision: 2 }, { userId: randomUUID() }, { errorCode: 'Bearer synthetic-secret-value' }]) {
    f.store.update(f.actor.tenantId, baserowOperations, native.id, { ...native, ...patch }); const before = f.snapshot(), result = await f.get(key); assert.equal(result.statusCode, 409, JSON.stringify(patch)); assert.equal(result.json().error.code, 'baserow_operation_unavailable'); assert.equal(f.snapshot(), before); noSecrets(result.json());
  }
  f.store.update(f.actor.tenantId, baserowOperations, native.id, native);
  const foreign = f.store.create(randomUUID(), baserowOperations, { ...native, httpOperationId: http.id }); f.store.update(f.actor.tenantId, baserowHttpOperations, http.id, { nativeOperationId: foreign.id }); assert.equal((await f.get(key)).statusCode, 409);
  assert.equal(f.calls.length, count);
});

test('Baserow HTTP authorization inside reservation precedes local intent and supports no stale tenant mutation', async t => {
  const f = await fixture(t), binding = await f.create(), beforeCount = f.store.list(f.actor.tenantId, baserowHttpOperations).length;
  const transaction = f.store.transaction.bind(f.store); let changed = false;
  f.store.transaction = fn => { if (!changed) { changed = true; f.aba(); } return transaction(fn); };
  const result = await f.send('POST', '/tables/' + binding.bindingId + '/rows', randomUUID(), f.body()); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(f.store.list(f.actor.tenantId, baserowHttpOperations).length, beforeCount); assert.deepEqual(f.calls, []);
});

test('Baserow HTTP original-session receipts survive SQLite restart without schema, credential decryption or POST', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY, directory = mkdtempSync(join(tmpdir(), 'kloel-baserow-http-')), path = join(directory, 'synthetic.sqlite');
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  let store = new Store(path), app = Fastify(); const actor: Actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const token = randomBytes(32).toString('base64url'), cookies = { kloel_session: token }; store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(token), actor.userId, actor.tenantId, Date.now() + 60000);
  let calls = 0;
  const transport: IntegrationTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async (_u, _a, spec) => { calls++; if (spec.method === 'GET') return metadata(); throw new Error('synthetic lost response'); } };
  try {
    await app.register(cookie); await registerAuth(app, store); await registerBaserowRoutes(app, store, transport);
    const me = await app.inject({ url: '/api/v1/auth/me', cookies }), headers = headerContext(me.json().context), configurationKey = randomUUID(), recordKey = randomUUID();
    const configurationBody = { expectedTenantId: actor.tenantId, configuration: configuration() };
    const configured = await app.inject({ method: 'POST', url: prefix + '/tables', cookies, headers: { ...headers, 'idempotency-key': configurationKey }, payload: configurationBody }); assert.equal(configured.statusCode, 201, configured.body);
    const id = configured.json().operation.bindingId, recordBody = { expectedTenantId: actor.tenantId, expectedRevision: 1, values: { [fieldId]: privateValue } };
    const sent = await app.inject({ method: 'POST', url: prefix + '/tables/' + id + '/rows', cookies, headers: { ...headers, 'idempotency-key': recordKey }, payload: recordBody }); assert.equal(sent.json().operation.status, 'uncertain'); assert.equal(calls, 2);
    // Simulate a crash after native attemptedAt but before its final outcome was saved.
    store.update(actor.tenantId, baserowOperations, sent.json().operation.nativeOperationId, { status: 'pending', encryptedResult: undefined });
    await app.close(); store.close(); store = new Store(path); app = Fastify();
    delete process.env.OAUTH_ENCRYPTION_KEY; // GET/replay requires no plaintext credential or encrypted result.
    await app.register(cookie); await registerAuth(app, store); await registerBaserowRoutes(app, store, { resolve: async () => { throw new Error('recovery must not resolve'); }, request: async () => { calls++; throw new Error('recovery must not send'); } });
    const snapshot = JSON.stringify(store.db.prepare('SELECT * FROM entities ORDER BY id').all());
    const configReceipt = await app.inject({ url: prefix + '/operations/' + configurationKey, cookies, headers }); assert.equal(configReceipt.json().status, 'succeeded');
    const receipt = await app.inject({ url: prefix + '/operations/' + recordKey, cookies, headers }); assert.equal(receipt.json().status, 'pending'); assert.equal(receipt.json().requiresReconciliation, true); noSecrets(receipt.json());
    const replay = await app.inject({ method: 'POST', url: prefix + '/tables/' + id + '/rows', cookies, headers: { ...headers, 'idempotency-key': recordKey }, payload: recordBody }); assert.equal(replay.json().operation.status, 'pending'); assert.equal(replay.json().replayed, true);
    const configReplay = await app.inject({ method: 'POST', url: prefix + '/tables', cookies, headers: { ...headers, 'idempotency-key': configurationKey }, payload: configurationBody }); assert.equal(configReplay.json().operation.bindingId, id); assert.equal(configReplay.json().replayed, true);
    assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM entities ORDER BY id').all()), snapshot); assert.equal(calls, 2);
  } finally { await app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; }
});

test('Baserow HTTP set_enabled uses observed CAS, same-key historical receipt and a shared intent namespace', async t => {
  const f = await fixture(t), binding = await f.create(), id = binding.bindingId, key = randomUUID();
  const payload = { expectedTenantId: f.actor.tenantId, expectedRevision: 1, enabled: false };
  const [first, stale] = await Promise.all([f.send('PATCH', '/tables/' + id, key, payload), f.send('PATCH', '/tables/' + id, randomUUID(), payload)]);
  assert.equal(first.statusCode, 200, first.body); assert.equal(first.json().operation.kind, 'binding.set_enabled'); assert.equal(first.json().operation.revision, 2);
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'baserow_configuration_changed');
  const updated = await f.send('PATCH', '/tables/' + id, randomUUID(), { ...payload, expectedRevision: 2, enabled: true }); assert.equal(updated.json().operation.revision, 3);
  const before = f.snapshot(), replay = await f.send('PATCH', '/tables/' + id, key, payload); assert.equal(replay.json().replayed, true); assert.equal(replay.json().operation.revision, 2); assert.equal(f.snapshot(), before);
  assert.equal(f.store.get(f.actor.tenantId, baserowBindings, id)!.enabled, true);
  assert.equal((await f.send('POST', '/tables/' + id + '/rows', key, f.body(3))).json().error.code, 'idempotency_conflict');
  assert.equal((await f.send('PATCH', '/tables/' + id, key, { ...payload, enabled: true })).json().error.code, 'idempotency_conflict');
  assert.equal((await f.get(key)).json().revision, 2); assert.deepEqual(f.calls, []);
});

test('Baserow HTTP set_enabled rolls back binding/audit/receipt if authority changes before commit', async t => {
  const f = await fixture(t), binding = await f.create(), before = f.snapshot(), create = f.store.create.bind(f.store);
  f.store.create = (tenant, collection, data) => { const row = create(tenant, collection, data); if (collection === 'baserow-http-audit') f.aba(); return row; };
  const result = await f.send('PATCH', '/tables/' + binding.bindingId, randomUUID(), { expectedTenantId: f.actor.tenantId, expectedRevision: 1, enabled: false });
  assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(f.snapshot(), before); assert.deepEqual(f.calls, []);
});

test('Baserow HTTP refuses every old mutating contract without CAS/key, including enabled PATCH', async t => {
  const f = await fixture(t), binding = await f.create(), before = f.snapshot();
  for (const [method, path, payload] of [['POST', '/tables', configuration()], ['PUT', '/tables/' + binding.bindingId, configuration()], ['PATCH', '/tables/' + binding.bindingId, { enabled: false }], ['POST', '/tables/' + binding.bindingId + '/rows', { values: { [fieldId]: 'old' } }]] as const) {
    const result = await f.send(method, path, randomUUID(), payload); assert.equal(result.statusCode, 400, result.body);
  }
  assert.equal(f.snapshot(), before); assert.deepEqual(f.calls, []);
});

test('Baserow HTTP re-reads configuration inside BEGIN before deriving revision or retaining a token', async t => {
  const f = await fixture(t), binding = await f.create(), transaction = f.store.transaction.bind(f.store); let changed = false;
  f.store.transaction = fn => { if (!changed) { changed = true; f.store.update(f.actor.tenantId, baserowBindings, binding.bindingId, { revision: 2, name: 'Concurrent version' }); } return transaction(fn); };
  const result = await f.send('PUT', '/tables/' + binding.bindingId, randomUUID(), { ...f.configBody({ name: 'Stale edit', token: undefined }), expectedRevision: 1 });
  assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'baserow_configuration_changed'); assert.equal(f.store.get(f.actor.tenantId, baserowBindings, binding.bindingId)!.name, 'Concurrent version');
  assert.equal(f.store.list(f.actor.tenantId, baserowHttpOperations).length, 1); assert.deepEqual(f.calls, []);
});

test('Baserow HTTP native reservation after schema refuses role ABA before linking or sending', async t => {
  const f = await fixture(t), binding = await f.create(), key = randomUUID(), transaction = f.store.transaction.bind(f.store); let boundaries = 0;
  f.store.transaction = fn => { boundaries++; if (boundaries === 2) f.aba(); return transaction(fn); };
  const result = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'context_changed_in_flight');
  assert.deepEqual(f.calls, ['GET']); assert.equal(f.store.list(f.actor.tenantId, baserowOperations).length, 0);
  const http = f.store.list(f.actor.tenantId, baserowHttpOperations).find(row => row.key === key)!; assert.equal(http.status, 'not_sent'); assert.equal(http.nativeOperationId, null);
  assert.equal((await f.get(key, await f.freshHeaders())).statusCode, 404);
});

test('Baserow HTTP accepted IDs survive disabled config or missing storage key before final disclosure', async t => {
  for (const change of ['disabled', 'key'] as const) await t.test(change, async t => {
    const f = await fixture(t), binding = await f.create(), key = randomUUID();
    f.hooks.request = async (_u, _a, spec) => { if (spec.method === 'GET') return metadata(); if (change === 'disabled') f.store.update(f.actor.tenantId, baserowBindings, binding.bindingId, { enabled: false, revision: 2 }); else delete process.env.OAUTH_ENCRYPTION_KEY; return accepted(); };
    const result = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); assert.equal(result.statusCode, 503, result.body);
    const native = f.store.list(f.actor.tenantId, baserowOperations)[0]; assert.equal(native.status, 'created'); assert.equal(native.rowId, rowId); if (change === 'key') assert.equal(native.encryptedResult, undefined);
    const before = f.snapshot(), receipt = await f.get(key); assert.equal(receipt.json().status, 'created'); assert.equal(receipt.json().rowId, rowId); noSecrets(receipt.json());
    assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body())).json().operation.status, 'created'); assert.equal(f.snapshot(), before); assert.deepEqual(f.calls, ['GET', 'POST']);
  });
});

test('Baserow HTTP same-location 307 and 308 dispatch one POST and preserve uncertain receipts', async t => {
  for (const status of [307, 308]) await t.test(String(status), async t => {
    const f = await fixture(t), binding = await f.create(), key = randomUUID();
    f.hooks.request = async (url, _a, spec) => spec.method === 'GET' ? metadata() : { status, headers: { location: url.href }, body: Buffer.alloc(0) };
    const result = await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body()); assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().operation.status, 'uncertain'); assert.equal(result.json().operation.rowId, null);
    assert.deepEqual(f.calls, ['GET', 'POST']); assert.equal((await f.get(key)).json().status, 'uncertain');
    assert.equal((await f.send('POST', '/tables/' + binding.bindingId + '/rows', key, f.body())).json().operation.status, 'uncertain'); assert.deepEqual(f.calls, ['GET', 'POST']);
  });
});

test('Baserow HTTP remains whole-table and preserves decimal strings and numeric select option IDs', async t => {
  const f = await fixture(t), binding = await f.create();
  const fieldSchema = [{ id: 2, name: 'Exact amount', type: 'number' }, { id: 3, name: 'Status', type: 'single_select', select_options: [{ id: 31, value: 'Ready' }] }, { id: 4, name: 'Flags', type: 'multiple_select', select_options: [{ id: 41, value: 'One' }] }];
  f.hooks.request = async (_u, _a, spec) => { if (spec.method === 'GET') return response(fieldSchema); assert.deepEqual(JSON.parse(spec.body!.toString()), { field_2: '12345678901234567890.00', field_3: 31, field_4: [41] }); return response({ id: rowId }); };
  const result = await f.send('POST', '/tables/' + binding.bindingId + '/rows', randomUUID(), { ...f.body(), values: { field_2: '12345678901234567890.00', field_3: 31, field_4: [41] } }); assert.equal(result.json().operation.status, 'created');
  const invalid = await f.send('POST', '/tables/' + binding.bindingId + '/rows', randomUUID(), { ...f.body(), values: { field_3: 'Ready' } }); assert.equal(invalid.statusCode, 400); assert.equal(f.calls.filter(x => x === 'POST').length, 1);
  assert.equal((await f.send('POST', '/tables', randomUUID(), f.configBody({ fieldIds: [3] }))).statusCode, 400);
});

