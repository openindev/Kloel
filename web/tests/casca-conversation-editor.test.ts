import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import { Store } from '../../engine/src/store'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { resolveSessionContext } from '../../engine/src/request-context'
import { registerConversationEditorState } from '../../engine/src/conversation-editor-state'
import { createEngineClient, EngineError, type RequestOptions } from '../src/services/engine/http'
import { createConversationEditorService } from '../src/services/casca/conversation-editor'
import { projectConversation, projectConversationRecord } from '../src/services/casca/conversation-projection'

async function fixture(t: any) {
  const store = new Store(), app = Fastify(), actor = { userId: 'adapter-user', tenantId: 'adapter-tenant', role: 'owner' as const }
  seedMember(store, actor)
  const cookie = 'fixture-session', hash = createHash('sha256').update(cookie).digest('hex')
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, actor.userId, actor.tenantId, Date.now() + 3600000)
  const identity = resolveSessionContext(store, hash)!
  app.addHook('onRequest', async request => { request.cookies = { kloel_session: cookie }; request.actor = identity.actor })
  await registerConversationEditorState(app, store)
  const calls: { path: string; method: string; body: unknown; etag: string | null }[] = []
  const client = createEngineClient((async (url, options = {}) => {
    const headers = new Headers(options.headers)
    calls.push({ path: String(url), method: options.method ?? 'GET', body: options.body ? JSON.parse(String(options.body)) : null, etag: headers.get('if-match') })
    const response = await app.inject({ method: options.method as any ?? 'GET', url: String(url), headers: Object.fromEntries(headers), ...(options.body ? { payload: String(options.body) } : {}) })
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent() {}, request: <T>(path: string, options?: RequestOptions) => client<T>(path, { ...options, expectedContext: identity.context }) }
  const conversation = store.create(actor.tenantId, 'conversations', { channel: 'whatsapp', status: 'pending', subject: 'Consulta', tags: ['human_handoff', 'runtime-label'] })
  t.after(async () => { await app.close(); store.close() })
  return { store, app, actor, conversation, context, service: createConversationEditorService(context), calls }
}

test('editor adapter uses exact CAS headers and shared flags do not change operational state', async t => {
  const f = await fixture(t), before = f.store.get(f.actor.tenantId, 'conversations', f.conversation.id)!
  const initial = await f.service.get(f.conversation.id), changed = await f.service.patch(initial, { starred: true, archived: true })
  assert.equal(changed.starred, true); assert.equal(changed.archived, true)
  assert.equal(f.calls.at(-1)!.etag, `"conversation-editor:${initial.conversationId}:${initial.version}"`)
  assert.deepEqual(f.calls.at(-1)!.body, { starred: true, archived: true })
  await assert.rejects(f.service.patch(initial, { read: true }), (e: any) => e.status === 409)
  assert.deepEqual(f.store.get(f.actor.tenantId, 'conversations', f.conversation.id), before)
})
test('catalog keeps shell colors, persists assignments and rejects stale catalog overwrites', async t => {
  const f = await fixture(t), initial = await f.service.catalog(), id = randomUUID()
  const catalog = await f.service.saveCatalog(initial, [{ id, orgId: f.actor.tenantId, label: 'Retorno', color: 'brand', autoAdd: false }])
  assert.equal(f.calls.at(-1)!.etag, `"conversation-tags:${initial.revision}"`)
  assert.equal((f.calls.at(-1)!.body as any).tags[0].color, '#585DF5'); assert.equal(catalog.tags[0].color, 'brand')
  const state = await f.service.patch(await f.service.get(f.conversation.id), { tagIds: [id] }); assert.deepEqual(state.tagIds, [id])
  await assert.rejects(f.service.saveCatalog(initial, []), (e: any) => e.status === 409)
  await f.service.saveCatalog(catalog, []); assert.deepEqual((await f.service.get(f.conversation.id)).tagIds, [])
  assert.deepEqual(f.store.get(f.actor.tenantId, 'conversations', f.conversation.id)!.tags, ['human_handoff', 'runtime-label'])
})
test('batch returns exact current-user state and a new message becomes unread', async t => {
  const f = await fixture(t), second = f.store.create(f.actor.tenantId, 'conversations', { channel: 'webchat', status: 'open' })
  const ids = [second.id, f.conversation.id], initial = await f.service.batch(ids)
  assert.deepEqual(initial.map(x => x.conversationId), ids); assert.equal(f.calls.length, 1)
  await f.service.patch(initial[1], { read: true }); assert.equal((await f.service.batch(ids))[1].read, true)
  f.store.create(f.actor.tenantId, 'messages', { conversationId: f.conversation.id, role: 'user', content: 'Novidade' })
  assert.equal((await f.service.batch(ids))[1].read, false)
  await assert.rejects(f.service.batch([f.conversation.id, randomUUID()]), (e: any) => e.status === 404)
})
test('adapter rejects foreign, duplicate or incomplete data and stale authority', async t => {
  const f = await fixture(t), initial = await f.service.get(f.conversation.id)
  const fake = (raw: unknown) => createConversationEditorService({ ...f.context, request: async <T>() => raw as T })
  await assert.rejects(fake({ ...initial, tenantId: 'other' }).get(f.conversation.id), EngineError)
  await assert.rejects(fake({ items: [] }).batch([f.conversation.id]), EngineError)
  await assert.rejects(fake({ items: [initial, initial] }).batch([f.conversation.id, randomUUID()]), EngineError)
  await assert.rejects(createConversationEditorService({ ...f.context, assertCurrent() { throw new EngineError(0, 'superseded', 'Changed') } }).get(f.conversation.id), (e: any) => e.code === 'superseded')
})
test('uncertain editorial writes are not repeated automatically', async t => {
  const f = await fixture(t), state = await f.service.get(f.conversation.id); let writes = 0
  const service = createConversationEditorService({ ...f.context, request: async <T>() => { writes++; throw new EngineError(0, 'network_error', 'lost') } })
  await assert.rejects(service.patch(state, { starred: true }), EngineError); assert.equal(writes, 1)
})
test('projection preserves unknown values, actual messages, tags and separate Email IA destination', async t => {
  const f = await fixture(t), editor = await f.service.get(f.conversation.id)
  const record = { ...f.conversation, agentId: null, contactId: null } as any
  const list = projectConversationRecord(record, null, [], [], editor)
  assert.equal(list.durationSec, null); assert.equal(list.result, 'unknown'); assert.equal(list.direction, 'unknown'); assert.equal(list.endedBy, 'unknown'); assert.equal(list.engineConversation?.loaded, false); assert.equal(list.engineConversation?.control, null)
  assert.equal(list.recording, undefined); assert.equal(list.handover?.at, null); assert.equal(list.simulated, false); assert.equal(list.read, false)
  assert.equal(list.tagIds.some(id => id.includes('human_handoff')), false)
  const content = 'Mensagem real', detail = projectConversation({ conversation: record, version: 'a'.repeat(64) }, [{ id: 'msg', conversationId: record.id, role: 'user', content, createdAt: record.createdAt, deliveryStatus: 'received', internalNote: false }], [], editor)
  assert.equal(detail.transcript[0].text, content); assert.equal(detail.transcript[0].sentAt, record.createdAt); assert.equal(detail.engineConversation?.loaded, true)
  assert.throws(() => projectConversationRecord({ ...record, channel: 'email' }, null, [], [], editor), (e: any) => e.code === 'email_inbox_separate')
})
