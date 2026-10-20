import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store.js';
import { digest } from '../oauth/crypto.js';
import { assertRequestContext,parseExpectedRequestContext,resolveSessionContext,sameRequestContext,type ExpectedRequestContext } from '../request-context.js';
import { resolveMembershipActor } from '../memberships/service.js';
import { C,fail,hash,uuid } from './schema.js';

export type PrivateAudience={kind:'private';tenantId:string;userId:string;sessionHash:string;context:ExpectedRequestContext;assertLive:()=>void};
export type PublicAudience={kind:'webchat';tenantId:string;sessionId:string;channelId:string;conversationId:string;origin:string;tokenHash:string};
export type Audience=PrivateAudience|PublicAudience;
export const scope=(a:Audience)=>a.kind==='private'?{kind:'private',userId:a.userId,sessionHash:a.sessionHash,membershipId:a.context.membershipId,authorityVersion:a.context.authorityVersion}:{kind:'webchat',sessionId:a.sessionId,channelId:a.channelId,origin:a.origin,tokenHash:a.tokenHash};
export const privateScope=(a:PrivateAudience)=>({userId:a.userId,sessionHash:a.sessionHash,membershipId:a.context.membershipId,authorityVersion:a.context.authorityVersion});
export function privateAudience(store:Store,req:FastifyRequest):PrivateAudience{
  if(!parseExpectedRequestContext(req))fail(400,'expected_context_required');
  if(req.headers.authorization||req.apiKey||!req.cookies?.kloel_session)fail(401,'authentication_required');
  assertRequestContext(store,req);const sessionHash=digest(req.cookies.kloel_session),live=resolveSessionContext(store,sessionHash);
  if(!live?.actor||live.actor.role!=='owner'||req.actor.userId!==live.actor.userId||req.actor.tenantId!==live.actor.tenantId)fail(403,'calendly_owner_required');
  const context=Object.freeze({...live.context}),a:PrivateAudience={kind:'private',tenantId:live.actor.tenantId,userId:live.actor.userId,sessionHash,context,assertLive:()=>{assertRequestContext(store,req);const now=resolveSessionContext(store,sessionHash);if(!now?.actor||now.actor.role!=='owner'||!sameRequestContext(context,now.context))fail(409,'context_changed_in_flight');}};
  return a;
}
export function assertAudience(store:Store,a:Audience,active=false){
  if(a.kind==='private'){a.assertLive();return;}
  const s=store.get(a.tenantId,'public-chat-sessions',a.sessionId);
  if(!s||s.tokenHash!==a.tokenHash||s.channelId!==a.channelId||s.origin!==a.origin||s.conversationId!==a.conversationId||Number(s.expiresAt)<=Date.now()||!['active',...active?[]:['ended']].includes(String(s.status)))fail(401,'calendly_session_expired');
}
export function publicAudience(store:Store,req:FastifyRequest):PublicAudience{
  const q=z.object({tenantId:z.string().min(1).max(128),channelId:uuid,operationKey:uuid.optional()}).strict().parse(req.query),m=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');
  if(!m||typeof req.headers.origin!=='string')fail(401,'calendly_session_expired');
  const s=store.list(q.tenantId,'public-chat-sessions').find(r=>r.tokenHash===digest(m[1]));if(!s)fail(401,'calendly_session_expired');
  const a:PublicAudience={kind:'webchat',tenantId:q.tenantId,sessionId:s.id,channelId:q.channelId,conversationId:String(s.conversationId),origin:req.headers.origin,tokenHash:digest(m[1])};assertAudience(store,a);return a;
}
export function member(store:Store,tenantId:string,userId:string){
  const a=resolveMembershipActor(store,userId,tenantId),row=store.db.prepare('SELECT id,revision FROM memberships WHERE tenant_id=? AND user_id=?').get(tenantId,userId);
  if(a?.role!=='owner'||!row)fail(403,'calendly_owner_required');return{id:String(row.id),revision:Number(row.revision)};
}
export function connection(store:Store,tenantId:string,id:string,owner?:string){
  const r=store.get(tenantId,C.connections,id);if(!r||owner&&r.issuerUserId!==owner)fail(404,'calendly_connection_not_found');
  if(r.status==='scope_unverified')fail(403,'calendly_scope_unverified');
  if(r.status!=='connected'||r.invalidated===true||hash(member(store,tenantId,String(r.issuerUserId)))!==r.memberHash)fail(409,'calendly_reauthorization_required');return r;
}
export const connectionIdentity=(r:ReturnType<typeof connection>)=>hash([r.id,r.issuerUserId,r.authorizationGeneration,r.remoteUserId,r.remoteOrganizationId,r.scopes,r.memberHash]);
