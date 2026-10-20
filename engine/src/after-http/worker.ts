import { randomUUID } from 'node:crypto';
import type { Entity, Store } from '../store.js';
import { executeRegisteredIntegration, operationCollection } from '../integrations/service.js';
import type { IntegrationTransport } from '../integrations/transport.js';
import { budgets, codeOf, fail, jobs } from './authority.js';
import { assertJob } from './service.js';
import { dailyLimit } from './schema.js';

/** One closure intent has one claim and at most one transport boundary. GET/restart never replay it. */
export function createAfterHttpWorker(store:Store,options:{transport?:IntegrationTransport;now?:()=>number}={}) {
 const now=options.now??Date.now,stamp=()=>new Date(now()).toISOString();let stopped=false,generation=0,ticking=false,timer:ReturnType<typeof setInterval>|undefined;
 const active=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();
 const linked=(row:Entity)=>{
  if(!row.integrationOperationId)return undefined;const o=store.get(row.tenantId,operationCollection,String(row.integrationOperationId));
  if(!o||o.ownerKind!=='after_http'||o.ownerJobId!==row.id||o.actionId!==row.actionId||o.revision!==row.actionRevision)return fail('after_http_receipt_invalid');return o;
 };
 const recover=()=>store.transaction(()=>{
  for(const found of store.db.prepare("SELECT body FROM entities WHERE collection=? AND json_extract(body,'$.status')='running'").all(jobs)){
   const row=JSON.parse(String(found.body)) as Entity;if(typeof row.claimLeaseUntil==='number'&&Number.isSafeInteger(row.claimLeaseUntil)&&row.claimLeaseUntil>now())continue;
   const op=linked(row),accepted=op?.status==='endpoint_acknowledged'&&Number(op.httpStatus)>=200&&Number(op.httpStatus)<300;
   store.update(row.tenantId,jobs,row.id,{status:accepted?'endpoint_acknowledged':'unknown',httpStatus:op?.httpStatus??row.httpStatus??null,reasonCode:accepted?null:'interrupted',completedAt:stamp()});
   if(op?.status==='pending')store.update(row.tenantId,operationCollection,op.id,{status:'uncertain',errorCode:'interrupted'});
  }
 });
 async function execute(tenant:string,id:string) {
  if(stopped)return;const epoch=generation,token=randomUUID(),controller=new AbortController();let claimed=false;
  const lifecycle=()=>{if(stopped||epoch!==generation||controller.signal.aborted)fail('after_http_interrupted');};
  const owned=()=>{lifecycle();const row=store.get(tenant,jobs,id);if(!row||row.status!=='running'||row.claimToken!==token||!Number.isSafeInteger(row.claimLeaseUntil)||Number(row.claimLeaseUntil)<=now())fail('after_http_claim_changed');return {row:row!,...assertJob(store,row!)};};
  try{
   const row=store.transaction(()=>{lifecycle();const row=store.get(tenant,jobs,id);if(!row||row.status!=='queued'||row.dispatchCount!==0)return undefined;assertJob(store,row);return store.update(tenant,jobs,id,{status:'running',claimToken:token,claimLeaseUntil:now()+60000,startedAt:stamp()})!;});
   if(!row)return store.get(tenant,jobs,id);claimed=true;controllers.add(controller);const ready=owned();
   await executeRegisteredIntegration(store,ready.actor,String(row.actionId),ready.args,row.id,{transport:options.transport,assertAccess:()=>{owned();},afterHttp:{
    jobId:id,signal:controller.signal,
    onReserved:operation=>{const current=owned().row;if(current.integrationOperationId!==null)fail('after_http_receipt_invalid');store.update(tenant,jobs,id,{integrationOperationId:operation.id});},
    beforeDispatch:operation=>{store.transaction(()=>{
     const current=owned().row;if(current.dispatchCount!==0||current.attemptedAt||current.integrationOperationId!==operation.id)fail('after_http_already_attempted');linked(current);
     const limit=dailyLimit();if(limit===null)return fail('after_http_quota_configuration_invalid');const day=stamp().slice(0,10),budget=store.list(tenant,budgets).find(b=>b.day===day),used=Number(budget?.count??0);
     if(!Number.isSafeInteger(used)||used<0)fail('after_http_quota_configuration_invalid');if(used>=limit)fail('quota_exceeded');
     if(budget)store.update(tenant,budgets,budget.id,{count:used+1});else store.create(tenant,budgets,{day,count:1});
     const attemptedAt=stamp();store.update(tenant,jobs,id,{dispatchCount:1,attemptedAt,quotaDay:day});store.update(tenant,operationCollection,operation.id,{attemptedAt,dispatchCount:1});
    });},
    onResponse:(operation,status)=>{const current=store.get(tenant,jobs,id);if(!current||current.claimToken!==token||current.integrationOperationId!==operation.id||current.dispatchCount!==1)return;
     if(current.status==='endpoint_acknowledged')return;const accepted=status>=200&&status<300;
     store.update(tenant,jobs,id,{status:accepted?'endpoint_acknowledged':'unknown',httpStatus:status,reasonCode:accepted?null:'upstream_non_success',completedAt:stamp()});
    },
   }});
  }catch(error){
   const current=store.get(tenant,jobs,id);if(!current||current.status==='endpoint_acknowledged'||current.status==='unknown'||current.status==='skipped'||current.status==='not_sent')return current;
   if(current.status==='running'&&current.claimToken!==token||current.status!=='running'&&current.status!=='queued')return current;
   const reason=codeOf(error);return store.transaction(()=>{
    const fresh=store.get(tenant,jobs,id);if(!fresh||fresh.status!==current.status||fresh.claimToken!==current.claimToken)return fresh;
    const op=linked(fresh),accepted=op?.status==='endpoint_acknowledged'&&Number(op.httpStatus)>=200&&Number(op.httpStatus)<300;
    const status=accepted?'endpoint_acknowledged':fresh.dispatchCount===1?'unknown':claimed?'not_sent':'skipped';
    if(op&&status==='unknown'&&op.status!=='uncertain')store.update(tenant,operationCollection,op.id,{status:'uncertain',errorCode:reason});
    return store.update(tenant,jobs,id,{status,reasonCode:accepted?null:reason,httpStatus:op?.httpStatus??fresh.httpStatus??null,completedAt:stamp()});
   });
  }finally{controllers.delete(controller);}
  const current=store.get(tenant,jobs,id);if(!current||current.status!=='running'||current.claimToken!==token)return current;
  // The executor can return a durable failure instead of throwing. Read only the original linked receipt.
  return store.transaction(()=>{const row=store.get(tenant,jobs,id)!;if(row.status!=='running'||row.claimToken!==token)return row;const op=linked(row),accepted=op?.status==='endpoint_acknowledged';return store.update(tenant,jobs,id,{status:accepted?'endpoint_acknowledged':row.dispatchCount===1?'unknown':'not_sent',reasonCode:accepted?null:op?.errorCode??'after_http_interrupted',httpStatus:op?.httpStatus??null,completedAt:stamp()});});
 }
 const runOne=(tenant:string,id:string)=>{const promise=Promise.resolve().then(()=>execute(tenant,id));active.add(promise);void promise.finally(()=>active.delete(promise)).catch(()=>{});return promise;};
 const tick=async()=>{if(ticking||stopped)return;ticking=true;try{recover();const r=store.db.prepare("SELECT body FROM entities WHERE collection=? AND json_extract(body,'$.status')='queued' ORDER BY rowid LIMIT 1").get(jobs);if(r){const row=JSON.parse(String(r.body)) as Entity;await runOne(row.tenantId,row.id);}}finally{ticking=false;}};
 return {runOne,recover,tick,start(){if(timer)return;stopped=false;recover();timer=setInterval(()=>{void tick().catch(()=>{});},1000);timer.unref();},async stop(){stopped=true;generation++;if(timer)clearInterval(timer);timer=undefined;for(const c of controllers)c.abort();await Promise.allSettled([...active]);}};
}
