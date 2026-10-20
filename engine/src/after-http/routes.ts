import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store.js';
import { DomainError } from '../domains.js';
import { MembershipError } from '../memberships/service.js';
import { capture, initialize } from './authority.js';
import { configure, detail, history, original, projectConfiguration } from './service.js';
import { configureSchema, uuid } from './schema.js';
import { createAfterHttpWorker } from './worker.js';
export async function registerAfterHttp(app:FastifyInstance,store:Store) {
 initialize(store);const worker=createAfterHttpWorker(store),params=z.object({id:uuid}).strict(),key=z.object({key:uuid}).strict();
 const wrap=(fn:(r:FastifyRequest)=>unknown)=>async(r:FastifyRequest,reply:any)=>{try{return await fn(r);}catch(e){if(e instanceof DomainError||e instanceof MembershipError)return reply.code(e.statusCode).send({error:{code:e.code,message:e.message}});if(e instanceof z.ZodError)return reply.code(400).send({error:{code:'validation_error',message:'Configuração HTTP inválida.'}});throw e;}};
 app.get('/api/v1/agents/:id/after-http',wrap(r=>projectConfiguration(store,capture(store,r,['agents:read']),params.parse(r.params).id)));
 app.put('/api/v1/agents/:id/after-http',wrap(r=>configure(store,capture(store,r,['agents:write','integrations:manage','integrations:execute']),params.parse(r.params).id,configureSchema.parse(r.body))));
 app.get('/api/v1/after-http/config-operations/:key',wrap(r=>original(store,capture(store,r,['agents:read']),key.parse(r.params).key)));
 app.get('/api/v1/conversations/:id/after-http-operations',wrap(r=>{const a=capture(store,r,['conversations:read']),q=z.object({cursor:uuid.optional()}).strict().parse(r.query);return history(store,a.tenantId,params.parse(r.params).id,q.cursor);}));
 app.get('/api/v1/after-http/operations/:id',wrap(r=>detail(store,capture(store,r,['conversations:read']).tenantId,params.parse(r.params).id)));
 app.addHook('onClose',async()=>{await worker.stop();});return worker;
}
