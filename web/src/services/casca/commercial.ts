import { captureEngineContext } from '../engine/session'

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
  const raw = await context.request<{ ok: boolean; status: number }>(`/agents/${agentId}/commercial/test`, { method: 'POST', body: {}, timeoutMs: 20000 })
  context.assertCurrent()
  return raw
}
