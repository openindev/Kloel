import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.js';
import { capabilitiesFor, hasPermission } from '../src/memberships/permissions.js';
import { addOrganizationMember, changeOrganizationRole, createOrganizationForUser, initializeMemberships, listOrganizations, MembershipError, registerIdentityWithOrganization, removeOrganizationMember, requireOrganizationPermission, resolveMembershipActor, resolveSessionActor, revokeOrganizationSessions, selectOrganizationForSession, type MembershipActor } from '../src/memberships/service.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const passwordHash = `${'ab'.repeat(16)}:${'cd'.repeat(64)}`;
const ownerA: MembershipActor = { userId: 'owner-a', tenantId: 'tenant-a', role: 'owner' };
const ownerB: MembershipActor = { userId: 'owner-b', tenantId: 'tenant-b', role: 'owner' };

function fixture(initialize = true) {
  const store = new Store(':memory:', { migrateMemberships: false });
  for (const [id, tenantId, role] of [['owner-a', 'tenant-a', 'owner'], ['owner-b', 'tenant-b', 'owner'], ['member-a', 'tenant-a', 'member']]) store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run(id, tenantId, `${id}@example.test`, passwordHash, role);
  store.create('tenant-a', 'organization-settings', { name: 'Empresa A', timezone: 'America/Sao_Paulo' });
  store.create('tenant-b', 'organization-settings', { name: 'Empresa B', timezone: 'America/Sao_Paulo' });
  store.create('tenant-a', 'contacts', { name: 'Preserved contact', email: 'contact@example.test' });
  const expires = Date.now() + 60_000;
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(digest('old-a'), 'owner-a', expires);
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(digest('old-b'), 'owner-b', expires);
  if (initialize) initializeMemberships(store);
  return { store, expires };
}
function session(store: Store, userId: string, tenantId: string, token: string, expires = Date.now() + 60_000) {
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(digest(token), userId, expires, tenantId);
}
function errorCode(code: string) { return (error: unknown) => error instanceof MembershipError && error.code === code; }

test('explicit migration preserves legacy identities, hashes, roles, tenants and sessions without rerunning backfill', t => {
  const { store } = fixture(false); t.after(() => store.close());
  const before = store.db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='memberships'").get(), undefined);
  initializeMemberships(store);
  assert.deepEqual(store.db.prepare('SELECT * FROM users ORDER BY id').all(), before);
  assert.equal(store.list('tenant-a', 'contacts')[0].name, 'Preserved contact');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM memberships').get()?.n, 3);
  assert.deepEqual(resolveSessionActor(store, digest('old-a')), ownerA);
  assert.equal(listOrganizations(store, ownerA.userId)[0].name, 'Empresa A');
  initializeMemberships(store);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM memberships').get()?.n, 3);
  removeOrganizationMember(store, ownerA, 'member-a');
  initializeMemberships(store);
  assert.equal(resolveMembershipActor(store, 'member-a', 'tenant-a'), undefined);
  assert.ok(store.db.prepare('SELECT id FROM users WHERE id=?').get('member-a'));
});

test('invalid legacy role rolls back the entire schema migration instead of guessing privileges', t => {
  const { store } = fixture(false); t.after(() => store.close());
  store.db.prepare('UPDATE users SET role=? WHERE id=?').run('superadmin', 'member-a');
  assert.throws(() => initializeMemberships(store), errorCode('invalid_legacy_role'));
  assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='memberships'").get(), undefined);
  assert.equal(store.db.prepare('PRAGMA table_info(sessions)').all().some(column => column.name === 'tenant_id'), false);
  assert.equal(store.db.prepare('SELECT role FROM users WHERE id=?').get('member-a')?.role, 'superadmin');
});

test('one identity has independent roles and sessions in two organizations; legacy role is never authoritative', t => {
  const { store } = fixture(); t.after(() => store.close());
  addOrganizationMember(store, ownerA, { userId: ownerB.userId, role: 'viewer' });
  session(store, ownerB.userId, 'tenant-a', 'b-in-a');
  assert.deepEqual(resolveSessionActor(store, digest('b-in-a')), { ...ownerB, tenantId: 'tenant-a', role: 'viewer' });
  assert.deepEqual(resolveSessionActor(store, digest('old-b')), ownerB);
  store.db.prepare('UPDATE users SET role=?,tenant_id=? WHERE id=?').run('owner', 'tenant-a', ownerB.userId);
  assert.equal(resolveSessionActor(store, digest('b-in-a'))?.role, 'viewer');
  assert.deepEqual(resolveSessionActor(store, digest('old-b')), ownerB);
  session(store, ownerA.userId, 'tenant-b', 'forged-session');
  assert.equal(resolveSessionActor(store, digest('forged-session')), undefined);
  assert.deepEqual(listOrganizations(store, ownerA.userId).map(org => org.tenantId), ['tenant-a']);
  assert.equal(listOrganizations(store, 'nonexistent').length, 0);
});

test('organization switch requires membership, preserves expiry and rotates the original session hash', t => {
  const { store, expires } = fixture(); t.after(() => store.close());
  addOrganizationMember(store, ownerA, { userId: ownerB.userId, role: 'builder' });
  assert.throws(() => selectOrganizationForSession(store, digest('old-a'), 'tenant-b', digest('unauthorized')), errorCode('organization_unavailable'));
  assert.deepEqual(resolveSessionActor(store, digest('old-a')), ownerA);
  const target = selectOrganizationForSession(store, digest('old-b'), 'tenant-a', digest('rotated'));
  assert.equal(target.role, 'builder');
  assert.equal(resolveSessionActor(store, digest('old-b')), undefined);
  assert.deepEqual(resolveSessionActor(store, digest('rotated')), target);
  assert.equal(store.db.prepare('SELECT expires FROM sessions WHERE hash=?').get(digest('rotated'))?.expires, expires);
  assert.throws(() => selectOrganizationForSession(store, digest('rotated'), 'tenant-a', digest('rotated')), errorCode('session_rotation_required'));
  assert.throws(() => selectOrganizationForSession(store, digest('old-b'), 'tenant-b', digest('replay')), errorCode('session_invalid'));
  store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run('tenant-b');
  assert.throws(() => selectOrganizationForSession(store, digest('rotated'), 'tenant-b', digest('suspended')), errorCode('organization_unavailable'));
});

test('removing membership revokes only tenant sessions and invitations and retains global identity and other membership', t => {
  const { store } = fixture(); t.after(() => store.close());
  addOrganizationMember(store, ownerA, { userId: ownerB.userId, role: 'editor' });
  session(store, ownerB.userId, 'tenant-a', 'b-in-a');
  const invitationA = store.create('tenant-a', 'team-invitations', { invitedBy: ownerB.userId, email: 'invited@example.test', status: 'pending', tokenHash: 'secret-hash' });
  const invitationB = store.create('tenant-b', 'team-invitations', { invitedBy: ownerB.userId, email: 'invited@example.test', status: 'pending', tokenHash: 'other-hash' });
  removeOrganizationMember(store, ownerA, ownerB.userId);
  assert.equal(resolveSessionActor(store, digest('b-in-a')), undefined);
  assert.deepEqual(resolveSessionActor(store, digest('old-b')), ownerB);
  assert.equal(store.db.prepare('SELECT password FROM users WHERE id=?').get(ownerB.userId)?.password, passwordHash);
  assert.equal(store.get('tenant-a', 'team-invitations', invitationA.id)?.status, 'revoked');
  assert.equal(store.get('tenant-a', 'team-invitations', invitationA.id)?.tokenHash, null);
  assert.equal(store.get('tenant-b', 'team-invitations', invitationB.id)?.status, 'pending');
  assert.equal(listOrganizations(store, ownerB.userId).length, 1);
});

test('role changes revoke only the affected tenant and a captured owner cannot bypass a live demotion', t => {
  const { store } = fixture(); t.after(() => store.close());
  addOrganizationMember(store, ownerA, { userId: ownerB.userId, role: 'builder' });
  session(store, ownerB.userId, 'tenant-a', 'b-in-a');
  changeOrganizationRole(store, ownerA, ownerB.userId, 'viewer');
  assert.equal(resolveSessionActor(store, digest('b-in-a')), undefined);
  assert.deepEqual(resolveSessionActor(store, digest('old-b')), ownerB);
  store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=? AND tenant_id=?").run(ownerA.userId, ownerA.tenantId);
  assert.throws(() => changeOrganizationRole(store, ownerA, ownerB.userId, 'owner'), errorCode('forbidden'));
  assert.throws(() => requireOrganizationPermission(store, ownerA, 'agents:write'), errorCode('forbidden'));
});

test('last owner, admin escalation and organization boundaries are enforced transactionally', t => {
  const { store } = fixture(); t.after(() => store.close());
  assert.throws(() => removeOrganizationMember(store, ownerA, ownerA.userId), errorCode('last_owner'));
  assert.throws(() => changeOrganizationRole(store, ownerA, ownerA.userId, 'admin'), errorCode('last_owner'));
  assert.throws(() => changeOrganizationRole(store, ownerA, ownerB.userId, 'member'), errorCode('member_not_found'));
  changeOrganizationRole(store, ownerA, 'member-a', 'admin');
  const admin: MembershipActor = { userId: 'member-a', tenantId: 'tenant-a', role: 'admin' };
  for (const role of ['admin', 'owner'] as const) assert.throws(() => addOrganizationMember(store, admin, { userId: ownerB.userId, role }), errorCode('forbidden'));
  addOrganizationMember(store, admin, { userId: ownerB.userId, role: 'builder' });
  changeOrganizationRole(store, admin, ownerB.userId, 'editor');
  assert.throws(() => changeOrganizationRole(store, admin, ownerB.userId, 'owner'), errorCode('forbidden'));
  assert.throws(() => removeOrganizationMember(store, admin, ownerA.userId), errorCode('forbidden'));
  changeOrganizationRole(store, ownerA, ownerB.userId, 'owner');
  changeOrganizationRole(store, ownerA, ownerA.userId, 'member');
  assert.equal(resolveMembershipActor(store, ownerA.userId, 'tenant-a')?.role, 'member');
  assert.equal(resolveMembershipActor(store, ownerB.userId, 'tenant-a')?.role, 'owner');
});

test('session revocation is scoped and same-role updates do not revoke sessions', t => {
  const { store } = fixture(); t.after(() => store.close());
  addOrganizationMember(store, ownerA, { userId: ownerB.userId, role: 'member' });
  session(store, ownerB.userId, 'tenant-a', 'b-in-a');
  changeOrganizationRole(store, ownerA, ownerB.userId, 'member');
  assert.ok(resolveSessionActor(store, digest('b-in-a')));
  assert.equal(revokeOrganizationSessions(store, ownerA, ownerB.userId), 1);
  assert.equal(resolveSessionActor(store, digest('b-in-a')), undefined);
  assert.ok(resolveSessionActor(store, digest('old-b')));
  session(store, ownerB.userId, 'tenant-a', 'expired', Date.now() - 1);
  assert.equal(resolveSessionActor(store, digest('expired')), undefined);
});

test('new organization adds a membership without copying any business data or provider configuration', t => {
  const { store } = fixture(); t.after(() => store.close());
  const org = createOrganizationForUser(store, ownerA.userId, { name: 'Nova empresa', timezone: 'America/Manaus' });
  assert.equal(org.role, 'owner');
  assert.equal(listOrganizations(store, ownerA.userId).length, 2);
  assert.equal(store.list(org.id, 'contacts').length, 0);
  assert.equal(store.list(org.id, 'oauth-connections').length, 0);
  assert.equal(store.list(org.id, 'organization-settings')[0].timezone, 'America/Manaus');
  assert.deepEqual(resolveSessionActor(store, digest('old-a')), ownerA);
  assert.throws(() => createOrganizationForUser(store, 'not-a-user', { name: 'Invalid' }), errorCode('identity_not_found'));
});

test('registration preserves one identity per normalized email and rolls back identity plus organization together', t => {
  const { store } = fixture(); t.after(() => store.close());
  const result = registerIdentityWithOrganization(store, { email: '  NEW@example.test ', passwordHash, organization: { name: 'New company' } });
  assert.equal(store.db.prepare('SELECT email FROM users WHERE id=?').get(result.userId)?.email, 'new@example.test');
  assert.equal(resolveMembershipActor(store, result.userId, result.organization.id)?.role, 'owner');
  assert.throws(() => registerIdentityWithOrganization(store, { email: 'NEW@example.test', passwordHash, organization: { name: 'Duplicate' } }), errorCode('email_unavailable'));
  assert.throws(() => registerIdentityWithOrganization(store, { email: 'raw@example.test', passwordHash: 'plaintext-password', organization: { name: 'No raw password' } }));
  const users = store.db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n;
  const organizations = store.db.prepare('SELECT COUNT(*) AS n FROM organizations').get()?.n;
  const original = store.create.bind(store);
  store.create = (tenant, collection, data) => { if (collection === 'organization-settings') throw new Error('Injected settings failure'); return original(tenant, collection, data); };
  assert.throws(() => registerIdentityWithOrganization(store, { email: 'rollback@example.test', passwordHash, organization: { name: 'Rollback' } }), /Injected settings failure/);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n, users);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM organizations').get()?.n, organizations);
});

test('capability matrix preserves operator writes and never grants viewer/builder administrative rights', () => {
  assert.equal(hasPermission('viewer', 'agents:read'), true);
  assert.equal(hasPermission('viewer', 'contacts:write'), false);
  assert.equal(hasPermission('viewer', 'appointments:write'), false);
  assert.equal(hasPermission('builder', 'knowledge:write'), true);
  assert.equal(hasPermission('builder', 'phones:write'), false);
  assert.equal(hasPermission('builder', 'api_keys:manage'), false);
  assert.equal(hasPermission('editor', 'api_keys:manage'), true);
  assert.equal(hasPermission('editor', 'billing:manage'), false);
  assert.equal(hasPermission('member', 'contacts:write'), true);
  assert.equal(hasPermission('member', 'agents:write'), false);
  assert.equal(hasPermission('admin', 'owners:manage'), false);
  assert.equal(hasPermission('owner', 'owners:manage'), true);
  assert.equal(hasPermission('__proto__', 'agents:read'), false);
  assert.equal(hasPermission('owner', 'host:credentials'), false);
  assert.equal(new Set(capabilitiesFor('owner')).size, capabilitiesFor('owner').length);
});
