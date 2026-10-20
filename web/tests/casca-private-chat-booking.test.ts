import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { assistantBookingUIFixture } from './engine-assistant-booking-fixture'
import { calendlyUIFixture } from './engine-calendly-fixture'
import { createAgentTestService } from '../src/services/engine/agent-test'
import { createPrivateChatBooking, privateBookingStatus } from '../src/services/casca/private-chat-booking'
const memory = () => { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } } }

test('private chat choices create a managed reservation once; lost response survives reopening with only opaque references', async t => {
  const f = await assistantBookingUIFixture(t), action = await f.create(); f.toolRound(action)
  const result = await createAgentTestService(f.context, f.agent.id).chat('Quero agendar.', randomUUID()), storage = memory()
  const client = createPrivateChatBooking(f.context, f.identity.context, f.agent.id, storage), before = f.calls.length
  const [choice] = client.accept(result); assert.equal(f.calls.length, before)
  const refreshed = await client.slots(choice, f.from, f.to); assert.ok(refreshed.length)
  f.state.after = async (r, response) => { if (r.method === 'POST' && r.path.endsWith('/bookings')) { f.state.after = undefined; throw Error('Synthetic response loss') } return response }
  await assert.rejects(client.create(refreshed[0], {}, false))
  const resumed = createPrivateChatBooking(f.context, f.identity.context, f.agent.id, storage), [reference] = resumed.references()
  const receipt = await resumed.consult(reference); assert.equal(receipt.value.status, 'confirmed'); assert.equal(privateBookingStatus(receipt), 'Criação da reserva confirmada')
  await assert.rejects(resumed.releaseNotSent(reference)); assert.equal(resumed.references().length, 1)
  const links = await resumed.management(reference); assert.match(links[0].url, /#booking=.*&manage=/)
  assert.equal(f.writes().filter(r => r.path.endsWith('/bookings')).length, 1)
  assert.doesNotMatch([...storage.values.values()].join(), /quote|values|email|phone|name|token|timezone/)
  assert.equal((await client.create({ choice, slot: choice.value.slots[0] }, {}, false)).value.key, receipt.value.key)
  assert.equal(f.writes().filter(r => r.path.endsWith('/bookings')).length, 1)
})

test('Calendly private choices require explicit notifications acknowledgement; accepted is verified separately before management', async t => {
  const f = await calendlyUIFixture(t), connection = await f.connect(), action = await f.createAction(connection.id); f.toolRound(action)
  const result = await createAgentTestService(f.context, f.agent.id).chat('Quero agendar.', randomUUID()), storage = memory()
  const client = createPrivateChatBooking(f.context, f.identity.context, f.agent.id, storage), [choice] = client.accept(result)
  const [selected] = await client.slots(choice, f.from, f.to); assert.ok(selected)
  await assert.rejects(client.create(selected, { name: 'Pessoa', email: 'pessoa@example.test' }, false), /notificações/)
  await assert.rejects(client.create(selected, { name: 'Pessoa', email: 'inválido' }, true))
  assert.equal(client.references().length, 0)
  f.hooks.before = (url, method) => url.pathname === '/invitees' && method === 'POST' ? Response.json({ message: 'Rejected by controlled provider' }, { status: 400 }) : undefined
  await assert.rejects(client.create(selected, { name: 'Pessoa', email: 'pessoa@example.test' }, true))
  const [failedRef] = client.references(), rejected = await client.consult(failedRef)
  assert.equal(rejected.value.status, 'failed'); await client.releaseNotSent(failedRef); assert.equal(client.references().length, 0)
  assert.equal(client.initialSlots(choice).length, 0)
  await assert.rejects(client.create(selected, { name: 'Pessoa', email: 'pessoa@example.test' }, true), /horários novamente/)
  assert.equal(client.references().length, 0)
  f.hooks.before = undefined
  const [fresh] = await client.slots(choice, f.from, f.to)
  const accepted = await client.create(fresh, { name: 'Pessoa', email: 'pessoa@example.test' }, true), [reference] = client.references()
  assert.equal(accepted.value.status, 'accepted'); assert.match(privateBookingStatus(accepted), /pendente/)
  await assert.rejects(client.management(reference), /Aguarde/)
  const posts = f.requests.filter(r => r.method === 'POST').length
  const verified = await client.verify(reference); assert.equal(verified.value.status, 'confirmed')
  const links = await client.management(reference); assert.equal(links.length, 2); assert.ok(links.every(link => /^https:\/\/calendly.com\/(cancellations|reschedulings)\//.test(link.url)))
  assert.equal(f.requests.filter(r => r.method === 'POST').length, posts)
  assert.doesNotMatch([...storage.values.values()].join(), /pessoa|quote|timezone|name|email/)
})

test('unseen choices, foreign references and stale contexts cannot reserve or consult under another authority', async t => {
  const f = await assistantBookingUIFixture(t), action = await f.create(); f.toolRound(action)
  const result = await createAgentTestService(f.context, f.agent.id).chat('Agendar.', randomUUID()), client = createPrivateChatBooking(f.context, f.identity.context, f.agent.id, memory())
  const unseen = { provider: 'kloel' as const, value: result.bookingChoices[0] }
  await assert.rejects(client.create({ choice: unseen, slot: unseen.value.slots[0] }, {}, false), /Atualize/)
  const [choice] = client.accept(result), count = f.calls.length
  await assert.rejects(client.consult({ provider: 'kloel', attempt: { key: randomUUID(), actionId: choice.value.actionId, actionRevision: choice.value.actionRevision, conversationId: choice.value.conversationId, eventTypeId: choice.value.eventTypeId, chatOperationKey: choice.value.chatOperationKey } }), /não pertence/)
  f.state.current = false
  await assert.rejects(client.create({ choice, slot: choice.value.slots[0] }, {}, false), /Context changed/)
  assert.equal(f.calls.length, count)
})

test('a visitor choice cannot be converted into private owner authority even if supplied to the adapter', async t => {
  const f = await assistantBookingUIFixture(t), action = await f.create('webchat'); f.toolRound(action)
  const session = await f.session(), response = await f.publicRequest(session.token, 'messages', { message: 'Agendar.', idempotencyKey: randomUUID() })
  assert.equal(response.statusCode, 200, response.body)
  const value = response.json().bookingChoices[0], client = createPrivateChatBooking(f.context, f.identity.context, f.agent.id, memory()), before = f.requests.length
  const [choice] = client.accept({ conversationId: value.conversationId, responseId: 'test', text: 'test', usage: {}, sheetOperations: [], bookingChoices: [value] })
  await assert.rejects(client.create({ choice, slot: value.slots[0] }, {}, false))
  assert.equal(f.requests.length, before)
  assert.equal(f.store.list(f.actor.tenantId, 'booking-assistant-operations').length, 0)
})
