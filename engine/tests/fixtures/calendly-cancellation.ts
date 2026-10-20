import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { Store } from '../../src/store.js';
import { calendlyFixture } from './calendly.js';
import { C } from '../../src/calendly/schema.js';
import { remoteUri } from '../../src/calendly/oauth.js';
import { privateAudience } from '../../src/calendly/access.js';

export async function calendlyCancellationFixture(t:TestContext,setup?:(app:FastifyInstance,store:Store)=>void|Promise<void>){
  const f=await calendlyFixture(t,setup),cancelHooks:{before?:typeof f.hooks.before;after?:typeof f.hooks.after}={};
  f.hooks.before=async(url,method,body)=>{
    const intercepted=await cancelHooks.before?.(url,method,body);if(intercepted)return intercepted;
    if(method==='POST'&&/^\/scheduled_events\/[0-9a-f-]{36}\/cancellation$/.test(url.pathname)){
      assert.deepEqual(body,{});const eventId=url.pathname.split('/')[2],event=f.remote.events.get(eventId);
      if(!event)return Response.json({}, {status:404});
      event.status='canceled';event.invitees_counter.active=0;
      for(const i of f.remote.invitees.values())if(i.event===event.uri)i.status='canceled';
      const response=Response.json({resource:{canceler_type:'host',created_by:'Synthetic owner',reason:null}},{status:201});
      return cancelHooks.after?cancelHooks.after(url,method,body,response):response;
    }
  };
  f.hooks.after=(url,method,body,response)=>cancelHooks.after?cancelHooks.after(url,method,body,response):response;
  const prepare=async()=>{
    const connection=await f.connect(),action=await f.createAction(connection.id);f.toolRound(action);
    const chat=await f.askPrivate();assert.equal(chat.statusCode,200,chat.body);const choice=chat.json().calendlyChoices[0],creationKey=randomUUID();
    const booked=await f.book(choice,creationKey);assert.equal(booked.statusCode,200,booked.body);
    const verified=await f.verify(creationKey);assert.equal(verified.statusCode,200,verified.body);assert.equal(verified.json().status,'confirmed');
    const row=f.store.list(f.actor.tenantId,C.operations).find(r=>r.key===creationKey)!;
    const event=[...f.remote.events.values()].at(-1)!,invitee=[...f.remote.invitees.values()].at(-1)!;
    Object.assign(event,{event_memberships:[{user:remoteUri('users',f.remote.userId)}],event_guests:[],invitees_counter:{total:1,active:1,limit:1}});
    return{connection,action,choice,creationKey,bookingRef:String(row.bookingRef),row,event,invitee};
  };
  const cancelBody=(bookingRef:string,key=randomUUID(),previousNotSentKey?:string)=>({expectedTenantId:f.actor.tenantId,idempotencyKey:key,bookingRef,confirm:true,acknowledgeNotifications:true,...previousNotSentKey?{previousNotSentKey}:{}});
  const cancelOriginal=(creationKey:string,bookingRef:string,key=randomUUID(),previousNotSentKey?:string)=>f.request('POST',`${f.base}/operations/${creationKey}/cancellations`,cancelBody(bookingRef,key,previousNotSentKey));
  const cancellation=(key:string)=>f.request('GET',`${f.base}/cancellation-operations/${key}`);
  const cancellations=(creationKey:string)=>f.request('GET',`${f.base}/operations/${creationKey}/cancellations`);
  const verifyCancellation=(key:string)=>f.request('POST',`${f.base}/cancellation-operations/${key}/verify`,{expectedTenantId:f.actor.tenantId});
  const audience=(store=f.store)=>privateAudience(store,{headers:{...f.headers},cookies:f.cookies,actor:f.actor} as unknown as FastifyRequest);
  const cancellationPosts=()=>f.requests.filter(r=>r.method==='POST'&&new URL(r.url).pathname.endsWith('/cancellation'));
  return{...f,prepare,cancelHooks,cancelBody,cancelOriginal,cancellation,cancellations,verifyCancellation,audience,cancellationPosts};
}
