import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { bookingOperatorFixture } from '../../engine/tests/fixtures/booking-operator'
import { rescheduleFixture } from './engine-booking-reschedule-service-fixture'
import { createEngineClient } from '../src/services/engine/http'
import { loadConversationBookings, createBookingRescheduling } from '../src/services/casca/conversation-bookings'
import { createBookingOperationsJournal } from '../src/services/engine/booking-operations-journal'
import { bookingCancellationAttempt } from '../src/services/engine/booking-operations'
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }

test('conversation reservation projection uses persisted references, keeps unknown attempts and never guesses visitor data', async t => {
  const f = await bookingOperatorFixture(t), identity = (await f.request('/api/v1/auth/me')).json()
  const conversation = f.store.create(f.actor.tenantId, 'conversations', { channel: 'webchat' })
  const fields = { kind: 'booking.create', key: randomUUID(), status: 'confirmed', conversationId: conversation.id, actionId: randomUUID(), actionRevision: 1, eventTypeId: f.page.id, bookingRef: f.booked.bookingRef, startAt: f.record().startAt, endAt: f.record().endAt, timezone: 'UTC' }
  f.store.create(f.actor.tenantId, 'booking-assistant-operations', fields)
  f.store.create(f.actor.tenantId, 'booking-assistant-operations', { ...fields, key: randomUUID(), status: 'pending', bookingRef: randomUUID() })
  f.store.create(f.actor.tenantId, 'booking-assistant-operations', { ...fields, key: randomUUID(), conversationId: randomUUID() })
  const request = createEngineClient((async (input, init = {}) => {
    const r = await f.app.inject({ url: String(input), method: init.method as any ?? 'GET', cookies: f.cookies, headers: Object.fromEntries(new Headers(init.headers)) })
    return new Response(r.body, { status: r.statusCode })
  }) as typeof fetch)
  const context = { tenantId: f.actor.tenantId, generation: 1, assertCurrent() {}, request: <T>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }) }
  const projected = await loadConversationBookings(context, conversation.id)
  assert.equal(projected.bookings.length, 1); assert.equal(projected.bookings[0].id, f.booked.bookingRef)
  // Origin comes from the engine record (public page booking here); visitor data is never guessed (none was collected).
  assert.equal(projected.bookings[0].name, ''); assert.equal(projected.bookings[0].source, 'booking_page')
  assert.equal(projected.operations.length, 1); assert.equal(projected.operations[0].status, 'unknown'); assert.equal(f.requests.length, 0)
  await assert.rejects(loadConversationBookings({ ...context, request: async () => ({ conversationId: randomUUID(), page: 1, limit: 100, total: 0, totalPages: 0, items: [] }) as any }, conversation.id))
})

test('operator reschedule response loss is reconciled and read without repeating provider PATCH', async t => {
  const f = await rescheduleFixture(t), storage = memory(), api = createBookingRescheduling(f.context, f.identity.context, storage)
  const booking = (await f.cancelApi.list()).find(row => row.bookingRef === f.booked.bookingRef)!
  const slots = await api.slots(booking, f.from, f.to), target = slots.find(row => row.startAt !== booking.startAt)!
  assert.ok(target)
  let lost = false
  f.wire.after = async (path, method, response) => { if (!lost && method === 'POST' && path.endsWith('/reschedule')) { lost = true; throw Error('Synthetic transport loss') } return response }
  await assert.rejects(api.change(booking, target)); assert.equal(api.pending(booking.bookingRef), true)
  const fresh = createBookingRescheduling(f.context, f.identity.context, storage), observed = await fresh.change(booking)
  assert.equal(observed.startAt, target.startAt); assert.equal(observed.status, 'confirmed'); assert.equal(fresh.pending(booking.bookingRef), false)
  assert.equal(f.requests.filter(row => row.method === 'PATCH').length, 1)
  assert.equal(f.browser.filter(row => row.method === 'POST' && row.path.endsWith('/reschedule')).length, 1)
})

test('a retained cancellation blocks another reschedule intent before any provider call', async t => {
  const f = await rescheduleFixture(t), storage = memory(), api = createBookingRescheduling(f.context, f.identity.context, storage)
  const booking = (await f.cancelApi.list())[0], prefix = `kloel:casca:scheduling:${f.identity.context.membershipId}:${f.identity.context.authorityVersion}:`
  const scoped = { getItem: (key: string) => storage.getItem(prefix + key), setItem: (key: string, value: string) => storage.setItem(prefix + key, value), removeItem: (key: string) => storage.removeItem(prefix + key) }
  createBookingOperationsJournal(scoped, f.identity.context).reserve(bookingCancellationAttempt(booking), f.context.assertCurrent)
  await assert.rejects(api.slots(booking, f.from, f.to), /pendente/)
  await assert.rejects(api.change(booking), /cancelamento pendente/)
  assert.equal(f.requests.length, 0)
})
