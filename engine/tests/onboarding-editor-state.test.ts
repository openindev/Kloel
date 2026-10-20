import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { sessionDigest } from '../src/auth.js';
import { provisionPlanPolicy, setTenantEnforcement, commitEntitlement } from '../src/billing/plans.js';
import { seedMember } from './fixtures/membership.js';

const base = '/api/v1/onboarding/editor-state';
const defaults = { step: 'plan', sector: null, size: null, referralSource: null, agentId: null, conversationId: null };
async function fixture(t: test.TestContext) {
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'onboarding@example.test', password: 'onboarding-test-password', organization: 'Onboarding' } });
  assert.equal(signup.statusCode, 201, signup.body);
  const cookies = { kloel_session: signup.cookies.find(c => c.name === 'kloel_session')!.value }, context = signup.json().context;
  const headers = { 'x-kloel-expected-user': context.userId, 'x-kloel-expected-tenant': context.tenantId, 'x-kloel-expected-membership': context.membershipId, 'x-kloel-expected-authority': context.authorityVersion };
  const read = (path = base, expected = headers) => app.inject({ url: path, cookies, headers: expected });
  const write = (input: Record<string, unknown>, expected = headers) => app.inject({ method: 'PUT', url: base, cookies, headers: expected, payload: { expectedTenantId: context.tenantId, expectedRevision: 0, idempotencyKey: randomUUID(), state: defaults, ...input } });
  const agent = () => store.create(context.tenantId, 'agents', { name: 'Assistente real', status: 'active' });
  const grant = (mode: 'test' | 'live', end = Date.now() + 86400000) => {
    const previous = store.db.prepare('SELECT body FROM billing_plan_enforcement WHERE scope=?').get(context.tenantId);
    setTenantEnforcement(store, { operationKey: randomUUID(), expectedRevision: previous ? JSON.parse(String(previous.body)).revision : 0, tenantId: context.tenantId, stripeMode: mode, enabled: true });
    provisionPlanPolicy(store, { operationKey: randomUUID(), expectedRevision: 0, priceId: `price_${mode}`, stripeMode: mode, planId: `onboarding_${mode}`, enabled: true, assistantChatRoundsPerDay: 10 });
    if (!store.list(context.tenantId, 'billing-accounts').length) store.create(context.tenantId, 'billing-accounts', { customerId: 'cus_onboarding' });
    const live = mode === 'live', price = { id: `price_${mode}`, livemode: live, type: 'recurring', recurring: { usage_type: 'licensed' } };
    const subscription = { id: 'sub_onboarding', livemode: live, customer: 'cus_onboarding', status: 'active', pause_collection: null, cancel_at: null,
      items: { has_more: false, data: [{ quantity: 1, price: { id: price.id }, current_period_start: Math.floor(Date.now() / 1000) - 3600, current_period_end: Math.floor(end / 1000) }] } };
    store.transaction(() => commitEntitlement(store, context.tenantId, { mode: 'subscription', subscription: subscription.id, customer: subscription.customer, livemode: live }, subscription, price));
  };
  return { store, app, cookies, headers, context, read, write, agent, grant };
}

test('legacy absence stays not required without writes; explicit initialization has CAS and recoverable exact receipts', async t => {
  const f = await fixture(t), before = f.store.db.prepare('SELECT * FROM entities ORDER BY id').all();
  const absent = await f.read(); assert.equal(absent.statusCode, 200, absent.body);
  assert.deepEqual(absent.json(), { tenantId: f.context.tenantId, userId: f.context.userId, revision: 0, required: false, completed: false, completedAt: null, state: defaults });
  assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY id').all(), before);
  assert.equal((await f.write({})).json().error.code, 'onboarding_not_initialized');
  const input = { initialize: true, idempotencyKey: randomUUID() }, started = await f.write(input);
  assert.equal(started.statusCode, 200, started.body); assert.equal(started.json().status, 'succeeded'); assert.equal(started.json().view.required, true);
  assert.equal(started.json().view.completed, false); assert.equal(started.json().revision, 1);
  assert.deepEqual((await f.write(input)).json(), started.json());
  assert.deepEqual((await f.read(`${base}/operations/${input.idempotencyKey}`)).json(), started.json());
  assert.equal((await f.write({ ...input, state: { ...defaults, sector: 'Comércio' } })).json().error.code, 'onboarding_idempotency_conflict');
  assert.equal((await f.write({ state: { ...defaults, step: 'sector' } })).json().error.code, 'onboarding_revision_conflict');
  const saved = await f.write({ expectedRevision: 1, state: { ...defaults, step: 'sector', sector: 'Comércio' } });
  assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().view.state.sector, 'Comércio'); assert.equal(saved.json().revision, 2);
});

test('completion requires a real same-tenant agent and LIVE eligible billing; TEST never completes or creates an entitlement', async t => {
  const f = await fixture(t); assert.equal((await f.write({ initialize: true })).statusCode, 200);
  const agent = f.agent(), state = { ...defaults, step: 'done', agentId: agent.id };
  assert.equal((await f.write({ expectedRevision: 1, complete: true, state: { ...state, agentId: null } })).json().error.code, 'onboarding_agent_required');
  assert.equal((await f.write({ expectedRevision: 1, complete: true, state })).json().error.code, 'onboarding_live_subscription_required');
  f.grant('test');
  const before = f.store.db.prepare('SELECT * FROM billing_plan_entitlements').all();
  const denied = await f.write({ expectedRevision: 1, complete: true, state });
  assert.equal(denied.statusCode, 409); assert.equal(denied.json().error.code, 'onboarding_live_subscription_required');
  assert.equal((await f.read()).json().completed, false); assert.deepEqual(f.store.db.prepare('SELECT * FROM billing_plan_entitlements').all(), before);
  f.grant('live');
  const input = { expectedRevision: 1, idempotencyKey: randomUUID(), complete: true, state }, complete = await f.write(input);
  assert.equal(complete.statusCode, 200, complete.body); assert.equal(complete.json().view.completed, true); assert.equal(complete.json().view.required, true);
  assert.ok(Number.isFinite(Date.parse(complete.json().view.completedAt)));
  assert.deepEqual((await f.write(input)).json(), complete.json());
  assert.equal((await f.write({ expectedRevision: 2, initialize: true })).json().error.code, 'onboarding_already_completed');
});

test('expired LIVE billing and unrelated conversation references cannot complete onboarding', async t => {
  const f = await fixture(t), agent = f.agent(), another = f.agent();
  assert.equal((await f.write({ initialize: true })).statusCode, 200);
  const foreign = f.store.create('foreign', 'agents', { status: 'active' });
  assert.equal((await f.write({ expectedRevision: 1, state: { ...defaults, agentId: foreign.id } })).json().error.code, 'onboarding_agent_unavailable');
  const conversation = f.store.create(f.context.tenantId, 'conversations', { agentId: another.id, channel: 'webchat' });
  assert.equal((await f.write({ expectedRevision: 1, state: { ...defaults, agentId: agent.id, conversationId: conversation.id } })).json().error.code, 'onboarding_conversation_unavailable');
  f.grant('live', Date.now() - 1000);
  assert.equal((await f.write({ expectedRevision: 1, complete: true, state: { ...defaults, step: 'done', agentId: agent.id } })).json().error.code, 'onboarding_live_subscription_required');
  assert.equal((await f.read()).json().revision, 1);
});

test('context, tenant, strict fields and user-scoped receipts deny stale or foreign authority', async t => {
  const f = await fixture(t), key = randomUUID();
  assert.equal((await f.read(base, {})).statusCode, 400);
  assert.equal((await f.write({ initialize: true, expectedTenantId: 'foreign' })).statusCode, 409);
  assert.equal((await f.write({ initialize: true, completed: true })).statusCode, 400);
  assert.equal((await f.write({ initialize: true, state: { ...defaults, sector: 'x'.repeat(101) } })).statusCode, 400);
  assert.equal((await f.write({ initialize: true, idempotencyKey: key })).statusCode, 200);
  const login = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'onboarding@example.test', password: 'onboarding-test-password' } });
  const cookies = { kloel_session: login.cookies.find(c => c.name === 'kloel_session')!.value }, headers = { ...f.headers, 'x-kloel-expected-authority': login.json().context.authorityVersion };
  assert.equal((await f.app.inject({ url: `${base}/operations/${key}`, cookies, headers })).statusCode, 404);
  assert.equal((await f.app.inject({ url: base, cookies, headers })).json().required, true);
  assert.equal((await f.app.inject({ url: base, cookies, headers: f.headers })).statusCode, 409);
});

test('another member of the same tenant has independent editor state and cannot recover another user receipt', async t => {
  const f = await fixture(t), key = randomUUID();
  assert.equal((await f.write({ initialize: true, idempotencyKey: key })).statusCode, 200);
  const other = { userId: 'other-onboarding-user', tenantId: f.context.tenantId, role: 'member' as const };
  seedMember(f.store, other);
  const cookies = { kloel_session: 'isolated-other-onboarding-session' };
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(cookies.kloel_session), other.userId, other.tenantId, Date.now() + 3600000);
  const me = await f.app.inject({ url: '/api/v1/auth/me', cookies }); assert.equal(me.statusCode, 200, me.body);
  const c = me.json().context, headers = { 'x-kloel-expected-user': c.userId, 'x-kloel-expected-tenant': c.tenantId, 'x-kloel-expected-membership': c.membershipId, 'x-kloel-expected-authority': c.authorityVersion };
  const state = await f.app.inject({ url: base, cookies, headers });
  assert.equal(state.statusCode, 200, state.body); assert.equal(state.json().required, false); assert.equal(state.json().userId, other.userId);
  assert.equal((await f.app.inject({ url: `${base}/operations/${key}`, cookies, headers })).statusCode, 404);
  assert.equal((await f.read()).json().required, true);
});
