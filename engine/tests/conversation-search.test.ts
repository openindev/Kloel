import test from 'node:test';
import assert from 'node:assert/strict';
import { registerConversationSearch } from '../src/conversation-search.js';
import { afterConversationFixture } from './fixtures/after-conversation.js';

const fixture = (t: Parameters<typeof afterConversationFixture>[0]) => afterConversationFixture(t, registerConversationSearch);
test('search returns only IDs for tenant Inbox channels including unloaded messages, with stable pagination and no writes', async t => {
  const f = await fixture(t), tenant = f.actor.tenantId;
  const first = f.store.create(tenant, 'conversations', { channel: 'phone', subject: 'ASSUNTO cliente' });
  const second = f.store.create(tenant, 'conversations', { channel: 'whatsapp', subject: 'Outro' });
  f.store.create(tenant, 'messages', { conversationId: second.id, content: 'Contexto de cliente na transcrição.' });
  for (const [scope, channel] of [[tenant, 'email'], ['foreign', 'whatsapp'], [tenant, 'sms']]) {
    const row = f.store.create(scope, 'conversations', { channel, subject: 'cliente' });
    f.store.create(scope, 'messages', { conversationId: row.id, content: 'cliente' });
  }
  const before = f.store.db.prepare('SELECT * FROM entities ORDER BY id').all();
  const all = await f.request('GET', '/api/v1/conversation-search?q=CLIENTE'); assert.equal(all.statusCode, 200, all.body);
  assert.deepEqual(new Set(all.json().items.map((row: any) => row.id)), new Set([first.id, second.id]));
  assert.deepEqual(Object.keys(all.json().items[0]), ['id']); assert.equal(all.headers['cache-control'], 'no-store');
  const page = await f.request('GET', '/api/v1/conversation-search?q=cliente&page=2&limit=1');
  assert.deepEqual(page.json(), { items: [all.json().items[1]], page: 2, limit: 1, total: 2, totalPages: 2 });
  assert.deepEqual((await f.request('GET', '/api/v1/conversation-search?q=cliente&page=4&limit=1')).json().items, []);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY id').all(), before);
});
test('only authoritative applicable analysis summary is searched; invalidation removes it without new analysis', async t => {
  const f = await fixture(t); assert.equal((await f.configureAfter()).statusCode, 200);
  const { conversation } = await f.seedConversation('Texto sem a palavra pesquisada.'), closed = await f.close(conversation);
  assert.equal(closed.statusCode, 200); await f.worker.runOne(f.actor.tenantId, closed.json().operation.closureId);
  const result = await f.request('GET', '/api/v1/conversation-search?q=Resumo'); assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().items, [{ id: conversation.id }]);
  f.store.create(f.actor.tenantId, 'messages', { conversationId: conversation.id, role: 'user', content: 'Nova informação.' });
  assert.deepEqual((await f.request('GET', '/api/v1/conversation-search?q=Resumo')).json().items, []);
  assert.equal(f.analysisCalls.length, 1);
});
test('strict bounded query and stale authority fail closed', async t => {
  const f = await fixture(t);
  for (const query of ['', '?q=', '?q=' + 'x'.repeat(301), '?q=x&limit=101', '?q=x&page=0', '?q=x&extra=y']) assert.equal((await f.request('GET', '/api/v1/conversation-search' + query)).statusCode, 400);
  assert.equal((await f.request('GET', '/api/v1/conversation-search?q=x', undefined, {})).statusCode, 400);
  f.aba(); assert.equal((await f.request('GET', '/api/v1/conversation-search?q=x')).statusCode, 409);
});
