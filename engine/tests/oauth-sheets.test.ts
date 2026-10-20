import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerOAuth } from '../src/oauth.js';
import { scopesFor } from '../src/oauth/client.js';
import { tokenContext,updateOAuthAuthorization,type Actor } from '../src/oauth/access.js';
import { digest,seal } from '../src/oauth/crypto.js';
import { configureSpreadsheet,listSpreadsheetTabs,readSpreadsheetRange,appendSpreadsheetRows,sheetsBindings,sheetsOperations } from '../src/oauth/sheets.js';
import { integrationRuntimeMatrix } from '../src/integrations/capabilities.js';
import { seedMember } from './fixtures/membership.js';

const SHEET_ID='fixture_spreadsheet_123456789';
const readScope='https://www.googleapis.com/auth/spreadsheets.readonly',writeScope='https://www.googleapis.com/auth/spreadsheets';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
async function setup(t:any,write=true){
  const envNames=['OAUTH_ENCRYPTION_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','PUBLIC_BASE_URL'];
  const previous=Object.fromEntries(envNames.map(key=>[key,process.env[key]])),original=globalThis.fetch;
  process.env.OAUTH_ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.GOOGLE_CLIENT_ID='fixture-google-id';process.env.GOOGLE_CLIENT_SECRET='fixture-google-secret';delete process.env.PUBLIC_BASE_URL;
  const store=new Store(),actor:Actor={tenantId:randomUUID(),userId:randomUUID(),role:'owner'},session=randomBytes(32).toString('hex');
  seedMember(store,actor);
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(digest(session),actor.userId,Date.now()+3600000,actor.tenantId);
  const conn=store.create(actor.tenantId,'oauth-connections',{provider:'google',userId:actor.userId,visibility:'personal',status:'connected',capabilities:write?['sheets_read','sheets_append']:['sheets_read'],scopes:write?writeScope:readScope});
  store.update(actor.tenantId,'oauth-connections',conn.id,{encryptedTokens:seal({accessToken:'fixture-sheets-token',scope:conn.scopes,expiresAt:Date.now()+3600000},tokenContext(conn))});
  const app=Fastify();await app.register(cookie);await registerAuth(app,store);await registerOAuth(app,store);
  t.after(async()=>{await app.close();store.close();globalThis.fetch=original;for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const binding=configureSpreadsheet(store,actor,conn.id,{spreadsheetId:SHEET_ID,name:'Fixture table',allowAppend:write});
  return {store,actor,conn,binding,app,cookies:{kloel_session:session},prefix:`/api/v1/oauth/connections/${conn.id}/spreadsheets/${binding.id}`};
}
const input={sheetTitle:"Client's Data",range:'A1:C20',rows:[['Alice',42,true]]};
const ack={spreadsheetId:SHEET_ID,tableRange:"'Client''s Data'!A1:C5",updates:{updatedRange:"'Client''s Data'!A6:C6",updatedRows:1,updatedColumns:3,updatedCells:3}};

test('Sheets append quarantines a response after reauthorization without replaying the write',async t=>{
  const f=await setup(t);let writes=0;
  globalThis.fetch=async()=>{writes++;f.store.transaction(()=>updateOAuthAuthorization(f.store,f.store.get(f.actor.tenantId,'oauth-connections',f.conn.id)!,{}));return json(ack);};
  await assert.rejects(appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,input,'generation-change'),(e:any)=>e.code==='oauth_connection_changed');
  assert.equal(f.store.list(f.actor.tenantId,sheetsOperations)[0].status,'uncertain');
  await assert.rejects(appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,input,'generation-change'),(e:any)=>e.code==='append_outcome_unknown');assert.equal(writes,1);
});

test('Sheets OAuth requests only explicit scopes, declares provider reach and rejects Microsoft',async t=>{
  const f=await setup(t);
  assert.deepEqual(scopesFor('google',['sheets_read']),['openid','email',readScope]);
  assert.deepEqual(scopesFor('google',['sheets_read','sheets_append']),['openid','email',writeScope]);
  const start=await f.app.inject({method:'POST',url:'/api/v1/oauth/google/start',cookies:f.cookies,payload:{capabilities:['sheets_append']}});
  assert.equal(start.statusCode,200,start.body);const result=start.json();
  assert.equal(result.scopeNotice.providerScope,'all_google_spreadsheets');assert.equal(result.scopeNotice.driveListing,false);
  assert.ok(!new URL(result.authorizationUrl).searchParams.get('scope')!.includes('/drive'));
  assert.equal((await f.app.inject({method:'POST',url:'/api/v1/oauth/microsoft/start',cookies:f.cookies,payload:{capabilities:['sheets_read']}})).statusCode,400);
  let calls=0;globalThis.fetch=async()=>{calls++;return json({});};
  const list=await f.app.inject({url:`/api/v1/oauth/connections/${f.conn.id}/spreadsheets`,cookies:f.cookies});
  assert.equal(list.json().items.length,1);assert.equal(list.json().source,'local_configured_bindings');assert.equal(calls,0);
  assert.equal((await f.app.inject({url:`/api/v1/oauth/connections/${f.conn.id}/spreadsheets`})).statusCode,401);
});

test('Sheets callback refuses partial consent instead of granting write capability',async t=>{
  const f=await setup(t);const begin=(await f.app.inject({method:'POST',url:'/api/v1/oauth/google/start',cookies:f.cookies,payload:{capabilities:['sheets_append']}})).json();
  const state=new URL(begin.authorizationUrl).searchParams.get('state')!;
  globalThis.fetch=async()=>json({access_token:'partial-token',expires_in:3600,token_type:'Bearer',scope:`openid email ${readScope}`});
  const result=await f.app.inject({url:`/api/v1/oauth/google/callback?state=${encodeURIComponent(state)}&code=fixture`,cookies:f.cookies});
  assert.equal(result.statusCode,403);assert.equal(result.json().error.code,'oauth_scope_missing');
});

test('metadata and range reads use fixed Google host, field masks and safely encoded sheet titles',async t=>{
  const f=await setup(t);let calls=0;
  globalThis.fetch=async(value,init)=>{
    calls++;const url=new URL(String(value));assert.equal(url.origin,'https://sheets.googleapis.com');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fixture-sheets-token');
    if(!url.pathname.includes('/values/')){assert.ok(url.searchParams.get('fields')!.includes('sheets(properties'));assert.equal(url.searchParams.get('includeGridData'),null);return json({spreadsheetId:SHEET_ID,properties:{title:'Fixture',locale:'pt_BR',timeZone:'America/Sao_Paulo'},sheets:[{properties:{sheetId:0,title:"Client's Data",index:0,gridProperties:{rowCount:100,columnCount:3}}}]});}
    assert.equal(decodeURIComponent(url.pathname.split('/values/')[1]),"'Client''s Data'!A1:C20");assert.equal(url.searchParams.get('valueRenderOption'),'UNFORMATTED_VALUE');
    return json({range:"'Client''s Data'!A1:C20",majorDimension:'ROWS',values:[['Alice',42,true]]});
  };
  const tabs=await listSpreadsheetTabs(f.store,f.actor,f.conn.id,f.binding.id);assert.equal(tabs.items[0].sheetId,0);assert.equal(tabs.providerVerified,true);
  const range=await readSpreadsheetRange(f.store,f.actor,f.conn.id,f.binding.id,{sheetTitle:input.sheetTitle,range:input.range});assert.deepEqual(range.values,input.rows);assert.equal(range.dataSource,'untrusted_spreadsheet_content');
  assert.equal(calls,2);assert.ok(f.store.get(f.actor.tenantId,sheetsBindings,f.binding.id)?.lastVerifiedAt);
  assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId,sheetsBindings)).includes('Alice'));
});

test('binding and range limits fail before I/O, malformed provider values are never fabricated',async t=>{
  const f=await setup(t);let calls=0;globalThis.fetch=async()=>{calls++;return json({range:'A1:A1',values:[[{}]]});};
  assert.throws(()=>configureSpreadsheet(f.store,f.actor,f.conn.id,{name:'Unsafe',spreadsheetId:'https://evil.example/path'}));
  for(const range of ['A:A','1:2','A1:ZZZ10000','D9:A1','A0:C2','A1:C10000000'])await assert.rejects(readSpreadsheetRange(f.store,f.actor,f.conn.id,f.binding.id,{sheetTitle:'Tab',range}));
  assert.equal(calls,0);
  await assert.rejects(readSpreadsheetRange(f.store,f.actor,f.conn.id,f.binding.id,{sheetTitle:'Tab',range:'A1:A1'}),(e:any)=>e.code==='provider_response_invalid');assert.equal(calls,1);
});

test('append uses RAW and INSERT_ROWS, persists receipt without cells, and replays the result',async t=>{
  const f=await setup(t);let calls=0;
  globalThis.fetch=async(value,init)=>{
    calls++;const url=new URL(String(value));assert.equal(init?.method,'POST');assert.equal(url.searchParams.get('valueInputOption'),'RAW');assert.equal(url.searchParams.get('insertDataOption'),'INSERT_ROWS');assert.equal(url.searchParams.get('includeValuesInResponse'),'false');
    assert.equal(f.store.list(f.actor.tenantId,sheetsOperations)[0].status,'pending');const body=JSON.parse(String(init?.body));assert.equal(body.majorDimension,'ROWS');assert.equal(body.values[0][0],'=SUM(A1:A3)');return json(ack);
  };
  const body={...input,rows:[['=SUM(A1:A3)',42,true]]};
  const result:any=await appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,body,'one');assert.equal(result.status,'appended');assert.equal(result.updatedRows,1);assert.equal(result.valueInputOption,'RAW');
  const duplicate=await appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,body,'one');assert.deepEqual(duplicate,result);assert.equal(calls,1);
  await assert.rejects(appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,input,'one'),(e:any)=>e.code==='idempotency_conflict');
  assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId,sheetsOperations)).includes('SUM'));
  const receipts=(await f.app.inject({url:`/api/v1/oauth/connections/${f.conn.id}/sheets-operations`,cookies:f.cookies})).json();assert.equal(receipts.items[0].status,'appended');assert.equal(receipts.items[0].keyHash,undefined);
});

test('unknown append outcome and interrupted pending receipt cannot be sent again',async t=>{
  const f=await setup(t);let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('fixture network problem');};
  await assert.rejects(appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,input,'uncertain'),(e:any)=>e.code==='provider_unavailable');
  assert.equal(f.store.list(f.actor.tenantId,sheetsOperations)[0].status,'uncertain');
  await assert.rejects(appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,input,'uncertain'),(e:any)=>e.code==='append_outcome_unknown');assert.equal(calls,1);
  let release:(response:Response)=>void=()=>{};globalThis.fetch=async()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const pending=appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,input,'parallel');await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,input,'parallel'),(e:any)=>e.code==='append_in_progress');
  release(json(ack));await pending;assert.equal(calls,2);
});

test('read-only OAuth, binding write toggle, tenant and current shared-account roles are enforced',async t=>{
  const f=await setup(t,false);let calls=0;globalThis.fetch=async()=>{calls++;return json(ack);};
  await assert.rejects(appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,input,'read-only'),(e:any)=>e.code==='capability_not_authorized');
  f.store.update(f.actor.tenantId,'oauth-connections',f.conn.id,{capabilities:['sheets_read','sheets_append'],scopes:writeScope});
  await assert.rejects(appendSpreadsheetRows(f.store,f.actor,f.conn.id,f.binding.id,input,'disabled-write'),(e:any)=>e.code==='spreadsheet_read_only');
  f.store.update(f.actor.tenantId,sheetsBindings,f.binding.id,{allowAppend:true});
  f.store.update(f.actor.tenantId,'oauth-connections',f.conn.id,{userId:randomUUID(),visibility:'shared'});
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('member',f.actor.userId,f.actor.tenantId);
  await assert.rejects(readSpreadsheetRange(f.store,f.actor,f.conn.id,f.binding.id,{sheetTitle:'Tab',range:'A1'}),(e:any)=>e.code==='connection_not_found');
  const outsider={...f.actor,tenantId:randomUUID()};
  await assert.rejects(listSpreadsheetTabs(f.store,outsider,f.conn.id,f.binding.id),(e:any)=>e.code==='authentication_required');assert.equal(calls,0);
});

test('Sheets routes require key, reject write without binding permission and report errors honestly',async t=>{
  const f=await setup(t);let calls=0;globalThis.fetch=async()=>{calls++;return json({error:{message:'fixture forbidden detail'}},403);};
  const missing=await f.app.inject({method:'POST',url:`${f.prefix}/append`,cookies:f.cookies,payload:input});assert.equal(missing.statusCode,400);assert.equal(calls,0);
  const failure=await f.app.inject({method:'POST',url:`${f.prefix}/append`,cookies:f.cookies,headers:{'idempotency-key':'route-v2'},payload:{...input,expectedTenantId:f.actor.tenantId,expectedRevision:1}});assert.equal(failure.statusCode,403);assert.equal(failure.json().error.code,'provider_permission_denied');assert.ok(!failure.body.includes('fixture forbidden'));assert.equal(calls,1);
  const disabled=await f.app.inject({method:'PATCH',url:f.prefix,cookies:f.cookies,headers:{'idempotency-key':'disable-v2'},payload:{expectedTenantId:f.actor.tenantId,expectedRevision:1,enabled:false}});assert.equal(disabled.statusCode,200);
  const read=await f.app.inject({url:`${f.prefix}/tabs?expectedRevision=2`,cookies:f.cookies});assert.equal(read.statusCode,503);assert.equal(read.json().error.code,'spreadsheet_binding_disabled');assert.equal(calls,1);
});

test('runtime capability matrix separates 27 reference labels from native, generic and absent implementation',async t=>{
  const f=await setup(t),matrix=integrationRuntimeMatrix(f.store,f.actor);
  assert.equal(matrix.reference.catalogCount,113);assert.equal(matrix.reference.earlyAccessImplementedClaim,false);assert.equal(matrix.items.length,27);
  const sheets=matrix.items.find(i=>i.name==='Google Sheets')!;assert.equal(sheets.implementation,'native_partial');assert.equal(sheets.runtime.accessibleConnectedAccounts,1);assert.equal(sheets.runtime.configuredSpreadsheetBindings,1);assert.equal(sheets.runtime.readVerifiedSpreadsheetBindings,0);
  assert.equal(matrix.items.find(i=>i.name==='3CX')!.runtime.state,'not_implemented');
  assert.equal(matrix.items.find(i=>i.name==='n8n')!.implementation,'generic_http_only');
  assert.ok(matrix.items.every(i=>i.runtime.endToEndValidation==='not_recorded_by_this_registry'));
  f.store.update(f.actor.tenantId,'oauth-connections',f.conn.id,{visibility:'personal',userId:randomUUID()});
  const isolated=integrationRuntimeMatrix(f.store,f.actor).items.find(i=>i.name==='Google Sheets')!;assert.equal(isolated.runtime.accessibleConnectedAccounts,0);assert.equal(isolated.runtime.configuredSpreadsheetBindings,0);
});
