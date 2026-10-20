import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import { Store } from '../../engine/src/store'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { registerDomains } from '../../engine/src/domains'
import { registerKnowledge } from '../../engine/src/knowledge'
import { registerIngestion } from '../../engine/src/ingestion'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { createKnowledgeService, readKnowledgeFile } from '../src/services/engine/knowledge'

async function fixture(t: any) {
  const store = new Store(), app = Fastify(), actor = { tenantId: 'knowledge-ui', userId: 'knowledge-user', role: 'owner' as const }
  seedMember(store, actor); app.addHook('preHandler', async request => { request.actor = actor })
  let providerCalls = 0, providerFailure = false, urlCalls = 0
  await registerDomains(app, store)
  await registerKnowledge(app, store, { apiKey: 'isolated-test-placeholder', fetchImpl: (async (address, init) => {
    providerCalls++; assert.equal(address, 'https://api.openai.com/v1/embeddings')
    if (providerFailure) return new Response('rejected', { status: 503 })
    const body = JSON.parse(String(init?.body)); return Response.json({ data: body.input.map((_: unknown, index: number) => ({ index, embedding: [1, 0, 0] })), usage: { prompt_tokens: 10, total_tokens: 10 } })
  }) as typeof fetch })
  await registerIngestion(app, store, { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => { urlCalls++; return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<h1>Horário</h1><p>Aberto às 9h.</p><script>secret-script</script>') } } })
  const seen: Array<{ method: string; path: string; body?: any }> = []
  const request = createEngineClient((async (url, options = {}) => {
    assert.equal(options.credentials, 'include'); assert.equal((options.headers as any).Authorization, undefined)
    seen.push({ method: options.method ?? 'GET', path: String(url), body: options.body ? JSON.parse(String(options.body)) : undefined })
    const response = await app.inject({ method: options.method as any ?? 'GET', url: String(url), headers: options.headers as any, ...(options.body ? { payload: String(options.body) } : {}) })
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, request, assertCurrent() {} }
  const agent = store.create(actor.tenantId, 'agents', { name: 'Own assistant' }), otherAgent = store.create(actor.tenantId, 'agents', { name: 'Other assistant' })
  t.after(async () => { await app.close(); store.close() })
  return { actor, store, context, agent, otherAgent, seen, service: createKnowledgeService(context, agent.id), providerCalls: () => providerCalls, urlCalls: () => urlCalls, failProvider: () => { providerFailure = true } }
}

test('knowledge UI adapter uses real CRUD, scoped indexing, provenance, invalidation and cascading delete', async t => {
  const f = await fixture(t)
  const entry = await f.service.createText({ title: 'Política', content: 'A garantia é de dois anos.', tags: ['produto'] })
  const unrelated = await createKnowledgeService(f.context, f.otherAgent.id).createText({ title: 'Outro', content: 'Outra política.', tags: [] })
  assert.equal(entry.indexed, false); assert.equal(entry.agentId, f.agent.id)
  const listing = await f.service.list(1, 'produto'); assert.equal(listing.total, 1); assert.equal(listing.items[0].id, entry.id)
  const indexed = await f.service.ingest(entry.id); assert.equal(indexed.chunkCount, 1); assert.equal(indexed.cached, false); assert.equal(f.providerCalls(), 1)
  assert.equal((await f.service.ingest(entry.id)).cached, true); assert.equal(f.providerCalls(), 1)
  const chunks = await f.service.chunks(entry.id); assert.equal(chunks.total, 1); assert.equal(chunks.items[0].source.charEnd, entry.content.length); assert.equal('embedding' in chunks.items[0], false)
  const matches = await f.service.search('Qual a garantia?'); assert.equal(matches.length, 1); assert.equal(matches[0].knowledgeId, entry.id); assert.equal(matches[0].text, entry.content)
  const changed = await f.service.update(entry.id, { title: entry.title, content: 'A garantia é de três anos.', tags: [] })
  assert.equal(changed.indexed, false); assert.equal((await f.service.chunks(entry.id)).total, 0)
  const calls = f.providerCalls(); assert.deepEqual(await f.service.search('garantia'), []); assert.equal(f.providerCalls(), calls)
  await assert.rejects(f.service.remove(unrelated.id), EngineError); assert.ok(f.store.get(f.actor.tenantId, 'knowledge', unrelated.id))
  await f.service.ingest(entry.id); await f.service.remove(entry.id)
  assert.equal((await f.service.list()).total, 0); assert.equal(f.store.list(f.actor.tenantId, 'knowledge-chunks').length, 0)
})

test('document and URL import use actual extraction routes, never fabricate indexed status, and reject private sources', async t => {
  const f = await fixture(t)
  const file = new File(['Horário: nove às dezoito.'], 'horario.txt', { type: 'text/plain' })
  const uploaded = await f.service.upload('Horários', file)
  assert.equal(uploaded.content, 'Horário: nove às dezoito.'); assert.equal(uploaded.indexed, false); assert.equal(uploaded.extraction?.originalBinaryRetained, false)
  assert.equal(uploaded.document?.filename, file.name); assert.equal((uploaded.document as any).storageKey, undefined)
  const imported = await f.service.importUrl('Página', 'https://example.com/horario')
  assert.ok(imported.content.includes('Aberto às 9h')); assert.ok(!imported.content.includes('secret-script')); assert.equal(imported.indexed, false); assert.equal(f.urlCalls(), 1)
  await f.service.ingest(imported.id); assert.equal((await f.service.get(imported.id)).indexed, true)
  await assert.rejects(f.service.update(imported.id, { title: imported.title, content: 'Invented extraction', tags: [] }), EngineError)
  await assert.rejects(f.service.importUrl('Private', 'http://127.0.0.1/private')); assert.equal(f.urlCalls(), 1)
  const countBefore = f.seen.length
  await assert.rejects(f.service.upload('Bad', new File(['bad'], 'file.exe'))); await assert.rejects(readKnowledgeFile(new File([], 'empty.txt')))
  await assert.rejects(f.service.importUrl('Bad', 'javascript:alert(1)')); assert.equal(f.seen.length, countBefore)
  f.failProvider(); await assert.rejects(f.service.ingest(uploaded.id), (error: any) => error.status === 502)
  assert.equal((await f.service.get(uploaded.id)).indexed, false)
})

test('knowledge adapter enforces actual viewer permissions and rejects mismatched tenant/agent responses', async t => {
  const f = await fixture(t), entry = await f.service.createText({ title: 'Own', content: 'Own source', tags: [] })
  for (const changed of [{ tenantId: 'foreign' }, { agentId: f.otherAgent.id }]) {
    const service = createKnowledgeService({ ...f.context, request: (async () => ({ ...entry, ...changed })) as EngineRequest }, f.agent.id)
    await assert.rejects(service.get(entry.id), EngineError)
  }
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('viewer', f.actor.userId, f.actor.tenantId)
  assert.equal((await f.service.list()).total, 1)
  await assert.rejects(f.service.createText({ title: 'Denied', content: 'No permission', tags: [] }), (error: any) => error.status === 403)
  await assert.rejects(f.service.ingest(entry.id), (error: any) => error.status === 403)
  assert.equal(f.providerCalls(), 0)
})

test('uncertain knowledge creation is never retried and a stale session cannot publish a result', async () => {
  let attempts = 0
  const service = createKnowledgeService({ tenantId: 'T', generation: 1, assertCurrent() {}, request: createEngineClient((async () => { attempts++; throw Error('connection lost') }) as typeof fetch) }, 'agent')
  await assert.rejects(service.createText({ title: 'Uncertain', content: 'Source', tags: [] }), (error: any) => error.code === 'network_error'); assert.equal(attempts, 1)
  const stale = createKnowledgeService({ tenantId: 'T', generation: 1, assertCurrent() { throw new EngineError(0, 'superseded', 'Changed') }, request: (async () => ({ items: [], page: 1, limit: 25, total: 0, totalPages: 0 })) as EngineRequest }, 'agent')
  await assert.rejects(stale.list(), (error: any) => error.code === 'superseded')
})
