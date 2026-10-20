import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerPublicBooking } from '../src/public-booking.js';
import { PublicBookingService } from '../src/public-booking/service.js';
import { validateEventTypeConfig } from '../src/scheduling/service.js';
import { CONTEXT_HEADERS } from '../src/request-context.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { tokenContext } from '../src/oauth/access.js';
import { seedMember } from './fixtures/membership.js';

const origin = 'http://127.0.0.1:4310';
type ProviderRequest = { url: URL; method: string; body: any; headers: Headers };
async function fixture(t: TestContext) {
  const priorFetch = globalThis.fetch, priorKey = process.env.OAUTH_ENCRYPTION_KEY, priorOrigin = process.env.PUBLIC_BASE_URL;
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 43).toString('base64'); process.env.PUBLIC_BASE_URL = origin;
  const store = new Store(), app = Fastify(), actor = { userId: 'booking-context-owner', tenantId: 'booking-context-tenant', role: 'owner' as const };
  seedMember(store, actor);
  const cookies = { kloel_session: 'synthetic-booking-context-cookie' }, sessionHash = digest(cookies.kloel_session);
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, actor.tenantId, Date.now() + 86400000);
  const service = new PublicBookingService(store), scopes = 'https://www.googleapis.com/auth/calendar';
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider: 'google', userId: actor.userId, status: 'connected', remoteId: 'synthetic-account', visibility: 'personal', capabilities: ['calendar', 'calendar_write'], scopes });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'synthetic-booking-token', scope: scopes, expiresAt: Date.now() + 86400000 }, tokenContext(connection)) });
  const calendar = store.create(actor.tenantId, 'calendars', { provider: 'google', enabled: true, connectionId: connection.id, externalCalendarId: 'primary', timezone: 'UTC' });
  const config = validateEventTypeConfig({ name: 'Context test', slug: 'context-test', calendarId: calendar.id, enabled: true, timezone: 'UTC', durationMinutes: 30, bufferMinutes: 0, minimumNoticeMinutes: 0, horizonDays: 30, dailyLimit: 20, slotIntervalMinutes: 15, availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' })), form: [] });
  const page = store.create(actor.tenantId, 'booking-pages', { ...config, revision: 1, publicationStatus: 'draft' }), target = { tenantId: actor.tenantId, pageId: page.id };
  const events = new Map<string, any>(), requests: ProviderRequest[] = [];
  let intercept: ((r: ProviderRequest) => Response | undefined | Promise<Response | undefined>) | undefined;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const r = { url: new URL(String(input)), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) };
    assert.equal(r.url.hostname, 'www.googleapis.com'); assert.equal(r.headers.get('authorization'), 'Bearer synthetic-booking-token'); requests.push(r);
    const handled = await intercept?.(r); if (handled) return handled;
    const id = decodeURIComponent(r.url.pathname.split('/').at(-1)!);
    if (r.method === 'GET' && !/\/events(\/|$)/.test(r.url.pathname)) return Response.json({ id: 'synthetic-canonical-calendar', accessRole: 'owner', primary: true });
    if (r.method === 'POST') { const event = { ...r.body, etag: '"version-1"' }; events.set(event.id, event); return Response.json(event, { status: 201 }); }
    if (r.method === 'PATCH') { const event = { ...events.get(id), ...r.body, etag: '"version-2"' }; events.set(id, event); return Response.json(event); }
    if (r.method === 'DELETE') { events.delete(id); return new Response(null, { status: 204 }); }
    if (id === 'events') return Response.json({ items: [...events.values()], timeZone: 'UTC' });
    return events.has(id) ? Response.json(events.get(id)) : Response.json({}, { status: 404 });
  }) as typeof fetch;
  await app.register(cookie); await registerAuth(app, store); await registerPublicBooking(app, store);
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = priorFetch; if (priorKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = priorKey; if (priorOrigin === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = priorOrigin; });
  const freshHeaders = async () => {
    const me = await app.inject({ url: '/api/v1/auth/me', cookies }); assert.equal(me.statusCode, 200, me.body);
    const context = me.json().context;
    return Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, header]) => [header, context[key] ?? '-']));
  };
  const headers = await freshHeaders();
  const request = (url: string, payload?: unknown, expected = headers) => app.inject({ method: payload === undefined ? 'GET' : 'POST', url, cookies, headers: expected, ...(payload === undefined ? {} : { payload }) });
  const aba = () => {
    store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('admin', actor.userId);
    store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('owner', actor.userId);
  };
  const arm = (boundary: 'BEGIN' | 'COMMIT', occurrence = 1) => {
    const original = store.db.exec.bind(store.db); let seen = 0, changed = false;
    store.db.exec = (sql: string) => {
      if (sql.startsWith(boundary) && ++seen === occurrence) {
        if (boundary === 'COMMIT') { const result = original(sql); aba(); changed = true; return result; }
        aba(); changed = true;
      }
      return original(sql);
    };
    return () => { store.db.exec = original; assert.equal(changed, true, 'test must exercise the chosen boundary'); };
  };
  const publish = () => service.publish(actor, sessionHash, page.id, 1);
  const from = new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T09:00:00.000Z', to = new Date(Date.parse(from) + 4 * 3600000).toISOString();
  const seedBooking = async () => {
    await publish(); const visitor = service.createSession(target, origin).token;
    const quote = (await service.slots(target, visitor, origin, { from, to })).slots[0];
    const body = { quote: quote.quote, values: {}, idempotencyKey: randomUUID() };
    const booked = await service.book(target, visitor, origin, body);
    const manage = service.managementToken(target, visitor, origin, booked.bookingRef).token;
    const record = () => store.get(actor.tenantId, 'public-bookings', booked.bookingRef)!;
    return { visitor, booked, body, manage, record };
  };
  const uncertainMove = async () => {
    const b = await seedBooking();
    const quote = (await service.rescheduling.slots(target, b.manage, origin, { bookingRef: b.booked.bookingRef, from, to })).slots.find(q => Date.parse(q.startAt) >= Date.parse(from) + 3600000)!;
    const body = { bookingRef: b.booked.bookingRef, expectedRevision: 1, quote: quote.quote, idempotencyKey: randomUUID() };
    intercept = r => { if (r.method === 'PATCH') { const id = String(b.record().remoteEventId); events.set(id, { ...events.get(id), ...r.body, etag: '"accepted-lost"' }); throw new Error('synthetic lost response after acceptance'); } };
    await assert.rejects(service.rescheduling.reschedule(target, b.manage, origin, body)); intercept = undefined;
    assert.equal(b.record().status, 'reschedule_unknown');
    return { ...b, quote, moveBody: body };
  };
  const snapshot = () => ['booking-pages', 'booking-grants', 'public-bookings', 'appointments', 'booking-reschedule-operations'].map(collection => store.list(actor.tenantId, collection));
  return { app, store, actor, service, sessionHash, cookies, headers, freshHeaders, request, requests, events, page, target, from, to, publish, seedBooking, uncertainMove, snapshot, aba, arm, intercept: (next: typeof intercept) => { intercept = next; } };
}

function changed(response: any) {
  assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'context_changed_in_flight');
  for (const secret of ['synthetic-booking-token', 'synthetic-account', 'synthetic-canonical-calendar']) assert.ok(!response.body.includes(secret));
}

for (const boundary of ['provider', 'BEGIN'] as const) test(`publication rejects owner/admin/owner ABA at ${boundary} with no grant or page mutation`, async t => {
  const f = await fixture(t), before = f.snapshot();
  let changedAtProvider = false;
  if (boundary === 'provider') f.intercept(() => { if (!changedAtProvider) { changedAtProvider = true; f.aba(); } });
  const disarm = boundary === 'BEGIN' ? f.arm('BEGIN') : undefined;
  const result = await f.request(`/api/v1/scheduling/event-types/${f.page.id}/publish`, { revision: 1 }); disarm?.();
  changed(result); assert.deepEqual(f.snapshot(), before); assert.equal(f.requests.length, 1);
});

for (const action of ['unpublish', 'revoke-grant'] as const) test(`${action} rechecks context inside BEGIN and preserves publication and grant`, async t => {
  const f = await fixture(t); await f.publish(); const before = f.snapshot(), disarm = f.arm('BEGIN');
  const result = await f.request(`/api/v1/scheduling/event-types/${f.page.id}/${action}`, {}); disarm();
  changed(result); assert.deepEqual(f.snapshot(), before); assert.equal(f.requests.length, 1);
});

test('private booking list suppresses late data after context changes during read', async t => {
  const f = await fixture(t); await f.seedBooking(); const original = f.store.list.bind(f.store); let armed = true;
  f.store.list = (tenant, collection) => { const rows = original(tenant, collection); if (armed && collection === 'public-bookings') { armed = false; f.aba(); } return rows; };
  const result = await f.request('/api/v1/scheduling/bookings'); f.store.list = original;
  changed(result); assert.equal(armed, false); assert.ok(!result.body.includes('bookingRef'));
});

for (const boundary of ['provider', 'BEGIN'] as const) test(`booking reconciliation rejects context ABA at ${boundary} while retaining accepted event evidence`, async t => {
  const f = await fixture(t), b = await f.seedBooking();
  f.store.update(f.actor.tenantId, 'public-bookings', b.booked.bookingRef, { status: 'unknown' });
  const before = f.snapshot(), beforeWrites = f.requests.filter(r => r.method !== 'GET').length;
  let atProvider = false;
  if (boundary === 'provider') f.intercept(() => { if (!atProvider) { atProvider = true; f.aba(); } });
  const disarm = boundary === 'BEGIN' ? f.arm('BEGIN') : undefined;
  const result = await f.request(`/api/v1/scheduling/bookings/${b.booked.bookingRef}/reconcile`, {}); disarm?.();
  changed(result); assert.deepEqual(f.snapshot(), before); assert.equal(f.requests.filter(r => r.method !== 'GET').length, beforeWrites);
  assert.ok(f.events.has(String(b.record().remoteEventId))); f.intercept(undefined);
  const recovered = await f.request(`/api/v1/scheduling/bookings/${b.booked.bookingRef}/reconcile`, {}, await f.freshHeaders());
  assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().status, 'confirmed'); assert.equal(f.requests.filter(r => r.method !== 'GET').length, beforeWrites);
});

test('reconciliation committed before context loss remains confirmed and is recovered by GET without a second provider write', async t => {
  const f = await fixture(t), b = await f.seedBooking();
  f.store.update(f.actor.tenantId, 'public-bookings', b.booked.bookingRef, { status: 'unknown' });
  const remoteId = b.record().remoteEventId, disarm = f.arm('COMMIT');
  const result = await f.request(`/api/v1/scheduling/bookings/${b.booked.bookingRef}/reconcile`, {}); disarm(); changed(result);
  assert.equal(b.record().status, 'confirmed'); assert.equal(b.record().remoteEventId, remoteId);
  const recovered = await f.request('/api/v1/scheduling/bookings', undefined, await f.freshHeaders());
  assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().items[0].status, 'confirmed'); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

for (const boundary of ['lease', 'provider', 'resolution'] as const) test(`reschedule reconciliation ${boundary} ABA retains both holds and accepted PATCH without repeat`, async t => {
  const f = await fixture(t), b = await f.uncertainMove(), before = f.snapshot(), original = b.record();
  let atProvider = false;
  if (boundary === 'provider') f.intercept(() => { if (!atProvider) { atProvider = true; f.aba(); } });
  const disarm = boundary !== 'provider' ? f.arm('BEGIN', boundary === 'lease' ? 1 : 2) : undefined;
  const result = await f.request(`/api/v1/scheduling/bookings/${b.booked.bookingRef}/reconcile`, {}); disarm?.(); changed(result);
  if (boundary === 'lease') assert.deepEqual(f.snapshot(), before);
  const current = b.record(); assert.equal(current.status, 'reschedule_unknown'); assert.equal(current.operationInFlightUntil, 0);
  assert.equal(current.remoteEventId, original.remoteEventId); assert.deepEqual(current.reschedule, original.reschedule);
  assert.equal(f.store.list(f.actor.tenantId, 'appointments').filter(a => a.status === 'scheduled').length, 2);
  assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 1);
  const grant = f.store.list(f.actor.tenantId, 'booking-grants')[0];
  assert.equal(f.service.localBusy(f.target, grant, String(original.startAt), String(original.endAt)), true);
  assert.equal(f.service.localBusy(f.target, grant, b.quote.startAt, b.quote.endAt), true);
  f.intercept(undefined);
  const recovered = await f.request(`/api/v1/scheduling/bookings/${b.booked.bookingRef}/reconcile`, {}, await f.freshHeaders());
  assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().status, 'confirmed'); assert.equal(recovered.json().startAt, b.quote.startAt);
  assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 1); assert.equal(f.store.list(f.actor.tenantId, 'appointments').filter(a => a.status === 'scheduled').length, 1);
});

test('public visitor create, replay and cancel stay independent of owner logout and retain actual provider receipts', async t => {
  const f = await fixture(t), published = await f.publish(), visitor = f.service.createSession(f.target, origin).token;
  const quote = (await f.service.slots(f.target, visitor, origin, { from: f.from, to: f.to })).slots[0];
  const body = { quote: quote.quote, values: {}, idempotencyKey: randomUUID() }, query = new URLSearchParams({ orgSlug: published.orgSlug, eventSlug: published.eventSlug }).toString();
  f.intercept(r => { if (r.method === 'POST') f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash); });
  const send = () => f.app.inject({ method: 'POST', url: '/api/v1/public/booking/bookings?' + query, headers: { origin, authorization: 'Booking ' + visitor }, payload: body });
  const accepted = await send(); assert.equal(accepted.statusCode, 200, accepted.body); assert.equal(accepted.json().status, 'confirmed');
  assert.equal((await send()).json().bookingRef, accepted.json().bookingRef); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  const booking = f.store.get(f.actor.tenantId, 'public-bookings', accepted.json().bookingRef)!; assert.ok(f.events.has(String(booking.remoteEventId)));
  assert.equal((await f.request('/api/v1/scheduling/bookings')).statusCode, 401);
  const manage = f.service.managementToken(f.target, visitor, origin, booking.id).token;
  const canceled = await f.app.inject({ method: 'POST', url: '/api/v1/public/booking/cancel?' + query, headers: { origin, authorization: 'BookingManage ' + manage }, payload: { bookingRef: booking.id, idempotencyKey: randomUUID() } });
  assert.equal(canceled.statusCode, 200, canceled.body); assert.equal(canceled.json().status, 'cancelled'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});
