import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Store } from '../src/store.js';
import { seedMember } from './fixtures/membership.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { tokenContext } from '../src/oauth/access.js';
import { PublicBookingService } from '../src/public-booking/service.js';
import { validateEventTypeConfig } from '../src/scheduling/service.js';
import { buildApp } from '../src/app.js';
import { createDomainAppointment, listCalendarSlots, registerDomains, updateDomainAppointment } from '../src/domains.js';
const origin = 'http://127.0.0.1:4310', originalFetch = globalThis.fetch, originalKey = process.env.OAUTH_ENCRYPTION_KEY;
afterEach(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = originalKey; });
async function fixture(provider = 'google', dailyLimit = 20, bufferMinutes = 0) {
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
  const store = new Store(), actor = { userId: 'test-owner', tenantId: 'test-tenant', role: 'owner' as const }; seedMember(store, actor);
  const sessionHash = digest('fixture-owner-cookie'); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, actor.tenantId, Date.now() + 86400000);
  let now = Date.now(); const service = new PublicBookingService(store, () => now), scopes = provider === 'google' ? 'https://www.googleapis.com/auth/calendar' : 'Calendars.ReadWrite';
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider, userId: actor.userId, status: 'connected', remoteId: 'remote-test-owner', visibility: 'personal', capabilities: ['calendar', 'calendar_write'], scopes });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'synthetic-token', scope: scopes, expiresAt: now + 86400000 }, tokenContext(connection)) });
  const calendar = store.create(actor.tenantId, 'calendars', { provider, enabled: true, connectionId: connection.id, externalCalendarId: 'primary', timezone: 'UTC', appointmentDurationMinutes: 15 });
  const config = validateEventTypeConfig({ name: 'Consulta', slug: 'consulta', calendarId: calendar.id, enabled: true, timezone: 'UTC', durationMinutes: 30, bufferMinutes, minimumNoticeMinutes: 0, horizonDays: 30, dailyLimit, slotIntervalMinutes: 15, availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' })), form: [] });
  const page = store.create(actor.tenantId, 'booking-pages', { ...config, revision: 1, publicationStatus: 'draft' });
  const target = { tenantId: actor.tenantId, pageId: page.id }, events = new Map<string, any>(), requests: { url: URL; method: string; body: any; headers: Headers }[] = [];
  let intercept: ((r: typeof requests[number]) => Response | undefined | Promise<Response | undefined>) | undefined;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const r = { url: new URL(String(input)), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) };
    assert.match(r.url.hostname, /^(www\.googleapis\.com|graph\.microsoft\.com)$/); assert.equal(r.headers.get('authorization'), 'Bearer synthetic-token'); requests.push(r);
    const intercepted = await intercept?.(r); if (intercepted) return intercepted;
    const id = decodeURIComponent(r.url.pathname.split('/').at(-1)!);
    if (r.method === 'GET' && !/\/(events|calendarView)(\/|$)/.test(r.url.pathname)) return Response.json({ id: 'canonical-test', primary: true, accessRole: 'owner', canEdit: true });
    if (r.method === 'POST') { const e = { ...r.body, id: r.body.id ?? 'graph-test', etag: '"version-1"' }; events.set(e.id, e); return Response.json(e, { status: 201 }); }
    if (r.method === 'PATCH') { const old = events.get(id); if (old?.etag !== r.headers.get('if-match')) return Response.json({}, { status: 412 }); const e = { ...old, ...r.body, etag: '"version-' + requests.length + '"' }; events.set(id, e); return Response.json(e); }
    if (r.method === 'DELETE') { events.delete(id); return new Response(null, { status: 204 }); }
    if (id === 'events' || id === 'calendarView') return Response.json(provider === 'google' ? { items: [...events.values()], timeZone: 'UTC' } : { value: [...events.values()] });
    return events.has(id) ? Response.json(events.get(id)) : Response.json({}, { status: 404 });
  }) as typeof fetch;
  const published = await service.publish(actor, sessionHash, page.id, 1), visitor = service.createSession(target, origin).token;
  const from = new Date(now + 86400000).toISOString().slice(0, 10) + 'T09:00:00.000Z', to = new Date(Date.parse(from) + 4 * 3600000).toISOString();
  const q = (await service.slots(target, visitor, origin, { from, to })).slots[0];
  const booked = await service.book(target, visitor, origin, { quote: q.quote, values: {}, idempotencyKey: randomUUID() });
  const manage = service.managementToken(target, visitor, origin, booked.bookingRef).token;
  const record = () => store.get(actor.tenantId, 'public-bookings', booked.bookingRef)!;
  const quotes = () => service.rescheduling.slots(target, manage, origin, { bookingRef: booked.bookingRef, from, to });
  const body = (q: string, revision = 1) => ({ bookingRef: booked.bookingRef, expectedRevision: revision, quote: q, idempotencyKey: randomUUID() });
  const move = (input: unknown) => service.rescheduling.reschedule(target, manage, origin, input);
  const status = () => service.rescheduling.status(target, manage, origin, booked.bookingRef);
  const reconcile = () => service.reconcile(actor, sessionHash, booked.bookingRef);
  return { store, actor, sessionHash, service, target, calendar, config, page, connection, events, requests, published, visitor, booked, manage, from, to, record, quotes, body, move, status, reconcile, intercept: (value: typeof intercept) => { intercept = value; }, advance: (ms: number) => { now += ms; } };
}
const code = (expected: string) => (e: any) => e.code === expected;

test('Google changes the same event using exact ETag; idempotency and revision prevent duplicate writes', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const before = f.record();
  const slots = await f.quotes(); assert.equal(slots.expectedRevision, 1); const request = f.body(slots.slots[0].quote);
  const result = await f.move(request); assert.equal(result.status, 'confirmed'); assert.equal(result.revision, 2); assert.notEqual(result.startAt, f.booked.startAt);
  assert.equal(f.record().remoteEventId, before.remoteEventId); assert.equal(f.events.size, 1); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0);
  const patch = f.requests.find(r => r.method === 'PATCH')!; assert.equal(patch.headers.get('if-match'), '"version-1"'); assert.equal(patch.url.searchParams.get('sendUpdates'), 'none'); assert.deepEqual(Object.keys(patch.body).sort(), ['end', 'start']);
  assert.deepEqual(await f.move(request), result); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 1);
  await assert.rejects(f.move({ ...request, expectedRevision: 2 }), code('idempotency_conflict'));
  await assert.rejects(f.move(f.body(slots.slots[1].quote)), code('booking_revision_conflict'));
  const appointment = f.store.get(f.actor.tenantId, 'appointments', String(before.appointmentId))!; assert.equal(appointment.startAt, result.startAt); assert.equal(appointment.syncStatus, 'synced');
});

test('management is own-reservation scoped and cookie/visitor credentials cannot substitute for it', async t => {
  const f = await fixture(); t.after(() => f.store.close()); assert.equal(f.status().rescheduleAllowed, true);
  assert.throws(() => f.service.rescheduling.status(f.target, f.visitor, origin, f.booked.bookingRef), code('booking_not_found'));
  assert.throws(() => f.service.rescheduling.status(f.target, f.manage, 'https://wrong.example', f.booked.bookingRef), code('booking_not_found'));
  const q = (await f.quotes()).slots[0]; f.service.managementToken(f.target, f.visitor, origin, f.booked.bookingRef);
  await assert.rejects(f.move(f.body(q.quote)), code('booking_not_found')); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 0);
});

test('Graph explicitly declines rescheduling while existing reservation can still be cancelled', async t => {
  const f = await fixture('microsoft'); t.after(() => f.store.close()); assert.equal(f.status().rescheduleAllowed, false); assert.equal(f.status().rescheduleUnavailableReason, 'booking_reschedule_unsupported');
  await assert.rejects(f.quotes(), code('booking_reschedule_unsupported')); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 0);
  assert.equal((await f.service.cancel(f.target, f.manage, origin, { bookingRef: f.booked.bookingRef, idempotencyKey: randomUUID() })).status, 'cancelled');
});

test('applied PATCH with lost response retains both holds, blocks cancel, and reconciles without another mutation', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const q = (await f.quotes()).slots.find(s => Date.parse(s.startAt) >= Date.parse(f.from) + 3600000)!; const body = f.body(q.quote);
  f.intercept(r => { if (r.method === 'PATCH') { const id = String(f.record().remoteEventId); f.events.set(id, { ...f.events.get(id), ...r.body, etag: '"applied-lost"' }); throw new Error('synthetic timeout'); } });
  await assert.rejects(f.move(body)); assert.equal(f.status().status, 'reschedule_unknown'); assert.equal(f.status().startAt, f.booked.startAt); assert.equal(f.status().requestedTime?.startAt, q.startAt);
  const grant = f.store.list(f.actor.tenantId, 'booking-grants')[0]; assert.equal(f.service.localBusy(f.target, grant, f.from, String(f.booked.endAt)), true); assert.equal(f.service.localBusy(f.target, grant, q.startAt, q.endAt), true);
  assert.throws(() => createDomainAppointment(f.store, f.actor.tenantId, { title: 'Outro compromisso', calendarId: f.calendar.id, startAt: q.startAt, endAt: q.endAt }), code('appointment_overlap'));
  await assert.rejects(f.service.cancel(f.target, f.manage, origin, { bookingRef: f.booked.bookingRef, idempotencyKey: randomUUID() }), code('booking_requires_reconciliation'));
  await f.move(body); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 1); f.intercept(undefined);
  const resolved = await f.reconcile(); assert.equal(resolved.status, 'confirmed'); assert.equal(resolved.startAt, q.startAt); assert.equal(resolved.revision, 2); assert.equal(f.record().reschedule, null);
  assert.equal(f.store.list(f.actor.tenantId, 'appointments').find(a => a.source === 'public_booking_reschedule_hold')?.status, 'cancelled');
});

test('negative reads after uncertain PATCH never free either hold or permit blind repeat', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const body = f.body((await f.quotes()).slots[0].quote);
  f.intercept(r => { if (r.method === 'PATCH') throw new Error('timeout before response'); }); await assert.rejects(f.move(body)); f.intercept(undefined);
  assert.equal((await f.reconcile()).status, 'reschedule_unknown'); f.events.clear(); assert.equal((await f.reconcile()).status, 'reschedule_unknown');
  await f.move(body); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 1);
});

test('412 preserves verified old event, releases destination and never retries the write', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const q = (await f.quotes()).slots[0];
  f.intercept(r => { if (r.method === 'PATCH') { const id = String(f.record().remoteEventId); f.events.set(id, { ...f.events.get(id), etag: '"touched-by-owner"' }); return Response.json({}, { status: 412 }); } });
  const result = await f.move(f.body(q.quote)); assert.equal(result.status, 'confirmed'); assert.equal(result.startAt, f.booked.startAt); assert.equal(result.revision, 2); assert.equal(f.record().errorCode, 'booking_remote_version_changed'); assert.equal(f.record().reschedule, null);
  assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 1);
});

test('malformed successful patch remains uncertain and exact identity is required during reconciliation', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const q = (await f.quotes()).slots[0];
  f.intercept(r => r.method === 'PATCH' ? Response.json({}) : undefined); await assert.rejects(f.move(f.body(q.quote))); assert.equal(f.record().status, 'reschedule_unknown');
  f.intercept(r => r.url.pathname.endsWith('/' + f.record().remoteEventId) ? Response.json({ ...f.events.get(String(f.record().remoteEventId)), id: 'other-event' }) : undefined);
  await assert.rejects(f.reconcile(), code('booking_provider_response_invalid')); assert.equal(f.record().status, 'reschedule_unknown');
});

test('simultaneous requests serialize by booking and destination holds also block canonical calendar aliases', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const q = (await f.quotes()).slots.find(s => Date.parse(s.startAt) >= Date.parse(f.from) + 3600000)!;
  let enter!: () => void, release!: () => void; const entered = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; }); let paused = false;
  f.intercept(async r => { if (!paused && r.method === 'GET') { paused = true; enter(); await gate; } }); const pending = f.move(f.body(q.quote)); await entered;
  await assert.rejects(f.move(f.body(q.quote)), code('booking_requires_reconciliation'));
  const grant = f.store.list(f.actor.tenantId, 'booking-grants')[0], alias = { ...grant, localCalendarId: randomUUID() }; assert.equal(f.service.localBusy(f.target, alias, q.startAt, q.endAt), true); assert.equal(f.service.localBusy(f.target, alias, f.from, String(f.booked.endAt)), true);
  release(); assert.equal((await pending).status, 'confirmed'); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 1);
});

test('membership, OAuth generation, calendar policy and capability rotation during await prevent PATCH', async t => {
  for (const mutation of ['member', 'oauth', 'calendar', 'management'] as const) {
    const f = await fixture(); try {
      const q = (await f.quotes()).slots[0]; let changed = false;
      f.intercept(r => { if (!changed && r.method === 'GET') { changed = true; if (mutation === 'member') f.store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=?").run(f.actor.userId); else if (mutation === 'oauth') f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { authorizationGeneration: 1 }); else if (mutation === 'calendar') f.store.update(f.actor.tenantId, 'calendars', f.calendar.id, { bufferMinutes: 30 }); else f.service.managementToken(f.target, f.visitor, origin, f.booked.bookingRef); } });
      await assert.rejects(f.move(f.body(q.quote))); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 0, mutation); assert.equal(f.record().startAt, f.booked.startAt);
    } finally { f.store.close(); }
  }
});

test('late completion cannot resurrect a reservation reconciled and cancelled after lease expiry', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const q = (await f.quotes()).slots[0]; let entered!: () => void, release!: () => void;
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { entered = r; }); let pause = true;
  f.intercept(async r => { if (pause && f.requests.some(x => x.method === 'PATCH') && r.method === 'GET' && r.url.pathname.endsWith('/events')) { pause = false; entered(); await gate; } });
  const running = f.move(f.body(q.quote)); await ready; f.advance(420000); assert.equal((await f.reconcile()).status, 'confirmed');
  assert.equal((await f.service.cancel(f.target, f.manage, origin, { bookingRef: f.booked.bookingRef, idempotencyKey: randomUUID() })).status, 'cancelled'); release();
  await assert.rejects(running, code('booking_state_changed')); assert.equal(f.record().status, 'cancelled'); assert.equal(f.events.size, 0);
});

test('same-day daily limit excludes own reservation and protects unrelated days while uncertain', async t => {
  const f = await fixture('google', 1); t.after(() => f.store.close()); assert.ok((await f.quotes()).slots.length > 0);
  const from = new Date(Date.parse(f.from) + 86400000).toISOString(), to = new Date(Date.parse(from) + 3600000).toISOString();
  const q = (await f.service.rescheduling.slots(f.target, f.manage, origin, { bookingRef: f.booked.bookingRef, from, to })).slots[0];
  f.intercept(r => { if (r.method === 'PATCH') throw new Error('timeout'); }); await assert.rejects(f.move(f.body(q.quote)));
  assert.equal(f.service.dailyBusy(f.target, f.page, f.from.slice(0, 10)), true); assert.equal(f.service.dailyBusy(f.target, f.page, from.slice(0, 10)), true);
});

test('externally added attendees or recurrence cannot trigger invitation-producing edits', async t => {
  for (const change of [{ attendees: [{ email: 'external@example.test' }] }, { recurrence: ['RRULE:FREQ=DAILY'] }]) {
    const f = await fixture(); try { const q = (await f.quotes()).slots[0]; const id = String(f.record().remoteEventId); f.events.set(id, { ...f.events.get(id), ...change }); await assert.rejects(f.move(f.body(q.quote)), code('booking_remote_changed')); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 0); assert.equal(f.record().status, 'reschedule_conflict'); } finally { f.store.close(); }
  }
});

test('unpublish blocks new rescheduling but management status and cancellation retain original grant', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const q = (await f.quotes()).slots[0]; f.service.unpublish(f.actor, f.sessionHash, f.page.id);
  assert.equal(f.status().rescheduleAllowed, false); await assert.rejects(f.move(f.body(q.quote)), code('booking_page_unavailable'));
  assert.equal((await f.service.cancel(f.target, f.manage, origin, { bookingRef: f.booked.bookingRef, idempotencyKey: randomUUID() })).status, 'cancelled');
});

test('integrated middleware exposes only BookingManage routes with same-origin enforcement and no private IDs', async t => {
  const f = await fixture(); const app = await buildApp(f.store, { workers: false }); t.after(() => app.close());
  const query = new URLSearchParams({ orgSlug: f.published.orgSlug, eventSlug: f.published.eventSlug, bookingRef: f.booked.bookingRef }).toString();
  const url = '/api/v1/public/booking/manage-status?' + query;
  const response = await app.inject({ url, headers: { origin, authorization: 'BookingManage ' + f.manage } }); assert.equal(response.statusCode, 200); assert.equal(response.json().revision, 1); assert.equal(response.headers['cache-control'], 'no-store'); assert.ok(!response.body.includes('synthetic-token')); assert.ok(!response.body.includes(String(f.record().remoteEventId)));
  assert.notEqual((await app.inject({ url, headers: { origin, cookie: 'kloel_session=fixture-owner-cookie' } })).statusCode, 200);
  assert.notEqual((await app.inject({ url, headers: { origin, authorization: 'Booking ' + f.visitor } })).statusCode, 200);
  assert.equal((await app.inject({ url, headers: { origin: 'https://other.example', authorization: 'BookingManage ' + f.manage } })).statusCode, 403);
  const q = (await f.quotes()).slots[0], body = f.body(q.quote), identity = new URLSearchParams({ orgSlug: f.published.orgSlug, eventSlug: f.published.eventSlug }).toString();
  const move = await app.inject({ method: 'POST', url: '/api/v1/public/booking/reschedule?' + identity, headers: { origin, authorization: 'BookingManage ' + f.manage }, payload: body }); assert.equal(move.statusCode, 200); assert.equal(move.json().revision, 2);
});

test('external conflict after PATCH keeps both holds until read-only reconciliation observes a free destination', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const q = (await f.quotes()).slots.find(s => Date.parse(s.startAt) >= Date.parse(f.from) + 3600000)!;
  f.intercept(r => { if (r.method === 'PATCH') f.events.set('external-overlap', { id: 'external-overlap', start: { dateTime: q.startAt }, end: { dateTime: q.endAt } }); });
  const result = await f.move(f.body(q.quote)); assert.equal(result.status, 'reschedule_conflict'); assert.equal(result.startAt, f.booked.startAt); assert.equal(result.requestedTime?.startAt, q.startAt); assert.equal(result.revision, 1);
  assert.equal(f.store.list(f.actor.tenantId, 'appointments').filter(a => a.status === 'scheduled').length, 2);
  assert.equal((await f.reconcile()).status, 'reschedule_conflict'); f.events.delete('external-overlap'); const resolved = await f.reconcile(); assert.equal(resolved.status, 'confirmed'); assert.equal(resolved.startAt, q.startAt); assert.equal(resolved.revision, 2);
});

test('lease takeover before PATCH fences stale operation before any write and releases only destination', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const q = (await f.quotes()).slots[0];
  let entered!: () => void, release!: () => void; const ready = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; }); let paused = false;
  f.intercept(async r => { if (!paused && r.method === 'GET') { paused = true; entered(); await gate; } });
  const running = f.move(f.body(q.quote)); await ready; f.advance(420000); const resolved = await f.reconcile(); assert.equal(resolved.status, 'confirmed'); assert.equal(resolved.startAt, f.booked.startAt); assert.equal(resolved.lastRescheduleResult, 'not_applied');
  release(); await assert.rejects(running, code('booking_state_changed')); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 0); assert.equal(f.store.list(f.actor.tenantId, 'appointments').filter(a => a.status === 'scheduled').length, 1);
});

test('expired destination quote cannot acquire a revision or send a provider mutation', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const q = (await f.quotes()).slots[0]; f.advance(300001);
  await assert.rejects(f.move(f.body(q.quote)), code('booking_quote_expired')); assert.equal(f.status().revision, 1); assert.equal(f.status().status, 'confirmed'); assert.equal(f.store.list(f.actor.tenantId, 'booking-reschedule-operations').length, 0); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 0);
});

test('private scheduling and slot enumeration honor public page buffers and uncertain destination hold buffers', async t => {
  const f = await fixture('google', 20, 30); t.after(() => f.store.close());
  const privateInput = (start: number) => ({ title: 'Privado', calendarId: f.calendar.id, timezone: 'UTC', startAt: new Date(start).toISOString(), endAt: new Date(start + 15 * 60000).toISOString() });
  const afterOld = privateInput(Date.parse(String(f.booked.endAt)) + 15 * 60000);
  assert.throws(() => createDomainAppointment(f.store, f.actor.tenantId, afterOld), code('appointment_overlap'));
  const q = (await f.quotes()).slots.find(s => Date.parse(s.startAt) >= Date.parse(f.from) + 2 * 3600000)!;
  f.intercept(r => { if (r.method === 'PATCH') throw new Error('uncertain'); }); await assert.rejects(f.move(f.body(q.quote)));
  const afterTarget = privateInput(Date.parse(q.endAt) + 15 * 60000);
  assert.throws(() => createDomainAppointment(f.store, f.actor.tenantId, afterTarget), code('appointment_overlap'));
  assert.equal(listCalendarSlots(f.store, f.actor.tenantId, { calendarId: f.calendar.id, from: afterTarget.startAt, to: afterTarget.endAt }).slots.length, 0);
  const atBoundary = privateInput(Date.parse(q.endAt) + 30 * 60000); assert.equal(createDomainAppointment(f.store, f.actor.tenantId, atBoundary).status, 'scheduled');
});

test('generic private CRUD and agent calendar helper cannot remove or alter a public reschedule hold', async t => {
  const f = await fixture(); const app = Fastify(); t.after(async () => { await app.close(); f.store.close(); });
  app.addHook('preHandler', async request => { request.actor = f.actor; }); await registerDomains(app, f.store);
  const q = (await f.quotes()).slots[0]; f.intercept(r => { if (r.method === 'PATCH') throw new Error('timeout'); }); await assert.rejects(f.move(f.body(q.quote)));
  const hold = f.store.list(f.actor.tenantId, 'appointments').find(a => a.source === 'public_booking_reschedule_hold')!;
  const patched = await app.inject({ method: 'PATCH', url: '/api/v1/appointments/' + hold.id, payload: { status: 'cancelled' } }); assert.equal(patched.statusCode, 409);
  const removed = await app.inject({ method: 'DELETE', url: '/api/v1/appointments/' + hold.id }); assert.equal(removed.statusCode, 409);
  assert.throws(() => updateDomainAppointment(f.store, f.actor.tenantId, hold.id, { status: 'cancelled' }), code('external_appointment_requires_sync'));
  assert.equal(f.store.get(f.actor.tenantId, 'appointments', hold.id)?.status, 'scheduled');
});
