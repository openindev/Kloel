import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rescheduleFixture } from './engine-booking-reschedule-service-fixture'
import { bookingRescheduleAttempt, parseRescheduleOperation, parseRescheduleSlots } from '../src/services/engine/booking-reschedule'

test('Google slots are bounded and move preserves exact key/revision/quote; receipt GET and replay make no second PATCH', async t => {
  const f = await rescheduleFixture(t), booking = (await f.cancelApi.list())[0]; assert.equal(booking.adminRescheduling?.eligible, true)
  const slots = await f.api.slots(f.range), selected = slots.slots[0]; assert.ok(selected); assert.ok(selected.expiresAt > Date.now()); assert.notEqual(selected.startAt, booking.startAt)
  const a = bookingRescheduleAttempt(booking), { operation } = await f.api.reschedule(a, selected, { startAt: f.from, endAt: new Date(Date.parse(f.from) + 1800000).toISOString() })
  assert.equal(operation.status, 'succeeded'); assert.equal(operation.reservedRevision, 2); assert.equal(operation.requestedTime.startAt, selected.startAt); assert.equal(operation.originalTime.startAt, booking.startAt)
  const count = f.requests.length; assert.equal((await f.api.operation(a)).status, 'succeeded'); assert.equal((await f.api.reschedule(a, selected, { startAt: f.from, endAt: new Date(Date.parse(f.from) + 1800000).toISOString() })).replayed, true); assert.equal(f.requests.length, count)
  const write = f.browser.find(r => r.path.endsWith('/reschedule'))!; assert.deepEqual(write.body, { expectedTenantId: f.actor.tenantId, expectedRevision: 1, quote: selected.quote, confirm: true }); assert.equal(write.headers.get('idempotency-key'), a.key)
  const patch = f.requests.find(r => r.method === 'PATCH')!; assert.ok(patch.headers.get('if-match')); assert.deepEqual(Object.keys(patch.body).sort(), ['end', 'start']); assert.equal(patch.url.searchParams.get('sendUpdates'), 'none')
})
test('lost commit response recovers locally with same reference and no provider I/O', async t => {
  const f = await rescheduleFixture(t), selected = (await f.api.slots(f.range)).slots[0], a = bookingRescheduleAttempt({ bookingRef: f.range.bookingRef, revision: 1 })
  f.wire.after = async (path, _method, response) => { if (path.endsWith('/reschedule')) throw Error('lost response after commit'); return response }
  await assert.rejects(f.api.reschedule(a, selected, { startAt: f.from, endAt: new Date(Date.parse(f.from) + 1800000).toISOString() })); const count = f.requests.length; assert.equal((await f.api.operation(a)).status, 'succeeded'); assert.equal(f.requests.length, count); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 1)
})
test('stale admission and authority ABA make no PATCH; GET404 does not create a receipt', async t => {
  const f = await rescheduleFixture(t), selected = (await f.api.slots(f.range)).slots[0], a = bookingRescheduleAttempt({ bookingRef: f.range.bookingRef, revision: 2 })
  const count = f.requests.length; await assert.rejects(f.api.reschedule(a, selected, { startAt: f.from, endAt: new Date(Date.parse(f.from) + 1800000).toISOString() }), (e: any) => e.code === 'booking_reschedule_admission_revision_conflict'); assert.equal(f.requests.length, count)
  await assert.rejects(f.api.operation(a), (e: any) => e.status === 404); f.aba(); await assert.rejects(f.api.slots(f.range)); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 0)
})
test('private Graph is unavailable and request limits reject before HTTP', async t => {
  const f = await rescheduleFixture(t, 'microsoft'); assert.equal((await f.cancelApi.list())[0].adminRescheduling?.supported, false)
  await assert.rejects(f.api.slots(f.range)); assert.equal(f.requests.length, 0)
  const n = f.browser.length; await assert.rejects(f.api.slots({ ...f.range, to: new Date(Date.parse(f.range.from) + 8 * 86400000).toISOString() })); assert.equal(f.browser.length, n)
})
test('receipt parser refuses substituted bindings, incoherent effects, notifications, and wrong interval', async t => {
  const f = await rescheduleFixture(t), selected = (await f.api.slots(f.range)).slots[0], a = bookingRescheduleAttempt({ bookingRef: f.range.bookingRef, revision: 1 }), o = (await f.api.reschedule(a, selected, { startAt: f.from, endAt: new Date(Date.parse(f.from) + 1800000).toISOString() })).operation
  for (const patch of [{ key: randomUUID() }, { bookingRef: randomUUID() }, { kind: 'booking.cancel' }, { expectedRevision: 2 }, { reservedRevision: 3 }, { effect: 'patch_accepted' }, { needsReconciliation: true }, { notifications: 'sent' }, { errorCode: '<secret>' }, { requestedTime: o.originalTime }]) assert.throws(() => parseRescheduleOperation({ ...o, ...patch }, a))
  f.wire.after = async (_p, _m, response) => { f.invalidate(); return response }; await assert.rejects(f.api.operation(a), (e: any) => e.code === 'superseded')
})
test('slots parser enforces binding, completion cursor, unique quote, range, and hard 200 limit', async t => {
  const f = await rescheduleFixture(t), result = await f.api.slots(f.range)
  for (const patch of [{ bookingRef: randomUUID() }, { expectedRevision: 2 }, { timezone: 'invalid/zone' }, { reservationsGuaranteed: true }, { complete: false }, { slots: [result.slots[0], result.slots[0]] }, { slots: Array(201).fill(result.slots[0]) }, { slots: [{ ...result.slots[0], startAt: '2000-01-01T00:00:00Z' }] }]) assert.throws(() => parseRescheduleSlots({ ...result, ...patch }, f.range))
  const wide = await f.api.slots({ ...f.range, to: new Date(Date.parse(f.range.from) + 7 * 86400000).toISOString() }); assert.equal(wide.slots.length, 200); assert.equal(wide.complete, false); assert.ok(wide.nextFrom)
})
