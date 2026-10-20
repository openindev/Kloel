import type { Booking, EventType } from '@/domain/types'
import type { CalendarOption } from '@/domain/ext/engine-scheduling'
import '@/domain/ext/engine-scheduling'
import { useStore } from '@/data/store'
import { baseLocationOf, normalizeEventType } from '@/app/pages/scheduling/model'
import { accountClient } from '@/services/engine/account'
import { captureEngineContext, engineSession, type EngineContext } from '@/services/engine/session'
import { schedulingClient, newEventConfig, eventConfig, type Calendar, type EventConfig, type EventSettings, type EventType as EngineEvent } from '@/services/engine/scheduling'
import type { NotificationTemplates } from '@/domain/ext/scheduling'
import { bookingOperationsClient, type OperatorBooking } from '@/services/engine/booking-operations'
import { loadConnections } from './oauth'
import { publishSlice } from './data'

const emptyCalendars: CalendarOption[] = []
/** "Sem limite" de agendamentos por dia = teto aceito pelo motor. */
const NO_DAILY_LIMIT = 1000
export const useSchedulingCalendars = () => useStore(s => s.db.engineScheduling?.calendars ?? emptyCalendars)
const bad = (message: string): never => { throw Error(message) }
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function projectEvent(row: EngineEvent): EventType {
  if (!row.createdAt || !Number.isFinite(Date.parse(row.createdAt))) bad('Não foi possível confirmar a data deste tipo de evento.')
  // The shell edits one interval per weekday. Preserve every original interval in the adapter.
  const days = Array.from({ length: 7 }, (_, day) => {
    const first = row.availability.find(a => a.weekday === day)
    return { day, enabled: !!first, from: first?.start ?? '09:00', to: first?.end ?? '18:00' }
  })
  const phone = row.form.find(f => f.field === 'phone'), n = row.notifications, kind = row.location.kind
  const reminders = n.reminders.map(r => ({ id: r.id, channel: 'email' as const, hoursBefore: r.hoursBefore }))
  // Modelos ausentes no motor ficam de fora: normalizeEventType completa com os padrões (mesmo texto que o motor usa).
  const templates = { ...(n.senderName ? { emailSenderName: n.senderName } : {}), email: n.email, ...(n.calendar ? { calendar: n.calendar } : {}) } as unknown as NotificationTemplates
  return normalizeEventType({ id: row.id, orgId: row.tenantId, name: row.name, slug: row.slug,
    durationMin: row.durationMinutes, description: row.description, calendarId: row.calendarId,
    location: baseLocationOf(kind), locationKind: kind, locationAddress: row.location.address, locationPhone: row.location.phone, availability: days, bufferMin: row.bufferMinutes,
    minNoticeHours: row.minimumNoticeMinutes / 60, maxDaysAhead: row.horizonDays,
    notifications: { confirmationEmail: n.invitee, reminderEmail: reminders.length > 0, reminderHours: reminders[0]?.hoursBefore ?? 24, smsReminder: false, notifyTeam: n.team },
    templates, reminders, staticInvitees: row.staticInvitees, conflictCalendarIds: row.conflictCalendarIds,
    dataCollection: row.customFields.map(f => ({ id: f.id, label: f.label, required: f.required, type: f.type })), customFieldsV2: true, webPhone: !phone ? 'hidden' : phone.required ? 'required' : 'optional',
    agentIds: row.agentIds, advanced: { allowReschedule: row.allowReschedule, allowCancel: row.allowCancel,
      slotIntervalMin: row.slotIntervalMinutes, maxPerDay: row.dailyLimit >= NO_DAILY_LIMIT ? 0 : row.dailyLimit },
    confirmationMessage: row.confirmationMessage, hideFromCompanyPage: row.hideFromCompanyPage, hostDisplayName: row.hostDisplayName,
    webhooks: row.webhooks.map(w => ({ id: w.id, url: w.url, events: w.events, createdAt: w.createdAt ?? '' })),
    active: row.enabled, timezone: row.timezone, createdAt: row.createdAt!, engineEvent: row })
}

/** Telefone digitado ("+55 (11) 3000-0000") no formato E.164 aceito pelo motor; vazio quando incompleto. */
export function e164(value: string | undefined) {
  const digits = (value ?? '').replace(/[^\d+]/g, '')
  const normalized = digits.startsWith('+') ? digits : digits ? `+${digits}` : ''
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : ''
}
/** Opções do rascunho no formato do motor (todas persistidas; nada é descartado em silêncio). */
export function settingsFromDraft(draft: EventType, previous: EngineEvent): EventSettings {
  const kind = draft.locationKind ?? 'none', t = draft.templates, rem = (draft.reminders ?? []).filter(r => r.channel === 'email')
  if (kind === 'phone' && (draft.locationPhone ?? '').trim() && !e164(draft.locationPhone)) bad('Informe o telefone do local com DDI e DDD, ex.: +55 11 3000-0000.')
  return {
    location: { kind, address: kind === 'physical' ? (draft.locationAddress ?? '').trim() : '', phone: kind === 'phone' ? e164(draft.locationPhone) : '' },
    customFields: draft.dataCollection.map(f => ({ id: f.id, label: f.label.trim(), type: f.type, required: f.required })),
    staticInvitees: (draft.staticInvitees ?? []).map(e => e.trim().toLowerCase()),
    conflictCalendarIds: (draft.conflictCalendarIds ?? []).filter(id => id !== draft.calendarId),
    notifications: { invitee: draft.notifications.confirmationEmail, team: draft.notifications.notifyTeam, senderName: (t?.emailSenderName ?? '').trim(),
      email: t ? { confirmation: t.email.confirmation, reschedule: t.email.reschedule, cancellation: t.email.cancellation } : previous.notifications.email,
      ...(t?.calendar ? { calendar: t.calendar } : previous.notifications.calendar ? { calendar: previous.notifications.calendar } : {}),
      reminders: rem.map(r => ({ id: r.id, hoursBefore: r.hoursBefore })) },
    confirmationMessage: (draft.confirmationMessage ?? '').trim(), hideFromCompanyPage: !!draft.hideFromCompanyPage, hostDisplayName: (draft.hostDisplayName ?? '').trim(),
    allowCancel: draft.advanced.allowCancel, allowReschedule: draft.advanced.allowReschedule,
    webhooks: (draft.webhooks ?? []).map(w => ({ id: w.id, url: w.url.trim(), events: w.events, ...(w.createdAt ? { createdAt: w.createdAt } : {}) })),
  }
}

export function configFromDraft(draft: EventType, previous: EngineEvent): EventConfig {
  const base = projectEvent(previous)
  if (!draft.calendarId) bad('Selecione um calendário.')
  const availability = same(draft.availability, base.availability) ? previous.availability : draft.availability.flatMap(day => {
    const original = previous.availability.filter(a => a.weekday === day.day)
    if (same(day, base.availability.find(a => a.day === day.day))) return original
    if (!day.enabled) return []
    return [{ weekday: day.day, start: day.from, end: day.to }, ...original.slice(1)]
  })
  const form = previous.form.filter(f => f.field !== 'phone')
  // Ligação telefônica sem número fixo: a equipe liga para o convidado, então o telefone é obrigatório.
  const callsInvitee = draft.locationKind === 'phone' && !e164(draft.locationPhone)
  if (draft.webPhone !== 'hidden' || callsInvitee) form.push({ field: 'phone', label: previous.form.find(f => f.field === 'phone')?.label ?? 'Telefone', required: draft.webPhone === 'required' || callsInvitee })
  return { ...settingsFromDraft(draft, previous), name: draft.name.trim(), description: draft.description.trim(), slug: draft.slug, calendarId: draft.calendarId!,
    timezone: draft.timezone ?? previous.timezone, durationMinutes: draft.durationMin, bufferMinutes: draft.bufferMin,
    minimumNoticeMinutes: draft.minNoticeHours * 60, horizonDays: draft.maxDaysAhead, dailyLimit: draft.advanced.maxPerDay > 0 ? draft.advanced.maxPerDay : NO_DAILY_LIMIT,
    slotIntervalMinutes: draft.advanced.slotIntervalMin, availability, form, agentIds: previous.agentIds, enabled: draft.active !== false }
}

export function projectBooking(row: OperatorBooking, tenantId: string): Booking {
  return { id: row.bookingRef, orgId: tenantId, eventTypeId: row.pageId ?? '', name: row.invitee?.name ?? '', ...(row.invitee?.email ? { email: row.invitee.email } : {}), ...(row.invitee?.phone ? { phone: row.invitee.phone } : {}),
    startsAt: row.startAt, status: (row.status === 'cancelled' ? 'canceled' : row.status) as Booking['status'], source: row.source ?? 'unknown',
    ...(row.cancelReason ? { cancelReason: row.cancelReason } : {}), ...(row.meetingUrl ? { meetingLink: row.meetingUrl } : {}), engineBooking: row }
}

export async function loadScheduling(context: EngineContext) {
  const client = schedulingClient(context)
  const owner = engineSession.getSnapshot().data?.identity.role === 'owner'
  const [events, calendars, config, bookings, connections] = await Promise.all([client.events(), client.calendars(), client.configuration(), owner ? bookingOperationsClient(context).list() : Promise.resolve([]), loadConnections(context)])
  context.assertCurrent()
  if (new Set(events.map(e => e.id)).size !== events.length || new Set(calendars.map(c => c.id)).size !== calendars.length) bad('A lista de calendários mudou. Atualize a página.')
  return { calendarConnections: connections, eventTypes: events.map(projectEvent), bookings: bookings.map(b => projectBooking(b, context.tenantId)),
    engineScheduling: { publicBaseUrl: config.publicBaseUrl, bookingsReadable: owner, calendars: calendars.map(calendarOption) } }
}

export function calendarOption(calendar: Calendar): CalendarOption {
  return { id: calendar.id, email: calendar.name, provider: calendar.provider, timezone: calendar.timezone, calendar }
}
export async function refreshScheduling(context = captureEngineContext()) {
  const slice = await loadScheduling(context); publishSlice(context, slice); return slice
}
function commitEvent(context: EngineContext, row: EngineEvent) {
  context.assertCurrent(); const event = projectEvent(row)
  useStore.getState().mutate(db => ({ ...db, eventTypes: db.eventTypes.some(e => e.id === event.id) ? db.eventTypes.map(e => e.id === event.id ? event : e) : [...db.eventTypes, event] }))
  return event
}
async function finalize(context: EngineContext, row: EngineEvent) {
  const client = schedulingClient(context)
  commitEvent(context, row)
  if (row.publicationStatus === 'published') return commitEvent(context, row)
  if (row.enabled && engineSession.getSnapshot().data?.identity.role === 'owner') {
    const result = await client.publish(row)
    row = { ...row, publicationStatus: 'published', publicPath: result.publicPath }
  }
  return commitEvent(context, row)
}
export async function saveEvent(draft: EventType) {
  const context = captureEngineContext('calendars:write'); let previous = draft.engineEvent
  if (!previous || previous.tenantId !== context.tenantId) bad('Atualize o tipo de evento antes de salvar.')
  const config = configFromDraft(draft, previous!)
  if (previous!.publicationStatus === 'published') {
    await schedulingClient(context).unpublish(previous!.id)
    previous = { ...previous!, publicationStatus: 'unpublished' }; commitEvent(context, previous)
  }
  return finalize(context, await schedulingClient(context).save(previous!, config))
}
export async function createEvent(input: { name: string; durationMin: number; calendarId?: string; location: string }, slug: string) {
  const context = captureEngineContext('calendars:write')
  if (!input.calendarId) bad('Selecione um calendário.')
  const calendar = useStore.getState().db.engineScheduling?.calendars.find(c => c.id === input.calendarId)
  if (!calendar?.calendar || !calendar.calendar.enabled || calendar.provider === 'local') bad('Selecione um calendário disponível.')
  const base = newEventConfig(input.calendarId), kind = (['online', 'phone', 'physical', 'none'] as const).find(k => k === input.location) ?? 'none'
  // "Ligação telefônica" sem número fixo: a empresa liga para o convidado, então o telefone passa a ser obrigatório.
  const form = kind === 'phone' ? [...base.form, { field: 'phone' as const, label: 'Telefone', required: true }] : base.form
  const config = { ...base, name: input.name, slug, durationMinutes: input.durationMin, timezone: calendar!.timezone, form, location: { kind, address: '', phone: '' } }
  return createConfig(context, config)
}
async function createConfig(context: EngineContext, config: EventConfig) {
  const identity = engineSession.getSnapshot().data!.identity.context
  const key = `kloel:casca:create-event:${identity.userId}:${identity.tenantId}:${identity.membershipId}:${identity.authorityVersion}`
  const bytes = sessionStorage.getItem(key)
  let pending: { config: EventConfig; id?: string } | undefined
  if (bytes) {
    try { const value = JSON.parse(bytes); pending = { config: eventConfig(value.config), ...(typeof value.id === 'string' ? { id: value.id } : {}) } }
    catch { return bad('Não foi possível ler a criação pendente. Confira os tipos de evento existentes.') }
  }
  let row: EngineEvent
  if (pending) {
    if (!same(eventConfig({ ...config, slug: pending.config.slug }), pending.config)) return bad('Conclua a criação anterior com os mesmos campos antes de criar outro evento.')
    const found = (await schedulingClient(context).events()).find(e => pending!.id ? e.id === pending!.id : e.slug === pending!.config.slug)
    if (!found || !same(eventConfig(found), eventConfig(pending.config))) return bad('A criação anterior ainda não foi confirmada. Consulte a lista antes de continuar.')
    row = found
  } else {
    const value = JSON.stringify({ config }); sessionStorage.setItem(key, value)
    if (sessionStorage.getItem(key) !== value) return bad('Não foi possível preservar a criação nesta aba.')
    try { row = await schedulingClient(context).create(config) }
    catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 400) { context.assertCurrent(); sessionStorage.removeItem(key) }
      throw error
    }
    const observed = JSON.stringify({ config, id: row.id }); sessionStorage.setItem(key, observed)
    if (sessionStorage.getItem(key) !== observed) return bad('O evento foi criado. Confira a lista antes de continuar.')
  }
  const result = await finalize(context, row)
  context.assertCurrent(); sessionStorage.removeItem(key)
  return result
}
export async function duplicateEvent(event: EventType, slug: string) {
  const context = captureEngineContext('calendars:write'), previous = event.engineEvent
  if (!previous) bad('Atualize o tipo de evento.')
  return createConfig(context, { ...configFromDraft(event, previous!), name: `${event.name} (cópia)`, slug, agentIds: [] })
}
export async function deleteEvent(event: EventType) {
  const context = captureEngineContext('calendars:write')
  if (!event.engineEvent) bad('Atualize o tipo de evento.')
  await schedulingClient(context).remove(event.engineEvent!)
  context.assertCurrent(); useStore.getState().mutate(db => ({ ...db, eventTypes: db.eventTypes.filter(e => e.id !== event.id) }))
}
export function eventPublicPath(event: EventType) {
  return event.engineEvent?.publicationStatus === 'published' ? event.engineEvent.publicPath : null
}

/** Discovery never registers a calendar or picks a provider calendar without a user selection. */
export async function discoverCalendars(connectionId: string): Promise<CalendarOption[]> {
  const context = captureEngineContext('integrations:execute'), userId = engineSession.getSnapshot().data!.identity.userId
  const connection = (await accountClient(context, userId).connections()).find(c => c.id === connectionId && c.status === 'connected')
  if (!connection) bad('A conexão não está disponível. Conecte a conta novamente.')
  const client = schedulingClient(context), found: CalendarOption[] = [], seen = new Set<string>(), cursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const result = await client.remoteCalendars(connection!, cursor)
    for (const remote of result.items) {
      if (seen.has(remote.id)) bad('A lista do provedor mudou. Tente novamente.')
      seen.add(remote.id)
      if (remote.writable) found.push({ id: `remote:${connection!.id}:${encodeURIComponent(remote.id)}`, email: `${remote.name} · ${connection!.email}`, provider: connection!.provider,
        timezone: remote.timezone ?? 'America/Sao_Paulo', remote: { connection: connection!, calendar: remote } })
    }
    if (!result.nextPageToken) { context.assertCurrent(); return found }
    if (cursors.has(result.nextPageToken)) bad('A lista do provedor mudou. Tente novamente.')
    cursors.add(result.nextPageToken); cursor = result.nextPageToken
  }
  return bad('Não foi possível carregar todos os calendários.')
}
export async function registerSelectedCalendar(option: CalendarOption): Promise<CalendarOption> {
  const context = captureEngineContext('calendars:write'), client = schedulingClient(context)
  if (option.calendar) return option
  if (!option.remote) return bad('Selecione um calendário.')
  // Refresh first so a retry after an uncertain response cannot silently create another registration.
  const current = await client.calendars()
  const matches = current.filter(c => c.connectionId === option.remote!.connection.id && c.externalCalendarId === option.remote!.calendar.id)
  if (matches.length > 1) return bad('Há mais de um registro deste calendário. Confira seus calendários.')
  const row = matches[0] ?? await client.registerCalendar(option.remote.connection, option.remote.calendar, option.timezone)
  context.assertCurrent(); const selected = calendarOption(row)
  useStore.getState().mutate(db => ({ ...db, engineScheduling: { publicBaseUrl: db.engineScheduling?.publicBaseUrl ?? '', bookingsReadable: db.engineScheduling?.bookingsReadable ?? false,
    calendars: [...(db.engineScheduling?.calendars ?? []).filter(c => c.id !== row.id), selected] } }))
  return selected
}

/** Histórico real de e-mails e webhooks do tipo de evento (motor). */
export async function loadNotificationHistory(eventTypeId: string, signal?: AbortSignal) {
  const context = captureEngineContext()
  const result = await schedulingClient(context).notifications(eventTypeId, signal)
  context.assertCurrent(); return result
}
/** "Enviar teste": POST real do motor para a URL informada, com dados de exemplo. */
export async function testEventWebhook(eventTypeId: string, url: string) {
  const context = captureEngineContext('calendars:write'), started = Date.now()
  try {
    const result = await schedulingClient(context).testWebhook(eventTypeId, url)
    return { status: result.delivered ? 'success' as const : 'error' as const, code: result.httpStatus, ms: result.durationMs }
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'O destino não respondeu ao teste.'
    throw Error(Date.now() - started > 9000 ? 'O destino não respondeu em 10 segundos.' : message)
  }
}
export const NOTIFICATION_STATUS_LABEL: Record<string, string> = {
  queued: 'agendado', pending: 'enviando', accepted: 'enviado', delivered: 'entregue', rejected: 'recusado', failed: 'falhou', uncertain: 'não confirmado', not_sent: 'não enviado', obsolete: 'cancelado',
}
export const NOTIFICATION_EVENT_LABEL: Record<string, string> = { created: 'Confirmação', rescheduled: 'Reagendamento', canceled: 'Cancelamento', reminder: 'Lembrete' }
