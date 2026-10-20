/**
 * Platform provider scope.
 * - Pilot (default): shared provider credentials are usable only by PROVIDER_TENANT_ID.
 * - Platform (PLATFORM_AI_PROVIDERS=1): Kloel's own platform credentials (OpenAI, Stripe)
 *   serve every organization. Data isolation is unchanged: every call stays scoped to the
 *   caller's tenantId. Tenant-owned telephony/WhatsApp numbers stay bound separately.
 */
export function platformProvidersEnabled(): boolean {
  return ['1', 'true', 'on'].includes(String(process.env.PLATFORM_AI_PROVIDERS ?? '').trim().toLowerCase());
}
export function providerAllowedForTenant(tenantId: string | null | undefined): boolean {
  if (!tenantId) return false;
  if (platformProvidersEnabled()) return true;
  return !!process.env.PROVIDER_TENANT_ID && process.env.PROVIDER_TENANT_ID.trim() === tenantId;
}
