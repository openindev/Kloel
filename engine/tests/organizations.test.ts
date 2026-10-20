import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { hashPassword, sessionDigest } from '../src/auth.js';
import { addOrganizationMember, resolveSessionActor } from '../src/memberships/service.js';

const password = 'organization-test-password';
const cookiesOf = (response: any) => ({ kloel_session: response.cookies.find((item: any) => item.name === 'kloel_session').value as string });
const inviteToken = (response: any) => new URL(response.json().localAcceptancePath, 'http://localhost').hash.slice('#token='.length);

test('signup and organization switch persist one identity with independent roles, data and rotated sessions', async t => {
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'ONE@example.test', password, organization: 'Original company' } });
  assert.equal(signup.statusCode, 201, signup.body);
  const first = signup.json(), originalCookie = cookiesOf(signup);
  assert.equal(first.role, 'owner'); assert.equal(first.email, 'one@example.test');
  const duplicate = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'one@example.test', password, organization: 'Duplicate' } });
  assert.equal(duplicate.statusCode, 409);
  const created = await app.inject({ method: 'POST', url: '/api/v1/organizations', cookies: originalCookie, payload: { name: 'Second company', timezone: 'America/Sao_Paulo' } });
  assert.equal(created.statusCode, 201, created.body);
  const second = created.json();
  const contact = await app.inject({ method: 'POST', url: '/api/v1/contacts', cookies: originalCookie, payload: { name: 'Private contact' } });
  assert.equal(contact.statusCode, 201);
  assert.equal((await app.inject({ url: '/api/v1/auth/me', cookies: originalCookie })).json().tenantId, first.tenantId);
  const forbidden = await app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: originalCookie, payload: { tenantId: 'someone-elses-org' } });
  assert.equal(forbidden.statusCode, 403);
  const selected = await app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: originalCookie, payload: { tenantId: second.tenantId } });
  assert.equal(selected.statusCode, 200, selected.body);
  const selectedCookie = cookiesOf(selected);
  assert.notEqual(selectedCookie.kloel_session, originalCookie.kloel_session);
  assert.equal((await app.inject({ url: '/api/v1/auth/me', cookies: originalCookie })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/v1/contacts', cookies: selectedCookie })).json().total, 0);
  assert.equal((await app.inject({ url: '/api/v1/organizations', cookies: selectedCookie })).json().items.length, 2);
  store.db.prepare("UPDATE users SET role='viewer',tenant_id='tampered-legacy' WHERE id=?").run(first.userId);
  assert.equal((await app.inject({ url: '/api/v1/auth/me', cookies: selectedCookie })).json().role, 'owner');
});

test('existing identity must prove ownership to accept invite; password and other organization remain unchanged', async t => {
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY;
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 39).toString('base64');
  t.after(() => { if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; });
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'inviter@example.test', password, organization: 'Inviting company' } });
  const recipient = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'recipient@example.test', password, organization: 'Recipient company' } });
  const originalHash = store.db.prepare('SELECT password FROM users WHERE id=?').get(recipient.json().userId)!.password;
  const invite = await app.inject({ method: 'POST', url: '/api/v1/invitations', cookies: cookiesOf(owner), payload: { email: 'recipient@example.test', role: 'viewer', idempotencyKey: randomUUID(), expectedTenantId: owner.json().tenantId } });
  assert.equal(invite.statusCode, 201, invite.body);
  const input = { email: 'recipient@example.test', token: inviteToken(invite), idempotencyKey: randomUUID() };
  const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', cookies: cookiesOf(owner), payload: { ...input, password: 'attacker-new-password' } });
  assert.equal(wrong.statusCode, 401);
  const accepted = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', cookies: cookiesOf(recipient), payload: input });
  assert.equal(accepted.statusCode, 201, accepted.body);
  assert.equal(accepted.json().userId, recipient.json().userId);
  assert.equal(accepted.json().role, 'viewer');
  assert.equal(store.db.prepare('SELECT password FROM users WHERE id=?').get(recipient.json().userId)!.password, originalHash);
  assert.equal((await app.inject({ url: '/api/v1/organizations', cookies: cookiesOf(accepted) })).json().items.length, 2);
  assert.equal((await app.inject({ url: '/api/v1/auth/me', cookies: cookiesOf(recipient) })).statusCode, 401);
  for (const path of ['contacts', 'members', 'calendars']) assert.equal((await app.inject({ url: `/api/v1/${path}`, cookies: cookiesOf(accepted) })).statusCode, 403, path);
  for (const path of ['agents', 'contacts', 'conversations']) assert.equal((await app.inject({ method: 'POST', url: `/api/v1/${path}`, cookies: cookiesOf(accepted), payload: { name: 'Denied' } })).statusCode, 403, path);
  assert.equal((await app.inject({ url: '/api/v1/agents', cookies: cookiesOf(accepted) })).statusCode, 200);
  const switchBack = await app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: cookiesOf(accepted), payload: { tenantId: recipient.json().tenantId } });
  assert.equal(switchBack.json().role, 'owner');
  const members = await app.inject({ url: '/api/v1/members', cookies: cookiesOf(owner) });
  assert.equal(members.statusCode, 200);
  const member = members.json().items.find((item: { id: string }) => item.id === recipient.json().userId);
  assert.ok(member);
  const remove = await app.inject({ method: 'DELETE', url: `/api/v1/members/${recipient.json().userId}`, cookies: cookiesOf(owner), payload: { expectedVersion: member.version } });
  assert.equal(remove.statusCode, 204);
  assert.equal((await app.inject({ url: '/api/v1/auth/me', cookies: cookiesOf(switchBack) })).statusCode, 200);
});

test('builder can edit agents but cannot enable recording, write contacts or change team', async t => {
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'build-owner@example.test', password, organization: 'Builder company' } });
  const builder = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'builder@example.test', password, organization: 'Builder home' } });
  addOrganizationMember(store, owner.json(), { userId: builder.json().userId, role: 'builder' });
  const selected = await app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: cookiesOf(builder), payload: { tenantId: owner.json().tenantId } });
  const cookies = cookiesOf(selected);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/agents', cookies, payload: { name: 'Builder agent' } })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/agents', cookies, payload: { name: 'Recording agent', settings: { recordingEnabled: true } } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/contacts', cookies, payload: { name: 'Denied' } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/v1/invitations', cookies })).statusCode, 403);
});

test('identity with zero memberships may authenticate and create an organization without regaining removed access', async t => {
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'no-membership@example.test', password, organization: 'Removed org' } });
  // Simulate an administratively removed last membership, keeping its global identity.
  store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(signup.json().userId);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'no-membership@example.test', password } });
  assert.equal(login.statusCode, 200, login.body); assert.equal(login.json().tenantId, null);
  const cookies = cookiesOf(login);
  assert.equal((await app.inject({ url: '/api/v1/agents', cookies })).statusCode, 403);
  const created = await app.inject({ method: 'POST', url: '/api/v1/organizations', cookies, payload: { name: 'Fresh company' } });
  assert.equal(created.statusCode, 201);
  const selected = await app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies, payload: { tenantId: created.json().tenantId } });
  assert.equal(selected.statusCode, 200); assert.equal(selected.json().role, 'owner');
  assert.equal(store.db.prepare('SELECT id FROM memberships WHERE user_id=? AND tenant_id=?').get(signup.json().userId, signup.json().tenantId), undefined);
});

test('automatic on-disk migration preserves credentials, owner, records and active session and does not backfill deleted membership again', t => {
  const directory = mkdtempSync(join(tmpdir(), 'kloel-memberships-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'legacy.sqlite'), legacy = new Store(path, { migrateMemberships: false }), passwordHash = hashPassword(password);
  legacy.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run('legacy-owner', 'legacy-tenant', 'legacy@example.test', passwordHash, 'owner');
  legacy.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(sessionDigest('legacy-token'), 'legacy-owner', Date.now() + 60000);
  const record = legacy.create('legacy-tenant', 'contacts', { name: 'Preserved' }); legacy.close();
  const migrated = new Store(path);
  assert.equal(migrated.db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  assert.deepEqual(resolveSessionActor(migrated, sessionDigest('legacy-token')), { userId: 'legacy-owner', tenantId: 'legacy-tenant', role: 'owner' });
  assert.equal(migrated.db.prepare('SELECT password FROM users WHERE id=?').get('legacy-owner')!.password, passwordHash);
  assert.deepEqual(migrated.get('legacy-tenant', 'contacts', record.id), record);
  migrated.db.prepare('DELETE FROM memberships WHERE user_id=?').run('legacy-owner'); migrated.close();
  const reopened = new Store(path); t.after(() => reopened.close());
  assert.equal(resolveSessionActor(reopened, sessionDigest('legacy-token')), undefined);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM memberships').get()!.n, 0);
});
