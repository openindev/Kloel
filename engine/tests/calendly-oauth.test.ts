import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { calendlyFixture } from './fixtures/calendly.js';
import { calendlyJson,accessToken } from '../src/calendly/oauth.js';
import { C } from '../src/calendly/schema.js';
const deferred=()=>{let resolve!:()=>void;return{promise:new Promise<void>(r=>resolve=r),get resolve(){return resolve;}};};

test('deadline bounds a noncooperative response body instead of waiting forever',async t=>{
  let controller!:ReadableStreamDefaultController<Uint8Array>;const originalFetch=globalThis.fetch,timeout=globalThis.setTimeout;
  t.after(()=>{globalThis.fetch=originalFetch;});t.mock.method(globalThis,'setTimeout',((fn:any,ms:any,...args:any[])=>timeout(fn,ms===15000?5:ms,...args)) as any);
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){controller=c;}}));
  const pending=calendlyJson('/users/me',{check:()=>{}}).then(()=>true,()=>true);let bounded=false;
  try{bounded=await Promise.race([pending,new Promise<boolean>(r=>timeout(()=>r(false),50))]);}finally{try{controller.close();}catch{}await pending;}
  assert.equal(bounded,true,'the total transport deadline must also bound body reading');
});

test('OAuth intent recovery, one-use state, original-session isolation and encrypted tokens',async t=>{
  const f=await calendlyFixture(t),key=randomUUID(),r=await f.request('POST',`${f.base}/oauth/start`,{expectedTenantId:f.actor.tenantId,idempotencyKey:key});assert.equal(r.statusCode,200,r.body);const intent=r.json(),get=await f.request('GET',`${f.base}/oauth/operations/${key}`);assert.equal(get.json().authorizationUrl,intent.authorizationUrl);assert.equal(intent.operationKey,key);assert.equal(f.requests.length,0);
  const state=new URL(intent.authorizationUrl).searchParams.get('state')!,url=`${f.base}/oauth/callback?code=synthetic&state=${state}`;
  const noCookie=await f.app.inject({method:'GET',url});assert.equal(noCookie.statusCode,409);assert.equal(f.requests.length,0);
  const ok=await f.app.inject({method:'GET',url,cookies:f.cookies});assert.equal(ok.statusCode,200,ok.body);const replay=await f.app.inject({method:'GET',url,cookies:f.cookies});assert.equal(replay.statusCode,409);assert.equal(f.requests.filter(r=>r.url.endsWith('/oauth/token')).length,1);
  const after=(await f.request('GET',`${f.base}/oauth/operations/${key}`)).json();assert.equal(after.status,'connected');assert.equal(after.authorizationUrl,null);assert.equal(JSON.stringify(f.store.list(f.actor.tenantId,C.connections)).includes('synthetic-access'),false);assert.equal(JSON.stringify(ok.json()).includes('synthetic-refresh'),false);
});
for(const scopes of ['', 'default', 'users:read event_types:read'])test(`insufficient/unverified scopes never become create consent: ${scopes||'empty'}`,async t=>{
  const f=await calendlyFixture(t);f.remote.scope=scopes;const c=await f.connect();assert.equal(c.status,'scope_unverified');const n=f.requests.length,r=await f.request('GET',`${f.base}/connections/${c.id}/event-types`);assert.equal(r.statusCode,403);assert.equal(f.requests.length,n);
});
test('OAuth organization ABA after token response invalidates state and prevents connection publication',async t=>{
  const f=await calendlyFixture(t),key=randomUUID(),r=await f.request('POST',`${f.base}/oauth/start`,{expectedTenantId:f.actor.tenantId,idempotencyKey:key}),state=new URL(r.json().authorizationUrl).searchParams.get('state');
  f.hooks.after=(url,_method,_body,response)=>{if(url.pathname==='/oauth/token'){f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(f.actor.tenantId);f.store.db.prepare("UPDATE organizations SET status='active' WHERE id=?").run(f.actor.tenantId);}return response;};
  const cb=await f.app.inject({method:'GET',url:`${f.base}/oauth/callback?code=synthetic&state=${state}`,cookies:f.cookies});assert.equal(cb.statusCode,409);assert.equal(f.store.list(f.actor.tenantId,C.connections).length,0);assert.equal(f.requests.filter(r=>r.url.endsWith('/users/me')).length,0);
});
test('two independent Stores share one durable refresh reservation and use only the successor',async t=>{
  const f=await calendlyFixture(t),c=await f.connect();f.store.update(f.actor.tenantId,C.connections,c.id,{expiresAt:0});const dir=mkdtempSync(join(tmpdir(),'calendly-refresh-')),file=join(dir,'controlled.sqlite');f.store.db.exec(`VACUUM INTO '${file.replaceAll("'","''")}'`);const a=new Store(file,{migrateMemberships:false}),b=new Store(file,{migrateMemberships:false});t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});
  const entered=deferred(),release=deferred();f.hooks.before=async(url,_method,body)=>{if(url.pathname==='/oauth/token'&&body.grant_type==='refresh_token'){entered.resolve();await release.promise;}};
  const first=accessToken(a,f.actor.tenantId,c.id,()=>{});await entered.promise;await assert.rejects(accessToken(b,f.actor.tenantId,c.id,()=>{}),(e:any)=>e.code==='calendly_reauthorization_required');release.resolve();const token=await first;assert.equal(await accessToken(b,f.actor.tenantId,c.id,()=>{}),token);assert.equal(f.requests.filter(r=>r.body?.grant_type==='refresh_token').length,1);assert.equal(a.get(f.actor.tenantId,C.connections,c.id)?.tokenVersion,2);
});
test('refresh transport loss after remote consumption never retries the used token',async t=>{
  const f=await calendlyFixture(t),c=await f.connect();f.store.update(f.actor.tenantId,C.connections,c.id,{expiresAt:0});f.hooks.after=(url,_method,body,response)=>{if(url.pathname==='/oauth/token'&&body.grant_type==='refresh_token')throw Error('lost response');return response;};
  const path=`${f.base}/connections/${c.id}/event-types`;assert.equal((await f.request('GET',path)).statusCode,502);const n=f.requests.length;assert.equal((await f.request('GET',path)).statusCode,409);assert.equal(f.requests.length,n);assert.equal(f.store.get(f.actor.tenantId,C.connections,c.id)?.status,'reauthorization_required');
});
test('catalog foreign host URI and unsupported complete type are not native booking authority',async t=>{
  const f=await calendlyFixture(t),c=await f.connect();f.remote.type.pooling_type='round_robin';const list=await f.request('GET',`${f.base}/connections/${c.id}/event-types`);assert.equal(list.statusCode,200);assert.equal(list.json().items[0].supported,false);assert.equal(list.json().items[0].unavailableReason,'unsupported_kind');f.remote.type.uri='https://attacker.test/event_types/'+f.remote.eventTypeId;assert.equal((await f.request('GET',`${f.base}/connections/${c.id}/event-types`)).statusCode,502);
});
test('disconnect during refresh does not let a late failure overwrite disconnected state',async t=>{
  const f=await calendlyFixture(t),c=await f.connect(),entered=deferred(),release=deferred();f.store.update(f.actor.tenantId,C.connections,c.id,{expiresAt:0});
  f.hooks.before=async(url,_method,body)=>{if(url.pathname==='/oauth/token'&&body.grant_type==='refresh_token'){entered.resolve();await release.promise;}};
  const pending=f.request('GET',`${f.base}/connections/${c.id}/event-types`);await entered.promise;
  const d=await f.request('POST',`${f.base}/connections/${c.id}/disconnect`,{expectedTenantId:f.actor.tenantId,idempotencyKey:randomUUID(),expectedRevision:1,confirm:true});assert.equal(d.statusCode,200,d.body);release.resolve();await pending;
  assert.equal(f.store.get(f.actor.tenantId,C.connections,c.id)?.status,'disconnected');
  assert.equal(f.store.get(f.actor.tenantId,C.connections,c.id)?.sealedTokens,null);
});
