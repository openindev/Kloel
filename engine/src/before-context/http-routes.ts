import { z } from 'zod';
import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';
import type { Store } from '../store.js';
import { DomainError } from '../domains.js';
import { MembershipError } from '../memberships/service.js';
import { captureBeforeOperator,fail } from './operations.js';
import { configureHttp,httpConfigReceipt,ownedHttpConfig,publicSource,secretInput,initializeBeforeHttp,httpOperations } from './http-source.js';
import { beforeHttpRuntime,httpView } from './http-resolution.js';
const uuid=z.string().uuid(),revision=z.number().int().nonnegative().safe();
export async function registerBeforeHttp(app:FastifyInstance,store:Store){
 initializeBeforeHttp(store);
 const wrap=(handler:(req:FastifyRequest,reply:FastifyReply)=>unknown)=>async(req:FastifyRequest,reply:FastifyReply)=>{reply.header('Cache-Control','no-store');try{return await handler(req,reply);}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:{code:'invalid_input',message:'Confira os campos da fonte de contexto.'}});if(e instanceof DomainError||e instanceof MembershipError)return reply.code(e.statusCode).send({error:{code:e.code,message:e.message}});throw e;}};
 const access=(req:FastifyRequest)=>{const a=captureBeforeOperator(store,req);if(!['owner','admin'].includes(req.actor.role))fail(403,'forbidden');return a;};
 const agent=(req:FastifyRequest)=>z.object({id:uuid}).strict().parse(req.params).id;
 app.get('/api/v1/agents/:id/before-context/http-source',wrap(req=>{const a=access(req);const result=publicSource(store,a.tenantId,agent(req));a.assertCurrent();return result;}));
 app.put('/api/v1/agents/:id/before-context/http-source',{bodyLimit:65536},wrap(req=>{const a=access(req);const b=z.object({expectedTenantId:z.string().min(1).max(128),expectedRevision:revision,expectedBeforeRevision:revision,idempotencyKey:uuid,configuration:z.unknown(),secrets:secretInput}).strict().parse(req.body);return configureHttp(store,a,agent(req),{...b,configuration:b.configuration});}));
 app.get('/api/v1/before-context/http-config-operations/:key',wrap(req=>{const a=access(req),key=z.object({key:uuid}).strict().parse(req.params).key;return httpConfigReceipt(ownedHttpConfig(store,a,key));}));
 app.get('/api/v1/before-context/http-operations/:id',wrap(req=>{const a=access(req),id=z.object({id:uuid}).strict().parse(req.params).id,op=store.get(a.tenantId,httpOperations,id);if(!op||(op.scope as {surface?:string})?.surface!=='voice_incoming')return fail(404,'before_context_operation_not_found');const opening=store.get(a.tenantId,String(op.openingCollection),String(op.openingId));if(!opening)return fail(404,'before_context_operation_not_found');const view=httpView(store,opening);a.assertCurrent();return {tenantId:a.tenantId,openingId:opening.id,agentId:opening.agentId,httpSource:view};}));
 app.addHook('onClose',async()=>{await beforeHttpRuntime(store).close();});
}
