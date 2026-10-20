import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { startKnowledgeBackfill, retrieveKnowledge } from '../src/knowledge.js';

test('background backfill indexes entries whose inline ingest never ran, and skips deterministic failures', async () => {
  const store = new Store(':memory:');
  const previous = process.env.PROVIDER_TENANT_ID; process.env.PROVIDER_TENANT_ID = 't1';
  let calls = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => { calls++; const input = JSON.parse(String(init.body)).input as string[]; return new Response(JSON.stringify({ data: input.map((_t, index) => ({ index, embedding: [1, index + 1, 0.5] })), usage: { prompt_tokens: 1, total_tokens: 1 } }), { status: 200 }); }) as typeof fetch;
  try {
    const ok = store.create('t1', 'knowledge', { title: 'Horário', type: 'text', content: 'Abrimos 9h', tags: [], indexed: false, ingestionStatus: 'stored_text', chunkCount: 0 });
    const bad = store.create('t1', 'knowledge', { title: 'URL sem prova', type: 'url', content: 'x', tags: [], indexed: false, ingestionStatus: 'extracted', chunkCount: 0 });
    const backfill = startKnowledgeBackfill(store, { apiKey: 'k', fetchImpl, initialDelayMs: 1e9, intervalMs: 1e9 });
    await backfill.tick();
    assert.equal(store.get('t1', 'knowledge', ok.id)?.indexed, true);
    assert.equal(store.get('t1', 'knowledge', bad.id)?.indexed, false);
    const before = calls; await backfill.tick(); assert.equal(calls, before);
    const found = await retrieveKnowledge(store, 't1', { query: 'horario', limit: 3 }, { apiKey: 'k', fetchImpl });
    assert.equal(found.items[0]?.knowledgeId, ok.id);
    await backfill.stop();
  } finally { if (previous === undefined) delete process.env.PROVIDER_TENANT_ID; else process.env.PROVIDER_TENANT_ID = previous; store.close(); }
});
