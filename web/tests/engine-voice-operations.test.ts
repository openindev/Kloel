import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerProviders } from '../../engine/src/providers'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { createVoiceOperationsService, type RecoveredVoiceOperation } from '../src/services/engine/voice-operations'

const stamp = '2026-10-18T12:00:00.000Z'
const entry: RecoveredVoiceOperation = { operationKey: 'voice:operation.0001', agentId: 'voice-agent', conversationId: 'voice-conversation', callId: 'rtc_fixture', status: 'succeeded', cancelRequested: false, hangupStatus: 'not_requested', leaseExpiresAt: stamp, heartbeatIntervalMs: 15000, createdAt: stamp, updatedAt: stamp }
async function fixture(t: any) {
  const store = new Store(), app = Fastify(), actor = { tenantId: 'recovery-tenant', userId: 'recovery-user', role: 'owner' as const }, token = 'synthetic-recovery-cookie'
  const oldFetch = globalThis.fetch, oldEnv = { ...process.env }, config = { PROVIDER_TENANT_ID: actor.tenantId, OPENAI_API_KEY: 'synthetic-recovery-key', OPENAI_MODEL: 'mock-text', OPENAI_REALTIME_MODEL: 'mock-voice' }
  Object.assign(process.env, config); seedMember(store, actor)
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), actor.userId, actor.tenantId, Date.now() + 3600000)
  const agent = store.create(actor.tenantId, 'agents', { name: 'Synthetic', status: 'active', prompt: 'Private synthetic prompt', voice: 'marin', tools: [], settings: { maxResponseTokens: 256 } })
  let starts = 0, stops = 0, loseCancel = false
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/hangup')) { stops++; return new Response(null, { status: 200 }) }
    assert.equal(String(input), 'https://api.openai.com/v1/realtime/calls'); starts++
    return new Response('v=0\r\na=synthetic-answer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_recovery_' + starts } })
  }
  class Socket extends EventEmitter { readyState = 0; constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open') }) } send() {} close() { if (this.readyState !== 3) { this.readyState = 3; this.emit('close') } } terminate() { this.close() } }
  await app.register(cookie); await registerAuth(app, store); await registerProviders(app, store, { socketFactory: () => new Socket() as any }); await app.ready()
  const headers = { cookie: 'kloel_session=' + token }, identity = (await app.inject({ url: '/api/v1/auth/me', headers })).json()
  const requests: Array<{ method: string; url: string }> = []
  const transport = createEngineClient((async (url, options = {}) => {
    requests.push({ method: options.method ?? 'GET', url: String(url) })
    const response = await app.inject({ url: String(url), method: options.method as any ?? 'GET', headers: { ...options.headers as any, ...headers }, ...(options.body ? { payload: String(options.body) } : {}) })
    if (loseCancel && String(url).endsWith('/cancel')) { loseCancel = false; throw new Error('Synthetic lost cancellation response') }
    return new Response(response.body, { status: response.statusCode })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent() {}, request: ((path, options) => transport(path, { ...options, expectedContext: identity.context })) as EngineRequest }
  const start = async (key: string) => { const response = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers, payload: { agentId: agent.id, sdp: 'v=0\r\na=synthetic-offer', idempotencyKey: key } }); assert.equal(response.statusCode, 200, response.body); return response.json() }
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = oldFetch; for (const key of Object.keys(config)) { if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key] } })
  return { store, actor, agent, start, context, requests, counts: () => ({ starts, stops }), loseCancel: () => { loseCancel = true } }
}

test('voice recovery uses real authenticated paginated routes without starting, heartbeating, or stopping on GET', async t => {
  const f = await fixture(t), first = await f.start('voice:operation.0001'), second = await f.start('voice-operation-0002')
  const service = createVoiceOperationsService(f.context, { agentId: f.agent.id }), page = await service.list({ limit: 1 })
  assert.equal(page.items.length, 1); assert.equal(page.items[0].operationKey, second.operationKey); assert.ok(page.nextCursor)
  const next = await service.list({ limit: 1, cursor: page.nextCursor! }); assert.equal(next.items[0].operationKey, first.operationKey); assert.equal(next.nextCursor, null)
  const before = next.items[0].leaseExpiresAt, read = await service.get(next.items[0]); assert.equal(read.leaseExpiresAt, before)
  assert.equal((await createVoiceOperationsService(f.context, { conversationId: first.conversationId }).list()).items[0].operationKey, first.operationKey)
  assert.deepEqual(f.counts(), { starts: 2, stops: 0 }); assert.ok(f.requests.every(item => item.method === 'GET'))
  assert.ok(f.requests.some(item => item.url.includes('voice%3Aoperation.0001')))
  assert.equal('sdp' in read, false); assert.equal('binding' in read, false)
})

test('lost cancel response is recovered after service recreation with GET and one real mocked provider stop', async t => {
  const f = await fixture(t); await f.start('voice:operation.0001')
  const service = createVoiceOperationsService(f.context, { agentId: f.agent.id }), operation = (await service.list()).items[0]
  f.loseCancel(); await assert.rejects(service.cancel(operation), (error: any) => error.code === 'network_error')
  assert.deepEqual(f.counts(), { starts: 1, stops: 1 })
  const recovered = createVoiceOperationsService(f.context, { agentId: f.agent.id }), row = (await recovered.list()).items[0]
  assert.equal(row.hangupStatus, 'accepted'); assert.equal(row.cancelRequested, true)
  assert.equal((await recovered.get(row)).hangupStatus, 'accepted')
  await assert.rejects(recovered.cancel(row), (error: any) => error.code === 'voice_cancel_not_needed')
  assert.equal(f.requests.filter(item => item.method === 'POST').length, 1); assert.deepEqual(f.counts(), { starts: 1, stops: 1 })
})

test('config change hides recovery entries and denied individual reads never trigger a provider effect', async t => {
  const f = await fixture(t); await f.start('voice-operation-0001')
  const service = createVoiceOperationsService(f.context, { agentId: f.agent.id }), row = (await service.list()).items[0]
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { prompt: 'Changed synthetic configuration' })
  assert.deepEqual((await service.list()).items, [])
  await assert.rejects(service.get(row), (error: any) => error.status === 403)
  assert.deepEqual(f.counts(), { starts: 1, stops: 0 })
})

function mock(raw: unknown, fence = () => {}) {
  let calls = 0
  const service = createVoiceOperationsService({ tenantId: 'tenant', generation: 1, assertCurrent: fence, request: (async () => { calls++; return raw }) as EngineRequest }, { agentId: entry.agentId, conversationId: entry.conversationId })
  return { service, calls: () => calls }
}
test('recovery parser binds list and individual responses to filters and original call, projecting no secrets', async () => {
  const page = { items: [entry], limit: 20, nextCursor: null }
  for (const bad of [{ ...entry, agentId: 'foreign' }, { ...entry, conversationId: 'foreign' }, { ...entry, operationKey: '../unsafe' }, { ...entry, createdAt: 'not-a-date' }, { ...entry, hangupStatus: 'ended' }, { ...entry, status: ['succeeded'] }, { ...entry, hangupStatus: ['accepted'] }]) {
    await assert.rejects(mock({ ...page, items: [bad] }).service.list(), EngineError)
  }
  for (const bad of [{ ...entry, callId: 'foreign' }, { ...entry, operationKey: 'another-operation' }, { ...entry, createdAt: '2026-10-19T12:00:00.000Z' }]) await assert.rejects(mock(bad).service.get(entry), EngineError)
  const safe = await mock({ ...entry, sdp: 'private', encryptedToken: 'private', binding: { secret: 'private' } }).service.get(entry)
  assert.deepEqual(safe, entry)
  await assert.rejects(mock({ ...page, items: [entry, entry] }).service.list(), EngineError)
  await assert.rejects(mock({ ...page, nextCursor: 'same-cursor' }).service.list({ cursor: 'same-cursor' }), EngineError)
  await assert.rejects(mock(entry).service.get({ ...entry, cancelRequested: true, hangupStatus: 'accepted' }), EngineError)
  assert.deepEqual(await mock({ ...page, items: [], nextCursor: 'opaque-cursor' }).service.list(), { items: [], nextCursor: 'opaque-cursor', limit: 20 })
})
test('recovery rejects stale results and malformed inputs without retry or alternate route authority', async () => {
  const f = mock(entry)
  for (const key of ['../unsafe', 'voice/unsafe', 'voice%3Aunsafe']) await assert.rejects(f.service.get({ ...entry, operationKey: key }), EngineError)
  await assert.rejects(f.service.list({ limit: 51 }), EngineError); await assert.rejects(f.service.list({ cursor: 'bad/cursor' }), EngineError); assert.equal(f.calls(), 0)
  const stale = mock(entry, () => { throw new EngineError(0, 'superseded', 'Synthetic session changed') })
  await assert.rejects(stale.service.get(entry), (error: any) => error.code === 'superseded'); assert.equal(stale.calls(), 1)
  await assert.rejects(mock(entry).service.cancel({ ...entry, status: 'failed', callId: undefined }), (error: any) => error.code === 'voice_cancel_not_needed')
})
