import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { ingestKnowledge, retrieveKnowledge } from '../src/knowledge.js';
import { providerAllowedForTenant } from '../src/platform-providers.js';

const fetchImpl = (async (_url: string, init: RequestInit) => { const input = JSON.parse(String(init.body)).input as string[]; return new Response(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: [t.length % 7 + 1, index + 1, 0.5] })) }), { status: 200 }); }) as typeof fetch;

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return fn().finally(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test('pilot mode keeps platform credentials bound to PROVIDER_TENANT_ID', () => withEnv({ PLATFORM_AI_PROVIDERS: undefined, PROVIDER_TENANT_ID: 'joana' }, async () => {
  assert.equal(providerAllowedForTenant('joana'), true);
  assert.equal(providerAllowedForTenant('other'), false);
}));

test('platform mode indexes and searches for every org while keeping data isolated per org', () => withEnv({ PLATFORM_AI_PROVIDERS: '1', PROVIDER_TENANT_ID: 'joana', OPENAI_API_KEY: 'platform-key' }, async () => {
  const store = new Store(':memory:');
  try {
    const a = store.create('org-a', 'knowledge', { title: 'A', type: 'text', content: 'segredo da org A', tags: [], indexed: false, ingestionStatus: 'stored_text', chunkCount: 0 });
    const j = store.create('joana', 'knowledge', { title: 'J', type: 'text', content: 'horário da Joana', tags: [], indexed: false, ingestionStatus: 'stored_text', chunkCount: 0 });
    assert.equal((await ingestKnowledge(store, 'org-a', a.id, {}, { fetchImpl })).status, 'indexed');
    assert.equal((await ingestKnowledge(store, 'joana', j.id, {}, { fetchImpl })).status, 'indexed');
    const fromA = await retrieveKnowledge(store, 'org-a', { query: 'segredo', limit: 5 }, { fetchImpl });
    assert.deepEqual(fromA.items.map(i => i.knowledgeId), [a.id]);
    const fromJ = await retrieveKnowledge(store, 'joana', { query: 'segredo', limit: 5 }, { fetchImpl });
    assert.deepEqual(fromJ.items.map(i => i.knowledgeId), [j.id]);
    await assert.rejects(ingestKnowledge(store, 'org-a', j.id, {}, { fetchImpl }));
    assert.equal(providerAllowedForTenant(''), false);
  } finally { store.close(); }
}));
