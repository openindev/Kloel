import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { validPassword } from '../src/auth.js';

const oldPassword = 'current-test-password', password = 'new-password-for-tests', route = '/api/v1/account/password';
async function fixture(t: test.TestContext) {
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'password@example.test', password: oldPassword, organization: 'Password tests' } });
  assert.equal(signup.statusCode, 201);
  const cookies = { kloel_session: signup.cookies.find(c => c.name === 'kloel_session')!.value }, context = signup.json().context;
  const headers = { 'x-kloel-expected-user': context.userId, 'x-kloel-expected-tenant': context.tenantId, 'x-kloel-expected-membership': context.membershipId, 'x-kloel-expected-authority': context.authorityVersion };
  const input = { operationKey: randomUUID(), currentPassword: oldPassword, password, confirmation: password };
  return { store, app, cookies, headers, input, userId: context.userId };
}
test('password form updates real credentials, revokes other sessions, retains current session and exposes only a receipt', async t => {
  const f = await fixture(t);
  const login = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'password@example.test', password: oldPassword } });
  const other = { kloel_session: login.cookies.find(c => c.name === 'kloel_session')!.value };
  const result = await f.app.inject({ method: 'POST', url: route, cookies: f.cookies, headers: f.headers, payload: f.input });
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().changed, true);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/me', cookies: f.cookies })).statusCode, 200);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/me', cookies: other })).statusCode, 401);
  const stored = String(f.store.db.prepare('SELECT password FROM users WHERE id=?').get(f.userId)!.password);
  assert.equal(validPassword(password, stored), true); assert.equal(validPassword(oldPassword, stored), false);
  const recovered = await f.app.inject({ url: `${route}/operations/${f.input.operationKey}`, cookies: f.cookies, headers: f.headers });
  assert.deepEqual(recovered.json(), result.json());
  const receipts = JSON.stringify(f.store.list(f.headers['x-kloel-expected-tenant'], 'account_password_operations'));
  for (const secret of [oldPassword, password, stored, f.cookies.kloel_session]) assert.equal(receipts.includes(secret), false);
  assert.equal((await f.app.inject({ method: 'POST', url: route, cookies: f.cookies, headers: f.headers, payload: f.input })).statusCode, 409);
});
test('wrong current password, malformed input, missing or stale context never change credentials', async t => {
  const f = await fixture(t), original = f.store.db.prepare('SELECT password FROM users WHERE id=?').get(f.userId)!.password;
  for (const patch of [{ currentPassword: 'incorrect' }, { password: 'short', confirmation: 'short' }, { confirmation: 'different-pass-long' }, { userId: 'another' }]) {
    const r = await f.app.inject({ method: 'POST', url: route, cookies: f.cookies, headers: f.headers, payload: { ...f.input, ...patch } });
    assert.equal(r.statusCode, 400, r.body);
  }
  assert.equal((await f.app.inject({ method: 'POST', url: route, cookies: f.cookies, payload: f.input })).statusCode, 400);
  assert.equal(f.store.db.prepare('SELECT password FROM users WHERE id=?').get(f.userId)!.password, original);
});
test('receipt is session-bound; fresh login and API credentials cannot recover another session operation', async t => {
  const f = await fixture(t);
  const key = (await f.app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies: f.cookies, payload: { name: 'Password API denial', scopes: ['agents:read'] } })).json();
  assert.equal((await f.app.inject({ method: 'POST', url: route, headers: { authorization: `Bearer ${key.secret}` }, payload: f.input })).statusCode, 403);
  assert.equal((await f.app.inject({ method: 'POST', url: route, cookies: f.cookies, headers: f.headers, payload: f.input })).statusCode, 200);
  const login = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'password@example.test', password } });
  const cookies = { kloel_session: login.cookies.find(c => c.name === 'kloel_session')!.value }, c = login.json().context;
  const headers = { ...f.headers, 'x-kloel-expected-authority': c.authorityVersion };
  assert.equal((await f.app.inject({ url: `${route}/operations/${f.input.operationKey}`, cookies, headers })).statusCode, 404);
  assert.equal((await f.app.inject({ method: 'POST', url: route, cookies, headers: f.headers, payload: { ...f.input, operationKey: randomUUID(), currentPassword: password, password: oldPassword, confirmation: oldPassword } })).statusCode, 409);
});
