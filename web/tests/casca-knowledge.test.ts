import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createKnowledgeCommands } from '../src/services/casca/knowledge'
import { EngineError } from '../src/services/engine/http'

function fixture() {
  const tenantId = 'synthetic-knowledge', agentId = randomUUID(), id = randomUUID(), values = new Map<string, string>(), calls: any[] = [], published: any[] = []
  const expected = { tenantId, userId: randomUUID(), membershipId: randomUUID(), authorityVersion: 'c'.repeat(64) }
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  let current = true, handler = async (_path: string, _options: any): Promise<any> => { throw Error('unset') }
  const context = { tenantId, generation: 1, assertCurrent() { if (!current) throw Error('context changed') }, async request<T>(path: string, options?: any): Promise<T> { calls.push({ path, options }); return handler(path, options) } }
  const row = { id, tenantId, agentId, title: 'Informação privada', content: 'Conteúdo privado', type: 'text', tags: [], createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', indexed: false, ingestionStatus: 'pending', chunkCount: 0, embeddingModel: null, indexedAt: null, url: null, document: null, extraction: null }
  const commands = createKnowledgeCommands(context, expected, storage, agentId, 'test', (scope, value) => { scope.assertCurrent(); published.push(value) })
  return { context, expected, storage, commands, calls, values, row, published, set: (f: typeof handler) => { handler = f }, revoke: () => { current = false } }
}
test('manual source is indexed and published only from API records; journal has IDs only', async () => {
  const f = fixture(); let indexed = false
  f.set(async (path, options) => {
    assert.doesNotMatch([...f.values.values()].join(''), /Informação|Conteúdo/)
    if (path.endsWith('/ingest')) { indexed = true; return { knowledgeId: f.row.id, status: 'indexed', chunkCount: 1, model: 'fixture-model', cached: false } }
    return { ...f.row, indexed, chunkCount: indexed ? 1 : 0, ingestionStatus: indexed ? 'indexed' : 'pending' }
  })
  const result = await f.commands.createText(f.row.title, f.row.content)
  assert.equal(result.indexed, true); assert.equal(f.values.size, 0)
  assert.equal(f.calls.filter(x => x.options?.method === 'POST').length, 2)
  assert.deepEqual(f.published.map(x => x.indexed), [false, true])
})
test('lost create response retains opaque unresolved reference and retry does not duplicate source', async () => {
  const f = fixture(); f.set(async () => { throw Error('response lost') })
  await assert.rejects(() => f.commands.createText('Pergunta', 'Resposta'))
  await assert.rejects(() => f.commands.createText('Pergunta', 'Resposta'), /não foi confirmado/)
  assert.equal(f.calls.length, 1); assert.equal(f.published.length, 0); assert.equal(f.values.size, 1)
})
test('lost ingestion response is recovered by GET, never by repeating provider work', async () => {
  const f = fixture(); let indexed = false
  f.set(async (path, options) => {
    if (path.endsWith('/ingest')) { indexed = true; throw Error('response lost') }
    return { ...f.row, indexed, chunkCount: indexed ? 1 : 0, ingestionStatus: indexed ? 'indexed' : 'pending' }
  })
  assert.equal((await f.commands.createText('Pergunta', 'Resposta')).indexed, true)
  assert.equal(f.calls.filter(x => x.path.endsWith('/ingest')).length, 1)
})
test('failed indexing is not labeled ready; consulting a pending import sends no POST', async () => {
  const f = fixture(); f.set(async path => { if (path.endsWith('/ingest')) throw Error('embedding unavailable'); return f.row })
  await assert.rejects(() => f.commands.createText('Pergunta', 'Resposta'), /indexação/)
  const before = f.calls.length
  await assert.rejects(() => f.commands.createText('Outra', 'Outra'), /indexação/)
  assert.ok(f.calls.slice(before).every(x => !x.options?.method)); assert.equal(f.values.size, 1)
})
test('definitive rejected create releases reference and expired context never publishes', async () => {
  const f = fixture(); f.set(async () => { throw new EngineError(422, 'validation_error', 'invalid') })
  await assert.rejects(() => f.commands.createText('Pergunta', 'Resposta')); assert.equal(f.values.size, 0)
  const g = fixture(); g.set(async () => { g.revoke(); return g.row })
  await assert.rejects(() => g.commands.createText('Pergunta', 'Resposta'), /context changed/); assert.equal(g.published.length, 0)
})
test('invalid local input fails before reserving a reference or sending data', () => {
  const f = fixture()
  assert.throws(() => f.commands.createText('', 'Resposta'))
  assert.throws(() => f.commands.upload('Documento', { size: 11 * 1024 * 1024, name: 'large.pdf' } as File))
  assert.equal(f.calls.length, 0); assert.equal(f.values.size, 0)
})
