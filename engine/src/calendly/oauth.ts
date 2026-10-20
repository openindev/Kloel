import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Store,Entity } from '../store.js';
import type { FastifyRequest } from 'fastify';
import { digest,seal,unseal,encryptionKey } from '../oauth/crypto.js';
import { resolveSessionContext,sameRequestContext } from '../request-context.js';
import { C,fail,hash,uuid,nextRevision,CalendlyError } from './schema.js';
import { assertAudience,connection,connectionIdentity,member,scope,type PrivateAudience } from './access.js';

export const requestedScopes=['users:read','event_types:read','availability:read','scheduled_events:read','scheduled_events:write'];
const secret=z.string().min(1).max(8000),uuidPattern='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function remoteId(value:unknown,kind:'users'|'organizations'|'event_types'|'scheduled_events'|'invitees'){
  if(typeof value!=='string'||value.length>512)return fail(502,'calendly_provider_response_invalid');
  const m=new RegExp(kind==='invitees'?`^https://api\\.calendly\\.com/(?:api/v2/)?scheduled_events/(${uuidPattern})/invitees/(${uuidPattern})$`:`^https://api\\.calendly\\.com/(?:api/v2/)?${kind}/(${uuidPattern})$`).exec(value);
  if(!m)fail(502,'calendly_provider_response_invalid');return{ id:m.at(-1)!.toLowerCase(),eventId:kind==='invitees'?m[1].toLowerCase():undefined};
}
export const remoteUri=(kind:string,id:string)=>`https://api.calendly.com/${kind}/${uuid.parse(id)}`;
export function appConfiguration(){
  encryptionKey();const clientId=secret.parse(process.env.CALENDLY_CLIENT_ID),clientSecret=secret.parse(process.env.CALENDLY_CLIENT_SECRET),redirect=new URL(String(process.env.CALENDLY_REDIRECT_URI));
  if(redirect.username||redirect.password||redirect.search||redirect.hash||redirect.pathname!=='/api/v1/calendly/oauth/callback'||redirect.protocol!=='https:'&&!(redirect.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(redirect.hostname)))fail(409,'calendly_reauthorization_required');
  return{clientId,clientSecret,redirect:redirect.href};
}
export function status(){let callbackUrl:string|null=null;try{callbackUrl=appConfiguration().redirect;}catch{}return{provider:'calendly' as const,configured:callbackUrl!==null,callbackUrl,requestedScopes:[...requestedScopes],schedulingRequiresPaidPlan:true as const,realAccountVerified:false as const};}
type RequestOptions={method?:'GET'|'POST';body?:string;headers?:Record<string,string>;check:()=>void;observed?:(status:number)=>void;beforeDispatch?:()=>void};
/** Fixed hosts/paths. Positive HTTP evidence is recorded before body parsing or a late access guard. */
export async function calendlyJson(path:string,options:RequestOptions,auth=false):Promise<unknown>{
  const cancellation=!auth&&(options.method??'GET')==='POST'&&/^\/scheduled_events\/[0-9a-f-]{36}\/cancellation$/.test(path);
  if(!cancellation&&(auth?path!=='/oauth/token':!/^\/(users\/me|event_types(?:\/[0-9a-f-]{36})?|event_type_available_times|invitees|scheduled_events\/[0-9a-f-]{36}(?:\/invitees\/[0-9a-f-]{36})?)(?:\?[^#]*)?$/.test(path)))fail(400,'invalid_input');
  if((options.method??'GET')==='POST'&&!(auth||path==='/invitees'||cancellation))fail(400,'invalid_input');
  const controller=new AbortController();let rejectDeadline!:(reason:Error)=>void;const deadline=new Promise<never>((_resolve,reject)=>{rejectDeadline=reject;});
  const timer=setTimeout(()=>{controller.abort();rejectDeadline(new CalendlyError(502,'calendly_outcome_unknown'));},15000);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    options.check();options.beforeDispatch?.();const response=await Promise.race([fetch(`${auth?'https://auth.calendly.com':'https://api.calendly.com'}${path}`,{method:options.method??'GET',headers:options.headers,body:options.body,redirect:'error',signal:controller.signal}),deadline]);
    options.observed?.(response.status);
    if(!response.ok){void response.body?.cancel().catch(()=>{});throw new CalendlyError(response.status>=400&&response.status<500?502:503,response.status>=400&&response.status<500?'calendly_provider_rejected':'calendly_outcome_unknown');}
    if(Number(response.headers.get('content-length')??0)>262144)fail(502,'calendly_provider_response_invalid');
    reader=response.body?.getReader();if(!reader)fail(502,'calendly_provider_response_invalid');let size=0;const chunks:Uint8Array[]=[];
    while(true){const v=await Promise.race([reader.read(),deadline]);if(v.done)break;size+=v.value.byteLength;if(size>262144)fail(502,'calendly_provider_response_invalid');chunks.push(v.value);}
    let data:unknown;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return fail(502,'calendly_provider_response_invalid');}
    // A booking caller can preserve validated original references before its own post-guard.
    if(!options.observed)options.check();return data;
  }catch(e){if(e instanceof CalendlyError||e instanceof z.ZodError)throw e;return fail(502,'calendly_outcome_unknown');}
  finally{clearTimeout(timer);void reader?.cancel().catch(()=>{});}
}
const tokens=z.object({access_token:secret,refresh_token:secret,token_type:z.literal('Bearer'),expires_in:z.number().int().min(60).max(86400),owner:z.string(),organization:z.string(),scope:z.string().max(2000).optional()}).passthrough();
function parseTokens(raw:unknown){const t=tokens.safeParse(raw);if(!t.success)fail(502,'calendly_provider_response_invalid');const scopes=t.data.scope?.split(/\s+/).filter(Boolean)??[];return{accessToken:t.data.access_token,refreshToken:t.data.refresh_token,expiresAt:Date.now()+t.data.expires_in*1000,remoteUserId:remoteId(t.data.owner,'users').id,remoteOrganizationId:remoteId(t.data.organization,'organizations').id,scopes:[...new Set(scopes)].sort()};}
const tokenAAD=(tenant:string,id:string,version:number)=>`${tenant}:${id}:calendly:${version}`;
export function connectionView(row:Entity){return{id:row.id,provider:'calendly' as const,revision:Number(row.revision),authorizationGeneration:Number(row.authorizationGeneration),status:row.invalidated===true&&row.status!=='disconnected'?'reauthorization_required':row.status,displayName:String(row.displayName??'Calendly'),timezone:String(row.timezone??'UTC'),scopes:row.scopes as string[],createdAt:row.createdAt,updatedAt:row.updatedAt};}
export function oauthIntent(store:Store,a:PrivateAudience,key:string){
  assertAudience(store,a);const r=store.list(a.tenantId,C.states).find(r=>r.key===uuid.parse(key));if(!r||hash(r.scope)!==hash(scope(a)))fail(404,'calendly_operation_not_found');
  const state=r.connectionId?'connected':r.consumed===true?'unknown':r.invalidated===true||Number(r.expiresAt)<=Date.now()?'expired':'pending';
  return{operationKey:String(r.key),status:state,authorizationUrl:state==='pending'?unseal<{url:string}>(String(r.sealedIntent),`${a.tenantId}:${r.id}:calendly-oauth`).url:null,expiresAt:new Date(Number(r.expiresAt)).toISOString(),connectionId:r.connectionId?String(r.connectionId):null};
}
export function startOAuth(store:Store,a:PrivateAudience,input:unknown){
  const b=z.object({expectedTenantId:z.string(),idempotencyKey:uuid}).strict().parse(input);if(b.expectedTenantId!==a.tenantId)fail(409,'tenant_mismatch');
  const r=store.transaction(()=>{assertAudience(store,a);const old=store.list(a.tenantId,C.states).find(r=>r.key===b.idempotencyKey);if(old){if(hash(old.scope)!==hash(scope(a)))fail(409,'calendly_idempotency_conflict');return old;}
    const config=appConfiguration(),state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),row=store.create(a.tenantId,C.states,{key:b.idempotencyKey,scope:scope(a),context:a.context,issuerUserId:a.userId,sessionHash:a.sessionHash,memberHash:hash(member(store,a.tenantId,a.userId)),configHash:hash(config),stateHash:digest(state),expiresAt:Date.now()+600000,consumed:false,invalidated:false});
    const url=new URL('https://auth.calendly.com/oauth/authorize');url.search=new URLSearchParams({client_id:config.clientId,response_type:'code',redirect_uri:config.redirect,state,code_challenge:Buffer.from(digest(verifier),'hex').toString('base64url'),code_challenge_method:'S256',scope:requestedScopes.join(' ')}).toString();
    return store.update(a.tenantId,C.states,row.id,{sealedIntent:seal({url:url.href,verifier},`${a.tenantId}:${row.id}:calendly-oauth`)})!;});
  const view=oauthIntent(store,a,String(r.key));if(!view.authorizationUrl)fail(409,'calendly_reauthorization_required');return{authorizationUrl:view.authorizationUrl,expiresAt:view.expiresAt,operationKey:view.operationKey};
}
export async function finishOAuth(store:Store,req:FastifyRequest){
  const q=z.object({code:z.string().min(1).max(4000),state:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().parse(req.query);
  const raw=store.db.prepare("SELECT body FROM entities WHERE collection=? AND json_extract(body,'$.stateHash')=?").get(C.states,digest(q.state));if(!raw)fail(409,'calendly_reauthorization_required');const row=JSON.parse(String(raw.body)) as Entity;
  const check=()=>{const r=store.get(row.tenantId,C.states,row.id),live=resolveSessionContext(store,String(row.sessionHash));if(!req.cookies?.kloel_session||digest(req.cookies.kloel_session)!==row.sessionHash||!r||r.invalidated===true||Number(row.expiresAt)<=Date.now()||!live?.actor||live.actor.role!=='owner'||!sameRequestContext(row.context as PrivateAudience['context'],live.context)||row.memberHash!==hash(member(store,row.tenantId,String(row.issuerUserId)))||hash(appConfiguration())!==row.configHash)fail(409,'calendly_reauthorization_required');};
  store.transaction(()=>{check();if(store.get(row.tenantId,C.states,row.id)?.consumed===true)fail(409,'calendly_reauthorization_required');store.update(row.tenantId,C.states,row.id,{consumed:true});});
  const config=appConfiguration(),intent=unseal<{verifier:string}>(String(row.sealedIntent),`${row.tenantId}:${row.id}:calendly-oauth`);
  const rawToken=await calendlyJson('/oauth/token',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:q.code,redirect_uri:config.redirect,code_verifier:intent.verifier}).toString(),check},true),t=parseTokens(rawToken);check();
  const me=await calendlyJson('/users/me',{headers:{Authorization:`Bearer ${t.accessToken}`},check}) as any;
  if(remoteId(me?.resource?.uri,'users').id!==t.remoteUserId||remoteId(me?.resource?.current_organization,'organizations').id!==t.remoteOrganizationId||typeof me?.resource?.name!=='string'||me.resource.name.length>160)fail(502,'calendly_provider_response_invalid');
  const zone=z.string().min(1).max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}).parse(me.resource.timezone);
  return store.transaction(()=>{check();const c=store.create(row.tenantId,C.connections,{issuerUserId:row.issuerUserId,memberHash:row.memberHash,revision:1,authorizationGeneration:1,tokenVersion:1,status:requestedScopes.every(s=>t.scopes.includes(s))?'connected':'scope_unverified',invalidated:false,remoteUserId:t.remoteUserId,remoteOrganizationId:t.remoteOrganizationId,displayName:me.resource.name,timezone:zone,scopes:t.scopes,expiresAt:t.expiresAt});
    const saved=store.update(row.tenantId,C.connections,c.id,{sealedTokens:seal({accessToken:t.accessToken,refreshToken:t.refreshToken},tokenAAD(row.tenantId,c.id,1))})!;store.update(row.tenantId,C.states,row.id,{connectionId:c.id,sealedIntent:null});check();return{connection:connectionView(saved)};});
}
/** Internal authority callback is restrictive; the persisted connection/issuer remains the credential owner. */
export async function accessToken(store:Store,tenant:string,id:string,check:()=>void){
  check();const c=connection(store,tenant,id),identity=connectionIdentity(c);
  const current=()=>{check();const fresh=connection(store,tenant,id);if(connectionIdentity(fresh)!==identity)fail(409,'calendly_reauthorization_required');return fresh;};
  if(Number(c.expiresAt)>Date.now()+30000){const t=unseal<{accessToken:string}>(String(c.sealedTokens),tokenAAD(tenant,id,Number(c.tokenVersion)));current();return t.accessToken;}
  const claim=store.transaction(()=>{const fresh=current();if(fresh.tokenVersion!==c.tokenVersion)fail(409,'calendly_reauthorization_required');if(store.list(tenant,C.refresh).some(r=>r.connectionId===id&&r.tokenVersion===c.tokenVersion))fail(409,'calendly_reauthorization_required');return store.create(tenant,C.refresh,{connectionId:id,tokenVersion:c.tokenVersion,status:'reserved'});});
  try{
    const config=appConfiguration(),old=unseal<{refreshToken:string}>(String(c.sealedTokens),tokenAAD(tenant,id,Number(c.tokenVersion)));
    const t=parseTokens(await calendlyJson('/oauth/token',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:old.refreshToken}).toString(),check:current},true));
    if(t.remoteUserId!==c.remoteUserId||t.remoteOrganizationId!==c.remoteOrganizationId||hash(t.scopes)!==hash(c.scopes)||!requestedScopes.every(s=>t.scopes.includes(s)))fail(409,'calendly_reauthorization_required');
    store.transaction(()=>{const fresh=current();if(fresh.tokenVersion!==c.tokenVersion||store.get(tenant,C.refresh,claim.id)?.status!=='reserved')fail(409,'calendly_reauthorization_required');const version=nextRevision(c.tokenVersion);store.update(tenant,C.connections,id,{tokenVersion:version,expiresAt:t.expiresAt,sealedTokens:seal({accessToken:t.accessToken,refreshToken:t.refreshToken},tokenAAD(tenant,id,version))});store.update(tenant,C.refresh,claim.id,{status:'completed'});});
    current();return t.accessToken;
  }catch(e){const latest=store.get(tenant,C.connections,id);if(latest&&latest.tokenVersion===c.tokenVersion&&latest.status==='connected'&&connectionIdentity(latest)===identity){store.update(tenant,C.connections,id,{status:'reauthorization_required',sealedTokens:null});store.update(tenant,C.refresh,claim.id,{status:'unknown'});}throw e;}
}
export async function api(store:Store,tenant:string,id:string,path:string,check:()=>void,options:{body?:unknown;observed?:(status:number)=>void;beforeDispatch?:()=>void}={}){
  const token=await accessToken(store,tenant,id,check);check();return calendlyJson(path,{method:options.body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...options.body===undefined?{}:{'Content-Type':'application/json'}},body:options.body===undefined?undefined:JSON.stringify(options.body),check,observed:options.observed,beforeDispatch:options.beforeDispatch});
}
