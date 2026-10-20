const tiers: Record<string, readonly string[]> = { voice: ['solo', 'team'], whatsapp: ['solo', 'team'], webchat: ['solo', 'team'], email: ['standard'], care: ['essential', 'pro', 'premium'] };
type Data = Record<string, any>;
/** An explicit provider-owned catalog declaration, never an inference from a name or amount. */
export function kloelCatalogPlan(price: Data): { product: string; tier: string; interval: 'monthly' | 'annual' } | null {
  const p = price.metadata, product = price.product?.metadata;
  if (!p || !product || p.kloel_catalog !== 'casca-v2' || product.kloel_catalog !== 'casca-v2' || p.kloel_product !== product.kloel_product || p.kloel_tier !== product.kloel_tier) return null;
  if (!Object.hasOwn(tiers, p.kloel_product) || !tiers[p.kloel_product].includes(p.kloel_tier) || !['monthly', 'annual'].includes(p.kloel_interval)) return null;
  if (['email', 'care'].includes(p.kloel_product) && p.kloel_interval !== 'monthly') return null;
  if (price.recurring?.interval !== (p.kloel_interval === 'annual' ? 'year' : 'month') || price.recurring?.interval_count !== 1) return null;
  return { product: p.kloel_product, tier: p.kloel_tier, interval: p.kloel_interval };
}
