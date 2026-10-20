import type { Agent, GreetingRule, WebhookConfig } from '@/domain/types'
import { parseBeforeConfiguration, type BeforeConfiguration, type BeforeCondition, type BeforeVariable, type BeforeScalar } from '../engine/before-context'
import { parseHttpConfiguration, parseHttpSecrets, type HttpConfiguration, type HttpSecrets } from '../engine/before-http'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const aliases: Record<string, string> = { 'agent.name': 'system.agentName', 'company.name': 'system.companyName', 'caller.phone': 'system.phone', 'call.direction': 'system.direction', 'call.timeOfDay': 'system.localTime' }
const reverse = Object.fromEntries(Object.entries(aliases).map(([k, v]) => [v, k]))
function unsupported(message: string): never { throw Error(message) }
export function beforeRows(agent: Agent) { return agent.webhooks.filter(row => row.kind === 'inbound' || row.kind === 'test_context') }
export function assertNewBeforeConfiguration(agent: Agent) {
  if (agent.engineBefore?.context.configuration.enabled || agent.greeting.includes('{{') || agent.greetingPersonalized && agent.greetingMode === 'advanced' && agent.greetingRules.length) unsupported('Crie o assistente primeiro e configure a mensagem inicial nele. A configuração inicial de outro assistente não pode ser copiada automaticamente.')
}
export function beforeFieldsChanged(base: Agent, next: Agent) {
  return ['greeting', 'greetingPersonalized', 'greetingMode', 'greetingRules'].some(key => !same(base[key as keyof Agent], next[key as keyof Agent])) || base.businessHours.timezone !== next.businessHours.timezone || !same(beforeRows(base), beforeRows(next))
}
function flatJson(raw: string, label: string): Record<string, BeforeScalar> {
  let data: unknown
  try { data = JSON.parse(raw) } catch { return unsupported(`${label}: informe um objeto JSON válido.`) }
  if (!object(data) || Object.entries(data).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || !['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value))) return unsupported(`${label}: use nomes simples e valores de texto, número ou verdadeiro/falso, sem objetos ou listas.`)
  return data as Record<string, BeforeScalar>
}
export function translateGreeting(text: string, variables: BeforeVariable[]): string {
  const names = new Set(variables.map(v => v.name))
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) => {
    const field = aliases[name] ?? (names.has(name) ? `vars.${name}` : name.startsWith('vars.') && names.has(name.slice(5)) ? name : undefined)
    if (!field) return unsupported(`A variável ${name} ainda não está disponível nesta mensagem inicial.`)
    return `{{${field}}}`
  })
}
export function shellGreeting(text: string): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => `{{${reverse[key] ?? (key.startsWith('vars.') ? key.slice(5) : key)}}}`)
}
export function translateGreetingCondition(c: GreetingRule['conditions'][number]): BeforeCondition {
  if (c.field === 'call.timeOfDay') {
    const parts = c.value.split('-')
    if (c.operator !== 'within' || parts.length !== 2 || !parts.every(v => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) || parts[0] === parts[1]) return unsupported('Para hora do dia, escolha “está dentro de” e um intervalo válido. Os demais operadores ainda não estão disponíveis.')
    return { field: 'system.localTime', operator: 'time_between', value: { start: parts[0], end: parts[1], overnight: parts[0] > parts[1] } }
  }
  const field = aliases[c.field]
  if (!field || !['caller.phone', 'call.direction'].includes(c.field)) return unsupported(`A condição ${c.field} ainda não dispõe de dados confirmados para esta mensagem inicial.`)
  if (['is_set', 'is_empty'].includes(c.operator)) return { field, operator: c.operator as 'is_set' | 'is_empty' }
  if (!['is', 'contains'].includes(c.operator) || c.field === 'call.direction' && c.operator !== 'is') return unsupported('Este operador ainda não está disponível nesta condição. Nenhuma regra foi alterada.')
  const value = c.field === 'call.direction' ? ({ inbound: 'incoming', outbound: 'outgoing' } as Record<string, string>)[c.value] : c.value
  if (value === undefined) return unsupported('Escolha uma direção de chamada válida.')
  return { field, operator: c.operator === 'is' ? 'equals' : 'contains', value }
}
export function shellGreetingCondition(c: BeforeCondition): GreetingRule['conditions'][number] | null {
  if (c.field === 'system.localTime' && c.operator === 'time_between' && object(c.value)) return { field: 'call.timeOfDay', operator: 'within', value: `${c.value.start}-${c.value.end}` }
  if (!['system.phone', 'system.direction'].includes(c.field) || !['equals', 'contains', 'is_set', 'is_empty'].includes(c.operator)) return null
  const value = c.field === 'system.direction' && c.value !== undefined ? ({ incoming: 'inbound', outgoing: 'outbound' } as Record<string, string>)[String(c.value)] : c.value
  if (value === undefined && !['is_set', 'is_empty'].includes(c.operator)) return null
  return { field: reverse[c.field], operator: c.operator === 'equals' ? 'is' : c.operator, value: value === undefined ? '' : String(value) }
}
export type BeforePlan = { configuration: BeforeConfiguration; inbound?: WebhookConfig; httpChanged: boolean; contextChanged: boolean; reauthorizeHttp: boolean }
/** Only fields intentionally changed by this save may activate old editorial preferences. */
export function preflightBeforeFields(base: Agent, next: Agent): BeforePlan | null {
  // An editor write may change an HTTP-before dependency. Preserve its confirmed configuration for readback.
  const reauthorizeHttp = base.engineBefore?.http?.state === 'enabled' && base.engineBefore.http.configuration?.enabled === true && base.engineBefore.context.configuration.enabled
  if (!beforeFieldsChanged(base, next)) return reauthorizeHttp ? { configuration: structuredClone(base.engineBefore!.context.configuration), httpChanged: false, contextChanged: false, reauthorizeHttp: true } : null
  const inboundRows = next.webhooks.filter(r => r.kind === 'inbound'), testRows = next.webhooks.filter(r => r.kind === 'test_context')
  if (inboundRows.length > 1 || testRows.length > 1) return unsupported('Use um webhook de entrada e um contexto de teste por assistente.')
  const previous = base.engineBefore?.context.configuration, inbound = inboundRows[0], test = testRows[0]
  const inboundChanged = !same(base.webhooks.filter(r => r.kind === 'inbound'), inboundRows)
  const defaults = inbound ? flatJson(inbound.defaults ?? '{}', 'Valores padrão') : {}
  const variables: BeforeVariable[] = Object.entries(defaults).map(([name, defaultValue]) => ({ name, type: typeof defaultValue === 'string' ? 'text' : typeof defaultValue as 'number' | 'boolean', defaultValue }))
  const testContext = test?.enabled ? flatJson(test.body ?? '{}', 'Contexto de teste') : {}
  const personalChanged = ['greetingPersonalized', 'greetingMode', 'greetingRules'].some(key => !same(base[key as keyof Agent], next[key as keyof Agent]))
  const personalization = personalChanged ? next.greetingPersonalized : !!previous?.enabled && previous.greetingRules.length > 0
  if (personalization && next.greetingMode !== 'advanced') return unsupported('A personalização automática por nome do contato ainda não está disponível. Use regras avançadas com dados disponíveis.')
  const greetingRules = personalization ? next.greetingRules.map(row => ({ conditions: row.conditions.map(translateGreetingCondition), greeting: translateGreeting(row.message, variables) })) : []
  if (personalization && !greetingRules.length) return unsupported('Adicione pelo menos uma regra avançada para personalizar a mensagem.')
  const configuration = parseBeforeConfiguration({ enabled: true, timezone: next.businessHours.timezone, variables, defaultGreeting: translateGreeting(next.greeting, variables), greetingRules, testContext })
  if (inbound?.enabled && !variables.length) return unsupported('Declare pelo menos um valor padrão para identificar os campos da resposta do webhook.')
  return { configuration, inbound, httpChanged: inboundChanged, contextChanged: !same(previous, configuration), reauthorizeHttp }
}
function translateBody(value: unknown, variables: BeforeVariable[]): unknown {
  if (Array.isArray(value)) return value.map(v => translateBody(v, variables))
  if (object(value)) {
    if (Object.keys(value).some(k => ['constructor', 'prototype', '__proto__'].includes(k))) return unsupported('O corpo contém um campo reservado.')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, translateBody(v, variables)]))
  }
  if (typeof value !== 'string' || !value.includes('{{')) return value
  const match = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(value)
  if (!match) return unsupported('No corpo, use a variável como o valor inteiro de um campo JSON.')
  const translated = translateGreeting(value, variables).slice(2, -2)
  if (translated === 'system.phone') return unsupported('O telefone do interlocutor ainda não está disponível no corpo deste webhook de entrada.')
  return { $before: translated }
}
export function translateInbound(plan: BeforePlan, incomingNumberIds: string[], previous?: Agent['engineBefore'], webchatChannelIds: string[] = []): { configuration: HttpConfiguration; secrets: HttpSecrets } | null {
  const row = plan.inbound, existing = previous?.http
  if (!row) {
    if (!existing?.configuration) return null
    return { configuration: { ...existing.configuration, enabled: false }, secrets: { mode: 'keep' } }
  }
  if (row.timing && row.timing !== 'before' || row.activeWindow && row.activeWindow !== 'any' || row.condition?.trim()) return unsupported('Condições livres e janelas de execução ainda não estão disponíveis para este webhook de entrada.')
  if (row.enabled && !incomingNumberIds.length && !webchatChannelIds.length) return unsupported('Associe um número de entrada ou ative o chatbot de IA (webchat) deste assistente antes de ativar o webhook.')
  if (!row.enabled && !existing?.sourceId && !row.url?.trim()) return null
  if (!plan.configuration.variables.length) {
    if (!row.enabled && !existing?.configuration && !row.url?.trim()) return null
    return unsupported('Declare valores padrão para os campos esperados do webhook.')
  }
  const configuration = parseHttpConfiguration({ enabled: row.enabled, method: row.method ?? 'POST', audiences: { private: false, voicePrivate: false, webchatChannelIds, incomingNumberIds, incomingDefaultRoute: false }, mappings: plan.configuration.variables.map(v => ({ variable: v.name, jsonPointer: `/${v.name.replace(/~/g, '~0').replace(/\//g, '~1')}` })), conditions: [], schedule: null }, plan.configuration)
  if (!row.url?.trim()) {
    if (!existing?.sourceId) return unsupported('Informe a URL HTTPS do webhook.')
    if (row.headers?.length || row.body !== undefined) return unsupported('Para alterar o corpo ou os cabeçalhos, informe também a URL completa do webhook.')
    if (configuration.method === 'GET' && existing.hasBodyTemplate) return unsupported('Informe a URL completa para trocar para GET e remover o corpo salvo.')
    return { configuration, secrets: { mode: 'keep' } }
  }
  if (row.url.includes('{{') || row.headers?.some(h => h.value.includes('{{'))) return unsupported('Use URL e cabeçalhos fixos neste webhook. Variáveis são aceitas apenas no corpo JSON.')
  const headers: Record<string, string> = {}
  for (const h of row.headers ?? []) { if (Object.keys(headers).some(k => k.toLowerCase() === h.key.toLowerCase())) return unsupported('Há cabeçalhos repetidos.'); headers[h.key] = h.value }
  let bodyTemplate: unknown
  if (configuration.method === 'POST') { try { bodyTemplate = JSON.parse(row.body ?? '{}') } catch { return unsupported('Informe um corpo JSON válido.') }; bodyTemplate = translateBody(bodyTemplate, plan.configuration.variables) }
  return { configuration, secrets: parseHttpSecrets({ mode: 'replace', url: row.url, headers, ...(configuration.method === 'POST' ? { bodyTemplate } : {}) }, configuration, plan.configuration) }
}
