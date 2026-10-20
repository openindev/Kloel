import { createHash, randomUUID } from 'node:crypto'
import Fastify from '../../../engine/node_modules/fastify/fastify.js'
import cookie from '../../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../../engine/src/store'
import { registerAuth } from '../../../engine/src/auth'
import { registerProviders } from '../../../engine/src/providers'
import { seedMember } from '../../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError } from '../../src/services/engine/http'
import { createBillingService } from '../../src/services/engine/billing'

export async function billingFixture(t: any) {
  const names = ['PROVIDER_TENANT_ID', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_IDS', 'APP_ORIGIN', 'BILLING_RETURN_URL'], saved = Object.fromEntries(names.map(name => [name, process.env[name]])), originalFetch = globalThis.fetch
  const store = new Store(), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }, token = randomUUID(), sessionHash = createHash('sha256').update(token).digest('hex')
  seedMember(store, actor); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, actor.tenantId, Date.now() + 60000)
  Object.assign(process.env, { PROVIDER_TENANT_ID: actor.tenantId, STRIPE_SECRET_KEY: 'sk_test_fixture_only_no_network', STRIPE_PRICE_IDS: 'price_fixture', APP_ORIGIN: 'http://127.0.0.1:8787', BILLING_RETURN_URL: '/app/billing' })
  const state = { complete: false, lostResponsePath: '', providerUnknown: false, live: false, pause: false, release: undefined as (() => void) | undefined, started: undefined as (() => void) | undefined, requests: [] as Array<{ url: string; method: string; body: URLSearchParams }>, localRequests: [] as Array<{ path: string; method: string; body?: any }>, currentToken: token }
  const expiration = Math.floor(Date.now() / 1000) + 3600, cancelAt = Math.floor(Date.now() / 1000) + 86400
  const checkout = () => ({ id: 'cs_test_fixture', object: 'checkout.session', livemode: state.live, url: 'https://checkout.stripe.com/c/pay/cs_test_fixture#valid', expires_at: expiration, status: state.complete ? 'complete' : 'open', payment_status: state.complete ? 'paid' : 'unpaid', mode: 'subscription', customer: state.complete ? 'cus_fixture' : null, subscription: state.complete ? 'sub_fixture' : null, metadata: { tenantId: actor.tenantId }, client_reference_id: actor.tenantId, line_items: { has_more: false, data: [{ price: { id: 'price_fixture' }, quantity: 1 }] } })
  const providerFetch: typeof fetch = async (path, options = {}) => {
    const url = new URL(String(path)); assertStripe(url)
    const body = new URLSearchParams(String(options.body ?? '')), method = options.method ?? 'GET'
    state.requests.push({ url: url.href, method, body })
    if (url.pathname === '/v1/prices/price_fixture') return Response.json({ id: 'price_fixture', active: true, livemode: state.live, currency: 'brl', unit_amount: 100, type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, product: { id: 'prod_fixture', name: 'Kloel — validação sintética', active: true, metadata: { kloel_synthetic: 'true' } }, metadata: {} })
    if (url.pathname === '/v1/checkout/sessions' && method === 'POST') {
      if (state.pause) { state.started?.(); await new Promise<void>(resolve => { state.release = resolve }) }
      if (state.providerUnknown) throw Error('Provider unavailable fixture')
      return Response.json(checkout())
    }
    if (url.pathname === '/v1/checkout/sessions/cs_test_fixture') return Response.json(checkout())
    if (url.pathname === '/v1/subscriptions/sub_fixture') return Response.json({ id: 'sub_fixture', customer: 'cus_fixture', metadata: { tenantId: actor.tenantId }, status: 'active', cancel_at_period_end: false, cancel_at: cancelAt, canceled_at: cancelAt - 1000, ended_at: null, items: { has_more: false, data: [{ price: { id: 'price_fixture' }, quantity: 1, current_period_end: cancelAt }] } })
    if (url.pathname === '/v1/billing_portal/sessions' && method === 'POST') {
      if (state.pause) await new Promise<void>(resolve => { state.release = resolve })
      return Response.json({ id: 'bps_fixture', url: 'https://billing.stripe.com/p/session/test_fixture' })
    }
    throw Error(`Unexpected mocked Stripe endpoint ${url.pathname}`)
  }
  globalThis.fetch = providerFetch
  const app = Fastify(); await app.register(cookie); await registerAuth(app, store); await registerProviders(app, store)
  const localFetch: typeof fetch = async (path, options = {}) => {
    const url = String(path); if (url.startsWith('https:')) return providerFetch(path, options)
    state.localRequests.push({ path: url, method: options.method ?? 'GET', body: options.body ? JSON.parse(String(options.body)) : undefined })
    const response = await app.inject({ method: options.method as any ?? 'GET', url, headers: { ...options.headers as Record<string, string>, cookie: `kloel_session=${state.currentToken}` }, ...(options.body ? { payload: String(options.body) } : {}) })
    if (state.lostResponsePath === url) { state.lostResponsePath = ''; throw Error('Browser response lost fixture') }
    return new Response(response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  }
  let current = true
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', 'Session replaced') }, request: createEngineClient(localFetch) }
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = originalFetch; for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name] })
  return { store, app, actor, token, sessionHash, state, context, localFetch, providerFetch, service: createBillingService(context), invalidate: () => { current = false }, expiration, cancelAt }
}
function assertStripe(url: URL) { if (url.origin !== 'https://api.stripe.com') throw Error('Unexpected external origin in billing fixture') }
