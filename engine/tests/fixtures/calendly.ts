import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Store,Entity } from '../../src/store.js';
import { assistantBookingFixture } from './assistant-booking.js';
import { registerCalendly } from '../../src/calendly/routes.js';
import { C } from '../../src/calendly/schema.js';
import { requestedScopes,remoteUri } from '../../src/calendly/oauth.js';

export async function calendlyFixture(t:TestContext,setup?:(app:FastifyInstance,store:Store)=>void|Promise<void>){
  const keys=['CALENDLY_CLIENT_ID','CALENDLY_CLIENT_SECRET','CALENDLY_REDIRECT_URI'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  process.env.CALENDLY_CLIENT_ID='synthetic-calendly-client';process.env.CALENDLY_CLIENT_SECRET='synthetic-calendly-secret';process.env.CALENDLY_REDIRECT_URI='http://127.0.0.1:4310/api/v1/calendly/oauth/callback';
  t.after(()=>{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}});
  const f=await assistantBookingFixture(t,async(app,store)=>{await registerCalendly(app,store);await setup?.(app,store);});
  const inherited=globalThis.fetch,userId=randomUUID(),organizationId=randomUUID(),eventTypeId=randomUUID();
  const type:any={uri:remoteUri('event_types',eventTypeId),name:'Calendly sintético',active:true,booking_method:'instant',kind:'solo',pooling_type:null,duration:30,duration_options:null,is_paid:false,custom_questions:[],locations:[],profile:{type:'User',owner:remoteUri('users',userId)},scheduling_url:'https://calendly.com/synthetic/meeting'};
  const from=new Date(Date.now()+2*86400000).toISOString(),to=new Date(Date.parse(from)+86400000).toISOString(),startAt=new Date(Date.parse(from)+3600000).toISOString(),endAt=new Date(Date.parse(startAt)+1800000).toISOString();
  const remote={type,types:new Map<string,any>([[eventTypeId,type]]),userId,organizationId,eventTypeId,scope:requestedScopes.join(' '),available:[startAt],tokenVersion:0,events:new Map<string,any>(),invitees:new Map<string,any>()};
  const requests:{url:string;method:string;body:any}[]=[],hooks:{before?:(url:URL,method:string,body:any)=>Response|void|Promise<Response|void>;after?:(url:URL,method:string,body:any,response:Response)=>Response|Promise<Response>}={};
  const transport=(async(input,init={})=>{
    const url=new URL(String(input));if(url.origin==='https://api.openai.com')return inherited(input,init);
    if(!['https://api.calendly.com','https://auth.calendly.com'].includes(url.origin))throw new Error('Unexpected controlled provider');
    assert.equal(init.redirect,'error');const method=init.method??'GET',body=init.body?url.pathname==='/oauth/token'?Object.fromEntries(new URLSearchParams(String(init.body))):JSON.parse(String(init.body)):null;requests.push({url:url.href,method,body});const intercepted=await hooks.before?.(url,method,body);if(intercepted)return intercepted;
    let response:Response;
    if(url.origin==='https://auth.calendly.com'&&url.pathname==='/oauth/token'&&method==='POST'){
      assert.equal(new Headers(init.headers).get('authorization'),`Basic ${Buffer.from('synthetic-calendly-client:synthetic-calendly-secret').toString('base64')}`);
      if(body.grant_type==='refresh_token')assert.equal(body.refresh_token,`synthetic-refresh-${remote.tokenVersion}`);else assert.equal(body.grant_type,'authorization_code');remote.tokenVersion++;
      response=Response.json({access_token:`synthetic-access-${remote.tokenVersion}`,refresh_token:`synthetic-refresh-${remote.tokenVersion}`,token_type:'Bearer',expires_in:7200,owner:remoteUri('users',userId),organization:remoteUri('organizations',organizationId),scope:remote.scope});
    }else{
      assert.match(new Headers(init.headers).get('authorization')??'',/^Bearer synthetic-access-\d+$/);
      if(url.pathname==='/users/me'&&method==='GET')response=Response.json({resource:{uri:remoteUri('users',userId),current_organization:remoteUri('organizations',organizationId),name:'Synthetic owner',timezone:'America/Sao_Paulo'}});
      else if(url.pathname==='/event_types'&&method==='GET'){assert.equal(url.searchParams.get('user'),remoteUri('users',userId));response=Response.json({collection:[...remote.types.values()],pagination:{next_page_token:null}});}
      else if(url.pathname.startsWith('/event_types/')&&method==='GET')response=remote.types.has(url.pathname.split('/')[2])?Response.json({resource:remote.types.get(url.pathname.split('/')[2])}):Response.json({}, {status:404});
      else if(url.pathname==='/event_type_available_times'&&method==='GET'){assert.ok([...remote.types.keys()].some(id=>url.searchParams.get('event_type')===remoteUri('event_types',id)));const lo=Date.parse(url.searchParams.get('start_time')!),hi=Date.parse(url.searchParams.get('end_time')!);response=Response.json({collection:remote.available.filter(s=>Date.parse(s)>=lo&&Date.parse(s)<hi).map(start_time=>({start_time,status:'available',invitees_remaining:1}))});}
      else if(url.pathname==='/invitees'&&method==='POST'){
        const eventId=randomUUID(),inviteeId=randomUUID(),event={uri:remoteUri('scheduled_events',eventId),event_type:body.event_type,start_time:body.start_time,end_time:new Date(Date.parse(body.start_time)+1800000).toISOString(),status:'active'};
        const invitee={uri:`${event.uri}/invitees/${inviteeId}`,event:event.uri,...body.invitee,status:'active',rescheduled:false,cancel_url:`https://calendly.com/cancellations/${inviteeId}`,reschedule_url:`https://calendly.com/reschedulings/${inviteeId}`};remote.events.set(eventId,event);remote.invitees.set(inviteeId,invitee);response=Response.json({resource:invitee},{status:201});
      }else if(/^\/scheduled_events\/[0-9a-f-]{36}$/.test(url.pathname)&&method==='GET'){const r=remote.events.get(url.pathname.split('/')[2]);response=r?Response.json({resource:r}):Response.json({}, {status:404});}
      else if(/^\/scheduled_events\/[0-9a-f-]{36}\/invitees\/[0-9a-f-]{36}$/.test(url.pathname)&&method==='GET'){const r=remote.invitees.get(url.pathname.split('/')[4]);response=r?Response.json({resource:r}):Response.json({}, {status:404});}
      else throw new Error(`Unexpected controlled Calendly path ${method} ${url.pathname}`);
    }
    return hooks.after?hooks.after(url,method,body,response):response;
  }) as typeof fetch;globalThis.fetch=transport;
  const base='/api/v1/calendly',request=f.request;
  const connect=async(key=randomUUID())=>{const s=await request('POST',`${base}/oauth/start`,{expectedTenantId:f.actor.tenantId,idempotencyKey:key});assert.equal(s.statusCode,200,s.body);const start=s.json(),state=new URL(start.authorizationUrl).searchParams.get('state');const r=await f.app.inject({method:'GET',url:`${base}/oauth/callback?${new URLSearchParams({code:'synthetic-code',state:state!})}`,cookies:f.cookies});assert.equal(r.statusCode,200,r.body);return r.json().connection;};
  const createAction=async(connectionId:string,audience:'private'|'webchat'='private',enabled=true,typeId=eventTypeId)=>{const r=await request('POST',`${base}/agents/${f.agent.id}/actions`,{expectedTenantId:f.actor.tenantId,idempotencyKey:randomUUID(),connectionId,eventTypeId:typeId,audience,channelId:audience==='webchat'?f.channel.id:null});assert.equal(r.statusCode,200,r.body);let op=r.json().operation;if(enabled){const u=await request('PUT',`${base}/agents/${f.agent.id}/actions/${op.resourceId}`,{expectedTenantId:f.actor.tenantId,idempotencyKey:randomUUID(),expectedRevision:op.revision,enabled:true,allowCreate:true,expiresInDays:1,maxBookingsPerDay:10});assert.equal(u.statusCode,200,u.body);op=u.json().operation;}return f.store.get(f.actor.tenantId,C.actions,op.resourceId)!;};
  const toolRound=(action:Entity)=>{f.aiHooks.openAI=body=>body.input.some((i:any)=>i.type==='function_call_output')?Response.json({id:'response_calendly_done',output:[{type:'message',content:[{type:'output_text',text:'Confirme pelo cartão Calendly.'}]}]}):Response.json({id:'response_calendly_slots',output:[{type:'function_call',call_id:'calendly_call',name:`calendly_slots_${action.id.replaceAll('-','')}`,arguments:JSON.stringify({from,to})}]});};
  const body=(choice:any,key=randomUUID())=>({idempotencyKey:key,actionId:choice.actionId,expectedRevision:choice.actionRevision,choiceId:choice.choiceId,quote:choice.slots[0].quote,values:{name:'Synthetic visitor',email:'visitor@example.test',timezone:'America/Sao_Paulo'},confirm:true,acknowledgeNotifications:true});
  const book=(choice:any,key=randomUUID())=>request('POST',`${base}/conversations/${choice.conversationId}/bookings`,{expectedTenantId:f.actor.tenantId,...body(choice,key)});
  const operation=(key:string)=>request('GET',`${base}/operations/${key}`),verify=(key:string)=>request('POST',`${base}/operations/${key}/verify`,{expectedTenantId:f.actor.tenantId});
  return{...f,base,from,to,startAt,endAt,requests,hooks,remote,transport,connect,createAction,toolRound,bookingBody:body,book,operation,verify};
}
