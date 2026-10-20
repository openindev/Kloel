import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { createDomainAppointment, updateDomainAppointment, listCalendarSlots, DomainError } from '../domains.js';
import { accessible, oauthAuthorizationIdentity, type Actor } from './access.js';
import { createCalendarEvent, updateCalendarEvent, cancelCalendarEvent, readCalendarAvailability } from './calendar.js';
import { OAuthError } from './client.js';
import { digest } from './crypto.js';
import { authorizedOAuthActor, authorizedOAuthConnection } from './authorization.js';
import { hasPermission } from '../memberships/permissions.js';

type Context={tenantId:string;agent:Entity;actor?:Actor;assertAccess?:()=>void;recordResult?:(result:Record<string,unknown>)=>void};
type Tool={type:'function';name:string;description:string;parameters:Record<string,unknown>;strict:true};
const string={type:'string'},confirmed={type:'boolean'};
const definition=(name:string,description:string,properties:Record<string,unknown>):Tool=>({type:'function',name,description,parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false},strict:true});
const actions='oauth-agent-calendar-actions';
const base=z.object({calendarId:z.string().uuid()});
const moment=z.string().datetime({offset:true});

export function externalCalendarTools(agent:Entity,actor?:Actor):Tool[]{
  if(!actor||!hasPermission(actor.role,'integrations:execute')||actor.tenantId!==agent.tenantId||!(Array.isArray(agent.tools)&&agent.tools.includes('schedule_appointment')))return [];
  return [
    definition('external_list_calendars','List connected Google/Microsoft calendars explicitly assigned to this assistant and accessible to this authenticated operator.',{}),
    definition('external_list_calendar_slots','Find slots satisfying local opening hours and live Google/Microsoft busy times. Never claim availability if the provider fails.',{calendarId:string,from:string,to:string}),
    definition('external_create_appointment','After explicit confirmation, reserve locally and create the real Google/Microsoft event. Report synced only when returned; invitations may be sent by the provider.',{calendarId:string,title:string,startAt:string,endAt:string,timezone:string,confirmedByUser:confirmed}),
    definition('external_update_appointment','Reschedule this assistant appointment after confirmation. Do not claim synchronization if the remote update fails.',{calendarId:string,appointmentId:string,startAt:string,endAt:string,confirmedByUser:confirmed}),
    definition('external_cancel_appointment','Cancel this assistant appointment on the connected calendar only after confirmation. Provider may notify attendees.',{calendarId:string,appointmentId:string,confirmedByUser:confirmed}),
  ];
}

function authorize(store:Store,context:Context){
  context.assertAccess?.();
  const actor=context.actor,agent=store.get(context.tenantId,'agents',context.agent.id);
  if(!actor||actor.tenantId!==context.tenantId||!agent||agent.status==='paused'||agent.tenantId!==actor.tenantId||!Array.isArray(agent.tools)||!agent.tools.includes('schedule_appointment'))throw new OAuthError(403,'external_calendar_not_authorized','Calendário externo exige operador autenticado e recurso habilitado.');
  return {actor:authorizedOAuthActor(store,actor),agent};
}
function assigned(store:Store,actor:Actor,agent:Entity,id:string){
  const calendar=store.get(actor.tenantId,'calendars',id);
  if(!calendar||!calendar.enabled||calendar.agentId!==agent.id||!['google','microsoft'].includes(String(calendar.provider)))throw new OAuthError(404,'calendar_not_available','Calendário externo não atribuído a este assistente.');
  if(typeof calendar.connectionId!=='string')throw new OAuthError(503,'integration_disconnected','Calendário sem conta conectada.');
  const connection=authorizedOAuthConnection(store,actor,calendar.connectionId,'calendar');
  if(connection.provider!==calendar.provider||connection.status!=='connected'||!Array.isArray(connection.capabilities)||!connection.capabilities.includes('calendar'))throw new OAuthError(503,'integration_disconnected','Conexão de calendário indisponível.');
  return {calendar,connection,remoteCalendarId:typeof calendar.externalCalendarId==='string'&&calendar.externalCalendarId?calendar.externalCalendarId:'primary'};
}
function errorCode(e:unknown){return e instanceof OAuthError||e instanceof DomainError?e.code:e instanceof z.ZodError?'invalid_tool_arguments':'external_calendar_failed';}

export async function executeExternalCalendarTool(store:Store,context:Context,name:string,args:unknown,idempotencyKey:string):Promise<Record<string,unknown>>{
  let record:Entity|undefined,appointment:Entity|undefined,connectionId:string|undefined,remoteKey:string|undefined,appointmentTouched=false;
  try{
    const {actor,agent}=authorize(store,context);
    if(!externalCalendarTools(agent,actor).some(t=>t.name===name))throw new OAuthError(403,'tool_not_enabled','Ferramenta não habilitada.');
    if(name==='external_list_calendars'){
      z.object({}).strict().parse(args);
      const calendars=store.list(actor.tenantId,'calendars').filter(c=>c.enabled&&c.agentId===agent.id&&['google','microsoft'].includes(String(c.provider))).filter(c=>{
        const connection=typeof c.connectionId==='string'?store.get(actor.tenantId,'oauth-connections',c.connectionId):undefined;
        return connection&&connection.status==='connected'&&accessible(actor,connection)&&connection.provider===c.provider;
      }).map(c=>({id:c.id,name:c.name,timezone:c.timezone,provider:c.provider,appointmentDurationMinutes:c.appointmentDurationMinutes}));
      return {ok:true,calendars};
    }
    const {calendarId}=base.passthrough().parse(args);
    const selected=assigned(store,actor,agent,calendarId),calendar=selected.calendar;
    const assertAccess=()=>{
      const current=authorize(store,context),latest=assigned(store,current.actor,current.agent,calendarId);
      if(digest(JSON.stringify(latest.calendar))!==digest(JSON.stringify(calendar))||oauthAuthorizationIdentity(latest.connection)!==oauthAuthorizationIdentity(selected.connection))throw new OAuthError(409,'external_calendar_context_changed','A agenda ou sua autorização mudou durante a operação.');
    };
    connectionId=selected.connection.id;
    if(name==='external_list_calendar_slots'){
      const q=base.extend({from:moment,to:moment}).strict().parse(args);
      const local=listCalendarSlots(store,actor.tenantId,q);
      const buffer=Number(calendar.bufferMinutes||0)*60_000;
      const availability=await readCalendarAvailability(store,actor,connectionId,{calendarId:selected.remoteCalendarId,from:new Date(Date.parse(q.from)-buffer).toISOString(),to:new Date(Date.parse(q.to)+buffer).toISOString()},assertAccess);
      assertAccess();
      const slots=local.slots.filter(slot=>!availability.busy.some(b=>Date.parse(slot.startAt)<Date.parse(b.end)+buffer&&Date.parse(slot.endAt)+buffer>Date.parse(b.start)));
      return {ok:true,...local,slots,source:'local_and_external_calendar',provider:calendar.provider,externalAvailabilityChecked:true};
    }
    if(!(selected.connection.capabilities as string[]).includes('calendar_write'))throw new OAuthError(403,'capability_not_authorized','Autorize escrita no calendário.');
    const key=z.string().min(1).max(1000).parse(idempotencyKey);
    const keyHash=digest(`${agent.id}:${actor.userId}:${key}`),fingerprint=digest(JSON.stringify({name,args}));
    const old=store.list(actor.tenantId,actions).find(r=>r.keyHash===keyHash);
    if(old){if(old.fingerprint!==fingerprint)throw new OAuthError(409,'idempotency_conflict','A chave já pertence a outra operação.');return old.result as Record<string,unknown>||{ok:false,error:'external_calendar_requires_reconciliation'};}
    remoteKey=digest(`agent-calendar:${keyHash}`);
    let input:any;
    if(name==='external_create_appointment'){
      input=base.extend({title:z.string().min(1).max(200),startAt:moment,endAt:moment,timezone:z.string().min(1),confirmedByUser:z.literal(true)}).strict().parse(args);
      if(Date.parse(input.startAt)<Date.now())throw new OAuthError(400,'appointment_in_past','Escolha um horário futuro.');
    }else{
      input=base.extend({appointmentId:z.string().uuid(),confirmedByUser:z.literal(true),...(name==='external_update_appointment'?{startAt:moment,endAt:moment}:{})}).strict().parse(args);
      appointment=store.get(actor.tenantId,'appointments',input.appointmentId);
      if(!appointment||appointment.agentId!==agent.id||appointment.calendarId!==calendar.id)throw new OAuthError(404,'appointment_not_found','Agendamento não pertence a este assistente e calendário.');
      if(appointment.syncStatus!=='synced'||typeof appointment.externalEventId!=='string'||appointment.status!=='scheduled')throw new OAuthError(409,'appointment_requires_reconciliation','Confirme o estado remoto antes de alterar este agendamento.');
      if(name==='external_update_appointment'&&Date.parse(input.startAt)<Date.now())throw new OAuthError(400,'appointment_in_past','Escolha um horário futuro.');
    }
    record=store.transaction(()=>{assertAccess();return store.create(actor.tenantId,actions,{keyHash,fingerprint,name,agentId:agent.id,userId:actor.userId,calendarId:calendar.id,status:'pending'});});
    if(name==='external_create_appointment'){
      const {confirmedByUser:_confirmation,...localInput}=input;
      appointment=createDomainAppointment(store,actor.tenantId,{...localInput,agentId:agent.id},assertAccess);
      appointmentTouched=true;
      appointment=store.update(actor.tenantId,'appointments',appointment.id,{syncStatus:'pending',connectionId})!;
      const result:any=await createCalendarEvent(store,actor,connectionId,{calendarId:selected.remoteCalendarId,title:input.title,startAt:input.startAt,endAt:input.endAt},remoteKey,assertAccess);
      appointment=store.update(actor.tenantId,'appointments',appointment.id,{syncStatus:'synced',externalEventId:result.event.id,providerOperationId:result.operationId,lastSyncedAt:new Date().toISOString()})!;
    }else if(name==='external_update_appointment'){
      const before={startAt:appointment!.startAt,endAt:appointment!.endAt};
      appointment=updateDomainAppointment(store,actor.tenantId,appointment!.id,{startAt:input.startAt,endAt:input.endAt},assertAccess);
      appointmentTouched=true;
      appointment=store.update(actor.tenantId,'appointments',appointment!.id,{syncStatus:'pending',previousSyncInterval:before})!;
      const result:any=await updateCalendarEvent(store,actor,connectionId,String(appointment.externalEventId),{calendarId:selected.remoteCalendarId,startAt:input.startAt,endAt:input.endAt},remoteKey,assertAccess);
      appointment=store.update(actor.tenantId,'appointments',appointment.id,{syncStatus:'synced',providerOperationId:result.operationId,previousSyncInterval:null,lastSyncedAt:new Date().toISOString()})!;
    }else{
      appointmentTouched=true;
      appointment=store.update(actor.tenantId,'appointments',appointment!.id,{syncStatus:'pending'})!;
      assertAccess();
      const result:any=await cancelCalendarEvent(store,actor,connectionId,String(appointment.externalEventId),{calendarId:selected.remoteCalendarId},remoteKey,assertAccess);
      appointment=updateDomainAppointment(store,actor.tenantId,appointment.id,{status:'cancelled'});
      appointment=store.update(actor.tenantId,'appointments',appointment!.id,{syncStatus:'synced',providerOperationId:result.operationId,lastSyncedAt:new Date().toISOString()})!;
    }
    const result={ok:true,appointment,externalSync:true,provider:calendar.provider,invitationDelivery:'not_confirmed'};
    store.update(actor.tenantId,actions,record.id,{status:'completed',appointmentId:appointment.id,result});
    context.recordResult?.(result);
    assertAccess();
    return result;
  }catch(e){
    let uncertain=false;
    const remoteReceipt=connectionId&&remoteKey?store.list(context.tenantId,'oauth-calendar-operations').find(r=>r.connectionId===connectionId&&r.keyHash===digest(`${connectionId}:${remoteKey}`)):undefined;
    uncertain=!!remoteReceipt&&['pending','uncertain'].includes(String(remoteReceipt.status));
    // A completed provider receipt remains authoritative after HTTP/session revocation.
    // Reconcile only its already accepted effect; do not send or acquire new authority.
    const completed=remoteReceipt?.status==='completed'?remoteReceipt.result as {operationId?:unknown;provider?:unknown;event?:{id?:unknown}}:undefined;
    if(appointment&&record&&appointmentTouched&&completed&&typeof completed.operationId==='string'&&typeof completed.event?.id==='string'){
      appointment=store.update(context.tenantId,'appointments',appointment.id,{syncStatus:'synced',externalEventId:completed.event.id,providerOperationId:completed.operationId,previousSyncInterval:null,syncError:null,lastSyncedAt:new Date().toISOString(),...(name==='external_cancel_appointment'?{status:'cancelled'}:{})})!;
      const known={ok:true,appointment,externalSync:true,provider:completed.provider,invitationDelivery:'not_confirmed'};
      store.update(context.tenantId,actions,record.id,{status:'completed',appointmentId:appointment.id,result:known});
      context.recordResult?.(known);
      return {ok:false,error:errorCode(e),externalSync:false,requiresReconciliation:false};
    }
    if(appointment&&record&&appointmentTouched){
      const changes:Record<string,unknown>={syncStatus:uncertain?'pending_reconciliation':'failed',syncError:errorCode(e)};
      if(name==='external_create_appointment'&&!uncertain)changes.status='cancelled';
      if(name==='external_update_appointment'&&!uncertain&&appointment.previousSyncInterval&&typeof appointment.previousSyncInterval==='object')Object.assign(changes,appointment.previousSyncInterval,{previousSyncInterval:null});
      appointment=store.update(context.tenantId,'appointments',appointment.id,changes)!;
    }
    const result={ok:false,error:errorCode(e),externalSync:false,...(appointment?{appointmentId:appointment.id,syncStatus:appointment.syncStatus}:{}),requiresReconciliation:uncertain};
    if(record)store.update(context.tenantId,actions,record.id,{status:uncertain?'uncertain':'failed',appointmentId:appointment?.id,result});
    return result;
  }
}
