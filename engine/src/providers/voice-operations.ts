import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Entity, Store } from '../store.js';
import type { Role } from '../memberships/permissions.js';

export const voiceStartOperationsCollection = 'voice-start-operations';
export const VOICE_OPERATION_LEASE_MS = 60_000;
export const VOICE_OPERATION_HEARTBEAT_MS = 15_000;
export type VoiceOperationActor = { tenantId: string; userId: string; sessionHash: string; role: Role };
export type VoiceOperationBinding = { actor: VoiceOperationActor; agentId: string; configurationHash: string };
export type VoiceStartStatus = 'pending' | 'succeeded' | 'failed' | 'unknown';
export type VoiceHangupResult = 'accepted' | 'rejected' | 'unknown';
export type VoiceHangupStatus = 'not_requested' | 'pending' | VoiceHangupResult;
export type VoiceStopReason = 'user_cancelled' | 'lease_expired' | 'authorization_revoked' | 'start_failed' | 'server_restarted' | 'server_shutdown';
export type VoiceObservedStopReason = VoiceStopReason | 'realtime_control_disconnected' | 'realtime_control_failed' | 'operator_session_revoked' | 'voice_route_revoked';
export type VoiceCallIdentity = { callId: string; conversationId?: string };
export type VoiceStartAnswer = VoiceCallIdentity & { sdp: string; conversationId: string; toolsEnabled: string[] };
export type VoiceOperationView = {
  operationKey: string; agentId: string; status: VoiceStartStatus;
  callId?: string; conversationId?: string; cancelRequested: boolean;
  hangupStatus: VoiceHangupStatus; stopReason?: VoiceObservedStopReason; errorCode?: string;
  leaseExpiresAt: string; heartbeatIntervalMs: number; createdAt: string; updatedAt: string;
};
export type VoiceStartResponse = VoiceOperationView & { requiresRecovery: boolean; sdp?: string; toolsEnabled?: string[] };
export type VoiceOperationAccess = { key: string; actor: VoiceOperationActor };
export type VoiceOperationListInput = { actor: VoiceOperationActor; agentId?: string; conversationId?: string; limit?: number; cursor?: string };
export type VoiceOperationPage = { items: VoiceOperationView[]; nextCursor: string | null; limit: number };
export type VoiceStartInput<Request> = { key: string; binding: VoiceOperationBinding; request: Request };
export type VoiceStartDependencies<Request> = {
  /** Must synchronously resolve the ORIGINAL session, membership capability and exact agent configuration. */
  authorize: (binding: Readonly<VoiceOperationBinding>) => boolean;
  start: (input: {
    binding: Readonly<VoiceOperationBinding>; request: Request; operationKey: string;
    /** Await immediately after the provider Location is known, before awaiting SDP or attaching control. */
    reportCall: (identity: VoiceCallIdentity) => Promise<VoiceOperationView>;
    assertActive: () => void;
  }) => Promise<VoiceStartAnswer>;
  /** Cleanup deliberately works after the original session is revoked. Supply server credentials here. */
  stop: (input: { binding: Readonly<VoiceOperationBinding>; callId: string; reason: VoiceStopReason }) => Promise<VoiceHangupResult>;
  now?: () => number; leaseMs?: number; stopTimeoutMs?: number;
};

export class VoiceOperationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'VoiceOperationError'; }
}
/** Use ONLY for a response proving no call was created. Timeouts/5xx/malformed answers are unknown. */
export class VoiceStartRejected extends Error {
  constructor(readonly code = 'voice_start_rejected') { super('O provedor recusou a criação da chamada.'); this.name = 'VoiceStartRejected'; }
}
type Row = Entity & {
  operationKey: string; binding: VoiceOperationBinding; requestHash: string; executionId: string;
  startAttemptId: string; completionFence: string; status: VoiceStartStatus;
  callId?: string; conversationId?: string; cancelRequested: boolean; stopReason?: VoiceStopReason;
  leaseExpiresAt: number; hangupStatus: VoiceHangupStatus; stopAttemptId?: string;
  errorCode?: string; completedAt?: string; stopStartedAt?: number; stopCompletedAt?: string;
};
const id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && id.test(value);
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const hashPattern = /^[a-f0-9]{64}$/i;
const roles = new Set(['owner', 'admin', 'member', 'editor', 'builder', 'viewer']);
const observedStopReasons = new Set<VoiceObservedStopReason>(['user_cancelled', 'lease_expired', 'authorization_revoked', 'start_failed', 'server_restarted', 'server_shutdown', 'realtime_control_disconnected', 'realtime_control_failed', 'operator_session_revoked', 'voice_route_revoked']);
const observedStopReason = (value: unknown): VoiceObservedStopReason | undefined => typeof value === 'string' && observedStopReasons.has(value as VoiceObservedStopReason) ? value as VoiceObservedStopReason : undefined;
const validTimestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const safeCode = (value: string) => /^[a-z0-9_]{1,80}$/.test(value) ? value : 'voice_start_rejected';
function failure(status: number, code: string, message: string): never { throw new VoiceOperationError(status, code, message); }

function validateActor(actor: VoiceOperationActor): void {
  if (!actor || !validId(actor.tenantId) || !validId(actor.userId) || typeof actor.sessionHash !== 'string' || !hashPattern.test(actor.sessionHash) || !roles.has(actor.role)) failure(400, 'invalid_voice_actor', 'Identidade de voz inválida.');
}
function validateKey(key: string): void { if (typeof key !== 'string' || !keyPattern.test(key)) failure(400, 'invalid_operation_key', 'Chave de operação inválida.'); }
function validateIdentity(identity: VoiceCallIdentity): void {
  if (!identity || !validId(identity.callId) || (identity.conversationId !== undefined && !validId(identity.conversationId))) failure(502, 'invalid_call_identity', 'Identificação da chamada inválida.');
}
function sameActor(a: VoiceOperationActor, b: VoiceOperationActor): boolean {
  return a.tenantId === b.tenantId && a.userId === b.userId && a.sessionHash === b.sessionHash && a.role === b.role;
}
function fingerprint(input: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, canonical(part)]));
    if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return value;
    return failure(400, 'invalid_voice_request', 'Pedido de voz inválido.');
  };
  let serialized: string;
  try { serialized = JSON.stringify(canonical(input)); }
  catch { return failure(400, 'invalid_voice_request', 'Pedido de voz inválido.'); }
  if (Buffer.byteLength(serialized) > 262_144) failure(400, 'invalid_voice_request', 'Pedido de voz excedeu o limite.');
  return createHash('sha256').update(serialized).digest('hex');
}

/** Single-writer lifecycle journal. No provider credentials, request SDP or response SDP are persisted. */
export function createVoiceStartOperations<Request>(store: Store, dependencies: VoiceStartDependencies<Request>) {
  // Cursors reveal no actor/session data and expire when this runtime is replaced.
  const cursorSecret = randomBytes(32);
  const executionId = randomUUID(), now = dependencies.now ?? Date.now;
  const leaseMs = dependencies.leaseMs ?? VOICE_OPERATION_LEASE_MS;
  const stopTimeoutMs = dependencies.stopTimeoutMs ?? 15_000;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0 || !Number.isFinite(stopTimeoutMs) || stopTimeoutMs <= 0) throw new Error('Invalid voice operation timing');
  const stopping = new Map<string, Promise<void>>();
  const providerStops = new Set<Promise<void>>();
  const activeStarts = new Set<Promise<VoiceStartResponse>>();
  let closing = false;
  const read = (row: Pick<Row, 'tenantId' | 'id'>): Row => {
    const result = store.get(row.tenantId, voiceStartOperationsCollection, row.id);
    if (!result) return failure(404, 'voice_operation_not_found', 'Operação de voz não encontrada.');
    return result as Row;
  };
  const authorized = (binding: VoiceOperationBinding): boolean => {
    try { return dependencies.authorize(structuredClone(binding)) === true; } catch { return false; }
  };
  const requireAuthorized = (binding: VoiceOperationBinding): void => {
    if (!authorized(binding)) failure(403, 'voice_authority_revoked', 'A autorização desta chamada não está mais válida.');
  };
  const view = (row: Row): VoiceOperationView => {
    let hangupStatus = row.hangupStatus, cancelRequested = row.cancelRequested, updatedAt = row.updatedAt;
    let stopReason = observedStopReason(row.stopReason), errorCode = row.errorCode;
    if (validId(row.callId)) {
      // Bounded, tenant-local lookup; GET never repairs journals or initiates a stop.
      const receipts = store.db.prepare("SELECT id,body FROM entities WHERE tenant_id=? AND collection='voice-stop-operations' AND CASE WHEN json_valid(body) THEN json_extract(body,'$.callId') END=? ORDER BY rowid LIMIT 2").all(row.tenantId, row.callId);
      if (receipts.length) {
        cancelRequested = true;
        const valid = receipts.map(receipt => {
          const data = JSON.parse(String(receipt.body)) as Record<string, unknown>;
          return data.id === receipt.id && validId(data.id) && data.tenantId === row.tenantId && data.callId === row.callId
            && ['pending', 'accepted', 'rejected', 'unknown'].includes(String(data.status))
            && validTimestamp(data.createdAt) && validTimestamp(data.updatedAt) ? data : undefined;
        });
        const shared = valid.length === 1 ? valid[0] : undefined;
        const conflicting = valid.length > 1 || valid.some(receipt => !receipt)
          || row.hangupStatus === 'rejected' && shared?.status !== 'rejected' && shared?.status !== 'accepted'
          || row.hangupStatus === 'accepted' && shared?.status !== 'accepted';
        // Accepted is a confirmed provider receipt, not a claim that remote media ended.
        // Never downgrade that evidence because another mirror is older or inconsistent.
        if (row.hangupStatus === 'accepted' || valid.some(receipt => receipt?.status === 'accepted')) hangupStatus = 'accepted';
        else if (conflicting) hangupStatus = 'unknown';
        else if (shared?.status === 'rejected') hangupStatus = 'rejected';
        else if (shared?.status === 'pending' && row.hangupStatus === 'pending' && stopping.has(row.id)) hangupStatus = 'pending';
        else hangupStatus = 'unknown';
        // A durable pending row alone does not prove a live worker after restart.
        // Direct sideband stops also remain uncertain until their final receipt arrives.
        stopReason = shared ? observedStopReason(shared.reason) : undefined;
        if (conflicting) errorCode = 'voice_stop_state_conflict';
        for (const receipt of valid) if (receipt && Date.parse(String(receipt.updatedAt)) > Date.parse(updatedAt)) updatedAt = String(receipt.updatedAt);
      }
    }
    return {
      operationKey: row.operationKey, agentId: row.binding.agentId, status: row.status,
      ...(row.callId ? { callId: row.callId } : {}), ...(row.conversationId ? { conversationId: row.conversationId } : {}),
      cancelRequested, hangupStatus,
      ...(stopReason ? { stopReason } : {}), ...(errorCode ? { errorCode } : {}),
      leaseExpiresAt: new Date(row.leaseExpiresAt).toISOString(), heartbeatIntervalMs: VOICE_OPERATION_HEARTBEAT_MS,
      createdAt: row.createdAt, updatedAt,
    };
  };
  const all = (): Row[] => store.db.prepare('SELECT body FROM entities WHERE collection=? ORDER BY rowid').all(voiceStartOperationsCollection).map(item => JSON.parse(String(item.body)) as Row);
  const getOwned = ({ key, actor }: VoiceOperationAccess): Row => {
    validateKey(key); validateActor(actor);
    const row = store.list(actor.tenantId, voiceStartOperationsCollection).find(item => item.operationKey === key && (item.binding as VoiceOperationBinding).actor.userId === actor.userId) as Row | undefined;
    if (!row || !sameActor(row.binding.actor, actor)) return failure(404, 'voice_operation_not_found', 'Operação de voz não encontrada.');
    requireAuthorized(row.binding); return row;
  };
  const patch = (row: Row, data: Partial<Row>): Row => store.update(row.tenantId, voiceStartOperationsCollection, row.id, data) as Row;
  const cancelRow = (row: Row, reason: VoiceStopReason, invalidatePending = false): Row => {
    const current = read(row);
    if (current.status === 'failed' && !current.callId) return current;
    return patch(current, {
      cancelRequested: true, stopReason: current.stopReason ?? reason,
      ...(invalidatePending && current.status === 'pending' ? { status: 'unknown', completionFence: randomUUID(), errorCode: reason === 'lease_expired' ? 'voice_lease_expired_during_start' : 'voice_execution_interrupted' } : {}),
    });
  };
  function stopOnce(row: Row): Promise<void> {
    const inFlight = stopping.get(row.id);
    if (inFlight) return inFlight;
    const claim = store.transaction(() => {
      const current = read(row);
      if (!current.cancelRequested || !current.callId || current.hangupStatus !== 'not_requested') return undefined;
      return patch(current, { hangupStatus: 'pending', stopAttemptId: randomUUID(), stopStartedAt: now() });
    });
    if (!claim) return Promise.resolve();
    const finish = (status: VoiceHangupResult) => store.transaction(() => {
      const current = read(claim);
      if (current.stopAttemptId !== claim.stopAttemptId || current.hangupStatus === 'accepted' || current.hangupStatus === 'rejected') return;
      patch(current, { hangupStatus: status, stopCompletedAt: new Date(now()).toISOString() });
    });
    // Claim is committed BEFORE any external stop. A crash/timeout never creates an automatic second stop.
    const provider = Promise.resolve().then(() => dependencies.stop({ binding: structuredClone(claim.binding), callId: claim.callId!, reason: claim.stopReason ?? 'user_cancelled' }))
      .then(result => { finish(['accepted', 'rejected', 'unknown'].includes(result) ? result : 'unknown'); }, () => { finish('unknown'); });
    providerStops.add(provider);
    void provider.then(() => providerStops.delete(provider), () => providerStops.delete(provider));
    const pending = new Promise<void>(resolve => {
      const timer = setTimeout(() => { finish('unknown'); resolve(); }, stopTimeoutMs);
      timer.unref?.();
      void provider.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
    });
    stopping.set(row.id, pending);
    void pending.finally(() => { if (stopping.get(row.id) === pending) stopping.delete(row.id); });
    return pending;
  }
  const inactivity = (row: Row): VoiceStopReason | undefined => row.cancelRequested ? row.stopReason ?? 'user_cancelled' : closing ? 'server_shutdown' : !authorized(row.binding) ? 'authorization_revoked' : row.leaseExpiresAt <= now() ? 'lease_expired' : undefined;
  function assertActive(row: Row): void {
    const current = read(row);
    const reason = inactivity(current);
    if (reason || current.status === 'failed' || current.status === 'unknown') failure(409, 'voice_start_cancelled', 'A conexão de voz foi cancelada ou perdeu sua autorização.');
  }
  async function reportCall(original: Row, identity: VoiceCallIdentity): Promise<VoiceOperationView> {
    validateIdentity(identity);
    let current = store.transaction(() => {
      const fresh = read(original);
      if (fresh.startAttemptId !== original.startAttemptId) return failure(409, 'voice_operation_changed', 'A operação mudou durante a conexão.');
      if ((fresh.callId && fresh.callId !== identity.callId) || (fresh.conversationId && identity.conversationId && fresh.conversationId !== identity.conversationId)) return failure(409, 'voice_call_binding_conflict', 'A identificação da chamada mudou.');
      return patch(fresh, { callId: identity.callId, ...(identity.conversationId ? { conversationId: identity.conversationId } : {}) });
    });
    const reason = inactivity(current);
    if (reason) current = store.transaction(() => cancelRow(current, reason));
    await stopOnce(current);
    return view(read(current));
  }
  async function performStart(row: Row, request: Request): Promise<VoiceStartResponse> {
    let answer: VoiceStartAnswer | undefined;
    try {
      assertActive(row);
      answer = await dependencies.start({ binding: structuredClone(row.binding), request, operationKey: row.operationKey, reportCall: identity => reportCall(row, identity), assertActive: () => assertActive(row) });
      // Even a malformed SDP can carry a real call ID that must be journaled and closed.
      if (answer && validId(answer.callId)) await reportCall(row, { callId: answer.callId, ...(validId(answer.conversationId) ? { conversationId: answer.conversationId } : {}) });
      if (!answer || typeof answer.sdp !== 'string' || !answer.sdp.startsWith('v=0') || answer.sdp.length > 100_000 || !validId(answer.conversationId) || !Array.isArray(answer.toolsEnabled) || answer.toolsEnabled.length > 64 || answer.toolsEnabled.some(tool => typeof tool !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tool))) failure(502, 'invalid_voice_response', 'Resposta de áudio inválida.');
      validateIdentity(answer);
      store.transaction(() => {
        const current = read(row);
        if (current.completionFence !== row.completionFence || current.status !== 'pending') return;
        patch(current, { status: 'succeeded', completedAt: new Date(now()).toISOString() });
      });
    } catch (error) {
      store.transaction(() => {
        const current = read(row);
        if (current.completionFence !== row.completionFence || current.status !== 'pending') return;
        patch(current, {
          status: error instanceof VoiceStartRejected && !current.callId ? 'failed' : 'unknown',
          errorCode: error instanceof VoiceStartRejected ? safeCode(error.code) : error instanceof VoiceOperationError ? safeCode(error.code) : 'voice_start_outcome_unknown',
          completedAt: new Date(now()).toISOString(),
        });
      });
      const current = read(row);
      if (current.callId) await stopOnce(store.transaction(() => cancelRow(current, inactivity(current) ?? 'start_failed')));
    }
    let current = read(row);
    const reason = inactivity(current);
    if (reason) { current = store.transaction(() => cancelRow(current, reason)); await stopOnce(current); }
    current = read(row);
    // Authorization is checked AFTER cleanup, so revocation cannot leak SDP or prevent a stop.
    requireAuthorized(current.binding);
    const projected = view(current);
    if (answer && current.status === 'succeeded' && !projected.cancelRequested && current.completionFence === row.completionFence && projected.hangupStatus === 'not_requested') {
      return { ...projected, sdp: answer.sdp, toolsEnabled: [...answer.toolsEnabled], requiresRecovery: false };
    }
    return { ...projected, requiresRecovery: true };
  }
  return {
    async start(input: VoiceStartInput<Request>): Promise<VoiceStartResponse> {
      if (closing) return failure(503, 'voice_service_closing', 'O serviço de voz está encerrando.');
      validateKey(input.key); validateActor(input.binding?.actor);
      if (!validId(input.binding.agentId) || typeof input.binding.configurationHash !== 'string' || !hashPattern.test(input.binding.configurationHash)) return failure(400, 'invalid_voice_binding', 'Vínculo de voz inválido.');
      const binding = structuredClone(input.binding), requestHash = fingerprint(input.request);
      requireAuthorized(binding);
      let created = false;
      const row = store.transaction(() => {
        const old = store.list(binding.actor.tenantId, voiceStartOperationsCollection).find(item => item.operationKey === input.key && (item.binding as VoiceOperationBinding).actor.userId === binding.actor.userId) as Row | undefined;
        if (old) {
          if (!sameActor(old.binding.actor, binding.actor) || old.binding.agentId !== binding.agentId || old.binding.configurationHash !== binding.configurationHash || old.requestHash !== requestHash) return failure(409, 'voice_idempotency_conflict', 'Esta chave já foi usada para outra conexão de voz.');
          requireAuthorized(old.binding); return old;
        }
        created = true;
        return store.create(binding.actor.tenantId, voiceStartOperationsCollection, { operationKey: input.key, binding, requestHash, executionId, startAttemptId: randomUUID(), completionFence: randomUUID(), status: 'pending', cancelRequested: false, leaseExpiresAt: now() + leaseMs, hangupStatus: 'not_requested' }) as Row;
      });
      if (!created) return { ...view(row), requiresRecovery: true };
      const task = performStart(row, input.request);
      activeStarts.add(task);
      try { return await task; } finally { activeStarts.delete(task); }
    },
    list(input: VoiceOperationListInput): VoiceOperationPage {
      validateActor(input.actor);
      const limit = input.limit ?? 20;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (input.agentId !== undefined && !validId(input.agentId)) || (input.conversationId !== undefined && !validId(input.conversationId))) failure(400, 'invalid_voice_filter', 'Filtros de operações de voz inválidos.');
      const scope = fingerprint({ actor: input.actor, agentId: input.agentId ?? null, conversationId: input.conversationId ?? null, limit });
      let snapshot = Number.MAX_SAFE_INTEGER, before = Number.MAX_SAFE_INTEGER;
      if (input.cursor !== undefined) {
        try {
          if (!/^[A-Za-z0-9_-]{40,512}$/.test(input.cursor)) throw new Error('invalid');
          const encoded = Buffer.from(input.cursor, 'base64url');
          if (encoded.toString('base64url') !== input.cursor) throw new Error('invalid');
          const decipher = createDecipheriv('aes-256-gcm', cursorSecret, encoded.subarray(0, 12));
          decipher.setAAD(Buffer.from('kloel-voice-operation-page-v1')); decipher.setAuthTag(encoded.subarray(12, 28));
          const parsed = JSON.parse(Buffer.concat([decipher.update(encoded.subarray(28)), decipher.final()]).toString('utf8'));
          if (parsed.scope !== scope || !Number.isSafeInteger(parsed.snapshot) || !Number.isSafeInteger(parsed.before) || parsed.snapshot < 1 || parsed.before < 1 || parsed.before > parsed.snapshot) throw new Error('invalid');
          snapshot = parsed.snapshot; before = parsed.before;
        } catch { failure(400, 'invalid_voice_cursor', 'Esta página expirou ou não corresponde à consulta. Atualize a lista.'); }
      }
      // Bound the candidate scan even when many old configurations have been revoked.
      // SQL filters authority before materializing JSON; never load another actor's journal.
      const conditions = [
        'tenant_id=?', 'collection=?', 'rowid<=?', 'rowid<?',
        "json_extract(body,'$.binding.actor.tenantId')=?", "json_extract(body,'$.binding.actor.userId')=?",
        "json_extract(body,'$.binding.actor.sessionHash')=?", "json_extract(body,'$.binding.actor.role')=?",
      ];
      const args: (string | number)[] = [input.actor.tenantId, voiceStartOperationsCollection, snapshot, before, input.actor.tenantId, input.actor.userId, input.actor.sessionHash, input.actor.role];
      if (input.agentId) { conditions.push("json_extract(body,'$.binding.agentId')=?"); args.push(input.agentId); }
      if (input.conversationId) { conditions.push("json_extract(body,'$.conversationId')=?"); args.push(input.conversationId); }
      const candidates = store.db.prepare('SELECT rowid AS position,body FROM entities WHERE ' + conditions.join(' AND ') + ' ORDER BY rowid DESC LIMIT 201').all(...args);
      if (!input.cursor && candidates.length) snapshot = Number(candidates[0].position);
      const items: VoiceOperationView[] = [];
      let scanned = 0;
      for (const candidate of candidates.slice(0, 200)) {
        scanned++; before = Number(candidate.position);
        const row = JSON.parse(String(candidate.body)) as Row;
        if (row.tenantId === input.actor.tenantId && sameActor(row.binding.actor, input.actor) && authorized(row.binding)) items.push(view(row));
        if (items.length === limit) break;
      }
      let nextCursor: string | null = null;
      if (scanned < candidates.length) {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', cursorSecret, iv);
        cipher.setAAD(Buffer.from('kloel-voice-operation-page-v1'));
        const encrypted = Buffer.concat([cipher.update(JSON.stringify({ scope, snapshot, before }), 'utf8'), cipher.final()]);
        nextCursor = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
      }
      return { items, nextCursor, limit };
    },
    status(access: VoiceOperationAccess): VoiceOperationView { return view(getOwned(access)); },
    async cancel(access: VoiceOperationAccess): Promise<VoiceOperationView> {
      const row = store.transaction(() => cancelRow(getOwned(access), 'user_cancelled'));
      await stopOnce(row);
      requireAuthorized(read(row).binding);
      return view(read(row));
    },
    async heartbeat(access: VoiceOperationAccess): Promise<VoiceOperationView> {
      let row = store.transaction(() => {
        const current = getOwned(access);
        if (current.leaseExpiresAt <= now()) return cancelRow(current, 'lease_expired', true);
        if (current.cancelRequested || !['pending', 'succeeded'].includes(current.status)) return current;
        return patch(current, { leaseExpiresAt: now() + leaseMs });
      });
      await stopOnce(row); row = read(row); requireAuthorized(row.binding); return view(row);
    },
    /** Call every <=15s. Checks revocation even if a browser continues heartbeating. */
    async sweepExpired(): Promise<{ inspected: number; cancellationRequested: number }> {
      let inspected = 0, cancellationRequested = 0;
      for (const original of all()) {
        if (original.hangupStatus === 'accepted' || original.hangupStatus === 'rejected' || (original.status === 'failed' && !original.callId)) continue;
        inspected++;
        let row = read(original);
        const reason = inactivity(row);
        if (reason) { row = store.transaction(() => cancelRow(row, reason, reason === 'lease_expired')); cancellationRequested++; }
        await stopOnce(row);
      }
      return { inspected, cancellationRequested };
    },
    /** Explicit startup recovery ONLY after the previous owner stopped. Never run as a concurrent worker takeover. */
    async recoverPreviousExecutions(): Promise<{ recovered: number }> {
      let recovered = 0;
      for (const original of all()) {
        if (original.executionId === executionId || original.hangupStatus === 'accepted' || original.hangupStatus === 'rejected' || (original.status === 'failed' && !original.callId)) continue;
        const row = store.transaction(() => {
          const current = read(original);
          return patch(current, { executionId, completionFence: randomUUID(), status: ['pending', 'succeeded'].includes(current.status) ? 'unknown' : current.status, errorCode: current.errorCode ?? 'voice_execution_interrupted', cancelRequested: true, stopReason: current.stopReason ?? 'server_restarted', leaseExpiresAt: now(), hangupStatus: current.hangupStatus === 'pending' ? 'unknown' : current.hangupStatus });
        });
        recovered++; await stopOnce(row);
      }
      return { recovered };
    },
    /** Stops accepting work and marks starts cancelled BEFORE draining callbacks. Call before closing Store. */
    async close(): Promise<void> {
      closing = true;
      const cancelled = store.transaction(() => all().filter(original => original.executionId === executionId && original.hangupStatus === 'not_requested' && !(original.status === 'failed' && !original.callId)).map(original => cancelRow(original, 'server_shutdown')));
      await Promise.allSettled(cancelled.map(stopOnce));
      await Promise.allSettled([...activeStarts]);
      await Promise.allSettled([...stopping.values()]);
      await Promise.allSettled([...providerStops]);
    },
  };
}
