import type { Store } from '../store.js';

/**
 * Concessão interna de acesso por org ('plan-grants'), sem Stripe. Um registro
 * { status:'active', planId, products:[{product,tier}], startsAt, expiresAt, noCharge:true }
 * faz a org valer como assinante (planSnapshot 'eligible' + assinaturas sintéticas em /billing/status)
 * até expiresAt; depois disso trava sozinha. Revogar: status:'revoked'.
 */
export type GrantProduct = { product: 'voice' | 'whatsapp' | 'webchat' | 'email' | 'care'; tier: string };
export const GRANTS = 'plan-grants';
export function activeGrant(store: Store, tenant: string, now = Date.now()) {
  return store.list(tenant, GRANTS).find(g => g.status === 'active' && typeof g.expiresAt === 'string' && Date.parse(g.expiresAt) > now
    && (!g.startsAt || Date.parse(String(g.startsAt)) <= now));
}
export function publicGrants(store: Store, tenant: string, now = Date.now()) {
  return store.list(tenant, GRANTS).filter(g => typeof g.expiresAt === 'string').map(g => {
    const active = g.status === 'active' && Date.parse(String(g.expiresAt)) > now && (!g.startsAt || Date.parse(String(g.startsAt)) <= now);
    return { id: g.id, planId: String(g.planId ?? 'grant'), status: active ? 'active' : g.status === 'active' ? 'expired' : String(g.status),
      startsAt: String(g.startsAt ?? g.createdAt), expiresAt: String(g.expiresAt),
      products: (Array.isArray(g.products) ? g.products : []).filter((p: any) => p && typeof p.product === 'string' && typeof p.tier === 'string').map((p: any) => ({ product: p.product, tier: p.tier })) };
  });
}
