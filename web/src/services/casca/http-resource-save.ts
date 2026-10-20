import type { Agent, WebhookConfig } from '@/domain/types'
import { useStore } from '@/data/store'
import { captureEngineContext, engineSession } from '../engine/session'
import { agentCommands, saveAgentFields } from './agents'
import { httpConfigurationFor, httpResourceConnector, hydrateHttpResources, projectHttpAction } from './http-resources'
import { hydrateAgentResources } from './resource-hydration'

export async function saveHttpResourceFields(base: Agent, patch: Partial<Agent>): Promise<boolean> {
  const supported = (i: Agent['integrations'][number]) => ['n8n', 'make', 'zapier'].includes(i.integration)
  const oldIntegrations = base.integrations.filter(supported), integrations = structuredClone(patch.integrations ?? base.integrations)
  const oldHooks = base.webhooks, hooks = structuredClone(patch.webhooks ?? base.webhooks)
  const changedHooks = hooks.filter(row => JSON.stringify(row) !== JSON.stringify(oldHooks.find(old => old.id === row.id))), removedHooks = oldHooks.filter(old => !hooks.some(row => row.id === old.id))
  const changedIntegrations = integrations.filter(supported).filter(row => JSON.stringify(row) !== JSON.stringify(oldIntegrations.find(old => old.id === row.id))), removedIntegrations = oldIntegrations.filter(old => !integrations.some(row => row.id === old.id))
  const changes = changedHooks.length + removedHooks.length + changedIntegrations.length + removedIntegrations.length
  if (!changes) return false
  if (changes !== 1) throw Error('Salve uma requisição por vez.')
  if ([...changedHooks, ...removedHooks].some(row => ['inbound', 'test_context'].includes(row.kind))) { await saveAgentFields(base, patch); return true }
  if ([...changedHooks, ...removedHooks].some(row => row.kind !== 'http_request')) throw Error('Este contexto ainda não pode ser salvo nesta conexão. Nenhuma configuração foi alterada.')
  const context = captureEngineContext('integrations:manage')
  const userId = engineSession.getSnapshot().data!.identity.context.userId
  if (context.tenantId !== base.orgId) throw Error('A organização da sessão mudou. Abra o assistente de novo antes de salvar.')
  if (context.generation !== base.cascaEditor?.generation) {
    const fresh = await agentCommands(base.id).read(base.id)
    if (fresh.orgId !== context.tenantId || fresh.cascaEditor?.generation !== context.generation) throw Error('Não foi possível confirmar o assistente. Atualize a página antes de salvar.')
    base = { ...base, cascaEditor: fresh.cascaEditor, runtimeStatus: fresh.runtimeStatus, engineBefore: base.engineBefore ?? fresh.engineBefore }
  }
  const acknowledgements: (() => void)[] = []; let changed = false
  try {
    for (const row of changedHooks) {
      const configuration = httpConfigurationFor(base, row), api = httpResourceConnector(base.id, row.id)
      const saved = await api.save(configuration, row.timing as 'during' | 'after', row.engineWebhook); changed = true
      Object.assign(row, projectHttpAction(saved.action, saved.reference, row)); acknowledgements.push(api.acknowledge)
    }
    for (const row of changedIntegrations) {
      const timeoutRaw = row.config.timeoutMs?.trim()
      const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined
      if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000)) throw Error('O tempo limite deve ficar entre 500 e 15000 ms.')
      const webhook: WebhookConfig = { id: row.id, kind: 'http_request', name: row.name, description: row.description, enabled: true, timing: row.timing, activeWindow: row.activeWindow, url: row.config.webhookUrl, method: 'POST', ...(timeoutMs ? { timeoutMs } : {}) }
      const configuration = httpConfigurationFor(base, webhook, row.integration as 'n8n' | 'make' | 'zapier', true), api = httpResourceConnector(base.id, row.id)
      const saved = await api.save(configuration, row.timing as 'during' | 'after', row.engineBinding?.kind === 'http' ? row.engineBinding : undefined); changed = true
      row.engineBinding = saved.reference; row.config = {}; row.connected = saved.action.status === 'endpoint_acknowledged'; acknowledgements.push(api.acknowledge)
    }
    for (const row of removedHooks) { if (!row.engineWebhook) throw Error('Atualize a requisição antes de removê-la.'); const api = httpResourceConnector(base.id, row.id); await api.remove(row.engineWebhook); changed = true; acknowledgements.push(api.acknowledge) }
    for (const row of removedIntegrations) { if (row.engineBinding?.kind !== 'http') throw Error('Atualize a integração antes de removê-la.'); const api = httpResourceConnector(base.id, row.id); await api.remove(row.engineBinding); changed = true; acknowledgements.push(api.acknowledge) }
    const saved = await agentCommands(base.id).update(base, { ...patch, ...(patch.webhooks ? { webhooks: hooks } : {}), ...(patch.integrations ? { integrations } : {}) })
    const [projected] = await hydrateAgentResources(context, [saved], userId); context.assertCurrent(); useStore.getState().patch('agents', base.id, projected)
    acknowledgements.forEach(acknowledge => acknowledge()); return true
  } catch (error) {
    if (changed) {
      try { const [projected] = await hydrateAgentResources(context, [await agentCommands(base.id).read(base.id)], userId); context.assertCurrent(); useStore.getState().patch('agents', base.id, projected) } catch { /* Preserve only confirmed reads. */ }
      throw Error(`A requisição foi configurada, mas o salvamento do assistente não foi concluído. ${error instanceof Error ? error.message : 'Atualize para conferir.'}`)
    }
    throw error
  }
}
