import type { Agent } from '@/domain/types'
import { captureEngineContext, type EngineContext } from '../engine/session'

export type CommercialProfile = {
  platformName: string
  baseUrl: string
  authType: 'api_key' | 'bearer' | 'basic' | 'oauth2'
  apiKeyHeader?: string
  actions: { name: string; method: string; path: string; description: string; confirm: boolean }[]
  rules: { maxDiscountPercent: number; tiers: { days: number; percent: number }[]; gifts: string; returnPolicy: string; contactFrom: string; contactTo: string; cadencePerDay: number; maxAttempts: number; offers: string; autoContact: boolean; fieldMap: Record<string, string> }
  secretConfigured: boolean
  pagarme: { accountId: string; mode: 'test' | 'live'; configured: boolean }
  inboundPath: string
  lastTest?: { at: string; ok: boolean; status: number; detail: string } | null
}

function client() { return captureEngineContext('integrations:manage') }

export async function loadCommercial(agentId: string) {
  const context = client()
  const raw = await context.request<{ configured: boolean; profile?: CommercialProfile }>(`/agents/${agentId}/commercial`)
  context.assertCurrent()
  return raw
}

export async function saveCommercial(agentId: string, body: unknown) {
  const context = client()
  const raw = await context.request<{ profile: CommercialProfile; inboundSecret?: string }>(`/agents/${agentId}/commercial`, { method: 'PUT', body, timeoutMs: 30000 })
  context.assertCurrent()
  return raw
}

export async function testCommercial(agentId: string) {
  const context = client()
  const raw = await context.request<{ ok: boolean; status: number; detail?: string; at?: string }>(`/agents/${agentId}/commercial/test`, { method: 'POST', body: {}, timeoutMs: 20000 })
  context.assertCurrent()
  return raw
}

export async function deleteCommercial(agentId: string) {
  const context = client()
  await context.request(`/agents/${agentId}/commercial`, { method: 'DELETE' })
  context.assertCurrent()
}

export async function hydrateCommercial(context: EngineContext, agents: Agent[]): Promise<Agent[]> {
  return Promise.all(agents.map(async agent => {
    if (!agent.integrations.some(item => item.integration === 'personalizar')) return agent
    try {
      const raw = await context.request<{ configured: boolean; profile?: CommercialProfile }>(`/agents/${agent.id}/commercial`)
      const test = raw.profile?.lastTest
      if (!test?.at) return agent
      return { ...agent, integrations: agent.integrations.map(item => item.integration === 'personalizar' ? { ...item, connected: test.ok === true, lastTest: { ok: test.ok, at: test.at, detail: test.detail } } : item) }
    } catch { return agent }
  }))
}

export async function probeWebhook(url: string) {
  const context = client()
  const raw = await context.request<{ ok: boolean; status: number; body: string }>('/integrations/webhook-probe', { method: 'POST', body: { url }, timeoutMs: 20000 })
  context.assertCurrent()
  return raw
}
