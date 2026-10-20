import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { requireRequestPermission } from '../memberships/access.js';
import { MembershipError } from '../memberships/service.js';
import { planSnapshot } from '../billing/plans.js';
import { chargeExtraNumber } from './addon.js';
import { numberProviders, NumberProviderError, type NumberProviderName, type PurchasedNumber } from './providers.js';
import { numberAddonPriceIds } from '../billing/addons.js';
import { ManagedNumberError, MANAGED_SOURCES, registerManagedNumbers, routeKey } from './manage.js';
import { sipBackend } from './sip.js';

const collection = 'phone-numbers', operations = 'number-purchase-operations';
export class NumberError extends Error { constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); } }
const fail = (status: number, code: string, message: string): never => { throw new NumberError(status, code, message); };

/** Allowance = numbers included by the plan (NUMBER_PLAN_ALLOWANCE {"planId":n}) + paid add-on units ('number-addons'). */
export function numberAllowance(store: Store, tenant: string) {
  const plan = planSnapshot(store, tenant);
  const map = (() => { try { return JSON.parse(process.env.NUMBER_PLAN_ALLOWANCE || '{}') as Record<string, number>; } catch { return {}; } })();
  // QA-only internal grant ('qa-plan-grants', qa:true, status active, not expired): treats the org as on a paid plan for
  // number allowance only. No Stripe/billing state is touched. Revert: set status:'revoked' (or delete the record).
  const qaGrant = store.list(tenant, 'qa-plan-grants').find(g => g.qa === true && g.status === 'active' && (!g.expiresAt || Date.parse(String(g.expiresAt)) > Date.now()));
  const planId = plan.planId ?? (qaGrant ? String(qaGrant.planId || 'qa-internal') : null);
  const paid = (plan.planId !== null && (!plan.enforced || plan.state === 'eligible')) || !!qaGrant;
  const included = paid ? Math.max(0, Math.trunc(Number(map[String(planId)] ?? map.default ?? 1))) : 0;
  const extra = store.list(tenant, 'number-addons').filter(a => a.status === 'active').reduce((sum, a) => sum + Math.max(0, Math.trunc(Number(a.quantity) || 0)), 0);
  const owned = store.list(tenant, collection).filter(n => n.source === 'platform_purchase');
  const usedIncluded = owned.filter(n => n.allowance === 'included').length, usedExtra = owned.filter(n => n.allowance === 'extra').length;
  return { planId, paid, qaGrant: !!qaGrant, included, extra, usedIncluded, usedExtra, remainingIncluded: Math.max(0, included - usedIncluded), remainingExtra: Math.max(0, extra - usedExtra) };
}
/**
 * What the platform still lacks to sell numbers, in plain pt-BR (shown to the owner instead of a generic "em breve").
 * `missing` blocks every purchase; `extraMissing` only blocks numbers beyond the plan (Twilio + Stripe add-on price).
 */
export function purchaseConfig() {
  const included = numberProviders.didlogic.configured() || numberProviders.twilio.configured();
  const missing = [
    ...(process.env.NUMBER_PURCHASE_ENABLED === '1' ? [] : ['ativação da venda de números (NUMBER_PURCHASE_ENABLED=1)']),
    ...(included ? [] : numberProviders.twilio.missing()),
  ];
  const extraMissing = [
    ...numberProviders.twilio.missing(),
    ...(numberAddonPriceIds().length ? [] : ['preço mensal do número extra no Stripe (NUMBER_ADDON_PRICE_IDS)']),
    ...(process.env.STRIPE_SECRET_KEY?.trim() ? [] : ['cobrança Stripe (STRIPE_SECRET_KEY)']),
  ];
  return { missing, extraMissing };
}
/** SIP numbers: any paid plan, or only the plans listed in NUMBER_SIP_PLAN_IDS (plan ids / Stripe price ids, comma-separated). */
export function sipAccess(store: Store, tenant: string) {
  const a = numberAllowance(store, tenant), only = String(process.env.NUMBER_SIP_PLAN_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  return { allowed: a.paid && (!only.length || a.qaGrant || only.includes(String(a.planId))), paid: a.paid };
}
export function numberOffer(store: Store, tenant: string) {
  const allowance = numberAllowance(store, tenant), config = purchaseConfig(), sip = sipAccess(store, tenant), sipMissing = sipBackend.current.missing();
  return {
    enabled: config.missing.length === 0,
    missing: config.missing, extraMissing: config.extraMissing,
    allowance,
    extraMonthlyPriceBRL: Number(process.env.NUMBER_EXTRA_PRICE_BRL || 49),
    providers: { included: { provider: 'didlogic', configured: numberProviders.didlogic.configured() }, extra: { provider: 'twilio', configured: numberProviders.twilio.configured() } },
    sip: { allowed: sip.allowed, configured: sipMissing.length === 0, missing: sipMissing, originationHost: sipBackend.current.originationHost() },
  };
}
function nextAllowance(store: Store, tenant: string): { allowance: 'included' | 'extra'; provider: NumberProviderName } {
  const a = numberAllowance(store, tenant);
  // Included number: DIDlogic when configured, otherwise the Twilio BR bundle so paid orgs are never blocked.
  if (a.remainingIncluded > 0) return { allowance: 'included', provider: numberProviders.didlogic.configured() ? 'didlogic' : 'twilio' };
  if (a.remainingExtra > 0) return { allowance: 'extra', provider: 'twilio' };
  return fail(402, a.paid ? 'number_addon_required' : 'plan_required', a.paid ? 'Todos os números do seu plano estão em uso. Adicione números extras em Assinatura e faturamento.' : 'Assine um plano para adquirir um número.');
}

/** Buys one number for the tenant and records it bound to the agent. Idempotent per (tenant, key). */
export async function purchaseNumber(store: Store, tenant: string, input: { ddd?: string; phoneNumber?: string; agentId?: string | null; name?: string; key: string }, actor: { userId: string } | null, assertAccess: () => void = () => {}) {
  if (process.env.NUMBER_PURCHASE_ENABLED !== '1') fail(503, 'number_purchase_disabled', `A venda de números não está ativada nesta plataforma. Falta: ${purchaseConfig().missing.join('; ')}.`);
  const opId = createHash('sha256').update(`${tenant}:${input.key}`).digest('hex').slice(0, 32);
  const prior = store.list(tenant, operations).find(o => o.opId === opId);
  if (prior?.status === 'succeeded') return store.get(tenant, collection, String(prior.numberId));
  if (prior?.status === 'pending') fail(409, 'number_purchase_in_progress', 'Esta compra já está em andamento.');
  if (input.agentId && store.get(tenant, 'agents', input.agentId)?.status === undefined) fail(404, 'agent_not_found', 'Assistente não encontrado.');
  const choice = nextAllowance(store, tenant), provider = numberProviders[choice.provider];
  if (!provider.configured()) fail(503, `${choice.provider}_not_configured`, choice.provider === 'didlogic' ? 'O provedor do número incluído ainda não está configurado.' : 'O provedor de números extras ainda não está configurado.');
  const op = store.create(tenant, operations, { opId, status: 'pending', provider: choice.provider, allowance: choice.allowance, requestedBy: actor?.userId ?? 'system', ddd: input.ddd ?? null });
  let bought: PurchasedNumber;
  try { assertAccess(); bought = await provider.purchase({ ddd: input.ddd, phoneNumber: input.phoneNumber, friendlyName: `kloel:${tenant.slice(0, 8)}` }); }
  catch (error) { store.update(tenant, operations, op.id, { status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }); throw error; }
  // DIDlogic delivers to the LiveKit SIP host: the number gets its own inbound trunk + `kloel-tw-` dispatch rule so the voice
  // worker resolves this org/assistant through number-route (Twilio numbers arrive by the platform Elastic SIP trunk).
  let route: { trunkId: string; dispatchRuleId: string } | null = null;
  if (bought.provider === 'didlogic' && !sipBackend.current.missing().length) {
    const allowed = String(process.env.DIDLOGIC_SIP_ALLOWED_ADDRESSES || '').split(',').map(x => x.trim()).filter(Boolean);
    route = await sipBackend.current.createInbound({ number: bought.phoneNumber, label: bought.phoneNumber, tenantId: tenant, allowedAddresses: allowed }).catch(e => { console.log('didlogic_route_failed', e instanceof Error ? e.message.slice(0, 120) : 'unknown'); return null; });
  }
  const number = store.create(tenant, collection, {
    name: (input.name?.trim() || `Número ${bought.phoneNumber.slice(3, 5)}`).slice(0, 200), number: bought.phoneNumber, provider: bought.provider, providerNumberId: bought.providerNumberId,
    agentId: input.agentId ?? null, channelId: null, capabilities: ['voice'], provisioningStatus: 'unverified', revision: 1, source: 'platform_purchase',
    ...(bought.provider === 'twilio' ? { ownership: { source: 'twilio', checkedAt: new Date().toISOString(), scope: 'registration' } } : {}), allowance: choice.allowance,
    locality: bought.locality, monthlyCostUsd: bought.monthlyCostUsd, purchasedAt: new Date().toISOString(),
    ...(route ? { sip: { inboundTrunkId: route.trunkId, dispatchRuleId: route.dispatchRuleId } } : {}),
  });
  store.update(tenant, operations, op.id, { status: 'succeeded', numberId: number.id });
  return number;
}

/** Called when a tenant's paid plan becomes active (billing webhook) and by the owner from the app. */
export async function provisionIncludedNumber(store: Store, tenant: string, options: { ddd?: string } = {}) {
  const a = numberAllowance(store, tenant);
  if (a.remainingIncluded <= 0) return null;
  const agent = store.list(tenant, 'agents').find(x => x.status === 'active') ?? store.list(tenant, 'agents')[0];
  return purchaseNumber(store, tenant, { ddd: options.ddd, agentId: agent?.id ?? null, key: `included:${a.usedIncluded + 1}` }, null);
}

/**
 * Resolves the org/agent for an inbound call (used by the voice runtime over SIP): phone numbers by digits, SIP numbers by
 * their name ("recepcao", "sip:recepcao@host"). Imported numbers are outbound-only and never route. For numbers Kloel
 * manages, `assigned:false` tells the worker the owner unlinked the assistant ("Sem vinculação"): the call is not answered.
 */
export function routeInboundNumber(store: Store, to: string) {
  const key = routeKey(to); if (!key) return null;
  const rows = store.db.prepare("SELECT e.tenant_id AS tenant, e.body FROM entities e JOIN organizations o ON o.id=e.tenant_id AND o.status='active' WHERE e.collection=? ORDER BY e.rowid").all(collection) as { tenant: string; body: string }[];
  for (const r of rows) {
    const row = JSON.parse(r.body) as Entity;
    if (row.source === 'imported' || routeKey(row.number) !== key) continue;
    const agentId = typeof row.agentId === 'string' && store.get(r.tenant, 'agents', row.agentId) ? row.agentId : null;
    return { tenantId: r.tenant, numberId: row.id, agentId, provider: row.provider, ...((MANAGED_SOURCES as readonly string[]).includes(String(row.source)) ? { assigned: !!agentId } : {}) };
  }
  return null;
}

const internal = (req: FastifyRequest) => { const key = process.env.INTERNAL_TOKEN || '', got = String(req.headers['x-kloel-internal'] || ''); return !!key && got.length === key.length && timingSafeEqual(Buffer.from(got), Buffer.from(key)); };
function wrap(fn: (req: FastifyRequest, reply: FastifyReply) => unknown) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await fn(req, reply); }
    catch (e) {
      if (e instanceof NumberError || e instanceof NumberProviderError || e instanceof MembershipError || e instanceof ManagedNumberError) return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } });
      // Messages written in pt-BR in the schemas (SIP name, termination URL) reach the user; zod defaults do not.
      if (e instanceof z.ZodError) { const m = String(e.issues[0]?.message ?? ''); return reply.code(400).send({ error: { code: 'validation_error', message: /^(O número|Use apenas|URL de terminação|Nada para)/.test(m) ? m : 'Dados inválidos.' } }); }
      throw e;
    }
  };
}
export async function registerNumbers(app: FastifyInstance, store: Store) {
  app.get('/api/v1/numbers/offer', wrap(req => numberOffer(store, requireRequestPermission(store, req, 'phones:read').tenantId)));
  app.get('/api/v1/numbers/search', wrap(async req => {
    const actor = requireRequestPermission(store, req, 'phones:read');
    const q = z.object({ ddd: z.string().regex(/^[1-9]\d$/).optional(), limit: z.coerce.number().int().min(1).max(30).default(10) }).strict().parse(req.query);
    // Sem plano (só consulta) ou plano pago sem saldo: a busca segue liberada (número extra Twilio); a compra cobra o add-on antes.
    const al = numberAllowance(store, actor.tenantId);
    const choice: { allowance: 'included' | 'extra'; provider: NumberProviderName } = !al.paid || (al.remainingIncluded <= 0 && al.remainingExtra <= 0) ? { allowance: al.paid ? 'extra' : 'included', provider: al.paid ? 'twilio' : (numberProviders.didlogic.configured() ? 'didlogic' : 'twilio') } : nextAllowance(store, actor.tenantId);
    const provider = numberProviders[choice.provider];
    if (!provider.configured()) fail(503, `${choice.provider}_not_configured`, 'O provedor de números ainda não está configurado.');
    return { allowance: choice.allowance, provider: choice.provider, priceBRL: choice.allowance === 'extra' ? Number(process.env.NUMBER_EXTRA_PRICE_BRL || 49) : 0, items: await provider.search({ ddd: q.ddd, limit: q.limit }) };
  }));
  app.post('/api/v1/numbers/addon', wrap(async (req, reply) => {
    const actor = requireRequestPermission(store, req, 'billing:manage'); requireRequestPermission(store, req, 'phones:write');
    const body = z.object({ idempotencyKey: z.string().uuid() }).strict().parse(req.body);
    if (process.env.NUMBER_PURCHASE_ENABLED !== '1') fail(503, 'number_purchase_disabled', `A venda de números não está ativada nesta plataforma. Falta: ${purchaseConfig().missing.join('; ')}.`);
    const a = numberAllowance(store, actor.tenantId);
    if (!a.paid) fail(402, 'plan_required', 'Assine um plano para adquirir um número.');
    if (a.remainingIncluded > 0 || a.remainingExtra > 0) return reply.code(200).send({ status: 'active', alreadyAvailable: true });
    const origin = process.env.APP_ORIGIN?.trim() || `https://${String(req.headers.host ?? 'www.kloel.ai')}`;
    return reply.code(200).send(await chargeExtraNumber(store, actor.tenantId, body.idempotencyKey, origin));
  }));
  app.get('/api/v1/numbers/owned', wrap(req => {
    const tenant = requireRequestPermission(store, req, 'phones:read').tenantId, price = Number(process.env.NUMBER_EXTRA_PRICE_BRL || 49);
    return { items: store.list(tenant, collection).filter(n => n.source === 'platform_purchase').map(n => ({ id: n.id, number: n.number, name: n.name, provider: n.provider, agentId: n.agentId ?? null,
      locality: n.locality ?? null, allowance: n.allowance, monthlyPriceBRL: n.allowance === 'extra' ? price : 0, purchasedAt: n.purchasedAt ?? n.createdAt })) };
  }));
  app.post('/api/v1/numbers/purchase', wrap(async (req, reply) => {
    const actor = requireRequestPermission(store, req, 'phones:write'); requireRequestPermission(store, req, 'billing:manage');
    const body = z.object({ ddd: z.string().regex(/^[1-9]\d$/).optional(), phoneNumber: z.string().regex(/^\+55\d{10,11}$/).optional(), agentId: z.string().min(1).max(128).nullable().optional(), name: z.string().max(200).optional(), idempotencyKey: z.string().uuid(), dryRun: z.boolean().optional() }).strict().parse(req.body);
    if (body.dryRun) {
      // Verification only: same gates and provider lookup, nothing is bought or recorded.
      const choice = nextAllowance(store, actor.tenantId), provider = numberProviders[choice.provider];
      if (!provider.configured()) fail(503, `${choice.provider}_not_configured`, 'O provedor de números ainda não está configurado.');
      const pick = body.phoneNumber ? { phoneNumber: body.phoneNumber } : (await provider.search({ ddd: body.ddd, limit: 1 }))[0];
      if (!pick) fail(409, 'number_unavailable', 'Nenhum número disponível para este DDD.');
      return reply.code(200).send({ dryRun: true, enabled: process.env.NUMBER_PURCHASE_ENABLED === '1', allowance: choice.allowance, provider: choice.provider, number: pick!.phoneNumber, priceBRL: choice.allowance === 'extra' ? Number(process.env.NUMBER_EXTRA_PRICE_BRL || 49) : 0 });
    }
    const { dryRun: _dry, ...input } = body;
    const row = await purchaseNumber(store, actor.tenantId, { ...input, key: body.idempotencyKey }, actor, () => { requireRequestPermission(store, req, 'phones:write'); });
    return reply.code(201).send(row);
  }));
  app.get('/api/v1/internal/phone/number-route', wrap((req, reply) => {
    if (!internal(req)) return reply.code(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
    const { to } = z.object({ to: z.string().min(1).max(200) }).strict().parse(req.query);
    return routeInboundNumber(store, to) ?? reply.code(404).send({ error: { code: 'number_not_routed', message: 'Número sem roteamento.' } });
  }));
  registerManagedNumbers(app, store, fn => wrap(req => fn(req)), tenant => { const s = sipAccess(store, tenant); if (!s.allowed) fail(402, s.paid ? 'sip_plan_required' : 'plan_required', 'Seu plano atual não oferece complementos para esse recurso. Faça upgrade do seu plano.'); });
}
export type { Entity };
