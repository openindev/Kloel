import { useMemo } from 'react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import * as SelectPrimitive from '@radix-ui/react-select'
import { ArrowRight, Check, Sparkles } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Conversation } from '@/domain/types'
import { cn, formatNumber } from '@/lib/utils'
import { useBillingProfile, useCollection, useStore, useUi } from '@/data/store'
import { RESULTS } from '@/data/catalogs/results'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ANALYSIS_THRESHOLD, analysis, buildSeries, granularityOf, seriesAgents, tickInterval, totals, type Bucket, type Range } from './metrics'
import { billingCycles, cycleLabel, cycleLongLabel, minutesQuota, useProductPlan } from './plan-usage'
import { resolveConversationAgent } from '../inbox/agentLabel'

const CARD = 'rounded-lg border bg-card text-card-foreground shadow-sm'
const SEG_ITEM = 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 h-7 rounded-[5px] px-2.5 text-sm'

/* -------------------------- Histórico de ligações -------------------------- */

/**
 * Cores das barras por assistente (empilhadas): o primeiro na cor da marca, como na referência ao vivo (1 assistente,
 * barra e quadrado do tooltip em bg-brand); os demais em tons da marca para continuarem distinguíveis.
 */
const AGENT_COLORS = ['hsl(var(--brand))', 'hsl(var(--brand) / 0.55)', 'hsl(var(--brand) / 0.3)', 'hsl(var(--muted-foreground) / 0.55)', 'hsl(var(--muted-foreground) / 0.3)']
const agentColor = (i: number) => AGENT_COLORS[i % AGENT_COLORS.length]!

type SeriesAgent = { id: string; name: string; color: string }

/** Tooltip Recharts da referência (08-minutos-tooltip-barra.txt): data longa + quadrado de cor + assistente + valor. */
function ChartTooltip({ active, payload, metric, agents }: { active?: boolean; payload?: Array<{ payload: Bucket }>; metric: 'calls' | 'minutes'; agents: SeriesAgent[] }) {
  if (!active || !payload?.length) return null
  const b = payload[0]!.payload
  const prefix = metric === 'calls' ? 'c' : 'm'
  return (
    <div className="grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{b.label}</div>
      <div className="grid gap-1.5">
        {agents.map((a) => (
          <div key={a.id} className="flex w-full items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: a.color }} />
            <span className="text-muted-foreground">{a.name}</span>
            <span className="ml-auto font-mono font-medium tabular-nums text-foreground">{b[`${prefix}:${a.id}`] === null ? '—' : formatNumber(b[`${prefix}:${a.id}`] ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CallHistoryCard({
  calls,
  range,
  period,
  metric,
  onMetric,
  loading,
}: {
  calls: Conversation[]
  range: Range
  period: string
  metric: 'calls' | 'minutes'
  onMetric: (m: 'calls' | 'minutes') => void
  loading: boolean
}) {
  const agentsAll = useCollection('agents')
  const series = useMemo(() => buildSeries(calls, range, period), [calls, range, period])
  const t = useMemo(() => totals(calls), [calls])
  const agents = useMemo<SeriesAgent[]>(() => {
    // o assistente com mais ligações no recorte fica na cor da marca (base da pilha); os demais em tons mais claros
    const ids = seriesAgents(calls)
    const named = ids.map((id) => {
      const c = calls.find((x) => (x.agentId ?? '') === id)!
      return { id, name: resolveConversationAgent(c, agentsAll).name, n: calls.filter((x) => (x.agentId ?? '') === id && x.result !== 'missed').length }
    })
    named.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'pt-BR'))
    return named.map((a, i) => ({ id: a.id, name: a.name, color: agentColor(i) }))
  }, [calls, agentsAll])
  const key = metric === 'calls' ? 'calls' : 'minutes'
  const prefix = metric === 'calls' ? 'c' : 'm'
  const max = Math.max(0, ...series.map((b) => b[key]).filter((value): value is number => value != null))
  const interval = tickInterval(granularityOf(period, range), series.length)

  return (
    <div className={cn(CARD, 'flex flex-col transition-opacity @2xl:col-span-2', loading && 'opacity-60')}>
      <div className="flex p-6 flex-row flex-wrap items-start justify-between gap-4 space-y-0 pb-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="tracking-tight text-base font-medium">Histórico de ligações</h3>
          <p className="text-sm text-muted-foreground">Ligações dos seus assistentes no período selecionado</p>
        </div>
        <div role="radiogroup" aria-label="Métrica" className="inline-flex items-center gap-0.5 rounded-md border border-input bg-muted/50 p-0.5">
          {(
            [
              ['calls', 'Ligações', t.calls],
              ['minutes', 'Minutos', t.minutes],
            ] as const
          ).map(([value, label, total]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={metric === value}
              onClick={() => onMetric(value)}
              className={cn(SEG_ITEM, metric === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
              <span className="tabular-nums text-foreground">{total == null ? '—' : formatNumber(total)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="p-6 flex min-h-0 flex-1 flex-col pt-4">
        <div className="relative flex justify-center text-xs aspect-auto min-h-80 w-full flex-1">
          <div className="absolute inset-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            {/* Geometria medida em fonio-live/app-overview.jpg (1512×746): grade horizontal contínua e clara (stroke-border/50),
                área do gráfico começando ~33px após o padding do cartão e indo até a borda direita do conteúdo. */}
            <BarChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: -11 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.5)" />
              <XAxis
                dataKey="tick"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={interval}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={44}
                domain={[0, Math.max(1, Math.ceil(max))]}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              />
              <Tooltip cursor={false} content={<ChartTooltip metric={metric} agents={agents} />} />
              {agents.length === 0 ? (
                <Bar dataKey={key} fill="hsl(var(--brand))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              ) : (
                agents.map((a, i) => (
                  <Bar
                    key={a.id}
                    name={a.name}
                    dataKey={(b: Bucket) => b[`${prefix}:${a.id}`] === null ? null : b[`${prefix}:${a.id}`] ?? 0}
                    stackId="agents"
                    fill={a.color}
                    radius={i === agents.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                    isAnimationActive={false}
                  />
                ))
              )}
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------- Uso ----------------------------------- */

function CycleItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

/**
 * Cartão "Uso" da Fonio ao vivo (fonio-live2/B-visao-geral/01 e 09): período de cobrança (gatilho curto
 * "18 de out. – 18 de nov."; opções longas "18 de out. de 2026 – 18 de nov. de 2026 · atual"), "Minutos de ligação",
 * e só as linhas "Chamadas simultâneas" e "Usuários" (sem barras), mesmo com o plano completo contratado.
 */
export function UsageCard({ loading }: { loading: boolean }) {
  const subs = useCollection('subscriptions')
  const conversations = useCollection('conversations')
  const billing = useBillingProfile()
  const orgId = useStore((s) => s.db.session.orgId)
  const memberships = useStore((s) => s.db.memberships)
  const setUi = useStore((s) => s.setUi)
  const selected = useUi().overviewUsageCycle
  const { plan } = useProductPlan('voice')
  const hasConfirmedCycle = subs.some(sub => sub.status === 'active' && sub.startedAt !== null && sub.renewsAt !== null && Number.isFinite(Date.parse(sub.startedAt)) && Number.isFinite(Date.parse(sub.renewsAt)))

  const cycles = useMemo(() => billingCycles(subs), [subs])
  const cycle = cycles.find((c) => c.key === selected) ?? cycles[0]!
  const usedMin = useMemo(
    () =>
      conversations
        .filter((c) => c.channel === 'phone' && c.result !== 'missed')
        .filter((c) => {
          const t = new Date(c.startedAt).getTime()
          return t >= cycle.from.getTime() && t < cycle.to.getTime()
        })
        .reduce<number | null>((s, c) => s == null || c.durationSec == null ? null : s + Math.ceil(c.durationSec / 60), 0),
    [conversations, cycle],
  )
  // The engine meters chat rounds, not voice minutes or the catalog's display limits.
  const quota: number | null = null
  const remaining: number | null = null
  const members = memberships.filter((m) => m.orgId === orgId).length
  const usersLimit = undefined
  const concurrent = undefined

  return (
    <div className={cn(CARD, 'flex flex-col transition-opacity @5xl:h-0 @5xl:min-h-full', loading && 'opacity-60')}>
      <div className="flex p-6 flex-row items-baseline justify-between gap-4 space-y-0 pb-4">
        <h3 className="tracking-tight text-base font-medium">Uso</h3>
        <Select value={cycle.key} disabled={!hasConfirmedCycle} onValueChange={(v) => setUi({ overviewUsageCycle: v })}>
          <SelectTrigger
            aria-label="Período de cobrança"
            className="h-auto w-auto gap-1 border-0 bg-transparent p-0 text-xs text-muted-foreground hover:text-foreground focus:ring-0 [&>svg]:size-3.5"
          >
            <SelectValue>{hasConfirmedCycle ? cycleLabel(cycle) : '—'}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {cycles.map((c) => (
              <CycleItem key={c.key} value={c.key}>
                {cycleLongLabel(c)}
                {c.current ? ' · atual' : ''}
              </CycleItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="p-6 pt-0 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-0">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Minutos de ligação</p>
            <p className="text-2xl font-medium tabular-nums">— min restantes</p>
          </div>
          <div><div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Uso indisponível" /></div>
          <p className="text-xs text-muted-foreground tabular-nums">
            — de — min usados
          </p>
        </div>
        <ul className="flex flex-col divide-y border-t text-sm">
          <li className="flex items-baseline justify-between gap-4 py-2">
            <span className="truncate">Chamadas simultâneas</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{concurrent === undefined ? '—' : concurrent >= 99 ? 'ilimitadas' : `até ${concurrent}`}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 py-2">
            <span className="truncate">Usuários</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {usersLimit === undefined ? members : usersLimit >= 999 ? `${members} · ilimitados` : `${members} de ${usersLimit}`}
            </span>
          </li>
        </ul>
      </div>
      <div className="flex flex-wrap gap-2 px-6 pt-4 pb-6">
        <Link to="/app/billing" className={cn(buttonVariants({ variant: 'outline' }), 'h-9 rounded-md px-3 flex-1')}>
          Gerenciar assinatura
        </Link>
        <Link to="/agendar-demo" className={cn(buttonVariants({ variant: 'outline' }), 'h-9 rounded-md px-3 flex-1')}>
          Falar com vendas
        </Link>
      </div>
    </div>
  )
}

/* --------------------------------- Análise --------------------------------- */

/**
 * Filtros iniciais das Conversas para o mesmo recorte da análise: ligações recebidas (channel=calls, direction=inbound)
 * do período selecionado (date=custom&from&to), incluindo arquivadas, e o assistente filtrado.
 */
function inboxScope(range: Range, agentId: string) {
  const sp = new URLSearchParams({ channel: 'calls', direction: 'inbound', date: 'custom', from: format(range.from, 'yyyy-MM-dd'), to: format(range.to, 'yyyy-MM-dd'), archived: '1' })
  if (agentId !== 'all') sp.set('agent', agentId)
  return sp.toString()
}

export function AnalysisCard({ calls, withConversation, loading, agentId, range }: { calls: Conversation[]; withConversation: number | null; loading: boolean; agentId: string; range: Range }) {
  const data = useMemo(() => analysis(calls), [calls])
  const scope = inboxScope(range, agentId)
  const scopeQs = `&${scope}`

  if (withConversation == null || withConversation < ANALYSIS_THRESHOLD) {
    const missing = withConversation == null ? null : ANALYSIS_THRESHOLD - withConversation
    return (
      <div className={cn(CARD, 'flex flex-col items-center gap-4 px-6 py-10 text-center transition-opacity @5xl:col-span-3', loading && 'opacity-60')}>
        <div className="flex size-10 items-center justify-center rounded-full bg-brand/10 text-brand">
          <Sparkles className="size-5" />
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-medium text-balance">Sua análise está quase pronta</h3>
          <p className="max-w-[56ch] text-sm text-pretty text-muted-foreground">
            A partir de {ANALYSIS_THRESHOLD} conversas, você verá aqui como terminaram e o que quem ligou queria.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Progress value={withConversation == null ? 0 : (withConversation / ANALYSIS_THRESHOLD) * 100} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {missing == null ? '—' : `Faltam ${missing} de ${ANALYSIS_THRESHOLD} conversas`}
          </p>
        </div>
      </div>
    )
  }

  const topIntents = data.intents.slice(0, 5)
  const maxIntent = Math.max(1, ...topIntents.map((i) => i.count))
  return (
    <div className={cn(CARD, 'flex flex-col transition-opacity @5xl:col-span-3 @container/analysis', loading && 'opacity-60')}>
      <div className="flex flex-row flex-wrap items-start justify-between gap-4 p-6 pb-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="tracking-tight text-base font-medium">Análise das conversas</h3>
          <p className="text-sm text-muted-foreground">Como terminaram e o que quem ligou queria · {formatNumber(data.total)} ligações atendidas</p>
        </div>
        <Link to={`/app/inbox?${scope}`} className={cn(buttonVariants({ variant: 'outline' }), 'h-9 gap-1.5 rounded-md px-3')}>
          Ver conversas <ArrowRight className="size-4" />
        </Link>
      </div>
      <div className="grid gap-8 p-6 pt-4 @3xl/analysis:grid-cols-2">
        <section aria-label="Como terminaram" className="flex min-w-0 flex-col gap-3">
          <h4 className="text-sm font-medium">Como terminaram</h4>
          <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-muted" aria-hidden>
            {data.results.map((r) => (
              <span key={r.result} className={cn('h-full first:rounded-l-full last:rounded-r-full', RESULTS[r.result].dot)} style={{ width: `${(r.count / data.total) * 100}%` }} />
            ))}
          </div>
          <ul className="flex flex-col">
            {data.results.map((r) => (
              <li key={r.result}>
                <Link
                  to={`/app/inbox?result=${r.result}${scopeQs}`}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', RESULTS[r.result].dot)} />
                  <span className="min-w-0 flex-1 truncate">{RESULTS[r.result].label}</span>
                  <span className="tabular-nums">{r.count}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round((r.count / data.total) * 100)}%</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="O que quem ligou queria" className="flex min-w-0 flex-col gap-3">
          <h4 className="text-sm font-medium">O que quem ligou queria</h4>
          <ul className="flex flex-col gap-1">
            {topIntents.map((i) => (
              <li key={i.title}>
                <Link to={`/app/inbox?q=${encodeURIComponent(i.title)}${scopeQs}`} className="-mx-2 flex flex-col gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{i.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{i.count}</span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${(i.count / maxIntent) * 100}%` }} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Intenções agrupadas pelo assunto identificado em cada conversa.</p>
        </section>
      </div>
    </div>
  )
}
