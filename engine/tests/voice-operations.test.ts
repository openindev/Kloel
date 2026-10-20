import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { createVoiceStartOperations, VoiceStartRejected, voiceStartOperationsCollection, type VoiceStartDependencies, type VoiceOperationBinding, type VoiceStartAnswer } from '../src/providers/voice-operations.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const binding: VoiceOperationBinding = { actor: { tenantId: 'tenant-a', userId: 'owner-a', role: 'owner', sessionHash: hash('session-a') }, agentId: 'agent-a', configurationHash: hash('agent-configuration') };
const request = { sdp: 'v=0\r\ns=offer-private-value', preview: true };
const answer: VoiceStartAnswer = { callId: 'rtc_test_call', conversationId: 'conversation-a', sdp: 'v=0\r\ns=answer-private-value', toolsEnabled: ['search_knowledge'] };
const access = { key: 'voice-test-0001', actor: binding.actor };
const input = { key: access.key, binding, request };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function tick() { await new Promise(resolve => setImmediate(resolve)); }
function fixture(t: any, overrides: Partial<VoiceStartDependencies<typeof request>> = {}) {
  const store = new Store(); t.after(() => store.close());
  let time = Date.parse('2026-10-18T12:00:00Z'), authorized = true, starts = 0, stops = 0;
  const deps: VoiceStartDependencies<typeof request> = {
    now: () => time, authorize: value => authorized && value.configurationHash === binding.configurationHash && value.actor.sessionHash === binding.actor.sessionHash,
    start: async ({ reportCall }) => { starts++; await reportCall(answer); return answer; },
    stop: async () => { stops++; return 'accepted'; }, ...overrides,
  };
  const ops = createVoiceStartOperations(store, deps);
  return { store, ops, deps, advance: (amount: number) => { time += amount; }, revoke: () => { authorized = false; }, starts: () => starts, stops: () => stops };
}

test('first start returns negotiation once; replay/status and durable journal contain no SDP or session secret', async t => {
  const f = fixture(t);
  const first = await f.ops.start(input);
  assert.equal(first.status, 'succeeded'); assert.equal(first.sdp, answer.sdp); assert.equal(first.requiresRecovery, false);
  assert.equal(first.callId, answer.callId); assert.deepEqual(first.toolsEnabled, answer.toolsEnabled);
  const replay = await f.ops.start(input), status = f.ops.status(access);
  assert.equal(replay.requiresRecovery, true); assert.equal(replay.sdp, undefined); assert.equal(f.starts(), 1);
  for (const result of [replay, status]) { const text = JSON.stringify(result); assert.equal(text.includes('private-value'), false); assert.equal(text.includes(binding.actor.sessionHash), false); assert.equal(text.includes('configurationHash'), false); }
  const persisted = JSON.stringify(f.store.list(binding.actor.tenantId, voiceStartOperationsCollection));
  assert.equal(persisted.includes(request.sdp), false); assert.equal(persisted.includes(answer.sdp), false); assert.equal(persisted.includes('offer-private-value'), false);
  assert.equal(status.heartbeatIntervalMs, 15_000); assert.equal(Date.parse(status.leaseExpiresAt), Date.parse('2026-10-18T12:01:00Z'));
});

test('concurrent requests and a second helper share committed idempotency without duplicate start', async t => {
  const wait = deferred<VoiceStartAnswer>(); let calls = 0;
  const f = fixture(t, { start: async () => { calls++; return wait.promise; } });
  const original = f.ops.start(input); await tick();
  assert.equal(f.ops.status(access).status, 'pending');
  const peer = createVoiceStartOperations(f.store, f.deps), replay = await peer.start(input);
  assert.equal(replay.status, 'pending'); assert.equal(replay.requiresRecovery, true); assert.equal(calls, 1);
  wait.resolve(answer); assert.equal((await original).status, 'succeeded'); assert.equal(calls, 1);
});

test('changed SDP, assistant or configuration cannot reuse operation key; unknown input is rejected before network', async t => {
  const f = fixture(t); await f.ops.start(input);
  await assert.rejects(f.ops.start({ ...input, request: { ...request, sdp: 'v=0\r\ns=different' } }), (error: any) => error.code === 'voice_idempotency_conflict');
  await assert.rejects(f.ops.start({ ...input, binding: { ...binding, agentId: 'other-agent' } }), (error: any) => error.code === 'voice_idempotency_conflict');
  await assert.rejects(f.ops.start({ ...input, binding: { ...binding, configurationHash: hash('changed') } }), (error: any) => error.code === 'voice_authority_revoked');
  await assert.rejects(f.ops.start({ ...input, key: undefined as any }), (error: any) => error.code === 'invalid_operation_key');
  await assert.rejects(f.ops.start({ ...input, binding: { ...binding, agentId: undefined as any } }), (error: any) => error.code === 'invalid_voice_binding');
  assert.equal(f.starts(), 1);
});

test('same opaque key never leaks other user, tenant, session or role operation', async t => {
  const f = fixture(t); await f.ops.start(input);
  for (const actor of [{ ...binding.actor, tenantId: 'tenant-b' }, { ...binding.actor, userId: 'other-user' }, { ...binding.actor, sessionHash: hash('other-session') }, { ...binding.actor, role: 'admin' as const }]) {
    assert.throws(() => f.ops.status({ ...access, actor }), (error: any) => error.code === 'voice_operation_not_found');
    await assert.rejects(f.ops.cancel({ ...access, actor }), (error: any) => error.code === 'voice_operation_not_found');
  }
  assert.equal(f.stops(), 0);
});

test('cancel during creation is durable and stops immediately when callId is reported, before SDP resolves', async t => {
  const identified = deferred<void>(), finishing = deferred<VoiceStartAnswer>(); let stopCount = 0;
  const f = fixture(t, { start: async ({ reportCall }) => { await identified.promise; await reportCall({ callId: answer.callId }); return finishing.promise; }, stop: async () => { stopCount++; return 'accepted'; } });
  const pending = f.ops.start(input); await tick();
  const cancelled = await f.ops.cancel(access); assert.equal(cancelled.cancelRequested, true); assert.equal(cancelled.hangupStatus, 'not_requested');
  identified.resolve(); await tick(); assert.equal(stopCount, 1); assert.equal(f.ops.status(access).hangupStatus, 'accepted');
  finishing.resolve(answer); const result = await pending;
  assert.equal(result.sdp, undefined); assert.equal(result.requiresRecovery, true); assert.equal(result.cancelRequested, true);
  await f.ops.cancel(access); await f.ops.sweepExpired(); assert.equal(stopCount, 1);
});

test('heartbeat renews live lease; expiration cancels, later heartbeat never resurrects', async t => {
  const f = fixture(t); await f.ops.start(input);
  f.advance(15_000); const renewed = await f.ops.heartbeat(access);
  assert.equal(Date.parse(renewed.leaseExpiresAt), Date.parse('2026-10-18T12:01:15Z'));
  f.advance(59_999); await f.ops.sweepExpired(); assert.equal(f.stops(), 0);
  f.advance(1); await f.ops.sweepExpired(); assert.equal(f.stops(), 1);
  const expired = f.ops.status(access); assert.equal(expired.cancelRequested, true); assert.equal(expired.stopReason, 'lease_expired');
  f.advance(15_000); const later = await f.ops.heartbeat(access);
  assert.equal(later.leaseExpiresAt, expired.leaseExpiresAt); assert.equal(later.hangupStatus, 'accepted'); assert.equal(f.stops(), 1);
});

test('pending lease expiration fences late success and stops the eventual call instead of returning SDP', async t => {
  const wait = deferred<VoiceStartAnswer>();
  const f = fixture(t, { start: async () => wait.promise });
  const pending = f.ops.start(input); await tick(); f.advance(60_000); await f.ops.sweepExpired();
  assert.equal(f.ops.status(access).status, 'unknown');
  wait.resolve(answer); const result = await pending;
  assert.equal(result.status, 'unknown'); assert.equal(result.sdp, undefined); assert.equal(result.hangupStatus, 'accepted'); assert.equal(f.stops(), 1);
});

test('membership/session/configuration revocation is checked on replay, status, heartbeat and quiet sweep', async t => {
  const f = fixture(t); await f.ops.start(input); f.revoke();
  assert.throws(() => f.ops.status(access), (error: any) => error.code === 'voice_authority_revoked');
  await assert.rejects(f.ops.start(input), (error: any) => error.code === 'voice_authority_revoked');
  await assert.rejects(f.ops.heartbeat(access), (error: any) => error.code === 'voice_authority_revoked');
  await f.ops.sweepExpired(); assert.equal(f.stops(), 1);
  const persisted = f.store.list(binding.actor.tenantId, voiceStartOperationsCollection)[0];
  assert.equal(persisted.stopReason, 'authorization_revoked'); assert.equal(persisted.hangupStatus, 'accepted');
});

test('revocation while start is awaiting persists identity and compensates before denying the response', async t => {
  const wait = deferred<VoiceStartAnswer>();
  const f = fixture(t, { start: async () => wait.promise });
  const pending = f.ops.start(input); await tick(); f.revoke(); wait.resolve(answer);
  await assert.rejects(pending, (error: any) => error.code === 'voice_authority_revoked');
  assert.equal(f.stops(), 1); const row = f.store.list(binding.actor.tenantId, voiceStartOperationsCollection)[0];
  assert.equal(row.callId, answer.callId); assert.equal(row.hangupStatus, 'accepted');
});

test('uncertain starts never retry; definite provider rejection is explicitly failed without invented call', async t => {
  let attempts = 0;
  const f = fixture(t, { start: async () => { attempts++; throw new Error('upstream timeout with secret key sk_example'); } });
  const first = await f.ops.start(input); assert.equal(first.status, 'unknown'); assert.equal(first.callId, undefined); assert.equal(first.errorCode, 'voice_start_outcome_unknown');
  const replay = await f.ops.start(input); assert.equal(replay.status, 'unknown'); assert.equal(attempts, 1); assert.equal(JSON.stringify(replay).includes('sk_example'), false);
  const rejected = createVoiceStartOperations(f.store, { ...f.deps, start: async () => { throw new VoiceStartRejected('provider_400'); } });
  const result = await rejected.start({ ...input, key: 'voice-rejected-0001' }); assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'provider_400');
  assert.equal(f.stops(), 0);
});

test('malformed SDP with known call is closed; malformed ID fields do not become fake succeeded', async t => {
  const f = fixture(t, { start: async () => ({ ...answer, sdp: 'not SDP' }) });
  const result = await f.ops.start(input); assert.equal(result.status, 'unknown'); assert.equal(result.hangupStatus, 'accepted'); assert.equal(result.errorCode, 'invalid_voice_response'); assert.equal(f.stops(), 1);
  const other = createVoiceStartOperations(f.store, { ...f.deps, start: async () => ({ ...answer, conversationId: undefined as any }) });
  const malformed = await other.start({ ...input, key: 'voice-malformed-0001' }); assert.equal(malformed.status, 'unknown'); assert.equal(malformed.sdp, undefined);
});

test('stop outcomes rejected/unknown are truthful and never retried by cancel/lease/restart', async t => {
  let stops = 0;
  const f = fixture(t, { stop: async () => { stops++; throw new Error('connection failed'); } });
  await f.ops.start(input); assert.equal((await f.ops.cancel(access)).hangupStatus, 'unknown');
  await f.ops.cancel(access); f.advance(90_000); await f.ops.sweepExpired();
  const restart = createVoiceStartOperations(f.store, f.deps); await restart.recoverPreviousExecutions(); await restart.cancel(access);
  assert.equal(stops, 1); assert.equal(restart.status(access).hangupStatus, 'unknown');
  const rejection = createVoiceStartOperations(f.store, { ...f.deps, stop: async () => { stops++; return 'rejected'; } });
  await rejection.start({ ...input, key: 'voice-stop-rejected' });
  assert.equal((await rejection.cancel({ ...access, key: 'voice-stop-rejected' })).hangupStatus, 'rejected');
  await rejection.cancel({ ...access, key: 'voice-stop-rejected' }); assert.equal(stops, 2);
});

test('concurrent cancellation claims one stop, and no transaction remains open across awaits', async t => {
  const stop = deferred<'accepted'>(); let calls = 0;
  const f = fixture(t, { stop: async () => { calls++; return stop.promise; } });
  await f.ops.start(input);
  const a = f.ops.cancel(access), b = f.ops.cancel(access); await tick(); assert.equal(calls, 1);
  assert.doesNotThrow(() => f.store.transaction(() => f.store.create('tenant-a', 'unrelated', { value: 1 })));
  assert.equal(f.ops.status(access).hangupStatus, 'pending'); stop.resolve('accepted');
  assert.equal((await a).hangupStatus, 'accepted'); assert.equal((await b).hangupStatus, 'accepted');
});

test('startup recovery stops known previous calls and marks lost pending starts unknown without retry', async t => {
  const wait = deferred<VoiceStartAnswer>(); let starts = 0;
  const f = fixture(t, { start: async ({ reportCall, request: value }) => { starts++; if (value.preview) { await reportCall(answer); return answer; } return wait.promise; } });
  await f.ops.start(input);
  const pending = f.ops.start({ ...input, key: 'voice-pending-restart', request: { ...request, preview: false } }); await tick();
  const replacement = createVoiceStartOperations(f.store, f.deps), recovered = await replacement.recoverPreviousExecutions();
  assert.equal(recovered.recovered, 2); assert.equal(f.stops(), 1);
  const prior = replacement.status(access); assert.equal(prior.status, 'unknown'); assert.equal(prior.hangupStatus, 'accepted');
  assert.equal((await replacement.start({ ...input, key: 'voice-pending-restart', request: { ...request, preview: false } })).status, 'unknown'); assert.equal(starts, 2);
  // A late callback from the old owner may reveal a call, but cannot overwrite recovery state.
  wait.resolve({ ...answer, callId: 'rtc_late', conversationId: 'conversation-late' });
  const late = await pending; assert.equal(late.status, 'unknown'); assert.equal(late.sdp, undefined); assert.equal(late.hangupStatus, 'accepted'); assert.equal(f.stops(), 2);
});

test('startup recovery treats a previously attempted pending stop as unknown and does not repeat it', async t => {
  const f = fixture(t); await f.ops.start(input);
  const row = f.store.list(binding.actor.tenantId, voiceStartOperationsCollection)[0];
  f.store.update(row.tenantId, voiceStartOperationsCollection, row.id, { cancelRequested: true, hangupStatus: 'pending', stopAttemptId: 'old-attempt' });
  const restart = createVoiceStartOperations(f.store, f.deps); await restart.recoverPreviousExecutions();
  assert.equal(restart.status(access).hangupStatus, 'unknown'); assert.equal(f.stops(), 0);
});

test('shutdown marks in-progress starts before draining and stops the late created call', async t => {
  const wait = deferred<VoiceStartAnswer>();
  const f = fixture(t, { start: async () => wait.promise });
  const pending = f.ops.start(input); await tick();
  let closed = false; const closing = f.ops.close().then(() => { closed = true; }); await tick();
  assert.equal(closed, false); assert.equal(f.ops.status(access).cancelRequested, true);
  await assert.rejects(f.ops.start({ ...input, key: 'voice-new-on-close' }), (error: any) => error.code === 'voice_service_closing');
  wait.resolve(answer); assert.equal((await pending).sdp, undefined); await closing;
  assert.equal(closed, true); assert.equal(f.stops(), 1); assert.equal(f.ops.status(access).stopReason, 'server_shutdown');
});

test('stop timeout stays unknown without a second request; later provider evidence may confirm the same attempt', async t => {
  const stop = deferred<'accepted'>(); let calls = 0;
  const f = fixture(t, { stopTimeoutMs: 10, stop: async () => { calls++; return stop.promise; } });
  await f.ops.start(input);
  const keepingTestAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepingTestAlive));
  const initial = await f.ops.cancel(access); assert.equal(initial.hangupStatus, 'unknown');
  await f.ops.cancel(access); await f.ops.sweepExpired(); assert.equal(calls, 1);
  let closed = false; const closing = f.ops.close().then(() => { closed = true; }); await tick(); assert.equal(closed, false);
  stop.resolve('accepted'); await closing;
  assert.equal(f.ops.status(access).hangupStatus, 'accepted'); assert.equal(calls, 1);
});

test('operation survives reopening an isolated SQLite database; startup never repeats the provider start', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'kloel-voice-operations-')), database = join(folder, 'temporary.sqlite');
  let store = new Store(database), starts = 0, stops = 0;
  const deps: VoiceStartDependencies<typeof request> = { authorize: () => true, start: async () => { starts++; return answer; }, stop: async () => { stops++; return 'accepted'; } };
  try {
    const original = createVoiceStartOperations(store, deps); await original.start(input);
    // Simulates loss of the old process, without orderly lifecycle.close(). This is test-only DB state.
    store.close(); store = new Store(database);
    const replacement = createVoiceStartOperations(store, deps);
    assert.equal((await replacement.recoverPreviousExecutions()).recovered, 1);
    const replay = await replacement.start(input);
    assert.equal(replay.status, 'unknown'); assert.equal(replay.hangupStatus, 'accepted'); assert.equal(replay.sdp, undefined);
    assert.equal(starts, 1); assert.equal(stops, 1);
    await replacement.close();
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
