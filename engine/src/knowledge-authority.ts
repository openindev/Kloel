import { createHash } from 'node:crypto';
import type { Entity, Store } from './store.js';

/** Saving a source is not permission to use an unindexed or invalidated version. */
export function currentKnowledgeIndex(entry: Entity | undefined): entry is Entity {
  return !!entry && entry.indexed === true && typeof entry.content === 'string' && typeof entry.embeddingModel === 'string'
    && entry.sourceHash === createHash('sha256').update(JSON.stringify({ content: entry.content, model: entry.embeddingModel })).digest('hex');
}

export function indexedKnowledgeEntries(store: Store, tenantId: string): Entity[] {
  const chunks = store.list(tenantId, 'knowledge-chunks');
  return store.list(tenantId, 'knowledge').filter(entry => {
    if (!currentKnowledgeIndex(entry) || !Number.isSafeInteger(entry.chunkCount) || Number(entry.chunkCount) < 1) return false;
    const matching = chunks.filter(chunk => chunk.knowledgeId === entry.id);
    return matching.length === entry.chunkCount && matching.every(chunk => chunk.sourceHash === entry.sourceHash && chunk.model === entry.embeddingModel && (chunk.agentId ?? null) === (entry.agentId ?? null));
  });
}

/** Resolve the current agent flag from the store; captured objects are not authority. */
export function agentKnowledgeReferences(store: Store, tenantId: string, agentId: string) {
  const agent = store.get(tenantId, 'agents', agentId);
  if (!agent || !Array.isArray(agent.tools) || !agent.tools.includes('search_knowledge')) return [];
  return indexedKnowledgeEntries(store, tenantId).filter(entry => entry.agentId === agentId).slice(0, 10)
    .map(entry => ({ id: entry.id, title: String(entry.title ?? ''), content: String(entry.content).slice(0, 8000) }));
}
