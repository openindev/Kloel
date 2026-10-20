import { EngineError } from './http'
import type { EngineContext } from './session'

export const integrationTemplates = ['custom_http', 'n8n', 'make', 'zapier', 'baserow', 'airtable', 'notion', 'slack', 'gohighlevel', 'cal_com'] as const
export type IntegrationTemplate = typeof integrationTemplates[number]
export type IntegrationAction = {
  id: string; name: string; description: string; template: IntegrationTemplate; targetOrigin: string
  method: string; argumentsSchema: Record<string, unknown>; responsePaths: Record<string, string>
  configuredSecretHeaders: string[]; signed: boolean; timeoutMs: number; allowedRoles: string[]; agentIds: string[]
  enabled: boolean; revision: number; status: 'configured_unverified' | 'endpoint_acknowledged' | 'disabled'
  lastAcknowledgedAt: string | null
  executionTiming?: 'during' | 'after'
}
export type IntegrationOperation = {
  id: string; actionId: string; revision: number; status: 'pending' | 'endpoint_acknowledged' | 'uncertain' | 'not_sent'
  httpStatus: number | null; errorCode: string | null; attempts: number; createdAt: string; updatedAt: string
  durationMs: number | null; requiresReconciliation: boolean; automaticRetry: false
}
export type IntegrationCapability = {
  name: string; implementation: 'native_partial' | 'generic_http_only' | 'not_implemented'
  capabilities: string[]; limits: string[]
  runtime: { state: string; accessibleConnectedAccounts: number; configuredHttpActions: number; configuredSpreadsheetBindings: number; configuredAirtableTables: number; configuredBaserowTables: number }
}
export type IntegrationRegistryEntry = { id: IntegrationTemplate; name: string; configuredActions: number }
export type IntegrationConfiguration = {
  name: string; description: string; template: IntegrationTemplate; url: string; method: string
  headers: Record<string, string>; argumentsSchema: Record<string, unknown>; responsePaths: Record<string, string>
  bodyTemplate?: unknown; signingSecret?: string; timeoutMs: number; allowedRoles: Array<'owner' | 'admin' | 'member'>; agentIds: string[]; enabled: boolean
}
export type IntegrationExecution = { ok: boolean; operation: IntegrationOperation; outcome: string; workflowCompletion: 'not_verified' }

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
function invalid(message = 'Os dados de integração recebidos são inválidos.'): never { throw new EngineError(0, 'invalid_response', message) }
function identifier(v: unknown): string { if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) invalid(); return v }
function dictionary(v: unknown): v is Record<string, string> { return record(v) && Object.values(v).every(x => typeof x === 'string') }
function items(v: unknown): unknown[] { if (!record(v) || !Array.isArray(v.items)) invalid(); return v.items }
function origin(v: unknown): string {
  if (typeof v !== 'string') invalid()
  try { const u = new URL(v); if (u.protocol !== 'https:' || u.origin !== v || u.username || u.password) invalid(); return u.origin } catch { invalid() }
}

/** Whitelist DTOs: endpoint paths, tokens, encrypted configuration and response bodies never enter the view model. */
export function parseIntegrationAction(v: unknown): IntegrationAction {
  if (!record(v) || v.transport !== 'generic_http' || v.nativeConnector !== false || v.workflowCompletion !== 'not_verified') invalid()
  if (v.executionTiming !== undefined && !['during', 'after'].includes(String(v.executionTiming))) invalid()
  if (!record(v) || typeof v.name !== 'string' || typeof v.description !== 'string' || !integrationTemplates.includes(v.template as IntegrationTemplate) || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(v.method)) || !record(v.argumentsSchema) || !dictionary(v.responsePaths) || !strings(v.configuredSecretHeaders) || typeof v.signed !== 'boolean' || !natural(v.timeoutMs) || !strings(v.allowedRoles) || !strings(v.agentIds) || typeof v.enabled !== 'boolean' || !natural(v.revision) || !['configured_unverified', 'endpoint_acknowledged', 'disabled'].includes(String(v.status)) || (v.lastAcknowledgedAt !== null && typeof v.lastAcknowledgedAt !== 'string')) invalid()
  return { id: identifier(v.id), name: v.name, description: v.description, template: v.template as IntegrationTemplate, targetOrigin: origin(v.targetOrigin), method: String(v.method), argumentsSchema: structuredClone(v.argumentsSchema), responsePaths: { ...v.responsePaths }, configuredSecretHeaders: [...v.configuredSecretHeaders], signed: v.signed, timeoutMs: v.timeoutMs, allowedRoles: [...v.allowedRoles], agentIds: v.agentIds.map(identifier), enabled: v.enabled, revision: v.revision, status: v.status as IntegrationAction['status'], lastAcknowledgedAt: v.lastAcknowledgedAt as string | null, ...(v.executionTiming === undefined ? {} : { executionTiming: v.executionTiming as 'during' | 'after' }) }
}
export function parseIntegrationOperation(v: unknown): IntegrationOperation {
  if (!record(v) || !['pending', 'endpoint_acknowledged', 'uncertain', 'not_sent'].includes(String(v.status)) || !natural(v.revision) || !natural(v.attempts) || (v.httpStatus !== null && (!natural(v.httpStatus) || v.httpStatus < 100 || v.httpStatus > 599)) || (v.durationMs !== null && !natural(v.durationMs)) || (v.errorCode !== null && (typeof v.errorCode !== 'string' || !/^[a-zA-Z0-9_:-]{1,100}$/.test(v.errorCode))) || !Number.isFinite(Date.parse(String(v.createdAt))) || !Number.isFinite(Date.parse(String(v.updatedAt))) || v.automaticRetry !== false || v.requiresReconciliation !== ['pending', 'uncertain'].includes(String(v.status))) invalid()
  return { id: identifier(v.id), actionId: identifier(v.actionId), revision: v.revision, status: v.status as IntegrationOperation['status'], httpStatus: v.httpStatus as number | null, errorCode: v.errorCode as string | null, attempts: v.attempts, createdAt: String(v.createdAt), updatedAt: String(v.updatedAt), durationMs: v.durationMs as number | null, requiresReconciliation: v.requiresReconciliation as boolean, automaticRetry: false }
}
function parseCapability(v: unknown): IntegrationCapability {
  const keys = ['accessibleConnectedAccounts', 'configuredHttpActions', 'configuredSpreadsheetBindings', 'configuredAirtableTables', 'configuredBaserowTables'] as const
  if (!record(v) || typeof v.name !== 'string' || !['native_partial', 'generic_http_only', 'not_implemented'].includes(String(v.implementation)) || !strings(v.capabilities) || !strings(v.limits) || !record(v.runtime) || !['not_implemented', 'read_verified', 'configured_unverified', 'not_configured', 'endpoint_acknowledged', 'account_connected', 'account_connected_config_incomplete', 'authorization_required'].includes(String(v.runtime.state)) || keys.some(k => !natural((v.runtime as Record<string, unknown>)[k]))) invalid()
  return { name: v.name, implementation: v.implementation as IntegrationCapability['implementation'], capabilities: [...v.capabilities], limits: [...v.limits], runtime: { state: String(v.runtime.state), ...Object.fromEntries(keys.map(k => [k, v.runtime && (v.runtime as Record<string, unknown>)[k]])) } as IntegrationCapability['runtime'] }
}
export function integrationConfiguration(input: IntegrationConfiguration): IntegrationConfiguration {
  const fail = (message: string): never => { throw new EngineError(0, 'invalid_input', message) }
  if (!input.name.trim() || input.name.length > 120 || input.description.length > 1000 || !integrationTemplates.includes(input.template)) fail('Informe um nome de até 120 caracteres e um modelo válido.')
  let u: URL; try { u = new URL(input.url) } catch { return fail('Informe uma URL HTTPS completa.') }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || input.url.length > 8000) fail('Use HTTPS sem usuário, senha ou fragmento na URL.')
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method) || !dictionary(input.headers) || !dictionary(input.responsePaths) || !record(input.argumentsSchema) || input.argumentsSchema.type !== 'object') fail('Revise o método e os objetos JSON da configuração.')
  if (['GET', 'HEAD'].includes(input.method) && input.bodyTemplate !== undefined) fail('GET e HEAD não aceitam corpo.')
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 500 || input.timeoutMs > 15000 || !input.allowedRoles.length || input.allowedRoles.some(x => !['owner', 'admin', 'member'].includes(x)) || input.agentIds.length > 50) fail('Revise o tempo limite e os acessos da ação.')
  if (input.signingSecret !== undefined && (input.signingSecret.length < 16 || input.signingSecret.length > 1024)) fail('O segredo HMAC deve ter entre 16 e 1024 caracteres.')
  return { name: input.name.trim(), description: input.description, template: input.template, url: input.url, method: input.method, headers: { ...input.headers }, argumentsSchema: structuredClone(input.argumentsSchema), responsePaths: { ...input.responsePaths }, ...(input.bodyTemplate === undefined ? {} : { bodyTemplate: structuredClone(input.bodyTemplate) }), ...(input.signingSecret ? { signingSecret: input.signingSecret } : {}), timeoutMs: input.timeoutMs, allowedRoles: [...new Set(input.allowedRoles)], agentIds: input.agentIds.map(identifier), enabled: input.enabled }
}

export function createIntegrationService(context: EngineContext) {
  async function read<T>(path: string, parse: (value: unknown) => T, signal?: AbortSignal) {
    context.assertCurrent(); const value = await context.request(path, { signal }); context.assertCurrent(); return parse(value)
  }
  return {
    capabilities: (signal?: AbortSignal) => read('/integrations/capabilities', v => items(v).map(parseCapability), signal),
    registry: (signal?: AbortSignal) => read('/integrations/registry', v => items(v).map(raw => {
      if (!record(raw) || !integrationTemplates.includes(raw.id as IntegrationTemplate) || typeof raw.name !== 'string' || !natural(raw.configuredActions) || raw.nativeConnector !== false || raw.workflowCompletion !== 'not_verified') invalid()
      return { id: raw.id as IntegrationTemplate, name: raw.name, configuredActions: raw.configuredActions }
    }), signal),
    actions: (signal?: AbortSignal) => read('/integrations/actions', v => items(v).map(parseIntegrationAction), signal),
    operations: (signal?: AbortSignal) => read('/integrations/operations', v => items(v).map(parseIntegrationOperation), signal),
    async save(input: IntegrationConfiguration, id?: string) {
      context.assertCurrent(); const body = integrationConfiguration(input)
      const result = parseIntegrationAction(await context.request(id ? `/integrations/actions/${identifier(id)}` : '/integrations/actions', { method: id ? 'PUT' : 'POST', body }))
      context.assertCurrent(); if (id && result.id !== id) invalid(); return result
    },
    async enabled(id: string, enabled: boolean) {
      context.assertCurrent(); const result = parseIntegrationAction(await context.request(`/integrations/actions/${identifier(id)}`, { method: 'PATCH', body: { enabled } }))
      context.assertCurrent(); if (result.id !== id || result.enabled !== enabled) invalid(); return result
    },
    async execute(id: string, args: unknown, key: string): Promise<IntegrationExecution> {
      context.assertCurrent()
      const value = await context.request<unknown>(`/integrations/actions/${identifier(id)}/execute`, { method: 'POST', body: { arguments: args }, idempotencyKey: key, timeoutMs: 20000 })
      context.assertCurrent()
      if (!record(value) || typeof value.ok !== 'boolean' || !['endpoint_acknowledged', 'uncertain', 'not_confirmed', 'not_sent'].includes(String(value.outcome)) || (value.workflowCompletion !== undefined && value.workflowCompletion !== 'not_verified')) invalid()
      const operation = parseIntegrationOperation(value.operation)
      if (operation.actionId !== id || value.ok !== (operation.status === 'endpoint_acknowledged')) invalid()
      return { ok: value.ok, operation, outcome: String(value.outcome), workflowCompletion: 'not_verified' }
    },
  }
}

/** Arguments and key are frozen per explicit attempt, including a lost HTTP response. No automatic retries. */
export function createIntegrationAttempt(service: ReturnType<typeof createIntegrationService>, actionId: string, args: unknown, key = crypto.randomUUID()) {
  const frozen = structuredClone(args)
  let running: Promise<IntegrationExecution> | undefined
  return { key, run() { return running ??= service.execute(actionId, structuredClone(frozen), key).finally(() => { running = undefined }) } }
}
