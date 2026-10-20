import { addDays, addHours, addWeeks, differenceInCalendarDays, endOfDay, format, getISOWeek, isSameDay, startOfDay, startOfHour, startOfISOWeek, subDays } from 'date-fns'
import type { Conversation, ConversationResult } from '@/domain/types'
import { fmtShortDate } from './plan-usage'

/** Métricas da Visão geral, calculadas a partir das conversas locais (ligações = canais phone + web). */

export type PeriodKey = 'today' | '7d' | '30d' | '90d' | 'custom'
export const PERIOD_DAYS: Record<Exclude<PeriodKey, 'custom'>, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 }
export const ANALYSIS_THRESHOLD = 15

export interface Range {
  from: Date
  to: Date
}

export function periodRange(period: string, customFrom?: string, customTo?: string, now = new Date()): Range {
  if (period === 'custom' && customFrom && customTo) {
    const a = new Date(customFrom)
    const b = new Date(customTo)
    const [from, to] = a <= b ? [a, b] : [b, a]
    return { from: startOfDay(from), to: endOfDay(to) }
  }
  const days = PERIOD_DAYS[(period as keyof typeof PERIOD_DAYS)] ?? 30
  return { from: startOfDay(subDays(now, days - 1)), to: endOfDay(now) }
}

export function previousRange(r: Range): Range {
  const len = r.to.getTime() - r.from.getTime() + 1
  return { from: new Date(r.from.getTime() - len), to: new Date(r.from.getTime() - 1) }
}

export function rangeLabel(period: string, r: Range) {
  // Fonio ao vivo (fonio-live2/B-visao-geral/02-04-periodos.txt): todos os períodos usam "· em relação ao período anterior".
  if (period === 'today') return 'Hoje · em relação ao período anterior'
  if (period === 'custom') return `${fmtShortDate(r.from)} – ${fmtShortDate(r.to)} · em relação ao período anterior`
  const days = PERIOD_DAYS[(period as keyof typeof PERIOD_DAYS)] ?? 30
  return `Últimos ${days} dias · em relação ao período anterior`
}

export const isCall = (c: Conversation) => c.channel === 'phone' || c.channel === 'web'
const inRange = (c: Conversation, r: Range) => {
  const t = new Date(c.startedAt).getTime()
  return t >= r.from.getTime() && t <= r.to.getTime()
}

export function callsIn(convs: Conversation[], r: Range, agentId: string) {
  return convs.filter((c) => isCall(c) && inRange(c, r) && (agentId === 'all' || c.agentId === agentId))
}

const hasConversation = (c: Conversation) => c.transcript.some((l) => l.speaker === 'caller')

export interface Kpis {
  answered: number | null
  withConversation: number | null
  handled: number | null
  handledPct: number | null
  secondsTalked: number | null
}

export function computeKpis(calls: Conversation[]): Kpis {
  if (calls.some(c => c.direction === 'unknown' || c.result === 'unknown' || c.engineConversation?.loaded === false)) {
    return { answered: null, withConversation: null, handled: null, handledPct: null, secondsTalked: null }
  }
  const answered = calls.filter((c) => c.direction === 'inbound' && c.result !== 'missed')
  const withConv = answered.filter(hasConversation)
  const handled = withConv.filter((c) => c.result !== 'transferred' && c.result !== 'abandoned')
  return {
    answered: answered.length,
    withConversation: withConv.length,
    handled: handled.length,
    handledPct: withConv.length >= ANALYSIS_THRESHOLD ? Math.round((handled.length / withConv.length) * 100) : null,
    secondsTalked: calls.some(c => c.durationSec == null) ? null : answered.reduce((s, c) => s + c.durationSec!, 0),
  }
}

export function formatMinutes(sec: number | null) {
  if (sec == null) return '—'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Variação percentual em relação ao período anterior (null quando não há base de comparação). */
export function delta(cur: number | null, prev: number | null): number | null {
  if (cur == null || !prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}

export interface Bucket {
  key: string
  tick: string
  label: string
  calls: number
  minutes: number | null
  /** Valores por assistente (barras empilhadas e linhas do tooltip): `c:<agentId>` ligações, `m:<agentId>` minutos. */
  [k: `c:${string}` | `m:${string}`]: number | null
}

export type Granularity = 'hour' | 'day' | 'week'

/**
 * Agrupamento do gráfico como na Fonio ao vivo (02-04-periodos.txt + live-compare B-inicio/02): Hoje → uma barra por hora
 * de 00 até a hora atual (às 09:15: 10 barras, ticks 00,02,04,06,08; às 23h: 24 barras, ticks 00,04,…,20); um dia inteiro
 * no passado (Personalizado de 1 dia) → 24 barras; até 31 dias → por dia (7 dias: todos os rótulos; 30 dias: um a cada 5);
 * acima disso (90 dias) → por semana ISO (13 barras, ticks "Sem. 30, Sem. 32 … Sem. 42", um a cada 2).
 */
export function granularityOf(period: string, r: Range): Granularity {
  const days = differenceInCalendarDays(r.to, r.from) + 1
  if (period === 'today' || days <= 1) return 'hour'
  if (days <= 31) return 'day'
  return 'week'
}

/** Intervalo dos rótulos do eixo X (Recharts `interval`): por hora, a cada 2h com até 12 barras e a cada 4h acima disso. */
export function tickInterval(g: Granularity, bars: number) {
  if (g === 'hour') return bars <= 12 ? 1 : 3
  if (g === 'week') return Math.max(0, Math.ceil(bars / 7) - 1)
  return bars <= 7 ? 0 : Math.max(0, Math.ceil(bars / 6) - 1)
}

/** Número de barras por hora: de 00 até a hora atual quando o recorte é hoje; 24 para um dia que já terminou. */
export function hourBuckets(r: Range, now = new Date()) {
  return isSameDay(r.from, now) ? now.getHours() + 1 : 24
}

const longDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
/** Data longa do tooltip: "dom., 18 de out. de 2026" (08-minutos-tooltip-barra.txt). */
export const fmtTooltipDay = (d: Date) => longDay.format(d)

/** Série do gráfico "Histórico de ligações" (por hora, por dia ou por semana ISO), com os valores de cada assistente. */
export function buildSeries(calls: Conversation[], r: Range, period: string, now = new Date()): Bucket[] {
  const counted = calls.filter((c) => c.result !== 'missed')
  const buckets: Bucket[] = []
  const idx = new Map<string, Bucket>()
  const g = granularityOf(period, r)
  const mk = (d: Date, tick: string, label: string): Bucket => ({ key: d.toISOString(), tick, label, calls: 0, minutes: 0 })
  let keyOf: (d: Date) => string
  if (g === 'hour') {
    keyOf = (d) => startOfHour(d).toISOString()
    const n = hourBuckets(r, now)
    for (let i = 0; i < n; i++) {
      const d = addHours(startOfDay(r.from), i)
      buckets.push(mk(d, format(d, 'HH'), `${fmtTooltipDay(d)}, ${format(d, 'HH')}:00`))
    }
  } else if (g === 'day') {
    keyOf = (d) => startOfDay(d).toISOString()
    const days = differenceInCalendarDays(r.to, r.from) + 1
    for (let i = 0; i < days; i++) {
      const d = startOfDay(addDays(r.from, i))
      buckets.push(mk(d, format(d, 'dd/MM'), fmtTooltipDay(d)))
    }
  } else {
    keyOf = (d) => startOfISOWeek(d).toISOString()
    for (let d = startOfISOWeek(r.from); d.getTime() <= r.to.getTime(); d = addWeeks(d, 1)) {
      const end = addDays(d, 6)
      buckets.push(mk(d, `Sem. ${getISOWeek(d)}`, `Sem. ${getISOWeek(d)} · ${fmtShortDate(d)} – ${fmtShortDate(end)}`))
    }
  }
  buckets.forEach((b) => idx.set(b.key, b))
  for (const c of counted) {
    const b = idx.get(keyOf(new Date(c.startedAt)))
    if (!b) continue
    const a = c.agentId ?? ''
    b.calls += 1
    b.minutes = b.minutes == null || c.durationSec == null ? null : b.minutes + c.durationSec / 60
    b[`c:${a}`] = (b[`c:${a}`] ?? 0) + 1
    b[`m:${a}`] = b[`m:${a}`] === null || c.durationSec == null ? null : (b[`m:${a}`] ?? 0) + c.durationSec / 60
  }
  for (const b of buckets) {
    if (b.minutes != null) b.minutes = Math.round(b.minutes * 10) / 10
    for (const k of Object.keys(b)) if (k.startsWith('m:') && b[k as `m:${string}`] != null) b[k as `m:${string}`] = Math.round(b[k as `m:${string}`]! * 10) / 10
  }
  return buckets
}

/** Assistentes com ligações no recorte (ids), para as barras empilhadas e o tooltip. */
export function seriesAgents(calls: Conversation[]) {
  return [...new Set(calls.filter((c) => c.result !== 'missed').map((c) => c.agentId ?? ''))]
}

export function totals(calls: Conversation[]) {
  const counted = calls.filter((c) => c.result !== 'missed')
  return { calls: counted.length, minutes: counted.some(c => c.durationSec == null) ? null : Math.round(counted.reduce((s, c) => s + c.durationSec!, 0) / 60) }
}

/** Análise (≥ 15 conversas): desfechos e intenções (títulos das conversas). */
export function analysis(calls: Conversation[]) {
  const answered = calls.filter((c) => c.direction === 'inbound' && c.result !== 'missed')
  const byResult = new Map<ConversationResult, number>()
  answered.forEach((c) => byResult.set(c.result, (byResult.get(c.result) ?? 0) + 1))
  const results = [...byResult.entries()].map(([result, count]) => ({ result, count })).sort((a, b) => b.count - a.count)
  const byTitle = new Map<string, number>()
  answered.filter(hasConversation).forEach((c) => byTitle.set(c.title, (byTitle.get(c.title) ?? 0) + 1))
  const intents = [...byTitle.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
  return { total: answered.length, results, intents }
}
