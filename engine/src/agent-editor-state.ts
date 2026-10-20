import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store, Entity } from './store.js';
import { canActivateAgent } from './billing/activation-gate.js';
import { agentSchema, DomainError, mergePatch, requireRecordingPermission } from './domains.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { resolveSessionContext, sameRequestContext } from './request-context.js';
import { agentEditorVersion, canonicalEditorJson, editorDigest, sanitizeAgentEditorState } from './agent-editor-state-schema.js';

export const agentEditorStates = 'agent-editor-states', agentEditorOperations = 'agent-editor-operations';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), key = z.string().uuid();
const common = { expectedTenantId:id, idempotencyKey:key, agent:z.record(z.unknown()), state:z.unknown() };
const createInput = z.object(common).strict();
const updateInput = createInput.extend({expectedRevision:z.number().int().nonnegative().safe(),expectedAgentVersion:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const fail = (code:string,status=409):never => { throw new DomainError(status,code,code); };
const operationView = (row:Entity) => ({key:row.key,kind:row.kind,agentId:row.agentId,tenantId:row.tenantId,expectedRevision:row.expectedRevision,revision:row.revision,agentVersion:row.agentVersion,fingerprint:row.fingerprint,status:'succeeded',createdAt:row.createdAt,automaticRetry:false});
const editable = (agent:Entity) => Object.fromEntries(Object.keys(agentSchema.shape).filter(key => agent[key] !== undefined).map(key => [key,agent[key]]));

/** Both runtime and editor state commit locally together; this route has no provider boundary. */
export async function registerAgentEditorState(app:FastifyInstance,store:Store) {
  const capture = (request:FastifyRequest,write=false) => {
    if (request.apiKey || request.headers.authorization || !request.cookies?.kloel_session) return fail('human_session_required',401);
    const actor = requireRequestPermission(store,request,write?'agents:write':'agents:read');
    const sessionHash = createHash('sha256').update(request.cookies.kloel_session).digest('hex');
    const session = resolveSessionContext(store,sessionHash);
    if (!session?.actor || session.actor.userId !== actor.userId || session.actor.tenantId !== actor.tenantId) return fail('unauthorized',401);
    return {...actor,sessionHash,context:session.context};
  };
  type Actor = ReturnType<typeof capture>;
  const principal = (a:Actor) => ({userId:a.userId,sessionHash:a.sessionHash,membershipId:a.context.membershipId,authorityVersion:a.context.authorityVersion});
  const owns = (row:Entity,a:Actor) => canonicalEditorJson(row.authority) === canonicalEditorJson(principal(a));
  const same = (request:FastifyRequest,a:Actor,write=false) => { const current=capture(request,write); if (!sameRequestContext(current.context,a.context)) fail('context_changed_in_flight'); return current; };
  const readAgent = (tenant:string,agentId:string) => store.get(tenant,'agents',agentId) ?? fail('not_found',404);
  const stateFor = (tenant:string,agentId:string) => {
    const found=store.list(tenant,agentEditorStates).filter(row=>row.agentId===agentId);
    if(found.length>1)fail('agent_editor_state_invalid');return found[0];
  };
  const operationFor = (tenant:string,operationKey:string) => store.list(tenant,agentEditorOperations).find(row=>row.key===operationKey);
  const view = (tenant:string,agentId:string) => {
    const agent=readAgent(tenant,agentId),row=stateFor(tenant,agentId),op=row?.operationId?store.get(tenant,agentEditorOperations,String(row.operationId)):undefined;
    if(row&&(!Number.isSafeInteger(row.revision)||Number(row.revision)<1||!op||op.agentId!==agentId||op.revision!==row.revision))fail('agent_editor_state_invalid');
    return {agent,agentVersion:agentEditorVersion(agent),revision:row?Number(row.revision):0,state:row?.state??{},lastWrite:op?operationView(op):null};
  };
  const wrap = (fn:(r:FastifyRequest)=>unknown) => async(r:FastifyRequest,p:any) => {
    p.header('Cache-Control','no-store');
    try{return await fn(r);}catch(e){if(e instanceof DomainError||e instanceof MembershipError)return p.code(e.statusCode).send({error:{code:e.code,message:e.message}});throw e;}
  };
  const params = (r:FastifyRequest) => z.object({id}).strict().parse(r.params).id;
  app.get('/api/v1/agents/editor-state/operations/:key',wrap(r=>{
    const a=capture(r,true),operationKey=z.object({key}).strict().parse(r.params).key,row=operationFor(a.tenantId,operationKey);
    if(!row||!owns(row,a))return fail('operation_not_found',404);same(r,a,true);return operationView(row);
  }));
  app.get('/api/v1/agents/:id/editor-state',wrap(r=>{const a=capture(r),result=view(a.tenantId,params(r));same(r,a);return result;}));

  const mutate = (request:FastifyRequest,creating:boolean) => {
    const a=capture(request,true),body=creating?createInput.parse(request.body):updateInput.parse(request.body);
    if(body.expectedTenantId!==a.tenantId)fail('context_mismatch');
    const agentId=creating?null:params(request),state=sanitizeAgentEditorState(body.state);
    const fingerprint=editorDigest({kind:creating?'create':'update',agentId,...body,state});
    return store.transaction(()=>{
      same(request,a,true);const old=operationFor(a.tenantId,body.idempotencyKey);
      if(old){if(!owns(old,a)||old.fingerprint!==fingerprint)fail('agent_editor_idempotency_conflict');return {...view(a.tenantId,String(old.agentId)),operation:operationView(old),replayed:true};}
      const prior=creating?undefined:readAgent(a.tenantId,agentId!),sidecar=prior?stateFor(a.tenantId,prior.id):undefined,currentRevision=sidecar?Number(sidecar.revision):0;
      if(!Number.isSafeInteger(currentRevision)||currentRevision<0||currentRevision===Number.MAX_SAFE_INTEGER)fail('agent_editor_revision_invalid');
      if(!creating){const b=body as z.infer<typeof updateInput>;if(b.expectedRevision!==currentRevision)fail('agent_editor_revision_conflict');if(b.expectedAgentVersion!==agentEditorVersion(prior))fail('agent_editor_agent_changed');}
      const patch=body.agent,allowed=new Set(Object.keys(agentSchema.shape));
      if(Object.keys(patch).some(key=>!allowed.has(key)))fail('invalid_patch',400);
      const data=agentSchema.parse(prior?mergePatch(editable(prior),patch):patch);
      if(data.status==='active'&&prior?.status!=='active'&&!canActivateAgent(store,a.tenantId))throw new DomainError(402,'plan_required','Assine um plano para ativar o assistente.');
      requireRecordingPermission(store,request,'agents',data,prior);
      let agent:Entity;
      if(!prior)agent=store.create(a.tenantId,'agents',data);
      else if(!Object.keys(patch).length||canonicalEditorJson(data)===canonicalEditorJson(agentSchema.parse(editable(prior))))agent=prior;
      else {
        const generation=prior.delegationGeneration??0;
        if(!Number.isSafeInteger(generation)||Number(generation)<0||Number(generation)>=Number.MAX_SAFE_INTEGER)fail('agent_delegation_version_invalid');
        agent=store.update(a.tenantId,'agents',prior.id,{...data,delegationGeneration:Number(generation)+1})!;
      }
      const operation=store.create(a.tenantId,agentEditorOperations,{key:body.idempotencyKey,kind:creating?'agent.editor.create':'agent.editor.update',agentId:agent.id,expectedRevision:currentRevision,revision:currentRevision+1,agentVersion:agentEditorVersion(agent),fingerprint,authority:principal(a)});
      const next={agentId:agent.id,revision:currentRevision+1,state,operationId:operation.id};
      if(sidecar)store.update(a.tenantId,agentEditorStates,sidecar.id,next);else store.create(a.tenantId,agentEditorStates,next);
      same(request,a,true);return {...view(a.tenantId,agent.id),operation:operationView(operation),replayed:false};
    });
  };
  app.post('/api/v1/agents/editor-state',async(r,p)=>{const handler=wrap(request=>mutate(request,true));const result=await handler(r,p);return p.sent?result:p.code(201).send(result);});
  app.put('/api/v1/agents/:id/editor-state',wrap(r=>mutate(r,false)));
}
