import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type WebSocket from 'ws';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerProviders } from '../src/providers.js';
import { RealtimeSidebands } from '../src/providers/realtime.js';
import { createVoiceStartOperations, voiceStartOperationsCollection, type VoiceStartDependencies } from '../src/providers/voice-operations.js';
import { seedMember } from './fixtures/membership.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const actor = { tenantId: 'shared-stop-tenant', userId: 'shared-stop-owner', sessionHash: hash('shared-stop-session'), role: 'owner' as const };
const binding = { actor, agentId: 'shared-stop-agent', configurationHash: hash('shared-stop-config') };
const access = { actor, key: 'voice.local:shared-stop-001' };
const answer = { callId: 'rtc_shared_stop', conversationId: 'shared-stop-conversation', sdp: 'v=0\r\ns=private-answer', toolsEnabled: [] };
const input = { key: access.key, binding, request: { sdp: 'v=0\r\ns=private-offer' } };
const snapshot = (store: Store) => store.db.prepare('SELECT * FROM entities ORDER BY rowid').all();
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(t: any, overrides: Partial<VoiceStartDependencies<typeof input.request>> = {}) {
  const store = new Store(':memory:'), sidebands = new RealtimeSidebands(store);
  let authorized = true, starts = 0, stops = 0, fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetches++; return new Response(null, { status: 200 }); }) as typeof fetch;
  t.after(() => { store.close(); globalThis.fetch = originalFetch; });
  const ops = createVoiceStartOperations(store, {
    authorize: candidate => authorized && candidate.configurationHash === binding.configurationHash,
    start: async ({ reportCall }) => { starts++; await reportCall(answer); return answer; },
    stop: async ({ callId, reason }) => { stops++; return sidebands.stopCall(callId, 'synthetic-key-only', actor.tenantId, reason); },
    ...overrides,
  });
  const stopRow = (status: unknown, extra: Record<string, unknown> = {}, tenant = actor.tenantId) => store.create(tenant, 'voice-stop-operations', { callId: answer.callId, status, reason: 'realtime_control_disconnected', ...extra });
  return { store, ops, stopRow, sidebands, revoke: () => { authorized = false; }, starts: () => starts, stops: () => stops, fetches: () => fetches };
}

test('shared terminal/uncertain receipts project into GET and list without writes, heartbeat or provider calls', async t => {
  for (const status of ['accepted', 'rejected', 'unknown', 'pending'] as const) await t.test(status, async child => {
    const f = fixture(child); await f.ops.start(input); f.stopRow(status);
    const before = snapshot(f.store), local = f.store.list(actor.tenantId, voiceStartOperationsCollection)[0];
    assert.equal(local.hangupStatus, 'not_requested'); assert.equal(local.cancelRequested, false);
    for (const view of [f.ops.status(access), f.ops.list({ actor }).items[0]]) {
      assert.equal(view.hangupStatus, status === 'pending' ? 'unknown' : status);
      assert.equal(view.cancelRequested, true); assert.equal(view.stopReason, 'realtime_control_disconnected');
      assert.equal(view.leaseExpiresAt, new Date(Number(local.leaseExpiresAt)).toISOString());
      assert.equal(view.status, 'succeeded');
      const serialized = JSON.stringify(view);
      for (const secret of ['binding', 'sessionHash', actor.sessionHash, 'configurationHash', 'private-answer', 'private-offer', 'synthetic-key-only']) assert.equal(serialized.includes(secret), false);
    }
    assert.deepEqual(snapshot(f.store), before); assert.equal(f.starts(), 1); assert.equal(f.stops(), 0); assert.equal(f.fetches(), 0);
  });
});

test('accepted evidence is monotonic; terminal shared outcome replaces stale mirror state', async t => {
  const f = fixture(t); await f.ops.start(input);
  const row = f.store.list(actor.tenantId, voiceStartOperationsCollection)[0];
  f.store.update(actor.tenantId, voiceStartOperationsCollection, row.id, { hangupStatus: 'unknown', cancelRequested: true });
  const shared = f.stopRow('accepted'); assert.equal(f.ops.status(access).hangupStatus, 'accepted');
  f.store.update(actor.tenantId, voiceStartOperationsCollection, row.id, { hangupStatus: 'accepted' });
  f.store.update(actor.tenantId, 'voice-stop-operations', shared.id, { status: 'rejected' });
  assert.equal(f.ops.status(access).hangupStatus, 'accepted');
  f.store.update(actor.tenantId, voiceStartOperationsCollection, row.id, { hangupStatus: 'pending' });
  assert.equal(f.ops.status(access).hangupStatus, 'rejected');
  f.store.update(actor.tenantId, 'voice-stop-operations', shared.id, { status: 'unknown' });
  assert.equal(f.ops.status(access).hangupStatus, 'unknown');
  assert.equal(f.fetches(), 0);
});

test('pending has live helper proof only while its single stop awaits; reconstructed helper stays uncertain', async t => {
  const response = deferred<Response>(), f = fixture(t); let calls = 0;
  globalThis.fetch = (async () => { calls++; return response.promise; }) as typeof fetch;
  await f.ops.start(input); const stopping = f.ops.cancel(access); await tick();
  const before = snapshot(f.store);
  assert.equal(f.ops.status(access).hangupStatus, 'pending'); assert.equal(f.ops.list({ actor }).items[0].hangupStatus, 'pending');
  const restarted = createVoiceStartOperations(f.store, { authorize: () => true, start: async () => { throw new Error('no start'); }, stop: async () => { throw new Error('no stop'); } });
  assert.equal(restarted.status(access).hangupStatus, 'unknown'); assert.deepEqual(snapshot(f.store), before);
  response.resolve(new Response(null, { status: 200 })); assert.equal((await stopping).hangupStatus, 'accepted'); assert.equal(calls, 1);
});

test('malformed or duplicate shared receipts fail conservatively without copying raw reasons or diagnostics', async t => {
  for (const mutation of ['invalid_status', 'foreign_body', 'invalid_id', 'invalid_time', 'duplicate']) await t.test(mutation, async child => {
    const f = fixture(child); await f.ops.start(input); const row = f.stopRow(mutation === 'duplicate' ? 'rejected' : 'accepted');
    const invalid = { ...row, reason: 'sk_mock_secret_reason', providerError: 'private provider body',
      ...(mutation === 'invalid_status' ? { status: 'success-with-secret' } : {}),
      ...(mutation === 'foreign_body' ? { tenantId: 'foreign-tenant' } : {}),
      ...(mutation === 'invalid_id' ? { id: '../secret' } : {}),
      ...(mutation === 'invalid_time' ? { updatedAt: 'private-invalid-date' } : {}),
    };
    f.store.db.prepare('UPDATE entities SET body=? WHERE id=?').run(JSON.stringify(invalid), row.id);
    if (mutation === 'duplicate') f.stopRow('unknown');
    const before = snapshot(f.store), view = f.ops.status(access), serialized = JSON.stringify(view);
    assert.equal(view.hangupStatus, 'unknown'); assert.equal(view.cancelRequested, true); assert.equal(view.errorCode, 'voice_stop_state_conflict');
    assert.equal(view.stopReason, undefined);
    for (const secret of ['sk_mock', 'private provider', 'private-invalid', '../secret', 'foreign-tenant']) assert.equal(serialized.includes(secret), false);
    assert.deepEqual(snapshot(f.store), before); assert.equal(f.fetches(), 0);
  });
  const f = fixture(t); await f.ops.start(input); f.stopRow('accepted', { reason: 'sk_mock_secret_reason', providerHttpStatus: 401, error: 'private body' });
  const view = f.ops.status(access); assert.equal(view.hangupStatus, 'accepted'); assert.equal(view.stopReason, undefined); assert.equal(JSON.stringify(view).includes('private body'), false);
});

test('tenant, operator, original session, role and exact configuration still fence shared stop projection', async t => {
  const f = fixture(t); await f.ops.start(input); f.stopRow('accepted', {}, 'foreign-tenant');
  assert.equal(f.ops.status(access).hangupStatus, 'not_requested');
  f.stopRow('rejected');
  for (const other of [{ ...actor, tenantId: 'foreign-tenant' }, { ...actor, userId: 'other-owner' }, { ...actor, sessionHash: hash('new-session') }, { ...actor, role: 'admin' as const }]) {
    assert.throws(() => f.ops.status({ key: access.key, actor: other }), (error: any) => error.code === 'voice_operation_not_found');
    assert.deepEqual(f.ops.list({ actor: other }).items, []);
  }
  f.revoke(); assert.throws(() => f.ops.status(access), (error: any) => error.code === 'voice_authority_revoked'); assert.deepEqual(f.ops.list({ actor }).items, []);
  assert.equal(f.fetches(), 0);
});

test('stop already registered during start suppresses SDP, and stale explicit cancel only reuses the shared receipt', async t => {
  const f = fixture(t, { start: async ({ reportCall }) => { await reportCall(answer); f.stopRow('rejected'); return answer; } });
  const result = await f.ops.start(input);
  assert.equal(result.requiresRecovery, true); assert.equal(result.sdp, undefined); assert.equal(result.toolsEnabled, undefined);
  assert.equal(result.hangupStatus, 'rejected'); assert.equal(result.cancelRequested, true);
  const cancelled = await f.ops.cancel(access); assert.equal(cancelled.hangupStatus, 'rejected'); assert.equal(cancelled.stopReason, 'realtime_control_disconnected');
  await f.ops.cancel(access); assert.equal(f.fetches(), 0); assert.equal(f.stops(), 1);
  const heartbeat = await f.ops.heartbeat(access); assert.equal(heartbeat.hangupStatus, 'rejected'); assert.equal(heartbeat.cancelRequested, true);
});

class Socket extends EventEmitter {
  readyState = 0;
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  send() {}
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
test('HTTP shared rejection from sideband disconnect is immediately discoverable and no GET repeats hangup', async t => {
  const env = { PROVIDER_TENANT_ID: actor.tenantId, OPENAI_API_KEY: 'synthetic-key-only', OPENAI_MODEL: 'mock-text', OPENAI_REALTIME_MODEL: 'mock-voice' };
  const previous = { ...process.env }, originalFetch = globalThis.fetch; Object.assign(process.env, env);
  const store = new Store(':memory:'), app = Fastify({ logger: false }); seedMember(store, actor);
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(actor.sessionHash, actor.userId, actor.tenantId, Date.now() + 3600000);
  const agent = store.create(actor.tenantId, 'agents', { name: 'Shared stop integration', status: 'active', prompt: 'synthetic prompt', initialMessage: '', voice: 'marin', language: 'pt-BR', rules: [], tools: [], settings: {} });
  let socket!: Socket, calls = 0;
  globalThis.fetch = (async url => { calls++; return String(url).endsWith('/hangup') ? new Response(null, { status: 400 }) : new Response(answer.sdp, { status: 201, headers: { location: '/v1/realtime/calls/' + answer.callId } }); }) as typeof fetch;
  await app.register(cookie); await registerAuth(app, store); await registerProviders(app, store, { socketFactory: () => (socket = new Socket()) as unknown as WebSocket }); await app.ready();
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = originalFetch; for (const key of Object.keys(env)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  const headers = { cookie: 'kloel_session=shared-stop-session' }, base = '/api/v1/ai/realtime/operations', operation = base + '/' + encodeURIComponent(access.key);
  const started = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', headers, payload: { agentId: agent.id, sdp: input.request.sdp, idempotencyKey: access.key } }); assert.equal(started.statusCode, 200, started.body);
  socket.close(); await tick();
  assert.equal(store.list(actor.tenantId, 'voice-stop-operations')[0].status, 'rejected');
  assert.equal(store.list(actor.tenantId, voiceStartOperationsCollection)[0].hangupStatus, 'not_requested');
  const before = snapshot(store), beforeCalls = calls;
  const single = await app.inject({ url: operation, headers }), list = await app.inject({ url: base, headers });
  assert.equal(single.statusCode, 200, single.body); assert.equal(list.statusCode, 200, list.body);
  for (const view of [single.json(), list.json().items[0]]) { assert.equal(view.hangupStatus, 'rejected'); assert.equal(view.cancelRequested, true); assert.equal(view.stopReason, 'realtime_control_disconnected'); }
  assert.deepEqual(snapshot(store), before); assert.equal(calls, beforeCalls);
  const cancel = await app.inject({ method: 'POST', url: operation + '/cancel', headers, payload: {} }); assert.equal(cancel.statusCode, 200, cancel.body); assert.equal(cancel.json().hangupStatus, 'rejected'); assert.equal(calls, beforeCalls);
});
