import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../store.js';
import { canManageRole, hasPermission, roleSchema, type Role } from './permissions.js';

export type MembershipActor = { userId: string; tenantId: string; role: Role };
export type Membership = { id: string; userId: string; tenantId: string; role: Role; joinedAt: string; revision: number; version: string };
export type OrganizationMembership = { id: string; tenantId: string; name: string; status: 'active'; createdAt: string; membershipId: string; role: Role; joinedAt: string };
export class MembershipError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}
const migration = '2026-10-18-memberships-v1';
const organizationInput = z.object({ name: z.string().trim().min(2).max(120), timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }).default('America/Sao_Paulo') }).strict();
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Explicit, additive migration. Importing this module never changes any database. */
export function initializeMemberships(store: Store): void {
  store.transaction(() => {
    store.db.exec('CREATE TABLE IF NOT EXISTS engine_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    if (store.db.prepare('SELECT version FROM engine_migrations WHERE version=?').get(migration)) return;
    store.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS identity_email_casefold ON users(lower(email));
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','suspended')), created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memberships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        tenant_id TEXT NOT NULL REFERENCES organizations(id),
        role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','builder','member','viewer')),
        joined_at TEXT NOT NULL,
        UNIQUE(user_id,tenant_id)
      );
      CREATE INDEX IF NOT EXISTS membership_tenant_role ON memberships(tenant_id,role);
      CREATE INDEX IF NOT EXISTS membership_user ON memberships(user_id);
    `);
    if (!store.db.prepare('PRAGMA table_info(sessions)').all().some(column => column.name === 'tenant_id')) store.db.exec('ALTER TABLE sessions ADD COLUMN tenant_id TEXT REFERENCES organizations(id)');
    const now = new Date().toISOString();
    const tenants = store.db.prepare('SELECT tenant_id FROM users UNION SELECT tenant_id FROM entities').all();
    for (const row of tenants) {
      const tenantId = String(row.tenant_id);
      if (!tenantId) throw new MembershipError(409, 'invalid_legacy_tenant', 'Existe dado legado sem organização válida.');
      const settings = store.list(tenantId, 'organization-settings')[0];
      const name = typeof settings?.name === 'string' && settings.name.trim() ? settings.name : 'Organização existente';
      store.db.prepare("INSERT OR IGNORE INTO organizations(id,name,status,created_at) VALUES(?,?,'active',?)").run(tenantId, name, now);
    }
    for (const row of store.db.prepare('SELECT id,tenant_id,role FROM users').all()) {
      const role = roleSchema.safeParse(row.role);
      if (!role.success) throw new MembershipError(409, 'invalid_legacy_role', 'Papel legado inválido; migração cancelada sem alterar dados.');
      store.db.prepare('INSERT OR IGNORE INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,?,?)').run(randomUUID(), String(row.id), String(row.tenant_id), role.data, now);
    }
    store.db.exec('UPDATE sessions SET tenant_id=(SELECT u.tenant_id FROM users u WHERE u.id=sessions.user_id) WHERE tenant_id IS NULL');
    store.db.exec('CREATE INDEX IF NOT EXISTS session_membership ON sessions(user_id,tenant_id)');
    store.db.prepare('INSERT INTO engine_migrations(version,applied_at) VALUES(?,?)').run(migration, now);
  });
  store.transaction(() => {
    const version = '2026-10-18-memberships-v2-revision';
    if (store.db.prepare('SELECT version FROM engine_migrations WHERE version=?').get(version)) return;
    if (!store.db.prepare('PRAGMA table_info(memberships)').all().some(column => column.name === 'revision')) store.db.exec('ALTER TABLE memberships ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
    // Includes internal role writes: owner -> member -> owner must invalidate old views.
    store.db.exec(`CREATE TRIGGER IF NOT EXISTS membership_role_revision AFTER UPDATE OF role ON memberships
      WHEN OLD.role <> NEW.role BEGIN UPDATE memberships SET revision=revision+1 WHERE id=NEW.id; END;`);
    store.db.prepare('INSERT INTO engine_migrations(version,applied_at) VALUES(?,?)').run(version, new Date().toISOString());
  });
}

function actorFrom(row: Record<string, unknown> | undefined): MembershipActor | undefined {
  if (!row) return;
  const role = roleSchema.safeParse(row.role);
  return role.success ? { userId: String(row.user_id), tenantId: String(row.tenant_id), role: role.data } : undefined;
}

export function resolveSessionActor(store: Store, sessionHash: string, now = Date.now()): MembershipActor | undefined {
  return actorFrom(store.db.prepare(`SELECT u.id AS user_id,s.tenant_id,m.role FROM sessions s
    JOIN users u ON u.id=s.user_id
    JOIN memberships m ON m.user_id=u.id AND m.tenant_id=s.tenant_id
    JOIN organizations o ON o.id=m.tenant_id AND o.status='active'
    WHERE s.hash=? AND s.expires>?`).get(sessionHash, now));
}

export function resolveSessionIdentity(store: Store, sessionHash: string, now = Date.now()): { userId: string } | undefined {
  const row = store.db.prepare('SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?').get(sessionHash, now);
  return row ? { userId: String(row.id) } : undefined;
}

export function resolveMembershipActor(store: Store, userId: string, tenantId: string): MembershipActor | undefined {
  return actorFrom(store.db.prepare(`SELECT m.user_id,m.tenant_id,m.role FROM memberships m
    JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=m.tenant_id AND o.status='active'
    WHERE m.user_id=? AND m.tenant_id=?`).get(userId, tenantId));
}

function requireActor(store: Store, actor: MembershipActor): MembershipActor {
  const current = resolveMembershipActor(store, actor.userId, actor.tenantId);
  if (!current) throw new MembershipError(401, 'membership_revoked', 'Vínculo da organização indisponível.');
  return current;
}

export function membership(store: Store, tenantId: string, userId: string): Membership {
  const row = store.db.prepare('SELECT id,user_id,tenant_id,role,joined_at,revision FROM memberships WHERE user_id=? AND tenant_id=?').get(userId, tenantId);
  if (!row) throw new MembershipError(404, 'member_not_found', 'Membro não encontrado nesta organização.');
  const data = { id: String(row.id), userId: String(row.user_id), tenantId: String(row.tenant_id), role: roleSchema.parse(row.role), joinedAt: String(row.joined_at), revision: Number(row.revision) };
  return { ...data, version: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}

function expectVersion(target: Membership, expectedVersion?: string) {
  if (expectedVersion !== undefined && hashSchema.parse(expectedVersion) !== target.version) throw new MembershipError(409, 'version_conflict', 'O vínculo mudou; consulte a equipe antes de tentar novamente.');
}

function retainOwner(store: Store, target: Membership) {
  if (target.role === 'owner' && Number(store.db.prepare("SELECT COUNT(*) AS count FROM memberships WHERE tenant_id=? AND role='owner'").get(target.tenantId)?.count) <= 1) throw new MembershipError(409, 'last_owner', 'A organização precisa manter pelo menos um proprietário.');
}

function requireManage(actor: MembershipActor, targetRole: Role, nextRole?: Role) {
  if (!canManageRole(actor.role, targetRole, nextRole)) throw new MembershipError(403, 'forbidden', 'Seu papel não permite gerenciar este vínculo ou conceder este papel.');
}

function revokeIssuedInvitations(store: Store, tenantId: string, userId: string, revokedBy: string) {
  for (const invitation of store.list(tenantId, 'team-invitations')) {
    if (invitation.invitedBy === userId && invitation.status === 'pending') store.update(tenantId, 'team-invitations', invitation.id, { status: 'revoked', tokenHash: null, revokedBy, revision: Number(invitation.revision || 0) + 1 });
  }
}

export function listOrganizations(store: Store, userId: string): OrganizationMembership[] {
  return store.db.prepare(`SELECT o.id,o.name,o.created_at,m.id AS membership_id,m.role,m.joined_at FROM memberships m
    JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=m.tenant_id AND o.status='active'
    WHERE m.user_id=? ORDER BY o.created_at,o.id`).all(userId).map(row => {
    const settings = store.list(String(row.id), 'organization-settings')[0];
    return { id: String(row.id), tenantId: String(row.id), name: typeof settings?.name === 'string' ? settings.name : String(row.name), status: 'active', createdAt: String(row.created_at), membershipId: String(row.membership_id), role: roleSchema.parse(row.role), joinedAt: String(row.joined_at) };
  });
}

function insertOrganization(store: Store, userId: string, input: z.infer<typeof organizationInput>, tenantId = randomUUID()): OrganizationMembership {
  const now = new Date().toISOString(), membershipId = randomUUID();
  store.db.prepare("INSERT INTO organizations(id,name,status,created_at) VALUES(?,?,'active',?)").run(tenantId, input.name, now);
  store.db.prepare("INSERT INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,'owner',?)").run(membershipId, userId, tenantId, now);
  store.create(tenantId, 'organization-settings', { name: input.name, country: 'BR', locale: 'pt-BR', timezone: input.timezone });
  return { id: tenantId, tenantId, name: input.name, status: 'active', createdAt: now, membershipId, role: 'owner', joinedAt: now };
}

/** Internal service: the route must obtain userId from an authenticated identity. */
export function createOrganizationForUser(store: Store, userId: string, input: unknown, assertAccess?: () => void): OrganizationMembership {
  const data = organizationInput.parse(input);
  return store.transaction(() => {
    assertAccess?.();
    if (!store.db.prepare('SELECT id FROM users WHERE id=?').get(userId)) throw new MembershipError(401, 'identity_not_found', 'Identidade autenticada não encontrada.');
    return insertOrganization(store, userId, data);
  });
}

/** Auth adapter supplies a server-generated scrypt hash, never a public request hash. */
export function registerIdentityWithOrganization(store: Store, input: unknown): { userId: string; organization: OrganizationMembership } {
  const data = z.object({ email: z.string().trim().toLowerCase().email().max(254), passwordHash: z.string().regex(/^[a-f0-9]{32}:[a-f0-9]{128}$/), organization: organizationInput }).strict().parse(input);
  return store.transaction(() => {
    if (store.db.prepare('SELECT id FROM users WHERE lower(email)=?').get(data.email)) throw new MembershipError(409, 'email_unavailable', 'E-mail já associado a uma identidade.');
    const userId = randomUUID(), tenantId = randomUUID();
    // Legacy columns remain physically present but are never used for authorization here.
    store.db.prepare("INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,'owner')").run(userId, tenantId, data.email, data.passwordHash);
    const organization = insertOrganization(store, userId, data.organization, tenantId);
    return { userId, organization };
  });
}

export function selectOrganizationForSession(store: Store, sessionHash: string, tenantId: string, replacementHash: string, now = Date.now(), assertAccess?: () => void): MembershipActor {
  hashSchema.parse(replacementHash);
  if (sessionHash === replacementHash) throw new MembershipError(400, 'session_rotation_required', 'A seleção exige um novo token de sessão.');
  return store.transaction(() => {
    assertAccess?.();
    const current = resolveSessionIdentity(store, sessionHash, now);
    if (!current) throw new MembershipError(401, 'session_invalid', 'Sessão inválida ou expirada.');
    const target = resolveMembershipActor(store, current.userId, tenantId);
    if (!target) throw new MembershipError(403, 'organization_unavailable', 'Organização indisponível para esta identidade.');
    const old = store.db.prepare('SELECT expires FROM sessions WHERE hash=?').get(sessionHash)!;
    store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(replacementHash, current.userId, Number(old.expires), tenantId);
    store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sessionHash);
    return target;
  });
}

export function addOrganizationMember(store: Store, actor: MembershipActor, input: { userId: string; role: Role }): Membership {
  const data = z.object({ userId: z.string().min(1).max(128), role: roleSchema }).strict().parse(input);
  return store.transaction(() => {
    const current = requireActor(store, actor);
    requireManage(current, data.role, data.role);
    if (!store.db.prepare('SELECT id FROM users WHERE id=?').get(data.userId)) throw new MembershipError(404, 'identity_not_found', 'Identidade não encontrada.');
    if (store.db.prepare('SELECT id FROM memberships WHERE user_id=? AND tenant_id=?').get(data.userId, current.tenantId)) throw new MembershipError(409, 'already_member', 'A identidade já pertence à organização.');
    store.db.prepare('INSERT INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,?,?)').run(randomUUID(), data.userId, current.tenantId, data.role, new Date().toISOString());
    return membership(store, current.tenantId, data.userId);
  });
}

export function changeOrganizationRole(store: Store, actor: MembershipActor, userId: string, nextRole: Role, expectedVersion?: string, assertAccess?: () => void): Membership {
  roleSchema.parse(nextRole);
  return store.transaction(() => {
    assertAccess?.();
    const current = requireActor(store, actor), target = membership(store, current.tenantId, userId);
    requireManage(current, target.role, nextRole);
    expectVersion(target, expectedVersion);
    if (target.role !== nextRole) {
      if (nextRole !== 'owner') retainOwner(store, target);
      store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run(nextRole, userId, current.tenantId);
      store.db.prepare('DELETE FROM sessions WHERE user_id=? AND tenant_id=?').run(userId, current.tenantId);
      revokeIssuedInvitations(store, current.tenantId, userId, current.userId);
    }
    return membership(store, current.tenantId, userId);
  });
}

export function removeOrganizationMember(store: Store, actor: MembershipActor, userId: string, expectedVersion?: string, assertAccess?: () => void): void {
  store.transaction(() => {
    assertAccess?.();
    const current = requireActor(store, actor), target = membership(store, current.tenantId, userId);
    requireManage(current, target.role); expectVersion(target, expectedVersion); retainOwner(store, target);
    const user = store.db.prepare('SELECT email FROM users WHERE id=?').get(userId)!;
    store.db.prepare('DELETE FROM sessions WHERE user_id=? AND tenant_id=?').run(userId, current.tenantId);
    store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(userId, current.tenantId);
    revokeIssuedInvitations(store, current.tenantId, userId, current.userId);
    for (const invitation of store.list(current.tenantId, 'team-invitations')) if (invitation.email === user.email && invitation.status === 'pending') store.update(current.tenantId, 'team-invitations', invitation.id, { status: 'revoked', tokenHash: null, revokedBy: current.userId, revision: Number(invitation.revision || 0) + 1 });
  });
}

export function revokeOrganizationSessions(store: Store, actor: MembershipActor, userId: string, expectedVersion?: string, assertAccess?: () => void): number {
  return store.transaction(() => {
    assertAccess?.();
    const current = requireActor(store, actor), target = membership(store, current.tenantId, userId);
    requireManage(current, target.role);
    expectVersion(target, expectedVersion);
    store.db.prepare('UPDATE memberships SET revision=revision+1 WHERE id=?').run(target.id);
    revokeIssuedInvitations(store, current.tenantId, userId, current.userId);
    return Number(store.db.prepare('DELETE FROM sessions WHERE user_id=? AND tenant_id=?').run(userId, current.tenantId).changes);
  });
}

export function requireOrganizationPermission(store: Store, actor: MembershipActor, permission: string): MembershipActor {
  const current = requireActor(store, actor);
  if (!hasPermission(current.role, permission)) throw new MembershipError(403, 'forbidden', 'Permissão insuficiente nesta organização.');
  return current;
}
