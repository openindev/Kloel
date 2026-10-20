import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import { Store } from '../../engine/src/store'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { registerDomains } from '../../engine/src/domains'
import { registerConversationControl } from '../../engine/src/conversation-control'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { createConversationService } from '../src/services/engine/conversations'

async function fixture(t: any) {
  const store = new Store(), app = Fastify(), actor = { tenantId: 'conversations-ui', userId: 'inbox-user', role: 'owner' as const }
  seedMember(store, actor); app.addHook('preHandler', async request => { request.actor = actor })
  await registerDomains(app, store); await registerConversationControl(app, store)
  const request = createEngineClient((async (url, options = {}) => {
    assert.equal(options.credentials, 'include')
    const response = await app.inject({ method: options.method as any ?? 'GET', url: String(url), headers: options.headers as any, ...(options.body ? { payload: String(options.body) } : {}) })
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, request, assertCurrent() {} }
  t.after(async () => { await app.close(); store.close() })
  return { store, actor, context, service: createConversationService(context) }
}

test('inbox adapter reads real filtered pages and messages, preserves provenance and saves with concurrency control', async t => {
  const f = await fixture(t)
  const conversation = f.store.create(f.actor.tenantId, 'conversations', { channel: 'webchat', status: 'open', subject: 'Garantia', tags: ['produto'] })
  f.store.create(f.actor.tenantId, 'conversations', { channel: 'phone', status: 'closed' })
  f.store.create('foreign', 'conversations', { channel: 'webchat', status: 'open', subject: 'Garantia' })
  const listing = await f.service.list({ page: 1, q: 'produto', status: 'open', channel: 'webchat' }); assert.equal(listing.total, 1); assert.equal(listing.items[0].id, conversation.id)
  const current = await f.service.get(conversation.id)
  f.store.update(f.actor.tenantId, 'conversations', conversation.id, { tags: ['produto', 'human_handoff'] })
  await assert.rejects(f.service.update(current, { subject: 'Stale' }), (error: any) => error.code === 'conversation_changed')
  const changed = await f.service.update(await f.service.get(conversation.id), { status: 'pending' })
  assert.deepEqual(changed.conversation.tags, ['produto', 'human_handoff']); assert.equal(changed.conversation.subject, 'Garantia')
  const key = randomUUID(), first = await f.service.addNote(conversation.id, 'Equipe: retorno amanhã.', key)
  assert.equal((await f.service.addNote(conversation.id, 'Equipe: retorno amanhã.', key)).id, first.id)
  const messages = await f.service.messages(conversation.id); assert.equal(messages.total, 1); assert.equal(messages.items[0].internalNote, true); assert.equal(messages.items[0].deliveryStatus, 'recorded'); assert.equal('noteOperationKey' in messages.items[0], false)
  await f.service.update(await f.service.get(conversation.id), { status: 'closed' })
  await assert.rejects(f.service.addNote(conversation.id, 'New note', randomUUID()), (error: any) => error.code === 'conversation_closed')
})
test('inbox viewer can read but cannot mutate; wrong tenant and wrong conversation responses are rejected', async t => {
  const f = await fixture(t), conversation = f.store.create(f.actor.tenantId, 'conversations', { channel: 'email', status: 'open' })
  f.store.db.prepare('UPDATE memberships SET role=? WHERE tenant_id=? AND user_id=?').run('viewer', f.actor.tenantId, f.actor.userId)
  const state = await f.service.get(conversation.id)
  await assert.rejects(f.service.update(state, { status: 'closed' }), (error: any) => error.status === 403)
  await assert.rejects(f.service.addNote(conversation.id, 'Denied', randomUUID()), (error: any) => error.status === 403)
  const forged = createConversationService({ ...f.context, request: (async () => ({ ...state, conversation: { ...state.conversation, tenantId: 'foreign' } })) as EngineRequest })
  await assert.rejects(forged.get(conversation.id), EngineError)
  const wrongHistory = createConversationService({ ...f.context, request: (async () => ({ items: [{ id: 'msg', tenantId: f.actor.tenantId, conversationId: 'other', role: 'user', content: 'secret', createdAt: conversation.createdAt }], total: 1, totalPages: 1, page: 1, limit: 50 })) as EngineRequest })
  await assert.rejects(wrongHistory.messages(conversation.id), EngineError)
})
test('inbox mutations never retry uncertain results and captured stale sessions cannot publish data', async () => {
  let attempts = 0
  const context = { tenantId: 'T', generation: 1, assertCurrent() {}, request: createEngineClient((async () => { attempts++; throw Error('lost') }) as typeof fetch) }
  await assert.rejects(createConversationService(context).addNote('conversation', 'Note', randomUUID()), (error: any) => error.code === 'network_error'); assert.equal(attempts, 1)
  const stale = createConversationService({ ...context, assertCurrent() { throw new EngineError(0, 'superseded', 'Changed') }, request: (async () => ({ items: [], total: 0, totalPages: 0, page: 1, limit: 25 })) as EngineRequest })
  await assert.rejects(stale.list({ page: 1 }), (error: any) => error.code === 'superseded')
})
