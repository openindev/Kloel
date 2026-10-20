import { EngineError } from './http'
import type { EngineContext } from './session'

export type KnowledgeType = 'text' | 'url' | 'document'
export interface KnowledgeEntry {
  id: string; tenantId: string; agentId: string; title: string; type: KnowledgeType; content: string; tags: string[]
  createdAt: string; updatedAt: string; indexed: boolean; ingestionStatus: string; chunkCount: number
  embeddingModel: string | null; indexedAt: string | null; url: string | null
  document: { filename: string; mimeType: string; sizeBytes: number } | null
  extraction: { method: string; ocr: boolean; originalBinaryRetained: boolean | null } | null
}
export interface KnowledgePage { items: KnowledgeEntry[]; page: number; limit: number; total: number; totalPages: number }
export interface KnowledgeMatch { knowledgeId: string; chunkId: string; title: string; type: string; text: string; score: number; source: KnowledgeSource }
export interface KnowledgeSource { knowledgeId: string; title: string; type: string; chunkIndex: number; charStart: number; charEnd: number; url: string | null; filename: string | null; pageNumbers: number[] }
export interface KnowledgeChunk { id: string; content: string; model: string; source: KnowledgeSource }
export interface KnowledgeDraft { title: string; content: string; tags: string[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, min = 0, max = 100000): value is string => typeof value === 'string' && value.length >= min && value.length <= max
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function invalid(message = 'A fonte de conhecimento recebida é inválida.'): never { throw new EngineError(0, 'invalid_data', message) }
function id(value: string) { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) invalid(); return value }
function url(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (!text(value, 1, 4000)) invalid('Informe uma URL HTTP ou HTTPS pública.')
  try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) invalid(); return parsed.href } catch { invalid('Informe uma URL HTTP ou HTTPS pública.') }
}
function draft(value: KnowledgeDraft) {
  if (!text(value.title, 1, 200) || !value.title.trim() || !text(value.content) || !Array.isArray(value.tags) || value.tags.length > 50 || value.tags.some(tag => !text(tag, 1, 80))) invalid('Confira título, conteúdo e etiquetas da fonte.')
  return { title: value.title.trim(), content: value.content, tags: [...value.tags] }
}
function parseEntry(raw: unknown, tenantId: string, agentId: string): KnowledgeEntry {
  if (!object(raw) || raw.tenantId !== tenantId || raw.agentId !== agentId || !text(raw.id, 1, 128) || !text(raw.title, 1, 200) || !text(raw.content) || !['text', 'url', 'document'].includes(String(raw.type)) || typeof raw.indexed !== 'boolean' || !count(raw.chunkCount) || !text(raw.ingestionStatus, 1, 100) || !Array.isArray(raw.tags) || raw.tags.some(tag => !text(tag, 1, 80)) || !Number.isFinite(Date.parse(String(raw.createdAt))) || !Number.isFinite(Date.parse(String(raw.updatedAt)))) invalid()
  id(raw.id)
  const doc = raw.document
  if (doc != null && (!object(doc) || !text(doc.filename, 1, 200) || !text(doc.mimeType, 1, 150) || !count(doc.sizeBytes))) invalid()
  const extraction = raw.extraction
  if (extraction != null && (!object(extraction) || !text(extraction.method, 1, 100) || typeof extraction.ocr !== 'boolean')) invalid()
  if (raw.embeddingModel != null && !text(raw.embeddingModel, 1, 150)) invalid()
  if (raw.indexedAt != null && !Number.isFinite(Date.parse(String(raw.indexedAt)))) invalid()
  return { id: raw.id, tenantId, agentId, title: raw.title, type: raw.type as KnowledgeType, content: raw.content, tags: raw.tags as string[], createdAt: String(raw.createdAt), updatedAt: String(raw.updatedAt), indexed: raw.indexed, ingestionStatus: raw.ingestionStatus, chunkCount: raw.chunkCount, embeddingModel: raw.embeddingModel as string ?? null, indexedAt: raw.indexedAt as string ?? null, url: url(raw.url), document: object(doc) ? { filename: String(doc.filename), mimeType: String(doc.mimeType), sizeBytes: Number(doc.sizeBytes) } : null, extraction: object(extraction) ? { method: String(extraction.method), ocr: Boolean(extraction.ocr), originalBinaryRetained: typeof extraction.originalBinaryRetained === 'boolean' ? extraction.originalBinaryRetained : null } : null }
}
function source(raw: unknown, knowledgeId: string): KnowledgeSource {
  if (!object(raw) || raw.knowledgeId !== knowledgeId || !text(raw.title, 1, 200) || !text(raw.type, 1, 100) || !count(raw.chunkIndex) || !count(raw.charStart) || !count(raw.charEnd) || raw.charEnd < raw.charStart || (raw.filename != null && !text(raw.filename, 1, 200)) || (raw.pageNumbers != null && (!Array.isArray(raw.pageNumbers) || raw.pageNumbers.some(page => !count(page) || page < 1)))) invalid()
  return { knowledgeId, title: raw.title, type: raw.type, chunkIndex: raw.chunkIndex, charStart: raw.charStart, charEnd: raw.charEnd, url: url(raw.url), filename: raw.filename as string ?? null, pageNumbers: raw.pageNumbers as number[] ?? [] }
}
function pageShape(raw: unknown, page: number, limit: number): asserts raw is { items: unknown[]; page: number; limit: number; total: number; totalPages: number } {
  if (!object(raw) || !Array.isArray(raw.items) || raw.page !== page || raw.limit !== limit || !count(raw.total) || !count(raw.totalPages) || raw.totalPages !== Math.ceil(raw.total / limit) || raw.items.length > limit) invalid()
}

export const knowledgeFileTypes = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json' } as const
export async function readKnowledgeFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() as keyof typeof knowledgeFileTypes
  const mimeType = knowledgeFileTypes[extension]
  if (!mimeType || !file.size || file.size > 10 * 1024 * 1024 || file.name.length > 200) invalid('Use PDF, TXT, Markdown, CSV ou JSON, de até 10 MiB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return { filename: file.name, mimeType, base64: btoa(binary) }
}

/** Each instance is bound to one session organization and one agent. Provider keys stay on the server. */
export function createKnowledgeService(context: EngineContext, agentId: string) {
  id(agentId)
  const parse = (raw: unknown) => parseEntry(raw, context.tenantId, agentId)
  async function get(entryId: string) {
    const result = parse(await context.request(`/knowledge/${id(entryId)}`)); context.assertCurrent()
    if (result.id !== entryId) invalid()
    return result
  }
  return {
    get,
    async list(page = 1, query = '', signal?: AbortSignal): Promise<KnowledgePage> {
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || query.length > 300) invalid()
      const raw = await context.request('/knowledge', { query: { agentId, page, limit: 25, q: query || undefined }, signal })
      pageShape(raw, page, 25); const items = raw.items.map(parse); context.assertCurrent(); return { ...raw, items }
    },
    async createText(input: KnowledgeDraft) {
      const body = draft(input); if (!body.content.trim()) invalid('Escreva o conteúdo da fonte.')
      const result = parse(await context.request('/knowledge', { method: 'POST', body: { ...body, type: 'text', agentId } })); context.assertCurrent(); return result
    },
    async update(entryId: string, input: KnowledgeDraft) {
      const body = draft(input), previous = await get(entryId)
      if (previous.type !== 'text' && body.content !== previous.content) invalid('O texto de fontes importadas é somente leitura. Importe uma nova fonte para substituí-lo.')
      if (!body.content.trim()) invalid('Escreva o conteúdo da fonte.')
      const result = parse(await context.request(`/knowledge/${id(entryId)}`, { method: 'PATCH', body: { title: body.title, tags: body.tags, ...(previous.type === 'text' ? { content: body.content } : {}) } })); context.assertCurrent(); return result
    },
    async importUrl(title: string, address: string, tags: string[] = []) {
      const body = draft({ title, content: '', tags }), addressValue = url(address)
      if (!addressValue) invalid('Informe a URL pública da página.')
      const result = parse(await context.request('/knowledge/import-url', { method: 'POST', timeoutMs: 45000, body: { title: body.title, tags: body.tags, url: addressValue, agentId } })); context.assertCurrent(); return result
    },
    async upload(title: string, file: File, tags: string[] = []) {
      const body = draft({ title, content: '', tags }), data = await readKnowledgeFile(file); context.assertCurrent()
      const result = parse(await context.request('/knowledge/upload', { method: 'POST', timeoutMs: 45000, body: { title: body.title, tags: body.tags, agentId, ...data } })); context.assertCurrent(); return result
    },
    async ingest(entryId: string) {
      await get(entryId)
      const raw = await context.request('/knowledge/' + id(entryId) + '/ingest', { method: 'POST', timeoutMs: 45000, body: {} })
      if (!object(raw) || raw.knowledgeId !== entryId || raw.status !== 'indexed' || !count(raw.chunkCount) || raw.chunkCount < 1 || !text(raw.model, 1, 150) || typeof raw.cached !== 'boolean') invalid('A indexação não pôde ser confirmada. Consulte o estado da fonte.')
      context.assertCurrent(); return { knowledgeId: entryId, chunkCount: raw.chunkCount, model: raw.model, cached: raw.cached }
    },
    async remove(entryId: string) { await get(entryId); await context.request('/knowledge/' + id(entryId), { method: 'DELETE' }); context.assertCurrent() },
    async chunks(entryId: string, page = 1) {
      await get(entryId)
      const raw = await context.request('/knowledge/' + id(entryId) + '/chunks', { query: { page, limit: 25 } }); pageShape(raw, page, 25)
      const items = raw.items.map(item => {
        if (!object(item) || item.tenantId !== context.tenantId || item.agentId !== agentId || item.knowledgeId !== entryId || !text(item.id, 1, 128) || !text(item.content, 1) || !text(item.model, 1, 150) || 'embedding' in item) invalid()
        return { id: item.id, content: item.content, model: item.model, source: source(item.source, entryId) }
      }); context.assertCurrent(); return { ...raw, items }
    },
    async search(query: string, signal?: AbortSignal): Promise<KnowledgeMatch[]> {
      if (!text(query, 1, 8000) || !query.trim()) invalid('Escreva uma pergunta para buscar nas fontes indexadas.')
      const raw = await context.request('/knowledge/search', { method: 'POST', timeoutMs: 45000, body: { agentId, query: query.trim(), limit: 5 }, signal })
      if (!object(raw) || raw.mode !== 'vector' || !Array.isArray(raw.items) || raw.items.length > 5) invalid()
      const items = raw.items.map(item => {
        if (!object(item) || !text(item.knowledgeId, 1, 128) || !text(item.chunkId, 1, 128) || !text(item.title, 1, 200) || !text(item.type, 1, 100) || !text(item.text, 1) || typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < -1 || item.score > 1) invalid()
        return { knowledgeId: item.knowledgeId, chunkId: item.chunkId, title: item.title, type: item.type, text: item.text, score: item.score, source: source(item.source, item.knowledgeId) }
      }); context.assertCurrent(); return items
    },
  }
}
