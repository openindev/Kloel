import test from 'node:test'
import assert from 'node:assert/strict'
import { selectedBillingPrice, projectBilling, createHostedBillingActions, loadBilling } from '../src/services/casca/billing'
import { parseBillingCatalog, type BillingCatalog, type BillingStatus } from '../src/services/engine/billing'
import type { EngineContext } from '../src/services/engine/session'
import { planOf } from '../src/data/catalogs/plans'
const expected = { userId: 'owner', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
const cart = [{ product: 'voice', tier: 'solo', interval: 'monthly' }] as const
const catalog = (mode: 'test' | 'live' = 'test'): BillingCatalog => ({ configured: true, mode, source: 'stripe_api', items: [{ priceId: 'price_actual', productName: 'Produto', currency: 'brl', unitAmount: planOf('voice', 'solo')!.monthly! * 100, interval: 'month', intervalCount: 1, active: true, livemode: mode === 'live', checkoutUsable: true, synthetic: mode === 'test', kloelPlan: { ...cart[0] } }] })
const identity = { configured: true, mode: 'test', verification: null } as const
const status = (): BillingStatus => ({ account: { customerId: 'cus_actual', checkoutStatus: 'complete' }, subscriptions: [{ id: 'subscription', providerSubscriptionId: 'sub_actual', status: 'active', priceId: 'price_actual', startedAt: null, cancelAtPeriodEnd: false, cancelAt: null, canceledAt: null, endedAt: null, currentPeriodEnd: null, scheduledCancellation: false }] })
const session = { sessionId: 'cs_test_actual', url: 'https://checkout.stripe.com/c/pay/cs_test_actual#fragment', expiresAt: Math.floor(Date.now() / 1000) + 600, paymentStatus: 'unpaid' }
const memory = () => { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }
const context = (request: EngineContext['request']): EngineContext => ({ tenantId: 'tenant', generation: 1, assertCurrent() {}, request })

test('checkout uses explicit coherent metadata and the exact displayed cycle amount, never a product name/amount guess', () => {
  assert.equal(selectedBillingPrice([...cart], catalog()).priceId, 'price_actual')
  for (const changed of [{ kloelPlan: null }, { unitAmount: 1 }, { currency: 'usd' }, { checkoutUsable: false }]) {
    const c = catalog(); Object.assign(c.items[0], changed); assert.throws(() => selectedBillingPrice([...cart], c))
  }
  assert.throws(() => selectedBillingPrice([...cart, ...cart], catalog()))
  const duplicate = catalog(); duplicate.items.push({ ...duplicate.items[0], priceId: 'price_duplicate' }); assert.throws(() => selectedBillingPrice([...cart], duplicate))
  for (const changed of [{ product: 'email', tier: 'solo' }, { product: 'toString' }, { interval: 'annual' }]) {
    const c = catalog(); Object.assign(c.items[0].kloelPlan!, changed); assert.throws(() => parseBillingCatalog(c))
  }
})

test('test subscriptions never grant production features; unknown dates, balance, invoices and address stay unknown', () => {
  const projected = projectBilling('tenant', catalog(), status(), identity)
  assert.equal(projected.subscriptions.length, 0); assert.equal(projected.billingProfiles[0].engineBilling!.status.subscriptions.length, 1)
  assert.equal(projected.billingProfiles[0].engineBilling!.balanceKnown, false); assert.equal(projected.billingProfiles[0].engineBilling!.addressKnown, false)
  assert.deepEqual(projected.invoices, []); assert.equal(projected.billingProfiles[0].identity, 'not_started')
  const live = projectBilling('tenant', catalog('live'), status(), identity).subscriptions[0]
  assert.equal(live.startedAt, null); assert.equal(live.renewsAt, null)
  const s = status(); s.subscriptions[0].startedAt = 1792432000; s.subscriptions[0].currentPeriodEnd = 1795000000
  assert.equal(projectBilling('tenant', catalog('live'), s, identity).subscriptions[0].startedAt, new Date(1792432000 * 1000).toISOString())
  s.subscriptions[0].priceId = 'price_unknown'; assert.equal(projectBilling('tenant', catalog('live'), s, identity).subscriptions.length, 0)
})

test('lost checkout response recovers the original GET operation after reload; no PAN, URL or duplicate POST is stored', async () => {
  let posts = 0; const storage = memory(), calls: string[] = []
  const ctx = context(async (path, options) => {
    calls.push(path)
    if (path === '/billing/catalog') return catalog() as never
    if (path === '/billing/checkout') { posts++; assert.deepEqual(Object.keys(options!.body!).sort(), ['idempotencyKey', 'priceId']); throw Error('lost response') }
    if (path.startsWith('/billing/operations/')) return { operation: 'stripe.checkout', status: 'succeeded', errorCode: null, result: session, requiresReconciliation: false } as never
    throw Error('unexpected request')
  })
  await assert.rejects(createHostedBillingActions(ctx, expected, storage).checkout([...cart]))
  const resumed = await createHostedBillingActions(ctx, expected, storage).checkout([...cart]); assert.equal(resumed.session.sessionId, session.sessionId); assert.equal(posts, 1)
  assert.equal(calls.filter(path => path.startsWith('/billing/operations/')).length, 1)
  const saved = [...storage.data.values()].join(''); assert.ok(!saved.includes('https:')); assert.ok(!saved.includes('client_secret')); assert.ok(saved.includes(session.sessionId))
})

test('unknown creation or changed price cannot silently create another checkout; storage failure stops before POST', async () => {
  let posts = 0; const storage = memory(); let c = catalog()
  const ctx = context(async path => { if (path === '/billing/catalog') return c as never; if (path === '/billing/checkout') { posts++; throw Error('lost') }; return { operation: 'stripe.checkout', status: 'unknown', errorCode: null, requiresReconciliation: true } as never })
  const actions = createHostedBillingActions(ctx, expected, storage); await assert.rejects(actions.checkout([...cart])); await assert.rejects(actions.checkout([...cart])); assert.equal(posts, 1)
  c = catalog(); c.items[0].priceId = 'price_changed'; await assert.rejects(actions.checkout([...cart])); assert.equal(posts, 1)
  await assert.rejects(createHostedBillingActions(ctx, expected, { getItem() { return null }, setItem() { throw Error('storage denied') }, removeItem() {} }).checkout([...cart])); assert.equal(posts, 1)
})

test('checkout and portal journals are separate; successful portal recovery removes its own receipt only', async () => {
  const storage = memory(); let portalPosts = 0
  const ctx = context(async path => {
    if (path === '/billing/catalog') return catalog() as never
    if (path === '/billing/checkout') return session as never
    if (path === '/billing/portal') { portalPosts++; throw Error('lost portal') }
    if (path.startsWith('/billing/operations/')) return { operation: 'stripe.portal', status: 'succeeded', errorCode: null, requiresReconciliation: false, result: { sessionId: 'bps_actual', url: 'https://billing.stripe.com/p/session/actual' } } as never
    throw Error('unexpected')
  })
  const actions = createHostedBillingActions(ctx, expected, storage); await actions.checkout([...cart]); await assert.rejects(actions.portal()); assert.equal(storage.data.size, 2)
  await createHostedBillingActions(ctx, expected, storage).portal(); assert.equal(storage.data.size, 1); assert.equal(portalPosts, 1)
})

test('reconcile verifies registration and only clears the same confirmed checkout journal', async () => {
  const storage = memory(); let reconciles = 0
  const ctx = context(async (path, options) => {
    if (path === '/billing/catalog') return catalog() as never
    if (path === '/billing/checkout') return session as never
    if (path === '/billing/status') return status() as never
    if (path === '/billing/identity') return identity as never
    if (path === '/billing/checkouts') return { items: [session.sessionId, 'cs_test_other'].map(sessionId => ({ id: sessionId, sessionId, priceId: 'price_actual', status: 'complete', expiresAt: null, url: null, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z' })) } as never
    if (path === '/billing/reconcile') { reconciles++; return { checkoutStatus: 'complete', source: 'stripe_api', reconciledAt: '2026-10-19T00:00:00Z' } as never }
    throw Error('unexpected')
  })
  const actions = createHostedBillingActions(ctx, expected, storage); await actions.checkout([...cart])
  await assert.rejects(actions.reconcile('cs_test_unregistered')); assert.equal(reconciles, 0)
  await actions.reconcile('cs_test_other'); assert.equal(storage.data.size, 1)
  await actions.reconcile(session.sessionId); assert.equal(storage.data.size, 0); assert.equal(reconciles, 2)
})

test('session context change after provider response prevents publish and retains journal for controlled recovery', async () => {
  let current = true, posts = 0; const storage = memory()
  const ctx = context(async path => { if (path === '/billing/catalog') return catalog() as never; posts++; current = false; return session as never })
  ctx.assertCurrent = () => { if (!current) throw Error('context changed') }
  await assert.rejects(createHostedBillingActions(ctx, expected, storage).checkout([...cart]), /context changed/)
  assert.equal(posts, 1); assert.equal(storage.data.size, 1)
})

test('original checkout is recovered before any current catalogue or cart validation', async () => {
  const storage = memory(); let lost = true, reads = 0
  const ctx = context(async (path) => {
    if (path === '/billing/catalog') { reads++; if (!lost) throw Error('catalog now unavailable'); return catalog() as never }
    if (path === '/billing/checkout') { lost = false; throw Error('lost response') }
    return { operation: 'stripe.checkout', status: 'succeeded', errorCode: null, result: session, requiresReconciliation: false } as never
  })
  await assert.rejects(createHostedBillingActions(ctx, expected, storage).checkout([...cart]))
  const result = await createHostedBillingActions(ctx, expected, storage).checkout([])
  assert.equal(result.session.sessionId, session.sessionId); assert.equal(result.recovered, true); assert.equal(reads, 1)
})

test('terminal failed receipt clears only its slot and requires a new explicit invocation before another POST', async () => {
  const storage = memory(); let posts = 0
  const ctx = context(async path => {
    if (path === '/billing/catalog') return catalog() as never
    if (path === '/billing/checkout') { posts++; throw Error('definitive provider failure') }
    return { operation: 'stripe.checkout', status: 'failed', errorCode: 'provider_failed', requiresReconciliation: false } as never
  })
  const actions = createHostedBillingActions(ctx, expected, storage)
  await assert.rejects(actions.checkout([...cart])); await assert.rejects(actions.checkout([...cart]), /anterior falhou/)
  assert.equal(storage.data.size, 0); assert.equal(posts, 1)
  await assert.rejects(actions.checkout([...cart])); assert.equal(posts, 2)
})
