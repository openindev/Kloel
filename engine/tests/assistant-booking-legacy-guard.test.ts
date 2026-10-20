import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {assistantBookingFixture} from './fixtures/assistant-booking.js';
import {seedMember} from './fixtures/membership.js';
import {CONTEXT_HEADERS} from '../src/request-context.js';

for(const role of ['owner','admin'] as const)for(const effect of ['local_create','cached_external'] as const)test(`managed private mode fences ${effect} for ${role} even without a booking turn`,async t=>{
  const f=await assistantBookingFixture(t),action=await f.create();let cookies=f.cookies,userId=f.actor.userId;
  if(role==='admin'){
    userId='booking-admin-reader';seedMember(f.store,{userId,tenantId:f.actor.tenantId,role:'admin'});cookies={kloel_session:'synthetic-other-admin'};f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(cookies.kloel_session).digest('hex'),userId,f.actor.tenantId,Date.now()+86400000);
  }
  // Owner omits expected context; admin has real current context but is not a booking owner.
  const me=await f.app.inject({url:'/api/v1/auth/me',cookies});assert.equal(me.statusCode,200,me.body);const context=me.json().context;
  const headers=role==='owner'?{}:Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([k,v])=>[v,context[k]??'-']));
  const request=(conversationId?:string)=>f.app.inject({method:'POST',url:'/api/v1/ai/chat',cookies,headers,payload:{agentId:f.agent.id,idempotencyKey:randomUUID(),message:'Confirmo o horário.',...(conversationId?{conversationId}:{})}});
  let conversationId:string|undefined,callId='attempt_generic',name='create_appointment',args:any;
  if(effect==='local_create'){
    const calendar=f.store.create(f.actor.tenantId,'calendars',{name:'Local',provider:'local',enabled:true,agentId:f.agent.id,timezone:'UTC',appointmentDurationMinutes:30});
    args={calendarId:calendar.id,title:'BYPASS LOCAL',startAt:f.from,endAt:new Date(Date.parse(f.from)+1800000).toISOString(),timezone:'UTC',confirmedByUser:true};
  }else{
    const initial=await request();assert.equal(initial.statusCode,200,initial.body);conversationId=initial.json().conversationId;name='external_create_appointment';args={};
    f.store.create(f.actor.tenantId,'agent-tool-calls',{key:`${conversationId}:${callId}`,name,fingerprint:createHash('sha256').update(`${name}:{}:`).digest('hex'),operatorUserId:userId,status:'succeeded',result:{ok:true,marker:'LEGACY-CACHED-ACCEPTANCE'}});
    // An unavailable enabled delegation must still fence the fallback mutator.
    f.store.update(f.actor.tenantId,'booking-assistant-actions',action.id,{invalidated:true});
  }
  const before=f.store.list(f.actor.tenantId,'appointments').length;let advertised:string[]=[];
  f.aiHooks.openAI=body=>{
    if(body.input.some((v:any)=>v.type==='function_call_output'&&v.call_id===callId))return Response.json({id:'response_guard_done',output:[{type:'message',content:[{type:'output_text',text:'Confira o cartão de agendamento.'}]}]});
    advertised=(body.tools??[]).map((v:any)=>v.name);return Response.json({id:'response_guard_call',output:[{type:'function_call',call_id:callId,name,arguments:JSON.stringify(args)}]});
  };
  const result=await request(conversationId);assert.equal(result.statusCode,200,result.body);
  assert.equal(f.store.list(f.actor.tenantId,'appointments').length-before,0,'managed mode must not create a generic local appointment');
  assert.ok(!advertised.includes('create_appointment')&&!advertised.includes('external_create_appointment'),'generic create must not be advertised');
  assert.ok(JSON.stringify(f.openAI).includes('booking_card_confirmation_required'));assert.ok(!JSON.stringify(f.openAI).includes('LEGACY-CACHED-ACCEPTANCE'));assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
});

test('private chat without managed delegation preserves existing generic local booking',async t=>{
  const f=await assistantBookingFixture(t),calendar=f.store.create(f.actor.tenantId,'calendars',{name:'Local',provider:'local',enabled:true,agentId:f.agent.id,timezone:'UTC',appointmentDurationMinutes:30}),before=f.store.list(f.actor.tenantId,'appointments').length;
  f.aiHooks.openAI=body=>body.input.some((v:any)=>v.type==='function_call_output')?Response.json({id:'response_legacy_done',output:[{type:'message',content:[{type:'output_text',text:'Agenda local atualizada.'}]}]}):Response.json({id:'response_legacy',output:[{type:'function_call',call_id:'legacy',name:'create_appointment',arguments:JSON.stringify({calendarId:calendar.id,title:'Legacy local',startAt:f.from,endAt:new Date(Date.parse(f.from)+1800000).toISOString(),timezone:'UTC',confirmedByUser:true})}]});
  const result=await f.request('POST','/api/v1/ai/chat',{agentId:f.agent.id,message:'Confirmo',idempotencyKey:randomUUID()},{});assert.equal(result.statusCode,200,result.body);assert.equal(f.store.list(f.actor.tenantId,'appointments').length-before,1);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
});
