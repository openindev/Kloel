import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerProviders } from '../src/providers.js';
import { Store, type Entity } from '../src/store.js';
import { seedMember } from './fixtures/membership.js';
import { seedIndexedKnowledge } from './fixtures/knowledge.js';

const tenant = 'chat-authority-fixture';
const config = { PROVIDER_TENANT_ID: tenant, OPENAI_API_KEY: 'isolated-chat-test-key', OPENAI_MODEL: 'isolated-text-model' };
const savedEnv = { ...process.env }, originalFetch = globalThis.fetch;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
let app: FastifyInstance, store: Store, agent: Entity, calls: string[];
let respond: (url: string, init: RequestInit) => Promise<Response>;
function answer() { return Response.json({ id: 'resp_chat_fixture', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta de teste.' }] }], usage: { total_tokens: 12 } }); }
function session(user = 'operator') {
  store.db.prepare('INSERT OR REPLACE INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(hash(`${user}-cookie`), user, Date.now() + 3600000, tenant);
}
beforeEach(async () => {
  Object.assign(process.env, config);
  store = new Store(); app = Fastify(); calls = []; respond = async () => answer();
  for (const userId of ['operator', 'other-operator']) { seedMember(store, { userId, tenantId: tenant, role: 'owner' }); session(userId); }
  agent = store.create(tenant, 'agents', { name: 'Chat fixture', status: 'active', prompt: 'Responda somente ao teste.', voice: 'marin', tools: [] });
  app.addHook('onRequest', async request => {
    const userId = String(request.headers['x-fixture-user'] ?? 'operator');
    request.cookies = { kloel_session: `${userId}-cookie` };
    request.actor = { userId, tenantId: tenant, role: 'owner' };
  });
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => { calls.push(String(url)); return respond(String(url), init); }) as typeof fetch;
  await registerProviders(app, store); await app.ready();
});
afterEach(async () => {
  await app.close(); store.close(); globalThis.fetch = originalFetch;
  for (const name of Object.keys(config)) { if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name]; }
});
function payload(extra: Record<string, unknown> = {}) { return { agentId: agent.id, message: 'Teste de autorização.', idempotencyKey: 'chat-authority-key', ...extra }; }
function send(extra: Record<string, unknown> = {}, user?: string) { return app.inject({ method: 'POST', url: '/api/v1/ai/chat', payload: payload(extra), ...(user ? { headers: { 'x-fixture-user': user } } : {}) }); }
function operation(key = 'chat-authority-key') { return store.list(tenant, 'provider-operations').find(row => row.key === key)!; }
function status(key = 'chat-authority-key', user?: string) { return app.inject({ url: `/api/v1/ai/chat/operations/${key}`, ...(user ? { headers: { 'x-fixture-user': user } } : {}) }); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('revocation before provider I/O rejects without creating an operation or charging', async () => {
  store.db.exec('DELETE FROM sessions');
  assert.equal((await send()).statusCode, 403);
  assert.equal(calls.length, 0); assert.equal(store.list(tenant, 'provider-operations').length, 0);
});

const changes: [string, () => void, number][] = [
  ['session deleted', () => { store.db.exec('DELETE FROM sessions'); }, 403],
  ['session expired', () => { store.db.exec('UPDATE sessions SET expires=0'); }, 403],
  ['session tenant switched', () => { seedMember(store, { userId: 'operator', tenantId: 'another-tenant', role: 'owner' }); store.db.prepare('UPDATE sessions SET tenant_id=? WHERE user_id=?').run('another-tenant', 'operator'); }, 403],
  ['membership removed', () => { store.db.prepare('DELETE FROM memberships WHERE user_id=?').run('operator'); }, 403],
  ['membership removed and rejoined', () => { store.db.prepare('DELETE FROM memberships WHERE user_id=?').run('operator'); seedMember(store, { userId: 'operator', tenantId: tenant, role: 'owner' }); }, 403],
  ['role downgraded', () => { store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('member', 'operator'); }, 403],
  ['organization suspended', () => { store.db.prepare('UPDATE organizations SET status=? WHERE id=?').run('suspended', tenant); }, 403],
  ['provider tenant changed', () => { process.env.PROVIDER_TENANT_ID = 'another-tenant'; }, 403],
  ['agent paused', () => { store.update(tenant, 'agents', agent.id, { status: 'paused' }); }, 409],
  ['agent removed', () => { store.remove(tenant, 'agents', agent.id); }, 409],
  ['agent instructions changed', () => { store.update(tenant, 'agents', agent.id, { prompt: 'Outra política.' }); }, 409],
  ['agent tools changed', () => { store.update(tenant, 'agents', agent.id, { tools: ['lookup_contact'] }); }, 409],
  ['agent settings changed', () => { store.update(tenant, 'agents', agent.id, { settings: { maxResponseTokens: 128 } }); }, 409],
];
for (const [label, change, expected] of changes) test(`in-flight non-tool response is withheld when ${label}`, async () => {
  respond = async () => { change(); return answer(); };
  const result = await send();
  assert.equal(result.statusCode, expected, result.body);
  assert.ok(!result.body.includes('Resposta de teste.'));
  assert.equal(store.list(tenant, 'messages').length, 0);
  assert.equal(operation().status, 'unknown'); assert.equal(calls.length, 1);
});

test('revoked paid response remains unknown after session restoration and cannot be repeated', async () => {
  respond = async () => { store.db.exec('DELETE FROM sessions'); return answer(); };
  assert.equal((await send()).statusCode, 403); session();
  assert.equal((await send()).json().error.code, 'operation_requires_reconciliation');
  assert.deepEqual((await status()).json(), { status: 'unknown', errorCode: 'operator_session_revoked' });
  assert.equal(calls.length, 1);
});

for (const kind of ['closed', 'removed', 'rebound', 'channel', 'metadata', 'new-message'] as const) test(`in-flight conversation ${kind} invalidates the response before persistence`, async () => {
  const conversation = store.create(tenant, 'conversations', { channel: 'webchat', agentId: agent.id, status: 'open' });
  respond = async () => {
    if (kind === 'removed') store.remove(tenant, 'conversations', conversation.id);
    else if (kind === 'new-message') store.create(tenant, 'messages', { conversationId: conversation.id, role: 'user', content: 'Concurrent fixture' });
    else store.update(tenant, 'conversations', conversation.id, kind === 'closed' ? { status: 'closed' } : kind === 'rebound' ? { agentId: 'different-agent' } : kind === 'channel' ? { channel: 'email' } : { title: 'Changed fixture' });
    return answer();
  };
  const result = await send({ conversationId: conversation.id });
  assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'conversation_changed');
  assert.equal(store.list(tenant, 'messages').filter(row => row.source === 'openai' || row.source === 'manual').length, 0);
  assert.equal(operation().status, 'unknown'); assert.equal(calls.length, 1);
});

test('knowledge removed during Responses is not returned or stored', async () => {
  store.update(tenant, 'agents', agent.id, { tools: ['search_knowledge'] });
  const knowledge = await seedIndexedKnowledge(store, tenant, agent.id, 'Conhecimento autorizado.');
  respond = async () => { store.remove(tenant, 'knowledge', knowledge.id); return answer(); };
  const result = await send(); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'knowledge_changed');
  assert.equal(store.list(tenant, 'messages').length, 0); assert.equal(operation().status, 'unknown');
});

test('revocation inside knowledge tool I/O prevents tool result persistence and the next paid model call', async () => {
  store.update(tenant, 'agents', agent.id, { tools: ['search_knowledge'] });
  await seedIndexedKnowledge(store, tenant, agent.id, 'Conhecimento autorizado.');
  respond = async url => {
    if (url.endsWith('/responses')) return Response.json({ id: 'resp_tools', output: [{ type: 'function_call', call_id: 'call_search', name: 'search_knowledge', arguments: JSON.stringify({ query: 'Conhecimento' }) }] });
    assert.ok(url.endsWith('/embeddings')); store.db.exec('DELETE FROM sessions');
    return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] });
  };
  const result = await send(); assert.equal(result.statusCode, 403, result.body);
  assert.equal(calls.filter(url => url.endsWith('/responses')).length, 1); assert.equal(calls.length, 2);
  assert.equal(store.list(tenant, 'messages').length, 0); assert.equal(operation().status, 'unknown');
});

test('body consumption is also guarded after its asynchronous boundary', async () => {
  respond = async () => {
    const response = answer(), read = response.text.bind(response);
    response.text = async () => { const text = await read(); store.db.exec('DELETE FROM sessions'); return text; };
    return response;
  };
  assert.equal((await send()).statusCode, 403); assert.equal(store.list(tenant, 'messages').length, 0); assert.equal(operation().status, 'unknown');
});

test('pending status is owner-only, contains no provider payload, and blocks another key on its conversation', async () => {
  const entered = deferred(), release = deferred();
  respond = async () => { entered.resolve(); await release.promise; return answer(); };
  const running = send().then(response => response);
  await entered.promise;
  try {
    assert.deepEqual((await status()).json(), { status: 'pending' });
    assert.equal((await status('chat-authority-key', 'other-operator')).statusCode, 404);
    const next = await send({ conversationId: operation().chatConversationId, idempotencyKey: 'another-chat-key' });
    assert.equal(next.json().error.code, 'operation_requires_reconciliation'); assert.equal(calls.length, 1);
  } finally { release.resolve(); }
  assert.equal((await running).statusCode, 200);
  assert.equal((await status()).json().status, 'succeeded');
});

test('successful cached response uses the same operator and active authority without another charge', async () => {
  const first = await send(), replay = await send();
  assert.equal(first.statusCode, 200); assert.deepEqual(replay.json(), first.json());
  assert.equal(first.headers['cache-control'], 'no-store');
  const read = await status(); assert.equal(read.statusCode, 200); assert.equal(read.headers['cache-control'], 'no-store');
  assert.deepEqual(read.json(), { status: 'succeeded', result: first.json() });
  assert.equal((await send({}, 'other-operator')).json().error.code, 'idempotency_conflict');
  assert.equal((await status('chat-authority-key', 'other-operator')).statusCode, 404); assert.equal(calls.length, 1);
});

test('cached response cannot bypass current conversation metadata even when POST omitted its ID', async () => {
  const first = await send(); const conversationId = first.json().conversationId;
  store.update(tenant, 'conversations', conversationId, { title: 'Changed after successful generation' });
  assert.equal((await send()).json().error.code, 'conversation_changed');
  assert.equal((await status()).json().error.code, 'conversation_changed'); assert.equal(calls.length, 1);
});

test('cached response cannot bypass a changed agent or a replacement membership', async () => {
  await send(); store.update(tenant, 'agents', agent.id, { prompt: 'New policy' });
  assert.equal((await send()).json().error.code, 'idempotency_conflict');
  assert.equal((await status()).json().error.code, 'agent_changed');
  store.db.prepare('DELETE FROM memberships WHERE user_id=?').run('operator'); seedMember(store, { userId: 'operator', tenantId: tenant, role: 'owner' });
  assert.equal((await status()).statusCode, 403); assert.equal(calls.length, 1);
});

test('transport uncertainty is durable, secret-free, and blocks replay or a fresh key on that conversation', async () => {
  respond = async () => { throw new Error('private transport payload'); };
  assert.equal((await send()).statusCode, 502);
  const read = await status(); assert.deepEqual(read.json(), { status: 'unknown', errorCode: 'provider_unreachable' });
  assert.ok(!read.body.includes('private')); assert.equal((await send()).statusCode, 409);
  assert.equal((await send({ idempotencyKey: 'retry-new-key', conversationId: operation().chatConversationId })).statusCode, 409);
  assert.equal(calls.length, 1);
});

test('definitive provider rejection exposes only normalized failure and does not repeat the same key', async () => {
  respond = async () => Response.json({ error: { code: 'invalid_request', message: 'private provider payload' } }, { status: 400 });
  assert.equal((await send()).statusCode, 502);
  assert.deepEqual((await status()).json(), { status: 'failed', errorCode: 'provider_rejected' });
  assert.equal((await send()).statusCode, 409); assert.equal(calls.length, 1);
});

test('operation result projection strips unexpected receipt fields and nested usage values', async () => {
  await send(); const row = operation();
  store.update(tenant, 'provider-operations', row.id, { secret: 'private-receipt', result: { ...(row.result as object), secret: 'private-result', usage: { total_tokens: 12, secret: 'private-usage', input_tokens_details: { cached_tokens: 2, secret: 'private-nested' } } } });
  const read = await status(); assert.equal(read.statusCode, 200);
  assert.deepEqual(Object.keys(read.json()), ['status', 'result']);
  assert.deepEqual(read.json().result.usage, { total_tokens: 12, input_tokens_details: { cached_tokens: 2 } });
  assert.ok(!read.body.includes('private')); assert.ok(!read.body.includes('operatorUserId'));
});

test('missing, legacy, cross-tenant and non-chat operations cannot be queried through the chat endpoint', async () => {
  for (const [scope, data] of [
    [tenant, { operation: 'resend.send', key: 'wrong-operation', operatorUserId: 'operator', status: 'succeeded', result: { text: 'private-other' } }],
    [tenant, { operation: 'openai.chat', key: 'legacy-operation', status: 'succeeded', result: { text: 'private-legacy' } }],
    ['another-tenant', { operation: 'openai.chat', key: 'cross-tenant-operation', operatorUserId: 'operator', status: 'succeeded', result: { text: 'private-other-tenant' } }],
  ] as const) store.create(scope, 'provider-operations', data);
  for (const key of ['missing-operation', 'wrong-operation', 'legacy-operation', 'cross-tenant-operation']) {
    const read = await status(key); assert.equal(read.statusCode, 404); assert.ok(!read.body.includes('private'));
  }
  assert.equal(calls.length, 0);
});

test('malformed or mismatched successful operation result requires reconciliation without exposing it', async () => {
  await send(); const row = operation();
  store.update(tenant, 'provider-operations', row.id, { result: { ...(row.result as object), conversationId: 'other-conversation' } });
  assert.equal((await status()).json().error.code, 'operation_requires_reconciliation');
  store.update(tenant, 'provider-operations', row.id, { result: { ...(row.result as object), usage: { total_tokens: -1 } } });
  assert.equal((await status()).json().error.code, 'operation_requires_reconciliation'); assert.equal(calls.length, 1);
});

test('unknown operations never expose stored results or unsafe error strings', async () => {
  await send(); const row = operation();
  store.update(tenant, 'provider-operations', row.id, { status: 'unknown', errorCode: 'private data with spaces', result: { text: 'private-uncertain-result' } });
  assert.deepEqual((await status()).json(), { status: 'unknown' });
});

test('final effect await rechecks authority before the durable succeeded receipt is committed', async () => {
  const create = store.create.bind(store);
  store.create = (scope, collection, data) => {
    const result = create(scope, collection, data);
    if (collection === 'messages' && data.role === 'assistant') queueMicrotask(() => store.db.exec('DELETE FROM sessions'));
    return result;
  };
  const result = await send(); assert.equal(result.statusCode, 403, result.body);
  // The message transaction completed while authorized; revocation at the following
  // await still withholds the response and must never claim a succeeded receipt.
  assert.equal(operation().status, 'unknown'); assert.equal(operation().result, undefined);
  session(); assert.deepEqual((await status()).json(), { status: 'unknown', errorCode: 'operator_session_revoked' });
  assert.equal((await send()).statusCode, 409); assert.equal(calls.length, 1);
});

test('a model response without an identity stays unknown without storing user or assistant messages', async () => {
  respond = async () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Unidentified fixture' }] }] });
  assert.equal((await send()).json().error.code, 'provider_invalid_response');
  assert.equal(operation().status, 'unknown'); assert.equal(store.list(tenant, 'messages').length, 0);
  assert.equal((await send()).statusCode, 409); assert.equal(calls.length, 1);
});
