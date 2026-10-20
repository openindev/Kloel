import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type WebSocket from 'ws';
import { Store, type Entity } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerProviders } from '../src/providers.js';
import { voiceStartOperationsCollection } from '../src/providers/voice-operations.js';
import { seedMember } from './fixtures/membership.js';

const config = { PROVIDER_TENANT_ID: 'voice-routes-a', OPENAI_API_KEY: 'synthetic-voice-route-key', OPENAI_MODEL: 'test-text-model', OPENAI_REALTIME_MODEL: 'test-realtime-model' };
const oldFetch = globalThis.fetch, oldEnv = { ...process.env };
const tenant = config.PROVIDER_TENANT_ID, operationKey = 'voice-route-test-0001';
const owner = { tenantId: tenant, userId: 'voice-owner', role: 'owner' as const };
const cookieTokens = { owner: 'voice-owner-cookie', otherOwner: 'voice-other-owner-cookie', otherTenant: 'voice-other-tenant-cookie', member: 'voice-member-cookie' };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const offer = 'v=0\r\na=synthetic-offer-private', answer = 'v=0\r\na=synthetic-answer-private';
let app: FastifyInstance, store: Store, agent: Entity;
let requests: Array<{ url: string; init: RequestInit }>, sockets: Socket[];
let respond: (url: string, init: RequestInit) => Promise<Response>;
class Socket extends EventEmitter {
  readyState = 0; sent: Record<string, any>[] = [];
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
function providerAnswer(callId = 'rtc_route_fixture'): Response { return new Response(answer, { status: 201, headers: { Location: `/v1/realtime/calls/${callId}` } }); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) { if (condition()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(condition(), 'mocked async boundary did not arrive');
}
const headers = (identity: keyof typeof cookieTokens = 'owner') => ({ cookie: `kloel_session=${cookieTokens[identity]}` });
const payload = (key: string | undefined = operationKey) => ({ agentId: agent.id, sdp: offer, ...(key ? { idempotencyKey: key } : {}) });
const path = (suffix = '') => `/api/v1/ai/realtime/operations/${operationKey}${suffix}`;
const startCalls = () => requests.filter(item => item.url.endsWith('/realtime/calls'));
const stopCalls = () => requests.filter(item => item.url.endsWith('/hangup'));
const journal = () => store.list(tenant, voiceStartOperationsCollection).find(item => item.operationKey === operationKey)!;

beforeEach(async () => {
  Object.assign(process.env, config); requests = []; sockets = [];
  respond = async url => url.endsWith('/realtime/calls') ? providerAnswer() : url.endsWith('/hangup') ? new Response(null, { status: 200 }) : Promise.reject(new Error(`Unexpected synthetic provider path ${url}`));
  globalThis.fetch = (async (url, init = {}) => { requests.push({ url: String(url), init }); return respond(String(url), init); }) as typeof fetch;
  store = new Store(); app = Fastify({ logger: false });
  const actors = { owner, otherOwner: { ...owner, userId: 'voice-other-owner' }, otherTenant: { ...owner, tenantId: 'voice-routes-b', userId: 'voice-other-tenant' }, member: { ...owner, role: 'member' as const, userId: 'voice-member' } };
  for (const [identity, actor] of Object.entries(actors)) {
    seedMember(store, actor);
    store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(cookieTokens[identity as keyof typeof cookieTokens]), actor.userId, actor.tenantId, Date.now() + 3_600_000);
  }
  agent = store.create(tenant, 'agents', { name: 'Synthetic route assistant', status: 'active', prompt: 'Private test prompt', initialMessage: '', voice: 'marin', language: 'pt-BR', rules: [], tools: ['search_knowledge'], settings: { maxResponseTokens: 1024, timezone: 'America/Sao_Paulo' } });
  await app.register(cookie); await registerAuth(app, store);
  await registerProviders(app, store, { socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; } });
  await app.ready();
});
afterEach(async () => {
  try { await app.close(); } finally {
    store.close(); globalThis.fetch = oldFetch;
    for (const key of Object.keys(config)) { if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]; }
  }
});

test('real authenticated routes start once, replay without SDP, and return a secret-free status DTO', async () => {
  const first = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() });
  assert.equal(first.statusCode, 200, first.body); const result = first.json();
  assert.equal(result.sdp, answer); assert.equal(result.status, 'succeeded'); assert.equal(result.requiresRecovery, false); assert.equal(result.operationKey, operationKey);
  assert.equal(result.callId, 'rtc_route_fixture'); assert.ok(result.conversationId); assert.deepEqual(result.toolsEnabled, ['search_knowledge']);
  assert.equal(store.get(tenant, 'conversations', result.conversationId)?.agentId, agent.id);
  const replay = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() });
  assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().requiresRecovery, true); assert.equal(replay.json().sdp, undefined);
  assert.equal(startCalls().length, 1); assert.equal(sockets.length, 1);
  assert.ok(startCalls()[0].init.body instanceof FormData); assert.equal((startCalls()[0].init.body as FormData).get('sdp'), offer);
  const status = await app.inject({ url: path(), headers: headers() }); assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().callId, result.callId); assert.equal(status.json().conversationId, result.conversationId);
  for (const response of [replay, status]) {
    assert.equal(response.headers['cache-control'], 'no-store');
    for (const secret of [answer, offer, config.OPENAI_API_KEY, digest(cookieTokens.owner), 'Private test prompt', 'configurationHash', 'requestHash', 'binding']) assert.equal(response.body.includes(secret), false, secret);
  }
  assert.equal(JSON.stringify(journal()).includes('synthetic-offer-private'), false); assert.equal(JSON.stringify(journal()).includes('synthetic-answer-private'), false);
});

test('different request cannot reuse a key and another owner/tenant/member cannot control its operation', async () => {
  const first = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() }); assert.equal(first.statusCode, 200, first.body);
  const conflict = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: { ...payload(), sdp: 'v=0\r\na=different-offer' } });
  assert.equal(conflict.statusCode, 409, conflict.body);
  for (const identity of ['otherOwner', 'otherTenant', 'member'] as const) for (const suffix of ['', '/cancel', '/heartbeat']) {
    const response = await app.inject({ method: suffix ? 'POST' : 'GET', url: path(suffix), headers: headers(identity), ...(suffix ? { payload: {} } : {}) });
    assert.ok([403, 404].includes(response.statusCode), `${identity}${suffix}: ${response.body}`); assert.equal(response.body.includes('rtc_route_fixture'), false);
  }
  assert.equal((await app.inject({ url: path() })).statusCode, 401);
  assert.equal(startCalls().length, 1); assert.equal(stopCalls().length, 0);
});

test('cancel while Location is delayed persists intent, closes the eventual call once, and never returns SDP', async () => {
  const location = deferred<Response>(); respond = async url => url.endsWith('/realtime/calls') ? location.promise : new Response(null, { status: 200 });
  const starting = app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() });
  try {
    await until(() => startCalls().length === 1);
    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() });
    assert.equal(duplicate.statusCode, 200, duplicate.body); assert.equal(duplicate.json().status, 'pending'); assert.equal(duplicate.json().requiresRecovery, true);
    const cancel = await app.inject({ method: 'POST', url: path('/cancel'), headers: headers(), payload: {} });
    assert.equal(cancel.statusCode, 200, cancel.body); assert.equal(cancel.json().cancelRequested, true); assert.equal(stopCalls().length, 0);
    location.resolve(providerAnswer()); const finished = await starting;
    assert.equal(finished.statusCode, 200, finished.body); assert.equal(finished.json().sdp, undefined); assert.equal(finished.json().requiresRecovery, true);
    assert.equal(stopCalls().length, 1); assert.equal(startCalls().length, 1); assert.equal(sockets.length, 0);
    const again = await app.inject({ method: 'POST', url: path('/cancel'), headers: headers(), payload: {} });
    assert.equal(again.statusCode, 200, again.body); assert.equal(again.json().hangupStatus, 'accepted'); assert.equal(stopCalls().length, 1);
  } finally { location.resolve(providerAnswer()); await starting; }
});

test('provider Location is journaled before its SDP body resolves, allowing immediate cancellation', async () => {
  const text = deferred<string>(); let bodyRead = false;
  respond = async url => {
    if (url.endsWith('/hangup')) return new Response(null, { status: 200 });
    const response = providerAnswer(); response.text = async () => { bodyRead = true; return text.promise; }; return response;
  };
  const starting = app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() });
  try {
    await until(() => bodyRead);
    assert.equal(journal().callId, 'rtc_route_fixture');
    const cancel = await app.inject({ method: 'POST', url: path('/cancel'), headers: headers(), payload: {} });
    assert.equal(cancel.statusCode, 200, cancel.body); assert.equal(cancel.json().hangupStatus, 'accepted'); assert.equal(stopCalls().length, 1);
    text.resolve(answer); const completed = await starting;
    assert.equal(completed.statusCode, 200, completed.body); assert.equal(completed.json().sdp, undefined); assert.equal(completed.json().requiresRecovery, true);
    assert.equal(sockets.length, 0); assert.equal(stopCalls().length, 1);
  } finally { text.resolve(answer); await starting; }
});

for (const mutation of ['session', 'configuration', 'membership'] as const) test(`revoking ${mutation} during provider await compensates and denies SDP with real authorization`, async () => {
  const location = deferred<Response>(); respond = async url => url.endsWith('/realtime/calls') ? location.promise : new Response(null, { status: 200 });
  const starting = app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() });
  try {
    await until(() => startCalls().length === 1);
    if (mutation === 'session') store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(cookieTokens.owner));
    if (mutation === 'configuration') store.update(tenant, 'agents', agent.id, { prompt: 'Changed during negotiation' });
    if (mutation === 'membership') { store.db.prepare('DELETE FROM memberships WHERE tenant_id=? AND user_id=?').run(tenant, owner.userId); seedMember(store, owner); }
    location.resolve(providerAnswer()); const completed = await starting;
    assert.equal(completed.statusCode, 403, completed.body); assert.equal(completed.body.includes('synthetic-answer-private'), false);
    assert.equal(journal().callId, 'rtc_route_fixture'); assert.equal(journal().hangupStatus, 'accepted'); assert.equal(stopCalls().length, 1); assert.equal(sockets.length, 0);
    assert.equal(completed.body.includes(config.OPENAI_API_KEY), false);
    const status = await app.inject({ url: path(), headers: headers() }); assert.ok([401, 403].includes(status.statusCode), status.body);
  } finally { location.resolve(providerAnswer()); await starting; }
});

test('heartbeat extends a live lease, expired heartbeat stops the call, and cancellation is idempotent', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() }); assert.equal(created.statusCode, 200, created.body);
  const row = journal(); store.update(tenant, voiceStartOperationsCollection, row.id, { leaseExpiresAt: Date.now() + 5_000 });
  const heartbeat = await app.inject({ method: 'POST', url: path('/heartbeat'), headers: headers(), payload: {} });
  assert.equal(heartbeat.statusCode, 200, heartbeat.body); assert.ok(Date.parse(heartbeat.json().leaseExpiresAt) >= Date.now() + 55_000); assert.equal(heartbeat.json().heartbeatIntervalMs, 15_000);
  store.update(tenant, voiceStartOperationsCollection, row.id, { leaseExpiresAt: Date.now() - 1 });
  const expired = await app.inject({ method: 'POST', url: path('/heartbeat'), headers: headers(), payload: {} });
  assert.equal(expired.statusCode, 200, expired.body); assert.equal(expired.json().cancelRequested, true); assert.equal(expired.json().hangupStatus, 'accepted'); assert.equal(stopCalls().length, 1);
  const cancel = await app.inject({ method: 'POST', url: path('/cancel'), headers: headers(), payload: {} });
  assert.equal(cancel.statusCode, 200, cancel.body); assert.equal(cancel.json().hangupStatus, 'accepted'); assert.equal(stopCalls().length, 1);
});

test('ambiguous keyed start returns recoverable unknown without retry; legacy no-key failure remains 502', async () => {
  respond = async () => { throw new Error('Synthetic unknown provider outcome with private detail'); };
  const keyed = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() });
  assert.equal(keyed.statusCode, 200, keyed.body); assert.equal(keyed.json().status, 'unknown'); assert.equal(keyed.json().requiresRecovery, true); assert.equal(keyed.json().sdp, undefined);
  assert.equal(keyed.body.includes('private detail'), false);
  const replay = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() });
  assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().status, 'unknown'); assert.equal(startCalls().length, 1);
  const legacy = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: { agentId: agent.id, sdp: offer } });
  assert.equal(legacy.statusCode, 502, legacy.body); assert.equal(startCalls().length, 2);
});

test('unknown hangup stays unknown on cancel retry, never sends another stop, and never claims ended', async () => {
  respond = async url => { if (url.endsWith('/realtime/calls')) return providerAnswer(); throw new Error('Synthetic hangup timeout'); };
  const created = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() }); assert.equal(created.statusCode, 200, created.body);
  const cancel = await app.inject({ method: 'POST', url: path('/cancel'), headers: headers(), payload: {} });
  assert.equal(cancel.statusCode, 200, cancel.body); assert.equal(cancel.json().hangupStatus, 'unknown'); assert.notEqual(cancel.json().status, 'ended');
  const retry = await app.inject({ method: 'POST', url: path('/cancel'), headers: headers(), payload: {} });
  assert.equal(retry.statusCode, 200, retry.body); assert.equal(retry.json().hangupStatus, 'unknown'); assert.equal(stopCalls().length, 1);
  const status = await app.inject({ url: path(), headers: headers() }); assert.equal(status.json().hangupStatus, 'unknown');
});

test('successful legacy start is also journaled and can be cancelled using its returned operation key', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: { agentId: agent.id, sdp: offer } });
  assert.equal(created.statusCode, 200, created.body); assert.ok(created.json().operationKey); assert.equal(created.json().sdp, answer);
  assert.equal(store.list(tenant, voiceStartOperationsCollection).length, 1);
  const cancel = await app.inject({ method: 'POST', url: `/api/v1/ai/realtime/operations/${created.json().operationKey}/cancel`, headers: headers(), payload: {} });
  assert.equal(cancel.statusCode, 200, cancel.body); assert.equal(cancel.json().hangupStatus, 'accepted'); assert.equal(stopCalls().length, 1);
});

test('legacy manual hangup and lifecycle cancellation share the same provider stop receipt', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() }); assert.equal(created.statusCode, 200, created.body);
  const manual = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/sessions/rtc_route_fixture/hangup', headers: headers(), payload: {} });
  assert.equal(manual.statusCode, 200, manual.body); assert.equal(stopCalls().length, 1);
  const cancel = await app.inject({ method: 'POST', url: path('/cancel'), headers: headers(), payload: {} });
  assert.equal(cancel.statusCode, 200, cancel.body); assert.equal(cancel.json().hangupStatus, 'accepted'); assert.equal(stopCalls().length, 1);
  assert.equal(store.list(tenant, 'voice-stop-operations').length, 1);
});

test('provider registration onReady recovers previous pending execution and stops its known call without restart', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() }); assert.equal(created.statusCode, 200, created.body);
  // Test-only durable row representing another process that died after journaling Location.
  const lost = store.create(tenant, voiceStartOperationsCollection, { ...journal(), operationKey: 'voice-recovery-route', executionId: 'dead-execution', status: 'pending', callId: 'rtc_recovery_fixture', hangupStatus: 'not_requested', cancelRequested: false });
  await app.close(); assert.equal(stopCalls().length, 1);
  app = Fastify({ logger: false }); await app.register(cookie); await registerAuth(app, store);
  await registerProviders(app, store, { socketFactory: () => { throw new Error('Recovery must never open a sideband'); } });
  await app.ready();
  assert.equal(startCalls().length, 1); assert.equal(stopCalls().filter(item => item.url.endsWith('/rtc_recovery_fixture/hangup')).length, 1);
  assert.equal(store.get(tenant, voiceStartOperationsCollection, lost.id)?.status, 'unknown');
  const status = await app.inject({ url: '/api/v1/ai/realtime/operations/voice-recovery-route', headers: headers() });
  assert.equal(status.statusCode, 200, status.body); assert.equal(status.json().status, 'unknown'); assert.equal(status.json().hangupStatus, 'accepted');
  const replay = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload('voice-recovery-route') });
  assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().requiresRecovery, true); assert.equal(replay.json().sdp, undefined); assert.equal(startCalls().length, 1);
});

test('provider registration onClose waits for remote hangup before completing and deduplicates sideband cleanup', async () => {
  const stopping = deferred<Response>();
  respond = async url => url.endsWith('/realtime/calls') ? providerAnswer() : stopping.promise;
  const created = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers: headers(), payload: payload() }); assert.equal(created.statusCode, 200, created.body);
  let closed = false; const closing = app.close().then(() => { closed = true; });
  try {
    await until(() => stopCalls().length === 1);
    assert.equal(closed, false); assert.equal(journal().cancelRequested, true); assert.equal(journal().stopReason, 'server_shutdown');
    assert.equal(store.db.prepare('SELECT 1 AS healthy').get()?.healthy, 1);
    stopping.resolve(new Response(null, { status: 200 })); await closing;
    assert.equal(closed, true); assert.equal(journal().hangupStatus, 'accepted'); assert.equal(stopCalls().length, 1);
  } finally { stopping.resolve(new Response(null, { status: 200 })); await closing; }
});
