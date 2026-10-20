import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingOperatorFixture } from './fixtures/booking-operator.js';

test('assistant booking configuration is available as an owner-scoped local capability', async t => {
  const f = await bookingOperatorFixture(t);
  const agent = f.store.create(f.actor.tenantId, 'agents', { name: 'Agendamento', status: 'active', tools: [] });
  const r = await f.request(`/api/v1/agents/${agent.id}/booking-actions`);
  assert.equal(r.statusCode, 200, r.body); assert.deepEqual(r.json(), { items: [] });
});

import { randomUUID,createHash } from 'node:crypto';
import { assistantBookingFixture } from './fixtures/assistant-booking.js';

test('private model offers a typed card; one explicit click creates a shared managed booking with local recovery',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create();f.toolRound(a);const chat=await f.askPrivate();assert.equal(chat.statusCode,200,chat.body);
  const choice=chat.json().bookingChoices[0];assert.ok(choice.slots.length);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
  assert.ok(!JSON.stringify(f.openAI).includes(choice.slots[0].quote));
  const key=randomUUID(),r=await f.book(choice,key);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.status,'confirmed');
  const posted=f.requests.filter(r=>r.method==='POST');assert.equal(posted.length,1);assert.equal(posted[0].url.searchParams.get('sendUpdates'),'none');assert.deepEqual(posted[0].body.attendees,[]);assert.deepEqual(posted[0].body.reminders,{useDefault:false,overrides:[]});
  const before=f.requests.length;assert.deepEqual((await f.operation(key)).json(),r.json().operation);assert.equal(f.requests.length,before);
  assert.equal((await f.book(choice,key)).json().replayed,true);assert.equal(f.requests.length,before);
  const b=f.store.get(f.actor.tenantId,'public-bookings',r.json().operation.bookingRef)!;assert.equal(b.status,'confirmed');assert.equal(f.store.get(f.actor.tenantId,'appointments',String(b.appointmentId))?.syncStatus,'synced');
});

test('webchat card uses its real visitor scope and receipt survives ended channel disable',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create('webchat');f.toolRound(a);const s=await f.session();
  const chat=await f.publicRequest(s.token,'messages',{message:'Agendar',idempotencyKey:randomUUID()});assert.equal(chat.statusCode,200,chat.body);const choice=chat.json().bookingChoices[0];assert.ok(choice);
  const key=randomUUID(),r=await f.publicRequest(s.token,'bookings',f.bookingBody(choice,key));assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.status,'confirmed');
  assert.equal((await f.publicRequest(s.token,'end',{})).statusCode,200);f.store.update(f.actor.tenantId,'channels',f.channel.id,{enabled:false});const before=f.requests.length;
  const get=await f.publicRequest(s.token,'booking-operation',undefined,{operationKey:key});assert.equal(get.statusCode,200,get.body);assert.deepEqual(get.json(),r.json().operation);assert.equal(f.requests.length,before);
  assert.notEqual((await f.publicRequest(s.token,'bookings',f.bookingBody(choice,randomUUID()))).statusCode,200);
});

test('configuration receipts replay before current dependencies and require the original session authority',async t=>{
  const f=await assistantBookingFixture(t),key=randomUUID(),body={expectedTenantId:f.actor.tenantId,idempotencyKey:key,eventTypeId:f.page.id,audience:'webchat',channelId:f.channel.id};
  const first=await f.request('POST',f.base,body);assert.equal(first.statusCode,200,first.body);const op=first.json().operation;
  assert.equal(op.enabled,false);assert.equal(op.allowCreate,false);f.store.remove(f.actor.tenantId,'booking-pages',f.page.id);
  const before=f.requests.length,replay=await f.request('POST',f.base,body);assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json().operation,op);
  assert.equal((await f.request('GET',`/api/v1/booking-action-operations/${key}`)).statusCode,200);assert.equal(f.requests.length,before);
  f.aba();const fresh=await f.freshHeaders();assert.equal((await f.request('GET',`/api/v1/booking-action-operations/${key}`,undefined,fresh)).statusCode,404);
  assert.equal((await f.request('POST',f.base,body,fresh)).statusCode,409);
});

test('webchat capability availability uses current owner configuration; stale configuration CAS has zero remote effects',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create('webchat');const before=f.requests.length;
  const list=await f.request('GET',f.base);assert.equal(list.json().items[0].available,true);
  const stale=await f.request('PUT',`${f.base}/${a.id}`,{expectedTenantId:f.actor.tenantId,idempotencyKey:randomUUID(),expectedRevision:1,enabled:false,allowCreate:false,expiresInDays:1,maxBookingsPerDay:10});assert.equal(stale.statusCode,409);assert.equal(f.requests.length,before);
});

for(const kind of ['private','webchat'] as const)test(`${kind} round-two revocation suppresses booking card publication and no create is performed`,async t=>{
  const f=await assistantBookingFixture(t),a=await f.create(kind);f.toolRound(a);const original=f.aiHooks.openAI!;
  f.aiHooks.openAI=body=>{if(body.input.some((i:any)=>i.type==='function_call_output'))f.store.update(f.actor.tenantId,'booking-pages',f.page.id,{description:'changed after availability'});return original(body);};
  const s=kind==='webchat'?await f.session():null;
  const result=kind==='private'?await f.askPrivate():await f.publicRequest(s!.token,'messages',{message:'Agendar',idempotencyKey:randomUUID()});
  assert.notEqual(result.statusCode,200,result.body);assert.ok(!result.body.includes('bookingChoices'));assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
  assert.equal(f.store.list(f.actor.tenantId,'messages').filter(m=>m.role==='assistant').length,0);
});

test('membership ABA after availability and before explicit confirmation cannot adopt the quote',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create();f.toolRound(a);const choice=(await f.askPrivate()).json().bookingChoices[0],before=f.requests.length;
  f.aba();const fresh=await f.freshHeaders();const result=await f.request('POST',`/api/v1/ai/conversations/${choice.conversationId}/bookings`,{expectedTenantId:f.actor.tenantId,...f.bookingBody(choice)},fresh);
  assert.notEqual(result.statusCode,200);assert.equal(f.requests.length,before);assert.equal(f.store.list(f.actor.tenantId,'booking-assistant-operations').length,0);
});

test('revocation before Google POST settles not_sent and never creates a remote event',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create();f.toolRound(a);const choice=(await f.askPrivate()).json().bookingChoices[0];let once=true;
  f.hooks.provider=r=>{if(once&&r.method==='GET'&&r.url.pathname.endsWith('/events')){once=false;f.store.update(f.actor.tenantId,'booking-assistant-actions',a.id,{enabled:false});}return undefined;};
  const key=randomUUID(),result=await f.book(choice,key);assert.notEqual(result.statusCode,200);const op=(await f.operation(key)).json();assert.equal(op.status,'not_sent');assert.equal(op.needsReconciliation,false);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
});

for(const cause of ['invalid_json','revoked_after_acceptance'] as const)test(`positive Google response ${cause} remains accepted with its hold and original GET; no replay`,async t=>{
  const f=await assistantBookingFixture(t),a=await f.create();f.toolRound(a);const chatKey=randomUUID(),choice=(await f.askPrivate(undefined,chatKey)).json().bookingChoices[0];
  f.hooks.provider=r=>{if(r.method!=='POST')return undefined;if(cause==='invalid_json')return new Response('{invalid',{status:201,headers:{'content-type':'application/json'}});f.store.update(f.actor.tenantId,'agents',f.agent.id,{status:'paused'});const event={...r.body,id:r.body.id,etag:'"accepted"'};f.events.set(event.id,event);return Response.json(event,{status:201});};
  const key=randomUUID(),result=await f.book(choice,key);assert.notEqual(result.statusCode,200);const before=f.requests.length,op=(await f.operation(key)).json();assert.equal(op.status,'accepted');assert.equal(op.effect,'http_accepted');assert.equal(op.needsReconciliation,true);
  const booking=f.store.get(f.actor.tenantId,'public-bookings',op.bookingRef)!;assert.equal(booking.status,'unknown');assert.ok(f.service.localBusy(f.target,f.store.get(f.actor.tenantId,'booking-grants',String(booking.grantId))!,String(booking.bufferStartAt),String(booking.bufferEndAt)));
  f.store.remove(f.actor.tenantId,'booking-assistant-actions',a.id);f.store.remove(f.actor.tenantId,'booking-pages',f.page.id);
  assert.deepEqual((await f.operation(key)).json(),op);assert.equal((await f.book(choice,key)).json().replayed,true);
  const metadata=await f.request('GET',`/api/v1/ai/booking-chat-operations/${chatKey}`);assert.equal(metadata.statusCode,200,metadata.body);assert.deepEqual(metadata.json().bookingChoices,[]);assert.deepEqual(metadata.json().bookingOperations,[op]);assert.equal(f.requests.length,before);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
});

test('unknown creation survives lease and action reauthorization; a different key still cannot create a duplicate',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create();f.toolRound(a);const choice=(await f.askPrivate()).json().bookingChoices[0];
  f.hooks.provider=r=>{if(r.method==='POST')throw Error('synthetic transport lost');return undefined;};const key=randomUUID();assert.notEqual((await f.book(choice,key)).statusCode,200);assert.equal((await f.operation(key)).json().status,'unknown');f.advance(400000);
  const body={expectedTenantId:f.actor.tenantId,idempotencyKey:randomUUID(),expectedRevision:a.revision,enabled:true,allowCreate:true,expiresInDays:1,maxBookingsPerDay:10};assert.equal((await f.request('PUT',`${f.base}/${a.id}`,body)).statusCode,200);
  const next=await f.request('POST',`/api/v1/ai/conversations/${choice.conversationId}/booking-slots`,{expectedTenantId:f.actor.tenantId,actionId:a.id,expectedRevision:Number(a.revision)+1,from:f.from,to:f.to});assert.equal(next.statusCode,200,next.body);
  const r=await f.book(next.json());assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error.code,'booking_slot_used');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
});

test('range bound and required form fail before reservation; receipt holds no visitor plaintext',async t=>{
  const f=await assistantBookingFixture(t);f.store.update(f.actor.tenantId,'booking-pages',f.page.id,{form:[{field:'name',label:'Nome',required:true}]});const a=await f.create();f.toolRound(a);const choice=(await f.askPrivate()).json().bookingChoices[0],before=f.requests.length;
  assert.deepEqual(Object.keys(choice.slots[0]).sort(),['endAt','expiresAt','quote','startAt']);
  assert.notEqual((await f.book(choice)).statusCode,200);assert.equal(f.requests.length,before);assert.equal(f.store.list(f.actor.tenantId,'booking-assistant-operations').length,0);
  const range=await f.request('POST',`/api/v1/ai/conversations/${choice.conversationId}/booking-slots`,{expectedTenantId:f.actor.tenantId,actionId:a.id,expectedRevision:a.revision,from:f.from,to:new Date(Date.parse(f.from)+8*86400000).toISOString()});assert.equal(range.statusCode,400);assert.equal(f.requests.length,before);
  const key=randomUUID(),booked=await f.book(choice,key,{name:'PRIVATE-VISITOR-NAME'});assert.equal(booked.statusCode,200,booked.body);
  assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId,'booking-assistant-operations')).includes('PRIVATE-VISITOR-NAME'));assert.ok(!JSON.stringify(f.openAI).includes('PRIVATE-VISITOR-NAME'));
  const link=await f.request('POST',`/api/v1/ai/booking-operations/${key}/management-link`,{});assert.equal(link.statusCode,200,link.body);const url=new URL(link.json().url);assert.equal(url.origin,'http://127.0.0.1:4310');assert.equal(new URLSearchParams(url.hash.slice(1)).get('booking'),booked.json().operation.bookingRef);
});

for(const change of ['organization','agent','channel'] as const)test(`${change} ABA retains reauthorization requirement instead of silently restoring delegated availability`,async t=>{
  const f=await assistantBookingFixture(t),a=await f.create('webchat');
  if(change==='organization'){f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(f.actor.tenantId);f.store.db.prepare("UPDATE organizations SET status='active' WHERE id=?").run(f.actor.tenantId);}
  if(change==='agent'){f.store.update(f.actor.tenantId,'agents',f.agent.id,{status:'paused'});f.store.update(f.actor.tenantId,'agents',f.agent.id,{status:'active'});}
  if(change==='channel'){f.store.update(f.actor.tenantId,'channels',f.channel.id,{enabled:false});f.store.update(f.actor.tenantId,'channels',f.channel.id,{enabled:true});}
  const list=await f.request('GET',f.base,undefined,await f.freshHeaders());assert.equal(list.statusCode,200,list.body);assert.equal(list.json().items[0].available,false);assert.equal(f.store.get(f.actor.tenantId,'booking-assistant-actions',a.id)?.invalidated,true);
  const before=f.requests.length,s=await f.session();const chat=await f.publicRequest(s.token,'messages',{message:'Olá',idempotencyKey:randomUUID()});assert.equal(chat.statusCode,200,chat.body);assert.equal(chat.json().bookingChoices,undefined);assert.equal(f.requests.length,before);
});

for(const name of ['create_appointment','external_create_appointment'])test(`managed action denies ${name} before a generic cached tool success can be replayed`,async t=>{
  const f=await assistantBookingFixture(t);await f.create();const initial=await f.askPrivate(),conversationId=initial.json().conversationId;assert.ok(conversationId,initial.body);
  const callId='old_success',args='{}',fingerprint=createHash('sha256').update(`${name}:${args}:`).digest('hex');f.store.create(f.actor.tenantId,'agent-tool-calls',{key:`${conversationId}:${callId}`,name,fingerprint,status:'succeeded',operatorUserId:f.actor.userId,result:{ok:true,secret:'CACHED-BOOKING-SUCCESS'}});
  f.aiHooks.openAI=body=>body.input.some((i:any)=>i.type==='function_call_output'&&i.call_id===callId)?Response.json({id:'response_denied_done',output:[{type:'message',content:[{type:'output_text',text:'Use o cartão.'}]}]}):Response.json({id:'response_denied_call',output:[{type:'function_call',call_id:callId,name,arguments:args}]});
  const result=await f.askPrivate(conversationId);assert.equal(result.statusCode,200,result.body);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);assert.ok(JSON.stringify(f.openAI).includes('booking_card_confirmation_required'));assert.ok(!JSON.stringify(f.openAI).includes('CACHED-BOOKING-SUCCESS'));
});

test('expired quote and a foreign visitor credential cannot reserve; unknown metadata stays original-scope',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create('webchat');f.toolRound(a);const s=await f.session(),other=await f.session(),chat=await f.publicRequest(s.token,'messages',{message:'Agendar',idempotencyKey:randomUUID()}),choice=chat.json().bookingChoices[0],before=f.requests.length;
  assert.notEqual((await f.publicRequest(other.token,'bookings',f.bookingBody(choice))).statusCode,200);assert.equal(f.requests.length,before);
  f.advance(Number(f.store.get(f.actor.tenantId,'booking-assistant-choices',choice.choiceId)!.expiresAt)-f.service.now()+1);const expired=await f.publicRequest(s.token,'bookings',f.bookingBody(choice));assert.equal(expired.statusCode,409,expired.body);assert.equal(expired.json().error.code,'booking_quote_expired');assert.equal(f.requests.length,before);assert.equal(f.store.list(f.actor.tenantId,'booking-assistant-operations').length,0);
});

test('bounded quote page uses Brazil timezone and detects the next window without asserting a reservation',async t=>{
  const f=await assistantBookingFixture(t);f.store.update(f.actor.tenantId,'booking-pages',f.page.id,{timezone:'America/Sao_Paulo'});const a=await f.create();f.toolRound(a);const choice=(await f.askPrivate()).json().bookingChoices[0];
  const page=await f.request('POST',`/api/v1/ai/conversations/${choice.conversationId}/booking-slots`,{expectedTenantId:f.actor.tenantId,actionId:a.id,expectedRevision:a.revision,from:f.from,to:new Date(Date.parse(f.from)+7*86400000).toISOString()});assert.equal(page.statusCode,200,page.body);const result=page.json();assert.equal(result.timezone,'America/Sao_Paulo');assert.equal(result.slots.length,200);assert.equal(result.complete,false);assert.ok(Date.parse(result.nextFrom)>Date.parse(result.slots.at(-1).startAt));assert.equal(result.reservationsGuaranteed,false);
  const original=f.store.list(f.actor.tenantId,'booking-assistant-choices')[0];for(let i=0;i<18;i++)f.store.create(f.actor.tenantId,'booking-assistant-choices',{conversationId:choice.conversationId,expiresAt:original.expiresAt});const before=f.requests.length;
  const bounded=await f.request('POST',`/api/v1/ai/conversations/${choice.conversationId}/booking-slots`,{expectedTenantId:f.actor.tenantId,actionId:a.id,expectedRevision:a.revision,from:f.from,to:f.to});assert.equal(bounded.statusCode,429,bounded.body);assert.equal(f.requests.length,before);
});

test('local finalization cannot overwrite a later cancellation owner after Google accepted create',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create();f.toolRound(a);const choice=(await f.askPrivate()).json().bookingChoices[0];let changed:any;
  f.hooks.provider=r=>{if(r.method!=='POST')return undefined;const b=f.store.list(f.actor.tenantId,'public-bookings').find(b=>b.assistantConversationId===choice.conversationId)!;changed=f.store.update(f.actor.tenantId,'public-bookings',b.id,{status:'cancel_pending',revision:2,operationId:randomUUID(),operationInFlightUntil:Date.now()+360000});return Response.json({...r.body,id:r.body.id,etag:'"accepted"'},{status:201});};
  const key=randomUUID();assert.notEqual((await f.book(choice,key)).statusCode,200);const op=(await f.operation(key)).json();assert.equal(op.status,'accepted');assert.deepEqual(f.store.get(f.actor.tenantId,'public-bookings',op.bookingRef),changed);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
});

test('pending is reported only while the exact local create is in flight; concurrent replay never dispatches',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create();f.toolRound(a);const choice=(await f.askPrivate()).json().bookingChoices[0];let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
  f.hooks.provider=async r=>{if(r.method==='POST'){enter();await held;}return undefined;};const key=randomUUID(),sending=f.book(choice,key);await entered;
  const before=f.requests.length;assert.equal((await f.operation(key)).json().status,'pending');assert.equal((await f.book(choice,key)).json().replayed,true);assert.equal(f.requests.length,before);release();assert.equal((await sending).statusCode,200);assert.equal((await f.operation(key)).json().status,'confirmed');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
});

test('a post-COMMIT exception after reservation but before dispatch leaves unknown and never releases a fresh key',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create();f.toolRound(a);const choice=(await f.askPrivate()).json().bookingChoices[0],original=f.store.transaction.bind(f.store);let fail=true;
  f.store.transaction=((fn:any)=>{const before=f.store.list(f.actor.tenantId,'booking-assistant-operations').length,result=original(fn);if(fail&&!before&&f.store.list(f.actor.tenantId,'booking-assistant-operations').length){fail=false;throw Error('synthetic committed reservation interruption');}return result;}) as any;
  const key=randomUUID(),r=await f.book(choice,key);assert.notEqual(r.statusCode,200);const before=f.requests.length,op=(await f.operation(key)).json();assert.equal(op.status,'unknown');assert.equal(op.needsReconciliation,true);assert.equal((await f.book(choice,key)).json().replayed,true);assert.notEqual((await f.book(choice)).statusCode,200);assert.equal(f.requests.length,before);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);assert.equal(f.store.list(f.actor.tenantId,'booking-assistant-operations').length,1);
});

test('public booking preflights use only exact original origin and never credentials, including after channel disable',async t=>{
  const f=await assistantBookingFixture(t);await f.create('webchat');const s=await f.session();await f.publicRequest(s.token,'end',{});f.store.update(f.actor.tenantId,'channels',f.channel.id,{enabled:false});
  for(const path of ['booking-slots','bookings','booking-operation','booking-management-link']){
    const headers={origin:f.origin,'access-control-request-method':path==='booking-operation'?'GET':'POST','access-control-request-headers':'authorization,content-type'};
    const result=await f.app.inject({method:'OPTIONS',url:f.publicPath(path),headers});assert.equal(result.statusCode,204,result.body);assert.equal(result.headers['access-control-allow-origin'],f.origin);assert.equal(result.headers['access-control-allow-credentials'],undefined);
    assert.equal((await f.app.inject({method:'OPTIONS',url:f.publicPath(path),headers:{...headers,origin:'https://other.example.test'}})).statusCode,403);
  }
  assert.equal((await f.app.inject({url:f.publicPath('booking-operation',{operationKey:randomUUID()}),headers:{origin:'https://other.example.test',authorization:'Bearer '+s.token}})).statusCode,401);
});
