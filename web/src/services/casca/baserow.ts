import type { Agent, IntegrationAction } from '@/domain/types'
import { createBaserowService, baserowAttempt, baserowConfiguration, validBaserowAttempt, type BaserowAttempt, type BaserowBinding, type BaserowConfiguration } from '../engine/baserow'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { EngineError, parseExpectedContext } from '../engine/http'
import type { SheetsReference } from './sheets'
import type { HttpResourceReference } from './http-resources'
import type { AirtableReference } from './airtable'

declare module '@/domain/types' {
  interface IntegrationAction { engineBinding?: { kind: 'baserow'; id: string; revision: number } | SheetsReference | HttpResourceReference | AirtableReference }
}
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Reference = { context: ExpectedContext; attempt: BaserowAttempt; bindingId?: string }
function invalid(): never { throw Error('Não foi possível confirmar a referência da tabela. Nenhuma nova configuração foi enviada.') }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v)

export function createBaserowConnector(context: EngineContext, identity: ExpectedContext, storage: StoragePort, agentId: string, slot: string) {
  const expected = parseExpectedContext(identity)
  if (context.tenantId !== expected.tenantId || !uuid(agentId)) invalid()
  const api = createBaserowService(context), key = `kloel-casca-baserow:${expected.userId}:${expected.tenantId}:${agentId}:${slot}`
  let busy = false
  function read(): Reference | null {
    context.assertCurrent(); const text = storage.getItem(key); if (text === null) return null
    let value: Reference; try { value = JSON.parse(text) } catch { invalid() }
    if (!value! || JSON.stringify(value.context) !== JSON.stringify(expected) || !validBaserowAttempt(value.attempt) || value.attempt.kind === 'row.create' || value.bindingId !== undefined && !uuid(value.bindingId) || Object.keys(value).some(k => !['context', 'attempt', 'bindingId'].includes(k))) invalid()
    return value
  }
  function write(value: Reference | null) {
    context.assertCurrent(); const text = value === null ? null : JSON.stringify(value)
    if (text === null) storage.removeItem(key); else storage.setItem(key, text)
    context.assertCurrent(); if (storage.getItem(key) !== text) invalid()
  }
  async function recover(reference: Reference, verify = false): Promise<BaserowBinding> {
    const operation = await api.operation(reference.attempt); context.assertCurrent()
    if (operation.status !== 'succeeded') throw Error('A configuração da tabela ainda não foi confirmada. Consulte novamente; nada será reenviado.')
    write({ ...reference, bindingId: operation.bindingId })
    let binding = await api.get(operation.bindingId)
    if (binding.revision !== operation.revision) throw Error('A configuração da tabela mudou. Atualize antes de continuar.')
    if (verify) {
      try { await api.fields(binding) }
      catch (error) {
        // The table was registered but Baserow refused the key/table: forget this attempt so a corrected key creates a new one.
        // A definitive refusal (wrong key/table) forgets this attempt so a corrected key creates a new one; transient failures keep it for a read-only retry.
        context.assertCurrent()
        if (error instanceof EngineError && [401, 403, 404].includes(error.status)) { write(null); throw Error('O Baserow recusou a chave de API ou o ID da tabela. Confira a chave (Database token com leitura) e o Table ID e conecte novamente.') }
        throw error
      }
      binding = await api.get(binding.id)
    }
    context.assertCurrent(); write(null); return binding
  }
  async function configure(configuration: BaserowConfiguration, previous?: BaserowBinding, verify = false) {
    context.assertCurrent(); if (busy) throw Error('Aguarde a configuração atual.')
    const input = baserowConfiguration(configuration), unresolved = read()
    busy = true
    try {
      if (unresolved) return await recover(unresolved, verify)
      const attempt = baserowAttempt(previous ? 'binding.update' : 'binding.create', previous)
      const reference = { context: expected, attempt }; write(reference)
      try { await api.configure(attempt, input) }
      catch (error) {
        context.assertCurrent()
        if (error instanceof EngineError && ['validation_error', 'invalid_input', 'forbidden', 'baserow_configuration_changed'].includes(error.code)) { write(null); throw error }
      }
      return await recover(reference, verify)
    } finally { busy = false }
  }
  return { configure, get: api.get, list: api.list,
    async connect(tableId: number, token: string, name: string) {
      if (!Number.isSafeInteger(tableId) || tableId < 1 || !token.trim()) throw Error('Informe o ID da tabela e a chave de API.')
      return configure({ name: name.trim() || 'Baserow', instanceUrl: 'https://api.baserow.io', tableId, token, allowedRoles: ['owner'], agentIds: [], allowCreate: false, enabled: true }, undefined, true)
    },
    async assign(binding: BaserowBinding, allowCreate: boolean) {
      const current = await api.get(binding.id)
      if (current.revision !== binding.revision) throw Error('A tabela mudou. Abra a integração novamente.')
      const { id: _id, revision: _revision, status: _status, lastReadAt: _lastRead, nativeConnector: _native, implementation: _implementation, liveValidation: _validation, createdAt: _createdAt, updatedAt: _updatedAt, ...configuration } = current
      return configure({ ...configuration, enabled: true, allowCreate, agentIds: [...new Set([...configuration.agentIds, agentId])] }, current, true)
    },
    async detach(binding: BaserowBinding) {
      const current = await api.get(binding.id)
      if (current.revision !== binding.revision) throw Error('A tabela mudou. Abra a integração novamente.')
      const { id: _id, revision: _revision, status: _status, lastReadAt: _lastRead, nativeConnector: _native, implementation: _implementation, liveValidation: _validation, createdAt: _createdAt, updatedAt: _updatedAt, ...configuration } = current
      return configure({ ...configuration, agentIds: configuration.agentIds.filter(id => id !== agentId) }, current)
    },
  }
}
export function baserowConnector(agentId: string, slot: string) {
  const context = captureEngineContext('integrations:execute'), identity = engineSession.getSnapshot().data!.identity.context
  return createBaserowConnector(context, identity, window.sessionStorage, agentId, slot)
}
export function projectBaserow(binding: BaserowBinding, existing?: IntegrationAction): IntegrationAction {
  return { ...existing, id: existing?.id ?? binding.id, integration: 'baserow', name: binding.name, timing: 'during', connected: binding.status === 'read_verified', config: { tableId: String(binding.tableId), action: binding.allowCreate ? 'Add row' : 'Search rows' }, engineBinding: { kind: 'baserow', id: binding.id, revision: binding.revision } }
}
export async function hydrateBaserow(context: EngineContext, agents: Agent[], prefetched?: Promise<BaserowBinding[]>): Promise<Agent[]> {
  const bindings = await (prefetched ?? createBaserowService(context).list()); context.assertCurrent()
  return agents.map(agent => {
    const own = bindings.filter(binding => binding.enabled && binding.agentIds.includes(agent.id))
    return { ...agent, integrations: [...agent.integrations.filter(i => i.integration !== 'baserow'), ...own.map(binding => projectBaserow(binding, agent.integrations.find(i => i.engineBinding?.id === binding.id)))] }
  })
}
