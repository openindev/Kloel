import { seedIndexedKnowledge } from './fixtures/knowledge.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store, type Entity } from '../src/store.js';
import { createWhatsAppWorker, enqueueInboundReply } from '../src/providers/worker.js';

let store: Store; let time: number; let agent: Entity; let channel: Entity; let conversation: Entity;
const originalEnv = { ...process.env }; const originalFetch = globalThis.fetch;
beforeEach(() => {
  store = new Store(); time = Date.now() + 1000;
  process.env.META_PHONE_NUMBER_ID = 'phone-1'; process.env.PROVIDER_TENANT_ID = 'worker-tenant'; process.env.WHATSAPP_AUTOREPLY_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'test-key'; process.env.OPENAI_MODEL = 'test-model';
  agent = store.create('worker-tenant', 'agents', { name: 'Assistente', status: 'active', prompt: 'Atenda em português', tools: [] });
  channel = store.create('worker-tenant', 'channels', { type: 'whatsapp', provider: 'meta', enabled: true, agentId: agent.id, configuration: { externalId: 'phone-1' } });
  conversation = store.create('worker-tenant', 'conversations', { channel: 'whatsapp', status: 'open' });
});
afterEach(() => {
  store.close(); globalThis.fetch = originalFetch;
  for (const key of ['PROVIDER_TENANT_ID', 'WHATSAPP_AUTOREPLY_ENABLED', 'WHATSAPP_MAX_REPLIES_PER_DAY', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'META_GRAPH_VERSION', 'META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID']) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});
function incoming(timestamp = time, content = 'Olá', type = 'text') {
  const message = store.create('worker-tenant', 'messages', { conversationId: conversation.id, role: 'user', source: 'meta', content, providerMessageId: `wamid.${store.list('worker-tenant', 'messages').length}`, externalContact: '+5511999999999' });
  return { message, job: enqueueInboundReply(store, 'worker-tenant', { message, conversation, phoneNumberId: 'phone-1', providerTimestamp: String(Math.floor(timestamp / 1000)), messageType: type }) };
}
const generated = async () => ({ text: 'Olá, como posso ajudar?', responseId: 'resp_worker', usage: { total_tokens: 20 } });

test('only an explicitly enabled bound channel enqueues; provider duplicate source messages share one job', () => {
  store.update('worker-tenant', 'channels', channel.id, { enabled: false });
  assert.equal(incoming().job, undefined);
  store.update('worker-tenant', 'channels', channel.id, { enabled: true });
  const { message, job } = incoming();
  const duplicate = enqueueInboundReply(store, 'worker-tenant', { message, conversation, phoneNumberId: 'phone-1', providerTimestamp: String(Math.floor(time / 1000)), messageType: 'text' });
  assert.equal(duplicate?.id, job?.id); assert.equal(store.list('worker-tenant', 'reply-jobs').length, 1);
});

test('transactional inbound replies need no marketing consent and persist only actual accepted sends', async () => {
  const { job } = incoming(); let sends = 0;
  const worker = createWhatsAppWorker(store, { now: () => time, generate: generated, send: async (pending, text) => { sends++; assert.equal(pending.recipient, '+5511999999999'); assert.ok(text); return 'wamid.accepted'; } });
  assert.deepEqual(await worker.tick(), { processed: 1, status: 'sent' });
  assert.equal(store.get('worker-tenant', 'reply-jobs', job!.id)?.status, 'sent');
  assert.equal(store.list('worker-tenant', 'messages').filter(m => m.role === 'assistant').length, 1);
  assert.equal((await worker.tick()).status, 'idle'); assert.equal(sends, 1); await worker.stop();
});

test('runtime opt-in disabled means no generation or sending', async () => {
  incoming(); delete process.env.WHATSAPP_AUTOREPLY_ENABLED; let generated = false;
  const worker = createWhatsAppWorker(store, { now: () => time, generate: async () => { generated = true; throw new Error('never'); } });
  assert.equal((await worker.tick()).status, 'disabled'); assert.equal(generated, false); await worker.stop();
});

test('human takeover during inference stops send, preserving generated reply for review', async () => {
  const { job } = incoming(); let sends = 0;
  const worker = createWhatsAppWorker(store, { now: () => time, generate: async () => { store.update('worker-tenant', 'conversations', conversation.id, { status: 'pending' }); return generated(); }, send: async () => { sends++; return 'unexpected'; } });
  assert.equal((await worker.tick()).status, 'human_handoff'); assert.equal(sends, 0);
  assert.equal(store.get('worker-tenant', 'reply-jobs', job!.id)?.status, 'paused'); await worker.stop();
});

test('outside the 24 hour window and unsupported media never trigger free-text sends', async () => {
  const { job } = incoming(time - 86401000);
  const worker = createWhatsAppWorker(store, { now: () => time, generate: async () => { throw new Error('must not generate'); } });
  assert.equal((await worker.tick()).status, 'outside_24h_window');
  assert.equal(store.get('worker-tenant', 'reply-jobs', job!.id)?.status, 'paused');
  assert.equal(incoming(time, '[audio]', 'audio').job?.status, 'unsupported_media');
  assert.equal((await worker.tick()).status, 'idle'); await worker.stop();
});

test('uncertain outbound failure is durable and never automatically resent', async () => {
  const { job } = incoming(); let sends = 0;
  const worker = createWhatsAppWorker(store, { now: () => time, generate: generated, send: async () => { sends++; throw new Error('lost response after request sent'); } });
  assert.equal((await worker.tick()).status, 'requires_reconciliation');
  time += 3600000;
  assert.equal((await worker.tick()).status, 'idle'); assert.equal(sends, 1);
  assert.equal(store.get('worker-tenant', 'reply-jobs', job!.id)?.status, 'requires_reconciliation');
  assert.equal(store.list('worker-tenant', 'messages').filter(m => m.role === 'assistant').length, 0); await worker.stop();
});

test('two worker instances cannot claim and send the same durable job', async () => {
  incoming(); let release!: () => void; let sends = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const deps = { now: () => time, generate: async () => { await gate; return generated(); }, send: async () => { sends++; return 'wamid.single'; } };
  const a = createWhatsAppWorker(store, deps); const b = createWhatsAppWorker(store, deps);
  const running = a.tick();
  assert.equal((await b.tick()).status, 'idle'); release(); assert.equal((await running).status, 'sent');
  assert.equal(sends, 1); await a.stop(); await b.stop();
});

test('a newer inbound message supersedes queued reply to avoid duplicate stale answers', async () => {
  const first = incoming(); const second = incoming(time, 'Na verdade preciso agendar.'); let sends = 0;
  assert.equal(store.get('worker-tenant', 'reply-jobs', first.job!.id)?.status, 'superseded');
  const worker = createWhatsAppWorker(store, { now: () => time, generate: generated, send: async job => { sends++; assert.equal(job.id, second.job!.id); return 'wamid.latest'; } });
  assert.equal((await worker.tick()).status, 'sent'); assert.equal(sends, 1); await worker.stop();
});

test('retryable model throttling retries boundedly before sending and records real token usage', async () => {
  incoming(); let requests = 0; let sends = 0;
  globalThis.fetch = (async () => {
    requests++;
    if (requests === 1) return Response.json({ error: 'limit' }, { status: 429 });
    return Response.json({ id: 'resp_real_adapter', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Bem-vindo!' }] }], usage: { total_tokens: 42 } });
  }) as typeof fetch;
  const worker = createWhatsAppWorker(store, { now: () => time, send: async () => { sends++; return 'wamid.retry'; } });
  assert.equal((await worker.tick()).status, 'queued'); assert.equal((await worker.tick()).status, 'idle');
  time += 11000; assert.equal((await worker.tick()).status, 'sent');
  assert.equal(requests, 2); assert.equal(sends, 1); assert.equal((store.list('worker-tenant', 'provider-usage')[0].usage as any).total_tokens, 42); await worker.stop();
});

test('interrupted sending is reconciled without retry and daily limit stops new generation', async () => {
  const { job } = incoming(); store.update('worker-tenant', 'reply-jobs', job!.id, { status: 'sending', startedAt: time - 16 * 60000 });
  const worker = createWhatsAppWorker(store, { now: () => time, generate: generated, send: async () => { throw new Error('never'); } });
  assert.equal((await worker.tick()).status, 'idle'); assert.equal(store.get('worker-tenant', 'reply-jobs', job!.id)?.status, 'requires_reconciliation');
  process.env.WHATSAPP_MAX_REPLIES_PER_DAY = '1'; store.update('worker-tenant', 'reply-jobs', job!.id, { status: 'sent', sentAt: time }); incoming(time, 'Nova mensagem');
  assert.equal((await worker.tick()).status, 'daily_limit'); await worker.stop();
});

test('WhatsApp generation uses only enabled indexed sources and rejects source changes before send', async () => {
  const source = await seedIndexedKnowledge(store, 'worker-tenant', agent.id, 'VALID-INDEXED-REFERENCE');
  store.create('worker-tenant', 'knowledge', { agentId: agent.id, content: 'DRAFT-MUST-NOT-LEAK', indexed: false });
  let sends = 0, expectReference = false, invalidateDuringReply = false;
  globalThis.fetch = (async (_url, init) => {
    const serialized = String(init?.body); assert.equal(serialized.includes('VALID-INDEXED-REFERENCE'), expectReference); assert.ok(!serialized.includes('DRAFT-MUST-NOT-LEAK'));
    if (invalidateDuringReply) store.update('worker-tenant', 'knowledge', source.id, { indexed: false });
    return Response.json({ id: 'reply', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta neutra.' }] }] });
  }) as typeof fetch;
  const worker = createWhatsAppWorker(store, { now: () => time, send: async () => { sends++; return 'wamid.fixture-' + sends; } });
  incoming(); assert.equal((await worker.tick()).status, 'sent'); assert.equal(sends, 1);
  store.update('worker-tenant', 'agents', agent.id, { tools: ['search_knowledge'] }); expectReference = true;
  incoming(time, 'Segunda'); assert.equal((await worker.tick()).status, 'sent'); assert.equal(sends, 2);
  invalidateDuringReply = true; const { job } = incoming(time, 'Terceira');
  assert.equal((await worker.tick()).status, 'failed'); assert.equal(sends, 2); assert.equal(store.get('worker-tenant', 'reply-jobs', job!.id)?.errorCode, 'knowledge_changed');
  await worker.stop();
});
