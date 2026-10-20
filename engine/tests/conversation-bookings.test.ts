import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingOperatorFixture } from './fixtures/booking-operator.js';

test('conversation booking list joins only persisted tenant references with no secrets, provider requests or writes', async t => {
  const f = await bookingOperatorFixture(t), tenant = f.actor.tenantId;
  const conversation = f.store.create(tenant, 'conversations', { channel: 'webchat', subject: 'Reserva' });
  const another = f.store.create(tenant, 'conversations', { channel: 'webchat', subject: 'Outra conversa' });
  const fields = { kind: 'booking.create', key: randomUUID(), status: 'confirmed', conversationId: conversation.id,
    actionId: randomUUID(), actionRevision: 1, eventTypeId: f.page.id, bookingRef: f.booked.bookingRef,
    startAt: f.record().startAt, endAt: f.record().endAt, timezone: 'UTC',
    scope: { kind: 'webchat', tokenHash: 'secret-token-hash' }, encryptedVisitor: 'secret-visitor', sealedSlots: 'secret-slots' };
  const first = f.store.create(tenant, 'booking-assistant-operations', fields);
  f.store.create(tenant, 'booking-assistant-operations', { ...fields, key: randomUUID(), conversationId: another.id });
  f.store.create('foreign-tenant', 'booking-assistant-operations', fields);
  const orphan = f.store.create(tenant, 'booking-assistant-operations', { ...fields, key: randomUUID(), status: 'pending', bookingRef: randomUUID() });
  const before = f.store.db.prepare('SELECT * FROM entities ORDER BY id').all();
  const response = await f.request(`/api/v1/conversations/${conversation.id}/bookings`);
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.headers['cache-control'], 'no-store');
  const body = response.json(); assert.equal(body.conversationId, conversation.id); assert.equal(body.total, 2); assert.equal(body.totalPages, 1);
  assert.deepEqual(new Set(body.items.map((item: any) => item.operation.key)), new Set([first.key, orphan.key]));
  const known = body.items.find((item: any) => item.operation.key === first.key), missing = body.items.find((item: any) => item.operation.key === orphan.key);
  assert.equal(known.booking.bookingRef, f.booked.bookingRef); assert.equal(known.booking.status, 'confirmed');
  assert.equal(known.operation.conversationId, conversation.id); assert.equal(known.booking.adminCancellation.eligible, true);
  assert.equal(missing.operation.status, 'unknown'); assert.equal(missing.operation.needsReconciliation, true); assert.equal(missing.booking, null);
  assert.doesNotMatch(response.body, /secret-|encryptedVisitor|sealedSlots|tokenHash|quote|sessionHash|remoteEventId/);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY id').all(), before);
  const page = await f.request(`/api/v1/conversations/${conversation.id}/bookings?page=2&limit=1`);
  assert.deepEqual(page.json(), { conversationId: conversation.id, items: [body.items[1]], page: 2, limit: 1, total: 2, totalPages: 2 });
  assert.deepEqual((await f.request(`/api/v1/conversations/${conversation.id}/bookings?page=3&limit=1`)).json().items, []);
});

test('conversation booking list requires current owner cookie/context and validates bounded input and tenant ownership', async t => {
  const f = await bookingOperatorFixture(t), conversation = f.store.create(f.actor.tenantId, 'conversations', { channel: 'webchat' });
  const path = `/api/v1/conversations/${conversation.id}/bookings`;
  const foreign = f.store.create('foreign-tenant', 'conversations', { channel: 'webchat' });
  assert.equal((await f.request(`/api/v1/conversations/${foreign.id}/bookings`)).statusCode, 404);
  assert.equal((await f.request(path, undefined, {})).statusCode, 400);
  for (const query of ['?limit=101', '?limit=0', '?page=0', '?page=100001', '?extra=value']) assert.equal((await f.request(path + query)).statusCode, 400);
  assert.equal((await f.request('/api/v1/conversations/not-a-uuid/bookings')).statusCode, 400);
  f.aba(); assert.equal((await f.request(path)).statusCode, 409);
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('admin', f.actor.userId);
  assert.equal((await f.request(path, undefined, await f.freshHeaders())).statusCode, 403);
});

test('a conflicting persisted booking reference never yields an unrelated reservation', async t => {
  const f = await bookingOperatorFixture(t), conversation = f.store.create(f.actor.tenantId, 'conversations', { channel: 'webchat' });
  f.store.create(f.actor.tenantId, 'booking-assistant-operations', { kind: 'booking.create', key: randomUUID(), status: 'confirmed', conversationId: conversation.id,
    actionId: randomUUID(), actionRevision: 1, eventTypeId: randomUUID(), bookingRef: f.booked.bookingRef,
    startAt: f.record().startAt, endAt: f.record().endAt, timezone: 'UTC' });
  const result = await f.request(`/api/v1/conversations/${conversation.id}/bookings`);
  assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'booking_operation_unavailable');
  assert.equal(f.requests.length, 0);
});
