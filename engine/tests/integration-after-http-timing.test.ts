import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterHttpFixture } from './after-http-fixture.js';
import { integrationAgentTools, executeAgentIntegration, configureAction, operationCollection } from '../src/integrations/service.js';
import { samplePayload } from '../src/after-http/schema.js';
const ok=(response:any)=>{assert.equal(response.statusCode,200,response.body);return response.json();};

test('after-conversation action is excluded from during tools and direct execution; closure executor remains intact',async t=>{
 const f=await afterHttpFixture(t),context={tenantId:f.actor.tenantId,actor:f.actor,agent:f.agent},name=`integration_${f.action.id.replaceAll('-','')}`;
 assert.equal(integrationAgentTools(f.store,context).some(tool=>tool.name===name),true);
 ok(await f.configureHttp());assert.equal(integrationAgentTools(f.store,context).some(tool=>tool.name===name),false);
 await assert.rejects(executeAgentIntegration(f.store,context,f.action.id,{...samplePayload,agentRef:f.agent.id},randomUUID(),f.transport),(e:any)=>e.code==='action_after_conversation_only');
 assert.equal(f.calls.length,0);assert.equal(f.store.list(f.actor.tenantId,operationCollection).length,0);
 const {conversation}=await f.seedConversation();ok(await f.close(conversation));const job=f.jobFor(conversation.id);await f.httpWorker.runOne(f.actor.tenantId,job.id);assert.equal(f.calls.length,1);
 ok(await f.configureHttp(false,1));assert.equal(integrationAgentTools(f.store,context).some(tool=>tool.name===name),true);
});

test('timing restriction is scoped to the agent and does not hide unrelated during actions',async t=>{
 const f=await afterHttpFixture(t),otherAgent=f.store.create(f.actor.tenantId,'agents',{name:'Other',status:'active'});
 const otherAction=configureAction(f.store,f.actor,{...f.definition,name:'During action'});
 ok(await f.configureHttp());const context={tenantId:f.actor.tenantId,actor:f.actor,agent:f.agent};
 const tools=integrationAgentTools(f.store,context);assert.equal(tools.some(tool=>tool.name===`integration_${otherAction.id.replaceAll('-','')}`),true);
 const shared=configureAction(f.store,f.actor,{...f.definition,name:'Shared action',agentIds:[f.agent.id,otherAgent.id]});
 ok(await f.configureHttp(true,1,randomUUID(),shared.id,Number(shared.revision)));
 assert.equal(integrationAgentTools(f.store,{...context,agent:otherAgent}).some(tool=>tool.name===`integration_${shared.id.replaceAll('-','')}`),true);
});

for(const aba of [false,true])test(`changing timing during DNS blocks the during request before transport${aba?' including ABA':''}`,async t=>{
 const f=await afterHttpFixture(t),context={tenantId:f.actor.tenantId,actor:f.actor,agent:f.agent};
 f.hooks.resolve=async()=>{ok(await f.configureHttp());if(aba)ok(await f.configureHttp(false,1));return [{address:'93.184.216.34',family:4}];};
 await assert.rejects(executeAgentIntegration(f.store,context,f.action.id,{...samplePayload,agentRef:f.agent.id},randomUUID(),f.transport),(e:any)=>e.code==='action_timing_changed');
 assert.equal(f.calls.length,0);
});
