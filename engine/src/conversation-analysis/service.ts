import type { Entity, Store } from '../store.js';
import { chatGeneration } from '../conversation-replies-shared.js';
import { conversationFence, channelFor, optedOut, transcript, inFlight } from '../conversation-closure-context.js';
export { conversationFence, transcript, inFlight } from '../conversation-closure-context.js';
import { admitAfterHttp, hasAfterHttpConfiguration } from '../after-http/service.js';
import { configurationSchema, defaultConfiguration, type Configuration } from './schema.js';
import { by, configs, configOps, closeOps, closures, delegated, fail, hash, issuer, owned, type Operator } from './authority.js';
export function configuration(store:Store,tenant:string,agentId:string) {
 const row=by(store,tenant,configs,'agentId',agentId); if(row&&(!Number.isSafeInteger(row.revision)||Number(row.revision)<1))fail('after_revision_invalid');
 return {row,agentId,revision:row?Number(row.revision):0,configuration:row?configurationSchema.parse(row.configuration):defaultConfiguration()};
}
export function projectConfiguration(store:Store,tenant:string,agentId:string) { const c=configuration(store,tenant,agentId);let state:'disabled'|'active'|'revoked'=c.configuration.enabled?'active':'disabled',reasonCode:string|null=null;
 if(c.configuration.enabled)try{delegated(store,c.row!);}catch{state='revoked';reasonCode='analysis_authority_revoked';}
 return {agentId,revision:c.revision,configuration:c.configuration,authorization:{state,reasonCode}};
}
export const configReceipt=(r:Entity)=>({key:r.key,kind:'after.configure',tenantId:r.tenantId,agentId:r.agentId,expectedRevision:r.expectedRevision,revision:r.revision,status:'succeeded',createdAt:r.createdAt,automaticRetry:false});
export const closeReceipt=(r:Entity)=>({key:r.key,kind:'conversation.close',tenantId:r.tenantId,conversationId:r.conversationId,closureId:r.closureId??null,epoch:r.epoch??null,status:'closed',createdAt:r.createdAt,automaticRetry:false});
export function original(store:Store,a:Operator,key:string,kind:'config'|'close') { a.assertCurrent();const r=by(store,a.tenantId,kind==='config'?configOps:closeOps,'key',key);if(!r||!owned(r,a))return fail('operation_not_found',404);a.assertCurrent();return kind==='config'?configReceipt(r):closeReceipt(r); }
export function configure(store:Store,a:Operator,agentId:string,b:{expectedTenantId:string;expectedRevision:number;idempotencyKey:string;configuration:Configuration}) {
 if(a.tenantId!==b.expectedTenantId)fail('context_mismatch');const fingerprint=hash({kind:'after.configure',agentId,...b});
 return store.transaction(()=>{a.assertCurrent();const old=by(store,a.tenantId,configOps,'key',b.idempotencyKey);if(old){if(!owned(old,a)||old.fingerprint!==fingerprint)return fail('idempotency_conflict');return {operation:configReceipt(old),replayed:true};}
 const current=configuration(store,a.tenantId,agentId),agent=store.get(a.tenantId,'agents',agentId);if(!agent)return fail('not_found',404);if(current.revision!==b.expectedRevision)return fail('after_revision_conflict');if(current.revision===Number.MAX_SAFE_INTEGER)return fail('after_revision_exhausted');
 const data={agentId,revision:current.revision+1,configuration:b.configuration,issuer:issuer(store,a.tenantId,a.userId),agentHash:hash(agent),delegationGeneration:agent.delegationGeneration??0,authorizationRevoked:false,invalidated:false,invalidatedReason:null};
 if(current.row)store.update(a.tenantId,configs,current.row.id,data);else store.create(a.tenantId,configs,data);
 const row=store.create(a.tenantId,configOps,{key:b.idempotencyKey,agentId,expectedRevision:b.expectedRevision,revision:data.revision,fingerprint,authority:a.scope});store.create(a.tenantId,'after-audit',{kind:'configuration',operationId:row.id,agentId,revision:data.revision});a.assertCurrent();return {operation:configReceipt(row),replayed:false};});
}
export function genericStatusRequiresControl(store:Store,c:Entity) { return c.closureEpoch!==undefined||hasAfterHttpConfiguration(store,c)||typeof c.agentId==='string'&&!!by(store,c.tenantId,configs,'agentId',c.agentId); }
/** Caller owns BEGIN: control, explicit close, and authenticated public end share this seam. */
export function closeWithin(store:Store,previous:Entity,patch:Record<string,unknown>,origin:Record<string,unknown>) {
 if(previous.status==='closed'){const current=store.update(previous.tenantId,'conversations',previous.id,patch)!;const closure=store.list(previous.tenantId,closures).find(r=>r.conversationId===previous.id&&r.epoch===previous.closureEpoch);return {conversation:current,closure};}
 const epoch=Number(previous.closureEpoch??0),reply=chatGeneration(previous);if(!Number.isSafeInteger(epoch)||epoch<0||epoch===Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(reply)||reply===Number.MAX_SAFE_INTEGER)return fail('closure_revision_exhausted');
 const conversation=store.update(previous.tenantId,'conversations',previous.id,{...patch,status:'closed',closureEpoch:epoch+1,replyRevision:reply+1})!;
 let reason:string|null=null,config:ReturnType<typeof configuration>|undefined,channel:Entity|undefined;
 try { if(!['webchat','whatsapp'].includes(String(conversation.channel)))fail('unsupported_channel');if(optedOut(conversation))fail('automation_blocked');if(typeof conversation.agentId!=='string')fail('agent_unavailable');config=configuration(store,previous.tenantId,String(conversation.agentId));if(!config.configuration.enabled)fail('disabled');delegated(store,config.row!);channel=channelFor(store,conversation);if(inFlight(store,conversation))fail('in_flight'); }catch(e){reason=e&&typeof e==='object'&&'code' in e?String(e.code):'configuration_unavailable';}
 const input=transcript(store,conversation);if(!reason&&input.messages.length===0)reason='no_content';if(!reason&&(input.messages.length>500||Buffer.byteLength(JSON.stringify({messages:input.messages,allowedTags:config!.configuration.allowedTags}))>65536))reason='input_limit';
 const closure=store.create(previous.tenantId,closures,{conversationId:previous.id,agentId:conversation.agentId??null,channelId:conversation.channelId??null,surface:conversation.channel,epoch:epoch+1,closedAt:new Date().toISOString(),origin,conversationVersion:hash(conversation),conversationFence:conversationFence(conversation),configId:config?.row?.id??null,configRevision:config?.revision??null,issuer:config?.row?.issuer??null,agentHash:config?.row?.agentHash??null,delegationGeneration:config?.row?.delegationGeneration??null,channelHash:channel?hash(channel):null,sourceMessageCount:input.messages.length,messageRefs:input.messageRefs,allDigest:input.allDigest,inputDigest:input.inputDigest,promptVersion:1,status:reason?'skipped':'queued',reasonCode:reason,invalidated:false,invalidatedReason:null,dispatchCount:0,startedAt:null,completedAt:reason?new Date().toISOString():null,result:null});
 admitAfterHttp(store,conversation,closure);
 return {conversation,closure};
}
export function close(store:Store,a:Operator,id:string,b:{expectedTenantId:string;expectedVersion:string;idempotencyKey:string}) {
 if(b.expectedTenantId!==a.tenantId)fail('context_mismatch');const fingerprint=hash({id,...b});return store.transaction(()=>{a.assertCurrent();const old=by(store,a.tenantId,closeOps,'key',b.idempotencyKey);if(old){if(!owned(old,a)||old.fingerprint!==fingerprint)return fail('idempotency_conflict');return {operation:closeReceipt(old),replayed:true};}
 const previous=store.get(a.tenantId,'conversations',id);if(!previous)return fail('not_found',404);if(hash(previous)!==b.expectedVersion)return fail('conversation_changed');
 const {closure}=previous.status==='closed'?{closure:store.list(a.tenantId,closures).find(r=>r.conversationId===id&&r.epoch===previous.closureEpoch)}:closeWithin(store,previous,{}, {kind:'operator',userId:a.userId,membershipId:a.scope.membershipId});
 const row=store.create(a.tenantId,closeOps,{key:b.idempotencyKey,conversationId:id,closureId:closure?.id??null,epoch:closure?.epoch??null,fingerprint,authority:a.scope});store.create(a.tenantId,'after-audit',{kind:'closure',operationId:row.id,conversationId:id,closureId:closure?.id??null});a.assertCurrent();return {operation:closeReceipt(row),replayed:false};});
}
export function assertClosure(store:Store,row:Entity) {
 const current=store.get(row.tenantId,closures,row.id);if(!current||current.invalidated===true)return fail(String(current?.invalidatedReason??'analysis_invalidated'));
 const c=store.get(row.tenantId,'conversations',String(row.conversationId));if(!c||c.status!=='closed'||conversationFence(c)!==row.conversationFence||optedOut(c))return fail('conversation_changed');
 const config=configuration(store,row.tenantId,String(row.agentId));if(!config.row||config.row.id!==row.configId||config.revision!==row.configRevision||!config.configuration.enabled)return fail('configuration_changed');delegated(store,config.row);if(hash(config.row.issuer)!==hash(row.issuer))return fail('analysis_authority_revoked');if(hash(channelFor(store,c))!==row.channelHash)return fail('channel_changed');
 const input=transcript(store,c);if(input.allDigest!==row.allDigest||input.inputDigest!==row.inputDigest)return fail('messages_changed');if(inFlight(store,c))return fail('in_flight');return {conversation:c,configuration:config.configuration,input};
}
export function analysisView(store:Store,row:Entity) { let applicable=row.status==='succeeded'&&row.invalidated!==true,invalidatedReason=row.invalidatedReason??null;if(applicable)try{assertClosure(store,row);}catch(e){applicable=false;invalidatedReason=e&&typeof e==='object'&&'code'in e?String(e.code):'analysis_invalidated';}
 return {id:row.id,conversationId:row.conversationId,epoch:row.epoch,closedAt:row.closedAt,sourceMessageCount:row.sourceMessageCount,status:row.status,reasonCode:row.reasonCode??null,applicable,invalidatedReason,startedAt:row.startedAt??null,completedAt:row.completedAt??null,automaticRetry:false,result:row.status==='succeeded'?row.result:null}; }
export function analyses(store:Store,tenant:string,id:string,cursor?:string) { if(!store.get(tenant,'conversations',id))return fail('not_found',404);const rows=store.list(tenant,closures).filter(r=>r.conversationId===id).sort((a,b)=>Number(b.epoch)-Number(a.epoch));const index=cursor?rows.findIndex(r=>r.id===cursor):-1;if(cursor&&index<0)return fail('invalid_cursor',400);const page=rows.slice(index+1,index+21);return {items:page.map(r=>analysisView(store,r)),cursor:page.at(-1)?.id??cursor??null,hasMore:index+1+page.length<rows.length}; }
