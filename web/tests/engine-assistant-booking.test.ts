import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { assistantBookingUIFixture } from './engine-assistant-booking-fixture'
import { bookingValues, parseBookingChoice, parseBookingOperation, type BookingAttempt, type BookingActionAttempt } from '../src/services/engine/assistant-booking'
import { createAssistantBookingJournal, createBookingActionJournal } from '../src/services/engine/assistant-booking-journal'
import { createAgentTestService } from '../src/services/engine/agent-test'

const memory = () => { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } } }
const attempt = (c: any): BookingAttempt => ({ key: randomUUID(), conversationId: c.conversationId, actionId: c.actionId, actionRevision: c.actionRevision, eventTypeId: c.eventTypeId, chatOperationKey: c.chatOperationKey })
test('real HTTP config starts disabled, options local, explicit update CAS and original receipt survive removal', async t => {
  const f = await assistantBookingUIFixture(t); f.requests.length = 0
  const options = await f.client.options(); assert.equal(options.eventTypes[0].id, f.page.id); assert.equal(f.requests.length, 0)
  const a: BookingActionAttempt = { key: randomUUID(), kind: 'booking.action.create', agentId: f.agent.id, eventTypeId: f.page.id, audience: 'private', channelId: null }
  const op = await f.client.configure(a); assert.equal(op.enabled, false); assert.equal(op.allowCreate, false)
  const row = (await f.client.list())[0], b: BookingActionAttempt = { key: randomUUID(), kind: 'booking.action.update', agentId: f.agent.id, actionId: row.id, expectedRevision: row.revision }
  const next = await f.client.configure(b, { enabled: true, allowCreate: true, expiresInDays: 1, maxBookingsPerDay: 2 }); assert.equal(next.revision, 2)
  await assert.rejects(f.client.configure({ ...b, key: randomUUID() }, { enabled: false, allowCreate: false, expiresInDays: 1, maxBookingsPerDay: 1 }))
  f.store.remove(f.actor.tenantId, 'booking-assistant-actions', row.id)
  assert.deepEqual(await f.client.actionOperation(a), op); assert.equal(f.requests.length, 0)
})
test('real chat produces typed choice, create enters managed booking core and recovery/management never repeats provider POST', async t => {
  const f = await assistantBookingUIFixture(t), action = await f.create(); f.toolRound(action)
  const key = randomUUID(), chat = await createAgentTestService(f.context, f.agent.id).chat('Quero agendar.', key), choice = chat.bookingChoices[0]
  assert.equal(choice.chatOperationKey, key); assert.equal(choice.reservationsGuaranteed, false); assert.ok(choice.slots.length)
  const a = attempt(choice), op = await f.client.create(a, choice, choice.slots[0], {}); assert.equal(op.status, 'confirmed'); assert.ok(f.store.get(f.actor.tenantId, 'public-bookings', op.bookingRef))
  const posts = f.requests.filter(r => r.method === 'POST').length
  assert.deepEqual(await f.client.operation(a), op); assert.equal((await f.client.chatOperations(key)).bookingOperations[0].key, a.key)
  const link = await f.client.management(op); assert.match(link.url, /#booking=.*&manage=/); assert.equal(f.requests.filter(r => r.method === 'POST').length, posts)
})
test('lost create response then pause/remove action recovers only GET and never reconstructs PII', async t => {
  const f = await assistantBookingUIFixture(t), c = (await f.choices())[0], a = attempt(c)
  f.state.after = async (r, response) => { if (r.path.endsWith('/bookings')) { f.state.after = undefined; throw Error('lost after commit') }; return response }
  await assert.rejects(f.client.create(a, c, c.slots[0], {})); const posts = f.requests.filter(r => r.method === 'POST').length
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'paused' }); f.store.remove(f.actor.tenantId, 'booking-assistant-actions', c.actionId)
  assert.equal((await f.client.operation(a)).status, 'confirmed'); const recovered = await f.client.chatOperations(c.chatOperationKey); assert.equal(recovered.bookingOperations[0].key, a.key); assert.equal(f.requests.filter(r => r.method === 'POST').length, posts)
})
test('strict card and receipt parsers reject malformed matrices, duplicate fields, quotes and wrong original linkage', async t => {
  const f = await assistantBookingUIFixture(t), c = (await f.choices())[0], a = attempt(c), op = await f.client.create(a, c, c.slots[0], {})
  for (const bad of [{ ...op, status: 'accepted', effect: 'event_verified' }, { ...op, bookingRef: null }, { ...op, needsReconciliation: true }, { ...op, conversationId: randomUUID() }]) assert.throws(() => parseBookingOperation(bad, a))
  for (const bad of [{ ...c, form: [{ field: 'email', label: 'Email', required: true }, { field: 'email', label: 'Again', required: false }] }, { ...c, slots: [c.slots[0], c.slots[0]] }, { ...c, reservationsGuaranteed: true }, { ...c, chatOperationKey: '../key' }]) assert.throws(() => parseBookingChoice(bad))
  const card = { ...c, form: [{ field: 'phone' as const, label: 'Telefone', required: true }] }; assert.throws(() => bookingValues(card, { phone: '119999' })); assert.deepEqual(bookingValues(card, { phone: '+15555550123' }), { phone: '+15555550123' })
})
test('execution journal is opaque, fail-closed, scoped, bounded and blocks equivalent new keys until proven not_sent', async t => {
  const f = await assistantBookingUIFixture(t), c = (await f.choices())[0], a = attempt(c), storage = memory(), journal = createAssistantBookingJournal(storage, f.identity.context, f.agent.id), fresh = () => {}
  assert.throws(() => journal.reserve(a, fresh)); journal.rememberChat(a.chatOperationKey, fresh); journal.reserve(a, fresh)
  assert.throws(() => journal.reserve({ ...a, key: randomUUID(), actionId: randomUUID(), actionRevision: 2 }, fresh)); assert.doesNotMatch([...storage.values.values()].join(), /quote|values|timezone|name|email|phone/)
  const same = createAssistantBookingJournal(storage, f.identity.context, f.agent.id); assert.deepEqual(same.read().attempts, [a]); assert.throws(() => same.reserve({ ...a, privateName: 'private' } as any, fresh))
  const old = storage.setItem; storage.setItem = () => {}; assert.throws(() => journal.rememberChat(randomUUID(), fresh)); storage.setItem = old
  const stale = createAssistantBookingJournal(storage, { ...f.identity.context, authorityVersion: 'f'.repeat(64) }, f.agent.id); assert.equal(stale.read().attempts.length, 0)
})
test('configuration journal preserves unrelated pending rows and rejects receipt mismatch or failed readback', async t => {
  const f = await assistantBookingUIFixture(t), storage = memory(), journal = createBookingActionJournal(storage, f.identity.context, f.agent.id), fresh = () => {}, a: BookingActionAttempt = { key: randomUUID(), kind: 'booking.action.create', agentId: f.agent.id, eventTypeId: f.page.id, audience: 'private', channelId: null }, b = { ...a, key: randomUUID(), audience: 'webchat' as const, channelId: f.channel.id }
  journal.reserve(a, fresh); journal.reserve(b, fresh); const op = await f.client.configure(a); assert.throws(() => journal.resolve(b, op, fresh)); journal.resolve(a, op, fresh); assert.deepEqual(journal.read(), [b]); assert.throws(() => journal.resolve(a, op, fresh))
  for (let i = 1; i < 20; i++) journal.reserve({ ...a, key: randomUUID(), eventTypeId: randomUUID() }, fresh)
  assert.throws(() => journal.reserve({ ...a, key: randomUUID(), eventTypeId: randomUUID() }, fresh)); assert.equal(journal.read().length, 20)
})
