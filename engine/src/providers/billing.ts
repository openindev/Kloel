import { createHash } from 'node:crypto';
import type { Entity, Store } from '../store.js';
import { planItems } from '../billing/addons.js';
import { commitEntitlement, getEnforcement, reconciliationFence, invalidateReconciliation } from '../billing/plans.js';

type Data = Record<string, any>;
export class BillingError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}
const timestamp = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
const snapshot = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function stripeSubscriptionFields(data: Data): Data {
  return { providerSubscriptionId: data.id, customerId: data.customer, status: data.status, startedAt: timestamp(data.start_date), cancelAtPeriodEnd: data.cancel_at_period_end === true,
    cancelAt: timestamp(data.cancel_at), canceledAt: timestamp(data.canceled_at), endedAt: timestamp(data.ended_at),
    currentPeriodEnd: timestamp(data.current_period_end ?? data.items?.data?.[0]?.current_period_end) };
}
export function publicSubscription(value: Entity | Data): Data {
  return { ...value, scheduledCancellation: !['canceled', 'incomplete_expired'].includes(String(value.status)) && (value.cancelAtPeriodEnd === true || timestamp(value.cancelAt) !== null) };
}

/** Read-only Stripe requests repair a missed webhook without impersonating one. */
export async function reconcileStripeBilling(store: Store, tenant: string, checkoutId: string, allowedPrices: string[], get: (path: string) => Promise<Data>, userId: string, authorize: () => void = () => {}): Promise<Data> {
  const registered = store.list(tenant, 'billing-checkouts').find(c => c.sessionId === checkoutId);
  if (!registered || typeof registered.priceId !== 'string') throw new BillingError(404, 'checkout_not_found', 'Checkout não registrado nesta organização.');
  const quotaFence = reconciliationFence(store, tenant);
  const beforeAccounts = snapshot(store.list(tenant, 'billing-accounts'));
  const beforeSubscriptions = snapshot(store.list(tenant, 'subscriptions'));
  const beforeCheckout = snapshot(registered);
  const unchanged = () => {
    authorize();
    if (reconciliationFence(store, tenant) !== quotaFence) throw new BillingError(409, 'plan_context_changed', 'O plano mudou durante a consulta. Consulte novamente.');
    if (snapshot(store.list(tenant, 'billing-accounts')) !== beforeAccounts || snapshot(store.list(tenant, 'subscriptions')) !== beforeSubscriptions || snapshot(store.get(tenant, 'billing-checkouts', registered.id)) !== beforeCheckout) throw new BillingError(409, 'billing_changed_retry', 'Uma atualização chegou durante a consulta. Consulte novamente.');
  };
  const invalidEvidence = (message: string): never => {
    store.transaction(() => { unchanged(); invalidateReconciliation(store, tenant); });
    throw new BillingError(502, 'billing_binding_invalid', message);
  };
  const requestedAt = Date.now();
  const session = await get(`/checkout/sessions/${encodeURIComponent(checkoutId)}?expand%5B%5D=line_items`);
  unchanged();
  const lines = session.line_items;
  if (session.id !== checkoutId || session.mode !== 'subscription' || session.metadata?.tenantId !== tenant || session.client_reference_id !== tenant || !['open', 'complete', 'expired'].includes(session.status)
    || lines?.has_more !== false || !Array.isArray(lines?.data) || lines.data.length !== 1 || lines.data[0]?.price?.id !== registered.priceId || lines.data[0]?.quantity !== 1) invalidEvidence('Stripe não confirmou os dados vinculados deste checkout.');
  if (session.status !== 'complete') {
    return store.transaction(() => { unchanged(); store.update(tenant, 'billing-checkouts', registered.id, { status: session.status, reconciledAt: new Date().toISOString(), source: 'stripe_api' });
      return { account: null, subscription: null, checkoutStatus: session.status, source: 'stripe_api', reconciledAt: new Date().toISOString() }; });
  }
  if (typeof session.customer !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(session.customer) || typeof session.subscription !== 'string' || !/^sub_[A-Za-z0-9]+$/.test(session.subscription) || !['paid', 'unpaid', 'no_payment_required'].includes(session.payment_status)) invalidEvidence('Stripe não confirmou cliente e assinatura do checkout.');
  const subscription = await get(`/subscriptions/${encodeURIComponent(session.subscription)}`);
  unchanged();
  const prices = planItems(subscription.items?.data); // add-on de números extras não é plano
  if (subscription.id !== session.subscription || subscription.customer !== session.customer || subscription.metadata?.tenantId !== tenant
    || !['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'].includes(subscription.status)
    || subscription.items?.has_more !== false || !Array.isArray(prices) || prices.length !== 1 || prices[0]?.quantity !== 1 || !allowedPrices.includes(prices[0]?.price?.id)) invalidEvidence('Stripe não confirmou o vínculo e o plano da assinatura.');
  const price = getEnforcement(store, tenant) ? await get(`/prices/${encodeURIComponent(prices[0].price.id)}`) : undefined;
  unchanged();
  return store.transaction(() => {
    unchanged();
    const oldAccount = store.list(tenant, 'billing-accounts')[0];
    if (oldAccount?.customerId && oldAccount.customerId !== session.customer) throw new BillingError(409, 'billing_customer_conflict', 'Cliente Stripe diferente do vínculo atual.');
    const now = new Date().toISOString();
    const accountFields = { customerId: session.customer, checkoutStatus: session.payment_status, confirmedSource: 'stripe_api', lastReconciledAt: now, lastStripeSnapshotAt: Math.floor(requestedAt / 1000) };
    const account = oldAccount ? store.update(tenant, 'billing-accounts', oldAccount.id, accountFields)! : store.create(tenant, 'billing-accounts', accountFields);
    const oldSubscription = store.list(tenant, 'subscriptions').find(s => s.providerSubscriptionId === subscription.id);
    const fields = { ...stripeSubscriptionFields(subscription), priceId: prices[0].price.id, lastReconciledAt: now, lastStripeSnapshotAt: Math.floor(requestedAt / 1000), confirmedSource: 'stripe_api' };
    const stored = oldSubscription ? store.update(tenant, 'subscriptions', oldSubscription.id, fields)! : store.create(tenant, 'subscriptions', fields);
    store.update(tenant, 'billing-checkouts', registered.id, { status: 'completed', subscriptionId: subscription.id, customerId: session.customer, paymentStatus: session.payment_status, reconciledAt: now });
    commitEntitlement(store, tenant, session, subscription, price);
    const receipt = store.create(tenant, 'billing-reconciliations', { source: 'stripe_api', checkoutSessionId: checkoutId, subscriptionId: subscription.id, customerId: session.customer, userId, requestedAt, reconciledAt: now, status: 'confirmed' });
    return { account, subscription: publicSubscription(stored), checkoutStatus: 'complete', source: 'stripe_api', reconciledAt: now, reconciliationId: receipt.id };
  });
}
