import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { assertRequestContext, resolveSessionContext, sameRequestContext } from '../request-context.js';
import { hasPermission } from '../memberships/permissions.js';
import { MembershipError } from '../memberships/service.js';
import { providerAllowedForTenant, platformProvidersEnabled } from '../platform-providers.js';

type Data = Record<string, any>;
type Dependencies = { upstream: (url: string, init: RequestInit, provider: string) => Promise<Data>; stripeRequest: (secret: string, body: Record<string, string>, key: string) => RequestInit };
export const identityCollection = 'stripe-identity-verifications';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sessionHash = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = z.string().uuid(), tenantId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const remoteId = /^vs_[A-Za-z0-9]+$/;
const statuses = new Set(['requires_input', 'processing', 'verified', 'canceled']);
const eventTypes = new Set(['created', 'requires_input', 'processing', 'verified', 'canceled', 'redacted'].map(s => `identity.verification_session.${s}`));
const configuration = () => digest(['PROVIDER_TENANT_ID', 'STRIPE_SECRET_KEY', 'APP_ORIGIN', 'STRIPE_IDENTITY_RETURN_URL'].map(name => process.env[name] ?? ''));
const mode = (): 'test' | 'live' | 'unavailable' => /^(?:sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '') ? 'test' : /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? '') ? 'live' : 'unavailable';
class IdentityError extends Error { constructor(readonly statusCode: number, readonly code: string, message = 'Não foi possível confirmar a verificação. Consulte o estado antes de continuar.') { super(message); } }
function fail(status: number, code: string, message?: string): never { throw new IdentityError(status, code, message); }
function returnUrl() {
  try {
    const origin = new URL(process.env.APP_ORIGIN ?? ''), target = process.env.STRIPE_IDENTITY_RETURN_URL ? new URL(process.env.STRIPE_IDENTITY_RETURN_URL) : new URL('/app/billing/identity', origin.origin);
    const valid = (u: URL) => !u.username && !u.password && !u.search && !u.hash && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
    if (!valid(origin) || !valid(target) || target.pathname !== '/app/billing/identity') return fail(503, 'identity_return_invalid');
    return target.href;
  } catch { return fail(503, 'identity_return_invalid'); }
}
function hostedUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) return fail(502, 'identity_invalid_response');
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.hostname !== 'verify.stripe.com' || url.username || url.password || url.port || !url.pathname.startsWith('/start/')) return fail(502, 'identity_invalid_response'); return value; }
  catch { return fail(502, 'identity_invalid_response'); }
}
function publicView(row: Entity, currentConfiguration = configuration()) {
  const bound = row.configurationHash === currentConfiguration, dirty = row.needsReconciliation === true || !bound;
  const state = bound ? String(row.state) : 'unknown';
  return { id: row.id, state, mode: row.mode, verified: bound && !dirty && row.mode === 'live' && state === 'verified' && typeof row.confirmedAt === 'string' && row.redacted !== true,
    canResume: bound && !!row.providerSessionId && state === 'requires_input' && row.redacted !== true,
    requiresReconciliation: dirty || ['pending', 'unknown', 'processing'].includes(state), confirmedAt: bound && !dirty ? row.confirmedAt ?? null : null,
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function operationView(row: Entity) { return { key: row.key, kind: 'stripe.identity.create', status: row.operationStatus, verification: publicView(row), automaticRetry: false }; }
function validateSession(remote: Data, row: Entity, allowRedaction = true) {
  if (typeof remote.id !== 'string' || !remoteId.test(remote.id) || row.providerSessionId && row.providerSessionId !== remote.id || remote.object !== 'identity.verification_session' || remote.type !== 'document' || remote.livemode !== (row.mode === 'live') || !statuses.has(remote.status)) fail(502, 'identity_binding_invalid');
  const redacted = remote.redaction?.status === 'redacted' || remote.redaction?.status === 'processing';
  if (redacted && allowRedaction && row.providerSessionId === remote.id) return { redacted: true, state: 'redacted' };
  if (remote.options?.document?.require_matching_selfie !== true) fail(502, 'identity_binding_invalid');
  if (remote.metadata?.kloelIdentityId !== row.id || remote.metadata?.tenantId !== row.tenantId || remote.metadata?.userId !== row.userId || remote.client_reference_id !== row.id) fail(502, 'identity_binding_invalid');
  return { redacted: false, state: remote.status as string };
}

/** Called only inside the existing signed Stripe webhook transaction. Events invalidate a cached verdict; only GET confirms it. */
export function observeStripeIdentityEvent(store: Store, tenant: string, event: Data): boolean {
  if (!eventTypes.has(event.type)) return false;
  const remote = event.data?.object;
  if (!remote || typeof remote.id !== 'string' || !remoteId.test(remote.id) || remote.object !== 'identity.verification_session' || typeof remote.livemode !== 'boolean' || event.livemode !== remote.livemode) return true;
  const row = store.list(tenant, identityCollection).find(r => r.providerSessionId === remote.id || remote.metadata?.kloelIdentityId === r.id);
  if (!row || row.configurationHash !== configuration() || row.mode !== (remote.livemode ? 'live' : 'test') || event.account !== undefined && event.account !== row.accountId || row.providerSessionId && row.providerSessionId !== remote.id) return true;
  if (!row.providerSessionId && (remote.metadata?.tenantId !== tenant || remote.metadata?.userId !== row.userId || remote.client_reference_id !== row.id)) return true;
  if (Number(row.lastEventAt ?? 0) > Number(event.created)) return true;
  store.update(tenant, identityCollection, row.id, { providerSessionId: remote.id, needsReconciliation: true, lastEventAt: event.created, lastEventId: event.id,
    ...(event.type.endsWith('.redacted') ? { redacted: true, state: 'redacted', confirmedAt: null } : {}) });
  return true;
}

export async function registerStripeIdentity(app: FastifyInstance, store: Store, deps: Dependencies) {
  function authority(request: FastifyRequest, required = true) {
    assertRequestContext(store, request);
    if (request.apiKey || request.headers.authorization || !request.cookies?.kloel_session) fail(403, 'identity_human_session_required');
    const hash = sessionHash(request.cookies.kloel_session), original = resolveSessionContext(store, hash);
    if (!original?.actor || !original.context.membershipId || original.actor.userId !== request.actor?.userId || original.actor.tenantId !== request.actor?.tenantId || !hasPermission(original.actor.role, 'billing:manage')) fail(403, 'forbidden');
    const config = configuration(), selectedMode = mode(), tenant = original.actor.tenantId;
    const configured = providerAllowedForTenant(tenant) && selectedMode !== 'unavailable' && !!process.env.APP_ORIGIN;
    if (required && !configured) fail(503, 'identity_not_configured');
    const assertCurrent = () => { assertRequestContext(store, request); const fresh = resolveSessionContext(store, hash); if (!fresh?.actor || !sameRequestContext(original.context, fresh.context) || !hasPermission(fresh.actor.role, 'billing:manage')) fail(403, 'identity_authority_changed'); if (configuration() !== config) fail(409, 'identity_configuration_changed'); };
    return { tenant, userId: original.actor.userId, membershipId: original.context.membershipId, mode: selectedMode, configuration: config, configured, assertCurrent };
  }
  type Authority = ReturnType<typeof authority>;
  const owned = (row: Entity, a: Authority) => row.userId === a.userId && row.membershipId === a.membershipId;
  const records = (a: Authority) => store.list(a.tenant, identityCollection).filter(row => owned(row, a));
  const read = (a: Authority, id: string) => { const row = store.get(a.tenant, identityCollection, id); if (!row || !owned(row, a)) return fail(404, 'identity_not_found'); if (row.configurationHash !== a.configuration) return fail(409, 'identity_configuration_changed'); return row; };
  const api = (path: string) => deps.upstream(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } }, 'Stripe');
  const account = async (a: Authority) => { a.assertCurrent(); const remote = await api('/account'); a.assertCurrent(); if (typeof remote.id !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(remote.id)) return fail(502, 'identity_account_invalid'); return remote.id as string; };
  const safe = (handler: (request: FastifyRequest) => unknown) => async (request: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    try { return await handler(request); }
    catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'identity_invalid_input', message: 'Confira os dados da solicitação.' } });
      if (error instanceof IdentityError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error instanceof IdentityError ? error.message : 'Sua sessão mudou. Atualize a página.' } });
      return reply.code(502).send({ error: { code: 'identity_provider_unavailable', message: 'Não foi possível confirmar o resultado no Stripe. Consulte a mesma tentativa.' } });
    }
  };
  const bodyFor = (request: FastifyRequest, a: Authority) => { const body = z.object({ expectedTenantId: tenantId, verificationId: uuid }).strict().parse(request.body); if (body.expectedTenantId !== a.tenant) fail(409, 'context_mismatch'); return body; };
  app.get('/api/v1/billing/identity', safe(request => { z.object({}).strict().parse(request.query); const a = authority(request, false), row = records(a).at(-1); return { configured: a.configured, mode: a.configured ? a.mode : 'unavailable', verification: row ? publicView(row) : null }; }));
  app.get('/api/v1/billing/identity/operations/:key', safe(request => {
    const a = authority(request), key = z.object({ key: uuid }).strict().parse(request.params).key, row = records(a).find(r => r.key === key);
    if (!row) fail(404, 'identity_operation_not_found'); read(a, row.id); return operationView(row);
  }));
  app.post('/api/v1/billing/identity/start', safe(async request => {
    const a = authority(request), body = z.object({ expectedTenantId: tenantId, idempotencyKey: uuid }).strict().parse(request.body);
    if (body.expectedTenantId !== a.tenant) fail(409, 'context_mismatch');
    const previous = records(a).find(row => row.key === body.idempotencyKey);
    if (previous) { read(a, previous.id); return { operation: operationView(previous) }; }
    const target = returnUrl(), accountId = await account(a);
    const reservation = store.transaction(() => {
      a.assertCurrent(); const attempts = records(a);
      const existing = attempts.find(r => r.key === body.idempotencyKey);
      if (existing) return { row: read(a, existing.id), created: false };
      if (attempts.some(r => r.configurationHash !== a.configuration || !['canceled', 'redacted', 'failed'].includes(String(r.state)))) fail(409, 'identity_attempt_exists', 'Já existe uma verificação. Consulte ou continue a tentativa atual.');
      return { row: store.create(a.tenant, identityCollection, { key: body.idempotencyKey, userId: a.userId, membershipId: a.membershipId, mode: a.mode, accountId, configurationHash: a.configuration, state: 'pending', operationStatus: 'pending', providerSessionId: null, confirmedAt: null, needsReconciliation: true, redacted: false }), created: true };
    });
    const { row } = reservation; if (!reservation.created) return { operation: operationView(row) };
    let started = false, recorded = false;
    try {
      a.assertCurrent(); started = true;
      const remote = await deps.upstream('https://api.stripe.com/v1/identity/verification_sessions', deps.stripeRequest(process.env.STRIPE_SECRET_KEY!, {
        type: 'document', 'options[document][require_matching_selfie]': 'true', return_url: target, client_reference_id: row.id, 'metadata[kloelIdentityId]': row.id, 'metadata[tenantId]': a.tenant, 'metadata[userId]': a.userId,
      }, digest(['kloel.identity.create.v1', a.tenant, a.userId, row.id])), 'Stripe');
      const observed = validateSession(remote, row, false), current = store.get(a.tenant, identityCollection, row.id)!;
      if (current.providerSessionId && current.providerSessionId !== remote.id) fail(502, 'identity_binding_invalid');
      store.update(a.tenant, identityCollection, row.id, { providerSessionId: remote.id, operationStatus: 'succeeded', state: current.redacted ? 'redacted' : observed.state === 'verified' ? 'pending' : observed.state, needsReconciliation: true }); recorded = true;
      a.assertCurrent(); return { operation: operationView(read(a, row.id)) };
    } catch (error) {
      if (!recorded) { const current = store.get(a.tenant, identityCollection, row.id)!; const definite = !started || error && typeof error === 'object' && 'uncertain' in error && error.uncertain === false;
        store.update(a.tenant, identityCollection, row.id, { operationStatus: definite ? 'failed' : 'unknown', state: current.redacted ? 'redacted' : definite ? 'failed' : 'unknown', needsReconciliation: !definite }); }
      throw error;
    }
  }));
  async function reconcile(request: FastifyRequest, resume: boolean) {
    const a = authority(request), body = bodyFor(request, a), row = read(a, body.verificationId), before = digest(row);
    if (!row.providerSessionId || !remoteId.test(String(row.providerSessionId))) fail(409, 'identity_creation_unconfirmed');
    const accountId = await account(a); if (accountId !== row.accountId) fail(409, 'identity_account_changed');
    const remote = await api(`/identity/verification_sessions/${encodeURIComponent(String(row.providerSessionId))}`); a.assertCurrent();
    const observed = validateSession(remote, row);
    const updated = store.transaction(() => { a.assertCurrent(); const current = read(a, row.id); if (digest(current) !== before) fail(409, 'identity_changed_retry');
      return store.update(a.tenant, identityCollection, row.id, { state: observed.state, redacted: observed.redacted, confirmedAt: new Date().toISOString(), needsReconciliation: false, operationStatus: 'succeeded' })!; });
    const verification = publicView(updated);
    if (!resume) return verification;
    return { verification, url: verification.canResume ? hostedUrl(remote.url) : null };
  }
  app.post('/api/v1/billing/identity/reconcile', safe(request => reconcile(request, false)));
  app.post('/api/v1/billing/identity/resume', safe(request => reconcile(request, true)));
}
