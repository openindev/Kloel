import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Store } from '../store.js';
import { assertRequestContext } from '../request-context.js';
import { hasPermission, type Permission } from './permissions.js';
import { MembershipError, resolveMembershipActor, resolveSessionActor } from './service.js';
import { apiKeyPermission, requireApiKeyScope } from '../api-keys/service.js';

/** Recheck captured requests after awaits. A live session cannot outlive its membership. */
export function currentRequestActor(store: Store, request: FastifyRequest) {
  assertRequestContext(store, request);
  const captured = request.actor;
  if (!captured?.tenantId || !captured.userId) throw new MembershipError(401, 'unauthorized', 'Autenticação necessária.');
  if (request.apiKey) {
    const permission = apiKeyPermission(request.method, request.url.split('?')[0]);
    if (!permission) throw new MembershipError(403, 'api_key_route_forbidden', 'Esta rota não aceita chave de API.');
    const { actor } = requireApiKeyScope(store, request.apiKey, permission);
    if (actor.userId !== captured.userId || actor.tenantId !== captured.tenantId) throw new MembershipError(401, 'invalid_api_key', 'Chave de API indisponível.');
    return actor;
  }
  const token = request.cookies?.kloel_session;
  const actor = token ? resolveSessionActor(store, createHash('sha256').update(token).digest('hex')) : resolveMembershipActor(store, captured.userId, captured.tenantId);
  if (!actor || actor.userId !== captured.userId || actor.tenantId !== captured.tenantId) throw new MembershipError(401, 'unauthorized', 'Sessão ou vínculo da organização revogado.');
  return actor;
}

export function requireRequestPermission(store: Store, request: FastifyRequest, permission: Permission) {
  const actor = currentRequestActor(store, request);
  if (!hasPermission(actor.role, permission)) throw new MembershipError(403, 'forbidden', 'Seu papel nesta organização não permite esta operação.');
  if (request.apiKey) requireApiKeyScope(store, request.apiKey, permission);
  return actor;
}
