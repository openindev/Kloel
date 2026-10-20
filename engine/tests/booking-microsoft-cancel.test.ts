import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingOrigin } from './fixtures/booking-operator.js';
import { bookingMicrosoftCancelFixture as graphFixture } from './fixtures/booking-microsoft-cancel.js';
import { bookingCancelOperations } from '../src/public-booking/operator-cancel.js';

test('Microsoft private cancellation uses exact weak ETag and reconciles scoped absence without another DELETE', async t => {
  const f = await graphFixture(t), key = randomUUID();
  const list = (await f.request('/api/v1/scheduling/bookings')).json().items[0];
  assert.equal(list.adminCancellation.supported, true); assert.equal(list.adminRescheduling.supported, false);
  assert.equal(list.notifications, 'provider_managed_unknown');
  const response = await f.cancel(key); assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().operation.status, 'accepted'); assert.equal(response.json().operation.notifications, 'provider_managed_unknown');
  const deletes = f.requests.filter(r => r.method === 'DELETE'); assert.equal(deletes.length, 1);
  assert.equal(deletes[0].headers.get('if-match'), 'W/"graph-version-1"'); assert.equal(deletes[0].body, undefined);
  assert.equal(deletes[0].url.search, ''); assert.match(deletes[0].headers.get('prefer')!, /IdType="ImmutableId"/);
  const count = f.requests.length; assert.equal((await f.operation(key)).json().status, 'accepted');
  assert.equal((await f.cancel(key)).json().replayed, true); assert.equal(f.requests.length, count);
  const reconciled = await f.reconcile(); assert.equal(reconciled.statusCode, 200, reconciled.body); assert.equal(reconciled.json().status, 'cancelled');
  assert.ok(f.requests.some(r => r.method === 'GET' && r.url.pathname === `/v1.0/me/events/${f.id}`));
  assert.equal((await f.operation(key)).json().status, 'succeeded'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  for (const privateValue of ['remoteEtag', 'graph-version', 'synthetic-account', 'synthetic-booking-token', 'sessionHash']) assert.ok(!response.body.includes(privateValue));
  assert.equal(f.journal()[0].remoteEtag, 'W/"graph-version-1"');
});

const invalid: Record<string, (event: any) => void> = {
  missing_attendees: e => { delete e.attendees; }, attendees: e => { e.attendees = [{ emailAddress: { address: 'private@example.test' } }]; },
  missing_type: e => { delete e.type; }, occurrence: e => { e.type = 'occurrence'; }, exception: e => { e.type = 'exception'; }, series: e => { e.type = 'seriesMaster'; },
  recurrence: e => { e.recurrence = {}; }, missing_recurrence: e => { delete e.recurrence; }, series_id: e => { e.seriesMasterId = 'other'; },
  other_organizer: e => { e.isOrganizer = false; }, missing_organizer: e => { delete e.isOrganizer; },
  all_day: e => { e.isAllDay = true; }, missing_all_day: e => { delete e.isAllDay; }, missing_cancelled: e => { delete e.isCancelled; },
  etag: e => { e['@odata.etag'] = 'unquoted'; }, missing_etag: e => { delete e['@odata.etag']; }, etag_injection: e => { e['@odata.etag'] = 'W/"x\r\ny"'; },
  reference: e => { e.transactionId = randomUUID(); }, identity: e => { e.id = 'different-id'; }, time: e => { e.end.dateTime = '2040-01-01T00:00:00'; },
};
for (const [name, change] of Object.entries(invalid)) test(`Graph private ${name} mismatch never sends a DELETE`, async t => {
  const f = await graphFixture(t), key = randomUUID(); change(f.remote);
  const response = await f.cancel(key); assert.ok(response.statusCode >= 400, response.body);
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0);
  assert.equal((await f.operation(key)).json().status, 'not_sent'); assert.equal(f.record().status, 'confirmed'); assert.equal(f.record().revision, 2);
});

test('a Graph conditional412 never refreshes the ETag or resends after a remote attendee edit', async t => {
  const f = await graphFixture(t), key = randomUUID();
  f.control.hook = r => { if (r.method === 'DELETE') { f.remote['@odata.etag'] = 'W/"graph-version-2"'; f.remote.attendees = [{ emailAddress: { address: 'new@example.test' } }]; } };
  const response = await f.cancel(key); assert.equal(response.statusCode, 502); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  const operation = (await f.operation(key)).json(); assert.equal(operation.status, 'not_applied'); assert.equal(operation.errorCode, 'booking_remote_version_changed');
  assert.equal(f.events.size, 1); assert.equal(f.record().status, 'conflict');
  const count = f.requests.length; assert.equal((await f.cancel(key)).json().replayed, true); assert.equal(f.requests.length, count);
});

for (const outcome of ['invalid_json', 'accepted202', 'authority', 'revoked_grant'] as const) test(`Graph positive DELETE ${outcome} preserves original acceptance before late processing`, async t => {
  const f = await graphFixture(t), key = randomUUID();
  f.control.hook = r => { if (r.method === 'DELETE') {
    f.events.clear();
    if (outcome === 'authority') f.aba();
    if (outcome === 'revoked_grant') f.store.update(f.actor.tenantId, 'booking-grants', String(f.record().grantId), { status: 'revoked' });
    return outcome === 'invalid_json' ? new Response('broken-json', { status: 200 }) : new Response(null, { status: outcome === 'accepted202' ? 202 : 204 });
  } };
  const response = await f.cancel(key); assert.equal(f.journal()[0].status, 'accepted'); assert.equal(f.record().status, 'cancel_pending');
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  const count = f.requests.length;
  if (outcome === 'authority') { assert.equal(response.statusCode, 409); assert.equal((await f.operation(key, await f.freshHeaders())).statusCode, 404); }
  else { assert.equal((await f.operation(key)).json().status, 'accepted'); assert.equal((await f.cancel(key)).json().replayed, true); }
  assert.equal(f.requests.length, count);
});

for (const afterCommit of [false, true]) test(`Graph acceptance storage failure ${afterCommit ? 'after' : 'before'} commit never authorizes retry`, async t => {
  const f = await graphFixture(t), key = randomUUID(), transaction = f.store.transaction.bind(f.store); let armed = true;
  f.store.transaction = ((fn: () => unknown) => {
    if (!armed) return transaction(fn);
    if (afterCommit) {
      const result = transaction(fn);
      if (f.journal()[0]?.status === 'accepted') { armed = false; throw Error('failure after durable commit'); }
      return result;
    }
    return transaction(() => { const result = fn(); if (f.journal()[0]?.status === 'accepted') { armed = false; throw Error('failure before commit'); } return result; });
  }) as typeof f.store.transaction;
  await f.cancel(key); f.store.transaction = transaction;
  assert.equal(armed, false); assert.equal((await f.operation(key)).json().status, afterCommit ? 'accepted' : 'unknown');
  const count = f.requests.length; await f.cancel(key); assert.equal(f.requests.length, count);
  f.advance(360001); assert.equal((await f.reconcile()).json().status, 'cancelled'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});

test('missing and moved Graph events are distinct, including absence before dispatch', async t => {
  const f = await graphFixture(t), key = randomUUID(); f.control.moved = true;
  assert.equal((await f.cancel(key)).json().error.code, 'booking_remote_moved'); assert.equal(f.record().status, 'confirmed');
  assert.equal((await f.operation(key)).json().status, 'not_sent'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0);
  f.events.clear(); const next = await f.cancel(randomUUID(), 2);
  assert.equal(next.json().operation.status, 'succeeded'); assert.equal(f.record().status, 'cancelled'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0);
});

for (const condition of ['moved', 'cancelled_present', 'cancelled_wrong_reference', 'mailbox_denied', 'calendar_access_lost'] as const) test(`Graph reconcile ${condition} never mistakes it for absence`, async t => {
  const f = await graphFixture(t), key = randomUUID();
  f.control.hook = r => r.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined;
  await f.cancel(key); f.control.hook = undefined;
  if (condition === 'moved') f.control.moved = true;
  if (condition.startsWith('cancelled_')) f.remote.isCancelled = true;
  if (condition === 'cancelled_wrong_reference') f.remote.transactionId = randomUUID();
  if (condition === 'mailbox_denied' || condition === 'calendar_access_lost') {
    f.events.clear(); let calendarReads = 0;
    f.control.hook = r => {
      if (condition === 'mailbox_denied' && r.url.pathname === `/v1.0/me/events/${f.id}`) return Response.json({}, { status: 403 });
      if (condition === 'calendar_access_lost' && !r.url.pathname.includes('/events') && ++calendarReads === 2) return Response.json({ id: 'synthetic-canonical-calendar', canEdit: false });
    };
  }
  const before = f.record(), response = await f.reconcile();
  if (condition === 'cancelled_present') { assert.equal(response.statusCode, 200); assert.equal(response.json().reconciliation, 'remote_still_present'); }
  else assert.ok(response.statusCode >= 400, response.body);
  assert.deepEqual(f.record(), before); assert.equal((await f.operation(key)).json().status, 'accepted'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});

for (const corruption of ['missing', 'wrong_fence', 'wrong_tenant', 'wrong_fingerprint'] as const) test(`private persisted Graph fence with ${corruption} receipt cannot fall back to public reconciliation`, async t => {
  const f = await graphFixture(t), key = randomUUID(); await f.cancel(key); const row = f.journal()[0];
  if (corruption === 'missing') f.store.remove(f.actor.tenantId, bookingCancelOperations, row.id);
  if (corruption === 'wrong_fence') f.store.update(f.actor.tenantId, bookingCancelOperations, row.id, { operationId: randomUUID() });
  if (corruption === 'wrong_tenant') { f.store.remove(f.actor.tenantId, bookingCancelOperations, row.id); f.store.create('foreign', bookingCancelOperations, row); }
  if (corruption === 'wrong_fingerprint') f.store.update(f.actor.tenantId, bookingCancelOperations, row.id, { fingerprint: 'invalid' });
  const before = f.record(), count = f.requests.length, response = await f.reconcile();
  assert.equal(response.json().error.code, 'booking_cancel_operation_unavailable'); assert.deepEqual(f.record(), before); assert.equal(f.requests.length, count);
});

test('Graph reconcile cannot settle a newer reservation or a receipt replaced during remote GET', async t => {
  const f = await graphFixture(t), key = randomUUID(); await f.cancel(key); let newBooking: unknown;
  f.control.hook = r => { if (r.url.pathname === `/v1.0/me/events/${f.id}`) { f.store.update(f.actor.tenantId, 'public-bookings', f.booked.bookingRef, { revision: 3, operationId: randomUUID(), status: 'confirmed' }); newBooking = f.record(); } };
  assert.equal((await f.reconcile()).json().error.code, 'booking_state_changed'); assert.deepEqual(f.record(), newBooking); assert.equal((await f.operation(key)).json().status, 'accepted');
});

test('Graph reconcile detects its original receipt replaced during remote GET', async t => {
  const f = await graphFixture(t), key = randomUUID(); await f.cancel(key);
  f.control.hook = r => { if (r.url.pathname === `/v1.0/me/events/${f.id}`) f.store.update(f.actor.tenantId, bookingCancelOperations, f.journal()[0].id, { key: randomUUID() }); };
  const before = f.record(); assert.equal((await f.reconcile()).json().error.code, 'booking_cancel_operation_unavailable'); assert.deepEqual(f.record(), before);
});

test('Graph reconcile rechecks receipt integrity inside BEGIN before settling holds', async t => {
  const f = await graphFixture(t), key = randomUUID(); await f.cancel(key);
  const transaction = f.store.transaction.bind(f.store), before = f.record(), appointment = f.store.list(f.actor.tenantId, 'appointments'); let armed = true;
  f.store.transaction = ((fn: () => unknown) => transaction(() => {
    if (armed) { armed = false; f.store.update(f.actor.tenantId, bookingCancelOperations, f.journal()[0].id, { key: randomUUID() }); }
    return fn();
  })) as typeof f.store.transaction;
  const response = await f.reconcile(); f.store.transaction = transaction;
  assert.equal(armed, false); assert.equal(response.json().error.code, 'booking_cancel_operation_unavailable');
  assert.deepEqual(f.record(), before); assert.deepEqual(f.store.list(f.actor.tenantId, 'appointments'), appointment);
  assert.equal(f.journal()[0].key, key); assert.equal((await f.operation(key)).json().status, 'accepted');
});

test('Graph private/public contenders share the same local reservation, and administrative move stays unsupported', async t => {
  const f = await graphFixture(t), key = randomUUID(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
  f.control.hook = async r => { if (r.method === 'DELETE') { enter(); await held; } };
  const running = f.cancel(key); await entered;
  assert.equal((await f.cancel(key)).json().operation.status, 'pending'); assert.equal((await f.cancel(randomUUID(), 2)).json().error.code, 'booking_requires_reconciliation');
  await assert.rejects(f.service.cancel(f.target, f.manage, bookingOrigin, { bookingRef: f.booked.bookingRef, idempotencyKey: randomUUID() }), (e: any) => e.code === 'booking_requires_reconciliation');
  assert.equal((await f.reconcile()).json().error.code, 'booking_operation_in_progress');
  release(); assert.equal((await running).json().operation.status, 'accepted'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  assert.equal((await f.request('/api/v1/scheduling/bookings')).json().items[0].adminRescheduling.supported, false);
});

test('Graph observation storage and authority recheck roll back before external DELETE', async t => {
  const f = await graphFixture(t), key = randomUUID(), update = f.store.update.bind(f.store); let armed = true;
  f.store.update = (tenant, collection, id, data) => { const row = update(tenant, collection, id, data); if (armed && collection === bookingCancelOperations && data.remoteEtag) { armed = false; f.aba(); } return row; };
  const response = await f.cancel(key); f.store.update = update;
  assert.equal(response.json().error.code, 'context_changed_in_flight'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0);
  assert.equal(f.journal()[0].remoteEtag, undefined); assert.equal(f.journal()[0].status, 'not_sent');
});
