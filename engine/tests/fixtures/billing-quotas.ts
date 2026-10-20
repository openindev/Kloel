import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import type { TestContext } from 'node:test';
import { sheetsActionsFixture } from './sheets-actions.js';
import { getEnforcement, getPlanPolicy, provisionPlanPolicy, setTenantEnforcement } from '../../src/billing/plans.js';

export async function billingQuotaFixture(t: TestContext) {
  const f = await sheetsActionsFixture(t), tenant = f.actor.tenantId;
  const names = ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_IDS', 'STRIPE_WEBHOOK_SECRET'], old = Object.fromEntries(names.map(n => [n, process.env[n]]));
  process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic'; process.env.STRIPE_PRICE_IDS = 'price_Quota'; process.env.STRIPE_WEBHOOK_SECRET = 'synthetic-webhook';
  t.after(() => { for (const n of names) { if (old[n] === undefined) delete process.env[n]; else process.env[n] = old[n]; } });
  const now = Math.floor(Date.now() / 1000);
  const checkout = { id: 'cs_quota', mode: 'subscription', livemode: false, status: 'complete', payment_status: 'paid', metadata: { tenantId: tenant }, client_reference_id: tenant, customer: 'cus_Quota', subscription: 'sub_Quota', line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_Quota' } }] } };
  const subscription = { id: 'sub_Quota', customer: 'cus_Quota', livemode: false, metadata: { tenantId: tenant }, status: 'active', pause_collection: null, cancel_at: null, items: { has_more: false, data: [{ id: 'si_Quota', quantity: 1, price: { id: 'price_Quota' }, current_period_start: now - 60, current_period_end: now + 86400 * 7 }] } };
  const price = { id: 'price_Quota', livemode: false, type: 'recurring', recurring: { usage_type: 'licensed' }, active: true };
  const requests: string[] = [], hooks: { stripe?: (path: string) => Response | undefined | Promise<Response | undefined> } = {};
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init = {}) => {
    if (!String(url).startsWith('https://api.stripe.com/v1/')) return previousFetch(url, init);
    assert.equal(init.method ?? 'GET', 'GET');
    const path = new URL(String(url)).pathname; requests.push(path);
    const handled = await hooks.stripe?.(path); if (handled) return handled;
    if (path === '/v1/checkout/sessions/cs_quota') return Response.json(checkout);
    if (path === '/v1/subscriptions/sub_Quota') return Response.json(subscription);
    if (path === '/v1/prices/price_Quota') return Response.json(price);
    throw new Error('unexpected_synthetic_stripe_get');
  }) as typeof fetch;
  f.store.create(tenant, 'billing-checkouts', { sessionId: checkout.id, priceId: price.id, status: 'open' });
  const reconcile = () => f.request('POST', '/api/v1/billing/reconcile', { checkoutSessionId: checkout.id });
  const policy = (limit: number, enabled = true, stripeMode: 'test' | 'live' = 'test', planId = 'synthetic') => provisionPlanPolicy(f.store, { operationKey: randomUUID(), expectedRevision: getPlanPolicy(f.store, stripeMode, price.id)?.revision ?? 0, priceId: price.id, stripeMode, planId, enabled, assistantChatRoundsPerDay: limit });
  const enforce = (enabled: boolean, stripeMode: 'test' | 'live' = 'test') => setTenantEnforcement(f.store, { operationKey: randomUUID(), expectedRevision: getEnforcement(f.store, tenant)?.revision ?? 0, tenantId: tenant, stripeMode, enabled });
  const configure = async (limit: number) => { policy(limit); enforce(true); const r = await reconcile(); assert.equal(r.statusCode, 200, r.body); return r; };
  const event = async (type: string, data: unknown, id = `evt_${randomUUID()}`, created = now) => {
    const payload = JSON.stringify({ id, type, created, data: { object: data } }), ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'synthetic-webhook').update(`${ts}.${payload}`).digest('hex');
    return f.app.inject({ method: 'POST', url: '/api/v1/webhooks/stripe', payload, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` } });
  };
  const read = () => f.request('GET', '/api/v1/billing/entitlements');
  const slots = () => f.store.db.prepare('SELECT body FROM billing_chat_rounds ORDER BY rowid').all().map(row => JSON.parse(String(row.body)));
  const ask = (key = randomUUID(), conversationId?: string) => f.request('POST', '/api/v1/ai/chat', { agentId: f.agent.id, message: 'Synthetic private message', idempotencyKey: key, ...(conversationId ? { conversationId } : {}) });
  return { ...f, tenant, checkout, subscription, price, stripeRequests: requests, stripeHooks: hooks, configure, policy, enforce, reconcile, event, read, slots, ask };
}
