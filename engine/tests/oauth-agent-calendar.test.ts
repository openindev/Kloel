import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { seal } from '../src/oauth/crypto.js';
import { tokenContext, type Actor } from '../src/oauth/access.js';
import { externalCalendarTools, executeExternalCalendarTool } from '../src/oauth/agent-calendar.js';
import { seedMember } from './fixtures/membership.js';

function setup(t:any){
  const previous=process.env.OAUTH_ENCRYPTION_KEY;process.env.OAUTH_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const original=globalThis.fetch;
  const store=new Store();
  t.after(()=>{store.close();globalThis.fetch=original;if(previous===undefined)delete process.env.OAUTH_ENCRYPTION_KEY;else process.env.OAUTH_ENCRYPTION_KEY=previous;});
  const actor:Actor={tenantId:randomUUID(),userId:randomUUID(),role:'owner'};
  seedMember(store,actor);
  const agent=store.create(actor.tenantId,'agents',{name:'Scheduling fixture',tools:['schedule_appointment']});
  const conn=store.create(actor.tenantId,'oauth-connections',{provider:'google',userId:actor.userId,visibility:'personal',status:'connected',capabilities:['calendar','calendar_write'],scopes:'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'});
  store.update(actor.tenantId,'oauth-connections',conn.id,{encryptedTokens:seal({accessToken:'fixture-only-access',expiresAt:Date.now()+3600000,scope:conn.scopes},tokenContext(conn))});
  const calendar=store.create(actor.tenantId,'calendars',{name:'Fixture Google',timezone:'UTC',provider:'google',externalCalendarId:'primary',connectionId:conn.id,agentId:agent.id,enabled:true,appointmentDurationMinutes:30,bufferMinutes:0,availability:[]});
  const context={tenantId:actor.tenantId,agent,actor};
  return {store,actor,agent,conn,calendar,context};
}
const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
const createInput=(calendarId:string)=>({calendarId,title:'Confirmed fixture',startAt:'2099-01-05T10:00:00Z',endAt:'2099-01-05T10:30:00Z',timezone:'UTC',confirmedByUser:true});

test('external calendar tools require real operator, explicit agent assignment and OAuth ownership',async t=>{
  const f=setup(t);let calls=0;globalThis.fetch=async()=>{calls++;return json({items:[]});};
  assert.equal(externalCalendarTools(f.agent).length,0);assert.equal(externalCalendarTools(f.agent,f.actor).length,5);
  const anonymous=await executeExternalCalendarTool(f.store,{tenantId:f.actor.tenantId,agent:f.agent},'external_list_calendars',{},'a');
  assert.equal(anonymous.ok,false);assert.equal(anonymous.error,'external_calendar_not_authorized');
  const available=await executeExternalCalendarTool(f.store,f.context,'external_list_calendars',{},'b');
  assert.equal((available.calendars as any[]).length,1);
  f.store.update(f.actor.tenantId,'calendars',f.calendar.id,{agentId:null});
  const unassigned=await executeExternalCalendarTool(f.store,f.context,'external_create_appointment',createInput(f.calendar.id),'c');assert.equal(unassigned.error,'calendar_not_available');
  f.store.update(f.actor.tenantId,'calendars',f.calendar.id,{agentId:f.agent.id});
  const other={...f.context,actor:{...f.actor,userId:randomUUID(),role:'member' as const}};
  seedMember(f.store,other.actor);
  assert.equal((await executeExternalCalendarTool(f.store,other,'external_create_appointment',createInput(f.calendar.id),'d')).error,'connection_not_found');
  assert.equal(calls,0);
});

test('external slots intersect live busy intervals and local availability, without local fallback on failure',async t=>{
  const f=setup(t);let failing=false;
  globalThis.fetch=async()=>{if(failing)throw new Error('fixture disconnected');return json({items:[{id:'busy',start:{dateTime:'2099-01-05T10:30:00Z'},end:{dateTime:'2099-01-05T11:00:00Z'}}]});};
  const input={calendarId:f.calendar.id,from:'2099-01-05T10:00:00Z',to:'2099-01-05T12:00:00Z'};
  const available=await executeExternalCalendarTool(f.store,f.context,'external_list_calendar_slots',input,'slots');
  assert.equal(available.ok,true);assert.equal(available.source,'local_and_external_calendar');
  assert.deepEqual((available.slots as any[]).map(s=>s.startAt),['2099-01-05T10:00:00.000Z','2099-01-05T11:00:00.000Z','2099-01-05T11:30:00.000Z']);
  failing=true;
  const failed=await executeExternalCalendarTool(f.store,f.context,'external_list_calendar_slots',input,'slots-fail');
  assert.equal(failed.ok,false);assert.equal(failed.externalSync,false);assert.equal(failed.slots,undefined);
});

test('external shared calendar access uses current database role and rejects removed operators',async t=>{
  const f=setup(t);let calls=0;globalThis.fetch=async()=>{calls++;return json({items:[]});};
  f.store.update(f.actor.tenantId,'oauth-connections',f.conn.id,{userId:randomUUID(),visibility:'shared'});
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('member',f.actor.userId,f.actor.tenantId);
  const revoked=await executeExternalCalendarTool(f.store,f.context,'external_create_appointment',createInput(f.calendar.id),'revoked');
  assert.equal(revoked.error,'connection_not_found');assert.equal(calls,0);
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.actor.userId,f.actor.tenantId);
  assert.equal((await executeExternalCalendarTool(f.store,f.context,'external_list_calendars',{},'deleted')).error,'authentication_required');
});

test('external create, reschedule and cancel update local state only with confirmed remote outcomes',async t=>{
  const f=setup(t);let writes=0;
  globalThis.fetch=async(_url,init)=>{
    if(!init?.method||init.method==='GET')return json({items:[]});
    writes++;
    const pending=f.store.list(f.actor.tenantId,'appointments')[0];
    assert.equal(pending.syncStatus,'pending');
    if(init.method==='DELETE')return new Response(null,{status:204});
    return json({id:'remote-event-1'});
  };
  const input=createInput(f.calendar.id);
  const created:any=await executeExternalCalendarTool(f.store,f.context,'external_create_appointment',input,'create-key');
  assert.equal(created.ok,true,JSON.stringify(created));assert.equal(created.externalSync,true);assert.equal(created.invitationDelivery,'not_confirmed');
  assert.equal(created.appointment.syncStatus,'synced');assert.equal(created.appointment.externalEventId,'remote-event-1');
  const repeated=await executeExternalCalendarTool(f.store,f.context,'external_create_appointment',input,'create-key');assert.deepEqual(repeated,created);assert.equal(writes,1);
  const conflict=await executeExternalCalendarTool(f.store,f.context,'external_create_appointment',{...input,title:'different'},'create-key');assert.equal(conflict.error,'idempotency_conflict');
  const update={calendarId:f.calendar.id,appointmentId:created.appointment.id,startAt:'2099-01-05T11:00:00Z',endAt:'2099-01-05T11:30:00Z',confirmedByUser:true};
  const updated:any=await executeExternalCalendarTool(f.store,f.context,'external_update_appointment',update,'update-key');assert.equal(updated.ok,true,JSON.stringify(updated));assert.equal(updated.appointment.startAt,'2099-01-05T11:00:00.000Z');
  const cancelled:any=await executeExternalCalendarTool(f.store,f.context,'external_cancel_appointment',{calendarId:f.calendar.id,appointmentId:created.appointment.id,confirmedByUser:true},'cancel-key');
  assert.equal(cancelled.ok,true,JSON.stringify(cancelled));assert.equal(cancelled.appointment.status,'cancelled');assert.equal(cancelled.appointment.syncStatus,'synced');assert.equal(writes,3);
});

test('uncertain write keeps local reservation and does not claim sync; failed availability cancels pending local reservation',async t=>{
  const f=setup(t);let failRead=false,writes=0;
  globalThis.fetch=async(_url,init)=>{
    if(!init?.method||init.method==='GET'){if(failRead)throw new Error('read failed');return json({items:[]});}
    writes++;throw new Error('write outcome unknown');
  };
  const input=createInput(f.calendar.id);
  const failed:any=await executeExternalCalendarTool(f.store,f.context,'external_create_appointment',input,'uncertain-key');
  assert.equal(failed.ok,false);assert.equal(failed.externalSync,false);assert.equal(failed.requiresReconciliation,true);
  const kept=f.store.get(f.actor.tenantId,'appointments',failed.appointmentId)!;
  assert.equal(kept.status,'scheduled');assert.equal(kept.syncStatus,'pending_reconciliation');
  await executeExternalCalendarTool(f.store,f.context,'external_create_appointment',input,'uncertain-key');assert.equal(writes,1);
  failRead=true;
  const failedRead:any=await executeExternalCalendarTool(f.store,f.context,'external_create_appointment',{...input,startAt:'2099-01-05T12:00:00Z',endAt:'2099-01-05T12:30:00Z'},'read-failure-key');
  assert.equal(failedRead.ok,false);assert.equal(failedRead.requiresReconciliation,false);
  const cancelled=f.store.get(f.actor.tenantId,'appointments',failedRead.appointmentId)!;
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.syncStatus,'failed');assert.equal(writes,1);
});
