import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../../src/store.js';
import { registerAuth } from '../../src/auth.js';
import { registerPublicBooking } from '../../src/public-booking.js';
import { PublicBookingService } from '../../src/public-booking/service.js';
import { validateEventTypeConfig } from '../../src/scheduling/service.js';
import { CONTEXT_HEADERS } from '../../src/request-context.js';
import { digest, seal } from '../../src/oauth/crypto.js';
import { tokenContext } from '../../src/oauth/access.js';
import { seedMember } from './membership.js';

export const bookingOrigin = 'http://127.0.0.1:4310';
export type BookingProviderRequest = { url: URL; method: string; body: any; headers: Headers };
export async function bookingOperatorFixture(t: TestContext, provider: 'google' | 'microsoft' = 'google', setup?: (app: FastifyInstance, store: Store) => void | Promise<void>) {
  const priorFetch = globalThis.fetch, priorKey = process.env.OAUTH_ENCRYPTION_KEY, priorOrigin = process.env.PUBLIC_BASE_URL;
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 43).toString('base64'); process.env.PUBLIC_BASE_URL = bookingOrigin;
  const store = new Store(), app = Fastify(), actor = { userId: 'booking-operator-owner', tenantId: 'booking-operator-tenant', role: 'owner' as const };
  seedMember(store, actor); let now = Date.now();
  const cookies = { kloel_session: 'synthetic-booking-operator-cookie' }, sessionHash = digest(cookies.kloel_session);
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, actor.tenantId, now + 86400000);
  const service = new PublicBookingService(store, () => now), scopes = provider === 'google' ? 'https://www.googleapis.com/auth/calendar' : 'Calendars.ReadWrite';
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider, userId: actor.userId, status: 'connected', remoteId: 'synthetic-account', visibility: 'personal', capabilities: ['calendar', 'calendar_write'], scopes });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'synthetic-booking-token', scope: scopes, expiresAt: now + 86400000 }, tokenContext(connection)) });
  const calendar = store.create(actor.tenantId, 'calendars', { provider, enabled: true, connectionId: connection.id, externalCalendarId: 'primary', timezone: 'UTC' });
  const config = validateEventTypeConfig({ name: 'Operator test', slug: 'operator-test', calendarId: calendar.id, enabled: true, timezone: 'UTC', durationMinutes: 30, bufferMinutes: 0, minimumNoticeMinutes: 0, horizonDays: 30, dailyLimit: 20, slotIntervalMinutes: 15, availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' })), form: [] });
  const page = store.create(actor.tenantId, 'booking-pages', { ...config, revision: 1, publicationStatus: 'draft' }), target = { tenantId: actor.tenantId, pageId: page.id };
  const events = new Map<string, any>(), requests: BookingProviderRequest[] = [];
  const hooks: { provider?: (r: BookingProviderRequest) => Response | undefined | Promise<Response | undefined> } = {};
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const r = { url: new URL(String(input)), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) };
    assert.ok(['www.googleapis.com', 'graph.microsoft.com'].includes(r.url.hostname)); assert.equal(r.headers.get('authorization'), 'Bearer synthetic-booking-token'); requests.push(r);
    const handled = await hooks.provider?.(r); if (handled) return handled;
    const id = decodeURIComponent(r.url.pathname.split('/').at(-1)!);
    if (r.method === 'GET' && !/\/(events|calendarView)(\/|$)/.test(r.url.pathname)) return Response.json({ id: 'synthetic-canonical-calendar', accessRole: 'owner', canEdit: true, primary: true });
    if (r.method === 'POST') { const event = { ...r.body, id: r.body.id ?? `graph-${events.size + 1}`, etag: '"version-1"' }; events.set(event.id, event); return Response.json(event, { status: 201 }); }
    if (r.method === 'PATCH') { const event = { ...events.get(id), ...r.body, etag: '"version-2"' }; events.set(id, event); return Response.json(event); }
    if (r.method === 'DELETE') { if (r.headers.has('if-match') && r.headers.get('if-match') !== events.get(id)?.etag) return Response.json({}, { status: 412 }); events.delete(id); return new Response(null, { status: 204 }); }
    if (id === 'events' || id === 'calendarView') return Response.json(provider === 'google' ? { items: [...events.values()], timeZone: 'UTC' } : { value: [...events.values()] });
    return events.has(id) ? Response.json(events.get(id)) : Response.json({}, { status: 404 });
  }) as typeof fetch;
  await app.register(cookie); await registerAuth(app, store); await registerPublicBooking(app, store, { now: () => now });
  await setup?.(app, store);
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = priorFetch; if (priorKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = priorKey; if (priorOrigin === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = priorOrigin; });
  const freshHeaders = async () => {
    const me = await app.inject({ url: '/api/v1/auth/me', cookies }); assert.equal(me.statusCode, 200, me.body);
    const context = me.json().context;
    return Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, header]) => [header, context[key] ?? '-']));
  };
  const headers = await freshHeaders();
  const request = (url: string, payload?: unknown, expected = headers, key?: string) => app.inject({ method: payload === undefined ? 'GET' : 'POST', url, cookies, headers: { ...expected, ...(key ? { 'idempotency-key': key } : {}) }, ...(payload === undefined ? {} : { payload }) });
  const aba = () => { store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('admin', actor.userId); store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('owner', actor.userId); };
  const from = new Date(now + 86400000).toISOString().slice(0, 10) + 'T09:00:00.000Z', to = new Date(Date.parse(from) + 4 * 3600000).toISOString();
  await service.publish(actor, sessionHash, page.id, 1);
  const visitor = service.createSession(target, bookingOrigin).token;
  const quote = (await service.slots(target, visitor, bookingOrigin, { from, to })).slots[0];
  const booked = await service.book(target, visitor, bookingOrigin, { quote: quote.quote, values: {}, idempotencyKey: randomUUID() });
  const manage = service.managementToken(target, visitor, bookingOrigin, booked.bookingRef).token;
  const record = () => store.get(actor.tenantId, 'public-bookings', booked.bookingRef)!;
  const cancel = (key = randomUUID(), revision = 1, expected = headers) => request(`/api/v1/scheduling/bookings/${booked.bookingRef}/cancel`, { expectedTenantId: actor.tenantId, expectedRevision: revision, confirm: true }, expected, key);
  const operation = (key: string, expected = headers) => request(`/api/v1/scheduling/operations/${key}`, undefined, expected);
  const reconcile = (expected = headers) => request(`/api/v1/scheduling/bookings/${booked.bookingRef}/reconcile`, {}, expected);
  requests.length = 0;
  return { app, store, actor, service, sessionHash, cookies, headers, freshHeaders, request, requests, events, hooks, connection, page, target, from, to, visitor, booked, manage, record, cancel, operation, reconcile, aba, advance: (ms: number) => { now += ms; } };
}
