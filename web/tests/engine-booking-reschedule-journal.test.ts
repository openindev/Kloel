import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRescheduleJournal } from '../src/services/engine/booking-reschedule-journal'
import { createBookingIntentCoordinator } from '../src/services/engine/booking-intents'
import { bookingRescheduleAttempt, type RescheduleOperation } from '../src/services/engine/booking-reschedule'
import { bookingCancellationAttempt } from '../src/services/engine/booking-operations'

const context = { userId: 'operator', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }, fresh = () => {}
function fixture() {
  const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  const journal = createRescheduleJournal(storage, context), coordinator = createBookingIntentCoordinator(storage, context), a = bookingRescheduleAttempt({ bookingRef: randomUUID(), revision: 1 })
  const receipt = (status: RescheduleOperation['status']): RescheduleOperation => ({ ...a, reservedRevision: 2, status, effect: ({ pending: 'unconfirmed', unknown: 'unconfirmed', accepted: 'patch_accepted', not_sent: 'not_sent', not_applied: 'not_applied', succeeded: 'target_confirmed' } as const)[status], needsReconciliation: ['pending', 'unknown', 'accepted'].includes(status), originalTime: { startAt: '2030-01-01T09:00:00Z', endAt: '2030-01-01T09:30:00Z' }, requestedTime: { startAt: '2030-01-02T09:00:00Z', endAt: '2030-01-02T09:30:00Z' }, errorCode: null, automaticRetry: false, notifications: 'not_sent', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  return { values, storage, journal, coordinator, a, receipt }
}
test('references persist only original opaque intent, with no quote/time/cells/identity payload', () => {
  const f = fixture(); f.journal.reserve(f.a, fresh); f.coordinator.claim(f.a, fresh)
  for (const raw of f.values.values()) { const parsed = JSON.parse(raw); assert.deepEqual(Object.keys(parsed.entries[0].attempt ?? parsed.entries[0]).sort(), ['bookingRef', 'expectedRevision', 'key', 'kind']); assert.equal(/quote|startAt|endAt|calendar|email/.test(raw), false) }
  assert.throws(() => f.journal.reserve({ ...f.a, quote: 'private' } as any, fresh)); assert.throws(() => f.journal.reserve({ ...f.a, key: randomUUID() }, fresh)); assert.equal(f.journal.read().length, 1)
})
test('pending/unknown/accepted and not_sent/not_applied requiring reconciliation stay open', () => {
  const f = fixture(); f.journal.reserve(f.a, fresh)
  for (const s of ['pending', 'unknown', 'accepted', 'not_sent', 'not_applied'] as const) assert.throws(() => f.journal.close(f.a, { ...f.receipt(s), needsReconciliation: true }, fresh))
  assert.equal(f.journal.read()[0].closed, false); f.journal.close(f.a, f.receipt('not_applied'), fresh); assert.equal(f.journal.read()[0].closed, true)
})
test('only the exclusive stale-admission code closes without a receipt; 404 never does', () => {
  const f = fixture(); f.journal.reserve(f.a, fresh)
  for (const c of ['booking_quote_expired', 'booking_state_changed', 'not_found', 'context_changed_in_flight']) assert.throws(() => f.journal.close(f.a, c as any, fresh))
  f.journal.close(f.a, 'booking_reschedule_admission_revision_conflict', fresh); assert.equal(f.journal.read()[0].closed, true)
})
test('same original authority survives remount; user/session/membership ABA does not adopt it', () => {
  const f = fixture(); f.journal.reserve(f.a, fresh); assert.equal(createRescheduleJournal(f.storage, { ...context }).read()[0].attempt.key, f.a.key)
  assert.deepEqual(createRescheduleJournal(f.storage, { ...context, authorityVersion: 'b'.repeat(64) }).read(), []); assert.equal(f.storage.getItem(f.journal.key), null)
  f.coordinator.claim(f.a, fresh); assert.deepEqual(createBookingIntentCoordinator(f.storage, { ...context, authorityVersion: 'b'.repeat(64) }).read(), [])
})
test('cancel and move cross-block by booking; release A cannot delete B and a second tab cannot resurrect A', () => {
  const f = fixture(), other = createBookingIntentCoordinator(f.storage, context), cancel = bookingCancellationAttempt({ bookingRef: f.a.bookingRef, revision: 1 })
  f.coordinator.claim(f.a, fresh); assert.throws(() => other.claim(cancel, fresh)); assert.throws(() => other.available(cancel))
  f.coordinator.release(f.a, fresh); assert.equal(other.wasReleased(f.a), true); assert.throws(() => other.claim(f.a, fresh))
  other.claim(cancel, fresh); f.coordinator.release(f.a, fresh); assert.equal(other.read()[0].key, cancel.key)
  const foreign = { ...f.a, expectedRevision: 2 }; assert.throws(() => other.available(foreign))
})
test('journal/coordinator readback and authority checks must pass before dispatch', () => {
  const f = fixture(); f.storage.setItem = () => {}; assert.throws(() => f.journal.reserve(f.a, fresh)); assert.throws(() => f.coordinator.claim(f.a, fresh))
  const g = fixture(); let calls = 0; assert.throws(() => g.coordinator.claim(g.a, () => { if (++calls === 3) throw Error('changed') })); assert.ok(calls >= 3)
})
test('historical receipt A cannot close pending B, and terminal write failure retains pending pointer', () => {
  const f = fixture(); f.journal.reserve(f.a, fresh); const set = f.storage.setItem; f.storage.setItem = () => { throw Error('quota') }; assert.throws(() => f.journal.close(f.a, f.receipt('succeeded'), fresh)); assert.equal(f.journal.read()[0].closed, false)
  f.storage.setItem = set; f.journal.close(f.a, f.receipt('succeeded'), fresh); const b = { ...f.a, key: randomUUID(), expectedRevision: 2 }; f.journal.reserve(b, fresh); f.journal.close(f.a, f.receipt('succeeded'), fresh); assert.equal(f.journal.read().find(e => e.attempt.key === b.key)?.closed, false)
})
test('metadata capacity never evicts pending or released proof and malformed records fail closed', () => {
  const f = fixture(); for (let i = 0; i < 100; i++) f.coordinator.claim(bookingRescheduleAttempt({ bookingRef: randomUUID(), revision: 1 }), fresh)
  assert.throws(() => f.coordinator.claim(f.a, fresh)); assert.equal(f.coordinator.read().length, 100)
  const g = fixture(); g.coordinator.claim(g.a, fresh); const bad = JSON.parse(g.storage.getItem(g.coordinator.key)!); bad.entries[0].quote = 'extra'; g.storage.setItem(g.coordinator.key, JSON.stringify(bad)); assert.throws(() => g.coordinator.read())
})
