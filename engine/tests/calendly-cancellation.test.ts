import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { C } from '../src/calendly/schema.js';
import { createCancellation } from '../src/calendly/cancellation.js';
import { calendlyJson,remoteUri } from '../src/calendly/oauth.js';
import { calendlyCancellationFixture } from './fixtures/calendly-cancellation.js';

const deferred=()=>{let resolve!:()=>void;return{promise:new Promise<void>(r=>resolve=r),get resolve(){return resolve;}};};
const prepared=async(t:any)=>{const f=await calendlyCancellationFixture(t);return{...f,...await f.prepare()};};
const rowFor=(f:any,key:string)=>f.store.list(f.actor.tenantId,C.cancellations).find((r:any)=>r.key===key)!;
const internalBody=(f:any,key:string,previousNotSentKey?:string)=>{const {expectedTenantId,...body}=f.cancelBody(f.bookingRef,key,previousNotSentKey);return body;};

test('private cancellation verifies original ownership, preserves creation hold and confirms only by explicit GET',async t=>{
  const f=await prepared(t),key=randomUUID(),creation=JSON.stringify(f.store.list(f.actor.tenantId,C.operations));f.requests.length=0;
  const r=await f.cancelOriginal(f.creationKey,f.bookingRef,key);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.status,'accepted');assert.equal(r.json().operation.effect,'http_accepted');assert.equal(r.json().operation.automaticRetry,false);
  assert.deepEqual(f.requests.map(r=>[r.method,new URL(r.url).pathname]),[['GET','/users/me'],['GET',`/event_types/${f.remote.eventTypeId}`],['GET',new URL(f.invitee.uri).pathname],['GET',new URL(f.event.uri).pathname],['POST',new URL(f.event.uri).pathname+'/cancellation']]);
  const read=(await f.cancellation(key)).json();assert.ok(read.attemptedAt);assert.ok(read.acceptedAt);assert.equal(read.verifiedAt,null);assert.equal(read.notifications,'provider_managed_unknown');
  for(const privateValue of [f.invitee.email,f.invitee.name,f.event.uri,f.remote.userId,'sealedSnapshot','laneHeld','executorId'])assert.equal(JSON.stringify(read).includes(privateValue),false);
  const v=await f.verifyCancellation(key);assert.equal(v.statusCode,200,v.body);assert.equal(v.json().status,'confirmed');assert.equal(v.json().effect,'cancellation_verified');assert.equal(v.json().needsReconciliation,false);
  assert.equal(JSON.stringify(f.store.list(f.actor.tenantId,C.operations)),creation);assert.equal(f.cancellationPosts().length,1);
  const n=f.requests.length;assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).json().replayed,true);assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,randomUUID())).statusCode,409);assert.equal(f.requests.length,n);
});
test('local original receipt, list and replay work after agent/action/connection/creation removal without I/O',async t=>{
  const f=await prepared(t),key=randomUUID();await f.cancelOriginal(f.creationKey,f.bookingRef,key);
  f.store.remove(f.actor.tenantId,'agents',f.agent.id);f.store.remove(f.actor.tenantId,C.actions,f.action.id);f.store.remove(f.actor.tenantId,C.connections,f.connection.id);f.store.remove(f.actor.tenantId,C.operations,f.row.id);
  const n=f.requests.length;assert.equal((await f.cancellation(key)).json().status,'accepted');assert.equal((await f.cancellations(f.creationKey)).json().items[0].key,key);assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).json().replayed,true);assert.equal(f.requests.length,n);
});
test('paused agent and inactive original event type do not prohibit explicit cleanup',async t=>{
  const f=await prepared(t);f.store.update(f.actor.tenantId,'agents',f.agent.id,{status:'paused'});f.store.update(f.actor.tenantId,C.actions,f.action.id,{enabled:false});f.remote.type.active=false;
  const r=await f.cancelOriginal(f.creationKey,f.bookingRef);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.status,'accepted');assert.equal(f.cancellationPosts().length,1);
});
test('already canceled exact solo event is confirmed without any cancellation dispatch',async t=>{
  const f=await prepared(t),key=randomUUID();f.event.status='canceled';f.event.invitees_counter.active=0;f.invitee.status='canceled';
  const r=await f.cancelOriginal(f.creationKey,f.bookingRef,key);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.status,'confirmed');assert.equal(r.json().operation.reasonCode,'already_canceled');assert.equal(r.json().operation.attemptedAt,null);assert.equal(r.json().operation.acceptedAt,null);assert.equal(f.cancellationPosts().length,0);
});
for(const [name,mutate] of [
  ['another host',(f:any)=>{f.event.event_memberships[0].user=remoteUri('users',randomUUID());}],
  ['group type',(f:any)=>{f.remote.type.kind='group';}],
  ['pooled type',(f:any)=>{f.remote.type.pooling_type='round_robin';}],
  ['two memberships',(f:any)=>{f.event.event_memberships.push({...f.event.event_memberships[0]});}],
  ['guest',(f:any)=>{f.event.event_guests=[{email:'guest@example.test'}];}],
  ['counter ambiguity',(f:any)=>{f.event.invitees_counter.total=2;}],
  ['missing counters',(f:any)=>{delete f.event.invitees_counter;}],
  ['invitee URI parent',(f:any)=>{f.invitee.uri=f.invitee.uri.replace(f.event.uri,remoteUri('scheduled_events',randomUUID()));}],
  ['different interval',(f:any)=>{f.event.start_time=new Date(Date.parse(f.event.start_time)+60000).toISOString();}],
  ['rescheduled',(f:any)=>{f.invitee.rescheduled=true;}],
  ['different invitee',(f:any)=>{f.invitee.email='other@example.test';}],
  ['different type owner',(f:any)=>{f.remote.type.profile.owner=remoteUri('users',randomUUID());}],
] as const)test(`preflight rejects ${name} before POST and closes not_sent with original lane held`,async t=>{
  const f=await prepared(t),key=randomUUID();mutate(f);const r=await f.cancelOriginal(f.creationKey,f.bookingRef,key);assert.ok([409,502].includes(r.statusCode),r.body);
  const get=(await f.cancellation(key)).json();assert.equal(get.status,'not_sent');assert.equal(get.attemptedAt,null);assert.equal(get.acceptedAt,null);assert.equal(get.needsReconciliation,false);assert.equal(rowFor(f,key).phase,'closed');assert.equal(rowFor(f,key).laneHeld,true);assert.equal(f.cancellationPosts().length,0);
});
test('strict body, original bookingRef, four headers and original session are required before I/O',async t=>{
  const f=await prepared(t),key=randomUUID(),path=`${f.base}/operations/${f.creationKey}/cancellations`,n=f.requests.length;
  for(const extra of [{reason:'free text'},{eventId:randomUUID()},{connectionId:f.connection.id},{confirm:false}])assert.equal((await f.request('POST',path,{...f.cancelBody(f.bookingRef,key),...extra})).statusCode,400);
  assert.equal((await f.cancelOriginal(f.creationKey,randomUUID(),key)).statusCode,409);
  assert.equal((await f.request('POST',path,f.cancelBody(f.bookingRef,key),{})).statusCode,400);assert.equal(f.requests.length,n);assert.equal(f.store.list(f.actor.tenantId,C.cancellations).length,0);
});
test('preflight GET failure permits only explicit atomic not_sent successor; old receipt never observes successor effect',async t=>{
  const f=await prepared(t),first=randomUUID();f.cancelHooks.before=url=>url.pathname==='/users/me'?Response.json({}, {status:503}):undefined;
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,first)).statusCode,503);assert.equal((await f.cancellation(first)).json().status,'not_sent');
  const n=f.requests.length;assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,randomUUID())).statusCode,409);assert.equal((await f.verifyCancellation(first)).json().status,'not_sent');assert.equal(f.requests.length,n);
  f.cancelHooks.before=undefined;const second=randomUUID(),r=await f.cancelOriginal(f.creationKey,f.bookingRef,second,first);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.status,'accepted');assert.equal(rowFor(f,first).laneHeld,false);assert.equal(rowFor(f,first).successorKey,second);
  const after=f.requests.length;assert.equal((await f.verifyCancellation(first)).json().status,'not_sent');assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,first)).json().operation.status,'not_sent');assert.equal((await f.cancellations(f.creationKey)).json().items.length,2);assert.equal(f.requests.length,after);assert.equal(f.cancellationPosts().length,1);
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,second)).statusCode,409,'same key cannot omit its original predecessor');
});
test('two Stores compete for a single explicit successor and losing invocation performs zero I/O',async t=>{
  const f=await prepared(t),first=randomUUID();f.cancelHooks.before=url=>url.pathname==='/users/me'?Response.json({}, {status:503}):undefined;await f.cancelOriginal(f.creationKey,f.bookingRef,first);f.cancelHooks.before=undefined;
  const dir=mkdtempSync(join(tmpdir(),'calendly-cancellation-')),file=join(dir,'controlled.sqlite');f.store.db.exec(`VACUUM INTO '${file.replaceAll("'","''")}'`);const a=new Store(file,{migrateMemberships:false}),b=new Store(file,{migrateMemberships:false});t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});
  const entered=deferred(),release=deferred();f.cancelHooks.before=async url=>{if(url.pathname==='/users/me'){entered.resolve();await release.promise;}};
  const key=randomUUID(),sending=createCancellation(a,f.audience(a),f.creationKey,internalBody(f,key,first));await entered.promise;const n=f.requests.length;
  await assert.rejects(createCancellation(b,f.audience(b),f.creationKey,internalBody(f,randomUUID(),first)),(e:any)=>e.code==='calendly_cancellation_unresolved');assert.equal(f.requests.length,n);
  release.resolve();assert.equal((await sending).operation.status,'accepted');assert.equal(b.list(f.actor.tenantId,C.cancellations).filter(r=>r.laneHeld===true).length,1);assert.equal(f.cancellationPosts().length,1);
});
test('reservation COMMIT loss stays unknown with null attemptedAt and cannot be released as not_sent',async t=>{
  const f=await prepared(t),key=randomUUID(),transaction=f.store.transaction.bind(f.store);let thrown=false;
  f.store.transaction=((fn:any)=>{const v=transaction(fn);if(!thrown&&rowFor(f,key)){thrown=true;throw Error('controlled after reservation COMMIT');}return v;}) as any;
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).statusCode,502);const r=(await f.cancellation(key)).json();assert.equal(r.status,'unknown');assert.equal(r.attemptedAt,null);assert.equal(rowFor(f,key).phase,'preflight');
  const n=f.requests.length;assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,randomUUID(),key)).statusCode,409);assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).json().replayed,true);assert.equal(f.requests.length,n);assert.equal(f.cancellationPosts().length,0);
});
test('successor transaction rollback preserves predecessor lane and no second receipt',async t=>{
  const f=await prepared(t),first=randomUUID();f.cancelHooks.before=url=>url.pathname==='/users/me'?Response.json({}, {status:503}):undefined;await f.cancelOriginal(f.creationKey,f.bookingRef,first);f.cancelHooks.before=undefined;
  const create=f.store.create.bind(f.store);f.store.create=((tenant:string,collection:string,data:any)=>{if(collection===C.cancellations)throw Error('controlled insertion failure');return create(tenant,collection,data);}) as any;
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,randomUUID(),first)).statusCode,502);assert.equal(rowFor(f,first).laneHeld,true);assert.equal(rowFor(f,first).successorKey,null);assert.equal(f.store.list(f.actor.tenantId,C.cancellations).length,1);assert.equal(f.cancellationPosts().length,0);
});
test('successor COMMIT loss retains both histories and the new lane without resuming either intention',async t=>{
  const f=await prepared(t),first=randomUUID(),second=randomUUID();f.cancelHooks.before=url=>url.pathname==='/users/me'?Response.json({}, {status:503}):undefined;await f.cancelOriginal(f.creationKey,f.bookingRef,first);f.cancelHooks.before=undefined;
  const transaction=f.store.transaction.bind(f.store);let thrown=false;f.store.transaction=((fn:any)=>{const value=transaction(fn);if(!thrown&&rowFor(f,second)){thrown=true;throw Error('controlled successor COMMIT loss');}return value;}) as any;
  const n=f.requests.length;assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,second,first)).statusCode,502);assert.equal((await f.cancellation(second)).json().status,'unknown');assert.equal(rowFor(f,first).status,'not_sent');assert.equal(rowFor(f,first).laneHeld,false);assert.equal(rowFor(f,first).successorKey,second);assert.equal(rowFor(f,second).laneHeld,true);
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,second,first)).json().replayed,true);assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,randomUUID(),second)).statusCode,409);assert.equal(f.requests.length,n);assert.equal(f.cancellationPosts().length,0);
});
for(const [name,fields] of [
  ['open phase',{phase:'preflight'}],['attempt exists',{attemptedAt:'2026-10-19T00:00:00.000Z'}],['semantic mismatch',{semanticFingerprint:'0'.repeat(64)}],['unknown with null attempt',{status:'unknown'}],['pending with null attempt',{status:'pending'}],['prior successor',{successorKey:'11111111-1111-4111-8111-111111111111'}],
] as const)test(`not_sent succession rejects ${name} without I/O or releasing its lane`,async t=>{
  const f=await prepared(t),key=randomUUID();f.cancelHooks.before=url=>url.pathname==='/users/me'?Response.json({}, {status:503}):undefined;await f.cancelOriginal(f.creationKey,f.bookingRef,key);f.cancelHooks.before=undefined;
  f.store.update(f.actor.tenantId,C.cancellations,rowFor(f,key).id,fields);const n=f.requests.length;
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,randomUUID(),key)).statusCode,409);assert.equal(rowFor(f,key).laneHeld,true);assert.equal(f.store.list(f.actor.tenantId,C.cancellations).length,1);assert.equal(f.requests.length,n);
});
test('stale preflight continuation cannot dispatch after its own phase has closed and successor holds lane',async t=>{
  const f=await prepared(t),key=randomUUID(),entered=deferred(),release=deferred();let held=false;
  f.cancelHooks.before=async url=>{if(!held&&url.pathname==='/users/me'){held=true;entered.resolve();await release.promise;}};
  const old=f.cancelOriginal(f.creationKey,f.bookingRef,key);await entered.promise;
  // Controlled scheduler fault: persist the exact closed-not-sent state while retaining an old continuation.
  const oldRow=rowFor(f,key);f.store.update(f.actor.tenantId,C.cancellations,oldRow.id,{status:'not_sent',phase:'closed',reasonCode:'verification_unavailable'});
  const second=randomUUID(),next=await f.cancelOriginal(f.creationKey,f.bookingRef,second,key);assert.equal(next.statusCode,200,next.body);assert.equal(f.cancellationPosts().length,1);
  release.resolve();assert.equal((await old).statusCode,409);assert.equal((await f.cancellation(key)).json().status,'not_sent');assert.equal(f.cancellationPosts().length,1);
});
test('attempt is marked after token retrieval and synchronously before transport; post-COMMIT throw cannot retry',async t=>{
  const f=await prepared(t),key=randomUUID(),transaction=f.store.transaction.bind(f.store);let thrown=false;
  f.store.transaction=((fn:any)=>{const v=transaction(fn);if(!thrown&&rowFor(f,key)?.attemptedAt){thrown=true;throw Error('controlled dispatch COMMIT loss');}return v;}) as any;
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).statusCode,502);assert.equal((await f.cancellation(key)).json().status,'unknown');assert.ok((await f.cancellation(key)).json().attemptedAt);assert.equal(f.cancellationPosts().length,0);
  const n=f.requests.length;await f.cancelOriginal(f.creationKey,f.bookingRef,key);assert.equal(f.requests.length,n);
});
test('refresh before final POST still has null attempt; loss cannot authorize a cancellation POST',async t=>{
  const f=await prepared(t),key=randomUUID();let refreshed=false;
  f.cancelHooks.after=(url,_method,body,response)=>{
    if(url.pathname===new URL(f.event.uri).pathname)f.store.update(f.actor.tenantId,C.connections,f.connection.id,{expiresAt:0});
    if(url.pathname==='/oauth/token'&&body.grant_type==='refresh_token'){refreshed=true;assert.equal(rowFor(f,key).attemptedAt,null);throw Error('controlled refresh loss');}
    return response;
  };
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).statusCode,502);assert.equal(refreshed,true);assert.equal((await f.cancellation(key)).json().status,'not_sent');assert.equal(f.cancellationPosts().length,0);
});
test('HTTP201 is durably accepted while body is held; local GET works and late revocation cannot erase it',async t=>{
  const f=await prepared(t),key=randomUUID(),entered=deferred(),transaction=f.store.transaction.bind(f.store);let controller!:ReadableStreamDefaultController<Uint8Array>;
  f.store.transaction=((fn:any)=>{const value=transaction(fn);if(rowFor(f,key)?.status==='accepted')entered.resolve();return value;}) as any;
  f.cancelHooks.after=(url,_method,_body,response)=>{if(url.pathname.endsWith('/cancellation'))return new Response(new ReadableStream({start(c){controller=c;}}),{status:201});return response;};
  const sending=f.cancelOriginal(f.creationKey,f.bookingRef,key);await entered.promise;
  const n=f.requests.length,read=(await f.cancellation(key)).json();assert.equal(read.status,'accepted');assert.ok(read.acceptedAt);assert.equal(f.requests.length,n);assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).json().replayed,true);
  f.store.update(f.actor.tenantId,C.connections,f.connection.id,{status:'disconnected',sealedTokens:null,authorizationGeneration:2});controller.enqueue(new TextEncoder().encode('{"resource":{}}'));controller.close();assert.equal((await sending).statusCode,409);
  assert.equal((await f.cancellation(key)).json().status,'accepted');assert.equal(f.cancellationPosts().length,1);
});
test('exception after accepted COMMIT and invalid response never downgrade positive evidence',async t=>{
  const f=await prepared(t),key=randomUUID(),transaction=f.store.transaction.bind(f.store);let thrown=false;
  f.store.transaction=((fn:any)=>{const v=transaction(fn);if(!thrown&&rowFor(f,key)?.status==='accepted'){thrown=true;throw Error('controlled accepted COMMIT loss');}return v;}) as any;
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).statusCode,502);assert.equal((await f.cancellation(key)).json().status,'accepted');assert.equal(f.cancellationPosts().length,1);
});
test('malformed cancellation acknowledgement preserves accepted and sanitized reason',async t=>{
  const f=await prepared(t),key=randomUUID();f.cancelHooks.after=(url,_method,_body,response)=>url.pathname.endsWith('/cancellation')?new Response('SECRET INVALID BODY',{status:201}):response;
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).statusCode,502);const r=(await f.cancellation(key)).json();assert.equal(r.status,'accepted');assert.equal(r.reasonCode,'provider_response_invalid');assert.equal(JSON.stringify(r).includes('SECRET'),false);assert.equal(f.cancellationPosts().length,1);
});
for(const status of [400,401,429,500])test(`cancellation HTTP${status} is never retried and cannot free the lane`,async t=>{
  const f=await prepared(t),key=randomUUID();f.cancelHooks.before=url=>url.pathname.endsWith('/cancellation')?Response.json({message:'SECRET REMOTE'},{status}):undefined;
  await f.cancelOriginal(f.creationKey,f.bookingRef,key);const r=(await f.cancellation(key)).json();assert.equal(r.status,status<500?'failed':'unknown');assert.equal(r.effect,status<500?'provider_rejected':'unconfirmed');assert.equal(JSON.stringify(r).includes('SECRET'),false);const n=f.requests.length;
  await f.cancelOriginal(f.creationKey,f.bookingRef,key);assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,randomUUID(),key)).statusCode,409);assert.equal(f.requests.length,n);assert.equal(f.cancellationPosts().length,1);
});
test('lost POST reply remains unknown, verifies original cancellation and never releases creation hold',async t=>{
  const f=await prepared(t),key=randomUUID(),original=JSON.stringify(f.store.list(f.actor.tenantId,C.operations));f.cancelHooks.after=(url,_method,_body,response)=>{if(url.pathname.endsWith('/cancellation'))throw Error('controlled network loss');return response;};
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).statusCode,502);assert.equal((await f.cancellation(key)).json().status,'unknown');f.cancelHooks.after=undefined;
  assert.equal((await f.verifyCancellation(key)).json().status,'confirmed');assert.equal(JSON.stringify(f.store.list(f.actor.tenantId,C.operations)),original);assert.equal(f.cancellationPosts().length,1);
});
test('verification GET404 and malformed evidence preserve confirmed; active original becomes explicit conflict',async t=>{
  const f=await prepared(t),key=randomUUID();await f.cancelOriginal(f.creationKey,f.bookingRef,key);assert.equal((await f.verifyCancellation(key)).json().status,'confirmed');
  f.cancelHooks.before=url=>url.pathname.startsWith('/scheduled_events/')?Response.json({}, {status:404}):undefined;assert.equal((await f.verifyCancellation(key)).statusCode,502);assert.equal((await f.cancellation(key)).json().status,'confirmed');f.cancelHooks.before=undefined;
  delete f.event.invitees_counter;assert.equal((await f.verifyCancellation(key)).statusCode,502);assert.equal((await f.cancellation(key)).json().status,'confirmed');
  f.event.invitees_counter={total:1,active:1,limit:1};f.event.status='active';f.invitee.status='active';const v=await f.verifyCancellation(key);assert.equal(v.statusCode,200,v.body);assert.equal(v.json().status,'conflict');assert.equal(v.json().reasonCode,'verification_conflict');assert.equal(f.cancellationPosts().length,1);
});
test('organization ABA during preflight prevents POST while keeping original not_sent receipt',async t=>{
  const f=await prepared(t),key=randomUUID();let changed=false;f.cancelHooks.after=(url,_method,_body,response)=>{if(!changed&&url.pathname==='/users/me'){changed=true;f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(f.actor.tenantId);f.store.db.prepare("UPDATE organizations SET status='active' WHERE id=?").run(f.actor.tenantId);}return response;};
  assert.equal((await f.cancelOriginal(f.creationKey,f.bookingRef,key)).statusCode,409);assert.equal((await f.cancellation(key)).json().status,'not_sent');assert.equal(f.cancellationPosts().length,0);
});
test('changed session authority cannot disclose original receipt or adopt its not_sent successor',async t=>{
  const f=await prepared(t),key=randomUUID();f.cancelHooks.before=url=>url.pathname==='/users/me'?Response.json({}, {status:503}):undefined;await f.cancelOriginal(f.creationKey,f.bookingRef,key);f.cancelHooks.before=undefined;f.aba();
  assert.equal((await f.cancellation(key)).statusCode,409);const newHeaders=await f.freshHeaders();const n=f.requests.length;
  assert.equal((await f.request('GET',`${f.base}/cancellation-operations/${key}`,undefined,newHeaders)).statusCode,404);
  assert.ok([404,409].includes((await f.request('POST',`${f.base}/operations/${f.creationKey}/cancellations`,f.cancelBody(f.bookingRef,randomUUID(),key),newHeaders)).statusCode));assert.equal(f.requests.length,n);
});
test('same-key body mismatch and lane sharing across copied creation references fail closed',async t=>{
  const f=await prepared(t),key=randomUUID();await f.cancelOriginal(f.creationKey,f.bookingRef,key);const n=f.requests.length;
  assert.equal((await f.cancelOriginal(f.creationKey,randomUUID(),key)).statusCode,409);
  // No route adopts a remote event by UUID; even a synthetic duplicate original cannot bypass the event lane.
  const copy=f.store.create(f.actor.tenantId,C.operations,{...f.row,key:randomUUID(),bookingRef:randomUUID()});assert.notEqual(copy.id,f.row.id);
  assert.equal((await f.cancelOriginal(String(copy.key),String(copy.bookingRef),randomUUID())).statusCode,502,'sealed original references cannot be adopted under another receipt AAD');assert.equal(f.requests.length,n);
});
test('transport admits only exact cancellation POST path and invokes final fence before fetch',async t=>{
  const fetch=globalThis.fetch;let calls=0;t.after(()=>{globalThis.fetch=fetch;});globalThis.fetch=async()=>{calls++;return Response.json({resource:{}},{status:201});};
  const path=`/scheduled_events/${randomUUID()}/cancellation`;
  for(const [method,url] of [['GET',path],['POST',path+'?x=1'],['POST',path+'/'],['POST',path.replace('/cancellation','/invitees')]] as const)await assert.rejects(calendlyJson(url,{method,check:()=>{}}));
  await assert.rejects(calendlyJson(path,{method:'POST',check:()=>{},beforeDispatch:()=>{throw Error('final fence rejected');}}));assert.equal(calls,0);
  let marked=false;globalThis.fetch=async()=>{assert.equal(marked,true);calls++;return Response.json({resource:{}},{status:201});};await calendlyJson(path,{method:'POST',check:()=>{},beforeDispatch:()=>{marked=true;}});assert.equal(calls,1);
});
