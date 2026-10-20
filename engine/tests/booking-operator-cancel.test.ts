import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingOperatorFixture, bookingOrigin } from './fixtures/booking-operator.js';
import { bookingCancelOperations } from '../src/public-booking/operator-cancel.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { tokenContext } from '../src/oauth/access.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerAuth } from '../src/auth.js';
import { registerPublicBooking } from '../src/public-booking.js';

const journal = (f: Awaited<ReturnType<typeof bookingOperatorFixture>>) => f.store.list(f.actor.tenantId, bookingCancelOperations);

test('Google operator cancellation persists acceptance, then explicit reconciliation completes without repeating DELETE', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID();
  const result = await f.cancel(key); assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().operation.status, 'accepted'); assert.equal(f.record().status, 'cancel_pending'); assert.equal(f.record().revision, 2);
  const sent = f.requests.filter(r => r.method === 'DELETE'); assert.equal(sent.length, 1); assert.equal(sent[0].headers.get('if-match'), '"version-1"');
  assert.equal(sent[0].url.searchParams.get('sendUpdates'), 'none');
  const count = f.requests.length; assert.equal((await f.operation(key)).json().status, 'accepted'); assert.equal((await f.cancel(key)).json().replayed, true); assert.equal(f.requests.length, count);
  assert.equal((await f.reconcile()).json().status, 'cancelled'); assert.equal((await f.operation(key)).json().status, 'succeeded');
  assert.equal(f.store.list(f.actor.tenantId, 'appointments')[0].status, 'cancelled'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  for (const secret of ['synthetic-booking-token', 'synthetic-account', 'synthetic-canonical-calendar', 'remoteEventId', 'sessionHash', 'encryptedVisitor']) assert.ok(!result.body.includes(secret));
});

test('reconcile waiting on old busy range cannot commit after a complete reschedule with the same remote event ID', async t => {
  const f = await bookingOperatorFixture(t);
  const quote = (await f.service.rescheduling.slots(f.target, f.manage, bookingOrigin, { bookingRef: f.booked.bookingRef, from: f.from, to: f.to })).slots.find(q => Date.parse(q.startAt) >= Date.parse(f.from) + 3600000)!;
  let enter!: () => void, release!: () => void; const entered = new Promise<void>(r => { enter = r; }), hold = new Promise<void>(r => { release = r; }); let paused = false;
  f.hooks.provider = async r => { if (!paused && r.method === 'GET' && r.url.pathname.endsWith('/events')) { paused = true; const stale = [...f.events.values()]; enter(); await hold; return Response.json({ items: stale, timeZone: 'UTC' }); } };
  const reconciling = f.service.reconcile(f.actor, f.sessionHash, f.booked.bookingRef); await entered;
  await f.service.rescheduling.reschedule(f.target, f.manage, bookingOrigin, { bookingRef: f.booked.bookingRef, expectedRevision: 1, quote: quote.quote, idempotencyKey: randomUUID() });
  const after = f.record(); assert.equal(after.revision, 2); release();
  await assert.rejects(reconciling, (e: any) => e.code === 'booking_state_changed'); assert.deepEqual(f.record(), after);
});

test('admission stale revision is an exclusive refusal before journal, audit and all provider I/O', async t => {
  const f = await bookingOperatorFixture(t), before = f.record();
  const result = await f.cancel(randomUUID(), 9); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'booking_cancel_admission_revision_conflict');
  assert.equal(journal(f).length, 0); assert.equal(f.store.list(f.actor.tenantId, 'booking-cancel-audit').length, 0); assert.equal(f.requests.length, 0); assert.deepEqual(f.record(), before);
});

test('Graph public management cancellation remains independent of private conditional cancellation', async t => {
  const f = await bookingOperatorFixture(t, 'microsoft');
  const row = (await f.request('/api/v1/scheduling/bookings')).json().items[0];
  assert.deepEqual(row.adminCancellation, { supported: true, eligible: true, reason: null });
  assert.equal(row.adminRescheduling.supported, false); assert.equal(journal(f).length, 0); assert.equal(f.requests.length, 0);
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash);
  assert.equal((await f.service.cancel(f.target, f.manage, bookingOrigin, { bookingRef: f.booked.bookingRef, idempotencyKey: randomUUID() })).status, 'cancelled');
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1); assert.equal(f.requests.find(r => r.method === 'DELETE')!.headers.has('if-match'), false);
});

for (const change of ['time', 'attendees', 'recurring', 'etag', 'reference', 'identity'] as const) test(`remote ${change} mismatch is not sent and increments the administrative attempt revision`, async t => {
  const f = await bookingOperatorFixture(t), id = String(f.record().remoteEventId), event = f.events.get(id);
  if (change === 'time') event.start.dateTime = new Date(Date.parse(String(f.record().startAt)) + 60000).toISOString();
  if (change === 'attendees') event.attendees = [{ email: 'private@example.test' }];
  if (change === 'recurring') event.recurrence = ['RRULE:FREQ=DAILY'];
  if (change === 'etag') event.etag = 'unquoted';
  if (change === 'reference') event.extendedProperties.private.kloelBooking = randomUUID();
  if (change === 'identity') event.id = 'another-event';
  const key = randomUUID(), response = await f.cancel(key); assert.ok(response.statusCode >= 400);
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0); assert.equal(f.record().status, 'confirmed'); assert.equal(f.record().revision, 2);
  const result = await f.operation(key); assert.equal(result.json().status, 'not_sent'); assert.equal(result.json().needsReconciliation, false);
  assert.equal((await f.cancel(randomUUID(), 1)).json().error.code, 'booking_cancel_admission_revision_conflict');
});

test('Google If-Match rejects an edit after GET with one412, no retry, and a terminal non-application receipt', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID();
  f.hooks.provider = r => { if (r.method === 'DELETE') f.events.get(String(f.record().remoteEventId)).etag = '"changed-after-read"'; };
  const response = await f.cancel(key); assert.equal(response.statusCode, 502);
  const op = (await f.operation(key)).json(); assert.equal(op.status, 'not_applied'); assert.equal(op.effect, 'not_applied'); assert.equal(op.needsReconciliation, false);
  assert.equal(op.errorCode, 'booking_remote_version_changed'); assert.equal(f.record().status, 'conflict'); assert.equal(f.record().revision, 2); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  const count = f.requests.length; assert.equal((await f.cancel(key)).json().replayed, true); assert.equal(f.requests.length, count);
});

test('a202 response proves acceptance, not absence; GET is read-only and reconciliation never resends', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID();
  f.hooks.provider = r => r.method === 'DELETE' ? new Response(null, { status: 202 }) : undefined;
  assert.equal((await f.cancel(key)).json().operation.status, 'accepted'); const before = JSON.stringify(journal(f)); const count = f.requests.length;
  assert.equal((await f.operation(key)).json().status, 'accepted'); assert.equal(JSON.stringify(journal(f)), before); assert.equal(f.requests.length, count);
  assert.equal((await f.reconcile()).json().reconciliation, 'remote_still_present'); assert.equal((await f.operation(key)).json().status, 'accepted');
  assert.equal(f.record().status, 'cancel_pending'); assert.equal((await f.cancel(randomUUID(), 2)).json().error.code, 'booking_requires_reconciliation');
  f.events.clear(); assert.equal((await f.reconcile()).json().status, 'cancelled'); assert.equal((await f.operation(key)).json().status, 'succeeded'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});

test('event already absent completes with zeroDELETE and does not attribute a remote send', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID(); f.events.clear();
  const result = await f.cancel(key); assert.equal(result.statusCode, 200); assert.equal(result.json().operation.status, 'succeeded'); assert.equal(result.json().operation.effect, 'event_absent');
  assert.equal(journal(f)[0].attemptedAt, undefined); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0); assert.equal(f.record().status, 'cancelled');
});

test('ABA inside BEGIN prevents journal and booking mutation even without context headers', async t => {
  const f = await bookingOperatorFixture(t), before = f.record(), exec = f.store.db.exec.bind(f.store.db); let armed = true;
  f.store.db.exec = (sql: string) => { if (armed && sql.startsWith('BEGIN')) { armed = false; f.aba(); } return exec(sql); };
  const result = await f.cancel(randomUUID(), 1, {}); f.store.db.exec = exec;
  assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(armed, false); assert.equal(journal(f).length, 0); assert.equal(f.requests.length, 0); assert.deepEqual(f.record(), before);
});

test('revocation during event read stops DELETE; accepted response followed by role ABA stays durable but undisclosed', async t => {
  const f = await bookingOperatorFixture(t), first = randomUUID(); let once = true;
  f.hooks.provider = r => { if (once && r.method === 'GET') { once = false; f.aba(); } };
  assert.equal((await f.cancel(first)).json().error.code, 'context_changed_in_flight'); assert.equal(journal(f)[0].status, 'not_sent'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0);
  const headers = await f.freshHeaders(), key = randomUUID();
  f.hooks.provider = r => { if (r.method === 'DELETE') { f.events.clear(); f.aba(); return new Response(null, { status: 204 }); } };
  const response = await f.cancel(key, 2, headers); assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'context_changed_in_flight'); assert.ok(!response.body.includes('bookingRef'));
  assert.equal(journal(f).at(-1)!.status, 'accepted'); assert.equal(f.record().status, 'cancel_pending');
  const fresh = await f.freshHeaders(); assert.equal((await f.operation(key, fresh)).statusCode, 404); assert.equal((await f.cancel(key, 2, fresh)).json().error.code, 'idempotency_conflict');
  assert.equal((await f.reconcile(fresh)).json().status, 'cancelled'); assert.equal(journal(f).at(-1)!.status, 'succeeded'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});

test('grant revoked after DELETE cannot erase acceptance; original session GET/replay remain local', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID();
  f.hooks.provider = r => { if (r.method === 'DELETE') { f.events.clear(); f.store.update(f.actor.tenantId, 'booking-grants', String(f.record().grantId), { status: 'revoked' }); return new Response(null, { status: 204 }); } };
  assert.equal((await f.cancel(key)).json().error.code, 'booking_grant_revoked'); assert.equal(journal(f)[0].status, 'accepted');
  const count = f.requests.length; assert.equal((await f.operation(key)).json().status, 'accepted'); assert.equal((await f.cancel(key)).json().replayed, true); assert.equal(f.requests.length, count);
  assert.equal((await f.reconcile()).json().error.code, 'booking_grant_revoked'); assert.equal(f.record().status, 'cancel_pending');
});

test('timeout retains capacity and explicit recovery never sends another DELETE', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID();
  f.hooks.provider = r => { if (r.method === 'DELETE') { f.events.clear(); throw Error('lost response'); } };
  assert.equal((await f.cancel(key)).statusCode, 502); assert.equal((await f.operation(key)).json().status, 'unknown'); assert.equal(f.record().status, 'cancel_pending');
  assert.equal(f.store.list(f.actor.tenantId, 'appointments')[0].status, 'scheduled'); assert.equal((await f.reconcile()).json().error.code, 'booking_operation_in_progress');
  assert.equal((await f.cancel(key)).json().operation.status, 'unknown'); f.advance(360001); f.hooks.provider = undefined;
  assert.equal((await f.reconcile()).json().status, 'cancelled'); assert.equal((await f.operation(key)).json().status, 'succeeded'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});

test('same-key replay, competing private key, visitor cancel and reconcile share one physical lease', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
  f.hooks.provider = async r => { if (r.method === 'DELETE') { enter(); await held; } };
  const first = f.cancel(key); await entered;
  assert.equal((await f.cancel(key)).json().operation.status, 'pending'); assert.equal((await f.cancel(randomUUID(), 2)).json().error.code, 'booking_requires_reconciliation');
  await assert.rejects(f.service.cancel(f.target, f.manage, bookingOrigin, { bookingRef: f.booked.bookingRef, idempotencyKey: randomUUID() }), (e: any) => e.code === 'booking_requires_reconciliation');
  assert.equal((await f.reconcile()).json().error.code, 'booking_operation_in_progress'); release(); assert.equal((await first).json().operation.status, 'accepted');
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});

test('new session cannot adopt an original operation; tenant and confirmation are checked before reservation', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID(); await f.cancel(key);
  const cookie = 'different-synthetic-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(cookie), f.actor.userId, f.actor.tenantId, Date.now() + 86400000);
  const result = await f.app.inject({ url: `/api/v1/scheduling/operations/${key}`, cookies: { kloel_session: cookie } }); assert.equal(result.statusCode, 404);
  const bad = await f.request(`/api/v1/scheduling/bookings/${f.booked.bookingRef}/cancel`, { expectedTenantId: 'other-tenant', expectedRevision: 2, confirm: true }, f.headers, randomUUID()); assert.equal(bad.json().error.code, 'tenant_mismatch');
  const unconfirmed = await f.request(`/api/v1/scheduling/bookings/${f.booked.bookingRef}/cancel`, { expectedTenantId: f.actor.tenantId, expectedRevision: 2, confirm: false }, f.headers, randomUUID()); assert.equal(unconfirmed.statusCode, 400); assert.equal(journal(f).length, 1);
});

test('failed acceptance persistence never claims success and explicit reconciliation can recover absence', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID(), update = f.store.update.bind(f.store); let failOnce = true;
  f.store.update = (tenant, collection, id, data) => { if (failOnce && collection === bookingCancelOperations && data.status === 'accepted') { failOnce = false; throw Error('synthetic storage failure'); } return update(tenant, collection, id, data); };
  assert.equal((await f.cancel(key)).statusCode, 502); f.store.update = update; assert.equal(failOnce, false); assert.equal((await f.operation(key)).json().status, 'unknown');
  f.advance(360001); assert.equal((await f.reconcile()).json().status, 'cancelled'); assert.equal((await f.operation(key)).json().status, 'succeeded'); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
});

test('late acceptance preserves its own journal without overwriting a newer booking fence', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID(); let superseded: unknown;
  f.hooks.provider = r => { if (r.method === 'DELETE') { f.store.update(f.actor.tenantId, 'public-bookings', f.booked.bookingRef, { operationId: randomUUID(), revision: 3, status: 'conflict' }); superseded = f.record(); f.events.clear(); return new Response(null, { status: 204 }); } };
  const result = await f.cancel(key); assert.equal(result.statusCode, 200); assert.equal(result.json().operation.status, 'accepted'); assert.deepEqual(f.record(), superseded); assert.equal(journal(f)[0].status, 'accepted');
});

test('late acceptance cannot settle a changed resource snapshot even if the operation fence remains', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID(); let superseded: unknown;
  f.hooks.provider = r => { if (r.method === 'DELETE') {
    f.store.update(f.actor.tenantId, 'public-bookings', f.booked.bookingRef, { bufferEndAt: new Date(Date.parse(String(f.record().endAt)) + 60000).toISOString(), resourceKey: 'changed-resource', status: 'conflict' });
    superseded = f.record(); f.events.clear(); return new Response(null, { status: 204 });
  } };
  const result = await f.cancel(key); assert.equal(result.statusCode, 200); assert.equal(result.json().operation.status, 'accepted');
  assert.deepEqual(f.record(), superseded); assert.equal(journal(f)[0].status, 'accepted');
});

test('authority changed during OAuth refresh cannot reach calendar GET or DELETE', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID(), controlledFetch = globalThis.fetch;
  const previous = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET];
  process.env.GOOGLE_CLIENT_ID = 'synthetic-client'; process.env.GOOGLE_CLIENT_SECRET = 'synthetic-secret';
  t.after(() => { for (const [index, name] of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].entries()) { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; } });
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { encryptedTokens: seal({ accessToken: 'expired-synthetic', refreshToken: 'synthetic-refresh', expiresAt: 1, scope: f.connection.scopes }, tokenContext(f.connection)) });
  let refreshes = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') { refreshes++; f.aba(); return Response.json({ access_token: 'synthetic-booking-token', token_type: 'Bearer', expires_in: 3600, scope: f.connection.scopes }); }
    return controlledFetch(input, init);
  }) as typeof fetch;
  const result = await f.cancel(key); globalThis.fetch = controlledFetch;
  assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(refreshes, 1); assert.equal(f.requests.length, 0); assert.equal(journal(f)[0].status, 'not_sent');
});

test('final reservation guard rolls back journal, booking, appointment and audit as one transaction', async t => {
  const f = await bookingOperatorFixture(t), before = f.record(), appointments = f.store.list(f.actor.tenantId, 'appointments'), create = f.store.create.bind(f.store); let armed = true;
  f.store.create = (tenant, collection, data) => { const row = create(tenant, collection, data); if (armed && collection === 'booking-cancel-audit') { armed = false; f.aba(); } return row; };
  const result = await f.cancel(); f.store.create = create;
  assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.equal(armed, false); assert.equal(journal(f).length, 0);
  assert.equal(f.store.list(f.actor.tenantId, 'booking-cancel-audit').length, 0); assert.equal(f.requests.length, 0); assert.deepEqual(f.record(), before); assert.deepEqual(f.store.list(f.actor.tenantId, 'appointments'), appointments);
});

test('membership removal and reentry cannot adopt an original accepted receipt', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID(); await f.cancel(key); const count = f.requests.length;
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.actor.userId, f.actor.tenantId);
  f.store.db.prepare('INSERT INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,?,?)').run(randomUUID(), f.actor.userId, f.actor.tenantId, 'owner', new Date().toISOString());
  const fresh = await f.freshHeaders(); assert.equal((await f.operation(key, fresh)).statusCode, 404); assert.equal((await f.cancel(key, 1, fresh)).json().error.code, 'idempotency_conflict');
  assert.equal(f.requests.length, count); assert.equal(journal(f)[0].status, 'accepted');
});

test('new HTTP service instance rediscovers an accepted receipt and replays without provider I/O', async t => {
  const f = await bookingOperatorFixture(t), key = randomUUID(); await f.cancel(key); const count = f.requests.length;
  const restarted = Fastify(); await restarted.register(cookie); await registerAuth(restarted, f.store); await registerPublicBooking(restarted, f.store); t.after(() => restarted.close());
  const get = await restarted.inject({ url: `/api/v1/scheduling/operations/${key}`, cookies: f.cookies, headers: f.headers }); assert.equal(get.json().status, 'accepted');
  const replay = await restarted.inject({ method: 'POST', url: `/api/v1/scheduling/bookings/${f.booked.bookingRef}/cancel`, cookies: f.cookies, headers: { ...f.headers, 'idempotency-key': key }, payload: { expectedTenantId: f.actor.tenantId, expectedRevision: 1, confirm: true } });
  assert.equal(replay.json().replayed, true); assert.equal(replay.json().operation.status, 'accepted'); assert.equal(f.requests.length, count);
});
