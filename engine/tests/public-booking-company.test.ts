import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingOperatorFixture, bookingOrigin } from './fixtures/booking-operator.js';
import { publicBookingCompany } from '../src/public-booking/company.js';
import { eventTypeConfigFromRecord } from '../src/scheduling/service.js';

test('company public projection includes only current published grants and no private calendar or visitor data', async t => {
  const f = await bookingOperatorFixture(t);
  const page = f.store.get(f.actor.tenantId, 'booking-pages', f.page.id)!;
  const config = eventTypeConfigFromRecord(page);
  f.store.create(f.actor.tenantId, 'booking-pages', { ...config, slug: 'private-draft', revision: 1, publicationStatus: 'draft' });
  const before = f.store.db.prepare('SELECT * FROM entities ORDER BY id').all();
  const result = publicBookingCompany(f.store, f.service, { orgSlug: page.publicOrgSlug });
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.items[0].eventSlug, 'operator-test');
  assert.equal(result.body.items[0].horizonDays, 30);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY id').all(), before);
  assert.equal(f.requests.length, 0);
  const text = JSON.stringify(result.body);
  for (const secret of [f.actor.tenantId, f.actor.userId, f.connection.id, f.booked.bookingRef, f.visitor, f.manage, 'synthetic-account', 'calendarId', 'grantId']) assert.equal(text.includes(secret), false);
  f.service.unpublish(f.actor, f.sessionHash, f.page.id);
  assert.throws(() => publicBookingCompany(f.store, f.service, { orgSlug: page.publicOrgSlug }), (e: any) => e.code === 'booking_page_unavailable');
});

test('company public pagination is bounded and revoked grants never remain visible', async t => {
  const f = await bookingOperatorFixture(t);
  const page = f.store.get(f.actor.tenantId, 'booking-pages', f.page.id)!;
  const second = f.store.create(f.actor.tenantId, 'booking-pages', { ...eventTypeConfigFromRecord(page), slug: 'second', revision: 1, publicationStatus: 'draft' });
  await f.service.publish(f.actor, f.sessionHash, second.id, 1);
  const one = publicBookingCompany(f.store, f.service, { orgSlug: page.publicOrgSlug, page: 1, limit: 1 }).body;
  const two = publicBookingCompany(f.store, f.service, { orgSlug: page.publicOrgSlug, page: 2, limit: 1 }).body;
  assert.equal(one.total, 2); assert.equal(one.totalPages, 2); assert.notEqual(one.items[0].eventSlug, two.items[0].eventSlug);
  assert.throws(() => publicBookingCompany(f.store, f.service, { orgSlug: page.publicOrgSlug, limit: 101 }));
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { authorizationGeneration: 1 });
  assert.throws(() => publicBookingCompany(f.store, f.service, { orgSlug: page.publicOrgSlug }), (e: any) => e.code === 'booking_page_unavailable');
});

test('company HTTP route stays public without accepting foreign origins or extra query authority', async t => {
  const f = await bookingOperatorFixture(t);
  const page = f.store.get(f.actor.tenantId, 'booking-pages', f.page.id)!;
  const url = `/api/v1/public/booking/company?orgSlug=${page.publicOrgSlug}`;
  const response = await f.app.inject({ url, headers: { origin: bookingOrigin } });
  assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal((await f.app.inject({ url, headers: { origin: 'https://foreign.invalid' } })).statusCode, 403);
  assert.equal((await f.app.inject({ url: `${url}&tenantId=foreign`, headers: { origin: bookingOrigin } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: 'OPTIONS', url, headers: { origin: bookingOrigin, 'access-control-request-method': 'GET' } })).statusCode, 204);
  assert.equal((await f.app.inject({ method: 'OPTIONS', url, headers: { origin: bookingOrigin, 'access-control-request-method': 'POST' } })).statusCode, 403);
});
