import { seedIndexedKnowledge } from './fixtures/knowledge.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import Fastify, { type FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { Store } from '../src/store.js';
import { registerProviders } from '../src/providers.js';
import { verifyStripeSignature, verifyMetaSignature, verifyOpenAISignature } from '../src/providers/security.js';
import { executeAgentTool } from '../src/providers/agent-tools.js';
import { seedMemberships, seedMember } from './fixtures/membership.js';
import { selectOrganizationForSession } from '../src/memberships/service.js';

const config: Record<string, string> = {
  PROVIDER_TENANT_ID: 'tenant-a', OPENAI_API_KEY: 'test-openai-secret', OPENAI_MODEL: 'test-text-model', OPENAI_REALTIME_MODEL: 'test-realtime-model',
  STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_stripe_fixture', STRIPE_PRICE_IDS: 'price_fixture', APP_ORIGIN: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_fixture', RESEND_FROM: 'Kloel <noreply@example.test>', META_ACCESS_TOKEN: 'meta_fixture', META_PHONE_NUMBER_ID: '12345', META_GRAPH_VERSION: 'v25.0', META_APP_SECRET: 'meta_signing_fixture', META_VERIFY_TOKEN: 'meta_verify_fixture',
  TWILIO_ACCOUNT_SID: 'AC_fixture', TWILIO_AUTH_TOKEN: 'twilio_fixture', TWILIO_FROM_NUMBER: '+551155555555', TWILIO_VOICE_WEBHOOK_URL: 'https://example.test/api/v1/webhooks/twilio/voice', OPENAI_SIP_URI: 'sip:proj_fixture@sip.api.openai.com;transport=tls',
  OPENAI_WEBHOOK_SECRET: `whsec_${Buffer.from('openai-signing-secret-fixture').toString('base64')}`,
};
let app: FastifyInstance; let store: Store;
let calls: { url: string; init: RequestInit }[];
let respond: (url: string, init: RequestInit) => Promise<Response>;
let sockets: FakeSocket[];
class FakeSocket extends EventEmitter {
  readyState = 0; sent: Record<string, any>[] = [];
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };

beforeEach(async () => {
  Object.assign(process.env, config);
  calls = []; sockets = [];
  respond = async () => Response.json({ id: 'provider_fixture' });
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init }); return respond(String(url), init);
  }) as typeof fetch;
  app = Fastify(); store = new Store();
  store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run('test-user', 'tenant-a', 'owner@example.test', 'unused', 'owner');
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(createHash('sha256').update('test-cookie').digest('hex'), 'test-user', Date.now() + 3600000);
  seedMemberships(store);
  seedMember(store, { userId: 'test-user', tenantId: 'tenant-b', role: 'owner' });
  app.addHook('onRequest', async request => {
    request.cookies = { kloel_session: 'test-cookie' };
    request.actor = { userId: 'test-user', tenantId: String(request.headers['x-test-tenant'] ?? 'tenant-a'), role: request.headers['x-test-member'] ? 'member' : 'owner' };
  });
  await registerProviders(app, store, { socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; } }); await app.ready();
});
afterEach(async () => {
  await app.close(); store.close(); globalThis.fetch = originalFetch;
  for (const name of [...Object.keys(config), 'OPENAI_INBOUND_AGENT_ID']) {
    if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name];
  }
});
function agent() { return store.create('tenant-a', 'agents', { name: 'Assistente', status: 'active', prompt: 'Ajude a agendar.', voice: 'marin', tools: ['web_search'] }); }
function stripeHeader(raw: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', config.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex')}`;
}
function stripeEvent(type: string, data: object, eventId = 'evt_fixture', created = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify({ id: eventId, type, created, data: { object: data } });
  return { raw, signature: stripeHeader(raw) };
}
function sendStripe(event: ReturnType<typeof stripeEvent>) {
  return app.inject({ method: 'POST', url: '/api/v1/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': event.signature }, payload: event.raw });
}

test('configuration health is read-only, secret-free, tenant scoped and not a live verification claim', async () => {
  const response = await app.inject('/api/v1/providers/status');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().providers.openai.configured, true);
  assert.equal(response.json().providers.openai.verifiedLive, false);
  for (const secret of [config.OPENAI_API_KEY, config.RESEND_API_KEY, config.META_ACCESS_TOKEN]) assert.ok(!response.body.includes(secret));
  const other = await app.inject({ url: '/api/v1/providers/status', headers: { 'x-test-tenant': 'tenant-b' } });
  assert.equal(other.json().providers.openai.configured, false);
  assert.equal(calls.length, 0);
});

test('outbound side effects reject members, other tenants and missing configuration without fetch', async () => {
  const payload = { to: 'a@example.test', subject: 'Teste', text: 'Olá', idempotencyKey: 'email-test-1' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/email/send', headers: { 'x-test-member': '1' }, payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/email/send', headers: { 'x-test-tenant': 'tenant-b' }, payload })).statusCode, 403);
  delete process.env.RESEND_API_KEY;
  const missing = await app.inject({ method: 'POST', url: '/api/v1/email/send', payload });
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.json().error.code, 'integration_not_configured');
  assert.equal(calls.length, 0);
});

test('chat calls Responses, includes stored knowledge/history, persists results and deduplicates retries', async () => {
  const a = agent();
  store.update('tenant-a', 'agents', a.id, { tools: ['web_search', 'search_knowledge'] });
  await seedIndexedKnowledge(store, 'tenant-a', a.id, 'Atendemos das 9 às 18.');
  store.create('tenant-a', 'knowledge', { agentId: a.id, content: 'UNINDEXED-SOURCE', indexed: false });
  const conversation = store.create('tenant-a', 'conversations', { channel: 'webchat', agentId: a.id });
  store.create('tenant-a', 'messages', { conversationId: conversation.id, role: 'user', content: 'Bom dia' });
  respond = async (_url, init) => {
    const body = JSON.parse(String(init.body)); assert.equal(body.store, false);
    assert.ok(!body.instructions.includes('Atendemos das 9 às 18.')); assert.ok(!JSON.stringify(body).includes('UNINDEXED-SOURCE'));
    assert.equal(body.input[0].role, 'user'); assert.ok(body.input[0].content.includes('Atendemos das 9 às 18.'));
    assert.deepEqual(body.input.slice(1).map((v: any) => v.content), ['Bom dia', 'Qual o horário?']);
    return Response.json({ id: 'resp_fixture', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Das 9 às 18.' }] }], usage: { total_tokens: 42 } });
  };
  const payload = { agentId: a.id, conversationId: conversation.id, message: 'Qual o horário?', idempotencyKey: 'chat-test-1' };
  const response = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', payload });
  assert.equal(response.statusCode, 200); assert.equal(response.json().text, 'Das 9 às 18.');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(store.list('tenant-a', 'messages').length, 3);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/chat', payload })).statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/chat', payload: { ...payload, message: 'Outra' } })).statusCode, 409);
});

test('cross-tenant conversation identifiers cannot influence chat or leak history', async () => {
  const a = agent(); const other = store.create('tenant-b', 'conversations', { channel: 'webchat' });
  const response = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', payload: { agentId: a.id, conversationId: other.id, message: 'test', idempotencyKey: 'chat-test-1' } });
  assert.equal(response.statusCode, 404); assert.equal(calls.length, 0);
});

test('realtime returns only ephemeral token and does not persist it', async () => {
  const a = agent();
  respond = async (_url, init) => {
    const body = JSON.parse(String(init.body)); assert.equal(body.expires_after.seconds, 60); assert.equal(body.session.type, 'realtime');
    return Response.json({ value: 'ek_fixture', expires_at: 999, unexpected: config.OPENAI_API_KEY });
  };
  const result = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/token', payload: { agentId: a.id } });
  assert.equal(result.statusCode, 200); assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.json().value, 'ek_fixture'); assert.ok(!result.body.includes(config.OPENAI_API_KEY));
  assert.equal(store.list('tenant-a', 'provider-operations').length, 0);
});

test('Stripe checkout permits configured prices only and uses server-owned redirect/customer identity', async () => {
  const payload = { priceId: 'price_fixture', idempotencyKey: 'checkout-1' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', payload: { ...payload, priceId: 'price_other' } })).statusCode, 400);
  respond = async (_url, init) => {
    const form = new URLSearchParams(String(init.body));
    assert.equal(form.get('metadata[tenantId]'), 'tenant-a'); assert.equal(form.get('subscription_data[metadata][tenantId]'), 'tenant-a');
    assert.ok(form.get('success_url')?.startsWith('http://localhost:3000/billing'));
    return Response.json({ id: 'cs_fixture', url: 'https://checkout.stripe.com/fixture', payment_status: 'unpaid', status: 'open', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  };
  const result = await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', payload });
  assert.equal(result.statusCode, 200); assert.equal(result.json().sessionId, 'cs_fixture');
  assert.equal(store.list('tenant-a', 'subscriptions').length, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', payload: { ...payload, idempotencyKey: 'checkout-new-key' } })).json().sessionId, 'cs_fixture');
  assert.equal(calls.length, 1);
  process.env.STRIPE_PRICE_IDS = 'price_fixture,price_other';
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', payload: { priceId: 'price_other', idempotencyKey: 'checkout-other-price' } })).statusCode, 409);
  assert.equal(calls.length, 1);
  store.create('tenant-a', 'subscriptions', { status: 'active', providerSubscriptionId: 'sub_fixture' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', payload: { ...payload, idempotencyKey: 'checkout-active' } })).json().error.code, 'subscription_exists');
});

test('Stripe malformed success responses are unknown outcomes and cannot create another checkout', async () => {
  respond = async () => Response.json({});
  const request = { method: 'POST' as const, url: '/api/v1/billing/checkout', payload: { priceId: 'price_fixture', idempotencyKey: 'checkout-invalid' } };
  assert.equal((await app.inject(request)).json().error.code, 'provider_invalid_response');
  assert.equal(store.list('tenant-a', 'provider-operations')[0].status, 'unknown');
  assert.equal((await app.inject({ ...request, payload: { ...request.payload, idempotencyKey: 'checkout-invalid-2' } })).statusCode, 409);
  assert.equal(calls.length, 1);
  store.create('tenant-a', 'billing-accounts', { customerId: 'cus_fixture' });
  respond = async () => Response.json({ id: 'bps_fixture', url: 'https://billing.stripe.com.evil.test/steal' });
  const portal = await app.inject({ method: 'POST', url: '/api/v1/billing/portal', payload: { idempotencyKey: 'portal-invalid' } });
  assert.equal(portal.json().error.code, 'provider_invalid_response');
});

test('Stripe signatures reject tampering/stale payloads; duplicate events are applied once', async () => {
  const event = stripeEvent('checkout.session.completed', { customer: 'cus_fixture', payment_status: 'paid', metadata: { tenantId: 'tenant-a' } });
  assert.equal((await sendStripe({ ...event, raw: event.raw.replace('paid', 'unpaid') })).statusCode, 401);
  assert.equal((await sendStripe({ ...event, signature: stripeHeader(event.raw, Math.floor(Date.now() / 1000) - 301) })).statusCode, 401);
  assert.equal((await sendStripe(event)).statusCode, 200);
  assert.equal((await sendStripe(event)).json().duplicate, true);
  assert.equal(store.list('tenant-a', 'billing-accounts').length, 1);
  assert.equal(store.list('tenant-a', 'provider-events').length, 1);
  assert.equal(calls.length, 0);
});

test('subscription updates are ordered and unbound Stripe customers never change local billing', async () => {
  const newest = stripeEvent('customer.subscription.updated', { id: 'sub_fixture', status: 'canceled', metadata: { tenantId: 'tenant-a' } }, 'evt_new', 200);
  const old = stripeEvent('customer.subscription.updated', { id: 'sub_fixture', status: 'active', metadata: { tenantId: 'tenant-a' } }, 'evt_old', 100);
  await sendStripe(newest); await sendStripe(old);
  assert.equal(store.list('tenant-a', 'subscriptions')[0].status, 'canceled');
  const unbound = stripeEvent('checkout.session.completed', { customer: 'cus_other', metadata: { tenantId: 'tenant-b' } }, 'evt_other');
  assert.equal((await sendStripe(unbound)).json().ignored, true);
  assert.equal(store.list('tenant-a', 'billing-accounts').length, 0);
});

function billingCheckout() {
  store.create('tenant-a', 'billing-checkouts', { sessionId: 'cs_registered', priceId: 'price_fixture', status: 'open' });
  return { id: 'cs_registered', mode: 'subscription', status: 'complete', payment_status: 'paid', metadata: { tenantId: 'tenant-a' }, client_reference_id: 'tenant-a', customer: 'cus_fixture', subscription: 'sub_fixture', line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_fixture' } }] } };
}
function billingSubscription() { return { id: 'sub_fixture', customer: 'cus_fixture', metadata: { tenantId: 'tenant-a' }, status: 'active', cancel_at_period_end: false, cancel_at: 1794988169, canceled_at: 1792310080, ended_at: null, items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_fixture' }, current_period_end: 1794988169 }] } }; }
const reconcileBilling = (checkoutSessionId = 'cs_registered') => app.inject({ method: 'POST', url: '/api/v1/billing/reconcile', payload: { checkoutSessionId } });

test('billing reconciliation repairs a missed checkout webhook with verified API state and preserves scheduled cancellation timestamps', async () => {
  const checkout = billingCheckout(); const subscription = billingSubscription();
  respond = async (url, init) => { assert.equal(init.method, undefined); return Response.json(url.includes('/checkout/sessions/') ? checkout : subscription); };
  const response = await reconcileBilling(); assert.equal(response.statusCode, 200, response.body);
  const data = response.json(); assert.equal(data.source, 'stripe_api'); assert.equal(data.account.customerId, 'cus_fixture'); assert.equal(data.subscription.cancelAtPeriodEnd, false); assert.equal(data.subscription.cancelAt, 1794988169); assert.equal(data.subscription.canceledAt, 1792310080); assert.equal(data.subscription.endedAt, null); assert.equal(data.subscription.scheduledCancellation, true);
  assert.equal(store.list('tenant-a', 'provider-events').length, 0); assert.equal(store.list('tenant-a', 'billing-reconciliations').length, 1);
  respond = async () => Response.json({ id: 'bps_fixture', url: 'https://billing.stripe.com/p/session/fixture' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/billing/portal', payload: { idempotencyKey: 'portal-after-reconcile' } })).statusCode, 200);
  const stale = stripeEvent('customer.subscription.updated', { ...subscription, status: 'canceled', cancel_at: null }, 'evt_stale_after_snapshot', Math.floor(Date.now() / 1000) - 10);
  await sendStripe(stale); assert.equal(store.list('tenant-a', 'subscriptions')[0].status, 'active');
});

test('billing reconciliation never queries unregistered checkout and rejects foreign metadata, customer or prices without writes', async () => {
  assert.equal((await reconcileBilling('cs_unknown')).statusCode, 404); assert.equal(calls.length, 0);
  const checkout = billingCheckout(); const subscription = billingSubscription();
  for (const mutation of [
    { checkout: { ...checkout, metadata: { tenantId: 'tenant-b' } }, subscription },
    { checkout: { ...checkout, client_reference_id: 'tenant-b' }, subscription },
    { checkout: { ...checkout, line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_other' } }] } }, subscription },
    { checkout, subscription: { ...subscription, customer: 'cus_foreign' } },
    { checkout, subscription: { ...subscription, items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_other' } }] } } },
  ]) {
    respond = async url => Response.json(url.includes('/checkout/sessions/') ? mutation.checkout : mutation.subscription);
    assert.equal((await reconcileBilling()).json().error.code, 'billing_binding_invalid');
    assert.equal(store.list('tenant-a', 'billing-accounts').length, 0); assert.equal(store.list('tenant-a', 'subscriptions').length, 0); assert.equal(store.list('tenant-a', 'billing-reconciliations').length, 0);
  }
});

test('billing reconciliation refuses concurrent webhook updates and membership revocation', async () => {
  const checkout = billingCheckout(); const subscription = billingSubscription();
  respond = async url => { if (url.includes('/subscriptions/')) store.create('tenant-a', 'subscriptions', { providerSubscriptionId: 'sub_fixture', status: 'canceled', lastEventAt: Math.floor(Date.now() / 1000) }); return Response.json(url.includes('/checkout/sessions/') ? checkout : subscription); };
  assert.equal((await reconcileBilling()).json().error.code, 'billing_changed_retry'); assert.equal(store.list('tenant-a', 'subscriptions')[0].status, 'canceled'); assert.equal(store.list('tenant-a', 'billing-accounts').length, 0);
  respond = async url => { if (url.includes('/subscriptions/')) store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run('test-user', 'tenant-a'); return Response.json(url.includes('/checkout/sessions/') ? checkout : subscription); };
  assert.equal((await reconcileBilling()).statusCode, 403); assert.equal(store.list('tenant-a', 'billing-accounts').length, 0);
});

test('Stripe webhook records cancel_at even when cancel_at_period_end is false', async () => {
  await sendStripe(stripeEvent('customer.subscription.updated', billingSubscription(), 'evt_scheduled'));
  const response = await app.inject('/api/v1/billing/status'); const subscription = response.json().subscriptions[0];
  assert.equal(subscription.cancelAtPeriodEnd, false); assert.equal(subscription.cancelAt, 1794988169); assert.equal(subscription.canceledAt, 1792310080); assert.equal(subscription.scheduledCancellation, true);
});

test('Resend sends once, persists provider identity, and never silently retries ambiguous transport failure', async () => {
  const payload = { to: 'a@example.test', subject: 'Teste', text: 'Olá', idempotencyKey: 'email-test-1' };
  let result = await app.inject({ method: 'POST', url: '/api/v1/email/send', payload });
  assert.equal(result.statusCode, 200); assert.equal(result.json().status, 'accepted');
  result = await app.inject({ method: 'POST', url: '/api/v1/email/send', payload });
  assert.equal(result.statusCode, 200); assert.equal(calls.length, 1);
  assert.equal(store.list('tenant-a', 'messages')[0].providerMessageId, 'provider_fixture');
  respond = async () => { throw new Error('network test'); };
  const ambiguous = { ...payload, idempotencyKey: 'email-test-2' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/email/send', payload: ambiguous })).statusCode, 502);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/email/send', payload: ambiguous })).statusCode, 409);
  assert.equal(calls.length, 2);
  assert.equal(store.list('tenant-a', 'provider-operations')[1].status, 'unknown');
});

test('provider errors are truthful and do not reflect secrets from upstream bodies', async () => {
  respond = async () => Response.json({ error: `bad ${config.RESEND_API_KEY}` }, { status: 401 });
  const response = await app.inject({ method: 'POST', url: '/api/v1/email/send', payload: { to: 'a@example.test', subject: 'Teste', text: 'Olá', idempotencyKey: 'email-test-1' } });
  assert.equal(response.statusCode, 502); assert.equal(response.json().error.code, 'provider_rejected');
  assert.ok(!response.body.includes(config.RESEND_API_KEY)); assert.equal(store.list('tenant-a', 'messages').length, 0);
});

test('WhatsApp sends via Graph and ingests signed inbound messages idempotently for the configured number', async () => {
  respond = async (_url, init) => { assert.equal(JSON.parse(String(init.body)).to, '5511999999999'); return Response.json({ messages: [{ id: 'wamid.outgoing' }] }); };
  const send = await app.inject({ method: 'POST', url: '/api/v1/whatsapp/send', payload: { to: '+5511999999999', text: 'Olá', idempotencyKey: 'whatsapp-1' } });
  assert.equal(send.statusCode, 200);
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: config.META_PHONE_NUMBER_ID }, messages: [{ id: 'wamid.incoming', from: '5511999999999', type: 'text', text: { body: 'Bom dia' } }] } }] }] });
  const signature = `sha256=${createHmac('sha256', config.META_APP_SECRET).update(raw).digest('hex')}`;
  const args = { method: 'POST' as const, url: '/api/v1/webhooks/meta', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature } };
  assert.equal((await app.inject({ ...args, payload: raw + ' ' })).statusCode, 401);
  assert.equal((await app.inject(args)).json().messages, 1);
  assert.equal((await app.inject(args)).json().messages, 0);
  assert.equal(store.list('tenant-a', 'messages').filter(m => m.providerMessageId === 'wamid.incoming').length, 1);
  assert.equal(calls.length, 1);
});

test('Meta verification challenges require the configured token', async () => {
  const challenge = '/api/v1/webhooks/meta?hub.mode=subscribe&hub.challenge=123&hub.verify_token=';
  assert.equal((await app.inject(challenge + 'wrong')).statusCode, 401);
  const result = await app.inject(challenge + config.META_VERIFY_TOKEN);
  assert.equal(result.statusCode, 200); assert.equal(result.body, '123');
});

test('Twilio exact URL signature rejects altered body and returns only configured OpenAI SIP target', async () => {
  const params = { AccountSid: config.TWILIO_ACCOUNT_SID, CallSid: 'CA_fixture', From: '+5511999999999', To: config.TWILIO_FROM_NUMBER };
  const signature = twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN, config.TWILIO_VOICE_WEBHOOK_URL, params);
  const args = { method: 'POST' as const, url: '/api/v1/webhooks/twilio/voice', payload: new URLSearchParams(params).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature } };
  assert.equal((await app.inject({ ...args, payload: args.payload.replace('CA_fixture', 'CA_tampered') })).statusCode, 401);
  const result = await app.inject(args);
  assert.equal(result.statusCode, 200); assert.ok(result.body.includes('<Sip>sip:proj_fixture@sip.api.openai.com;transport=tls</Sip>'));
  await app.inject(args); assert.equal(store.list('tenant-a', 'calls').length, 1); assert.equal(calls.length, 0);
});

test('signed OpenAI inbound calls accept configured agent once and reject replay outside timestamp window', async () => {
  const a = agent(); process.env.OPENAI_INBOUND_AGENT_ID = a.id;
  respond = async () => new Response(null, { status: 200 });
  const raw = JSON.stringify({ type: 'realtime.call.incoming', data: { call_id: 'call_fixture' } });
  const timestamp = String(Math.floor(Date.now() / 1000)); const eventId = 'wh_fixture';
  const signature = createHmac('sha256', Buffer.from(config.OPENAI_WEBHOOK_SECRET.slice(6), 'base64')).update(`${eventId}.${timestamp}.${raw}`).digest('base64');
  const args = { method: 'POST' as const, url: '/api/v1/webhooks/openai', payload: raw, headers: { 'content-type': 'application/json', 'webhook-id': eventId, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } };
  assert.equal((await app.inject({ ...args, headers: { ...args.headers, 'webhook-timestamp': '1' } })).statusCode, 401);
  assert.equal((await app.inject(args)).json().accepted, true);
  assert.equal((await app.inject(args)).json().accepted, true);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.openai.com/v1/realtime/calls/call_fixture/accept');
});

test('signature functions enforce exact bytes and malformed signatures fail closed', () => {
  const raw = Buffer.from('{"x":1}');
  assert.equal(verifyStripeSignature(raw, 't=NaN,v1=anything', 's'), false);
  assert.equal(verifyMetaSignature(raw, 'sha256=', 's'), false);
  assert.equal(verifyOpenAISignature(raw, '', '123', '', 'whsec_c2VjcmV0'), false);
});

test('Responses tool loop books a real local appointment and returns its confirmed result to the model', async () => {
  const a = agent(); store.update('tenant-a', 'agents', a.id, { tools: ['schedule_appointment'] });
  const calendar = store.create('tenant-a', 'calendars', { name: 'Agenda local', provider: 'local', enabled: true, agentId: a.id, timezone: 'America/Sao_Paulo', appointmentDurationMinutes: 30 });
  const args = { calendarId: calendar.id, title: 'Demonstração', startAt: '2029-01-15T10:00:00-03:00', endAt: '2029-01-15T10:30:00-03:00', timezone: 'America/Sao_Paulo', confirmedByUser: true };
  respond = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    if (calls.length === 1) {
      assert.ok(body.tools.some((t: any) => t.name === 'create_appointment'));
      return Response.json({ id: 'resp_tool', output: [{ type: 'function_call', call_id: 'tool_booking', name: 'create_appointment', arguments: JSON.stringify(args) }] });
    }
    const output = body.input.find((item: any) => item.type === 'function_call_output');
    assert.equal(JSON.parse(output.output).ok, true);
    assert.equal(JSON.parse(output.output).externalSync, false);
    return Response.json({ id: 'resp_final', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Agendado na agenda local.' }] }] });
  };
  const result = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', payload: { agentId: a.id, message: 'Confirmo a demonstração dia 15/01/2029 às 10h por 30 minutos.', idempotencyKey: 'booking-1' } });
  assert.equal(result.statusCode, 200); assert.equal(calls.length, 2);
  assert.equal(store.list('tenant-a', 'appointments').length, 1);
  assert.equal(store.list('tenant-a', 'appointments')[0].syncStatus, 'local_only');
});

test('tool calls enforce confirmation, tenant, agent permission, conflicts and durable duplicate protection', async () => {
  const a = agent(); a.tools = ['schedule_appointment', 'lookup_contact'];
  store.update('tenant-a', 'agents', a.id, { tools: a.tools });
  const conversation = store.create('tenant-a', 'conversations', { channel: 'webchat' });
  const context = { tenantId: 'tenant-a', agent: a, conversationId: conversation.id, trustedOperator: true, actor: { userId: 'test-user', tenantId: 'tenant-a', role: 'owner' as const }, operatorSessionHash: createHash('sha256').update('test-cookie').digest('hex') };
  const calendar = store.create('tenant-a', 'calendars', { name: 'Agenda local', provider: 'local', enabled: true, timezone: 'America/Sao_Paulo', appointmentDurationMinutes: 30 });
  const args = { calendarId: calendar.id, title: 'Demonstração', startAt: '2029-01-15T10:00:00-03:00', endAt: '2029-01-15T10:30:00-03:00', timezone: 'America/Sao_Paulo', confirmedByUser: true };
  const call = { id: 'call_1', name: 'create_appointment', arguments: JSON.stringify(args) };
  assert.equal((await executeAgentTool(store, context, { ...call, id: 'no_confirmation', arguments: JSON.stringify({ ...args, confirmedByUser: false }) })).ok, false);
  const first = await executeAgentTool(store, context, call); assert.equal(first.ok, true);
  assert.deepEqual(await executeAgentTool(store, context, call), first); assert.equal(store.list('tenant-a', 'appointments').length, 1);
  assert.equal((await executeAgentTool(store, context, { ...call, id: 'collision' })).error, 'appointment_overlap');
  assert.equal((await executeAgentTool(store, context, { ...call, id: 'bad', arguments: JSON.stringify({ ...args, calendarId: 'tenant_b_calendar' }) })).error, 'calendar_not_available');
  assert.equal((await executeAgentTool(store, { ...context, trustedOperator: false }, { id: 'crm', name: 'lookup_contact', arguments: '{"emailOrPhone":"a@example.test"}' })).error, 'tool_not_enabled');
});

test('WebRTC SDP proxy binds provider call, controls sideband and persists deduplicated transcript/usage', async () => {
  const a = agent(); store.update('tenant-a', 'agents', a.id, { tools: ['schedule_appointment'], initialMessage: 'Olá!' });
  respond = async (url, init) => {
    if (url.endsWith('/realtime/calls')) {
      assert.ok(init.body instanceof FormData);
      assert.equal((init.body as FormData).get('sdp'), 'v=0\r\na=offer');
      return new Response('v=0\r\na=answer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_fixture' } });
    }
    return new Response(null, { status: 200 });
  };
  const response = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', payload: { agentId: a.id, sdp: 'v=0\r\na=offer' } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().callId, 'rtc_fixture');
  assert.ok(sockets[0].sent.some(e => e.type === 'session.update'));
  assert.ok(sockets[0].sent.find(e => e.type === 'session.update')!.session.tools.every((t: any) => !('strict' in t)));
  assert.ok(sockets[0].sent.some(e => e.type === 'response.create'));
  const event = { type: 'response.output_audio_transcript.done', item_id: 'item_1', transcript: 'Olá, sou da Kloel.' };
  sockets[0].emit('message', Buffer.from(JSON.stringify(event))); sockets[0].emit('message', Buffer.from(JSON.stringify(event)));
  sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'response.done', response: { id: 'resp_audio', usage: { total_tokens: 100 } } })));
  const tool = { type: 'response.function_call_arguments.done', call_id: 'tool_calendars', name: 'list_calendars', arguments: '{}' };
  sockets[0].emit('message', Buffer.from(JSON.stringify(tool))); sockets[0].emit('message', Buffer.from(JSON.stringify(tool)));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.list('tenant-a', 'messages').length, 1);
  assert.equal(store.list('tenant-a', 'provider-usage').length, 1);
  assert.equal(sockets[0].sent.filter(e => e.type === 'conversation.item.create').length, 1);
  sockets[0].close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.list('tenant-a', 'voice-sessions')[0].controlStatus, 'closed');
  assert.equal(store.list('tenant-a', 'voice-sessions')[0].callStatus, 'hangup_accepted');
  assert.equal(store.list('tenant-a', 'voice-sessions')[0].securityStop, 'realtime_control_disconnected');
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/sessions/rtc_unknown/hangup', payload: {} })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/sessions/rtc_fixture/hangup', payload: {} })).statusCode, 200);
  assert.ok(calls.some(c => c.url.endsWith('/rtc_fixture/hangup')));
  const callsAfterHangup = calls.length;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/sessions/rtc_fixture/hangup', payload: {} })).statusCode, 200);
  assert.equal(calls.length, callsAfterHangup);
});

test('Realtime revocation stops queued tools and requests real hangup without leaking session hashes', async () => {
  const a = agent(); store.update('tenant-a', 'agents', a.id, { tools: ['lookup_contact'] });
  respond = async url => url.endsWith('/realtime/calls')
    ? new Response('v=0\r\na=answer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_revoke' } })
    : new Response(null, { status: 200 });
  const response = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', payload: { agentId: a.id, sdp: 'v=0\r\na=offer' } });
  assert.equal(response.statusCode, 200);
  store.db.prepare('DELETE FROM sessions WHERE user_id=?').run('test-user');
  sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'revoke-tool', name: 'lookup_contact', arguments: '{"emailOrPhone":"owner@example.test"}' })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.list('tenant-a', 'agent-tool-calls').length, 0);
  assert.equal(sockets[0].sent.filter(e => e.type === 'conversation.item.create').length, 0);
  assert.ok(calls.some(c => c.url.endsWith('/rtc_revoke/hangup')));
  const record = store.list('tenant-a', 'voice-sessions')[0];
  assert.equal(record.callStatus, 'hangup_accepted'); assert.equal(record.securityStop, 'operator_session_revoked');
  assert.ok(!JSON.stringify(record).includes(createHash('sha256').update('test-cookie').digest('hex')));
});

test('Realtime organization switch ends the old session control before any new tool executes', async () => {
  const a = agent(); store.update('tenant-a', 'agents', a.id, { tools: ['lookup_contact'] });
  respond = async url => url.endsWith('/realtime/calls') ? new Response('v=0\r\na=answer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_orgswitch' } }) : new Response(null, { status: 200 });
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/session', payload: { agentId: a.id, sdp: 'v=0\r\na=offer' } })).statusCode, 200);
  selectOrganizationForSession(store, createHash('sha256').update('test-cookie').digest('hex'), 'tenant-b', 'c'.repeat(64));
  sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'wrong-org', name: 'lookup_contact', arguments: '{"emailOrPhone":"owner@example.test"}' })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.list('tenant-a', 'agent-tool-calls').length, 0); assert.ok(calls.some(c => c.url.endsWith('/rtc_orgswitch/hangup')));
  assert.equal(store.list('tenant-a', 'voice-sessions')[0].securityStop, 'operator_session_revoked');
});

test('WhatsApp approved template sends use body parameters and persist accepted provider result once', async () => {
  const previousWaba = process.env.META_WABA_ID;
  process.env.META_WABA_ID = '98765';
  respond = async (url, init) => {
    if (url.includes('/message_templates')) return Response.json({ data: [{ id: '42', name: 'appointment_reminder', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}}' }] }] });
    const body = JSON.parse(String(init.body));
    assert.equal(body.type, 'template'); assert.equal(body.template.language.code, 'pt_BR');
    assert.deepEqual(body.template.components, [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }] }]);
    return Response.json({ messages: [{ id: 'wamid.template' }] });
  };
  const payload = { to: '+5511999999999', name: 'appointment_reminder', language: 'pt_BR', bodyParameters: ['Maria'], idempotencyKey: 'template-1' };
  try {
    const first = await app.inject({ method: 'POST', url: '/api/v1/whatsapp/templates/send', payload });
    assert.equal(first.statusCode, 200); assert.equal(first.json().messageId, 'wamid.template');
    await app.inject({ method: 'POST', url: '/api/v1/whatsapp/templates/send', payload }); assert.equal(calls.length, 2);
  } finally { if (previousWaba === undefined) delete process.env.META_WABA_ID; else process.env.META_WABA_ID = previousWaba; }
});

test('recipient mismatches are rejected before external side effects', async () => {
  const conversation = store.create('tenant-a', 'conversations', { channel: 'whatsapp', status: 'open', externalContact: '+5511888888888' });
  const result = await app.inject({ method: 'POST', url: '/api/v1/whatsapp/send', payload: { to: '+5511999999999', text: 'Olá', conversationId: conversation.id, idempotencyKey: 'recipient-1' } });
  assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'recipient_mismatch'); assert.equal(calls.length, 0);
});

test('WhatsApp media is tenant-owned, verifies hash, hides access URLs and blocks SSRF destinations', async () => {
  const media = store.create('tenant-a', 'messages', { source: 'meta', mediaId: 'media_123' });
  const bytes = Buffer.from('test-media');
  respond = async url => url.startsWith('https://graph.facebook.com/') ? Response.json({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?token=hidden', sha256: createHash('sha256').update(bytes).digest('hex'), file_size: bytes.length }) : new Response(bytes);
  const result = await app.inject(`/api/v1/whatsapp/messages/${media.id}/media`);
  assert.equal(result.statusCode, 200); assert.deepEqual(result.rawPayload, bytes); assert.equal(result.headers['cache-control'], 'no-store');
  assert.ok(!JSON.stringify(result.headers).includes('hidden'));
  respond = async () => Response.json({ url: 'http://127.0.0.1/admin' });
  const blocked = await app.inject(`/api/v1/whatsapp/messages/${media.id}/media`);
  assert.equal(blocked.statusCode, 502); assert.equal(blocked.json().error.code, 'invalid_media_url'); assert.equal(calls.length, 3);
  const other = await app.inject({ url: `/api/v1/whatsapp/messages/${media.id}/media`, headers: { 'x-test-tenant': 'tenant-b' } });
  assert.equal(other.statusCode, 403); assert.equal(calls.length, 3);
});

test('ephemeral voice secret is withheld when the operator session is revoked during issuance', async () => {
  const a = agent();
  respond = async () => {
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run('test-user');
    return Response.json({ value: 'ek_revoked_fixture', expires_at: 999 });
  };
  const result = await app.inject({ method: 'POST', url: '/api/v1/ai/realtime/token', payload: { agentId: a.id } });
  assert.equal(result.statusCode, 403); assert.equal(result.json().error.code, 'operator_session_revoked');
  assert.ok(!result.body.includes('ek_revoked_fixture')); assert.equal(calls.length, 1);
});

test('authenticated generation omits disabled knowledge and rejects a toggle change during inference', async () => {
  const a = agent(); await seedIndexedKnowledge(store, 'tenant-a', a.id, 'INDEXED-PRIVATE-MARKER');
  respond = async (_url, init) => { assert.ok(!JSON.stringify(JSON.parse(String(init.body))).includes('INDEXED-PRIVATE-MARKER')); return Response.json({ id: 'no_knowledge', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta sem referência.' }] }] }); };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/chat', payload: { agentId: a.id, message: 'Olá', idempotencyKey: 'disabled-knowledge-1' } })).statusCode, 200);
  store.update('tenant-a', 'agents', a.id, { tools: ['search_knowledge'] });
  respond = async (_url, init) => { assert.ok(String(init.body).includes('INDEXED-PRIVATE-MARKER')); store.update('tenant-a', 'agents', a.id, { tools: [] }); return Response.json({ id: 'stale_reply', output: [{ type: 'message', content: [{ type: 'output_text', text: 'MUST-NOT-PERSIST' }] }] }); };
  const rejected = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', payload: { agentId: a.id, message: 'Outra pergunta', idempotencyKey: 'changed-knowledge-2' } });
  assert.equal(rejected.statusCode, 409); assert.equal(rejected.json().error.code, 'knowledge_changed');
  assert.ok(!JSON.stringify(store.list('tenant-a', 'messages')).includes('MUST-NOT-PERSIST'));
});
