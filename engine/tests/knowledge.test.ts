import { seedMember } from './fixtures/membership.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Store } from '../src/store.js';
import { registerDomains } from '../src/domains.js';
import { chunkText, cosineSimilarity, ingestKnowledge, registerKnowledge, retrieveKnowledge, type KnowledgeOptions } from '../src/knowledge.js';

function provider(vectors?: number[][], callback?: () => void): KnowledgeOptions {
  return { apiKey: 'test-not-a-real-key', fetchImpl: (async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/embeddings');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'text-embedding-3-small');
    callback?.();
    return Response.json({ data: body.input.map((_: unknown, index: number) => ({ index, embedding: vectors?.[index] ?? [1, 0, 0] })), usage: { prompt_tokens: 10, total_tokens: 10 } });
  }) as typeof fetch };
}
function entry(store: Store, tenant = 'tenant-a', content = 'Our office opens at nine in the morning.', extra: Record<string, unknown> = {}) {
  return store.create(tenant, 'knowledge', { title: 'Office policy', type: 'text', content, indexed: false, ...extra });
}

test('chunking preserves provenance offsets, overlap and complete source coverage', () => {
  const content = 'A paragraph with words.\n'.repeat(500) + '😊';
  const chunks = chunkText(content);
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1)?.end, content.length);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    assert.equal(chunk.text, content.slice(chunk.start, chunk.end));
    assert.ok(chunk.text.length <= 2000);
    if (i) assert.ok(chunk.start <= chunks[i - 1].end);
  }
  assert.deepEqual(chunkText('  \n  '), []);
  assert.throws(() => chunkText('test', 100, 100), /Invalid chunk configuration/);
});

test('real indexing path stores vectors and source evidence and caches unchanged inputs', async () => {
  const store = new Store();
  try {
    const source = entry(store);
    let calls = 0;
    const options = provider(undefined, () => calls++);
    const result = await ingestKnowledge(store, 'tenant-a', source.id, {}, options);
    assert.equal(result.status, 'indexed');
    assert.equal(result.cached, false);
    assert.equal(calls, 1);
    const chunks = store.list('tenant-a', 'knowledge-chunks');
    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0].embedding, [1, 0, 0]);
    assert.equal((chunks[0].source as any).knowledgeId, source.id);
    assert.equal((chunks[0].source as any).charEnd, String(source.content).length);
    assert.equal(store.get('tenant-a', 'knowledge', source.id)?.indexed, true);
    const cached = await ingestKnowledge(store, 'tenant-a', source.id, {}, options);
    assert.equal(cached.cached, true);
    assert.equal(calls, 1);
  } finally { store.close(); }
});

test('cosine search isolates tenants and agent assignment and includes source citations', async () => {
  const store = new Store();
  try {
    const agent = store.create('tenant-a', 'agents', { name: 'Agent' });
    const own = entry(store, 'tenant-a', 'Own policy', { agentId: agent.id });
    const other = entry(store, 'tenant-b', 'Other tenant secret');
    const unrelated = entry(store, 'tenant-a', 'Other agent policy');
    await ingestKnowledge(store, 'tenant-a', own.id, {}, provider());
    await ingestKnowledge(store, 'tenant-b', other.id, {}, provider());
    await ingestKnowledge(store, 'tenant-a', unrelated.id, {}, provider());
    const result = await retrieveKnowledge(store, 'tenant-a', { query: 'office policy', agentId: agent.id }, provider());
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].knowledgeId, own.id);
    assert.equal(result.items[0].score, 1);
    assert.equal(result.items[0].source.title, 'Office policy');
    await assert.rejects(retrieveKnowledge(store, 'tenant-b', { query: 'policy', agentId: agent.id }, provider()), /agent is unavailable/);
  } finally { store.close(); }
});

test('cosine similarity handles mismatched and zero vectors without NaN', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), -1);
  assert.equal(cosineSimilarity([1], [1, 1]), -1);
});

test('retrieval excludes stale text even when an internal writer bypasses domain invalidation', async () => {
  const store = new Store();
  try {
    const source = entry(store);
    await ingestKnowledge(store, 'tenant-a', source.id, {}, provider());
    store.update('tenant-a', 'knowledge', source.id, { content: 'A replacement policy' });
    let calls = 0;
    const result = await retrieveKnowledge(store, 'tenant-a', { query: 'opening time' }, provider(undefined, () => calls++));
    assert.equal(result.items.length, 0);
    assert.equal(calls, 0);
  } finally { store.close(); }
});

test('provider failures and invalid vectors never commit a partial index or expose credentials', async () => {
  const store = new Store();
  try {
    const source = entry(store);
    for (const response of [
      Response.json({ error: { message: 'sensitive provider detail' } }, { status: 401 }),
      Response.json({ data: [{ index: 0, embedding: [0, 0, 0] }] }),
      Response.json({ data: [{ index: 1, embedding: [1, 0, 0] }] }),
      new Response('not-json'),
    ]) {
      await assert.rejects(ingestKnowledge(store, 'tenant-a', source.id, {}, { apiKey: 'not-a-real-key', fetchImpl: (async () => response) as typeof fetch }), error => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('sensitive provider detail'));
        assert.ok(!error.message.includes('not-a-real-key'));
        return true;
      });
      assert.equal(store.list('tenant-a', 'knowledge-chunks').length, 0);
      assert.equal(store.get('tenant-a', 'knowledge', source.id)?.indexed, false);
    }
  } finally { store.close(); }
});

test('indexing rejects stale results if source was edited during the upstream request', async () => {
  const store = new Store();
  try {
    const source = entry(store);
    await assert.rejects(ingestKnowledge(store, 'tenant-a', source.id, {}, provider(undefined, () => store.update('tenant-a', 'knowledge', source.id, { content: 'Changed concurrently' }))), /changed during indexing/);
    assert.equal(store.list('tenant-a', 'knowledge-chunks').length, 0);
  } finally { store.close(); }
});

test('direct indexing rejects URLs and PDFs without extraction provenance; plain text documents are supported', async () => {
  const store = new Store();
  try {
    const url = entry(store, 'tenant-a', '', { type: 'url', url: 'http://127.0.0.1/private' });
    const pdf = entry(store, 'tenant-a', '', { type: 'document', document: { mimeType: 'application/pdf', filename: 'test.pdf' } });
    await assert.rejects(ingestKnowledge(store, 'tenant-a', url.id, {}, provider()), /URL crawling is not implemented/);
    await assert.rejects(ingestKnowledge(store, 'tenant-a', pdf.id, { content: 'Extracted text' }, provider()), /PDF\/OCR extraction is not implemented/);
    const plain = entry(store, 'tenant-a', '', { type: 'document', document: { mimeType: 'text/plain', filename: 'hours.txt' } });
    await ingestKnowledge(store, 'tenant-a', plain.id, { content: 'Opening hours: 9 to 5' }, provider());
    assert.equal((store.list('tenant-a', 'knowledge-chunks')[0].source as any).filename, 'hours.txt');
  } finally { store.close(); }
});

test('domain update and delete invalidate embeddings, and chunk API omits raw vectors', async () => {
  const store = new Store();
  const app = Fastify();
  try {
    app.addHook('preHandler', async request => { request.actor = { tenantId: 'tenant-a', userId: 'user', role: 'owner' }; seedMember(store, request.actor); });
    await registerDomains(app, store);
    await registerKnowledge(app, store, provider());
    const created = await app.inject({ method: 'POST', url: '/api/v1/knowledge', payload: { title: 'Policy', type: 'text', content: 'Stored text' } });
    const source = created.json();
    const index = await app.inject({ method: 'POST', url: `/api/v1/knowledge/${source.id}/ingest`, payload: {} });
    assert.equal(index.statusCode, 200);
    const chunks = await app.inject({ url: `/api/v1/knowledge/${source.id}/chunks` });
    assert.equal(chunks.json().total, 1);
    assert.equal(chunks.json().items[0].embedding, undefined);
    const update = await app.inject({ method: 'PATCH', url: `/api/v1/knowledge/${source.id}`, payload: { content: 'Updated policy' } });
    assert.equal(update.json().indexed, false);
    assert.equal(update.json().chunkCount, 0);
    assert.equal(store.list('tenant-a', 'knowledge-chunks').length, 0);
    await app.inject({ method: 'POST', url: `/api/v1/knowledge/${source.id}/ingest`, payload: {} });
    assert.equal(store.list('tenant-a', 'knowledge-chunks').length, 1);
    const deletion = await app.inject({ method: 'DELETE', url: `/api/v1/knowledge/${source.id}` });
    assert.equal(deletion.statusCode, 204);
    assert.equal(store.list('tenant-a', 'knowledge-chunks').length, 0);
  } finally { await app.close(); store.close(); }
});

test('HTTP indexing requires knowledge write permission and retrieval requires authentication', async () => {
  const store = new Store();
  const app = Fastify();
  try {
    const source = entry(store);
    app.addHook('preHandler', async request => {
      if (!request.headers['x-anonymous']) { request.actor = { tenantId: 'tenant-a', userId: 'user', role: 'member' }; seedMember(store, request.actor); }
    });
    await registerKnowledge(app, store, provider());
    const denied = await app.inject({ method: 'POST', url: `/api/v1/knowledge/${source.id}/ingest`, payload: {} });
    assert.equal(denied.statusCode, 403);
    const unauthenticated = await app.inject({ method: 'POST', url: '/api/v1/knowledge/search', payload: { query: 'secret' }, headers: { 'x-anonymous': 'true' } });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(store.list('tenant-a', 'knowledge-chunks').length, 0);
  } finally { await app.close(); store.close(); }
});

test('global OpenAI credentials cannot be consumed by another tenant', async () => {
  const store = new Store();
  const previous = process.env.PROVIDER_TENANT_ID;
  try {
    const source = entry(store, 'tenant-attacker');
    process.env.PROVIDER_TENANT_ID = 'tenant-provider-owner';
    let calls = 0;
    const mockedFetch = (async () => { calls++; throw new Error('Upstream must not be called'); }) as typeof fetch;
    await assert.rejects(ingestKnowledge(store, 'tenant-attacker', source.id, {}, { fetchImpl: mockedFetch }), /not bound/);
    assert.equal(calls, 0);
    delete process.env.PROVIDER_TENANT_ID;
    await assert.rejects(ingestKnowledge(store, 'tenant-attacker', source.id, {}, { fetchImpl: mockedFetch }), /Bind the OpenAI provider/);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.PROVIDER_TENANT_ID; else process.env.PROVIDER_TENANT_ID = previous;
    store.close();
  }
});
