import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { registerAuth } from '../src/auth.js';
import { registerOAuth } from '../src/oauth.js';
import { Store } from '../src/store.js';
import { digest, seal, unseal } from '../src/oauth/crypto.js';
import { seedMember } from './fixtures/membership.js';
import { roleSchema } from '../src/memberships/permissions.js';

const envNames=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','MICROSOFT_CLIENT_ID','MICROSOFT_CLIENT_SECRET','MICROSOFT_TENANT_ID','OAUTH_ENCRYPTION_KEY','PUBLIC_BASE_URL'];
async function setup(t:any, configured=true) {
  const previous=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));
  t.after(()=>{for(const [n,v] of Object.entries(previous))if(v===undefined)delete process.env[n];else process.env[n]=v;});
  for(const n of envNames)delete process.env[n];
  if(configured){process.env.GOOGLE_CLIENT_ID='google-test';process.env.GOOGLE_CLIENT_SECRET='test-google-secret';process.env.MICROSOFT_CLIENT_ID='microsoft-test';process.env.MICROSOFT_CLIENT_SECRET='test-microsoft-secret';process.env.OAUTH_ENCRYPTION_KEY=randomBytes(32).toString('base64');}
  const store=new Store();
  const app=Fastify();
  await app.register(cookie);
  app.setErrorHandler((e,_req,reply)=>reply.code(e instanceof z.ZodError?400:500).send({error:'invalid'}));
  await registerAuth(app,store);
  await registerOAuth(app,store);
  t.after(async()=>{await app.close();store.close();});
  function user(tenantId=randomUUID(),role='owner') {
    const userId=randomUUID(),session=randomBytes(32).toString('hex');
    seedMember(store,{userId,tenantId,role:roleSchema.parse(role)});
    store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(digest(session),userId,Date.now()+3600000,tenantId);
    return {userId,tenantId,cookies:{kloel_session:session}};
  }
  const actor=user();
  return {app,store,actor,user};
}
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
const token=(scope:string,extras={})=>({access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'Bearer',expires_in:3600,scope,...extras});
async function start(app:any,actor:any,provider='google',capabilities=['calendar','email'],visibility='personal') {
  const r=await app.inject({method:'POST',url:`/api/v1/oauth/${provider}/start`,cookies:actor.cookies,payload:{capabilities,visibility}});
  assert.equal(r.statusCode,200,r.body);
  const url=new URL(r.json().authorizationUrl);
  return {url,state:url.searchParams.get('state')!,scope:url.searchParams.get('scope')!};
}
const callback=(app:any,actor:any,state:string,provider='google',extra='code=test-code')=>app.inject({url:`/api/v1/oauth/${provider}/callback?state=${encodeURIComponent(state)}&${extra}`,cookies:actor.cookies});

test('OAuth authorization, capability replacement, revocation and reconnect advance the public generation',async t=>{
  const {app,actor}=await setup(t);let begin=await start(app,actor,'google',['email']);
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async url=>String(url).endsWith('/token')?json(token(begin.scope)):json({sub:'same-remote',email:'fixture@example.test'});
  let done=await callback(app,actor,begin.state);assert.equal(done.statusCode,200,done.body);
  const id=done.json().connection.id;assert.equal(done.json().connection.authorizationGeneration,1);
  begin=await start(app,actor,'google',['email','email_send']);done=await callback(app,actor,begin.state);
  assert.equal(done.statusCode,200,done.body);assert.equal(done.json().connection.id,id);assert.equal(done.json().connection.authorizationGeneration,2);
  const revoked=await app.inject({method:'DELETE',url:`/api/v1/oauth/connections/${id}`,cookies:actor.cookies});
  assert.equal(revoked.statusCode,200);assert.equal(revoked.json().authorizationGeneration,3);
  begin=await start(app,actor,'google',['email']);done=await callback(app,actor,begin.state);
  assert.equal(done.statusCode,200,done.body);assert.equal(done.json().connection.id,id);assert.equal(done.json().connection.authorizationGeneration,4);
});

test('OAuth callback follows selected session organization instead of legacy identity home',async t=>{
  const {app,store,actor}=await setup(t),tenantId=randomUUID();
  seedMember(store,{userId:actor.userId,tenantId,role:'owner'});
  store.db.prepare('UPDATE sessions SET tenant_id=? WHERE hash=?').run(tenantId,digest(actor.cookies.kloel_session));
  const begin=await start(app,actor),original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async url=>String(url).endsWith('/token')?json(token(begin.scope)):json({sub:'second-org-remote',email:'fixture@example.test'});
  const done=await callback(app,actor,begin.state);assert.equal(done.statusCode,200,done.body);
  assert.equal(store.list(actor.tenantId,'oauth-connections').length,0);assert.equal(store.list(tenantId,'oauth-connections').length,1);
});

test('OAuth callback refuses a membership revoked during provider authorization',async t=>{
  const {app,store,actor}=await setup(t),begin=await start(app,actor),original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async url=>{
    if(String(url).endsWith('/token'))return json(token(begin.scope));
    store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(actor.userId,actor.tenantId);
    return json({sub:'revoked-remote',email:'fixture@example.test'});
  };
  const done=await callback(app,actor,begin.state);assert.equal(done.statusCode,403);assert.equal(done.json().error.code,'oauth_session_mismatch');
  assert.equal(store.list(actor.tenantId,'oauth-connections').length,0);
});

test('Viewer, builder and editor cannot connect personal OAuth accounts using legacy owner role',async t=>{
  const {app,store,actor}=await setup(t);
  for(const role of ['viewer','builder','editor']){
    store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run(role,actor.userId,actor.tenantId);
    const denied=await app.inject({method:'POST',url:'/api/v1/oauth/google/start',cookies:actor.cookies,payload:{capabilities:['email']}});
    assert.equal(denied.statusCode,403,denied.body);
  }
  assert.equal(store.list(actor.tenantId,'oauth-states').length,0);
});

test('OAuth rechecks current capability after token refresh before reading private mail',async t=>{
  const {app,store,actor}=await setup(t),scope='https://www.googleapis.com/auth/gmail.readonly';
  const c=store.create(actor.tenantId,'oauth-connections',{provider:'google',userId:actor.userId,visibility:'personal',status:'connected',capabilities:['email'],scopes:scope});
  store.update(actor.tenantId,'oauth-connections',c.id,{encryptedTokens:seal({accessToken:'expired',refreshToken:'fixture-refresh',expiresAt:0,scope},`${c.tenantId}:${c.id}:google:tokens`)});
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
  globalThis.fetch=async url=>{
    calls++;assert.ok(String(url).endsWith('/token'));
    store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('viewer',actor.userId,actor.tenantId);
    return json(token(scope));
  };
  const read=await app.inject({url:`/api/v1/oauth/connections/${c.id}/messages`,cookies:actor.cookies});
  assert.equal(read.statusCode,403);assert.equal(read.json().error.code,'forbidden');assert.equal(calls,1);
});

test('OAuth missing configuration is 503, start requires auth, shared start requires admin',async t=>{
  const {app,actor,user}=await setup(t,false);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/oauth/google/start',payload:{capabilities:['calendar']}})).statusCode,401);
  const missing=await app.inject({method:'POST',url:'/api/v1/oauth/google/start',cookies:actor.cookies,payload:{capabilities:['calendar']}});
  assert.equal(missing.statusCode,503);assert.equal(missing.json().error.code,'integration_not_configured');
  const member=user(actor.tenantId,'member');
  assert.equal((await app.inject({method:'POST',url:'/api/v1/oauth/google/start',cookies:member.cookies,payload:{capabilities:['email'],visibility:'shared'}})).statusCode,403);
  const status=await app.inject({url:'/api/v1/oauth/status',cookies:actor.cookies});
  assert.ok(status.json().providers.every((p:any)=>p.status==='not_configured'));
});

test('Google PKCE callback binds original session; consumes once; encrypts and isolates tokens',async t=>{
  const {app,store,actor,user}=await setup(t);
  const other=user(),sameTenant=user(actor.tenantId);
  const begin=await start(app,actor);
  assert.equal(begin.url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(begin.url.searchParams.get('access_type'),'offline');
  let requests=0;
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(input,init)=>{
    requests++;
    if(String(input).endsWith('/token')){
      const body=init!.body as URLSearchParams;
      assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),begin.url.searchParams.get('code_challenge'));
      assert.equal(body.get('redirect_uri'),'http://127.0.0.1:4310/api/v1/oauth/google/callback');
      return json(token(begin.scope));
    }
    assert.equal(String(input),'https://openidconnect.googleapis.com/v1/userinfo');
    return json({sub:'provider-user',email:'fixture@example.test'});
  };
  assert.equal((await callback(app,other,begin.state)).statusCode,403);
  assert.equal((await callback(app,sameTenant,begin.state)).statusCode,403);
  assert.equal(requests,0);
  const finish=await callback(app,actor,begin.state);
  assert.equal(finish.statusCode,200,finish.body);
  assert.equal(requests,2);assert.equal(finish.body.includes('test-access-token'),false);
  const id=finish.json().connection.id;
  const saved=store.get(actor.tenantId,'oauth-connections',id)!;
  assert.equal(JSON.stringify(saved).includes('test-access-token'),false);
  assert.equal(JSON.stringify(saved).includes('test-refresh-token'),false);
  const decrypted=unseal<any>(String(saved.encryptedTokens),`${actor.tenantId}:${id}:google:tokens`);
  assert.equal(decrypted.accessToken,'test-access-token');
  assert.throws(()=>unseal(String(saved.encryptedTokens),`${other.tenantId}:${id}:google:tokens`));
  assert.equal((await callback(app,actor,begin.state)).statusCode,400);
  assert.equal((await app.inject({url:`/api/v1/oauth/connections/${id}/calendars`,cookies:other.cookies})).statusCode,404);
  assert.equal((await app.inject({url:`/api/v1/oauth/connections/${id}/calendars`,cookies:sameTenant.cookies})).statusCode,404);
  const list=await app.inject({url:'/api/v1/oauth/connections',cookies:actor.cookies});
  assert.equal(list.body.includes('encryptedTokens'),false);assert.equal(list.json().items.length,1);
});

test('OAuth rejects expired, tampered, mixed-provider and logged-out state',async t=>{
  const {app,store,actor}=await setup(t);
  const begin=await start(app,actor);
  assert.equal((await callback(app,actor,begin.state,'microsoft')).statusCode,400);
  assert.equal((await callback(app,actor,begin.state.slice(0,-5)+'AAAAA')).statusCode,400);
  const s=store.list(actor.tenantId,'oauth-states')[0];
  store.update(actor.tenantId,'oauth-states',s.id,{expiresAt:Date.now()-1});
  assert.equal((await callback(app,actor,begin.state)).json().error.code,'oauth_state_expired');
  const next=await start(app,actor);
  store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(actor.cookies.kloel_session));
  assert.equal((await callback(app,actor,next.state)).statusCode,403);
});

test('OAuth denial consumes state and partial consent never creates a connection',async t=>{
  const {app,store,actor}=await setup(t);
  const begin=await start(app,actor);
  assert.equal((await callback(app,actor,begin.state,'google','error=access_denied')).json().error.code,'oauth_consent_denied');
  assert.equal((await callback(app,actor,begin.state)).statusCode,400);
  const second=await start(app,actor);
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>json(token('openid email'));
  assert.equal((await callback(app,actor,second.state)).json().error.code,'oauth_scope_missing');
  assert.equal(store.list(actor.tenantId,'oauth-connections').length,0);
});

test('Microsoft read endpoints use Graph, renew tokens, preserve encryption and clear on disconnect',async t=>{
  const {app,store,actor}=await setup(t);
  const begin=await start(app,actor,'microsoft');
  const calls:Array<{url:string;method:string;authorization?:string}>=[];
  let refreshed=false;
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(input,init)=>{
    const url=String(input);calls.push({url,method:init?.method||'GET',authorization:(init?.headers as any)?.Authorization});
    if(url.includes('/token')){
      const form=init!.body as URLSearchParams;
      if(form.get('grant_type')==='refresh_token'){refreshed=true;assert.equal(form.get('refresh_token'),'test-refresh-token');return json(token(begin.scope,{access_token:'refreshed-access',refresh_token:'rotated-refresh'}));}
      return json(token(begin.scope,{expires_in:1}));
    }
    if(url.includes('/me?$select'))return json({id:'ms-user',mail:'fixture@example.test'});
    if(url.includes('/messages/'))return json({id:'message-1',body:{contentType:'text',content:'Test fixture'}});
    if(url.includes('/messages'))return json({value:[{id:'message-1',subject:'Test'}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/messages?$skip=20'});
    return json({value:[{id:'calendar-1',name:'Primary'}]});
  };
  const done=await callback(app,actor,begin.state,'microsoft');assert.equal(done.statusCode,200,done.body);
  const id=done.json().connection.id;
  const calendars=await app.inject({url:`/api/v1/oauth/connections/${id}/calendars`,cookies:actor.cookies});
  assert.equal(calendars.statusCode,200,calendars.body);assert.equal(refreshed,true);assert.equal(calendars.json().items[0].id,'calendar-1');
  const events=await app.inject({url:`/api/v1/oauth/connections/${id}/events?from=2026-10-18T00:00:00Z&to=2026-10-19T00:00:00Z`,cookies:actor.cookies});
  assert.equal(events.statusCode,200,events.body);
  const messages=await app.inject({url:`/api/v1/oauth/connections/${id}/messages`,cookies:actor.cookies});
  assert.equal(messages.statusCode,200,messages.body);
  const cursor=messages.json().nextPageToken;
  assert.deepEqual(JSON.parse(Buffer.from(cursor,'base64url').toString()),{parameter:'$skip',value:'20'});
  const nextPage=await app.inject({url:`/api/v1/oauth/connections/${id}/messages?pageToken=${encodeURIComponent(cursor)}`,cookies:actor.cookies});
  assert.equal(nextPage.statusCode,200);
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get('$skip'),'20');
  const badCursor=Buffer.from(JSON.stringify({parameter:'url',value:'https://evil.example'})).toString('base64url');
  assert.equal((await app.inject({url:`/api/v1/oauth/connections/${id}/messages?pageToken=${badCursor}`,cookies:actor.cookies})).statusCode,400);
  assert.equal((await app.inject({url:`/api/v1/oauth/connections/${id}/messages/message-1`,cookies:actor.cookies})).json().untrustedContent,true);
  assert.ok(calls.filter(c=>!c.url.includes('/token')).every(c=>c.method==='GET'));
  const saved=store.get(actor.tenantId,'oauth-connections',id)!;
  assert.equal(unseal<any>(String(saved.encryptedTokens),`${actor.tenantId}:${id}:microsoft:tokens`).refreshToken,'rotated-refresh');
  const disconnected=await app.inject({method:'DELETE',url:`/api/v1/oauth/connections/${id}`,cookies:actor.cookies});
  assert.equal(disconnected.statusCode,200);assert.equal(disconnected.json().revokedAtProvider,false);
  assert.equal(store.get(actor.tenantId,'oauth-connections',id)!.encryptedTokens,null);
  const unavailable=await app.inject({url:`/api/v1/oauth/connections/${id}/calendars`,cookies:actor.cookies});
  assert.equal(unavailable.statusCode,503);assert.equal(unavailable.json().error.code,'integration_disconnected');
});

test('AES-GCM refuses modified ciphertext and wrong associated context',()=>{
  const key=randomBytes(32),cipher=seal({secret:'fixture'},'tenant-a:connection-a',key);
  assert.deepEqual(unseal(cipher,'tenant-a:connection-a',key),{secret:'fixture'});
  assert.throws(()=>unseal(cipher,'tenant-b:connection-a',key));
  const parts=cipher.split('.');parts[3]=Buffer.from('modified').toString('base64url');
  assert.throws(()=>unseal(parts.join('.'),'tenant-a:connection-a',key));
});

for(const provider of ['google','microsoft'])test(`${provider} calendar creates, reschedules and cancels with durable idempotency`,async t=>{
  const {app,store,actor}=await setup(t);
  const begin=await start(app,actor,provider,['calendar_write']);
  assert.ok(begin.scope.includes(provider==='google'?'calendar.events':'Calendars.ReadWrite'));
  const writes:Array<{url:string;method:string;body:any}>=[];
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(input,init)=>{
    const url=String(input),method=init?.method||'GET';
    if(url.includes('/token'))return json(token(begin.scope));
    if(url.includes('userinfo'))return json({sub:'google-owner',email:'owner@example.test'});
    if(url.includes('/me?$select'))return json({id:'ms-owner',mail:'owner@example.test'});
    if(method==='GET')return json(provider==='google'?{items:[]}:{value:[]});
    const body=init?.body?JSON.parse(String(init.body)):null;
    writes.push({url,method,body});
    if(method==='DELETE')return new Response(null,{status:204});
    return json({id:body.id||'remote-event',...body});
  };
  const finish=await callback(app,actor,begin.state,provider);assert.equal(finish.statusCode,200,finish.body);
  const id=finish.json().connection.id;
  const event={title:'Fixture consultation',startAt:'2026-10-20T13:00:00-03:00',endAt:'2026-10-20T13:30:00-03:00',attendeeEmails:[]};
  const request={method:'POST' as const,url:`/api/v1/oauth/connections/${id}/events`,cookies:actor.cookies,payload:event,headers:{'idempotency-key':'create-event-001'}};
  const created=await app.inject(request);assert.equal(created.statusCode,201,created.body);
  assert.equal(writes.length,1);assert.equal(writes[0].method,'POST');
  assert.ok(provider==='google'?writes[0].body.id:writes[0].body.transactionId);
  const replay=await app.inject(request);assert.equal(replay.statusCode,201,replay.body);assert.deepEqual(replay.json(),created.json());assert.equal(writes.length,1);
  const conflict=await app.inject({...request,payload:{...event,title:'Different'}});assert.equal(conflict.statusCode,409);assert.equal(conflict.json().error.code,'idempotency_conflict');
  const eventId=created.json().event.id;
  const updated=await app.inject({method:'PATCH',url:`/api/v1/oauth/connections/${id}/events/${eventId}`,cookies:actor.cookies,headers:{'idempotency-key':'reschedule-event-001'},payload:{startAt:'2026-10-20T17:00:00Z',endAt:'2026-10-20T17:30:00Z'}});
  assert.equal(updated.statusCode,200,updated.body);assert.equal(writes.at(-1)!.method,'PATCH');
  assert.equal(writes.at(-1)!.body.attendees,undefined,'time change must preserve attendees');
  const cancel={method:'DELETE' as const,url:`/api/v1/oauth/connections/${id}/events/${eventId}`,cookies:actor.cookies,headers:{'idempotency-key':'cancel-event-001'}};
  const cancelled=await app.inject(cancel);assert.equal(cancelled.statusCode,200,cancelled.body);assert.equal(cancelled.json().event.status,'cancelled');
  assert.equal((await app.inject(cancel)).statusCode,200);assert.equal(writes.length,3);
  const records=store.list(actor.tenantId,'oauth-calendar-operations');assert.equal(records.length,3);assert.ok(records.every(r=>r.status==='completed'));
  const ops=await app.inject({url:`/api/v1/oauth/connections/${id}/operations`,cookies:actor.cookies});assert.equal(ops.statusCode,200);assert.equal(ops.body.includes('keyHash'),false);
});

test('calendar rejects unavailable slots, read-only scopes and overlapping unresolved operations; uncertain writes cannot replay',async t=>{
  const {app,store,actor}=await setup(t);
  const begin=await start(app,actor,'google',['calendar_write']);
  let occupied=true,failWrite=false,writeCalls=0;
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.includes('/token'))return json(token(begin.scope));
    if(url.includes('userinfo'))return json({sub:'g-user'});
    if((init?.method||'GET')==='GET')return json({items:occupied?[{id:'existing',start:{dateTime:'2026-10-20T13:00:00Z'},end:{dateTime:'2026-10-20T14:00:00Z'}}]:[]});
    writeCalls++;if(failWrite)throw new Error('network lost after request');return json({id:'created'});
  };
  const finish=await callback(app,actor,begin.state);const id=finish.json().connection.id;
  const event={title:'Fixture',startAt:'2026-10-20T13:15:00Z',endAt:'2026-10-20T13:45:00Z'};
  const request={method:'POST' as const,url:`/api/v1/oauth/connections/${id}/events`,cookies:actor.cookies,headers:{'idempotency-key':'busy-case-001'},payload:event};
  const busy=await app.inject(request);assert.equal(busy.statusCode,409);assert.equal(busy.json().error.code,'calendar_busy');assert.equal(writeCalls,0);
  store.update(actor.tenantId,'oauth-connections',id,{capabilities:['calendar']});
  assert.equal((await app.inject(request)).statusCode,403);assert.equal(writeCalls,0);
  store.update(actor.tenantId,'oauth-connections',id,{capabilities:['calendar','calendar_write']});
  occupied=false;failWrite=true;
  const uncertain=await app.inject(request);assert.equal(uncertain.statusCode,502);assert.equal(writeCalls,1);
  const repeated=await app.inject(request);assert.equal(repeated.statusCode,409);assert.equal(repeated.json().error.code,'operation_outcome_unknown');assert.equal(writeCalls,1);
  const other=await app.inject({...request,headers:{'idempotency-key':'different-key-001'}});assert.equal(other.statusCode,409);assert.equal(other.json().error.code,'calendar_busy');assert.equal(writeCalls,1);
});

test('Google all-day events preserve calendar timezone without blocking unrelated days',async t=>{
  const {app,actor}=await setup(t);
  const begin=await start(app,actor,'google',['calendar']);
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.includes('/token'))return json(token(begin.scope));
    if(url.includes('userinfo'))return json({sub:'g-owner'});
    return json({timeZone:'America/Sao_Paulo',items:[{id:'all-day',start:{date:'2026-10-20'},end:{date:'2026-10-21'}}]});
  };
  const finish=await callback(app,actor,begin.state);
  const r=await app.inject({url:`/api/v1/oauth/connections/${finish.json().connection.id}/availability?from=2026-10-18T00:00:00Z&to=2026-10-24T00:00:00Z`,cookies:actor.cookies});
  assert.equal(r.statusCode,200,r.body);
  assert.deepEqual(r.json().busy,[{eventId:'all-day',start:'2026-10-20T03:00:00.000Z',end:'2026-10-21T03:00:00.000Z'}]);
});

test('calendar availability follows safe pagination and refuses hostile continuation or malformed busy times',async t=>{
  const {app,actor}=await setup(t);
  const begin=await start(app,actor,'microsoft',['calendar']);
  let mode='pagination',pages=0;
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.includes('/token'))return json(token(begin.scope));
    if(url.includes('/me?$select'))return json({id:'ms-owner'});
    pages++;
    if(mode==='hostile')return json({value:[],'@odata.nextLink':'https://attacker.invalid/collect'});
    if(mode==='malformed')return json({value:[{id:'bad-event',start:{dateTime:'invalid'},end:{dateTime:'invalid'}}]});
    const next=new URL(url);next.searchParams.set('$skip','1000');
    return json({value:[{id:`event-${pages}`,start:{dateTime:'2026-10-20T13:00:00',timeZone:'UTC'},end:{dateTime:'2026-10-20T14:00:00',timeZone:'UTC'}}],...(new URL(url).searchParams.has('$skip')?{}:{'@odata.nextLink':next.toString()})});
  };
  const finish=await callback(app,actor,begin.state,'microsoft');const id=finish.json().connection.id;
  const request={url:`/api/v1/oauth/connections/${id}/availability?from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z`,cookies:actor.cookies};
  const available=await app.inject(request);assert.equal(available.statusCode,200,available.body);assert.equal(available.json().busy.length,2);assert.equal(available.json().complete,true);
  mode='hostile';assert.equal((await app.inject(request)).statusCode,502);
  mode='malformed';assert.equal((await app.inject(request)).statusCode,502);
});

for(const provider of ['google','microsoft'])test(`${provider} OAuth send requires explicit scope and confirmation is acceptance, not delivery`,async t=>{
  const {app,store,actor,user}=await setup(t);
  const begin=await start(app,actor,provider,['email_send']);
  assert.ok(begin.scope.includes(provider==='google'?'gmail.send':'Mail.Send'));
  assert.equal(begin.scope.includes(provider==='google'?'gmail.readonly':'Mail.Read'),false);
  const requests:Array<{url:string;body:any}>=[];
  let failSend=false;
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.includes('/token'))return json(token(begin.scope));
    if(url.includes('userinfo'))return json({sub:'mailbox-user',email:'fixture@example.test'});
    if(url.includes('/me?$select'))return json({id:'mailbox-user',mail:'fixture@example.test'});
    requests.push({url,body:JSON.parse(String(init?.body))});
    if(failSend)throw new Error('send status unknown');
    return provider==='google'?json({id:'gmail-message'}):new Response(null,{status:202});
  };
  const done=await callback(app,actor,begin.state,provider);assert.equal(done.statusCode,200,done.body);
  const id=done.json().connection.id;
  const body={to:['recipient@example.test'],subject:'Olá, confirmação',text:'Conteúdo apenas de fixture; nenhum envio real.'};
  const request={method:'POST' as const,url:`/api/v1/oauth/connections/${id}/messages/send`,cookies:actor.cookies,headers:{'idempotency-key':'send-fixture-001'},payload:body};
  const stranger=user(actor.tenantId);
  assert.equal((await app.inject({...request,cookies:stranger.cookies})).statusCode,404);
  store.update(actor.tenantId,'oauth-connections',id,{capabilities:['email']});
  assert.equal((await app.inject(request)).statusCode,403);assert.equal(requests.length,0);
  store.update(actor.tenantId,'oauth-connections',id,{capabilities:['email_send']});
  const sent=await app.inject(request);assert.equal(sent.statusCode,202,sent.body);assert.equal(sent.json().status,'accepted');assert.equal(sent.json().delivery,'not_confirmed');
  assert.equal(requests.length,1);
  if(provider==='google'){
    const mime=Buffer.from(requests[0].body.raw,'base64url').toString('utf8');
    assert.ok(mime.startsWith('From: fixture@example.test\r\n'));assert.ok(mime.includes('To: recipient@example.test'));
    const payload=mime.split('\r\n\r\n')[1];assert.equal(Buffer.from(payload,'base64').toString('utf8'),body.text);
  }else{
    assert.equal(requests[0].url,'https://graph.microsoft.com/v1.0/me/sendMail');assert.equal(requests[0].body.message.body.content,body.text);assert.equal(requests[0].body.message.from,undefined);
  }
  assert.deepEqual((await app.inject(request)).json(),sent.json());assert.equal(requests.length,1);
  assert.equal((await app.inject({...request,payload:{...body,subject:'Changed'}})).statusCode,409);
  assert.equal((await app.inject({...request,headers:{'idempotency-key':'bad-header-001'},payload:{...body,subject:'Hello\r\nBcc: attacker@example.test'}})).statusCode,400);
  failSend=true;
  const uncertain={...request,headers:{'idempotency-key':'uncertain-send-001'}};
  assert.equal((await app.inject(uncertain)).statusCode,502);
  assert.equal((await app.inject(uncertain)).json().error.code,'send_outcome_unknown');assert.equal(requests.length,2);
  const operations=await app.inject({url:`/api/v1/oauth/connections/${id}/mail-operations`,cookies:actor.cookies});
  assert.equal(operations.statusCode,200);assert.equal(operations.body.includes(body.text),false);assert.equal(operations.body.includes('keyHash'),false);
});
