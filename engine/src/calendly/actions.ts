import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Store,Entity } from '../store.js';
import { seal,unseal,digest } from '../oauth/crypto.js';
import { allowedChatOrigin,chatGeneration,chatMode } from '../conversation-replies-shared.js';
import { C,fail,hash,uuid,revision,nextRevision,token } from './schema.js';
import { assertAudience,connection,connectionIdentity,member,scope,privateScope,type Audience,type PrivateAudience } from './access.js';
import { api,remoteId,remoteUri,connectionView } from './oauth.js';

export function publicLink(value:unknown,kind?:'cancel'|'reschedule'):string|null{
  if(typeof value!=='string'||value.length>2048)return null;try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='calendly.com'||u.port||u.username||u.password||u.search||u.hash)return null;
    if(kind&&!new RegExp(`^/${kind==='cancel'?'cancellations':'reschedulings'}/[0-9a-f-]{36}$`,'i').test(u.pathname))return null;
    if(!/^\/[a-zA-Z0-9/_-]+$/.test(u.pathname))return null;return u.href;}catch{return null;}
}
export function projectType(raw:unknown,c:Entity){
  const r=z.record(z.unknown()).safeParse(raw);if(!r.success)fail(502,'calendly_provider_response_invalid');const v=r.data,id=remoteId(v.uri,'event_types').id;
  if(typeof v.name!=='string'||!v.name.trim()||v.name.length>160)fail(502,'calendly_provider_response_invalid');
  let reason:string|null=null;const profile=v.profile as Record<string,unknown>|undefined;
  const duration=Number.isSafeInteger(v.duration)&&Number(v.duration)>0&&Number(v.duration)<=1440?Number(v.duration):null;
  if(!['active','booking_method','kind','pooling_type','is_paid','custom_questions','locations','profile','duration'].every(k=>Object.hasOwn(v,k))||typeof v.active!=='boolean'||typeof v.is_paid!=='boolean'||!Array.isArray(v.custom_questions)||!Array.isArray(v.locations)||!profile)reason='snapshot_incomplete';
  else if(v.active!==true)reason='inactive';
  else if(profile.type!=='User'||profile.owner!==remoteUri('users',String(c.remoteUserId)))reason='owner_mismatch';
  else if(v.booking_method!=='instant')reason='unsupported_booking_method';
  else if(v.kind!=='solo'||v.pooling_type!==null)reason='unsupported_kind';
  else if(!duration||v.duration_options!=null&&(!Array.isArray(v.duration_options)||v.duration_options.length!==1||v.duration_options[0]!==duration))reason='unsupported_duration';
  else if(v.is_paid!==false)reason='unsupported_payment';
  else if(v.custom_questions.some(q=>!q||typeof q!=='object'||!Object.hasOwn(q,'required')||!Object.hasOwn(q,'enabled')||(q as any).enabled!==false&&(q as any).required!==false))reason='unsupported_questions';
  else if(v.locations.length>1||v.locations.some(l=>!l||typeof l!=='object'||!['zoom','google_conference','microsoft_teams_conference','webex_conference','gotomeeting_conference'].includes(String((l as any).kind))))reason='unsupported_location';
  return{view:{id,name:v.name,durationMinutes:duration,timezone:String(c.timezone),supported:reason===null,unavailableReason:reason,schedulingUrl:publicLink(v.scheduling_url)},snapshot:hash(v)};
}
export async function readType(store:Store,tenant:string,connectionId:string,eventTypeId:string,check:()=>void){
  check();const c=connection(store,tenant,connectionId),identity=connectionIdentity(c),guard=()=>{check();if(connectionIdentity(connection(store,tenant,connectionId))!==identity)fail(409,'calendly_reauthorization_required');};
  const data=await api(store,tenant,connectionId,`/event_types/${uuid.parse(eventTypeId)}`,guard) as any,projected=projectType(data?.resource,c);guard();if(projected.view.id!==eventTypeId)fail(502,'calendly_provider_response_invalid');return projected;
}
export async function catalog(store:Store,a:PrivateAudience,id:string,cursorValue?:unknown){
  assertAudience(store,a);const c=connection(store,a.tenantId,id,a.userId),identity=connectionIdentity(c),check=()=>{assertAudience(store,a);if(connectionIdentity(connection(store,a.tenantId,id,a.userId))!==identity)fail(409,'calendly_reauthorization_required');};let pageToken:string|undefined;
  if(cursorValue!==undefined){const cursor=token.parse(cursorValue),r=store.list(a.tenantId,C.cursors).find(r=>r.tokenHash===digest(cursor));if(!r||r.connectionId!==id||r.identity!==identity||hash(r.scope)!==hash(scope(a))||Number(r.expiresAt)<=Date.now())fail(400,'invalid_input');pageToken=unseal<{token:string}>(String(r.sealedToken),`${a.tenantId}:${r.id}:calendly-cursor`).token;}
  const query=new URLSearchParams({user:remoteUri('users',String(c.remoteUserId)),count:'100',...pageToken?{page_token:pageToken}:{}});
  const data=await api(store,a.tenantId,id,`/event_types?${query}`,check) as any;
  if(!Array.isArray(data?.collection)||data.collection.length>100||!data.pagination||!Object.hasOwn(data.pagination,'next_page_token')||data.pagination.next_page_token!==null&&(typeof data.pagination.next_page_token!=='string'||data.pagination.next_page_token.length>2048||!data.pagination.next_page_token))fail(502,'calendly_provider_response_invalid');
  const items=data.collection.map((r:unknown)=>projectType(r,c).view);if(new Set(items.map((r:any)=>r.id)).size!==items.length)fail(502,'calendly_provider_response_invalid');
  let nextCursor:string|null=null;if(data.pagination.next_page_token){nextCursor=randomBytes(32).toString('base64url');store.transaction(()=>{check();const r=store.create(a.tenantId,C.cursors,{scope:scope(a),tokenHash:digest(nextCursor!),connectionId:id,identity,expiresAt:Date.now()+300000});store.update(a.tenantId,C.cursors,r.id,{sealedToken:seal({token:data.pagination.next_page_token},`${a.tenantId}:${r.id}:calendly-cursor`)});});}check();return{items,nextCursor};
}
function localTarget(store:Store,tenant:string,agentId:string,connectionId:string,audience:string,channelId:unknown,userId:string){
  const agent=store.get(tenant,'agents',agentId),c=connection(store,tenant,connectionId,userId),m=member(store,tenant,userId),channel=audience==='webchat'?store.get(tenant,'channels',String(channelId)):undefined;
  if(!agent||agent.status!=='active')fail(409,'calendly_action_unavailable');
  if(audience==='webchat'&&(!channel||channel.type!=='webchat'||channel.provider!=='openai'||channel.enabled!==true||channel.agentId!==agentId))fail(409,'calendly_action_unavailable');
  return{agent,c,channel,member:m,snapshot:hash([agent,connectionIdentity(c),channel??null,m])};
}
export function resolveAction(store:Store,a:Audience,actionId:string,conversationId?:string,expectedRevision?:number){
  assertAudience(store,a,true);const action=store.get(a.tenantId,C.actions,actionId);
  if(!action||action.enabled!==true||action.invalidated===true||Number(action.expiresAt)<=Date.now()||action.audience!==a.kind||a.kind==='webchat'&&action.channelId!==a.channelId||expectedRevision!==undefined&&action.revision!==expectedRevision)fail(409,'calendly_action_unavailable');
  if(a.kind==='private'&&action.issuerUserId!==a.userId)fail(403,'calendly_owner_required');
  const t=localTarget(store,a.tenantId,String(action.agentId),String(action.connectionId),String(action.audience),action.channelId,String(action.issuerUserId));if(t.snapshot!==action.snapshot)fail(409,'calendly_action_changed');
  const conv=conversationId?store.get(a.tenantId,'conversations',conversationId):undefined;
  if(conversationId&&(!conv||conv.agentId!==action.agentId||conv.channel!=='webchat'||chatMode(conv)!=='ai'||a.kind==='webchat'&&(a.conversationId!==conv.id||conv.channelId!==a.channelId||!allowedChatOrigin(t.channel!,a.origin))||a.kind==='private'&&!store.list(a.tenantId,'provider-operations').some(r=>r.operation==='openai.chat'&&r.chatConversationId===conv.id&&hash(r.calendlyAuthority)===hash(privateScope(a)))))fail(403,'calendly_conversation_unavailable');
  const generation=conv?chatGeneration(conv):null,actionHash=hash(action);
  const check=()=>{assertAudience(store,a,true);const r=store.get(a.tenantId,C.actions,action.id);if(!r||hash(r)!==actionHash||Number(r.expiresAt)<=Date.now())fail(409,'calendly_action_changed');const fresh=localTarget(store,a.tenantId,String(action.agentId),String(action.connectionId),String(action.audience),action.channelId,String(action.issuerUserId));if(fresh.snapshot!==action.snapshot)fail(409,'calendly_action_changed');if(conv){const now=store.get(a.tenantId,'conversations',conv.id);if(!now||now.agentId!==action.agentId||now.channel!=='webchat'||chatMode(now)!=='ai'||chatGeneration(now)!==generation||a.kind==='webchat'&&(now.channelId!==a.channelId||!allowedChatOrigin(fresh.channel!,a.origin)))fail(409,'calendly_conversation_unavailable');}};
  return{action,...t,conversation:conv,check};
}
export function actionView(store:Store,a:PrivateAudience,r:Entity){let available=false,unavailableReason:string|null=null;try{if(r.enabled!==true||r.invalidated===true||Number(r.expiresAt)<=Date.now())fail(409,'calendly_action_unavailable');assertAudience(store,a);const t=localTarget(store,a.tenantId,String(r.agentId),String(r.connectionId),String(r.audience),r.channelId,a.userId);if(t.snapshot!==r.snapshot)fail(409,'calendly_action_changed');available=true;}catch(e){unavailableReason=e instanceof Error&&'code'in e?String(e.code):'calendly_action_unavailable';}
  return{id:r.id,agentId:String(r.agentId),connectionId:String(r.connectionId),eventTypeId:String(r.eventTypeId),audience:r.audience,channelId:r.channelId??null,revision:Number(r.revision),enabled:r.enabled===true,allowCreate:r.allowCreate===true,expiresAt:new Date(Number(r.expiresAt)).toISOString(),maxBookingsPerDay:Number(r.maxBookingsPerDay),available,unavailableReason};}
export function configurationReceipt(r:Entity){return{key:String(r.key),kind:r.kind,tenantId:r.tenantId,resourceId:String(r.resourceId),agentId:r.agentId??null,revision:Number(r.revision),status:'succeeded' as const,automaticRetry:false as const,createdAt:r.createdAt};}
export function getConfigurationReceipt(store:Store,a:PrivateAudience,key:string){assertAudience(store,a);const r=store.list(a.tenantId,C.config).find(r=>r.key===uuid.parse(key));if(!r||hash(r.scope)!==hash(scope(a)))fail(404,'calendly_operation_not_found');return configurationReceipt(r);}
function prior(store:Store,a:PrivateAudience,key:string,fingerprint:string){assertAudience(store,a);const r=store.list(a.tenantId,C.config).find(r=>r.key===key);if(r&&(hash(r.scope)!==hash(scope(a))||r.fingerprint!==fingerprint))fail(409,'calendly_idempotency_conflict');return r;}
export async function writeAction(store:Store,a:PrivateAudience,agentId:string,id:string|null,input:unknown){
  const create=z.object({expectedTenantId:z.string(),idempotencyKey:uuid,connectionId:uuid,eventTypeId:uuid,audience:z.enum(['private','webchat']),channelId:uuid.nullable()}).strict();
  const update=z.object({expectedTenantId:z.string(),idempotencyKey:uuid,expectedRevision:revision,enabled:z.boolean(),allowCreate:z.boolean(),expiresInDays:z.number().int().min(1).max(30),maxBookingsPerDay:z.number().int().min(1).max(100)}).strict();
  const b=id?update.parse(input):create.parse(input);if(b.expectedTenantId!==a.tenantId)fail(409,'tenant_mismatch');const kind=id?'calendly.action.update':'calendly.action.create',fingerprint=hash([kind,agentId,id,b]),old=prior(store,a,b.idempotencyKey,fingerprint);if(old)return{operation:configurationReceipt(old),replayed:true};
  const source=id?store.get(a.tenantId,C.actions,id):undefined;if(id&&(!source||source.agentId!==agentId||source.issuerUserId!==a.userId))fail(404,'calendly_action_not_found');if('expectedRevision'in b&&source!.revision!==b.expectedRevision)fail(409,'calendly_revision_conflict');
  if('connectionId'in b&&(b.audience==='private'&&b.channelId!==null||b.audience==='webchat'&&b.channelId===null))fail(400,'invalid_input');
  const cfg='connectionId'in b?b:source!,needsRemote='connectionId'in b||b.enabled;
  const t=needsRemote?localTarget(store,a.tenantId,agentId,String(cfg.connectionId),String(cfg.audience),cfg.channelId,a.userId):undefined;
  const check=()=>{assertAudience(store,a);if(source&&hash(store.get(a.tenantId,C.actions,source.id))!==hash(source))fail(409,'calendly_revision_conflict');if(t&&localTarget(store,a.tenantId,agentId,String(cfg.connectionId),String(cfg.audience),cfg.channelId,a.userId).snapshot!==t.snapshot)fail(409,'calendly_action_changed');};
  const remote=t?await readType(store,a.tenantId,String(cfg.connectionId),String(cfg.eventTypeId),check):undefined;if(remote&&!remote.view.supported)fail(409,'calendly_type_unsupported');
  return store.transaction(()=>{check();const old=prior(store,a,b.idempotencyKey,fingerprint);if(old)return{operation:configurationReceipt(old),replayed:true};let r:Entity;
    if('connectionId'in b){const all=store.list(a.tenantId,C.actions).filter(r=>r.agentId===agentId);if(all.length>=10||all.some(r=>r.connectionId===b.connectionId&&r.eventTypeId===b.eventTypeId&&r.audience===b.audience&&r.channelId===b.channelId))fail(409,'calendly_action_unavailable');r=store.create(a.tenantId,C.actions,{agentId,connectionId:b.connectionId,eventTypeId:b.eventTypeId,audience:b.audience,channelId:b.channelId,revision:1,enabled:false,allowCreate:false,expiresAt:Date.now()+86400000,maxBookingsPerDay:10,issuerUserId:a.userId,snapshot:t!.snapshot,remoteSnapshot:remote!.snapshot,title:remote!.view.name,durationMinutes:remote!.view.durationMinutes,timezone:remote!.view.timezone,invalidated:false});}
    else r=store.update(a.tenantId,C.actions,id!,{revision:nextRevision(source!.revision),enabled:b.enabled,allowCreate:b.allowCreate,expiresAt:Date.now()+b.expiresInDays*86400000,maxBookingsPerDay:b.maxBookingsPerDay,...t?{snapshot:t.snapshot,remoteSnapshot:remote!.snapshot,title:remote!.view.name,durationMinutes:remote!.view.durationMinutes,timezone:remote!.view.timezone,invalidated:false}:{}})!;
    const receipt=store.create(a.tenantId,C.config,{key:b.idempotencyKey,scope:scope(a),fingerprint,kind,resourceId:r.id,agentId,revision:r.revision});assertAudience(store,a);return{operation:configurationReceipt(receipt),replayed:false};});
}
export function disconnect(store:Store,a:PrivateAudience,id:string,input:unknown){const b=z.object({expectedTenantId:z.string(),idempotencyKey:uuid,expectedRevision:revision,confirm:z.literal(true)}).strict().parse(input);if(b.expectedTenantId!==a.tenantId)fail(409,'tenant_mismatch');const fingerprint=hash(['disconnect',id,b]);return store.transaction(()=>{const old=prior(store,a,b.idempotencyKey,fingerprint);if(old)return{operation:configurationReceipt(old),replayed:true};const c=store.get(a.tenantId,C.connections,id);if(!c||c.issuerUserId!==a.userId)fail(404,'calendly_connection_not_found');if(c.revision!==b.expectedRevision)fail(409,'calendly_revision_conflict');const r=store.update(a.tenantId,C.connections,id,{revision:nextRevision(c.revision),authorizationGeneration:nextRevision(c.authorizationGeneration),status:'disconnected',sealedTokens:null,invalidated:true})!;const receipt=store.create(a.tenantId,C.config,{key:b.idempotencyKey,scope:scope(a),fingerprint,kind:'calendly.connection.disconnect',resourceId:id,agentId:null,revision:r.revision});assertAudience(store,a);return{operation:configurationReceipt(receipt),replayed:false};});}
export function actionOptions(store:Store,a:PrivateAudience,agentId:string){assertAudience(store,a);return{connections:store.list(a.tenantId,C.connections).filter(r=>r.issuerUserId===a.userId).map(connectionView),channels:store.list(a.tenantId,'channels').filter(r=>r.agentId===agentId&&r.enabled===true&&r.type==='webchat'&&r.provider==='openai').map(r=>({id:r.id,name:String(r.name??'Webchat')}))};}
