import type { BillingCatalog, BillingStatus, BillingMode } from '@/services/engine/billing'
declare module '@/domain/types' {
  interface BillingProfile { engineBilling?: { catalog: BillingCatalog; status: BillingStatus; balanceKnown: false; addressKnown: false } }
  interface Subscription { grant?: { id: string; expiresAt: string }; engineBilling?: { mode: BillingMode; scheduledCancellation: boolean; providerSubscriptionId: string } }
}
export {}
