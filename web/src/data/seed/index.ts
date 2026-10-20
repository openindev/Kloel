import type { DemoDB } from '@/domain/types'
import { buildDemoOrg } from './demo'
import { defaultUi } from './defaults'
import seedSite from './modules/site'
import seedHelp from './modules/help'
import seedBilling from './modules/billing'
import seedAgents from './modules/agents'
import seedInboxContacts from './modules/inbox-contacts'
import seedMaisA from './modules/mais-a'
import seedMaisB from './modules/mais-b'
import seedTasks from './modules/tasks'
import seedMirror from './mirror'

/** seedMirror: organização "Kloel Tecnologia" no estado da conta Fonio ao vivo (login espelho@kloel.ai — ver ./mirror.ts). */
const MODULE_SEEDS = [seedSite, seedHelp, seedBilling, seedAgents, seedInboxContacts, seedMaisA, seedMaisB, seedTasks, seedMirror]

function mergeSeeds(base: Partial<DemoDB>, parts: Partial<DemoDB>[]): Partial<DemoDB> {
  const out: Record<string, unknown> = { ...base }
  for (const part of parts) {
    for (const [k, v] of Object.entries(part)) {
      const cur = out[k]
      out[k] = Array.isArray(cur) && Array.isArray(v) ? [...cur, ...v] : v
    }
  }
  return out as Partial<DemoDB>
}

export const SCHEMA_VERSION = 1
export { DEMO_LOGIN } from './demo'
export { MIRROR_LOGIN, MIRROR_ORG_ID, withMirrorScenario } from './mirror'

const EMPTY: Omit<DemoDB, 'schemaVersion' | 'seededAt' | 'session' | 'ui'> = {
  organizations: [], users: [], memberships: [], invites: [], agents: [], knowledgeEntries: [], knowledgeSources: [], conversations: [], tags: [],
  contacts: [], contactSettings: [], phoneNumbers: [], whatsappAccounts: [], calendarConnections: [], eventTypes: [], bookings: [], emailInboxes: [],
  emailMessages: [], apiKeys: [], integrationRequests: [], campaigns: [], subscriptions: [], invoices: [], billingProfiles: [], referrals: [], demoBookings: [], leads: [],
  tasks: [], // módulo tasks (DemoDB.tasks declarado em src/domain/ext/tasks.ts)
}

/**
 * Constrói o banco de demonstração do zero (determinístico em relação ao instante do seed).
 * A sessão inicia DESLOGADA: o site público é a porta de entrada; login demo em DEMO_LOGIN.
 */
export function buildSeed(now = new Date()): DemoDB {
  const demo = mergeSeeds(buildDemoOrg(now), MODULE_SEEDS.map((f) => f(now)))
  return {
    ...EMPTY,
    ...demo,
    schemaVersion: SCHEMA_VERSION,
    seededAt: now.toISOString(),
    session: { orgId: null, userId: null },
    ui: defaultUi(),
  } as DemoDB
}
