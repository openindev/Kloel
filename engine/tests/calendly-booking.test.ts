import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { calendlyFixture } from './fixtures/calendly.js';
import { C } from '../src/calendly/schema.js';
import { remoteUri } from '../src/calendly/oauth.js';

async function prepared(t:any){const f=await calendlyFixture(t),connection=await f.connect(),action=await f.createAction(connection.id);f.toolRound(action);const chat=await f.askPrivate();assert.equal(chat.statusCode,200,chat.body);return{...f,connection,action,choice:chat.json().calendlyChoices[0]};}

test('Calendly real HTTP OAuth → delegated slots → explicit create → verify; one POST and private receipt',async t=>{
  const f=await calendlyFixture(t),c=await f.connect(),a=await f.createAction(c.id);f.toolRound(a);const chat=await f.askPrivate();assert.equal(chat.statusCode,200,chat.body);const choice=chat.json().calendlyChoices[0];assert.equal(choice.notifications,'provider_managed_unknown');assert.equal(choice.slots.length,1);
  const key=randomUUID(),r=await f.book(choice,key);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.status,'accepted');assert.equal(r.json().operation.needsReconciliation,true);
  const v=await f.verify(key);assert.equal(v.statusCode,200,v.body);assert.equal(v.json().status,'confirmed');assert.equal(v.json().effect,'event_verified');const replay=await f.book(choice,key);assert.equal(replay.json().replayed,true);assert.equal(replay.json().operation.status,'confirmed');assert.equal(f.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/invitees')).length,1);
  assert.equal(JSON.stringify(f.openAI).includes(choice.slots[0].quote),false);const receipt=(await f.operation(key)).json();assert.equal(JSON.stringify(receipt).includes('visitor@example.test'),false);
});
test('lost create response leaves unknown; local GET/replay after resource removal never sends again',async t=>{
  const f=await prepared(t),key=randomUUID();f.hooks.after=(url,_method,_body,response)=>{if(url.pathname==='/invitees')throw Error('lost network reply');return response;};const r=await f.book(f.choice,key);assert.equal(r.statusCode,502);assert.equal((await f.operation(key)).json().status,'unknown');assert.equal(f.remote.events.size,1);
  f.store.remove(f.actor.tenantId,C.actions,f.action.id);f.store.remove(f.actor.tenantId,C.connections,f.connection.id);f.store.remove(f.actor.tenantId,'agents',f.agent.id);const n=f.requests.length;const read=await f.operation(key),replay=await f.book(f.choice,key);assert.equal(read.statusCode,200);assert.equal(replay.json().replayed,true);assert.equal(replay.json().operation.status,'unknown');assert.equal(f.requests.length,n);
});
test('HTTP2xx observation survives invalid body and late configuration revocation',async t=>{
  const f=await prepared(t),key=randomUUID();f.hooks.after=(url,_method,_body,response)=>{if(url.pathname==='/invitees'){f.store.update(f.actor.tenantId,C.actions,f.action.id,{enabled:false});return new Response('not JSON',{status:201});}return response;};assert.equal((await f.book(f.choice,key)).statusCode,502);const r=(await f.operation(key)).json();assert.equal(r.status,'accepted');assert.equal(r.effect,'http_accepted');assert.equal(r.reasonCode,'provider_response_invalid');assert.equal(r.needsReconciliation,true);assert.equal(f.remote.events.size,1);
});
test('original validated references survive post-response revocation but do not grant current verification',async t=>{
  const f=await prepared(t),key=randomUUID();f.hooks.after=(url,_method,_body,response)=>{if(url.pathname==='/invitees')f.store.update(f.actor.tenantId,C.connections,f.connection.id,{status:'disconnected',sealedTokens:null,authorizationGeneration:2});return response;};assert.equal((await f.book(f.choice,key)).statusCode,409);assert.equal((await f.operation(key)).json().status,'accepted');const n=f.requests.length;assert.equal((await f.verify(key)).statusCode,409);assert.equal(f.requests.length,n);const r=f.store.list(f.actor.tenantId,C.operations)[0];assert.equal(typeof r.sealedRemote,'string');
});
test('exception after reservation COMMIT leaves durable unknown, no provider POST and same-key no retry',async t=>{
  const f=await prepared(t),key=randomUUID(),original=f.store.transaction.bind(f.store);let thrown=false;f.store.transaction=((fn:any)=>{const value=original(fn);if(!thrown&&f.store.list(f.actor.tenantId,C.operations).some(r=>r.key===key)){thrown=true;throw Error('after committed reservation');}return value;}) as any;
  assert.equal((await f.book(f.choice,key)).statusCode,502);assert.equal((await f.operation(key)).json().status,'unknown');assert.equal(f.requests.filter(r=>r.url.endsWith('/invitees')).length,0);const n=f.requests.length;assert.equal((await f.book(f.choice,key)).json().replayed,true);assert.equal(f.requests.length,n);assert.equal((await f.book(f.choice,randomUUID())).statusCode,409);
});
test('exception immediately after accepted COMMIT never downgrades positive evidence',async t=>{
  const f=await prepared(t),key=randomUUID(),original=f.store.transaction.bind(f.store);let thrown=false;f.store.transaction=((fn:any)=>{const value=original(fn);if(!thrown&&f.store.list(f.actor.tenantId,C.operations).some(r=>r.key===key&&r.status==='accepted')){thrown=true;throw Error('after accepted COMMIT');}return value;}) as any;
  assert.equal((await f.book(f.choice,key)).statusCode,502);const r=(await f.operation(key)).json();assert.equal(r.status,'accepted');assert.equal(r.needsReconciliation,true);const n=f.requests.length;await f.book(f.choice,key);assert.equal(f.requests.length,n);assert.equal(f.remote.events.size,1);
});
for(const status of [400,429,500])test(`remote ${status} has no automatic POST retry and truthful terminal matrix`,async t=>{
  const f=await prepared(t),key=randomUUID();f.hooks.before=(url)=>url.pathname==='/invitees'?Response.json({error:'SECRET-REMOTE-MESSAGE'},{status}):undefined;await f.book(f.choice,key);const r=(await f.operation(key)).json();assert.equal(r.status,status<500?'failed':'unknown');assert.equal(r.needsReconciliation,status>=500);assert.equal(JSON.stringify(r).includes('SECRET-REMOTE-MESSAGE'),false);const n=f.requests.length;await f.book(f.choice,key);assert.equal(f.requests.length,n);assert.equal(f.requests.filter(r=>r.url.endsWith('/invitees')).length,1);
});
test('two types and connections for one remote host cannot bypass an uncertain overlapping reservation',async t=>{
  const f=await prepared(t),second=await f.connect(),typeId=randomUUID();f.remote.types.set(typeId,{...f.remote.type,uri:remoteUri('event_types',typeId),name:'Other type'});const action=await f.createAction(second.id,'private',true,typeId);f.toolRound(action);const chat=await f.askPrivate(),choice=chat.json().calendlyChoices[0];assert.ok(choice);f.hooks.after=(url,_method,_body,response)=>{if(url.pathname==='/invitees')throw Error('lost');return response;};await f.book(f.choice);const r=await f.book(choice);assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error.code,'calendly_slot_unavailable');assert.equal(f.remote.events.size,1);
});
test('verify 404 never means absence; authoritative cancellation is conflict, never new permission',async t=>{
  const f=await prepared(t),key=randomUUID();await f.book(f.choice,key);assert.equal((await f.verify(key)).json().status,'confirmed');f.hooks.before=url=>url.pathname.startsWith('/scheduled_events/')?Response.json({}, {status:404}):undefined;assert.equal((await f.verify(key)).statusCode,502);assert.equal((await f.operation(key)).json().status,'confirmed');f.hooks.before=undefined;for(const r of f.remote.events.values())r.status='canceled';assert.equal((await f.verify(key)).json().status,'conflict');assert.equal((await f.operation(key)).json().needsReconciliation,true);
});
test('verify rejects an invitee URI belonging to another event despite matching independent event field',async t=>{
  const f=await prepared(t),key=randomUUID();await f.book(f.choice,key);for(const i of f.remote.invitees.values())i.uri=i.uri.replace(/scheduled_events\/[^/]+\//,`scheduled_events/${randomUUID()}/`);
  const r=await f.verify(key);assert.equal(r.statusCode,502,r.body);assert.equal((await f.operation(key)).json().status,'accepted');assert.equal(f.remote.events.size,1);
});
test('authoritative rescheduled flag conflicts even if the remote status remains active',async t=>{
  const f=await prepared(t),key=randomUUID();await f.book(f.choice,key);for(const i of f.remote.invitees.values())i.rescheduled=true;
  const r=await f.verify(key);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().status,'conflict');assert.equal(r.json().reasonCode,'verification_conflict');
});
test('verification snapshot missing the rescheduled flag cannot claim confirmation',async t=>{
  const f=await prepared(t),key=randomUUID();await f.book(f.choice,key);for(const i of f.remote.invitees.values())delete i.rescheduled;
  assert.equal((await f.verify(key)).statusCode,502);assert.equal((await f.operation(key)).json().status,'accepted');assert.equal(f.remote.events.size,1);
});
test('concurrent local replay observes pending; another key cannot dispatch the same quote',async t=>{
  const f=await prepared(t),key=randomUUID();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),hold=new Promise<void>(r=>release=r);f.hooks.before=async url=>{if(url.pathname==='/invitees'){enter();await hold;}};const sending=f.book(f.choice,key);await entered;
  const before=f.requests.length;assert.equal((await f.operation(key)).json().status,'pending');assert.equal((await f.book(f.choice,key)).json().replayed,true);assert.equal(f.requests.length,before);assert.equal((await f.book(f.choice,randomUUID())).statusCode,409);release();assert.equal((await sending).statusCode,200);assert.equal(f.remote.events.size,1);
});
test('current action CAS and changed remote type reject before invitee dispatch',async t=>{
  const f=await prepared(t);f.remote.type.duration=60;const r=await f.book(f.choice);assert.equal(r.statusCode,409);assert.equal(f.requests.filter(r=>r.url.endsWith('/invitees')).length,0);assert.equal(f.store.list(f.actor.tenantId,C.operations).length,0);
});
test('Calendly public audience uses same executor without fabricated actor',async t=>{
  const f=await calendlyFixture(t),c=await f.connect(),a=await f.createAction(c.id,'webchat');f.toolRound(a);const s=await f.session(),chat=await f.publicRequest(s.token,'messages',{message:'Agendar',idempotencyKey:randomUUID()});assert.equal(chat.statusCode,200,chat.body);const choice=chat.json().calendlyChoices[0],key=randomUUID();
  const r=await f.publicRequest(s.token,'calendly-bookings',f.bookingBody(choice,key));assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.status,'accepted');const v=await f.publicRequest(s.token,'calendly-verify',{operationKey:key});assert.equal(v.statusCode,200,v.body);assert.equal(v.json().status,'confirmed');
});
