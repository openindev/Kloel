import type { Entity, Store } from '../store.js';
import type { PublicBookingService, BookingTarget } from './service.js';
import { authorizeBookingCalendar, BookingError, type BookingAuthority } from './authority.js';
import { readBookingCalendar, createBookingCalendarEvent } from '../oauth/booking-calendar.js';
import { eventTypeConfigFromRecord, validateBookingWindow } from '../scheduling/service.js';
import { bookingEffectiveBuffer, validateCalendarBookingWindow } from './window.js';
import { conflictBusy } from './conflicts.js';
import { bookingCalendarDetails, notificationManageFields } from '../scheduling-notifications.js';

const iso = (n: number) => new Date(n).toISOString();
export const overlaps = (a: string, b: string, c: string, d: string) => Date.parse(a) < Date.parse(d) && Date.parse(b) > Date.parse(c);
export const createSnapshot = (b: Entity) => JSON.stringify([b.status,b.operationId,b.revision??1,b.operationInFlightUntil,b.reference,b.grantId,b.pageId,b.resourceKey,b.appointmentId,b.startAt,b.endAt,b.bufferStartAt,b.bufferEndAt,b.reschedule??null,b.adminCancelOperationId??null,b.adminCancelFence??null]);
export async function availableBookingWindows(core: PublicBookingService, authority: BookingAuthority, fromValue: string, toValue: string, check: () => void) {
  const from = Date.parse(fromValue), to = Date.parse(toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to-from > 7*86400000) throw new BookingError(400,'booking_range_invalid');
  check(); const { page, grant, calendar } = authorizeBookingCalendar(core.store, authority), pageConfig = eventTypeConfigFromRecord(page!);
  const config = { ...pageConfig, bufferMinutes: bookingEffectiveBuffer(calendar,pageConfig.bufferMinutes) }, padding=config.bufferMinutes*60000;
  const busy=[...await readBookingCalendar(core.store,authority,iso(from-padding),iso(to+padding)),...await conflictBusy(core.store,authority.tenantId,page!,iso(from-padding),iso(to+padding))];check();
  const target={tenantId:authority.tenantId,pageId:page!.id}, candidates:ReturnType<typeof validateBookingWindow>[]=[];
  for(let at=Math.ceil(from/60000)*60000;at<to&&candidates.length<201;at+=60000){
    let w:ReturnType<typeof validateBookingWindow>;
    try{w=validateBookingWindow(config,{startAt:iso(at)},{now:core.now()});w={...w,...validateCalendarBookingWindow(calendar,w,config.bufferMinutes)};}catch{continue;}
    if(Date.parse(w.endAt)>to||busy.some(b=>overlaps(w.bufferStartAt,w.bufferEndAt,b.startAt,b.endAt))||core.localBusy(target,grant!,w.bufferStartAt,w.bufferEndAt)||core.dailyBusy(target,page!,w.localDate))continue;
    candidates.push(w);
  }
  check();return{candidates,config,page:page!,grant:grant!,calendar};
}
/** Call inside the ingress transaction after its own credential/quote/CAS checks. */
export function reserveManagedBooking(core:PublicBookingService,target:BookingTarget,grant:Entity,title:string,fields:Record<string,unknown>){
  const booking=core.store.create(target.tenantId,'public-bookings',{pageId:target.pageId,grantId:grant.id,resourceKey:grant.resourceKey,provider:grant.provider,status:'pending',revision:1,operationInFlightUntil:core.now()+360000,notifications:'not_sent',...notificationManageFields(target.tenantId,String(fields.reference)),...fields});
  const appointment=core.store.create(target.tenantId,'appointments',{calendarId:grant.localCalendarId,bookingId:booking.id,title,startAt:booking.startAt,endAt:booking.endAt,bufferStartAt:booking.bufferStartAt,bufferEndAt:booking.bufferEndAt,timezone:booking.timezone,status:'scheduled',source:'public_booking',remoteResourceKey:grant.resourceKey,syncStatus:'pending',attendeeEmails:[]});
  return core.store.update(target.tenantId,'public-bookings',booking.id,{appointmentId:appointment.id})!;
}
export type CreateState='pending'|'unknown'|'accepted'|'confirmed'|'conflict'|'not_sent';
export type CreateHooks={record?:(state:CreateState,booking:Entity)=>void;quiet?:boolean};
/** One physical create for all ingresses; no retry, no compensation, no invented actor. */
export async function executeReservedCreate(core:PublicBookingService,target:BookingTarget,booking:Entity,authority:BookingAuthority,title:string,check:()=>void,hooks:CreateHooks={}){
  const store=core.store,snapshot=createSnapshot(booking);let attempted=false;
  const fence=()=>{const b=store.get(target.tenantId,'public-bookings',booking.id);if(!b||createSnapshot(b)!==snapshot)throw new BookingError(409,'booking_state_changed');return b;};
  const assert=()=>{check();fence();};
  const settle=(status:string,state:CreateState,extra:Record<string,unknown>={},live=true)=>store.transaction(()=>{
    if(live)check();const b=fence();hooks.record?.(state,b);
    const result=store.update(target.tenantId,'public-bookings',b.id,{status,operationId:null,operationInFlightUntil:0,...extra})!;
    store.update(target.tenantId,'appointments',String(b.appointmentId),{status:status==='failed'?'cancelled':'scheduled',syncStatus:status==='confirmed'?'synced':status,...(result.remoteEventId?{externalEventId:result.remoteEventId}:{})});return result;
  });
  try{
    assert();const busy=await readBookingCalendar(store,authority,String(booking.bufferStartAt),String(booking.bufferEndAt));assert();
    if(busy.some(b=>overlaps(String(booking.bufferStartAt),String(booking.bufferEndAt),b.startAt,b.endAt)))throw new BookingError(409,'booking_slot_taken');
    const page=store.get(target.tenantId,'booking-pages',target.pageId);
    if(page&&(await conflictBusy(store,target.tenantId,page,String(booking.bufferStartAt),String(booking.bufferEndAt))).some(b=>overlaps(String(booking.bufferStartAt),String(booking.bufferEndAt),b.startAt,b.endAt)))throw new BookingError(409,'booking_slot_taken');
    assert();const details=bookingCalendarDetails(store,booking,title);
    const remote=await createBookingCalendarEvent(store,authority,{reference:String(booking.reference),startAt:String(booking.startAt),endAt:String(booking.endAt),...details},()=>{
      store.transaction(()=>{assert();attempted=true;store.update(target.tenantId,'public-bookings',booking.id,{remoteAttemptedAt:iso(core.now())});});
    },{quiet:hooks.quiet,recordAccepted:()=>store.transaction(()=>{
      // Durable evidence does not depend on the initiating authority remaining live.
      hooks.record?.('accepted',booking);const b=store.get(target.tenantId,'public-bookings',booking.id);
      if(b&&createSnapshot(b)===snapshot)store.update(target.tenantId,'public-bookings',b.id,{remoteHttpAcceptedAt:iso(core.now())});
    }),recordValidated:remote=>store.transaction(()=>{
      const b=store.get(target.tenantId,'public-bookings',booking.id);
      if(b&&createSnapshot(b)===snapshot)store.update(target.tenantId,'public-bookings',b.id,{remoteEventId:remote.id});
    })});
    assert();const finalBusy=await readBookingCalendar(store,authority,String(booking.bufferStartAt),String(booking.bufferEndAt));assert();
    const conflict=finalBusy.some(b=>b.id!==remote.id&&overlaps(String(booking.bufferStartAt),String(booking.bufferEndAt),b.startAt,b.endAt));
    return settle(conflict?'conflict':'confirmed',conflict?'conflict':'confirmed',{remoteEventId:remote.id,confirmedAt:iso(core.now()),...(remote.meetingUrl?{meetingUrl:remote.meetingUrl}:{})});
  }catch(error){
    const current=store.get(target.tenantId,'public-bookings',booking.id);
    // A marker may have committed before its callback threw. Never turn that into not_sent.
    const uncertain=attempted||!!current?.remoteAttemptedAt||!!current?.remoteHttpAcceptedAt;
    if(current&&createSnapshot(current)===snapshot){
      try{settle(uncertain?'unknown':'failed',uncertain?'unknown':'not_sent',{errorCode:error instanceof BookingError?error.code:'booking_provider_failed'},false);}catch{/* Keep the original reservation/evidence if local settlement fails. */}
    }
    throw error;
  }
}
/** Reconciliation can settle creation evidence, but never rewrite a moved/cancelled history. */
export function completeAssistantCreation(store:Store,booking:Entity,status:string){
  if(!booking.assistantOperationId||!['confirmed','conflict'].includes(status))return;
  const r=store.get(booking.tenantId,'booking-assistant-operations',String(booking.assistantOperationId));
  if(!r||r.bookingRef!==booking.id||r.reference!==booking.reference||r.startAt!==booking.startAt||r.endAt!==booking.endAt||['confirmed','conflict','not_sent'].includes(String(r.status)))return;
  store.update(booking.tenantId,'booking-assistant-operations',r.id,{status});
}
