import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { whatsappChannelUIFixture } from './engine-whatsapp-channel-fixture'
import { createConversationService } from '../src/services/engine/conversations'
import type { EngineRequest } from '../src/services/engine/http'

test('Inbox preserves signed Meta delivery/read/failure updates without changing provider acceptance or sending', async t => {
  const f = await whatsappChannelUIFixture(t), service = createConversationService(f.bound)
  const conversation = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'open' })
  const message = f.store.create(f.tenant, 'messages', { conversationId: conversation.id, role: 'assistant', source: 'meta', content: 'Synthetic outbound', deliveryStatus: 'sent', providerMessageId: 'wamid.synthetic.delivery', phoneNumberId: f.env.META_PHONE_NUMBER_ID })
  const failedMessage = f.store.create(f.tenant, 'messages', { conversationId: conversation.id, role: 'assistant', source: 'meta', content: 'Synthetic failed outbound', deliveryStatus: 'sent', providerMessageId: 'wamid.synthetic.failure', phoneNumberId: f.env.META_PHONE_NUMBER_ID })
  assert.equal((await service.messages(conversation.id)).items.find(item => item.id === message.id)?.deliveryStatus, 'sent')
  let timestamp = 1800000000
  async function webhook(providerMessageId: string, status: string) {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: f.env.META_PHONE_NUMBER_ID }, statuses: [{ id: providerMessageId, status, timestamp: String(timestamp++) }] } }] }] })
    const response = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', f.env.META_APP_SECRET).update(body).digest('hex') }, payload: body })
    assert.equal(response.statusCode, 200, response.body)
  }
  for (const status of ['delivered', 'read']) {
    await webhook(String(message.providerMessageId), status)
    assert.equal(f.store.get(f.tenant, 'messages', message.id)?.providerStatus, status)
    const projected = (await service.messages(conversation.id)).items.find(item => item.id === message.id)!
    assert.equal(projected.providerStatus, status)
    assert.equal(projected.deliveryStatus, 'sent')
    assert.equal('providerMessageId' in projected, false)
    assert.equal('providerStatusAt' in projected, false)
    assert.equal('phoneNumberId' in projected, false)
  }
  await webhook(String(message.providerMessageId), 'failed')
  const read = (await service.messages(conversation.id)).items.find(item => item.id === message.id)!
  assert.equal(read.providerStatus, 'read', 'contradictory late failure cannot downgrade confirmed read')
  assert.equal(read.deliveryStatus, 'sent')
  assert.equal(f.store.get(f.tenant, 'messages', message.id)?.providerStatus, 'read')
  await webhook(String(failedMessage.providerMessageId), 'failed')
  const failed = (await service.messages(conversation.id)).items.find(item => item.id === failedMessage.id)!
  assert.equal(failed.providerStatus, 'failed')
  assert.equal(failed.deliveryStatus, 'failed')
  assert.equal(f.calls.length, 0)
  assert.ok(f.requests.every(request => request.method === 'GET'))
})

test('Inbox provider status projection is bounded and excludes inbound, notes and other sources', async t => {
  const f = await whatsappChannelUIFixture(t), service = createConversationService(f.bound)
  const conversation = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'open' })
  const cases = [
    {}, { providerStatus: 'sent' }, { providerStatus: 'accepted' }, { providerStatus: 'unknown' },
    { providerStatus: 'https://private.invalid/?secret=hidden' }, { providerStatus: { secret: 'hidden' } },
    { providerStatus: null }, { providerStatus: 1 }, { providerStatus: 'READ' },
    { providerStatus: 'read', source: 'resend' }, { providerStatus: 'read', source: 'openai' },
    { providerStatus: 'read', role: 'user' }, { providerStatus: 'read', kind: 'internal_note' },
  ]
  for (const [index, extra] of cases.entries()) f.store.create(f.tenant, 'messages', { conversationId: conversation.id, role: 'assistant', source: 'meta', content: 'Message ' + index, deliveryStatus: 'sent', ...extra })
  const messages = await service.messages(conversation.id)
  assert.equal(messages.items.length, cases.length)
  for (const message of messages.items) {
    assert.equal(message.providerStatus, undefined)
    assert.equal(message.deliveryStatus, 'sent')
    assert.equal(JSON.stringify(message).includes('hidden'), false)
  }
  assert.equal(f.calls.length, 0)
})

test('valid delivery status never weakens tenant, conversation or current-session validation', async t => {
  const f = await whatsappChannelUIFixture(t)
  const message = { id: 'message', tenantId: f.tenant, conversationId: 'conversation', role: 'assistant', source: 'meta', content: 'Synthetic', createdAt: '2026-10-19T00:00:00Z', deliveryStatus: 'sent', providerStatus: 'read' }
  for (const extra of [{ tenantId: 'other' }, { conversationId: 'other' }]) {
    const service = createConversationService({ ...f.bound, request: (async () => ({ items: [{ ...message, ...extra }], total: 1, totalPages: 1, page: 1, limit: 50 })) as EngineRequest })
    await assert.rejects(service.messages('conversation'), (error: any) => error.code === 'invalid_data')
  }
  f.state.current = false
  const stale = createConversationService({ ...f.bound, request: (async () => ({ items: [message], total: 1, totalPages: 1, page: 1, limit: 50 })) as EngineRequest })
  await assert.rejects(stale.messages('conversation'), (error: any) => error.code === 'superseded')
  assert.equal(f.calls.length, 0)
})
