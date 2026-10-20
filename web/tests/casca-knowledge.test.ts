import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createKnowledgeCommands, mediaUploadSlot } from '../src/services/casca/knowledge'
import { readKnowledgeFile } from '../src/services/engine/knowledge'
import { parseActionLines, formatActionLines } from '../src/services/casca/commercial-actions'
import { EngineError } from '../src/services/engine/http'

function fixture() {
  const tenantId = 'synthetic-knowledge', agentId = randomUUID(), id = randomUUID(), values = new Map<string, string>(), calls: any[] = [], published: any[] = []
  const expected = { tenantId, userId: randomUUID(), membershipId: randomUUID(), authorityVersion: 'c'.repeat(64) }
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  let current = true, handler = async (_path: string, _options: any): Promise<any> => { throw Error('unset') }
  const context = { tenantId, generation: 1, assertCurrent() { if (!current) throw Error('context changed') }, async request<T>(path: string, options?: any): Promise<T> { calls.push({ path, options }); return handler(path, options) } }
  const row = { id, tenantId, agentId, title: 'Informação privada', content: 'Conteúdo privado', type: 'text', tags: [], createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', indexed: false, ingestionStatus: 'pending', chunkCount: 0, embeddingModel: null, indexedAt: null, url: null, document: null, extraction: null }
  const commands = createKnowledgeCommands(context, expected, storage, agentId, 'test', (scope, value) => { scope.assertCurrent(); published.push(value) })
  return { context, expected, storage, commands, calls, values, row, published, agentId, set: (f: typeof handler) => { handler = f }, revoke: () => { current = false } }
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
test('a definitive upload indexing error keeps the journal and shows the server message', async () => {
  const f = fixture(); let uploads = 0; let fail = true
  const document = { filename: 'foto.png', mimeType: 'image/png', sizeBytes: 4 }
  const extraction = { method: 'openai_vision', ocr: true, originalBinaryRetained: false }
  f.set(async (path, options) => {
    if (path.endsWith('/upload')) { uploads++; return { ...f.row, type: 'document', document, extraction, indexed: false, ingestionStatus: 'extracted' } }
    if (path.endsWith('/ingest')) {
      if (fail) throw new EngineError(422, 'document_format_unavailable', 'This endpoint accepts plain-text documents')
      return { knowledgeId: f.row.id, status: 'indexed', chunkCount: 1, model: 'fixture-model', cached: false }
    }
    return { ...f.row, type: 'document', document, extraction, indexed: !fail, chunkCount: fail ? 0 : 1, ingestionStatus: fail ? 'extracted' : 'indexed' }
  })
  const file = new File([Uint8Array.from([1, 2, 3, 4])], 'foto.png', { type: 'image/png' })
  await assert.rejects(() => f.commands.upload('Foto', file), /indexação falhou: This endpoint accepts plain-text documents/)
  assert.equal(uploads, 1); assert.equal(f.values.size, 1)
  assert.equal(f.calls.filter(call => String(call.path).endsWith('/upload')).length, 1)
  fail = false
  const ready = await f.commands.upload('Foto', file)
  assert.equal(ready.indexed, true)
  assert.equal(uploads, 1)
  assert.equal(f.calls.filter(call => String(call.path).endsWith('/upload')).length, 1)
})
test('each media file has its own journal slot and keeps the declared mime', async () => {
  const f = fixture()
  const image = mediaUploadSlot({ name: 'politica-trocas.png', size: 10, lastModified: 1 })
  const audio = mediaUploadSlot({ name: 'horario.mp3', size: 20, lastModified: 2 })
  assert.notEqual(image, audio)
  const publish = () => undefined
  const stuck = createKnowledgeCommands(f.context, f.expected, f.storage, f.agentId, image, publish)
  const next = createKnowledgeCommands(f.context, f.expected, f.storage, f.agentId, audio, publish)
  const key = `kloel-casca-knowledge:${f.expected.userId}:${f.expected.tenantId}:${f.agentId}:${image}`
  f.storage.setItem(key, JSON.stringify({ context: f.expected, entryId: f.row.id }))
  let fresh = false
  const audioRow = { ...f.row, type: 'document', document: { filename: 'horario.mp3', mimeType: 'audio/mpeg', sizeBytes: 4 }, extraction: { method: 'openai_whisper', ocr: false, originalBinaryRetained: false } }
  f.set(async (path) => {
    if (!fresh) {
      if (path.endsWith('/ingest')) throw Error('still pending')
      return { ...f.row, indexed: false, document: { filename: 'politica-trocas.png', mimeType: 'image/png', sizeBytes: 10 }, extraction: { method: 'openai_vision', ocr: true, originalBinaryRetained: false } }
    }
    if (path.endsWith('/upload')) return { ...audioRow, indexed: false, chunkCount: 0, ingestionStatus: 'extracted' }
    if (path.endsWith('/ingest')) return { knowledgeId: f.row.id, status: 'indexed', chunkCount: 1, model: 'fixture-model', cached: false }
    return { ...audioRow, indexed: true, chunkCount: 1, ingestionStatus: 'indexed' }
  })
  await assert.rejects(() => stuck.upload('Preso', new File([Uint8Array.from([1])], 'politica-trocas.png', { type: 'image/png' })), /indexação ainda não foi confirmada/)
  assert.equal(f.calls.some(call => String(call.path).endsWith('/upload')), false)
  fresh = true
  const uploaded = await next.upload('Horário', new File([Uint8Array.from([1, 2, 3, 4])], 'horario.mp3', { type: 'audio/mpeg' }))
  assert.equal(uploaded.indexed, true)
  assert.equal(f.calls.filter(call => String(call.path).endsWith('/upload')).length, 1)
  assert.equal((await readKnowledgeFile(new File([Uint8Array.from([1, 2, 3, 4])], 'horario.mp3', { type: 'audio/mpeg' }))).mimeType, 'audio/mpeg')
  assert.equal((await readKnowledgeFile(new File([Uint8Array.from([1])], 'clip.mov', { type: 'video/quicktime' }))).mimeType, 'video/quicktime')
  assert.equal((await readKnowledgeFile(new File([Uint8Array.from([1])], 'nota.webm', { type: 'audio/webm' }))).mimeType, 'audio/webm')
})
test('action lines keep the typed confirmation text', () => {
  const line = 'GET /anything/orders | Consulta pedidos | não'
  const parsed = parseActionLines(line)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].method, 'GET')
  assert.equal(parsed[0].path, '/anything/orders')
  assert.equal(parsed[0].description, 'Consulta pedidos')
  assert.equal(parsed[0].confirm, false)
  assert.equal(parsed[0].confirmLabel, 'não')
  assert.equal(formatActionLines(parsed), line)
  assert.equal(parseActionLines('POST /orders | cria | sim')[0].confirm, true)
  assert.equal(parseActionLines('POST /orders | cria | nao')[0].confirm, false)
  assert.equal(parseActionLines('POST /orders | cria | yes')[0].confirm, true)
  assert.equal(parseActionLines('POST /orders | cria | no')[0].confirm, false)
  assert.equal(formatActionLines(parseActionLines('POST /orders | cria | nao')), 'POST /orders | cria | nao')
})
