import test from 'node:test'
import assert from 'node:assert/strict'
import { billingUsageFixture } from './fixtures/billing-usage-engine'
import { billingUsageDay, parseBillingEntitlements, parseBillingUsagePage } from '../src/services/engine/billing-usage'

test('real local entitlement GET distinguishes disabled, zero, and missing policy without Stripe I/O', async t => {
  const f = await billingUsageFixture(t), initial = await f.client.entitlements()
  assert.equal(initial.state, 'not_enforced'); assert.equal(initial.meters[0].limit, null); assert.equal(initial.measuredSpend, null)
  assert.equal(f.stripeRequests.length, 0)
  await f.configure(0); const before = f.stripeRequests.length, zero = await f.client.entitlements()
  assert.equal(zero.state, 'eligible'); assert.equal(zero.meters[0].limit, 0); assert.equal(zero.meters[0].remaining, 0)
  f.policy(10, false); const unavailable = await f.client.entitlements()
  assert.equal(unavailable.state, 'unavailable'); assert.equal(unavailable.reason, 'policy_disabled'); assert.equal(unavailable.meters[0].limit, null)
  assert.equal(f.stripeRequests.length, before)
})

test('real usage paginates by day and preserves conservative unknown counts without exposing content or claims', async t => {
  const f = await billingUsageFixture(t); await f.round(); await f.round('unknown')
  const first = await f.client.usage({ limit: 1 }), second = await f.client.usage({ day: first.period.start.slice(0, 10), cursor: first.nextCursor!, limit: 1 })
  assert.equal(first.items.length, 1); assert.ok(first.nextCursor); assert.equal(second.nextCursor, null)
  assert.deepEqual([first.items[0].state, second.items[0].state], ['observed', 'unknown'])
  assert.deepEqual(first.items[0].usage, { inputTokens: 0, outputTokens: 2, totalTokens: 2 }); assert.equal(second.items[0].usage, null)
  assert.equal((await f.client.entitlements()).meters[0].used, 2)
  const text = JSON.stringify([first, second]); for (const field of ['authorityHash', 'claimToken', 'prompt', 'message', 'secret', 'input_tokens']) assert.equal(text.includes(field), false)
  await assert.rejects(f.client.usage({ day: '2000-01-01', cursor: first.nextCursor! }), (e: any) => e.code === 'invalid_cursor')
  assert.equal(f.stripeRequests.length, 0); assert.equal(f.openAI.length, 0)
})

test('equal entitlement version can have different usage and disabling enforcement does not reset measurement', async t => {
  const f = await billingUsageFixture(t); await f.configure(10)
  const before = await f.client.entitlements(); await f.round(); const after = await f.client.entitlements()
  assert.equal(after.version, before.version); assert.equal(after.meters[0].remaining, 9); assert.equal(before.meters[0].remaining, 10)
  f.enforce(false); const disabled = await f.client.entitlements()
  assert.equal(disabled.state, 'not_enforced'); assert.equal(disabled.meters[0].used, 1); assert.equal(disabled.meters[0].remaining, null)
})

test('parser refuses malformed entitlement matrices, unsafe counters, monetary fiction and unknown fields', async t => {
  const f = await billingUsageFixture(t); await f.configure(5); const value = await f.client.entitlements()
  for (const change of [
    (x: any) => { x.meters[0].remaining = 0 }, (x: any) => { x.meters[0].used = Number.MAX_SAFE_INTEGER + 1 },
    (x: any) => { x.measuredSpend = 0 }, (x: any) => { x.reason = 'invented' }, (x: any) => { x.enforced = false },
    (x: any) => { x.period.timezone = 'America/Sao_Paulo' }, (x: any) => { x.coverage.push('voice') },
    (x: any) => { x.privateToken = 'secret' }, (x: any) => { x.policyRevision = null },
  ]) { const copy = structuredClone(value); change(copy); assert.throws(() => parseBillingEntitlements(copy)) }
})

test('usage parser refuses duplicate rows, foreign periods and content outside the HTTP allowlist', async t => {
  const f = await billingUsageFixture(t); await f.round(); const value = await f.client.usage()
  for (const change of [
    (x: any) => { x.items.push(x.items[0]) }, (x: any) => { x.items[0].day = '2000-01-01' },
    (x: any) => { x.items[0].usage.inputTokens = -1 }, (x: any) => { x.items[0].httpStatus = 999 },
    (x: any) => { x.items[0].body = 'private' }, (x: any) => { x.nextCursor = '../other' },
  ]) { const copy = structuredClone(value); change(copy); assert.throws(() => parseBillingUsagePage(copy)) }
  assert.throws(() => parseBillingUsagePage(value, { day: '2000-01-01' }))
  assert.throws(() => billingUsageDay('2026-02-30'))
  for (const query of [{ day: 'bad' }, { limit: 0 }, { cursor: '../x' }, { private: true }]) assert.throws(() => f.client.usage(query as any))
})

test('client checks authority and abort again after a transport ignores cancellation', async t => {
  const f = await billingUsageFixture(t)
  f.state.after = async (_r, response) => { f.state.current = false; return response }
  await assert.rejects(f.client.entitlements(), (e: any) => e.code === 'superseded')
  f.state.current = true; const abort = new AbortController(); f.state.after = async (_r, response) => { abort.abort(); return response }
  await assert.rejects(f.client.usage({}, abort.signal), (e: any) => e.code === 'superseded')
  assert.equal(f.calls.every(r => r.method === 'GET'), true)
})

test('real permission revocation rejects administrative usage without touching Stripe', async t => {
  const f = await billingUsageFixture(t); f.store.db.prepare("UPDATE memberships SET role='member' WHERE user_id=?").run(f.actor.userId)
  await assert.rejects(f.client.entitlements(), (e: any) => e.status === 403 || e.status === 409)
  assert.equal(f.stripeRequests.length, 0)
})
