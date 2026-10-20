import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { makeAgent } from '../src/data/seed/defaults'
import { assertNewBeforeConfiguration, preflightBeforeFields, translateInbound, translateGreetingCondition } from '../src/services/casca/before-translation'
import { createBeforeFieldsService, projectBeforeFields, readBeforeSnapshot } from '../src/services/casca/before-context'
import { createCascaChatSession } from '../src/services/casca/test-chat'
import { beforeContextUIFixture } from './engine-before-context-fixture'
import { beforeHttpUIFixture } from './engine-before-http-fixture'
import { registerAgentEditorState } from '../../engine/src/agent-editor-state'
import { createBeforeHttpService, type HttpConfiguration } from '../src/services/engine/before-http'
import { createAgentCommands, createAgentJournal, createManagedAgentCommands } from '../src/services/casca/agents'
import { prepareBeforeFieldsForContext } from '../src/services/casca/before-save'

const memory = () => { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } } }
const agent = () => makeAgent('synthetic-org', 'Ana', 'chat', 'Empresa', { id: randomUUID(), greeting: 'Olá', greetingPersonalized: false, greetingRules: [], webhooks: [] })

test('shell fields translate deterministically; old automatic defaults do not block unrelated edits', () => {
  const base = agent(), old = { ...base, greetingPersonalized: true, greetingMode: 'auto' as const }
  assert.equal(preflightBeforeFields(old, { ...old, name: 'Outro nome' }), null)
  assert.doesNotThrow(() => assertNewBeforeConfiguration(old))
  assert.throws(() => assertNewBeforeConfiguration({ ...old, greeting: '{{company.name}}' }), /Crie o assistente primeiro/)
  const literal = preflightBeforeFields(old, { ...old, greeting: 'Olá {{agent.name}}, {{company.name}}.' })!
  assert.equal(literal.configuration.defaultGreeting, 'Olá {{system.agentName}}, {{system.companyName}}.')
  assert.deepEqual(literal.configuration.greetingRules, [])
  const next = { ...base, greetingPersonalized: true, greetingMode: 'advanced' as const, greetingRules: [{ id: 'r1', message: 'Boa noite!', conditions: [{ field: 'call.direction', operator: 'is', value: 'inbound' }, { field: 'call.timeOfDay', operator: 'within', value: '22:00-06:00' }] }] }
  const plan = preflightBeforeFields(base, next)!
  assert.deepEqual(plan.configuration.greetingRules[0].conditions, [{ field: 'system.direction', operator: 'equals', value: 'incoming' }, { field: 'system.localTime', operator: 'time_between', value: { start: '22:00', end: '06:00', overnight: true } }])
  assert.throws(() => preflightBeforeFields(base, { ...base, greetingPersonalized: true }), /automática/)
  for (const field of ['contact.firstName', 'call.period', 'call.withinBusinessHours']) assert.throws(() => translateGreetingCondition({ field, operator: 'is', value: 'x' }))
  assert.throws(() => translateGreetingCondition({ field: 'call.direction', operator: 'is_not', value: 'inbound' }))
})

test('flat defaults preserve false and zero; incompatible facts and types fail before writes', () => {
  const base = agent(), next = { ...base, greeting: 'Olá {{nome}} {{quantidade}} {{ativo}}', webhooks: [{ id: 'in', kind: 'inbound' as const, name: 'Webhook', enabled: false, defaults: '{"nome":"Visitante","quantidade":0,"ativo":false}' }, { id: 'test', kind: 'test_context' as const, name: 'Contexto', enabled: true, body: '{"nome":"Teste","quantidade":7,"ativo":true}' }] }
  const plan = preflightBeforeFields(base, next)!
  assert.equal(plan.configuration.variables[1].defaultValue, 0); assert.equal(plan.configuration.variables[2].defaultValue, false)
  assert.equal(plan.configuration.testContext.nome, 'Teste')
  assert.equal(translateInbound(plan, []), null)
  for (const defaults of ['{"name":null}', '{"name":[]}', '{"name":{}}', '{"constructor":"x"}']) assert.throws(() => preflightBeforeFields(base, { ...next, webhooks: [{ ...next.webhooks[0], defaults }] }))
  assert.throws(() => preflightBeforeFields(base, { ...next, webhooks: [next.webhooks[0], { ...next.webhooks[1], body: '{"quantidade":"7"}' }] }))
  assert.throws(() => preflightBeforeFields(base, { ...base, greeting: 'Olá {{contact.firstName}}' }))
})

test('real config API saves translated greeting; lost committed response is consulted once without duplicate PUT', async t => {
  const f = await beforeContextUIFixture(t), storage = memory(), service = createBeforeFieldsService(f.context, f.identity.context, storage, f.agent.id)
  const base = projectBeforeFields({ ...agent(), id: f.agent.id, orgId: f.actor.tenantId }, await service.read())
  const next = { ...base, greeting: 'Olá {{agent.name}} em {{company.name}}' }, plan = preflightBeforeFields(base, next)!
  let dropped = false
  f.state.after = async (r, response) => { if (!dropped && r.method === 'PUT' && r.path.endsWith('/before-context')) { dropped = true; throw Error('Controlled response loss') }; return response }
  const saved = await service.save(plan, base.engineBefore!, [])
  assert.equal(saved.context.revision, 1); assert.equal(saved.context.configuration.defaultGreeting, 'Olá {{system.agentName}} em {{system.companyName}}')
  assert.equal(f.writes().length, 1); assert.ok(f.calls.some(r => r.path.includes('/config-operations/')))
  assert.equal(projectBeforeFields(next, saved).greeting, next.greeting)
  assert.doesNotMatch([...storage.values.values()].join(''), /defaultGreeting|Olá|configuration/)
  await assert.rejects(service.save(plan, base.engineBefore!, []), /mudou/)
  assert.equal(f.writes().length, 1)
})

test('incoming form configures only associated incoming number; initial disable/enable and secret projection stay real', async t => {
  const f = await beforeHttpUIFixture(t), storage = memory(), service = createBeforeFieldsService(f.context, f.identity.context, storage, f.agent.id)
  const phoneChannel = f.store.create(f.actor.tenantId, 'channels', { type: 'phone', provider: 'twilio', name: 'QA phone', agentId: f.agent.id, enabled: true })
  const number = f.store.create(f.actor.tenantId, 'phone-numbers', { number: '+551155559999', provider: 'twilio', providerNumberId: 'PNcontrolled', agentId: f.agent.id, channelId: phoneChannel.id, capabilities: ['voice'], name: 'QA' })
  const base = projectBeforeFields({ ...agent(), id: f.agent.id, orgId: f.actor.tenantId }, await service.read())
  const next = { ...base, greeting: 'Olá {{nome}}', webhooks: [{ id: 'in', kind: 'inbound' as const, name: 'Webhook', enabled: true, method: 'POST' as const, url: 'https://context.example.com/context', headers: [{ key: 'authorization', value: 'Bearer synthetic-private-secret' }], body: '{"nome":"{{nome}}"}', defaults: '{"nome":"Visitante"}' }] }
  const plan = preflightBeforeFields(base, next)!
  assert.throws(() => translateInbound(plan, []), /Associe/)
  const chat = randomUUID()
  assert.deepEqual(translateInbound(plan, [], undefined, [chat])!.configuration.audiences, { private: false, voicePrivate: false, webchatChannelIds: [chat], incomingNumberIds: [], incomingDefaultRoute: false })
  const saved = await service.save(plan, base.engineBefore!, [number.id])
  assert.equal(saved.http!.state, 'enabled'); assert.equal(saved.http!.revision, 2)
  assert.deepEqual(saved.http!.configuration!.audiences, { private: false, voicePrivate: false, webchatChannelIds: [], incomingNumberIds: [number.id], incomingDefaultRoute: false })
  assert.equal(f.httpWrites().length, 2); assert.equal(f.httpRequests.length, 0)
  const projected = projectBeforeFields(next, saved)
  assert.equal(projected.webhooks[0].enabled, true); assert.equal(projected.webhooks[0].url, undefined); assert.equal(projected.webhooks[0].headers, undefined)
  assert.doesNotMatch(JSON.stringify(projected.engineBefore), /synthetic-private-secret|Bearer/)
  // The editor commits first: its agent mutation invalidates HTTP authority; the final dedicated save restores it.
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { initialMessage: 'Bom dia {{nome}}' })
  assert.equal((await service.read()).http!.state, 'needs_reauthorization')
  const changedGreeting = { ...projected, greeting: 'Bom dia {{nome}}' }
  const refreshed = await service.save(preflightBeforeFields(projected, changedGreeting)!, projected.engineBefore!, [number.id])
  assert.equal(refreshed.http!.state, 'enabled'); assert.equal(refreshed.http!.beforeRevision, 2)
  const final = projectBeforeFields(changedGreeting, refreshed)
  const disabled = { ...final, webhooks: final.webhooks.map(row => ({ ...row, enabled: false })) }
  const paused = await service.save(preflightBeforeFields(final, disabled)!, final.engineBefore!, [number.id])
  assert.equal(paused.http!.state, 'disabled'); assert.equal(f.httpRequests.length, 0)
})

test('private chat opens with typed test values and restores original opening after response loss', async t => {
  const f = await beforeContextUIFixture(t); await f.enable()
  const storage = memory(), chat = createCascaChatSession(f.context, f.identity.context, storage, f.agent.id, { beforeRevision: 1 })
  await assert.rejects(chat.send('Ainda não'), /Prepare/)
  let lost = false
  f.state.after = async (r, response) => { if (!lost && r.path.endsWith('/conversations/open')) { lost = true; throw Error('Opening response lost') }; return response }
  const history = await chat.prepare()
  assert.equal(history.length, 1); assert.match(history[0].content, /Exemplo sintético: 7 \/ true/)
  assert.ok(chat.conversationId); assert.equal(f.writes().filter(r => r.path.endsWith('/conversations/open')).length, 1)
  assert.deepEqual(await chat.prepare(), []); assert.equal(f.openAI.length, 0)
  assert.doesNotMatch([...storage.values.values()].join(''), /Exemplo|testFacts|greeting|nome/)
  const result = await chat.send('Olá'); assert.equal(result.conversationId, chat.conversationId); assert.equal(f.openAI.length, 1)
})

test('invalid HTTP body/variables and stale session never silently omit input or dispatch', async t => {
  const base = agent(), next = { ...base, webhooks: [{ id: 'in', kind: 'inbound' as const, name: 'Webhook', enabled: true, method: 'POST' as const, url: 'https://context.example.com/context', body: '{"phone":"{{caller.phone}}"}', defaults: '{"nome":"Visitante"}' }] }
  const plan = preflightBeforeFields(base, next)!
  assert.throws(() => translateInbound(plan, [randomUUID()]), /telefone/)
  assert.throws(() => translateInbound({ ...plan, inbound: { ...plan.inbound!, url: 'https://{{nome}}.example.com', body: '{}' } }, [randomUUID()]), /fixos/)
  const f = await beforeContextUIFixture(t), snapshot = await readBeforeSnapshot(f.context, f.agent.id), service = createBeforeFieldsService(f.context, f.identity.context, memory(), f.agent.id)
  f.state.current = false; await assert.rejects(service.save(plan, snapshot, []), /Context changed/); assert.equal(f.writes().length, 0)
})

test('unresolved configuration and opening preserve references and never repeat writes on another attempt', async t => {
  const f = await beforeContextUIFixture(t), storage = memory(), service = createBeforeFieldsService(f.context, f.identity.context, storage, f.agent.id)
  const base = projectBeforeFields({ ...agent(), id: f.agent.id, orgId: f.actor.tenantId }, await service.read()), plan = preflightBeforeFields(base, { ...base, greeting: 'Bom dia' })!
  f.state.before = async r => { if (r.method === 'PUT' && r.path.endsWith('/before-context')) throw Error('Before ingress unknown') }
  await assert.rejects(service.save(plan, base.engineBefore!, []), /não foi confirmado/)
  await assert.rejects(service.save(plan, base.engineBefore!, [])); assert.equal(f.writes().length, 1)
  assert.doesNotMatch([...storage.values.values()].join(''), /Bom dia|defaultGreeting/)
  f.state.before = undefined; await f.enable()
  f.state.before = async r => { if (r.path.endsWith('/conversations/open')) throw Error('Opening ingress unknown') }
  const chat = createCascaChatSession(f.context, f.identity.context, memory(), f.agent.id, { beforeRevision: 1 })
  await assert.rejects(chat.prepare()); await assert.rejects(chat.prepare())
  assert.equal(f.writes().filter(r => r.path.endsWith('/conversations/open')).length, 1); assert.equal(f.openAI.length, 0)
})


async function managedFixture(t: import('node:test').TestContext) {
  const f = await beforeContextUIFixture(t, registerAgentEditorState); await f.enable()
  const http = createBeforeHttpService(f.context, f.agent.id), storage = memory()
  const config: HttpConfiguration = { enabled: false, method: 'POST', audiences: { private: true, voicePrivate: true, webchatChannelIds: [f.channel.id], incomingNumberIds: [], incomingDefaultRoute: false }, mappings: f.sample.variables.map(v => ({ variable: v.name, jsonPointer: '/' + v.name })), conditions: [], schedule: null }
  await http.configure({ key: randomUUID(), agentId: f.agent.id, expectedRevision: 0, expectedBeforeRevision: 1 }, config, { mode: 'replace', url: 'https://context.example.com/existing', headers: { authorization: 'Bearer preserved-private-test' }, bodyTemplate: { name: { $before: 'vars.nome' } } }, f.sample)
  await http.configure({ key: randomUUID(), agentId: f.agent.id, expectedRevision: 1, expectedBeforeRevision: 1 }, { ...config, enabled: true }, { mode: 'keep' }, f.sample)
  const journal = createAgentJournal(storage, f.identity.context, f.agent.id), raw = createAgentCommands(f.context, journal)
  const commands = createManagedAgentCommands(f.context, journal, (base, next) => prepareBeforeFieldsForContext(base, next, f.context, f.identity.context, storage))
  const read = async () => projectBeforeFields(await raw.read(f.agent.id), await readBeforeSnapshot(f.context, f.agent.id))
  return { ...f, http, storage, commands, raw, read, journal }
}

test('every managed editor update rebinds the active HTTP source without changing configuration, secrets or audiences', async t => {
  const f = await managedFixture(t), initial = await f.http.read()
  const availabilityAfterEditor: string[] = []
  f.state.after = async (r, response) => {
    if (r.method === 'PUT' && r.path.endsWith('/editor-state') && response.ok) availabilityAfterEditor.push((await f.http.read()).state)
    return response
  }
  // These use the same central update called by saveAgentFields, http-resource-save and resource-save.
  const cases = [
    { patch: (_base: ReturnType<typeof agent>) => ({ name: 'Nome atualizado' }), rebind: true },
    { patch: (_base: ReturnType<typeof agent>) => ({ companyInfo: 'Texto editorial' }), rebind: false },
    { patch: (base: ReturnType<typeof agent>) => ({ knowledgeBaseEnabled: !base.knowledgeBaseEnabled }), rebind: true },
    { patch: (base: ReturnType<typeof agent>) => ({ rules: { ...base.rules, custom: [{ id: 'regra', title: 'Atendimento', active: true, instruction: 'Responda em português.', condition: '' }] } }), rebind: true },
    { patch: (_base: ReturnType<typeof agent>) => ({}), rebind: false },
  ]
  for (const item of cases) {
    const base = await f.read(), start = f.calls.length
    await f.commands.update(base, item.patch(base))
    const current = await f.http.read(), writes = f.calls.slice(start).filter(r => r.method !== 'GET')
    assert.equal(current.state, 'enabled'); assert.deepEqual(current.configuration, initial.configuration)
    assert.equal(current.beforeRevision, initial.beforeRevision)
    assert.deepEqual(current.configuredHeaderNames, initial.configuredHeaderNames); assert.equal(current.targetOrigin, initial.targetOrigin); assert.equal(current.hasBodyTemplate, initial.hasBodyTemplate)
    assert.equal(writes.length, item.rebind ? 2 : 1); assert.ok(writes[0].path.endsWith('/editor-state'))
    if (item.rebind) { assert.ok(writes[1].path.endsWith('/http-source')); assert.deepEqual(writes[1].body.secrets, { mode: 'keep' }) }
  }
  assert.deepEqual(availabilityAfterEditor, ['needs_reauthorization', 'enabled', 'needs_reauthorization', 'needs_reauthorization', 'enabled'])
  assert.equal((await f.http.read()).revision, initial.revision + 3)
  assert.equal(f.openAI.length, 0)
  assert.doesNotMatch([...f.storage.values.values()].join(''), /preserved-private-test|configuration|Nome atualizado/)
})

test('an already unavailable HTTP source is never reactivated by unrelated edits or greeting changes', async t => {
  const f = await managedFixture(t)
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { name: 'Alteração anterior' })
  let base = await f.read(); assert.equal(base.engineBefore!.http!.state, 'needs_reauthorization')
  const start = f.calls.length
  await f.commands.update(base, { name: 'Nova edição' })
  assert.equal((await f.http.read()).state, 'needs_reauthorization')
  base = await f.read()
  await f.commands.update(base, { greeting: 'Boa tarde {{nome}}' })
  assert.equal((await f.http.read()).state, 'needs_reauthorization')
  assert.equal(f.calls.slice(start).filter(r => r.method === 'PUT' && r.path.endsWith('/http-source')).length, 0)
})

test('stale HTTP availability blocks editor mutation; a failed rebind reports partial completion and retries only its receipt', async t => {
  const f = await managedFixture(t), base = await f.read()
  f.store.update(f.actor.tenantId, 'channels', f.channel.id, { name: 'Canal alterado' })
  const start = f.calls.length
  await assert.rejects(f.commands.update(base, { name: 'Não salvar' }), /configuração inicial mudou/)
  assert.equal(f.calls.slice(start).filter(r => r.method !== 'GET').length, 0)
  const unavailable = await f.http.read()
  await f.http.configure({ key: randomUUID(), agentId: f.agent.id, expectedRevision: unavailable.revision, expectedBeforeRevision: unavailable.beforeRevision! }, unavailable.configuration!, { mode: 'keep' }, base.engineBefore!.context.configuration)
  const fresh = await f.read()
  f.state.before = async r => { if (r.method === 'PUT' && r.path.endsWith('/http-source')) throw Error('Unknown HTTP ingress') }
  await assert.rejects(f.commands.update(fresh, { name: 'Salvamento parcial' }), /assistente foi salvo.*não foi possível confirmar/)
  assert.equal((await f.raw.read(f.agent.id)).name, 'Salvamento parcial')
  const writes = f.calls.filter(r => r.method !== 'GET').length
  await assert.rejects(f.commands.update(fresh, { name: 'Outra edição' }))
  assert.equal(f.calls.filter(r => r.method !== 'GET').length, writes)
})
