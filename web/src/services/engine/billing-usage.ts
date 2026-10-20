import { EngineError } from './http'
import type { EngineContext } from './session'

export type BillingPeriod = { start: string; end: string; timezone: 'UTC' }
export type EntitlementState = 'eligible' | 'unavailable' | 'reconcile_required' | 'not_enforced'
const reasons = ['enforcement_disabled', 'policy_missing', 'policy_invalid', 'policy_disabled', 'subscription_missing', 'subscription_ambiguous', 'subscription_ineligible', 'snapshot_expired', 'stripe_mode_mismatch', 'binding_invalid', 'reconciliation_required'] as const
export type EntitlementReason = typeof reasons[number]
export type BillingEntitlements = {
  enforced: boolean; planId: string | null; version: string; policyRevision: number | null; entitlementRevision: number | null
  state: EntitlementState; reason: EntitlementReason | null; stripeMode: 'test' | 'live' | null; validUntil: string | null; measurementStartedAt: string
  coverage: ['private_chat', 'webchat']; period: BillingPeriod
  meters: [{ key: 'assistant_chat_rounds_per_day'; limit: number | null; used: number; reserved: number; remaining: number | null; unit: 'provider_request' }]
  measuredSpend: null
}
export type UsageState = 'reserved' | 'dispatched' | 'observed' | 'unknown' | 'not_dispatched'
export type BillingUsageRow = {
  id: string; sourceKind: 'private_chat' | 'webchat'; operationId: string; roundIndex: number; day: string; state: UsageState; model: string
  httpStatus: number | null; responseId: string | null; usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null; createdAt: string; updatedAt: string
}
export type BillingUsagePage = { items: BillingUsageRow[]; nextCursor: string | null; period: BillingPeriod; coverage: ['private_chat', 'webchat']; measuredSpend: null }
export type BillingUsageQuery = { day?: string; cursor?: string; limit?: number }
function invalid(): never { throw new EngineError(0, 'invalid_billing_usage_response', 'Os dados de consumo recebidos são inválidos. Consulte novamente os registros.') }
function object(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) invalid()
  return value as Record<string, any>
}
function text(v: unknown, max: number): string { if (typeof v !== 'string' || !v.length || v.length > max) invalid(); return v }
function integer(v: unknown, max = Number.MAX_SAFE_INTEGER): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) invalid(); return v }
function iso(v: unknown): string { const s = text(v, 30); if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) invalid(); return s }
function oneOf<T extends string>(v: unknown, values: readonly T[]): T { if (!values.includes(v as T)) invalid(); return v as T }
function uuid(v: unknown): string { const s = text(v, 36); if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s)) invalid(); return s }
export function billingUsageDay(v: unknown): string {
  const s = text(v, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + 'T00:00:00.000Z')) || new Date(s + 'T00:00:00.000Z').toISOString().slice(0, 10) !== s) invalid()
  return s
}
function period(v: unknown): BillingPeriod {
  const p = object(v, ['start', 'end', 'timezone']), start = iso(p.start), end = iso(p.end)
  if (p.timezone !== 'UTC' || !start.endsWith('T00:00:00.000Z') || Date.parse(end) - Date.parse(start) !== 86400000) invalid()
  return { start, end, timezone: 'UTC' }
}
function coverage(v: unknown): ['private_chat', 'webchat'] { if (!Array.isArray(v) || v.length !== 2 || v[0] !== 'private_chat' || v[1] !== 'webchat') invalid(); return ['private_chat', 'webchat'] }
export function parseBillingEntitlements(value: unknown): BillingEntitlements {
  const v = object(value, ['enforced', 'planId', 'version', 'policyRevision', 'entitlementRevision', 'state', 'reason', 'stripeMode', 'validUntil', 'measurementStartedAt', 'coverage', 'period', 'meters', 'measuredSpend'])
  if (typeof v.enforced !== 'boolean' || !/^[a-f0-9]{64}$/.test(text(v.version, 64)) || v.measuredSpend !== null || !Array.isArray(v.meters) || v.meters.length !== 1) invalid()
  const m = object(v.meters[0], ['key', 'limit', 'used', 'reserved', 'remaining', 'unit'])
  if (m.key !== 'assistant_chat_rounds_per_day' || m.unit !== 'provider_request') invalid()
  const limit = m.limit === null ? null : integer(m.limit, 1000000), used = integer(m.used), reserved = integer(m.reserved), remaining = m.remaining === null ? null : integer(m.remaining)
  if (!Number.isSafeInteger(used + reserved) || remaining !== (limit === null ? null : Math.max(0, limit - used - reserved))) invalid()
  const state = oneOf(v.state, ['eligible', 'unavailable', 'reconcile_required', 'not_enforced'] as const), reason = v.reason === null ? null : oneOf(v.reason, reasons)
  const planId = v.planId === null ? null : text(v.planId, 80), policyRevision = v.policyRevision === null ? null : integer(v.policyRevision), entitlementRevision = v.entitlementRevision === null ? null : integer(v.entitlementRevision)
  const stripeMode = v.stripeMode === null ? null : oneOf(v.stripeMode, ['test', 'live'] as const), validUntil = v.validUntil === null ? null : iso(v.validUntil)
  if (planId !== null && !/^[A-Za-z0-9_-]+$/.test(planId)) invalid()
  if (!v.enforced && (state !== 'not_enforced' || reason !== 'enforcement_disabled') || v.enforced && state === 'not_enforced') invalid()
  if (state === 'eligible' ? reason !== null || limit === null || planId === null || stripeMode === null || policyRevision === null || entitlementRevision === null || validUntil === null : reason === null || limit !== null) invalid()
  return { enforced: v.enforced, planId, version: v.version, policyRevision, entitlementRevision, state, reason, stripeMode, validUntil, measurementStartedAt: iso(v.measurementStartedAt), coverage: coverage(v.coverage), period: period(v.period), meters: [{ key: m.key, limit, used, reserved, remaining, unit: m.unit }], measuredSpend: null }
}
export function parseBillingUsagePage(value: unknown, query: BillingUsageQuery = {}): BillingUsagePage {
  const v = object(value, ['items', 'nextCursor', 'period', 'coverage', 'measuredSpend']), p = period(v.period), day = p.start.slice(0, 10)
  if (v.measuredSpend !== null || query.day !== undefined && day !== query.day || !Array.isArray(v.items) || v.items.length > (query.limit ?? 50)) invalid()
  const nextCursor = v.nextCursor === null ? null : text(v.nextCursor, 1024)
  if (nextCursor !== null && !/^[A-Za-z0-9_-]+$/.test(nextCursor)) invalid()
  const items = v.items.map((value: unknown): BillingUsageRow => {
    const r = object(value, ['id', 'sourceKind', 'operationId', 'roundIndex', 'day', 'state', 'model', 'httpStatus', 'responseId', 'usage', 'createdAt', 'updatedAt'])
    if (billingUsageDay(r.day) !== day) invalid()
    const httpStatus = r.httpStatus === null ? null : integer(r.httpStatus, 599), responseId = r.responseId === null ? null : text(r.responseId, 200)
    if (httpStatus !== null && httpStatus < 100 || responseId !== null && !/^[A-Za-z0-9_-]+$/.test(responseId)) invalid()
    let usage: BillingUsageRow['usage'] = null
    if (r.usage !== null) { const u = object(r.usage, ['inputTokens', 'outputTokens', 'totalTokens']); usage = { inputTokens: integer(u.inputTokens), outputTokens: integer(u.outputTokens), totalTokens: integer(u.totalTokens) } }
    return { id: uuid(r.id), sourceKind: oneOf(r.sourceKind, ['private_chat', 'webchat'] as const), operationId: uuid(r.operationId), roundIndex: integer(r.roundIndex, 10), day, state: oneOf(r.state, ['reserved', 'dispatched', 'observed', 'unknown', 'not_dispatched'] as const), model: text(r.model, 120), httpStatus, responseId, usage, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) }
  })
  if (new Set(items.map(r => r.id)).size !== items.length) invalid()
  return { items, nextCursor, period: p, coverage: coverage(v.coverage), measuredSpend: null }
}
export function createBillingUsageService(context: EngineContext) {
  async function read<T>(path: string, parse: (raw: unknown) => T, query?: Record<string, string>, signal?: AbortSignal) {
    context.assertCurrent(); if (signal?.aborted) throw new EngineError(0, 'superseded', 'Consulta cancelada.')
    const raw = await context.request(path, { query, signal, timeoutMs: 15000 })
    context.assertCurrent(); if (signal?.aborted) throw new EngineError(0, 'superseded', 'Consulta cancelada.')
    return parse(raw)
  }
  return {
    entitlements: (signal?: AbortSignal) => read('/billing/entitlements', parseBillingEntitlements, undefined, signal),
    usage(input: BillingUsageQuery = {}, signal?: AbortSignal) {
      if (Object.keys(input).some(k => !['day', 'cursor', 'limit'].includes(k))) invalid()
      const query: Record<string, string> = {}, captured: BillingUsageQuery = {}
      if (input.day !== undefined) query.day = captured.day = billingUsageDay(input.day)
      if (input.cursor !== undefined) { const c = text(input.cursor, 1024); if (!/^[A-Za-z0-9_-]+$/.test(c)) invalid(); query.cursor = captured.cursor = c }
      if (input.limit !== undefined) { if (integer(input.limit, 100) < 1) invalid(); captured.limit = input.limit; query.limit = String(input.limit) }
      return read('/billing/usage', raw => parseBillingUsagePage(raw, captured), query, signal)
    },
  }
}
