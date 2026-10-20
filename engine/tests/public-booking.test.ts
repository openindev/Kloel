import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { seedMember } from './fixtures/membership.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { tokenContext } from '../src/oauth/access.js';
import { PublicBookingService } from '../src/public-booking/service.js';
import { registerPublicBooking, PUBLIC_BOOKING_PATHS } from '../src/public-booking.js';
import { BookingError } from '../src/public-booking/authority.js';
import { validateEventTypeConfig } from '../src/scheduling/service.js';
import type { MembershipActor } from '../src/memberships/service.js';
import { buildApp } from '../src/app.js';
import { createApiKey } from '../src/api-keys/service.js';

const originalFetch = globalThis.fetch; const originalKey = process.env.OAUTH_ENCRYPTION_KEY; const originalBase = process.env.PUBLIC_BASE_URL;
afterEach(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = originalKey; if (originalBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = originalBase; });
const origin = 'http://127.0.0.1:4310';
type MockEvent = Record<string, any>;
function fixture(provider: 'google' | 'microsoft' = 'google') {
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); process.env.PUBLIC_BASE_URL = origin;
  const store = new Store(); const actor: MembershipActor = { userId: 'owner-fixture', tenantId: 'tenant-fixture', role: 'owner' }; seedMember(store, actor);
  const cookieValue = 'cookie-owner-test'; const sessionHash = digest(cookieValue); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, actor.tenantId, Date.now() + 86400000);
  let now = Date.now(); const service = new PublicBookingService(store, () => now);
  const scopes = provider === 'google' ? 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' : 'Calendars.ReadWrite';
  const connection = store.create(actor.tenantId, 'oauth-connections', { userId: actor.userId, provider, status: 'connected', remoteId: 'remote-owner', email: 'owner@example.test', visibility: 'personal', capabilities: ['calendar', 'calendar_write'], scopes, authorizationGeneration: 0 });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'mock-oauth-token', expiresAt: Date.now() + 86400000, scope: scopes }, tokenContext(connection)) });
  const calendar = store.create(actor.tenantId, 'calendars', { enabled: true, provider, connectionId: connection.id, externalCalendarId: 'primary', timezone: 'UTC' });
  const configuration = validateEventTypeConfig({ name: 'Consulta', slug: 'consulta', calendarId: calendar.id, timezone: 'UTC', durationMinutes: 30, bufferMinutes: 0, minimumNoticeMinutes: 0, horizonDays: 30, dailyLimit: 20, slotIntervalMinutes: 15, availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' })), form: [{ field: 'name', label: 'Nome', required: true }, { field: 'email', label: 'E-mail', required: true }], enabled: true });
  const page = store.create(actor.tenantId, 'booking-pages', { ...configuration, revision: 1, publicationStatus: 'draft' });
  const target = { tenantId: actor.tenantId, pageId: page.id }; const events = new Map<string, MockEvent>(); const requests: { url: string; method: string; body?: MockEvent }[] = [];
  let intercept: ((url: URL, method: string, body: MockEvent | undefined) => Promise<Response | undefined> | Response | undefined) | undefined;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input)); const method = init.method ?? 'GET'; const body = init.body ? JSON.parse(String(init.body)) : undefined;
    assert.match(url.hostname, /^(www\.googleapis\.com|graph\.microsoft\.com)$/); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer mock-oauth-token');
    requests.push({ url: url.toString(), method, body });
    const handled = await intercept?.(url, method, body); if (handled) return handled;
    if (method === 'GET' && !/\/(events|calendarView)(\/|$)/.test(url.pathname)) return Response.json({ id: 'canonical-calendar', canEdit: true, accessRole: 'owner', primary: true, isDefaultCalendar: true });
    if (method === 'POST') {
      const id = body.id ?? `graph-${events.size + 1}`; const event = { ...body, id }; events.set(id, event); return Response.json(event, { status: 201 });
    }
    const last = decodeURIComponent(url.pathname.split('/').at(-1)!);
    if (method === 'DELETE') { events.delete(last); return new Response(null, { status: 204 }); }
    if (last !== 'events' && last !== 'calendarView') return events.has(last) ? Response.json(events.get(last)) : Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(provider === 'google' ? { items: [...events.values()], timeZone: 'UTC' } : { value: [...events.values()] });
  }) as typeof fetch;
  const from = `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T09:00:00.000Z`; const to = new Date(Date.parse(from) + 3600000).toISOString();
  const publish = () => service.publish(actor, sessionHash, page.id, 1);
  const visitor = () => service.createSession(target, origin).token;
  const quotes = (raw: string, t = target) => service.slots(t, raw, origin, { from, to });
  const body = (quote: string) => ({ quote, values: { name: 'Visitante', email: 'visitor@example.test' }, idempotencyKey: randomUUID() });
  return { store, service, actor, sessionHash, cookieValue, connection, calendar, page, configuration, target, events, requests, publish, visitor, quotes, body, from, to, intercept: (value: typeof intercept) => { intercept = value; }, advance: (ms: number) => { now += ms; } };
}

test('publication binds real owner session, own connection, canonical resource and current generation', async t => {
  const f = fixture(); t.after(() => f.store.close());
  const result = await f.publish(); assert.match(result.publicPath, /^\/c\/o-/);
  const grant = f.store.list(f.actor.tenantId, 'booking-grants')[0]; assert.equal(grant.canonicalCalendarId, 'canonical-calendar'); assert.equal(grant.publisherUserId, f.actor.userId);
  const text = JSON.stringify(f.service.page(f.target)); assert.ok(!text.includes('remote-owner')); assert.ok(!text.includes('owner@example')); assert.ok(!text.includes('mock-oauth-token'));
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash);
  assert.doesNotThrow(() => f.service.page(f.target)); // Publication is independent of logout.
  await assert.rejects(f.publish(), (error: any) => error.code === 'booking_owner_required');
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { authorizationGeneration: 1 });
  assert.throws(() => f.service.page(f.target), (error: any) => error.code === 'booking_grant_revoked');
});

test('publication rejects another user connection and session revoked during canonicalization', async t => {
  const f = fixture(); t.after(() => f.store.close());
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { userId: 'another-user', visibility: 'shared' });
  await assert.rejects(f.publish(), (error: any) => error.code === 'booking_connection_unavailable'); assert.equal(f.requests.length, 0);
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { userId: f.actor.userId });
  f.intercept(() => { f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash); return Response.json({ id: 'canonical-calendar' }); });
  await assert.rejects(f.publish(), (error: any) => error.code === 'booking_owner_required'); assert.equal(f.store.list(f.actor.tenantId, 'booking-grants').length, 0);
});

test('booking persists encrypted visitor, actual event and local reservation; replay cannot send twice', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const quote = (await f.quotes(visitor)).slots[0];
  const input = f.body(quote.quote); const booked = await f.service.book(f.target, visitor, origin, input);
  assert.equal(booked.status, 'confirmed'); assert.deepEqual(await f.service.book(f.target, visitor, origin, input), booked);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1); const sent = f.requests.find(r => r.method === 'POST')!;
  assert.deepEqual(sent.body!.attendees, []); assert.equal(sent.body!.summary, 'Consulta'); assert.ok(!JSON.stringify(sent.body).includes('visitor@example.test'));
  const record = f.store.list(f.actor.tenantId, 'public-bookings')[0]; assert.ok(typeof record.encryptedVisitor === 'string'); assert.ok(!JSON.stringify(record).includes('visitor@example.test')); assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 0);
  assert.equal(f.store.list(f.actor.tenantId, 'appointments')[0].syncStatus, 'synced');
  await assert.rejects(f.service.book(f.target, visitor, origin, { ...input, values: { ...input.values, name: 'Outra pessoa' } }), (e: any) => e.code === 'idempotency_conflict');
  const other = f.visitor(); assert.throws(() => f.service.status(f.target, other, origin, booked.bookingRef), (e: any) => e.code === 'booking_not_found');
  const sessions = f.store.list(f.actor.tenantId, 'booking-visitor-sessions'); assert.ok(!JSON.stringify(sessions).includes(visitor));
});

test('concurrent aliases of the same calendar cannot reserve the same interval', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish();
  const aliasCalendar = f.store.create(f.actor.tenantId, 'calendars', { ...f.calendar, externalCalendarId: 'canonical-calendar' });
  const aliasPage = f.store.create(f.actor.tenantId, 'booking-pages', { ...f.configuration, calendarId: aliasCalendar.id, slug: 'consulta-2', revision: 1, publicationStatus: 'draft' });
  await f.service.publish(f.actor, f.sessionHash, aliasPage.id, 1); const second = { tenantId: f.actor.tenantId, pageId: aliasPage.id };
  const firstVisitor = f.visitor(), secondVisitor = f.service.createSession(second, origin).token;
  const q1 = (await f.quotes(firstVisitor)).slots[0], q2 = (await f.quotes(secondVisitor, second)).slots[0];
  let release!: () => void; let entered!: () => void; const enteredPromise = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  let paused = false; f.intercept(async (_url, method) => { if (method === 'GET' && !paused) { paused = true; entered(); await gate; } return undefined; });
  const first = f.service.book(f.target, firstVisitor, origin, f.body(q1.quote)); await enteredPromise;
  await assert.rejects(f.service.book(second, secondVisitor, origin, f.body(q2.quote)), (e: any) => e.code === 'booking_slot_taken');
  release(); assert.equal((await first).status, 'confirmed'); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

test('membership revocation during availability prevents write; remove/rejoin never revives grant', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const quote = (await f.quotes(visitor)).slots[0];
  f.intercept((_url, method) => { if (method === 'GET') f.store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=?").run(f.actor.userId); return undefined; });
  await assert.rejects(f.service.book(f.target, visitor, origin, f.body(quote.quote)), (e: any) => e.code === 'booking_grant_revoked');
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 0); assert.equal(f.store.list(f.actor.tenantId, 'public-bookings')[0].status, 'failed');
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(f.actor.userId); seedMember(f.store, f.actor);
  assert.throws(() => f.service.page(f.target), (e: any) => e.code === 'booking_grant_revoked');
});

test('uncertain create holds slot and reconciles remote reality without another POST', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const quote = (await f.quotes(visitor)).slots[0]; const input = f.body(quote.quote);
  f.intercept((_url, method, body) => { if (method === 'POST') { f.events.set(body!.id, body!); throw new Error('synthetic network loss after provider creation'); } return undefined; });
  await assert.rejects(f.service.book(f.target, visitor, origin, input)); const record = f.store.list(f.actor.tenantId, 'public-bookings')[0]; assert.equal(record.status, 'unknown');
  assert.equal((await f.service.book(f.target, visitor, origin, input)).status, 'unknown');
  await assert.rejects(f.service.book(f.target, visitor, origin, { ...input, idempotencyKey: randomUUID() }), (e: any) => e.code === 'booking_slot_taken');
  f.intercept(undefined); const result = await f.service.reconcile(f.actor, f.sessionHash, record.id); assert.equal(result.status, 'confirmed'); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

test('cancel is exclusive to management capability and does not depend on a published page', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const quote = (await f.quotes(visitor)).slots[0]; const booking = await f.service.book(f.target, visitor, origin, f.body(quote.quote));
  const manage = f.service.managementToken(f.target, visitor, origin, booking.bookingRef);
  await assert.rejects(f.service.cancel(f.target, f.visitor(), origin, { bookingRef: booking.bookingRef, idempotencyKey: randomUUID() }), (e: any) => e.code === 'booking_not_found');
  f.service.unpublish(f.actor, f.sessionHash, f.page.id);
  const input = { bookingRef: booking.bookingRef, idempotencyKey: randomUUID() };
  assert.equal((await f.service.cancel(f.target, manage.token, origin, input)).status, 'cancelled');
  assert.equal((await f.service.cancel(f.target, manage.token, origin, input)).status, 'cancelled'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  assert.equal(f.store.list(f.actor.tenantId, 'appointments')[0].status, 'cancelled');
});

test('cancel timeout remains pending until read-only reconciliation confirms deletion', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const booking = await f.service.book(f.target, visitor, origin, f.body((await f.quotes(visitor)).slots[0].quote));
  const manage = f.service.managementToken(f.target, visitor, origin, booking.bookingRef);
  f.intercept((url, method) => { if (method === 'DELETE') { f.events.delete(decodeURIComponent(url.pathname.split('/').at(-1)!)); throw new Error('synthetic cancellation timeout'); } return undefined; });
  await assert.rejects(f.service.cancel(f.target, manage.token, origin, { bookingRef: booking.bookingRef, idempotencyKey: randomUUID() }));
  assert.equal(f.service.status(f.target, visitor, origin, booking.bookingRef).status, 'cancel_pending');
  await assert.rejects(f.service.cancel(f.target, manage.token, origin, { bookingRef: booking.bookingRef, idempotencyKey: randomUUID() }), (e: any) => e.code === 'booking_requires_reconciliation');
  f.intercept(undefined); assert.equal((await f.service.reconcile(f.actor, f.sessionHash, booking.bookingRef)).status, 'cancelled'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});

test('revocation blocks response after upstream write and malformed successful response stays uncertain', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const quote = (await f.quotes(visitor)).slots[0];
  f.intercept((_url, method, body) => { if (method === 'POST') { f.events.set(body!.id, body!); f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { authorizationGeneration: 2 }); return Response.json(body); } return undefined; });
  await assert.rejects(f.service.book(f.target, visitor, origin, f.body(quote.quote)), (e: any) => e.code === 'booking_grant_revoked');
  assert.equal(f.store.list(f.actor.tenantId, 'public-bookings')[0].status, 'unknown');
});

test('Microsoft calendar event identity is reconciled by transactionId, with no attendees', async t => {
  const f = fixture('microsoft'); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const input = f.body((await f.quotes(visitor)).slots[0].quote);
  f.intercept((_url, method, body) => { if (method === 'POST') { f.events.set('remote-ms-id', { ...body, id: 'remote-ms-id' }); throw new Error('synthetic response loss'); } return undefined; });
  await assert.rejects(f.service.book(f.target, visitor, origin, input)); f.intercept(undefined);
  const record = f.store.list(f.actor.tenantId, 'public-bookings')[0]; assert.equal((await f.service.reconcile(f.actor, f.sessionHash, record.id)).status, 'confirmed');
  const sent = f.requests.find(r => r.method === 'POST')!; assert.deepEqual(sent.body!.attendees, []); assert.equal(sent.body!.transactionId, record.reference);
});

test('public HTTP contract rejects origin, admin cookies as visitor and cross-session reads without leaking identifiers', async t => {
  const f = fixture(); t.after(() => f.store.close()); const published = await f.publish(); const app = Fastify(); t.after(() => app.close()); await app.register(cookie); await registerPublicBooking(app, f.store);
  const query = `?orgSlug=${published.orgSlug}&eventSlug=${published.eventSlug}`;
  assert.equal(PUBLIC_BOOKING_PATHS.size, 11);
  assert.equal(PUBLIC_BOOKING_PATHS.has('/api/v1/public/booking/company'), true);
  const wrong = await app.inject({ method: 'POST', url: `/api/v1/public/booking/sessions${query}`, headers: { origin: 'https://evil.example' }, payload: {} }); assert.equal(wrong.statusCode, 403);
  const session = await app.inject({ method: 'POST', url: `/api/v1/public/booking/sessions${query}`, headers: { origin }, payload: {} }); assert.equal(session.statusCode, 201);
  const raw = session.json().token; assert.equal(session.headers['cache-control'], 'no-store');
  const cookieOnly = await app.inject({ method: 'POST', url: `/api/v1/public/booking/slots${query}`, headers: { origin, cookie: `kloel_session=${f.cookieValue}` }, payload: { from: f.from, to: f.to } }); assert.equal(cookieOnly.statusCode, 401);
  const slots = await app.inject({ method: 'POST', url: `/api/v1/public/booking/slots${query}`, headers: { origin, authorization: `Booking ${raw}` }, payload: { from: f.from, to: f.to } }); assert.equal(slots.statusCode, 200); assert.ok(slots.json().slots.length > 0);
  const text = slots.body; assert.ok(!text.includes('canonical-calendar')); assert.ok(!text.includes('remote-owner')); assert.ok(!text.includes('mock-oauth-token'));
  const response = await app.inject({ method: 'POST', url: `/api/v1/public/booking/bookings${query}`, headers: { origin, authorization: `Booking ${raw}` }, payload: { ...f.body(slots.json().slots[0].quote), tenantId: 'other-tenant' } }); assert.equal(response.statusCode, 400);
});

test('expired quote/session, unexpected form and incomplete provider pagination fail closed', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const quote = (await f.quotes(visitor)).slots[0];
  await assert.rejects(f.service.book(f.target, visitor, origin, { ...f.body(quote.quote), values: { name: 'V', email: 'visitor@example.test', owner: 'yes' } }));
  f.advance(6 * 60000); await assert.rejects(f.service.book(f.target, visitor, origin, f.body(quote.quote)), (e: any) => e.code === 'booking_quote_expired');
  f.intercept((url, method) => method === 'GET' && url.pathname.endsWith('/events') ? Response.json({ items: [], nextPageToken: 'repeat' }) : undefined);
  await assert.rejects(f.quotes(visitor), (e: any) => e.code === 'booking_availability_incomplete');
  f.advance(13 * 3600000); assert.throws(() => f.service.session(f.target, visitor, origin), (e: any) => e.code === 'booking_session_expired'); assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
});

test('negative reconciliation does not free an uncertain create or permit retry', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const input = f.body((await f.quotes(visitor)).slots[0].quote);
  f.intercept((_url, method) => { if (method === 'POST') throw new Error('no acknowledgement'); return undefined; }); await assert.rejects(f.service.book(f.target, visitor, origin, input)); f.intercept(undefined);
  const record = f.store.list(f.actor.tenantId, 'public-bookings')[0]; const result = await f.service.reconcile(f.actor, f.sessionHash, record.id);
  assert.equal(result.status, 'unknown'); assert.equal((result as any).reconciliation, 'remote_not_found_outcome_unresolved'); assert.equal(f.store.list(f.actor.tenantId, 'appointments')[0].status, 'scheduled');
});

test('malformed successful response stays uncertain and upstream booking conflict is not confirmed', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const input = f.body((await f.quotes(visitor)).slots[0].quote);
  f.intercept((_url, method) => method === 'POST' ? Response.json({}) : undefined);
  await assert.rejects(f.service.book(f.target, visitor, origin, input), (e: any) => e.code === 'booking_provider_response_invalid');
  assert.equal(f.store.list(f.actor.tenantId, 'public-bookings')[0].status, 'unknown');
  assert.equal(f.store.list(f.actor.tenantId, 'appointments')[0].status, 'scheduled');
});

test('reconciliation cannot resurrect a booking cancelled during the provider read', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const booking = await f.service.book(f.target, visitor, origin, f.body((await f.quotes(visitor)).slots[0].quote));
  const manage = f.service.managementToken(f.target, visitor, origin, booking.bookingRef);
  let release!: () => void; let entered!: () => void; const gate = new Promise<void>(r => { release = r; }); const enteredPromise = new Promise<void>(r => { entered = r; });
  let paused = false; f.intercept(async (url, method) => { if (!paused && method === 'GET' && /\/events\//.test(url.pathname)) { paused = true; const cached = f.events.get(decodeURIComponent(url.pathname.split('/').at(-1)!)); entered(); await gate; return Response.json(cached); } return undefined; });
  const reconciliation = f.service.reconcile(f.actor, f.sessionHash, booking.bookingRef); await enteredPromise;
  assert.equal((await f.service.cancel(f.target, manage.token, origin, { bookingRef: booking.bookingRef, idempotencyKey: randomUUID() })).status, 'cancelled');
  release(); await assert.rejects(reconciliation, (e: any) => e.code === 'booking_state_changed');
  assert.equal(f.service.status(f.target, visitor, origin, booking.bookingRef).status, 'cancelled');
});

test('integrated auth accepts exact booking capabilities and rejects API keys or visitor credentials elsewhere', async t => {
  const f = fixture(); const published = await f.publish(); const app = await buildApp(f.store, { workers: false }); t.after(() => app.close());
  const query = `?orgSlug=${published.orgSlug}&eventSlug=${published.eventSlug}`;
  const created = await app.inject({ method: 'POST', url: `/api/v1/public/booking/sessions${query}`, headers: { origin }, payload: {} }); assert.equal(created.statusCode, 201, created.body);
  const visitor = created.json().token;
  const headers = { origin, authorization: `Booking ${visitor}` };
  const slots = await app.inject({ method: 'POST', url: `/api/v1/public/booking/slots${query}`, headers, payload: { from: f.from, to: f.to } }); assert.equal(slots.statusCode, 200, slots.body);
  const reserved = await app.inject({ method: 'POST', url: `/api/v1/public/booking/bookings${query}`, headers, payload: f.body(slots.json().slots[0].quote) }); assert.equal(reserved.statusCode, 200, reserved.body); assert.equal(reserved.json().status, 'confirmed');
  const reference = reserved.json().bookingRef;
  const status = await app.inject({ url: `/api/v1/public/booking/status${query}&bookingRef=${reference}`, headers }); assert.equal(status.statusCode, 200, status.body);
  const management = await app.inject({ method: 'POST', url: `/api/v1/public/booking/manage-token${query}`, headers, payload: { bookingRef: reference } }); assert.equal(management.statusCode, 200, management.body);
  const canceled = await app.inject({ method: 'POST', url: `/api/v1/public/booking/cancel${query}`, headers: { origin, authorization: `BookingManage ${management.json().token}` }, payload: { bookingRef: reference, idempotencyKey: randomUUID() } }); assert.equal(canceled.statusCode, 200, canceled.body); assert.equal(canceled.json().status, 'cancelled');
  const privateRoute = await app.inject({ url: '/api/v1/scheduling/bookings', headers }); assert.equal(privateRoute.statusCode, 401);
  const key = createApiKey(f.store, f.actor, { name: 'fixture key', scopes: ['calendars:read'] });
  for (const path of PUBLIC_BOOKING_PATHS) {
    const response = await app.inject({ method: path.endsWith('/page') || path.endsWith('/status') ? 'GET' : 'POST', url: `${path}${query}`, headers: { origin, authorization: `Bearer ${key.secret}` } }); assert.equal(response.statusCode, 403, `${path}: ${response.body}`);
  }
  const preflight = await app.inject({ method: 'OPTIONS', url: `/api/v1/public/booking/bookings${query}`, headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } }); assert.equal(preflight.statusCode, 204, preflight.body);
});

test('calendar availability, timezone and larger buffer constrain a broader event type', async t => {
  const f = fixture(); t.after(() => f.store.close());
  const weekday = new Date(f.from).getUTCDay();
  f.store.update(f.actor.tenantId, 'calendars', f.calendar.id, { availability: [{ weekday, start: '09:00', end: '10:00' }], bufferMinutes: 15, timezone: 'UTC' });
  await f.publish(); const visitor = f.visitor(); const result = await f.service.slots(f.target, visitor, origin, { from: new Date(Date.parse(f.from) - 3600000).toISOString(), to: f.to });
  assert.equal(result.slots.length, 1); assert.equal(result.slots[0].startAt, new Date(Date.parse(f.from) + 15 * 60000).toISOString());
  const created = await f.service.book(f.target, visitor, origin, f.body(result.slots[0].quote)); assert.equal(created.status, 'confirmed');
  const stored = f.store.list(f.actor.tenantId, 'public-bookings')[0]; assert.equal(stored.bufferStartAt, f.from); assert.equal(stored.bufferEndAt, f.to);
});

test('calendar policy narrowed during availability prevents the subsequent write', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const quote = (await f.quotes(visitor)).slots[0];
  f.intercept((url, method) => { if (method === 'GET' && url.pathname.endsWith('/events')) f.store.update(f.actor.tenantId, 'calendars', f.calendar.id, { bufferMinutes: 90 }); return undefined; });
  await assert.rejects(f.service.book(f.target, visitor, origin, f.body(quote.quote)), (e: any) => e.code === 'booking_calendar_policy_changed'); assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
});

test('truncation is explicit and points to the next unreturned slot', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor();
  const result = await f.service.slots(f.target, visitor, origin, { from: f.from, to: new Date(Date.parse(f.from) + 7 * 86400000).toISOString() });
  assert.equal(result.slots.length, 200); assert.equal(result.complete, false); assert.equal(result.remoteAvailabilityComplete, true); assert.ok(Date.parse(result.nextFrom!) > Date.parse(result.slots.at(-1)!.startAt));
  const next = await f.service.slots(f.target, visitor, origin, { from: result.nextFrom, to: new Date(Date.parse(f.from) + 7 * 86400000).toISOString() }); assert.equal(next.slots[0].startAt, result.nextFrom);
});

test('read-only calendar ACL and inadequate persisted or actual token scopes cannot publish', async t => {
  const f = fixture(); t.after(() => f.store.close());
  f.intercept(() => Response.json({ id: 'canonical-calendar', accessRole: 'reader' })); await assert.rejects(f.publish(), (e: any) => e.code === 'booking_calendar_read_only');
  f.intercept(undefined); f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { scopes: 'https://www.googleapis.com/auth/calendar.readonly' }); await assert.rejects(f.publish(), (e: any) => e.code === 'booking_oauth_scope_missing');
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { scopes: f.connection.scopes, encryptedTokens: seal({ accessToken: 'mock-oauth-token', expiresAt: Date.now() + 86400000, scope: 'https://www.googleapis.com/auth/calendar.readonly' }, tokenContext(f.connection)) });
  await assert.rejects(f.publish(), (e: any) => e.code === 'booking_oauth_scope_missing'); assert.equal(f.store.list(f.actor.tenantId, 'booking-grants').length, 0);
});

test('legacy local appointments on a canonical alias block the public primary calendar', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish();
  const alias = f.store.create(f.actor.tenantId, 'calendars', { ...f.calendar, externalCalendarId: 'canonical-calendar' });
  f.store.create(f.actor.tenantId, 'appointments', { calendarId: alias.id, startAt: f.from, endAt: f.to, status: 'scheduled' });
  assert.equal((await f.quotes(f.visitor())).slots.length, 0);
});

test('expired create operation cannot resurrect a reservation reconciled and cancelled meanwhile', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const input = f.body((await f.quotes(visitor)).slots[0].quote);
  let release!: () => void; let entered!: () => void; const gate = new Promise<void>(r => { release = r; }); const started = new Promise<void>(r => { entered = r; }); let paused = false;
  f.intercept(async (url, method) => { if (!paused && method === 'GET' && url.pathname.endsWith('/events') && f.events.size) { paused = true; const cached = [...f.events.values()]; entered(); await gate; return Response.json({ items: cached, timeZone: 'UTC' }); } return undefined; });
  const creating = f.service.book(f.target, visitor, origin, input); await started; f.advance(420000);
  const record = f.store.list(f.actor.tenantId, 'public-bookings')[0]; assert.equal((await f.service.reconcile(f.actor, f.sessionHash, record.id)).status, 'confirmed');
  const manage = f.service.managementToken(f.target, visitor, origin, record.id);
  assert.equal((await f.service.cancel(f.target, manage.token, origin, { bookingRef: record.id, idempotencyKey: randomUUID() })).status, 'cancelled');
  release(); await assert.rejects(creating, (e: any) => e.code === 'booking_state_changed');
  assert.equal(f.store.get(f.actor.tenantId, 'public-bookings', record.id)!.status, 'cancelled'); assert.equal(f.store.list(f.actor.tenantId, 'appointments')[0].status, 'cancelled'); assert.equal(f.events.size, 0);
});

test('remote GET cannot substitute another event identity for cancellation or reconciliation', async t => {
  const f = fixture(); t.after(() => f.store.close()); await f.publish(); const visitor = f.visitor(); const booking = await f.service.book(f.target, visitor, origin, f.body((await f.quotes(visitor)).slots[0].quote));
  const manage = f.service.managementToken(f.target, visitor, origin, booking.bookingRef); const actual = [...f.events.values()][0];
  f.intercept((url, method) => method === 'GET' && /\/events\//.test(url.pathname) ? Response.json({ ...actual, id: 'another-event' }) : undefined);
  await assert.rejects(f.service.cancel(f.target, manage.token, origin, { bookingRef: booking.bookingRef, idempotencyKey: randomUUID() }), (e: any) => e.code === 'booking_provider_response_invalid');
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0); assert.equal(f.service.status(f.target, visitor, origin, booking.bookingRef).status, 'confirmed');
  await assert.rejects(f.service.reconcile(f.actor, f.sessionHash, booking.bookingRef), (e: any) => e.code === 'booking_provider_response_invalid');
});
