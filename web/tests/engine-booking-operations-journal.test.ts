import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBookingOperationsJournal } from '../src/services/engine/booking-operations-journal'
import { bookingCancellationAttempt, type BookingOperation } from '../src/services/engine/booking-operations'

const authority = { userId: 'operator', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
function fixture() {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const journal = createBookingOperationsJournal(storage, authority), attempt = bookingCancellationAttempt({ bookingRef: randomUUID(), revision: 1 })
  const receipt = (status: BookingOperation['status']): BookingOperation => ({ ...attempt, reservedRevision: 2, status, effect: ({ pending: 'unconfirmed', unknown: 'unconfirmed', accepted: 'delete_accepted', not_sent: 'not_sent', not_applied: 'not_applied', succeeded: 'event_absent' } as const)[status], needsReconciliation: ['pending', 'unknown', 'accepted'].includes(status), errorCode: null, automaticRetry: false, notifications: 'not_sent', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  return { values, storage, journal, attempt, receipt }
}
test('journal persists only opaque references and forbids another key for the same unresolved booking', () => {
  const f = fixture(); f.journal.reserve(f.attempt, () => {})
  const serialized = f.storage.getItem(f.journal.key)!
  assert.deepEqual(Object.keys(JSON.parse(serialized).entries[0].attempt).sort(), ['bookingRef', 'expectedRevision', 'key', 'kind'])
  assert.throws(() => f.journal.reserve({ ...f.attempt, key: randomUUID() }, () => {}))
  assert.throws(() => f.journal.reserve({ ...f.attempt, visitor: 'private@example.test' } as any, () => {}))
  assert.equal(f.journal.read().length, 1)
  assert.equal(f.journal.reserve({ ...f.attempt }, () => {}).length, 1, 'same key remains available for explicit recovery')
})
test('accepted, pending and unknown cannot close a reference or permit a new key', () => {
  const f = fixture(); f.journal.reserve(f.attempt, () => {})
  for (const status of ['accepted', 'pending', 'unknown'] as const) assert.throws(() => f.journal.close(f.attempt, f.receipt(status), () => {}))
  assert.equal(f.journal.read()[0].closed, false)
})
test('terminal receipt must bind key and booking, and closing retains proof before another attempt', () => {
  const f = fixture(); f.journal.reserve(f.attempt, () => {})
  assert.throws(() => f.journal.close(f.attempt, { ...f.receipt('not_sent'), bookingRef: randomUUID() }, () => {}))
  f.journal.close(f.attempt, f.receipt('not_sent'), () => {})
  assert.equal(f.journal.read()[0].resolution, 'not_sent')
  f.journal.reserve(bookingCancellationAttempt({ bookingRef: f.attempt.bookingRef, revision: 2 }), () => {})
  assert.equal(f.journal.read().length, 2)
})
test('only specific admission revision conflict closes without a receipt; generic conflicts and GET404 never do', () => {
  const f = fixture(); f.journal.reserve(f.attempt, () => {})
  for (const code of ['not_found', 'booking_state_changed', 'booking_remote_version_changed']) assert.throws(() => f.journal.close(f.attempt, code as any, () => {}))
  f.journal.close(f.attempt, 'booking_cancel_admission_revision_conflict', () => {})
  assert.equal(f.journal.read()[0].resolution, 'booking_cancel_admission_revision_conflict')
})
test('write/readback and authority failure prevent reserve from authorizing a dispatch', () => {
  const f = fixture(); let checks = 0
  assert.throws(() => f.journal.reserve(f.attempt, () => { if (++checks === 3) throw Error('authority changed after storage write') }))
  assert.ok(checks >= 3)
  const g = fixture(); g.storage.setItem = () => {}; assert.throws(() => g.journal.reserve(g.attempt, () => {})); assert.equal(g.journal.read().length, 0)
})
test('same original context remount preserves uncertainty while another authority cannot adopt references', () => {
  const f = fixture(); f.journal.reserve(f.attempt, () => {})
  assert.equal(createBookingOperationsJournal(f.storage, { ...authority }).read()[0].attempt.key, f.attempt.key)
  assert.deepEqual(createBookingOperationsJournal(f.storage, { ...authority, authorityVersion: 'b'.repeat(64) }).read(), [])
  assert.equal(f.storage.getItem(f.journal.key), null)
})
test('invalid stored metadata fails closed and history capacity never evicts an unresolved reference', () => {
  const f = fixture(); f.journal.reserve(f.attempt, () => {})
  const raw = JSON.parse(f.storage.getItem(f.journal.key)!); raw.entries[0].secret = 'not-allowed'; f.storage.setItem(f.journal.key, JSON.stringify(raw)); assert.throws(() => f.journal.read())
  const g = fixture(); for (let index = 0; index < 100; index++) g.journal.reserve(bookingCancellationAttempt({ bookingRef: randomUUID(), revision: 1 }), () => {})
  assert.throws(() => g.journal.reserve(g.attempt, () => {})); assert.equal(g.journal.read().length, 100)
})
