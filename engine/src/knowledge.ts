import { currentKnowledgeIndex, indexedKnowledgeEntries } from './knowledge-authority.js';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { DomainError } from './domains.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { providerAllowedForTenant, platformProvidersEnabled } from './platform-providers.js';

export type KnowledgeOptions = { apiKey?: string; fetchImpl?: typeof fetch; model?: string; assertAccess?: () => void };
const defaultModel = 'text-embedding-3-small';
const searchSchema = z.object({ query: z.string().trim().min(1).max(8000), agentId: z.string().min(1).max(128).optional(), limit: z.number().int().min(1).max(20).default(5), minScore: z.number().min(-1).max(1).default(-1) }).strict();
type SearchInput = { query: string; agentId?: string; limit?: number; minScore?: number };
type Chunk = { text: string; index: number; start: number; end: number };
export type KnowledgeMatch = { knowledgeId: string; chunkId: string; title: string; type: string; text: string; score: number; source: { knowledgeId: string; title: string; type: string; chunkIndex: number; charStart: number; charEnd: number; url: string | null; filename: string | null; pageNumbers?: number[]; sourceSha256?: string | null } };

function modelName(options: KnowledgeOptions) { return options.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? defaultModel; }
function fingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function requireEntry(store: Store, tenantId: string, id: string): Entity {
  const entry = store.get(tenantId, 'knowledge', id);
  if (!entry) throw new DomainError(404, 'not_found', 'Knowledge entry not found');
  return entry;
}

/** Character offsets always refer to the supplied source text, including overlap. */
export function chunkText(content: string, size = 2000, overlap = 200): Chunk[] {
  if (!Number.isInteger(size) || !Number.isInteger(overlap) || size < 100 || overlap < 0 || overlap >= size) throw new Error('Invalid chunk configuration');
  const chunks: Chunk[] = [];
  for (let start = 0; start < content.length;) {
    let end = Math.min(start + size, content.length);
    if (end < content.length) {
      const paragraph = content.lastIndexOf('\n', end);
      const word = content.lastIndexOf(' ', end);
      const boundary = paragraph > start + size / 2 ? paragraph : word;
      if (boundary > start + size / 2) end = boundary;
      // Do not split the UTF-16 surrogate pair used by an astral character.
      if (end > start && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
    }
    const body = content.slice(start, end);
    if (body.trim()) chunks.push({ text: body, index: chunks.length, start, end });
    if (end === content.length) break;
    start = Math.max(start + 1, end - overlap);
    if (/[\uDC00-\uDFFF]/.test(content[start])) start++;
  }
  return chunks;
}

async function embeddings(tenantId: string, input: string[], options: KnowledgeOptions): Promise<{ vectors: number[][]; usage: { prompt_tokens: number; total_tokens: number } | null }> {
  options.assertAccess?.();
  // Explicit dependency-injected credentials belong to the trusted embedding adapter
  // (used by isolated tests). The global pilot account is bound to exactly one tenant.
  if (options.apiKey === undefined) {
    if (!platformProvidersEnabled() && !process.env.PROVIDER_TENANT_ID) throw new DomainError(503, 'integration_not_configured', 'Bind the OpenAI provider to an organization before indexing');
    if (!providerAllowedForTenant(tenantId)) throw new DomainError(403, 'provider_tenant_mismatch', 'The OpenAI provider is not bound to this organization');
  }
  const key = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new DomainError(503, 'integration_not_configured', 'OpenAI must be configured for knowledge indexing and vector retrieval');
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName(options), input, encoding_format: 'float' }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new DomainError(502, 'embedding_provider_unavailable', 'The embedding provider could not be reached'); }
  if (!response.ok) throw new DomainError(response.status === 429 ? 429 : 502, response.status === 429 ? 'embedding_rate_limited' : 'embedding_provider_error', 'The embedding provider did not complete the request');
  let body: unknown;
  try { body = await response.json(); } catch { throw new DomainError(502, 'invalid_embedding_response', 'The embedding provider returned an invalid response'); }
  options.assertAccess?.();
  const parsed = z.object({ data: z.array(z.object({ index: z.number().int().min(0), embedding: z.array(z.number().finite()).min(1).max(8192) })), usage: z.object({ prompt_tokens: z.number().int().min(0), total_tokens: z.number().int().min(0) }).optional() }).safeParse(body);
  if (!parsed.success || parsed.data.data.length !== input.length) throw new DomainError(502, 'invalid_embedding_response', 'The embedding response does not match the requested chunks');
  const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index);
  const dimensions = ordered[0]?.embedding.length;
  if (ordered.some((item, index) => item.index !== index || item.embedding.length !== dimensions || item.embedding.every(value => value === 0))) throw new DomainError(502, 'invalid_embedding_response', 'The embedding response contains invalid vectors');
  return { vectors: ordered.map(item => item.embedding), usage: parsed.data.usage ?? null };
}

export async function ingestKnowledge(store: Store, tenantId: string, id: string, input: unknown = {}, options: KnowledgeOptions = {}) {
  options.assertAccess?.();
  const body = z.object({ content: z.string().min(1).max(100_000).optional() }).strict().parse(input);
  const entry = requireEntry(store, tenantId, id);
  const sourceProof = entry.extraction as { status?: string; textSha256?: string } | null | undefined;
  const extracted = sourceProof?.status === 'extracted' && sourceProof.textSha256 === createHash('sha256').update(String(entry.content ?? '')).digest('hex') && (!body.content || body.content === entry.content);
  if (entry.type === 'url' && !extracted) throw new DomainError(422, 'source_import_required', 'URL crawling is not implemented by this endpoint. Import the URL through /knowledge/import-url before indexing.');
  if (entry.type === 'document') {
    const metadata = entry.document as { mimeType?: string } | undefined;
    if (!['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(metadata?.mimeType ?? '') && !(metadata?.mimeType === 'application/pdf' && extracted)) throw new DomainError(422, 'document_format_unavailable', 'This endpoint accepts plain-text documents. PDF/OCR extraction is not implemented by this endpoint; upload PDFs through /knowledge/upload. OCR remains unavailable.');
  }
  const content = body.content ?? String(entry.content ?? '');
  if (!content.trim() || content.length > 100_000) throw new DomainError(400, 'content_required', 'Provide source text containing 1–100000 characters');
  const chunks = chunkText(content);
  const model = modelName(options);
  const sourceHash = fingerprint({ content, model });
  const existing = store.list(tenantId, 'knowledge-chunks').filter(item => item.knowledgeId === id);
  if (entry.indexed === true && entry.sourceHash === sourceHash && existing.length === chunks.length && existing.every(item => item.sourceHash === sourceHash)) return { knowledgeId: id, status: 'indexed', chunkCount: existing.length, model, cached: true, usage: null };
  const before = fingerprint(entry);
  const result = await embeddings(tenantId, chunks.map(chunk => chunk.text), options);
  return store.transaction(() => {
    options.assertAccess?.();
    const current = requireEntry(store, tenantId, id);
    if (fingerprint(current) !== before) throw new DomainError(409, 'knowledge_changed', 'Knowledge changed during indexing; retry with the current version');
    for (const item of store.list(tenantId, 'knowledge-chunks').filter(item => item.knowledgeId === id)) store.remove(tenantId, 'knowledge-chunks', item.id);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const document = entry.document as { filename?: string } | undefined;
      const extraction = entry.extraction as { sourceSha256?: string; pages?: { page: number; charStart: number; charEnd: number }[] } | undefined;
      store.create(tenantId, 'knowledge-chunks', {
        knowledgeId: id, agentId: entry.agentId ?? null, content: chunk.text, embedding: result.vectors[index], model, sourceHash,
        source: { knowledgeId: id, title: entry.title, type: entry.type, chunkIndex: chunk.index, charStart: chunk.start, charEnd: chunk.end, url: entry.url ?? null, filename: document?.filename ?? null, pageNumbers: extraction?.pages?.filter(page => chunk.start < page.charEnd && chunk.end > page.charStart).map(page => page.page) ?? [], sourceSha256: extraction?.sourceSha256 ?? null },
      });
    }
    store.update(tenantId, 'knowledge', id, { content, ingestionStatus: 'indexed', indexed: true, embeddingModel: model, chunkCount: chunks.length, sourceHash, indexedAt: new Date().toISOString() });
    return { knowledgeId: id, status: 'indexed', chunkCount: chunks.length, model, cached: false, usage: result.usage };
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return -1;
  let dot = 0; let normA = 0; let normB = 0;
  for (let index = 0; index < a.length; index++) { dot += a[index] * b[index]; normA += a[index] ** 2; normB += b[index] ** 2; }
  return normA && normB ? Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB))) : -1;
}

export async function retrieveKnowledge(store: Store, tenantId: string, input: SearchInput, options: KnowledgeOptions = {}): Promise<{ items: KnowledgeMatch[]; model: string; mode: 'vector'; usage: { prompt_tokens: number; total_tokens: number } | null }> {
  options.assertAccess?.();
  const query = searchSchema.parse(input);
  if (query.agentId && !store.get(tenantId, 'agents', query.agentId)) throw new DomainError(400, 'invalid_reference', 'The requested agent is unavailable');
  const model = modelName(options);
  const entries = new Map(indexedKnowledgeEntries(store, tenantId).filter(item => !query.agentId || item.agentId === query.agentId).map(item => [item.id, item]));
  const chunks = store.list(tenantId, 'knowledge-chunks').filter(item => entries.has(String(item.knowledgeId)) && item.model === model && item.sourceHash === entries.get(String(item.knowledgeId))!.sourceHash);
  if (!chunks.length) return { items: [], model, mode: 'vector', usage: null };
  const result = await embeddings(tenantId, [query.query], options);
  const currentChunks = chunks.filter(chunk => {
    const current = store.get(tenantId, 'knowledge', String(chunk.knowledgeId));
    return currentKnowledgeIndex(current) && current.sourceHash === chunk.sourceHash && Array.isArray(chunk.embedding) && chunk.embedding.length === result.vectors[0].length;
  });
  const items = currentChunks.map(chunk => {
    const entry = entries.get(String(chunk.knowledgeId))!;
    return { knowledgeId: entry.id, chunkId: chunk.id, title: String(entry.title), type: String(entry.type), text: String(chunk.content), score: cosineSimilarity(result.vectors[0], chunk.embedding as number[]), source: chunk.source as KnowledgeMatch['source'] };
  }).filter(item => item.score >= query.minScore).sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId)).slice(0, query.limit);
  return { items, model, mode: 'vector', usage: result.usage };
}

function handler(fn: (request: FastifyRequest, reply: FastifyReply) => unknown) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await fn(request, reply); }
    catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Invalid knowledge request' } });
      throw error;
    }
  };
}

export async function registerKnowledge(app: FastifyInstance, store: Store, options: KnowledgeOptions = {}): Promise<void> {
  app.post('/api/v1/knowledge/:id/ingest', handler(request => {
    const current = requireRequestPermission(store, request, 'knowledge:write');
    const { id } = z.object({ id: z.string().min(1).max(128) }).strict().parse(request.params);
    return ingestKnowledge(store, current.tenantId, id, request.body ?? {}, { ...options, assertAccess: () => { requireRequestPermission(store, request, 'knowledge:write'); options.assertAccess?.(); } });
  }));
  app.post('/api/v1/knowledge/search', handler(request => {
    const current = requireRequestPermission(store, request, 'knowledge:read');
    return retrieveKnowledge(store, current.tenantId, searchSchema.parse(request.body), { ...options, assertAccess: () => { requireRequestPermission(store, request, 'knowledge:read'); options.assertAccess?.(); } });
  }));
  app.get('/api/v1/knowledge/:id/chunks', handler(request => {
    const current = requireRequestPermission(store, request, 'knowledge:read');
    const { id } = z.object({ id: z.string().min(1).max(128) }).strict().parse(request.params);
    requireEntry(store, current.tenantId, id);
    const { page, limit } = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict().parse(request.query);
    const all = store.list(current.tenantId, 'knowledge-chunks').filter(item => item.knowledgeId === id).sort((a, b) => Number((a.source as Record<string, unknown>).chunkIndex) - Number((b.source as Record<string, unknown>).chunkIndex));
    return { items: all.slice((page - 1) * limit, page * limit).map(({ embedding, ...item }) => item), page, limit, total: all.length, totalPages: Math.ceil(all.length / limit) };
  }));
}

/**
 * Self-healing indexer: entries whose inline ingest was skipped or failed transiently
 * (provider 5xx, network timeout, API-created entries) are retried in the background
 * for the provider-bound tenant. Deterministic 4xx failures are not retried until the
 * entry changes, so no provider spend loops on the same source.
 */
export function startKnowledgeBackfill(store: Store, options: KnowledgeOptions & { intervalMs?: number; initialDelayMs?: number } = {}) {
  const skipped = new Map<string, string>();
  let running = false; let stopped = false;
  const tick = async () => {
    const tenants = platformProvidersEnabled() ? (store.db.prepare("SELECT id FROM organizations WHERE status='active'").all() as { id: string }[]).map(row => row.id) : [process.env.PROVIDER_TENANT_ID].filter((id): id is string => !!id);
    if (running || stopped || !tenants.length || !(options.apiKey ?? process.env.OPENAI_API_KEY)) return;
    running = true;
    try {
      for (const tenantId of tenants) for (const entry of store.list(tenantId, 'knowledge')) {
        if (stopped) break;
        if (entry.indexed === true && currentKnowledgeIndex(entry)) continue;
        const version = String(entry.updatedAt ?? '') + ':' + String(entry.sourceHash ?? '') + ':' + createHash('sha256').update(String(entry.content ?? '')).digest('hex');
        if (skipped.get(tenantId + ':' + entry.id) === version) continue;
        try { await ingestKnowledge(store, tenantId, entry.id, {}, options); skipped.delete(tenantId + ':' + entry.id); }
        catch (error) {
          if (error instanceof DomainError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 409 && error.statusCode !== 429) skipped.set(tenantId + ':' + entry.id, version);
          if (error instanceof DomainError && error.statusCode === 429) break;
        }
      }
    } catch { /* store unavailable during shutdown */ }
    finally { running = false; }
  };
  const first = setTimeout(() => { void tick(); }, options.initialDelayMs ?? 15_000);
  const timer = setInterval(() => { void tick(); }, options.intervalMs ?? 120_000);
  first.unref?.(); timer.unref?.();
  return { tick, stop: async () => { stopped = true; clearTimeout(first); clearInterval(timer); while (running) await new Promise(resolve => setTimeout(resolve, 50)); } };
}
