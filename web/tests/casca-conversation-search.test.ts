import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import { Store } from '../../engine/src/store'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { resolveSessionContext } from '../../engine/src/request-context'
import { registerConversationSearch } from '../../engine/src/conversation-search'
import { createEngineClient, EngineError, type RequestOptions } from '../src/services/engine/http'
import { searchConversations } from '../src/services/casca/conversation-search'
async function fixture(t: any) {
  const store = new Store(), app = Fastify(), actor = { userId: 'search-user', tenantId: 'search-tenant', role: 'viewer' as const }, cookie = 'search-session'
  seedMember(store, actor); const hash = createHash('sha256').update(cookie).digest('hex')
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, actor.userId, actor.tenantId, Date.now() + 3600000)
  const identity = resolveSessionContext(store, hash)!
  app.addHook('onRequest', async request => { request.cookies = { kloel_session: cookie }; request.actor = identity.actor })
  await registerConversationSearch(app, store)
  let reads = 0
  const client = createEngineClient((async (url, options = {}) => {
    reads++; assert.ok(!options.method || options.method === 'GET')
    const result = await app.inject({ url: String(url), headers: Object.fromEntries(new Headers(options.headers)) })
    return new Response(result.body, { status: result.statusCode })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent() {}, request: <T>(path: string, options?: RequestOptions) => client<T>(path, { ...options, expectedContext: identity.context }) }
  t.after(async () => { await app.close(); store.close() })
  return { store, actor, context, reads: () => reads }
}
test('search reads all matching unloaded transcripts across pages and only own non-email conversations', async t => {
  const f = await fixture(t), ids: string[] = []
  for (let i = 0; i < 201; i++) {
    const c = f.store.create(f.actor.tenantId, 'conversations', { channel: i % 2 ? 'phone' : 'whatsapp', status: 'open', subject: 'Subject without the query' }); ids.push(c.id)
    f.store.create(f.actor.tenantId, 'messages', { conversationId: c.id, role: 'user', content: 'Pagamento confirmado' })
  }
  f.store.create(f.actor.tenantId, 'conversations', { channel: 'email', status: 'open', subject: 'Pagamento' })
  f.store.create('foreign', 'conversations', { channel: 'phone', status: 'open', subject: 'Pagamento' })
  const before = f.store.list(f.actor.tenantId, 'conversations')
  assert.deepEqual(await searchConversations(f.context, 'ＰＡＧＡＭＥＮＴＯ'), new Set(ids)); assert.equal(f.reads(), 3)
  assert.deepEqual(f.store.list(f.actor.tenantId, 'conversations'), before)
})
test('no matches is confirmed empty; cancelled, stale or invalid terms never publish an answer', async t => {
  const f = await fixture(t)
  assert.deepEqual(await searchConversations(f.context, 'missing'), new Set())
  const count = f.reads(), abort = new AbortController(); abort.abort()
  await assert.rejects(searchConversations(f.context, 'valid', abort.signal), (e: any) => e.name === 'AbortError')
  await assert.rejects(searchConversations(f.context, 'x'.repeat(301)), (e: any) => e.code === 'invalid_search'); assert.equal(f.reads(), count)
  await assert.rejects(searchConversations({ ...f.context, assertCurrent() { throw new EngineError(0, 'superseded', 'Changed') } }, 'valid'), (e: any) => e.code === 'superseded')
})
test('missing pages, duplicate IDs and unsolicited content reject instead of producing partial success', async () => {
  const fake = (raw: unknown) => ({ tenantId: 'tenant', generation: 1, assertCurrent() {}, request: async <T>() => raw as T })
  for (const raw of [
    { items: [{ id: 'one' }], page: 1, limit: 100, total: 2, totalPages: 1 },
    { items: [{ id: 'one' }, { id: 'one' }], page: 1, limit: 100, total: 2, totalPages: 1 },
    { items: [{ id: 'one', content: 'unexpected private body' }], page: 1, limit: 100, total: 1, totalPages: 1 },
    { items: [], page: 2, limit: 100, total: 0, totalPages: 0 },
  ]) await assert.rejects(searchConversations(fake(raw), 'query'), (e: any) => e.code === 'invalid_search')
})
