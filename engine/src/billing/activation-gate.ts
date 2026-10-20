/**
 * Plano obrigatório para ATIVAR um assistente (Fonio: assistente fica em rascunho até assinar).
 * Isentos: org da plataforma (PROVIDER_TENANT_ID) e BILLING_ENFORCEMENT_EXEMPT (via getEnforcement → não enforced),
 * assinatura elegível (inclui Stripe `trialing`), e concessões internas ativas ('plan-grants' / 'qa-plan-grants').
 */
import type { Store } from '../store.js';
import { planSnapshot } from './plans.js';

export class ActivationGateError extends Error {
  readonly statusCode = 402; readonly code = 'plan_required';
  constructor() { super('Assine um plano para ativar o assistente.'); }
}
export function activeGrant(store: Store, tenant: string, now = Date.now()) {
  return [...store.list(tenant, 'plan-grants'), ...store.list(tenant, 'qa-plan-grants')]
    .find(g => g.status === 'active' && (!g.expiresAt || Date.parse(String(g.expiresAt)) > now));
}
export function canActivateAgent(store: Store, tenant: string) {
  const plan = planSnapshot(store, tenant);
  return !plan.enforced || plan.state === 'eligible' || !!activeGrant(store, tenant);
}
export function assertAgentActivationAllowed(store: Store, tenant: string) {
  if (!canActivateAgent(store, tenant)) throw new ActivationGateError();
}
