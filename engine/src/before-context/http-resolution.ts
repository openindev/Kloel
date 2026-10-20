import { performance } from 'node:perf_hooks';
import type { Entity, Store } from '../store.js';
import type { IntegrationTransport } from '../integrations/transport.js';
import { boundedJson, jsonPointer } from '../integrations/schema.js';
import { hash, fail } from './operations.js';
import { resolveBefore, type Resolution } from './resolve.js';
import type { Configuration } from './schema.js';
import { assertSource, httpOperations, sourceRow, sourceSnapshot, sourceSecrets, renderHttpBody, type HttpSourceConfiguration } from './http-source.js';

export const HTTP_DEADLINE_MS=5000;
export type HttpScope={surface:'private'|'webchat'|'voice_private'|'voice_incoming';channelId?:string;numberId?:string;defaultRoute?:boolean};
const runtimes=new WeakMap<Store,BeforeHttpRuntime>();
export function beforeHttpRuntime(store:Store){let r=runtimes.get(store);if(!r){r=new BeforeHttpRuntime(store);runtimes.set(store,r);}return r;}
/** Internal fixture seam only; no route accepts a transport, clock or arbitrary authority. */
export function setBeforeHttpTransport(store:Store,transport:IntegrationTransport){beforeHttpRuntime(store).transport=transport;}
export function requireHttpRevision(store:Store,tenant:string,agent:string,expected?:number){const r=sourceRow(store,tenant,agent);if(r&&(r.configuration as HttpSourceConfiguration).enabled&&r.revision!==expected)fail(409,'before_http_revision_conflict');if(expected!==undefined&&(!r||r.revision!==expected))fail(409,'before_http_revision_conflict');}
export function assertHttpSnapshot(store:Store,tenant:string,agent:string,snapshot:string){if(sourceSnapshot(store,tenant,agent)!==snapshot)fail(409,'before_http_changed');}
export function httpOperation(store:Store,opening:Entity){return store.list(opening.tenantId,httpOperations).find(r=>r.openingId===opening.id);}
export function httpView(store:Store,opening:Entity){const r=httpOperation(store,opening);if(!r)return undefined;const orphan=r.resolution==='pending'&&!beforeHttpRuntime(store).active.has(r.id);return {operationId:r.id,sourceRevision:r.sourceRevision,state:orphan&&r.state!=='not_dispatched'?'unknown':r.state,resolution:orphan?'unknown':r.resolution,reasonCode:orphan?'before_http_interrupted':r.reasonCode??null,httpStatus:r.httpStatus??null,startedAt:r.startedAt,deadlineAt:r.deadlineAt,completedAt:r.completedAt??null,automaticRetry:false};}
export function openingStatus(store:Store,r:Entity){if(!r.httpSnapshot)return 'ready';const op=httpView(store,r);if(r.httpStatus==='ready')return 'ready';if(r.httpStatus==='blocked')return 'blocked';return op?.resolution==='unknown'?'unknown':'pending';}
function selected(c:HttpSourceConfiguration,s:HttpScope){return s.surface==='private'?c.audiences.private:s.surface==='voice_private'?c.audiences.voicePrivate:s.surface==='webchat'?c.audiences.webchatChannelIds.includes(s.channelId??''):s.defaultRoute?c.audiences.incomingDefaultRoute:c.audiences.incomingNumberIds.includes(s.numberId??'');}
function skip(c:HttpSourceConfiguration,config:Configuration,local:Resolution,s:HttpScope){
 if(local.mode==='test')return 'test_no_io';if(!selected(c,s))return 'audience_not_selected';
 if(c.conditions.length){const r=resolveBefore({...config,defaultGreeting:'',greetingRules:[{conditions:c.conditions as Configuration['greetingRules'][number]['conditions'],greeting:'match'}]},{mode:'live',agentName:local.facts.agentName,companyName:local.facts.companyName,surface:local.facts.surface,startedAt:local.facts.startedAt});if(r.ruleIndex===null)return 'condition_not_matched';}
 if(c.schedule){const w=c.schedule,t=local.facts.localTime;const inTime=w.overnight?t>=w.start||t<w.end:t>=w.start&&t<w.end;const day=w.overnight&&t<w.end?(local.facts.weekday+6)%7:local.facts.weekday;if(!inTime||!w.weekdays.includes(day))return 'outside_hours';}return null;
}
export function reserveHttp(store:Store,opening:Entity,config:Configuration,local:Resolution,scope:HttpScope){
 const r=sourceRow(store,opening.tenantId,String(opening.agentId));if(!r||!(r.configuration as HttpSourceConfiguration).enabled)return undefined;
 const c=r.configuration as HttpSourceConfiguration,reason=skip(c,config,local,scope);if(local.mode!=='test'&&selected(c,scope))assertSource(store,r);
 return store.create(opening.tenantId,httpOperations,{openingId:opening.id,openingCollection:opening.surface==='private'||opening.surface==='webchat'?'before-context-openings':'before-voice-openings',sourceId:r.id,sourceRevision:r.revision,sourceSnapshot:hash(r),source:r,scope,agentId:opening.agentId,authority:opening.authority,state:'not_dispatched',resolution:'pending',skipReason:reason,reasonCode:null,httpStatus:null,startedAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+HTTP_DEADLINE_MS).toISOString(),completedAt:null});
}
export type HttpProposal={external?:Record<string,string|number|boolean>;reason:string|null};
export class BeforeHttpRuntime {
 transport:IntegrationTransport={};active=new Map<string,{controller:AbortController;promise:Promise<HttpProposal>;openingId:string;done:Promise<void>;settle:()=>void;deadline:number}>();private closed=false;
 constructor(private store:Store){}
 cancelOpening(openingId:string){for(const [id,active] of this.active){if(active.openingId===openingId)active.controller.abort('cancelled');}}
 async close(){this.closed=true;for(const a of this.active.values())a.controller.abort('cancelled');await Promise.allSettled([...this.active.values()].map(a=>a.done));}
 run(op:Entity,config:Configuration,local:Resolution,assertCurrent:()=>void):Promise<HttpProposal>{
  if(this.closed)return Promise.reject(new Error('before_http_cancelled'));if(this.active.has(op.id))return Promise.reject(new Error('before_http_interrupted'));
  const controller=new AbortController(),deadline=performance.now()+Math.max(0,Math.min(HTTP_DEADLINE_MS,Date.parse(String(op.deadlineAt))-Date.now()));
  const promise=Promise.resolve().then(async()=>{
   const current=this.store.get(op.tenantId,httpOperations,op.id);if(!current||current.state!=='not_dispatched'||current.resolution!=='pending')fail(409,'before_http_interrupted');
   assertCurrent();if(op.skipReason)return {reason:String(op.skipReason)};
   const source=op.source as Entity;assertSource(this.store,source);
   this.store.transaction(()=>{assertCurrent();assertSource(this.store,source);const c=this.store.get(op.tenantId,httpOperations,op.id);if(!c||c.state!=='not_dispatched')fail(409,'before_http_interrupted');this.store.update(op.tenantId,httpOperations,op.id,{state:'reserved'});});
   // Lazy load avoids the legacy domains -> analysis -> Before -> transport class cycle.
   const {deliver,sendPinned,DeliveryError}=await import('../integrations/transport.js');
   assertCurrent();assertSource(this.store,source);
   const secret=sourceSecrets(source),c=source.configuration as HttpSourceConfiguration;
   const body=c.method==='POST'?Buffer.from(boundedJson(renderHttpBody(secret.bodyTemplate??{},local.values,local.facts),16384)):undefined;
   const remaining=()=>Math.min(deadline-performance.now(),Date.parse(String(op.deadlineAt))-Date.now());
   const timer=setTimeout(()=>controller.abort('timeout'),Math.max(0,remaining()));
   const observe=(status:number)=>{if(!Number.isInteger(status)||status<100||status>599)return;this.store.transaction(()=>{const row=this.store.get(op.tenantId,httpOperations,op.id);if(row&&row.resolution==='pending')this.store.update(op.tenantId,httpOperations,op.id,{state:'response_observed',httpStatus:status});});};
   try{
    if(remaining()<=0){controller.abort('timeout');return {reason:'http_timeout'};}
    const sent=await deliver(secret.url,{method:c.method,headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{}),...secret.headers,'idempotency-key':op.id},body,signal:controller.signal,redirectLimit:0,onResponse:observe},Math.max(1,remaining()),{...this.transport,request:async(url,address,spec,maxBytes,timeoutMs)=>{
     if(controller.signal.aborted||remaining()<=0)throw new DeliveryError('integration_timeout',false);
     this.store.transaction(()=>{assertCurrent();assertSource(this.store,source);const row=this.store.get(op.tenantId,httpOperations,op.id);if(!row||row.state!=='reserved')fail(409,'before_http_interrupted');this.store.update(op.tenantId,httpOperations,op.id,{state:'dispatched'});});
     assertCurrent();assertSource(this.store,source);if(controller.signal.aborted||remaining()<=0)throw new DeliveryError('integration_timeout',false);
     const response=await (this.transport.request??sendPinned)(url,address,spec,maxBytes,timeoutMs);if(!controller.signal.aborted)observe(response.status);return response;
    }});
    if(remaining()<=0||controller.signal.aborted)return {reason:controller.signal.reason==='cancelled'?'before_http_cancelled':'http_timeout'};
    if(sent.response.status<200||sent.response.status>=300)return {reason:'http_non_success'};
    let parsed:unknown;try{parsed=JSON.parse(sent.response.body.toString('utf8'));boundedJson(parsed,65536);}catch{return {reason:'http_response_invalid'};}
    const external:Record<string,string|number|boolean>={};for(const m of c.mappings){const value=jsonPointer(parsed,m.jsonPointer),v=config.variables.find(x=>x.name===m.variable)!;if(!v||typeof value!==(v.type==='text'?'string':v.type)||typeof value==='string'&&value.length>1000||typeof value==='number'&&!Number.isFinite(value))return {reason:'http_response_invalid'};external[m.variable]=value as string|number|boolean;}
    try{resolveBefore(config,{mode:'live',agentName:local.facts.agentName,companyName:local.facts.companyName,surface:local.facts.surface,startedAt:local.facts.startedAt},external);}catch{return {reason:'http_response_invalid'};}
    return {external,reason:null};
   }catch(error){if(controller.signal.reason==='cancelled')throw new Error('before_http_cancelled');const r=this.store.get(op.tenantId,httpOperations,op.id);if(r&&r.state!=='response_observed')this.store.update(op.tenantId,httpOperations,op.id,{state:r.state==='dispatched'?'unknown':r.state});return {reason:controller.signal.reason==='timeout'||error instanceof DeliveryError&&error.code==='integration_timeout'?'http_timeout':'http_transport_error'};}
   finally{clearTimeout(timer);controller.abort('completed');}
  });
  let settle!:()=>void;const done=new Promise<void>(r=>{settle=r;});this.active.set(op.id,{controller,promise,openingId:String(op.openingId),done,settle,deadline});return promise;
 }
 release(id:string){this.active.get(id)?.settle();this.active.delete(id);}
 deadlineExpired(id:string){const a=this.active.get(id);return !a||performance.now()>=a.deadline;}
 assertRunning(){if(this.closed)throw new Error('before_http_cancelled');}
}
/** Called inside the caller's final transaction; metadata and greeting commit together. */
export function finishHttp(store:Store,op:Entity,config:Configuration,local:Resolution,proposal:HttpProposal,assertCurrent:()=>void){
 beforeHttpRuntime(store).assertRunning();assertCurrent();const source=op.source as Entity;if(local.mode!=='test'&&selected(source.configuration as HttpSourceConfiguration,op.scope as HttpScope))assertSource(store,source);
 const row=store.get(op.tenantId,httpOperations,op.id);if(!row||row.resolution!=='pending')fail(409,'before_http_interrupted');
 if(proposal.external&&(beforeHttpRuntime(store).deadlineExpired(op.id)||Date.now()>=Date.parse(String(op.deadlineAt))))proposal={reason:'http_timeout'};
 const external=proposal.external;const resolution=external?resolveBefore(config,{mode:'live',agentName:local.facts.agentName,companyName:local.facts.companyName,surface:local.facts.surface,startedAt:local.facts.startedAt},external):local;
 store.update(op.tenantId,httpOperations,op.id,{resolution:external?'external':'defaults',reasonCode:proposal.reason,completedAt:new Date().toISOString()});assertCurrent();return resolution;
}
export function failHttp(store:Store,opening:Entity,error:unknown){
 const op=httpOperation(store,opening);if(!op)return;store.transaction(()=>{const r=store.get(op.tenantId,httpOperations,op.id);if(!r||r.resolution!=='pending')return;const reason=error instanceof Error&&error.message==='before_http_cancelled'?'before_http_cancelled':'before_http_changed';store.update(op.tenantId,httpOperations,op.id,{resolution:'blocked',reasonCode:reason,completedAt:new Date().toISOString()});store.update(opening.tenantId,String(op.openingCollection),opening.id,{httpStatus:'blocked',invalidated:true});});
}
