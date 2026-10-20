import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { digest, seal, unseal } from '../oauth/crypto.js';
import { eventTypeConfigFromRecord, validateBookingForm, validateBookingWindow, type EventTypeConfig } from '../scheduling/service.js';
import { DomainError } from '../domains.js';
import { BookingError } from './authority.js';
import { validateCalendarBookingWindow, bookingEffectiveBuffer } from './window.js';
import { PublicBookingService } from './service.js';
import { availableBookingWindows, reserveManagedBooking, executeReservedCreate, type CreateState } from './create.js';
import { bookingChoices, bookingOperations, assertAudience, resolveAction, scope, hash, fail, uuid, revision, ownerScope, type Audience } from './assistant-authority.js';
import { publicBookingBaseUrl } from './origin.js';
import { bookingToolSettings } from './tool-settings.js';

const token=()=>randomBytes(32).toString('base64url'), tokenSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/), stamp=z.string().datetime({offset:true});
const activeCreates=new WeakMap<Store,Set<string>>();
const activeFor=(store:Store)=>{let set=activeCreates.get(store);if(!set){set=new Set();activeCreates.set(store,set);}return set;};
const effects={pending:'unconfirmed',unknown:'unconfirmed',accepted:'http_accepted',confirmed:'event_verified',conflict:'event_verified',not_sent:'not_sent'} as const;
export function operationView(row:Entity,now:number,store:Store){
  if(row.kind!=='booking.create'||!Object.hasOwn(effects,String(row.status))||!uuid.safeParse(row.bookingRef).success)return fail(409,'booking_operation_unavailable');
  const status=row.status==='pending'&&(!activeFor(store).has(row.id)||Number(row.leaseUntil)<=now)?'unknown':row.status as keyof typeof effects;
  return{key:String(row.key),kind:'booking.create' as const,conversationId:String(row.conversationId),actionId:String(row.actionId),actionRevision:Number(row.actionRevision),eventTypeId:String(row.eventTypeId),bookingRef:String(row.bookingRef),requestedTime:{startAt:String(row.startAt),endAt:String(row.endAt),timezone:String(row.timezone)},status,effect:effects[status],needsReconciliation:['pending','unknown','accepted','conflict'].includes(status),automaticRetry:false as const,notifications:'not_sent' as const,createdAt:row.createdAt,updatedAt:row.updatedAt};
}
function ownedOperation(store:Store,a:Audience,key:string,now:number){
  assertAudience(store,a,now);const row=store.list(a.tenantId,bookingOperations).find(r=>r.key===key);
  if(!row||hash(row.scope)!==hash(scope(a)))return fail(404,'booking_operation_not_found');return row;
}
export function getAssistantBooking(store:Store,a:Audience,key:string,now=Date.now()){const r=ownedOperation(store,a,uuid.parse(key),now),view=operationView(r,now,store);assertAudience(store,a,now);return view;}
const answersContext=(tenantId:string,choiceId:string)=>`${tenantId}:${choiceId}:booking-answers`;
/** Respostas aos campos personalizados (chaves c_<id>) já coletadas pelo assistente nesta conversa e ação; ficam seladas na escolha. */
export function collectedAnswers(store:Store,a:Audience,conversationId:string,actionId:string):Record<string,string>{
  const row=store.list(a.tenantId,bookingChoices).filter(r=>r.conversationId===conversationId&&r.actionId===actionId&&r.sealedAnswers&&hash(r.scope)===hash(scope(a))).at(-1);
  return row?unseal<Record<string,string>>(String(row.sealedAnswers),answersContext(a.tenantId,row.id)):{};
}
/** Rótulos dos campos personalizados obrigatórios sem resposta e dos respondidos fora do formato do tipo de evento. */
export function customFieldGaps(config:EventTypeConfig,values:Record<string,string|null|undefined>){
  const missing:string[]=[],invalid:string[]=[];
  for(const field of config.customFields){
    const key=`c_${field.id}`,value=String(values[key]??'').trim();
    if(!value){if(field.required)missing.push(field.label);continue;}
    // Os personalizados são conferidos antes do formulário padrão: só booking_form_invalid diz respeito a este campo.
    try{validateBookingForm({...config,customFields:[field]},{[key]:value});}catch(e){if(e instanceof DomainError&&e.code==='booking_form_invalid')invalid.push(field.label);}
  }
  return{missing,invalid};
}
export function choiceView(store:Store,a:Audience,row:Entity,now:number){
  assertAudience(store,a,now,true);if(hash(row.scope)!==hash(scope(a)))return fail(404,'booking_choice_not_found');
  const t=resolveAction(store,a,String(row.actionId),String(row.conversationId),now,Number(row.actionRevision));
  if(row.snapshot!==t.action.snapshot)return fail(409,'booking_choice_expired');
  const slots=unseal<any[]>(String(row.sealedSlots),`${a.tenantId}:${row.id}:booking-choice`).map(s=>({startAt:s.startAt,endAt:s.endAt,quote:s.quote,expiresAt:s.expiresAt}));
  t.check();return{choiceId:row.id,conversationId:String(row.conversationId),chatOperationKey:String(row.chatOperationKey),actionId:t.action.id,actionRevision:Number(t.action.revision),eventTypeId:t.page!.id,title:String(row.title),timezone:String(row.timezone),durationMinutes:Number(row.durationMinutes),form:row.form,allowCreate:t.action.allowCreate===true,slots,complete:row.complete===true,nextFrom:row.nextFrom??null,remoteAvailabilityComplete:true as const,reservationsGuaranteed:false as const};
}
export function choicesFor(store:Store,a:Audience,conversationId:string,now:number,chatOperationId?:string){
  assertAudience(store,a,now);return store.list(a.tenantId,bookingChoices).filter(r=>r.conversationId===conversationId&&(!chatOperationId||r.chatOperationId===chatOperationId)&&hash(r.scope)===hash(scope(a))).slice(-10).flatMap(r=>{try{return[choiceView(store,a,r,now)];}catch{return[];}});
}
export function operationsFor(store:Store,a:Audience,conversationId:string,now:number,chatOperationId?:string){assertAudience(store,a,now);return store.list(a.tenantId,bookingOperations).filter(r=>r.conversationId===conversationId&&(!chatOperationId||r.chatOperationId===chatOperationId)&&hash(r.scope)===hash(scope(a))).slice(-20).map(r=>operationView(r,now,store));}
export function chatReceipt(store:Store,a:Audience,key:string){
  if(a.kind!=='private')return fail(403,'booking_owner_required');
  assertAudience(store,a,Date.now());const r=store.list(a.tenantId,'provider-operations').find(r=>r.operation==='openai.chat'&&r.key===key&&hash(r.bookingAuthority)===hash(ownerScope(a.operator)));
  if(!r)return fail(404,'booking_operation_not_found');return r;
}
export async function assistantSlots(core:PublicBookingService,a:Audience,conversationId:string,input:unknown,chat?:{id:string;key:string},answers?:Record<string,string|null|undefined>){
  const q=z.object({actionId:uuid,expectedRevision:revision,from:stamp,to:stamp}).strict().parse(input);
  const t=resolveAction(core.store,a,q.actionId,conversationId,core.now(),q.expectedRevision);
  // Bound remote work before reading Google, then check again inside reservation.
  if(core.store.list(a.tenantId,bookingChoices).filter(r=>r.conversationId===conversationId&&Number(r.expiresAt)>core.now()).length>=20)return fail(429,'booking_quote_limit');
  if(!chat){
    const collection=a.kind==='private'?'provider-operations':'public-chat-operations';
    const operation=core.store.list(a.tenantId,collection).filter(r=>a.kind==='private'?r.chatConversationId===conversationId&&hash(r.bookingAuthority)===hash(ownerScope(a.operator)):r.sessionId===a.sessionId).at(-1);
    if(!operation)return fail(404,'booking_conversation_unavailable');chat={id:operation.id,key:String(operation.key)};
  }
  const {candidates,config}=await availableBookingWindows(core,t.authority,q.from,q.to,t.check);
  return core.store.transaction(()=>{
    t.check();const existing=core.store.list(a.tenantId,bookingChoices).filter(r=>r.conversationId===conversationId&&Number(r.expiresAt)>core.now());
    if(existing.length>=20)return fail(429,'booking_quote_limit');
    const expiresAt=core.now()+300000,slots=candidates.slice(0,200).map(w=>({...w,quote:token(),expiresAt:new Date(expiresAt).toISOString()}));
    // Sem respostas novas (ex.: "Atualizar horários" no cartão), a nova página herda as já coletadas nesta conversa.
    const given=answers??collectedAnswers(core.store,a,conversationId,t.action.id),kept=Object.fromEntries(config.customFields.map(f=>[`c_${f.id}`,String(given[`c_${f.id}`]??'').trim()]).filter(([,v])=>v));
    const row=core.store.create(a.tenantId,bookingChoices,{scope:scope(a),actionId:t.action.id,actionRevision:t.action.revision,snapshot:t.action.snapshot,conversationId,chatOperationId:chat!.id,chatOperationKey:chat!.key,title:config.name,timezone:config.timezone,durationMinutes:config.durationMinutes,form:config.form,expiresAt,complete:candidates.length<=200,nextFrom:candidates[200]?.startAt??null});
    core.store.update(a.tenantId,bookingChoices,row.id,{sealedSlots:seal(slots,`${a.tenantId}:${row.id}:booking-choice`),...(Object.keys(kept).length?{sealedAnswers:seal(kept,answersContext(a.tenantId,row.id))}:{})});
    t.check();return choiceView(core.store,a,core.store.get(a.tenantId,bookingChoices,row.id)!,core.now());
  });
}
export async function createAssistantBooking(core:PublicBookingService,a:Audience,conversationId:string,input:unknown){
  const body=z.object({actionId:uuid,expectedRevision:revision,choiceId:uuid,quote:tokenSchema,values:z.record(z.string().max(500)),idempotencyKey:uuid,confirm:z.literal(true)}).strict().parse(input);
  assertAudience(core.store,a,core.now());const fingerprint=hash({conversationId,...body}), prior=core.store.list(a.tenantId,bookingOperations).find(r=>r.key===body.idempotencyKey);
  if(prior){if(hash(prior.scope)!==hash(scope(a))||prior.fingerprint!==fingerprint)return fail(409,'booking_idempotency_conflict');return{operation:operationView(prior,core.now(),core.store),replayed:true};}
  const t=resolveAction(core.store,a,body.actionId,conversationId,core.now(),body.expectedRevision);
  if(t.action.allowCreate!==true)return fail(403,'booking_creation_disabled');
  const choice=core.store.get(a.tenantId,bookingChoices,body.choiceId);
  if(!choice||choice.conversationId!==conversationId||choice.actionId!==body.actionId||choice.actionRevision!==body.expectedRevision||hash(choice.scope)!==hash(scope(a))||choice.snapshot!==t.action.snapshot||Number(choice.expiresAt)<=core.now())return fail(409,'booking_quote_expired');
  const slot=unseal<any[]>(String(choice.sealedSlots),`${a.tenantId}:${choice.id}:booking-choice`).find(s=>s.quote===body.quote);
  if(!slot)return fail(409,'booking_quote_expired');
  const config=eventTypeConfigFromRecord(t.page!),collected=choice.sealedAnswers?unseal<Record<string,string>>(String(choice.sealedAnswers),answersContext(a.tenantId,choice.id)):{};
  // O que a pessoa preencher no cartão prevalece; o que o assistente coletou na conversa completa os campos em branco.
  const filled={...body.values,...Object.fromEntries(Object.entries(collected).filter(([k])=>!body.values[k]?.trim()))};
  const missing=[...config.form.filter(f=>f.required&&!filled[f.field]?.trim()).map(f=>f.label),...customFieldGaps(config,filled).missing];
  if(missing.length)throw new BookingError(400,'booking_form_required',`Preencha os campos obrigatórios: ${missing.join(', ')}.`);
  const values=validateBookingForm(config,filled),reference=randomUUID();
  const encryptedVisitor=seal(values,`${a.tenantId}:${reference}:booking-visitor`),target={tenantId:a.tenantId,pageId:t.page!.id};
  const reserved=core.store.transaction(()=>{
    t.check();const old=core.store.list(a.tenantId,bookingOperations).find(r=>r.key===body.idempotencyKey);if(old){if(hash(old.scope)!==hash(scope(a))||old.fingerprint!==fingerprint)return fail(409,'booking_idempotency_conflict');return{old};}
    const all=core.store.list(a.tenantId,bookingOperations);
    if(all.some(r=>r.quoteHash===digest(body.quote)))return fail(409,'booking_quote_consumed');
    if(all.some(r=>r.conversationId===conversationId&&r.eventTypeId===t.page!.id&&r.status!=='not_sent'&&core.store.get(a.tenantId,'public-bookings',String(r.bookingRef))?.status!=='cancelled'))return fail(409,'booking_slot_used');
    if(all.filter(r=>r.actionId===t.action.id&&Date.parse(r.createdAt)>=core.now()-86400000).length>=Number(t.action.maxBookingsPerDay))return fail(429,'booking_daily_limit');
    const buffer=bookingEffectiveBuffer(t.calendar,config.bufferMinutes),w=validateBookingWindow({...config,bufferMinutes:buffer},{startAt:slot.startAt,endAt:slot.endAt},{now:core.now()}),window={...w,...validateCalendarBookingWindow(t.calendar,w,buffer)};
    if(core.localBusy(target,t.grant!,window.bufferStartAt,window.bufferEndAt)||core.dailyBusy(target,t.page!,window.localDate))return fail(409,'booking_slot_taken');
    const silent=bookingToolSettings(core.store,a.tenantId,String(t.action.agentId),t.page!.id).disableNotifications;
    const booking=reserveManagedBooking(core,target,t.grant!,config.name,{reference,operationId:reference,...window,timezone:config.timezone,encryptedVisitor,visitorRetentionUntil:core.now()+90*86400000,assistantConversationId:conversationId,...(silent?{notificationsDisabled:true}:{})});
    const record=core.store.create(a.tenantId,bookingOperations,{kind:'booking.create',key:body.idempotencyKey,fingerprint,scope:scope(a),conversationId,chatOperationId:choice.chatOperationId,actionId:t.action.id,actionRevision:t.action.revision,eventTypeId:t.page!.id,bookingRef:booking.id,reference,quoteHash:digest(body.quote),startAt:booking.startAt,endAt:booking.endAt,timezone:booking.timezone,status:'pending',leaseUntil:booking.operationInFlightUntil});
    const linked=core.store.update(a.tenantId,'public-bookings',booking.id,{assistantOperationId:record.id})!;t.check();return{record,booking:linked};
  });
  if(reserved.old)return{operation:operationView(reserved.old,core.now(),core.store),replayed:true};
  const record=reserved.record!,booking=reserved.booking!;
  const recordState=(proposed:CreateState)=>{
    const old=core.store.get(a.tenantId,bookingOperations,record.id);
    if(!old||old.reference!==reference||old.bookingRef!==booking.id||old.fingerprint!==fingerprint)return fail(409,'booking_operation_unavailable');
    const status=['confirmed','conflict'].includes(String(old.status))||old.status==='accepted'&&['pending','unknown','not_sent'].includes(proposed)?old.status:proposed;
    core.store.update(a.tenantId,bookingOperations,old.id,{status});
  };
  activeFor(core.store).add(record.id);
  try {
    await executeReservedCreate(core,target,booking,t.authority,config.name,t.check,{quiet:true,record:recordState});
    t.check();return{operation:getAssistantBooking(core.store,a,body.idempotencyKey,core.now()),replayed:false};
  } finally { activeFor(core.store).delete(record.id); }
}
export function assistantManagementLink(core:PublicBookingService,a:Audience,key:string){
  const r=ownedOperation(core.store,a,uuid.parse(key),core.now()),b=core.store.get(a.tenantId,'public-bookings',String(r.bookingRef));
  if(!b||b.reference!==r.reference||!['confirmed','conflict','cancelled'].includes(String(b.status)))return fail(409,'booking_requires_reconciliation');
  const page=core.store.get(a.tenantId,'booking-pages',String(b.pageId));if(!page?.publicOrgSlug||!page.slug)return fail(409,'booking_page_unavailable');
  const value=token(),origin=publicBookingBaseUrl(),expiresAt=Math.min(core.now()+90*86400000,Math.max(core.now()+86400000,Date.parse(String(b.endAt))+7*86400000));
  core.store.transaction(()=>{assertAudience(core.store,a,core.now());core.store.update(a.tenantId,'public-bookings',b.id,{managementTokenHash:digest(value),managementTokenExpiresAt:expiresAt,managementOrigin:origin});});
  return{bookingRef:b.id,url:`${origin}/c/${page.publicOrgSlug}/${page.slug}#booking=${b.id}&manage=${value}`,expiresAt:new Date(expiresAt).toISOString()};
}
