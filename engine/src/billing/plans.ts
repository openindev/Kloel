import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../store.js';
import { planItems } from './addons.js';
import { activeGrant } from './grants.js';

type Data = Record<string, any>;
export class PlanError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message = 'Consulte o estado atual do plano antes de continuar.') { super(message); }
}
export const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const revision = z.number().int().safe().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const operationKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const mode = z.enum(['test', 'live']);
export const policyInput = z.object({ operationKey, expectedRevision: revision, priceId: z.string().max(100).regex(/^price_[A-Za-z0-9]+$/), stripeMode: mode, planId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/), enabled: z.boolean(), assistantChatRoundsPerDay: z.number().int().safe().min(0).max(1000000) }).strict();
export const enforcementInput = z.object({ operationKey, expectedRevision: revision, tenantId: z.string().min(1).max(128), stripeMode: mode, enabled: z.boolean() }).strict();
type Table = 'billing_plan_policies' | 'billing_plan_enforcement' | 'billing_plan_entitlements';
function read(store: Store, table: Table, scope: string): Data | undefined {
  const row = store.db.prepare(`SELECT body FROM ${table} WHERE scope=?`).get(scope);
  return row ? JSON.parse(String(row.body)) : undefined;
}
function write(store: Store, table: Table, scope: string, value: Data) {
  store.db.prepare(`INSERT INTO ${table}(scope,body) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET body=excluded.body`).run(scope, JSON.stringify(value));
}
function nextRevision(current?: Data) {
  const n = current?.revision ?? 0;
  if (!Number.isSafeInteger(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER) throw new PlanError(409, 'plan_revision_exhausted');
  return n + 1;
}
/**
 * Sem linha própria, a org segue o padrão da plataforma: BILLING_ENFORCEMENT_DEFAULT=live|test liga o controle de plano
 * para todas as orgs (exceto PROVIDER_TENANT_ID e BILLING_ENFORCEMENT_EXEMPT). Uma linha explícita sempre vence.
 */
export const getEnforcement = (store: Store, tenant: string) => {
  const row = read(store, 'billing_plan_enforcement', tenant); if (row) return row;
  const mode = String(process.env.BILLING_ENFORCEMENT_DEFAULT || '').trim();
  const exempt = new Set([process.env.PROVIDER_TENANT_ID, ...String(process.env.BILLING_ENFORCEMENT_EXEMPT || '').split(',')].map(s => String(s ?? '').trim()).filter(Boolean));
  return (mode === 'live' || mode === 'test') && !exempt.has(tenant) ? { tenantId: tenant, stripeMode: mode, enabled: true, revision: 0, source: 'platform_default' } : undefined;
};
export const getEntitlement = (store: Store, tenant: string) => read(store, 'billing_plan_entitlements', tenant);
/** Sem política gravada, todo preço do catálogo (STRIPE_PRICE_IDS) vale como plano ativo com a cota padrão. */
export const getPlanPolicy = (store: Store, stripeMode: string, priceId: string) => {
  const row = read(store, 'billing_plan_policies', `${stripeMode}:${priceId}`); if (row) return row;
  const catalog = String(process.env.STRIPE_PRICE_IDS || '').split(',').map(s => s.trim());
  if (!String(process.env.BILLING_ENFORCEMENT_DEFAULT || '').trim() || !catalog.includes(priceId)) return undefined;
  const rounds = Math.trunc(Number(process.env.BILLING_DEFAULT_CHAT_ROUNDS_PER_DAY || 2000));
  return { priceId, stripeMode, planId: priceId, enabled: true, assistantChatRoundsPerDay: Number.isSafeInteger(rounds) && rounds >= 0 && rounds <= 1000000 ? rounds : 2000, revision: 0, source: 'platform_default' };
};
function provision(store: Store, kind: 'policy' | 'enforcement', input: Data) {
  const keyHash = digest(input.operationKey), fingerprint = digest([kind, input]);
  return store.transaction(() => {
    const existing = store.db.prepare('SELECT fingerprint,body FROM billing_plan_operations WHERE key_hash=?').get(keyHash);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new PlanError(409, 'plan_operation_conflict');
      return { ...JSON.parse(String(existing.body)), replayed: true };
    }
    const scope = kind === 'policy' ? `${input.stripeMode}:${input.priceId}` : input.tenantId;
    const table = kind === 'policy' ? 'billing_plan_policies' : 'billing_plan_enforcement';
    const current = read(store, table, scope);
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new PlanError(409, 'plan_revision_conflict');
    const { operationKey: _, expectedRevision: __, ...configuration } = input;
    const resultRevision = nextRevision(current);
    write(store, table, scope, { ...configuration, revision: resultRevision });
    const receipt = { status: 'applied', kind, operationRef: randomUUID(), resultRevision };
    store.db.prepare('INSERT INTO billing_plan_operations(key_hash,fingerprint,body) VALUES(?,?,?)').run(keyHash, fingerprint, JSON.stringify(receipt));
    return { ...receipt, replayed: false };
  });
}
export const provisionPlanPolicy = (store: Store, value: unknown) => provision(store, 'policy', policyInput.parse(value));
export const setTenantEnforcement = (store: Store, value: unknown) => provision(store, 'enforcement', enforcementInput.parse(value));

/** Called inside the existing verified webhook transaction, after event.id deduplication. */
export function invalidatePlanEvent(store: Store, tenant: string, event: Data): boolean {
  const data = event.data?.object;
  if (!data || typeof data !== 'object') return false;
  const account = store.list(tenant, 'billing-accounts')[0];
  const known = store.list(tenant, 'subscriptions').some(s => s.providerSubscriptionId === data.id);
  const subscriptionEvent = ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type);
  const checkoutEvent = event.type === 'checkout.session.completed' && store.list(tenant, 'billing-checkouts').some(c => c.sessionId === data.id);
  if (!(subscriptionEvent && (known || typeof account?.customerId === 'string' && data.customer === account.customerId) || checkoutEvent)) return false;
  const current = getEntitlement(store, tenant);
  write(store, 'billing_plan_entitlements', tenant, { revision: nextRevision(current), state: 'reconcile_required', reason: 'reconciliation_required', snapshot: null });
  return true;
}

const seconds = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v < 8640000000000 ? v : null;
/** No missing field inherits entitlement from an earlier snapshot. */
export function normalizeEntitlement(session: Data, subscription: Data, price: Data | undefined, stripeMode: unknown, now = Date.now()): Data {
  const unavailable = (reason: string) => ({ state: 'unavailable', reason, snapshot: null });
  const incomplete = () => ({ state: 'reconcile_required', reason: 'reconciliation_required', snapshot: null });
  if (!['test', 'live'].includes(String(stripeMode))) return incomplete();
  const live = stripeMode === 'live';
  if ([session.livemode, subscription.livemode, price?.livemode].some(v => typeof v !== 'boolean')) return incomplete();
  if ([session.livemode, subscription.livemode, price?.livemode].some(v => v !== live)) return unavailable('stripe_mode_mismatch');
  const items = subscription.items, plans = planItems(items?.data);
  if (items?.has_more !== false || !Array.isArray(items?.data) || plans.length !== 1) return unavailable('subscription_ambiguous');
  const item = plans[0];
  if (!price || price.id !== item?.price?.id || price.type !== 'recurring' || price.recurring?.usage_type !== 'licensed' || item.quantity !== 1) return unavailable('binding_invalid');
  if (session.mode !== 'subscription' || session.subscription !== subscription.id || session.customer !== subscription.customer) return unavailable('binding_invalid');
  if (!Object.hasOwn(subscription, 'pause_collection') || !Object.hasOwn(subscription, 'cancel_at')) return incomplete();
  if (!['active', 'trialing'].includes(subscription.status) || subscription.pause_collection != null) return unavailable('subscription_ineligible');
  // V1 uses the modern item period only. Legacy absent/contradictory periods require reconciliation.
  const start = seconds(item.current_period_start), end = seconds(item.current_period_end);
  if (start === null || end === null || start >= end || subscription.current_period_end != null && subscription.current_period_end !== end) return incomplete();
  const trialEnd = subscription.status === 'trialing' ? seconds(subscription.trial_end) : end;
  const cancelAt = subscription.cancel_at == null ? end : seconds(subscription.cancel_at);
  if (trialEnd === null || cancelAt === null) return incomplete();
  const validUntil = Math.min(end, trialEnd, cancelAt) * 1000;
  if (start * 1000 > now || validUntil <= now) return unavailable('snapshot_expired');
  return { state: 'eligible', reason: null, snapshot: { subscriptionId: subscription.id, customerId: subscription.customer, priceId: price.id, stripeMode, status: subscription.status, validUntil, periodStart: start * 1000, periodEnd: end * 1000 } };
}
/** A positive contradictory Stripe object cannot leave the previous grant eligible. Caller owns BEGIN. */
export function invalidateReconciliation(store: Store, tenant: string) {
  const current = getEntitlement(store, tenant);
  write(store, 'billing_plan_entitlements', tenant, { revision: nextRevision(current), state: 'reconcile_required', reason: 'reconciliation_required', snapshot: null });
}
/** Snapshot revisions before Stripe GETs; configuration ABA invalidates the returned evidence. */
export function reconciliationFence(store: Store, tenant: string) {
  return digest([getEnforcement(store, tenant) ?? null, getEntitlement(store, tenant) ?? null,
    store.db.prepare('SELECT scope,body FROM billing_plan_policies ORDER BY scope').all()]);
}
/** Caller owns BEGIN and has just checked the fence, account and subscription bindings. */
export function commitEntitlement(store: Store, tenant: string, session: Data, subscription: Data, price?: Data) {
  const current = getEntitlement(store, tenant), enforcement = getEnforcement(store, tenant);
  const normalized = normalizeEntitlement(session, subscription, price, enforcement?.stripeMode);
  const others = store.list(tenant, 'subscriptions').filter(s => s.customerId === session.customer && s.providerSubscriptionId !== subscription.id && !['canceled', 'incomplete_expired'].includes(String(s.status)));
  write(store, 'billing_plan_entitlements', tenant, { revision: nextRevision(current), ...(others.length ? { state: 'unavailable', reason: 'subscription_ambiguous', snapshot: null } : normalized) });
}

export function utcPeriod(now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10), start = `${day}T00:00:00.000Z`;
  return { day, start, end: new Date(Date.parse(start) + 86400000).toISOString(), timezone: 'UTC' as const };
}
export function quotaCounts(store: Store, tenant: string, day: string) {
  const rows = store.db.prepare('SELECT state,COUNT(*) AS n FROM billing_chat_rounds WHERE tenant_id=? AND day=? GROUP BY state').all(tenant, day);
  return { used: rows.filter(r => ['dispatched', 'observed', 'unknown'].includes(String(r.state))).reduce((n, r) => n + Number(r.n), 0), reserved: Number(rows.find(r => r.state === 'reserved')?.n ?? 0) };
}
export function planSnapshot(store: Store, tenant: string, now = Date.now()) {
  const enforcement = getEnforcement(store, tenant), entitlement = getEntitlement(store, tenant), snapshot = entitlement?.snapshot;
  const policy = snapshot ? getPlanPolicy(store, String(enforcement?.stripeMode), snapshot.priceId) : undefined;
  const account = store.list(tenant, 'billing-accounts')[0];
  let state = 'not_enforced', reason: string | null = 'enforcement_disabled', limit: number | null = null;
  if (enforcement?.enabled === true) {
    state = entitlement?.state ?? 'reconcile_required'; reason = entitlement?.reason ?? 'subscription_missing';
    if (state === 'eligible') {
      if (!snapshot || snapshot.customerId !== account?.customerId) { state = 'unavailable'; reason = 'binding_invalid'; }
      else if (snapshot.stripeMode !== enforcement.stripeMode) { state = 'unavailable'; reason = 'stripe_mode_mismatch'; }
      else if (!Number.isSafeInteger(snapshot.validUntil) || snapshot.validUntil <= now || snapshot.periodStart > now) { state = 'reconcile_required'; reason = 'snapshot_expired'; }
      else if (!policy) { state = 'unavailable'; reason = 'policy_missing'; }
      else if (!Number.isSafeInteger(policy.assistantChatRoundsPerDay) || policy.assistantChatRoundsPerDay < 0 || policy.assistantChatRoundsPerDay > 1000000) { state = 'unavailable'; reason = 'policy_invalid'; }
      else if (policy.enabled !== true) { state = 'unavailable'; reason = 'policy_disabled'; }
      else { limit = policy.assistantChatRoundsPerDay; reason = null; }
    }
  }
  // Concessão interna com validade (plan-grants): libera o plano sem Stripe até expiresAt.
  const grant = state === 'eligible' || enforcement?.enabled !== true ? undefined : activeGrant(store, tenant, now);
  if (grant) {
    const rounds = Math.trunc(Number(grant.assistantChatRoundsPerDay ?? process.env.BILLING_DEFAULT_CHAT_ROUNDS_PER_DAY ?? 2000));
    state = 'eligible'; reason = null; limit = Number.isSafeInteger(rounds) && rounds >= 0 && rounds <= 1000000 ? rounds : 2000;
  }
  const period = utcPeriod(now), counts = quotaCounts(store, tenant, period.day);
  const version = digest([enforcement ?? null, entitlement ?? null, policy ?? null, account?.id ?? null, account?.customerId ?? null]);
  return { enforced: enforcement?.enabled === true, planId: grant ? String(grant.planId ?? 'grant') : policy?.planId ?? null, version: grant ? digest([version, grant.id, grant.expiresAt]) : version, policyRevision: grant ? policy?.revision ?? 0 : policy?.revision ?? null, entitlementRevision: grant ? entitlement?.revision ?? 0 : entitlement?.revision ?? null, state, reason, stripeMode: enforcement?.stripeMode ?? null,
    validUntil: grant ? new Date(String(grant.expiresAt)).toISOString() : snapshot?.validUntil ? new Date(snapshot.validUntil).toISOString() : null, measurementStartedAt: String(store.db.prepare('SELECT started_at FROM billing_quota_meta WHERE id=1').get()!.started_at), coverage: ['private_chat', 'webchat'],
    period: { start: period.start, end: period.end, timezone: period.timezone }, meters: [{ key: 'assistant_chat_rounds_per_day', limit, ...counts, remaining: limit === null ? null : Math.max(0, limit - counts.used - counts.reserved), unit: 'provider_request' }], measuredSpend: null };
}
export function assertPlanEligible(value: ReturnType<typeof planSnapshot>) {
  if (value.enforced && value.state !== 'eligible') throw new PlanError(403, 'plan_not_eligible', 'O plano precisa ser consultado antes de continuar.');
}
