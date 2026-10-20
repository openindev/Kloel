import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { sheetsFixture, sheetInput, sheetAck, spreadsheetId } from './fixtures/sheets-http.js';
import { appendSpreadsheetRows, registerSheetsRoutes, sheetsBindings, sheetsOperations } from '../src/oauth/sheets.js';
import { sheetsHttpOperations } from '../src/oauth/sheets-http.js';
import { registerAuth } from '../src/auth.js';
import { digest } from '../src/oauth/crypto.js';

type Fixture = Awaited<ReturnType<typeof sheetsFixture>>;
const rows = (f: Fixture) => f.store.list(f.actor.tenantId, sheetsHttpOperations);
const native = (f: Fixture) => f.store.list(f.actor.tenantId, sheetsOperations);
const payload = (f: Fixture, revision = 1) => ({ expectedTenantId: f.actor.tenantId, expectedRevision: revision });
const update = (f: Fixture, revision = 1, key = randomUUID()) => f.request('PUT', `${f.prefix}/${f.binding.id}`, { ...payload(f, revision), configuration: { name: 'Updated', allowAppend: true } }, key);

test('four kinds have local configuration CAS and immutable replay receipts after disconnection', async t => {
  const f = await sheetsFixture(t), createKey = randomUUID(), updateKey = randomUUID(), toggleKey = randomUUID();
  const body = { expectedTenantId: f.actor.tenantId, configuration: { spreadsheetId: 'another_spreadsheet_12345', name: '  New sheet  ', allowAppend: false, enabled: false } };
  const created = await f.request('POST', f.prefix, body, createKey); assert.equal(created.statusCode, 201, created.body); assert.equal(created.json().operation.kind, 'binding.create');
  const id = created.json().operation.bindingId, path = `${f.prefix}/${id}`;
  assert.equal((await f.request('GET', path)).json().name, 'New sheet'); assert.equal((await f.request('GET', path)).json().enabled, false);
  const changed = await f.request('PUT', path, { ...payload(f), configuration: { name: 'Changed', allowAppend: false } }, updateKey); assert.equal(changed.json().operation.revision, 2);
  const enabled = await f.request('PATCH', path, { ...payload(f, 2), enabled: true }, toggleKey); assert.equal(enabled.json().operation.revision, 3);
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { status: 'disconnected' });
  assert.equal((await f.operation(createKey)).json().revision, 1); assert.equal((await f.operation(updateKey)).json().revision, 2); assert.equal((await f.operation(toggleKey)).json().revision, 3);
  const replay = await f.request('POST', f.prefix, body, createKey); assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true); assert.equal(f.requests.length, 0);
  assert.equal((await f.request('PATCH', path, { ...payload(f, 3), enabled: false }, randomUUID())).statusCode, 200);
  assert.equal((await f.request('GET', path)).json().enabled, false);
  assert.equal((await f.request('PATCH', path, { ...payload(f, 4), enabled: true }, randomUUID())).json().error.code, 'integration_disconnected');
});

test('append admission stale is distinct and occurs before I/O, journal and audit', async t => {
  const f = await sheetsFixture(t);
  assert.equal((await f.append(randomUUID(), 2)).json().error.code, 'sheets_admission_revision_conflict');
  assert.equal((await update(f, 2)).json().error.code, 'spreadsheet_configuration_changed');
  assert.equal(rows(f).length, 0); assert.equal(native(f).length, 0); assert.equal(f.store.list(f.actor.tenantId, 'oauth-sheets-http-audit').length, 0); assert.equal(f.requests.length, 0);
});

test('RAW append links journals before one POST and historical DTO excludes cells and secrets', async t => {
  const f = await sheetsFixture(t), key = randomUUID();
  f.hooks.provider = request => {
    if (request.method === 'POST') {
      assert.equal(request.url.searchParams.get('valueInputOption'), 'RAW'); assert.equal(request.url.searchParams.get('insertDataOption'), 'INSERT_ROWS'); assert.equal(request.url.searchParams.get('includeValuesInResponse'), 'false');
      assert.deepEqual((request.body as any).values, sheetInput.rows); assert.equal(native(f)[0].httpOperationId, rows(f)[0].id); assert.equal(rows(f)[0].nativeOperationId, native(f)[0].id); assert.equal(rows(f)[0].status, 'pending');
    }
  };
  const response = await f.append(key); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().operation.kind, 'rows.append'); assert.equal(response.json().operation.status, 'appended');
  assert.equal(response.json().operation.result.updatedCells, 3); const known = await f.operation(key); assert.equal(known.headers['cache-control'], 'no-store');
  for (const secret of ['SUM(A1', 'synthetic-sheet-token', 'sessionHash', 'authorityVersion', 'fingerprint', 'synthetic-refresh']) assert.ok(!known.body.includes(secret));
  assert.ok(!JSON.stringify([...rows(f), ...native(f)]).includes('SUM(A1'));
  assert.equal((await f.append(key)).json().replayed, true); assert.equal((await f.append(key, 1, f.originalHeaders, [['different']])).json().error.code, 'idempotency_conflict'); assert.equal(f.requests.length, 1);
  const legacy = await f.request('GET', `/api/v1/oauth/connections/${f.connection.id}/sheets-operations`); assert.deepEqual(legacy.json().items, []);
});

test('unknown append remains replay-only while independent configuration can disable offline', async t => {
  const f = await sheetsFixture(t), key = randomUUID(); f.hooks.provider = request => { if (request.method === 'POST') throw Error('lost response'); };
  assert.equal((await f.append(key)).statusCode, 502); assert.equal((await f.operation(key)).json().status, 'uncertain');
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { status: 'disconnected' });
  assert.equal((await f.toggle(false)).statusCode, 200); assert.equal((await f.append(key)).json().operation.status, 'uncertain'); assert.equal((await f.operation(key)).json().automaticRetry, false); assert.equal(f.requests.length, 1);
  assert.equal((await f.request('GET', `${f.prefix}/${f.binding.id}`)).json().enabled, false);
});

test('configuration changed after accepted POST is generic409 and GET still recovers appended', async t => {
  const f = await sheetsFixture(t), key = randomUUID();
  f.hooks.provider = request => { if (request.method === 'POST') f.store.update(f.actor.tenantId, sheetsBindings, f.binding.id, { name: 'New version', revision: 2 }); };
  const result = await f.append(key); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'oauth_connection_changed'); assert.equal(native(f)[0].status, 'appended');
  assert.equal((await f.operation(key)).json().status, 'appended'); assert.equal((await f.append(key)).json().replayed, true); assert.equal(f.requests.length, 1);
});

test('accepted POST followed by role ABA remains durable but cannot be adopted or leaked through the legacy list', async t => {
  const f = await sheetsFixture(t), key = randomUUID(); f.hooks.provider = request => { if (request.method === 'POST') f.aba(); };
  const result = await f.append(key); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(native(f)[0].status, 'appended');
  assert.ok(!result.body.includes('updatedRange')); const fresh = f.headers();
  assert.equal((await f.operation(key, fresh)).statusCode, 404); assert.equal((await f.append(key, 1, fresh)).json().error.code, 'idempotency_conflict');
  assert.deepEqual((await f.request('GET', `/api/v1/oauth/connections/${f.connection.id}/sheets-operations`, undefined, undefined, fresh)).json().items, []); assert.equal(f.requests.length, 1);
});

test('OAuth refresh revocation records not_sent without a native receipt or resource POST', async t => {
  const f = await sheetsFixture(t), key = randomUUID(); f.setTokens(1);
  f.hooks.provider = request => { if (request.url.hostname === 'oauth2.googleapis.com') f.aba(); };
  const result = await f.append(key); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(rows(f)[0].status, 'not_sent'); assert.equal(native(f).length, 0);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url.hostname, 'oauth2.googleapis.com');
});

test('revision rechecked inside the native BEGIN blocks append even after HTTP reservation', async t => {
  const f = await sheetsFixture(t), exec = f.store.db.exec.bind(f.store.db); let begins = 0;
  f.store.db.exec = sql => { if (sql.startsWith('BEGIN') && ++begins === 2) f.store.update(f.actor.tenantId, sheetsBindings, f.binding.id, { revision: 2 }); return exec(sql); };
  const key = randomUUID(), result = await f.append(key); f.store.db.exec = exec;
  assert.equal(result.json().error.code, 'spreadsheet_configuration_changed'); assert.equal((await f.operation(key)).json().status, 'not_sent'); assert.equal(native(f).length, 0); assert.equal(f.requests.length, 0);
});

for (const boundary of ['BEGIN', 'final audit'] as const) test(`configuration authority guard at ${boundary} rolls back all local effects without headers`, async t => {
  const f = await sheetsFixture(t), before = f.store.get(f.actor.tenantId, sheetsBindings, f.binding.id), exec = f.store.db.exec.bind(f.store.db), create = f.store.create.bind(f.store); let armed = true;
  if (boundary === 'BEGIN') f.store.db.exec = sql => { if (armed && sql.startsWith('BEGIN')) { armed = false; f.aba(); } return exec(sql); };
  else f.store.create = (tenant, collection, body) => { const value = create(tenant, collection, body); if (armed && collection === 'oauth-sheets-http-audit') { armed = false; f.aba(); } return value; };
  const result = await f.toggle(false, 1, randomUUID(), {}); f.store.db.exec = exec; f.store.create = create;
  assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(armed, false); assert.deepEqual(f.store.get(f.actor.tenantId, sheetsBindings, f.binding.id), before); assert.equal(rows(f).length, 0); assert.equal(f.requests.length, 0);
});

test('native linking failure rolls back both pointers and produces recoverable not_sent', async t => {
  const f = await sheetsFixture(t), create = f.store.create.bind(f.store), key = randomUUID();
  f.store.create = (tenant, collection, data) => { if (collection === 'oauth-sheets-http-audit' && data.kind === 'rows.append') throw Error('audit storage failed'); return create(tenant, collection, data); };
  const result = await f.append(key); f.store.create = create; assert.equal(result.statusCode, 500); assert.equal(native(f).length, 0); assert.equal(rows(f)[0].nativeOperationId, null);
  assert.equal((await f.operation(key)).json().status, 'not_sent'); assert.equal((await f.append(key)).json().operation.status, 'not_sent'); assert.equal(f.requests.length, 0);
});

test('restart during pending refresh preserves HTTP key without another native operation or POST', async t => {
  const f = await sheetsFixture(t), key = randomUUID(); f.setTokens(1); let entered!: () => void, release!: () => void;
  const entry = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
  f.hooks.provider = async request => { if (request.url.hostname === 'oauth2.googleapis.com') { entered(); await held; } };
  const first = f.append(key); await entry; assert.equal(rows(f)[0].nativeOperationId, null); assert.equal((await f.operation(key)).json().status, 'pending');
  const restarted = Fastify(); await restarted.register(cookie); await registerAuth(restarted, f.store); await registerSheetsRoutes(restarted, f.store); t.after(() => restarted.close());
  const recovered = await restarted.inject({ url: `/api/v1/oauth/sheets/operations/${key}`, cookies: f.cookies, headers: f.originalHeaders }); assert.equal(recovered.json().status, 'pending');
  const replay = await restarted.inject({ method: 'POST', url: `${f.prefix}/${f.binding.id}/append`, cookies: f.cookies, headers: { ...f.originalHeaders, 'idempotency-key': key }, payload: { ...payload(f), ...sheetInput } }); assert.equal(replay.json().replayed, true); assert.equal(replay.json().operation.status, 'pending');
  assert.equal(native(f).length, 0); release(); assert.equal((await first).json().operation.status, 'appended'); assert.equal(f.requests.filter(r => r.url.hostname === 'sheets.googleapis.com' && r.method === 'POST').length, 1);
});

test('concurrent replay after native reservation reports pending without a second POST', async t => {
  const f = await sheetsFixture(t), key = randomUUID(); let entered!: () => void, release!: () => void;
  const entry = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
  f.hooks.provider = async request => { if (request.method === 'POST') { entered(); await held; } };
  const first = f.append(key); await entry; assert.equal((await f.append(key)).json().operation.status, 'pending'); assert.equal((await f.operation(key)).json().nativeOperationId, native(f)[0].id); release(); await first; assert.equal(f.requests.length, 1);
});

test('new session and membership reentry cannot adopt an original operation', async t => {
  const f = await sheetsFixture(t), key = randomUUID(); await f.append(key); const raw = randomUUID();
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(raw), f.actor.userId, f.actor.tenantId, Date.now() + 86400000);
  assert.equal((await f.app.inject({ url: `/api/v1/oauth/sheets/operations/${key}`, cookies: { kloel_session: raw } })).statusCode, 404);
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(f.actor.userId);
  f.store.db.prepare('INSERT INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,?,?)').run(randomUUID(), f.actor.userId, f.actor.tenantId, 'owner', new Date().toISOString());
  assert.equal((await f.operation(key, f.headers())).statusCode, 404); assert.equal((await f.append(key, 1, f.headers())).json().error.code, 'idempotency_conflict'); assert.equal(f.requests.length, 1);
});

test('a legacy native key is never adopted by V2 and native APIs keep their existing contract', async t => {
  const f = await sheetsFixture(t), key = randomUUID();
  const result = await appendSpreadsheetRows(f.store, f.actor, f.connection.id, f.binding.id, sheetInput, key); assert.equal(result.status, 'appended');
  assert.equal((await f.append(key)).json().error.code, 'legacy_operation_unrecoverable'); assert.equal((await f.operation(key)).statusCode, 404); assert.equal(rows(f).length, 0); assert.equal(f.requests.length, 1);
  assert.equal((await f.request('GET', `/api/v1/oauth/connections/${f.connection.id}/sheets-operations`)).json().items.length, 1);
});

test('acceptance persistence failure retains uncertain, never false success or automatic retry', async t => {
  const f = await sheetsFixture(t), key = randomUUID(), write = f.store.update.bind(f.store); let failOnce = true;
  f.store.update = (tenant, collection, id, value) => { if (failOnce && collection === sheetsOperations && value.status === 'appended') { failOnce = false; throw Error('accept storage failed'); } return write(tenant, collection, id, value); };
  assert.equal((await f.append(key)).statusCode, 500); f.store.update = write; assert.equal((await f.operation(key)).json().status, 'uncertain'); assert.equal((await f.append(key)).json().operation.status, 'uncertain'); assert.equal(f.requests.length, 1);
});

test('legacy weak envelopes, missing key and wrong tenant fail without I/O', async t => {
  const f = await sheetsFixture(t);
  for (const [method, url, body] of [['POST', f.prefix, { spreadsheetId, name: 'Legacy' }], ['PATCH', `${f.prefix}/${f.binding.id}`, { enabled: false }], ['POST', `${f.prefix}/${f.binding.id}/append`, sheetInput]] as const) {
    assert.equal((await f.request(method, url, body, randomUUID())).statusCode, 400);
  }
  assert.equal((await f.request('POST', `${f.prefix}/${f.binding.id}/append`, { ...payload(f), ...sheetInput })).statusCode, 400);
  assert.equal((await f.request('POST', `${f.prefix}/${f.binding.id}/append`, { ...payload(f), expectedTenantId: 'another-tenant', ...sheetInput }, randomUUID())).json().error.code, 'tenant_mismatch');
  assert.equal(rows(f).length, 0); assert.equal(f.requests.length, 0);
});

test('current member can execute an owned connection but cannot manage bindings', async t => {
  const f = await sheetsFixture(t); f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('member', f.actor.userId); const current = f.headers();
  assert.equal((await f.toggle(false, 1, randomUUID(), current)).statusCode, 403);
  assert.equal((await f.append(randomUUID(), 1, current)).json().operation.status, 'appended');
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { userId: randomUUID(), visibility: 'shared' });
  assert.equal((await f.append(randomUUID(), 1, current)).json().error.code, 'connection_not_found'); assert.equal(f.requests.length, 1);
});

test('authority lost after native reservation COMMIT blocks transport even without expected headers', async t => {
  const f = await sheetsFixture(t), exec = f.store.db.exec.bind(f.store.db); let commits = 0;
  f.store.db.exec = sql => { const result = exec(sql); if (sql.startsWith('COMMIT') && ++commits === 2) f.aba(); return result; };
  const response = await f.append(randomUUID(), 1, {}); f.store.db.exec = exec;
  assert.equal(response.json().error.code, 'context_changed_in_flight'); assert.equal(commits, 2); assert.equal(native(f)[0].status, 'not_sent'); assert.equal(rows(f)[0].nativeOperationId, native(f)[0].id); assert.equal(f.requests.length, 0);
});
