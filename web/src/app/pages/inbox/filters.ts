import { endOfDay, endOfMonth, format, isSameYear, startOfDay, startOfMonth, subDays, subMonths, differenceInCalendarDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Agent, Contact, Conversation, ConversationResult } from '@/domain/types'
import { RESULTS, CHANNEL_LABEL } from '@/data/catalogs/results'
import { useStore } from '@/data/store'
import '@/domain/ext/inbox-contacts'
import { formatDuration, phoneKey, toCsv } from './shared'
import { resolveConversationAgent } from './agentLabel'

export type ChannelGroup = 'calls' | 'chats'
export type StatusKey = 'starred' | 'unread' | 'read' | 'mine'
export type DatePreset = 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'last_month' | 'all' | 'custom'

export const DURATION_MAX = 1800 // 30:00+

export interface InboxFilters {
  channels: ChannelGroup[]
  agentIds: string[]
  directions: ('inbound' | 'outbound')[]
  results: ConversationResult[]
  statuses: StatusKey[]
  date: { preset: DatePreset; from?: string; to?: string }
  duration: [number, number]
  showArchived: boolean
}

export const EMPTY_FILTERS: InboxFilters = {
  channels: [],
  agentIds: [],
  directions: [],
  results: [],
  statuses: [],
  date: { preset: 'all' },
  duration: [0, DURATION_MAX],
  showArchived: false,
}

export const DATE_PRESETS: { key: Exclude<DatePreset, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: 'Últimos 7 dias' },
  { key: '30d', label: 'Últimos 30 dias' },
  { key: 'this_month', label: 'Este mês' },
  { key: 'last_month', label: 'Mês passado' },
  { key: 'all', label: 'Todo o período' },
]

export const CHANNEL_GROUP_LABEL: Record<ChannelGroup, string> = { calls: 'Chamadas', chats: 'Chats' }
export const STATUS_LABEL: Record<StatusKey, string> = { starred: 'Favoritos', unread: 'Não lido', read: 'Lido', mine: 'Atribuídas a mim' }
export const DIRECTION_LABEL = { inbound: 'Entrada', outbound: 'Saída', unknown: '—' } as const

export const isChat = (c: Pick<Conversation, 'channel'>) => c.channel === 'whatsapp' || c.channel === 'webchat'

/* ---------------- filtros ↔ URL (?q=, ?result=, ?agent=, … — fonte da verdade) ---------------- */

const DATE_KEYS = ['today', 'yesterday', '7d', '30d', 'this_month', 'last_month', 'all', 'custom'] as const
const listParam = (sp: URLSearchParams, key: string) =>
  sp
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)
const ymd = (iso?: string) => (iso ? format(new Date(iso), 'yyyy-MM-dd') : '')
const fromYmd = (s: string | null) => {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString() : undefined
}

/** Lê busca e filtros da query string. Aceita valores repetidos ou separados por vírgula. */
export function filtersFromParams(sp: URLSearchParams): { query: string; filters: InboxFilters } {
  const results = listParam(sp, 'result').filter((r): r is ConversationResult => r in RESULTS)
  const channels = listParam(sp, 'channel').filter((c): c is ChannelGroup => c === 'calls' || c === 'chats')
  const directions = listParam(sp, 'direction').filter((d): d is 'inbound' | 'outbound' => d === 'inbound' || d === 'outbound')
  const statuses = listParam(sp, 'status').filter((s): s is StatusKey => s === 'starred' || s === 'unread' || s === 'read' || s === 'mine')
  const preset = (DATE_KEYS as readonly string[]).includes(sp.get('date') ?? '') ? (sp.get('date') as DatePreset) : 'all'
  const date: InboxFilters['date'] = preset === 'custom' ? { preset, from: fromYmd(sp.get('from')), to: fromYmd(sp.get('to')) } : { preset }
  if (date.preset === 'custom' && !date.from) date.preset = 'all'
  const dur = (sp.get('dur') ?? '').match(/^(\d+)-(\d+)$/)
  const duration: [number, number] = dur ? [Math.min(Number(dur[1]), DURATION_MAX), Math.min(Number(dur[2]), DURATION_MAX)] : [0, DURATION_MAX]
  return {
    query: sp.get('q') ?? '',
    filters: {
      channels,
      agentIds: listParam(sp, 'agent'),
      directions,
      results,
      statuses,
      date,
      duration: duration[0] <= duration[1] ? duration : [0, DURATION_MAX],
      showArchived: sp.get('archived') === '1',
    },
  }
}

/** Serializa busca e filtros (somente o que difere do padrão). */
export function filtersToParams(query: string, f: InboxFilters): URLSearchParams {
  const sp = new URLSearchParams()
  if (query) sp.set('q', query)
  if (f.results.length) sp.set('result', f.results.join(','))
  if (f.agentIds.length) sp.set('agent', f.agentIds.join(','))
  if (f.channels.length) sp.set('channel', f.channels.join(','))
  if (f.directions.length) sp.set('direction', f.directions.join(','))
  if (f.statuses.length) sp.set('status', f.statuses.join(','))
  if (f.date.preset !== 'all') {
    sp.set('date', f.date.preset)
    if (f.date.preset === 'custom') {
      sp.set('from', ymd(f.date.from))
      if (f.date.to) sp.set('to', ymd(f.date.to))
    }
  }
  if (f.duration[0] > 0 || f.duration[1] < DURATION_MAX) sp.set('dur', `${f.duration[0]}-${f.duration[1]}`)
  if (f.showArchived) sp.set('archived', '1')
  return sp
}

/* ---------- preferência de exibição do horário (persistida em ui.inboxView) ---------- */

interface InboxViewState {
  relativeTime: boolean
}
export function setInboxView(patch: Partial<InboxViewState>) {
  const st = useStore.getState()
  st.setUi({ inboxView: { ...st.db.ui.inboxView, ...patch } })
}
export function useInboxView(): InboxViewState {
  const relativeTime = useStore((s) => !!s.db.ui.inboxView?.relativeTime)
  return { relativeTime }
}

/* ------------------------------- datas ------------------------------- */

export function presetRange(preset: DatePreset, now = new Date()): { from?: Date; to?: Date } {
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) }
    case 'yesterday': {
      const y = subDays(now, 1)
      return { from: startOfDay(y), to: endOfDay(y) }
    }
    case '7d':
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) }
    case '30d':
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) }
    case 'this_month':
      return { from: startOfMonth(now), to: endOfDay(now) }
    case 'last_month': {
      const m = subMonths(now, 1)
      return { from: startOfMonth(m), to: endOfMonth(m) }
    }
    default:
      return {}
  }
}

export function dateFilterRange(f: InboxFilters['date']): { from?: Date; to?: Date } {
  if (f.preset === 'custom') {
    return { from: f.from ? startOfDay(new Date(f.from)) : undefined, to: f.to ? endOfDay(new Date(f.to)) : f.from ? endOfDay(new Date(f.from)) : undefined }
  }
  return presetRange(f.preset)
}

export function dateFilterLabel(f: InboxFilters['date']) {
  if (f.preset === 'custom') {
    const fmt = (s?: string) => (s ? format(new Date(s), 'dd/MM/yyyy') : '…')
    return f.to && f.to !== f.from ? `${fmt(f.from)} – ${fmt(f.to)}` : fmt(f.from)
  }
  return DATE_PRESETS.find((p) => p.key === f.preset)?.label ?? ''
}

export function durationLabel([a, b]: [number, number]) {
  if (a === 0 && b >= DURATION_MAX) return 'Qualquer duração'
  return `${formatDuration(a)} – ${b >= DURATION_MAX ? '30:00+' : formatDuration(b)}`
}

/** Rótulo do grupo de data: Hoje, Ontem, dia da semana (últimos 7 dias) ou data. */
export function dayGroupLabel(d: Date, now = new Date()) {
  const diff = differenceInCalendarDays(now, d)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  if (diff < 7) return format(d, 'EEEE', { locale: ptBR })
  return format(d, isSameYear(d, now) ? "d 'de' MMMM" : "d 'de' MMMM 'de' yyyy", { locale: ptBR })
}

export function relativeLabel(d: Date, now = new Date()) {
  const min = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  // horas completas (23h59 → "há 23 h"): com arredondamento, 23h30–23h59 virava 24 h e caía em "há 0 d" no mesmo dia
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const days = Math.max(1, differenceInCalendarDays(now, d))
  return days === 1 ? 'ontem' : `há ${days} d`
}

/* ------------------------------- filtro ------------------------------- */

export function countActive(f: InboxFilters) {
  let n = 0
  if (f.channels.length) n++
  if (f.agentIds.length) n++
  if (f.directions.length) n++
  if (f.results.length) n++
  if (f.statuses.length) n++
  if (f.date.preset !== 'all') n++
  if (f.duration[0] > 0 || f.duration[1] < DURATION_MAX) n++
  if (f.showArchived) n++
  return n
}

export function callerName(c: Conversation, contacts: Contact[]) {
  const ct = matchContact(c, contacts)
  return ct ? `${ct.firstName} ${ct.lastName}`.trim() : ''
}

/** Correspondência de contato: pelo vínculo existente ou por qualquer telefone igual ao do chamador. */
export function matchContact(c: Conversation, contacts: Contact[]): Contact | undefined {
  if (c.contactId) {
    const byId = contacts.find((x) => x.id === c.contactId)
    if (byId) return byId
  }
  const key = phoneKey(c.callerNumber)
  if (key.length < 8) return undefined
  return contacts.find((x) => x.phones.some((p) => phoneKey(p.value) === key))
}

export function matchesConversationQuery(c: Conversation, query: string, contacts: Contact[]) {
  const q = query.trim().normalize('NFKC').toLocaleLowerCase('pt-BR'), qDigits = q.replace(/\D/g, '')
  if (!q) return true
  const hay = [c.title, c.summary, c.callerNumber ?? '', c.calleeNumber ?? '', callerName(c, contacts), ...c.transcript.map(l => l.text)].join('\n').normalize('NFKC').toLocaleLowerCase('pt-BR')
  return hay.includes(q) || qDigits.length >= 4 && [c.callerNumber, c.calleeNumber].some(number => (number ?? '').replace(/\D/g, '').includes(qDigits))
}

export function applyFilters(list: Conversation[], f: InboxFilters, query: string, contacts: Contact[]) {
  const q = query.trim().toLowerCase()
  const qDigits = q.replace(/\D/g, '')
  const { from, to } = dateFilterRange(f.date)
  return list.filter((c) => {
    if (!f.showArchived && c.archived) return false
    if (f.channels.length && !f.channels.includes(isChat(c) ? 'chats' : 'calls')) return false
    if (f.agentIds.length && !f.agentIds.includes(c.agentId)) return false
    if (f.directions.length && (c.direction === 'unknown' || !f.directions.includes(c.direction))) return false
    // Chats em andamento ainda não têm resultado: não entram em nenhum filtro de Resultado.
    if (f.results.length && (c.chatActive || !f.results.includes(c.result))) return false
    if (f.statuses.length) {
      const me = useStore.getState().db.session.userId
      const ok = f.statuses.some((s) => (s === 'starred' ? c.starred : s === 'unread' ? !c.read : s === 'mine' ? !!me && c.assigneeUserId === me : c.read))
      if (!ok) return false
    }
    const t = new Date(c.startedAt)
    if (from && t < from) return false
    if (to && t > to) return false
    if (c.durationSec == null) { if (f.duration[0] > 0 || f.duration[1] < DURATION_MAX) return false }
    else if (c.durationSec < f.duration[0] || f.duration[1] < DURATION_MAX && c.durationSec > f.duration[1]) return false
    if (q) {
      const hay = [c.title, c.summary, c.callerNumber ?? '', c.calleeNumber ?? '', callerName(c, contacts), ...c.transcript.map((l) => l.text)].join('\n').toLowerCase()
      const digitsHit = qDigits.length >= 4 && [c.callerNumber, c.calleeNumber].some((n) => (n ?? '').replace(/\D/g, '').includes(qDigits))
      if (!hay.includes(q) && !digitsHit) return false
    }
    return true
  })
}

/* ------------------------------- exportação ------------------------------- */

export function conversationsCsv(list: Conversation[], agents: Agent[], contacts: Contact[], tagLabel: (id: string) => string) {
  const header = ['ID', 'Data', 'Hora', 'Título', 'Canal', 'Direção', 'Assistente', 'Resultado', 'Duração', 'Chamador', 'Contato', 'Destinatário', 'Favorito', 'Lido', 'Arquivado', 'Etiquetas', 'Resumo']
  const rows = list.map((c) => {
    const d = new Date(c.startedAt)
    return [
      c.id,
      format(d, 'dd/MM/yyyy'),
      format(d, 'HH:mm'),
      c.title,
      CHANNEL_LABEL[c.channel] ?? c.channel,
      DIRECTION_LABEL[c.direction],
      resolveConversationAgent(c, agents).name, // assistente excluído → "<nome> (excluído)"
      c.chatActive ? 'Ativo' : RESULTS[c.result].label,
      formatDuration(c.durationSec),
      c.callerNumber ?? '',
      callerName(c, contacts),
      c.calleeNumber ?? '',
      c.starred ? 'Sim' : 'Não',
      c.read ? 'Sim' : 'Não',
      c.archived ? 'Sim' : 'Não',
      c.tagIds.map(tagLabel).filter(Boolean).join(' | '),
      c.summary,
    ]
  })
  return toCsv(header, rows)
}
