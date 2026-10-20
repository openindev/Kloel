import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store,Entity } from '../store.js';
import { seal,unseal } from '../oauth/crypto.js';
import { MembershipError } from '../memberships/service.js';
import { C,CalendlyError,fail,hash,stamp,timezone,uuid } from './schema.js';
import { assertAudience,connection,connectionIdentity,scope,type PrivateAudience } from './access.js';
import { originalBookingReceipt } from './booking.js';
import { api,remoteId } from './oauth.js';

const effects={pending:'unconfirmed',unknown:'unconfirmed',accepted:'http_accepted',confirmed:'cancellation_verified',conflict:'verification_conflict',not_sent:'not_sent',failed:'provider_rejected'} as const;
const reasons=z.enum(['authority_changed','verification_unavailable','verification_conflict','already_canceled','provider_rejected','provider_response_invalid','outcome_unknown']);
const active=new WeakMap<Store,Set<string>>();
const activeFor=(store:Store)=>{let set=active.get(store);if(!set){set=new Set();active.set(store,set);}return set;};
const input=z.object({idempotencyKey:uuid,bookingRef:uuid,confirm:z.literal(true),acknowledgeNotifications:z.literal(true),previousNotSentKey:uuid.optional()}).strict();
const valuesSchema=z.object({name:z.string().min(1).max(120),email:z.string().email().max(254),timezone}).strict();
const snapshotSchema=z.object({creationId:uuid,creationDigest:z.string().length(64),connectionId:uuid,connectionIdentity:z.string().length(64),remoteUserId:uuid,remoteOrganizationId:uuid,eventTypeId:uuid,eventId:uuid,inviteeId:uuid,startAt:stamp,endAt:stamp,values:valuesSchema}).strict();
type Snapshot=z.infer<typeof snapshotSchema>;
const aad=(row:Entity)=>`${row.tenantId}:${row.id}:calendly-cancellation`;
const proof=(r:Entity)=>hash([r.id,r.key,r.kind,r.status,r.fingerprint,r.scope,r.bookingRef,r.connectionId,r.connectionIdentity,r.remoteUserId,r.remoteOrganizationId,r.eventTypeId,r.startAt,r.endAt,r.sealedRemote,r.sealedValues]);
const binding=(r:Entity)=>hash([r.key,r.creationKey,r.bookingRef,r.fingerprint,r.semanticFingerprint,r.targetHash,r.scope,r.executorId,r.sealedSnapshot]);

function owned(store:Store,a:PrivateAudience,key:string){
  assertAudience(store,a);if(a.kind!=='private')fail(403,'calendly_owner_required');
  const row=store.list(a.tenantId,C.cancellations).find(r=>r.key===uuid.parse(key));
  if(!row||hash(row.scope)!==hash(scope(a)))fail(404,'calendly_operation_not_found');return row;
}
export function cancellationView(store:Store,row:Entity){
  if(row.kind!=='calendly.event.cancel'||!Object.hasOwn(effects,String(row.status)))fail(409,'calendly_operation_unresolved');
  const status=row.status==='pending'&&!activeFor(store).has(row.id)?'unknown':row.status as keyof typeof effects;
  return{key:uuid.parse(row.key),kind:'calendly.event.cancel' as const,tenantId:row.tenantId,creationKey:uuid.parse(row.creationKey),bookingRef:uuid.parse(row.bookingRef),status,effect:effects[status],needsReconciliation:['pending','unknown','accepted','conflict'].includes(status),automaticRetry:false as const,notifications:'provider_managed_unknown' as const,reasonCode:row.reasonCode==null?null:reasons.parse(row.reasonCode),attemptedAt:row.attemptedAt==null?null:stamp.parse(row.attemptedAt),acceptedAt:row.acceptedAt==null?null:stamp.parse(row.acceptedAt),verifiedAt:row.verifiedAt==null?null:stamp.parse(row.verifiedAt),createdAt:row.createdAt,updatedAt:row.updatedAt};
}
export const getCancellation=(store:Store,a:PrivateAudience,key:string)=>cancellationView(store,owned(store,a,key));
export function cancellationsFor(store:Store,a:PrivateAudience,creationKey:string){
  assertAudience(store,a);uuid.parse(creationKey);
  const items=store.list(a.tenantId,C.cancellations).filter(r=>r.creationKey===creationKey&&hash(r.scope)===hash(scope(a)));
  // Existing cancellation references remain readable even if creation/configuration is removed.
  if(!items.length)originalBookingReceipt(store,a,creationKey);
  return{items:items.map(r=>cancellationView(store,r))};
}
function originalSnapshot(store:Store,a:PrivateAudience,creationKey:string,bookingRef:string):Snapshot{
  const r=originalBookingReceipt(store,a,creationKey);
  if(r.kind!=='calendly.invitee.create'||r.status!=='confirmed'||r.bookingRef!==bookingRef||!r.sealedRemote||!r.sealedValues)fail(409,'calendly_verification_unavailable');
  const refs=unseal<{eventId:string;inviteeId:string}>(String(r.sealedRemote),`${a.tenantId}:${r.id}:calendly-remote`);
  const values=unseal<unknown>(String(r.sealedValues),`${a.tenantId}:${r.id}:calendly-values`);
  return snapshotSchema.parse({creationId:r.id,creationDigest:proof(r),connectionId:r.connectionId,connectionIdentity:r.connectionIdentity,remoteUserId:r.remoteUserId,remoteOrganizationId:r.remoteOrganizationId,eventTypeId:r.eventTypeId,eventId:refs.eventId,inviteeId:refs.inviteeId,startAt:r.startAt,endAt:r.endAt,values});
}
function authorize(store:Store,a:PrivateAudience,s:Snapshot){
  assertAudience(store,a);const c=connection(store,a.tenantId,s.connectionId,a.userId),scopes=c.scopes;
  if(connectionIdentity(c)!==s.connectionIdentity||c.remoteUserId!==s.remoteUserId||c.remoteOrganizationId!==s.remoteOrganizationId||!Array.isArray(scopes)||!['users:read','event_types:read','scheduled_events:read','scheduled_events:write'].every(v=>scopes.includes(v)))fail(409,'calendly_reauthorization_required');
}
function bound(store:Store,row:Entity){
  const fresh=store.get(row.tenantId,C.cancellations,row.id);
  if(!fresh||binding(fresh)!==binding(row))fail(409,'calendly_operation_unresolved');return fresh;
}
function beforeAttempt(store:Store,a:PrivateAudience,row:Entity,s:Snapshot){
  authorize(store,a,s);const original=store.get(a.tenantId,C.operations,s.creationId);
  if(!original||proof(original)!==s.creationDigest)fail(409,'calendly_verification_unavailable');
  const fresh=bound(store,row);
  if(fresh.status!=='pending'||fresh.phase!=='preflight'||fresh.laneHeld!==true||fresh.successorKey!=null||fresh.attemptedAt!=null)fail(409,'calendly_cancellation_unresolved');
}
function observation(store:Store,row:Entity,status:number){
  // Positive evidence belongs to the attempted operation, even if authority was revoked meanwhile.
  const fresh=bound(store,row);if(fresh.attemptedAt==null||fresh.laneHeld!==true)fail(409,'calendly_operation_unresolved');
  if(status>=200&&status<300){
    const keep=['confirmed','conflict'].includes(String(fresh.status));
    store.update(row.tenantId,C.cancellations,row.id,{status:keep?fresh.status:'accepted',phase:'closed',acceptedAt:fresh.acceptedAt??new Date().toISOString(),reasonCode:keep?fresh.reasonCode:null});
  }else if(status>=400&&status<500&&!['accepted','confirmed','conflict'].includes(String(fresh.status))){
    store.update(row.tenantId,C.cancellations,row.id,{status:'failed',phase:'closed',reasonCode:'provider_rejected'});
  }
}
function reasonFor(error:unknown):z.infer<typeof reasons>{
  const code=error instanceof CalendlyError||error instanceof MembershipError?error.code:'';
  if(code==='calendly_verification_conflict')return'verification_conflict';
  if(code==='calendly_provider_response_invalid'||error instanceof z.ZodError)return'provider_response_invalid';
  if(code==='calendly_reauthorization_required'||code==='context_changed_in_flight'||code==='calendly_owner_required')return'authority_changed';
  return'verification_unavailable';
}

const object=z.record(z.unknown());
function resource(raw:unknown){const r=object.safeParse(raw);if(!r.success||!object.safeParse(r.data.resource).success)fail(502,'calendly_provider_response_invalid');return r.data.resource as Record<string,unknown>;}
function mismatch(ok:boolean){if(!ok)fail(409,'calendly_verification_conflict');}
/** Four bounded GETs of original IDs. This is not a transactional provider snapshot or remote CAS. */
async function remoteState(store:Store,a:PrivateAudience,s:Snapshot,check:()=>void):Promise<'active'|'canceled'> {
  const read=async(path:string)=>{check();const result=await api(store,a.tenantId,s.connectionId,path,check);check();return resource(result);};
  const me=await read('/users/me');
  mismatch(remoteId(me.uri,'users').id===s.remoteUserId&&remoteId(me.current_organization,'organizations').id===s.remoteOrganizationId);
  const type=await read(`/event_types/${s.eventTypeId}`),profile=object.safeParse(type.profile);
  if(!profile.success||typeof type.kind!=='string'||!Object.hasOwn(type,'pooling_type'))fail(502,'calendly_provider_response_invalid');
  mismatch(remoteId(type.uri,'event_types').id===s.eventTypeId&&type.kind==='solo'&&type.pooling_type===null&&profile.data.type==='User'&&remoteId(profile.data.owner,'users').id===s.remoteUserId);
  const i=await read(`/scheduled_events/${s.eventId}/invitees/${s.inviteeId}`);
  const e=await read(`/scheduled_events/${s.eventId}`),invitee=remoteId(i.uri,'invitees');
  if(!stamp.safeParse(e.start_time).success||!stamp.safeParse(e.end_time).success||!['active','canceled'].includes(String(e.status))||!['active','canceled'].includes(String(i.status))||typeof i.rescheduled!=='boolean'||!Array.isArray(e.event_memberships)||!Array.isArray(e.event_guests))fail(502,'calendly_provider_response_invalid');
  const counter=z.object({total:z.number().int().nonnegative(),active:z.number().int().nonnegative(),limit:z.number().int().positive()}).passthrough().safeParse(e.invitees_counter);
  if(!counter.success)fail(502,'calendly_provider_response_invalid');
  mismatch(remoteId(e.uri,'scheduled_events').id===s.eventId&&invitee.id===s.inviteeId&&invitee.eventId===s.eventId&&remoteId(i.event,'scheduled_events').id===s.eventId&&remoteId(e.event_type,'event_types').id===s.eventTypeId&&Date.parse(String(e.start_time))===Date.parse(s.startAt)&&Date.parse(String(e.end_time))===Date.parse(s.endAt)&&i.name===s.values.name&&i.email===s.values.email&&i.timezone===s.values.timezone&&i.rescheduled===false);
  mismatch(e.event_memberships.length===1&&e.event_guests.length===0&&counter.data.total===1&&counter.data.limit===1);
  const membership=object.safeParse(e.event_memberships[0]);if(!membership.success)fail(502,'calendly_provider_response_invalid');
  mismatch(remoteId(membership.data.user,'users').id===s.remoteUserId);
  if(e.status==='canceled'&&i.status==='canceled'&&counter.data.active===0)return'canceled';
  mismatch(e.status==='active'&&i.status==='active'&&counter.data.active===1);return'active';
}

export async function createCancellation(store:Store,a:PrivateAudience,creationKey:string,raw:unknown){
  const b=input.parse(raw);uuid.parse(creationKey);assertAudience(store,a);if(a.kind!=='private')fail(403,'calendly_owner_required');
  const fingerprint=hash([creationKey,b]),existing=store.list(a.tenantId,C.cancellations).find(r=>r.key===b.idempotencyKey);
  const replay=(r:Entity)=>{if(hash(r.scope)!==hash(scope(a))||r.fingerprint!==fingerprint)fail(409,'calendly_idempotency_conflict');return{operation:cancellationView(store,r),replayed:true};};
  if(existing)return replay(existing);
  const s=originalSnapshot(store,a,creationKey,b.bookingRef),targetHash=hash([s.remoteUserId,s.eventId]);
  const semanticFingerprint=hash([creationKey,b.bookingRef,scope(a),s,b.confirm,b.acknowledgeNotifications]);
  authorize(store,a,s);
  const reserved=store.transaction(()=>{
    authorize(store,a,s);if(hash(originalSnapshot(store,a,creationKey,b.bookingRef))!==hash(s))fail(409,'calendly_verification_unavailable');
    const all=store.list(a.tenantId,C.cancellations),old=all.find(r=>r.key===b.idempotencyKey);if(old)return{old};
    const occupied=all.find(r=>r.targetHash===targetHash&&r.laneHeld===true);
    if(b.previousNotSentKey){
      const previous=all.find(r=>r.key===b.previousNotSentKey);
      if(!previous||previous.id!==occupied?.id||previous.semanticFingerprint!==semanticFingerprint||hash(previous.scope)!==hash(scope(a))||previous.status!=='not_sent'||previous.phase!=='closed'||previous.attemptedAt!==null||previous.acceptedAt!==null||previous.successorKey!=null)fail(409,'calendly_cancellation_unresolved');
      store.update(a.tenantId,C.cancellations,previous.id,{laneHeld:false,successorKey:b.idempotencyKey});
    }else if(occupied)fail(409,'calendly_cancellation_unresolved');
    const row=store.create(a.tenantId,C.cancellations,{key:b.idempotencyKey,kind:'calendly.event.cancel',creationKey,bookingRef:b.bookingRef,fingerprint,semanticFingerprint,targetHash,scope:scope(a),executorId:randomUUID(),previousNotSentKey:b.previousNotSentKey??null,successorKey:null,laneHeld:true,phase:'preflight',status:'pending',reasonCode:null,attemptedAt:null,acceptedAt:null,verifiedAt:null});
    return{row:store.update(a.tenantId,C.cancellations,row.id,{sealedSnapshot:seal(s,aad(row))})!};
  });
  // A throw after this COMMIT leaves pending/unknown. It cannot invent terminal not_sent.
  if(reserved.old)return replay(reserved.old);const row=reserved.row!,check=()=>beforeAttempt(store,a,row,s);
  activeFor(store).add(row.id);
  try{
    const state=await remoteState(store,a,s,check);
    if(state==='canceled'){
      store.transaction(()=>{check();store.update(a.tenantId,C.cancellations,row.id,{status:'confirmed',phase:'closed',reasonCode:'already_canceled',verifiedAt:new Date().toISOString()});});
    }else{
      const data=await api(store,a.tenantId,s.connectionId,`/scheduled_events/${s.eventId}/cancellation`,check,{
        body:{},beforeDispatch:()=>store.transaction(()=>{check();store.update(a.tenantId,C.cancellations,row.id,{attemptedAt:new Date().toISOString(),phase:'dispatched'});}),
        observed:status=>store.transaction(()=>observation(store,row,status)),
      });
      // A cancellation response is an acknowledgement, not proof that the event is canceled.
      resource(data);authorize(store,a,s);
    }
    return{operation:getCancellation(store,a,b.idempotencyKey),replayed:false};
  }catch(error){
    store.transaction(()=>{const latest=bound(store,row);
      if(latest.status==='pending'&&latest.laneHeld===true&&latest.successorKey==null){
        if(latest.attemptedAt==null&&latest.phase==='preflight')store.update(a.tenantId,C.cancellations,row.id,{status:'not_sent',phase:'closed',reasonCode:reasonFor(error)});
        else store.update(a.tenantId,C.cancellations,row.id,{status:'unknown',phase:'closed',reasonCode:'outcome_unknown'});
      }else if(latest.status==='accepted'&&reasonFor(error)==='provider_response_invalid')store.update(a.tenantId,C.cancellations,row.id,{reasonCode:'provider_response_invalid'});
    });throw error;
  }finally{activeFor(store).delete(row.id);}
}

export async function verifyCancellation(store:Store,a:PrivateAudience,key:string){
  const row=owned(store,a,key);
  // An ended non-dispatch remains its own history, never the effect of its successor.
  if(row.status==='not_sent')return cancellationView(store,row);
  const s=snapshotSchema.parse(unseal<unknown>(String(row.sealedSnapshot),aad(row)));
  const check=()=>{authorize(store,a,s);bound(store,row);};
  try{
    const state=await remoteState(store,a,s,check);
    return store.transaction(()=>{check();const latest=bound(store,row);
      if(hash(latest)===hash(row))store.update(a.tenantId,C.cancellations,row.id,{status:state==='canceled'?'confirmed':'conflict',phase:'closed',verifiedAt:new Date().toISOString(),reasonCode:state==='canceled'?(row.attemptedAt==null?'already_canceled':null):'verification_conflict'});
      return getCancellation(store,a,key);
    });
  }catch(error){
    if(error instanceof CalendlyError&&error.code==='calendly_verification_conflict')return store.transaction(()=>{check();const latest=bound(store,row);if(hash(latest)===hash(row)&&latest.status!=='confirmed')store.update(a.tenantId,C.cancellations,row.id,{status:'conflict',phase:'closed',reasonCode:'verification_conflict',verifiedAt:new Date().toISOString()});return getCancellation(store,a,key);});
    // 404, parse failures and lost GETs provide no evidence to replace the original status.
    throw error;
  }
}
