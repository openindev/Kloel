import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac,randomBytes,randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Store } from '../src/store.js';
import { registerIntegrations } from '../src/integrations.js';
import { configureAction,executeRegisteredIntegration,executeAgentIntegration,publicOperation,actionCollection,operationCollection } from '../src/integrations/service.js';
import { argumentSchema,jsonPointer,renderBody } from '../src/integrations/schema.js';
import { deliver, type IntegrationTransport } from '../src/integrations/transport.js';
import type { Actor } from '../src/oauth/access.js';
import { seedMember } from './fixtures/membership.js';

const publicAddress={address:'93.184.216.34',family:4};
const resolver=async()=>[publicAddress];
const input=(extra:Record<string,unknown>={})=>({name:'Fixture workflow',template:'n8n',url:'https://workflow.example.com/webhook/fixture-secret-path?key=fixture-query-secret',method:'POST',headers:{Authorization:'Bearer fixture-credential-token'},argumentsSchema:{type:'object',properties:{name:{type:'string',maxLength:50}},required:['name'],additionalProperties:false},bodyTemplate:{customer:{$arg:'/name'}},responsePaths:{result:'/result'},...extra});
function fixture(t:any){
  const previous=process.env.OAUTH_ENCRYPTION_KEY;process.env.OAUTH_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const store=new Store(),actor:Actor={tenantId:randomUUID(),userId:randomUUID(),role:'owner'};
  seedMember(store,actor);
  t.after(()=>{store.close();if(previous===undefined)delete process.env.OAUTH_ENCRYPTION_KEY;else process.env.OAUTH_ENCRYPTION_KEY=previous;});
  return {store,actor};
}
const response=(status=200,value:unknown={result:'accepted'})=>({status,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(value))});

test('registration encrypts URL, headers and templates; configuration and execution use current role',async t=>{
  const f=fixture(t),action=configureAction(f.store,f.actor,input({bodyTemplate:{secret:'fixture-static-value',customer:{$arg:'/name'}}}));
  assert.equal(action.nativeConnector,false);assert.equal(action.status,'configured_unverified');assert.equal(action.targetOrigin,'https://workflow.example.com');
  const publicJson=JSON.stringify(action),stored=JSON.stringify(f.store.get(f.actor.tenantId,actionCollection,action.id));
  for(const secret of ['fixture-secret-path','fixture-query-secret','fixture-credential-token','fixture-static-value']){assert.ok(!publicJson.includes(secret));assert.ok(!stored.includes(secret));}
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('member',f.actor.userId,f.actor.tenantId);
  assert.throws(()=>configureAction(f.store,f.actor,input()),/Somente proprietário/);
  await assert.rejects(executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'a'),(e:any)=>e.code==='action_not_authorized');
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.actor.userId,f.actor.tenantId);
  await assert.rejects(executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'b'),(e:any)=>e.code==='authentication_required');
});

test('schema validates arguments and literal JSON substitutions without remote refs, patterns or URL interpolation',async t=>{
  const f=fixture(t);let calls=0;const action=configureAction(f.store,f.actor,input());
  const transport:IntegrationTransport={resolve:resolver,request:async()=>{calls++;return response();}};
  await assert.rejects(executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x',url:'https://evil.example'},'x',{transport}),(e:any)=>e.code==='invalid_arguments');
  assert.equal(calls,0);
  assert.throws(()=>argumentSchema({type:'object',$ref:'https://evil.example/schema'}));
  assert.throws(()=>argumentSchema({type:'object',properties:{x:{type:'string',pattern:'(a+)+$'}}}));
  assert.throws(()=>jsonPointer({},'/absent/__proto__'));
  assert.throws(()=>jsonPointer({},'/absent/bad~2'));
  assert.deepEqual(renderBody({value:{$arg:'/x'}},{x:{nested:'value'}}),{value:{nested:'value'}});
  assert.throws(()=>renderBody({value:{$arg:'/missing'}},{x:'v'}));
  for(const headers of [{Host:'evil.example'},{'x-kloel-signature':'wrong'},{Authorization:'x\r\ny: z'}])assert.throws(()=>configureAction(f.store,f.actor,input({headers})));
});

test('explicit execution pins DNS, signs exact bytes, projects redacted data and replays without a second request',async t=>{
  const f=fixture(t),signingSecret='fixture-signing-secret-123456',action=configureAction(f.store,f.actor,input({signingSecret}));let calls=0;
  const transport:IntegrationTransport={resolve:resolver,request:async(url,address,spec)=>{
    calls++;assert.equal(url.hostname,'workflow.example.com');assert.deepEqual(address,publicAddress);assert.equal(spec.body?.toString(),'{"customer":"Alice"}');
    const expected=createHmac('sha256',signingSecret).update(`${spec.headers['x-kloel-timestamp']}.${spec.headers['x-kloel-event-id']}.`).update(spec.body!).digest('hex');
    assert.equal(spec.headers['x-kloel-signature'],`v1=${expected}`);assert.equal(spec.headers['idempotency-key'],spec.headers['x-kloel-event-id']);
    return response(202,{result:{message:'echo fixture-credential-token fixture-secret-path fixture-query-secret',token:'arbitrary-provider-token',recordId:'row-1'}});
  }};
  const first:any=await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'Alice'},'once',{transport});
  assert.equal(first.ok,true);assert.equal(first.outcome,'endpoint_acknowledged');assert.equal(first.workflowCompletion,'not_verified');assert.equal(first.data.result.recordId,'row-1');
  assert.equal(first.data.result.token,'[redacted]');assert.ok(!JSON.stringify(first).includes('fixture-credential-token'));
  const replay=await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'Alice'},'once',{transport});assert.deepEqual(replay,first);assert.equal(calls,1);
  assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId,operationCollection)).includes('Alice'));
  const publicReceipt=publicOperation(f.store.list(f.actor.tenantId,operationCollection)[0]);assert.equal((publicReceipt as any).fingerprint,undefined);
  await assert.rejects(executeRegisteredIntegration(f.store,f.actor,action.id,{name:'Bob'},'once',{transport}),(e:any)=>e.code==='idempotency_conflict');
});

test('private URLs, mixed DNS and metadata destinations never receive a request; retries only happen explicitly before send',async t=>{
  const f=fixture(t);let calls=0,privateDns=true;const action=configureAction(f.store,f.actor,input());
  for(const url of ['http://public.example','https://127.0.0.1/','https://[::1]/','https://169.254.169.254/','https://168.63.129.16/','https://localhost/'])assert.throws(()=>configureAction(f.store,f.actor,input({url})));
  const transport:IntegrationTransport={resolve:async()=>privateDns?[publicAddress,{address:'10.0.0.1',family:4}]:[publicAddress],request:async()=>{calls++;return response();}};
  const failed:any=await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'retry',{transport});
  assert.equal(failed.operation.status,'not_sent');assert.equal(failed.operation.errorCode,'unsafe_destination');assert.equal(calls,0);
  privateDns=false;
  await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'retry',{transport});assert.equal(calls,0);
  const success:any=await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'retry',{transport,retryOperationId:failed.operation.id});
  assert.equal(success.ok,true);assert.equal(success.operation.attempts,2);assert.equal(calls,1);
});

test('write errors and transport uncertainty are never blindly retried, including concurrent pending calls',async t=>{
  const f=fixture(t),action=configureAction(f.store,f.actor,input());let calls=0;
  const uncertain:IntegrationTransport={resolve:resolver,request:async()=>{calls++;throw new Error('socket fixture secret detail');}};
  const failed:any=await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'uncertain',{transport:uncertain});
  assert.equal(failed.operation.status,'uncertain');assert.equal(failed.operation.requiresReconciliation,true);
  assert.ok(!JSON.stringify(failed).includes('socket fixture'));
  await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'uncertain',{transport:uncertain});assert.equal(calls,1);
  await assert.rejects(executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'uncertain',{transport:uncertain,retryOperationId:failed.operation.id}),(e:any)=>e.code==='retry_not_safe');
  const httpFailure:any=await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'http-failure',{transport:{resolve:resolver,request:async()=>response(500)}});assert.equal(httpFailure.operation.status,'uncertain');
  let release:(value:ReturnType<typeof response>)=>void=()=>{};
  const blocked:IntegrationTransport={resolve:resolver,request:async()=>{calls++;return new Promise(resolve=>{release=resolve;});}};
  const pending=executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'concurrent',{transport:blocked});
  await new Promise(resolve=>setImmediate(resolve));
  const repeated:any=await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'concurrent',{transport:blocked});assert.equal(repeated.operation.status,'pending');
  release(response());await pending;assert.equal(calls,2);
});

test('redirects are independently resolved and pinned; cross-origin secrets and method rewrites are blocked',async()=>{
  let calls=0,resolves=0;
  const spec={method:'POST',headers:{authorization:'Bearer fixture-secret'},body:Buffer.from('{}')};
  const same:IntegrationTransport={resolve:async()=>{resolves++;return [publicAddress];},request:async(_url,_address,request)=>{calls++;assert.equal(request.headers.authorization,'Bearer fixture-secret');return calls===1?{...response(307),headers:{location:'/second'}}:response();}};
  assert.equal((await deliver('https://public.example/first',spec,500,same)).redirects,1);assert.equal(resolves,2);
  for(const location of ['https://other.example/target','https://127.0.0.1/target','http://public.example/downgrade']){
    let requests=0;await assert.rejects(deliver('https://public.example/first',spec,500,{resolve:resolver,request:async()=>{requests++;return {...response(307),headers:{location}};}}));assert.equal(requests,1);
  }
  await assert.rejects(deliver('https://public.example/first',spec,500,{resolve:resolver,request:async()=>({...response(302),headers:{location:'/second'}})}),(e:any)=>e.code==='redirect_method_change_blocked');
  let rebinding=0;
  await assert.rejects(deliver('https://public.example/first',spec,500,{resolve:async()=>++rebinding===1?[publicAddress]:[{address:'127.0.0.1',family:4}],request:async()=>({...response(307),headers:{location:'/second'}})}),(e:any)=>e.code==='unsafe_destination');
});

test('agent helper requires a current operator and persisted explicit assignment, never model-selected URL or headers',async t=>{
  const f=fixture(t),agent=f.store.create(f.actor.tenantId,'agents',{name:'Fixture agent'}),action=configureAction(f.store,f.actor,input({agentIds:[agent.id]}));
  const transport:IntegrationTransport={resolve:resolver,request:async()=>response()};
  const context={tenantId:f.actor.tenantId,actor:f.actor,agent};
  assert.equal((await executeAgentIntegration(f.store,context,action.id,{name:'x'},'agent-1',transport)).ok,true);
  await assert.rejects(executeAgentIntegration(f.store,{...context,actor:undefined},action.id,{name:'x'},'agent-2',transport),(e:any)=>e.code==='operator_required');
  f.store.update(f.actor.tenantId,actionCollection,action.id,{agentIds:[]});
  await assert.rejects(executeAgentIntegration(f.store,context,action.id,{name:'x'},'agent-3',transport),(e:any)=>e.code==='action_not_assigned');
});

test('delivery deadline does not initiate a late request after DNS timeout and bounds response bytes',async()=>{
  let requests=0;
  await assert.rejects(deliver('https://public.example/',{method:'GET',headers:{}},10,{resolve:async()=>{await new Promise(resolve=>setTimeout(resolve,30));return [publicAddress];},request:async()=>{requests++;return response();}}),(e:any)=>e.code==='integration_timeout'&&e.outcomeUnknown===false);
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(requests,0);
  await assert.rejects(deliver('https://public.example/',{method:'GET',headers:{}},100,{resolve:resolver,request:async()=>({status:200,headers:{},body:Buffer.alloc(65537)})}),(e:any)=>e.code==='response_limit_exceeded');
});

test('tenant isolation, disabled actions and per-operator idempotency prevent credential/result crossover',async t=>{
  const f=fixture(t),action=configureAction(f.store,f.actor,input({allowedRoles:['owner','member']}));let calls=0;
  const member:Actor={...f.actor,userId:randomUUID(),role:'member'};
  seedMember(f.store,member);
  const foreign:Actor={...member,tenantId:randomUUID(),userId:randomUUID()};
  seedMember(f.store,foreign);
  const transport:IntegrationTransport={resolve:resolver,request:async()=>{calls++;return response(200,{result:{row:calls}});}};
  const first:any=await executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'shared-key',{transport});
  const second:any=await executeRegisteredIntegration(f.store,member,action.id,{name:'x'},'shared-key',{transport});
  assert.notEqual(first.operation.id,second.operation.id);assert.equal(calls,2);
  await assert.rejects(executeRegisteredIntegration(f.store,foreign,action.id,{name:'x'},'key',{transport}),(e:any)=>e.code==='action_not_found');
  f.store.update(f.actor.tenantId,actionCollection,action.id,{enabled:false});
  await assert.rejects(executeRegisteredIntegration(f.store,f.actor,action.id,{name:'x'},'shared-key',{transport}),(e:any)=>e.code==='action_disabled');
});

test('authenticated routes expose honest registry, explicit execution, safe receipt metadata and role boundaries',async t=>{
  const f=fixture(t),app=Fastify();let calls=0;t.after(()=>app.close());
  app.addHook('onRequest',async req=>{req.actor=f.actor;});
  await registerIntegrations(app,f.store,{resolve:resolver,request:async()=>{calls++;return response();}});
  const registry=(await app.inject('/api/v1/integrations/registry')).json();assert.equal(registry.items.find((r:any)=>r.id==='n8n').status,'not_configured');
  const created=await app.inject({method:'POST',url:'/api/v1/integrations/actions',payload:input()});assert.equal(created.statusCode,201);const action=created.json();
  assert.equal(calls,0);
  assert.equal((await app.inject({method:'POST',url:`/api/v1/integrations/actions/${action.id}/execute`,payload:{arguments:{name:'x'}}})).statusCode,400);
  const sent=await app.inject({method:'POST',url:`/api/v1/integrations/actions/${action.id}/execute`,headers:{'idempotency-key':'http-fixture'},payload:{arguments:{name:'x'}}});assert.equal(sent.statusCode,200);assert.equal(sent.json().ok,true);assert.equal(calls,1);
  const listed=(await app.inject('/api/v1/integrations/actions')).json();assert.equal(listed.items[0].status,'endpoint_acknowledged');assert.ok(!JSON.stringify(listed).includes('fixture-credential-token'));
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('member',f.actor.userId,f.actor.tenantId);
  assert.equal((await app.inject({method:'PATCH',url:`/api/v1/integrations/actions/${action.id}`,payload:{enabled:false}})).statusCode,403);
});
