import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { resolveSessionActor } from '../memberships/service.js';
import { assertRequestContext } from '../request-context.js';
import { hasPermission } from '../memberships/permissions.js';
import { planSnapshot } from '../billing/plans.js';
import { publicGrants } from '../billing/grants.js';
import { usagePage } from '../billing/usage.js';
import { BillingError, publicSubscription, reconcileStripeBilling } from './billing.js';
import { kloelCatalogPlan } from './billing-catalog-metadata.js';
import { providerAllowedForTenant, platformProvidersEnabled } from '../platform-providers.js';
import { registerBillingAddons } from './billing-addons.js';

type Data = Record<string, any>;
type Dependencies = {
  upstream: (url: string, init: RequestInit, provider: string) => Promise<Data>;
  stripeRequest: (secret: string, body: Record<string, string>, key: string) => RequestInit;
  stripeHostedSession: (response: Data, checkout: boolean) => Data;
};
const digest = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const keySchema = z.string().min(8).max(128).regex(/^[a-zA-Z0-9_.:-]+$/);
const operationSchema = z.enum(['stripe.checkout', 'stripe.portal']);
function fail(status: number, code: string, message: string): never { throw new BillingError(status, code, message); }
const required = (name: string) => process.env[name]?.trim() || fail(503, 'integration_not_configured', `Configure ${name} no servidor.`);
const configHash = () => digest(['PROVIDER_TENANT_ID', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_IDS', 'APP_ORIGIN', 'BILLING_RETURN_URL', 'STRIPE_BILLING_RETURN_URL'].map(k => process.env[k] ?? ''));
const allowedPrices = () => {
  const ids = [...new Set(required('STRIPE_PRICE_IDS').split(',').map(s => s.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 50 || ids.some(id => !/^price_[A-Za-z0-9]+$/.test(id))) fail(503, 'billing_catalog_invalid', 'Configure até 50 preços Stripe válidos.');
  return ids;
};
function returnUrl(): string {
  const override = process.env.STRIPE_BILLING_RETURN_URL?.trim();
  if (override) {
    let target: URL;
    try { target = new URL(override); } catch { return fail(503, 'billing_return_invalid', 'Endereço de retorno da cobrança inválido.'); }
    if (target.username || target.password || target.search || target.hash || target.pathname !== '/app/billing' || !(target.protocol === 'https:' || target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) return fail(503, 'billing_return_invalid', 'Endereço de retorno da cobrança inválido.');
    return target.toString();
  }
  let origin: URL, target: URL;
  try { origin = new URL(required('APP_ORIGIN')); target = new URL(process.env.BILLING_RETURN_URL || '/billing', origin.origin); }
  catch { return fail(503, 'billing_return_invalid', 'Endereço de retorno da cobrança inválido.'); }
  const safe = (u: URL) => !u.username && !u.password && !u.search && !u.hash && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  if (!safe(origin) || !safe(target) || target.origin !== origin.origin || !['/billing', '/app/billing'].includes(target.pathname)) fail(503, 'billing_return_invalid', 'Use um retorno de cobrança na origem configurada.');
  return target.toString();
}
function hostedUrl(value: unknown, checkout: boolean): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === (checkout ? 'checkout.stripe.com' : 'billing.stripe.com') && !u.username && !u.password && !u.port ? value : null; } catch { return null; }
}
const activeSubscription = (store: Store, tenant: string) => store.list(tenant, 'subscriptions').some(s => !['canceled', 'incomplete_expired'].includes(String(s.status)));

export async function registerBillingOperator(app: FastifyInstance, store: Store, deps: Dependencies) {
  function authority(request: FastifyRequest, requireBinding = true) {
    assertRequestContext(store, request);
    if (request.apiKey || request.headers.authorization || !request.cookies?.kloel_session) fail(403, 'billing_human_session_required', 'Use uma sessão humana para gerenciar cobrança.');
    const sessionHash = digest(request.cookies.kloel_session), actor = resolveSessionActor(store, sessionHash);
    if (!actor || actor.userId !== request.actor?.userId || actor.tenantId !== request.actor?.tenantId || actor.role !== request.actor?.role || !hasPermission(actor.role, 'billing:manage')) fail(403, 'forbidden', 'Sessão e permissão de cobrança vigentes obrigatórias.');
    const member = store.db.prepare('SELECT id FROM memberships WHERE user_id=? AND tenant_id=?').get(actor.userId, actor.tenantId)?.id;
    const configuration = configHash();
    if (requireBinding && !providerAllowedForTenant(actor.tenantId)) fail(403, 'provider_tenant_mismatch', 'Este provedor não está vinculado à organização.');
    const assertCurrent = () => {
      assertRequestContext(store, request);
      const current = resolveSessionActor(store, sessionHash);
      const currentMember = store.db.prepare('SELECT id FROM memberships WHERE user_id=? AND tenant_id=?').get(actor.userId, actor.tenantId)?.id;
      if (!current || current.userId !== actor.userId || current.tenantId !== actor.tenantId || current.role !== actor.role || currentMember !== member || !hasPermission(current.role, 'billing:manage')) fail(403, 'forbidden', 'A sessão ou permissão de cobrança mudou.');
      if (configHash() !== configuration) fail(409, 'billing_configuration_changed', 'A configuração da cobrança mudou. Consulte o estado atual.');
    };
    return { tenant: actor.tenantId, actor, member, configuration, sessionHash, assertCurrent };
  }
  type Authority = ReturnType<typeof authority>;
  const safe = (handler: (request: FastifyRequest) => unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    try { return await handler(request); } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira os dados da cobrança.' } });
      if (error && typeof error === 'object' && 'statusCode' in error && 'code' in error && 'message' in error && typeof error.statusCode === 'number' && typeof error.code === 'string') return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      return reply.code(502).send({ error: { code: 'billing_operation_failed', message: 'Não foi possível confirmar a operação de cobrança. Consulte a mesma tentativa.' } });
    }
  };
  const stripeGet = (secret: string, path: string) => deps.upstream(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${secret}` } }, 'Stripe');
  function matchesAuthority(row: Entity, a: Authority) { return row.operatorUserId === a.actor.userId && row.operatorMembershipId === a.member && row.operatorSessionHash === a.sessionHash && row.configurationHash === a.configuration; }
  function checkoutResult(record: Entity, tenant: string): Data | undefined {
    const value = record.result as Data | undefined;
    if (record.configurationHash !== configHash() || record.status !== 'open' || activeSubscription(store, tenant) ||
        record.accountBinding !== digest(store.list(tenant, 'billing-accounts')) ||
        !Number.isSafeInteger(record.expiresAt) || Number(record.expiresAt) * 1000 <= Date.now() ||
        !value || value.sessionId !== record.sessionId || value.expiresAt !== record.expiresAt ||
        !['paid', 'unpaid', 'no_payment_required'].includes(value.paymentStatus) || !hostedUrl(value.url, true)) return undefined;
    return { sessionId: value.sessionId, url: value.url, expiresAt: value.expiresAt, paymentStatus: value.paymentStatus };
  }
  function resultFor(row: Entity, tenant: string): Data | undefined {
    const value = row.result as Data | undefined, checkout = row.operation === 'stripe.checkout';
    if (!value || !hostedUrl(value.url, checkout) || typeof value.sessionId !== 'string' || !(checkout ? /^cs_[A-Za-z0-9_]+$/ : /^bps_[A-Za-z0-9_]+$/).test(value.sessionId)) return undefined;
    if (checkout) {
      const record = store.list(tenant, 'billing-checkouts').find(c => c.sessionId === value.sessionId);
      return record ? checkoutResult(record, tenant) : undefined;
    }
    const account = store.list(tenant, 'billing-accounts')[0];
    if (!account || row.providerAccountId !== account.id || row.providerCustomerId !== account.customerId) return undefined;
    return { sessionId: value.sessionId, url: value.url };
  }
  function operationView(row: Entity, tenant: string) {
    const result = row.status === 'succeeded' ? resultFor(row, tenant) : undefined;
    return { operation: row.operation, status: row.status, errorCode: typeof row.errorCode === 'string' ? row.errorCode : null, ...(result ? { result } : {}), requiresReconciliation: ['pending', 'unknown'].includes(String(row.status)) };
  }
  async function once(a: Authority, operation: 'stripe.checkout' | 'stripe.portal', key: string, body: unknown, effect: (upstreamKey: string, markStarted: () => void) => Promise<Data>) {
    const fingerprint = digest(body);
    const old = store.list(a.tenant, 'provider-operations').find(r => r.operation === operation && r.key === key);
    if (old) {
      if (!matchesAuthority(old, a)) fail(403, 'billing_operation_forbidden', 'Esta tentativa pertence a outra autorização.');
      if (old.fingerprint !== fingerprint) fail(409, 'idempotency_conflict', 'Chave já utilizada com outros dados.');
      a.assertCurrent(); const result = old.status === 'succeeded' ? resultFor(old, a.tenant) : undefined;
      if (result) return result;
      fail(409, 'operation_requires_reconciliation', 'A tentativa já foi iniciada. Consulte o estado antes de criar outra.');
    }
    const account = store.list(a.tenant, 'billing-accounts')[0];
    const receipt = store.create(a.tenant, 'provider-operations', { operation, key, fingerprint, status: 'pending', operatorUserId: a.actor.userId, operatorMembershipId: a.member, operatorSessionHash: a.sessionHash, configurationHash: a.configuration,
      ...(operation === 'stripe.portal' ? { providerAccountId: account?.id ?? null, providerCustomerId: account?.customerId ?? null } : {}) });
    let started = false, completed = false;
    try {
      a.assertCurrent();
      const result = await effect(digest(`${a.tenant}:${operation}:${key}`), () => { a.assertCurrent(); started = true; });
      // Persist the observed external result even if the caller was revoked while awaiting it.
      store.update(a.tenant, 'provider-operations', receipt.id, { status: 'succeeded', result }); completed = true;
      a.assertCurrent();
      const usable = resultFor(store.get(a.tenant, 'provider-operations', receipt.id)!, a.tenant);
      if (!usable) fail(409, 'billing_changed_retry', 'A cobrança mudou durante a operação. Consulte o estado atual.');
      return usable;
    } catch (error) {
      if (!completed) {
        const definite = !started || !!error && typeof error === 'object' && 'uncertain' in error && error.uncertain === false;
        store.update(a.tenant, 'provider-operations', receipt.id, { status: definite ? 'failed' : 'unknown', errorCode: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'billing_operation_failed' });
      }
      throw error;
    }
  }
  async function reserve(a: Authority, priceId: string, secret: string): Promise<{ record: Entity; cached?: Data }> {
    const old = store.list(a.tenant, 'billing-checkouts').find(c => c.status !== 'expired');
    if (old && old.configurationHash !== a.configuration) fail(409, 'billing_checkout_configuration_mismatch', 'O checkout existente pertence a outra configuração ou precisa de reconciliação.');
    if (old?.status === 'open' && Number(old.expiresAt) * 1000 <= Date.now()) {
      const before = digest(old), accountBefore = digest(store.list(a.tenant, 'billing-accounts')), subscriptionsBefore = digest(store.list(a.tenant, 'subscriptions'));
      const remote = await stripeGet(secret, `/checkout/sessions/${encodeURIComponent(String(old.sessionId))}`); a.assertCurrent();
      if (remote.id !== old.sessionId || !['expired', 'complete', 'open'].includes(remote.status)) fail(502, 'provider_invalid_response', 'Stripe não confirmou o checkout existente.');
      if (digest(store.get(a.tenant, 'billing-checkouts', old.id)) !== before || digest(store.list(a.tenant, 'billing-accounts')) !== accountBefore || digest(store.list(a.tenant, 'subscriptions')) !== subscriptionsBefore) fail(409, 'billing_changed_retry', 'A cobrança mudou durante a consulta. Consulte novamente.');
      store.update(a.tenant, 'billing-checkouts', old.id, { status: remote.status === 'complete' ? 'completed' : remote.status });
    }
    return store.transaction(() => {
      a.assertCurrent();
      if (activeSubscription(store, a.tenant)) fail(409, 'subscription_exists', 'Já existe assinatura. Use o portal para alterar o plano.');
      const current = store.list(a.tenant, 'billing-checkouts').find(c => c.status !== 'expired');
      if (current?.priceId === priceId) {
        const cached = checkoutResult(current, a.tenant); if (cached) return { record: current, cached };
      }
      if (current) fail(409, 'billing_checkout_exists', 'Já existe checkout ou assinatura pendente. Confira a cobrança antes de abrir outra.');
      return { record: store.create(a.tenant, 'billing-checkouts', { status: 'pending', priceId, configurationHash: a.configuration, accountBinding: digest(store.list(a.tenant, 'billing-accounts')), livemode: null }) };
    });
  }
  app.get('/api/v1/billing/catalog', safe(async request => {
    const a = authority(request, false), configured = providerAllowedForTenant(a.tenant) && ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_IDS', 'APP_ORIGIN'].every(k => !!process.env[k]?.trim());
    if (!configured) return { configured: false, mode: 'unavailable', items: [], source: 'stripe_api' };
    returnUrl(); const secret = required('STRIPE_SECRET_KEY'), items = [];
    for (const priceId of allowedPrices()) {
      const price = await stripeGet(secret, `/prices/${priceId}?expand%5B%5D=product`); a.assertCurrent();
      if (price.id !== priceId || typeof price.active !== 'boolean' || typeof price.livemode !== 'boolean' || !/^[a-z]{3}$/.test(price.currency) || !price.product || typeof price.product !== 'object' || typeof price.product.name !== 'string' || typeof price.product.active !== 'boolean') fail(502, 'billing_catalog_invalid', 'Stripe não confirmou o catálogo configurado.');
      const recurring = price.recurring, unitAmount = Number.isSafeInteger(price.unit_amount) && price.unit_amount >= 0 ? price.unit_amount : null;
      const interval = recurring && ['day', 'week', 'month', 'year'].includes(recurring.interval) ? recurring.interval : null;
      const intervalCount = recurring && Number.isSafeInteger(recurring.interval_count) && recurring.interval_count > 0 ? recurring.interval_count : null;
      const usable = price.active && price.product.active && price.type === 'recurring' && price.billing_scheme === 'per_unit' && unitAmount !== null && interval !== null && intervalCount !== null && recurring.usage_type === 'licensed' && !price.transform_quantity && !price.custom_unit_amount;
      items.push({ priceId, productName: price.product.name.slice(0, 500), currency: price.currency, unitAmount, interval, intervalCount, active: price.active && price.product.active, livemode: price.livemode, synthetic: !price.livemode || price.metadata?.kloel_synthetic === 'true' || price.product.metadata?.kloel_synthetic === 'true', checkoutUsable: usable, kloelPlan: kloelCatalogPlan(price), ...(!usable ? { reason: 'unsupported_or_inactive_price' } : {}) });
    }
    if (new Set(items.map(p => p.livemode)).size !== 1) fail(502, 'billing_catalog_mode_mismatch', 'Os preços retornados não pertencem ao mesmo ambiente.');
    return { configured: true, mode: items[0].livemode ? 'live' : 'test', items, source: 'stripe_api' };
  }));
  app.get('/api/v1/billing/checkouts', safe(request => {
    const a = authority(request, false);
    return { items: store.list(a.tenant, 'billing-checkouts').map(c => ({ id: c.id, sessionId: typeof c.sessionId === 'string' && /^cs_[A-Za-z0-9_]+$/.test(c.sessionId) ? c.sessionId : null, priceId: String(c.priceId), status: String(c.status), expiresAt: Number.isSafeInteger(c.expiresAt) ? c.expiresAt : null, url: checkoutResult(c, a.tenant)?.url ?? null, createdAt: c.createdAt, updatedAt: c.updatedAt })) };
  }));
  app.get('/api/v1/billing/operations/:key', safe(request => {
    const a = authority(request), key = keySchema.parse((request.params as Data).key), { operation } = z.object({ operation: operationSchema }).strict().parse(request.query);
    const row = store.list(a.tenant, 'provider-operations').find(r => r.operation === operation && r.key === key && matchesAuthority(r, a));
    if (!row) fail(404, 'billing_operation_not_found', 'Tentativa não encontrada para esta autorização.');
    return operationView(row, a.tenant);
  }));
  app.post('/api/v1/billing/checkout', safe(async request => {
    const a = authority(request), body = z.object({ priceId: z.string().regex(/^price_[A-Za-z0-9]+$/), idempotencyKey: keySchema }).strict().parse(request.body);
    if (!allowedPrices().includes(body.priceId)) fail(400, 'price_not_allowed', 'Plano não configurado.');
    const secret = required('STRIPE_SECRET_KEY'), target = returnUrl();
    if (activeSubscription(store, a.tenant)) fail(409, 'subscription_exists', 'Já existe assinatura. Use o portal para alterar o plano.');
    return once(a, 'stripe.checkout', body.idempotencyKey, body, async (key, markStarted) => {
      const reservation = await reserve(a, body.priceId, secret); a.assertCurrent(); if (reservation.cached) return reservation.cached;
      const account = store.list(a.tenant, 'billing-accounts')[0];
      try {
        markStarted();
        const response = await deps.upstream('https://api.stripe.com/v1/checkout/sessions', deps.stripeRequest(secret, { mode: 'subscription', billing_address_collection: 'required', 'line_items[0][price]': body.priceId, 'line_items[0][quantity]': '1', success_url: `${target}?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${target}?checkout=cancelled`, 'metadata[tenantId]': a.tenant, 'subscription_data[metadata][tenantId]': a.tenant, client_reference_id: a.tenant, ...(typeof account?.customerId === 'string' ? { customer: account.customerId } : {}) }, key), 'Stripe');
        const result = deps.stripeHostedSession(response, true), current = store.get(a.tenant, 'billing-checkouts', reservation.record.id);
        if (current) store.update(a.tenant, 'billing-checkouts', current.id, { ...(current.status === 'pending' ? { status: 'open' } : {}), sessionId: result.sessionId, expiresAt: result.expiresAt, livemode: typeof response.livemode === 'boolean' ? response.livemode : null, result });
        return result;
      } catch (error) { const current = store.get(a.tenant, 'billing-checkouts', reservation.record.id); if (current?.status === 'pending') store.update(a.tenant, 'billing-checkouts', current.id, { status: 'requires_reconciliation' }); throw error; }
    });
  }));
  app.post('/api/v1/billing/portal', safe(async request => {
    const a = authority(request), body = z.object({ idempotencyKey: keySchema }).strict().parse(request.body), secret = required('STRIPE_SECRET_KEY'), target = returnUrl();
    const account = store.list(a.tenant, 'billing-accounts')[0];
    if (typeof account?.customerId !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(account.customerId)) fail(409, 'customer_missing', 'Cliente Stripe ainda não confirmado. Consulte o checkout.');
    return once(a, 'stripe.portal', body.idempotencyKey, body, async (key, markStarted) => {
      markStarted(); const response = await deps.upstream('https://api.stripe.com/v1/billing_portal/sessions', deps.stripeRequest(secret, { customer: String(account.customerId), return_url: target }, key), 'Stripe');
      return deps.stripeHostedSession(response, false);
    });
  }));
  app.post('/api/v1/billing/reconcile', safe(async request => {
    const a = authority(request), { checkoutSessionId } = z.object({ checkoutSessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/) }).strict().parse(request.body), secret = required('STRIPE_SECRET_KEY');
    return reconcileStripeBilling(store, a.tenant, checkoutSessionId, allowedPrices(), path => stripeGet(secret, path), a.actor.userId, a.assertCurrent);
  }));
  app.get('/api/v1/billing/entitlements', safe(request => {
    z.object({}).strict().parse(request.query); const a = authority(request, false);
    const result = planSnapshot(store, a.tenant); a.assertCurrent(); return result;
  }));
  app.get('/api/v1/billing/usage', safe(request => {
    const a = authority(request, false); const result = usagePage(store, a.tenant, request.query); a.assertCurrent(); return result;
  }));
  app.get('/api/v1/billing/status', safe(request => {
    const a = authority(request, false), account = store.list(a.tenant, 'billing-accounts')[0];
    return { account: account ? { id: account.id, customerId: account.customerId, checkoutStatus: account.checkoutStatus, confirmedSource: account.confirmedSource, lastReconciledAt: account.lastReconciledAt } : null, subscriptions: store.list(a.tenant, 'subscriptions').map(s => { const value = publicSubscription(s); return { id: s.id, providerSubscriptionId: s.providerSubscriptionId, customerId: s.customerId, status: s.status, startedAt: s.startedAt ?? null, priceId: s.priceId, cancelAtPeriodEnd: s.cancelAtPeriodEnd === true, cancelAt: s.cancelAt ?? null, canceledAt: s.canceledAt ?? null, endedAt: s.endedAt ?? null, currentPeriodEnd: s.currentPeriodEnd ?? null, scheduledCancellation: value.scheduledCancellation, lastReconciledAt: s.lastReconciledAt ?? null, confirmedSource: s.confirmedSource ?? null }; }), grants: publicGrants(store, a.tenant) };
  }));
  // Add-ons (+/− e compra automática) com a mesma autoridade humana de cobrança.
  await registerBillingAddons(app, store, { authority, safe });
}
