import type { Agent, IntegrationAction } from '@/domain/types'
import { createAirtableService, airtableAttempt, validAirtableAttempt, bindingConfiguration, type AirtableAttempt, type AirtableBinding } from '../engine/airtable'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import { EngineError, parseExpectedContext } from '../engine/http'
import type { ExpectedContext } from '../engine/types'

export type AirtableReference = { kind: 'airtable'; id: string; revision: number }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Reference = { context: ExpectedContext; attempt: AirtableAttempt }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v)
function invalid(): never { throw Error('A referência da integração mudou. Atualize antes de continuar.') }

/** Uses existing, privately configured tables. Connection discovery never creates an OAuth grant. */
export function createAirtableConnector(context: EngineContext, identity: ExpectedContext, storage: StoragePort, agentId: string, slot: string) {
  const expected = parseExpectedContext(identity)
  if (context.tenantId !== expected.tenantId || !uuid(agentId)) invalid()
  const api = createAirtableService(context), key = `kloel-casca-airtable:${expected.userId}:${expected.tenantId}:${agentId}:${slot}`
  let busy = false
  function read(): Reference | null {
    context.assertCurrent(); const text = storage.getItem(key); if (text === null) return null
    let ref: Reference; try { ref = JSON.parse(text) } catch { invalid() }
    if (!ref! || Object.keys(ref).sort().join(',') !== 'attempt,context' || JSON.stringify(ref.context) !== JSON.stringify(expected) || !validAirtableAttempt(ref.attempt) || ref.attempt.kind !== 'binding.update') invalid()
    return ref
  }
  function write(ref: Reference | null) {
    context.assertCurrent(); const text = ref === null ? null : JSON.stringify(ref)
    if (text === null) storage.removeItem(key); else storage.setItem(key, text)
    context.assertCurrent(); if (storage.getItem(key) !== text) invalid()
  }
  async function recover(ref: Reference) {
    const result = await api.operation(ref.attempt)
    if (result.status !== 'succeeded') throw Error('A alteração ainda não foi confirmada. Consulte novamente; nada será reenviado.')
    const binding = await api.get(result.bindingId)
    if (binding.revision !== result.revision) throw Error('A tabela foi alterada novamente. Atualize a integração.')
    return binding
  }
  async function change(binding: AirtableBinding, attach: boolean, allowCreate = binding.allowCreate) {
    context.assertCurrent(); if (busy) throw Error('Aguarde a alteração da integração.'); busy = true
    try {
      const unresolved = read()
      if (unresolved) {
        const recovered = await recover(unresolved)
        if (recovered.id !== binding.id || recovered.agentIds.includes(agentId) !== attach || attach && recovered.allowCreate !== allowCreate) throw Error('A alteração anterior foi confirmada. Atualize antes de mudar a integração.')
        if (attach) await api.fields(recovered)
        return await api.get(recovered.id)
      }
      const current = await api.get(binding.id)
      if (current.revision !== binding.revision) throw Error('A tabela mudou. Abra a integração novamente.')
      if (attach && !current.enabled) throw Error('Esta conexão Airtable está desativada.')
      if (attach && current.allowCreate !== allowCreate && current.agentIds.some(id => id !== agentId)) throw Error('Esta tabela é compartilhada com outros assistentes. Preserve a ação já autorizada.')
      if (attach) await api.fields(current)
      if (current.agentIds.includes(agentId) === attach && (!attach || current.allowCreate === allowCreate)) return await api.get(current.id)
      const attempt = airtableAttempt('binding.update', current), ref = { context: expected, attempt }
      write(ref)
      try { await api.configure(attempt, { ...bindingConfiguration(current), allowCreate: attach ? allowCreate : current.allowCreate, agentIds: attach ? [...new Set([...current.agentIds, agentId])] : current.agentIds.filter(id => id !== agentId) }) }
      catch (error) {
        context.assertCurrent()
        if (error instanceof EngineError && ['validation_error', 'invalid_input', 'forbidden', 'airtable_configuration_changed'].includes(error.code)) { write(null); throw error }
      }
      const result = await recover(ref)
      if (attach) await api.fields(result)
      return await api.get(result.id)
    } finally { busy = false }
  }
  return { list: api.list, get: api.get,
    async connect(bindingId?: string) {
      const items = (await api.list()).filter(b => b.enabled)
      if (!items.length) throw Error('Nenhuma conexão Airtable está configurada para esta organização.')
      const binding = bindingId ? items.find(b => b.id === bindingId) : items[0]
      if (!binding) throw Error('A conexão Airtable selecionada não está disponível.')
      await api.fields(binding); const verified = await api.get(binding.id)
      return { items: items.map(b => b.id === verified.id ? verified : b), binding: verified }
    },
    assign: (binding: AirtableBinding, allowCreate: boolean) => change(binding, true, allowCreate),
    detach: (binding: AirtableBinding) => change(binding, false),
    acknowledge() { write(null) },
  }
}
export function airtableConnector(agentId: string, slot: string) {
  const context = captureEngineContext('integrations:execute'), identity = engineSession.getSnapshot().data!.identity.context
  return createAirtableConnector(context, identity, window.sessionStorage, agentId, slot)
}
export function projectAirtable(binding: AirtableBinding, existing?: IntegrationAction): IntegrationAction {
  return { ...existing, id: existing?.id ?? binding.id, integration: 'airtable', name: existing?.name ?? binding.name, timing: 'during', activeWindow: 'any', connected: binding.status === 'read_verified', config: { base: binding.id, table: binding.tableId, action: binding.allowCreate ? 'Create record' : 'Search records', account: binding.name }, engineBinding: { kind: 'airtable', id: binding.id, revision: binding.revision } }
}
export async function hydrateAirtable(context: EngineContext, agents: Agent[], prefetched?: Promise<AirtableBinding[]>): Promise<Agent[]> {
  const bindings = await (prefetched ?? createAirtableService(context).list()); context.assertCurrent()
  return agents.map(agent => ({ ...agent, integrations: [...agent.integrations.filter(i => i.integration !== 'airtable'), ...bindings.filter(b => b.enabled && b.agentIds.includes(agent.id)).map(b => projectAirtable(b, agent.integrations.find(i => i.engineBinding?.id === b.id)))] }))
}
