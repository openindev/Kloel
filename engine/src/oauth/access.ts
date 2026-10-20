import type { FastifyRequest } from 'fastify';
import type { Entity, Store } from '../store.js';
import { digest, encryptionKey, seal, unseal } from './crypto.js';
import { exchange, OAuthError, providerJson, type Provider, type Tokens } from './client.js';
import { resolveMembershipActor } from '../memberships/service.js';
import { hasPermission } from '../memberships/permissions.js';

export type Actor = FastifyRequest['actor'];
export const privileged = (actor:Actor) => hasPermission(actor.role,'integrations:manage');
export const accessible = (actor:Actor,c:Entity) => c.userId===actor.userId||(c.visibility==='shared'&&privileged(actor));
export const tokenContext = (c:Entity) => `${c.tenantId}:${c.id}:${c.provider}:tokens`;
/** Legacy rows have generation zero. Invalid persisted versions fail closed. */
export function oauthAuthorizationGeneration(connection:Entity):number {
  const value=connection.authorizationGeneration;
  if(value===undefined)return 0;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new OAuthError(503,'oauth_authorization_invalid','Versão de autorização OAuth inválida. Reconecte a conta.');
  return value;
}
const normalizedScopes=(value:unknown,provider:unknown)=>[...new Set(String(value??'').split(/\s+/).filter(Boolean).map(scope=>provider==='microsoft'?scope.replace('https://graph.microsoft.com/','').toLowerCase():scope))].sort();
/** Stable delegation fingerprint: a token refresh never changes consent identity. */
export function oauthAuthorizationIdentity(connection:Entity):string {
  return digest(JSON.stringify({tenantId:connection.tenantId,id:connection.id,generation:oauthAuthorizationGeneration(connection),provider:connection.provider,remoteId:connection.remoteId??null,userId:connection.userId??null,email:typeof connection.email==='string'?connection.email.toLowerCase():null,visibility:connection.visibility??null,status:connection.status??null,capabilities:Array.isArray(connection.capabilities)?[...new Set(connection.capabilities.map(String))].sort():[],scopes:normalizedScopes(connection.scopes,connection.provider)}));
}
/** Internal authorization mutations only. Call inside the caller's transaction. */
export function updateOAuthAuthorization(store:Store,connection:Entity,changes:Record<string,unknown>):Entity {
  const current=store.get(connection.tenantId,'oauth-connections',connection.id);
  if(!current||oauthAuthorizationIdentity(current)!==oauthAuthorizationIdentity(connection))throw new OAuthError(409,'oauth_connection_changed','A autorização OAuth mudou durante a operação.');
  const generation=oauthAuthorizationGeneration(current);
  if(generation===Number.MAX_SAFE_INTEGER)throw new OAuthError(503,'oauth_authorization_invalid','Limite de versões OAuth atingido.');
  return store.update(current.tenantId,'oauth-connections',current.id,{...changes,authorizationGeneration:generation+1})!;
}
/** Long-lived tool contexts must not retain privileges after account removal or role changes. */
export function currentActor(store:Store,actor:Actor):Actor {
  const current=resolveMembershipActor(store,actor.userId,actor.tenantId);
  if(!current)throw new OAuthError(401,'authentication_required','O vínculo da organização não está disponível.');
  return current;
}
export function storageKey() {try{return encryptionKey();}catch{throw new OAuthError(503,'oauth_storage_unavailable','Chave de proteção OAuth não configurada.');}}
const stores = new WeakMap<Store,Map<string,Promise<Tokens>>>();
export function scopedConnection(store:Store,actor:Actor,id:string):Entity {
  actor=currentActor(store,actor);
  const c=store.get(actor.tenantId,'oauth-connections',id);
  if(!c||!accessible(actor,c))throw new OAuthError(404,'connection_not_found','Conexão não encontrada.');
  return c;
}
export async function accessTokens(store:Store,c:Entity):Promise<Tokens> {
  const latest=store.get(c.tenantId,'oauth-connections',c.id);
  if(!latest)throw new OAuthError(503,'integration_disconnected','Conta desconectada.');
  if(oauthAuthorizationIdentity(latest)!==oauthAuthorizationIdentity(c))throw new OAuthError(409,'oauth_connection_changed','A autorização OAuth mudou durante a operação.');
  c=latest;
  if(c.status!=='connected'||typeof c.encryptedTokens!=='string')throw new OAuthError(503,'integration_disconnected','Conta desconectada. Autorize a conexão.');
  let t:Tokens;
  try{t=unseal<Tokens>(c.encryptedTokens,tokenContext(c),storageKey());}catch(e){if(e instanceof OAuthError)throw e;throw new OAuthError(503,'oauth_storage_unavailable','Não foi possível abrir as credenciais da conexão.');}
  if(t.expiresAt>Date.now()+60_000)return t;
  if(!t.refreshToken)throw new OAuthError(503,'reauthorization_required','Autorize novamente a conexão.');
  let refreshes=stores.get(store);if(!refreshes){refreshes=new Map();stores.set(store,refreshes);}
  const identity=oauthAuthorizationIdentity(c),refreshKey=`${c.tenantId}:${c.id}:${identity}:${digest(c.encryptedTokens)}`;
  if(refreshes.has(refreshKey))return refreshes.get(refreshKey)!;
  const work=(async()=>{
    const fresh=await exchange(c.provider as Provider,{grant_type:'refresh_token',refresh_token:t.refreshToken!},String(c.scopes).split(' '),t);
    // A refresh never changes what this connection is authorized for. The provider may also list scopes consented in another
    // authorization of the same account (Microsoft returns every scope consented for Graph, ex.: Mail.ReadWrite granted in a
    // reconnection the callback refused): they are ignored and the kept token carries only the connection's scopes. Only a
    // LOST scope requires consent again.
    const granted=new Set(normalizedScopes(fresh.scope,c.provider)),kept:Tokens={...fresh,scope:String(c.scopes??'')};
    store.transaction(()=>{
      const current=store.get(c.tenantId,'oauth-connections',c.id);
      if(!current||current.status!=='connected')throw new OAuthError(503,'integration_disconnected','Conta desconectada.');
      if(oauthAuthorizationIdentity(current)!==identity)throw new OAuthError(409,'oauth_connection_changed','A autorização OAuth mudou durante a renovação.');
      if(current.encryptedTokens!==c.encryptedTokens)throw new OAuthError(409,'oauth_tokens_changed','As credenciais OAuth foram renovadas por outra operação.');
      if(normalizedScopes(c.scopes,c.provider).some(scope=>!granted.has(scope)))throw new OAuthError(503,'reauthorization_required','As permissões OAuth mudaram. Autorize novamente a conexão.');
      store.update(c.tenantId,'oauth-connections',c.id,{encryptedTokens:seal(kept,tokenContext(c),storageKey())});
    });
    return kept;
  })();
  refreshes.set(refreshKey,work);
  try{return await work;}finally{if(refreshes.get(refreshKey)===work)refreshes.delete(refreshKey);}
}
export async function oauthRequest(store:Store,c:Entity,url:string,init:RequestInit={},allowEmpty=false) {
  const t=await accessTokens(store,c);
  const assertCurrent=()=>{const current=store.get(c.tenantId,'oauth-connections',c.id);if(!current||current.status!=='connected'||oauthAuthorizationIdentity(current)!==oauthAuthorizationIdentity(c))throw new OAuthError(409,'oauth_connection_changed','A autorização OAuth mudou durante a operação.');};
  assertCurrent();
  const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${t.accessToken}`);
  const result=await providerJson(url,{...init,headers},allowEmpty);assertCurrent();return result;
}
