import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { calendlyCancellationUIFixture } from './engine-calendly-cancellation-fixture'
import { parseCalendlyCancellationReceipt, type CalendlyCancellationAttempt, type CalendlyCancellationReceipt } from '../src/services/engine/calendly'
import { createCalendlyCancellationJournal } from '../src/services/engine/calendly-journal'

const memory = () => { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } } }
async function confirmed(f: Awaited<ReturnType<typeof calendlyCancellationUIFixture>>) {
  const { choice, attempt: a, receipt } = await f.confirmedCreation(), cancellation: CalendlyCancellationAttempt = { key: randomUUID(), creationKey: a.key, bookingRef: receipt.bookingRef }
  assert.equal(receipt.status, 'confirmed'); return { choice, a, receipt, cancellation }
}
const cancelPosts = (f: Awaited<ReturnType<typeof calendlyCancellationUIFixture>>) => f.requests.filter(r => r.method === 'POST' && new URL(r.url).pathname.endsWith('/cancellation'))

test('real client keeps cancellation accepted, GET recovery and verified state separate from confirmed creation', async t => {
  const f = await calendlyCancellationUIFixture(t), { a, receipt, cancellation } = await confirmed(f)
  const first = await f.client.cancel(cancellation); assert.equal(first.status, 'accepted'); assert.equal(first.needsReconciliation, true); assert.equal(first.notifications, 'provider_managed_unknown')
  const calls = f.requests.length; assert.deepEqual(await f.client.cancellation(cancellation), first); assert.equal(f.requests.length, calls)
  assert.deepEqual(await f.client.cancellations(a.key, receipt.bookingRef), [first]); assert.equal(f.requests.length, calls)
  assert.equal((await f.client.verifyCancellation(cancellation)).status, 'confirmed'); assert.equal(cancelPosts(f).length, 1)
  assert.deepEqual(await f.client.operation(a), receipt)
})
test('lost cancellation envelope recovers through local GET after agent pause without another remote POST', async t => {
  const f = await calendlyCancellationUIFixture(t), { cancellation } = await confirmed(f)
  f.state.after = async (r, response) => { if (r.method === 'POST' && r.path.endsWith('/cancellations')) { f.state.after = undefined; throw Error('lost after cancellation commit') }; return response }
  await assert.rejects(f.client.cancel(cancellation)); const count = f.requests.length
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'paused' })
  assert.equal((await f.client.cancellation(cancellation)).status, 'accepted'); assert.equal(f.requests.length, count); assert.equal(cancelPosts(f).length, 1)
})
test('an already canceled remote event is observed without attributing a new cancellation or changing creation', async t => {
  const f = await calendlyCancellationUIFixture(t), prepared = await f.confirmedCreation()
  prepared.event.status = 'canceled'; prepared.event.invitees_counter.active = 0; prepared.invitee.status = 'canceled'
  const a = { key: randomUUID(), creationKey: prepared.attempt.key, bookingRef: prepared.receipt.bookingRef }, receipt = await f.client.cancel(a)
  assert.equal(receipt.status, 'confirmed'); assert.equal(receipt.reasonCode, 'already_canceled'); assert.equal(receipt.attemptedAt, null); assert.equal(receipt.acceptedAt, null)
  assert.equal(cancelPosts(f).length, 0); assert.deepEqual(await f.client.operation(prepared.attempt), prepared.receipt)
})
test('exact receipt matrix rejects foreign keys, tenant, arbitrary diagnostics and contradictory no-send evidence', async t => {
  const f = await calendlyCancellationUIFixture(t), { cancellation } = await confirmed(f), receipt = await f.client.cancel(cancellation)
  for (const patch of [{ creationKey: randomUUID() }, { bookingRef: randomUUID() }, { key: randomUUID() }, { tenantId: 'foreign' }, { kind: 'calendly.invitee.create' }, { status: 'confirmed' }, { needsReconciliation: false }, { notifications: 'not_sent' }, { reasonCode: 'remote_raw_message' }, { acceptedAt: null }, { token: 'secret' }]) assert.throws(() => parseCalendlyCancellationReceipt({ ...receipt, ...patch }, cancellation, f.actor.tenantId))
  assert.throws(() => parseCalendlyCancellationReceipt({ ...receipt, status: 'not_sent', effect: 'not_sent', needsReconciliation: false }, cancellation, f.actor.tenantId))
  const already: CalendlyCancellationReceipt = { ...receipt, status: 'confirmed', effect: 'cancellation_verified', needsReconciliation: false, reasonCode: 'already_canceled', attemptedAt: null, acceptedAt: null, verifiedAt: receipt.updatedAt }
  assert.equal(parseCalendlyCancellationReceipt(already, cancellation, f.actor.tenantId).reasonCode, 'already_canceled')
})
test('journal permits only explicit not_sent successor, keeps every opaque key and rejects unknown or an unconsulted reference', async t => {
  const f = await calendlyCancellationUIFixture(t), { cancellation } = await confirmed(f), storage = memory(), j = createCalendlyCancellationJournal(storage, f.identity.context, f.agent.id), fresh = () => {}
  j.reserve(cancellation, [], fresh)
  const stamp = new Date().toISOString(), old: CalendlyCancellationReceipt = { ...cancellation, kind: 'calendly.event.cancel', tenantId: f.actor.tenantId, status: 'not_sent', effect: 'not_sent', needsReconciliation: false, automaticRetry: false, notifications: 'provider_managed_unknown', reasonCode: 'verification_unavailable', attemptedAt: null, acceptedAt: null, verifiedAt: null, createdAt: stamp, updatedAt: stamp }
  const next = { ...cancellation, key: randomUUID(), previousNotSentKey: cancellation.key }
  assert.throws(() => j.reserve(next, [], fresh))
  for (const status of ['pending', 'unknown', 'accepted', 'confirmed', 'conflict', 'failed'] as const) {
    const effects = { pending: 'unconfirmed', unknown: 'unconfirmed', accepted: 'http_accepted', confirmed: 'cancellation_verified', conflict: 'verification_conflict', failed: 'provider_rejected' } as const
    assert.throws(() => j.reserve(next, [{ ...old, status, effect: effects[status], needsReconciliation: !['confirmed', 'failed'].includes(status), attemptedAt: stamp, acceptedAt: status === 'accepted' ? stamp : null, reasonCode: null }], fresh))
  }
  j.reserve(next, [old], fresh); assert.deepEqual(j.read(), [cancellation, next]); assert.throws(() => j.reserve({ ...next, key: randomUUID() }, [old], fresh))
  assert.doesNotMatch([...storage.values.values()].join(), /visitor@example|timezone|requestedTime|quote|reasonCode|notifications|status|acceptedAt/)
})
test('journal discovery never evicts or resolves historical keys; write/readback and authority ABA fail closed', async t => {
  const f = await calendlyCancellationUIFixture(t), { cancellation } = await confirmed(f), receipt = await f.client.cancel(cancellation), storage = memory(), j = createCalendlyCancellationJournal(storage, f.identity.context, f.agent.id), fresh = () => {}
  j.discover(cancellation.creationKey, cancellation.bookingRef, [receipt], fresh); assert.deepEqual(j.read(), [cancellation])
  assert.throws(() => j.discover(cancellation.creationKey, cancellation.bookingRef, [receipt, receipt], fresh))
  const write = storage.setItem; storage.setItem = () => {}; assert.throws(() => j.reserve({ key: randomUUID(), creationKey: randomUUID(), bookingRef: randomUUID() }, [], fresh)); storage.setItem = write
  assert.deepEqual(j.read(), [cancellation]); assert.throws(() => j.reserve({ key: randomUUID(), creationKey: randomUUID(), bookingRef: randomUUID() }, [], () => { throw Error('authority changed') }))
  assert.deepEqual(createCalendlyCancellationJournal(storage, { ...f.identity.context, authorityVersion: 'f'.repeat(64) }, f.agent.id).read(), [])
  assert.equal((await f.client.cancellation(cancellation)).key, receipt.key)
})
test('local recovery rejects late authority changes rather than publishing a foreign cancellation', async t => {
  const f = await calendlyCancellationUIFixture(t), { cancellation } = await confirmed(f); await f.client.cancel(cancellation)
  f.state.after = async (_r, response) => { f.state.current = false; return response }
  await assert.rejects(f.client.cancellation(cancellation), /Context changed/); assert.equal(cancelPosts(f).length, 1)
})
