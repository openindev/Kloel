import type { DemoDB, Role, UiPrefs } from '@/domain/types'
import type { BootstrapData } from '@/services/engine/types'
import { defaultUi } from './seed/defaults'

/** A projection cache, never a second business database or a source of credentials. */
export function emptyEngineDB(ui: UiPrefs = defaultUi()): DemoDB {
  return {
    schemaVersion: 1, seededAt: '', session: { userId: null, orgId: null }, ui,
    organizations: [], users: [], memberships: [], invites: [], agents: [],
    knowledgeEntries: [], knowledgeSources: [], conversations: [], tags: [],
    contacts: [], contactSettings: [], phoneNumbers: [], whatsappAccounts: [],
    calendarConnections: [], eventTypes: [], bookings: [], emailInboxes: [],
    emailMessages: [], apiKeys: [], integrationRequests: [], campaigns: [],
    subscriptions: [], invoices: [], billingProfiles: [], referrals: [],
    demoBookings: [], leads: [], tasks: [],
  }
}

export function projectIdentity(data: BootstrapData): Pick<DemoDB, 'session' | 'users' | 'organizations' | 'memberships'> {
  const { identity, profile, settings } = data
  const role = (value: string): Role => value === 'owner' ? 'admin' : value === 'member' ? 'editor' : value as Role
  return {
    session: { userId: identity.userId, orgId: identity.tenantId },
    users: [{ id: profile.id, email: profile.email, firstName: profile.firstName, lastName: profile.lastName,
      password: '', language: profile.language, phone: profile.phone ?? undefined, createdAt: profile.profileCreatedAt ?? '' }],
    organizations: identity.organizations.map(org => ({ id: org.tenantId, name: org.tenantId === identity.tenantId ? settings?.name ?? org.name : org.name,
      slug: '', timezone: org.tenantId === identity.tenantId ? settings?.timezone ?? 'America/Sao_Paulo' : 'America/Sao_Paulo',
      // Compatibility default only; authoritative required/completed are read separately.
      // No subscription or completed onboarding is inferred from account existence.
      onboardingCompleted: true, onboardingRequired: undefined, onboardingCompletionConfirmed: false, createdAt: org.createdAt })),
    memberships: identity.organizations.map(org => ({ id: org.membershipId, orgId: org.tenantId, userId: identity.userId,
      role: role(org.role), joinedAt: org.joinedAt })),
  }
}
