import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { conversationReplyFixture } from './fixtures/conversation-replies-engine'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createConversationReplyService, createReplyOperationStorage, ReplyWriteUncertain, type ReplyReference } from '../src/services/engine/conversation-replies'

test('closing local tracking archives only opaque metadata before clearing; storage failure preserves the active reference', () => {
  const scope = { userId: randomUUID(), tenantId: randomUUID(), conversationId: randomUUID() }, values = new Map<string, string>()
  let failHistory = true, failClear = false
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (key.endsWith(':history') && failHistory) throw Error('Quota'); values.set(key, value) }, removeItem: (key: string) => { if (failClear) throw Error('Storage blocked'); values.delete(key) } }
  const journal = createReplyOperationStorage(storage, scope), reference: ReplyReference = { kind: 'reply', conversationId: scope.conversationId, key: randomUUID(), expectedVersion: 'a'.repeat(64) }
  journal.write(reference)
  assert.throws(() => journal.archive(reference), (e: any) => e.code === 'reply_storage_unavailable'); assert.deepEqual(journal.read(), reference)
  failHistory = false; failClear = true
  assert.throws(() => journal.archive({ ...reference, content: 'SECRET', token: 'SECRET' } as any)); assert.deepEqual(journal.read(), reference); assert.deepEqual(journal.history(), [reference])
  failClear = false; assert.deepEqual(journal.archive(reference), [reference]); assert.equal(journal.read(), undefined); assert.equal([...values.values()].join('').includes('SECRET'), false)
  assert.deepEqual(createReplyOperationStorage(storage, { ...scope, userId: randomUUID() }).history(), [])
  journal.write({ ...reference, key: randomUUID() }); assert.throws(() => journal.archive(reference)); assert.ok(journal.read())
})

test('human webchat takes control, publishes a real visitor-visible response and releases with truthful receipts', async t => {
  const f = await conversationReplyFixture(t), initial = await f.replies.context(f.conversation.id)
  assert.equal(initial.mode, 'ai'); assert.equal(initial.capabilities.reply, false)
  const ref = (kind: ReplyReference['kind'], expectedVersion: string): ReplyReference => ({ kind, expectedVersion, conversationId: f.conversation.id, key: randomUUID() })
  const takeover = await f.replies.command(ref('takeover', initial.version)); assert.equal(takeover.result?.mode, 'human')
  const current = await f.replies.context(f.conversation.id); assert.equal(current.capabilities.reply, true)
  const replyRef = ref('reply', current.version), response = await f.replies.command(replyRef, 'Olá, sou da equipe humana.')
  assert.equal(response.result?.delivery, 'available_in_chat')
  assert.deepEqual(await f.replies.command(replyRef, 'Olá, sou da equipe humana.'), response)
  await assert.rejects(f.replies.command(replyRef, 'Outro conteúdo.'), (e: any) => e.code === 'idempotency_conflict')
  await f.conversations.addNote(f.conversation.id, 'Nota só da equipe.', randomUUID())
  const history = await f.conversations.messages(f.conversation.id)
  assert.equal(history.items.find(m => m.id === response.result!.messageId)!.authorType, 'human')
  assert.equal(JSON.stringify(history).includes('authorUserId'), false)
  const publicHistory = (await f.visitorRead()).json()
  assert.equal(publicHistory.items.some((m: any) => m.content === 'Olá, sou da equipe humana.' && m.authorType === 'human'), true)
  assert.equal(JSON.stringify(publicHistory).includes('Nota só da equipe.'), false)
  assert.equal(JSON.stringify(publicHistory).includes(f.owner.userId), false)
  const release = await f.replies.command(ref('release', (await f.replies.context(f.conversation.id)).version))
  assert.equal(release.result?.mode, 'ai'); assert.equal((await f.replies.context(f.conversation.id)).capabilities.reply, false)
})

test('actual visitor ingress remains readable in the private inbox without exposing internal author identities', async t => {
  const f = await conversationReplyFixture(t), state = await f.replies.context(f.conversation.id)
  await f.replies.command({ kind: 'takeover', conversationId: f.conversation.id, key: randomUUID(), expectedVersion: state.version })
  const content = 'Olá equipe, teste local do atendimento humano.', ingress = await f.visitorSend(content)
  assert.equal(ingress.statusCode, 200); assert.equal(ingress.json().status, 'human_pending')
  const raw = f.store.list(f.owner.tenantId, 'messages').find(item => item.content === content)!
  assert.deepEqual({ role: raw.role, authorType: raw.authorType, source: raw.source, deliveryStatus: raw.deliveryStatus }, { role: 'user', authorType: 'visitor', source: 'public_widget', deliveryStatus: 'received' })
  const history = await f.conversations.messages(f.conversation.id), message = history.items.find(item => item.id === raw.id)!
  assert.equal(message.content, content); assert.equal(message.authorType, 'visitor'); assert.equal(message.role, 'user'); assert.equal(message.internalNote, false)
  assert.equal(JSON.stringify(message).includes('authorUserId'), false); assert.equal(JSON.stringify(message).includes('authorMembershipId'), false)
  f.store.update(f.owner.tenantId, 'messages', raw.id, { authorType: 'unexpected_author' })
  await assert.rejects(f.conversations.messages(f.conversation.id), (error: any) => error.code === 'invalid_data')
})

test('lost response restores by GET with no duplicate write; minimal storage excludes body and isolates users and conversations', async t => {
  const f = await conversationReplyFixture(t), state = await f.replies.context(f.conversation.id)
  await f.replies.command({ kind: 'takeover', conversationId: f.conversation.id, key: randomUUID(), expectedVersion: state.version })
  const ref: ReplyReference = { kind: 'reply', conversationId: f.conversation.id, key: randomUUID(), expectedVersion: (await f.replies.context(f.conversation.id)).version }
  f.state.lostResponsePath = `/api/v1/conversations/${f.conversation.id}/replies`
  await assert.rejects(f.replies.command(ref, 'Resposta privada de teste.'), ReplyWriteUncertain)
  const receipt = await f.replies.operation(ref); assert.equal(receipt.status, 'succeeded'); assert.equal(JSON.stringify(receipt).includes('Resposta privada'), false)
  assert.equal(f.state.requests.filter(r => r.path.endsWith('/replies') && r.method === 'POST').length, 1)
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, v: string) => { values.set(key, v) }, removeItem: (key: string) => { values.delete(key) } }
  const scope = { userId: f.owner.userId, tenantId: f.owner.tenantId, conversationId: f.conversation.id }, journal = createReplyOperationStorage(storage, scope)
  journal.write({ ...ref, content: 'PRIVATE', token: 'PRIVATE', url: 'https://private.test' } as any)
  assert.deepEqual(journal.read(), ref); assert.equal(/PRIVATE|content|token|https/.test([...values.values()].join('')), false)
  assert.equal(createReplyOperationStorage(storage, { ...scope, userId: f.member.userId }).read(), undefined)
  assert.equal(createReplyOperationStorage(storage, { ...scope, conversationId: randomUUID() }).read(), undefined)
  f.loginAs(f.admin.userId); await assert.rejects(f.replies.operation(ref), (e: any) => e.status === 404)
})

test('captured tenant, stale version, unavailable visitor, role revocation and malformed receipts fail closed', async t => {
  const f = await conversationReplyFixture(t), first = await f.replies.context(f.conversation.id)
  const ref: ReplyReference = { kind: 'takeover', conversationId: f.conversation.id, key: randomUUID(), expectedVersion: first.version }
  f.store.update(f.owner.tenantId, 'conversations', f.conversation.id, { subject: 'Changed elsewhere' })
  await assert.rejects(f.replies.command(ref), (e: any) => e.code === 'conversation_changed')
  const otherTenant = randomUUID(); seedMember(f.store, { ...f.owner, tenantId: otherTenant }); f.loginAs(f.owner.userId, otherTenant)
  await assert.rejects(f.replies.command(ref), (e: any) => e.code === 'tenant_mismatch')
  assert.equal(f.store.list(otherTenant, 'conversation-reply-operations').length, 0); assert.equal(f.store.list(f.owner.tenantId, 'conversation-reply-operations').length, 0)
  f.loginAs(f.owner.userId); f.store.update(f.owner.tenantId, 'public-chat-sessions', f.visitor.id, { status: 'ended' })
  const unavailable = await f.replies.context(f.conversation.id); assert.equal(unavailable.capabilities.takeover, false); assert.equal(unavailable.reasonCode, 'session_unavailable')
  await assert.rejects(f.replies.command({ ...ref, expectedVersion: unavailable.version }), (e: any) => e.code === 'session_unavailable')
  f.store.db.prepare("UPDATE memberships SET role='viewer',revision=revision+1 WHERE user_id=? AND tenant_id=?").run(f.owner.userId, f.owner.tenantId)
  assert.equal((await f.replies.context(f.conversation.id)).capabilities.takeover, false)
  await assert.rejects(f.replies.command(ref), (e: any) => e.status === 403)
  const forged = createConversationReplyService({ ...f.context, request: (async () => ({ key: ref.key, tenantId: otherTenant, conversationId: ref.conversationId, kind: ref.kind, status: 'succeeded', automaticRetry: false, result: { mode: 'human', version: 'a'.repeat(64) } })) as any })
  await assert.rejects(forged.command(ref), ReplyWriteUncertain)
  await assert.rejects(forged.operation(ref), (e: any) => e.code === 'invalid_reply_response')
})
