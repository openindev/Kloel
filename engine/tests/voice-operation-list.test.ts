import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type WebSocket from 'ws';
import { Store, type Entity } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerProviders } from '../src/providers.js';
import { createVoiceStartOperations, voiceStartOperationsCollection } from '../src/providers/voice-operations.js';
import { seedMember } from './fixtures/membership.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const path = '/api/v1/ai/realtime/operations';
class Socket extends EventEmitter {
  readyState = 0;
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  send() {}
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
async function fixture(t: any) {
  const config = { PROVIDER_TENANT_ID: 'voice-list-tenant', OPENAI_API_KEY: 'synthetic-list-key', OPENAI_MODEL: 'test-text', OPENAI_REALTIME_MODEL: 'test-voice' };
  const previous = { ...process.env }, oldFetch = globalThis.fetch;
  Object.assign(process.env, config);
  const store = new Store(':memory:'), app = Fastify({ logger: false });
  const owner = { tenantId: config.PROVIDER_TENANT_ID, userId: 'list-owner', role: 'owner' as const };
  const actors = { owner, other: { ...owner, userId: 'list-other-owner' }, viewer: { ...owner, userId: 'list-viewer', role: 'viewer' as const }, foreign: { ...owner, tenantId: 'list-foreign-tenant', userId: 'list-foreign-owner' } };
  const cookies = { owner: 'list-cookie-owner', other: 'list-cookie-other', viewer: 'list-cookie-viewer', foreign: 'list-cookie-foreign' };
  for (const [name, actor] of Object.entries(actors)) {
    seedMember(store, actor);
    store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(cookies[name as keyof typeof cookies]), actor.userId, actor.tenantId, Date.now() + 3600000);
  }
  const agent = store.create(owner.tenantId, 'agents', { name: 'List synthetic agent', status: 'active', prompt: 'Private prompt must stay private', initialMessage: '', voice: 'marin', language: 'pt-BR', rules: [], tools: [], settings: { maxResponseTokens: 1024, timezone: 'America/Sao_Paulo' } });
  const providerCalls: string[] = [];
  globalThis.fetch = (async url => {
    providerCalls.push(String(url));
    return String(url).endsWith('/realtime/calls') ? new Response('v=0\r\ns=private-answer', { status: 201, headers: { location: '/v1/realtime/calls/rtc_list_' + providerCalls.length } }) : new Response(null, { status: 200 });
  }) as typeof fetch;
  await app.register(cookie); await registerAuth(app, store);
  await registerProviders(app, store, { socketFactory: () => new Socket() as unknown as WebSocket }); await app.ready();
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = oldFetch; for (const key of Object.keys(config)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  const headers = (name: keyof typeof cookies = 'owner') => ({ cookie: 'kloel_session=' + cookies[name] });
  const seed = (key: string, patch: Record<string, unknown> = {}, selected = agent, name: keyof typeof actors = 'owner') => {
    const actor = { ...actors[name], sessionHash: hash(cookies[name]) };
    const membership = store.db.prepare('SELECT id,revision FROM memberships WHERE user_id=? AND tenant_id=?').get(actor.userId, actor.tenantId);
    return store.create(actor.tenantId, voiceStartOperationsCollection, { operationKey: key, binding: { actor, agentId: selected.id, configurationHash: hash(JSON.stringify({ agent: selected, knowledge: [], membership })) }, requestHash: 'private-request-hash', executionId: 'synthetic-old', startAttemptId: randomUUID(), completionFence: randomUUID(), status: 'unknown', cancelRequested: true, hangupStatus: 'accepted', leaseExpiresAt: Date.now() - 1000, ...patch });
  };
  const list = (query: Record<string, string> = {}, name: keyof typeof cookies = 'owner', extra: Record<string, string> = {}) => app.inject({ url: path + '?' + new URLSearchParams(query), headers: { ...headers(name), ...extra } });
  const contextHeaders = async () => {
    const response = await app.inject({ url: '/api/v1/auth/me', headers: headers() }); assert.equal(response.statusCode, 200);
    const context = response.json().context;
    return { 'x-kloel-expected-user': context.userId, 'x-kloel-expected-tenant': context.tenantId, 'x-kloel-expected-membership': context.membershipId, 'x-kloel-expected-authority': context.authorityVersion };
  };
  return { app, store, owner, actors, cookies, agent, seed, list, headers, providerCalls, contextHeaders };
}

test('list discovers an actual started journal and permits existing cancellation without exposing SDP or internals', async t => {
  const f = await fixture(t), key = 'voice.local:operation-001', encodedKey = encodeURIComponent(key);
  const started = await f.app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: f.headers(), payload: { agentId: f.agent.id, sdp: 'v=0\r\ns=private-offer', idempotencyKey: key } });
  assert.equal(started.statusCode, 200, started.body);
  const before = f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all(), count = f.providerCalls.length;
  const listed = await f.list({ conversationId: started.json().conversationId }); assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.headers['cache-control'], 'no-store'); assert.equal(listed.json().limit, 20); assert.equal(listed.json().nextCursor, null);
  assert.equal(listed.json().items[0].operationKey, key); assert.equal(listed.json().items[0].status, 'succeeded');
  assert.equal(f.providerCalls.length, count); assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all(), before);
  for (const forbidden of ['binding', 'sessionHash', 'configurationHash', 'requestHash', 'sdp', 'private-offer', 'private-answer', 'synthetic-list-key', 'Private prompt', hash(f.cookies.owner)]) assert.equal(listed.body.includes(forbidden), false, forbidden);
  const individual = await f.app.inject({ url: path + '/' + encodedKey, headers: f.headers() }); assert.equal(individual.statusCode, 200, individual.body); assert.equal(individual.json().operationKey, key);
  const stopped = await f.app.inject({ method: 'POST', url: path + '/' + encodedKey + '/cancel', headers: f.headers(), payload: {} }); assert.equal(stopped.statusCode, 200, stopped.body);
  const recovered = (await f.list()).json().items[0]; assert.equal(recovered.cancelRequested, true); assert.equal(recovered.hangupStatus, 'accepted');
  await f.app.inject({ method: 'POST', url: path + '/' + encodedKey + '/cancel', headers: f.headers(), payload: {} });
  assert.equal(f.providerCalls.filter(url => url.endsWith('/hangup')).length, 1);
});

test('keyset pagination is stable across new inserts and state changes, with SQL filters intersected', async t => {
  const f = await fixture(t), conversation = randomUUID(), other = f.store.create(f.owner.tenantId, 'agents', { ...f.agent, name: 'Second agent' });
  const rows = Array.from({ length: 5 }, (_, index) => f.seed('page-operation-' + index, { conversationId: conversation }));
  f.seed('other-agent-operation', { conversationId: conversation }, other);
  f.seed('other-conversation-operation', { conversationId: randomUUID() });
  const filters = { limit: '2', agentId: f.agent.id, conversationId: conversation };
  const first = (await f.list(filters)).json(); assert.deepEqual(first.items.map((row: any) => row.operationKey), ['page-operation-4', 'page-operation-3']); assert.ok(first.nextCursor);
  f.seed('newly-inserted-operation', { conversationId: conversation });
  f.store.update(f.owner.tenantId, voiceStartOperationsCollection, rows[2].id, { status: 'succeeded' });
  const second = (await f.list({ ...filters, cursor: first.nextCursor })).json();
  assert.deepEqual(second.items.map((row: any) => row.operationKey), ['page-operation-2', 'page-operation-1']); assert.equal(second.items[0].status, 'succeeded');
  const third = (await f.list({ ...filters, cursor: second.nextCursor })).json(); assert.deepEqual(third.items.map((row: any) => row.operationKey), ['page-operation-0']); assert.equal(third.nextCursor, null);
  assert.equal((await f.list({ agentId: other.id, conversationId: conversation })).json().items.length, 1);
  assert.equal((await f.list({ conversationId: randomUUID() })).json().items.length, 0); assert.equal(f.providerCalls.length, 0);
});

test('cursor tampering, changed filters/limit/actor and malformed query are rejected without effects', async t => {
  const f = await fixture(t); f.seed('cursor-operation-1'); f.seed('cursor-operation-2');
  const cursor = (await f.list({ limit: '1' })).json().nextCursor;
  const bytes = Buffer.from(cursor, 'base64url'); bytes[bytes.length - 1] ^= 1;
  for (const query of [{ limit: '1', cursor: bytes.toString('base64url') }, { limit: '2', cursor }, { limit: '1', cursor, agentId: f.agent.id }, { limit: '1', cursor: 'x'.repeat(513) }, { limit: '0' }, { limit: '51' }, { limit: '1.5' }, { agentId: "' OR 1=1" }, { extra: 'unknown' }]) {
    const response = await f.list(query); assert.equal(response.statusCode, 400, response.body);
  }
  const scoped = await f.list({ limit: '1', cursor }, 'other'); assert.equal(scoped.statusCode, 400); assert.equal(scoped.json().error.code, 'invalid_voice_cursor');
  assert.equal(f.providerCalls.length, 0);
});

test('list hides other operators, tenants, sessions and stale role/configuration bindings', async t => {
  const f = await fixture(t); f.seed('owned-list-operation'); f.seed('other-list-operation', {}, f.agent, 'other'); f.seed('foreign-list-operation', {}, f.agent, 'foreign');
  const existing = (await f.list()).json(); assert.deepEqual(existing.items.map((row: any) => row.operationKey), ['owned-list-operation']);
  assert.deepEqual((await f.list({}, 'other')).json().items.map((row: any) => row.operationKey), ['other-list-operation']);
  assert.equal((await f.list({}, 'foreign')).statusCode, 403); assert.equal((await f.list({}, 'viewer')).statusCode, 403);
  const newCookie = 'new-cookie-same-person'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(newCookie), f.owner.userId, f.owner.tenantId, Date.now() + 3600000);
  assert.deepEqual((await f.list({}, 'owner', { cookie: 'kloel_session=' + newCookie })).json().items, []);
  f.store.update(f.owner.tenantId, 'agents', f.agent.id, { prompt: 'Changed configuration' }); assert.deepEqual((await f.list()).json().items, []);
  assert.equal(f.providerCalls.length, 0);
});

test('role ABA and expired session cannot expose an earlier operation', async t => {
  const f = await fixture(t); f.seed('aba-list-operation'); const expected = await f.contextHeaders();
  f.store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND tenant_id=?").run(f.owner.userId, f.owner.tenantId);
  f.store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=? AND tenant_id=?").run(f.owner.userId, f.owner.tenantId);
  const changed = await f.list({}, 'owner', expected); assert.equal(changed.statusCode, 409); assert.equal(changed.json().code, 'context_mismatch');
  assert.deepEqual((await f.list()).json().items, []);
  f.store.db.prepare('UPDATE sessions SET expires=0 WHERE hash=?').run(hash(f.cookies.owner)); assert.equal((await f.list()).statusCode, 401);
  assert.equal(f.providerCalls.length, 0);
});

test('cookie rotation to another session of the same identity and inactive organization deny old authority', async t => {
  const f = await fixture(t); f.seed('cookie-rotation-operation'); const expected = await f.contextHeaders();
  const replacement = 'same-identity-new-cookie';
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(replacement), f.owner.userId, f.owner.tenantId, Date.now() + 3600000);
  const stale = await f.list({}, 'owner', { ...expected, cookie: 'kloel_session=' + replacement });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().code, 'context_mismatch');
  assert.deepEqual((await f.list({}, 'owner', { cookie: 'kloel_session=' + replacement })).json().items, []);
  f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(f.owner.tenantId);
  assert.equal((await f.list()).statusCode, 403); assert.equal(f.providerCalls.length, 0);
});

test('bounded scan allows empty pages through revoked configurations without unbounded journal reads or writes', async t => {
  const f = await fixture(t); f.seed('old-valid-operation');
  for (let index = 0; index < 205; index++) {
    const row = f.seed('revoked-operation-' + index); const binding = row.binding as Record<string, unknown>;
    f.store.update(f.owner.tenantId, voiceStartOperationsCollection, row.id, { binding: { ...binding, configurationHash: '0'.repeat(64) } });
  }
  const before = f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all();
  const original = f.store.list.bind(f.store);
  f.store.list = (tenant, collection) => { assert.notEqual(collection, voiceStartOperationsCollection, 'list must page in SQL'); return original(tenant, collection); };
  const first = (await f.list()).json(); assert.deepEqual(first.items, []); assert.ok(first.nextCursor);
  const second = (await f.list({ cursor: first.nextCursor })).json(); assert.equal(second.items[0].operationKey, 'old-valid-operation'); assert.equal(second.nextCursor, null);
  f.store.list = original;
  assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all(), before); assert.equal(f.providerCalls.length, 0);
});

test('list is read-only for expired pending and uncertain stop states; cursors expire across runtime replacement', async t => {
  const store = new Store(':memory:'); t.after(() => store.close()); let starts = 0, stops = 0;
  const actor = { tenantId: 'unit-tenant', userId: 'unit-user', sessionHash: hash('unit-session'), role: 'owner' as const };
  const dependencies = { authorize: () => true, start: async () => { starts++; throw new Error('must not start'); }, stop: async () => { stops++; return 'accepted' as const; } };
  for (const [index, status] of ['pending', 'unknown', 'failed', 'succeeded'].entries()) store.create(actor.tenantId, voiceStartOperationsCollection, { operationKey: 'read-only-operation-' + index, binding: { actor, agentId: 'unit-agent', configurationHash: hash('config') }, status, hangupStatus: status === 'unknown' ? 'unknown' : 'not_requested', cancelRequested: status === 'unknown', leaseExpiresAt: Date.now() - 1000 });
  const ops = createVoiceStartOperations(store, dependencies), before = store.list(actor.tenantId, voiceStartOperationsCollection);
  const page = ops.list({ actor, limit: 1 }); assert.equal(page.items[0].status, 'succeeded'); assert.ok(page.nextCursor);
  assert.deepEqual(ops.list({ actor }).items.map(row => row.status), ['succeeded', 'failed', 'unknown', 'pending']);
  const replaced = createVoiceStartOperations(store, dependencies);
  assert.throws(() => replaced.list({ actor, limit: 1, cursor: page.nextCursor! }), (error: any) => error.code === 'invalid_voice_cursor');
  assert.deepEqual(store.list(actor.tenantId, voiceStartOperationsCollection), before); assert.equal(starts, 0); assert.equal(stops, 0);
});
