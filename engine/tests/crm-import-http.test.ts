import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { seedMember } from './fixtures/membership.js';
import { resolveSessionContext } from '../src/request-context.js';
import { importOperations } from '../src/crm/import-operations.js';
import { commitCRMImport, previewCRMImport } from '../src/crm/import.js';
import { createContact, getContact, getSettings, saveSettings } from '../src/crm/service.js';

const base = '/api/v1/crm/import', hash = (s: string) => createHash('sha256').update(s).digest('hex');
const snapshot = (store: Store) => store.db.prepare('SELECT * FROM entities ORDER BY rowid').all();
const options = () => ({ bundle: { format: 'kloel.contacts', version: 2, definitions: [] as any[], contacts: [{ data: { firstName: 'Ana', lastName: 'Importada', emails: [{ value: 'ana.import@example.test' }] } }] as any[] } });
async function fixture(t: any, persistent = false) {
  const dir = persistent ? mkdtempSync(join(tmpdir(), 'kloel-import-')) : undefined;
  const path = dir ? join(dir, 'engine.sqlite') : ':memory:';
  let store = new Store(path), app = await buildApp(store, { workers: false });
  const tenant = 'import-http-tenant', actor = { userId: 'import-http-owner', tenantId: tenant, role: 'owner' as const };
  const identities = { owner: actor, other: { ...actor, userId: 'import-http-other' }, viewer: { ...actor, userId: 'import-http-viewer', role: 'viewer' as const }, foreign: { ...actor, userId: 'import-http-foreign', tenantId: 'import-foreign' } };
  const cookies: Record<string, string> = {};
  for (const [name, member] of Object.entries(identities)) {
    seedMember(store, member); cookies[name] = 'import-cookie-' + name;
    store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(cookies[name]), member.userId, member.tenantId, Date.now() + 86400000);
  }
  cookies.second = 'import-cookie-second'; store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(cookies.second), actor.userId, tenant, Date.now() + 86400000);
  const headers = (name = 'owner') => {
    const c = resolveSessionContext(store, hash(cookies[name]))!.context;
    return { 'x-kloel-expected-user': c.userId, 'x-kloel-expected-tenant': c.tenantId ?? '-', 'x-kloel-expected-membership': c.membershipId ?? '-', 'x-kloel-expected-authority': c.authorityVersion };
  };
  const request = (method: any, suffix: string, payload?: unknown, key?: string, name = 'owner', context = headers(name)) => app.inject({ method, url: base + suffix, cookies: { kloel_session: cookies[name] }, headers: { ...context, ...(key ? { 'idempotency-key': key } : {}) }, ...(payload === undefined ? {} : { payload }) });
  const preview = async (input = options()) => {
    const result = await request('POST', '/preview', { expectedTenantId: tenant, options: input }); assert.equal(result.statusCode, 200, result.body);
    return { input, response: result, body: { expectedTenantId: tenant, options: input, previewFingerprint: result.json().fingerprint } };
  };
  const restart = async () => { await app.close(); store = new Store(path); app = await buildApp(store, { workers: false }); };
  t.after(async () => { await app.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { get app() { return app; }, get store() { return store; }, actor, tenant, cookies, identities, headers, request, preview, restart };
}

test('preview is read-only, explicitly tenant-bound and restricted to human bulk permission', async t => {
  const f = await fixture(t), before = snapshot(f.store), input = options();
  const p = await f.preview(input); assert.equal(p.response.json().canCommit, true); assert.equal(p.response.headers['cache-control'], 'no-store'); assert.deepEqual(snapshot(f.store), before);
  assert.equal((await f.request('POST', '/preview', input)).statusCode, 400);
  assert.equal((await f.request('POST', '/preview', { expectedTenantId: 'wrong-tenant', options: input })).statusCode, 409);
  assert.equal((await f.request('POST', '/preview', { expectedTenantId: f.tenant, options: input }, undefined, 'viewer')).statusCode, 403);
  assert.equal((await f.app.inject({ method: 'POST', url: base + '/preview', payload: { expectedTenantId: f.tenant, options: input } })).statusCode, 401);
  assert.deepEqual(snapshot(f.store), before);
});

test('one reviewed commit stores scoped metadata and retains false/zero without importing permission evidence', async t => {
  const f = await fixture(t), input = options();
  input.bundle.definitions = [{ id: 'flag', key: 'flag', label: 'Flag', type: 'boolean' }, { id: 'amount', key: 'amount', label: 'Amount', type: 'number' }];
  input.bundle.contacts[0].data.fieldValues = { flag: false, amount: '0' };
  input.bundle.contacts[0].legacyData = { consent: { email: true }, privateHistory: 'must not appear in receipt' };
  const { body } = await f.preview(input), key = randomUUID(), res = await f.request('POST', '/commit', body, key);
  assert.equal(res.statusCode, 200, res.body); const { operation, replayed } = res.json();
  assert.equal(replayed, false); assert.equal(operation.status, 'succeeded'); assert.equal(operation.kind, 'import.commit'); assert.equal(operation.automaticRetry, false);
  assert.deepEqual(operation.result.summary, { total: 1, create: 1, merge: 0, error: 0 });
  const contact = getContact(f.store, f.tenant, operation.result.changes[0].id), fields = getSettings(f.store, f.tenant).definitions;
  assert.equal(contact.fieldValues[fields.find(d => d.key === 'flag')!.id], false); assert.equal(contact.fieldValues[fields.find(d => d.key === 'amount')!.id], '0');
  assert.equal((contact.consent as any).email, false); assert.deepEqual(f.store.list(f.tenant, 'contact-permission-events'), []);
  assert.equal(f.store.list(f.tenant, importOperations).length, 1); assert.equal(f.store.list(f.tenant, 'crm-import-http-audit').length, 1);
  for (const secret of ['Ana', 'ana.import@example.test', 'privateHistory', 'sessionHash', 'authorityVersion', 'fingerprint', 'encrypted']) assert.equal(res.body.includes(secret), false, secret);
});

test('response loss and parallel same-key requests recover one historical result before stale-preview checks', async t => {
  const f = await fixture(t), { body } = await f.preview(), key = randomUUID();
  assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 404);
  const responses = await Promise.all([f.request('POST', '/commit', body, key), f.request('POST', '/commit', body, key)]);
  assert.ok(responses.every(r => r.statusCode === 200)); assert.deepEqual(responses.map(r => r.json().replayed).sort(), [false, true]);
  const op = responses[0].json().operation;
  f.store.remove(f.tenant, 'contacts', op.result.changes[0].id);
  const before = snapshot(f.store), read = await f.request('GET', '/operations/' + key); assert.equal(read.statusCode, 200); assert.deepEqual(read.json(), op); assert.equal(read.headers['cache-control'], 'no-store');
  const reordered = { options: { bundle: { contacts: body.options.bundle.contacts, definitions: [], version: 2, format: 'kloel.contacts' } }, previewFingerprint: body.previewFingerprint, expectedTenantId: f.tenant };
  const replay = await f.request('POST', '/commit', reordered, key); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), { operation: op, replayed: true });
  assert.deepEqual(snapshot(f.store), before);
});

test('different payload or preview under the same key conflicts without any additional effect', async t => {
  const f = await fixture(t), { body } = await f.preview(), key = randomUUID(); assert.equal((await f.request('POST', '/commit', body, key)).statusCode, 200); const before = snapshot(f.store);
  for (const changed of [{ ...body, previewFingerprint: '0'.repeat(64) }, { ...body, options: { ...body.options, mode: 'merge' } }]) {
    const r = await f.request('POST', '/commit', changed, key); assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'idempotency_conflict');
  }
  assert.deepEqual(snapshot(f.store), before);
});

for (const name of ['second', 'other', 'foreign'] as const) test(`receipt cannot be adopted by ${name} session or tenant`, async t => {
  const f = await fixture(t), { body } = await f.preview(), key = randomUUID(); assert.equal((await f.request('POST', '/commit', body, key)).statusCode, 200); const before = snapshot(f.store);
  assert.equal((await f.request('GET', '/operations/' + key, undefined, undefined, name)).statusCode, 404);
  const replay = await f.request('POST', '/commit', body, key, name); assert.equal(replay.statusCode, 409);
  assert.deepEqual(snapshot(f.store), before);
});

for (const mutation of ['role-aba', 'membership-rejoin', 'expired-session'] as const) test(`${mutation} cannot inherit the original operation`, async t => {
  const f = await fixture(t), { body } = await f.preview(), key = randomUUID(), original = f.headers();
  assert.equal((await f.request('POST', '/commit', body, key)).statusCode, 200);
  if (mutation === 'role-aba') { f.store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=?").run(f.actor.userId); f.store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(f.actor.userId); }
  else if (mutation === 'membership-rejoin') { f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.actor.userId, f.tenant); seedMember(f.store, f.actor); }
  else f.store.db.prepare('UPDATE sessions SET expires=0 WHERE hash=?').run(hash(f.cookies.owner));
  const before = snapshot(f.store);
  const stale = await f.request('GET', '/operations/' + key, undefined, undefined, 'owner', original); assert.notEqual(stale.statusCode, 200);
  if (mutation !== 'expired-session') {
    assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 404);
    assert.equal((await f.request('POST', '/commit', body, key)).json().error.code, 'idempotency_conflict');
  }
  assert.deepEqual(snapshot(f.store), before);
});

test('stale preview or erroneous row commits no partial contacts, settings or receipts', async t => {
  const f = await fixture(t), { body } = await f.preview(); createContact(f.store, f.tenant, { firstName: 'Concurrent' }, f.actor.userId); const before = snapshot(f.store);
  const stale = await f.request('POST', '/commit', body, randomUUID()); assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'preview_stale'); assert.deepEqual(snapshot(f.store), before);
  const input = options(); input.bundle.contacts.push({ data: { firstName: 'Duplicate', emails: [{ value: 'ana.import@example.test' }] } });
  const invalid = await f.preview(input); assert.equal(invalid.response.json().canCommit, false);
  const rejected = await f.request('POST', '/commit', invalid.body, randomUUID()); assert.equal(rejected.statusCode, 409); assert.equal(rejected.json().error.code, 'import_has_errors'); assert.deepEqual(snapshot(f.store), before);
});

for (const failingCollection of [importOperations, 'crm-import-http-audit'] as const) test(`failure writing ${failingCollection} rolls back contacts, definitions and native receipt`, async t => {
  const f = await fixture(t); saveSettings(f.store, f.tenant, { autoCapture: true, definitions: [] }, 0, f.actor.userId);
  const input = options(); input.bundle.definitions.push({ key: 'new_flag', label: 'New flag', type: 'boolean' });
  const { body } = await f.preview(input), before = snapshot(f.store), create = f.store.create.bind(f.store);
  f.store.create = ((tenant, collection, data) => { if (collection === failingCollection) throw new Error('Injected receipt failure'); return create(tenant, collection, data); }) as typeof f.store.create;
  const result = await f.request('POST', '/commit', body, randomUUID()); assert.equal(result.statusCode, 500); assert.deepEqual(snapshot(f.store), before); assert.equal(getSettings(f.store, f.tenant).autoCapture, true);
});

test('authority change after contact creation rolls the entire import back', async t => {
  const f = await fixture(t), { body } = await f.preview(), before = snapshot(f.store), create = f.store.create.bind(f.store);
  f.store.create = ((tenant, collection, data) => {
    const row = create(tenant, collection, data);
    if (collection === 'contacts') { f.store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=?").run(f.actor.userId); f.store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(f.actor.userId); }
    return row;
  }) as typeof f.store.create;
  const result = await f.request('POST', '/commit', body, randomUUID()); assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.deepEqual(snapshot(f.store), before);
});

test('legacy domain receipts are not relabeled as session-owned imports', async t => {
  const f = await fixture(t), input = options(), plan = previewCRMImport(f.store, f.tenant, input), key = randomUUID();
  commitCRMImport(f.store, f.tenant, f.actor.userId, input, plan.fingerprint, key);
  const before = snapshot(f.store), response = await f.request('POST', '/commit', { expectedTenantId: f.tenant, options: input, previewFingerprint: plan.fingerprint }, key);
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'legacy_operation_unrecoverable'); assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 404); assert.deepEqual(snapshot(f.store), before);
});

test('SQLite restart preserves original scoped receipt without importing again', async t => {
  const f = await fixture(t, true), { body } = await f.preview(), key = randomUUID(), first = await f.request('POST', '/commit', body, key); assert.equal(first.statusCode, 200);
  const op = first.json().operation, before = snapshot(f.store); await f.restart();
  assert.deepEqual((await f.request('GET', '/operations/' + key)).json(), op);
  assert.deepEqual((await f.request('POST', '/commit', body, key)).json(), { operation: op, replayed: true }); assert.deepEqual(snapshot(f.store), before);
});


for (const mergePolicy of ['fill_empty', 'overwrite_supplied'] as const) test(`HTTP merge ${mergePolicy} distinguishes explicit empty strings from omitted values`, async t => {
  const f = await fixture(t);
  const old = createContact(f.store, f.tenant, { firstName: 'Original', lastName: 'Person', company: 'Old company', notes: 'Old notes', timezone: 'Europe/Lisbon', emails: [{ value: 'empty@example.test', label: 'WORK' }] }, f.actor.userId);
  const input: any = { bundle: { format: 'kloel.contacts', version: 2, definitions: [], contacts: [{ data: { company: '', notes: '', emails: [{ value: 'empty@example.test' }] } }] }, mode: 'merge', mergePolicy };
  const { body } = await f.preview(input), key = randomUUID(), response = await f.request('POST', '/commit', body, key);
  assert.equal(response.statusCode, 200, response.body);
  const saved = getContact(f.store, f.tenant, old.id);
  assert.equal(saved.company, mergePolicy === 'overwrite_supplied' ? '' : 'Old company');
  assert.equal(saved.notes, mergePolicy === 'overwrite_supplied' ? '' : 'Old notes');
  assert.equal(saved.firstName, 'Original'); assert.equal(saved.lastName, 'Person'); assert.equal(saved.timezone, 'Europe/Lisbon'); assert.equal(saved.emails[0].label, 'WORK');
  const before = snapshot(f.store);
  assert.equal((await f.request('POST', '/commit', body, key)).json().replayed, true); assert.deepEqual(snapshot(f.store), before);
});

for (const mode of ['create', 'merge'] as const) for (const first of ['original', 'replacement'] as const) test(`global preview CAS prevents two imports from the same state: ${mode}, ${first} first`, async t => {
  const f = await fixture(t);
  if (mode === 'merge') createContact(f.store, f.tenant, { firstName: 'Old', emails: [{ value: 'same@example.test' }] }, f.actor.userId);
  const input: any = { bundle: { format: 'kloel.contacts', version: 2, definitions: [], contacts: [{ data: mode === 'create' ? { firstName: 'Name only' } : { firstName: 'New', emails: [{ value: 'same@example.test' }] } }] }, mode, mergePolicy: 'overwrite_supplied' };
  const original = await f.preview(input), replacement = await f.preview(structuredClone(input));
  assert.equal(original.body.previewFingerprint, replacement.body.previewFingerprint);
  const requests = { original: { body: original.body, key: randomUUID() }, replacement: { body: replacement.body, key: randomUUID() } };
  const winner = requests[first], loser = requests[first === 'original' ? 'replacement' : 'original'];
  assert.equal((await f.request('POST', '/commit', winner.body, winner.key)).statusCode, 200);
  const before = snapshot(f.store), rejected = await f.request('POST', '/commit', loser.body, loser.key);
  assert.equal(rejected.statusCode, 409); assert.equal(rejected.json().error.code, 'preview_stale'); assert.deepEqual(snapshot(f.store), before);
  assert.equal(f.store.list(f.tenant, 'contacts').length, 1);
  assert.equal((await f.request('POST', '/commit', winner.body, winner.key)).json().replayed, true);
});

test('new definitions preserve the global capture flag and creation gate', async t => {
  const f = await fixture(t);
  saveSettings(f.store, f.tenant, { autoCapture: true, creationGate: 'Only explicit introductions', definitions: [] }, 0, f.actor.userId);
  const input = options(); input.bundle.definitions = [{ key: 'new_field', label: 'New field', type: 'boolean' }];
  const { body } = await f.preview(input), res = await f.request('POST', '/commit', body, randomUUID());
  assert.equal(res.statusCode, 200, res.body);
  const settings = getSettings(f.store, f.tenant);
  assert.equal(settings.autoCapture, true); assert.equal(settings.creationGate, 'Only explicit introductions');
  assert.equal(settings.definitions[0].aiFill, false);
  assert.equal(f.store.list(f.tenant, 'crm-capture-grants').length, 0);
});

test('malformed or ambiguous journal fails closed and GET never repairs it', async t => {
  const f = await fixture(t), { body } = await f.preview(), key = randomUUID(); assert.equal((await f.request('POST', '/commit', body, key)).statusCode, 200);
  const row = f.store.list(f.tenant, importOperations)[0]; f.store.update(f.tenant, importOperations, row.id, { result: { ...(row.result as any), summary: { total: 999, create: 999, merge: 0, error: 0 } } });
  let before = snapshot(f.store); assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 409); assert.deepEqual(snapshot(f.store), before);
  const { id, createdAt, updatedAt, tenantId, ...data } = row; f.store.create(f.tenant, importOperations, data);
  before = snapshot(f.store); assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 409); assert.deepEqual(snapshot(f.store), before);
});
