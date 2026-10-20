import type { Agent, IntegrationAction as ShellIntegration, WebhookConfig } from '@/domain/types'
import { resolveVariable } from '@/app/pages/agents/resources/shared/variables'
import { createIntegrationService, integrationConfiguration, type IntegrationAction, type IntegrationConfiguration } from '../engine/integrations'
import { createIntegrationConfigurations, validIntegrationConfigAttempt, type IntegrationConfigAttempt } from '../engine/integration-configurations'
import { createAfterHttpService, validAfterHttpAttempt, type AfterHttpAttempt, type AfterHttpConfig } from '../engine/after-http'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import { EngineError, parseExpectedContext } from '../engine/http'
import type { ExpectedContext } from '../engine/types'

export type HttpResourceReference = { kind: 'http'; id: string; revision: number; timing: 'during' | 'after'; afterRevision?: number }
declare module '@/domain/types' { interface WebhookConfig { engineWebhook?: HttpResourceReference } }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Journal = { context: ExpectedContext; fingerprint: string; attempt?: IntegrationConfigAttempt; action?: { id: string; revision: number }; afterAttempt?: AfterHttpAttempt; afterRevision?: number; completed?: boolean }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v)
function invalid(): never { throw Error('Não foi possível confirmar a configuração HTTP. Nenhum envio foi repetido.') }
const only = (v: object, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k))

const closureProperties = { schemaVersion: { type: 'integer', const: 1 }, event: { type: 'string', const: 'conversation.closed' }, eventId: { type: 'string' }, conversationRef: { type: 'string' }, agentRef: { type: 'string' }, channel: { type: 'string', enum: ['webchat', 'whatsapp'] }, closureEpoch: { type: 'integer', minimum: 1 }, closedAt: { type: 'string' }, messageCount: { type: 'integer', minimum: 0 } }
export function httpConfigurationFor(agent: Agent, row: WebhookConfig, template: 'custom_http' | 'n8n' | 'make' | 'zapier' = 'custom_http', metadataBody = false): IntegrationConfiguration {
  if (!['during', 'after'].includes(row.timing ?? '') || row.activeWindow && row.activeWindow !== 'any') throw Error('Esta ação HTTP permite execução durante ou após a conversa, sem restrição de horário.')
  if (row.timing === 'after' && (row.method !== 'POST' || row.condition?.trim())) throw Error('O envio após a conversa aceita POST, sem condição adicional.')
  const headers = Object.fromEntries((row.headers ?? []).map(h => [h.key, h.value]))
  if ([row.url ?? '', ...Object.values(headers)].some(value => /\{\{|\}\}/.test(value))) throw Error('Use uma URL e cabeçalhos fixos. Insira variáveis no corpo JSON.')
  const properties: Record<string, unknown> = {}, required = new Set<string>()
  const custom = new Map((row.customVariables ?? []).map(v => [v.name, v]))
  function visit(value: unknown): unknown {
    if (typeof value === 'string') {
      const match = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value)
      if (!match) { if (/\{\{|\}\}/.test(value)) throw Error('Cada variável precisa ocupar todo o valor de um campo JSON.'); return value }
      const name = resolveVariable(match[1])
      if (name === 'agent.name') return agent.name
      if (name === 'company.id') return agent.orgId
      if (row.timing === 'after' && name === 'conversation.id') return { $arg: '/conversationRef' }
      if (row.timing === 'after') throw Error(`A variável ${name} não está disponível neste envio após a conversa.`)
      const definition = custom.get(name)
      if (!definition || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name) || !definition.description.trim()) throw Error(`Descreva a variável personalizada ${name} antes de salvar.`)
      properties[name] = { type: definition.type, description: definition.description.slice(0, 500), ...(definition.type === 'string' ? { maxLength: 2000 } : {}) }; required.add(name)
      return { $arg: `/${name}` }
    }
    if (Array.isArray(value)) return value.map(visit)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => { if (['__proto__', 'prototype', 'constructor', '$arg'].includes(key)) throw Error('Use somente campos JSON e variáveis selecionadas.'); return [key, visit(v)] }))
    return value
  }
  let bodyTemplate: unknown
  if (!['GET', 'HEAD'].includes(row.method ?? 'POST') && !metadataBody) { let body: unknown; try { body = JSON.parse(row.body || '{}') } catch { throw Error('Confira o corpo JSON da requisição.') }; bodyTemplate = visit(body) }
  const argumentsSchema = row.timing === 'after' ? { type: 'object', properties: closureProperties, required: Object.keys(closureProperties), additionalProperties: false } : { type: 'object', properties, required: [...required], additionalProperties: false }
  return integrationConfiguration({ name: row.name, description: `${row.description ?? ''}${row.condition ? ` Use somente quando: ${row.condition}.` : ''}`.slice(0, 1000), template, url: row.url ?? '', method: row.method ?? 'POST', headers, argumentsSchema, responsePaths: {}, ...(bodyTemplate === undefined ? {} : { bodyTemplate }), timeoutMs: row.timeoutMs ?? 5000, allowedRoles: ['owner', 'admin'], agentIds: [agent.id], enabled: row.enabled })
}

export function createHttpResourceConnector(context: EngineContext, identity: ExpectedContext, storage: StoragePort, agentId: string, slot: string) {
  const expected = parseExpectedContext(identity); if (!uuid(agentId) || expected.tenantId !== context.tenantId) invalid()
  const config = createIntegrationConfigurations(context), actions = createIntegrationService(context), after = createAfterHttpService(context)
  const key = `kloel-casca-http:${expected.userId}:${expected.tenantId}:${agentId}:${slot}`; let busy = false
  function read(): Journal | null {
    context.assertCurrent(); const raw = storage.getItem(key); if (raw === null) return null
    let value: Journal; try { value = JSON.parse(raw) } catch { invalid() }
    if (!value! || !only(value, ['context', 'fingerprint', 'attempt', 'action', 'afterAttempt', 'afterRevision', 'completed']) || JSON.stringify(value.context) !== JSON.stringify(expected) || !/^[a-f0-9]{64}$/.test(value.fingerprint)) invalid()
    if (value.attempt && !validIntegrationConfigAttempt(value.attempt) || value.afterAttempt && (!validAfterHttpAttempt(value.afterAttempt) || value.afterAttempt.agentId !== agentId)) invalid()
    if (value.action && (!only(value.action, ['id', 'revision']) || !uuid(value.action.id) || !Number.isSafeInteger(value.action.revision) || value.action.revision < 1)) invalid()
    if (value.afterRevision !== undefined && (!Number.isSafeInteger(value.afterRevision) || value.afterRevision < 1) || value.completed !== undefined && value.completed !== true) invalid()
    return value
  }
  function write(value: Journal | null) { context.assertCurrent(); const raw = value === null ? null : JSON.stringify(value); if (raw === null) storage.removeItem(key); else storage.setItem(key, raw); context.assertCurrent(); if (storage.getItem(key) !== raw) invalid() }
  async function fingerprint(value: unknown) { const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))); return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('') }
  async function current(id: string, revision: number) { const action = (await actions.actions()).find(a => a.id === id); if (!action || action.revision !== revision || !action.agentIds.includes(agentId)) throw Error('A ação mudou. Abra sua configuração novamente.'); return action }
  async function dispatch(journal: Journal, field: 'attempt' | 'afterAttempt', call: () => Promise<unknown>) {
    try { await call() } catch (error) { context.assertCurrent(); if (error instanceof EngineError && error.code === 'dns_failed') { delete journal[field]; write(journal); throw new EngineError(error.status, error.code, 'Não encontramos o endereço da URL informada. Confira o domínio e tente novamente.') } if (error instanceof EngineError && [400, 401, 403, 404, 409, 413, 422].includes(error.status)) { delete journal[field]; write(journal); throw error } }
  }
  async function recoverAction(journal: Journal) { if (!journal.attempt) invalid(); const receipt = await config.operation(journal.attempt); journal.action = { id: receipt.actionId, revision: receipt.revision }; delete journal.attempt; write(journal); return current(receipt.actionId, receipt.revision) }
  async function recoverAfter(journal: Journal) { if (!journal.afterAttempt) invalid(); const receipt = await after.operation(journal.afterAttempt); journal.afterRevision = receipt.revision; delete journal.afterAttempt; write(journal); const state = await after.config(agentId); if (state.revision !== receipt.revision || state.authorization.state === 'revoked') throw Error('O envio após a conversa mudou. Abra a configuração novamente.'); return state }
  async function controlAfter(journal: Journal, action: IntegrationAction, enabled: boolean, reference?: HttpResourceReference) {
    if (journal.afterAttempt) return recoverAfter(journal)
    const existing = await after.config(agentId)
    if (reference?.afterRevision !== undefined && existing.revision !== reference.afterRevision) throw Error('O envio após a conversa mudou. Abra a configuração novamente.')
    if (existing.configuration.enabled && existing.configuration.actionId !== action.id) throw Error('Já existe um envio após a conversa. Edite-o antes de selecionar outro.')
    const attempt: AfterHttpAttempt = { kind: 'after_http.configure', key: crypto.randomUUID(), agentId, expectedRevision: existing.revision }; journal.afterAttempt = attempt; write(journal)
    await dispatch(journal, 'afterAttempt', () => after.configure(attempt, { enabled, actionId: enabled ? action.id : null }, enabled ? action.revision : null, enabled))
    return recoverAfter(journal)
  }
  async function save(configuration: IntegrationConfiguration, timing: 'during' | 'after', reference?: HttpResourceReference) {
    context.assertCurrent(); if (busy) throw Error('Aguarde o salvamento da requisição.')
    const input = integrationConfiguration(configuration), hash = await fingerprint({ input, timing, reference: reference ?? null }), pending = read()
    if (pending && pending.fingerprint !== hash) throw Error('Consulte o salvamento anterior antes de mudar a requisição.')
    const journal: Journal = pending ?? { context: expected, fingerprint: hash }; busy = true
    try {
      if (!pending) {
        if (reference) { await current(reference.id, reference.revision); if (reference.timing !== timing) throw Error('Para mudar o momento de execução, remova esta ação e adicione outra.') }
        if (timing === 'after') { const state = await after.config(agentId); if (state.configuration.enabled && state.configuration.actionId !== reference?.id) throw Error('Já existe um envio após a conversa. Edite-o antes de selecionar outro.') }
        write(journal)
      }
      let action: IntegrationAction
      if (journal.attempt) action = await recoverAction(journal)
      else if (journal.action) action = await current(journal.action.id, journal.action.revision)
      else {
        const attempt: IntegrationConfigAttempt = { key: crypto.randomUUID(), actionId: reference?.id ?? null, expectedRevision: reference?.revision ?? 0 }; journal.attempt = attempt; write(journal)
        await dispatch(journal, 'attempt', () => config.configure(attempt, input, timing)); action = await recoverAction(journal)
      }
      if (timing === 'after' && !journal.completed) await controlAfter(journal, action, input.enabled, reference)
      journal.completed = true; write(journal)
      return { action, reference: { kind: 'http' as const, id: action.id, revision: action.revision, timing, ...(journal.afterRevision === undefined ? {} : { afterRevision: journal.afterRevision }) } }
    } finally { busy = false }
  }
  async function remove(reference: HttpResourceReference) {
    context.assertCurrent(); if (busy) throw Error('Aguarde o salvamento da requisição.')
    const hash = await fingerprint({ remove: reference }), pending = read(); if (pending && pending.fingerprint !== hash) throw Error('Consulte o salvamento anterior antes de remover a requisição.')
    const journal: Journal = pending ?? { context: expected, fingerprint: hash }; busy = true
    try {
      if (journal.completed) return
      write(journal)
      let action: IntegrationAction
      if (journal.attempt) action = await recoverAction(journal)
      else if (journal.action) action = await current(journal.action.id, journal.action.revision)
      else {
        action = await current(reference.id, reference.revision)
        if (reference.timing === 'after' && journal.afterRevision === undefined) await controlAfter(journal, action, false, reference)
        const attempt: IntegrationConfigAttempt = { key: crypto.randomUUID(), actionId: action.id, expectedRevision: action.revision, enabled: false }; journal.attempt = attempt; write(journal)
        await dispatch(journal, 'attempt', () => config.setEnabled(attempt, { purgeSecrets: true })); action = await recoverAction(journal)
      }
      if (action.enabled) throw Error('A ação ainda não foi desabilitada. Consulte novamente.')
      journal.completed = true; write(journal)
    } finally { busy = false }
  }
  return { save, remove, acknowledge() { const journal = read(); if (journal && !journal.completed) throw Error('A requisição ainda não foi confirmada.'); write(null) } }
}
export function httpResourceConnector(agentId: string, slot: string) { const context = captureEngineContext('integrations:manage'), expected = engineSession.getSnapshot().data!.identity.context; return createHttpResourceConnector(context, expected, window.sessionStorage, agentId, slot) }
export function projectHttpAction(action: IntegrationAction, reference: HttpResourceReference, existing?: WebhookConfig): WebhookConfig {
  return { ...existing, id: existing?.id ?? action.id, kind: 'http_request', name: action.name, description: action.description, enabled: action.enabled, method: action.method as WebhookConfig['method'], timing: reference.timing, activeWindow: 'any', timeoutMs: action.timeoutMs, engineWebhook: reference, url: '', headers: [], body: '' }
}
export async function hydrateHttpResources(context: EngineContext, agents: Agent[], prefetched?: { actions: Promise<IntegrationAction[]>; after: Map<string, Promise<AfterHttpConfig>> }): Promise<Agent[]> {
  const actions = await (prefetched?.actions ?? createIntegrationService(context).actions()), after = createAfterHttpService(context)
  return Promise.all(agents.map(async agent => {
    const state = await (prefetched?.after.get(agent.id) ?? after.config(agent.id)), owned = actions.filter(a => a.enabled && a.agentIds.includes(agent.id) && ['custom_http', 'n8n', 'make', 'zapier'].includes(a.template)), webhooks: WebhookConfig[] = [], integrations: ShellIntegration[] = []
    for (const action of owned) {
      const timing = action.executionTiming === 'after' || state.configuration.actionId === action.id ? 'after' : 'during', reference: HttpResourceReference = { kind: 'http', id: action.id, revision: action.revision, timing, ...(timing === 'after' ? { afterRevision: state.revision } : {}) }
      if (action.template === 'custom_http') { const row = projectHttpAction(action, reference, agent.webhooks.find(w => w.engineWebhook?.id === action.id)); if (timing === 'after') row.enabled = state.configuration.actionId === action.id && state.configuration.enabled && state.authorization.state === 'active'; webhooks.push(row) }
      else { const existing = agent.integrations.find(i => i.engineBinding?.kind === 'http' && i.engineBinding.id === action.id); integrations.push({ ...existing, id: existing?.id ?? action.id, integration: action.template, name: action.name, description: action.description, timing, activeWindow: 'any', config: {}, connected: action.status === 'endpoint_acknowledged', engineBinding: reference }) }
    }
    context.assertCurrent(); return { ...agent, webhooks: [...agent.webhooks.filter(w => w.kind !== 'http_request'), ...webhooks], integrations: [...agent.integrations.filter(i => !['n8n', 'make', 'zapier'].includes(i.integration)), ...integrations] }
  }))
}
