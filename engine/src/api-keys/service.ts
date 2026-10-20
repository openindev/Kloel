import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../store.js';
import { hasPermission, type Permission } from '../memberships/permissions.js';
import { MembershipError, resolveMembershipActor, type MembershipActor } from '../memberships/service.js';

export const API_KEY_PREFIX = 'klo_key_';
export const apiKeyScopes = ['agents:read', 'agents:write', 'contacts:read', 'contacts:write', 'contacts:delete', 'knowledge:read', 'knowledge:write', 'calendars:read', 'calendars:write', 'appointments:read', 'appointments:write', 'recordings:manage'] as const;
export type ApiKeyScope = typeof apiKeyScopes[number];
export type ApiKeyContext = { id: string; secretHash: string };
export type ApiKeyRow = { id: string; tenant_id: string; creator_id: string; creator_membership_id: string; name: string; secret_hash: string; last4: string; scopes: string; created_at: string; expires_at: string; last_used_at: string | null; revoked_at: string | null; revoked_by: string | null };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const format = /^klo_key_[A-Za-z0-9_-]{43}$/;
export const scopeSchema = z.enum(apiKeyScopes);
const marker = '2026-10-18-api-keys-v1';

export function initializeApiKeys(store: Store) {
  store.transaction(() => {
    if (store.db.prepare('SELECT version FROM engine_migrations WHERE version=?').get(marker)) return;
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES organizations(id),
        creator_id TEXT NOT NULL REFERENCES users(id), creator_membership_id TEXT NOT NULL,
        name TEXT NOT NULL, secret_hash TEXT UNIQUE NOT NULL, last4 TEXT NOT NULL,
        scopes TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        last_used_at TEXT, revoked_at TEXT, revoked_by TEXT
      );
      CREATE INDEX IF NOT EXISTS api_key_tenant ON api_keys(tenant_id);
      CREATE UNIQUE INDEX IF NOT EXISTS api_key_active_name ON api_keys(tenant_id,lower(name)) WHERE revoked_at IS NULL;
      CREATE TABLE IF NOT EXISTS api_key_audit (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, key_id TEXT NOT NULL,
        actor_id TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL,
        method TEXT, route TEXT, status_code INTEGER, detail TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS api_key_audit_scope ON api_key_audit(tenant_id,key_id,created_at);
    `);
    store.db.prepare('INSERT INTO engine_migrations(version,applied_at) VALUES(?,?)').run(marker, new Date().toISOString());
  });
}

export function apiKeyPermission(method: string, path: string): Permission | undefined {
  if (method === 'GET' && path === '/api/v1/crm/contacts/lookup') return 'contacts:read';
  const crm = /^\/api\/v1\/crm\/contacts(?:\/([A-Za-z0-9_-]{1,128}))?$/.exec(path);
  if (crm) {
    if (crm[1] && ['lookup', 'export', 'import', 'settings', 'permissions'].includes(crm[1])) return;
    if (method === 'GET') return 'contacts:read';
    if (method === 'POST' && !crm[1] || method === 'PATCH' && crm[1]) return 'contacts:write';
    if (method === 'DELETE' && crm[1]) return 'contacts:delete';
    return;
  }
  // Keep these exact paths aligned with their independent route guards. No providers,
  // URL imports, bulk contacts, sessions, team, credentials or OAuth are delegated.
  if (method === 'POST' && path === '/api/v1/knowledge/search') return 'knowledge:read';
  if (method === 'POST' && /^\/api\/v1\/knowledge\/[A-Za-z0-9_-]{1,128}\/ingest$/.test(path)) return 'knowledge:write';
  if (method === 'GET' && /^\/api\/v1\/knowledge\/[A-Za-z0-9_-]{1,128}\/chunks$/.test(path)) return 'knowledge:read';
  if (method === 'GET' && /^\/api\/v1\/calendars\/[A-Za-z0-9_-]{1,128}\/slots$/.test(path)) return 'calendars:read';
  const match = /^\/api\/v1\/(agents|contacts|knowledge|calendars|appointments)(?:\/([A-Za-z0-9_-]{1,128}))?$/.exec(path);
  if (!match) return;
  const [, resource, id] = match;
  // Static shortcuts are excluded even if they resemble an entity identifier.
  if (id && ['search', 'upload', 'import-url', 'lookup', 'export', 'import'].includes(id)) return;
  if (method === 'GET') return `${resource}:read` as Permission;
  if (method === 'POST' && !id || method === 'PATCH' && id) return `${resource}:write` as Permission;
  if (method === 'DELETE' && id) return resource === 'contacts' ? 'contacts:delete' : `${resource}:write` as Permission;
}

export function keyRow(store: Store, tenantId: string, id: string): ApiKeyRow | undefined {
  return store.db.prepare('SELECT * FROM api_keys WHERE id=? AND tenant_id=?').get(id, tenantId) as ApiKeyRow | undefined;
}
function creator(store: Store, row: ApiKeyRow) {
  const membership = store.db.prepare('SELECT id FROM memberships WHERE user_id=? AND tenant_id=?').get(row.creator_id, row.tenant_id);
  if (membership?.id !== row.creator_membership_id) return;
  return resolveMembershipActor(store, row.creator_id, row.tenant_id);
}
export function keyView(store: Store, row: ApiKeyRow) {
  const actor = creator(store, row);
  const scopes = z.array(scopeSchema).parse(JSON.parse(row.scopes));
  const permissions = actor && !row.revoked_at && Date.parse(row.expires_at) > Date.now() ? scopes.filter(scope => hasPermission(actor.role, scope)) : [];
  return {
    id: row.id, tenantId: row.tenant_id, orgId: row.tenant_id, name: row.name, prefix: API_KEY_PREFIX,
    secret: `${API_KEY_PREFIX}••••••••••••${row.last4}`, last4: row.last4,
    createdByUserId: row.creator_id, createdAt: row.created_at, expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at, revokedAt: row.revoked_at, scopes, permissions,
    status: row.revoked_at ? 'revoked' : Date.parse(row.expires_at) <= Date.now() ? 'expired' : !actor || !permissions.length ? 'unavailable' : 'active',
  };
}

export function authenticateApiKey(store: Store, token: string) {
  if (!format.test(token)) throw new MembershipError(401, 'invalid_api_key', 'Chave de API inválida, expirada ou revogada.');
  const secretHash = digest(token);
  const row = store.db.prepare('SELECT * FROM api_keys WHERE secret_hash=?').get(secretHash) as ApiKeyRow | undefined;
  if (!row) throw new MembershipError(401, 'invalid_api_key', 'Chave de API inválida, expirada ou revogada.');
  return resolveApiKey(store, { id: row.id, secretHash });
}
export function resolveApiKey(store: Store, context: ApiKeyContext) {
  const row = store.db.prepare('SELECT * FROM api_keys WHERE id=? AND secret_hash=?').get(context.id, context.secretHash) as ApiKeyRow | undefined;
  if (!row || row.revoked_at || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) throw new MembershipError(401, 'invalid_api_key', 'Chave de API inválida, expirada ou revogada.');
  const actor = creator(store, row);
  if (!actor) throw new MembershipError(401, 'invalid_api_key', 'Chave de API inválida, expirada ou revogada.');
  const permissions = z.array(scopeSchema).parse(JSON.parse(row.scopes)).filter(scope => hasPermission(actor.role, scope));
  return { actor, permissions, context: { id: row.id, secretHash: row.secret_hash }, row };
}
export function requireApiKeyScope(store: Store, context: ApiKeyContext, permission: Permission) {
  const result = resolveApiKey(store, context);
  if (!result.permissions.includes(permission as ApiKeyScope)) throw new MembershipError(403, 'api_key_scope_denied', 'O escopo efetivo da chave não permite esta operação.');
  return result;
}
export function auditApiKey(store: Store, input: { tenantId: string; keyId: string; actorId: string | null; action: 'created' | 'renamed' | 'revoked' | 'request'; method?: string; route?: string; statusCode?: number; detail?: Record<string, unknown> }) {
  store.db.prepare('INSERT INTO api_key_audit(id,tenant_id,key_id,actor_id,action,created_at,method,route,status_code,detail) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), input.tenantId, input.keyId, input.actorId, input.action, new Date().toISOString(), input.method ?? null, input.route ?? null, input.statusCode ?? null, JSON.stringify(input.detail ?? {}));
}
export function createApiKey(store: Store, actor: MembershipActor, input: { name: string; scopes?: ApiKeyScope[]; expiresAt?: string }, assertAccess?: () => void) {
  return store.transaction(() => {
    assertAccess?.();
    const fresh = resolveMembershipActor(store, actor.userId, actor.tenantId);
    if (!fresh || !hasPermission(fresh.role, 'api_keys:manage')) throw new MembershipError(403, 'forbidden', 'Seu papel não permite gerenciar chaves de API.');
    const scopes = [...new Set(input.scopes ?? apiKeyScopes.filter(scope => scope.endsWith(':read') && hasPermission(fresh.role, scope)))];
    if (!scopes.length || scopes.some(scope => !apiKeyScopes.includes(scope) || !hasPermission(fresh.role, scope))) throw new MembershipError(403, 'api_key_scope_denied', 'Só é possível delegar permissões que você possui.');
    const expires = input.expiresAt ? Date.parse(input.expiresAt) : Date.now() + 90 * 86400000;
    if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 366 * 86400000) throw new MembershipError(400, 'invalid_expiry', 'A expiração deve ser futura, em até 366 dias.');
    if (store.db.prepare('SELECT id FROM api_keys WHERE tenant_id=? AND lower(name)=lower(?) AND revoked_at IS NULL').get(actor.tenantId, input.name)) throw new MembershipError(409, 'api_key_name_exists', 'Já existe uma chave com este nome.');
    const token = API_KEY_PREFIX + randomBytes(32).toString('base64url'), id = randomUUID(), now = new Date().toISOString();
    const membership = store.db.prepare('SELECT id FROM memberships WHERE user_id=? AND tenant_id=?').get(actor.userId, actor.tenantId)!;
    store.db.prepare('INSERT INTO api_keys(id,tenant_id,creator_id,creator_membership_id,name,secret_hash,last4,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, actor.tenantId, actor.userId, String(membership.id), input.name, digest(token), token.slice(-4), JSON.stringify(scopes), now, new Date(expires).toISOString());
    auditApiKey(store, { tenantId: actor.tenantId, keyId: id, actorId: actor.userId, action: 'created', detail: { scopes, expiresAt: new Date(expires).toISOString() } });
    return { ...keyView(store, keyRow(store, actor.tenantId, id)!), secret: token, secretDisplayedOnce: true };
  });
}
