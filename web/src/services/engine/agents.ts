import { EngineError } from './http'
import type { EngineContext } from './session'

export const agentToolNames = ['transfer_call', 'send_email', 'send_whatsapp', 'schedule_appointment', 'search_web', 'webhook', 'search_knowledge', 'lookup_contact'] as const
export type AgentTool = typeof agentToolNames[number]
export type AgentStatus = 'draft' | 'active' | 'paused'
export interface AgentFields {
  name: string; prompt: string; initialMessage: string; language: string; voice: string; status: AgentStatus
  settings: { temperature: number; maxResponseTokens: number; timezone: string; recordingEnabled: boolean; humanHandoffEnabled: boolean }
  tools: AgentTool[]
  rules: Array<{ name: string; instruction: string; enabled: boolean }>
}
export interface EngineAgent extends AgentFields { id: string; tenantId: string; createdAt: string; updatedAt: string }
export interface EngineOverview {
  period: { from: string; to: string; timezone: string }
  counts: { agents: number; contacts: number; conversations: number; openConversations: number; messages: number; appointments: number; upcomingAppointments: number; knowledgeEntries: number }
  periodCounts: { conversations: number; messages: number }
  daily: Array<{ date: string; conversations: number; messages: number }>
  usage: { cost: null; callMinutes: null; tokenCount: null; status: 'not_aggregated' }
  source: 'stored_tenant_records'
}

const fields = ['name', 'prompt', 'initialMessage', 'language', 'voice', 'status', 'settings', 'tools', 'rules'] as const
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function invalid(message = 'Os dados do assistente são inválidos.'): never { throw new EngineError(0, 'invalid_data', message) }
const text = (value: unknown, min: number, max: number) => typeof value === 'string' && value.length >= min && value.length <= max
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const identifier = (id: string) => { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) invalid(); return id }

/** Only the domain contract is accepted. Shell voice aliases, IDs and tenant selectors never leave the browser. */
export function agentPayload(input: unknown): Partial<AgentFields> {
  if (!object(input) || !Object.keys(input).length || Object.keys(input).some(key => !fields.includes(key as typeof fields[number]))) invalid()
  const result = structuredClone(input) as Record<string, unknown>
  for (const key of ['name', 'prompt', 'initialMessage', 'language', 'voice'] as const) if (key in result) {
    const maximum = { name: 200, prompt: 100000, initialMessage: 5000, language: 50, voice: 100 }[key]
    if (!text(result[key], ['name', 'language', 'voice'].includes(key) ? 1 : 0, maximum)) invalid()
    if (['name', 'voice'].includes(key)) { result[key] = (result[key] as string).trim(); if (!result[key]) invalid() }
  }
  if ('language' in result) { try { new Intl.Locale(result.language as string) } catch { invalid('Use um código de idioma válido, como pt-BR.') } }
  if ('status' in result && !['draft', 'active', 'paused'].includes(String(result.status))) invalid()
  if ('tools' in result && (!Array.isArray(result.tools) || result.tools.length > 20 || result.tools.some(tool => !agentToolNames.includes(tool)))) invalid()
  if ('rules' in result && (!Array.isArray(result.rules) || result.rules.length > 100 || result.rules.some(rule => !object(rule) || Object.keys(rule).some(key => !['name', 'instruction', 'enabled'].includes(key)) || !text(rule.name, 1, 200) || !String(rule.name).trim() || !text(rule.instruction, 1, 5000) || !String(rule.instruction).trim() || typeof rule.enabled !== 'boolean'))) invalid('Cada regra precisa de nome e instrução.')
  if ('settings' in result) {
    const s = result.settings
    if (!object(s) || !Object.keys(s).length || Object.keys(s).some(key => !['temperature', 'maxResponseTokens', 'timezone', 'recordingEnabled', 'humanHandoffEnabled'].includes(key))) invalid()
    if ('temperature' in s && (typeof s.temperature !== 'number' || !Number.isFinite(s.temperature) || s.temperature < 0 || s.temperature > 2)) invalid()
    if ('maxResponseTokens' in s && (!count(s.maxResponseTokens) || Number(s.maxResponseTokens) < 32 || Number(s.maxResponseTokens) > 32768)) invalid('O limite de resposta deve estar entre 32 e 32768 tokens.')
    if ('timezone' in s) { try { if (typeof s.timezone !== 'string') invalid(); new Intl.DateTimeFormat('pt-BR', { timeZone: s.timezone as string }) } catch { invalid('Informe um fuso horário IANA válido.') } }
    for (const key of ['recordingEnabled', 'humanHandoffEnabled']) if (key in s && typeof s[key] !== 'boolean') invalid()
  }
  return result as Partial<AgentFields>
}

export function editableAgent(agent: EngineAgent): AgentFields {
  return structuredClone(Object.fromEntries(fields.map(key => [key, agent[key]]))) as unknown as AgentFields
}

export function changedAgentFields(previous: AgentFields, next: AgentFields): Partial<AgentFields> {
  const changed: Record<string, unknown> = {}
  for (const key of fields) if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
    if (key === 'settings') changed.settings = Object.fromEntries(Object.keys(next.settings).filter(name => previous.settings[name as keyof AgentFields['settings']] !== next.settings[name as keyof AgentFields['settings']]).map(name => [name, next.settings[name as keyof AgentFields['settings']]]))
    else changed[key] = next[key]
  }
  return changed as Partial<AgentFields>
}

function parseAgent(raw: unknown, tenantId: string): EngineAgent {
  if (!object(raw) || raw.tenantId !== tenantId || !text(raw.id, 1, 128) || !Number.isFinite(Date.parse(String(raw.createdAt))) || !Number.isFinite(Date.parse(String(raw.updatedAt))) || fields.some(key => !(key in raw))) invalid('O assistente recebido é inválido ou pertence a outra organização.')
  identifier(raw.id as string)
  const parsed = agentPayload(Object.fromEntries(fields.map(key => [key, raw[key]])))
  if (!object(parsed.settings) || ['temperature', 'maxResponseTokens', 'timezone', 'recordingEnabled', 'humanHandoffEnabled'].some(key => !(key in parsed.settings!))) invalid()
  return { ...parsed, id: raw.id, tenantId: raw.tenantId, createdAt: raw.createdAt, updatedAt: raw.updatedAt } as EngineAgent
}

export function parseOverview(raw: unknown): EngineOverview {
  if (!object(raw) || raw.source !== 'stored_tenant_records' || !object(raw.counts) || !object(raw.periodCounts) || !object(raw.period) || !object(raw.usage) || !Array.isArray(raw.daily)) invalid('Os indicadores recebidos são inválidos.')
  if (['agents', 'contacts', 'conversations', 'openConversations', 'messages', 'appointments', 'upcomingAppointments', 'knowledgeEntries'].some(key => !count((raw.counts as Record<string, unknown>)[key])) || !count(raw.periodCounts.conversations) || !count(raw.periodCounts.messages)) invalid()
  if (!Number.isFinite(Date.parse(String(raw.period.from))) || !Number.isFinite(Date.parse(String(raw.period.to))) || raw.period.timezone !== 'UTC' || raw.daily.some(day => !object(day) || !/^\d{4}-\d{2}-\d{2}$/.test(String(day.date)) || !count(day.conversations) || !count(day.messages))) invalid()
  if (raw.usage.status !== 'not_aggregated' || raw.usage.cost !== null || raw.usage.callMinutes !== null || raw.usage.tokenCount !== null) invalid('O formato dos indicadores de uso mudou. Atualize a interface.')
  return raw as unknown as EngineOverview
}

export function createAgentService(context: EngineContext) {
  return {
    async list(signal?: AbortSignal): Promise<EngineAgent[]> {
      const agents = new Map<string, EngineAgent>()
      for (let page = 1; page <= 1000; page++) {
        const response = await context.request<{ items: unknown[]; page: number; limit: number; total: number; totalPages: number }>('/agents', { query: { page, limit: 100, sort: 'createdAt', order: 'asc' }, signal })
        if (!Array.isArray(response.items) || response.page !== page || response.limit !== 100 || !count(response.totalPages) || !count(response.total)) invalid()
        for (const item of response.items) { const agent = parseAgent(item, context.tenantId); agents.set(agent.id, agent) }
        context.assertCurrent()
        if (page >= response.totalPages) return [...agents.values()]
      }
      throw new EngineError(0, 'list_too_large', 'A lista excedeu o limite desta tela. Nenhuma lista parcial foi exibida.')
    },
    async create(input: unknown) {
      const body = agentPayload(input)
      if (!body.name) invalid('Informe o nome do assistente.')
      const result = parseAgent(await context.request('/agents', { method: 'POST', body }), context.tenantId)
      context.assertCurrent(); return result
    },
    async update(id: string, input: unknown) {
      const result = parseAgent(await context.request(`/agents/${identifier(id)}`, { method: 'PATCH', body: agentPayload(input) }), context.tenantId)
      if (result.id !== id) invalid()
      context.assertCurrent(); return result
    },
    async remove(id: string) { await context.request(`/agents/${identifier(id)}`, { method: 'DELETE' }); context.assertCurrent() },
    async overview(days: number, agentId?: string, signal?: AbortSignal) {
      if (!Number.isInteger(days) || days < 1 || days > 365) invalid()
      const result = parseOverview(await context.request('/overview', { query: { days, agentId: agentId ? identifier(agentId) : undefined }, signal }))
      context.assertCurrent(); return result
    },
  }
}

export const agentStatusLabel: Record<AgentStatus, string> = { draft: 'Rascunho', active: 'Ativo', paused: 'Pausado' }
export function engineMessage(error: unknown): string { return error instanceof Error ? error.message : 'Não foi possível concluir a operação.' }
