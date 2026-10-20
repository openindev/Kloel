import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import { Store } from '../../engine/src/store'
import { registerProviders } from '../../engine/src/providers'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { createAgentTestService } from '../src/services/engine/agent-test'

async function fixture(t: any) {
  const store = new Store(), app = Fastify(), actor = { tenantId: 'agent-test-tenant', userId: 'test-user', role: 'owner' as const }
  const originalFetch = globalThis.fetch, previousEnv = { ...process.env }
  const config = { PROVIDER_TENANT_ID: actor.tenantId, OPENAI_API_KEY: 'isolated-chat-adapter-key', OPENAI_MODEL: 'isolated-text-model' }
  Object.assign(process.env, config)
  seedMember(store, actor)
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(createHash('sha256').update('fixture-cookie').digest('hex'), actor.userId, Date.now() + 3600000, actor.tenantId)
  app.addHook('onRequest', async request => { request.actor = actor; request.cookies = { kloel_session: 'fixture-cookie' } })
  await registerProviders(app, store)
  const agent = store.create(actor.tenantId, 'agents', { name: 'Fixture', status: 'draft', prompt: 'Fixture prompt', tools: [] })
  const transport = { lose: false, modelCalls: 0, requests: [] as Array<{ method: string; path: string; body: any }>, response: async () => Response.json({ id: 'resp:opaque.fixture', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta real do adaptador.' }] }] }) }
  globalThis.fetch = (async (url, init) => { assert.equal(String(url), 'https://api.openai.com/v1/responses'); transport.modelCalls++; return transport.response() }) as typeof fetch
  const request = createEngineClient((async (url, options = {}) => {
    assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'error')
    transport.requests.push({ method: options.method ?? 'GET', path: String(url), body: options.body ? JSON.parse(String(options.body)) : undefined })
    const response = await app.inject({ method: options.method as any ?? 'GET', url: String(url), headers: options.headers as any, ...(options.body ? { payload: String(options.body) } : {}) })
    if (transport.lose && options.method === 'POST') { transport.lose = false; throw Error('fixture: response lost after server committed') }
    return new Response(response.body, { status: response.statusCode })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, request, assertCurrent() {} }
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = originalFetch; for (const key of Object.keys(config)) { if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key] } })
  return { actor, store, app, agent, context, transport, service: createAgentTestService(context, agent.id) }
}

test('chat adapter uses real Fastify contract and reconciles lost success via GET without another paid POST', async t => {
  const f = await fixture(t), key = randomUUID(); f.transport.lose = true
  await assert.rejects(f.service.chat('  Olá  ', key), (error: any) => error.code === 'network_error')
  assert.equal(f.transport.modelCalls, 1); assert.equal(f.transport.requests.length, 1)
  assert.deepEqual(f.transport.requests[0].body, { agentId: f.agent.id, preview: true, message: 'Olá', idempotencyKey: key })
  const recovered = await f.service.chatOperation(key)
  assert.equal(recovered.status, 'succeeded'); assert.ok(recovered.result)
  assert.equal(recovered.result.responseId, 'resp:opaque.fixture'); assert.deepEqual(recovered.result.usage, {})
  assert.equal(f.transport.requests[1].method, 'GET'); assert.equal(f.transport.modelCalls, 1)
  assert.equal(f.store.list(f.actor.tenantId, 'messages').length, 2)
  assert.deepEqual(await f.service.chat('Olá', key), recovered.result) // Explicit replay still uses server idempotency.
  assert.equal(f.transport.modelCalls, 1)
  const next = await f.service.chat('Segunda pergunta', randomUUID(), recovered.result.conversationId)
  assert.equal(next.conversationId, recovered.result.conversationId); assert.equal(f.transport.modelCalls, 2)
  assert.equal(f.store.list(f.actor.tenantId, 'conversations').length, 1)
})

test('unknown chat operation stays locked while repeated GET reconciliation never retries the provider', async t => {
  const f = await fixture(t), key = randomUUID(); f.transport.response = async () => { throw Error('isolated timeout') }
  await assert.rejects(f.service.chat('Pergunta', key), (error: any) => error.code === 'provider_unreachable')
  for (let count = 0; count < 3; count++) assert.deepEqual(await f.service.chatOperation(key), { status: 'unknown', errorCode: 'provider_unreachable', sheetOperations: [] })
  assert.equal(f.transport.requests.filter(row => row.method === 'POST').length, 1); assert.equal(f.transport.modelCalls, 1)
})

test('pending real chat operation can be queried during inference and succeeds without duplicate sends', async t => {
  const f = await fixture(t), key = randomUUID(); let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), wait = new Promise<void>(resolve => { release = resolve })
  f.transport.response = async () => { entered(); await wait; return Response.json({ id: 'resp_pending', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Concluído.' }] }], usage: { total_tokens: 5 } }) }
  const sending = f.service.chat('Pergunta pendente', key); await started
  try { assert.deepEqual(await f.service.chatOperation(key), { status: 'pending', sheetOperations: [] }); assert.equal(f.transport.modelCalls, 1) } finally { release() }
  const response = await sending; assert.deepEqual((await f.service.chatOperation(key, response.conversationId)).result, response)
})

const result = { conversationId: 'conversation', responseId: 'response:opaque', text: 'Resposta', usage: {} }
function mock(raw: unknown, check: () => void = () => {}) {
  let requests = 0
  const service = createAgentTestService({ tenantId: 'tenant', generation: 1, assertCurrent: check, request: (async () => { requests++; return raw }) as EngineRequest }, 'agent')
  return { service, requests: () => requests }
}
test('chat parser rejects malformed results and wrong conversation binding on both POST and reconciliation', async () => {
  for (const malformed of [{ ...result, responseId: '' }, { ...result, responseId: 'x'.repeat(201) }, { ...result, usage: [] }, { ...result, text: '' }, { ...result, conversationId: '../other' }]) {
    const f = mock(malformed); await assert.rejects(f.service.chat('Teste', randomUUID()), EngineError); assert.equal(f.requests(), 1)
  }
  await assert.rejects(mock(result).service.chat('Teste', randomUUID(), 'other'), (error: any) => error.code === 'invalid_response')
  await assert.rejects(mock({ status: 'succeeded', result }).service.chatOperation(randomUUID(), 'other'), (error: any) => error.code === 'invalid_response')
  await assert.rejects(mock({ status: 'succeeded' }).service.chatOperation(randomUUID()), (error: any) => error.code === 'invalid_response')
  assert.deepEqual(await mock({ status: 'unknown', result: { text: 'must not be published' } }).service.chatOperation(randomUUID()), { status: 'unknown', sheetOperations: [] })
})
test('chat adapter rejects late results after the captured session fence changes', async () => {
  const stale = () => { throw new EngineError(0, 'superseded', 'Fixture session changed') }
  await assert.rejects(mock(result, stale).service.chat('Teste', randomUUID()), (error: any) => error.code === 'superseded')
  await assert.rejects(mock({ status: 'succeeded', result }, stale).service.chatOperation(randomUUID()), (error: any) => error.code === 'superseded')
})
test('browser operation keys deliberately accept URL-safe UUIDs and reject unsupported punctuation without I/O', async () => {
  const f = mock(result)
  for (const key of ['operation.with.dot', 'operation:with:colon', '../operation', 'short']) {
    await assert.rejects(f.service.chat('Teste', key), EngineError); await assert.rejects(f.service.chatOperation(key), EngineError)
  }
  assert.equal(f.requests(), 0)
})
test('voice service accepts first-start DTO with ISO lease and not_requested without requiring SDP on recovery', async () => {
  const key = randomUUID(), operation = { status: 'succeeded', operationKey: key, callId: 'rtc_call', conversationId: 'conversation', cancelRequested: false, hangupStatus: 'not_requested', leaseExpiresAt: '2026-10-18T16:00:00.000Z', requiresRecovery: false }
  const first = await mock({ ...operation, sdp: 'v=0\r\nfixture-answer', toolsEnabled: [] }).service.startVoice('v=0\r\nfixture-offer', key)
  assert.equal(first.hangupStatus, 'not_requested'); assert.equal(first.leaseExpiresAt, operation.leaseExpiresAt); assert.ok('sdp' in first)
  const replay = await mock({ ...operation, requiresRecovery: true }).service.startVoice('v=0\r\nfixture-offer', key)
  assert.equal(replay.requiresRecovery, true); assert.equal('sdp' in replay, false)
  await assert.rejects(mock({ ...operation, leaseExpiresAt: Date.now() }).service.voiceOperation(key), EngineError)
  await assert.rejects(mock({ ...operation, operationKey: 'wrong-key' }).service.voiceOperation(key), EngineError)
  await assert.rejects(mock({ ...operation, status: 'pending', sdp: 'v=0\r\nfixture-answer', toolsEnabled: [] }).service.startVoice('v=0\r\nfixture-offer', key), EngineError)
})
