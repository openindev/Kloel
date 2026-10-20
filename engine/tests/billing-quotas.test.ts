import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { billingQuotaFixture } from './fixtures/billing-quotas.js';
import { commitEntitlement, getEntitlement, getEnforcement, getPlanPolicy, provisionPlanPolicy, setTenantEnforcement, normalizeEntitlement, planSnapshot, digest } from '../src/billing/plans.js';
import { chatRoundMeter, usagePage } from '../src/billing/usage.js';
import { Store } from '../src/store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const deferred = <T = void>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const answer = () => Response.json({ id: 'resp_synthetic', usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'SYNTHETIC_PRIVATE_RESULT' }] }] });

test('local metadata distinguishes not enforced, unknown limits, explicit zero and metering start without Stripe I/O', async t => {
  const f = await billingQuotaFixture(t);
  let r = await f.read(); assert.equal(r.statusCode, 200); assert.equal(r.json().state, 'not_enforced'); assert.equal(r.json().meters[0].limit, null); assert.equal(f.stripeRequests.length, 0);
  assert.equal((await f.ask()).statusCode, 200); assert.equal((await f.read()).json().meters[0].used, 1);
  await f.configure(0); r = await f.read(); assert.equal(r.json().state, 'eligible'); assert.equal(r.json().meters[0].limit, 0); assert.equal(r.json().meters[0].used, 1);
  const n = f.openAI.length; r = await f.ask(); assert.equal(r.statusCode, 429); assert.equal(r.json().error.code, 'plan_quota_exhausted'); assert.equal(f.openAI.length, n);
  assert.equal(f.slots().length, 1); assert.match(r.body, /limite/);
});

test('private and public requests compete for one tenant slot while the first body is in flight', async t => {
  const f = await billingQuotaFixture(t); await f.configure(1); const visitor = await f.session(); const entered = deferred(), release = deferred();
  f.aiHooks.openAI = async () => { entered.resolve(); await release.promise; return answer(); };
  const first = f.ask(); await entered.promise;
  const second = await f.publicRequest(visitor.token); assert.equal(second.statusCode, 429, second.body); assert.equal(second.json().error.code, 'plan_quota_exhausted'); assert.doesNotMatch(second.body, /price_|cus_|synthetic/);
  release.resolve(); assert.equal((await first).statusCode, 200); assert.equal(f.openAI.length, 1); assert.equal(f.slots().length, 1); assert.equal((await f.read()).json().meters[0].used, 1);
});

test('round two is a distinct physical attempt; quota denial never reexecutes the already committed tool', async t => {
  const f = await billingQuotaFixture(t); const action = await f.create('append'); f.toolRound(action, { nome: 'synthetic', qtd: 1, ativo: true }); await f.configure(1);
  const key = randomUUID(), first = await f.ask(key); assert.equal(first.statusCode, 429, first.body); assert.equal(f.openAI.length, 1);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  const second = await f.ask(key); assert.equal(second.statusCode, 409); assert.equal(f.openAI.length, 1); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  f.policy(5); assert.equal((await f.ask(key)).statusCode, 409); assert.equal(f.openAI.length, 1);
});

test('public human handoff records the incoming message but consumes no physical round', async t => {
  const f = await billingQuotaFixture(t); await f.configure(0); const visitor = await f.session();
  const session = f.store.list(f.tenant, 'public-chat-sessions')[0]; f.store.update(f.tenant, 'conversations', String(session.conversationId), { status: 'pending' });
  const r = await f.publicRequest(visitor.token); assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().status, 'human_pending'); assert.equal(f.slots().length, 0); assert.equal(f.openAI.length, 0);
});

test('HTTP receipt is durable before revocation; parsed usage cannot disclose the answer or authorize another round', async t => {
  const f = await billingQuotaFixture(t); await f.configure(10);
  f.aiHooks.openAI = () => { f.aba(); return answer(); };
  const r = await f.ask(); assert.equal(r.statusCode, 409, r.body); assert.doesNotMatch(r.body, /SYNTHETIC_PRIVATE_RESULT/);
  const slot = f.slots()[0]; assert.equal(slot.state, 'observed'); assert.equal(slot.httpStatus, 200); assert.deepEqual(slot.usage, { inputTokens: 5, outputTokens: 4, totalTokens: 9 });
  assert.equal(f.openAI.length, 1); assert.equal(f.store.list(f.tenant, 'messages').filter(m => m.role === 'assistant').length, 0);
});

test('policy and enforcement ABA during inference suppress content without erasing measured usage', async t => {
  for (const kind of ['policy', 'enforcement']) await t.test(kind, async t => {
    const f = await billingQuotaFixture(t); await f.configure(10);
    f.aiHooks.openAI = () => { if (kind === 'policy') { f.policy(20); f.policy(10); } else { f.enforce(false); f.enforce(true); } return answer(); };
    const r = await f.ask(); assert.equal(r.statusCode, 409, r.body); assert.equal(r.json().error.code, 'plan_context_changed'); assert.equal(f.slots()[0].state, 'observed'); assert.equal(f.openAI.length, 1);
  });
});

test('HTTP4xx counts observed; timeout and HTTP5xx count unknown, never automatic replay', async t => {
  for (const kind of ['4xx', '5xx', 'transport']) await t.test(kind, async t => {
    const f = await billingQuotaFixture(t); await f.configure(5);
    f.aiHooks.openAI = () => { if (kind === 'transport') throw new Error('synthetic timeout'); return Response.json({ error: { code: 'synthetic_rejection', message: 'PRIVATE_UPSTREAM' } }, { status: kind === '4xx' ? 400 : 503 }); };
    const key = randomUUID(); assert.equal((await f.ask(key)).statusCode, 502); assert.equal((await f.ask(key)).statusCode, 409);
    const slot = f.slots()[0]; assert.equal(slot.state, kind === '4xx' ? 'observed' : 'unknown'); assert.equal(slot.usage, null); assert.equal(f.openAI.length, 1); assert.equal((await f.read()).json().meters[0].used, 1);
    assert.doesNotMatch(JSON.stringify(slot), /PRIVATE_UPSTREAM|Synthetic private message|synthetic-openai-key/);
  });
});

test('successful chat replay remains available with zero balance and creates no second slot', async t => {
  const f = await billingQuotaFixture(t); await f.configure(1); const key = randomUUID(); const first = await f.ask(key); assert.equal(first.statusCode, 200, first.body);
  const second = await f.ask(key); assert.equal(second.statusCode, 200, second.body); assert.equal(second.json().text, first.json().text); assert.equal(f.openAI.length, 1); assert.equal(f.slots().length, 1);
  const before = f.stripeRequests.length; const usage = await f.request('GET', '/api/v1/billing/usage'); assert.equal(usage.statusCode, 200); assert.equal(f.stripeRequests.length, before);
  assert.doesNotMatch(usage.body, /claimToken|authorityHash|sessionHash|Synthetic private message|synthetic-sheet-token/);
});

test('duplicate and irrelevant Stripe events do not invalidate; relevant same-second and late events require reconciliation', async t => {
  const f = await billingQuotaFixture(t); await f.configure(10); const before = getEntitlement(f.store, f.tenant)!.revision;
  assert.equal((await f.event('invoice.paid', { customer: 'cus_Quota' })).statusCode, 200); assert.equal((await f.event('customer.subscription.updated', { id: 'sub_Other', customer: 'cus_Other' })).statusCode, 200);
  assert.equal(getEntitlement(f.store, f.tenant)!.revision, before);
  const eventId = 'evt_relevant'; assert.equal((await f.event('customer.subscription.updated', { id: 'sub_Quota' }, eventId, 1)).statusCode, 200);
  assert.equal((await f.read()).json().state, 'reconcile_required'); assert.equal(getEntitlement(f.store, f.tenant)!.revision, before + 1);
  await f.event('customer.subscription.updated', { id: 'sub_Quota' }, eventId, 1); assert.equal(getEntitlement(f.store, f.tenant)!.revision, before + 1);
  await f.event('customer.subscription.updated', { id: 'sub_Quota' }, 'evt_same_second', 1); assert.equal(getEntitlement(f.store, f.tenant)!.revision, before + 2);
  const n = f.openAI.length; assert.equal((await f.ask()).statusCode, 403); assert.equal(f.openAI.length, n);
  assert.equal((await f.reconcile()).statusCode, 200); assert.equal((await f.read()).json().state, 'eligible');
});

test('reconciliation refuses missing or mismatched evidence, paused collection, multiple items and expired trial', async t => {
  for (const variant of ['missing_mode', 'wrong_mode', 'missing_period', 'pause', 'multiple', 'trial', 'price_kind']) await t.test(variant, async t => {
    const f = await billingQuotaFixture(t); f.policy(5); f.enforce(true);
    if (variant === 'missing_mode') delete (f.subscription as any).livemode;
    if (variant === 'wrong_mode') f.price.livemode = true;
    if (variant === 'missing_period') delete (f.subscription.items.data[0] as any).current_period_start;
    if (variant === 'pause') (f.subscription as any).pause_collection = { behavior: 'void' };
    if (variant === 'multiple') f.subscription.items.data.push({ ...f.subscription.items.data[0], id: 'si_Another' });
    if (variant === 'trial') { f.subscription.status = 'trialing'; (f.subscription as any).trial_end = 1; }
    if (variant === 'price_kind') f.price.type = 'one_time';
    const r = await f.reconcile(); assert.ok([200, 502].includes(r.statusCode), r.body); assert.notEqual((await f.read()).json().state, 'eligible'); assert.equal((await f.ask()).statusCode, 403); assert.equal(f.openAI.length, 0);
  });
});

test('archived price can keep an explicitly enabled policy; no-op and downgrade preserve count; missing policy is not zero', async t => {
  const f = await billingQuotaFixture(t); f.price.active = false; await f.configure(3); assert.equal((await f.ask()).statusCode, 200);
  const before = (await f.read()).json(); f.policy(3); assert.notEqual((await f.read()).json().version, before.version); assert.equal((await f.read()).json().meters[0].used, 1);
  f.policy(0); const r = (await f.read()).json(); assert.equal(r.state, 'eligible'); assert.equal(r.meters[0].remaining, 0);
  f.policy(1, false); assert.equal((await f.read()).json().reason, 'policy_disabled'); assert.equal((await f.read()).json().meters[0].limit, null);
  f.enforce(true, 'live'); assert.equal((await f.read()).json().reason, 'stripe_mode_mismatch');
});

test('two Store connections and UTC rollover cannot reopen an already dispatched operation identity', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'quota-')), path = join(dir, 'controlled.sqlite'), a = new Store(path), b = new Store(path);
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true }); });
  const tenant = randomUUID(), operationId = randomUUID();
  // Unenforced attempts still share the durable identity across connections and days.
  const args = { tenantId: tenant, sourceKind: 'private_chat' as const, operationId, authorityHash: digest('real-fixture-scope'), model: 'synthetic' };
  let calls = 0; await chatRoundMeter(a, args, () => {}).run(0, async o => { calls++; o.http(200); o.parsed({ id: 'resp_one' }); });
  await assert.rejects(chatRoundMeter(b, args, () => {}).run(0, async () => { calls++; }), /reservada/);
  t.mock.method(Date, 'now', () => Date.parse('2030-01-01T00:00:01.000Z'));
  await assert.rejects(chatRoundMeter(b, args, () => {}).run(0, async () => { calls++; }), /reservada/);
  assert.equal(calls, 1); assert.equal(planSnapshot(b, tenant).meters[0].used, 0);
});

test('reservation COMMIT followed by exception stays reserved; no invocation and no new attempt on the same operation', async t => {
  const store = new Store(); t.after(() => store.close()); const original = store.transaction.bind(store); let fail = true;
  store.transaction = ((fn: any) => { const value = original(fn); if (fail && store.db.prepare('SELECT COUNT(*) AS n FROM billing_chat_rounds').get()!.n === 1) { fail = false; throw new Error('post_commit'); } return value; }) as typeof store.transaction;
  const args = { tenantId: randomUUID(), sourceKind: 'private_chat' as const, operationId: randomUUID(), authorityHash: digest('scope'), model: 'synthetic' }; let calls = 0;
  await assert.rejects(chatRoundMeter(store, args, () => {}).run(0, async () => { calls++; }), /post_commit/);
  assert.equal(store.db.prepare('SELECT state FROM billing_chat_rounds').get()!.state, 'reserved');
  await assert.rejects(chatRoundMeter(store, args, () => {}).run(0, async () => { calls++; })); assert.equal(calls, 0);
});

test('failed pre-dispatch access releases only its owned reservation, while the original identity stays terminal', async t => {
  const store = new Store(); t.after(() => store.close()); let checks = 0, calls = 0;
  const args = { tenantId: randomUUID(), sourceKind: 'webchat' as const, operationId: randomUUID(), authorityHash: digest('scope'), model: 'synthetic' };
  await assert.rejects(chatRoundMeter(store, args, () => { if (++checks === 2) throw new Error('revoked'); }).run(0, async () => { calls++; }), /revoked/);
  assert.equal(store.db.prepare('SELECT state FROM billing_chat_rounds').get()!.state, 'not_dispatched');
  await assert.rejects(chatRoundMeter(store, args, () => {}).run(0, async () => { calls++; })); assert.equal(calls, 0);
});

test('post-COMMIT observation error conserves observed proof and prevents content publication', async t => {
  const f = await billingQuotaFixture(t); await f.configure(5); const original = f.store.transaction.bind(f.store); let armed = true;
  f.store.transaction = ((fn: any) => { const value = original(fn); if (armed && f.slots().some(r => r.state === 'observed')) { armed = false; throw new Error('after_observed_commit'); } return value; }) as typeof f.store.transaction;
  const key = randomUUID(); const r = await f.ask(key); assert.equal(r.statusCode, 500, r.body); assert.equal(f.slots()[0].state, 'observed'); assert.equal(f.slots()[0].httpStatus, 200);
  assert.equal((await f.ask(key)).statusCode, 409); assert.equal(f.openAI.length, 1); assert.equal(f.store.list(f.tenant, 'messages').filter(m => m.role === 'assistant').length, 0);
});


test('independent Store connections enforce the tenant last slot across private and public identities', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'quota-race-')), path = join(dir, 'controlled.sqlite'), a = new Store(path), b = new Store(path);
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true }); });
  const tenant = randomUUID();
  provisionPlanPolicy(a, { operationKey: randomUUID(), expectedRevision: 0, priceId: 'price_Test', stripeMode: 'test', planId: 'fixture', enabled: true, assistantChatRoundsPerDay: 1 });
  setTenantEnforcement(a, { operationKey: randomUUID(), expectedRevision: 0, tenantId: tenant, stripeMode: 'test', enabled: true });
  a.create(tenant, 'billing-accounts', { customerId: 'cus_Test' });
  const sec = Math.floor(Date.now() / 1000);
  const sub = { id: 'sub_Test', customer: 'cus_Test', status: 'active', livemode: false, pause_collection: null, cancel_at: null, items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_Test' }, current_period_start: sec - 10, current_period_end: sec + 86400 }] } };
  a.transaction(() => commitEntitlement(a, tenant, { mode: 'subscription', customer: sub.customer, subscription: sub.id, livemode: false }, sub, { id: 'price_Test', livemode: false, type: 'recurring', recurring: { usage_type: 'licensed' } }));
  const args = { tenantId: tenant, sourceKind: 'private_chat' as const, operationId: randomUUID(), authorityHash: digest('fixture-scope'), model: 'synthetic' };
  const entered = deferred(), release = deferred(); let calls = 0;
  const first = chatRoundMeter(a, args, () => {}).run(0, async o => { calls++; entered.resolve(); await release.promise; o.http(200); });
  await entered.promise;
  await assert.rejects(chatRoundMeter(b, { ...args, sourceKind: 'webchat', operationId: randomUUID() }, () => {}).run(0, async () => { calls++; }), (e: any) => e.code === 'plan_quota_exhausted');
  release.resolve(); await first; assert.equal(calls, 1); assert.equal(planSnapshot(b, tenant).meters[0].used, 1);
});

test('billing reads isolate tenant, reject non-human callers and bind pagination to its UTC day', async t => {
  const f = await billingQuotaFixture(t); await f.ask(); await f.ask();
  const first = await f.request('GET', '/api/v1/billing/usage?limit=1'); assert.equal(first.statusCode, 200); assert.equal(first.json().items.length, 1); assert.ok(first.json().nextCursor);
  const cursor = encodeURIComponent(first.json().nextCursor); const next = await f.request('GET', `/api/v1/billing/usage?limit=1&cursor=${cursor}`); assert.equal(next.statusCode, 200); assert.equal(next.json().items.length, 1); assert.notEqual(first.json().items[0].id, next.json().items[0].id);
  assert.equal((await f.request('GET', `/api/v1/billing/usage?day=2001-01-01&cursor=${cursor}`)).statusCode, 400);
  assert.equal((await f.request('GET', '/api/v1/billing/usage?day=2026-02-31')).statusCode, 400);
  assert.equal(usagePage(f.store, randomUUID(), {}).items.length, 0);
  const denied = await f.app.inject({ method: 'GET', url: '/api/v1/billing/entitlements', headers: { authorization: 'Bearer synthetic' } }); assert.ok(denied.statusCode >= 400); assert.doesNotMatch(denied.body, /measurementStartedAt|meters/);
});
