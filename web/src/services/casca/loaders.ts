import { registerAreaLoader } from './data'
import { loadAgents, loadKnowledge } from './agents'
import { loadConnections } from './oauth'
import { engineSession } from '../engine/session'
import { loadContacts } from './contacts'
import { loadPhones } from './phones'
import { loadTeam } from './team'
import { loadConversations } from './conversations'
import { loadWhatsApp } from './whatsapp'
import { loadApiKeys } from './api-keys'
import { loadEmailArea } from './email'
import { loadIntegrations } from './integrations'
import { loadCampaigns } from './campaigns'
import { loadBilling } from './billing'
import { loadScheduling } from './scheduling';

/** Area registration is separate from the presentation and never installs demo data. */
/** Plano/assinaturas também nas áreas que exibem gates de plano (carga direta da rota). Falha de cobrança não derruba a área. */
const billingSlice = (context: Parameters<typeof loadBilling>[0]) => engineSession.can('billing:manage') ? loadBilling(context).catch(() => ({})) : Promise.resolve({})
export function registerEngineLoaders() {
  registerAreaLoader('scheduling', loadScheduling)
  // Independent reads of one area run concurrently; slices are merged in the same order as before.
  registerAreaLoader('overview', async context => {
    const [conversations, team, billing, agents] = await Promise.all([
      engineSession.can('conversations:read') ? loadConversations(context) : {},
      engineSession.can('team:read') ? loadTeam(context) : {},
      engineSession.can('billing:manage') ? loadBilling(context) : {},
      engineSession.can('agents:read') ? loadAgents(context) : [],
    ])
    return { ...conversations, ...team, ...billing, agents }
  })
  registerAreaLoader('campaigns', async context => {
    const [campaigns, contacts, phones, agents] = await Promise.all([loadCampaigns(context), loadContacts(context), loadPhones(context, { verifyProvider: engineSession.can('integrations:manage') }), loadAgents(context)])
    return { ...campaigns, ...contacts, ...phones, agents }
  })
  registerAreaLoader('billing', loadBilling)
  registerAreaLoader('email', async context => {
    const [email, billing] = await Promise.all([loadEmailArea(context), billingSlice(context)])
    return { ...billing, ...email }
  })
  registerAreaLoader('integrations', loadIntegrations)
  registerAreaLoader('api-keys', loadApiKeys)
  registerAreaLoader('users', loadTeam)
  registerAreaLoader('account', async context => ({ calendarConnections: await loadConnections(context) }))
  registerAreaLoader('company', async context => {
    const [team, email] = await Promise.all([engineSession.can('team:read') ? loadTeam(context) : {}, engineSession.can('integrations:manage') ? loadEmailArea(context) : {}])
    return { ...team, ...email }
  })
  registerAreaLoader('whatsapp', async context => {
    const [whatsapp, agents, billing] = await Promise.all([loadWhatsApp(context, { verifyMetadata: engineSession.can('integrations:manage') }), loadAgents(context), billingSlice(context)])
    return { ...billing, ...whatsapp, agents }
  })
  registerAreaLoader('conversations', async context => {
    const [conversations, agents, contacts] = await Promise.all([loadConversations(context), engineSession.can('agents:read') ? loadAgents(context) : [], engineSession.can('contacts:read') ? loadContacts(context) : {}])
    return { ...conversations, agents, ...contacts }
  })
  registerAreaLoader('contacts', async context => {
    const [contacts, team] = await Promise.all([loadContacts(context), engineSession.can('team:read') ? loadTeam(context) : {}])
    return { ...contacts, ...team }
  })
  registerAreaLoader('phones', async context => {
    const [phones, agents] = await Promise.all([loadPhones(context, { verifyProvider: engineSession.can('integrations:manage') }), loadAgents(context)])
    return { ...phones, agents }
  })
  registerAreaLoader('agents', async context => {
    const billing = billingSlice(context)
    const agents = await loadAgents(context)
    const knowledge = await loadKnowledge(context, agents.map(agent => agent.id))
    return { ...(await billing), agents, ...knowledge }
  })
  // Identity, profile and organization are hydrated by the verified session bootstrap.
  // Individual administrative pages load their additional data through their own adapter.
  registerAreaLoader('admin', async context => {
    const session = engineSession.getSnapshot()
    context.assertCurrent()
    const permissions = session.data?.identity.permissions ?? []
    const [team, calendarConnections] = await Promise.all([permissions.includes('team:read') ? loadTeam(context) : {}, permissions.includes('integrations:manage') ? loadConnections(context) : []])
    return { ...team, calendarConnections }
  })
}
