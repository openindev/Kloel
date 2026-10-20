import test from 'node:test'
import assert from 'node:assert/strict'
import { whatsappWorkerOnceHttpFixture } from '../../engine/tests/fixtures/whatsapp-worker-once-http'
import { createEngineClient, EngineError, type RequestOptions } from '../src/services/engine/http'
import { createWhatsAppJobOnceService } from '../src/services/engine/whatsapp-job-once'

async function fixture(t: any) {
  const f = await whatsappWorkerOnceHttpFixture(t), identity = (await f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + f.cookies.owner } })).json()
  const requests: { path: string; method: string }[] = [], flags = { losePost: false }
  const transport: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET', headers = Object.fromEntries(new Headers(init.headers))
    assert.equal(init.credentials, 'include'); requests.push({ path, method })
    for (const key of ['user', 'tenant', 'membership', 'authority']) assert.ok(headers['x-kloel-expected-' + key])
    const result = await f.app.inject({ method: method as any, url: path, headers: { ...headers, cookie: 'kloel_session=' + f.cookies.owner }, ...(init.body ? { payload: String(init.body) } : {}) })
    if (method === 'POST' && flags.losePost) { flags.losePost = false; throw Error('Synthetic HTTP response loss after execution') }
    return new Response(result.statusCode === 204 ? null : result.body, { status: result.statusCode, headers: { 'Content-Type': 'application/json' } })
  }
  const client = createEngineClient(transport), bound = { tenantId: f.tenant, generation: 1, assertCurrent() {}, request: <T>(path: string, options?: RequestOptions) => client<T>(path, { ...options, expectedContext: identity.context }) }
  return { ...f, flags, requests, engineRequest: bound.request, service: createWhatsAppJobOnceService(bound), ref: { jobId: f.job.id, expectedVersion: f.initialVersion } }
}
test('UI service and real local routes execute only the selected original inbound and recover without current provider configuration', async t => {
  const f = await fixture(t), receipt = await f.service.run(f.ref)
  assert.equal(receipt.status, 'sent'); assert.equal(receipt.externalEffect, 'accepted'); assert.equal(receipt.localLink, 'linked')
  const message = f.store.get(f.tenant, 'messages', receipt.messageId!)!
  assert.equal(message.conversationId, f.conversationId); assert.equal(message.autoReplyJobId, f.job.id)
  assert.equal(f.calls.length, 2); assert.equal(JSON.parse(String(f.calls[1].init.body)).to, f.sender)
  assert.equal(process.env.WHATSAPP_AUTOREPLY_ENABLED, 'false')
  delete process.env.META_ACCESS_TOKEN; delete process.env.OPENAI_API_KEY
  const before = f.snapshot(), recovered = await f.service.operation(f.ref)
  assert.equal(recovered.externalEffect, 'accepted'); assert.equal(recovered.replayed, true); assert.equal(recovered.messageId, receipt.messageId)
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 2); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1)
})
test('lost HTTP completion is recovered through the original GET with one generation and one Meta send', async t => {
  const f = await fixture(t); f.flags.losePost = true
  await assert.rejects(f.service.run(f.ref), error => error instanceof EngineError && error.code === 'network_error')
  const before = f.snapshot(), recovered = await f.service.operation(f.ref)
  assert.equal(recovered.status, 'sent'); assert.equal(recovered.localLink, 'linked'); assert.deepEqual(f.snapshot(), before)
  assert.equal(f.calls.length, 2); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1)
})
test('OpenAI rejection leaves a terminal readonly receipt and never calls Meta', async t => {
  const f = await fixture(t); f.hooks.provider = url => { assert.equal(url, 'https://api.openai.com/v1/responses'); return new Response('synthetic rejection', { status: 429 }) }
  await assert.rejects(f.service.run(f.ref), error => error instanceof EngineError)
  const before = f.snapshot(), recovered = await f.service.operation(f.ref)
  assert.equal(recovered.status, 'failed'); assert.equal(recovered.externalEffect, 'not_dispatched'); assert.equal(recovered.automaticRetry, false)
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1)
})

test('deleted conversation preserves accepted historical receipt without a false local link', async t => {
  const f = await fixture(t); await f.service.run(f.ref)
  await f.engineRequest(`/conversations/${f.conversationId}`, { method: 'DELETE' })
  const before = f.snapshot(), receipt = await f.service.operation(f.ref)
  assert.equal(receipt.status, 'sent'); assert.equal(receipt.externalEffect, 'accepted')
  assert.equal(receipt.localLink, 'not_linked'); assert.equal(receipt.messageId, null); assert.equal(receipt.requiresReconciliation, true)
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 2)
})
