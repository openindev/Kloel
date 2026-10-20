import type { Store } from '../store.js';

type Data = Record<string, any>;
/** Price of the "número extra" add-on (recurring, licensed, quantity = numbers). Line items with it are not plans. */
export const numberAddonPriceIds = () => String(process.env.NUMBER_ADDON_PRICE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
export const isNumberAddonItem = (item: Data | undefined) => !!item && numberAddonPriceIds().includes(String(item.price?.id ?? item.price));

/** Add-ons de Assinatura e faturamento: pacote somado por "+" (mesmas unidades da Fonio: "Adicionar 100 por R$ 90,00 / mês"). */
export const ADDON_PACKS = {
  minutes: { unit: 100, label: 'Minutos de ligação' }, outbound: { unit: 5, label: 'Créditos outbound' }, sms: { unit: 100, label: 'SMS' },
  numbers: { unit: 1, label: 'Números de telefone' }, workspaces: { unit: 1, label: 'Conexões de workspace' }, waNumbers: { unit: 1, label: 'Número WhatsApp' },
  waConversations: { unit: 20, label: 'Conversas do WhatsApp' }, chatConversations: { unit: 100, label: 'Conversas do Chatbot de IA' }, waActions: { unit: 100, label: 'Mensagens de ação do WhatsApp' },
} as const;
export type AddonKey = keyof typeof ADDON_PACKS;
export const ADDON_KEYS = Object.keys(ADDON_PACKS) as AddonKey[];
/**
 * Preços Stripe já existentes de cada add-on: STRIPE_ADDON_PRICE_IDS="minutes:price_…,outbound:price_…" (recorrente, licenciado,
 * quantidade = pacotes). O número extra também vale por NUMBER_ADDON_PRICE_IDS. O motor nunca cria preço.
 */
export function addonPriceIds(): Partial<Record<AddonKey, string>> {
  const out: Partial<Record<AddonKey, string>> = {};
  for (const pair of String(process.env.STRIPE_ADDON_PRICE_IDS || '').split(',')) {
    const [key, price] = pair.split(':').map(s => s.trim());
    if (key && Object.hasOwn(ADDON_PACKS, key) && /^price_[A-Za-z0-9]+$/.test(price ?? '') && !out[key as AddonKey]) out[key as AddonKey] = price;
  }
  if (!out.numbers && numberAddonPriceIds()[0]) out.numbers = numberAddonPriceIds()[0];
  return out;
}
const itemPrice = (item: Data) => String(item.price?.id ?? item.price);
export const isAddonItem = (item: Data | undefined) => !!item && (isNumberAddonItem(item) || Object.values(addonPriceIds()).includes(itemPrice(item)));
/** Itens de add-on (número extra e os da página de cobrança) nunca contam como plano. */
export const planItems = (items: unknown) => (Array.isArray(items) ? items as Data[] : []).filter(i => !isAddonItem(i));
const ms = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v * 1000 : null;

/**
 * Espelho local ('billing-addons', uma linha por org) das quantidades de add-on da assinatura Stripe do plano, com o período do item do plano.
 * Chamado pela compra (após reler a assinatura) e pelo webhook. Uma assinatura antiga encerrada nunca apaga o espelho da assinatura vigente.
 */
export function syncBillingAddons(store: Store, tenant: string, subscription: Data) {
  if (typeof subscription?.id !== 'string') return;
  const prices = addonPriceIds(), items = Array.isArray(subscription.items?.data) ? subscription.items.data as Data[] : [];
  const live = ['active', 'trialing', 'past_due'].includes(String(subscription.status)), plan = planItems(items)[0];
  const quantities = Object.fromEntries(ADDON_KEYS.map(k => [k, live && prices[k] ? items.filter(i => itemPrice(i) === prices[k]).reduce((n, i) => n + Math.max(0, Math.trunc(Number(i.quantity) || 0)), 0) : 0]));
  const fields = { subscriptionId: subscription.id, status: String(subscription.status), quantities, planPriceId: plan?.price?.id ?? null,
    periodStart: ms(plan?.current_period_start ?? subscription.current_period_start), periodEnd: ms(plan?.current_period_end ?? subscription.current_period_end), syncedAt: new Date().toISOString() };
  const old = store.list(tenant, 'billing-addons')[0];
  if (!old) { if (live) store.create(tenant, 'billing-addons', fields); return; }
  if (old.subscriptionId !== subscription.id && !live && ['active', 'trialing', 'past_due'].includes(String(old.status))) return;
  store.update(tenant, 'billing-addons', old.id, { ...fields, ...(old.planPriceId === fields.planPriceId && old.plan ? { plan: old.plan } : { plan: null }) });
}
