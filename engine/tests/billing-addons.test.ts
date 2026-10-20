import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Store } from '../src/store.js';
import { registerProviders } from '../src/providers.js';
import { registerPhoneRuntime } from '../src/phone-runtime.js';
import { planItems } from '../src/billing/addons.js';
import { normalizeEntitlement } from '../src/billing/plans.js';
import { autoBuyAddon, changeAddon, setAutoBuy, stripeClient } from '../src/billing/addon-purchase.js';
import { seedMemberships } from './fixtures/membership.js';

const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
const configuration: Record<string, string | undefined> = { PROVIDER_TENANT_ID: 'tenant', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PRICE_IDS: 'price_plan', APP_ORIGIN: 'http://localhost:3000', BILLING_RETURN_URL: '/app/billing',
  STRIPE_ADDON_PRICE_IDS: 'minutes:price_min,waConversations:price_wa', NUMBER_ADDON_PRICE_IDS: undefined, BILLING_AUTO_ADDON_MAX_PER_PERIOD: undefined, INTERNAL_TOKEN: 'internal-fixture-token', BILLING_ENFORCEMENT_DEFAULT: undefined };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const now = Math.floor(Date.now() / 1000), start = now - 86400 * 3, end = now + 86400 * 27;
type Call = { method: string; path: string; form: Record<string, string>; key: string | null };
let app: FastifyInstance, store: Store, calls: Call[], sub: any, failNext: ((call: Call) => Response | 'lose' | undefined) | undefined;
const plan = { id: 'price_plan', livemode: false, type: 'recurring', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, metadata: { kloel_catalog: 'casca-v2', kloel_product: 'voice', kloel_tier: 'solo', kloel_interval: 'monthly' },
  product: { id: 'prod_voice', metadata: { kloel_catalog: 'casca-v2', kloel_product: 'voice', kloel_tier: 'solo' } } };
const addonPrice = (id: string, unit_amount: number) => ({ id, active: true, type: 'recurring', billing_scheme: 'per_unit', unit_amount, currency: 'brl', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } });
/** Fake Stripe: a single subscription whose items change only through the subscription_items endpoints. */
async function stripe(url: string, init: RequestInit = {}): Promise<Response> {
  const u = new URL(url), method = String(init.method ?? 'GET'), form = Object.fromEntries(new URLSearchParams(String(init.body ?? '')));
  const call = { method, path: u.pathname.replace('/v1', ''), form, key: (init.headers as Record<string, string>)?.['Idempotency-Key'] ?? null };
  calls.push(call);
  const injected = failNext?.(call); if (injected instanceof Response) return injected;
  const items = sub?.items.data as any[];
  let body: unknown;
  if (call.path === '/subscriptions' && method === 'GET') body = { data: sub ? [sub] : [] };
  else if (call.path === `/subscriptions/${sub?.id}`) body = sub;
  else if (call.path === '/prices/price_plan') body = plan;
  else if (call.path === '/prices/price_min') body = addonPrice('price_min', 9000);
  else if (call.path === '/prices/price_wa') body = addonPrice('price_wa', 2400);
  else if (call.path === '/subscription_items' && method === 'POST') { const item = { id: `si_${form.price}`, price: { id: form.price }, quantity: Number(form.quantity) }; items.push(item); body = item; }
  else if (call.path.startsWith('/subscription_items/') && method === 'POST') { const item = items.find(i => i.id === call.path.split('/')[2]); item.quantity = Number(form.quantity); body = item; }
  else if (call.path.startsWith('/subscription_items/') && method === 'DELETE') { sub.items.data = items.filter(i => i.id !== call.path.split('/')[2]); body = { deleted: true }; }
  else return Response.json({ error: { message: 'unexpected' } }, { status: 404 });
  if (injected === 'lose') throw new TypeError('socket hang up');
  return Response.json(body);
}
const mutations = () => calls.filter(c => c.method !== 'GET');
beforeEach(async () => {
  for (const [k, v] of Object.entries(configuration)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  calls = []; failNext = undefined; store = new Store();
  sub = { id: 'sub_1', customer: 'cus_1', status: 'active', created: start, metadata: { tenantId: 'tenant' }, items: { has_more: false, data: [{ id: 'si_plan', price: { id: 'price_plan' }, quantity: 1, current_period_start: start, current_period_end: end }] } };
  store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run('owner', 'tenant', 'owner@example.test', 'unused', 'owner');
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(digest('session-one'), 'owner', Date.now() + 3600000);
  seedMemberships(store);
  store.create('tenant', 'billing-accounts', { customerId: 'cus_1' });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => stripe(String(url), init)) as typeof fetch;
  app = Fastify(); app.addHook('onRequest', async req => { req.cookies = { kloel_session: 'session-one' }; req.actor = { userId: 'owner', tenantId: 'tenant', role: 'owner' }; });
  await registerProviders(app, store); registerPhoneRuntime(app, store); await app.ready();
});
afterEach(async () => {
  await app.close(); store.close(); globalThis.fetch = savedFetch;
  for (const name of Object.keys(configuration)) { if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name]; }
});
const change = (key: string, action: string, expectedQuantity: number, idempotencyKey: string) => app.inject({ method: 'POST', url: `/api/v1/billing/addons/${key}`, payload: { action, expectedQuantity, idempotencyKey } });
const addons = async () => (await app.inject('/api/v1/billing/addons')).json();
async function until(check: () => boolean) { for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 10)); assert.ok(check(), 'timed out'); }

test('configured add-on items are never mistaken for the plan, so buying one keeps the plan entitlement eligible', () => {
  const items = [{ price: { id: 'price_plan' }, quantity: 1, current_period_start: start, current_period_end: end }, { price: { id: 'price_min' }, quantity: 2 }];
  assert.equal(planItems(items).length, 1);
  const subscription = { id: 'sub_1', customer: 'cus_1', status: 'active', livemode: false, pause_collection: null, cancel_at: null, items: { has_more: false, data: items } };
  const result = normalizeEntitlement({ livemode: false, mode: 'subscription', subscription: 'sub_1', customer: 'cus_1' }, subscription, { ...plan }, 'test');
  assert.equal(result.state, 'eligible');
});

test('"+" adds one pack to the plan subscription in Stripe, charges the proration now and mirrors the quantity; "−" removes it without credit', async () => {
  const first = await change('minutes', 'increment', 0, 'addon-one'); assert.equal(first.statusCode, 200); assert.equal(first.json().quantity, 1);
  const created = mutations(); assert.equal(created.length, 1);
  assert.deepEqual([created[0].path, created[0].form.subscription, created[0].form.price, created[0].form.quantity, created[0].form.proration_behavior, created[0].form.payment_behavior], ['/subscription_items', 'sub_1', 'price_min', '1', 'always_invoice', 'error_if_incomplete']);
  assert.match(String(created[0].key), /^kloel-addon:[a-f0-9]{48}$/);
  // The same click replayed never buys again; a stale screen cannot buy on top of a change it did not see.
  assert.equal((await change('minutes', 'increment', 0, 'addon-one')).json().quantity, 1);
  const stale = await change('minutes', 'increment', 0, 'addon-two'); assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'addon_quantity_changed');
  assert.equal(mutations().length, 1);
  const view = await addons(), minutes = view.items.find((i: any) => i.key === 'minutes');
  assert.deepEqual([view.configured, minutes.quantity, minutes.unit, minutes.unitAmount, minutes.currency, minutes.purchasable], [true, 1, 100, 9000, 'brl', true]);
  assert.equal(view.items.find((i: any) => i.key === 'outbound').reason, 'price_not_configured');
  assert.equal(store.list('tenant', 'billing-addons')[0].quantities.minutes, 1);
  assert.equal((await change('minutes', 'increment', 1, 'addon-three')).json().quantity, 2);
  assert.deepEqual([mutations()[1].path, mutations()[1].form.quantity, mutations()[1].form.proration_behavior], ['/subscription_items/si_price_min', '2', 'always_invoice']);
  assert.equal((await change('minutes', 'decrement', 2, 'addon-four')).json().quantity, 1);
  assert.deepEqual([mutations()[2].form.quantity, mutations()[2].form.proration_behavior], ['1', 'none']);
  assert.equal((await change('minutes', 'decrement', 1, 'addon-five')).json().quantity, 0);
  assert.deepEqual([mutations()[3].method, mutations()[3].path, mutations()[3].form.proration_behavior], ['DELETE', '/subscription_items/si_price_min', 'none']);
  assert.equal(store.list('tenant', 'billing-addons')[0].quantities.minutes, 0);
  assert.equal((await change('minutes', 'decrement', 0, 'addon-six')).json().error.code, 'addon_not_active');
});

test('missing price configuration or plan subscription is explained in Portuguese and never reaches Stripe writes', async () => {
  const missing = await change('outbound', 'increment', 0, 'addon-outbound');
  assert.equal(missing.statusCode, 503); assert.equal(missing.json().error.code, 'addon_not_configured'); assert.match(missing.json().error.message, /Créditos outbound.*STRIPE_ADDON_PRICE_IDS/);
  sub = undefined;
  const none = await change('minutes', 'increment', 0, 'addon-nosub');
  assert.equal(none.statusCode, 409); assert.equal(none.json().error.code, 'addon_subscription_required'); assert.match(none.json().error.message, /Contrate um plano/);
  assert.equal((await addons()).items.find((i: any) => i.key === 'minutes').reason, 'subscription_required');
  delete process.env.STRIPE_SECRET_KEY;
  const unconfigured = await addons(); assert.equal(unconfigured.configured, false); assert.ok(unconfigured.items.every((i: any) => !i.purchasable && i.quantity === 0));
  assert.equal(mutations().length, 0);
});

test('a declined payment changes nothing; a lost Stripe response is recognised on retry without a second charge', async () => {
  failNext = c => c.method === 'POST' ? Response.json({ error: { type: 'card_error', code: 'card_declined', message: 'declined' } }, { status: 402 }) : undefined;
  const declined = await change('minutes', 'increment', 0, 'addon-card'); assert.equal(declined.statusCode, 402); assert.equal(declined.json().error.code, 'addon_payment_failed');
  assert.equal(store.list('tenant', 'billing-addon-operations')[0].status, 'failed'); assert.equal(sub.items.data.length, 1);
  failNext = c => c.method === 'POST' ? 'lose' : undefined;
  const lost = await change('minutes', 'increment', 0, 'addon-lost'); assert.equal(lost.statusCode, 502); assert.equal(lost.json().error.code, 'billing_unreachable');
  assert.equal(store.list('tenant', 'billing-addon-operations').find(r => r.operationKey === 'manual:owner:addon-lost')!.status, 'unknown');
  failNext = undefined; const posts = mutations().length;
  const retried = await change('minutes', 'increment', 0, 'addon-lost'); assert.equal(retried.statusCode, 200); assert.equal(retried.json().quantity, 1);
  assert.equal(mutations().length, posts); assert.equal(sub.items.data.find((i: any) => i.id === 'si_price_min').quantity, 1);
});

test('auto-buy is persisted by the billing page and executed by the call-end usage path once per period, up to the cap', async () => {
  const put = await app.inject({ method: 'PUT', url: '/api/v1/billing/addons/settings', payload: { autoBuy: true } });
  assert.equal(put.statusCode, 200); assert.equal(put.json().autoBuy, true); assert.equal((await addons()).autoBuy, true);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/billing/addons/settings', payload: { autoBuy: 'yes' } })).statusCode, 400);
  const startedAt = new Date((start + 3600) * 1000).toISOString();
  store.create('tenant', 'conversations', { channel: 'phone', status: 'closed', startedAt, durationSeconds: 998 * 60 });
  const endCall = async (seconds: number) => {
    const conversation = store.create('tenant', 'conversations', { channel: 'phone', status: 'open', startedAt });
    const r = await app.inject({ method: 'POST', url: `/api/v1/internal/phone/calls/${conversation.id}/end`, headers: { 'x-kloel-internal': 'internal-fixture-token' }, payload: { durationSeconds: seconds } });
    assert.equal(r.statusCode, 200);
  };
  calls = [];
  await endCall(60); // 999 of 1000 included minutes: nothing is bought
  await until(() => calls.some(c => c.path === '/prices/price_plan'));
  await new Promise(r => setTimeout(r, 30)); assert.equal(mutations().length, 0);
  await endCall(61); // 1001 minutes: one pack of 100 is bought
  await until(() => store.list('tenant', 'billing-addon-operations').some(r => r.status === 'succeeded'));
  assert.equal(mutations().length, 1); assert.deepEqual([mutations()[0].form.price, mutations()[0].form.quantity, mutations()[0].form.proration_behavior], ['price_min', '1', 'always_invoice']);
  assert.equal(store.list('tenant', 'billing-addons')[0].quantities.minutes, 1);
  // Below the new quota (1100) nothing happens; above it the default cap (1 per period) holds.
  assert.equal((await autoBuyAddon(store, 'tenant', 'minutes')).status, 'below_quota');
  store.create('tenant', 'conversations', { channel: 'phone', status: 'closed', startedAt, durationSeconds: 200 * 60 });
  assert.equal((await autoBuyAddon(store, 'tenant', 'minutes')).status, 'cap_reached');
  process.env.BILLING_AUTO_ADDON_MAX_PER_PERIOD = '2';
  const both = await Promise.all([autoBuyAddon(store, 'tenant', 'minutes'), autoBuyAddon(store, 'tenant', 'minutes')]);
  assert.deepEqual(both.map(r => r.status).sort(), ['in_progress', 'purchased']);
  assert.equal(mutations().length, 2); assert.equal(mutations()[1].form.quantity, '2');
  const keys = store.list('tenant', 'billing-addon-operations').filter(r => r.source === 'auto').map(r => r.operationKey);
  assert.deepEqual(keys, [`auto:minutes:sub_1:${start * 1000}:0`, `auto:minutes:sub_1:${start * 1000}:1`]);
});

test('ablation: with auto-buy off (or a non-voice plan) exhausted minutes never buy anything nor call Stripe', async () => {
  const startedAt = new Date((start + 3600) * 1000).toISOString();
  store.create('tenant', 'conversations', { channel: 'phone', status: 'closed', startedAt, durationSeconds: 5000 * 60 });
  assert.equal((await autoBuyAddon(store, 'tenant', 'minutes')).status, 'disabled'); assert.equal(calls.length, 0);
  setAutoBuy(store, 'tenant', true, 'owner'); plan.metadata.kloel_product = plan.product.metadata.kloel_product = 'whatsapp';
  try { assert.equal((await autoBuyAddon(store, 'tenant', 'minutes')).status, 'plan_mismatch'); }
  finally { plan.metadata.kloel_product = plan.product.metadata.kloel_product = 'voice'; }
  assert.equal(mutations().length, 0);
});

test('core purchase works with an injected fetch (no global network) and refuses a reused key with other data', async () => {
  globalThis.fetch = (async () => { throw Error('global fetch must not be used') }) as typeof fetch;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => stripe(String(url), init)) as typeof fetch;
  const result = await changeAddon(store, 'tenant', { addon: 'waConversations', action: 'increment', operationKey: 'core-one', source: 'manual', expectedQuantity: 0 }, { stripe: stripeClient(fetchImpl) });
  assert.equal(result.quantity, 1); assert.equal(store.list('tenant', 'billing-addons')[0].quantities.waConversations, 1);
  await assert.rejects(changeAddon(store, 'tenant', { addon: 'minutes', action: 'increment', operationKey: 'core-one', source: 'manual', expectedQuantity: 0 }, { stripe: stripeClient(fetchImpl) }), /Chave já utilizada/);
});
