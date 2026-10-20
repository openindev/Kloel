import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { assertRequestContext } from './request-context.js';
import { hasPermission } from './memberships/permissions.js';
import { MembershipError, resolveSessionActor, type MembershipActor } from './memberships/service.js';
import { apiKeyScopes, auditApiKey, createApiKey, keyRow, keyView, scopeSchema, type ApiKeyRow } from './api-keys/service.js';

function manager(store: Store, request: FastifyRequest): MembershipActor {
  assertRequestContext(store, request);
  const token = request.cookies?.kloel_session;
  const actor = !request.apiKey && token ? resolveSessionActor(store, createHash('sha256').update(token).digest('hex')) : undefined;
  if (!actor || actor.userId !== request.actor?.userId || actor.tenantId !== request.actor?.tenantId) throw new MembershipError(401, 'human_session_required', 'Gerenciar chaves exige uma sessão autenticada.');
  if (!hasPermission(actor.role, 'api_keys:manage')) throw new MembershipError(403, 'forbidden', 'Seu papel não permite gerenciar chaves de API.');
  return actor;
}
function managedKey(store: Store, actor: MembershipActor, id: string): ApiKeyRow {
  const row = keyRow(store, actor.tenantId, id);
  if (!row || actor.role === 'editor' && row.creator_id !== actor.userId) throw new MembershipError(404, 'api_key_not_found', 'Chave de API não encontrada.');
  return row;
}
const keyId = (request: FastifyRequest) => z.object({ id: z.string().uuid() }).strict().parse(request.params).id;
const name = z.string().trim().min(1).max(80);

export async function registerApiKeys(app: FastifyInstance, store: Store) {
  app.get('/api/v1/api-keys', async request => {
    const actor = manager(store, request);
    const { includeRevoked } = z.object({ includeRevoked: z.enum(['true', 'false']).default('false') }).strict().parse(request.query);
    const rows = store.db.prepare('SELECT * FROM api_keys WHERE tenant_id=? ORDER BY created_at DESC,id').all(actor.tenantId) as ApiKeyRow[];
    return { items: rows.filter(row => (includeRevoked === 'true' || !row.revoked_at) && (actor.role !== 'editor' || row.creator_id === actor.userId)).map(row => keyView(store, row)), availableScopes: apiKeyScopes.filter(scope => hasPermission(actor.role, scope)) };
  });
  app.post('/api/v1/api-keys', async (request, reply) => {
    const actor = manager(store, request);
    const input = z.object({ name, scopes: z.array(scopeSchema).min(1).max(apiKeyScopes.length).optional(), expiresAt: z.string().datetime({ offset: true }).optional() }).strict().parse(request.body);
    const result = createApiKey(store, actor, input, () => { manager(store, request); });
    return reply.header('Cache-Control', 'no-store').code(201).send(result);
  });
  app.patch('/api/v1/api-keys/:id', async request => {
    const actor = manager(store, request), id = keyId(request);
    const input = z.object({ name }).strict().parse(request.body);
    return store.transaction(() => {
      manager(store, request);
      const row = managedKey(store, actor, id);
      if (row.revoked_at) throw new MembershipError(409, 'api_key_revoked', 'A chave já foi revogada.');
      if (store.db.prepare('SELECT id FROM api_keys WHERE tenant_id=? AND id<>? AND lower(name)=lower(?) AND revoked_at IS NULL').get(actor.tenantId, id, input.name)) throw new MembershipError(409, 'api_key_name_exists', 'Já existe uma chave com este nome.');
      store.db.prepare('UPDATE api_keys SET name=? WHERE id=? AND tenant_id=?').run(input.name, id, actor.tenantId);
      auditApiKey(store, { tenantId: actor.tenantId, keyId: id, actorId: actor.userId, action: 'renamed' });
      return keyView(store, keyRow(store, actor.tenantId, id)!);
    });
  });
  app.delete('/api/v1/api-keys/:id', async (request, reply) => {
    const actor = manager(store, request), id = keyId(request);
    store.transaction(() => {
      manager(store, request);
      const row = managedKey(store, actor, id);
      if (row.revoked_at) return;
      store.db.prepare('UPDATE api_keys SET revoked_at=?,revoked_by=? WHERE id=? AND tenant_id=?').run(new Date().toISOString(), actor.userId, id, actor.tenantId);
      auditApiKey(store, { tenantId: actor.tenantId, keyId: id, actorId: actor.userId, action: 'revoked' });
    });
    return reply.code(204).send();
  });
  app.get('/api/v1/api-keys/:id/audit', async request => {
    const actor = manager(store, request), id = keyId(request);
    managedKey(store, actor, id);
    const { page, limit } = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict().parse(request.query);
    const total = Number(store.db.prepare('SELECT COUNT(*) AS n FROM api_key_audit WHERE tenant_id=? AND key_id=?').get(actor.tenantId, id)!.n);
    const rows = store.db.prepare('SELECT * FROM api_key_audit WHERE tenant_id=? AND key_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(actor.tenantId, id, limit, (page - 1) * limit);
    return { items: rows.map(row => ({ id: row.id, keyId: row.key_id, actorId: row.actor_id, action: row.action, createdAt: row.created_at, method: row.method, route: row.route, statusCode: row.status_code, detail: JSON.parse(String(row.detail)) })), total, page, limit };
  });
}
