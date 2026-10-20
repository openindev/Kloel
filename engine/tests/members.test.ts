import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, scryptSync } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerMembers } from '../src/members.js';
import { registerAuth } from '../src/auth.js';
import { seedMemberships } from './fixtures/membership.js';
import { membership } from '../src/memberships/service.js';

const password = 'a-long-local-test-password';
async function fixture() {
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY;
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString('base64');
  const store = new Store();
  for (const [id, tenant, role] of [['owner-a', 'tenant-a', 'owner'], ['admin-a', 'tenant-a', 'admin'], ['member-a', 'tenant-a', 'member'], ['owner-b', 'tenant-b', 'owner']]) {
    store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run(id, tenant, `${id}@example.com`, `salt:${scryptSync(password, 'salt', 64).toString('hex')}`, role);
  }
  seedMemberships(store);
  const tokens = new Map<string, string>();
  for (const user of store.db.prepare('SELECT id,tenant_id FROM users').all()) {
    const raw = randomUUID(); tokens.set(String(user.id), raw);
    store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(createHash('sha256').update(raw).digest('hex'), String(user.id), Date.now() + 86400000, String(user.tenant_id));
  }
  const app = Fastify();
  await app.register(cookie);
  app.addHook('onRequest', async request => {
    if (request.headers['x-anonymous']) return;
    const userId = String(request.headers['x-user'] ?? 'owner-a');
    request.cookies.kloel_session = tokens.get(userId);
  });
  await registerAuth(app, store);
  await registerMembers(app, store);
  const version = (id: string) => membership(store, 'tenant-a', id).version;
  const inviteVersion = async (id: string) => (await app.inject({ url: '/api/v1/invitations' })).json().items.find((item: {id: string}) => item.id === id).version;
  return { app, store, version, inviteVersion, close: async () => { await app.close(); store.close(); if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; } };
}
function token(path: string): string { return new URL(path, 'http://localhost').hash.slice('#token='.length); }

test('owner creates a local invitation without claiming email delivery; secret is hashed and never listed', async () => {
  const f = await fixture();
  try {
    const response = await f.app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: 'NEW@example.com', role: 'member', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' } });
    assert.equal(response.statusCode, 201);
    const invitation = response.json();
    assert.equal(invitation.email, 'new@example.com');
    assert.equal(invitation.deliveryStatus, 'not_sent');
    assert.equal(invitation.tokenHash, undefined);
    assert.ok(invitation.localAcceptancePath.startsWith('/accept-invite#token='));
    const raw = token(invitation.localAcceptancePath);
    const stored = f.store.get('tenant-a', 'team-invitations', invitation.id)!;
    assert.equal(stored.tokenHash, createHash('sha256').update(raw).digest('hex'));
    assert.ok(!JSON.stringify(stored).includes(raw));
    const listed = await f.app.inject({ url: '/api/v1/invitations' });
    assert.equal(listed.json().items[0].tokenHash, undefined);
    assert.ok(!listed.body.includes(raw));
  } finally { await f.close(); }
});

test('invitation acceptance is single-use, creates same-tenant user and issues compatible session/login', async () => {
  const f = await fixture();
  const auth = Fastify();
  try {
    const invitation = (await f.app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: 'accepted@example.com', role: 'admin', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' } })).json();
    const input = { token: token(invitation.localAcceptancePath), email: 'accepted@example.com', password, idempotencyKey: randomUUID() };
    const accepted = await f.app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: input, headers: { 'x-anonymous': 'true' } });
    assert.equal(accepted.statusCode, 201, accepted.body);
    assert.equal(accepted.json().tenantId, 'tenant-a');
    assert.equal(accepted.json().role, 'admin');
    assert.ok(accepted.headers['set-cookie']?.toString().includes('HttpOnly'));
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(accepted.json().userId)?.n, 1);
    const replay = await f.app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: input });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    await auth.register(cookie);
    await registerAuth(auth, f.store);
    const login = await auth.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: input.email, password } });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.json().tenantId, 'tenant-a');
    const who = await auth.inject({ url: '/api/v1/auth/me', headers: { cookie: String(replay.headers['set-cookie']).split(';')[0] } });
    assert.equal(who.statusCode, 200);
    assert.equal(who.json().userId, accepted.json().userId);
  } finally { await auth.close(); await f.close(); }
});

test('expired, wrong-email, revoked and renewed invitation tokens cannot be accepted', async () => {
  const f = await fixture();
  try {
    const invitation = (await f.app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: 'expiry@example.com', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' } })).json();
    const original = token(invitation.localAcceptancePath);
    const wrong = await f.app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token: original, email: 'wrong@example.com', password, idempotencyKey: randomUUID() } });
    assert.equal(wrong.statusCode, 400);
    f.store.update('tenant-a', 'team-invitations', invitation.id, { expiresAt: '2000-01-01T00:00:00Z' });
    const expired = await f.app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token: original, email: 'expiry@example.com', password, idempotencyKey: randomUUID() } });
    assert.equal(expired.statusCode, 400);
    const renewed = await f.app.inject({ method: 'POST', url: `/api/v1/invitations/${invitation.id}/link`, payload: { expectedVersion: await f.inviteVersion(invitation.id), idempotencyKey: randomUUID() } });
    assert.equal(renewed.statusCode, 200);
    assert.notEqual(token(renewed.json().localAcceptancePath), original);
    const previous = await f.app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token: original, email: 'expiry@example.com', password, idempotencyKey: randomUUID() } });
    assert.equal(previous.statusCode, 400);
    await f.app.inject({ method: 'DELETE', url: `/api/v1/invitations/${invitation.id}`, payload: { expectedVersion: renewed.json().version } });
    const revoked = await f.app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token: token(renewed.json().localAcceptancePath), email: 'expiry@example.com', password, idempotencyKey: randomUUID() } });
    assert.equal(revoked.statusCode, 400);
    assert.equal(f.store.db.prepare('SELECT id FROM users WHERE email=?').get('expiry@example.com'), undefined);
  } finally { await f.close(); }
});

test('admin cannot promote themselves, invite privileged roles or reveal local invitation tokens', async () => {
  const f = await fixture();
  try {
    for (const role of ['owner', 'admin']) {
      const invite = await f.app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: `${role}@example.com`, role, idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' }, headers: { 'x-user': 'admin-a' } });
      assert.equal(invite.statusCode, 403);
      const promote = await f.app.inject({ method: 'PATCH', url: '/api/v1/members/member-a', payload: { role, expectedVersion: f.version('member-a') }, headers: { 'x-user': 'admin-a' } });
      assert.equal(promote.statusCode, 403);
    }
    const self = await f.app.inject({ method: 'PATCH', url: '/api/v1/members/admin-a', payload: { role: 'owner', expectedVersion: f.version('admin-a') }, headers: { 'x-user': 'admin-a' } });
    assert.equal(self.statusCode, 403);
    const invitation = await f.app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: 'member-new@example.com', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' }, headers: { 'x-user': 'admin-a' } });
    assert.equal(invitation.statusCode, 201);
    assert.equal(invitation.json().localAcceptancePath, undefined);
    const link = await f.app.inject({ method: 'POST', url: `/api/v1/invitations/${invitation.json().id}/link`, payload: {}, headers: { 'x-user': 'admin-a' } });
    assert.equal(link.statusCode, 403);
    const owner = await f.app.inject({ method: 'POST', url: `/api/v1/invitations/${invitation.json().id}/link`, payload: { expectedVersion: invitation.json().version, idempotencyKey: randomUUID() } });
    assert.equal(owner.statusCode, 200);
  } finally { await f.close(); }
});

test('last owner cannot be removed or demoted, but ownership transfer is possible', async () => {
  const f = await fixture();
  try {
    const demote = await f.app.inject({ method: 'PATCH', url: '/api/v1/members/owner-a', payload: { role: 'member', expectedVersion: f.version('owner-a') } });
    assert.equal(demote.statusCode, 409);
    assert.equal(demote.json().error.code, 'last_owner');
    const remove = await f.app.inject({ method: 'DELETE', url: '/api/v1/members/owner-a', payload: { expectedVersion: f.version('owner-a') } });
    assert.equal(remove.statusCode, 409);
    const promote = await f.app.inject({ method: 'PATCH', url: '/api/v1/members/admin-a', payload: { role: 'owner', expectedVersion: f.version('admin-a') } });
    assert.equal(promote.statusCode, 200);
    const transferred = await f.app.inject({ method: 'PATCH', url: '/api/v1/members/owner-a', payload: { role: 'member', expectedVersion: f.version('owner-a') } });
    assert.equal(transferred.statusCode, 200);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE tenant_id='tenant-a' AND role='owner'").get()?.n, 1);
  } finally { await f.close(); }
});

test('role changes revoke sessions and invitations issued under the previous authority', async () => {
  const f = await fixture();
  try {
    f.store.db.prepare("INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,'tenant-a')").run('session-a', 'admin-a', Date.now() + 100000);
    const invitation = (await f.app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: 'pending@example.com', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' }, headers: { 'x-user': 'admin-a' } })).json();
    const demotion = await f.app.inject({ method: 'PATCH', url: '/api/v1/members/admin-a', payload: { role: 'member', expectedVersion: f.version('admin-a') } });
    assert.equal(demotion.statusCode, 200);
    assert.equal(demotion.json().sessionsRevoked, true);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get('admin-a')?.n, 0);
    assert.equal(f.store.get('tenant-a', 'team-invitations', invitation.id)?.status, 'revoked');
  } finally { await f.close(); }
});

test('member removal revokes sessions; tenant boundaries cover members and invitations', async () => {
  const f = await fixture();
  try {
    const invitation = (await f.app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: 'private@example.com', idempotencyKey: randomUUID(), expectedTenantId: 'tenant-a' } })).json();
    const foreign = { 'x-user': 'owner-b' };
    for (const method of ['PATCH', 'DELETE'] as const) {
      const response = await f.app.inject({ method, url: '/api/v1/members/member-a', payload: { expectedVersion: f.version('member-a'), ...(method === 'PATCH' ? { role: 'owner' } : {}) }, headers: foreign });
      assert.equal(response.statusCode, 404);
    }
    const link = await f.app.inject({ method: 'POST', url: `/api/v1/invitations/${invitation.id}/link`, payload: { expectedVersion: invitation.version, idempotencyKey: randomUUID() }, headers: foreign });
    assert.equal(link.statusCode, 404);
    const list = await f.app.inject({ url: '/api/v1/members', headers: foreign });
    assert.equal(list.json().total, 1);
    f.store.db.prepare("INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,'tenant-a')").run('member-session', 'member-a', Date.now() + 100000);
    const remove = await f.app.inject({ method: 'DELETE', url: '/api/v1/members/member-a', payload: { expectedVersion: f.version('member-a') }, headers: { 'x-user': 'admin-a' } });
    assert.equal(remove.statusCode, 204);
    assert.ok(f.store.db.prepare('SELECT id FROM users WHERE id=?').get('member-a'));
    assert.equal(f.store.db.prepare('SELECT id FROM memberships WHERE user_id=? AND tenant_id=?').get('member-a', 'tenant-a'), undefined);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get('member-a')?.n, 0);
  } finally { await f.close(); }
});

test('member and anonymous callers cannot manage team and strict bodies reject injected tenant IDs', async () => {
  const f = await fixture();
  try {
    for (const headers of [{ 'x-user': 'member-a' }, { 'x-anonymous': 'true' }]) {
      const response = await f.app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: 'denied@example.com' }, headers });
      assert.equal(response.statusCode, headers['x-anonymous'] ? 401 : 403);
    }
    const injection = await f.app.inject({ method: 'POST', url: '/api/v1/invitations', payload: { email: 'injected@example.com', expectedTenantId: 'tenant-a', idempotencyKey: randomUUID(), tenantId: 'tenant-b' } });
    assert.equal(injection.statusCode, 400);
    const invalidRole = await f.app.inject({ method: 'PATCH', url: '/api/v1/members/member-a', payload: { role: 'owner', password: 'replacement' } });
    assert.equal(invalidRole.statusCode, 400);
  } finally { await f.close(); }
});
