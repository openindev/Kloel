import { EngineError } from './http'
import type { EngineContext } from './session'

export type BillingMode = 'test' | 'live' | 'unavailable'
export type KloelBillingPlan = { product: 'voice' | 'whatsapp' | 'webchat' | 'email' | 'care'; tier: 'solo' | 'team' | 'standard' | 'essential' | 'pro' | 'premium'; interval: 'monthly' | 'annual' }
export type BillingPrice = { priceId: string; productName: string; currency: string; unitAmount: number | null; interval: string | null; intervalCount: number | null; active: boolean; livemode: boolean; checkoutUsable: boolean; reason?: string; synthetic: boolean; kloelPlan?: KloelBillingPlan | null }
export type BillingCatalog = { mode: BillingMode; configured: boolean; items: BillingPrice[]; source: 'stripe_api' }
export type BillingSubscription = { id: string; providerSubscriptionId: string; status: 'active' | 'trialing' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused'; priceId: string | null; startedAt?: number | null; cancelAtPeriodEnd: boolean; cancelAt: number | null; canceledAt: number | null; endedAt: number | null; currentPeriodEnd: number | null; scheduledCancellation: boolean }
export type BillingGrant = { id: string; planId: string; status: string; startsAt: string; expiresAt: string; products: { product: KloelBillingPlan['product']; tier: KloelBillingPlan['tier'] }[] }
export type BillingStatus = { account: { customerId: string; checkoutStatus: string | null } | null; subscriptions: BillingSubscription[]; grants?: BillingGrant[] }
export type HostedBillingSession = { sessionId: string; url: string; expiresAt?: number; paymentStatus?: string }
export type BillingCheckout = { id: string; sessionId: string | null; priceId: string; status: string; expiresAt: number | null; url: string | null; createdAt: string; updatedAt: string }
export type BillingOperationKind = 'stripe.checkout' | 'stripe.portal'
export type BillingOperation = { operation: BillingOperationKind; status: 'pending' | 'succeeded' | 'failed' | 'unknown'; errorCode: string | null; result?: HostedBillingSession; requiresReconciliation: boolean }
export type BillingReconciliation = { checkoutStatus: 'open' | 'complete' | 'expired'; source: 'stripe_api'; reconciledAt: string; reconciliationId?: string }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const epoch = (v: unknown): v is number | null => v === null || integer(v) && v > 0
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
function invalid(message = 'Os dados de cobrança recebidos são inválidos. Consulte o estado antes de continuar.'): never { throw new EngineError(0, 'invalid_billing_response', message) }
function id(v: unknown): string { if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(v)) invalid(); return v }
function priceId(v: unknown): string { if (typeof v !== 'string' || !/^price_[A-Za-z0-9]+$/.test(v)) invalid(); return v }
function checkoutId(v: unknown): string { if (typeof v !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(v)) invalid(); return v }
function operationKey(v: string): string { if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(v)) invalid(); return v }

/** Stripe's hosted checkout can carry a legitimate fragment. Only its exact HTTPS origin is allowed. */
export function billingDestination(raw: unknown, operation: BillingOperationKind): string {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\u0000-\u0020\u007f]/.test(raw)) invalid('Endereço de cobrança inválido.')
  try {
    const url = new URL(raw), host = operation === 'stripe.checkout' ? 'checkout.stripe.com' : 'billing.stripe.com'
    if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.pathname === '/') invalid('Destino de cobrança não reconhecido.')
    return url.href
  } catch { invalid('Destino de cobrança não reconhecido.') }
}
export function parseHostedBillingSession(raw: unknown, operation: BillingOperationKind): HostedBillingSession {
  if (!object(raw) || typeof raw.sessionId !== 'string' || !(operation === 'stripe.checkout' ? /^cs_[A-Za-z0-9_]+$/ : /^bps_[A-Za-z0-9_]+$/).test(raw.sessionId)) invalid()
  const result: HostedBillingSession = { sessionId: raw.sessionId, url: billingDestination(raw.url, operation) }
  if (operation === 'stripe.checkout') {
    if (!integer(raw.expiresAt) || raw.expiresAt <= 0 || !['paid', 'unpaid', 'no_payment_required'].includes(String(raw.paymentStatus))) invalid()
    result.expiresAt = raw.expiresAt; result.paymentStatus = String(raw.paymentStatus)
  }
  return result
}
export function parseBillingCatalog(raw: unknown): BillingCatalog {
  if (!object(raw) || !['test', 'live', 'unavailable'].includes(String(raw.mode)) || typeof raw.configured !== 'boolean' || !Array.isArray(raw.items) || raw.source !== 'stripe_api') invalid()
  const items = raw.items.map((value): BillingPrice => {
    if (!object(value) || typeof value.productName !== 'string' || value.productName.length > 1000 || typeof value.currency !== 'string' || !/^[a-z]{3}$/.test(value.currency) || value.unitAmount !== null && !integer(value.unitAmount) || value.interval !== null && !['day', 'week', 'month', 'year'].includes(String(value.interval)) || value.intervalCount !== null && (!integer(value.intervalCount) || value.intervalCount < 1) || typeof value.active !== 'boolean' || typeof value.livemode !== 'boolean' || typeof value.checkoutUsable !== 'boolean' || value.reason !== undefined && typeof value.reason !== 'string' || value.synthetic !== undefined && typeof value.synthetic !== 'boolean') invalid()
    if (raw.mode === 'live' && !value.livemode || raw.mode === 'test' && value.livemode || value.checkoutUsable && (!value.active || value.interval === null || value.intervalCount === null || value.unitAmount === null)) invalid()
    const plan = value.kloelPlan
    if (plan != null) {
      if (!object(plan) || typeof plan.product !== 'string' || typeof plan.tier !== 'string' || !['monthly', 'annual'].includes(String(plan.interval))) invalid()
      const tiers: Record<string, string[]> = { voice: ['solo', 'team'], whatsapp: ['solo', 'team'], webchat: ['solo', 'team'], email: ['standard'], care: ['essential', 'pro', 'premium'] }
      if (!Object.hasOwn(tiers, plan.product) || !tiers[plan.product].includes(plan.tier) || ['email', 'care'].includes(plan.product) && plan.interval !== 'monthly' || value.interval !== (plan.interval === 'annual' ? 'year' : 'month') || value.intervalCount !== 1) invalid()
    }
    return { kloelPlan: plan ? { product: plan.product, tier: plan.tier, interval: plan.interval } as KloelBillingPlan : null, priceId: priceId(value.priceId), productName: value.productName, currency: value.currency, unitAmount: value.unitAmount as number | null, interval: value.interval as string | null, intervalCount: value.intervalCount as number | null, active: value.active, livemode: value.livemode, checkoutUsable: value.checkoutUsable, ...(value.reason ? { reason: String(value.reason) } : {}), synthetic: raw.mode === 'test' || value.synthetic === true }
  })
  if ((!raw.configured || raw.mode === 'unavailable') && items.length) invalid()
  return { mode: raw.mode as BillingMode, configured: raw.configured, items, source: 'stripe_api' }
}
export function parseBillingStatus(raw: unknown, tenantId: string): BillingStatus {
  if (!object(raw) || !Array.isArray(raw.subscriptions) || raw.account !== null && !object(raw.account)) invalid()
  let account: BillingStatus['account'] = null
  if (object(raw.account)) {
    if (raw.account.tenantId !== undefined && raw.account.tenantId !== tenantId || typeof raw.account.customerId !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(raw.account.customerId) || raw.account.checkoutStatus != null && typeof raw.account.checkoutStatus !== 'string') invalid()
    account = { customerId: raw.account.customerId, checkoutStatus: raw.account.checkoutStatus == null ? null : String(raw.account.checkoutStatus) }
  }
  const subscriptions = raw.subscriptions.map((value): BillingSubscription => {
    if (!object(value) || value.tenantId !== undefined && value.tenantId !== tenantId || typeof value.providerSubscriptionId !== 'string' || !/^sub_[A-Za-z0-9]+$/.test(value.providerSubscriptionId) || !['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'].includes(String(value.status)) || typeof value.cancelAtPeriodEnd !== 'boolean' || typeof value.scheduledCancellation !== 'boolean') invalid()
    for (const key of ['cancelAt', 'canceledAt', 'endedAt', 'currentPeriodEnd', 'startedAt']) if (!epoch(value[key] ?? null)) invalid()
    const scheduled = !['canceled', 'incomplete_expired'].includes(String(value.status)) && (value.cancelAtPeriodEnd || value.cancelAt != null)
    if (value.scheduledCancellation !== scheduled) invalid()
    return { startedAt: value.startedAt == null ? null : Number(value.startedAt), id: id(value.id), providerSubscriptionId: value.providerSubscriptionId, status: value.status as BillingSubscription['status'], priceId: value.priceId == null ? null : priceId(value.priceId), cancelAtPeriodEnd: value.cancelAtPeriodEnd, cancelAt: value.cancelAt as number ?? null, canceledAt: value.canceledAt as number ?? null, endedAt: value.endedAt as number ?? null, currentPeriodEnd: value.currentPeriodEnd as number ?? null, scheduledCancellation: scheduled }
  })
  const tiers: Record<string, string[]> = { voice: ['solo', 'team'], whatsapp: ['solo', 'team'], webchat: ['solo', 'team'], email: ['standard'], care: ['essential', 'pro', 'premium'] }
  const grants = (Array.isArray(raw.grants) ? raw.grants : []).map((g): BillingGrant => {
    if (!object(g) || typeof g.status !== 'string' || typeof g.planId !== 'string' || !date(g.startsAt) || !date(g.expiresAt) || !Array.isArray(g.products)) invalid()
    const products = g.products.map(p => { if (!object(p) || !Object.hasOwn(tiers, String(p.product)) || !tiers[String(p.product)].includes(String(p.tier))) invalid(); return { product: p.product, tier: p.tier } as BillingGrant['products'][number] })
    return { id: id(g.id), planId: g.planId.slice(0, 80), status: g.status, startsAt: g.startsAt, expiresAt: g.expiresAt, products }
  })
  return { account, subscriptions, ...(grants.length ? { grants } : {}) }
}
export function parseBillingCheckouts(raw: unknown): BillingCheckout[] {
  if (!object(raw) || !Array.isArray(raw.items)) invalid()
  return raw.items.map(value => {
    if (!object(value) || !['pending', 'requires_reconciliation', 'reconciling', 'open', 'completed', 'complete', 'expired'].includes(String(value.status)) || !epoch(value.expiresAt) || !date(value.createdAt) || !date(value.updatedAt)) invalid()
    const sessionId = value.sessionId === null ? null : checkoutId(value.sessionId)
    let url: string | null = null
    if (value.url !== null && value.url !== undefined) {
      if (value.status !== 'open' || !sessionId || value.expiresAt === null) invalid()
      const parsed = billingDestination(value.url, 'stripe.checkout')
      if (value.expiresAt * 1000 > Date.now()) url = parsed
    }
    return { id: id(value.id), sessionId, priceId: priceId(value.priceId), status: String(value.status), expiresAt: value.expiresAt, url, createdAt: value.createdAt, updatedAt: value.updatedAt }
  })
}
function parseOperation(raw: unknown, operation: BillingOperationKind): BillingOperation {
  if (!object(raw) || raw.operation !== operation || !['pending', 'succeeded', 'failed', 'unknown'].includes(String(raw.status)) || raw.errorCode !== null && (typeof raw.errorCode !== 'string' || !/^[a-zA-Z0-9_:-]{1,100}$/.test(raw.errorCode)) || typeof raw.requiresReconciliation !== 'boolean' || raw.requiresReconciliation !== ['pending', 'unknown'].includes(String(raw.status))) invalid()
  const result = raw.result == null ? undefined : parseHostedBillingSession(raw.result, operation)
  // Successful creation can outlive the usable hosted URL; status remains successful.
  if (raw.status !== 'succeeded' && result) invalid()
  return { operation, status: raw.status as BillingOperation['status'], errorCode: raw.errorCode as string | null, ...(result ? { result } : {}), requiresReconciliation: raw.requiresReconciliation }
}

export function createBillingService(context: EngineContext) {
  async function read<T>(path: string, parse: (value: unknown) => T, query?: Record<string, string>, signal?: AbortSignal) {
    context.assertCurrent(); const raw = await context.request(path, { query, signal, timeoutMs: 60000 }); context.assertCurrent(); return parse(raw)
  }
  return {
    status: (signal?: AbortSignal) => read('/billing/status', value => parseBillingStatus(value, context.tenantId), undefined, signal),
    catalog: (signal?: AbortSignal) => read('/billing/catalog', parseBillingCatalog, undefined, signal),
    checkouts: (signal?: AbortSignal) => read('/billing/checkouts', parseBillingCheckouts, undefined, signal),
    operation: (kind: BillingOperationKind, key: string) => read(`/billing/operations/${operationKey(key)}`, raw => parseOperation(raw, kind), { operation: kind }),
    async start(kind: BillingOperationKind, key: string, selectedPrice?: string): Promise<HostedBillingSession> {
      context.assertCurrent()
      const body = kind === 'stripe.checkout' ? { priceId: priceId(selectedPrice), idempotencyKey: operationKey(key) } : { idempotencyKey: operationKey(key) }
      const raw = await context.request(kind === 'stripe.checkout' ? '/billing/checkout' : '/billing/portal', { method: 'POST', body, timeoutMs: 60000 })
      context.assertCurrent(); return parseHostedBillingSession(raw, kind)
    },
    async reconcile(sessionId: string): Promise<BillingReconciliation> {
      context.assertCurrent(); const raw = await context.request<unknown>('/billing/reconcile', { method: 'POST', body: { checkoutSessionId: checkoutId(sessionId) }, timeoutMs: 60000 }); context.assertCurrent()
      if (!object(raw) || !['open', 'complete', 'expired'].includes(String(raw.checkoutStatus)) || raw.source !== 'stripe_api' || !date(raw.reconciledAt)) invalid()
      return { checkoutStatus: raw.checkoutStatus as BillingReconciliation['checkoutStatus'], source: 'stripe_api', reconciledAt: raw.reconciledAt, ...(raw.reconciliationId ? { reconciliationId: id(raw.reconciliationId) } : {}) }
    },
  }
}

/** Once a request starts, recovery uses GET only. A lost response never creates another Checkout. */
export function createBillingAttempt(service: ReturnType<typeof createBillingService>, operation: BillingOperationKind, selectedPrice?: string, key: string = crypto.randomUUID()) {
  operationKey(key); if (operation === 'stripe.checkout') priceId(selectedPrice)
  let started = false, pending: Promise<HostedBillingSession> | undefined
  return { operation, key, priceId: selectedPrice,
    start() {
      if (pending) return pending
      if (started) return Promise.reject(new EngineError(409, 'billing_already_started', 'Esta operação já foi iniciada. Consulte seu recibo.'))
      started = true; pending = service.start(operation, key, selectedPrice).finally(() => { pending = undefined }); return pending
    },
    recover: () => service.operation(operation, key),
  }
}

export type BillingAttemptReference = { kind: BillingOperationKind; key: string; mode: BillingMode; customerId?: string }
function attemptReference(value: unknown): BillingAttemptReference {
  if (!object(value) || !['stripe.checkout', 'stripe.portal'].includes(String(value.kind)) || typeof value.key !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(value.key) || !['test', 'live', 'unavailable'].includes(String(value.mode)) || value.customerId !== undefined && (typeof value.customerId !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(value.customerId))) throw new EngineError(0, 'billing_recovery_unavailable', 'Não foi possível ler os identificadores de cobrança salvos nesta aba.')
  return { kind: value.kind as BillingOperationKind, key: value.key, mode: value.mode as BillingMode, ...(value.customerId ? { customerId: String(value.customerId) } : {}) }
}

/** References are untrusted hints, scoped by opaque identity IDs; the server authorizes every GET. */
export function createBillingAttemptStorage(storage: Pick<Storage, 'getItem' | 'setItem'>, scope: { userId: string; tenantId: string }) {
  const storageKey = `kloel:billing:attempts:v1:${encodeURIComponent(id(scope.userId))}:${encodeURIComponent(id(scope.tenantId))}`
  function read(): BillingAttemptReference[] {
    try {
      const raw = storage.getItem(storageKey)
      if (raw === null) return []
      if (raw.length > 4096) throw Error('invalid')
      const data: unknown = JSON.parse(raw)
      if (!object(data) || data.version !== 1 || !Array.isArray(data.attempts) || data.attempts.length > 2) throw Error('invalid')
      const refs = data.attempts.map(attemptReference)
      if (new Set(refs.map(ref => ref.kind)).size !== refs.length) throw Error('invalid')
      return refs
    } catch { throw new EngineError(0, 'billing_recovery_unavailable', 'Não foi possível ler os identificadores de cobrança salvos nesta aba. Consulte os registros antes de iniciar outra operação.') }
  }
  return { read, remember(value: BillingAttemptReference) {
    try {
      const ref = attemptReference(value), refs = [...read().filter(item => item.kind !== ref.kind), ref]
      const raw = JSON.stringify({ version: 1, attempts: refs })
      storage.setItem(storageKey, raw)
      if (storage.getItem(storageKey) !== raw) throw Error('not persisted')
    } catch { throw new EngineError(0, 'billing_recovery_unavailable', 'Não foi possível preservar o identificador nesta aba. Nenhuma nova operação foi enviada.') }
  } }
}

/** Restored references cannot create sessions, even if their local storage was modified. */
export function restoreBillingAttempt(service: ReturnType<typeof createBillingService>, value: BillingAttemptReference): ReturnType<typeof createBillingAttempt> {
  const ref = attemptReference(value)
  return { operation: ref.kind, key: ref.key, priceId: undefined,
    start: () => Promise.reject(new EngineError(409, 'billing_already_started', 'Consulte a operação anterior; ela não será iniciada novamente.')),
    recover: () => service.operation(ref.kind, ref.key),
  }
}

/** Charge minor units per https://docs.stripe.com/currencies; ISK/UGX remain two-decimal API amounts. */
export function formatBillingAmount(amount: number | null, currency: string): string {
  if (amount === null) return 'Valor não disponível'
  const code = currency.toUpperCase(), zero = ['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']
  const decimals = zero.includes(code) ? 0 : 2
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount / 10 ** decimals)
}
