import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { DomainError } from './domains.js';
import { OAuthError } from './oauth/client.js';
import { privileged } from './oauth/access.js';
import { actionCollection,operationCollection,supportedTemplates,configureAction,integrationActor,publicAction,publicOperation,executeRegisteredIntegration } from './integrations/service.js';
import type { IntegrationTransport } from './integrations/transport.js';
import { integrationRuntimeMatrix } from './integrations/capabilities.js';
import { registerBaserowRoutes } from './integrations/baserow.js';
import { registerAirtableRoutes } from './integrations/airtable.js';
import { currentRequestActor } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { registerIntegrationConfigurations } from './integrations/configuration.js';

export {executeRegisteredIntegration,executeAgentIntegration,integrationAgentTools,assignedIntegrationTools} from './integrations/service.js';
export {baserowAgentTools,executeAgentBaserow} from './integrations/baserow.js';
export {airtableAgentTools,executeAgentAirtable} from './integrations/airtable.js';
const id=(req:FastifyRequest)=>z.object({id:z.string().uuid()}).parse(req.params).id;
export async function registerIntegrations(app:FastifyInstance,store:Store,transport?:IntegrationTransport){
  await registerIntegrationConfigurations(app,store,transport);
  await registerBaserowRoutes(app,store,transport);
  await registerAirtableRoutes(app,store,transport);
  const safe=(fn:(req:FastifyRequest,reply:FastifyReply)=>unknown|Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{
    try{currentRequestActor(store,req);return await fn(req,reply);}catch(e){
      try{currentRequestActor(store,req);}catch(accessError){e=accessError;}
      if(e instanceof MembershipError)return reply.code(e.statusCode).send({error:{code:e.code,message:e.message}});
      if(e instanceof DomainError||e instanceof OAuthError)return reply.code(e instanceof DomainError?e.statusCode:e.status).send({error:{code:e.code,message:e.message}});
      if(e instanceof z.ZodError)return reply.code(400).send({error:{code:'invalid_integration_input',message:'Dados de integração inválidos.'}});
      throw e;
    }
  };
  const access=(req:FastifyRequest)=>()=>{currentRequestActor(store,req);};
  app.get('/api/v1/integrations/registry',safe(req=>{
    const actor=integrationActor(store,req.actor),actions=store.list(actor.tenantId,actionCollection);
    return {items:supportedTemplates.map(template=>({...template,capabilities:['registered_https_request','json_arguments','encrypted_credentials','optional_hmac','idempotent_receipts'],nativeConnector:false,workflowCompletion:'not_verified',configuredActions:actions.filter(a=>a.template===template.id).length,status:actions.some(a=>a.template===template.id&&a.enabled)?'configured':'not_configured'}))};
  }));
  app.get('/api/v1/integrations/capabilities',safe(req=>integrationRuntimeMatrix(store,req.actor)));
  app.get('/api/v1/integrations/actions',safe(req=>{
    const actor=integrationActor(store,req.actor);
    return {items:store.list(actor.tenantId,actionCollection).filter(a=>privileged(actor)||(Array.isArray(a.allowedRoles)&&a.allowedRoles.includes(actor.role))).map(publicAction)};
  }));
  app.post('/api/v1/integrations/actions',safe((req,reply)=>reply.code(201).send(configureAction(store,req.actor,req.body,undefined,access(req)))));
  app.put('/api/v1/integrations/actions/:id',safe(req=>configureAction(store,req.actor,req.body,id(req),access(req))));
  app.patch('/api/v1/integrations/actions/:id',safe(req=>{
    const actor=integrationActor(store,req.actor,true),changes=z.object({enabled:z.boolean()}).strict().parse(req.body);
    const action=store.update(actor.tenantId,actionCollection,id(req),changes);
    if(!action)throw new DomainError(404,'action_not_found','Ação não encontrada.');return publicAction(action);
  }));
  app.post('/api/v1/integrations/actions/:id/execute',safe(req=>{
    const body=z.object({arguments:z.unknown()}).strict().parse(req.body);
    return executeRegisteredIntegration(store,req.actor,id(req),body.arguments,z.string().min(1).max(300).parse(req.headers['idempotency-key']),{transport,assertAccess:access(req)});
  }));
  app.get('/api/v1/integrations/operations',safe(req=>{
    const actor=integrationActor(store,req.actor);
    return {items:store.list(actor.tenantId,operationCollection).filter(o=>privileged(actor)||o.userId===actor.userId).map(publicOperation)};
  }));
  app.post('/api/v1/integrations/operations/:id/retry',safe(req=>{
    const actor=integrationActor(store,req.actor,true),operation=store.get(actor.tenantId,operationCollection,id(req));
    if(!operation)throw new DomainError(404,'operation_not_found','Recibo não encontrado.');
    if(operation.ownerKind==='after_http')throw new DomainError(409,'after_http_retry_forbidden','Esta operação não permite reenvio.');
    const body=z.object({arguments:z.unknown()}).strict().parse(req.body);
    return executeRegisteredIntegration(store,actor,String(operation.actionId),body.arguments,z.string().min(1).max(300).parse(req.headers['idempotency-key']),{transport,retryOperationId:operation.id,assertAccess:access(req)});
  }));
}
