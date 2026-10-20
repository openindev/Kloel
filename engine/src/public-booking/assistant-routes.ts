import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Store, Entity } from '../store.js';
import { BookingError } from './authority.js';
import { OAuthError } from '../oauth/client.js';
import { MembershipError } from '../memberships/service.js';
import { DomainError } from '../domains.js';
import { PublicBookingService } from './service.js';
import { bookingActions, bookingActionReceipts, privateAudience, publicAudience, assertAudience, ownerScope, scope, hash, fail, uuid, revision, configuration, projectAction, actionOptions, initializeAssistantBooking, type Audience } from './assistant-authority.js';
import { assistantSlots, createAssistantBooking, getAssistantBooking, assistantManagementLink, chatReceipt, choicesFor, operationsFor } from './assistant-booking.js';

const publicBase='/api/v1/public/chat';
export const ASSISTANT_BOOKING_PUBLIC_PATHS=new Set(['booking-slots','bookings','booking-operation','booking-management-link'].map(p=>`${publicBase}/${p}`));
function actionReceipt(r:Entity){return{key:String(r.key),kind:r.kind,actionId:String(r.actionId),agentId:String(r.agentId),revision:Number(r.revision),enabled:r.enabled===true,allowCreate:r.allowCreate===true,status:'succeeded' as const,automaticRetry:false as const,createdAt:r.createdAt};}
export async function registerAssistantBooking(app:FastifyInstance,store:Store,core:PublicBookingService){
  initializeAssistantBooking(store);
  const safe=(fn:(req:FastifyRequest,reply:FastifyReply)=>unknown)=>async(req:FastifyRequest,reply:FastifyReply)=>{
    reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
    try{return await fn(req,reply);}catch(e){
      if(e instanceof z.ZodError)return reply.code(400).send({error:{code:'invalid_input',message:'Confira os dados do agendamento.'}});
      if(e instanceof BookingError||e instanceof OAuthError||e instanceof MembershipError||e instanceof DomainError)return reply.code(e instanceof MembershipError || e instanceof DomainError ? e.statusCode : e.status).send({error:{code:e.code,message:'O agendamento mudou ou está indisponível. Consulte a referência original.'}});
      return reply.code(502).send({error:{code:'booking_operation_failed',message:'Não foi possível confirmar a operação. Consulte a referência original; não repita o envio.'}});
    }
  };
  const privateRoute=(fn:(req:FastifyRequest,a:Audience)=>unknown)=>safe(async req=>{const a=privateAudience(store,req);const result=await fn(req,a);assertAudience(store,a,core.now());return result;});
  const agentId=(req:FastifyRequest)=>z.object({agentId:uuid}).parse(req.params).agentId;
  const stripTenant=(req:FastifyRequest,a:Audience)=>{const{expectedTenantId,...body}=z.object({expectedTenantId:z.string()}).passthrough().parse(req.body);if(expectedTenantId!==a.tenantId)fail(409,'tenant_mismatch');return body;};
  app.get('/api/v1/agents/:agentId/booking-actions',privateRoute((req,a)=>({items:store.list(a.tenantId,bookingActions).filter(r=>r.agentId===agentId(req)&&a.kind==='private'&&r.issuerUserId===a.operator.actor.userId).map(r=>projectAction(store,r,a,core.now()))})));
  app.get('/api/v1/agents/:agentId/booking-actions/options',privateRoute((req,a)=>actionOptions(store,a,agentId(req))));
  const write=(update:boolean)=>privateRoute((req,a)=>{
    if(a.kind!=='private')return fail(403,'booking_owner_required');const id=agentId(req),raw=stripTenant(req,a);
    const body=update?z.object({idempotencyKey:uuid,expectedRevision:revision,enabled:z.boolean(),allowCreate:z.boolean(),expiresInDays:z.number().int().min(1).max(30),maxBookingsPerDay:z.number().int().min(1).max(100)}).strict().parse(raw):z.object({idempotencyKey:uuid,eventTypeId:uuid,audience:z.enum(['private','webchat']),channelId:uuid.nullable()}).strict().parse(raw);
    const targetId=update?z.object({id:uuid}).parse(req.params).id:null,kind=update?'booking.action.update':'booking.action.create',fingerprint=hash([kind,id,targetId,body]);
    return store.transaction(()=>{
      assertAudience(store,a,core.now());const old=store.list(a.tenantId,bookingActionReceipts).find(r=>r.key===body.idempotencyKey);
      if(old){if(hash(old.authority)!==hash(ownerScope(a.operator))||old.fingerprint!==fingerprint)return fail(409,'booking_idempotency_conflict');return{operation:actionReceipt(old),replayed:true};}
      let action:Entity;
      if('eventTypeId' in body){
        if(body.audience==='private'&&body.channelId!==null||body.audience==='webchat'&&body.channelId===null)fail(400,'invalid_input');
        const list=store.list(a.tenantId,bookingActions).filter(r=>r.agentId===id);if(list.length>=10||list.some(r=>r.eventTypeId===body.eventTypeId&&r.audience===body.audience&&r.channelId===body.channelId))fail(409,'booking_action_exists');
        const t=configuration(store,a.tenantId,id,body.eventTypeId,body.audience,body.channelId,a.operator.actor.userId);
        action=store.create(a.tenantId,bookingActions,{agentId:id,eventTypeId:body.eventTypeId,audience:body.audience,channelId:body.channelId,revision:1,enabled:false,allowCreate:false,expiresAt:core.now()+86400000,maxBookingsPerDay:10,issuerUserId:a.operator.actor.userId,snapshot:t.snapshot,grantId:t.grant!.id,calendarId:t.calendar.id,invalidated:false});
      }else{
        const oldAction=store.get(a.tenantId,bookingActions,targetId!);if(!oldAction||oldAction.agentId!==id||oldAction.issuerUserId!==a.operator.actor.userId) return fail(404,'booking_action_not_found');
        if(oldAction.revision!==body.expectedRevision)return fail(409,'booking_action_revision_conflict');
        const t=body.enabled?configuration(store,a.tenantId,id,String(oldAction.eventTypeId),String(oldAction.audience),oldAction.channelId,a.operator.actor.userId):undefined;
        action=store.update(a.tenantId,bookingActions,oldAction.id,{revision:Number(oldAction.revision)+1,enabled:body.enabled,allowCreate:body.allowCreate,expiresAt:core.now()+body.expiresInDays*86400000,maxBookingsPerDay:body.maxBookingsPerDay,...(t?{snapshot:t.snapshot,grantId:t.grant!.id,calendarId:t.calendar.id,invalidated:false}:{})})!;
      }
      const r=store.create(a.tenantId,bookingActionReceipts,{key:body.idempotencyKey,kind,fingerprint,authority:ownerScope(a.operator),actionId:action.id,agentId:id,revision:action.revision,enabled:action.enabled,allowCreate:action.allowCreate});assertAudience(store,a,core.now());return{operation:actionReceipt(r),replayed:false};
    });
  });
  app.post('/api/v1/agents/:agentId/booking-actions',write(false));app.put('/api/v1/agents/:agentId/booking-actions/:id',write(true));
  app.get('/api/v1/booking-action-operations/:key',privateRoute((req,a)=>{const key=z.object({key:uuid}).parse(req.params).key,r=store.list(a.tenantId,bookingActionReceipts).find(r=>r.key===key);if(a.kind!=='private'||!r||hash(r.authority)!==hash(ownerScope(a.operator)))return fail(404,'booking_operation_not_found');return actionReceipt(r);}));
  app.post('/api/v1/ai/conversations/:id/booking-slots',privateRoute((req,a)=>assistantSlots(core,a,z.object({id:uuid}).parse(req.params).id,stripTenant(req,a))));
  app.post('/api/v1/ai/conversations/:id/bookings',privateRoute((req,a)=>createAssistantBooking(core,a,z.object({id:uuid}).parse(req.params).id,stripTenant(req,a))));
  app.get('/api/v1/ai/booking-operations/:key',privateRoute((req,a)=>getAssistantBooking(store,a,z.object({key:uuid}).parse(req.params).key,core.now())));
  app.get('/api/v1/ai/booking-chat-operations/:key',privateRoute((req,a)=>{const key=z.object({key:z.string().min(1).max(200)}).parse(req.params).key,r=chatReceipt(store,a,key);return{bookingChoices:choicesFor(store,a,String(r.chatConversationId),core.now(),r.id),bookingOperations:operationsFor(store,a,String(r.chatConversationId),core.now(),r.id)};}));
  app.post('/api/v1/ai/booking-operations/:key/management-link',privateRoute((req,a)=>{z.object({}).strict().parse(req.body??{});return assistantManagementLink(core,a,z.object({key:uuid}).parse(req.params).key);}));
  const routeOptions={bodyLimit:8192,config:{cors:false as const}};
  const publicRoute=(fn:(req:FastifyRequest,a:Audience)=>unknown)=>safe(async(req,reply)=>{const a=publicAudience(store,req,core.now());if(a.kind!=='webchat')return fail(401,'booking_session_expired');reply.header('Access-Control-Allow-Origin',a.origin).header('Vary','Origin');const result=await fn(req,a);assertAudience(store,a,core.now());return result;});
  for(const path of ASSISTANT_BOOKING_PUBLIC_PATHS)app.options(path,routeOptions,safe((req,reply)=>{
    const q=z.object({tenantId:z.string().min(1).max(128),channelId:uuid,operationKey:uuid.optional()}).strict().parse(req.query),origin=req.headers.origin,method=path.endsWith('/booking-operation')?'GET':'POST';
    const s=store.list(q.tenantId,'public-chat-sessions').some(s=>s.channelId===q.channelId&&s.origin===origin&&Number(s.expiresAt)>core.now()&&['active','ended'].includes(String(s.status)));
    if(!s||typeof origin!=='string'||req.headers['access-control-request-method']!==method||String(req.headers['access-control-request-headers']??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).some(s=>!['authorization','content-type'].includes(s)))return fail(403,'booking_origin_forbidden');
    return reply.header('Access-Control-Allow-Origin',origin).header('Vary','Origin').header('Access-Control-Allow-Methods',method).header('Access-Control-Allow-Headers','Authorization, Content-Type').code(204).send();
  }));
  app.post(`${publicBase}/booking-slots`,routeOptions,publicRoute((req,a)=>assistantSlots(core,a,a.kind==='webchat'?a.conversationId:'',req.body)));
  app.post(`${publicBase}/bookings`,routeOptions,publicRoute((req,a)=>createAssistantBooking(core,a,a.kind==='webchat'?a.conversationId:'',req.body)));
  app.get(`${publicBase}/booking-operation`,routeOptions,publicRoute((req,a)=>getAssistantBooking(store,a,z.object({operationKey:uuid}).passthrough().parse(req.query).operationKey,core.now())));
  app.post(`${publicBase}/booking-management-link`,routeOptions,publicRoute((req,a)=>assistantManagementLink(core,a,z.object({operationKey:uuid}).strict().parse(req.body).operationKey)));
}
