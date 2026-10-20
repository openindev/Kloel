import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { registerScheduling } from '../src/scheduling.js';
import { registerPublicBooking } from '../src/public-booking.js';

const base = '/api/v1/scheduling/event-types', configuration = '/api/v1/scheduling/configuration';
async function fixture(t: any) {
  const store = new Store(), app = Fastify(), previous = process.env.PUBLIC_BASE_URL;
  t.after(async () => { await app.close(); store.close(); if (previous === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previous; });
  await app.register(cookie); await registerAuth(app, store); await registerScheduling(app, store); await registerPublicBooking(app, store);
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'links-owner@example.test', password: 'links-fixture-password', organization: 'Scheduling links' } });
  assert.equal(signup.statusCode, 201);
  const actor = signup.json(), cookies = { kloel_session: signup.cookies.find(c => c.name === 'kloel_session')!.value };
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider: 'google', remoteId: 'fixture-account', userId: actor.userId, visibility: 'personal', status: 'connected', capabilities: ['calendar', 'calendar_write'] });
  const calendar = store.create(actor.tenantId, 'calendars', { name: 'Fixture calendar', provider: 'google', connectionId: connection.id, externalCalendarId: 'primary', enabled: true, timezone: 'UTC' });
  const create = () => app.inject({ method: 'POST', url: base, cookies, payload: { name: 'Consulta', slug: 'consulta', calendarId: calendar.id, timezone: 'UTC', durationMinutes: 30, availability: [{ weekday: 1, start: '09:00', end: '18:00' }] } });
  return { app, store, actor, cookies, create };
}

test('event-type reload and listing recover only validated relative public links and never expose grant internals', async t => {
  const f = await fixture(t), created = await f.create(); assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id, org = 'o-' + 'a'.repeat(24), path = `/c/${org}/consulta`;
  assert.equal(created.json().publicPath, undefined);
  f.store.update(f.actor.tenantId, 'booking-pages', id, { publicationStatus: 'published', publicOrgSlug: org, publicPath: 'https://attacker.invalid/path', grantId: 'secret-grant-internal', privateNote: 'not-public' });
  const detail = await f.app.inject({ url: `${base}/${id}`, cookies: f.cookies }); assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().publicPath, path); assert.equal(detail.json().publicOrgSlug, org); assert.equal(detail.json().grantId, undefined); assert.equal(detail.body.includes('not-public'), false);
  const listing = await f.app.inject({ url: base, cookies: f.cookies }); assert.equal(listing.json().items[0].publicPath, path);
  for (const invalid of ['//evil.invalid', 'o-' + 'A'.repeat(24), org + '/../../../', '<script>', null]) {
    f.store.update(f.actor.tenantId, 'booking-pages', id, { publicOrgSlug: invalid });
    const result = await f.app.inject({ url: `${base}/${id}`, cookies: f.cookies }); assert.equal(result.statusCode, 200);
    assert.equal(result.json().publicOrgSlug, undefined); assert.equal(result.json().publicPath, undefined);
  }
  f.store.update(f.actor.tenantId, 'booking-pages', id, { publicOrgSlug: org, slug: '../unsafe' });
  const invalidSlug = await f.app.inject({ url: `${base}/${id}`, cookies: f.cookies }); assert.equal(invalidSlug.statusCode, 400); assert.equal(invalidSlug.json().publicPath, undefined);
});

test('scheduling configuration returns the canonical validated public origin and public routes use the same validator', async t => {
  const f = await fixture(t);
  delete process.env.PUBLIC_BASE_URL;
  assert.deepEqual((await f.app.inject({ url: configuration, cookies: f.cookies })).json(), { publicBaseUrl: 'http://127.0.0.1:4310' });
  for (const value of ['https://kloel.example/', 'https://kloel.example:443', 'http://localhost:4310/', 'http://127.0.0.1:4310', 'http://[::1]:4310']) {
    process.env.PUBLIC_BASE_URL = value;
    const result = await f.app.inject({ url: configuration, cookies: f.cookies }); assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), { publicBaseUrl: new URL(value).origin }); assert.equal(result.headers['cache-control'], 'no-store');
  }
  for (const value of ['not-a-url', 'http://kloel.example', 'ftp://kloel.example', 'https://user:secret@kloel.example', 'https://kloel.example/path', 'https://kloel.example/?token=secret', 'https://kloel.example/#secret']) {
    process.env.PUBLIC_BASE_URL = value;
    const result = await f.app.inject({ url: configuration, cookies: f.cookies }); assert.equal(result.statusCode, 503, value); assert.equal(result.json().error.code, 'booking_not_configured'); assert.equal(result.body.includes('secret'), false);
    const publicResult = await f.app.inject({ url: '/api/v1/public/booking/page?orgSlug=o-' + 'a'.repeat(24) + '&eventSlug=consulta', headers: { origin: 'https://kloel.example' } });
    assert.equal(publicResult.statusCode, 503); assert.equal(publicResult.json().error.code, 'booking_not_configured');
  }
});

test('scheduling configuration requires a current human session and calendars read permission', async t => {
  const f = await fixture(t); process.env.PUBLIC_BASE_URL = 'https://kloel.example';
  assert.equal((await f.app.inject({ url: configuration })).statusCode, 401);
  const key = await f.app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies: f.cookies, payload: { name: 'Fixture key', scopes: ['calendars:read'] } }); assert.equal(key.statusCode, 201);
  assert.equal((await f.app.inject({ url: configuration, cookies: f.cookies, headers: { authorization: `Bearer ${key.json().secret}` } })).statusCode, 403);
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('member', f.actor.userId, f.actor.tenantId);
  assert.equal((await f.app.inject({ url: configuration, cookies: f.cookies })).statusCode, 200);
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('viewer', f.actor.userId, f.actor.tenantId);
  assert.equal((await f.app.inject({ url: configuration, cookies: f.cookies })).statusCode, 403);
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sessionDigest(f.cookies.kloel_session));
  assert.equal((await f.app.inject({ url: configuration, cookies: f.cookies })).statusCode, 401);
});
