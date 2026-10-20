import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Store } from '../src/store.js';
import { registerDomains } from '../src/domains.js';
import { seedMember } from './fixtures/membership.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const app = Fastify(), store = new Store();
  for (const tenantId of ['company-a', 'company-b']) {
    seedMember(store, { userId: tenantId + '-owner', tenantId, role: 'owner' });
    seedMember(store, { userId: tenantId + '-viewer', tenantId, role: 'viewer' });
    store.db.prepare('UPDATE organizations SET name=? WHERE id=?').run('Empresa real ' + tenantId, tenantId);
  }
  app.addHook('preHandler', async request => {
    const tenantId = String(request.headers['x-tenant'] ?? 'company-a');
    const role = request.headers['x-role'] === 'viewer' ? 'viewer' : 'owner';
    request.actor = { userId: tenantId + '-' + role, tenantId, role };
  });
  await registerDomains(app, store); await app.ready();
  t.after(async () => { await app.close(); store.close(); });
  const get = (headers = {}) => app.inject({ url: '/api/v1/organization-settings', headers });
  const put = (payload: Record<string, unknown>, headers = {}) => app.inject({ method: 'PUT', url: '/api/v1/organization-settings', payload, headers });
  return { app, store, get, put };
}

test('company DTO uses actual organization name, fills defaults and never leaks entity internals', async t => {
  const h = await fixture(t), first = await h.get();
  assert.equal(first.statusCode, 200);
  const dto = first.json();
  assert.equal(dto.name, 'Empresa real company-a'); assert.equal(dto.id, null);
  assert.equal(dto.tenantId, 'company-a'); assert.equal(dto.country, 'BR');
  assert.equal(dto.website, null); assert.equal(dto.supportEmail, null); assert.match(dto.version, /^[a-f0-9]{64}$/);
  assert.equal(h.store.list('company-a', 'organization-settings').length, 0, 'GET is read-only');
  h.store.create('company-a', 'organization-settings', { name: 'Persistida', privateToken: 'must-never-be-projected', revision: 44, country: 'BR' });
  const persisted = await h.get();
  assert.equal(persisted.json().name, 'Persistida');
  assert.equal(persisted.body.includes('must-never-be-projected'), false);
  assert.equal('revision' in persisted.json(), false); assert.equal('createdAt' in persisted.json(), false);
});

test('company updates require the observed version, preserve singleton and normalize supported fields', async t => {
  const h = await fixture(t), initial = (await h.get()).json();
  assert.equal((await h.put({ name: 'Nova' })).statusCode, 400);
  const updated = await h.put({ name: '  Nova empresa  ', supportEmail: ' SUPORTE@EXAMPLE.TEST ', timezone: 'America/Manaus', country: 'BR', expectedVersion: initial.version });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().name, 'Nova empresa'); assert.equal(updated.json().supportEmail, 'suporte@example.test');
  assert.notEqual(updated.json().version, initial.version);
  assert.equal(h.store.db.prepare('SELECT name FROM organizations WHERE id=?').get('company-a')?.name, 'Nova empresa');
  const stale = await h.put({ name: 'Sobrescrita', expectedVersion: initial.version });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'organization_settings_conflict');
  assert.equal((await h.get()).json().name, 'Nova empresa');
  assert.equal(h.store.list('company-a', 'organization-settings').length, 1);
});

test('company revision detects ABA even when timestamps and final fields are identical', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-18T00:00:00.000Z') });
  const h = await fixture(t), initial = (await h.get()).json();
  const a = (await h.put({ name: 'A', expectedVersion: initial.version })).json();
  const before = h.store.list('company-a', 'organization-settings')[0];
  const b = (await h.put({ name: 'B', expectedVersion: a.version })).json();
  const a2 = (await h.put({ name: 'A', expectedVersion: b.version })).json();
  const after = h.store.list('company-a', 'organization-settings')[0];
  assert.equal(before.updatedAt, after.updatedAt); assert.equal(before.name, after.name);
  assert.notEqual(a.version, a2.version);
  const rejected = await h.put({ name: 'Stale edit', expectedVersion: a.version });
  assert.equal(rejected.statusCode, 409);
  assert.equal(h.store.list('company-a', 'organization-settings')[0].revision, 3);
});

test('company versions are tenant-bound and viewers cannot write', async t => {
  const h = await fixture(t), a = (await h.get()).json();
  const b = (await h.get({ 'x-tenant': 'company-b' })).json();
  assert.notEqual(a.version, b.version);
  assert.equal((await h.put({ name: 'Leak', expectedVersion: a.version }, { 'x-tenant': 'company-b' })).statusCode, 409);
  assert.equal((await h.get({ 'x-role': 'viewer' })).statusCode, 200);
  assert.equal((await h.put({ name: 'Escalation', expectedVersion: a.version }, { 'x-role': 'viewer' })).statusCode, 403);
  assert.equal(h.store.list('company-b', 'organization-settings').length, 0);
});

test('company input rejects system fields, unsupported currency and nested extras without changes', async t => {
  const h = await fixture(t), initial = (await h.get()).json();
  for (const extra of [{ revision: 9 }, { tenantId: 'company-b' }, { version: initial.version }, { currency: 'USD' }, { country: 'br' }, { website: 'javascript:alert(1)' }, { notifications: { newConversation: true, secret: 'no' } }]) {
    const response = await h.put({ name: 'Bad', expectedVersion: initial.version, ...extra });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.deepEqual((await h.get()).json(), initial);
});

test('company write rechecks membership at transaction boundary', async t => {
  const h = await fixture(t), initial = (await h.get()).json();
  const original = h.store.transaction.bind(h.store);
  let injected = false;
  h.store.transaction = function<T>(fn: () => T): T {
    if (!injected) { injected = true; h.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run('company-a-owner', 'company-a'); }
    return original(fn);
  };
  const response = await h.put({ name: 'Revoked owner', expectedVersion: initial.version });
  assert.ok([401, 403].includes(response.statusCode), response.body);
  assert.equal(h.store.list('company-a', 'organization-settings').length, 0);
  assert.equal(h.store.db.prepare('SELECT name FROM organizations WHERE id=?').get('company-a')?.name, initial.name);
});

test('company edit rollback preserves previous fields and revision after storage failure', async t => {
  const h = await fixture(t), initial = (await h.get()).json();
  const before = (await h.put({ name: 'Original', expectedVersion: initial.version })).json();
  const original = h.store.update.bind(h.store);
  h.store.update = (...args) => { original(...args); throw new Error('Injected persistence failure'); };
  const failed = await h.put({ name: 'Uncommitted', expectedVersion: before.version });
  assert.equal(failed.statusCode, 500);
  assert.deepEqual((await h.get()).json(), before);
  assert.equal(h.store.db.prepare('SELECT name FROM organizations WHERE id=?').get('company-a')?.name, 'Original');
});

