import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeVoiceFixture, untilBefore } from './fixtures/before-voice.js';
import { voiceOpenings } from '../src/before-context/voice.js';
const responses = (f: Awaited<ReturnType<typeof beforeVoiceFixture>>) => f.sockets.flatMap(s => s.sent).filter(e => e.type === 'response.create');
test('private HTTP waits for exact session/item ACKs; greeting precedes conversation and tools', async t => {
 const f = await beforeVoiceFixture(t, { autoAck: false }); await f.enable(); const body=f.startBody(), starting=f.start(body);
 await untilBefore(()=>f.sockets[0]?.sent.length>0); const s=f.sockets[0], initial=s.sent[0].session;
 assert.equal(initial.audio.input.turn_detection.create_response,false); assert.deepEqual(initial.tools,[]); assert.equal(responses(f).length,0);
 const provider=JSON.parse(String((f.requests[0].init.body as FormData).get('session'))); assert.equal(provider.audio.input.turn_detection.create_response,false); assert.deepEqual(provider.tools,[]);
 s.receive({type:'response.function_call_arguments.done',call_id:'early',name:'search_knowledge',arguments:'{}'});
 s.receive({type:'session.updated',session:{id:'session_a',...initial}}); await untilBefore(()=>s.sent.length===2); const item=s.sent[1].item;
 assert.equal(item.role,'user'); assert.equal(f.store.list(f.actor.tenantId,'messages').length,0);
 s.receive({type:'conversation.item.added',item}); await new Promise(r=>setImmediate(r)); assert.equal(responses(f).length,0);
 s.receive({type:'conversation.item.done',item:{...item,status:'completed'}}); const started=await starting; assert.equal(started.statusCode,200,started.body); const op=started.json(); assert.equal(op.beforeContext.barrier,'ready'); assert.equal(op.beforeContext.mediaStage,'blocked');
 const a=await f.activate(body.idempotencyKey,op.beforeContext.openingId); assert.equal(a.statusCode,200,a.body); assert.equal(a.json().beforeContext.mediaStage,'greeting'); await f.activate(body.idempotencyKey,op.beforeContext.openingId); assert.equal(responses(f).length,1);
 s.finishGreeting(); await untilBefore(()=>s.sent.filter(e=>e.type==='session.update').length===2); assert.equal((await f.get(body.idempotencyKey)).json().beforeContext.mediaStage,'greeting');
 s.receive({type:'session.updated',session:{id:'session_a',...s.sent.at(-1)!.session}}); await untilBefore(()=>f.store.list(f.actor.tenantId,voiceOpenings)[0].barrier==='active');
 const done=(await f.get(body.idempotencyKey)).json().beforeContext; assert.equal(done.mediaStage,'conversation'); assert.equal(done.greetingStatus,'generation_completed'); assert.equal(done.audioDelivery,'unverified'); assert.equal(f.store.list(f.actor.tenantId,'agent-tool-calls').length,0); assert.equal(f.store.list(f.actor.tenantId,'messages').length,0);
});
test('private replay freezes mode and metadata without SDP or second generation',async t=>{
 const f=await beforeVoiceFixture(t); await f.enable(); const b=f.startBody(undefined,'test'), r=await f.start(b); assert.equal(r.statusCode,200,r.body);
 assert.equal((await f.start(b)).json().requiresRecovery,true); assert.equal(f.requests.filter(r=>r.url.endsWith('/calls')).length,1);
 assert.equal((await f.start({...b,beforeContext:{...b.beforeContext,mode:'live'}})).statusCode,409);
 const raw=(await f.get(b.idempotencyKey)).body; for(const x of ['Pessoa sintética','synthetic-offer','synthetic-answer',f.sessionHash,'resolution'])assert.equal(raw.includes(x),false);
 await f.activate(b.idempotencyKey,r.json().beforeContext.openingId); await f.activate(b.idempotencyKey,r.json().beforeContext.openingId); assert.equal(responses(f).length,1);
});
test('incoming signed route accepts once and activates without fabricated human actor',async t=>{
 const f=await beforeVoiceFixture(t); await f.enable(); const first=await f.incoming(); assert.equal(first.statusCode,200,first.body); assert.equal(first.json().beforeContext.mediaStage,'greeting');
 const row=f.store.list(f.actor.tenantId,voiceOpenings)[0]; assert.equal((row.authority as any).kind,'incoming'); assert.equal((row.resolution as any).facts.direction,'incoming'); assert.equal((row.resolution as any).facts.phone,null);
 const again=await f.incoming(); assert.equal(again.statusCode,200,again.body); assert.equal(f.requests.filter(r=>r.url.endsWith('/accept')).length,1); assert.equal(responses(f).length,1);
});
test('changed before blocks activation while original metadata stays readable',async t=>{
 const f=await beforeVoiceFixture(t); await f.enable(); const b=f.startBody(),r=await f.start(b); assert.equal(r.statusCode,200,r.body); assert.equal((await f.save({...f.sample,enabled:false},1)).statusCode,200);
 const get=await f.get(b.idempotencyKey); assert.equal(get.statusCode,200,get.body); assert.equal(get.json().beforeContext.mediaStage,'blocked'); assert.equal((await f.activate(b.idempotencyKey,r.json().beforeContext.openingId)).statusCode,409); assert.equal(responses(f).length,0);
});
test('empty greeting requires activate and second ACK; raw token remains blocked',async t=>{
 const f=await beforeVoiceFixture(t); assert.equal((await f.save({...f.sample,defaultGreeting:''})).statusCode,200); const b=f.startBody(),r=await f.start(b); assert.equal(r.statusCode,200,r.body);
 assert.equal((await f.request('POST','/api/v1/ai/realtime/token',{agentId:f.agent.id,preview:true})).statusCode,409);
 const a=await f.activate(b.idempotencyKey,r.json().beforeContext.openingId); assert.equal(a.statusCode,200,a.body); await untilBefore(()=>f.store.list(f.actor.tenantId,voiceOpenings)[0].barrier==='active'); assert.equal(responses(f).length,0); assert.equal((await f.get(b.idempotencyKey)).json().beforeContext.greetingStatus,'not_needed');
});
for(const bad of ['session','item','generation'] as const)test(`wrong ${bad} cannot release the barrier or tools`,async t=>{
 const f=await beforeVoiceFixture(t,{autoAck:false}); await f.enable(); const b=f.startBody(),p=f.start(b); await untilBefore(()=>f.sockets[0]?.sent.length>0); const s=f.sockets[0];
 if(bad==='session')s.receive({type:'session.updated',session:{id:'wrong',...s.sent[0].session,tools:[{type:'function',name:'steal'}]}});
 else if(bad==='generation')s.receive({type:'response.created',response:{id:'unsolicited',metadata:{}}});
 else {s.receive({type:'session.updated',session:{id:'right',...s.sent[0].session}});await untilBefore(()=>s.sent.length===2);s.receive({type:'conversation.item.done',item:{...s.sent[1].item,status:'completed',id:'another'}});}
 const r=await p; assert.equal(r.json().requiresRecovery,true,r.body); assert.equal(responses(f).length,0); assert.equal(f.requests.filter(x=>x.url.endsWith('/hangup')).length,1);assert.equal((await f.get(b.idempotencyKey)).json().beforeContext.mediaStage,'blocked');
});
test('activation throws after real COMMIT: unknown without response, same reference never dispatches later',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody(),r=await f.start(b);assert.equal(r.statusCode,200,r.body);const original=f.store.transaction.bind(f.store);let armed=true;
 f.store.transaction=((fn:any)=>{const value=original(fn);if(armed&&f.store.list(f.actor.tenantId,voiceOpenings)[0]?.activationId){armed=false;throw new Error('synthetic-after-commit');}return value;}) as typeof f.store.transaction;
 const a=await f.activate(b.idempotencyKey,r.json().beforeContext.openingId);f.store.transaction=original;assert.equal(a.statusCode,500,a.body);assert.equal(armed,false);assert.equal(responses(f).length,0);assert.ok(f.store.list(f.actor.tenantId,voiceOpenings)[0].activationId);
 const get=await f.get(b.idempotencyKey);assert.equal(get.statusCode,200,get.body);assert.equal(get.json().beforeContext.mediaStage,'blocked');await f.activate(b.idempotencyKey,r.json().beforeContext.openingId);assert.equal(responses(f).length,0);
});
test('lost activation envelope and concurrent replay recover one greeting without retry',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody(),r=await f.start(b);const id=r.json().beforeContext.openingId;
 await Promise.all([f.activate(b.idempotencyKey,id),f.activate(b.idempotencyKey,id)]);assert.equal(responses(f).length,1);assert.equal((await f.get(b.idempotencyKey)).json().beforeContext.mediaStage,'greeting');
 f.sockets[0].finishGreeting();await untilBefore(()=>f.store.list(f.actor.tenantId,voiceOpenings)[0].barrier==='active');assert.equal((await f.get(b.idempotencyKey)).json().beforeContext.mediaStage,'conversation');assert.equal(responses(f).length,1);
});
test('membership and organization ABA before activate cannot re-adopt original authority',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody(),r=await f.start(b);assert.equal(r.statusCode,200,r.body);
 f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(f.actor.tenantId);f.store.db.prepare("UPDATE organizations SET status='active' WHERE id=?").run(f.actor.tenantId);
 assert.ok([403,404,409].includes((await f.activate(b.idempotencyKey,r.json().beforeContext.openingId)).statusCode));assert.equal(responses(f).length,0);assert.equal((await f.get(b.idempotencyKey)).statusCode,404);
});
test('managed mode rejects missing context, live facts, foreign cookie and raw token without I/O',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody();const no={...b};delete (no as any).beforeContext;assert.equal((await f.start(no)).statusCode,409);
 assert.equal((await f.request('POST','/api/v1/ai/realtime/session',{...b,beforeContext:{...b.beforeContext,testFacts:{phone:'+5511999990000'}}})).statusCode,400);
 assert.equal((await f.request('POST','/api/v1/ai/realtime/session',b,{cookie:f.headers.cookie} as any)).statusCode,400);assert.equal(f.requests.length,0);
});
test('legacy operation remains readable after enabling before and includes no new metadata',async t=>{
 const f=await beforeVoiceFixture(t);const body=f.startBody();delete (body as any).beforeContext;const r=await f.start(body);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().beforeContext,undefined);
 await f.enable();const get=await f.get(body.idempotencyKey);assert.equal(get.statusCode,200,get.body);assert.equal(get.json().beforeContext,undefined);
});
test('enable then remove configuration during legacy create cannot restore an absent snapshot',async t=>{
 const f=await beforeVoiceFixture(t);const body=f.startBody();delete (body as any).beforeContext;
 f.hooks.fetch=async url=>{if(url.endsWith('/calls')){await f.enable();const c=f.store.list(f.actor.tenantId,'before-context-configurations')[0];f.store.remove(f.actor.tenantId,'before-context-configurations',c.id);return new Response('v=0\r\na=answer',{status:201,headers:{location:'/v1/realtime/calls/legacy_aba'}});}return new Response(null,{status:200});};
 const r=await f.start(body);assert.equal(r.json().requiresRecovery,true,r.body);assert.equal(f.sockets.length,0);assert.equal(f.requests.filter(x=>x.url.endsWith('/hangup')).length,1);
});
test('close while awaiting ACK drains and keeps receipt, no fallback greeting',async t=>{
 const f=await beforeVoiceFixture(t,{autoAck:false});await f.enable();const b=f.startBody(),p=f.start(b);await untilBefore(()=>f.sockets[0]?.sent.length>0);
 // Cancel is the same durable stop used during app shutdown, without Fastify waiting for this HTTP request first.
 const c=await f.request('POST',`/api/v1/ai/realtime/operations/${b.idempotencyKey}/cancel`,{});assert.equal(c.statusCode,200,c.body);const r=await p;assert.equal(r.json().requiresRecovery,true,r.body);assert.equal(responses(f).length,0);assert.equal(f.requests.filter(x=>x.url.endsWith('/hangup')).length,1);
});
for(const surface of ['private','incoming'] as const)test(`positive ${surface} provider response survives post-COMMIT exception and closes known call once`,async t=>{
 const f=await beforeVoiceFixture(t);await f.enable(); const original=f.store.transaction.bind(f.store);let armed=true;
 f.store.transaction=((fn:any)=>{const result=original(fn);if(armed&&f.store.list(f.actor.tenantId,voiceOpenings)[0]?.providerAccepted===true){armed=false;throw new Error('synthetic-accepted-commit');}return result;}) as typeof f.store.transaction;
 const b=f.startBody();const r=surface==='private'?await f.start(b):await f.incoming();f.store.transaction=original;
 assert.equal(armed,false);const opening=f.store.list(f.actor.tenantId,voiceOpenings)[0];assert.equal(opening.providerAccepted,true);assert.ok(opening.callId);assert.equal(responses(f).length,0);
 assert.equal(f.requests.filter(x=>x.url.endsWith('/hangup')).length,1,r.body);
 if(surface==='private'){const get=await f.get(b.idempotencyKey);assert.equal(get.statusCode,200,get.body);assert.equal(get.json().callId,opening.callId);assert.equal(get.json().beforeContext.mediaStage,'blocked');await f.start(b);}else await f.incoming();
 assert.equal(f.requests.filter(x=>x.url.endsWith(surface==='private'?'/calls':'/accept')).length,1);
});
for(const stage of ['ack','greeting','normal_ack'] as const)test(`revocation at ${stage} does not release next stage or tools`,async t=>{
 const f=await beforeVoiceFixture(t,{autoAck:stage!=='ack'});await f.enable();const b=f.startBody();const starting=f.start(b);await untilBefore(()=>f.sockets[0]?.sent.length>0);const s=f.sockets[0];
 if(stage==='ack'){
  await f.save({...f.sample,defaultGreeting:'Different'},1);s.receive({type:'session.updated',session:{id:'s',...s.sent[0].session}});const r=await starting;assert.equal(r.json().requiresRecovery,true,r.body);assert.equal(responses(f).length,0);
 }else{
  const r=await starting;assert.equal(r.statusCode,200,r.body);await f.activate(b.idempotencyKey,r.json().beforeContext.openingId);
  if(stage==='normal_ack'){s.autoAck=false;s.finishGreeting();await untilBefore(()=>s.sent.filter(x=>x.type==='session.update').length===2);}
  f.store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=?").run(f.actor.userId);f.store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(f.actor.userId);
  s.receive(stage==='normal_ack'?{type:'session.updated',session:{id:'sess_synthetic_before',...s.sent.at(-1)!.session}}:{type:'response.function_call_arguments.done',call_id:'forged',name:'create_appointment',arguments:'{}'});
  await untilBefore(()=>f.requests.some(x=>x.url.endsWith('/hangup')));assert.equal(f.store.list(f.actor.tenantId,'agent-tool-calls').length,0);assert.equal(responses(f).length,1);
 }
 assert.equal(f.requests.filter(x=>x.url.endsWith('/hangup')).length,1);
});
test('deadline invalidates outstanding ACKs; advancing time cannot cause response',async t=>{
 const f=await beforeVoiceFixture(t,{autoAck:false});await f.enable();t.mock.timers.enable({apis:['setTimeout']});const b=f.startBody(),p=f.start(b);await untilBefore(()=>f.sockets[0]?.sent.length>0);const s=f.sockets[0];t.mock.timers.tick(10001);const r=await p;assert.equal(r.json().requiresRecovery,true,r.body);s.receive({type:'session.updated',session:{id:'late',...s.sent[0].session}});await new Promise(r=>setImmediate(r));assert.equal(responses(f).length,0);assert.equal((await f.get(b.idempotencyKey)).json().beforeContext.reasonCode,'voice_barrier_timeout');t.mock.timers.reset();
});
test('socket loss during generation preserves one intent and metadata cannot reconnect it',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody(),r=await f.start(b);await f.activate(b.idempotencyKey,r.json().beforeContext.openingId);f.sockets[0].close();await untilBefore(()=>f.requests.some(x=>x.url.endsWith('/hangup')));const get=await f.get(b.idempotencyKey);assert.equal(get.json().beforeContext.mediaStage,'blocked');assert.equal(get.json().beforeContext.greetingStatus,'unknown');await f.start(b);await f.activate(b.idempotencyKey,r.json().beforeContext.openingId);assert.equal(f.sockets.length,1);assert.equal(responses(f).length,1);
});
test('observed transcripts only: input before readiness cannot run capture or tools',async t=>{
 const f=await beforeVoiceFixture(t,{autoAck:false});await f.enable();const pending=f.incoming();await untilBefore(()=>f.sockets[0]?.sent.length>0);const s=f.sockets[0];
 s.receive({type:'conversation.item.input_audio_transcription.completed',item_id:'early_input',transcript:'Entrada antecipada sintética'});s.receive({type:'response.function_call_arguments.done',call_id:'bad_tool',name:'create_appointment',arguments:'{}'});await untilBefore(()=>f.store.list(f.actor.tenantId,'messages').length===1);
 assert.equal(f.store.list(f.actor.tenantId,'agent-tool-calls').length,0);assert.equal(f.store.list(f.actor.tenantId,'crm-capture-source-events').length,0);assert.equal(responses(f).length,0);
 s.receive({type:'session.updated',session:{id:'incoming',...s.sent[0].session}});await untilBefore(()=>s.sent.length===2);s.receive({type:'conversation.item.done',item:{...s.sent[1].item,status:'completed'}});const r=await pending;assert.equal(r.statusCode,200,r.body);assert.equal(responses(f).length,1);assert.equal(f.store.list(f.actor.tenantId,'messages').length,1);
});
test('a second independent incoming route does not revoke the first active opening',async t=>{
 const f=await beforeVoiceFixture(t,{autoGreeting:true});await f.enable();const a=await f.incoming('incoming_first');assert.equal(a.statusCode,200,a.body);await untilBefore(()=>f.store.list(f.actor.tenantId,voiceOpenings)[0].barrier==='active');
 const b=await f.incoming('incoming_second');assert.equal(b.statusCode,200,b.body);await untilBefore(()=>f.store.list(f.actor.tenantId,voiceOpenings).every(r=>r.barrier==='active'));assert.equal(f.requests.filter(x=>x.url.endsWith('/hangup')).length,0);assert.equal(responses(f).length,2);
});
test('raw token legacy captures absent-before generation through enable-delete ABA',async t=>{
 const f=await beforeVoiceFixture(t);f.hooks.fetch=async()=>{await f.enable();const c=f.store.list(f.actor.tenantId,'before-context-configurations')[0];f.store.remove(f.actor.tenantId,'before-context-configurations',c.id);return Response.json({value:'ek_MUST_NOT_PUBLISH',expires_at:9999999999});};
 const r=await f.request('POST','/api/v1/ai/realtime/token',{agentId:f.agent.id,preview:true});assert.equal(r.statusCode,403,r.body);assert.equal(r.body.includes('ek_MUST_NOT_PUBLISH'),false);
});
test('real app close waits for hangup and leaves no live playback permission',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody(),r=await f.start(b);await f.activate(b.idempotencyKey,r.json().beforeContext.openingId);
 let release!:(r:Response)=>void;const held=new Promise<Response>(resolve=>{release=resolve;});f.hooks.fetch=async url=>{assert.ok(url.endsWith('/hangup'));return held;};
 let closed=false;const closing=f.app.close().then(()=>{closed=true;});await untilBefore(()=>f.requests.some(x=>x.url.endsWith('/hangup')));assert.equal(closed,false);assert.ok(f.store.list(f.actor.tenantId,voiceOpenings)[0].activationId);
 release(new Response(null,{status:200}));await closing;assert.equal(closed,true);assert.equal(f.sockets[0].readyState,3);assert.equal(responses(f).length,1);assert.equal(f.store.list(f.actor.tenantId,'voice-stop-operations')[0].status,'accepted');
});
test('new app instance returns original blocked metadata and never reconnects or repeats activation',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody(),r=await f.start(b);await f.activate(b.idempotencyKey,r.json().beforeContext.openingId);await f.app.close();const before=f.requests.length;
 const {default:Fastify}=await import('fastify'),{default:cookie}=await import('@fastify/cookie'),{registerAuth}=await import('../src/auth.js'),{registerProviders}=await import('../src/providers.js');const app=Fastify();await app.register(cookie);await registerAuth(app,f.store);await registerProviders(app,f.store,{socketFactory:()=>{throw new Error('must not reconnect');}});await app.ready();
 try{const get=await app.inject({url:`/api/v1/ai/realtime/operations/${b.idempotencyKey}`,headers:f.headers});assert.equal(get.statusCode,200,get.body);assert.equal(get.json().beforeContext.openingId,r.json().beforeContext.openingId);assert.equal(get.json().beforeContext.mediaStage,'blocked');const a=await app.inject({method:'POST',url:`/api/v1/ai/realtime/operations/${b.idempotencyKey}/activate`,headers:f.headers,payload:{expectedTenantId:f.actor.tenantId,openingId:r.json().beforeContext.openingId,confirm:true}});assert.equal(a.statusCode,200,a.body);assert.equal(a.json().beforeContext.mediaStage,'blocked');assert.equal(f.requests.length,before);}finally{await app.close();}
});
for(const action of ['cancel','heartbeat'] as const)test(`managed ${action} rejects missing original context before any journal mutation`,async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody(),r=await f.start(b);assert.equal(r.statusCode,200,r.body);
 const snapshot=f.store.db.prepare('SELECT id,body FROM entities ORDER BY id').all();const calls=f.requests.length;
 const response=await f.request('POST',`/api/v1/ai/realtime/operations/${b.idempotencyKey}/${action}`,{}, {cookie:f.headers.cookie} as any);assert.equal(response.statusCode,400,response.body);assert.deepEqual(f.store.db.prepare('SELECT id,body FROM entities ORDER BY id').all(),snapshot);assert.equal(f.requests.length,calls);
});
test('heartbeat cannot renew a changed before snapshot; original cancel remains available',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody();assert.equal((await f.start(b)).statusCode,200);await f.save({...f.sample,enabled:false},1);
 const old=f.store.list(f.actor.tenantId,'voice-start-operations')[0];const heartbeat=await f.request('POST',`/api/v1/ai/realtime/operations/${b.idempotencyKey}/heartbeat`,{});assert.equal(heartbeat.statusCode,409,heartbeat.body);assert.equal(f.store.get(f.actor.tenantId,'voice-start-operations',old.id)?.leaseExpiresAt,old.leaseExpiresAt);
 assert.equal((await f.request('POST',`/api/v1/ai/realtime/operations/${b.idempotencyKey}/cancel`,{})).statusCode,200);
});
test('a new controller refuses a persisted ready opening before constructing any replacement socket',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const b=f.startBody();assert.equal((await f.start(b)).statusCode,200);const row=f.store.list(f.actor.tenantId,voiceOpenings)[0];
 const {BeforeVoice}=await import('../src/before-context/voice.js'),{RealtimeSidebands}=await import('../src/providers/realtime.js');const service=new BeforeVoice(f.store);
 const handle=await service.prepare(f.actor.tenantId,b.idempotencyKey,f.agent.id,row.authority as any,b.beforeContext,()=>{});let sockets=0;const sidebands=new RealtimeSidebands(f.store,()=>{sockets++;throw new Error('must not replace socket');});
 await assert.rejects(sidebands.connect(String(row.callId),'synthetic', {tenantId:f.actor.tenantId,agent:f.agent,conversationId:String(row.conversationId),trustedOperator:true,actor:f.actor,operatorSessionHash:f.sessionHash,beforeVoice:{service,handle,initialSession:{},normalSession:{},assertActive:()=>{}}}));assert.equal(sockets,0);await sidebands.close();
});
test('transport reservation commits before socket construction and is never reused after a post-COMMIT fault',async t=>{
 const f=await beforeVoiceFixture(t);await f.enable();const original=f.store.transaction.bind(f.store);let armed=true;f.store.transaction=((fn:any)=>{const result=original(fn);if(armed&&f.store.list(f.actor.tenantId,voiceOpenings)[0]?.attachmentId){armed=false;throw new Error('synthetic-attach-commit');}return result;}) as typeof f.store.transaction;
 const b=f.startBody(),r=await f.start(b);f.store.transaction=original;assert.equal(armed,false);assert.equal(r.json().requiresRecovery,true,r.body);assert.equal(f.sockets.length,0);assert.equal(f.requests.filter(x=>x.url.endsWith('/hangup')).length,1);await f.start(b);assert.equal(f.sockets.length,0);assert.equal((await f.get(b.idempotencyKey)).json().beforeContext.mediaStage,'blocked');
});
