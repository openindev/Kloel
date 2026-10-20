import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { calendlyUIFixture } from './engine-calendly-fixture'
import { calendlyUrl, parseCalendlyChoice, parseCalendlyReceipt, type CalendlyAttempt, type CalendlyConfigAttempt } from '../src/services/engine/calendly'
import { createCalendlyBookingJournal, createCalendlyConfigJournal, createCalendlyOAuthJournal } from '../src/services/engine/calendly-journal'
import { createAgentTestService } from '../src/services/engine/agent-test'

const memory = () => { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } } }
const attempt = (c: any): CalendlyAttempt => ({ key: randomUUID(), conversationId: c.conversationId, actionId: c.actionId, actionRevision: c.actionRevision, eventTypeId: c.eventTypeId, chatOperationKey: c.chatOperationKey })
const values = { name: 'Somente memória', email: 'private@example.test', timezone: 'America/Sao_Paulo' }
test('real HTTP opaque tenant config creates disabled then explicit CAS grant and original receipt', async t => {
  const f = await calendlyUIFixture(t), connection = await f.connect(), types = await f.client.eventTypes(connection)
  assert.equal(types.items[0].supported, true)
  const a: CalendlyConfigAttempt = { key: randomUUID(), kind: 'calendly.action.create', agentId: f.agent.id, connectionId: connection.id, eventTypeId: types.items[0].id, audience: 'private', channelId: null }
  const original = await f.client.configure(a); assert.equal(original.tenantId, f.actor.tenantId)
  let row = (await f.client.actions(f.agent.id))[0]; assert.equal(row.enabled, false); assert.equal(row.allowCreate, false)
  const b: CalendlyConfigAttempt = { key: randomUUID(), kind: 'calendly.action.update', agentId: f.agent.id, resourceId: row.id, expectedRevision: row.revision }
  await f.client.configure(b, { enabled: true, allowCreate: true, expiresInDays: 1, maxBookingsPerDay: 2 }); row = (await f.client.actions(f.agent.id))[0]; assert.equal(row.enabled, true)
  await assert.rejects(f.client.configure({ ...b, key: randomUUID() }, { enabled: false, allowCreate: false, expiresInDays: 1, maxBookingsPerDay: 1 }))
  const count = f.requests.length; assert.deepEqual(await f.client.configurationOperation(a), original); assert.equal(f.requests.length, count)
})
test('real OAuth response loss recovers the original authorization URL through GET only', async t => {
  const f = await calendlyUIFixture(t), key = randomUUID()
  f.state.after = async (r, response) => { if (r.path.endsWith('/oauth/start')) { f.state.after = undefined; throw Error('lost response') }; return response }
  await assert.rejects(f.client.start(key)); const before = f.requests.length, recovered = await f.client.oauthOperation(key)
  assert.equal(recovered.status, 'pending'); assert.equal(recovered.operationKey, key); assert.match(recovered.authorizationUrl!, /^https:\/\/auth.calendly.com\/oauth\/authorize\?/); assert.equal(f.requests.length, before); assert.equal(f.writes().length, 1)
})
test('actual chat card accepts once, verification is explicit GET-only remotely and original recovery survives pause', async t => {
  const f = await calendlyUIFixture(t), connection = await f.connect(), action = await f.createAction(connection.id); f.toolRound(action)
  const key = randomUUID(), chat = await createAgentTestService(f.context, f.agent.id).chat('Quero agendar.', key), c = chat.calendlyChoices![0], a = attempt(c)
  assert.equal(c.chatOperationKey, key); assert.equal(c.reservationsGuaranteed, false)
  const receipt = await f.client.create(a, c, c.slots[0].quote, values); assert.equal(receipt.status, 'accepted'); assert.equal(receipt.needsReconciliation, true)
  const posts = f.requests.filter(r => r.method === 'POST').length, all = f.requests.length
  assert.deepEqual(await f.client.operation(a), receipt); assert.equal(f.requests.length, all)
  const verified = await f.client.verify(a); assert.equal(verified.status, 'confirmed'); assert.equal(f.requests.filter(r => r.method === 'POST').length, posts)
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'paused' })
  const readCount = f.requests.length; assert.equal((await f.client.chatOperations(key)).calendlyOperations[0].key, a.key); assert.equal(f.requests.length, readCount)
  const links = await f.client.management(a, verified); assert.match(links.cancelUrl!, /^https:\/\/calendly.com\/cancellations\//)
})
test('lost booking response retains accepted receipt and no GET repeats a remote POST', async t => {
  const f = await calendlyUIFixture(t), c = (await f.choices())[0], a = attempt(c)
  f.state.after = async (r, response) => { if (r.path.endsWith('/bookings')) { f.state.after = undefined; throw Error('lost after commit') }; return response }
  await assert.rejects(f.client.create(a, c, c.slots[0].quote, values)); const count = f.requests.length
  assert.equal((await f.client.operation(a)).status, 'accepted'); assert.equal(f.requests.length, count)
  assert.equal((await f.client.chatOperations(c.chatOperationKey)).calendlyOperations[0].key, a.key); assert.equal(f.requests.length, count)
})
test('strict receipt/card matrices and provider links reject foreign metadata and noncanonical targets', async t => {
  const f = await calendlyUIFixture(t), c = (await f.choices())[0], a = attempt(c), receipt = await f.client.create(a, c, c.slots[0].quote, values)
  for (const bad of [{ ...receipt, status: 'confirmed' }, { ...receipt, needsReconciliation: false }, { ...receipt, tenantId: 'foreign' }, { ...receipt, bookingRef: null }, { ...receipt, token: 'not permitted' }]) assert.throws(() => parseCalendlyReceipt(bad, a, f.actor.tenantId))
  for (const bad of [{ ...c, reservationsGuaranteed: true }, { ...c, slots: [c.slots[0], c.slots[0]] }, { ...c, form: { ...c.form, phone: { required: true } } }, { ...c, timezone: 'invalid/zone' }]) assert.throws(() => parseCalendlyChoice(bad))
  for (const url of ['http://calendly.com/a', 'https://calendly.com.evil.test/a', 'https://calendly.com/a?token=private', 'https://user:pw@calendly.com/a', 'https://calendly.com/a#secret']) assert.throws(() => calendlyUrl(url, 'scheduling'))
})
test('journals preserve opaque references, CAS, scope and bounded history without eviction', async t => {
  const f = await calendlyUIFixture(t), c = (await f.choices())[0], a = attempt(c), storage = memory(), journal = createCalendlyBookingJournal(storage, f.identity.context, f.agent.id), fresh = () => {}
  assert.throws(() => journal.reserve(a, fresh)); journal.rememberChat(a.chatOperationKey, fresh); journal.reserve(a, fresh)
  assert.throws(() => journal.reserve({ ...a, key: randomUUID(), actionId: randomUUID() }, fresh)); assert.doesNotMatch([...storage.values.values()].join(), /quote|values|timezone|name|email|token|authorizationUrl/)
  const receipt = await f.client.create(a, c, c.slots[0].quote, values); assert.throws(() => journal.releaseNoEffect(a, receipt, fresh))
  const originalSet = storage.setItem; storage.setItem = () => {}; assert.throws(() => journal.rememberChat(randomUUID(), fresh)); storage.setItem = originalSet
  assert.deepEqual(journal.read().attempts, [a]); assert.throws(() => journal.discover(a.chatOperationKey, [{ ...receipt, conversationId: randomUUID() }], fresh))
  for (let i = 1; i < 100; i++) journal.rememberChat(randomUUID(), fresh)
  assert.throws(() => journal.rememberChat(randomUUID(), fresh)); assert.equal(journal.read().chats.length, 100)
  assert.equal(createCalendlyBookingJournal(storage, { ...f.identity.context, authorityVersion: 'f'.repeat(64) }, f.agent.id).read().attempts.length, 0)
})
test('configuration and OAuth journals retain unresolved slots and reject stale resolution', async t => {
  const f = await calendlyUIFixture(t), connection = await f.connect(), storage = memory(), j = createCalendlyConfigJournal(storage, f.identity.context, f.agent.id), fresh = () => {}
  const a: CalendlyConfigAttempt = { key: randomUUID(), kind: 'calendly.action.create', agentId: f.agent.id, connectionId: connection.id, eventTypeId: f.remote.eventTypeId, audience: 'private', channelId: null }, b = { ...a, key: randomUUID(), audience: 'webchat' as const, channelId: f.channel.id }
  j.reserve(a, fresh); j.reserve(b, fresh); assert.throws(() => j.reserve({ ...a, key: randomUUID() }, fresh)); const receipt = await f.client.configure(a); assert.throws(() => j.resolve(b, receipt, fresh)); j.resolve(a, receipt, fresh); assert.deepEqual(j.read(), [b]); assert.throws(() => j.resolve(a, receipt, fresh))
  const oauth = createCalendlyOAuthJournal(storage, f.identity.context), key = randomUUID(); oauth.reserve(key, fresh); assert.throws(() => oauth.reserve(key, fresh)); assert.throws(() => oauth.resolve(key, 'pending' as any, fresh)); oauth.resolve(key, 'expired', fresh); assert.deepEqual(oauth.read(), [])
})
test('late authorized read rejects a superseded session rather than publishing another account', async t => {
  const f = await calendlyUIFixture(t); await f.connect(); f.state.after = async (_r, response) => { f.state.current = false; return response }
  await assert.rejects(f.client.connections(), /Context changed/)
})
