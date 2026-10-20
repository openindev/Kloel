import test from 'node:test';
import assert from 'node:assert/strict';
import { kloelCatalogPlan } from '../src/providers/billing-catalog-metadata.js';
const metadata = { kloel_catalog: 'casca-v2', kloel_product: 'voice', kloel_tier: 'solo' };
const price = () => ({ metadata: { ...metadata, kloel_interval: 'monthly' }, product: { metadata: { ...metadata } }, recurring: { interval: 'month', interval_count: 1 } });
test('catalog plan requires explicit coherent price/product metadata and exact Stripe recurrence', () => {
  assert.deepEqual(kloelCatalogPlan(price()), { product: 'voice', tier: 'solo', interval: 'monthly' });
  const annual = price(); annual.metadata.kloel_interval = 'annual'; annual.recurring.interval = 'year';
  assert.deepEqual(kloelCatalogPlan(annual), { product: 'voice', tier: 'solo', interval: 'annual' });
  assert.equal(kloelCatalogPlan({ product: { name: 'Kloel Voice Solo' }, unit_amount: 71900 }), null);
  for (const patch of [{ kloel_tier: 'scale' }, { kloel_product: 'toString' }, { kloel_interval: 'day' }, { kloel_catalog: 'legacy' }]) assert.equal(kloelCatalogPlan({ ...price(), metadata: { ...price().metadata, ...patch } }), null);
  assert.equal(kloelCatalogPlan({ ...price(), recurring: { interval: 'year', interval_count: 1 } }), null);
  assert.equal(kloelCatalogPlan({ ...price(), recurring: { interval: 'month', interval_count: 2 } }), null);
  assert.equal(kloelCatalogPlan({ ...price(), product: { metadata: { ...metadata, kloel_tier: 'team' } } }), null);
  const care = { ...price(), metadata: { ...metadata, kloel_product: 'care', kloel_tier: 'premium', kloel_interval: 'monthly' }, product: { metadata: { ...metadata, kloel_product: 'care', kloel_tier: 'premium' } } };
  assert.equal(kloelCatalogPlan(care)?.product, 'care');
  assert.equal(kloelCatalogPlan({ ...care, metadata: { ...care.metadata, kloel_interval: 'annual' }, recurring: { interval: 'year', interval_count: 1 } }), null);
});

import { stripeSubscriptionFields } from '../src/providers/billing.js';
test('subscription start date is provider supplied or unknown, never synthesized', () => {
  assert.equal(stripeSubscriptionFields({ start_date: 1792432000 }).startedAt, 1792432000);
  for (const start_date of [null, undefined, 0, -1, '1792432000', 1.5]) assert.equal(stripeSubscriptionFields({ start_date }).startedAt, null);
});
