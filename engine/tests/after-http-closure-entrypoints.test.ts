import test from 'node:test';
import assert from 'node:assert/strict';
import { afterHttpFixture } from './after-http-fixture.js';
import { jobs } from '../src/after-http/authority.js';
const ok=(r:any)=>{assert.equal(r.statusCode,200,r.body);return r.json();};

test('authenticated public end with HTTP enabled closes once and dispatches independently of disabled analysis',async t=>{
 const f=await afterHttpFixture(t);ok(await f.configureHttp());const {conversation:c,token}=await f.seedConversation();
 assert.deepEqual(ok(await f.publicRequest(token,'end',{})),{ended:true});const job=f.jobFor(c.id);assert.equal(job.status,'queued');assert.equal(job.epoch,1);
 const before=JSON.stringify(f.store.get(f.actor.tenantId,'conversations',c.id));assert.deepEqual(ok(await f.publicRequest(token,'end',{})),{ended:true});assert.equal(JSON.stringify(f.store.get(f.actor.tenantId,'conversations',c.id)),before);
 await f.httpWorker.runOne(f.actor.tenantId,job.id);assert.equal(f.calls.length,1);assert.equal(f.analysisCalls.length,0);assert.equal(ok(await f.httpHistory(c.id)).items[0].status,'endpoint_acknowledged');
 const payload=JSON.parse(f.calls[0].spec.body!.toString());assert.equal(payload.conversationRef,c.id);assert.equal(payload.eventId,job.id);assert.equal(payload.closureEpoch,1);
 assert.deepEqual(ok(await f.publicRequest(token,'end',{})),{ended:true});await f.httpWorker.tick();assert.equal(f.store.list(f.actor.tenantId,jobs).length,1);assert.equal(f.calls.length,1);
});

test('HTTP-only configuration forces controlled close; PATCH control admits one job and repeated close cannot send twice',async t=>{
 const f=await afterHttpFixture(t);ok(await f.configureHttp());const {conversation:c}=await f.seedConversation();
 const bypass=await f.app.inject({method:'PATCH',url:`/api/v1/conversations/${c.id}`,cookies:f.cookies,headers:f.headers,payload:{status:'closed'}});
 assert.equal(bypass.statusCode,409,bypass.body);assert.equal(bypass.json().error.code,'conversation_control_required');assert.equal(f.store.list(f.actor.tenantId,jobs).length,0);
 const controlled=ok(await f.change(c,{status:'closed'}));assert.equal(controlled.conversation.closureEpoch,1);const job=f.jobFor(c.id);assert.equal(job.status,'queued');
 await f.httpWorker.runOne(f.actor.tenantId,job.id);assert.equal(f.calls.length,1);assert.equal(f.analysisCalls.length,0);assert.equal(ok(await f.httpHistory(c.id)).items[0].status,'endpoint_acknowledged');
 ok(await f.close(f.store.get(f.actor.tenantId,'conversations',c.id)!));await f.httpWorker.runOne(f.actor.tenantId,job.id);assert.equal(f.store.list(f.actor.tenantId,jobs).length,1);assert.equal(f.calls.length,1);
});
