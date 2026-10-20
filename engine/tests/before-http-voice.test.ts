import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeHttpFixture,beforeHttpVoiceFixture } from './fixtures/before-http.js';
import { sourceSecrets } from '../src/before-context/http-source.js';

test('private voice resolves external context before calls/create and keeps test voice synthetic',async t=>{
 const f=await beforeHttpVoiceFixture(t);await f.enable();await f.enableHttp();const r=await f.startHttp();assert.equal(r.statusCode,200,r.body);assert.equal(r.json().beforeContext.httpSource.resolution,'external');assert.equal(r.json().beforeContext.barrier,'ready');assert.equal(f.httpRequests.length,1);assert.equal(f.requests.filter(x=>x.url.endsWith('/calls')).length,1);const item=f.sockets[0].sent.find(e=>e.type==='conversation.item.create');assert.ok(item.item.content[0].text.includes('Externo sintético'));
});
test('signed incoming voice resolves delegated source before accept, without a visitor Actor',async t=>{
 const f=await beforeHttpVoiceFixture(t);await f.enable();await f.enableHttp();const result=await f.incoming();assert.equal(result.statusCode,200,result.body);assert.equal(f.httpRequests.length,1);assert.equal(f.requests.filter(x=>x.url.endsWith('/accept')).length,1);const op=f.store.list(f.actor.tenantId,'before-http-operations')[0];assert.equal((op.authority as any).kind,'incoming');const metadata=await f.request('GET','/api/v1/before-context/http-operations/'+op.id);assert.equal(metadata.statusCode,200,metadata.body);assert.equal(metadata.json().httpSource.resolution,'external');assert.ok(!metadata.body.includes('Externo sintético'));
});

import { untilBefore } from './fixtures/before-voice.js';

test('private test voice skips source decryption and DNS but still establishes controlled OpenAI call',async t=>{
 const f=await beforeHttpVoiceFixture(t);await f.enable();await f.enableHttp();const row=f.store.list(f.actor.tenantId,'before-http-sources')[0];f.store.update(f.actor.tenantId,'before-http-sources',row.id,{encryptedSecrets:'invalid'});const r=await f.startHttp('test');assert.equal(r.statusCode,200,r.body);assert.equal(r.json().beforeContext.httpSource.reasonCode,'test_no_io');assert.equal(f.dns.length,0);assert.equal(f.requests.filter(x=>x.url.endsWith('/calls')).length,1);assert.ok(f.sockets[0].sent.find(e=>e.type==='conversation.item.create').item.content[0].text.includes('Pessoa sintética'));
});
test('cancel while source body is pending aborts before calls/create and never creates a default voice greeting',async t=>{
 const f=await beforeHttpVoiceFixture(t);await f.enable();await f.enableHttp();let signal:AbortSignal|undefined;f.httpHooks.request=spec=>{signal=spec.signal;return new Promise(()=>{});};const key=randomUUID(),pending=f.startHttp('live',key);await untilBefore(()=>f.httpRequests.length===1);const cancel=await f.request('POST',`/api/v1/ai/realtime/operations/${key}/cancel`,{});assert.equal(cancel.statusCode,200,cancel.body);const r=await pending;assert.equal(r.json().requiresRecovery,true,r.body);assert.equal(signal?.aborted,true);assert.equal(f.requests.length,0);assert.equal(f.sockets.length,0);const get=await f.get(key);assert.equal(get.json().beforeContext.httpSource.resolution,'blocked');await f.startHttp('live',key);assert.equal(f.httpRequests.length,1);
});
test('source revocation in incoming body prevents accept despite observed 2xx',async t=>{
 const f=await beforeHttpVoiceFixture(t);await f.enable();await f.enableHttp();f.httpHooks.request=spec=>{spec.onResponse?.(200);f.store.update(f.actor.tenantId,'phone-numbers',f.number.id,{agentId:null});return {status:200,headers:{},body:Buffer.from('{"nome":"PRIVATE_RESULT"}')};};const r=await f.incoming();assert.equal(r.statusCode,403,r.body);assert.equal(r.json().error.code,'voice_route_revoked');assert.equal(f.requests.filter(x=>x.url.endsWith('/accept')).length,0);const op=f.store.list(f.actor.tenantId,'before-http-operations')[0];assert.equal(op.httpStatus,200);assert.equal(op.resolution,'blocked');assert.ok(!r.body.includes('PRIVATE_RESULT'));
});
test('unselected incoming audience resolves defaults without DNS and unrelated channels do not revoke selected number',async t=>{
 const f=await beforeHttpVoiceFixture(t);await f.enable();await f.enableHttp({...f.source,enabled:true,audiences:{...f.source.audiences,incomingNumberIds:[]}});let r=await f.incoming('call_unselected');assert.equal(r.statusCode,200,r.body);assert.equal(f.dns.length,0);assert.equal(r.json().beforeContext.httpSource.reasonCode,'audience_not_selected');
 assert.equal((await f.configure({...f.source,enabled:true},2,randomUUID(),{mode:'keep'})).statusCode,200);const other=f.store.create(f.actor.tenantId,'channels',{type:'phone',enabled:true,agentId:f.agent.id});f.store.update(f.actor.tenantId,'channels',other.id,{name:'other'});r=await f.incoming('call_selected');assert.equal(r.statusCode,200,r.body);assert.equal(f.httpRequests.length,1);
});
test('app shutdown drains pending HTTP voice work before Store ownership can close',async t=>{
 const f=await beforeHttpVoiceFixture(t);await f.enable();await f.enableHttp();let signal:AbortSignal|undefined;f.httpHooks.request=spec=>{signal=spec.signal;return new Promise(()=>{});};const pending=f.startHttp();await untilBefore(()=>f.httpRequests.length===1);await f.app.close();await pending;assert.equal(signal?.aborted,true);assert.equal(f.requests.length,0);assert.equal(f.store.list(f.actor.tenantId,'before-http-operations')[0].resolution,'blocked');
});
import { hash } from '../src/before-context/operations.js';
test('legacy voice without HTTP source can activate against the original snapshot format',async t=>{
 const f=await beforeHttpVoiceFixture(t);await f.enable();const key=randomUUID(),started=await f.start(f.startBody(key));assert.equal(started.statusCode,200,started.body);const row=f.store.list(f.actor.tenantId,'before-voice-openings')[0],agent=f.store.get(f.actor.tenantId,'agents',f.agent.id),config=f.store.list(f.actor.tenantId,'before-context-configurations')[0],generations=f.store.db.prepare('SELECT agent_id,generation FROM before_voice_generations WHERE tenant_id=? AND agent_id IN (?,?) ORDER BY agent_id').all(f.actor.tenantId,f.agent.id,'*');f.store.update(f.actor.tenantId,'before-voice-openings',row.id,{snapshot:hash([agent,config,generations])});const {BeforeVoice}=await import('../src/before-context/voice.js');await new BeforeVoice(f.store).prepare(f.actor.tenantId,key,f.agent.id,row.authority as any,f.startBody(key).beforeContext,()=>{});const active=await f.activate(key,row.id);assert.equal(active.statusCode,200,active.body);assert.equal(active.json().beforeContext.mediaStage,'greeting');assert.equal(f.sockets[0].sent.filter(e=>e.type==='response.create').length,1);
});
