import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { buildApp } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { CONTEXT_HEADERS } from '../../src/request-context.js';
import type { Role } from '../../src/memberships/permissions.js';
import { seedMember } from './membership.js';

export async function agentEditorFixture(t:TestContext,role:Role='owner') {
  const store=new Store(),actor={userId:'editor-fixture-user',tenantId:'editor-fixture-tenant',role};
  seedMember(store,actor);
  const cookies={kloel_session:'synthetic-agent-editor-cookie'},sessionHash=createHash('sha256').update(cookies.kloel_session).digest('hex');
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash,actor.userId,actor.tenantId,Date.now()+86400000);
  const previousFetch=globalThis.fetch,providerCalls:unknown[]=[];
  globalThis.fetch=(async(...args:any[])=>{providerCalls.push(args[0]);throw new Error('editor_fixture_provider_refused');}) as typeof fetch;
  const app=await buildApp(store,{workers:false});
  t.after(async()=>{await app.close();globalThis.fetch=previousFetch;assert.equal(providerCalls.length,0,'editor adapter must not call providers');});
  const freshHeaders=async()=>{
    const me=await app.inject({url:'/api/v1/auth/me',cookies});assert.equal(me.statusCode,200,me.body);const context=me.json().context;
    return Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key,name])=>[name,context[key]??'-']));
  };
  const headers=await freshHeaders();
  const request=(method:any,url:string,payload?:unknown,expected=headers)=>app.inject({method,url,cookies,headers:expected,...(payload===undefined?{}:{payload:payload as any})});
  const createBody=(changes:Record<string,unknown>={})=>({expectedTenantId:actor.tenantId,idempotencyKey:randomUUID(),agent:{name:'Assistente editorial',status:'active',prompt:'Ajude o usuário.'},state:{type:'chat',voiceId:'catalog-voice',technical:{temperature:0.7,recordAudio:false},companyInfo:'Empresa sintética'},...changes});
  const create=(body=createBody())=>request('POST','/api/v1/agents/editor-state',body);
  const detail=(agentId:string)=>request('GET',`/api/v1/agents/${agentId}/editor-state`);
  const updateBody=(view:any,changes:Record<string,unknown>={})=>({expectedTenantId:actor.tenantId,expectedRevision:view.revision,expectedAgentVersion:view.agentVersion,idempotencyKey:randomUUID(),agent:{},state:view.state,...changes});
  const save=(view:any,changes:Record<string,unknown>={})=>request('PUT',`/api/v1/agents/${view.agent.id}/editor-state`,updateBody(view,changes));
  const operation=(key:string)=>request('GET',`/api/v1/agents/editor-state/operations/${key}`);
  const aba=()=>{store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=?").run(actor.userId);store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(actor.userId);};
  return {app,store,actor,cookies,sessionHash,headers,freshHeaders,request,createBody,create,detail,updateBody,save,operation,aba,providerCalls};
}
