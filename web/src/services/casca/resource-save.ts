import type { Agent } from '@/domain/types'
import { useStore } from '@/data/store'
import { captureEngineContext, engineSession } from '../engine/session'
import { agentCommands, saveAgentFields } from './agents'
import { baserowConnector, hydrateBaserow } from './baserow'
import { sheetsResourceConnector, hydrateSheets, projectSheets } from './sheets';
import { saveHttpResourceFields } from './http-resource-save'
import { hydrateAgentResources } from './resource-hydration'
import { airtableConnector, projectAirtable } from './airtable'
import { assertExecutableResourceChanges } from './resource-capabilities'

/** Provider configuration is changed by its own contract; the editorial sidecar never grants tool access. */
export async function saveResourceFields(base: Agent, patch: Partial<Agent>): Promise<void> {
  assertExecutableResourceChanges(base, patch)
  if (await saveHttpResourceFields(base, patch)) return
  if (!patch.integrations) { await saveAgentFields(base, patch); return }
  const integrations = structuredClone(patch.integrations)
  patch = { ...patch, integrations }
  const supported = (row: Agent['integrations'][number]) => ['baserow', 'google-sheets', 'airtable'].includes(row.integration)
  const before = base.integrations.filter(supported), after = integrations.filter(supported)
  if (JSON.stringify(before) === JSON.stringify(after)) { await saveAgentFields(base, patch); return }
  const context = captureEngineContext('integrations:execute'), userId = engineSession.getSnapshot().data!.identity.context.userId
  if (context.tenantId !== base.orgId || context.generation !== base.cascaEditor?.generation) throw Error('A sessão mudou. Abra o assistente novamente.')
  const changed = after.filter(next => JSON.stringify(next) !== JSON.stringify(before.find(old => old.id === next.id)))
  const removed = before.filter(old => !after.some(next => next.id === old.id))
  if (changed.length + removed.length !== 1) throw Error('Salve uma integração por vez.')
  let providerChanged = false
  const acknowledgements: (() => void)[] = []
  const hydrate = async (agent: Agent) => (await hydrateAgentResources(context, [agent], userId))[0]
  try {
    for (const row of changed) {
      if (row.integration === 'airtable') {
        if (row.engineBinding?.kind !== 'airtable') throw Error('Conecte a tabela Airtable antes de salvar.')
        if (row.timing !== 'during' || row.activeWindow && row.activeWindow !== 'any') throw Error('Esta conexão Airtable está disponível durante a conversa, a qualquer momento.')
        if (!['Search records', 'Create record'].includes(row.config.action)) throw Error('Esta conexão Airtable permite pesquisar ou criar registros.')
        const api = airtableConnector(base.id, row.id), binding = await api.get(row.engineBinding.id)
        if (row.config.base !== binding.id || row.config.table !== binding.tableId) throw Error('Selecione uma tabela Airtable já configurada.')
        const previous = before.find(i => i.id === row.id)
        if (previous?.engineBinding && previous.engineBinding.id !== binding.id) throw Error('Remova a integração atual antes de selecionar outra tabela.')
        if (before.some(i => i.id !== row.id && i.engineBinding?.id === binding.id)) throw Error('Esta tabela já está ligada ao assistente.')
        const updated = await api.assign({ ...binding, revision: row.engineBinding.revision }, row.config.action === 'Create record'); providerChanged = true
        Object.assign(row, projectAirtable(updated, row)); acknowledgements.push(api.acknowledge)
        continue
      }
      if (row.integration === 'google-sheets') {
        const api = sheetsResourceConnector(base.id, row.id), result = await api.save(row)
        providerChanged = true
        Object.assign(row, projectSheets(result.action, result.binding, row))
        acknowledgements.push(api.acknowledge)
        continue
      }
      const reference = row.engineBinding
      if (!reference || reference.kind !== 'baserow') throw Error('Conecte a tabela Baserow antes de salvar.')
      if (row.timing !== 'during' || row.activeWindow && row.activeWindow !== 'any') throw Error('Esta conexão Baserow está disponível durante a conversa, a qualquer momento.')
      const api = baserowConnector(base.id, reference.id), binding = await api.get(reference.id)
      if (binding.revision !== reference.revision || Number(row.config.tableId) !== binding.tableId) throw Error('A tabela mudou. Conecte-a novamente antes de salvar.')
      if (!['Search rows', 'Add row'].includes(row.config.action)) throw Error('Escolha a ação da tabela.')
      const updated = await api.assign(binding, row.config.action === 'Add row'); providerChanged = true
      row.engineBinding = { kind: 'baserow', id: updated.id, revision: updated.revision }
    }
    for (const row of removed) {
      if (row.integration === 'airtable') {
        if (row.engineBinding?.kind !== 'airtable') throw Error('Atualize a integração antes de removê-la.')
        const api = airtableConnector(base.id, row.id), binding = await api.get(row.engineBinding.id)
        await api.detach({ ...binding, revision: row.engineBinding.revision }); providerChanged = true
        acknowledgements.push(api.acknowledge); continue
      }
      if (row.integration === 'google-sheets') {
        if (row.engineBinding?.kind !== 'sheets') throw Error('Atualize a integração antes de removê-la.')
        const api = sheetsResourceConnector(base.id, row.id)
        await api.remove(row.engineBinding); providerChanged = true
        acknowledgements.push(api.acknowledge)
        continue
      }
      if (row.engineBinding?.kind !== 'baserow') throw Error('Atualize a integração antes de removê-la.')
      const api = baserowConnector(base.id, row.engineBinding.id), binding = await api.get(row.engineBinding.id)
      if (binding.revision !== row.engineBinding.revision) throw Error('A tabela mudou. Atualize antes de removê-la.')
      await api.detach(binding); providerChanged = true
    }
    const saved = await agentCommands(base.id).update(base, patch), projected = await hydrate(saved)
    context.assertCurrent(); useStore.getState().patch('agents', base.id, projected)
    acknowledgements.forEach(acknowledge => acknowledge())
  } catch (error) {
    if (providerChanged) {
      try { const projected = await hydrate(await agentCommands(base.id).read(base.id)); context.assertCurrent(); useStore.getState().patch('agents', base.id, projected) } catch { /* Do not publish a guessed state. */ }
      throw Error(`A configuração da tabela mudou, mas não foi possível concluir o salvamento do assistente. ${error instanceof Error ? error.message : 'Atualize para conferir.'}`)
    }
    throw error
  }
}
