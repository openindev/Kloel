/**
 * Extra-number add-on charge (Fonio parity: "Adicionar número" beyond the plan charges R$ 49/mês before the number is bought).
 * - Org with a live Stripe subscription: add the add-on price as a subscription item (or quantity +1), prorated and invoiced
 *   immediately; `payment_behavior=error_if_incomplete` makes Stripe refuse the change when the payment fails.
 *   On success the add-on allowance is mirrored right away with the same sync the webhook uses (idempotent per subscription).
 * - No subscription: a Stripe Checkout (mode=subscription) for the add-on; the webhook mirrors it after payment.
 * The phone number itself is bought only afterwards, through /numbers/purchase, which requires remainingExtra > 0.
 */
import { createHash } from 'node:crypto';
import type { Store } from '../store.js';
import { numberAddonPriceIds, isNumberAddonItem } from '../billing/addons.js';
import { syncNumberAddons } from '../billing/webhook-followup.js';
import { NumberProviderError, numberHttp } from './providers.js';

type Data = Record<string, any>;
const fail = (status: number, code: string, message: string): never => { throw new NumberProviderError(status, code, message); };
async function stripe(method: 'GET' | 'POST' | 'DELETE', path: string, form?: Record<string, string>, idempotencyKey?: string): Promise<Data> {
  const key = process.env.STRIPE_SECRET_KEY?.trim(); if (!key) return fail(503, 'billing_not_configured', 'A cobrança ainda não está configurada.');
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let res: Response;
  try { res = await numberHttp.fetch(`https://api.stripe.com/v1${path}`, { method, headers, body: form ? new URLSearchParams(form) : undefined, signal: AbortSignal.timeout(30000) }); }
  catch { return fail(502, 'billing_unreachable', 'O Stripe não respondeu. Tente novamente.'); }
  const body = await res.json().catch(() => ({})) as Data;
  if (!res.ok) {
    const card = body?.error?.type === 'card_error' || body?.error?.code === 'subscription_payment_intent_requires_action' || /payment/i.test(String(body?.error?.message ?? ''));
    console.log('number_addon_stripe_error', res.status, String(body?.error?.code ?? body?.error?.type ?? '').slice(0, 60));
    return fail(card ? 402 : 502, card ? 'addon_payment_failed' : 'addon_billing_failed', card ? 'O pagamento do número extra foi recusado. Atualize a forma de pagamento em Assinatura e faturamento.' : 'Não foi possível adicionar o número extra à assinatura.');
  }
  return body;
}

export async function chargeExtraNumber(store: Store, tenant: string, idempotencyKey: string, origin: string) {
  const price = numberAddonPriceIds()[0]; if (!price) return fail(503, 'addon_not_configured', 'O número extra ainda não está à venda.');
  const key = (step: string) => `kloel-number-addon:${createHash('sha256').update(`${tenant}:${idempotencyKey}:${step}`).digest('hex').slice(0, 40)}`;
  const customer = String(store.list(tenant, 'billing-accounts')[0]?.customerId ?? '');
  let subscription: Data | undefined;
  if (customer) {
    const list = await stripe('GET', `/subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=20&expand[]=data.items`);
    subscription = (list.data as Data[] | undefined ?? []).filter(s => ['active', 'trialing'].includes(String(s.status)))
      .sort((a, b) => Number(b.created) - Number(a.created))[0];
  }
  if (subscription) {
    const existing = (subscription.items?.data as Data[] | undefined ?? []).find(isNumberAddonItem);
    const common = { proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' };
    if (existing) await stripe('POST', `/subscription_items/${encodeURIComponent(existing.id)}`, { ...common, quantity: String(Math.max(0, Math.trunc(Number(existing.quantity) || 0)) + 1) }, key('increment'));
    else await stripe('POST', '/subscription_items', { ...common, subscription: String(subscription.id), price, quantity: '1' }, key('create'));
    const fresh = await stripe('GET', `/subscriptions/${encodeURIComponent(String(subscription.id))}`);
    store.transaction(() => syncNumberAddons(store, tenant, fresh));
    return { status: 'active' as const, subscriptionId: String(subscription.id) };
  }
  const back = `${origin.replace(/\/$/, '')}/app/phone-numbers`;
  const form: Record<string, string> = { mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1', client_reference_id: tenant,
    'metadata[tenantId]': tenant, 'metadata[kind]': 'number_addon', 'subscription_data[metadata][tenantId]': tenant, 'subscription_data[metadata][kind]': 'number_addon',
    success_url: `${back}?addon=success`, cancel_url: `${back}?addon=canceled`, locale: 'pt-BR' };
  if (customer) form.customer = customer;
  const session = await stripe('POST', '/checkout/sessions', form, key('checkout'));
  if (typeof session.url !== 'string') return fail(502, 'addon_billing_failed', 'Não foi possível abrir o pagamento.');
  return { status: 'checkout' as const, url: session.url as string };
}

/**
 * Releasing an extra number gives back one add-on unit: the subscription item quantity goes down by one (prorated credit on the
 * next invoice) — or the item / add-on-only subscription is removed when it was the last unit — and the allowance is mirrored
 * immediately. Never blocks the release: the caller reports `adjusted:false` with the reason so the owner can act in billing.
 */
export async function releaseExtraNumber(store: Store, tenant: string, numberId: string): Promise<{ adjusted: boolean; reason?: string; quantity?: number }> {
  if (!numberAddonPriceIds().length || !process.env.STRIPE_SECRET_KEY?.trim()) return { adjusted: false, reason: 'billing_not_configured' };
  const customer = String(store.list(tenant, 'billing-accounts')[0]?.customerId ?? ''); if (!customer) return { adjusted: false, reason: 'no_subscription' };
  const key = (step: string) => `kloel-number-release:${createHash('sha256').update(`${tenant}:${numberId}:${step}`).digest('hex').slice(0, 40)}`;
  try {
    const list = await stripe('GET', `/subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=20&expand[]=data.items`);
    const subscription = (list.data as Data[] | undefined ?? []).filter(s => ['active', 'trialing', 'past_due'].includes(String(s.status)) && (s.items?.data as Data[] | undefined ?? []).some(isNumberAddonItem))
      .sort((a, b) => Number(b.created) - Number(a.created))[0];
    if (!subscription) return { adjusted: false, reason: 'no_subscription' };
    const items = subscription.items?.data as Data[], item = items.find(isNumberAddonItem)!, quantity = Math.max(0, Math.trunc(Number(item.quantity) || 0));
    if (quantity > 1) await stripe('POST', `/subscription_items/${encodeURIComponent(item.id)}`, { quantity: String(quantity - 1), proration_behavior: 'create_prorations' }, key('decrement'));
    else if (items.length > 1) await stripe('DELETE', `/subscription_items/${encodeURIComponent(item.id)}?proration_behavior=create_prorations`, undefined, key('remove'));
    else await stripe('DELETE', `/subscriptions/${encodeURIComponent(String(subscription.id))}?prorate=true`, undefined, key('cancel'));
    const fresh = await stripe('GET', `/subscriptions/${encodeURIComponent(String(subscription.id))}`);
    store.transaction(() => syncNumberAddons(store, tenant, fresh));
    return { adjusted: true, quantity: quantity - 1 };
  } catch (e) {
    console.log('number_addon_release_failed', e instanceof NumberProviderError ? e.code : 'unknown');
    return { adjusted: false, reason: e instanceof NumberProviderError ? e.code : 'billing_failed' };
  }
}
