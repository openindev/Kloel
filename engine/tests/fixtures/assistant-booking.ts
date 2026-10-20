import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Store, Entity } from '../../src/store.js';
import { bookingOperatorFixture } from './booking-operator.js';
import { registerProviders } from '../../src/providers.js';
import { registerPublicChat } from '../../src/public-chat.js';
import { registerDomains } from '../../src/domains.js';

export async function assistantBookingFixture(t:TestContext,setup?:(app:FastifyInstance,store:Store)=>void|Promise<void>){
  const env=['PROVIDER_TENANT_ID','OPENAI_API_KEY','OPENAI_MODEL'],previous=Object.fromEntries(env.map(k=>[k,process.env[k]]));
  process.env.PROVIDER_TENANT_ID='booking-operator-tenant';process.env.OPENAI_API_KEY='synthetic-booking-openai';process.env.OPENAI_MODEL='synthetic-model';
  t.after(()=>{for(const k of env){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}});
  let agent:Entity,channel:Entity;const origin='https://booking.example.test';
  const f=await bookingOperatorFixture(t,'google',async(app,store)=>{
    agent=store.create('booking-operator-tenant','agents',{name:'Booking assistant',status:'active',prompt:'Use horários reais.',tools:['schedule_appointment'],language:'pt-BR'});
    channel=store.create('booking-operator-tenant','channels',{name:'Site',type:'webchat',provider:'openai',enabled:true,agentId:agent.id,revision:1,configuration:{allowedOrigins:[origin]}});
    const page=store.list('booking-operator-tenant','booking-pages')[0];store.update('booking-operator-tenant','booking-pages',page.id,{agentIds:[agent.id]});
    await registerProviders(app,store);await registerDomains(app,store);await registerPublicChat(app,store);await setup?.(app,store);
  });
  const googleFetch=globalThis.fetch,openAI:any[]=[],aiHooks:{openAI?:(body:any)=>Response|Promise<Response>}={};
  globalThis.fetch=(async(input,init={})=>{
    if(String(input)!=='https://api.openai.com/v1/responses')return googleFetch(input,init);
    const body=JSON.parse(String(init.body));openAI.push(body);return aiHooks.openAI?aiHooks.openAI(body):Response.json({id:'response_booking',output:[{type:'message',content:[{type:'output_text',text:'Confira os horários no cartão.'}]}]});
  }) as typeof fetch;
  const request=(method:'GET'|'POST'|'PUT',url:string,payload?:unknown,headers=f.headers)=>f.app.inject({method,url,cookies:f.cookies,headers,...(payload!==undefined?{payload}:{})});
  const base=`/api/v1/agents/${agent!.id}/booking-actions`,from=new Date(Date.parse(f.from)+3600000).toISOString(),to=f.to;
  const create=async(audience:'private'|'webchat'='private',enabled=true)=>{
    const r=await request('POST',base,{expectedTenantId:f.actor.tenantId,idempotencyKey:randomUUID(),eventTypeId:f.page.id,audience,channelId:audience==='webchat'?channel!.id:null});assert.equal(r.statusCode,200,r.body);
    let op=r.json().operation;if(enabled){const u=await request('PUT',`${base}/${op.actionId}`,{expectedTenantId:f.actor.tenantId,idempotencyKey:randomUUID(),expectedRevision:op.revision,enabled:true,allowCreate:true,expiresInDays:1,maxBookingsPerDay:10});assert.equal(u.statusCode,200,u.body);op=u.json().operation;}
    return f.store.get(f.actor.tenantId,'booking-assistant-actions',op.actionId)!;
  };
  const toolRound=(action:Entity)=>{aiHooks.openAI=body=>body.input.some((i:any)=>i.type==='function_call_output')?Response.json({id:'response_done',output:[{type:'message',content:[{type:'output_text',text:'Escolha um horário e confirme no cartão.'}]}]}):Response.json({id:'response_slots',output:[{type:'function_call',call_id:'booking_call',name:`booking_slots_${action.id.replaceAll('-','')}`,arguments:JSON.stringify({from,to})}]});};
  const askPrivate=(conversationId?:string,key=randomUUID())=>request('POST','/api/v1/ai/chat',{agentId:agent!.id,message:'Quero agendar.',idempotencyKey:key,...(conversationId?{conversationId}:{})});
  const publicPath=(path:string,extra:Record<string,string>={})=>`/api/v1/public/chat/${path}?${new URLSearchParams({tenantId:f.actor.tenantId,channelId:channel!.id,...extra})}`;
  const publicRequest=(token:string,path:string,payload?:unknown,extra:Record<string,string>={})=>f.app.inject({method:payload===undefined?'GET':'POST',url:publicPath(path,extra),headers:{origin,authorization:`Bearer ${token}`},...(payload===undefined?{}:{payload})});
  const session=async()=>{const r=await f.app.inject({method:'POST',url:publicPath('sessions'),headers:{origin},payload:{}});assert.equal(r.statusCode,201,r.body);return r.json();};
  const bookingBody=(choice:any,key=randomUUID())=>({actionId:choice.actionId,expectedRevision:choice.actionRevision,choiceId:choice.choiceId,quote:choice.slots[0].quote,values:{},idempotencyKey:key,confirm:true});
  const book=(choice:any,key=randomUUID(),values:Record<string,string>={})=>request('POST',`/api/v1/ai/conversations/${choice.conversationId}/bookings`,{expectedTenantId:f.actor.tenantId,...bookingBody(choice,key),values});
  const operation=(key:string,headers=f.headers)=>request('GET',`/api/v1/ai/booking-operations/${key}`,undefined,headers);
  return{...f,agent:agent!,channel:channel!,origin,request,base,from,to,create,toolRound,aiHooks,openAI,askPrivate,publicPath,publicRequest,session,bookingBody,book,operation};
}
