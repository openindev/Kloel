import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify, { type HTTPMethods } from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, hashPassword, sessionDigest } from '../src/auth.js';
import { registerMembers } from '../src/members.js';
import { seedMemberships } from './fixtures/membership.js';
import { addOrganizationMember, changeOrganizationRole, initializeMemberships, membership, removeOrganizationMember, revokeOrganizationSessions } from '../src/memberships/service.js';

const password = 'an-existing-account-password', owner = { userId: 'owner', tenantId: 'tenant-a', role: 'owner' as const };
const tokenFrom = (path: string) => new URL(path, 'http://localhost').hash.slice('#token='.length);
async function fixture(t: TestContext) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY;
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 27).toString('base64');
  const store = new Store(), app = Fastify();
  for (const [id, tenant, role] of [['owner', 'tenant-a', 'owner'], ['admin', 'tenant-a', 'admin'], ['member', 'tenant-a', 'member'], ['other', 'tenant-b', 'owner']]) store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run(id, tenant, `${id}@example.test`, hashPassword(password), role);
  seedMemberships(store);
  const session = (userId: string, tenantId = userId === 'other' ? 'tenant-b' : 'tenant-a') => {
    const token = randomUUID();
    store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionDigest(token), userId, Date.now() + 86400000, tenantId);
    return `kloel_session=${token}`;
  };
  const cookies = Object.fromEntries(['owner', 'admin', 'member', 'other'].map(id => [id, session(id)]));
  await app.register(cookie); await registerAuth(app, store); await registerMembers(app, store);
  t.after(async () => { await app.close(); store.close(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous; });
  const call = (user: string | null, method: HTTPMethods, url: string, payload?: Record<string, unknown>) => app.inject({ method, url: '/api/v1' + url, ...(user ? { headers: { cookie: cookies[user] } } : {}), ...(payload ? { payload } : {}) });
  const invite = async (email = 'new@example.test', user = 'owner', key = randomUUID()) => {
    const result = await call(user, 'POST', '/invitations', { email, idempotencyKey: key, expectedTenantId: 'tenant-a' });
    assert.equal(result.statusCode, 201, result.body);
    return { ...result.json(), key };
  };
  return { store, app, call, invite, session, cookies };
}

test('real cookie, role capabilities and mandatory target version govern team routes', async t => {
  const f = await fixture(t);
  assert.equal((await f.call(null, 'GET', '/members')).statusCode, 401);
  assert.equal((await f.call('member', 'GET', '/members')).statusCode, 200);
  assert.equal((await f.call('member', 'POST', '/invitations', { email: 'denied@example.test', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' })).statusCode, 403);
  const roles = (await f.call('admin', 'GET', '/members/roles')).json();
  assert.equal(roles.ownerCount, 1); assert.equal(roles.items.find((x: any) => x.role === 'owner').canAssign, false);
  assert.ok(roles.items.find((x: any) => x.role === 'member').permissions.includes('team:read'));
  for (const [method, path, body] of [['PATCH', '/members/member', { role: 'viewer' }], ['DELETE', '/members/member', {}], ['POST', '/members/member/revoke-sessions', {}]] as const) assert.equal((await f.call('owner', method, path, body)).statusCode, 400);
  const forbidden = await f.call('admin', 'PATCH', '/members/member', { role: 'owner', expectedVersion: membership(f.store, 'tenant-a', 'member').version });
  assert.equal(forbidden.statusCode, 403);
  const foreign = await f.call('other', 'DELETE', '/members/member', { expectedVersion: membership(f.store, 'tenant-a', 'member').version });
  assert.equal(foreign.statusCode, 404);
});

test('role ABA, session revocation and remove/rejoin invalidate old member versions', async t => {
  const f = await fixture(t), initial = membership(f.store, 'tenant-a', 'member');
  changeOrganizationRole(f.store, owner, 'member', 'viewer');
  changeOrganizationRole(f.store, owner, 'member', 'member');
  assert.equal(membership(f.store, 'tenant-a', 'member').revision, initial.revision + 2);
  const stale = await f.call('owner', 'PATCH', '/members/member', { role: 'admin', expectedVersion: initial.version });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'version_conflict');
  const current = membership(f.store, 'tenant-a', 'member');
  const revoked = await f.call('owner', 'POST', '/members/member/revoke-sessions', { expectedVersion: current.version });
  assert.equal(revoked.statusCode, 200); assert.equal(revoked.json().member.revision, current.revision + 1);
  assert.equal((await f.call('owner', 'POST', '/members/member/revoke-sessions', { expectedVersion: current.version })).statusCode, 409);
  const beforeRejoin = membership(f.store, 'tenant-a', 'member');
  removeOrganizationMember(f.store, owner, 'member'); addOrganizationMember(f.store, owner, { userId: 'member', role: 'member' });
  assert.notEqual(membership(f.store, 'tenant-a', 'member').id, beforeRejoin.id);
  assert.equal((await f.call('owner', 'DELETE', '/members/member', { expectedVersion: beforeRejoin.version })).statusCode, 409);
});

test('last owner invariant and role-change session revocation survive CAS', async t => {
  const f = await fixture(t);
  const last = await f.call('owner', 'PATCH', '/members/owner', { role: 'member', expectedVersion: membership(f.store, 'tenant-a', 'owner').version });
  assert.equal(last.json().error.code, 'last_owner');
  const invitation = await f.invite('admin-issued@example.test', 'admin');
  const before = membership(f.store, 'tenant-a', 'admin');
  const changed = await f.call('owner', 'PATCH', '/members/admin', { role: 'member', expectedVersion: before.version });
  assert.equal(changed.statusCode, 200); assert.equal(changed.json().sessionsRevoked, true);
  assert.equal(changed.json().revision, before.revision + 1);
  assert.equal((await f.call('admin', 'GET', '/members')).statusCode, 401);
  assert.equal(f.store.get('tenant-a', 'team-invitations', invitation.id)?.status, 'revoked');
});

test('lost invitation creation is recoverable without another invite or plaintext secret in storage/GET', async t => {
  const f = await fixture(t), invitation = await f.invite(), raw = tokenFrom(invitation.localAcceptancePath);
  const duplicate = await f.call('owner', 'POST', '/invitations', { email: invitation.email, idempotencyKey: invitation.key, expectedTenantId: 'tenant-a' });
  assert.equal(duplicate.statusCode, 200); assert.equal(duplicate.json().localAcceptancePath, invitation.localAcceptancePath);
  assert.equal(f.store.list('tenant-a', 'team-invitations').length, 1);
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM entities').all()).includes(raw));
  for (const path of ['/invitations', '/team/operations/' + invitation.key]) {
    const response = await f.call('owner', 'GET', path);
    assert.equal(response.statusCode, 200); assert.ok(!response.body.includes(raw)); assert.ok(!response.body.includes('encryptedToken')); assert.ok(!response.body.includes('tokenHash'));
  }
  const recovered = await f.call('owner', 'POST', '/team/operations/' + invitation.key + '/recover-link', {});
  assert.equal(recovered.json().localAcceptancePath, invitation.localAcceptancePath);
  assert.equal((await f.call('other', 'GET', '/team/operations/' + invitation.key)).statusCode, 404);
  assert.equal((await f.call('admin', 'GET', '/team/operations/' + invitation.key)).statusCode, 404);
  assert.equal((await f.call('owner', 'POST', '/invitations', { email: 'changed@example.test', idempotencyKey: invitation.key, expectedTenantId: 'tenant-a' })).statusCode, 409);
});

test('rotation and revocation are CAS; old operation cannot reveal superseded, expired or closed links', async t => {
  const f = await fixture(t), invitation = await f.invite(), key = randomUUID();
  const input = { expectedVersion: invitation.version, idempotencyKey: key };
  const rotated = await f.call('owner', 'POST', '/invitations/' + invitation.id + '/link', input);
  assert.equal(rotated.statusCode, 200); assert.notEqual(rotated.json().localAcceptancePath, invitation.localAcceptancePath);
  assert.equal((await f.call('owner', 'POST', '/invitations/' + invitation.id + '/link', input)).json().localAcceptancePath, rotated.json().localAcceptancePath);
  assert.equal((await f.call('owner', 'POST', '/invitations/' + invitation.id + '/link', { ...input, idempotencyKey: randomUUID() })).json().error.code, 'version_conflict');
  assert.equal((await f.call('owner', 'GET', '/team/operations/' + invitation.key)).json().linkRecoverable, false);
  assert.equal((await f.call('owner', 'POST', '/team/operations/' + invitation.key + '/recover-link', {})).statusCode, 409);
  assert.equal((await f.call('owner', 'DELETE', '/invitations/' + invitation.id, { expectedVersion: invitation.version })).statusCode, 409);
  assert.equal((await f.call('owner', 'DELETE', '/invitations/' + invitation.id, { expectedVersion: rotated.json().version })).statusCode, 204);
  assert.equal((await f.call('owner', 'POST', '/team/operations/' + key + '/recover-link', {})).statusCode, 409);
  const expiring = await f.invite('expiry@example.test');
  f.store.update('tenant-a', 'team-invitations', expiring.id, { expiresAt: new Date(0).toISOString() });
  assert.equal((await f.call('owner', 'POST', '/team/operations/' + expiring.key + '/recover-link', {})).statusCode, 409);
});

test('admin cannot obtain a raw invitation link; missing encryption key rolls back owner creation', async t => {
  const f = await fixture(t), invitation = await f.invite('admin-new@example.test', 'admin');
  assert.equal(invitation.localAcceptancePath, undefined);
  assert.equal((await f.call('admin', 'POST', '/team/operations/' + invitation.key + '/recover-link', {})).statusCode, 409);
  assert.equal((await f.call('admin', 'POST', '/invitations/' + invitation.id + '/link', { expectedVersion: invitation.version, idempotencyKey: randomUUID() })).statusCode, 403);
  delete process.env.OAUTH_ENCRYPTION_KEY;
  const before = f.store.list('tenant-a', 'team-invitations').length;
  const failed = await f.call('owner', 'POST', '/invitations', { email: 'no-key@example.test', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' });
  assert.equal(failed.statusCode, 503); assert.equal(f.store.list('tenant-a', 'team-invitations').length, before);
});

test('invitation issuer/session/membership revocation blocks creation and recovery after rejoin', async t => {
  const f = await fixture(t), invitation = await f.invite();
  addOrganizationMember(f.store, owner, { userId: 'other', role: 'owner' });
  const other = { userId: 'other', tenantId: 'tenant-a', role: 'owner' as const };
  removeOrganizationMember(f.store, other, 'owner'); addOrganizationMember(f.store, other, { userId: 'owner', role: 'owner' });
  assert.equal((await f.call('owner', 'GET', '/team/operations/' + invitation.key)).statusCode, 401);
  f.cookies.owner = f.session('owner');
  assert.equal((await f.call('owner', 'GET', '/team/operations/' + invitation.key)).statusCode, 404);
  const accepted = await f.call(null, 'POST', '/auth/accept-invite', { email: invitation.email, token: tokenFrom(invitation.localAcceptancePath), password, idempotencyKey: randomUUID() });
  assert.equal(accepted.statusCode, 400);
});

test('new identity lost response/cookie recovers same membership once with password, without renewing expiry', async t => {
  const f = await fixture(t), invitation = await f.invite(), key = randomUUID();
  const input = { token: tokenFrom(invitation.localAcceptancePath), email: invitation.email, password, idempotencyKey: key };
  const accepted = await f.call(null, 'POST', '/auth/accept-invite', input);
  assert.equal(accepted.statusCode, 201, accepted.body); assert.equal(accepted.json().replayed, false);
  const originalCookie = String(accepted.headers['set-cookie']).split(';')[0];
  const oldSession = f.store.db.prepare('SELECT * FROM sessions WHERE user_id=?').get(accepted.json().userId)!;
  const wrong = await f.call(null, 'POST', '/auth/accept-invite', { action: 'recover', email: invitation.email, password: 'wrong-password-is-long', idempotencyKey: key });
  assert.equal(wrong.statusCode, 401);
  const recovered = await f.call(null, 'POST', '/auth/accept-invite', { action: 'recover', email: invitation.email, password, idempotencyKey: key });
  assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().membershipId, accepted.json().membershipId);
  assert.equal(recovered.json().replayed, true);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE user_id=?').get(accepted.json().userId)?.n, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(accepted.json().userId)?.n, 1);
  assert.equal(f.store.db.prepare('SELECT expires FROM sessions WHERE user_id=?').get(accepted.json().userId)?.expires, oldSession.expires);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: originalCookie } })).statusCode, 401);
  assert.equal((await f.call(null, 'POST', '/auth/accept-invite', input)).statusCode, 200);
  assert.equal((await f.call(null, 'POST', '/auth/accept-invite', { ...input, idempotencyKey: randomUUID() })).statusCode, 400);
  assert.equal((await f.call('owner', 'POST', '/team/operations/' + invitation.key + '/recover-link', {})).statusCode, 409);
});

test('existing identity needs its own session or current password and keeps password and other membership', async t => {
  const f = await fixture(t), invitation = await f.invite('other@example.test'), before = f.store.db.prepare('SELECT password FROM users WHERE id=?').get('other')!.password;
  const input = { email: invitation.email, token: tokenFrom(invitation.localAcceptancePath), idempotencyKey: randomUUID() };
  assert.equal((await f.call('owner', 'POST', '/auth/accept-invite', input)).statusCode, 401);
  assert.equal((await f.call(null, 'POST', '/auth/accept-invite', { ...input, password: 'new-password-not-current' })).statusCode, 401);
  const accepted = await f.call('other', 'POST', '/auth/accept-invite', input);
  assert.equal(accepted.statusCode, 201, accepted.body); assert.equal(accepted.json().userId, 'other');
  assert.equal(f.store.db.prepare('SELECT password FROM users WHERE id=?').get('other')?.password, before);
  assert.equal(membership(f.store, 'tenant-b', 'other').role, 'owner');
  assert.equal(membership(f.store, 'tenant-a', 'other').role, 'member');
});

test('acceptance recovery never resurrects revoked or expired sessions, changed membership or suspended organization', async t => {
  for (const reason of ['logout', 'expired', 'role', 'rejoin', 'suspended', 'issuer']) {
    await t.test(reason, async t => {
      const f = await fixture(t), invitation = await f.invite(), key = randomUUID();
      const accepted = await f.call(null, 'POST', '/auth/accept-invite', { email: invitation.email, token: tokenFrom(invitation.localAcceptancePath), password, idempotencyKey: key });
      assert.equal(accepted.statusCode, 201); const id = accepted.json().userId;
      if (reason === 'logout') f.store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      if (reason === 'expired') f.store.db.prepare('UPDATE sessions SET expires=0 WHERE user_id=?').run(id);
      if (reason === 'role') changeOrganizationRole(f.store, owner, id, 'viewer');
      if (reason === 'rejoin') { removeOrganizationMember(f.store, owner, id); addOrganizationMember(f.store, owner, { userId: id, role: 'member' }); }
      if (reason === 'suspended') f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id='tenant-a'").run();
      if (reason === 'issuer') revokeOrganizationSessions(f.store, owner, 'owner');
      const before = f.store.db.prepare('SELECT * FROM sessions WHERE user_id=?').all(id);
      const response = await f.call(null, 'POST', '/auth/accept-invite', { action: 'recover', email: invitation.email, password, idempotencyKey: key });
      assert.equal(response.statusCode, 409, response.body); assert.equal(response.headers['set-cookie'], undefined);
      assert.deepEqual(f.store.db.prepare('SELECT * FROM sessions WHERE user_id=?').all(id), before);
    });
  }
});

test('accept transaction rollback preserves invitation and creates no identity or membership if receipt persistence fails', async t => {
  const f = await fixture(t), invitation = await f.invite(), create = f.store.create.bind(f.store);
  f.store.create = (tenant, collection, body) => { if (collection === 'team-accept-operations') throw new Error('injected receipt failure'); return create(tenant, collection, body); };
  const response = await f.call(null, 'POST', '/auth/accept-invite', { email: invitation.email, token: tokenFrom(invitation.localAcceptancePath), password, idempotencyKey: randomUUID() });
  assert.equal(response.statusCode, 500);
  assert.equal(f.store.get('tenant-a', 'team-invitations', invitation.id)?.status, 'pending');
  assert.equal(f.store.db.prepare('SELECT id FROM users WHERE email=?').get(invitation.email), undefined);
});

test('migration is additive/idempotent, preserves identity/session and role trigger detects direct SQL ABA', async t => {
  const f = await fixture(t), before = membership(f.store, 'tenant-a', 'member'), sessions = f.store.db.prepare('SELECT * FROM sessions ORDER BY hash').all();
  initializeMemberships(f.store); initializeMemberships(f.store);
  assert.deepEqual(membership(f.store, 'tenant-a', 'member'), before); assert.deepEqual(f.store.db.prepare('SELECT * FROM sessions ORDER BY hash').all(), sessions);
  f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE id=?").run(before.id);
  f.store.db.prepare("UPDATE memberships SET role='member' WHERE id=?").run(before.id);
  assert.equal(membership(f.store, 'tenant-a', 'member').revision, before.revision + 2);
  assert.notEqual(membership(f.store, 'tenant-a', 'member').version, before.version);
});

test('fresh role is used after BEGIN even if owner becomes admin between initial check and transaction', async t => {
  for (const action of ['create', 'rotate', 'revoke']) {
    await t.test(action, async t => {
      const f = await fixture(t), invitation = await f.invite();
      if (action === 'revoke') f.store.update('tenant-a', 'team-invitations', invitation.id, { role: 'owner' });
      const current = (await f.call('owner', 'GET', '/invitations')).json().items[0];
      const original = f.store.transaction.bind(f.store);
      f.store.transaction = fn => {
        f.store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id='owner' AND tenant_id='tenant-a'").run();
        return original(fn);
      };
      const response = action === 'create'
        ? await f.call('owner', 'POST', '/invitations', { email: 'privileged@example.test', role: 'owner', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' })
        : action === 'rotate'
          ? await f.call('owner', 'POST', '/invitations/' + invitation.id + '/link', { expectedVersion: current.version, idempotencyKey: randomUUID() })
          : await f.call('owner', 'DELETE', '/invitations/' + invitation.id, { expectedVersion: current.version });
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(f.store.list('tenant-a', 'team-invitations').length, 1);
      assert.equal(f.store.get('tenant-a', 'team-invitations', invitation.id)?.revision, 1);
      assert.equal(f.store.get('tenant-a', 'team-invitations', invitation.id)?.status, 'pending');
      assert.equal(f.store.list('tenant-a', 'team-operations').length, 1);
    });
  }
});

test('member mutations recheck exact cookie inside service transaction after revocation', async t => {
  for (const action of ['role', 'remove', 'sessions']) {
    await t.test(action, async t => {
      const f = await fixture(t), before = membership(f.store, 'tenant-a', 'member'), original = f.store.transaction.bind(f.store);
      f.store.transaction = fn => { f.store.db.prepare("DELETE FROM sessions WHERE user_id='owner'").run(); return original(fn); };
      const response = action === 'role'
        ? await f.call('owner', 'PATCH', '/members/member', { role: 'viewer', expectedVersion: before.version })
        : action === 'remove'
          ? await f.call('owner', 'DELETE', '/members/member', { expectedVersion: before.version })
          : await f.call('owner', 'POST', '/members/member/revoke-sessions', { expectedVersion: before.version });
      assert.equal(response.statusCode, 401, response.body);
      assert.deepEqual(membership(f.store, 'tenant-a', 'member'), before);
      assert.equal((await f.call('member', 'GET', '/members')).statusCode, 200);
    });
  }
});

test('concurrent same-key creation and acceptance commit once; competing CAS rotations have one winner', async t => {
  const f = await fixture(t), key = randomUUID(), payload = { email: 'parallel@example.test', idempotencyKey: key, expectedTenantId: 'tenant-a' };
  const [first, second] = await Promise.all([f.call('owner', 'POST', '/invitations', payload), f.call('owner', 'POST', '/invitations', payload)]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 201]);
  assert.equal(first.json().id, second.json().id); assert.equal(first.json().localAcceptancePath, second.json().localAcceptancePath);
  assert.equal(first.headers['cache-control'], 'no-store');
  const invitation = first.json();
  const rotations = await Promise.all([0, 1].map(() => f.call('owner', 'POST', '/invitations/' + invitation.id + '/link', { expectedVersion: invitation.version, idempotencyKey: randomUUID() })));
  assert.deepEqual(rotations.map(r => r.statusCode).sort(), [200, 409]);
  const active = rotations.find(r => r.statusCode === 200)!.json();
  const input = { email: invitation.email, token: tokenFrom(active.localAcceptancePath), password, idempotencyKey: randomUUID() };
  const accepted = await Promise.all([f.call(null, 'POST', '/auth/accept-invite', input), f.call(null, 'POST', '/auth/accept-invite', input)]);
  assert.deepEqual(accepted.map(r => r.statusCode).sort(), [200, 201]);
  assert.equal(accepted[0].json().membershipId, accepted[1].json().membershipId);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get(input.email)?.n, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(accepted[0].json().userId)?.n, 1);
});

test('encrypted link recovery rejects ciphertext copied from another invitation operation', async t => {
  const f = await fixture(t), one = await f.invite('one@example.test'), two = await f.invite('two@example.test');
  const receipts = f.store.list('tenant-a', 'team-operations'), source = receipts.find(r => r.invitationId === one.id)!, target = receipts.find(r => r.invitationId === two.id)!;
  f.store.update('tenant-a', 'team-operations', target.id, { encryptedToken: source.encryptedToken });
  const response = await f.call('owner', 'POST', '/team/operations/' + two.key + '/recover-link', {});
  assert.equal(response.statusCode, 503); assert.ok(!response.body.includes(tokenFrom(one.localAcceptancePath)));
});

test('existing v1 database receives only additive revision migration without re-running user backfill', t => {
  const store = new Store(':memory:', { migrateMemberships: false }); t.after(() => store.close());
  store.db.exec(`CREATE TABLE engine_migrations(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT INTO engine_migrations VALUES('2026-10-18-memberships-v1','2026-01-01');
    CREATE TABLE organizations(id TEXT PRIMARY KEY,name TEXT,status TEXT,created_at TEXT);
    CREATE TABLE memberships(id TEXT PRIMARY KEY,user_id TEXT,tenant_id TEXT,role TEXT,joined_at TEXT,UNIQUE(user_id,tenant_id));
    ALTER TABLE sessions ADD COLUMN tenant_id TEXT;
    INSERT INTO organizations VALUES('a','Empresa','active','2026-01-01');
    INSERT INTO users VALUES('u','a','u@example.test','unchanged-hash','owner');
    INSERT INTO users VALUES('removed','a','removed@example.test','also-unchanged','member');
    INSERT INTO memberships VALUES('preserved-id','u','a','owner','2026-01-01');
    INSERT INTO sessions VALUES('preserved-hash','u',9999999999999,'a');`);
  const users = store.db.prepare('SELECT * FROM users').all(), sessions = store.db.prepare('SELECT * FROM sessions').all();
  initializeMemberships(store); initializeMemberships(store);
  assert.deepEqual(store.db.prepare('SELECT * FROM users').all(), users); assert.deepEqual(store.db.prepare('SELECT * FROM sessions').all(), sessions);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM memberships').get()?.n, 1);
  assert.equal(membership(store, 'a', 'u').id, 'preserved-id'); assert.equal(membership(store, 'a', 'u').revision, 1);
});

test('invitation create requires expected tenant and rejects cookie tenant changes before any receipt or replay', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('owner', 'POST', '/invitations', { email: 'missing-binding@example.test', idempotencyKey: randomUUID() })).statusCode, 400);
  const key = randomUUID(), input = { email: 'cross-tenant@example.test', role: 'member', idempotencyKey: key, expectedTenantId: 'tenant-a' };
  addOrganizationMember(f.store, { userId: 'other', tenantId: 'tenant-b', role: 'owner' }, { userId: 'owner', role: 'owner' });
  f.cookies.owner = f.session('owner', 'tenant-b');
  const wrong = await f.call('owner', 'POST', '/invitations', input);
  assert.equal(wrong.statusCode, 409); assert.equal(wrong.json().error.code, 'tenant_mismatch');
  assert.equal(f.store.list('tenant-a', 'team-invitations').length, 0); assert.equal(f.store.list('tenant-b', 'team-invitations').length, 0);
  assert.equal(f.store.list('tenant-b', 'team-operations').length, 0);
  f.cookies.owner = f.session('owner', 'tenant-a');
  const created = await f.call('owner', 'POST', '/invitations', input);
  assert.equal(created.statusCode, 201);
  // Same original key in another organization cannot create a second invitation.
  f.cookies.owner = f.session('owner', 'tenant-b');
  assert.equal((await f.call('owner', 'POST', '/invitations', input)).json().error.code, 'tenant_mismatch');
  assert.equal(f.store.list('tenant-b', 'team-invitations').length, 0);
  assert.equal(f.store.list('tenant-b', 'team-operations').length, 0);
});

test('invitation tenant binding is checked inside BEGIN, including a changed request actor/cookie pair', async t => {
  const f = await fixture(t);
  addOrganizationMember(f.store, { userId: 'other', tenantId: 'tenant-b', role: 'owner' }, { userId: 'owner', role: 'owner' });
  const original = f.store.transaction.bind(f.store);
  f.store.transaction = fn => {
    // Simulate the exact existing session selecting a different organization between route checks.
    f.store.db.prepare("UPDATE sessions SET tenant_id='tenant-b' WHERE user_id='owner'").run();
    return original(fn);
  };
  const response = await f.call('owner', 'POST', '/invitations', { email: 'late-tenant@example.test', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' });
  assert.equal(response.statusCode, 401); // captured request actor also binds its original tenant
  assert.equal(f.store.list('tenant-a', 'team-invitations').length, 0); assert.equal(f.store.list('tenant-b', 'team-invitations').length, 0);
});

test('legacy creation fingerprint stays recoverable; lost decryption key never claims the committed operation was rolled back', async t => {
  const f = await fixture(t), invitation = await f.invite(), operation = f.store.list('tenant-a', 'team-operations')[0];
  const legacyInput = { email: invitation.email, role: 'member', expiresInHours: 48, idempotencyKey: invitation.key };
  assert.equal(operation.fingerprint, sessionDigest(JSON.stringify(['invitation.create', legacyInput])));
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 78).toString('base64');
  const replay = await f.call('owner', 'POST', '/invitations', { ...legacyInput, expectedTenantId: 'tenant-a' });
  assert.equal(replay.statusCode, 503); assert.equal(replay.json().error.code, 'invitation_recovery_unavailable');
  const recover = await f.call('owner', 'POST', '/team/operations/' + invitation.key + '/recover-link', {});
  assert.equal(recover.statusCode, 503); assert.equal(recover.json().error.code, 'invitation_recovery_unavailable');
  assert.equal((await f.call('owner', 'GET', '/team/operations/' + invitation.key)).json().status, 'succeeded');
  assert.equal(f.store.list('tenant-a', 'team-invitations').length, 1);
  assert.equal(f.store.list('tenant-a', 'team-operations').length, 1);
});
