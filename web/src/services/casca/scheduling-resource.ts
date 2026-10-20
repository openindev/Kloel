import type { SchedulingAction } from '@/domain/types'
import { useStore } from '@/data/store'
import { captureEngineContext } from '@/services/engine/session'
import { createAssistantBookingService } from '@/services/engine/assistant-booking'
import { schedulingClient } from '@/services/engine/scheduling'
import { projectEvent } from './scheduling'
import { loadCalendlyResources } from './calendly-resource'
const reads = new Map<string, Promise<void>>()

export async function loadAgentScheduling(agentId: string) {
  const context = captureEngineContext(), key = `${context.generation}:${context.tenantId}:${agentId}`
  const previous = reads.get(key); if (previous) return previous
  const promise = (async () => {
    const [actions, events, calendly] = await Promise.all([createAssistantBookingService(context, agentId).list(), schedulingClient(context).events(), loadCalendlyResources(context, agentId)])
    context.assertCurrent()
    const grouped = new Map<string, typeof actions>()
    for (const action of actions) grouped.set(action.eventTypeId, [...(grouped.get(action.eventTypeId) ?? []), action])
    // Opções editoriais (nome, descrição, horário ativo, links, notificações) vêm do estado salvo do assistente.
    const savedOptions = (useStore.getState().db.agents.find(a => a.id === agentId)?.scheduling ?? []).filter(s => s.provider === 'kloel')
    const scheduling: SchedulingAction[] = [...grouped].filter(([, rows]) => rows.some(row => row.enabled)).map(([eventTypeId, rows]) => {
      const event = events.find(e => e.id === eventTypeId), representative = rows.find(a => a.audience === 'private') ?? rows[0]
      const prior = savedOptions.find(s => s.eventTypeId === eventTypeId), opts = (prior?.settings ?? {}) as Record<string, unknown>
      return { id: representative.id, provider: 'kloel', name: prior?.name?.trim() || event?.name || '—', eventTypeId, activeWindow: prior?.activeWindow ?? 'any', ...(prior?.description ? { description: prior.description } : {}),
        settings: { timezone: event?.timezone ?? '', allowBookings: rows.some(a => a.enabled && a.allowCreate), destination: 'email',
          smsSenderName: '', allowBookingLinks: opts.allowBookingLinks === true, fallbackEmail: '', durationMin: event?.durationMinutes ?? 0,
          disableNotifications: opts.disableNotifications === true }, engineBookingActions: rows }
    })
    useStore.getState().mutate(db => ({ ...db, eventTypes: events.map(projectEvent), agents: db.agents.map(agent => agent.id !== agentId ? agent : { ...agent,
      scheduling: [...agent.scheduling.filter(s => !['kloel', 'calendly'].includes(s.provider)), ...scheduling, ...calendly] }) }))
  })()
  reads.set(key, promise)
  try { await promise } finally { if (reads.get(key) === promise) reads.delete(key) }
}
