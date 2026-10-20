import type { Store } from '../store.js';
import { platformProvidersEnabled } from '../platform-providers.js';
import { reconcileStripeBilling } from '../providers/billing.js';
import { planSnapshot } from './plans.js';
import { provisionIncludedNumber } from '../numbers/service.js';
import { numberAddonPriceIds, isNumberAddonItem, syncBillingAddons } from './addons.js';

type Data = Record<string, any>;

const activeTenant = (store: Store, id: unknown): string | null => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,128}$/.test(id)) return null;
  const row = store.db.prepare("SELECT id FROM organizations WHERE id=? AND status='active'").get(id) as { id: string } | undefined;
  return row?.id ?? null;
};
/** Platform mode: the event belongs to the org in metadata.tenantId (set on checkout + subscription) or the org bound to the customer. */
export function resolveStripeTenant(store: Store, bound: string, data: Data): string {
  if (!platformProvidersEnabled()) return bound;
  const byMeta = activeTenant(store, data?.metadata?.tenantId) ?? activeTenant(store, data?.client_reference_id);
  if (byMeta) return byMeta;
  if (typeof data?.customer === 'string') {
    const tenants = (store.db.prepare("SELECT id FROM organizations WHERE status='active'").all() as { id: string }[]).map(r => r.id);
    for (const t of tenants) if (store.list(t, 'billing-accounts').some(a => a.customerId === data.customer)) return t;
  }
  return bound;
}

async function stripeGet(path: string): Promise<Data> {
  const key = process.env.STRIPE_SECRET_KEY || '';
  const res = await fetch(`https://api.stripe.com/v1${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  const body = await res.json() as Data;
  if (!res.ok) throw Error(`stripe_${res.status}`);
  return body;
}
const allowed = () => String(process.env.STRIPE_PRICE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

export function syncNumberAddons(store: Store, tenant: string, subscription: Data) {
  const ids = numberAddonPriceIds(); if (!ids.length || typeof subscription?.id !== 'string') return;
  const live = ['active', 'trialing', 'past_due'].includes(String(subscription.status));
  const quantity = (Array.isArray(subscription.items?.data) ? subscription.items.data as Data[] : []).filter(isNumberAddonItem).reduce((n, i) => n + Math.max(0, Math.trunc(Number(i.quantity) || 0)), 0);
  const old = store.list(tenant, 'number-addons').find(a => a.subscriptionId === subscription.id);
  const fields = { status: live && quantity > 0 ? 'active' : 'canceled', quantity, subscriptionId: subscription.id, source: 'stripe_webhook', updatedFromStripeAt: new Date().toISOString() };
  if (old) store.update(tenant, 'number-addons', old.id, fields); else if (quantity > 0) store.create(tenant, 'number-addons', fields);
}

/**
 * Runs after the webhook transaction commits (never blocks the 200 to Stripe):
 * 1) re-reads the checkout/subscription from Stripe and commits the plan entitlement (same path as /billing/reconcile);
 * 2) on a paid plan, provisions the included number (idempotent: does nothing when already used);
 * 3) mirrors the extra-number add-on quantity into 'number-addons' and the billing-page add-ons into 'billing-addons'.
 */
export async function stripeWebhookFollowUp(store: Store, tenant: string, event: Data) {
  const data = event?.data?.object as Data | undefined; if (!data || typeof data !== 'object') return;
  try {
    let subscriptionId: string | null = null, checkoutId: string | null = null;
    if (event.type === 'checkout.session.completed' && data.mode === 'subscription') { checkoutId = data.id; subscriptionId = typeof data.subscription === 'string' ? data.subscription : null; }
    else if (String(event.type).startsWith('customer.subscription.')) {
      subscriptionId = data.id;
      const checkout = store.list(tenant, 'billing-checkouts').filter(c => c.subscriptionId === data.id || c.status === 'completed').sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt))).find(c => c.subscriptionId === data.id) ?? null;
      checkoutId = checkout ? String(checkout.sessionId) : null;
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      subscriptionId = typeof data.subscription === 'string' ? data.subscription : (data.parent?.subscription_details?.subscription ?? null);
      const checkout = subscriptionId ? store.list(tenant, 'billing-checkouts').find(c => c.subscriptionId === subscriptionId) : undefined;
      checkoutId = checkout ? String(checkout.sessionId) : null;
    } else return;
    if (checkoutId && store.list(tenant, 'billing-checkouts').some(c => c.sessionId === checkoutId)) {
      await reconcileStripeBilling(store, tenant, checkoutId, allowed(), stripeGet, 'stripe-webhook').catch(e => console.log('stripe_followup_reconcile_failed', tenant.slice(0, 8), e instanceof Error ? e.message : 'error'));
    }
    if (subscriptionId) { const sub = await stripeGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`); store.transaction(() => { syncNumberAddons(store, tenant, sub); syncBillingAddons(store, tenant, sub); }); }
    const plan = planSnapshot(store, tenant);
    if (plan.planId !== null && plan.state === 'eligible' && process.env.NUMBER_PURCHASE_ENABLED === '1') {
      const number = await provisionIncludedNumber(store, tenant);
      if (number) console.log('stripe_followup_included_number', tenant.slice(0, 8));
    }
  } catch (e) { console.log('stripe_followup_failed', tenant.slice(0, 8), e instanceof Error ? e.message.slice(0, 200) : 'error'); }
}
