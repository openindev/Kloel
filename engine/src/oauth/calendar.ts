import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { OAuthError } from './client.js';
import { digest } from './crypto.js';
import { type Actor } from './access.js';
import { authorizedOAuthConnection, authorizedOAuthRequest, requestOAuthGuard } from './authorization.js';

const resourceId=z.string().min(1).max(1024).refine(v=>v!=='.'&&v!=='..');
const date=z.string().datetime({offset:true});
const calendarId=resourceId.default('primary');
const rangeSchema=z.object({calendarId,from:date,to:date}).strict();
const createSchema=z.object({calendarId,title:z.string().min(1).max(500),startAt:date,endAt:date,description:z.string().max(10000).optional(),attendeeEmails:z.array(z.string().email().max(254)).max(50).default([]),location:z.string().max(1000).optional()}).strict();
const updateSchema=createSchema.omit({calendarId:true}).partial().extend({calendarId}).strict().refine(v=>Boolean(v.startAt)===Boolean(v.endAt),{message:'startAt and endAt must be provided together'}).refine(v=>Object.keys(v).some(k=>k!=='calendarId'),{message:'No changes'});
const receipts='oauth-calendar-operations';
type Busy={start:string;end:string;eventId:string};
export type CalendarEventInput=z.input<typeof createSchema>;

function range(from:string,to:string){if(Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>93*86400000)throw new OAuthError(400,'invalid_time_range','Use um intervalo positivo de até 93 dias.');}
function calendarConnection(store:Store,actor:Actor,id:string,write=false){
  const c=authorizedOAuthConnection(store,actor,id,write?'calendar_write':'calendar');
  if(c.status!=='connected')throw new OAuthError(503,'integration_disconnected','Conexão de calendário desconectada.');
  if(!(c.capabilities as string[]).includes(write?'calendar_write':'calendar'))throw new OAuthError(403,'capability_not_authorized',write?'Autorize explicitamente a escrita na agenda.':'Autorize acesso à agenda.');
  return c;
}
function eventsUrl(c:Entity,calendar:string,eventId?:string){
  const root=c.provider==='google'?`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`:`https://graph.microsoft.com/v1.0/me/${calendar==='primary'?'calendar':`calendars/${encodeURIComponent(calendar)}`}/events`;
  return new URL(root+(eventId?`/${encodeURIComponent(eventId)}`:''));
}

/** Finds the first instant on a provider calendar date, including DST shifts at midnight. */
function dateBoundary(dateValue:unknown,timeZone:unknown):string {
  if(typeof dateValue!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)||typeof timeZone!=='string')throw new OAuthError(502,'provider_response_invalid','Data ou fuso horário de evento de dia inteiro indisponível.');
  try{
    const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
    const dayAt=(instant:number)=>{const parts=Object.fromEntries(format.formatToParts(instant).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
    const anchor=Date.parse(`${dateValue}T00:00:00Z`);
    if(!Number.isFinite(anchor)||new Date(anchor).toISOString().slice(0,10)!==dateValue)throw new Error('invalid_date');
    let low=anchor-48*3600000,high=anchor+48*3600000;
    while(high-low>1000){const middle=Math.floor((low+high)/2000)*1000;if(dayAt(middle)<dateValue)low=middle;else high=middle;}
    return new Date(high).toISOString();
  }catch{throw new OAuthError(502,'provider_response_invalid','Não foi possível resolver o fuso horário do calendário.');}
}

/** Only lists busy time. It never reserves a slot or claims that an external calendar is atomically locked. */
export async function readCalendarAvailability(store:Store,actor:Actor,connectionId:string,input:z.input<typeof rangeSchema>,assertAccess?:()=>void) {
  assertAccess?.();
  const q=rangeSchema.parse(input);range(q.from,q.to);
  const c=calendarConnection(store,actor,connectionId);
  const url=eventsUrl(c,q.calendarId);
  if(c.provider==='google'){
    url.searchParams.set('timeMin',q.from);url.searchParams.set('timeMax',q.to);url.searchParams.set('singleEvents','true');url.searchParams.set('maxResults','2500');
  }else{
    url.pathname=url.pathname.replace(/\/events$/,'/calendarView');url.searchParams.set('startDateTime',q.from);url.searchParams.set('endDateTime',q.to);url.searchParams.set('$top','1000');
    url.searchParams.set('$select','id,start,end,showAs,isCancelled,isAllDay');
  }
  const busy:Busy[]=[];
  for(let page=0;page<20;page++){
    const data=await authorizedOAuthRequest(store,actor,c,url.toString(),{headers:{Prefer:'outlook.timezone="UTC"'}},false,'calendar',assertAccess);
    const items=c.provider==='google'?(data.items||[]):(data.value||[]);
    if(!Array.isArray(items))throw new OAuthError(502,'provider_response_invalid','Resposta de disponibilidade inválida.');
    for(const item of items){
      if(c.provider==='google'?(item.status==='cancelled'||item.transparency==='transparent'):(item.isCancelled||item.showAs==='free'))continue;
      if(typeof item.id!=='string')throw new OAuthError(502,'provider_response_invalid','Evento sem identificação.');
      if(item.start?.date){
        const start=dateBoundary(item.start.date,item.start.timeZone||data.timeZone),end=dateBoundary(item.end?.date,item.end?.timeZone||item.start.timeZone||data.timeZone);
        if(Date.parse(end)<=Date.parse(start))throw new OAuthError(502,'provider_response_invalid','Intervalo de evento inválido.');
        busy.push({start,end,eventId:item.id});continue;
      }
      const stamp=(value:any)=>{
        if(typeof value?.dateTime!=='string')throw new OAuthError(502,'provider_response_invalid','Evento sem intervalo válido.');
        let result=value.dateTime;
        if(!/(Z|[+-]\d\d:\d\d)$/.test(result)){
          if(c.provider!=='microsoft'||!['UTC','Etc/UTC'].includes(value.timeZone))throw new OAuthError(502,'provider_response_invalid','Fuso horário do evento não reconhecido.');
          result+='Z';
        }
        const milliseconds=Date.parse(result);
        if(!Number.isFinite(milliseconds))throw new OAuthError(502,'provider_response_invalid','Intervalo de evento inválido.');
        return new Date(milliseconds).toISOString();
      };
      const start=stamp(item.start),end=stamp(item.end);
      if(Date.parse(end)<=Date.parse(start))throw new OAuthError(502,'provider_response_invalid','Intervalo de evento inválido.');
      busy.push({start,end,eventId:item.id});
    }
    if(c.provider==='google'){
      if(!data.nextPageToken)return {busy,complete:true as const,source:c.provider};
      if(typeof data.nextPageToken!=='string')throw new OAuthError(502,'provider_response_invalid','Cursor inválido.');
      url.searchParams.set('pageToken',data.nextPageToken);
    }else{
      if(!data['@odata.nextLink'])return {busy,complete:true as const,source:c.provider};
      let next:URL;
      try{next=new URL(data['@odata.nextLink']);}catch{throw new OAuthError(502,'provider_response_invalid','Cursor inválido.');}
      if(next.origin!==url.origin||next.pathname!==url.pathname)throw new OAuthError(502,'provider_response_invalid','Destino de paginação inválido.');
      const parameter=next.searchParams.has('$skiptoken')?'$skiptoken':'$skip';
      const value=next.searchParams.get(parameter);
      if(value===null)throw new OAuthError(502,'provider_response_invalid','Cursor inválido.');
      url.searchParams.delete('$skip');url.searchParams.delete('$skiptoken');url.searchParams.set(parameter,value);
    }
  }
  throw new OAuthError(503,'availability_incomplete','A agenda exige mais páginas do que o limite seguro. Restrinja o intervalo.');
}

const overlaps=(a:string,b:string,c:string,d:string)=>Date.parse(a)<Date.parse(d)&&Date.parse(b)>Date.parse(c);
async function mutate(store:Store,actor:Actor,connectionId:string,operation:'create'|'update'|'cancel',input:any,idempotencyKey:string,eventId?:string,assertAccess?:()=>void){
  assertAccess?.();
  const c=calendarConnection(store,actor,connectionId,true);
  const requestKey=z.string().min(8).max(200).regex(/^[a-zA-Z0-9._:-]+$/).parse(idempotencyKey);
  const bodyHash=digest(JSON.stringify({operation,input,eventId:eventId||null}));
  const keyHash=digest(`${c.id}:${requestKey}`);
  const acquired=store.transaction(()=>{
    assertAccess?.();
    calendarConnection(store,actor,connectionId,true);
    const all=store.list(actor.tenantId,receipts);
    const old=all.find(row=>row.connectionId===c.id&&row.keyHash===keyHash);
    if(old){
      if(old.bodyHash!==bodyHash)throw new OAuthError(409,'idempotency_conflict','Esta chave já foi usada com outra operação.');
      if(old.status==='completed')return {replay:old.result};
      throw new OAuthError(409,old.status==='uncertain'?'operation_outcome_unknown':'operation_in_progress','A operação já foi iniciada; consulte seu resultado antes de tentar outra chave.');
    }
    if(input.startAt&&all.some(row=>row.connectionId===c.id&&row.calendarId===input.calendarId&&['pending','uncertain'].includes(String(row.status))&&typeof row.startAt==='string'&&typeof row.endAt==='string'&&overlaps(input.startAt,input.endAt,row.startAt,row.endAt)))throw new OAuthError(409,'calendar_busy','Existe uma reserva em processamento neste intervalo.');
    return {receipt:store.create(actor.tenantId,receipts,{connectionId:c.id,userId:actor.userId,keyHash,bodyHash,operation,calendarId:input.calendarId,eventId:eventId||null,startAt:input.startAt,endAt:input.endAt,status:'pending'})};
  });
  if('replay' in acquired)return acquired.replay;
  const receipt=acquired.receipt!;
  let mutationStarted=false;
  try{
    if(input.startAt){
      const availability=await readCalendarAvailability(store,actor,connectionId,{calendarId:input.calendarId,from:input.startAt,to:input.endAt},assertAccess);
      if(availability.busy.some(b=>b.eventId!==eventId&&overlaps(input.startAt,input.endAt,b.start,b.end)))throw new OAuthError(409,'calendar_busy','Este horário está ocupado no calendário conectado.');
    }
    // Recheck ownership/status after external reads, before the side effect.
    assertAccess?.();
    const current=calendarConnection(store,actor,connectionId,true);
    const url=eventsUrl(current,input.calendarId,eventId);
    if(current.provider==='google')url.searchParams.set('sendUpdates','all');
    const body:Record<string,unknown>={};
    if(operation!=='cancel'){
      if(input.title!==undefined)body[current.provider==='google'?'summary':'subject']=input.title;
      if(input.description!==undefined){if(current.provider==='google')body.description=input.description;else body.body={contentType:'text',content:input.description};}
      if(input.location!==undefined)body.location=current.provider==='google'?input.location:{displayName:input.location};
      if(input.startAt){
        body.start=current.provider==='google'?{dateTime:input.startAt}:{dateTime:new Date(input.startAt).toISOString().replace(/Z$/,''),timeZone:'UTC'};
        body.end=current.provider==='google'?{dateTime:input.endAt}:{dateTime:new Date(input.endAt).toISOString().replace(/Z$/,''),timeZone:'UTC'};
      }
      if(input.attendeeEmails!==undefined)body.attendees=input.attendeeEmails.map((email:string)=>current.provider==='google'?{email}:{emailAddress:{address:email},type:'required'});
      if(operation==='create')body[current.provider==='google'?'id':'transactionId']=current.provider==='google'?`k${keyHash.slice(0,40)}`:keyHash;
    }
    mutationStarted=true;
    let result:Record<string,unknown>|undefined;
    const recordResponse=(event:Record<string,any>)=>{
      if(operation!=='cancel'&&typeof event.id!=='string')throw new OAuthError(502,'provider_response_invalid','O provedor não retornou o identificador do evento.');
      result={operationId:receipt.id,provider:c.provider,event:operation==='cancel'?{id:eventId,status:'cancelled'}:event};
      store.update(actor.tenantId,receipts,receipt.id,{status:'completed',result,completedAt:new Date().toISOString()});
    };
    const event=await authorizedOAuthRequest(store,actor,current,url.toString(),{method:operation==='create'?'POST':operation==='update'?'PATCH':'DELETE',headers:{'Content-Type':'application/json'},...(operation!=='cancel'?{body:JSON.stringify(body)}:{})},operation==='cancel','calendar_write',assertAccess,assertAccess?recordResponse:undefined);
    if(!assertAccess)recordResponse(event);
    assertAccess?.();
    return result;
  }catch(e){
    // A failed read has no remote side effect. A timed-out write can have succeeded remotely.
    if(!mutationStarted)store.remove(actor.tenantId,receipts,receipt.id);
    else if(store.get(actor.tenantId,receipts,receipt.id)?.status!=='completed')store.update(actor.tenantId,receipts,receipt.id,{status:'uncertain',errorCode:e instanceof OAuthError?e.code:'unexpected_error'});
    throw e;
  }
}

export async function createCalendarEvent(store:Store,actor:Actor,connectionId:string,input:CalendarEventInput,idempotencyKey:string,assertAccess?:()=>void){const parsed=createSchema.parse(input);range(parsed.startAt,parsed.endAt);return mutate(store,actor,connectionId,'create',parsed,idempotencyKey,undefined,assertAccess);}
export async function updateCalendarEvent(store:Store,actor:Actor,connectionId:string,eventId:string,input:z.input<typeof updateSchema>,idempotencyKey:string,assertAccess?:()=>void){const parsed=updateSchema.parse(input);resourceId.parse(eventId);if(parsed.startAt)range(parsed.startAt,parsed.endAt!);return mutate(store,actor,connectionId,'update',parsed,idempotencyKey,eventId,assertAccess);}
export async function cancelCalendarEvent(store:Store,actor:Actor,connectionId:string,eventId:string,input:{calendarId?:string},idempotencyKey:string,assertAccess?:()=>void){resourceId.parse(eventId);const parsed=z.object({calendarId}).strict().parse(input);return mutate(store,actor,connectionId,'cancel',parsed,idempotencyKey,eventId,assertAccess);}

const safe=(fn:(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{try{return await fn(req,reply);}catch(e){if(e instanceof OAuthError)return reply.code(e.status).send({error:{code:e.code,message:e.message}});throw e;}};
export async function registerCalendarRoutes(app:FastifyInstance,store:Store){
  const params=(req:FastifyRequest)=>z.object({id:z.string().uuid(),eventId:resourceId.optional()}).parse(req.params);
  const idempotency=(req:FastifyRequest)=>z.string().parse(req.headers['idempotency-key']);
  app.get('/api/v1/oauth/connections/:id/availability',safe(async req=>readCalendarAvailability(store,req.actor,params(req).id,rangeSchema.parse(req.query),requestOAuthGuard(store,req))));
  app.get('/api/v1/oauth/connections/:id/operations',safe(async req=>{
    requestOAuthGuard(store,req)();
    const c=authorizedOAuthConnection(store,req.actor,params(req).id);
    return {items:store.list(req.actor.tenantId,receipts).filter(r=>r.connectionId===c.id).map(r=>({id:r.id,operation:r.operation,status:r.status,eventId:r.eventId,result:r.result,errorCode:r.errorCode,createdAt:r.createdAt,updatedAt:r.updatedAt}))};
  }));
  app.post('/api/v1/oauth/connections/:id/events',safe(async(req,reply)=>reply.code(201).send(await createCalendarEvent(store,req.actor,params(req).id,req.body as CalendarEventInput,idempotency(req),requestOAuthGuard(store,req)))));
  app.patch('/api/v1/oauth/connections/:id/events/:eventId',safe(async req=>updateCalendarEvent(store,req.actor,params(req).id,params(req).eventId!,req.body as z.input<typeof updateSchema>,idempotency(req),requestOAuthGuard(store,req))));
  app.delete('/api/v1/oauth/connections/:id/events/:eventId',safe(async req=>cancelCalendarEvent(store,req.actor,params(req).id,params(req).eventId!,z.object({calendarId}).parse(req.query),idempotency(req),requestOAuthGuard(store,req))));
}
