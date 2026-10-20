import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingOperatorFixture } from './fixtures/booking-operator.js';
import { bookingRescheduleFixture } from './fixtures/booking-reschedule.js';
import { operatorRescheduleOperations } from '../src/public-booking/operator-reschedule.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { tokenContext } from '../src/oauth/access.js';
import { registerAuth } from '../src/auth.js';
import { registerPublicBooking } from '../src/public-booking.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

type Fixture = Awaited<ReturnType<typeof bookingRescheduleFixture>>;
const journal = (f: Fixture) => f.store.list(f.actor.tenantId, operatorRescheduleOperations);
const patches = (f: Fixture) => f.requests.filter(r => r.method === 'PATCH');
async function quote(f: Fixture) { const r = await f.slots(); assert.equal(r.statusCode, 200, r.body); return r.json().slots[0].quote as string; }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
function applyPatch(f: Fixture, request: typeof f.requests[number]) { const id = decodeURIComponent(request.url.pathname.split('/').at(-1)!); const event = { ...f.events.get(id), ...request.body, etag: `"version-${f.requests.length}"` }; f.events.set(id, event); return event; }

test('administrative slots and one conditional PATCH preserve the same event and appointment', async t => {
  const f = await bookingOperatorFixture(t);
  const before = f.record();
  const slots = await f.request(`/api/v1/scheduling/bookings/${before.id}/reschedule-slots`, { expectedTenantId: f.actor.tenantId, expectedRevision: 1, from: f.from, to: f.to });
  assert.equal(slots.statusCode, 200, slots.body);
  const destination = slots.json().slots[0]; assert.ok(destination);
  const key = randomUUID();
  const result = await f.request(`/api/v1/scheduling/bookings/${before.id}/reschedule`, { expectedTenantId: f.actor.tenantId, expectedRevision: 1, quote: destination.quote, confirm: true }, f.headers, key);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().operation.status, 'succeeded');
  const patches = f.requests.filter(r => r.method === 'PATCH'); assert.equal(patches.length, 1);
  assert.equal(patches[0].headers.get('if-match'), '"version-1"'); assert.equal(patches[0].url.searchParams.get('sendUpdates'), 'none');
  assert.deepEqual(Object.keys(patches[0].body).sort(), ['end', 'start']);
  assert.equal(f.record().remoteEventId, before.remoteEventId); assert.equal(f.record().appointmentId, before.appointmentId);
  assert.equal(f.record().revision, 2); assert.equal(f.record().startAt, destination.startAt);
  assert.equal(f.requests.filter(r => ['DELETE', 'POST'].includes(r.method)).length, 0);
});

test('private capability is local, Graph refuses before any quote or journal, public cancellation remains separate', async t => {
  const f = await bookingRescheduleFixture(t, 'microsoft');
  const list = await f.request('/api/v1/scheduling/bookings'); assert.deepEqual(list.json().items[0].adminRescheduling, { supported: false, eligible: false, reason: 'provider_unsupported' });
  assert.equal((await f.slots()).json().error.code, 'booking_admin_reschedule_unsupported');
  assert.equal((await f.move('a'.repeat(43))).json().error.code, 'booking_admin_reschedule_unsupported');
  assert.equal(f.requests.length, 0); assert.equal(journal(f).length, 0);
});

test('strict confirmation, expected tenant, stale CAS and quote ownership reject before reservation or I/O', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), before = f.record(); f.requests.length = 0;
  const path = `/api/v1/scheduling/bookings/${before.id}/reschedule`;
  for (const payload of [{ expectedTenantId: 'another-tenant', expectedRevision: 1, quote: q, confirm: true }, { expectedTenantId: f.actor.tenantId, expectedRevision: 1, quote: q, confirm: false }, { expectedTenantId: f.actor.tenantId, expectedRevision: 1, quote: q, confirm: true, eventId: 'forged' }]) assert.notEqual((await f.request(path, payload, f.headers, randomUUID())).statusCode, 200);
  const stale = await f.move(q, randomUUID(), 2); assert.equal(stale.json().error.code, 'booking_reschedule_admission_revision_conflict');
  const otherCookie = 'synthetic-other-owner-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(otherCookie), f.actor.userId, f.actor.tenantId, Date.now() + 86400000);
  const foreign = await f.app.inject({ method: 'POST', url: path, cookies: { kloel_session: otherCookie }, headers: { 'idempotency-key': randomUUID() }, payload: { expectedTenantId: f.actor.tenantId, expectedRevision: 1, quote: q, confirm: true } }); assert.equal(foreign.json().error.code, 'booking_quote_expired');
  assert.equal(f.requests.length, 0); assert.equal(journal(f).length, 0); assert.deepEqual(f.record(), before);
});

test('quotes expire and bind original full interval/appointment even with unchanged booking revision', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f); f.advance(300001); f.requests.length = 0;
  assert.equal((await f.move(q)).json().error.code, 'booking_quote_expired');
  const fresh = await quote(f); f.requests.length = 0;
  f.store.update(f.actor.tenantId, 'appointments', String(f.record().appointmentId), { bufferEndAt: new Date(Date.parse(String(f.record().endAt)) + 60000).toISOString() });
  assert.equal((await f.move(fresh)).json().error.code, 'booking_quote_expired'); assert.equal(journal(f).length, 0); assert.equal(f.requests.length, 0);
});

for (const modification of ['attendees', 'attendeesOmitted', 'recurrence', 'duration'] as const) test(`private slots reject ${modification} without PATCH`, async t => {
  const f = await bookingRescheduleFixture(t);
  if (modification === 'duration') f.store.update(f.actor.tenantId, 'public-bookings', f.booked.bookingRef, { endAt: new Date(Date.parse(String(f.record().endAt)) + 60000).toISOString() });
  else Object.assign(f.events.get(String(f.record().remoteEventId)), { [modification]: modification === 'attendees' ? [{ email: 'synthetic@example.invalid' }] : modification === 'recurrence' ? ['RRULE:FREQ=DAILY'] : true });
  assert.notEqual((await f.slots()).statusCode, 200); assert.equal(patches(f).length, 0); assert.equal(journal(f).length, 0);
});

for (const stage of ['slots', 'event', 'availability', 'refresh'] as const) test(`authority ABA without headers at ${stage} blocks the next provider effect`, async t => {
  const f = await bookingRescheduleFixture(t), q = stage === 'slots' ? '' : await quote(f); f.requests.length = 0; let armed = true;
  f.hooks.provider = r => { const match = stage === 'slots' || stage === 'event' ? /\/events\//.test(r.url.pathname) : stage === 'availability' && r.url.pathname.endsWith('/events'); if (armed && match && r.method === 'GET') { armed = false; f.aba(); } };
  let previous: (string | undefined)[] = [], controlled = globalThis.fetch;
  if (stage === 'refresh') {
    previous = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET]; process.env.GOOGLE_CLIENT_ID = 'synthetic'; process.env.GOOGLE_CLIENT_SECRET = 'synthetic';
    t.after(() => { ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); });
    f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { encryptedTokens: seal({ accessToken: 'expired', refreshToken: 'synthetic', scope: f.connection.scopes, expiresAt: 1 }, tokenContext(f.connection)) });
    globalThis.fetch = (async (url, init) => { if (String(url) === 'https://oauth2.googleapis.com/token') { armed = false; f.aba(); return Response.json({ access_token: 'synthetic-booking-token', token_type: 'Bearer', expires_in: 3600, scope: f.connection.scopes }); } return controlled(url, init); }) as typeof fetch;
  }
  const result = stage === 'slots' ? await f.slots(1, {}) : await f.move(q, randomUUID(), 1, {});
  globalThis.fetch = controlled;
  assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(armed, false); assert.equal(patches(f).length, 0);
  if (stage === 'refresh') assert.equal(f.requests.length, 0);
  if (stage !== 'slots') { assert.equal(journal(f)[0].status, 'not_sent'); assert.equal(journal(f)[0].needsReconciliation, false); assert.equal(f.record().revision, 2); }
});

for (const change of ['grant', 'oauth', 'policy', 'hold'] as const) test(`${change} change during availability fences the reserved snapshot before PATCH`, async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f); let armed = true;
  f.hooks.provider = r => { if (armed && r.url.pathname.endsWith('/events') && r.method === 'GET') { armed = false;
    if (change === 'grant') f.store.update(f.actor.tenantId, 'booking-grants', String(f.record().grantId), { status: 'revoked' });
    if (change === 'oauth') f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { authorizationGeneration: 1 });
    if (change === 'policy') { const calendar = f.store.list(f.actor.tenantId, 'calendars')[0]; f.store.update(f.actor.tenantId, 'calendars', calendar.id, { bufferMinutes: 15 }); }
    if (change === 'hold') { const move = f.record().reschedule as any; f.store.update(f.actor.tenantId, 'appointments', move.holdAppointmentId, { status: 'cancelled' }); }
  } };
  const result = await f.move(q); assert.notEqual(result.statusCode, 200, result.body); assert.equal(armed, false); assert.equal(patches(f).length, 0);
});

for (const kind of ['invalid_json', 'oversized', 'invalid_event', '202', 'authority', 'storage_before_commit', 'storage_after_commit'] as const) test(`HTTP positive remains durable and unconfirmed across ${kind}`, async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID(), update = f.store.update.bind(f.store); let armed = true;
  if (kind.startsWith('storage_')) f.store.update = (tenant, collection, id, data) => { if (armed && collection === operatorRescheduleOperations && data.status === 'accepted') { armed = false; if (kind === 'storage_after_commit') { const result = update(tenant, collection, id, data); return result; } throw Error('synthetic write failure'); } return update(tenant, collection, id, data); };
  if (kind === 'storage_after_commit') {
    const transaction = f.store.transaction.bind(f.store); f.store.transaction = fn => { const result = transaction(fn); const row = journal(f)[0]; if (row?.status === 'accepted' && !(row as any).completedAt && !armed) { f.store.transaction = transaction; throw Error('synthetic after commit'); } return result; };
  }
  f.hooks.provider = r => { if (r.method !== 'PATCH') return; const event = applyPatch(f, r);
    if (kind === 'authority') f.aba();
    if (kind === 'invalid_json') return new Response('{', { status: 200 });
    if (kind === 'oversized') return Response.json({ text: 'x'.repeat(2_000_001) });
    if (kind === 'invalid_event') return Response.json({ ...event, id: 'wrong-event' });
    return Response.json(event, { status: kind === '202' ? 202 : 200 });
  };
  const result = await f.move(q, key, 1, {}); f.store.update = update;
  assert.notEqual(result.statusCode, 200, result.body); assert.equal(patches(f).length, 1); const row = journal(f)[0];
  assert.equal(row.status, kind === 'storage_before_commit' ? 'unknown' : 'accepted'); assert.equal(row.needsReconciliation, true); assert.ok(f.record().reschedule); assert.equal(f.record().revision, 2);
  if (kind === 'authority') assert.equal((await f.operation(key, await f.freshHeaders())).statusCode, 404);
  else {
    const receipt = await f.operation(key); assert.equal(receipt.json().status, row.status);
    f.hooks.provider = undefined; f.advance(360001); assert.equal((await f.reconcile()).json().status, 'confirmed'); assert.equal((await f.operation(key)).json().status, 'succeeded'); assert.equal(patches(f).length, 1);
  }
});

test('lost PATCH response retains both holds; old event or 404 never releases or replays', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID();
  f.hooks.provider = r => { if (r.method === 'PATCH') throw Error('synthetic transport loss'); };
  assert.equal((await f.move(q, key)).statusCode, 502); assert.equal((await f.operation(key)).json().status, 'unknown');
  f.hooks.provider = undefined; f.advance(360001); assert.equal((await f.reconcile()).json().status, 'reschedule_unknown'); assert.ok(f.record().reschedule);
  f.events.clear(); assert.equal((await f.reconcile()).json().status, 'reschedule_unknown'); assert.ok(f.record().reschedule);
  assert.equal((await f.move(q, key, 1)).json().replayed, true); assert.equal(patches(f).length, 1);
});

for (const oldValid of [true, false]) test(`412 has separate proof and resolves holds only when old interval valid=${oldValid}`, async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID();
  f.hooks.provider = r => { if (r.method === 'PATCH') { if (!oldValid) f.events.get(String(f.record().remoteEventId)).attendees = [{ email: 'external@example.invalid' }]; return Response.json({}, { status: 412 }); } };
  await f.move(q, key); const op = (await f.operation(key)).json(); assert.equal(op.status, 'not_applied'); assert.equal(op.needsReconciliation, !oldValid); assert.equal(Boolean(f.record().reschedule), !oldValid); assert.equal(f.record().revision, 2); assert.equal(patches(f).length, 1);
  if (!oldValid) { delete f.events.get(String(f.record().remoteEventId)).attendees; f.hooks.provider = undefined; f.advance(360001); assert.equal((await f.reconcile()).json().status, 'confirmed'); assert.equal((await f.operation(key)).json().needsReconciliation, false); }
});

test('post-PATCH conflict remains accepted and both holds persist until explicit read-only reconciliation', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID();
  f.hooks.provider = r => { if (r.method === 'PATCH') { const event = applyPatch(f, r); f.events.set('busy', { id: 'busy', start: event.start, end: event.end, etag: '"other"' }); return Response.json(event); } };
  const result = await f.move(q, key); assert.equal(result.json().operation.status, 'accepted'); assert.equal(f.record().status, 'reschedule_conflict');
  f.events.delete('busy'); f.hooks.provider = undefined; assert.equal((await f.reconcile()).json().status, 'confirmed'); assert.equal((await f.operation(key)).json().status, 'succeeded'); assert.equal(patches(f).length, 1);
});

test('concurrent keys, visitor move and cancellation share one physical reservation', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID(), entered = deferred(), gate = deferred();
  const publicQuotes = await f.service.rescheduling.slots(f.target, f.manage, 'http://127.0.0.1:4310', { bookingRef: f.booked.bookingRef, from: f.from, to: f.to });
  f.hooks.provider = async r => { if (r.method === 'PATCH') { entered.resolve(); await gate.promise; } };
  const first = f.move(q, key); await entered.promise;
  assert.equal((await f.operation(key)).json().status, 'pending'); assert.equal((await f.move(q, key, 1)).json().replayed, true);
  assert.notEqual((await f.move(q, randomUUID(), 2)).statusCode, 200); assert.notEqual((await f.cancel(randomUUID(), 2)).statusCode, 200);
  await assert.rejects(f.service.rescheduling.reschedule(f.target, f.manage, 'http://127.0.0.1:4310', { bookingRef: f.booked.bookingRef, expectedRevision: 2, quote: publicQuotes.slots[0].quote, idempotencyKey: randomUUID() }));
  gate.resolve(); assert.equal((await first).json().operation.status, 'succeeded'); assert.equal(patches(f).length, 1);
});

test('late 2xx after lease takeover/reconciliation/cancellation updates only original receipt', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID(), entered = deferred(), gate = deferred();
  f.hooks.provider = async r => { if (r.method === 'PATCH') { const event = applyPatch(f, r); entered.resolve(); await gate.promise; return Response.json(event); } };
  const first = f.move(q, key); await entered.promise; f.advance(360001);
  assert.equal((await f.reconcile()).json().status, 'confirmed'); assert.equal((await f.operation(key)).json().status, 'succeeded');
  assert.equal((await f.cancel(randomUUID(), 2)).json().operation.status, 'accepted'); assert.equal((await f.reconcile()).json().status, 'cancelled'); const cancelled = f.record();
  gate.resolve(); assert.equal((await first).statusCode, 409); assert.deepEqual(f.record(), cancelled); assert.equal((await f.operation(key)).json().status, 'succeeded'); assert.equal(patches(f).length, 1);
});

test('reconciliation without headers captures current authority before await and rejects role ABA', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID();
  f.hooks.provider = r => { if (r.method === 'PATCH') { applyPatch(f, r); throw Error('lost'); } }; await f.move(q, key); f.advance(360001); let armed = true;
  f.hooks.provider = r => { if (armed && r.method === 'GET' && /\/events\//.test(r.url.pathname)) { armed = false; f.aba(); } };
  assert.equal((await f.reconcile({})).json().error.code, 'context_changed_in_flight'); assert.ok(f.record().reschedule); assert.notEqual(journal(f)[0].status, 'succeeded'); assert.equal(patches(f).length, 1);
});

test('same-operation snapshot or hold changed during final availability cannot be overwritten', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f); let patched = false, snapshot: any;
  f.hooks.provider = r => { if (r.method === 'PATCH') patched = true; if (patched && r.method === 'GET' && r.url.pathname.endsWith('/events')) { const row = f.record(); f.store.update(f.actor.tenantId, 'public-bookings', row.id, { resourceKey: 'new-resource' }); snapshot = f.record(); } };
  assert.equal((await f.move(q)).statusCode, 409); assert.deepEqual(f.record(), snapshot); assert.equal(journal(f)[0].status, 'accepted');
});

test('reservation final guard rolls back both journals, audit, hold and revision', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), before = f.record(), appointments = f.store.list(f.actor.tenantId, 'appointments'), create = f.store.create.bind(f.store);
  f.store.create = (tenant, collection, data) => { const row = create(tenant, collection, data); if (collection === 'booking-reschedule-audit') f.aba(); return row; };
  f.requests.length = 0; assert.equal((await f.move(q)).json().error.code, 'context_changed_in_flight'); f.store.create = create;
  assert.deepEqual(f.record(), before); assert.deepEqual(f.store.list(f.actor.tenantId, 'appointments'), appointments); assert.equal(journal(f).length, 0); assert.equal(f.store.list(f.actor.tenantId, 'booking-reschedule-operations').length, 0); assert.equal(f.requests.length, 0);
});

test('finish storage failure rolls back interval and hold before preserving accepted evidence', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID(), oldStart = f.record().startAt, update = f.store.update.bind(f.store); let armed = true;
  f.store.update = (tenant, collection, id, data) => { if (armed && collection === operatorRescheduleOperations && data.status === 'succeeded') { armed = false; throw Error('synthetic finish storage'); } return update(tenant, collection, id, data); };
  assert.equal((await f.move(q, key)).statusCode, 502); f.store.update = update;
  assert.equal(f.record().startAt, oldStart); assert.ok(f.record().reschedule); assert.equal((await f.operation(key)).json().status, 'accepted');
  assert.equal((await f.reconcile()).json().status, 'confirmed'); assert.equal((await f.operation(key)).json().status, 'succeeded'); assert.equal(patches(f).length, 1);
});

test('historical receipt survives grant revocation and restart, never projects a newer booking', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID(); const first = (await f.move(q, key)).json().operation;
  const q2 = await quote(f); await f.move(q2, randomUUID(), 2);
  f.store.update(f.actor.tenantId, 'booking-grants', String(f.record().grantId), { status: 'revoked' }); const calls = f.requests.length;
  const app = Fastify(); await app.register(cookie); await registerAuth(app, f.store); await registerPublicBooking(app, f.store); t.after(() => app.close());
  const recovered = await app.inject({ url: `/api/v1/scheduling/reschedule-operations/${key}`, cookies: f.cookies, headers: f.headers }); assert.deepEqual(recovered.json(), first);
  const replay = await f.move(q, key, 1); assert.equal(replay.json().replayed, true); assert.deepEqual(replay.json().operation, first); assert.equal(f.requests.length, calls);
  assert.equal(JSON.stringify(first).includes('synthetic-booking-token'), false); for (const field of ['eventId', 'etag', 'sessionHash', 'grantId', 'holdId']) assert.equal(Object.hasOwn(first, field), false);
});

test('new session, membership reentry and anonymous callers cannot adopt private receipts', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID(); await f.move(q, key); const calls = f.requests.length;
  const token = 'synthetic-new-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(token), f.actor.userId, f.actor.tenantId, Date.now() + 86400000);
  assert.equal((await f.app.inject({ url: `/api/v1/scheduling/reschedule-operations/${key}`, cookies: { kloel_session: token } })).statusCode, 404);
  assert.equal((await f.app.inject({ url: `/api/v1/scheduling/reschedule-operations/${key}` })).statusCode, 401);
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(f.actor.userId); f.store.db.prepare('INSERT INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,?,?)').run(randomUUID(), f.actor.userId, f.actor.tenantId, 'owner', new Date().toISOString());
  const headers = await f.freshHeaders(); assert.equal((await f.operation(key, headers)).statusCode, 404); assert.equal((await f.move(q, key, 1, headers)).json().error.code, 'idempotency_conflict'); assert.equal(f.requests.length, calls);
});

test('reservation captures hold snapshot inside BEGIN, not after the commit returns', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), transaction = f.store.transaction.bind(f.store); let armed = true, changed: unknown;
  f.store.transaction = fn => { const result = transaction(fn); const move = f.record().reschedule as any; if (armed && move?.admin && !move.attempted) { armed = false; f.store.update(f.actor.tenantId, 'appointments', move.holdAppointmentId, { bufferStartAt: '2040-01-01T00:00:00.000Z' }); changed = f.store.get(f.actor.tenantId, 'appointments', move.holdAppointmentId); } return result; };
  f.requests.length = 0; assert.equal((await f.move(q)).statusCode, 409); f.store.transaction = transaction;
  assert.equal(f.requests.length, 0); assert.equal(journal(f)[0].status, 'not_sent'); assert.equal(journal(f)[0].needsReconciliation, true);
  assert.deepEqual(f.store.get(f.actor.tenantId, 'appointments', (f.record().reschedule as any).holdAppointmentId), changed);
});

test('move reconciliation compares full snapshot at BEGIN even when timestamp stays identical', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f); f.hooks.provider = r => { if (r.method === 'PATCH') throw Error('lost'); }; await f.move(q); f.advance(360001); f.hooks.provider = undefined;
  const transaction = f.store.transaction.bind(f.store); let armed = true, changed: unknown;
  f.store.transaction = fn => { if (armed) { armed = false; const before = f.record(), next = { ...before, resourceKey: 'same-time-other-resource' }; f.store.db.prepare("UPDATE entities SET body=? WHERE tenant_id=? AND collection='public-bookings' AND id=?").run(JSON.stringify(next), f.actor.tenantId, before.id); changed = f.record(); assert.equal(f.record().updatedAt, before.updatedAt); } return transaction(fn); };
  f.requests.length = 0; assert.equal((await f.reconcile()).json().error.code, 'booking_state_changed'); f.store.transaction = transaction;
  assert.deepEqual(f.record(), changed); assert.equal(f.requests.length, 0);
});

test('reconciliation snapshot is captured before its lease COMMIT can return a changed hold', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f); f.hooks.provider = r => { if (r.method === 'PATCH') { applyPatch(f, r); throw Error('lost'); } }; await f.move(q); f.advance(360001); f.hooks.provider = undefined;
  const transaction = f.store.transaction.bind(f.store); let armed = true;
  f.store.transaction = fn => { const result = transaction(fn); if (armed) { armed = false; const move = f.record().reschedule as any; f.store.update(f.actor.tenantId, 'appointments', move.holdAppointmentId, { bufferEndAt: '2040-01-01T00:00:00.000Z' }); } return result; };
  f.requests.length = 0; assert.equal((await f.reconcile()).json().error.code, 'booking_state_changed'); f.store.transaction = transaction;
  assert.equal(f.requests.length, 0); assert.ok(f.record().reschedule); assert.notEqual(journal(f)[0].status, 'succeeded');
});

test('expired lease before PATCH is not adopted; explicit reconciliation resolves not_sent at reserved revision', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID(); let armed = true;
  f.hooks.provider = r => { if (armed && r.method === 'GET' && r.url.pathname.endsWith('/events')) { armed = false; f.advance(360001); } };
  assert.equal((await f.move(q, key)).statusCode, 409); assert.equal(patches(f).length, 0);
  const unknownCleanup = (await f.operation(key)).json(); assert.equal(unknownCleanup.status, 'not_sent'); assert.equal(unknownCleanup.needsReconciliation, true); assert.equal(f.record().revision, 2);
  f.hooks.provider = undefined; assert.equal((await f.reconcile()).json().status, 'confirmed'); const resolved = (await f.operation(key)).json(); assert.equal(resolved.status, 'not_sent'); assert.equal(resolved.needsReconciliation, false); assert.equal(f.record().revision, 2);
});

test('GET projects expired pending without writing, renewing lease or accessing provider', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID(), entered = deferred(), gate = deferred();
  f.hooks.provider = async r => { if (r.method === 'PATCH') { entered.resolve(); await gate.promise; return new Response('{', { status: 200 }); } };
  const first = f.move(q, key); await entered.promise; f.advance(360001); const before = journal(f)[0], calls = f.requests.length;
  const get = await f.operation(key); assert.equal(get.json().status, 'unknown'); assert.deepEqual(journal(f)[0], before); assert.equal(f.requests.length, calls);
  gate.resolve(); await first; assert.equal(journal(f)[0].status, 'accepted'); assert.equal(f.record().revision, 2);
});

test('committed dispatch marker followed by local exception cannot become terminal not_sent', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), transaction = f.store.transaction.bind(f.store); let armed = true;
  f.store.transaction = fn => { const result = transaction(fn); if (armed && journal(f)[0]?.attemptedAt) { armed = false; throw Error('synthetic after dispatch-marker commit'); } return result; };
  assert.equal((await f.move(q)).statusCode, 502); f.store.transaction = transaction;
  assert.equal(patches(f).length, 0); assert.equal(journal(f)[0].status, 'unknown'); assert.equal(journal(f)[0].needsReconciliation, true); assert.ok(f.record().reschedule);
});

test('target interval with invalid ETag is insufficient to reconcile a successful move', async t => {
  const f = await bookingRescheduleFixture(t), q = await quote(f), key = randomUUID();
  f.hooks.provider = r => { if (r.method === 'PATCH') { const event = applyPatch(f, r); event.etag = 'unquoted-version'; return Response.json(event); } };
  assert.equal((await f.move(q, key)).statusCode, 502); f.hooks.provider = undefined;
  const result = await f.reconcile(); assert.equal(result.json().status, 'reschedule_unknown'); assert.ok(f.record().reschedule); assert.equal((await f.operation(key)).json().status, 'accepted'); assert.equal(patches(f).length, 1);
});
