import { useEffect, useMemo, useRef, useState } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { CalendarDays, Check } from 'lucide-react'
import { startOfDay, subDays, subMonths } from 'date-fns'
import '@/domain/ext/mais-a'
import { cn } from '@/lib/utils'
import { useCollection, useStore, useUi } from '@/data/store'
import type { UiPrefs } from '@/domain/types'
import { Select, SelectContent, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { EnCalendar } from './EnCalendar'
import { ANALYSIS_THRESHOLD, callsIn, computeKpis, delta, formatMinutes, periodRange, previousRange, rangeLabel, type PeriodKey } from './metrics'
import { fmtShortDate } from './plan-usage'
import { AnalysisCard, CallHistoryCard, UsageCard } from './OverviewCards'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'

/** Item de select com o check à esquerda (pl-8), como no listbox "Todos os assistentes" da referência. */
function LeftCheckItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
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

const SEG_ITEM = 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 h-7 rounded-[5px] px-2.5 text-sm'
const SEG_ON = 'bg-background text-foreground shadow-sm'
const SEG_OFF = 'text-muted-foreground hover:text-foreground'

const PERIODS: { value: Exclude<PeriodKey, 'custom'>; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
]

/** true em telas ≥ 640px (sm); usado para mostrar 2 meses no calendário só quando cabem. */
function useWide() {
  const q = '(min-width: 640px)'
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(q).matches))
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

/**
 * Período (radiogroup) da Fonio ao vivo. "Personalizado" (05/06): ao abrir, o próprio botão já vira o intervalo curto
 * ("19 de set. – 18 de out.", padrão = últimos 30 dias) e o popover mostra o calendário em inglês com 2 meses; a seleção é
 * aplicada direto, sem rodapé nem botões. Fechar mantém o intervalo ativo. Como na Fonio (live-compare B-inicio/03), o
 * popover se ancora no radiogroup inteiro (PopoverAnchor): borda direita = borda direita do grupo, 4px abaixo dele.
 */
function PeriodFilter({ ov, onChange }: { ov: PeriodState; onChange: (p: Partial<PeriodState>) => void }) {
  const [open, setOpen] = useState(false)
  const wide = useWide()
  const today = startOfDay(new Date())
  const isCustom = ov.period === 'custom' && !!ov.customFrom && !!ov.customTo
  const from = isCustom ? new Date(ov.customFrom!) : undefined
  const to = isCustom ? new Date(ov.customTo!) : undefined
  const customLabel = isCustom ? `${fmtShortDate(from!)} – ${fmtShortDate(to!)}` : 'Personalizado'
  const apply = (a: Date, b: Date) => {
    const [x, y] = a <= b ? [a, b] : [b, a]
    onChange({ period: 'custom', customFrom: startOfDay(x).toISOString(), customTo: startOfDay(y).toISOString() })
  }

  return (
    <div className="max-w-full overflow-x-auto">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (o && ov.period !== 'custom') {
            // reabre com o último intervalo escolhido; na primeira vez, últimos 30 dias (como a Fonio)
            if (ov.customFrom && ov.customTo) onChange({ period: 'custom' })
            else apply(subDays(today, 29), today)
          }
        }}
      >
        <PopoverAnchor asChild>
          <div role="radiogroup" aria-label="Período" className="inline-flex items-center gap-0.5 rounded-md border border-input bg-muted/50 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={ov.period === p.value}
                onClick={() => onChange({ period: p.value })}
                className={cn(SEG_ITEM, ov.period === p.value ? SEG_ON : SEG_OFF)}
              >
                {p.label}
              </button>
            ))}
            <PopoverTrigger asChild>
              <button type="button" role="radio" aria-checked={ov.period === 'custom'} className={cn(SEG_ITEM, 'whitespace-nowrap', ov.period === 'custom' ? SEG_ON : SEG_OFF)}>
                <CalendarDays className="size-3.5" />
                {customLabel}
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent align="end" sideOffset={4} collisionPadding={8} className="w-auto max-w-[calc(100vw-1rem)] p-0">
          <EnCalendar
            mode="range"
            numberOfMonths={wide ? 2 : 1}
            selected={from && to ? { from, to } : undefined}
            defaultMonth={wide ? subMonths(to ?? today, 1) : to ?? today}
            onSelect={(r, day) => {
              if (r?.from) apply(r.from, r.to ?? r.from)
              else apply(day, day)
            }}
            disabled={{ after: today }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/**
 * Variação em relação ao período anterior, como na Fonio ao vivo (live-compare B-inicio/02): prefixo
 * `<span class="font-medium">-100%</span> · ` dentro da linha cinza de baixo (hífen ASCII, sem seta nem cor).
 * `unit="pp"`: diferença em pontos percentuais para métricas que já são porcentagem.
 */
function deltaText(value: number, unit: '%' | 'pp') {
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value)}${unit === 'pp' ? ' p.p.' : '%'}`
}

function Kpi({ label, value, sub, change, unit = '%' }: { label: string; value: string; sub: string; change: number | null; unit?: '%' | 'pp' }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-medium tabular-nums">{value}</div>
      <div className="truncate text-xs text-muted-foreground">
        {change !== null && (
          <>
            <span className="font-medium">{deltaText(change, unit)}</span>
            {' · '}
          </>
        )}
        {sub}
      </div>
    </div>
  )
}

/** Período da Visão geral: estado da página (a Fonio sempre abre em "30 dias"; a escolha não persiste nem vai para a URL). */
type PeriodState = { period: PeriodKey; customFrom?: string; customTo?: string }

export default function OverviewPage() {
  // Carregamento da página (respeita "Simular erro ao carregar a próxima página"); o estado `loading` abaixo
  // continua cobrindo apenas a troca de filtros.
  const load = usePageLoad('overview')
  const ui = useUi()
  const ov = ui.overview
  const setUi = useStore((s) => s.setUi)
  const agents = useCollection('agents')
  const conversations = useCollection('conversations')

  const voiceAgents = useMemo(() => agents.filter((a) => a.type === 'voice').sort((a, b) => a.name.localeCompare(b.name)), [agents])
  // Como em [464] (conta só com a Roberta), o filtro de assistente só aparece com 2+ assistentes de voz; com 0 ou 1 o
  // cabeçalho tem apenas "Início" e o segmented, e os números consideram todos os assistentes.
  const showAgentFilter = voiceAgents.length >= 2
  const agentId = showAgentFilter && voiceAgents.some((a) => a.id === ov.agentId) ? ov.agentId : 'all'
  const update = (patch: Partial<UiPrefs['overview']>) => setUi({ overview: { ...useStore.getState().db.ui.overview, ...patch } })
  // Fonio ao vivo (live-compare B-inicio/01): a página sempre abre em "30 dias" — o período não é salvo nem vai para a URL.
  const [pf, setPf] = useState<PeriodState>({ period: '30d' })
  const updatePeriod = (patch: Partial<PeriodState>) => setPf((cur) => ({ ...cur, ...patch }))

  const range = useMemo(() => periodRange(pf.period, pf.customFrom, pf.customTo), [pf.period, pf.customFrom, pf.customTo])
  const calls = useMemo(() => callsIn(conversations, range, agentId), [conversations, range, agentId])
  const prevCalls = useMemo(() => callsIn(conversations, previousRange(range), agentId), [conversations, range, agentId])
  const k = useMemo(() => computeKpis(calls), [calls])
  const pk = useMemo(() => computeKpis(prevCalls), [prevCalls])

  // Breve estado "carregando" ao trocar filtros (cartões com transition-opacity, como na referência).
  const [loading, setLoading] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 260)
    return () => clearTimeout(t)
  }, [pf.period, pf.customFrom, pf.customTo, agentId])

  const missing = k.withConversation == null ? null : Math.max(0, ANALYSIS_THRESHOLD - k.withConversation)

  if (load.isLoading || load.isError) {
    return (
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[1200px]">{load.isError ? <PageLoadError onRetry={load.retry} /> : <PageSkeleton rows={6} />}</div>
      </div>
    )
  }

  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="xl:text-3xl text-2xl font-semibold tracking-tight flex flex-row items-center min-w-0">
            <span>Início</span>
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            {showAgentFilter && (
              <Select value={agentId} onValueChange={(v) => update({ agentId: v })}>
                <SelectTrigger aria-label="Assistente" className="h-[2.125rem] w-full font-medium sm:w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
                  <LeftCheckItem value="all">Todos os assistentes</LeftCheckItem>
                  {voiceAgents.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="py-1.5 pl-8 pr-2 text-sm font-semibold text-foreground">Assistentes de IA</SelectLabel>
                      {voiceAgents.map((a) => (
                        <LeftCheckItem key={a.id} value={a.id}>
                          {a.name}
                        </LeftCheckItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            )}
            <PeriodFilter ov={pf} onChange={updatePeriod} />
          </div>
        </div>

        <div className="flex flex-col gap-5 @container">
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-base font-medium">Veja o que seus assistentes resolveram</h2>
              <p className="text-sm text-muted-foreground">{rangeLabel(pf.period, range)}</p>
            </div>
            <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm transition-opacity', loading && 'opacity-60')}>
              <div className="grid grid-cols-1 divide-y @xl:grid-cols-3 @xl:divide-x @xl:divide-y-0">
                <Kpi
                  label="Ligações atendidas"
                  value={k.answered == null ? '—' : String(k.answered)}
                  sub={`${k.withConversation ?? '—'} com conversa`}
                  change={delta(k.answered, pk.answered)}
                />
                <Kpi
                  label="Tratadas pelos assistentes"
                  value={k.handledPct === null ? '–' : `${k.handledPct}%`}
                  sub={k.handledPct === null ? missing == null ? '—' : `Faltam ${missing} de ${ANALYSIS_THRESHOLD} conversas` : `${k.handled} de ${k.withConversation} sem transferência`}
                  change={k.handledPct !== null && pk.handledPct !== null ? k.handledPct - pk.handledPct : null}
                  unit="pp"
                />
                <Kpi label="Tempo economizado" value={formatMinutes(k.secondsTalked)} sub="Tempo de conversa dos assistentes" change={delta(k.secondsTalked, pk.secondsTalked)} />
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
            <CallHistoryCard calls={calls} range={range} period={pf.period} metric={ov.metric} onMetric={(m) => update({ metric: m })} loading={loading} />
            <UsageCard loading={loading} />
            <AnalysisCard calls={calls} withConversation={k.withConversation} loading={loading} agentId={agentId} range={range} />
          </div>
        </div>
      </div>
    </div>
  )
}
