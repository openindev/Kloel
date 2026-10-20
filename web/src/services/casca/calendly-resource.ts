import type { SchedulingAction } from '@/domain/types'
import type { EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { createCalendlyService, type CalendlyAction, type CalendlyConnection, type CalendlyEventType, type CalendlyConfigAttempt, type CalendlyPolicy } from '../engine/calendly'
import { createCalendlyConfigJournal } from '../engine/calendly-journal'

export type CalendlyResource = { connectionId: string; eventTypeId: string; connection?: CalendlyConnection; event?: CalendlyEventType; actions: CalendlyAction[] }
declare module '@/domain/types' { interface SchedulingAction { engineCalendly?: CalendlyResource } }

export async function calendlyEvents(context: EngineContext, connection: CalendlyConnection) {
  const api = createCalendlyService(context), items: CalendlyEventType[] = [], ids = new Set<string>(), cursors = new Set<string>(); let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const result = await api.eventTypes(connection, cursor)
    for (const item of result.items) { if (ids.has(item.id)) throw Error('Os eventos mudaram. Consulte novamente.'); ids.add(item.id); items.push(item) }
    if (!result.nextCursor) { context.assertCurrent(); return items }
    if (cursors.has(result.nextCursor)) throw Error('Não foi possível carregar todos os eventos.')
    cursors.add(result.nextCursor); cursor = result.nextCursor
    await new Promise(resolve => setTimeout(resolve, 650))
  }
  throw Error('Não foi possível carregar todos os eventos.')
}

export async function loadCalendlyResources(context: EngineContext, agentId: string): Promise<SchedulingAction[]> {
  const api = createCalendlyService(context), [actions, options] = await Promise.all([api.actions(agentId), api.options(agentId)])
  const groups = new Map<string, CalendlyAction[]>(), events = new Map<string, CalendlyEventType[]>()
  for (const action of actions) { const key = `${action.connectionId}:${action.eventTypeId}`; groups.set(key, [...(groups.get(key) ?? []), action]) }
  for (const connection of options.connections.filter(c => c.status === 'connected' && actions.some(a => a.enabled && a.connectionId === c.id))) events.set(connection.id, await calendlyEvents(context, connection))
  context.assertCurrent()
  return [...groups.values()].filter(rows => rows.some(row => row.enabled)).map(rows => {
    const representative = rows.find(row => row.audience === 'private') ?? rows[0], connection = options.connections.find(c => c.id === representative.connectionId)
    const event = events.get(representative.connectionId)?.find(e => e.id === representative.eventTypeId)
    return { id: representative.id, provider: 'calendly', name: event?.name ?? '—', connectedAccount: connection?.status === 'connected' ? connection.displayName : undefined, calendarConnectionId: connection?.id,
      url: event?.schedulingUrl ?? undefined, activeWindow: 'any', description: '',
      settings: { timezone: event?.timezone ?? connection?.timezone ?? '', allowBookings: rows.some(row => row.enabled && row.allowCreate), destination: 'email', smsSenderName: '', allowBookingLinks: false, fallbackEmail: '', durationMin: event?.durationMinutes ?? 0, disableNotifications: true },
      engineCalendly: { connectionId: representative.connectionId, eventTypeId: representative.eventTypeId, connection, event, actions: rows } }
  })
}

export function createCalendlyResourceActions(context: EngineContext, agentId: string, identity: ExpectedContext, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const api = createCalendlyService(context), journal = createCalendlyConfigJournal(storage, identity, agentId), connections = createCalendlyConfigJournal(storage, identity)
  let busy = false
  async function recover(j = journal) { for (const attempt of j.read()) { const receipt = await api.configurationOperation(attempt); j.resolve(attempt, receipt, context.assertCurrent) } }
  async function write(attempt: CalendlyConfigAttempt, policy?: CalendlyPolicy, j = journal) { j.reserve(attempt, context.assertCurrent); const receipt = await api.configure(attempt, policy); j.resolve(attempt, receipt, context.assertCurrent); return receipt }
  async function locked<T>(fn: () => Promise<T>) { context.assertCurrent(); if (busy) throw Error('Aguarde a operação atual.'); busy = true; try { return await fn() } finally { busy = false } }
  return {
    save: (connectionId: string, eventTypeId: string, allowCreate: boolean) => locked(async () => {
      await recover()
      const options = await api.options(agentId), connection = options.connections.find(c => c.id === connectionId && c.status === 'connected')
      if (!connection) throw Error('Conecte novamente a conta do Calendly.')
      const event = (await calendlyEvents(context, connection)).find(e => e.id === eventTypeId && e.supported)
      if (!event) throw Error('Selecione um evento disponível nesta conta.')
      let rows = await api.actions(agentId)
      const audiences = [{ audience: 'private' as const, channelId: null as string | null }, ...options.channels.map(channel => ({ audience: 'webchat' as const, channelId: channel.id }))]
      for (const audience of audiences) {
        let row = rows.find(a => a.connectionId === connectionId && a.eventTypeId === eventTypeId && a.audience === audience.audience && a.channelId === audience.channelId), created = false
        if (!row) {
          const receipt = await write({ key: crypto.randomUUID(), kind: 'calendly.action.create', agentId, connectionId, eventTypeId, ...audience })
          rows = await api.actions(agentId); row = rows.find(a => a.id === receipt.resourceId); created = true
        }
        if (!row) throw Error('O vínculo ainda não foi confirmado. Atualize e consulte novamente.')
        if (!row.enabled || !row.available || row.allowCreate !== allowCreate) {
          const daysLeft = Math.ceil((Date.parse(row.expiresAt) - Date.now()) / 86400000)
          await write({ key: crypto.randomUUID(), kind: 'calendly.action.update', agentId, resourceId: row.id, expectedRevision: row.revision },
            { enabled: true, allowCreate, expiresInDays: created || daysLeft <= 0 ? 30 : Math.min(30, daysLeft), maxBookingsPerDay: created ? 100 : row.maxBookingsPerDay })
        }
      }
      const saved = (await api.actions(agentId)).filter(a => a.connectionId === connectionId && a.eventTypeId === eventTypeId)
      if (audiences.some(scope => !saved.some(a => a.audience === scope.audience && a.channelId === scope.channelId && a.enabled && a.available && a.allowCreate === allowCreate))) throw Error('Nem todos os vínculos foram confirmados. Consulte novamente.')
      return { connection, event, actions: saved }
    }),
    remove: (connectionId: string, eventTypeId: string) => locked(async () => {
      await recover()
      for (const row of (await api.actions(agentId)).filter(a => a.connectionId === connectionId && a.eventTypeId === eventTypeId && a.enabled)) {
        await write({ key: crypto.randomUUID(), kind: 'calendly.action.update', agentId, resourceId: row.id, expectedRevision: row.revision }, { enabled: false, allowCreate: false, expiresInDays: 1, maxBookingsPerDay: row.maxBookingsPerDay })
      }
      if ((await api.actions(agentId)).some(a => a.connectionId === connectionId && a.eventTypeId === eventTypeId && a.enabled)) throw Error('O vínculo ainda não foi desativado.')
    }),
    disconnect: (connectionId: string) => locked(async () => {
      await recover(connections)
      const connection = (await api.connections()).find(c => c.id === connectionId)
      if (!connection) throw Error('A conta não está disponível nesta sessão.')
      if (connection.status !== 'disconnected') await write({ key: crypto.randomUUID(), kind: 'calendly.connection.disconnect', agentId: null, resourceId: connection.id, expectedRevision: connection.revision }, undefined, connections)
      if ((await api.connections()).find(c => c.id === connectionId)?.status !== 'disconnected') throw Error('A desconexão ainda não foi confirmada.')
    }),
  }
}
