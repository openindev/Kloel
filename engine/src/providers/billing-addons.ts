import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store.js';
import { ADDON_KEYS, ADDON_PACKS, addonPriceIds, type AddonKey } from '../billing/addons.js';
import { AUTO_BUY_ADDONS, addonSettings, autoBuyCap, changeAddon, mirror, planSubscription, quantityOf, setAutoBuy, stripeClient } from '../billing/addon-purchase.js';
import { providerAllowedForTenant } from '../platform-providers.js';

type Data = Record<string, any>;
type Authority = { tenant: string; actor: { userId: string }; assertCurrent: () => void };
type Dependencies = {
  authority: (request: FastifyRequest, requireBinding?: boolean) => Authority;
  safe: (handler: (request: FastifyRequest) => unknown) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  fetchImpl?: typeof fetch;
};
const keySchema = z.string().min(8).max(128).regex(/^[a-zA-Z0-9_.:-]+$/);
const addonSchema = z.enum(ADDON_KEYS as [AddonKey, ...AddonKey[]]);

/**
 * Add-ons de Assinatura e faturamento (mesma autoridade humana de /billing/checkout: sessão + billing:manage).
 * GET lê da Stripe os preços configurados e a assinatura do plano (e espelha as quantidades); POST soma/tira 1 pacote;
 * PUT settings grava a compra automática, executada pelo caminho do uso (autoBuyAfterUsage).
 */
export async function registerBillingAddons(app: FastifyInstance, store: Store, deps: Dependencies) {
  const stripe = stripeClient(deps.fetchImpl ?? ((...args) => globalThis.fetch(...args)));
  app.get('/api/v1/billing/addons', deps.safe(async request => {
    const a = deps.authority(request, false), prices = addonPriceIds();
    const configured = providerAllowedForTenant(a.tenant) && !!process.env.STRIPE_SECRET_KEY?.trim();
    const subscription = configured ? await planSubscription(store, a.tenant, stripe) : undefined; a.assertCurrent();
    if (subscription) mirror(store, a.tenant, subscription);
    const row = store.list(a.tenant, 'billing-addons')[0], items = [];
    for (const key of ADDON_KEYS) {
      const priceId = prices[key] ?? null, price: Data | null | undefined = configured && priceId ? await stripe('GET', `/prices/${encodeURIComponent(priceId)}`).catch(() => null) : undefined;
      a.assertCurrent();
      const usable = !!price && price.id === priceId && price.active === true && price.type === 'recurring' && price.recurring?.usage_type === 'licensed' && price.billing_scheme === 'per_unit' && Number.isSafeInteger(price.unit_amount) && price.unit_amount >= 0 && /^[a-z]{3}$/.test(String(price.currency));
      const reason = !configured ? 'billing_not_configured' : !priceId ? 'price_not_configured' : price === null ? 'price_unavailable' : !usable ? 'price_invalid' : !subscription ? 'subscription_required' : undefined;
      items.push({ key, label: ADDON_PACKS[key].label, unit: ADDON_PACKS[key].unit, priceId, unitAmount: usable ? price!.unit_amount : null, currency: usable ? price!.currency : null, interval: usable ? price!.recurring.interval : null,
        quantity: subscription && priceId ? quantityOf(subscription, priceId) : 0, purchasable: !reason, ...(reason ? { reason } : {}) });
    }
    return { configured, autoBuy: addonSettings(store, a.tenant)?.autoBuy === true, autoBuyCap: autoBuyCap(), autoBuyAddons: AUTO_BUY_ADDONS,
      subscription: subscription ? { id: String(subscription.id), periodStart: row?.periodStart ?? null, periodEnd: row?.periodEnd ?? null } : null, items };
  }));
  app.put('/api/v1/billing/addons/settings', deps.safe(request => {
    const a = deps.authority(request, false), body = z.object({ autoBuy: z.boolean() }).strict().parse(request.body);
    const saved = store.transaction(() => { a.assertCurrent(); return setAutoBuy(store, a.tenant, body.autoBuy, a.actor.userId); });
    return { autoBuy: saved.autoBuy === true, autoBuyCap: autoBuyCap(), updatedAt: saved.updatedAt };
  }));
  app.post('/api/v1/billing/addons/:key', deps.safe(async request => {
    const a = deps.authority(request), addon = addonSchema.parse((request.params as Data).key);
    const body = z.object({ action: z.enum(['increment', 'decrement']), expectedQuantity: z.number().int().min(0).max(100000), idempotencyKey: keySchema }).strict().parse(request.body);
    return changeAddon(store, a.tenant, { addon, action: body.action, expectedQuantity: body.expectedQuantity, operationKey: `manual:${a.actor.userId}:${body.idempotencyKey}`, source: 'manual', userId: a.actor.userId }, { stripe, assertCurrent: a.assertCurrent });
  }));
}
