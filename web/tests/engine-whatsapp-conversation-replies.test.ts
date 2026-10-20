import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../src/services/engine/http'
import { createWhatsAppConversationReplyService, createWhatsAppReplyJournal } from '../src/services/engine/whatsapp-conversation-replies'
const version = 'a'.repeat(64), reference = { key: 'original-key-123', expectedVersion: version }
const contextDto = { conversationId: 'conversation-a', tenantId: 'tenant-a', version, canReply: true, reasonCode: null, channelId: 'channel-a', sourceMessageId: 'message-a', windowExpiresAt: '2026-10-20T00:00:00.000Z', destination: { display: '••••1234', provenance: 'signed_inbound' } }
const operationDto = { key: reference.key, kind: 'conversation_reply', tenantId: 'tenant-a', conversationId: 'conversation-a', status: 'succeeded', externalEffect: 'accepted', localLink: 'linked', messageId: 'message-b', deliveryStatus: 'accepted', requiresReconciliation: false, automaticRetry: false, errorCode: null, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z' }
function fixture() {
  let current = true, result: unknown = contextDto
  const calls: { path: string; options: any }[] = []
  const context = { tenantId: 'tenant-a', generation: 1, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', '') }, async request<T>(path: string, options?: any): Promise<T> { calls.push({ path, options }); return result as T } }
  return { service: createWhatsAppConversationReplyService(context, 'conversation-a'), calls, set(value: unknown) { result = value }, revoke() { current = false } }
}
test('context and POST bind chosen tenant/conversation; destination never comes from the browser', async () => {
  const f = fixture(); assert.deepEqual(await f.service.context(), contextDto)
  f.set({ operation: operationDto, replayed: false }); const response = await f.service.send(reference, '  Synthetic reply  ')
  assert.equal(response.deliveryStatus, 'accepted'); assert.equal(response.automaticRetry, false)
  assert.deepEqual(f.calls[1], { path: '/whatsapp/conversations/conversation-a/replies', options: { method: 'POST', body: { expectedTenantId: 'tenant-a', expectedVersion: version, idempotencyKey: reference.key, text: 'Synthetic reply', confirm: true } } })
})
test('context rejects a different conversation, plain recipient, or reply without source proof', async () => {
  const f = fixture()
  for (const patch of [{ conversationId: 'conversation-b' }, { tenantId: 'tenant-b' }, { destination: { display: '+5511999991234', provenance: 'signed_inbound' } }, { sourceMessageId: null }, { destination: { display: '••••1234', provenance: 'send_contact' } }]) {
    f.set({ ...contextDto, ...patch }); await assert.rejects(f.service.context(), /confirmar/)
  }
})
test('operation parser rejects cross-key/tenant/conversation and impossible acceptance or delivery combinations', async () => {
  const f = fixture()
  for (const patch of [{ tenantId: 'tenant-b' }, { conversationId: 'conversation-b' }, { key: 'another-key-123' }, { automaticRetry: true }, { status: 'failed' }, { externalEffect: 'unconfirmed' }, { localLink: 'not_linked' }, { messageId: null }, { deliveryStatus: null }, { graphCode: 'private-url' }, { status: 'pending', externalEffect: 'not_accepted', localLink: 'not_linked', messageId: null, deliveryStatus: null }, { status: 'unknown', externalEffect: 'unconfirmed', localLink: 'not_linked', messageId: null, deliveryStatus: null }, { status: 'failed', externalEffect: 'not_accepted', localLink: 'not_linked', messageId: null, deliveryStatus: null, requiresReconciliation: true }]) {
    f.set({ ...operationDto, ...patch }); await assert.rejects(f.service.operation(reference), /confirmar/)
  }
})
test('accepted-unlinked receipt is retained as requiring reconciliation and recovery is GET only', async () => {
  const f = fixture(); f.set({ ...operationDto, localLink: 'not_linked', messageId: null, requiresReconciliation: true })
  const receipt = await f.service.operation(reference); assert.equal(receipt.externalEffect, 'accepted'); assert.equal(receipt.requiresReconciliation, true)
  assert.deepEqual(f.calls, [{ path: '/whatsapp/conversations/conversation-a/reply-operations/original-key-123', options: undefined }])
})
test('transport ambiguity is never retried and revoked context never dispatches', async () => {
  let calls = 0
  const context = { tenantId: 'tenant-a', generation: 1, assertCurrent() {}, async request<T>(): Promise<T> { calls++; throw new EngineError(0, 'network_error', 'lost') } }
  const service = createWhatsAppConversationReplyService(context, 'conversation-a')
  await assert.rejects(service.send(reference, 'Synthetic reply'), /lost/); assert.equal(calls, 1)
  const f = fixture(); f.revoke(); await assert.rejects(f.service.send(reference, 'Synthetic reply')); assert.equal(f.calls.length, 0)
})
function storageFixture() {
  const values = new Map<string, string>(), scope = { userId: 'user-a', tenantId: 'tenant-a', membershipId: 'member-a', authorityVersion: 'b'.repeat(64), conversationId: 'conversation-a' }
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  return { values, storage, scope, journal: createWhatsAppReplyJournal(() => storage, scope) }
}
test('journal persists only a validated opaque pointer, with readback and compare-and-swap', () => {
  const f = storageFixture(); assert.equal(f.journal.read(), undefined)
  f.journal.remember(reference); assert.deepEqual(f.journal.read(), reference)
  assert.deepEqual(JSON.parse([...f.values.values()][0]), { version: 1, ...reference })
  const other = { key: 'another-key-123', expectedVersion: 'c'.repeat(64) }
  assert.throws(() => f.journal.remember(other)); assert.throws(() => f.journal.clearResolved(other))
  assert.deepEqual(f.journal.read(), reference); f.journal.clearResolved(reference); f.journal.remember(other)
  assert.throws(() => f.journal.clearResolved(reference)); assert.deepEqual(f.journal.read(), other)
})
test('journal rejects corrupted/extra private data without silently removing it', () => {
  const f = storageFixture(); f.journal.remember(reference); const key = [...f.values.keys()][0]
  for (const raw of ['invalid', JSON.stringify({ version: 1, ...reference, text: 'private body' }), JSON.stringify({ version: 1, ...reference, to: '+5511999991234' })]) {
    f.values.set(key, raw); assert.throws(() => f.journal.read()); assert.throws(() => f.journal.remember(reference)); assert.equal(f.values.get(key), raw)
  }
})
test('different membership, authority, tenant and conversation do not adopt an existing pointer', () => {
  const f = storageFixture(); f.journal.remember(reference)
  for (const patch of [{ membershipId: 'member-b' }, { authorityVersion: 'c'.repeat(64) }, { tenantId: 'tenant-b' }, { conversationId: 'conversation-b' }]) assert.equal(createWhatsAppReplyJournal(() => f.storage, { ...f.scope, ...patch }).read(), undefined)
  assert.deepEqual(f.journal.read(), reference)
})
test('unavailable or silently dropping storage fails before a send can be attempted', () => {
  const f = storageFixture(), dropped = createWhatsAppReplyJournal(() => ({ ...f.storage, setItem() {} }), f.scope)
  assert.throws(() => dropped.remember(reference), error => error instanceof EngineError && error.code === 'reply_storage_unavailable')
  const unavailable = createWhatsAppReplyJournal(() => { throw Error('denied') }, f.scope)
  assert.throws(() => unavailable.read()); assert.throws(() => unavailable.remember(reference)); assert.equal(f.values.size, 0)
})
