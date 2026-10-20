import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { registerScheduling } from '../src/scheduling.js';
import { createEventType, updateEventType, getEventType, bookingPagesCollection, eventTypeConfigFromRecord, validateBookingWindow, validateBookingForm, validateEventTypeConfig } from '../src/scheduling/service.js';
import { seedMember } from './fixtures/membership.js';
import type { MembershipActor } from '../src/memberships/service.js';

const base = '/api/v1/scheduling/event-types';
const password = 'scheduling-test-password';
const cookiesOf = (response: any) => ({ kloel_session: response.cookies.find((c: any) => c.name === 'kloel_session').value as string });
const owner: MembershipActor = { userId: 'scheduling-owner', tenantId: 'scheduling-tenant', role: 'owner' };
function calendarFor(store: Store, actor: MembershipActor, patch: Record<string, unknown> = {}) {
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider: 'google', remoteId: `remote-${actor.userId}`, userId: actor.userId, email: 'owner@example.test', visibility: 'personal', status: 'connected', capabilities: ['calendar', 'calendar_write'] });
  const calendar = store.create(actor.tenantId, 'calendars', { name: 'Connected calendar', provider: 'google', connectionId: connection.id, externalCalendarId: 'primary', enabled: true, timezone: 'America/Sao_Paulo', ...patch });
  return { calendar, connection };
}
function input(calendarId: string, patch: Record<string, unknown> = {}) {
  return { name: 'Consulta', slug: 'consulta', calendarId, timezone: 'America/Sao_Paulo', durationMinutes: 30, bufferMinutes: 15, minimumNoticeMinutes: 60, horizonDays: 30, dailyLimit: 8, slotIntervalMinutes: 15, availability: [{ weekday: 1, start: '09:00', end: '18:00' }], form: [{ field: 'name', label: 'Nome', required: true }, { field: 'email', label: 'E-mail', required: false }], agentIds: [], ...patch };
}
async function fixture() {
  const store = new Store(), app = Fastify(); await app.register(cookie); await registerAuth(app, store); await registerScheduling(app, store);
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'owner@example.test', password, organization: 'Scheduling tenant' } });
  assert.equal(signup.statusCode, 201, signup.body);
  const actor = signup.json() as MembershipActor, cookies = cookiesOf(signup);
  const { calendar, connection } = calendarFor(store, actor);
  const create = (patch: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: base, cookies, payload: input(calendar.id, patch) });
  return { app, store, actor, cookies, calendar, connection, create, close: async () => { await app.close(); store.close(); } };
}
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected); return true; };

test('private event-type CRUD persists draft, paginates, uses CAS and never publishes or sends', async t => {
  const f = await fixture(); t.after(f.close);
  const created = await f.create({ slug: '  Consulta  ' }); assert.equal(created.statusCode, 201, created.body);
  const item = created.json(); assert.equal(item.tenantId, f.actor.tenantId); assert.equal(item.revision, 1); assert.equal(item.publicationStatus, 'draft'); assert.equal(item.slug, 'consulta');
  assert.equal((await f.create()).statusCode, 409);
  const second = await f.create({ slug: 'segunda' }); assert.equal(second.statusCode, 201);
  const listing = (await f.app.inject({ url: `${base}?page=2&limit=1`, cookies: f.cookies })).json(); assert.equal(listing.items.length, 1); assert.equal(listing.total, 2); assert.equal(listing.totalPages, 2);
  const updated = await f.app.inject({ method: 'PATCH', url: `${base}/${item.id}`, cookies: f.cookies, payload: { revision: 1, name: 'Consulta atualizada', publicationStatus: 'unpublished' } });
  assert.equal(updated.statusCode, 200, updated.body); assert.equal(updated.json().revision, 2); assert.equal(updated.json().durationMinutes, 30); assert.equal(updated.json().publicationStatus, 'unpublished');
  const stale = await f.app.inject({ method: 'PATCH', url: `${base}/${item.id}`, cookies: f.cookies, payload: { revision: 1, name: 'Lost update' } }); assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'event_type_revision_conflict');
  assert.equal((await f.app.inject({ method: 'DELETE', url: `${base}/${item.id}?revision=1`, cookies: f.cookies })).statusCode, 409);
  assert.equal((await f.app.inject({ method: 'DELETE', url: `${base}/${item.id}?revision=2`, cookies: f.cookies })).statusCode, 204);
  assert.equal((await f.app.inject({ url: `${base}/${item.id}`, cookies: f.cookies })).statusCode, 404);
  for (const collection of ['booking-grants', 'public-bookings', 'appointments', 'provider-operations', 'messages']) assert.equal(f.store.list(f.actor.tenantId, collection).length, 0);
});

test('tenant isolation covers IDs, calendar/agent references and per-tenant slug uniqueness', async t => {
  const f = await fixture(); t.after(f.close);
  const created = (await f.create()).json();
  const other = await f.app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'other@example.test', password, organization: 'Other tenant' } });
  const actor = other.json() as MembershipActor, cookies = cookiesOf(other), foreign = calendarFor(f.store, actor);
  const own = await f.app.inject({ method: 'POST', url: base, cookies, payload: input(foreign.calendar.id) }); assert.equal(own.statusCode, 201, own.body);
  for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
    const result = await f.app.inject({ method, url: `${base}/${created.id}${method === 'DELETE' ? '?revision=1' : ''}`, cookies, ...(method === 'PATCH' ? { payload: { revision: 1, name: 'Cross tenant' } } : {}) }); assert.equal(result.statusCode, 404, result.body);
  }
  assert.equal((await f.create({ slug: 'foreign-calendar', calendarId: foreign.calendar.id })).statusCode, 404);
  const agent = f.store.create(actor.tenantId, 'agents', { name: 'Other agent' });
  assert.equal((await f.create({ slug: 'foreign-agent', agentIds: [agent.id] })).statusCode, 404);
  assert.equal(f.store.list(f.actor.tenantId, bookingPagesCollection).length, 1);
});

test('fresh membership capabilities govern reads and writes independently', async t => {
  const f = await fixture(); t.after(f.close);
  const item = (await f.create()).json();
  for (const [role, read, write] of [['admin', 200, 200], ['member', 200, 403], ['editor', 403, 403], ['builder', 403, 403], ['viewer', 403, 403]] as const) {
    f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run(role, f.actor.userId, f.actor.tenantId);
    assert.equal((await f.app.inject({ url: base, cookies: f.cookies })).statusCode, read, role);
    const result = await f.app.inject({ method: 'PATCH', url: `${base}/${item.id}`, cookies: f.cookies, payload: { revision: role === 'admin' ? 1 : 2, name: `Role ${role}` } }); assert.equal(result.statusCode, write, `${role}: ${result.body}`);
  }
  assert.throws(() => updateEventType(f.store, f.actor, item.id, { revision: 2, name: 'Captured owner' }), code('forbidden'));
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.actor.userId, f.actor.tenantId);
  assert.throws(() => getEventType(f.store, f.actor, item.id), code('unauthorized'));
});

test('expired/revoked human sessions and valid Kloel API keys cannot configure scheduling', async t => {
  const f = await fixture(); t.after(f.close);
  const key = await f.app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies: f.cookies, payload: { name: 'Calendar API', scopes: ['calendars:read', 'calendars:write'] } }); assert.equal(key.statusCode, 201);
  assert.equal((await f.app.inject({ url: base, cookies: f.cookies, headers: { authorization: `Bearer ${key.json().secret}` } })).statusCode, 403);
  assert.equal((await f.app.inject({ method: 'POST', url: base, payload: input(f.calendar.id) })).statusCode, 401);
  const hash = sessionDigest(f.cookies.kloel_session);
  f.store.db.prepare('UPDATE sessions SET expires=? WHERE hash=?').run(0, hash);
  assert.equal((await f.create()).statusCode, 401);
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash);
  assert.equal((await f.app.inject({ url: base, cookies: f.cookies })).statusCode, 401);
  assert.equal(f.store.list(f.actor.tenantId, bookingPagesCollection).length, 0);
});

test('strict configuration rejects publication/authority injection, invalid bounds, schedule and form', async t => {
  const f = await fixture(); t.after(f.close);
  const cases: Record<string, unknown>[] = [
    { tenantId: 'foreign' }, { revision: 9 }, { grantId: randomUUID() }, { publicationStatus: 'published' }, { notificationStatus: 'sent' },
    { slug: '../x' }, { timezone: 'Brazil/Invalid' }, { timezone: '+03:00' }, { durationMinutes: 4 }, { durationMinutes: 481 }, { bufferMinutes: 241 }, { minimumNoticeMinutes: -1 }, { minimumNoticeMinutes: 1441, horizonDays: 1 }, { horizonDays: 0 }, { horizonDays: 366 }, { dailyLimit: 0 }, { dailyLimit: 1001 }, { slotIntervalMinutes: 0 },
    { availability: [] }, { availability: [{ weekday: 7, start: '09:00', end: '10:00' }] }, { availability: [{ weekday: 1, start: '10:00', end: '09:00' }] }, { availability: [{ weekday: 1, start: '09:00', end: '24:01' }] }, { availability: [{ weekday: 1, start: '09:00', end: '11:00' }, { weekday: 1, start: '10:00', end: '12:00' }] },
    { form: [{ field: 'password', label: 'Password' }] }, { form: [{ field: 'email', label: 'E-mail', type: 'text' }] }, { form: [{ field: 'email', label: 'One' }, { field: 'email', label: 'Two' }] },
  ];
  for (const patch of cases) { const response = await f.create(patch); assert.equal(response.statusCode, 400, `${JSON.stringify(patch)}: ${response.body}`); }
  assert.equal(f.store.list(f.actor.tenantId, bookingPagesCollection).length, 0);
});

test('calendar must be external, enabled, connected, accessible and match provider', async t => {
  const f = await fixture(); t.after(f.close);
  const updates: [Record<string, unknown>, number][] = [[{ provider: 'local' }, 400], [{ externalCalendarId: '' }, 400], [{ enabled: false }, 409], [{ provider: 'microsoft' }, 409]];
  for (const [patch, expected] of updates) {
    f.store.update(f.actor.tenantId, 'calendars', f.calendar.id, { ...f.calendar, ...patch }); assert.equal((await f.create()).statusCode, expected);
  }
  f.store.update(f.actor.tenantId, 'calendars', f.calendar.id, f.calendar);
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { status: 'disconnected' }); assert.equal((await f.create()).statusCode, 503);
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { status: 'connected', capabilities: [] }); assert.equal((await f.create()).statusCode, 403);
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { capabilities: ['calendar'], userId: 'other-owner', visibility: 'personal' }); assert.equal((await f.create()).statusCode, 404);
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { visibility: 'shared' });
  assert.equal((await f.create()).statusCode, 201); // Draft is not consent to publish another member's connection.
});

test('published pages cannot be changed through CRUD; grants and bookings prevent deletion', async t => {
  const f = await fixture(); t.after(f.close);
  const item = (await f.create()).json();
  f.store.update(f.actor.tenantId, bookingPagesCollection, item.id, { publicationStatus: 'published', grantId: 'private-grant' });
  const read = await f.app.inject({ url: `${base}/${item.id}`, cookies: f.cookies }); assert.equal(read.json().publicationStatus, 'published'); assert.ok(!read.body.includes('private-grant'));
  assert.equal((await f.app.inject({ method: 'PATCH', url: `${base}/${item.id}`, cookies: f.cookies, payload: { revision: 1, publicationStatus: 'unpublished' } })).statusCode, 409);
  assert.equal((await f.app.inject({ method: 'DELETE', url: `${base}/${item.id}?revision=1`, cookies: f.cookies })).statusCode, 409);
  f.store.update(f.actor.tenantId, bookingPagesCollection, item.id, { publicationStatus: 'unpublished', publicOrgSlug: 'o-public' });
  const renamed = await f.app.inject({ method: 'PATCH', url: `${base}/${item.id}`, cookies: f.cookies, payload: { revision: 1, slug: 'broken-existing-links' } });
  assert.equal(renamed.statusCode, 409); assert.equal(renamed.json().error.code, 'event_type_slug_locked');
  for (const collection of ['booking-grants', 'public-bookings', 'appointments']) {
    const link = f.store.create(f.actor.tenantId, collection, { pageId: item.id });
    const response = await f.app.inject({ method: 'DELETE', url: `${base}/${item.id}?revision=1`, cookies: f.cookies }); assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'event_type_in_use');
    f.store.remove(f.actor.tenantId, collection, link.id);
  }
});

test('configuration survives a temporary SQLite restart and stale CAS does not overwrite it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kloel-scheduling-')), file = join(directory, 'fixture.sqlite'); let store = new Store(file);
  try {
    seedMember(store, owner); const { calendar } = calendarFor(store, owner);
    const page = createEventType(store, owner, input(calendar.id)); store.close(); store = new Store(file);
    const current = getEventType(store, owner, page.id); assert.equal(current.name, 'Consulta'); assert.equal(current.revision, 1);
    const updated = updateEventType(store, owner, page.id, { revision: 1, dailyLimit: 3 }); assert.equal(updated.revision, 2);
    assert.throws(() => updateEventType(store, owner, page.id, { revision: 1, dailyLimit: 99 }), code('event_type_revision_conflict'));
    assert.equal(getEventType(store, owner, page.id).dailyLimit, 3);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

const config = (patch: Record<string, unknown> = {}) => validateEventTypeConfig(input(randomUUID(), patch));
const now = Date.parse('2026-10-18T12:00:00Z');
test('window derives end and buffers in UTC while respecting local weekday, grid, notice and daily count', () => {
  const c = config(); const result = validateBookingWindow(c, { startAt: '2026-10-19T09:15:00-03:00' }, { now });
  assert.deepEqual(result, { startAt: '2026-10-19T12:15:00.000Z', endAt: '2026-10-19T12:45:00.000Z', bufferStartAt: '2026-10-19T12:00:00.000Z', bufferEndAt: '2026-10-19T13:00:00.000Z', localDate: '2026-10-19', timezone: 'America/Sao_Paulo', dailyLimit: 8 });
  assert.throws(() => validateBookingWindow(c, { startAt: result.startAt, endAt: '2026-10-19T13:00:00Z' }, { now }), code('invalid_booking_window'));
  assert.throws(() => validateBookingWindow(c, { startAt: '2026-10-19T12:15:01Z' }, { now }), code('invalid_booking_window'));
  assert.throws(() => validateBookingWindow(c, { startAt: '2026-10-19T12:16:00Z' }, { now }), code('booking_outside_schedule'));
  assert.throws(() => validateBookingWindow(c, { startAt: '2026-10-19T12:00:00Z' }, { now }), code('booking_outside_schedule'));
  assert.throws(() => validateBookingWindow(c, { startAt: result.startAt }, { now: Date.parse(result.startAt) - 30 * 60000 }), code('booking_notice_required'));
  assert.throws(() => validateBookingWindow(c, { startAt: result.startAt }, { now, bookingsOnLocalDate: 8 }), code('booking_daily_limit'));
  assert.throws(() => validateBookingWindow(config({ enabled: false }), { startAt: result.startAt }, { now }), code('event_type_disabled'));
});

test('local horizon uses calendar days across DST rather than a rolling 24-hour deadline', () => {
  const c = config({ timezone: 'America/New_York', horizonDays: 1, minimumNoticeMinutes: 0, bufferMinutes: 0, durationMinutes: 15, availability: [{ weekday: 0, start: '22:00', end: '24:00' }] });
  const early = Date.parse('2026-03-08T00:30:00Z'); // Saturday evening locally.
  assert.equal(validateBookingWindow(c, { startAt: '2026-03-09T03:30:00Z' }, { now: early }).localDate, '2026-03-08');
  assert.throws(() => validateBookingWindow(c, { startAt: '2026-03-10T03:30:00Z' }, { now: early }), code('booking_horizon_exceeded'));
});

test('DST spring gaps and fall folds validate every actual minute of the interval', () => {
  const spring = config({ timezone: 'America/New_York', bufferMinutes: 0, minimumNoticeMinutes: 0, availability: [{ weekday: 0, start: '01:00', end: '04:00' }] });
  assert.equal(validateBookingWindow(spring, { startAt: '2026-03-08T06:45:00Z' }, { now: Date.parse('2026-03-07T12:00:00Z') }).endAt, '2026-03-08T07:15:00.000Z');
  assert.throws(() => validateBookingWindow({ ...spring, availability: [{ weekday: 0, start: '01:00', end: '03:00' }] }, { startAt: '2026-03-08T06:45:00Z' }, { now: Date.parse('2026-03-07T12:00:00Z') }), code('booking_outside_schedule'));
  const fall = config({ timezone: 'America/New_York', bufferMinutes: 0, minimumNoticeMinutes: 0, slotIntervalMinutes: 5, availability: [{ weekday: 0, start: '01:00', end: '02:00' }] });
  assert.equal(validateBookingWindow(fall, { startAt: '2026-11-01T05:45:00Z' }, { now: Date.parse('2026-10-31T12:00:00Z') }).endAt, '2026-11-01T06:15:00.000Z');
  assert.throws(() => validateBookingWindow({ ...fall, availability: [{ weekday: 0, start: '01:40', end: '01:50' }] }, { startAt: '2026-11-01T05:45:00Z' }, { now: Date.parse('2026-10-31T12:00:00Z') }), code('booking_outside_schedule'));
});

test('midnight end is exclusive and adjacent explicit periods can accommodate one booking', () => {
  const midnight = config({ timezone: 'UTC', minimumNoticeMinutes: 0, bufferMinutes: 0, availability: [{ weekday: 1, start: '23:00', end: '24:00' }] });
  assert.equal(validateBookingWindow(midnight, { startAt: '2026-10-19T23:30:00Z' }, { now }).endAt, '2026-10-20T00:00:00.000Z');
  const adjacent = config({ timezone: 'UTC', minimumNoticeMinutes: 0, bufferMinutes: 0, durationMinutes: 60, availability: [{ weekday: 1, start: '09:00', end: '10:00' }, { weekday: 1, start: '10:00', end: '11:00' }] });
  assert.equal(validateBookingWindow(adjacent, { startAt: '2026-10-19T09:30:00Z' }, { now }).endAt, '2026-10-19T10:30:00.000Z');
});

test('configured form accepts only selected fields with strict types and no implicit delivery', () => {
  const c = config();
  assert.deepEqual(validateBookingForm(c, { name: '  Maria  ', email: '' }), { name: 'Maria' });
  assert.deepEqual(validateBookingForm(c, { name: 'Maria', email: 'M@Example.test' }), { name: 'Maria', email: 'm@example.test' });
  assert.throws(() => validateBookingForm(c, { name: '' }), code('booking_form_required'));
  assert.throws(() => validateBookingForm(c, { name: 'Maria', phone: '+5511999999999' }), code('booking_form_invalid'));
  assert.throws(() => validateBookingForm(c, { name: 'Maria', tenantId: 'foreign' }));
  assert.throws(() => validateBookingForm(c, { name: 'Maria', email: 'invalid' }));
  const phone = config({ form: [{ field: 'phone', label: 'Telefone', required: false }] });
  assert.deepEqual(validateBookingForm(phone, {}), {});
  assert.deepEqual(validateBookingForm(phone, { phone: '+5511999999999' }), { phone: '+5511999999999' });
  assert.throws(() => validateBookingForm(phone, { phone: '11999999999' }));
  assert.throws(() => validateBookingForm(phone, { phone: ['+5511999999999'] }));
  assert.equal(eventTypeConfigFromRecord({ ...c, id: randomUUID(), revision: 1, grantId: 'private' }).slug, c.slug);
});
