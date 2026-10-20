import test from 'node:test'
import assert from 'node:assert/strict'
import { bookingCancellationAttempt, bookingOperationTerminal, parseBookingOperation, parseOperatorBooking } from '../src/services/engine/booking-operations'

const bookingRef = '11111111-1111-4111-8111-111111111111'
const attempt = bookingCancellationAttempt({ bookingRef, revision: 3 }, '22222222-2222-4222-8222-222222222222')
const booking = { bookingRef, revision: 3, status: 'confirmed', startAt: '2026-10-20T12:00:00Z', endAt: '2026-10-20T12:30:00Z', timezone: 'America/Sao_Paulo', needsReconciliation: false, notifications: 'provider_managed_unknown', adminCancellation: { supported: true, eligible: true }, adminRescheduling: { supported: false, eligible: false, reason: 'provider_unsupported' } }
const receipt = { ...attempt, reservedRevision: 4, status: 'accepted', effect: 'delete_accepted', needsReconciliation: true, automaticRetry: false, notifications: 'provider_managed_unknown', errorCode: null, createdAt: '2026-10-19T12:00:00Z', updatedAt: '2026-10-19T12:00:00Z' }

test('Microsoft notifications survive parsing without granting administrative reschedule', () => {
  const parsed = parseOperatorBooking(booking), operation = parseBookingOperation(receipt, attempt)
  assert.equal(parsed.notifications, 'provider_managed_unknown')
  assert.deepEqual(parsed.adminCancellation, { supported: true, eligible: true })
  assert.equal(parsed.adminRescheduling?.supported, false)
  assert.equal(parsed.adminRescheduling?.eligible, false)
  assert.equal(operation.notifications, 'provider_managed_unknown')
  assert.equal(operation.status, 'accepted')
  assert.equal(operation.needsReconciliation, true)
  assert.equal(bookingOperationTerminal(operation), false)
})

test('historical receipts carry their own notification contract independently of the current booking', () => {
  const current = parseOperatorBooking({ ...booking, notifications: 'not_sent', revision: 5 })
  const original = parseBookingOperation({ ...receipt, status: 'succeeded', effect: 'event_absent', needsReconciliation: false }, attempt)
  assert.equal(current.notifications, 'not_sent')
  assert.equal(original.notifications, 'provider_managed_unknown')
  assert.equal(original.expectedRevision, 3)
  assert.equal(bookingOperationTerminal(original), true)
  assert.equal(parseBookingOperation({ ...receipt, notifications: 'not_sent' }, attempt).notifications, 'not_sent')
})

test('notification union remains closed and does not weaken operation identity or state validation', () => {
  for (const notifications of [undefined, null, 'sent', 'delivered', true, { raw: 'remote text' }]) {
    assert.throws(() => parseBookingOperation({ ...receipt, notifications }, attempt), /referência de reserva inválida/)
    assert.throws(() => parseOperatorBooking({ ...booking, notifications }), /referência de reserva inválida/)
  }
  for (const patch of [{ key: '33333333-3333-4333-8333-333333333333' }, { bookingRef: '44444444-4444-4444-8444-444444444444' }, { expectedRevision: 4 }, { reservedRevision: 5 }, { status: 'succeeded' }, { needsReconciliation: false }, { automaticRetry: true }]) {
    assert.throws(() => parseBookingOperation({ ...receipt, ...patch }, attempt), /referência de reserva inválida/)
  }
  assert.throws(() => parseOperatorBooking({ ...booking, adminCancellation: { supported: false, eligible: true } }))
})
