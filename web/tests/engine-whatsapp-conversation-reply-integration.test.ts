import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHmac } from 'node:crypto'
import { whatsappConversationReplyFixture } from '../../engine/tests/fixtures/whatsapp-conversation-reply'
import { createEngineClient, EngineError, type RequestOptions } from '../src/services/engine/http'
import { createWhatsAppConversationReplyService } from '../src/services/engine/whatsapp-conversation-replies'

async function fixture(t: any) {
  const f = await whatsappConversationReplyFixture(t), identity = (await f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + f.cookies.owner } })).json()
  const requests: { path: string; method: string; body?: any }[] = [], flags = { losePost: false }
  const transport: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET', headers = Object.fromEntries(new Headers(init.headers))
    assert.equal(init.credentials, 'include'); requests.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const result = await f.app.inject({ method: method as any, url: path, headers: { ...headers, cookie: 'kloel_session=' + f.cookies.owner }, ...(init.body ? { payload: String(init.body) } : {}) })
    if (method === 'POST' && flags.losePost) { flags.losePost = false; throw Error('Controlled response loss after server completion') }
    return new Response(result.body, { status: result.statusCode, headers: { 'Content-Type': 'application/json' } })
  }
  const client = createEngineClient(transport), bound = { tenantId: f.tenant, generation: 1, assertCurrent() {}, request: <T>(path: string, options?: RequestOptions) => client<T>(path, { ...options, expectedContext: identity.context }) }
  return { ...f, flags, requests, service: createWhatsAppConversationReplyService(bound, f.conversationId) }
}
test('browser service and actual local backend agree on masked context, exact destination, receipt and signed delivery', async t => {
  const f = await fixture(t), context = await f.service.context(), reference = { key: randomUUID(), expectedVersion: context.version }
  assert.equal(context.canReply, true); assert.ok(!JSON.stringify(context).includes(f.sender))
  const receipt = await f.service.send(reference, 'Synthetic integration reply')
  assert.equal(receipt.status, 'succeeded'); assert.equal(receipt.localLink, 'linked'); assert.equal(receipt.deliveryStatus, 'accepted')
  assert.equal(receipt.tenantId, f.tenant); assert.equal(receipt.conversationId, f.conversationId)
  const message = f.store.get(f.tenant, 'messages', receipt.messageId!)!; assert.equal(message.authorType, 'human'); assert.equal(message.conversationId, f.conversationId)
  assert.equal(f.calls.length, 1); assert.equal(JSON.parse(String(f.calls[0].init.body)).to, f.sender)
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: f.env.META_PHONE_NUMBER_ID }, statuses: [{ id: message.providerMessageId, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] })
  const response = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', f.env.META_APP_SECRET).update(raw).digest('hex') } })
  assert.equal(response.statusCode, 200, response.body)
  const before = f.snapshot(); assert.equal((await f.service.operation(reference)).deliveryStatus, 'delivered'); assert.deepEqual(f.snapshot(), before)
  await f.change(await f.read(f.channel.id), 'disable')
  assert.equal((await f.service.operation(reference)).deliveryStatus, 'delivered'); assert.equal(f.calls.length, 1)
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1)
})
test('lost HTTP reply is recovered by original GET without a second Meta request', async t => {
  const f = await fixture(t), context = await f.service.context(), reference = { key: randomUUID(), expectedVersion: context.version }
  f.flags.losePost = true
  await assert.rejects(f.service.send(reference, 'Synthetic lost response'), error => error instanceof EngineError && error.code === 'network_error')
  const before = f.snapshot(), recovered = await f.service.operation(reference)
  assert.equal(recovered.externalEffect, 'accepted'); assert.equal(recovered.localLink, 'linked'); assert.deepEqual(f.snapshot(), before)
  assert.equal(f.calls.length, 1); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1)
})
test('actual backend refuses stale conversation intent with unique pre-admission code and no send', async t => {
  const f = await fixture(t), context = await f.service.context(), reference = { key: randomUUID(), expectedVersion: context.version }
  await f.control('open'); await f.control('pending')
  await assert.rejects(f.service.send(reference, 'Synthetic stale reply'), error => error instanceof EngineError && error.status === 409 && error.code === 'whatsapp_reply_not_admitted')
  await assert.rejects(f.service.operation(reference), error => error instanceof EngineError && error.status === 404)
  assert.equal(f.calls.length, 0)
})
