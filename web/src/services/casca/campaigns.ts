import type { Campaign } from '@/domain/types'
import { useStore } from '@/data/store'
import { captureEngineContext, type EngineContext } from '../engine/session'
import { publishSlice } from './data'
export async function loadCampaigns(context: EngineContext) {
  const campaigns: Campaign[] = [], seen = new Set<string>()
  for (let page = 1; page <= 1000; page++) {
    const value = await context.request<{ items: Array<{ id: string; tenantId: string; name: string; channel: string; status: string; agentId: string | null; contactIds: string[]; messageTemplate: string; scheduledAt?: string; createdAt: string }>; total: number; totalPages: number }>('/campaigns', { query: { page, limit: 100 } })
    if (!Array.isArray(value.items) || !Number.isSafeInteger(value.total) || !Number.isSafeInteger(value.totalPages)) throw new Error('Não foi possível carregar as campanhas.')
    for (const row of value.items) {
      if (row.tenantId !== context.tenantId || row.status !== 'draft' || seen.has(row.id)) throw new Error('Atualize a lista de campanhas.')
      seen.add(row.id)
      if (row.channel === 'phone') campaigns.push({ id: row.id, orgId: row.tenantId, name: row.name, agentId: row.agentId ?? '', contactIds: row.contactIds, status: 'draft', createdAt: row.createdAt, objective: row.messageTemplate, scheduledAt: row.scheduledAt, stats: { called: 0, reached: 0, resolved: 0 } })
    }
    if (page >= value.totalPages) {
      if (seen.size !== value.total) throw new Error('A lista mudou. Atualize as campanhas.')
      context.assertCurrent(); return { campaigns }
    }
  }
  throw new Error('A lista de campanhas ultrapassou o limite de leitura.')
}
export async function deleteCampaign(id: string) {
  const context = captureEngineContext('campaigns:write')
  await context.request(`/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }); context.assertCurrent()
  publishSlice(context, { campaigns: useStore.getState().db.campaigns.filter(c => c.id !== id) })
}
