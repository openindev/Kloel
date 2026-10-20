import type { Store } from '../../src/store.js';
import { ingestKnowledge } from '../../src/knowledge.js';

/** Real indexing lifecycle with an explicitly injected, non-network embedding transport. */
export async function seedIndexedKnowledge(store: Store, tenantId: string, agentId: string, content: string) {
  const entry = store.create(tenantId, 'knowledge', { agentId, title: 'Indexed fixture', type: 'text', content, indexed: false });
  await ingestKnowledge(store, tenantId, entry.id, {}, { apiKey: 'isolated-index-fixture', fetchImpl: (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({ data: body.input.map((_: unknown, index: number) => ({ index, embedding: [1, 0, 0] })) });
  }) as typeof fetch });
  return store.get(tenantId, 'knowledge', entry.id)!;
}
