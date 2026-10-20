import { EngineError } from './http'
import type { EngineContext } from './session'
import type { Connection, Provider } from './account'

export type Availability = { weekday: number; start: string; end: string }
export type BookingField = { field: 'name' | 'email' | 'phone'; label: string; required: boolean }
export type MessageTemplate = { subject: string; body: string }
export type EventLocation = { kind: 'none' | 'online' | 'phone' | 'physical'; address: string; phone: string }
export type EventSettings = {
  location: EventLocation
  customFields: { id: string; label: string; type: 'text' | 'phone' | 'email'; required: boolean }[]
  staticInvitees: string[]
  conflictCalendarIds: string[]
  notifications: { invitee: boolean; team: boolean; senderName: string; email: Partial<Record<'confirmation' | 'reschedule' | 'cancellation', MessageTemplate>>; calendar?: MessageTemplate; reminders: { id: string; hoursBefore: number }[] }
  confirmationMessage: string
  hideFromCompanyPage: boolean
  hostDisplayName: string
  allowCancel: boolean
  allowReschedule: boolean
  webhooks: { id: string; url: string; events: ('created' | 'rescheduled' | 'canceled')[]; createdAt?: string }[]
}
export type EventConfig = { name: string; description: string; slug: string; calendarId: string; timezone: string; durationMinutes: number; bufferMinutes: number; minimumNoticeMinutes: number; horizonDays: number; dailyLimit: number; slotIntervalMinutes: number; availability: Availability[]; form: BookingField[]; agentIds: string[]; enabled: boolean } & EventSettings
export type NotificationRecord = { id: string; bookingId: string; event: 'created' | 'rescheduled' | 'canceled' | 'reminder'; audience: 'invitee' | 'team' | 'guest' | 'webhook'; channel: 'email' | 'webhook'; recipient: string; webhookId: string | null; dueAt: string; status: string; createdAt: string; completedAt: string | null; httpStatus: number | null; errorCode: string | null; hoursBefore: number | null }
export type EventType = EventConfig & { id: string; tenantId: string; revision: number; publicationStatus: 'draft' | 'unpublished' | 'published'; publicPath: string | null; createdAt?: string; updatedAt?: string }
export type Calendar = { id: string; tenantId: string; name: string; timezone: string; provider: 'local' | Provider; connectionId: string | null; externalCalendarId: string | null; agentId: string | null; enabled: boolean }
export type RemoteCalendar = { id: string; name: string; timezone: string | null; writable: boolean }
export type Booking = { bookingRef: string; pageId?: string; status: string; revision: number; startAt: string; endAt: string; timezone: string; needsReconciliation: boolean; notifications: 'not_sent'; requestedTime?: { startAt: string; endAt: string } }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const bad = (): never => { throw new EngineError(0, 'invalid_response', 'Resposta inválida do agendador. Atualize a tela para conferir o estado.') }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = (v: unknown) => { if (typeof v !== 'string' || !uuidPattern.test(v)) bad(); return v as string }
const text = (v: unknown) => { if (typeof v !== 'string') bad(); return v as string }
const integer = (v: unknown, min = 0) => { if (!Number.isSafeInteger(v) || Number(v) < min) bad(); return Number(v) }
const bool = (v: unknown) => { if (typeof v !== 'boolean') bad(); return v as boolean }
const zone = (v: unknown) => { const value = text(v).trim(); try { new Intl.DateTimeFormat('pt-BR', { timeZone: value }) } catch { bad() } return value }
export function bookingOrigin(v: unknown): string {
  let url: URL; try { url = new URL(text(v)) } catch { return bad() }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) bad()
  return url.origin
}
export function publicBookingUrl(origin: string, path: string) {
  if (!/^\/c\/o-[a-f0-9]{24}\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path) || path.split('/')[3].length > 80) bad()
  return bookingOrigin(origin) + path
}
const template = (v: unknown): MessageTemplate | undefined => record(v) ? { subject: typeof v.subject === 'string' ? v.subject : '', body: typeof v.body === 'string' ? v.body : '' } : undefined
/** Opções do tipo de evento; valores ausentes (motor anterior) recebem os mesmos padrões do motor. */
export function eventSettings(v: Record<string, unknown>): EventSettings {
  const loc = record(v.location) ? v.location : {}, n = record(v.notifications) ? v.notifications : {}, email = record(n.email) ? n.email : {}
  const kinds = ['none', 'online', 'phone', 'physical'] as const
  const list = <T,>(value: unknown, map: (item: Record<string, unknown>) => T): T[] => Array.isArray(value) ? value.map(item => record(item) ? map(item) : bad()) : []
  return {
    location: { kind: kinds.includes(loc.kind as typeof kinds[number]) ? loc.kind as EventLocation['kind'] : 'none', address: typeof loc.address === 'string' ? loc.address : '', phone: typeof loc.phone === 'string' ? loc.phone : '' },
    customFields: list(v.customFields, f => ({ id: text(f.id), label: text(f.label), type: ['text', 'phone', 'email'].includes(String(f.type)) ? f.type as 'text' : bad(), required: bool(f.required) })),
    staticInvitees: Array.isArray(v.staticInvitees) ? v.staticInvitees.map(text) : [],
    conflictCalendarIds: Array.isArray(v.conflictCalendarIds) ? v.conflictCalendarIds.map(uuid) : [],
    notifications: { invitee: n.invitee !== false, team: n.team === true, senderName: typeof n.senderName === 'string' ? n.senderName : '',
      email: Object.fromEntries((['confirmation', 'reschedule', 'cancellation'] as const).flatMap(k => { const t = template(email[k]); return t ? [[k, t]] : [] })),
      ...(template(n.calendar) ? { calendar: template(n.calendar) } : {}),
      reminders: list(n.reminders, r => ({ id: text(r.id), hoursBefore: integer(r.hoursBefore, 1) })) },
    confirmationMessage: typeof v.confirmationMessage === 'string' ? v.confirmationMessage : '', hideFromCompanyPage: v.hideFromCompanyPage === true, hostDisplayName: typeof v.hostDisplayName === 'string' ? v.hostDisplayName : '',
    allowCancel: v.allowCancel !== false, allowReschedule: v.allowReschedule !== false,
    webhooks: list(v.webhooks, w => ({ id: text(w.id), url: text(w.url), events: Array.isArray(w.events) ? w.events.map(e => ['created', 'rescheduled', 'canceled'].includes(String(e)) ? e as 'created' : bad()) : bad(), ...(typeof w.createdAt === 'string' ? { createdAt: w.createdAt } : {}) })),
  }
}
export function eventConfig(v: unknown): EventConfig {
  if (!record(v) || !Array.isArray(v.availability) || !Array.isArray(v.form) || !Array.isArray(v.agentIds)) return bad()
  return { ...eventSettings(v), name: text(v.name).trim(), description: text(v.description).trim(), slug: text(v.slug).trim().toLowerCase(), calendarId: uuid(v.calendarId), timezone: zone(v.timezone), durationMinutes: integer(v.durationMinutes, 5), bufferMinutes: integer(v.bufferMinutes), minimumNoticeMinutes: integer(v.minimumNoticeMinutes), horizonDays: integer(v.horizonDays, 1), dailyLimit: integer(v.dailyLimit, 1), slotIntervalMinutes: integer(v.slotIntervalMinutes, 5), enabled: bool(v.enabled), agentIds: v.agentIds.map(uuid),
    availability: v.availability.map(a => { if (!record(a) || integer(a.weekday) > 6 || !/^\d{2}:\d{2}$/.test(text(a.start)) || !/^\d{2}:\d{2}$/.test(text(a.end))) return bad(); return { weekday: Number(a.weekday), start: String(a.start), end: String(a.end) } }),
    form: v.form.map(f => { if (!record(f) || !['name', 'email', 'phone'].includes(String(f.field))) return bad(); return { field: f.field as BookingField['field'], label: text(f.label).trim(), required: bool(f.required) } }) }
}
function eventType(v: unknown, tenantId: string): EventType {
  if (!record(v) || v.tenantId !== tenantId || !['draft', 'unpublished', 'published'].includes(String(v.publicationStatus))) return bad()
  const path = v.publicPath === undefined || v.publicPath === null ? null : text(v.publicPath)
  if (path) publicBookingUrl('http://127.0.0.1:4310', path)
  return { ...eventConfig(v), id: uuid(v.id), tenantId, revision: integer(v.revision, 1), publicationStatus: v.publicationStatus as EventType['publicationStatus'], publicPath: path, ...(typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt)) ? { createdAt: v.createdAt } : {}), ...(typeof v.updatedAt === 'string' && Number.isFinite(Date.parse(v.updatedAt)) ? { updatedAt: v.updatedAt } : {}) }
}
function calendar(v: unknown, tenantId: string): Calendar {
  if (!record(v) || v.tenantId !== tenantId || !['local', 'google', 'microsoft'].includes(String(v.provider))) return bad()
  return { id: uuid(v.id), tenantId, name: text(v.name), timezone: zone(v.timezone), provider: v.provider as Calendar['provider'], connectionId: v.connectionId ? uuid(v.connectionId) : null, externalCalendarId: v.externalCalendarId ? text(v.externalCalendarId) : null, agentId: v.agentId ? uuid(v.agentId) : null, enabled: bool(v.enabled) }
}
function booking(v: unknown): Booking {
  if (!record(v) || !['pending', 'confirmed', 'unknown', 'failed', 'conflict', 'cancel_pending', 'cancelled', 'reschedule_pending', 'reschedule_unknown', 'reschedule_conflict'].includes(String(v.status)) || v.notifications !== 'not_sent') return bad()
  const result: Booking = { bookingRef: uuid(v.bookingRef), ...(v.pageId ? { pageId: uuid(v.pageId) } : {}), revision: integer(v.revision, 1), status: String(v.status), startAt: text(v.startAt), endAt: text(v.endAt), timezone: zone(v.timezone), needsReconciliation: v.needsReconciliation === true, notifications: 'not_sent' }
  if (!Number.isFinite(Date.parse(result.startAt)) || !Number.isFinite(Date.parse(result.endAt))) return bad()
  if (record(v.requestedTime)) result.requestedTime = { startAt: text(v.requestedTime.startAt), endAt: text(v.requestedTime.endAt) }
  return result
}
export function schedulingClient(context: EngineContext) {
  async function all<T>(path: string, parse: (v: unknown) => T, signal?: AbortSignal): Promise<T[]> {
    const items: T[] = []
    for (let page = 1; page <= 100; page++) {
      const data = await context.request<{ items: unknown[]; totalPages: number }>(path, { signal, query: { page, limit: 100 } })
      if (!Array.isArray(data.items) || !Number.isSafeInteger(data.totalPages) || data.totalPages < 0) return bad()
      items.push(...data.items.map(parse)); if (page >= data.totalPages) { context.assertCurrent(); return items }
    }
    throw new EngineError(0, 'too_many_results', 'A lista ultrapassou o limite desta tela. Nenhuma lista parcial foi usada.')
  }
  return {
    async configuration(signal?: AbortSignal) { const v = await context.request<{ publicBaseUrl: string }>('/scheduling/configuration', { signal }); return { publicBaseUrl: bookingOrigin(v.publicBaseUrl) } },
    events: (signal?: AbortSignal) => all('/scheduling/event-types', v => eventType(v, context.tenantId), signal),
    calendars: (signal?: AbortSignal) => all('/calendars', v => calendar(v, context.tenantId), signal),
    async remoteCalendars(connection: Connection, pageToken?: string) {
      const result = await context.request<{ source: Provider; items: unknown[]; nextPageToken: string | null }>(`/oauth/connections/${uuid(connection.id)}/calendars`, { query: { pageToken } })
      if (result.source !== connection.provider || !Array.isArray(result.items) || (result.nextPageToken != null && typeof result.nextPageToken !== 'string')) return bad()
      return { items: result.items.map(v => { if (!record(v)) return bad(); return { id: text(v.id), name: text(v.summary ?? v.name), timezone: typeof v.timeZone === 'string' ? zone(v.timeZone) : null, writable: connection.provider === 'google' ? ['owner', 'writer'].includes(String(v.accessRole)) : v.canEdit === true } }), nextPageToken: result.nextPageToken ?? null }
    },
    async registerCalendar(connection: Connection, remote: RemoteCalendar, timezone: string) {
      if (connection.status !== 'connected' || !connection.capabilities.includes('calendar_write') || !remote.writable) throw new EngineError(403, 'calendar_not_writable', 'Conecte um calendário com permissão de edição.')
      const v = await context.request('/calendars', { method: 'POST', body: { name: remote.name, provider: connection.provider, connectionId: uuid(connection.id), externalCalendarId: remote.id, timezone: zone(timezone), enabled: true, availability: [], appointmentDurationMinutes: 30, bufferMinutes: 0 } })
      return calendar(v, context.tenantId)
    },
    async create(config: EventConfig) { return eventType(await context.request('/scheduling/event-types', { method: 'POST', body: { ...eventConfig(config), publicationStatus: 'draft' } }), context.tenantId) },
    async save(previous: EventType, config: EventConfig) { if (previous.tenantId !== context.tenantId) return bad(); return eventType(await context.request(`/scheduling/event-types/${uuid(previous.id)}`, { method: 'PATCH', body: { ...eventConfig(config), revision: previous.revision } }), context.tenantId) },
    async remove(previous: EventType) { if (previous.tenantId !== context.tenantId) return bad(); await context.request(`/scheduling/event-types/${uuid(previous.id)}`, { method: 'DELETE', query: { revision: previous.revision } }) },
    async publish(previous: EventType) {
      const v = await context.request<{ published: boolean; revision: number; publicPath: string }>(`/scheduling/event-types/${uuid(previous.id)}/publish`, { method: 'POST', body: { revision: previous.revision } })
      if (v.published !== true || v.revision !== previous.revision) return bad(); publicBookingUrl('http://127.0.0.1:4310', v.publicPath); return v
    },
    async unpublish(id: string, revoke = false) { const v = await context.request<{ published: boolean; grantsRevoked: boolean }>(`/scheduling/event-types/${uuid(id)}/${revoke ? 'revoke-grant' : 'unpublish'}`, { method: 'POST', body: {} }); if (v.published !== false || v.grantsRevoked !== revoke) return bad(); return v },
    async bookings(signal?: AbortSignal) { const v = await context.request<{ items: unknown[] }>('/scheduling/bookings', { signal }); if (!Array.isArray(v.items)) return bad(); return v.items.map(booking) },
    async reconcile(id: string) { return booking(await context.request(`/scheduling/bookings/${uuid(id)}/reconcile`, { method: 'POST', body: {} })) },
    async notifications(id: string, signal?: AbortSignal): Promise<{ items: NotificationRecord[]; emailConfigured: boolean }> {
      const v = await context.request<{ items: unknown[]; emailConfigured: boolean }>(`/scheduling/event-types/${uuid(id)}/notifications`, { signal })
      if (!record(v) || !Array.isArray(v.items) || typeof v.emailConfigured !== 'boolean') return bad()
      return { emailConfigured: v.emailConfigured, items: v.items.map(item => { if (!record(item) || !uuid(item.id) || !uuid(item.bookingId) || !['created', 'rescheduled', 'canceled', 'reminder'].includes(String(item.event)) || !['email', 'webhook'].includes(String(item.channel))) return bad(); return item as unknown as NotificationRecord }) }
    },
    async testWebhook(id: string, url: string) {
      const v = await context.request<{ status: string; httpStatus: number; durationMs: number }>(`/scheduling/event-types/${uuid(id)}/webhooks/test`, { method: 'POST', body: { url } })
      if (!record(v) || !['delivered', 'rejected'].includes(String(v.status)) || !Number.isSafeInteger(v.httpStatus) || !Number.isFinite(v.durationMs)) return bad()
      return { delivered: v.status === 'delivered', httpStatus: v.httpStatus, durationMs: Math.round(v.durationMs) }
    },
  }
}

export const newEventConfig = (calendarId = ''): EventConfig => ({ name: 'Reunião', slug: '', description: '', calendarId, timezone: 'America/Sao_Paulo', durationMinutes: 30, bufferMinutes: 0, minimumNoticeMinutes: 60, horizonDays: 30, dailyLimit: 20, slotIntervalMinutes: 15, availability: [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), form: [{ field: 'name', label: 'Nome', required: true }, { field: 'email', label: 'E-mail', required: true }], agentIds: [], enabled: true, ...eventSettings({}) })
