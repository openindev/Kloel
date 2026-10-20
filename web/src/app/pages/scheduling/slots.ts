import { addDays, startOfDay } from 'date-fns'
import type { Agent, Booking, DemoDB, EventType } from '@/domain/types'
import type { BookingNotice } from '@/domain/ext/mais-a'
import type { LocationKind, TemplateKind } from '@/domain/ext/scheduling'
import '@/domain/ext/mais-a'
import '@/domain/ext/scheduling'
import { uid } from '@/lib/utils'
import { useStore } from '@/data/store'
import { ADDONS } from '@/data/catalogs/plans'
import { billingCycles } from '../overview/plan-usage'
import { REMINDER_TEMPLATE, baseLocationOf, defaultTemplates, locationText, normalizeEventType, templateText } from './model'

/** Regras do Agendador: horários disponíveis, slugs e criação de tipos de evento. */

export const TABS = [
  { slug: 'general', label: 'Geral' },
  { slug: 'availability', label: 'Disponibilidade' },
  { slug: 'notifications', label: 'Notificações' },
  { slug: 'data-collection', label: 'Coleta de dados' },
  { slug: 'agents', label: 'Agentes' },
  { slug: 'advanced', label: 'Avançado' },
] as const
export type TabSlug = (typeof TABS)[number]['slug']

/** Rótulo do campo base `location` (os cartões de Local usam `LOCATION_KIND_LABEL` em model.ts). */
export const LOCATION_LABEL: Record<EventType['location'], string> = { phone: 'Sem local', video: 'Reunião online', in_person: 'Local físico' }
/** Fusos do Brasil oferecidos na Disponibilidade (rótulo no padrão "Cidade (GMT-3)" do seletor de fuso da Fonio). */
export const TIMEZONES: { id: string; label: string }[] = [
  { id: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' },
  { id: 'America/Fortaleza', label: 'Fortaleza (GMT-3)' },
  { id: 'America/Recife', label: 'Recife (GMT-3)' },
  { id: 'America/Belem', label: 'Belém (GMT-3)' },
  { id: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { id: 'America/Cuiaba', label: 'Cuiabá (GMT-4)' },
  { id: 'America/Rio_Branco', label: 'Rio Branco (GMT-5)' },
  { id: 'America/Noronha', label: 'Fernando de Noronha (GMT-2)' },
]
const fmtCache = new Map<string, Intl.DateTimeFormat>()
function cachedFmt(key: string, make: () => Intl.DateTimeFormat) {
  let f = fmtCache.get(key)
  if (!f) {
    f = make()
    fmtCache.set(key, f)
  }
  return f
}

/** "GMT+9", "GMT-3" (deslocamento atual do fuso, sem minutos quando inteiro). */
function gmtLabel(tz: string, at = new Date()) {
  const off = tzOffsetMin(tz, at)
  const h = Math.trunc(Math.abs(off) / 60)
  const m = Math.abs(off) % 60
  return off === 0 ? 'GMT' : `GMT${off < 0 ? '-' : '+'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

/**
 * Rótulo do fuso: os fusos do Brasil seguem o padrão "Cidade (GMT-3)"; os demais usam o nome localizado em
 * português (Intl, ex.: "Horário do Japão (GMT+9)") — nunca o identificador IANA cru.
 */
export const tzLabel = (id?: string) => {
  const tz = id ?? 'America/Sao_Paulo'
  const known = TIMEZONES.find((t) => t.id === tz)
  if (known) return known.label
  try {
    const name = cachedFmt(`name:${tz}`, () => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, timeZoneName: 'longGeneric' }))
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value
    const gmt = gmtLabel(tz)
    return name && !/^GMT/.test(name) ? `${name} (${gmt})` : gmt
  } catch {
    return 'São Paulo (GMT-3)'
  }
}

/** Data de calendário (ano, mês 1–12, dia) do instante `at` no fuso `tz`. */
function ymdIn(tz: string, at: Date) {
  try {
    const parts = cachedFmt(`ymd:${tz}`, () => new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })).formatToParts(at)
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    return { y: v('year'), m: v('month'), d: v('day') }
  } catch {
    return { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate() }
  }
}

/** Deslocamento (min) do fuso `tz` em relação ao UTC no instante `at` (ex.: São Paulo = -180). */
export function tzOffsetMin(tz: string, at: Date): number {
  try {
    const parts = cachedFmt(`off:${tz}`, () => new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })).formatToParts(at)
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    const wall = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour') % 24, v('minute'), v('second'))
    return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60000)
  } catch {
    return -at.getTimezoneOffset()
  }
}

/** Fuso de quem está vendo a página (os horários são exibidos nele). */
export const viewerTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  } catch {
    return 'America/Sao_Paulo'
  }
}

export const DAY_LABEL = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'evento'
  )
}

export function uniqueSlug(base: string, taken: string[]) {
  let slug = slugify(base)
  let i = 2
  while (taken.includes(slug)) slug = `${slugify(base)}-${i++}`
  return slug
}

/** Padrões de um novo tipo de evento (AP-01…AP-08): antecedência 4 horas, intervalo 0 minutos, janela sem limite, sem lembretes. */
export function defaultEventType(input: { name: string; durationMin: number; calendarId?: string; locationKind: LocationKind; slug: string; orgName?: string }): Partial<EventType> {
  return {
    name: input.name,
    slug: input.slug,
    durationMin: input.durationMin,
    description: '',
    calendarId: input.calendarId,
    location: baseLocationOf(input.locationKind),
    locationKind: input.locationKind,
    locationAddress: '',
    staticInvitees: [],
    conflictCalendarIds: [],
    availability: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: d >= 1 && d <= 5, from: '09:00', to: '18:00' })),
    bufferMin: 0,
    minNoticeHours: 4,
    maxDaysAhead: NO_LIMIT_DAYS,
    notifications: { confirmationEmail: true, reminderEmail: false, reminderHours: 24, smsReminder: false, notifyTeam: true },
    templates: defaultTemplates(input.orgName),
    reminders: [],
    webPhone: 'required',
    dataCollection: [],
    customFieldsV2: true,
    agentIds: [],
    advanced: { allowReschedule: true, allowCancel: true, slotIntervalMin: 30, maxPerDay: 0 },
    active: true,
    hideFromCompanyPage: false,
    hostDisplayName: '',
    webhooks: [],
    timezone: 'America/Sao_Paulo',
    confirmationMessage: '',
  }
}

/** "Sem limite" na janela máxima de agendamento = 365 dias (a página pública e as campanhas continuam com limite finito). */
export const NO_LIMIT_DAYS = 365

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export interface Busy {
  start: number
  end: number
}

/** Intervalos ocupados: agendamentos confirmados dos tipos de evento que usam o mesmo calendário. */
export function busyFor(et: EventType, eventTypes: EventType[], bookings: Booking[]): Busy[] {
  // mesmo calendário + calendários marcados em "Verificar conflitos" (botão de ajustes do Calendário, aba Geral)
  const cals = new Set([et.calendarId, ...(et.conflictCalendarIds ?? [])].filter(Boolean))
  const sameCal = new Map(eventTypes.filter((e) => e.id === et.id || (e.calendarId && cals.has(e.calendarId))).map((e) => [e.id, e]))
  return bookings
    .filter((b) => b.status === 'confirmed' && sameCal.has(b.eventTypeId))
    .map((b) => {
      const start = new Date(b.startsAt).getTime()
      return { start, end: start + (sameCal.get(b.eventTypeId)!.durationMin || 30) * 60000 }
    })
}

/**
 * Horários livres de um dia DO CALENDÁRIO DE QUEM VÊ a página, respeitando disponibilidade, intervalo, antecedência,
 * janela e limite diário. Os horários semanais valem no fuso do tipo de evento: o dia local pode cobrir duas datas
 * nesse fuso (ex.: Tóquio vê o fim da tarde de terça e a manhã de quarta de São Paulo na mesma quarta-feira),
 * então cada instante é gerado no fuso do evento e só entra se cair dentro do dia local escolhido.
 */
export function availableSlots(et: EventType, day: Date, busy: Busy[], bookingsOfType: Booking[], now = new Date()): Date[] {
  if (et.active === false) return []
  const d0 = startOfDay(day)
  const dEnd = addDays(d0, 1)
  const lastDay = addDays(startOfDay(now), et.maxDaysAhead)
  if (d0 < startOfDay(now) || d0 > lastDay) return []
  const tz = et.timezone ?? 'America/Sao_Paulo'
  const earliest = now.getTime() + et.minNoticeHours * 3600000
  const step = Math.max(5, et.advanced.slotIntervalMin || et.durationMin)
  const dur = et.durationMin * 60000
  const buf = et.bufferMin * 60000
  const key = (x: { y: number; m: number; d: number }) => `${x.y}-${x.m}-${x.d}`
  const dates = new Map([ymdIn(tz, d0), ymdIn(tz, new Date(dEnd.getTime() - 1))].map((x) => [key(x), x]))
  const confirmed = bookingsOfType.filter((b) => b.status === 'confirmed')
  const out: Date[] = []
  for (const date of dates.values()) {
    const base = Date.UTC(date.y, date.m - 1, date.d)
    const av = et.availability.find((a) => a.day === new Date(base).getUTCDay())
    if (!av?.enabled) continue
    // limite diário conta os agendamentos da mesma data no fuso do tipo de evento
    // 0 = sem limite diário
    if (et.advanced.maxPerDay > 0 && confirmed.filter((b) => key(ymdIn(tz, new Date(b.startsAt))) === key(date)).length >= et.advanced.maxPerDay) continue
    const off = tzOffsetMin(tz, new Date(base + 12 * 3600000))
    for (let m = toMin(av.from); m + et.durationMin <= toMin(av.to); m += step) {
      const t = base + (m - off) * 60000
      if (t < d0.getTime() || t >= dEnd.getTime() || t < earliest) continue
      const conflict = busy.some((b) => t - buf < b.end && t + dur + buf > b.start)
      if (!conflict) out.push(new Date(t))
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime())
}

/** Campo de texto que já pede o nome do convidado ("Nome", "Nome completo"…). */
export const isNameField = (f: EventType['dataCollection'][number]) => f.type === 'text' && /\bnome\b/i.test(f.label)

/* ------------------------------- Cota de SMS ------------------------------- */

/**
 * SMS do ciclo de cobrança atual: incluídos no plano = 0 (catálogo); cada unidade do add-on "SMS" = 100.
 * Uso = avisos SMS SIMULADOS registrados nos agendamentos da organização com data dentro do ciclo.
 */
export function smsQuotaOf(db: DemoDB, orgId: string | null | undefined, now = new Date()) {
  const addOn = db.billingProfiles.find((b) => b.orgId === orgId)?.addOns?.sms ?? 0
  const unit = ADDONS.find((a) => a.key === 'sms')?.unit ?? 100
  const quota = addOn * unit
  const cycle = billingCycles(db.subscriptions.filter((s) => s.orgId === orgId), now)[0]!
  const used = db.bookings
    .filter((b) => b.orgId === orgId)
    .flatMap((b) => b.notices ?? [])
    .filter((n) => n.channel === 'sms' && new Date(n.at).getTime() >= cycle.from.getTime() && new Date(n.at).getTime() < cycle.to.getTime()).length
  return { quota, used, left: Math.max(0, quota - used) }
}

/** Data/hora no fuso do tipo de evento (variáveis "Agendamento: Data/Horário"). */
function fmtIn(tz: string, d: Date, kind: 'date' | 'time') {
  try {
    return cachedFmt(`${kind}:${tz}`, () =>
      new Intl.DateTimeFormat('pt-BR', kind === 'date' ? { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' } : { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
    ).format(d)
  } catch {
    return kind === 'date' ? fmtLongDay(d) : fmtTime(d)
  }
}

export interface NoticeTarget {
  id?: string
  name?: string
  email?: string
  phone?: string
  startsAt: string
  meetingLink?: string
  cancelReason?: string
}

/** Valores das variáveis dos modelos (AP-05) para um agendamento. */
export function templateValues(et: EventType, b: NoticeTarget): Record<string, string> {
  const db = useStore.getState().db
  const org = db.organizations.find((o) => o.id === et.orgId)
  const provider = db.calendarConnections.find((c) => c.id === et.calendarId)?.provider
  const tz = et.timezone ?? 'America/Sao_Paulo'
  const start = new Date(b.startsAt)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return {
    'booking.cancel_reason': b.cancelReason?.trim() ?? '',
    'booking.date': fmtIn(tz, start, 'date'),
    'booking.duration': String(et.durationMin),
    'booking.title': et.name,
    'booking.location': locationText(et, provider),
    'booking.manage_url': `${origin}/c/${org?.slug ?? ''}/${et.slug}${b.id ? `?booking=${b.id}` : ''}`,
    'booking.meeting_link': b.meetingLink ?? '',
    'booking.time': fmtIn(tz, start, 'time'),
    'booking.timezone': tzLabel(tz),
    'guest.email': b.email ?? '',
    'guest.name': b.name ?? '',
    'guest.phone': b.phone ?? '',
    'company.name': org?.name ?? '',
  }
}

/**
 * Avisos SIMULADOS de um agendamento, conforme a aba Notificações do tipo de evento (nada é enviado):
 * notificação padrão (confirmação / reagendamento / cancelamento) pelo canal mais adequado — e-mail se houver,
 * senão mensagem de texto (SMS, com crédito) —, lembretes (e-mail ou SMS, N horas antes), convite de calendário aos
 * convidados fixos e aviso à equipe (dono do calendário). Assunto e mensagem saem dos modelos, com as variáveis
 * preenchidas.
 */
export function noticesFor(
  rawEt: EventType,
  b: NoticeTarget,
  event: 'created' | 'canceled' | 'rescheduled',
  teamEmail?: string,
  now = new Date(),
  /** há créditos de SMS no ciclo (sem créditos, nenhuma mensagem de texto é registrada) */
  smsAvailable = true,
): BookingNotice[] {
  const org = useStore.getState().db.organizations.find((o) => o.id === rawEt.orgId)
  const et = normalizeEventType(rawEt, org?.name)
  const n = et.notifications
  const tpl = et.templates!
  const values = templateValues(et, b)
  const text = (html: string) => templateText(html, values)
  const at = now.toISOString()
  const out: BookingNotice[] = []
  const tk: TemplateKind = event === 'created' ? 'confirmation' : event === 'rescheduled' ? 'reschedule' : 'cancellation'
  const kind: BookingNotice['kind'] = event === 'created' ? 'confirmation' : event === 'rescheduled' ? 'reschedule' : 'cancellation'
  const emailFrom = `${tpl.emailSenderName || org?.name || 'Kloel'} via Kloel`
  if (n.confirmationEmail) {
    if (b.email) out.push({ kind, channel: 'email', to: b.email, at, from: emailFrom, subject: text(tpl.email[tk].subject), body: text(tpl.email[tk].body) })
    else if (b.phone && smsAvailable) out.push({ kind, channel: 'sms', to: b.phone, at, from: tpl.smsSenderName, body: text(tpl.sms[tk].body) })
  }
  if (event !== 'canceled') {
    for (const r of et.reminders ?? []) {
      const due = new Date(new Date(b.startsAt).getTime() - r.hoursBefore * 3600000)
      const remindAt = (due.getTime() > now.getTime() ? due : now).toISOString()
      if (r.channel === 'email' && b.email) out.push({ kind: 'reminder', channel: 'email', to: b.email, at: remindAt, hoursBefore: r.hoursBefore, from: emailFrom, subject: text(REMINDER_TEMPLATE.subject), body: text(REMINDER_TEMPLATE.body) })
      if (r.channel === 'sms' && b.phone && smsAvailable) out.push({ kind: 'reminder', channel: 'sms', to: b.phone, at: remindAt, hoursBefore: r.hoursBefore, from: tpl.smsSenderName, body: text(REMINDER_TEMPLATE.body) })
    }
  }
  for (const inv of et.staticInvitees ?? []) out.push({ kind, channel: 'email', to: inv, at, audience: 'invitee', from: emailFrom, subject: text(tpl.calendar.subject), body: text(tpl.calendar.body) })
  if (n.notifyTeam) out.push({ kind: 'team', channel: 'team', to: teamEmail, at })
  return out
}

export function noticeLabel(x: BookingNotice) {
  if (x.audience === 'invitee') return x.kind === 'cancellation' ? 'Cancelamento do convite (convidado fixo)' : 'Convite de calendário (convidado fixo)'
  const sms = x.channel === 'sms'
  if (x.kind === 'confirmation') return sms ? 'SMS de confirmação' : 'E-mail de confirmação'
  if (x.kind === 'reschedule') return sms ? 'SMS de reagendamento' : 'E-mail de remarcação'
  if (x.kind === 'cancellation') return sms ? 'SMS de cancelamento' : 'E-mail de cancelamento'
  if (x.kind === 'team') return 'Equipe avisada'
  return sms ? 'Lembrete por SMS' : 'Lembrete por e-mail'
}

/** Mantém as ações "Agendar compromissos" dos assistentes em sincronia com EventType.agentIds. */
export function syncAgentScheduling(et: EventType, agentIds: string[], agents: Agent[]) {
  const { patch } = useStore.getState()
  const now = new Date().toISOString()
  for (const a of agents) {
    const has = a.scheduling.find((s) => s.eventTypeId === et.id)
    const want = agentIds.includes(a.id)
    if (want && !has) {
      patch('agents', a.id, { scheduling: [...a.scheduling, { id: uid('sch'), provider: 'kloel', name: et.name, eventTypeId: et.id, settings: {} }], updatedAt: now })
    } else if (!want && has) {
      patch('agents', a.id, { scheduling: a.scheduling.filter((s) => s.eventTypeId !== et.id), updatedAt: now })
    } else if (want && has && has.name !== et.name) {
      patch('agents', a.id, { scheduling: a.scheduling.map((s) => (s.eventTypeId === et.id ? { ...s, name: et.name } : s)), updatedAt: now })
    }
  }
}

const weekdayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
const longDayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
export const fmtWeekday = (d: Date) => weekdayFmt.format(d)
export const fmtLongDay = (d: Date) => longDayFmt.format(d)
export const fmtTime = (d: Date) => timeFmt.format(d)
