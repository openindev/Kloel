import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';

const route = '/api/v1/account/profile';
const cookies = (response: any) => ({ kloel_session: response.cookies.find((c: any) => c.name === 'kloel_session').value as string });
const signup = (app: Awaited<ReturnType<typeof buildApp>>, email: string) => app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password: 'profile-test-password', organization: 'Profile fixture' } });

test('profile persists across restart and remains global across organizations without exposing credentials', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'kloel-profile-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let app = await buildApp(new Store(join(dir, 'db.sqlite'))); t.after(() => app.close());
  const account = await signup(app, 'profile@example.test'), jar = cookies(account);
  const initial = await app.inject({ url: route, cookies: jar });
  assert.equal(initial.statusCode, 200); assert.equal(initial.json().revision, 0); assert.equal(initial.json().profileCreatedAt, null);
  const saved = await app.inject({ method: 'PATCH', url: route, cookies: jar, payload: { revision: 0, firstName: '  Ana ', lastName: ' Silva ', language: 'pt-br', phone: '+55 (11) 99999-9999' } });
  assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().phone, '+5511999999999'); assert.equal(saved.json().language, 'pt-BR');
  assert.equal(saved.json().firstName, 'Ana'); assert.equal(saved.json().revision, 1); assert.ok(!saved.body.includes('password'));
  const org = await app.inject({ method: 'POST', url: '/api/v1/organizations', cookies: jar, payload: { name: 'Second organization' } });
  const selected = await app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: jar, payload: { tenantId: org.json().tenantId } });
  const secondJar = cookies(selected);
  assert.deepEqual((await app.inject({ url: route, cookies: secondJar })).json(), saved.json());
  await app.close(); app = await buildApp(new Store(join(dir, 'db.sqlite')));
  assert.deepEqual((await app.inject({ url: route, cookies: secondJar })).json(), saved.json());
});

test('profile is private to identity, works without membership, and cannot change authentication or roles', async t => {
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const a = await signup(app, 'first@example.test'), b = await signup(app, 'second@example.test');
  const jar = cookies(a), other = cookies(b);
  assert.equal((await app.inject({ method: 'PATCH', url: route, cookies: jar, payload: { revision: 0, firstName: 'Private name' } })).statusCode, 200);
  assert.equal((await app.inject({ url: route, cookies: other })).json().firstName, '');
  for (const extra of [{ userId: b.json().userId }, { tenantId: b.json().tenantId }, { email: 'replacement@example.test' }, { password: 'replacement-password' }, { role: 'owner' }]) {
    assert.equal((await app.inject({ method: 'PATCH', url: route, cookies: jar, payload: { revision: 1, firstName: 'Rejected', ...extra } })).statusCode, 400);
  }
  store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(a.json().userId);
  const read = await app.inject({ url: route, cookies: jar }); assert.equal(read.statusCode, 200); assert.equal(read.json().firstName, 'Private name');
  assert.equal((await app.inject({ method: 'PATCH', url: route, cookies: jar, payload: { revision: 1, language: 'en-US' } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/v1/agents', cookies: jar })).statusCode, 403);
  assert.equal(store.db.prepare('SELECT email FROM users WHERE id=?').get(a.json().userId)?.email, 'first@example.test');
});

test('stale edits conflict and malformed profile fields cannot overwrite persisted data', async t => {
  const app = await buildApp(new Store()); t.after(() => app.close()); const jar = cookies(await signup(app, 'revision@example.test'));
  const patch = (payload: object) => app.inject({ method: 'PATCH', url: route, cookies: jar, payload });
  assert.equal((await patch({ revision: 0, firstName: 'Alice' })).statusCode, 200);
  assert.equal((await patch({ revision: 0, firstName: 'Stale' })).statusCode, 409);
  for (const fields of [{ firstName: '' }, { firstName: 'Hidden\u0000' }, { language: 'bad_language' }, { phone: '5551234' }, { phone: '+55\n11999999999' }, {}]) {
    assert.equal((await patch({ revision: 1, ...fields })).statusCode, 400);
  }
  assert.equal((await app.inject({ url: route, cookies: jar })).json().firstName, 'Alice');
  assert.equal((await patch({ revision: 1, phone: null })).statusCode, 200);
});

test('API keys and revoked browser sessions cannot read or mutate a profile', async t => {
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  let revoke = false;
  app.addHook('preHandler', async request => { if (revoke && request.url === route) store.db.prepare('DELETE FROM sessions WHERE hash=?').run(createHash('sha256').update(request.cookies.kloel_session).digest('hex')); });
  const jar = cookies(await signup(app, 'security@example.test'));
  const key = (await app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies: jar, payload: { name: 'Profile scope test', scopes: ['agents:read'] } })).json();
  for (const method of ['GET', 'PATCH'] as const) {
    assert.equal((await app.inject({ method, url: route, cookies: jar, headers: { authorization: `Bearer ${key.secret}` }, ...(method === 'PATCH' ? { payload: { revision: 0, firstName: 'Denied' } } : {}) })).statusCode, 403);
  }
  revoke = true;
  assert.equal((await app.inject({ url: route, cookies: jar })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PATCH', url: route, cookies: jar, payload: { revision: 0, firstName: 'Denied' } })).statusCode, 401);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM user_profiles').get()?.n, 0);
});
