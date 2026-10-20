import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { beforeContextUIFixture } from './engine-before-context-fixture'
import { parseBeforeConfiguration, parseBeforeFacts, parseBeforeOpening, parseBeforeHistory, type BeforeConfigAttempt, type BeforeOpeningAttempt } from '../src/services/engine/before-context'
import { createBeforeConfigJournal, createBeforeOpeningJournal } from '../src/services/engine/before-context-journal'
const storage = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) }, map } }

test('real local config virtual0 → CAS1; preview uses typed examples and first rule without conversations or model', async t => {
  const f = await beforeContextUIFixture(t), initial = await f.client.read(); assert.equal(initial.revision, 0)
  const c = structuredClone(f.sample); c.greetingRules = [{ conditions: [{ field: 'vars.ativo', operator: 'equals', value: true }], greeting: 'Primeira {{vars.quantidade}}' }, { conditions: [{ field: 'vars.ativo', operator: 'equals', value: true }], greeting: 'Segunda' }]
  const before = f.store.list(f.actor.tenantId, 'conversations').length, preview = await f.client.preview(c, { startedAt: '2026-10-19T12:00:00.000Z' })
  assert.equal(preview.greeting, 'Primeira 7'); assert.equal(preview.ruleIndex, 0); assert.equal(preview.externalSources, false); assert.equal(f.store.list(f.actor.tenantId, 'conversations').length, before); assert.equal(f.openAI.length, 0)
  const a: BeforeConfigAttempt = { key: randomUUID(), agentId: f.agent.id, expectedRevision: 0 }, op = await f.client.configure(a, c); assert.equal(op.revision, 1); assert.deepEqual(await f.client.configOperation(a), op)
  assert.equal((await f.client.read()).revision, 1); assert.deepEqual(await f.client.availability(), { agentId: f.agent.id, enabled: true, revision: 1, supportedSurfaces: ['private', 'webchat', 'voice_private', 'voice_incoming'] })
  await assert.rejects(f.client.configure({ ...a, key: randomUUID() }, c), e => (e as any).code === 'before_context_revision_conflict')
})
test('private live preserves zero/false and test examples are explicit; replay and history do not duplicate greeting', async t => {
  const f = await beforeContextUIFixture(t); await f.enable()
  const a: BeforeOpeningAttempt = { key: randomUUID(), agentId: f.agent.id, expectedConfigRevision: 1, mode: 'live' }, live = await f.client.open(a)
  assert.equal(live.source, 'defaults'); assert.equal((await f.client.history(a, live)).items[0].content, 'Olá Visitante: 0 / false.')
  assert.deepEqual(await f.client.open(a), live); assert.equal((await f.client.history(a, live)).items.length, 1)
  const testA = { ...a, key: randomUUID(), mode: 'test' as const }, simulated = await f.client.open(testA)
  assert.equal((await f.client.history(testA, simulated)).items[0].content, 'Olá Exemplo sintético: 7 / true.'); assert.notEqual(simulated.conversationId, live.conversationId)
  await assert.rejects(f.client.open(a, {})); assert.equal(f.openAI.length, 0)
})
test('lost opening response recovers original metadata and history after pause/config edit using GET only', async t => {
  const f = await beforeContextUIFixture(t); await f.enable(); const a: BeforeOpeningAttempt = { key: randomUUID(), agentId: f.agent.id, expectedConfigRevision: 1, mode: 'test' }
  f.state.after = async (r, response) => { if (r.path === '/api/v1/ai/conversations/open') { f.state.after = undefined; throw Error('Response lost after commit') } return response }
  await assert.rejects(f.client.open(a)); f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'paused' }); await f.save({ ...f.sample, enabled: false }, 1)
  const count = f.writes().length, op = await f.client.opening(a), history = await f.client.history(a, op); assert.equal(history.items.length, 1); assert.equal(f.writes().length, count); assert.equal(op.configRevision, 1)
  assert.throws(() => parseBeforeOpening({ ...op, mode: 'live' }, a, f.actor.tenantId)); assert.throws(() => parseBeforeHistory({ ...history, conversationId: randomUUID() }, op))
})
test('opaque journals verify readback, preserve unknown lane and reject old CAS cleanup', async t => {
  const f = await beforeContextUIFixture(t), s = storage(), j = createBeforeConfigJournal(s, f.identity.context, f.agent.id), fresh = () => {}, a: BeforeConfigAttempt = { key: randomUUID(), agentId: f.agent.id, expectedRevision: 0 }
  j.reserve(a, fresh); assert.throws(() => j.reserve({ ...a, key: randomUUID() }, fresh)); const op = await f.client.configure(a, f.sample)
  assert.throws(() => j.resolve({ ...a, key: randomUUID() }, op, fresh)); j.resolve(a, op, fresh); assert.equal(j.read().active, null)
  const o = createBeforeOpeningJournal(s, f.identity.context, f.agent.id), attempt: BeforeOpeningAttempt = { key: randomUUID(), agentId: f.agent.id, expectedConfigRevision: 1, mode: 'test' }; o.reserve(attempt, fresh)
  assert.throws(() => o.reserve({ ...attempt, key: randomUUID(), mode: 'live' }, fresh)); const ready = await f.client.open(attempt); o.archiveReady(attempt, ready, fresh); assert.deepEqual(o.read().history, [attempt]); assert.equal(o.read().active, null)
  assert.doesNotMatch(JSON.stringify([...s.map.values()]), /Exemplo sintético|Visitante|greeting|testFacts|defaultValue/)
  const broken = createBeforeOpeningJournal({ ...s, setItem() {} }, f.identity.context, f.agent.id); assert.throws(() => broken.reserve({ ...attempt, key: randomUUID() }, fresh))
})
test('parser rejects wrong types/prototype/undeclared variables/invalid zone and overnight mismatch', async t => {
  const f = await beforeContextUIFixture(t), base = f.sample
  for (const bad of [{ ...base, timezone: 'No/Such_Zone' }, { ...base, testContext: { quantidade: '7' } }, { ...base, defaultGreeting: '{{vars.undeclared}}' }, { ...base, variables: [{ name: 'constructor', type: 'text', defaultValue: '' }] }, { ...base, greetingRules: [{ greeting: 'Oi', conditions: [{ field: 'system.localTime', operator: 'time_between', value: { start: '22:00', end: '06:00', overnight: false } }] }] }, JSON.parse(JSON.stringify(base).replace('"testContext":{', '"testContext":{"__proto__":"x",'))]) assert.throws(() => parseBeforeConfiguration(bad))
  assert.equal(parseBeforeConfiguration({ ...base, testContext: { nome: '', quantidade: 0, ativo: false } }).testContext.quantidade, 0)
  assert.throws(() => parseBeforeFacts({ startedAt: 'bad' })); assert.throws(() => parseBeforeFacts({ phone: '123' }))
})
test('request and late projection obey authority and abort fences', async t => {
  const f = await beforeContextUIFixture(t); f.state.after = async (_r, response) => { f.state.current = false; return response }; await assert.rejects(f.client.read(), e => (e as any).code === 'superseded')
  f.state.after = undefined; f.state.current = true; const abort = new AbortController(); f.state.after = async (_r, response) => { abort.abort(); return response }; await assert.rejects(f.client.read(abort.signal))
})

test('journal bounds preserve all references and exhausted revision never creates a POST', async t => {
  const f = await beforeContextUIFixture(t), s = storage(), fresh = () => {}, j = createBeforeOpeningJournal(s, f.identity.context, f.agent.id)
  const history = Array.from({ length: 100 }, () => ({ key: randomUUID(), agentId: f.agent.id, expectedConfigRevision: 1, mode: 'live' as const }))
  s.setItem(j.key, JSON.stringify({ version: 1, context: f.identity.context, data: { active: null, history } })); const original = s.getItem(j.key)
  assert.throws(() => j.reserve({ ...history[0], key: randomUUID() }, fresh)); assert.equal(s.getItem(j.key), original); assert.equal(j.read().history.length, 100)
  s.setItem(j.key, JSON.stringify({ version: 1, context: f.identity.context, data: { active: history[0], history } })); assert.throws(() => j.read()); s.setItem(j.key, original!)
  const before = f.writes().length; await assert.rejects(f.client.configure({ key: randomUUID(), agentId: f.agent.id, expectedRevision: Number.MAX_SAFE_INTEGER }, f.sample)); assert.equal(f.writes().length, before)
  const c = createBeforeConfigJournal(s, f.identity.context, f.agent.id), a = { key: randomUUID(), agentId: f.agent.id, expectedRevision: 0 }; let calls = 0
  assert.throws(() => c.reserve(a, () => { if (++calls === 3) throw Error('authority changed during readback') })); assert.deepEqual(c.read().active, a, 'durable opaque reference survives uncertain local publication')
})
