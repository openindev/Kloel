import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Entity } from '../src/store.js';
import { unseal } from '../src/oauth/crypto.js';
import { publicAudience } from '../src/public-booking/assistant-authority.js';
import { createAssistantBooking } from '../src/public-booking/assistant-booking.js';
import { assistantBookingFixture } from './fixtures/assistant-booking.js';

type F=Awaited<ReturnType<typeof assistantBookingFixture>>;
const customFields=[{id:'empresa',label:'Empresa',type:'text',required:true},{id:'site',label:'Site',type:'text',required:false}];
async function withCustomFields(t:any,audience:'private'|'webchat'='private'){
  const f=await assistantBookingFixture(t);f.store.update(f.actor.tenantId,'booking-pages',f.page.id,{customFields});const a=await f.create(audience);return{f,a};
}
/** O modelo chama booking_slots com as respostas que coletou; a segunda rodada só encerra o turno. */
function slotsRound(f:F,a:Entity,answers?:Record<string,string|null>){
  f.aiHooks.openAI=body=>body.input.some((i:any)=>i.type==='function_call_output')?Response.json({id:'response_done',output:[{type:'message',content:[{type:'output_text',text:'Pronto.'}]}]}):Response.json({id:'response_slots',output:[{type:'function_call',call_id:'booking_call',name:`booking_slots_${a.id.replaceAll('-','')}`,arguments:JSON.stringify({from:f.from,to:f.to,...(answers?{answers}:{})})}]});
}
const toolOutput=(f:F)=>{const item=f.openAI.flatMap(b=>b.input).find((i:any)=>i.type==='function_call_output');assert.ok(item,'tool output reached the model');return JSON.parse(item.output);};
const visitor=(f:F,bookingRef:string)=>{const b=f.store.get(f.actor.tenantId,'public-bookings',bookingRef)!;return unseal<any>(String(b.encryptedVisitor),`${f.actor.tenantId}:${b.reference}:booking-visitor`);};

test('booking_slots tool exposes the event type custom fields as strict answers the model can fill',async t=>{
  const{f,a}=await withCustomFields(t);slotsRound(f,a,{c_empresa:'ACME',c_site:null});assert.equal((await f.askPrivate()).statusCode,200);
  const tool=f.openAI[0].tools.find((x:any)=>x.name===`booking_slots_${a.id.replaceAll('-','')}`);assert.ok(tool);
  assert.equal(tool.strict,true);assert.deepEqual(tool.parameters.required,['from','to','answers']);
  const answers=tool.parameters.properties.answers;assert.equal(answers.additionalProperties,false);assert.deepEqual(answers.required,['c_empresa','c_site']);
  assert.deepEqual(answers.properties.c_empresa.type,['string','null']);assert.match(answers.properties.c_empresa.description,/Empresa.*obrigatório/);assert.match(tool.description,/Empresa \(obrigatório\)/);
});

test('event type without custom fields keeps the original booking_slots schema',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create();f.toolRound(a);assert.equal((await f.askPrivate()).statusCode,200);
  const tool=f.openAI[0].tools.find((x:any)=>x.name===`booking_slots_${a.id.replaceAll('-','')}`);assert.deepEqual(Object.keys(tool.parameters.properties),['from','to']);
});

test('assistant that collected the required answers gets a card whose confirmation books with them; refreshed slots keep them',async t=>{
  const{f,a}=await withCustomFields(t);slotsRound(f,a,{c_empresa:'ACME Ltda',c_site:null});
  const chat=await f.askPrivate();assert.equal(chat.statusCode,200,chat.body);const choice=chat.json().bookingChoices?.[0];assert.ok(choice,chat.body);
  const out=toolOutput(f);assert.equal(out.ok,true);assert.ok(!JSON.stringify(out).includes('ACME'));
  assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId,'booking-assistant-choices')).includes('ACME Ltda'));
  const r=await f.book(choice,randomUUID());assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.status,'confirmed');
  assert.deepEqual(visitor(f,r.json().operation.bookingRef).custom,{empresa:'ACME Ltda'});
  assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId,'booking-assistant-operations')).includes('ACME Ltda'));
  f.store.update(f.actor.tenantId,'public-bookings',r.json().operation.bookingRef,{status:'cancelled'});
  const next=await f.request('POST',`/api/v1/ai/conversations/${choice.conversationId}/booking-slots`,{expectedTenantId:f.actor.tenantId,actionId:a.id,expectedRevision:a.revision,from:f.from,to:f.to});assert.equal(next.statusCode,200,next.body);
  const again=await f.book({...next.json(),slots:next.json().slots.slice(1)},randomUUID());assert.equal(again.statusCode,200,again.body);assert.deepEqual(visitor(f,again.json().operation.bookingRef).custom,{empresa:'ACME Ltda'});
});

for(const[name,answers]of[['no answers',undefined],['null',{c_empresa:null,c_site:'acme.example'}],['blank',{c_empresa:'   ',c_site:null}]] as const)test(`assistant without the required answers (${name}) gets no card and is told which fields to ask`,async t=>{
  {
    const{f,a}=await withCustomFields(t);slotsRound(f,a,answers);
    const chat=await f.askPrivate();assert.equal(chat.statusCode,200,chat.body);assert.ok(!chat.json().bookingChoices?.length,chat.body);
    const out=toolOutput(f);assert.equal(out.ok,false);assert.equal(out.error,'booking_form_required');assert.deepEqual(out.missingFields,['Empresa']);assert.match(out.instruction,/Empresa/);
    assert.equal(f.store.list(f.actor.tenantId,'booking-assistant-choices').length,0);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
  }
});

test('confirmation of a card without the required answers fails listing the missing fields; card values complete it',async t=>{
  const{f,a}=await withCustomFields(t,'webchat');const s=await f.session();
  assert.equal((await f.publicRequest(s.token,'messages',{message:'Olá',idempotencyKey:randomUUID()})).statusCode,200);
  const slots=await f.publicRequest(s.token,'booking-slots',{actionId:a.id,expectedRevision:a.revision,from:f.from,to:f.to});assert.equal(slots.statusCode,200,slots.body);const choice=slots.json();
  const route=await f.publicRequest(s.token,'bookings',f.bookingBody(choice));assert.equal(route.statusCode,400,route.body);assert.equal(route.json().error.code,'booking_form_required');
  const audience=publicAudience(f.store,{query:{tenantId:f.actor.tenantId,channelId:f.channel.id},headers:{origin:f.origin,authorization:`Bearer ${s.token}`}} as any,f.service.now());
  await assert.rejects(createAssistantBooking(f.service,audience,choice.conversationId,f.bookingBody(choice)),(e:any)=>e.code==='booking_form_required'&&e.message==='Preencha os campos obrigatórios: Empresa.');
  assert.equal(f.store.list(f.actor.tenantId,'booking-assistant-operations').length,0);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
  const ok=await f.publicRequest(s.token,'bookings',{...f.bookingBody(choice),values:{c_empresa:'Kloel'}});assert.equal(ok.statusCode,200,ok.body);assert.deepEqual(visitor(f,ok.json().operation.bookingRef).custom,{empresa:'Kloel'});
});

test('answer outside the custom field format is sent back to the model before any card',async t=>{
  const f=await assistantBookingFixture(t);f.store.update(f.actor.tenantId,'booking-pages',f.page.id,{customFields:[...customFields,{id:'financeiro',label:'E-mail do financeiro',type:'email',required:false}]});const a=await f.create();
  slotsRound(f,a,{c_empresa:'ACME',c_site:null,c_financeiro:'nao-e-email'});const chat=await f.askPrivate();assert.equal(chat.statusCode,200,chat.body);assert.ok(!chat.json().bookingChoices?.length);
  const out=toolOutput(f);assert.equal(out.error,'booking_form_invalid');assert.deepEqual(out.missingFields,[]);assert.deepEqual(out.invalidFields,['E-mail do financeiro']);assert.equal(f.store.list(f.actor.tenantId,'booking-assistant-choices').length,0);
});
