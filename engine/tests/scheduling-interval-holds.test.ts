import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { createDomainAppointment, listCalendarSlots } from '../src/domains.js';
import { PublicBookingService } from '../src/public-booking/service.js';
import { executeExternalCalendarTool } from '../src/oauth/agent-calendar.js';
import { seal } from '../src/oauth/crypto.js';
import { tokenContext, type Actor } from '../src/oauth/access.js';
import { seedMember } from './fixtures/membership.js';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(t: any) {
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY, originalFetch = globalThis.fetch;
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store();
  t.after(() => { store.close(); globalThis.fetch = originalFetch; if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; });
  const actor: Actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const agent = store.create(actor.tenantId, 'agents', { name: 'Hold regression fixture', tools: ['schedule_appointment'] });
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider: 'google', remoteId: 'fixture-account', userId: actor.userId, visibility: 'personal', status: 'connected', capabilities: ['calendar', 'calendar_write'], scopes: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'fixture-only-not-a-credential', expiresAt: Date.now() + 3600000, scope: connection.scopes }, tokenContext(connection)) });
  const calendar = store.create(actor.tenantId, 'calendars', { name: 'Calendar fixture', provider: 'google', connectionId: connection.id, externalCalendarId: 'primary', agentId: agent.id, enabled: true, timezone: 'UTC', appointmentDurationMinutes: 30, bufferMinutes: 10, availability: [] });
  const grant = store.create(actor.tenantId, 'booking-grants', { localCalendarId: calendar.id, resourceKey: 'fixture-resource', provider: 'google', canonicalCalendarId: 'canonical', remoteAccountId: connection.remoteId, isPrimaryCalendar: true });
  const target = { tenantId: actor.tenantId, pageId: randomUUID() }, service = new PublicBookingService(store);
  const context = { tenantId: actor.tenantId, actor, agent };
  const old = { startAt: '2099-01-05T10:00:00Z', endAt: '2099-01-05T10:30:00Z' }, next = { startAt: '2099-01-05T12:00:00Z', endAt: '2099-01-05T12:30:00Z' };
  const local = (window: typeof old) => createDomainAppointment(store, actor.tenantId, { calendarId: calendar.id, title: 'Competing appointment', timezone: 'UTC', ...window });
  const busy = (window: typeof old) => service.localBusy(target, grant, window.startAt, window.endAt);
  const slots = () => listCalendarSlots(store, actor.tenantId, { calendarId: calendar.id, from: old.startAt, to: '2099-01-05T13:00:00Z' }).slots.map(slot => slot.startAt);
  return { store, actor, agent, calendar, context, old, next, local, busy, slots };
}

test('pending and uncertain external moves block both intervals in private conflicts, slots and public availability', async t => {
  const f = fixture(t), entered = deferred<void>(), patch = deferred<Response>(); let patches = 0;
  globalThis.fetch = async (_url, init) => {
    if (!init?.method || init.method === 'GET') return Response.json({ items: [] });
    if (init.method === 'POST') return Response.json({ id: 'fixture-event' });
    assert.equal(init.method, 'PATCH'); patches++; entered.resolve(); return patch.promise;
  };
  const created: any = await executeExternalCalendarTool(f.store, f.context, 'external_create_appointment', { calendarId: f.calendar.id, title: 'Original', timezone: 'UTC', ...f.old, confirmedByUser: true }, 'create-original');
  assert.equal(created.ok, true);
  const input = { calendarId: f.calendar.id, appointmentId: created.appointment.id, ...f.next, confirmedByUser: true };
  const moving = executeExternalCalendarTool(f.store, f.context, 'external_update_appointment', input, 'uncertain-move');
  await entered.promise;
  const assertBoth = () => {
    for (const interval of [f.old, f.next]) {
      assert.equal(f.busy(interval), true);
      assert.throws(() => f.local(interval), (error: any) => error.code === 'appointment_overlap');
      assert.equal(f.slots().includes(new Date(interval.startAt).toISOString()), false);
    }
    assert.throws(() => f.local({ startAt: '2099-01-05T09:45:00Z', endAt: '2099-01-05T09:55:00Z' }), (error: any) => error.code === 'appointment_overlap');
  };
  assert.equal(f.store.get(f.actor.tenantId, 'appointments', created.appointment.id)!.syncStatus, 'pending'); assertBoth();
  patch.reject(new Error('Synthetic lost PATCH response'));
  const result = await moving; assert.equal(result.requiresReconciliation, true);
  assert.equal(f.store.get(f.actor.tenantId, 'appointments', created.appointment.id)!.syncStatus, 'pending_reconciliation'); assertBoth();
  await executeExternalCalendarTool(f.store, f.context, 'external_update_appointment', input, 'uncertain-move'); assert.equal(patches, 1);
});

test('confirmed move releases the old interval; a definite pre-write failure keeps old and releases target', async t => {
  const f = fixture(t); let failRead = false, patches = 0;
  globalThis.fetch = async (_url, init) => {
    if (!init?.method || init.method === 'GET') { if (failRead) throw Error('Synthetic failed availability'); return Response.json({ items: [] }); }
    if (init.method === 'PATCH') patches++;
    return Response.json({ id: 'fixture-event' });
  };
  const created: any = await executeExternalCalendarTool(f.store, f.context, 'external_create_appointment', { calendarId: f.calendar.id, title: 'Original', timezone: 'UTC', ...f.old, confirmedByUser: true }, 'create-original');
  const moved: any = await executeExternalCalendarTool(f.store, f.context, 'external_update_appointment', { calendarId: f.calendar.id, appointmentId: created.appointment.id, ...f.next, confirmedByUser: true }, 'confirmed-move');
  assert.equal(moved.ok, true); assert.equal(moved.appointment.previousSyncInterval, null);
  assert.equal(f.busy(f.old), false); assert.equal(f.busy(f.next), true); assert.equal(f.slots().includes(new Date(f.old.startAt).toISOString()), true);
  failRead = true;
  const failed: any = await executeExternalCalendarTool(f.store, f.context, 'external_update_appointment', { calendarId: f.calendar.id, appointmentId: created.appointment.id, ...f.old, confirmedByUser: true }, 'rejected-move');
  assert.equal(failed.ok, false); assert.equal(failed.requiresReconciliation, false); assert.equal(patches, 1);
  const record = f.store.get(f.actor.tenantId, 'appointments', created.appointment.id)!;
  assert.equal(record.startAt, new Date(f.next.startAt).toISOString()); assert.equal(record.previousSyncInterval, null);
  assert.equal(f.busy(f.old), false); assert.equal(f.busy(f.next), true); assert.equal(f.local(f.old).status, 'scheduled');
});
