import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { planSnapshot } from '../src/billing/plans.js';
import { publicGrants } from '../src/billing/grants.js';

test('plan-grants libera o plano até expiresAt e trava depois', () => {
  process.env.BILLING_ENFORCEMENT_DEFAULT = 'live';
  const store = new Store(), t = 'tenant-grant', now = Date.now();
  assert.equal(planSnapshot(store, t, now).state, 'reconcile_required');
  const g = store.create(t, 'plan-grants', { status: 'active', planId: 'full-access-trial', products: [{ product: 'voice', tier: 'team' }], startsAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 7 * 86400000).toISOString(), noCharge: true });
  const on = planSnapshot(store, t, now);
  assert.equal(on.state, 'eligible'); assert.equal(on.planId, 'full-access-trial'); assert.equal(on.validUntil, g.expiresAt); assert.ok(on.meters[0].limit! > 0);
  assert.equal(planSnapshot(store, t, now + 8 * 86400000).state, 'reconcile_required');
  assert.equal(publicGrants(store, t, now + 8 * 86400000)[0].status, 'expired');
  store.update(t, 'plan-grants', g.id, { status: 'revoked' });
  assert.equal(planSnapshot(store, t, now).state, 'reconcile_required');
  delete process.env.BILLING_ENFORCEMENT_DEFAULT;
});
