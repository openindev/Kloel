import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { agentEditorFixture } from './fixtures/agent-editor-state.js';
import { agentEditorStates, agentEditorOperations } from '../src/agent-editor-state.js';
import { sanitizeAgentEditorState } from '../src/agent-editor-state-schema.js';
import { guardedBoundary } from './fixtures/request-context.js';
const ok=(r:any,status=200)=>{assert.equal(r.statusCode,status,r.body);return r.json();};
const rows=(f:any)=>f.store.db.prepare('SELECT * FROM entities ORDER BY id').all();

test('atomic create preserves safe full editor state and strips secrets and simulated provider facts',async t=>{
  const f=await agentEditorFixture(t),state={type:'voice',voiceId:'catalog148',greetingRules:[{id:'rule1',conditions:[{field:'balance',value:0}],message:'Olá'}],rules:{custom:[{id:'custom1',active:false,title:'Regra',instruction:'Ajude'}]},technical:{temperature:0,recordAudio:false},webhooks:[{id:'wh1',name:'Private action',enabled:true,url:'https://secret.example/?token=private',headers:[{key:'Authorization',value:'private'}],body:'private',defaults:'private',secret:'private',lastTest:{status:'success'},responseMapping:[{id:'mapping1',path:'/saldo',variable:'saldo'}]}],integrations:[{id:'int1',name:'Planilha',config:{token:'private'},connected:true,connectedAt:'fake'}],companyInfo:'Empresa'};
  const created=ok(await f.create(f.createBody({state})),201);assert.equal(created.agent.name,'Assistente editorial');assert.equal(created.revision,1);assert.equal(created.lastWrite.key,created.operation.key);assert.equal(created.operation.kind,'agent.editor.create');assert.equal(created.state.technical.temperature,0);assert.equal(created.state.rules.custom[0].active,false);
  assert.deepEqual(created.state.webhooks,[{id:'wh1',name:'Private action',enabled:true,responseMapping:[{id:'mapping1',path:'/saldo',variable:'saldo'}]}]);assert.deepEqual(created.state.integrations,[{id:'int1',name:'Planilha'}]);assert.equal(JSON.stringify(rows(f)).includes('private'),false);assert.deepEqual(ok(await f.detail(created.agent.id)).state,created.state);assert.equal(f.store.list(f.actor.tenantId,'agents').length,1);
});
test('legacy agent projects revision zero without modifying stored agent or database schema',async t=>{
  const f=await agentEditorFixture(t),created=ok(await f.request('POST','/api/v1/agents',{name:'Existing'}),201),before=rows(f),schema=f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
  const view=ok(await f.detail(created.id));assert.equal(view.revision,0);assert.deepEqual(view.state,{});assert.equal(view.lastWrite,null);assert.deepEqual(rows(f),before);ok(await f.save(view,{state:{type:'chat'}}));assert.deepEqual(f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all(),schema);
});
test('editorial-only save preserves exact agent and active analysis delegation; runtime edit invalidates it',async t=>{
  const f=await agentEditorFixture(t),created=ok(await f.create(),201);ok(await f.request('PUT',`/api/v1/agents/${created.agent.id}/after-conversation`,{expectedTenantId:f.actor.tenantId,expectedRevision:0,idempotencyKey:randomUUID(),configuration:{enabled:true,allowedTags:[]}}));
  const configured=ok(await f.request('GET',`/api/v1/agents/${created.agent.id}/after-conversation`));assert.equal(configured.authorization.state,'active');
  const changed=ok(await f.save(created,{state:{...created.state,companyInfo:'Nova apresentação'}}));assert.deepEqual(changed.agent,created.agent);assert.equal(changed.agentVersion,created.agentVersion);assert.equal(ok(await f.request('GET',`/api/v1/agents/${created.agent.id}/after-conversation`)).authorization.state,'active');
  const actual=ok(await f.save(changed,{agent:{prompt:'Instrução operacional nova'}}));assert.equal(actual.agent.delegationGeneration,1);assert.equal(ok(await f.request('GET',`/api/v1/agents/${created.agent.id}/after-conversation`)).authorization.state,'revoked');
});
test('both revision fences reject stale save atomically and valid save replaces complete editorial state',async t=>{
  const f=await agentEditorFixture(t),created=ok(await f.create(),201),next=ok(await f.save(created,{state:{type:'chat'}})),before=rows(f);assert.equal((await f.save(created,{agent:{name:'Stale'},state:{companyInfo:'stale'}})).json().error.code,'agent_editor_revision_conflict');assert.deepEqual(rows(f),before);
  ok(await f.request('PATCH',`/api/v1/agents/${created.agent.id}`,{name:'Changed elsewhere'}));const after=rows(f);assert.equal((await f.save(next,{state:{type:'voice'}})).json().error.code,'agent_editor_agent_changed');assert.deepEqual(rows(f),after);
  const fresh=ok(await f.detail(created.agent.id));assert.equal(fresh.lastWrite.agentVersion,created.agentVersion);const saved=ok(await f.save(fresh,{agent:{name:'Current'},state:{type:'voice'}}));assert.deepEqual(saved.state,{type:'voice'});assert.equal(saved.agent.name,'Current');
});
test('create and update lost-result recovery preserve original receipt and never duplicate writes',async t=>{
  const f=await agentEditorFixture(t),body=f.createBody(),transaction=f.store.transaction.bind(f.store);let armed=true;
  f.store.transaction=((fn:any)=>{const result=transaction(fn);if(armed&&f.store.list(f.actor.tenantId,agentEditorOperations).some(r=>r.key===body.idempotencyKey)){armed=false;throw new Error('synthetic commit-result loss');}return result;}) as typeof f.store.transaction;
  assert.equal((await f.create(body)).statusCode,500);const receipt=ok(await f.operation(body.idempotencyKey));assert.equal(receipt.kind,'agent.editor.create');const replay=ok(await f.create(body),201);assert.equal(replay.replayed,true);assert.equal(replay.agent.id,receipt.agentId);assert.equal(f.store.list(f.actor.tenantId,'agents').length,1);
  const update=f.updateBody(replay,{agent:{name:'Updated'}}),r=ok(await f.request('PUT',`/api/v1/agents/${replay.agent.id}/editor-state`,update));const before=rows(f);assert.equal(ok(await f.request('PUT',`/api/v1/agents/${replay.agent.id}/editor-state`,update)).replayed,true);assert.deepEqual(rows(f),before);assert.deepEqual(ok(await f.operation(update.idempotencyKey)),r.operation);
  assert.equal((await f.create({...body,agent:{name:'Different'}})).json().error.code,'agent_editor_idempotency_conflict');
});
test('validation and injected sidecar failure roll back runtime and receipt together',async t=>{
  const f=await agentEditorFixture(t),created=ok(await f.create(),201),before=rows(f);
  assert.equal((await f.save(created,{agent:{settings:{temperature:99}}})).statusCode,400);assert.deepEqual(rows(f),before);
  const update=f.store.update.bind(f.store);f.store.update=((tenant,collection,id,changes)=>{if(collection===agentEditorStates)throw new Error('synthetic sidecar write failure');return update(tenant,collection,id,changes);}) as typeof f.store.update;
  assert.equal((await f.save(created,{agent:{name:'Must roll back'}})).statusCode,500);assert.deepEqual(rows(f),before);
});
test('read/write are tenant scoped and require a current human session and capability',async t=>{
  const f=await agentEditorFixture(t),created=ok(await f.create(),201),before=rows(f);assert.equal((await f.create(f.createBody({expectedTenantId:'another-tenant'}))).statusCode,409);assert.deepEqual(rows(f),before);
  f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(f.actor.userId);const headers=await f.freshHeaders();assert.equal((await f.request('GET',`/api/v1/agents/${created.agent.id}/editor-state`,undefined,headers)).statusCode,200);assert.equal((await f.request('PUT',`/api/v1/agents/${created.agent.id}/editor-state`,f.updateBody(created),headers)).statusCode,403);assert.equal((await f.request('GET',`/api/v1/agents/editor-state/operations/${created.operation.key}`,undefined,headers)).statusCode,403);
  const foreign=f.store.create('other-tenant','agents',{name:'Foreign'});assert.equal((await f.request('GET',`/api/v1/agents/${foreign.id}/editor-state`,undefined,headers)).statusCode,404);assert.equal((await f.app.inject({url:`/api/v1/agents/${created.agent.id}/editor-state`})).statusCode,401);
});
test('recording capability cannot be bypassed through atomic editor endpoint',async t=>{
  const f=await agentEditorFixture(t,'builder'),created=ok(await f.create(),201),before=rows(f);assert.equal((await f.save(created,{agent:{settings:{recordingEnabled:true}},state:{technical:{recordAudio:true}}})).statusCode,403);assert.deepEqual(rows(f),before);
  assert.equal((await f.create(f.createBody({agent:{name:'Recording',settings:{recordingEnabled:true}}}))).statusCode,403);assert.deepEqual(rows(f),before);
});
test('revocation between admission and transaction rejects all writes and original receipt recovery',async t=>{
  const f=await agentEditorFixture(t),created=ok(await f.create(),201),before=rows(f),guard=guardedBoundary(f.store,f.sessionHash,f.actor.userId),restore=guard.arm('BEGIN');const result=await f.save(created,{agent:{name:'Revoked'}});restore();guard.rejected(result);assert.deepEqual(rows(f),before);assert.equal((await f.operation(created.operation.key)).statusCode,409);
  const fresh=await f.freshHeaders();assert.equal((await f.request('GET',`/api/v1/agents/editor-state/operations/${created.operation.key}`,undefined,fresh)).statusCode,404);
});
test('editor shape rejects root authority and prototype injection and enforces local JSON bounds',()=>{
  for(const state of [{id:'x'},{tenantId:'x'},{status:'active'},JSON.parse('{"technical":{"__proto__":{"x":true}}}'),{companyInfo:'x'.repeat(100001)},{technical:{value:Infinity}}])assert.throws(()=>sanitizeAgentEditorState(state));
  const safe=sanitizeAgentEditorState({technical:{nested:{access_token:'secret',password:'secret',keep:false}},companyInfo:'safe'});assert.deepEqual(safe,{technical:{nested:{keep:false}},companyInfo:'safe'});
});
test('private transport fields cannot hide in nested webhook or integration editorial objects',()=>{
  const state=sanitizeAgentEditorState({webhooks:[{id:'w1',request:{url:'https://example.test/?secret=private',body:'private',headers:{x:'private'},defaults:'private',name:'safe'}}],integrations:[{id:'i1',nested:{config:{value:'private'},name:'safe'}}]});
  assert.deepEqual(state,{webhooks:[{id:'w1',request:{name:'safe'}}],integrations:[{id:'i1',nested:{name:'safe'}}]});
});
