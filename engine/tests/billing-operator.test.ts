import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Store } from '../src/store.js';
import { registerProviders } from '../src/providers.js';
import { seedMemberships } from './fixtures/membership.js';

const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
const configuration = { PROVIDER_TENANT_ID: 'tenant', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PRICE_IDS: 'price_fixture', APP_ORIGIN: 'http://localhost:3000', BILLING_RETURN_URL: '/app/billing' };
let app: FastifyInstance, store: Store, calls: string[], cookie: string;
let respond: (url: string, init: RequestInit) => Promise<Response>;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const checkout = () => ({ id: 'cs_fixture', url: 'https://checkout.stripe.com/c/pay/fixture', status: 'open', payment_status: 'unpaid', expires_at: Math.floor(Date.now() / 1000) + 3600, livemode: false });
const portal = () => ({ id: 'bps_fixture', url: 'https://billing.stripe.com/p/session/fixture' });
beforeEach(async () => {
  Object.assign(process.env, configuration); calls = []; cookie = 'session-one'; store = new Store();
  store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run('owner', 'tenant', 'owner@example.test', 'unused', 'owner');
  for (const value of ['session-one', 'session-two']) store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(digest(value), 'owner', Date.now() + 3600000);
  seedMemberships(store);
  respond = async () => Response.json(checkout());
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => { calls.push(String(url)); return respond(String(url), init); }) as typeof fetch;
  app = Fastify(); app.addHook('onRequest', async req => { req.cookies = { kloel_session: cookie }; req.actor = { userId: 'owner', tenantId: 'tenant', role: 'owner' }; });
  await registerProviders(app, store); await app.ready();
});
afterEach(async () => {
  await app.close(); store.close(); globalThis.fetch = savedFetch;
  for (const name of Object.keys(configuration)) { if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name]; }
});
const postCheckout = (key = 'checkout-one') => app.inject({ method: 'POST', url: '/api/v1/billing/checkout', payload: { priceId: 'price_fixture', idempotencyKey: key } });
const operation = (key = 'checkout-one', kind = 'stripe.checkout') => app.inject(`/api/v1/billing/operations/${key}?operation=${kind}`);

test('checkout recovery is private to original session and never repeats provider I/O', async () => {
  assert.equal((await postCheckout()).statusCode, 200);
  const first = await operation(); assert.equal(first.json().status, 'succeeded'); assert.equal(first.json().result.sessionId, 'cs_fixture');
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.ok(!first.body.includes('operatorSessionHash')); assert.ok(!first.body.includes(configuration.STRIPE_SECRET_KEY));
  cookie = 'session-two'; assert.equal((await operation()).statusCode, 404); assert.equal((await postCheckout()).statusCode, 403);
  assert.equal(calls.length, 1);
});

test('configuration change masks historical checkout links and prevents reuse or replacement', async () => {
  assert.equal((await postCheckout()).statusCode, 200);
  assert.equal((await app.inject('/api/v1/billing/checkouts')).json().items[0].url, checkout().url);
  process.env.STRIPE_SECRET_KEY = 'sk_live_other_account';
  assert.equal((await app.inject('/api/v1/billing/checkouts')).json().items[0].url, null);
  assert.equal((await operation()).statusCode, 404);
  assert.equal((await postCheckout('checkout-new')).json().error.code, 'billing_checkout_configuration_mismatch');
  assert.equal(calls.length, 1);
});

test('legacy checkout without provider identity is not silently reusable', async () => {
  const result = checkout(); store.create('tenant', 'billing-checkouts', { status: 'open', priceId: 'price_fixture', sessionId: result.id, expiresAt: result.expires_at, result: { sessionId: result.id, url: result.url, expiresAt: result.expires_at, paymentStatus: 'unpaid' } });
  assert.equal((await app.inject('/api/v1/billing/checkouts')).json().items[0].url, null);
  assert.equal((await postCheckout()).statusCode, 409); assert.equal(calls.length, 0);
});

test('revocation during Stripe I/O retains observed receipt but discloses no hosted URL', async () => {
  respond = async () => { store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(cookie)); return Response.json(checkout()); };
  const result = await postCheckout(); assert.equal(result.statusCode, 403); assert.ok(!result.body.includes('checkout.stripe.com'));
  assert.equal(store.list('tenant', 'provider-operations')[0].status, 'succeeded'); assert.equal(store.list('tenant', 'billing-checkouts')[0].sessionId, 'cs_fixture');
  assert.equal((await operation()).statusCode, 403); assert.equal(calls.length, 1);
});

test('concurrent checkout webhook state is preserved and recovered without a stale payment link', async () => {
  respond = async () => { const row = store.list('tenant', 'billing-checkouts')[0]; store.update('tenant', 'billing-checkouts', row.id, { status: 'completed' }); return Response.json(checkout()); };
  const result = await postCheckout(); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'billing_changed_retry');
  assert.equal(store.list('tenant', 'billing-checkouts')[0].status, 'completed');
  const recovery = (await operation()).json(); assert.equal(recovery.status, 'succeeded'); assert.equal(recovery.result, undefined);
  assert.equal((await app.inject('/api/v1/billing/checkouts')).json().items[0].url, null); assert.equal(calls.length, 1);
});

test('portal customer change during request retains receipt without returning former customer portal', async () => {
  const account = store.create('tenant', 'billing-accounts', { customerId: 'cus_first' });
  respond = async () => { store.update('tenant', 'billing-accounts', account.id, { customerId: 'cus_second' }); return Response.json(portal()); };
  const result = await app.inject({ method: 'POST', url: '/api/v1/billing/portal', payload: { idempotencyKey: 'portal-one' } });
  assert.equal(result.statusCode, 409); assert.ok(!result.body.includes('billing.stripe.com'));
  const recovery = (await operation('portal-one', 'stripe.portal')).json(); assert.equal(recovery.status, 'succeeded'); assert.equal(recovery.result, undefined); assert.equal(calls.length, 1);
});

test('unknown provider outcome remains a barrier across different idempotency keys', async () => {
  respond = async () => { throw new Error('controlled connection loss'); };
  assert.equal((await postCheckout()).statusCode, 502);
  const receipt = (await operation()).json(); assert.equal(receipt.status, 'unknown'); assert.equal(receipt.requiresReconciliation, true);
  assert.equal((await postCheckout('checkout-new')).statusCode, 409); assert.equal(calls.length, 1);
});

test('catalog reports actual Stripe price mode, eligibility and synthetic designation without secrets', async () => {
  respond = async url => { assert.ok(url.includes('/prices/price_fixture?')); return Response.json({ id: 'price_fixture', active: true, livemode: false, currency: 'brl', unit_amount: 100, type: 'recurring', billing_scheme: 'per_unit', product: { name: 'Validação sintética', active: true }, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }); };
  const response = await app.inject('/api/v1/billing/catalog'); assert.equal(response.statusCode, 200);
  assert.equal(response.json().mode, 'test'); assert.equal(response.json().items[0].unitAmount, 100); assert.equal(response.json().items[0].synthetic, true); assert.equal(response.json().items[0].checkoutUsable, true);
  assert.ok(!response.body.includes(configuration.STRIPE_SECRET_KEY)); assert.equal(store.list('tenant', 'provider-operations').length, 0);
});

test('invalid return origin is rejected before Stripe I/O', async () => {
  process.env.BILLING_RETURN_URL = 'https://unrelated.example/billing';
  assert.equal((await postCheckout()).json().error.code, 'billing_return_invalid'); assert.equal(calls.length, 0);
});

test('explicit server billing return supports the new local app without changing APP_ORIGIN', async () => {
  const previous = process.env.STRIPE_BILLING_RETURN_URL;
  try {
    process.env.STRIPE_BILLING_RETURN_URL = 'http://127.0.0.1:3004/app/billing';
    respond = async (_url, init) => { const body = new URLSearchParams(String(init.body)); assert.equal(body.get('billing_address_collection'), 'required'); assert.equal(body.get('success_url'), 'http://127.0.0.1:3004/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}'); return Response.json(checkout()); };
    assert.equal((await postCheckout()).statusCode, 200); assert.equal(process.env.APP_ORIGIN, configuration.APP_ORIGIN);
    process.env.STRIPE_BILLING_RETURN_URL = 'http://127.0.0.1:3005/app/billing';
    assert.equal((await operation()).statusCode, 404);
  } finally { if (previous === undefined) delete process.env.STRIPE_BILLING_RETURN_URL; else process.env.STRIPE_BILLING_RETURN_URL = previous; }
});

test('explicit billing return rejects external HTTP, credentials, query and wrong path before provider I/O', async () => {
  const previous = process.env.STRIPE_BILLING_RETURN_URL;
  try {
    for (const url of ['http://example.test/app/billing', 'https://user:pass@example.test/app/billing', 'https://example.test/app/billing?paid=true', 'https://example.test/app/billing#done', 'http://127.0.0.1:3004/billing', '/app/billing']) {
      process.env.STRIPE_BILLING_RETURN_URL = url;
      assert.equal((await postCheckout()).json().error.code, 'billing_return_invalid');
    }
    assert.equal(calls.length, 0);
  } finally { if (previous === undefined) delete process.env.STRIPE_BILLING_RETURN_URL; else process.env.STRIPE_BILLING_RETURN_URL = previous; }
});

test('billing return configuration rotation during provider I/O retains receipt without disclosing an old URL', async () => {
  const previous = process.env.STRIPE_BILLING_RETURN_URL;
  try {
    process.env.STRIPE_BILLING_RETURN_URL = 'http://127.0.0.1:3004/app/billing';
    respond = async () => { process.env.STRIPE_BILLING_RETURN_URL = 'http://127.0.0.1:3005/app/billing'; return Response.json(checkout()); };
    const response = await postCheckout();
    assert.equal(response.statusCode, 409); assert.ok(!response.body.includes('checkout.stripe.com'));
    assert.equal(store.list('tenant', 'provider-operations')[0].status, 'succeeded');
    assert.equal((await operation()).statusCode, 404); assert.equal(calls.length, 1);
  } finally { if (previous === undefined) delete process.env.STRIPE_BILLING_RETURN_URL; else process.env.STRIPE_BILLING_RETURN_URL = previous; }
});
