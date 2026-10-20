import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../store.js';
import { PlanError, assertPlanEligible, digest, planSnapshot, utcPeriod } from './plans.js';

type Data = Record<string, any>;
export type RoundObserver = { http(status: number): void; parsed(value: unknown): void };
type State = 'reserved' | 'dispatched' | 'observed' | 'unknown' | 'not_dispatched';
const sourceSchema = z.enum(['private_chat', 'webchat']);
const inputSchema = z.object({ tenantId: z.string().min(1).max(128), sourceKind: sourceSchema, operationId: z.string().uuid(), authorityHash: z.string().regex(/^[a-f0-9]{64}$/), model: z.string().min(1).max(120) }).strict();
const readSlot = (store: Store, id: string): Data | undefined => {
  const row = store.db.prepare('SELECT body FROM billing_chat_rounds WHERE id=?').get(id);
  return row ? JSON.parse(String(row.body)) : undefined;
};
function updateSlot(store: Store, row: Data, state: State, extra: Data = {}) {
  const value = { ...row, ...extra, state, updatedAt: new Date().toISOString() };
  store.db.prepare('UPDATE billing_chat_rounds SET state=?,body=? WHERE id=?').run(state, JSON.stringify(value), row.id);
}
function normalizedUsage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Data, keys = ['input_tokens', 'output_tokens', 'total_tokens'];
  if (!keys.every(k => Number.isSafeInteger(v[k]) && v[k] >= 0)) return null;
  return { inputTokens: v.input_tokens, outputTokens: v.output_tokens, totalTokens: v.total_tokens };
}

/** Internal trusted seam. Caller supplies the real ingress guard, never user-provided authority. */
export function chatRoundMeter(store: Store, raw: z.input<typeof inputSchema>, assertAccess: () => void, onDispatched: () => void = () => {}) {
  const input = inputSchema.parse(raw), initial = planSnapshot(store, input.tenantId);
  const assertCurrent = () => {
    const current = planSnapshot(store, input.tenantId);
    if (current.version !== initial.version) throw new PlanError(409, 'plan_context_changed');
    assertPlanEligible(current);
  };
  async function run<T>(roundIndex: number, effect: (observer: RoundObserver) => Promise<T>): Promise<T> {
    if (!Number.isSafeInteger(roundIndex) || roundIndex < 0 || roundIndex > 10) throw new PlanError(400, 'invalid_round');
    let slot: Data | undefined;
    slot = store.transaction(() => {
      const existing = store.db.prepare('SELECT id FROM billing_chat_rounds WHERE tenant_id=? AND source_kind=? AND operation_id=? AND round_index=?').get(input.tenantId, input.sourceKind, input.operationId, roundIndex);
      if (existing) throw new PlanError(409, 'plan_round_requires_reconciliation', 'Esta tentativa já foi reservada; consulte a operação original.');
      assertAccess(); assertCurrent();
      const current = planSnapshot(store, input.tenantId), meter = current.meters[0];
      if (current.enforced && meter.remaining === 0) throw new PlanError(429, 'plan_quota_exhausted', 'O limite diário de respostas foi atingido.');
      const now = new Date().toISOString(), row = { id: randomUUID(), ...input, roundIndex, day: utcPeriod().day, state: 'reserved', claimToken: randomUUID(), planVersion: initial.version, policyRevision: initial.policyRevision, entitlementRevision: initial.entitlementRevision,
        httpStatus: null, responseId: null, usage: null, createdAt: now, updatedAt: now };
      store.db.prepare('INSERT INTO billing_chat_rounds(id,tenant_id,source_kind,operation_id,round_index,day,state,body) VALUES(?,?,?,?,?,?,?,?)').run(row.id, input.tenantId, input.sourceKind, input.operationId, roundIndex, row.day, row.state, JSON.stringify(row));
      return row;
    });
    const owned = () => {
      const current = readSlot(store, slot!.id);
      if (!current || current.claimToken !== slot!.claimToken) throw new PlanError(409, 'plan_context_changed');
      return current;
    };
    const observe = (extra: Data, state?: State) => store.transaction(() => {
      const current = owned();
      if (!['dispatched', 'observed', 'unknown'].includes(current.state)) throw new PlanError(409, 'plan_context_changed');
      // Observation survives revocation; never replace a newer durable observation with an error.
      updateSlot(store, current, current.state === 'observed' ? 'observed' : state ?? current.state, extra);
    });
    try {
      store.transaction(() => {
        const current = owned();
        if (current.state !== 'reserved') throw new PlanError(409, 'plan_round_requires_reconciliation');
        assertAccess(); assertCurrent();
        updateSlot(store, current, 'dispatched');
      });
      // Deliberately no await between durable dispatch admission and the physical invocation.
      onDispatched();
      const result = await effect({
        http(status) { if (!Number.isInteger(status) || status < 100 || status > 599) throw new PlanError(502, 'provider_invalid_response'); observe({ httpStatus: status }, status >= 200 && status < 500 ? 'observed' : 'unknown'); },
        parsed(value) {
          const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
          observe({ responseId: typeof data.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.id) ? data.id : null, usage: normalizedUsage(data.usage) });
        },
      });
      assertAccess(); assertCurrent();
      return result;
    } catch (error) {
      try {
        store.transaction(() => {
          const current = owned();
          if (current.state === 'reserved') updateSlot(store, current, 'not_dispatched');
          else if (current.state === 'dispatched') updateSlot(store, current, 'unknown');
        });
      } catch { /* An unavailable storage never authorizes replay or a refund. */ }
      throw error;
    }
  }
  return { run, assertCurrent };
}

const querySchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), cursor: z.string().max(1024).regex(/^[A-Za-z0-9_-]+$/).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export function usagePage(store: Store, tenant: string, query: unknown) {
  const q = querySchema.parse(query), day = q.day ?? utcPeriod().day;
  if (!Number.isFinite(Date.parse(`${day}T00:00:00.000Z`)) || new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day) throw new PlanError(400, 'invalid_input');
  let after = 0;
  if (q.cursor) {
    try {
      const c = z.object({ tenant: z.string(), day: z.string(), after: z.number().int().safe().positive() }).strict().parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString()));
      if (c.tenant !== digest(tenant) || c.day !== day) throw new Error('scope');
      after = c.after;
    } catch { throw new PlanError(400, 'invalid_cursor'); }
  }
  const rows = store.db.prepare('SELECT rowid AS seq,body FROM billing_chat_rounds WHERE tenant_id=? AND day=? AND rowid>? ORDER BY rowid LIMIT ?').all(tenant, day, after, q.limit + 1), selected = rows.slice(0, q.limit);
  const items = selected.map(row => {
    const r = JSON.parse(String(row.body));
    return { id: r.id, sourceKind: r.sourceKind, operationId: r.operationId, roundIndex: r.roundIndex, day: r.day, state: r.state, model: r.model, httpStatus: r.httpStatus, responseId: r.responseId, usage: r.usage, createdAt: r.createdAt, updatedAt: r.updatedAt };
  });
  return { items, nextCursor: rows.length > q.limit ? Buffer.from(JSON.stringify({ tenant: digest(tenant), day, after: Number(selected.at(-1)!.seq) })).toString('base64url') : null,
    period: { start: `${day}T00:00:00.000Z`, end: new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString(), timezone: 'UTC' }, coverage: ['private_chat', 'webchat'], measuredSpend: null };
}
