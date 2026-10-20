import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { billingFixture } from './fixtures/billing-engine'
import { billingDestination, createBillingAttempt, createBillingAttemptStorage, restoreBillingAttempt, createBillingService, formatBillingAmount, parseBillingCatalog, parseBillingStatus, parseHostedBillingSession } from '../src/services/engine/billing'
import { EngineError, type EngineRequest } from '../src/services/engine/http'

test('actual billing routes publish sandbox prices, create hosted checkout once and reconcile real subscription fields', async t => {
  const f = await billingFixture(t), catalog = await f.service.catalog()
  assert.equal(catalog.mode, 'test'); assert.equal(catalog.items[0].unitAmount, 100); assert.equal(catalog.items[0].synthetic, true)
  assert.equal(catalog.items[0].checkoutUsable, true); assert.equal(formatBillingAmount(100, 'brl'), 'R$\u00a01,00')
  assert.deepEqual(await f.service.status(), { account: null, subscriptions: [] })
  const attempt = createBillingAttempt(f.service, 'stripe.checkout', 'price_fixture'), first = attempt.start(), duplicate = attempt.start()
  assert.equal(first, duplicate); const result = await first
  assert.equal(result.sessionId, 'cs_test_fixture'); assert.equal(new URL(result.url).origin, 'https://checkout.stripe.com')
  await assert.rejects(attempt.start(), (e: any) => e.code === 'billing_already_started')
  const receipt = await attempt.recover(); assert.equal(receipt.status, 'succeeded'); assert.equal(receipt.result?.sessionId, result.sessionId)
  assert.equal(f.state.requests.filter(r => r.method === 'POST' && r.url.includes('/checkout/')).length, 1)
  const remote = f.state.requests.find(r => r.method === 'POST')!
  assert.equal(remote.body.get('client_reference_id'), f.actor.tenantId); assert.match(remote.body.get('success_url')!, /^http:\/\/127\.0\.0\.1:8787\/app\/billing\?/)
  assert.equal((await f.service.checkouts())[0].status, 'open')
  f.state.complete = true; const reconciliation = await f.service.reconcile(result.sessionId)
  assert.equal(reconciliation.source, 'stripe_api'); assert.equal(reconciliation.checkoutStatus, 'complete')
  const state = await f.service.status(), subscription = state.subscriptions[0]
  assert.equal(state.account?.customerId, 'cus_fixture'); assert.equal(subscription.status, 'active')
  assert.equal(subscription.cancelAtPeriodEnd, false); assert.equal(subscription.cancelAt, f.cancelAt); assert.equal(subscription.scheduledCancellation, true)
  assert.equal((await f.service.checkouts())[0].url, null)
  const after = await attempt.recover(); assert.equal(after.status, 'succeeded'); assert.equal(after.result, undefined)
  await assert.rejects(f.service.start('stripe.checkout', randomUUID(), 'price_fixture'), (e: any) => e.code === 'subscription_exists')
  const portal = createBillingAttempt(f.service, 'stripe.portal'), session = await portal.start()
  assert.equal(new URL(session.url).hostname, 'billing.stripe.com'); assert.equal((await portal.recover()).status, 'succeeded')
  assert.equal(f.state.requests.filter(r => r.method === 'POST' && r.url.includes('billing_portal')).length, 1)
})

test('lost browser response is recovered with GET only and unknown provider outcome cannot create a second checkout', async t => {
  const f = await billingFixture(t), attempt = createBillingAttempt(f.service, 'stripe.checkout', 'price_fixture')
  f.state.lostResponsePath = '/api/v1/billing/checkout'
  await assert.rejects(attempt.start(), (e: any) => e.code === 'network_error')
  assert.equal((await attempt.recover()).result?.sessionId, 'cs_test_fixture')
  assert.equal(f.state.localRequests.filter(r => r.method === 'POST').length, 1)
  assert.equal((await f.service.checkouts()).length, 1)
})

test('unknown creation is durable, recoverable without retry and blocks another checkout', async t => {
  const f = await billingFixture(t); f.state.providerUnknown = true
  const attempt = createBillingAttempt(f.service, 'stripe.checkout', 'price_fixture')
  await assert.rejects(attempt.start(), (e: any) => e.status === 502)
  const receipt = await attempt.recover(); assert.equal(receipt.status, 'unknown'); assert.equal(receipt.requiresReconciliation, true); assert.equal(receipt.result, undefined)
  assert.equal((await f.service.checkouts())[0].sessionId, null)
  await assert.rejects(f.service.start('stripe.checkout', randomUUID(), 'price_fixture'), (e: any) => e.code === 'billing_checkout_exists')
  assert.equal(f.state.requests.filter(r => r.method === 'POST').length, 1)
})

test('persisted attempt references isolate user/tenant and restore only authorized GET recovery without sensitive fields', async t => {
  const f = await billingFixture(t), data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  const scope = { userId: f.actor.userId, tenantId: f.actor.tenantId }, journal = createBillingAttemptStorage(storage, scope)
  const original = createBillingAttempt(f.service, 'stripe.checkout', 'price_fixture')
  journal.remember({ kind: 'stripe.checkout', key: original.key, mode: 'test', url: 'https://secret.invalid', email: 'private@example.test' } as any)
  f.state.lostResponsePath = '/api/v1/billing/checkout'; await assert.rejects(original.start())
  const saved = createBillingAttemptStorage(storage, scope).read()
  assert.deepEqual(saved, [{ kind: 'stripe.checkout', key: original.key, mode: 'test' }])
  assert.equal(/https|private|email|url/i.test([...data.values()].join('')), false)
  assert.deepEqual(createBillingAttemptStorage(storage, { ...scope, tenantId: 'other-tenant' }).read(), [])
  assert.deepEqual(createBillingAttemptStorage(storage, { ...scope, userId: 'other-user' }).read(), [])
  const restored = restoreBillingAttempt(f.service, saved[0])
  await assert.rejects(restored.start(), (e: any) => e.code === 'billing_already_started')
  assert.equal((await restored.recover()).result?.sessionId, 'cs_test_fixture')
  assert.equal(f.state.localRequests.filter(r => r.method === 'POST').length, 1)
  assert.equal(f.state.requests.filter(r => r.method === 'POST').length, 1)
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash)
  f.state.currentToken = randomUUID()
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(f.state.currentToken).digest('hex'), f.actor.userId, f.actor.tenantId, Date.now() + 60000)
  await assert.rejects(restored.recover(), (e: any) => e.status === 404 && e.code === 'billing_operation_not_found')
  assert.equal(f.state.localRequests.filter(r => r.method === 'POST').length, 1)
  const key = [...data.keys()][0]; data.set(key, '{invalid')
  assert.throws(() => journal.read(), (e: any) => e.code === 'billing_recovery_unavailable')
  assert.throws(() => journal.remember(saved[0]), (e: any) => e.code === 'billing_recovery_unavailable')
  const unavailable = createBillingAttemptStorage({ getItem: () => null, setItem: () => { throw Error('storage disabled') } }, scope)
  assert.throws(() => unavailable.remember(saved[0]), (e: any) => e.code === 'billing_recovery_unavailable')
})

test('session/role revocation while upstream runs prevents URL disclosure while retaining accepted external receipt', async t => {
  const f = await billingFixture(t); f.state.pause = true
  const attempt = createBillingAttempt(f.service, 'stripe.checkout', 'price_fixture'), started = attempt.start()
  while (!f.state.release) await new Promise(resolve => setImmediate(resolve))
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash); f.state.release()
  await assert.rejects(started, (e: any) => e.status === 403)
  const row = f.store.list(f.actor.tenantId, 'provider-operations').find(r => r.operation === 'stripe.checkout')!
  assert.equal(row.status, 'succeeded')
  await assert.rejects(attempt.recover(), (e: any) => e.status === 401)
  assert.equal(f.state.requests.filter(r => r.method === 'POST').length, 1)
})

test('unconfigured state is explicit and current permissions are required without contacting Stripe', async t => {
  const f = await billingFixture(t); delete process.env.STRIPE_SECRET_KEY
  assert.deepEqual(await f.service.catalog(), { mode: 'unavailable', configured: false, items: [], source: 'stripe_api' }); assert.equal(f.state.requests.length, 0)
  f.store.db.prepare("UPDATE memberships SET role='member' WHERE user_id=?").run(f.actor.userId)
  await assert.rejects(f.service.status(), (e: any) => e.status === 403)
  await assert.rejects(f.service.start('stripe.portal', randomUUID()), (e: any) => e.status === 403)
  assert.equal(f.state.requests.length, 0)
})

test('redirect allowlists, monetary minor units and DTO projection reject dangerous or inconsistent data', async () => {
  for (const url of ['javascript:alert(1)', 'https://checkout.stripe.com.evil.test/a', 'http://checkout.stripe.com/a', 'https://secret@checkout.stripe.com/a', 'https://checkout.stripe.com:444/a', 'https://billing.stripe.com/a', 'https://checkout.stripe.com/']) assert.throws(() => billingDestination(url, 'stripe.checkout'), EngineError)
  assert.equal(billingDestination('https://checkout.stripe.com/c/pay/cs_test_fixture#valid', 'stripe.checkout'), 'https://checkout.stripe.com/c/pay/cs_test_fixture#valid')
  assert.equal(formatBillingAmount(500, 'jpy').includes('500'), true); assert.equal(formatBillingAmount(500, 'ugx').includes('5,00'), true)
  const hosted = parseHostedBillingSession({ sessionId: 'bps_fixture', url: 'https://billing.stripe.com/p/session/x', secret: 'never expose', customer: { email: 'private' } }, 'stripe.portal')
  assert.equal(JSON.stringify(hosted).includes('never expose'), false); assert.equal((hosted as any).customer, undefined)
  assert.throws(() => parseBillingCatalog({ configured: true, mode: 'test', source: 'stripe_api', items: [{ priceId: 'price_fixture', productName: 'Wrong mode', currency: 'brl', unitAmount: 100, interval: 'month', intervalCount: 1, active: true, livemode: true, checkoutUsable: true }] }), EngineError)
  assert.throws(() => parseBillingStatus({ account: { tenantId: 'foreign', customerId: 'cus_x' }, subscriptions: [] }, 'local'), EngineError)
  let current = true
  const service = createBillingService({ tenantId: 'T', generation: 1, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', 'changed') }, request: (async () => { current = false; return { account: null, subscriptions: [] } }) as EngineRequest })
  await assert.rejects(service.status(), (e: any) => e.code === 'superseded')
})
