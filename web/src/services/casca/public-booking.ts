import type { Booking, EventType } from '@/domain/types'

export type PublicCustomField = { id: string; label: string; type: 'text' | 'phone' | 'email'; required: boolean }
export type PublicPage = { unavailable?: boolean; orgSlug: string; eventSlug: string; name: string; description: string; timezone: string; durationMinutes: number; horizonDays: number; minimumNoticeMinutes: number; form: { field: 'name' | 'email' | 'phone'; label: string; required: boolean }[]
  location?: { kind: 'none' | 'online' | 'phone' | 'physical'; address: string; phone: string }; customFields?: PublicCustomField[]; hostDisplayName?: string; confirmationMessage?: string; allowCancel?: boolean; allowReschedule?: boolean; emailNotifications?: 'enabled' | 'disabled'; listed?: boolean }
export type PublicSlot = { startAt: string; endAt: string; quote: string; expiresAt: number }
export type PublicReceipt = { bookingRef: string; revision: number; status: string; startAt: string; endAt: string; timezone: string; needsReconciliation?: boolean; rescheduleAllowed?: boolean; cancelAllowed?: boolean; inviteeEmail?: 'enabled' | 'disabled'; meetingUrl?: string }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type State = { version: 1; visitor?: { token: string; expiresAt: number }; manage?: { token: string; expiresAt: number }; receipt?: PublicReceipt; pending?: { kind: 'create' | 'reschedule' | 'cancel'; body: Record<string, unknown>; target?: { startAt: string; endAt: string } } }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v)
const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v)
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const invalid = (): never => { throw Error('Não foi possível confirmar os dados do agendamento.') }
const statuses = ['pending', 'confirmed', 'unknown', 'failed', 'conflict', 'cancel_pending', 'cancelled', 'reschedule_pending', 'reschedule_unknown', 'reschedule_conflict']
const transient = new Set(['pending', 'unknown', 'cancel_pending', 'reschedule_pending', 'reschedule_unknown', 'reschedule_conflict'])

export function parsePublicReceipt(v: unknown): PublicReceipt {
  if (!object(v) || !uuid(v.bookingRef) || !Number.isSafeInteger(v.revision) || v.revision < 1 || !statuses.includes(v.status) || !date(v.startAt) || !date(v.endAt) || typeof v.timezone !== 'string' || v.notifications !== 'not_sent') return invalid()
  let meetingUrl: string | undefined
  if (typeof v.meetingUrl === 'string') { try { const url = new URL(v.meetingUrl); if (url.protocol === 'https:') meetingUrl = url.toString() } catch { /* ignore an invalid link */ } }
  return { bookingRef: v.bookingRef, revision: v.revision, status: v.status, startAt: v.startAt, endAt: v.endAt, timezone: v.timezone,
    ...(typeof v.needsReconciliation === 'boolean' ? { needsReconciliation: v.needsReconciliation } : {}), ...(typeof v.rescheduleAllowed === 'boolean' ? { rescheduleAllowed: v.rescheduleAllowed } : {}),
    ...(typeof v.cancelAllowed === 'boolean' ? { cancelAllowed: v.cancelAllowed } : {}), ...(v.inviteeEmail === 'enabled' || v.inviteeEmail === 'disabled' ? { inviteeEmail: v.inviteeEmail } : {}), ...(meetingUrl ? { meetingUrl } : {}) }
}
function parsePage(v: unknown, orgSlug: string): PublicPage {
  if (!object(v) || v.orgSlug !== orgSlug || typeof v.eventSlug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.eventSlug) || typeof v.name !== 'string' || typeof v.description !== 'string' || typeof v.timezone !== 'string' || !Number.isSafeInteger(v.durationMinutes) || !Number.isSafeInteger(v.horizonDays) || v.horizonDays < 1 || v.horizonDays > 365 || !Number.isSafeInteger(v.minimumNoticeMinutes) || !Array.isArray(v.form)) return invalid()
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: v.timezone }) } catch { return invalid() }
  const form = v.form.map((f: unknown) => { if (!object(f) || !['name', 'email', 'phone'].includes(f.field) || typeof f.label !== 'string' || typeof f.required !== 'boolean') return invalid(); return { field: f.field as 'name' | 'email' | 'phone', label: f.label, required: f.required } })
  if (new Set(form.map(f => f.field)).size !== form.length) return invalid()
  const location = object(v.location) && ['none', 'online', 'phone', 'physical'].includes(v.location.kind) ? { kind: v.location.kind as 'none', address: typeof v.location.address === 'string' ? v.location.address : '', phone: typeof v.location.phone === 'string' ? v.location.phone : '' } : { kind: 'none' as const, address: '', phone: '' }
  const customFields = Array.isArray(v.customFields) ? v.customFields.map((f: unknown) => { if (!object(f) || typeof f.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(f.id) || typeof f.label !== 'string' || !['text', 'phone', 'email'].includes(f.type) || typeof f.required !== 'boolean') return invalid(); return { id: f.id, label: f.label, type: f.type as PublicCustomField['type'], required: f.required } }) : []
  return { orgSlug, eventSlug: v.eventSlug, name: v.name, description: v.description, timezone: v.timezone, durationMinutes: v.durationMinutes, horizonDays: v.horizonDays, minimumNoticeMinutes: v.minimumNoticeMinutes, form,
    location, customFields, hostDisplayName: typeof v.hostDisplayName === 'string' ? v.hostDisplayName : '', confirmationMessage: typeof v.confirmationMessage === 'string' ? v.confirmationMessage : '',
    allowCancel: v.allowCancel !== false, allowReschedule: v.allowReschedule !== false, emailNotifications: v.emailNotifications === 'enabled' ? 'enabled' : 'disabled', listed: v.listed !== false }
}
async function request(fetcher: typeof fetch, path: string, query: Record<string, string>, body?: unknown, auth?: { scheme: string; token: string }, signal?: AbortSignal) {
  const response = await fetcher(`/api/v1/public/booking/${path}?${new URLSearchParams(query)}`, { method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: `${auth.scheme} ${auth.token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const value = await response.json().catch(invalid)
  if (!response.ok) {
    const code = object(value) && object(value.error) && typeof value.error.code === 'string' ? value.error.code : 'booking_unavailable'
    const e = Error('Não foi possível confirmar o agendamento. Consulte a tentativa antes de continuar.') as Error & { code: string }; e.code = code; throw e
  }
  signal?.throwIfAborted(); return value
}
export async function loadPublicCompany(orgSlug: string, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!/^o-[a-f0-9]{24}$/.test(orgSlug)) return invalid()
  const items: PublicPage[] = [], seen = new Set<string>(); let total: number | undefined, name = ''
  for (let page = 1; page <= 100; page++) {
    const value = await request(fetcher, 'company', { orgSlug, page: String(page), limit: '100' }, undefined, undefined, signal)
    if (!object(value) || value.orgSlug !== orgSlug || typeof value.name !== 'string' || value.page !== page || value.limit !== 100 || !Number.isSafeInteger(value.total) || value.total < 0 || value.totalPages !== Math.ceil(value.total / 100) || !Array.isArray(value.items) || total !== undefined && value.total !== total || name && name !== value.name) return invalid()
    total = value.total; name = value.name
    for (const raw of value.items) { const p = parsePage(raw, orgSlug); if (seen.has(p.eventSlug)) return invalid(); seen.add(p.eventSlug); items.push(p) }
    if (page >= value.totalPages) { if (items.length !== total) return invalid(); return { orgSlug, name, items } }
  }
  return invalid()
}
/** Telefone digitado ("+55 11 90000-0000", "(11) 90000-0000") em E.164; números de 10-11 dígitos sem DDI são do Brasil. */
export function bookingPhone(value: string) {
  const raw = value.trim(); if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  return raw.startsWith('+') ? `+${digits}` : digits.length === 10 || digits.length === 11 ? `+55${digits}` : `+${digits}`
}
export function publicEvent(page: PublicPage): EventType {
  return { id: `${page.orgSlug}/${page.eventSlug}`, orgId: page.orgSlug, name: page.name, slug: page.eventSlug, description: page.description,
    timezone: page.timezone, durationMin: page.durationMinutes, maxDaysAhead: page.horizonDays, minNoticeHours: page.minimumNoticeMinutes / 60,
    location: page.location?.kind === 'online' ? 'video' : page.location?.kind === 'physical' ? 'in_person' : 'phone', locationKind: page.location?.kind ?? 'none', locationAddress: page.location?.address ?? '', locationPhone: page.location?.phone ?? '',
    availability: [], bufferMin: 0, agentIds: [], createdAt: '', active: true,
    notifications: { confirmationEmail: page.emailNotifications === 'enabled', reminderEmail: false, reminderHours: 0, smsReminder: false, notifyTeam: false },
    dataCollection: [...page.form.map(f => ({ id: `__${f.field}`, label: f.label, required: f.required, type: f.field === 'name' ? 'text' as const : f.field })), ...(page.customFields ?? []).map(f => ({ id: `c_${f.id}`, label: f.label, required: f.required, type: f.type }))],
    hostDisplayName: page.hostDisplayName ?? '', confirmationMessage: page.confirmationMessage ?? '',
    customFieldsV2: true, advanced: { allowCancel: page.allowCancel !== false, allowReschedule: page.allowReschedule !== false, slotIntervalMin: 0, maxPerDay: 0 } }
}
export function publicBooking(receipt: PublicReceipt, event: EventType): Booking {
  return { id: receipt.bookingRef, orgId: event.orgId, eventTypeId: event.id, startsAt: receipt.startAt, name: '', source: 'booking_page',
    status: (receipt.status === 'cancelled' ? 'canceled' : receipt.status) as Booking['status'], ...(receipt.meetingUrl ? { meetingLink: receipt.meetingUrl } : {}) }
}

/** Visitor credentials and opaque attempts belong only to this public page and browser tab. */
export function createPublicBookingClient(page: PublicPage, storage: StoragePort, fetcher: typeof fetch = fetch) {
  const query = { orgSlug: page.orgSlug, eventSlug: page.eventSlug }, key = `kloel:casca:public-booking:v1:${page.orgSlug}:${page.eventSlug}`
  let sessionRead: Promise<void> | undefined
  function state(): State {
    const bytes = storage.getItem(key); if (!bytes) return { version: 1 }
    let v: any; try { v = JSON.parse(bytes) } catch { return invalid() }
    if (!object(v) || v.version !== 1 || Object.keys(v).some(k => !['version', 'visitor', 'manage', 'receipt', 'pending'].includes(k))) return invalid()
    for (const p of ['visitor', 'manage']) if (v[p] && (!object(v[p]) || !token(v[p].token) || !Number.isFinite(v[p].expiresAt))) return invalid()
    if (v.receipt) parsePublicReceipt({ ...v.receipt, notifications: 'not_sent' })
    if (v.pending && (!object(v.pending) || !['create', 'reschedule', 'cancel'].includes(v.pending.kind) || !object(v.pending.body) || !uuid(v.pending.body.idempotencyKey))) return invalid()
    return v as State
  }
  function save(next: State) { const bytes = JSON.stringify(next); storage.setItem(key, bytes); if (storage.getItem(key) !== bytes) throw Error('Não foi possível preservar a tentativa nesta aba.'); return next }
  const auth = (management = false) => {
    const value = management ? state().manage : state().visitor
    if (!value || value.expiresAt <= Date.now()) throw Error('O link ou a sessão expirou. Solicite um novo link à empresa.')
    return { scheme: management ? 'BookingManage' : 'Booking', token: value.token }
  }
  async function session() {
    if (state().visitor && state().visitor!.expiresAt > Date.now()) return
    if (state().pending) throw Error('A sessão da tentativa expirou. Consulte a empresa antes de criar outra reserva.')
    if (sessionRead) return sessionRead
    sessionRead = (async () => { const v = await request(fetcher, 'sessions', query, {}); if (!object(v) || !token(v.token) || !Number.isFinite(v.expiresAt) || v.expiresAt <= Date.now()) return invalid(); save({ ...state(), visitor: { token: v.token, expiresAt: v.expiresAt } }) })()
    try { await sessionRead } finally { sessionRead = undefined }
  }
  function accept(raw: unknown) {
    const receipt = parsePublicReceipt(raw), previous = state()
    if (previous.receipt && previous.receipt.bookingRef !== receipt.bookingRef) return invalid()
    const pending = previous.pending
    const resolved = !pending || pending.kind === 'create' && !transient.has(receipt.status) || pending.kind === 'cancel' && receipt.status === 'cancelled' || pending.kind === 'reschedule' && receipt.status === 'confirmed' && receipt.startAt === pending.target?.startAt && receipt.endAt === pending.target?.endAt && receipt.revision > Number(pending.body.expectedRevision)
    save({ ...previous, receipt, ...(resolved ? { pending: undefined } : {}) }); return receipt
  }
  async function management() {
    const current = state()
    if (current.manage && current.manage.expiresAt > Date.now()) return
    if (!current.receipt) return invalid()
    const value = await request(fetcher, 'manage-token', query, { bookingRef: current.receipt.bookingRef }, auth())
    if (!object(value) || value.bookingRef !== current.receipt.bookingRef || !token(value.token) || !Number.isFinite(value.expiresAt)) return invalid()
    save({ ...state(), manage: { token: value.token, expiresAt: value.expiresAt } })
  }
  async function status() {
    const s = state(); if (!s.receipt) return undefined
    return accept(await request(fetcher, s.manage ? 'manage-status' : 'status', { ...query, bookingRef: s.receipt.bookingRef }, undefined, auth(!!s.manage)))
  }
  return {
    pending: () => !!state().pending,
    receipt: () => state().receipt,
    async restore(hash: string) {
      if (hash) {
        const h = new URLSearchParams(hash.replace(/^#/, '')), ref = h.get('booking'), manage = h.get('manage')
        if (h.size !== 2 || !uuid(ref) || !token(manage)) return invalid()
        const raw = await request(fetcher, 'manage-status', { ...query, bookingRef: ref }, undefined, { scheme: 'BookingManage', token: manage })
        const receipt = parsePublicReceipt(raw)
        if (receipt.bookingRef !== ref) return invalid()
        save({ version: 1, receipt, manage: { token: manage, expiresAt: Date.now() + 90 * 86400000 } })
        return receipt
      }
      return status()
    },
    status,
    async slots(from: string, to: string, moving = false, signal?: AbortSignal): Promise<PublicSlot[]> {
      if (!date(from) || !date(to) || Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 7 * 86400000) return invalid()
      if (moving) await management(); else await session()
      const items: PublicSlot[] = [], seen = new Set<string>(); let cursor = from
      for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
        const value = await request(fetcher, moving ? 'reschedule-slots' : 'slots', query, { from: cursor, to, ...(moving ? { bookingRef: state().receipt!.bookingRef } : {}) }, auth(moving), signal)
        if (!object(value) || !Array.isArray(value.slots) || typeof value.complete !== 'boolean' || value.remoteAvailabilityComplete !== true || value.reservationsGuaranteed !== false) return invalid()
        for (const slot of value.slots) {
          if (!object(slot) || !date(slot.startAt) || !date(slot.endAt) || Date.parse(slot.startAt) < Date.parse(cursor) || Date.parse(slot.endAt) > Date.parse(to) || Date.parse(slot.endAt) <= Date.parse(slot.startAt) || !token(slot.quote) || !Number.isFinite(slot.expiresAt) || seen.has(slot.startAt)) return invalid()
          seen.add(slot.startAt); items.push(slot as PublicSlot)
        }
        if (moving && (!state().receipt || value.expectedRevision !== state().receipt!.revision)) throw Error('O agendamento mudou. Consulte-o novamente.')
        if (value.complete) return items
        if (!date(value.nextFrom) || value.nextFrom <= cursor || value.nextFrom >= to) return invalid()
        cursor = value.nextFrom
      }
      return invalid()
    },
    async create(slot: PublicSlot | undefined, values: Record<string, string>) {
      await session(); let s = state()
      if (s.pending && s.pending.kind !== 'create') return invalid()
      if (!s.pending) {
        if (s.receipt || !slot || slot.expiresAt <= Date.now()) throw Error('Atualize os horários antes de confirmar.')
        const fields = Object.fromEntries([...page.form.map(f => [f.field, f.field === 'phone' ? bookingPhone(values.__phone ?? '') : (values[`__${f.field}`] ?? '').trim()]), ...(page.customFields ?? []).map(f => [`c_${f.id}`, (values[`c_${f.id}`] ?? '').trim()])])
        s = save({ ...s, pending: { kind: 'create', body: { quote: slot.quote, values: fields, idempotencyKey: crypto.randomUUID() } } })
      }
      // Only an explicit user action replays the exact idempotent request after a lost receipt.
      const result = accept(await request(fetcher, 'bookings', query, s.pending!.body, auth()))
      if (result.status === 'confirmed') {
        try { await management(); return (await status())! } catch { return result }
      }
      return result
    },
    async cancel(reason = '') {
      await management(); let s = state()
      if (!s.receipt) return invalid()
      if (s.pending) return (await status())!
      const why = reason.trim().slice(0, 300)
      s = save({ ...s, pending: { kind: 'cancel', body: { bookingRef: s.receipt.bookingRef, idempotencyKey: crypto.randomUUID(), ...(why ? { reason: why } : {}) } } })
      return accept(await request(fetcher, 'cancel', query, s.pending!.body, auth(true)))
    },
    async reschedule(slot?: PublicSlot) {
      await management(); let s = state()
      if (!s.receipt || s.pending && s.pending.kind !== 'reschedule') return invalid()
      if (!s.pending) {
        if (!slot || slot.expiresAt <= Date.now()) throw Error('Atualize os horários antes de remarcar.')
        s = save({ ...s, pending: { kind: 'reschedule', target: { startAt: slot.startAt, endAt: slot.endAt }, body: { bookingRef: s.receipt.bookingRef, expectedRevision: s.receipt.revision, quote: slot.quote, idempotencyKey: crypto.randomUUID() } } })
      }
      return accept(await request(fetcher, 'reschedule', query, s.pending!.body, auth(true)))
    },
    managementLink(origin: string) { const s = state(); return s.receipt && s.manage ? `${origin}/c/${page.orgSlug}/${page.eventSlug}#booking=${s.receipt.bookingRef}&manage=${s.manage.token}` : '' },
    restart() { const s = state(); if (s.pending || s.receipt && transient.has(s.receipt.status)) throw Error('Consulte o resultado pendente antes de agendar novamente.'); save({ version: 1, visitor: s.visitor }) },
  }
}
