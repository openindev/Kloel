import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { afterHttpFixture, httpResponse } from './after-http-fixture.js';
import { budgets, configs, configOps, jobs, initialize } from '../src/after-http/authority.js';
import { createAfterHttpWorker } from '../src/after-http/worker.js';
import { executeRegisteredIntegration, actionCollection, operationCollection, configureAction } from '../src/integrations/service.js';
import { DeliveryError } from '../src/integrations/transport.js';
const ok=(r:any)=>{assert.equal(r.statusCode,200,r.body);return r.json();};
const deferred=()=>{let resolve!:()=>void;return {promise:new Promise<void>(r=>resolve=r),resolve:()=>resolve()};};
test('baseline disabled and analysis-only never dispatch HTTP; independent enable sends one metadata POST',async t=>{
 const f=await afterHttpFixture(t);assert.deepEqual(ok(await f.request('GET',f.httpBase)).configuration,{enabled:false,actionId:null});
 const baseline=await f.seedConversation();ok(await f.close(baseline.conversation));await f.httpWorker.tick();assert.equal(f.store.list(f.actor.tenantId,jobs).length,0);
 ok(await f.configureAfter());const analysis=await f.seedConversation();ok(await f.close(analysis.conversation));await f.httpWorker.tick();assert.equal(f.calls.length,0);
 ok(await f.configureAfter(false,1));const configured=ok(await f.configureHttp());assert.equal(configured.operation.kind,'after_http.configure');
 const {conversation:c}=await f.seedConversation('This private transcript must not be sent');const closed=ok(await f.close(c));const row=f.jobFor(c.id);assert.equal(row.closureId,closed.operation.closureId);
 await Promise.all([f.httpWorker.runOne(f.actor.tenantId,row.id),f.httpWorker.runOne(f.actor.tenantId,row.id)]);assert.equal(f.calls.length,1);assert.equal(f.analysisCalls.length,0);
 const body=JSON.parse(f.calls[0].spec.body!.toString());assert.deepEqual(Object.keys(body),['schemaVersion','event','eventId','conversationRef','agentRef','channel','closureEpoch','closedAt','messageCount']);assert.equal(body.messageCount,2);assert.equal(body.eventId,row.id);assert.equal(f.calls[0].spec.redirectLimit,0);
 const history=ok(await f.httpHistory(c.id));assert.equal(history.items[0].status,'endpoint_acknowledged');assert.equal(history.items[0].workflowCompletion,'not_verified');
 const detail=ok(await f.request('GET',`/api/v1/after-http/operations/${row.id}`));assert.equal(detail.operation.integrationOperationId,detail.integrationOperation.id);assert.equal(detail.integrationOperation.status,'endpoint_acknowledged');
 for(const secret of ['private transcript','synthetic-http-credential','synthetic-secret','untrusted synthetic remote response','messageRefs','issuer','claimToken'])assert.equal(JSON.stringify({body,history,detail}).includes(secret),false);
 ok(await f.close(f.store.get(f.actor.tenantId,'conversations',c.id)!));await f.httpWorker.runOne(f.actor.tenantId,row.id);assert.equal(f.calls.length,1);assert.equal(ok(await f.request('GET',f.httpBase)).authorization.state,'active');
});
test('configuration consent, CAS, schema, assignment and exact original recovery are required',async t=>{
 const f=await afterHttpFixture(t),body={expectedTenantId:f.actor.tenantId,expectedRevision:0,idempotencyKey:randomUUID(),configuration:{enabled:true,actionId:f.action.id},expectedActionRevision:1,externalSendAcknowledged:false};
 assert.equal((await f.request('PUT',f.httpBase,body)).statusCode,400);assert.equal((await f.request('GET',f.httpBase,undefined,{})).statusCode,400);
 assert.equal((await f.request('PUT',f.httpBase,{...body,externalSendAcknowledged:true,expectedActionRevision:2})).statusCode,409);
 const key=randomUUID(),first=ok(await f.configureHttp(true,0,key));assert.equal(ok(await f.configureHttp(true,0,key)).replayed,true);assert.equal(f.store.list(f.actor.tenantId,configOps).length,1);
 assert.equal((await f.configureHttp()).statusCode,409);assert.equal(ok(await f.request('GET',`/api/v1/after-http/config-operations/${key}`)).revision,first.operation.revision);
 ok(await f.configureHttp(false,1));assert.equal(ok(await f.request('GET',`/api/v1/after-http/config-operations/${key}`)).revision,1);
 const bad=configureAction(f.store,f.actor,{...f.definition,argumentsSchema:{type:'object',properties:{},additionalProperties:false}});assert.equal((await f.configureHttp(true,2,randomUUID(),bad.id,Number(bad.revision))).statusCode,400);assert.equal(ok(await f.request('GET',f.httpBase)).eligibleActions.some((a:any)=>a.id===bad.id),false);
 const unassigned=configureAction(f.store,f.actor,{...f.definition,agentIds:[]});assert.equal((await f.configureHttp(true,2,randomUUID(),unassigned.id,Number(unassigned.revision))).statusCode,409);assert.equal(f.calls.length,0);
});
for(const mode of ['role','org','agent','channel','action','configuration','reopen','message'])test(`revocation ${mode} during DNS prevents all transport, including ABA`,async t=>{
 const f=await afterHttpFixture(t);ok(await f.configureHttp());const {conversation:c}=await f.seedConversation();ok(await f.close(c));const row=f.jobFor(c.id),entered=deferred(),release=deferred();f.hooks.resolve=async()=>{entered.resolve();await release.promise;return [{address:'93.184.216.34',family:4}];};
 const pending=f.httpWorker.runOne(f.actor.tenantId,row.id);await entered.promise;
 if(mode==='role')f.aba();if(mode==='org'){f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(f.actor.tenantId);f.store.db.prepare("UPDATE organizations SET status='active' WHERE id=?").run(f.actor.tenantId);}
 if(mode==='agent'){f.store.update(f.actor.tenantId,'agents',f.agent.id,{status:'paused'});f.store.update(f.actor.tenantId,'agents',f.agent.id,{status:'active'});}
 if(mode==='channel'){f.store.update(f.actor.tenantId,'channels',f.channel.id,{enabled:false});f.store.update(f.actor.tenantId,'channels',f.channel.id,{enabled:true});}
 if(mode==='action'){f.store.update(f.actor.tenantId,actionCollection,f.action.id,{enabled:false});f.store.update(f.actor.tenantId,actionCollection,f.action.id,{enabled:true});}
 if(mode==='configuration'){ok(await f.configureHttp(false,1));ok(await f.configureHttp(true,2));}
 if(mode==='reopen'){ok(await f.change(f.store.get(f.actor.tenantId,'conversations',c.id)!,{status:'open'}));}
 if(mode==='message')f.store.create(f.actor.tenantId,'messages',{conversationId:c.id,role:'system',kind:'internal_note',content:'private late note'});
 release.resolve();const result=await pending;assert.equal(f.calls.length,0);assert.equal(result?.status,'not_sent');assert.equal(result?.dispatchCount,0);await f.httpWorker.runOne(f.actor.tenantId,row.id);assert.equal(f.calls.length,0);
});
for(const status of [400,500,302,307,308])test(`HTTP ${status} is unknown and never follows a redirect or retries`,async t=>{
 const f=await afterHttpFixture(t);ok(await f.configureHttp());const {conversation:c}=await f.seedConversation();ok(await f.close(c));const row=f.jobFor(c.id);f.hooks.request=async(_u,_a,s)=>{s.onResponse?.(status);return {...httpResponse(status),headers:{location:'/second'}};};
 assert.equal((await f.httpWorker.runOne(f.actor.tenantId,row.id))?.status,'unknown');f.httpWorker.recover();await f.httpWorker.runOne(f.actor.tenantId,row.id);ok(await f.httpHistory(c.id));assert.equal(f.calls.length,1);
});
test('observed 2xx survives response loss, revocation and failed job projection',async t=>{
 const f=await afterHttpFixture(t);ok(await f.configureHttp());const {conversation:c}=await f.seedConversation();ok(await f.close(c));const row=f.jobFor(c.id),update=f.store.update.bind(f.store);let armed=true;
 f.store.update=((tenant,collection,id,changes)=>{if(armed&&collection===jobs&&changes.status==='endpoint_acknowledged'){armed=false;throw new Error('synthetic job persistence failure');}return update(tenant,collection,id,changes);}) as typeof f.store.update;
 f.hooks.request=async(_u,_a,s)=>{s.onResponse?.(202);f.store.update(f.actor.tenantId,actionCollection,f.action.id,{enabled:false});throw new DeliveryError('response_incomplete',true);};
 const result=await f.httpWorker.runOne(f.actor.tenantId,row.id);assert.equal(armed,false);assert.equal(result?.status,'endpoint_acknowledged');const op=f.store.list(f.actor.tenantId,operationCollection)[0];assert.equal(op.status,'endpoint_acknowledged');assert.equal(op.httpStatus,202);assert.equal(f.calls.length,1);
});
test('two stores preserve a live DNS claim; expired ownership becomes unknown without replay',async t=>{
 const f=await afterHttpFixture(t);ok(await f.configureHttp());const {conversation:c}=await f.seedConversation();ok(await f.close(c));const row=f.jobFor(c.id),dir=mkdtempSync(join(tmpdir(),'kloel-after-http-')),file=join(dir,'test.sqlite');
 f.store.db.exec(`VACUUM INTO '${file}'`);f.store.db.close();const owner=new Store(file);Object.defineProperty(f.store,'db',{value:owner.db});const second=new Store(file),other=createAfterHttpWorker(second,{transport:f.transport});t.after(async()=>{await other.stop();second.close();rmSync(dir,{recursive:true,force:true});});
 const entered=deferred(),release=deferred();f.hooks.resolve=async()=>{entered.resolve();await release.promise;return [{address:'93.184.216.34',family:4}];};const pending=f.httpWorker.runOne(f.actor.tenantId,row.id);await entered.promise;other.start();assert.equal(second.get(f.actor.tenantId,jobs,row.id)?.status,'running');release.resolve();assert.equal((await pending)?.status,'endpoint_acknowledged');assert.equal(f.calls.length,1);
 const next=await f.seedConversation();ok(await f.close(next.conversation));const orphan=f.jobFor(next.conversation.id);f.store.update(f.actor.tenantId,jobs,orphan.id,{status:'running',claimToken:randomUUID(),claimLeaseUntil:Date.now()-1,startedAt:new Date().toISOString()});other.recover();assert.equal(second.get(f.actor.tenantId,jobs,orphan.id)?.status,'unknown');await other.runOne(f.actor.tenantId,orphan.id);assert.equal(f.calls.length,1);
});
test('pre-dispatch failures are durable, generic retry route and executor cannot adopt After ownership',async t=>{
 const f=await afterHttpFixture(t);ok(await f.configureHttp());const {conversation:c}=await f.seedConversation();ok(await f.close(c));const row=f.jobFor(c.id);f.hooks.resolve=async()=>[{address:'127.0.0.1',family:4}];const result=await f.httpWorker.runOne(f.actor.tenantId,row.id);assert.equal(result?.status,'not_sent');assert.equal(f.calls.length,0);const op=f.store.list(f.actor.tenantId,operationCollection)[0];
 const retry=await f.app.inject({method:'POST',url:`/api/v1/integrations/operations/${op.id}/retry`,cookies:f.cookies,headers:{...f.headers,'idempotency-key':row.id},payload:{arguments:{}}});assert.equal(retry.statusCode,409);assert.equal(retry.json().error.code,'after_http_retry_forbidden');
 await assert.rejects(executeRegisteredIntegration(f.store,f.actor,f.action.id,JSON.parse(JSON.stringify({schemaVersion:1,event:'conversation.closed',eventId:row.id,conversationRef:c.id,agentRef:f.agent.id,channel:'webchat',closureEpoch:1,closedAt:row.closedAt,messageCount:2})),row.id,{retryOperationId:op.id,transport:f.transport}),(e:any)=>e.code==='after_http_retry_forbidden');assert.equal(f.calls.length,0);
});
test('quota charges the transport boundary and shutdown cancels a pending DNS without sending',async t=>{
 const f=await afterHttpFixture(t);process.env.AFTER_HTTP_MAX_DISPATCHES_PER_DAY='1';ok(await f.configureHttp());for(let i=0;i<2;i++){const {conversation:c}=await f.seedConversation();ok(await f.close(c));await f.httpWorker.runOne(f.actor.tenantId,f.jobFor(c.id).id);}assert.equal(f.calls.length,1);assert.equal(f.store.list(f.actor.tenantId,budgets)[0].count,1);
 const {conversation:c}=await f.seedConversation();ok(await f.close(c));const row=f.jobFor(c.id),entered=deferred(),release=deferred();f.hooks.resolve=async()=>{entered.resolve();await release.promise;return [{address:'93.184.216.34',family:4}];};const pending=f.httpWorker.runOne(f.actor.tenantId,row.id);await entered.promise;await f.httpWorker.stop();release.resolve();await pending;await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);assert.equal(f.store.get(f.actor.tenantId,jobs,row.id)?.dispatchCount,0);
});
test('local GET reconciles known receipt after projection loss and never replays unknown work',async t=>{
 const f=await afterHttpFixture(t);ok(await f.configureHttp());const {conversation:c}=await f.seedConversation();ok(await f.close(c));const row=f.jobFor(c.id);await f.httpWorker.runOne(f.actor.tenantId,row.id);
 f.store.update(f.actor.tenantId,jobs,row.id,{status:'running',httpStatus:null,reasonCode:null,completedAt:null});const before=f.calls.length;
 assert.equal(ok(await f.httpHistory(c.id)).items[0].status,'endpoint_acknowledged');const view=ok(await f.request('GET',`/api/v1/after-http/operations/${row.id}`));assert.equal(view.operation.httpStatus,202);assert.equal(view.integrationOperation.id,view.operation.integrationOperationId);assert.equal(f.calls.length,before);
 const next=await f.seedConversation();ok(await f.close(next.conversation));const unknown=f.jobFor(next.conversation.id);f.hooks.request=async()=>{throw new Error('synthetic lost response');};assert.equal((await f.httpWorker.runOne(f.actor.tenantId,unknown.id))?.status,'unknown');const calls=f.calls.length;f.httpWorker.recover();await f.httpWorker.runOne(f.actor.tenantId,unknown.id);ok(await f.httpHistory(next.conversation.id));assert.equal(f.calls.length,calls);
});
test('configuration commit loss recovers original scope, without dispatch or replay mutation',async t=>{
 const f=await afterHttpFixture(t),key=randomUUID(),transact=f.store.transaction.bind(f.store);let armed=true;
 f.store.transaction=((fn:any)=>{const result=transact(fn);if(armed&&f.store.list(f.actor.tenantId,configOps).some(o=>o.key===key)){armed=false;throw new Error('synthetic after commit');}return result;}) as typeof f.store.transaction;
 assert.equal((await f.configureHttp(true,0,key)).statusCode,500);assert.equal(ok(await f.request('GET',`/api/v1/after-http/config-operations/${key}`)).revision,1);assert.equal(ok(await f.configureHttp(true,0,key)).replayed,true);assert.equal(f.store.list(f.actor.tenantId,configOps).length,1);assert.equal(f.calls.length,0);
 f.aba();assert.notEqual((await f.request('GET',`/api/v1/after-http/config-operations/${key}`)).statusCode,200);const headers=await f.freshHeaders();assert.equal((await f.request('GET',`/api/v1/after-http/config-operations/${key}`,undefined,headers)).statusCode,404);
});
for(const policy of ['no_ai','human_handoff','manual_only','in_flight'])test(`admission ${policy} creates a skipped receipt without inheriting analysis authority`,async t=>{
 const f=await afterHttpFixture(t);ok(await f.configureHttp());const {conversation:c,session}=await f.seedConversation();if(policy==='no_ai'||policy==='human_handoff')f.store.update(f.actor.tenantId,'conversations',c.id,{tags:[policy]});if(policy==='manual_only')f.store.update(f.actor.tenantId,'conversations',c.id,{metaIdentityPolicy:'manual_only'});if(policy==='in_flight')f.store.update(f.actor.tenantId,'public-chat-sessions',session.id,{inFlight:'synthetic-pending'});
 ok(await f.close(f.store.get(f.actor.tenantId,'conversations',c.id)!));assert.equal(f.jobFor(c.id).status,'skipped');await f.httpWorker.runOne(f.actor.tenantId,f.jobFor(c.id).id);assert.equal(f.calls.length,0);assert.equal(f.analysisCalls.length,0);
});
test('WhatsApp metadata uses verified message links; private notes never contribute to count',async t=>{
 const f=await afterHttpFixture(t);const ch=f.store.create(f.actor.tenantId,'channels',{type:'whatsapp',provider:'meta',enabled:true,agentId:f.agent.id,configuration:{externalId:'synthetic-phone'}});ok(await f.configureHttp());const c=f.store.create(f.actor.tenantId,'conversations',{channel:'whatsapp',status:'open',agentId:f.agent.id,channelId:ch.id,phoneNumberId:'synthetic-phone',externalContact:'+5511999990000'});
 f.store.create(f.actor.tenantId,'messages',{conversationId:c.id,role:'user',source:'meta',deliveryStatus:'received',phoneNumberId:'synthetic-phone',content:'Synthetic received text'});f.store.create(f.actor.tenantId,'messages',{conversationId:c.id,role:'system',kind:'internal_note',content:'Private internal note'});ok(await f.close(c));await f.httpWorker.runOne(f.actor.tenantId,f.jobFor(c.id).id);assert.equal(f.calls.length,1);const p=JSON.parse(f.calls[0].spec.body!.toString());assert.equal(p.channel,'whatsapp');assert.equal(p.messageCount,1);assert.equal(JSON.stringify(p).includes('5511999990000'),false);assert.equal(JSON.stringify(p).includes('Synthetic received'),false);
});
test('migration is inert for existing rows and new revision does not license a closed epoch',async t=>{
 const f=await afterHttpFixture(t);const before=JSON.stringify(f.store.db.prepare('SELECT id,body FROM entities ORDER BY id').all());initialize(f.store);initialize(f.store);assert.equal(JSON.stringify(f.store.db.prepare('SELECT id,body FROM entities ORDER BY id').all()),before);
 const {conversation:c}=await f.seedConversation();ok(await f.close(c));ok(await f.configureHttp());assert.equal(f.store.list(f.actor.tenantId,jobs).length,0);ok(await f.close(f.store.get(f.actor.tenantId,'conversations',c.id)!));assert.equal(f.store.list(f.actor.tenantId,jobs).length,0);
 ok(await f.change(f.store.get(f.actor.tenantId,'conversations',c.id)!,{status:'open'}));ok(await f.close(f.store.get(f.actor.tenantId,'conversations',c.id)!));const row=f.jobFor(c.id);assert.equal(row.epoch,2);ok(await f.configureHttp(true,1));await f.httpWorker.runOne(f.actor.tenantId,row.id);assert.equal(f.calls.length,0);assert.equal(f.store.list(f.actor.tenantId,jobs).length,1);
});
