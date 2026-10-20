import test from 'node:test';
import assert from 'node:assert/strict';
import { billingQuotaFixture } from './fixtures/billing-quotas.js';

test('positive but incomplete nullable cancellation evidence cannot retain a previously eligible grant', async t => {
  for (const field of ['pause_collection', 'cancel_at']) await t.test(field, async t => {
    const f = await billingQuotaFixture(t); await f.configure(10); assert.equal((await f.read()).json().state, 'eligible');
    delete (f.subscription as any)[field]; const result = await f.reconcile(); assert.equal(result.statusCode, 200, result.body);
    assert.notEqual((await f.read()).json().state, 'eligible'); assert.equal((await f.ask()).statusCode, 403); assert.equal(f.openAI.length, 0);
  });
});

test('an authoritative positive but invalid reconciliation revokes the old grant instead of preserving eligible', async t => {
  for (const kind of ['multiple', 'more', 'status']) await t.test(kind, async t => {
    const f = await billingQuotaFixture(t); await f.configure(10); assert.equal((await f.read()).json().state, 'eligible');
    if (kind === 'multiple') f.subscription.items.data.push({ ...f.subscription.items.data[0], id: 'si_Other' });
    if (kind === 'more') f.subscription.items.has_more = true;
    if (kind === 'status') f.subscription.status = 'invalid_future_status';
    const result = await f.reconcile(); assert.equal(result.statusCode, 502, result.body);
    assert.notEqual((await f.read()).json().state, 'eligible'); assert.equal((await f.ask()).statusCode, 403); assert.equal(f.openAI.length, 0);
  });
});
