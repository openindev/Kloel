import type { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { conversationFence, channelFor, optedOut, transcript, inFlight } from '../conversation-closure-context.js';
import { actionCollection, operationCollection } from '../integrations/access.js';
import { argumentSchema, boundedJson } from '../integrations/schema.js';
import { configurationSchema, configureSchema, payloadSchema } from './schema.js';
import { by, configs, configOps, jobs, delegated, eligibleAction, actionFingerprint, issuer, fail, hash, owned, codeOf, type Operator } from './authority.js';

export function configuration(store: Store, tenant: string, agentId: string) {
 const row = by(store,tenant,configs,'agentId',agentId); if (row && (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1)) fail('after_http_revision_invalid');
 return { row, revision: row ? Number(row.revision) : 0, configuration: row ? configurationSchema.parse(row.configuration) : { enabled:false, actionId:null } };
}
export const hasAfterHttpConfiguration = (store:Store,c:Entity) => typeof c.agentId === 'string' && !!by(store,c.tenantId,configs,'agentId',c.agentId);
const actionView = (a:Entity) => ({ id:a.id,name:a.name,template:a.template,targetOrigin:a.targetOrigin,method:'POST',revision:a.revision });
export function projectConfiguration(store:Store,a:Operator,agentId:string) {
 if (!store.get(a.tenantId,'agents',agentId)) return fail('not_found',404);
 const c = configuration(store,a.tenantId,agentId); let state = c.configuration.enabled ? 'active' : 'disabled', reasonCode:string|null = null;
 if (c.configuration.enabled) try { delegated(store,c.row!); } catch { state='revoked'; reasonCode='after_http_authority_revoked'; }
 const eligibleActions=store.list(a.tenantId,actionCollection).flatMap(action => { try { return [actionView(eligibleAction(store,a.tenantId,a.userId,agentId,action.id).action)]; } catch { return []; } });
 return { agentId,revision:c.revision,configuration:c.configuration,authorization:{state,reasonCode},action:eligibleActions.find(v=>v.id===c.configuration.actionId)??null,eligibleActions };
}
export const configReceipt = (r:Entity) => ({key:r.key,kind:'after_http.configure',tenantId:r.tenantId,agentId:r.agentId,expectedRevision:r.expectedRevision,revision:r.revision,status:'succeeded',createdAt:r.createdAt,automaticRetry:false});
export function original(store:Store,a:Operator,key:string) { a.assertCurrent(); const r=by(store,a.tenantId,configOps,'key',key); if(!r||!owned(r,a))return fail('operation_not_found',404);a.assertCurrent();return configReceipt(r); }
export function configure(store:Store,a:Operator,agentId:string,input:z.infer<typeof configureSchema>) {
 const b=configureSchema.parse(input); if(b.expectedTenantId!==a.tenantId)fail('context_mismatch'); const fingerprint=hash({kind:'after_http.configure',agentId,...b});
 return store.transaction(()=>{
  a.assertCurrent();const old=by(store,a.tenantId,configOps,'key',b.idempotencyKey);
  if(old){if(!owned(old,a)||old.fingerprint!==fingerprint)return fail('idempotency_conflict');return {operation:configReceipt(old),replayed:true};}
  const current=configuration(store,a.tenantId,agentId),agent=store.get(a.tenantId,'agents',agentId);if(!agent)return fail('not_found',404);
  if(current.revision!==b.expectedRevision)fail('after_http_revision_conflict');if(current.revision===Number.MAX_SAFE_INTEGER)fail('after_http_revision_exhausted');
  const who=issuer(store,a.tenantId,a.userId);let action:Entity|undefined;
  if(b.configuration.enabled){if(agent.status!=='active')fail('after_http_agent_changed');action=eligibleAction(store,a.tenantId,a.userId,agentId,b.configuration.actionId!).action;if(action.revision!==b.expectedActionRevision)fail('after_http_action_changed');}
  const data={agentId,revision:current.revision+1,configuration:b.configuration,issuer:who.identity,agentHash:hash(agent),delegationGeneration:agent.delegationGeneration??0,actionRevision:action?.revision??null,actionFingerprint:action?actionFingerprint(action):null,authorizationRevoked:false,invalidated:false,invalidatedReason:null};
  if(current.row)store.update(a.tenantId,configs,current.row.id,data);else store.create(a.tenantId,configs,data);
  const row=store.create(a.tenantId,configOps,{key:b.idempotencyKey,agentId,expectedRevision:b.expectedRevision,revision:data.revision,fingerprint,authority:a.scope});a.assertCurrent();return {operation:configReceipt(row),replayed:false};
 });
}
export function payload(row:Entity) {
 const p=payloadSchema.parse({schemaVersion:1,event:'conversation.closed',eventId:row.id,conversationRef:row.conversationId,agentRef:row.agentId,channel:row.channel,closureEpoch:row.epoch,closedAt:row.closedAt,messageCount:row.messageCount});boundedJson(p,8192);return p;
}
/** Caller owns the closure transaction; analysis state is deliberately irrelevant. */
export function admitAfterHttp(store:Store,c:Entity,closure:Entity) {
 if(typeof c.agentId!=='string')return;
 const config=configuration(store,c.tenantId,c.agentId);if(!config.row||!config.configuration.enabled)return;
 const existing=store.list(c.tenantId,jobs).find(j=>j.conversationId===c.id&&j.epoch===closure.epoch);if(existing)return existing;
 let reason:string|null=null,channel:Entity|undefined;const input=transcript(store,c);
 try{if(!['webchat','whatsapp'].includes(String(c.channel)))fail('unsupported_channel');if(optedOut(c))fail('automation_blocked');delegated(store,config.row);channel=channelFor(store,c);if(inFlight(store,c))fail('in_flight');if(!input.messages.length)fail('no_content');}catch(e){reason=codeOf(e);}
 const row=store.create(c.tenantId,jobs,{conversationId:c.id,agentId:c.agentId,channelId:c.channelId??null,channel:c.channel,closureId:closure.id,epoch:closure.epoch,closedAt:closure.closedAt,configId:config.row.id,configRevision:config.revision,actionId:config.configuration.actionId,actionRevision:config.row.actionRevision,actionFingerprint:config.row.actionFingerprint,issuer:config.row.issuer,agentHash:config.row.agentHash,delegationGeneration:config.row.delegationGeneration,channelHash:channel?hash(channel):null,conversationFence:conversationFence(c),messageRefs:input.messageRefs,allDigest:input.allDigest,inputDigest:input.inputDigest,messageCount:input.messages.length,status:reason?'skipped':'queued',reasonCode:reason,invalidated:false,invalidatedReason:null,dispatchCount:0,integrationOperationId:null,startedAt:null,attemptedAt:null,completedAt:reason?new Date().toISOString():null,httpStatus:null});
 if(!reason)try{const action=store.get(c.tenantId,actionCollection,String(row.actionId));if(!action||!argumentSchema(action.argumentsSchema).validate(payload(row)))fail('after_http_payload_incompatible');}catch(e){return store.update(c.tenantId,jobs,row.id,{status:'skipped',reasonCode:codeOf(e),completedAt:new Date().toISOString()});}
 return row;
}
export function assertJob(store:Store,row:Entity) {
 const current=store.get(row.tenantId,jobs,row.id);if(!current||current.invalidated===true)return fail(String(current?.invalidatedReason??'after_http_job_invalidated'));
 const c=store.get(row.tenantId,'conversations',String(row.conversationId));if(!c||c.status!=='closed'||c.closureEpoch!==row.epoch||conversationFence(c)!==row.conversationFence||optedOut(c))return fail('conversation_changed');
 const config=configuration(store,row.tenantId,String(row.agentId));if(!config.row||config.row.id!==row.configId||config.revision!==row.configRevision||!config.configuration.enabled)return fail('configuration_changed');
 const delegatedContext=delegated(store,config.row);if(hash(config.row.issuer)!==hash(row.issuer)||config.row.actionRevision!==row.actionRevision||config.row.actionFingerprint!==row.actionFingerprint)return fail('after_http_authority_revoked');
 if(hash(channelFor(store,c))!==row.channelHash)return fail('channel_changed');const input=transcript(store,c);if(input.allDigest!==row.allDigest||input.inputDigest!==row.inputDigest)return fail('messages_changed');if(inFlight(store,c))fail('in_flight');
 const args=payload(row);if(!argumentSchema(delegatedContext.action.argumentsSchema).validate(args))return fail('after_http_payload_incompatible');return {...delegatedContext,args};
}
export function jobView(row:Entity) {return {id:row.id,conversationId:row.conversationId,agentId:row.agentId,closureId:row.closureId,epoch:row.epoch,configRevision:row.configRevision,actionId:row.actionId,actionRevision:row.actionRevision,status:row.status,reasonCode:row.reasonCode??null,closedAt:row.closedAt,messageCount:row.messageCount,startedAt:row.startedAt??null,attemptedAt:row.attemptedAt??null,completedAt:row.completedAt??null,httpStatus:row.httpStatus??null,integrationOperationId:row.integrationOperationId??null,dispatchCount:row.dispatchCount,automaticRetry:false,workflowCompletion:'not_verified'};}
function originalIntegration(store:Store,row:Entity) {
 const o=row.integrationOperationId?store.get(row.tenantId,operationCollection,String(row.integrationOperationId)):undefined;
 if(row.integrationOperationId&&(!o||o.ownerKind!=='after_http'||o.ownerJobId!==row.id||o.actionId!==row.actionId||o.revision!==row.actionRevision))return fail('after_http_receipt_invalid');return o;
}
function projectedJob(store:Store,row:Entity) {
 const o=originalIntegration(store,row);
 // Local reconciliation also covers a crash between factual receipt COMMIT and job projection.
 return jobView(o?.status==='endpoint_acknowledged'&&Number(o.httpStatus)>=200&&Number(o.httpStatus)<300?{...row,status:'endpoint_acknowledged',httpStatus:o.httpStatus,reasonCode:null,completedAt:row.completedAt??o.updatedAt}:row);
}
export function history(store:Store,tenant:string,id:string,cursor?:string) {
 if(!store.get(tenant,'conversations',id))return fail('not_found',404);const rows=store.list(tenant,jobs).filter(r=>r.conversationId===id).sort((a,b)=>Number(b.epoch)-Number(a.epoch));const i=cursor?rows.findIndex(r=>r.id===cursor):-1;if(cursor&&i<0)return fail('invalid_cursor',400);const page=rows.slice(i+1,i+21);return {items:page.map(row=>projectedJob(store,row)),cursor:page.at(-1)?.id??cursor??null,hasMore:i+1+page.length<rows.length};
}
export function detail(store:Store,tenant:string,id:string) {
 const row=store.get(tenant,jobs,id);if(!row)return fail('operation_not_found',404);const o=originalIntegration(store,row);
 return {operation:projectedJob(store,row),integrationOperation:o?{id:o.id,actionId:o.actionId,revision:o.revision,status:o.status,httpStatus:o.httpStatus??null,errorCode:o.errorCode??null,attempts:o.attempts,createdAt:o.createdAt,updatedAt:o.updatedAt,requiresReconciliation:['pending','uncertain'].includes(String(o.status)),automaticRetry:false}:null};
}
