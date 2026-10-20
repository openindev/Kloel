/**
 * Compra de add-ons (Fonio parity: "+"/"−" em Add-ons e "Compra automática de add-ons" em Assinatura e faturamento).
 * - Cada add-on é um item da MESMA assinatura Stripe do plano, com o preço já existente em STRIPE_ADDON_PRICE_IDS (nunca cria preço).
 *   "+" soma 1 pacote com proration_behavior=always_invoice e payment_behavior=error_if_incomplete: o proporcional é cobrado agora e,
 *   com pagamento recusado, a Stripe não altera a assinatura. "−" tira 1 pacote sem crédito (proration_behavior=none); em 0 o item sai.
 * - Toda alteração tem recibo durável ('billing-addon-operations') com a quantidade-alvo e chave idempotente na Stripe: repetir a mesma
 *   chave nunca soma outro pacote, e uma resposta perdida é reconhecida relendo a assinatura.
 * - Compra automática ('billing-addon-settings'.autoBuy): quando o uso medido no período da assinatura alcança a cota (incluída no
 *   plano + pacotes), compra 1 pacote. No máximo BILLING_AUTO_ADDON_MAX_PER_PERIOD (padrão 1) compras por add-on e período, com chave
 *   determinística por período: duas chamadas que terminam juntas nunca compram duas vezes.
 */
import { createHash } from 'node:crypto';
import type { Store } from '../store.js';
import { ADDON_PACKS, addonPriceIds, planItems, syncBillingAddons, type AddonKey } from './addons.js';
import { syncNumberAddons } from './webhook-followup.js';
import { kloelCatalogPlan } from '../providers/billing-catalog-metadata.js';

type Data = Record<string, any>;
export class AddonError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string, readonly uncertain = false) { super(message); }
}
const fail = (status: number, code: string, message: string, uncertain = false): never => { throw new AddonError(status, code, message, uncertain); };
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
export type StripeCall = (method: 'GET' | 'POST' | 'DELETE', path: string, form?: Record<string, string>, idempotencyKey?: string) => Promise<Data>;
export type AddonDeps = { stripe?: StripeCall; fetchImpl?: typeof fetch };

/** Stripe REST com fetch injetável (testes usam um fake; produção usa o fetch global). Nunca expõe a chave nem a resposta crua. */
export function stripeClient(fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)): StripeCall {
  return async (method, path, form, idempotencyKey) => {
    const key = process.env.STRIPE_SECRET_KEY?.trim(); if (!key) return fail(503, 'billing_not_configured', 'A cobrança ainda não está configurada no servidor (STRIPE_SECRET_KEY).');
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let res: Response;
    try { res = await fetchImpl(`https://api.stripe.com/v1${path}`, { method, headers, body: form ? new URLSearchParams(form).toString() : undefined, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { return fail(502, 'billing_unreachable', 'A Stripe não respondeu. Consulte os add-ons antes de tentar de novo.', true); }
    const body = await res.json().catch(() => ({})) as Data;
    if (!res.ok) {
      const card = body?.error?.type === 'card_error' || ['card_declined', 'subscription_payment_intent_requires_action', 'invoice_payment_intent_requires_action'].includes(String(body?.error?.code));
      console.log('billing_addon_stripe_error', res.status, String(body?.error?.code ?? body?.error?.type ?? '').slice(0, 60));
      return card ? fail(402, 'addon_payment_failed', 'O pagamento do add-on foi recusado. Atualize a forma de pagamento no portal financeiro e tente novamente.')
        : fail(502, 'addon_billing_failed', 'A Stripe não confirmou a alteração do add-on. Consulte os add-ons antes de tentar de novo.', res.status >= 500 || res.status === 429);
    }
    return body;
  };
}
const client = (deps: AddonDeps = {}) => deps.stripe ?? stripeClient(deps.fetchImpl);

/** Assinatura vigente (ativa/em teste) do cliente Stripe da org que contém o plano; sem ela não há onde cobrar add-on. */
export async function planSubscription(store: Store, tenant: string, stripe: StripeCall): Promise<Data | undefined> {
  const customer = store.list(tenant, 'billing-accounts')[0]?.customerId;
  if (typeof customer !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(customer)) return undefined;
  const list = await stripe('GET', `/subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=20`);
  return (Array.isArray(list.data) ? list.data as Data[] : []).filter(s => typeof s?.id === 'string' && s.customer === customer && ['active', 'trialing'].includes(String(s.status)) && planItems(s.items?.data).length > 0)
    .sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0))[0];
}
export const addonSettings = (store: Store, tenant: string) => store.list(tenant, 'billing-addon-settings')[0];
export function setAutoBuy(store: Store, tenant: string, autoBuy: boolean, userId: string) {
  const old = addonSettings(store, tenant), fields = { autoBuy, updatedBy: userId };
  return old ? store.update(tenant, 'billing-addon-settings', old.id, fields)! : store.create(tenant, 'billing-addon-settings', fields);
}
export const autoBuyCap = () => { const n = Math.trunc(Number(process.env.BILLING_AUTO_ADDON_MAX_PER_PERIOD ?? 1)); return Number.isSafeInteger(n) && n >= 0 && n <= 20 ? n : 1; };
const OPS = 'billing-addon-operations';
export const quantityOf = (subscription: Data, price: string) => (Array.isArray(subscription.items?.data) ? subscription.items.data as Data[] : []).filter(i => String(i.price?.id ?? i.price) === price).reduce((n, i) => n + Math.max(0, Math.trunc(Number(i.quantity) || 0)), 0);
/** Espelha add-ons e número extra da assinatura relida (mesma sincronização do webhook). */
export const mirror = (store: Store, tenant: string, subscription: Data) => store.transaction(() => { syncBillingAddons(store, tenant, subscription); syncNumberAddons(store, tenant, subscription); });

export type AddonChange = { addon: AddonKey; action: 'increment' | 'decrement'; operationKey: string; source: 'manual' | 'auto'; expectedQuantity?: number; userId?: string };
/**
 * Soma/tira 1 pacote na assinatura do plano. `assertCurrent` (autoridade da sessão) roda antes e depois da escrita na Stripe;
 * o recibo guarda o efeito observado mesmo quando a sessão muda durante a chamada.
 */
export async function changeAddon(store: Store, tenant: string, input: AddonChange, deps: AddonDeps & { subscription?: Data; assertCurrent?: () => void } = {}) {
  const stripe = client(deps), assertCurrent = deps.assertCurrent ?? (() => {}), label = ADDON_PACKS[input.addon].label;
  const price = addonPriceIds()[input.addon] ?? fail(503, 'addon_not_configured', `A venda de “${label}” ainda não foi configurada: falta o preço Stripe deste add-on (STRIPE_ADDON_PRICE_IDS).`);
  const fingerprint = sha(JSON.stringify([input.addon, input.action, input.source, input.expectedQuantity ?? null, input.userId ?? null]));
  let op = store.list(tenant, OPS).find(r => r.operationKey === input.operationKey);
  if (op && op.fingerprint !== fingerprint) fail(409, 'idempotency_conflict', 'Chave já utilizada com outros dados.');
  if (op?.status === 'succeeded') return { addon: input.addon, quantity: Number(op.quantity), replayed: true };
  const subscription = deps.subscription ?? await planSubscription(store, tenant, stripe);
  if (!subscription) return fail(409, 'addon_subscription_required', 'Os add-ons são cobrados junto da assinatura. Contrate um plano antes de adicionar add-ons.');
  assertCurrent();
  const current = quantityOf(subscription, price), item = (subscription.items?.data as Data[] ?? []).find(i => String(i.price?.id ?? i.price) === price);
  let target: number;
  if (op && op.subscriptionId === subscription.id && Number.isSafeInteger(op.target)) {
    target = Number(op.target);
    // Resposta perdida de uma tentativa anterior: a assinatura já mostra o alvo, então nada é reenviado.
    if (current === target) { mirror(store, tenant, subscription); store.update(tenant, OPS, op.id, { status: 'succeeded', quantity: target }); return { addon: input.addon, quantity: target, replayed: true }; }
  } else {
    if (input.expectedQuantity !== undefined && input.expectedQuantity !== current) fail(409, 'addon_quantity_changed', 'A quantidade deste add-on mudou. Confira o valor atualizado antes de continuar.');
    if (input.action === 'decrement' && current <= 0) fail(409, 'addon_not_active', `“${label}” não está ativo na assinatura.`);
    target = input.action === 'increment' ? current + 1 : current - 1;
    const fields = { operationKey: input.operationKey, fingerprint, addon: input.addon, action: input.action, source: input.source, userId: input.userId ?? null, priceId: price, subscriptionId: subscription.id, target, status: 'pending' };
    op = op ? store.update(tenant, OPS, op.id, fields)! : store.create(tenant, OPS, fields);
  }
  const opId = op!.id, key = (step: string) => `kloel-addon:${sha(`${tenant}:${input.operationKey}:${subscription.id}:${target}:${step}`).slice(0, 48)}`;
  try {
    if (!item) await stripe('POST', '/subscription_items', { subscription: String(subscription.id), price, quantity: String(target), proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' }, key('create'));
    else if (target === 0) await stripe('DELETE', `/subscription_items/${encodeURIComponent(String(item.id))}`, { proration_behavior: 'none' }, key('delete'));
    else await stripe('POST', `/subscription_items/${encodeURIComponent(String(item.id))}`, input.action === 'increment' ? { quantity: String(target), proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' } : { quantity: String(target), proration_behavior: 'none' }, key('update'));
  } catch (error) {
    const uncertain = !(error instanceof AddonError) || error.uncertain;
    store.update(tenant, OPS, opId, { status: uncertain ? 'unknown' : 'failed', errorCode: error instanceof AddonError ? error.code : 'addon_billing_failed' });
    throw error;
  }
  const fresh = await stripe('GET', `/subscriptions/${encodeURIComponent(String(subscription.id))}`).catch(() => undefined);
  const confirmed = fresh?.id === subscription.id ? fresh : undefined, quantity = confirmed ? quantityOf(confirmed, price) : target;
  if (confirmed) mirror(store, tenant, confirmed);
  store.update(tenant, OPS, opId, { status: 'succeeded', quantity });
  assertCurrent();
  return { addon: input.addon, quantity, replayed: false };
}

/** Cota incluída no plano (mesmos números do catálogo de planos do app) para os add-ons medidos no motor. */
const INCLUDED: Partial<Record<AddonKey, { product: string; tiers: Record<string, number> }>> = {
  minutes: { product: 'voice', tiers: { solo: 1000, team: 3600 } },
  waConversations: { product: 'whatsapp', tiers: { solo: 450, team: 2000 } },
  chatConversations: { product: 'webchat', tiers: { solo: 100, team: 400 } },
};
export const AUTO_BUY_ADDONS = Object.keys(INCLUDED) as AddonKey[];
/** Uso medido no período: minutos cobráveis (ligações por telefone, cada uma arredondada para cima) e conversas por canal. */
export function measuredUsage(store: Store, tenant: string, addon: AddonKey, from: number, to: number) {
  const inPeriod = (c: Data) => { const at = Date.parse(String(c.startedAt ?? c.createdAt)); return Number.isFinite(at) && at >= from && at < to; };
  const convs = store.list(tenant, 'conversations').filter(inPeriod);
  if (addon === 'minutes') return convs.filter(c => c.channel === 'phone').reduce((n, c) => n + Math.ceil(Math.max(0, Number(c.durationSeconds) || 0) / 60), 0);
  if (addon === 'waConversations') return convs.filter(c => c.channel === 'whatsapp').length;
  if (addon === 'chatConversations') return convs.filter(c => c.channel === 'webchat').length;
  return 0;
}
async function planOf(store: Store, tenant: string, row: Data, stripe: StripeCall) {
  if (row.plan && typeof row.plan.product === 'string') return row.plan as { product: string; tier: string };
  if (typeof row.planPriceId !== 'string') return null;
  const plan = kloelCatalogPlan(await stripe('GET', `/prices/${encodeURIComponent(row.planPriceId)}?expand%5B%5D=product`));
  if (plan) store.update(tenant, 'billing-addons', row.id, { plan: { product: plan.product, tier: plan.tier } });
  return plan;
}
export type AutoBuyResult = { status: 'disabled' | 'not_configured' | 'no_subscription' | 'plan_mismatch' | 'below_quota' | 'cap_reached' | 'in_progress' | 'purchased'; quantity?: number; used?: number; quota?: number };
/**
 * Caminho do uso: chamado depois que o consumo muda (fim de ligação etc.). Sem a opção ligada, sem preço ou abaixo da cota,
 * não fala com a Stripe além de, no máximo, reler a assinatura quando o espelho local está ausente ou com período vencido.
 */
export async function autoBuyAddon(store: Store, tenant: string, addon: AddonKey, deps: AddonDeps & { now?: number } = {}): Promise<AutoBuyResult> {
  const included = INCLUDED[addon], now = deps.now ?? Date.now();
  if (addonSettings(store, tenant)?.autoBuy !== true) return { status: 'disabled' };
  if (!included || !addonPriceIds()[addon]) return { status: 'not_configured' };
  const stripe = client(deps);
  let row = store.list(tenant, 'billing-addons')[0] as Data | undefined, subscription: Data | undefined;
  const stale = !row || !['active', 'trialing'].includes(String(row.status)) || !Number.isSafeInteger(row.periodStart) || !Number.isSafeInteger(row.periodEnd) || row.periodEnd <= now || row.periodStart > now;
  if (stale) {
    subscription = await planSubscription(store, tenant, stripe); if (!subscription) return { status: 'no_subscription' };
    mirror(store, tenant, subscription); row = store.list(tenant, 'billing-addons')[0] as Data | undefined;
    if (!row || !Number.isSafeInteger(row.periodStart) || !Number.isSafeInteger(row.periodEnd)) return { status: 'no_subscription' };
  }
  const plan = await planOf(store, tenant, row!, stripe), base = plan?.product === included.product ? included.tiers[plan.tier] : undefined;
  if (base === undefined) return { status: 'plan_mismatch' };
  const used = measuredUsage(store, tenant, addon, row!.periodStart, row!.periodEnd), quota = base + Number(row!.quantities?.[addon] ?? 0) * ADDON_PACKS[addon].unit;
  if (used < quota) return { status: 'below_quota', used, quota };
  // Reserva atômica da compra do período: chave determinística por (add-on, assinatura, início do período, ordem).
  const period = `${row!.subscriptionId}:${row!.periodStart}`, cap = autoBuyCap();
  const reserved = store.transaction(() => {
    const previous = store.list(tenant, OPS).filter(r => r.source === 'auto' && r.addon === addon && r.period === period);
    const open = previous.find(r => ['reserved', 'pending', 'unknown'].includes(String(r.status)));
    // Resultado desconhecido (ou tentativa parada há 10 min) é retomado com a MESMA chave; em andamento, ninguém compra outra vez.
    if (open) return open.status === 'unknown' || Date.parse(String(open.updatedAt)) < Date.now() - 600000 ? store.update(tenant, OPS, open.id, { status: 'reserved' })! : 'in_progress' as const;
    if (previous.length >= cap) return 'cap_reached' as const;
    return store.create(tenant, OPS, { operationKey: `auto:${addon}:${period}:${previous.length}`, addon, source: 'auto', period, status: 'reserved', used, quota });
  });
  if (typeof reserved === 'string') return { status: reserved, used, quota };
  subscription ??= await planSubscription(store, tenant, stripe);
  if (!subscription || subscription.id !== row!.subscriptionId) { store.update(tenant, OPS, reserved.id, { status: 'failed', errorCode: 'subscription_changed' }); return { status: 'no_subscription' }; }
  store.update(tenant, OPS, reserved.id, { fingerprint: sha(JSON.stringify([addon, 'increment', 'auto', null, null])) });
  const result = await changeAddon(store, tenant, { addon, action: 'increment', operationKey: String(reserved.operationKey), source: 'auto' }, { stripe, subscription });
  console.log('billing_addon_auto_purchased', tenant.slice(0, 8), addon, result.quantity);
  return { status: 'purchased', quantity: result.quantity, used, quota };
}
/** Gancho do caminho do uso: nunca lança nem bloqueia quem chamou (fim de ligação, worker). */
export function autoBuyAfterUsage(store: Store, tenant: string, addon: AddonKey, deps: AddonDeps = {}) {
  if (!tenant || addonSettings(store, tenant)?.autoBuy !== true) return Promise.resolve<AutoBuyResult>({ status: 'disabled' });
  return autoBuyAddon(store, tenant, addon, deps).catch(error => { console.log('billing_addon_auto_failed', tenant.slice(0, 8), addon, error instanceof Error ? error.message.slice(0, 160) : 'error'); return { status: 'in_progress' } as AutoBuyResult; });
}
