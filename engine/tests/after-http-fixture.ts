import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Store } from '../src/store.js';
import { afterConversationFixture } from './fixtures/after-conversation.js';
import { registerAfterHttp } from '../src/after-http/routes.js';
import { createAfterHttpWorker } from '../src/after-http/worker.js';
import { configureAction } from '../src/integrations/service.js';
import { registerIntegrations } from '../src/integrations.js';
import type { IntegrationTransport, RequestSpec } from '../src/integrations/transport.js';
import { jobs } from '../src/after-http/authority.js';
export const afterHttpArgumentsSchema={type:'object',additionalProperties:false,properties:{schemaVersion:{type:'integer',const:1},event:{type:'string',const:'conversation.closed'},eventId:{type:'string',maxLength:36},conversationRef:{type:'string',maxLength:36},agentRef:{type:'string',maxLength:36},channel:{type:'string',enum:['webchat','whatsapp']},closureEpoch:{type:'integer',minimum:1},closedAt:{type:'string',maxLength:40},messageCount:{type:'integer',minimum:0}},required:['schemaVersion','event','eventId','conversationRef','agentRef','channel','closureEpoch','closedAt','messageCount']};
export const httpResponse=(status=202)=>({status,headers:{'content-type':'application/json'},body:Buffer.from('{"secret":"untrusted synthetic remote response"}')});
export async function afterHttpFixture(t:TestContext,setup?:(app:FastifyInstance,store:Store)=>void|Promise<void>){
 const previous=process.env.AFTER_HTTP_MAX_DISPATCHES_PER_DAY;delete process.env.AFTER_HTTP_MAX_DISPATCHES_PER_DAY;
 t.after(()=>{if(previous===undefined)delete process.env.AFTER_HTTP_MAX_DISPATCHES_PER_DAY;else process.env.AFTER_HTTP_MAX_DISPATCHES_PER_DAY=previous;});
 const calls:Array<{url:string;spec:RequestSpec}>=[],hooks:{resolve?:IntegrationTransport['resolve'];request?:IntegrationTransport['request']}={};
 const transport:IntegrationTransport={resolve:async(...args)=>hooks.resolve?hooks.resolve(...args):[{address:'93.184.216.34',family:4}],request:async(...args)=>{calls.push({url:args[0].href,spec:args[2]});if(hooks.request)return hooks.request(...args);args[2].onResponse?.(202);return httpResponse();}};
 let worker!:ReturnType<typeof createAfterHttpWorker>;
 const f=await afterConversationFixture(t,async(app,store)=>{await registerAfterHttp(app,store);await registerIntegrations(app,store,transport);worker=createAfterHttpWorker(store,{transport});app.addHook('onClose',async()=>{await worker.stop();});await setup?.(app,store);});
 const definition={name:'Synthetic closure HTTP',template:'n8n',url:'https://after.example.com/webhook/synthetic-secret',method:'POST',headers:{Authorization:'Bearer synthetic-http-credential'},argumentsSchema:afterHttpArgumentsSchema,agentIds:[f.agent.id]};
 const action=configureAction(f.store,f.actor,definition),httpBase=`/api/v1/agents/${f.agent.id}/after-http`;
 const configureHttp=(enabled=true,expectedRevision=0,key=randomUUID(),actionId:string|null=action.id,expectedActionRevision:number|null=enabled?Number(action.revision):null)=>f.request('PUT',httpBase,{expectedTenantId:f.actor.tenantId,expectedRevision,idempotencyKey:key,configuration:{enabled,actionId},expectedActionRevision,externalSendAcknowledged:enabled});
 const httpHistory=(id:string,cursor?:string)=>f.request('GET',`/api/v1/conversations/${id}/after-http-operations${cursor?`?cursor=${cursor}`:''}`);
 const jobFor=(id:string)=>f.store.list(f.actor.tenantId,jobs).find(j=>j.conversationId===id)!;
 return {...f,httpWorker:worker,transport,hooks,calls,action,definition,httpBase,configureHttp,httpHistory,jobFor};
}
