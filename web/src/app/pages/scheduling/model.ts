import { MapPin, Phone, Video, X, type LucideIcon } from 'lucide-react'
import type { EventType } from '@/domain/types'
import '@/domain/ext/mais-a'
import '@/domain/ext/scheduling'
import type { BookingEvent, EventReminder, LocationKind, MessageTemplate, NotificationTemplates, TemplateKind, WebPhoneMode } from '@/domain/ext/scheduling'

/**
 * Modelo do tipo de evento conforme as telas observadas na central de ajuda (AP-01…AP-08): local em 3 opções,
 * convidados fixos, modelos de notificação com variáveis, lembretes, campos sempre coletados, página da empresa e
 * webhooks. Funções puras (sem store) — usadas pelo editor, pela página pública e por `noticesFor`.
 */

/* ---------------------------------- Local ---------------------------------- */

export const LOCATION_KINDS: LocationKind[] = ['online', 'phone', 'physical', 'none']
export const LOCATION_KIND_LABEL: Record<LocationKind, string> = { online: 'Reunião online', phone: 'Ligação telefônica', physical: 'Local físico', none: 'Sem local' }
export const LOCATION_KIND_ICON: Record<LocationKind, LucideIcon> = { online: Video, phone: Phone, physical: MapPin, none: X }

/** Tipos antigos: Videochamada → Reunião online, Presencial → Local físico; sem `locationKind` gravado → Sem local. */
export const locationKindOf = (et: Pick<EventType, 'location' | 'locationKind'>): LocationKind =>
  et.locationKind ?? (et.location === 'video' ? 'online' : et.location === 'in_person' ? 'physical' : 'none')
/** Campo base `location` mantido em sincronia (outros módulos podem ler o tipo base). */
export const baseLocationOf = (k: LocationKind): EventType['location'] => (k === 'online' ? 'video' : k === 'physical' ? 'in_person' : 'phone')

/** Texto do local exibido na página de reserva / variável "Agendamento: Local" (mesmo texto do motor). */
export function locationText(et: EventType, provider?: 'google' | 'microsoft') {
  const k = locationKindOf(et)
  if (k === 'physical') return et.locationAddress?.trim() || LOCATION_KIND_LABEL.physical
  if (k === 'phone') return et.locationPhone?.trim() ? `Ligação telefônica: ${et.locationPhone.trim()}` : 'Ligação telefônica para o seu telefone'
  if (k === 'online') return provider === 'microsoft' ? 'Reunião online (Microsoft Teams)' : provider === 'google' ? 'Reunião online (Google Meet)' : LOCATION_KIND_LABEL.online
  return ''
}

/* -------------------------------- Variáveis -------------------------------- */

export interface TemplateVariable {
  key: string
  label: string
  description: string
  /** pode ficar vazia (marcada com "?" no menu "Adicionar variável") */
  optional?: boolean
}

/** Catálogo do menu "Adicionar variável" (AP-05), em ordem alfabética como na referência. */
export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: 'booking.cancel_reason', label: 'Agendamento: Motivo do cancelamento', description: 'Motivo informado por quem cancelou. Vazio se nenhum motivo foi dado.', optional: true },
  { key: 'booking.date', label: 'Agendamento: Data', description: 'Data do compromisso, ex.: terça-feira, 21 de outubro.' },
  { key: 'booking.duration', label: 'Agendamento: Duração (minutos)', description: 'Duração do tipo de evento em minutos.' },
  { key: 'booking.title', label: 'Agendamento: Título do evento', description: 'Título do tipo de evento (aba Geral).' },
  { key: 'booking.location', label: 'Agendamento: Local', description: 'Endereço do local físico ou a plataforma da reunião online. Vazio em "Sem local".', optional: true },
  { key: 'booking.manage_url', label: 'Agendamento: URL de gerenciamento', description: 'Link onde o convidado reagenda ou cancela o compromisso.' },
  { key: 'booking.meeting_link', label: 'Agendamento: Link da reunião', description: 'Link da reunião online gerado na reserva. Vazio se o local não for "Reunião online".', optional: true },
  { key: 'booking.time', label: 'Agendamento: Horário', description: 'Horário de início, ex.: 14:30.' },
  { key: 'booking.timezone', label: 'Agendamento: Fuso horário', description: 'Fuso horário do tipo de evento, ex.: São Paulo (GMT-3).' },
  { key: 'guest.email', label: 'Convidado: E-mail', description: 'E-mail informado na reserva.', optional: true },
  { key: 'guest.name', label: 'Convidado: Nome', description: 'Nome de quem agendou.' },
  { key: 'guest.phone', label: 'Convidado: Telefone', description: 'Telefone informado na reserva ou na conversa.', optional: true },
  { key: 'company.name', label: 'Empresa: Nome', description: 'Nome da sua empresa (Configurações da empresa).' },
]
export const VARIABLE_BY_KEY: Record<string, TemplateVariable> = Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.key, v]))

/** Classe do chip de variável (mesmo padrão do editor de e-mail dos assistentes: texto brand sobre brand/10). */
export const CHIP_CLASS = 'kv-chip mx-0.5 inline-block rounded-md bg-brand/10 px-1.5 text-brand align-baseline'

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const chip = (key: string) => `<span data-var="${key}" contenteditable="false" class="${CHIP_CLASS}">${escapeHtml(VARIABLE_BY_KEY[key]?.label ?? key)}</span>`

/** Texto puro de um modelo (sem tags; chips viram o rótulo ou o valor). */
export function templateText(html: string, values?: Record<string, string>) {
  const withVars = html.replace(/<span[^>]*data-var="([^"]+)"[^>]*>.*?<\/span>/g, (_m, key: string) => (values ? values[key] ?? '' : `[${VARIABLE_BY_KEY[key]?.label ?? key}]`))
  return withVars
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|h2|h3)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------------ Modelos padrão ------------------------------ */

const g = chip('guest.name')
const t = chip('booking.title')
const c = chip('company.name')
const d = chip('booking.date')
const h = chip('booking.time')
const tz = chip('booking.timezone')
const m = chip('booking.manage_url')

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = { confirmation: 'Confirmação', reschedule: 'Reagendamento', cancellation: 'Cancelamento' }
export const TEMPLATE_KINDS: TemplateKind[] = ['confirmation', 'reschedule', 'cancellation']

export function defaultTemplates(orgName = ''): NotificationTemplates {
  return {
    emailSenderName: orgName,
    smsSenderName: smsSenderOf(orgName),
    email: {
      confirmation: { subject: `${t} confirmado: ${c} &lt;&gt; ${g}`, body: `<div>Olá ${g}, seu compromisso foi confirmado para ${d} às ${h} (${tz}).</div><div>Para reagendar ou cancelar: ${m}</div>` },
      reschedule: { subject: `${t} reagendado: ${c} &lt;&gt; ${g}`, body: `<div>Olá ${g}, seu compromisso foi reagendado para ${d} às ${h} (${tz}).</div>` },
      cancellation: { subject: `${t} cancelado: ${c} &lt;&gt; ${g}`, body: `<div>Olá ${g}, seu compromisso foi cancelado.</div>` },
    },
    sms: {
      confirmation: { subject: '', body: `<div>${c}: ${t} confirmado para ${d} às ${h}. Gerencie: ${m}</div>` },
      reschedule: { subject: '', body: `<div>${c}: ${t} reagendado para ${d} às ${h}.</div>` },
      cancellation: { subject: '', body: `<div>${c}: seu compromisso ${t} foi cancelado.</div>` },
    },
    calendar: { subject: `${t} — ${g}`, body: `<div>Compromisso com ${c}.</div><div>Para reagendar ou cancelar: ${m}</div>` },
  }
}

/** Lembretes (conteúdo fixo, exibido como prévia na lista de lembretes). */
export const REMINDER_TEMPLATE = { subject: `Lembrete: ${t} em ${d} às ${h}`, body: `<div>Olá ${g}, lembrete do seu compromisso ${t} em ${d} às ${h} (${tz}).</div>` }

/** Remetente de SMS (3 a 11 letras/números) derivado do nome da empresa: "Clínica Bem Viver" → "BemViver". */
export function smsSenderOf(name: string) {
  const words = name.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
  while (words.length > 1 && words.join('').length > 11) words.shift()
  const s = words.join('').slice(0, 11)
  return s.length >= 3 ? s : 'Kloel'
}
export const SMS_SENDER_RE = /^[A-Za-z0-9]{3,11}$/

/* ------------------------------ Normalização ------------------------------ */

const isNameLike = (f: EventType['dataCollection'][number]) => f.type === 'text' && /\bnome\b/i.test(f.label)

/** Campos antigos que hoje são "sempre coletados" (1º nome, 1º telefone e 1º e-mail) saem da lista personalizada. */
function legacySplit(list: EventType['dataCollection']) {
  const name = list.find(isNameLike)
  const phone = list.find((f) => f.type === 'phone')
  const email = list.find((f) => f.type === 'email')
  const drop = new Set([name?.id, phone?.id, email?.id].filter(Boolean))
  return { custom: list.filter((f) => !drop.has(f.id)), phone }
}

function remindersOf(et: EventType): EventReminder[] {
  const n = et.notifications
  if (!et.reminders) {
    return [
      ...(n.reminderEmail ? [{ id: 'rem_email', channel: 'email' as const, hoursBefore: n.reminderHours }] : []),
      ...(n.smsReminder ? [{ id: 'rem_sms', channel: 'sms' as const, hoursBefore: n.reminderHours }] : []),
    ]
  }
  // os interruptores legados (reminderEmail / smsReminder / reminderHours) continuam valendo quando alterados fora do editor
  let list = et.reminders.map((r) => ({ ...r }))
  if (!n.reminderEmail) list = list.filter((r) => r.channel !== 'email')
  else if (!list.some((r) => r.channel === 'email')) list.push({ id: 'rem_email', channel: 'email', hoursBefore: n.reminderHours })
  if (!n.smsReminder) list = list.filter((r) => r.channel !== 'sms')
  else if (!list.some((r) => r.channel === 'sms')) list.push({ id: 'rem_sms', channel: 'sms', hoursBefore: n.reminderHours })
  if (list[0] && list[0].hoursBefore !== n.reminderHours) list[0] = { ...list[0], hoursBefore: n.reminderHours }
  return list
}

function templatesOf(et: EventType, orgName?: string): NotificationTemplates {
  const def = defaultTemplates(orgName)
  const cur = et.templates
  if (!cur) return def
  const merge = (a: Partial<Record<TemplateKind, MessageTemplate>> | undefined, b: Record<TemplateKind, MessageTemplate>) =>
    Object.fromEntries(TEMPLATE_KINDS.map((k) => [k, { ...b[k], ...(a?.[k] ?? {}) }])) as Record<TemplateKind, MessageTemplate>
  return {
    emailSenderName: cur.emailSenderName ?? def.emailSenderName,
    smsSenderName: cur.smsSenderName ?? def.smsSenderName,
    email: merge(cur.email, def.email),
    sms: merge(cur.sms, def.sms),
    calendar: { ...def.calendar, ...(cur.calendar ?? {}) },
  }
}

/**
 * Tipo de evento com todos os campos observados preenchidos (idempotente). Migra dados antigos: local
 * (Videochamada/Presencial/Ligação), lembretes legados e campos de Coleta que viraram "sempre coletados".
 */
export function normalizeEventType(et: EventType, orgName?: string): EventType {
  const split = et.customFieldsV2 ? undefined : legacySplit(et.dataCollection)
  const webPhone: WebPhoneMode = et.webPhone ?? (split ? (split.phone ? (split.phone.required ? 'required' : 'optional') : 'hidden') : 'required')
  return {
    ...et,
    active: et.active !== false,
    timezone: et.timezone ?? 'America/Sao_Paulo',
    confirmationMessage: et.confirmationMessage ?? '',
    locationKind: locationKindOf(et),
    locationAddress: et.locationAddress ?? '',
    staticInvitees: et.staticInvitees ?? [],
    conflictCalendarIds: et.conflictCalendarIds ?? [],
    templates: templatesOf(et, orgName),
    reminders: remindersOf(et),
    webPhone,
    dataCollection: split ? split.custom : et.dataCollection,
    customFieldsV2: true,
    hideFromCompanyPage: et.hideFromCompanyPage ?? false,
    hostDisplayName: et.hostDisplayName ?? '',
    webhooks: et.webhooks ?? [],
  }
}

/** Antes de gravar: mantém os campos base/legados coerentes com os campos novos (outros módulos leem os base). */
export function withLegacyFields(et: EventType): EventType {
  const rem = et.reminders ?? []
  return {
    ...et,
    location: baseLocationOf(et.locationKind ?? locationKindOf(et)),
    notifications: {
      ...et.notifications,
      reminderEmail: rem.some((r) => r.channel === 'email'),
      smsReminder: rem.some((r) => r.channel === 'sms'),
      reminderHours: rem[0]?.hoursBefore ?? et.notifications.reminderHours,
    },
  }
}

/* --------------------------------- Rótulos --------------------------------- */

export const WEB_PHONE_LABEL: Record<WebPhoneMode, string> = { required: 'Obrigatório', optional: 'Opcional', hidden: 'Não solicitado' }
export const BOOKING_EVENT_LABEL: Record<BookingEvent, string> = { created: 'Criado', rescheduled: 'Reagendado', canceled: 'Cancelado' }

export const hoursLabel = (n: number) => (n === 0 ? 'Sem antecedência' : n % 24 === 0 && n >= 24 ? `${n / 24} ${n === 24 ? 'dia' : 'dias'}` : `${n} ${n === 1 ? 'hora' : 'horas'}`)
export const minutesLabel = (n: number) => `${n} ${n === 1 ? 'minuto' : 'minutos'}`
export const windowLabel = (n: number) => (n > 0 ? `${n} dias` : 'Sem limite')
/** "Sem limite" (0) vira 1 ano para a página pública e o cálculo de horários. */
export const windowDays = (et: Pick<EventType, 'maxDaysAhead'>) => (et.maxDaysAhead > 0 ? et.maxDaysAhead : 365)
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/** Entrega SIMULADA (mesma regra determinística de `services.webhooks.test`: URL com "erro"/"fail"/"500" falha). */
export function webhookDeliveriesFor(et: EventType, event: BookingEvent, now = new Date()) {
  return (et.webhooks ?? [])
    .filter((w) => w.events.includes(event))
    .map((w) => {
      const ok = !/erro|fail|500/i.test(w.url)
      return { webhookId: w.id, url: w.url, event, at: now.toISOString(), ok, code: ok ? 200 : 500 }
    })
}

/** Somente para o protótipo local de campanhas (sem motor). O Agendador usa o link criado pelo calendário conectado. */
export function meetingLinkFor(bookingId: string) {
  let h = 2166136261
  for (const ch of bookingId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  const abc = 'abcdefghijkmnopqrstuvwxyz'
  let code = ''
  for (let i = 0; i < 10; i++) {
    code += abc[h % abc.length]
    h = Math.imul(h ^ (i + 7), 2654435761) >>> 0
  }
  return `https://reuniao.kloel.example/${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}`
}
