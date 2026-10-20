import type { Entity, Store } from '../store.js';
import type { FastifyRequest } from 'fastify';
import { assertRequestContext } from '../request-context.js';
import { MembershipError } from '../memberships/service.js';
import { hasPermission } from '../memberships/permissions.js';
import { accessTokens, currentActor, scopedConnection, oauthAuthorizationIdentity, type Actor } from './access.js';
import { OAuthError, providerJson } from './client.js';

/** HTTP-only precondition. Workers and agents retain their independent grant authority. */
export function requestOAuthGuard(store: Store, request: FastifyRequest): () => void {
  return () => {
    try { assertRequestContext(store, request); }
    catch (error) {
      if (error instanceof MembershipError) throw new OAuthError(error.statusCode, error.code, error.message);
      throw error;
    }
  };
}

export function authorizedOAuthActor(store: Store, actor: Actor): Actor {
  const current = currentActor(store, actor);
  if (!hasPermission(current.role, 'integrations:execute')) throw new OAuthError(403, 'forbidden', 'Seu papel não permite utilizar conexões externas.');
  return current;
}

export function authorizedOAuthConnection(store: Store, actor: Actor, id: string, capability?: string): Entity {
  actor = authorizedOAuthActor(store, actor);
  const connection = scopedConnection(store, actor, id);
  if (connection.status !== 'connected') throw new OAuthError(503, 'integration_disconnected', 'Conta desconectada.');
  if (capability && (!Array.isArray(connection.capabilities) || !connection.capabilities.includes(capability))) throw new OAuthError(403, 'capability_not_authorized', 'A conexão não tem a permissão solicitada.');
  return connection;
}

/** Token refresh is an external await: repeat organization and connection checks before using its result. */
export async function authorizedOAuthRequest(store: Store, actor: Actor, connection: Entity, url: string, init: RequestInit = {}, allowEmpty = false, capability?: string, assertAccess?: () => void, recordResponse?: (response: Record<string, any>) => void) {
  assertAccess?.();
  const initial = authorizedOAuthConnection(store, actor, connection.id, capability);
  if (oauthAuthorizationIdentity(initial) !== oauthAuthorizationIdentity(connection)) throw new OAuthError(409, 'oauth_connection_changed', 'A conexão foi alterada durante a operação.');
  const tokens = await accessTokens(store, initial);
  assertAccess?.();
  const current = authorizedOAuthConnection(store, actor, connection.id, capability);
  if (oauthAuthorizationIdentity(current) !== oauthAuthorizationIdentity(initial)) throw new OAuthError(409, 'oauth_connection_changed', 'A conexão foi alterada durante a operação.');
  const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  assertAccess?.();
  const response = await providerJson(url, { ...init, headers }, allowEmpty);
  // Writers validate and journal a confirmed provider result before a late revocation
  // suppresses its disclosure. This callback must be synchronous and receipt-only.
  recordResponse?.(response);
  assertAccess?.();
  const completed = authorizedOAuthConnection(store, actor, connection.id, capability);
  if (oauthAuthorizationIdentity(completed) !== oauthAuthorizationIdentity(initial)) throw new OAuthError(409, 'oauth_connection_changed', 'A conexão foi alterada durante a operação.');
  return response;
}
