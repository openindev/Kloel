import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { agentKnowledgeReferences, indexedKnowledgeEntries } from '../src/knowledge-authority.js';
import { executeAgentTool } from '../src/providers/agent-tools.js';
import { seedIndexedKnowledge } from './fixtures/knowledge.js';

test('knowledge references require the current agent flag, a complete current index and exact tenant/agent assignment', async t => {
  const store = new Store(); t.after(() => store.close());
  const agent = store.create('own', 'agents', { status: 'active', tools: ['search_knowledge'] });
  const valid = await seedIndexedKnowledge(store, 'own', agent.id, 'CURRENT SOURCE');
  store.create('own', 'knowledge', { agentId: agent.id, title: 'Draft', content: 'DRAFT SOURCE', indexed: false });
  const other = store.create('own', 'agents', { tools: ['search_knowledge'] });
  await seedIndexedKnowledge(store, 'own', other.id, 'OTHER AGENT');
  await seedIndexedKnowledge(store, 'foreign', agent.id, 'FOREIGN TENANT');
  assert.deepEqual(agentKnowledgeReferences(store, 'own', agent.id).map(item => item.content), ['CURRENT SOURCE']);
  store.update('own', 'agents', agent.id, { tools: [] });
  assert.deepEqual(agentKnowledgeReferences(store, 'own', agent.id), []);
  store.update('own', 'agents', agent.id, { tools: ['search_knowledge'] });
  store.update('own', 'knowledge', valid.id, { content: 'CHANGED WITHOUT REINDEX' });
  assert.deepEqual(agentKnowledgeReferences(store, 'own', agent.id), []);
  store.update('own', 'knowledge', valid.id, { content: 'CURRENT SOURCE' });
  const chunk = store.list('own', 'knowledge-chunks').find(item => item.knowledgeId === valid.id)!;
  store.remove('own', 'knowledge-chunks', chunk.id);
  assert.deepEqual(agentKnowledgeReferences(store, 'own', agent.id), []);
  assert.equal(indexedKnowledgeEntries(store, 'own').length, 1);
});

test('agent search never falls back to unindexed text and cannot replay stale indexed results', async t => {
  const store = new Store(), originalFetch = globalThis.fetch, saved = { tenant: process.env.PROVIDER_TENANT_ID, key: process.env.OPENAI_API_KEY };
  t.after(() => { store.close(); globalThis.fetch = originalFetch; for (const [key, value] of [['PROVIDER_TENANT_ID', saved.tenant], ['OPENAI_API_KEY', saved.key]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } });
  process.env.PROVIDER_TENANT_ID = 'own'; process.env.OPENAI_API_KEY = 'isolated-test-fixture';
  let upstreamCalls = 0;
  globalThis.fetch = (async () => { upstreamCalls++; return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] }); }) as typeof fetch;
  const agent = store.create('own', 'agents', { status: 'active', tools: ['search_knowledge'] }), context = { tenantId: 'own', agent, conversationId: 'conversation', trustedOperator: false };
  store.create('own', 'knowledge', { agentId: agent.id, content: 'secret unindexed policy', indexed: false });
  const empty = await executeAgentTool(store, context, { id: 'before-index', name: 'search_knowledge', arguments: '{"query":"secret policy"}' });
  assert.deepEqual(empty, { ok: true, method: 'vector', items: [] }); assert.equal(upstreamCalls, 0);
  const source = await seedIndexedKnowledge(store, 'own', agent.id, 'current indexed policy');
  const call = { id: 'indexed-query', name: 'search_knowledge', arguments: '{"query":"policy"}' };
  const first = await executeAgentTool(store, context, call); assert.equal((first.items as any[]).length, 1); assert.equal(upstreamCalls, 1);
  assert.deepEqual(await executeAgentTool(store, context, call), first); assert.equal(upstreamCalls, 1);
  store.update('own', 'knowledge', source.id, { content: 'edited policy', indexed: false });
  assert.equal((await executeAgentTool(store, context, call)).error, 'tool_call_id_conflict'); assert.equal(upstreamCalls, 1);
});

test('disabling the knowledge tool during embedding retrieval prevents returning the result', async t => {
  const store = new Store(), originalFetch = globalThis.fetch, oldTenant = process.env.PROVIDER_TENANT_ID, oldKey = process.env.OPENAI_API_KEY;
  t.after(() => { store.close(); globalThis.fetch = originalFetch; if (oldTenant === undefined) delete process.env.PROVIDER_TENANT_ID; else process.env.PROVIDER_TENANT_ID = oldTenant; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  process.env.PROVIDER_TENANT_ID = 'own'; process.env.OPENAI_API_KEY = 'isolated-fixture';
  const agent = store.create('own', 'agents', { status: 'active', tools: ['search_knowledge'] });
  await seedIndexedKnowledge(store, 'own', agent.id, 'private indexed policy');
  globalThis.fetch = (async () => { store.update('own', 'agents', agent.id, { tools: [] }); return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] }); }) as typeof fetch;
  const result = await executeAgentTool(store, { tenantId: 'own', agent, conversationId: 'conversation', trustedOperator: false }, { id: 'changed-during-query', name: 'search_knowledge', arguments: '{"query":"policy"}' });
  assert.equal(result.ok, false); assert.equal(result.error, 'tool_not_enabled'); assert.ok(!JSON.stringify(result).includes('private indexed policy'));
});
