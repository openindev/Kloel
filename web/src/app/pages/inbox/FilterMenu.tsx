import { Fragment, useEffect, useState, type ReactNode } from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { Archive, ArrowDownLeft, ArrowUpRight, Bot, CalendarDays, Check, ChevronDown, Eye, EyeOff, Filter, Layers, MessageSquare, Phone, Star, Target, Timer, UserRound, X, type LucideIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import type { ConversationResult } from '@/domain/types'
import { cn } from '@/lib/utils'
import { RESULTS, RESULT_KEYS } from '@/data/catalogs/results'
import { ResultChip } from '@/components/app/misc'
import { EnCalendar } from '../overview/EnCalendar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CHANNEL_GROUP_LABEL, DATE_PRESETS, DIRECTION_LABEL, DURATION_MAX, EMPTY_FILTERS, STATUS_LABEL, countActive, dateFilterLabel, durationLabel,
  type ChannelGroup, type InboxFilters, type StatusKey,
} from './filters'
import { useMediaQuery } from './shared'
import type { AgentOption } from './agentLabel'

/**
 * Teclas dentro do slider e do calendário não chegam ao menu do Radix (← fecharia o submenu; letras acionariam a busca
 * por digitação) — exceto Escape e Tab, que continuam fechando/saindo do menu.
 */
const stopNavKeys = (e: React.KeyboardEvent) => {
  if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation()
}

function toggle<T>(arr: T[], v: T) {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

const ITEM = 'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm focus:bg-accent data-[state=open]:bg-accent'
/** Ícone dos grupos: 14px e 8px até o rótulo (só o gap-2 do item; live-compare D-conversas/04: ícone em x+8, texto em x+30). */
const ICON = 'h-3.5 w-3.5 shrink-0 text-muted-foreground'

/** Ícone de cada opção dos submenus (capturas AN-02 Canal, AN-03 Assistente por tipo, AN-04 Direção, AN-06 Status). */
const OPTION_ICON = 'h-3.5 w-3.5 shrink-0 text-muted-foreground'
const CHANNEL_ICON: Record<ChannelGroup, LucideIcon> = { calls: Phone, chats: MessageSquare }
const DIRECTION_ICON: Record<'inbound' | 'outbound', LucideIcon> = { inbound: ArrowDownLeft, outbound: ArrowUpRight }
const STATUS_ICON: Record<StatusKey, LucideIcon> = { starred: Star, unread: EyeOff, read: Eye, mine: UserRound }

/**
 * Opção de submenu como na Fonio ao vivo (fonio-live2/D-conversas/03–06): ícone + rótulo (ou selo colorido), sem caixa de
 * seleção à esquerda; a opção marcada mostra um check à direita.
 */
/** Item dos submenus da Fonio ao vivo (live-compare D-conversas/03): `relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm` (36px com selo). */
const SUB_ITEM = 'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm'

function CheckItem({ checked, onToggle, children, className, bare }: { checked: boolean; onToggle: () => void; children: ReactNode; className?: string; bare?: boolean }) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault()
        onToggle()
      }}
      role="menuitemcheckbox"
      aria-checked={checked}
      className={cn(SUB_ITEM, 'gap-2', checked && 'bg-accent/60', className)}
    >
      {/* selos (Resultado) entram direto no item, sem invólucro; rótulos com ícone truncam */}
      {bare ? children : <span className="min-w-0 flex-1 truncate">{children}</span>}
      {checked && <Check className={cn('!size-3.5 shrink-0', bare && 'ml-auto')} />}
    </DropdownMenuItem>
  )
}

function SubTrigger({ icon, label, active }: { icon: ReactNode; label: string; active?: number }) {
  return (
    <DropdownMenuSubTrigger className={ITEM}>
      {icon}
      <span className="flex-1">{label}</span>
      {!!active && <span className="mr-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand/10 px-1 text-[10px] font-semibold text-brand">{active}</span>}
    </DropdownMenuSubTrigger>
  )
}

/** Slider de intervalo (dois polegares) — 0:00 a 30:00+. */
export function DurationRange({ value, onChange }: { value: [number, number]; onChange: (v: [number, number]) => void }) {
  // Valor local imediato: o filtro vive na URL e a navegação é assíncrona; sem isto, teclas rápidas (→ → →) partiam do
  // valor antigo e só o primeiro passo era aplicado.
  const [local, setLocal] = useState<[number, number]>(value)
  useEffect(() => setLocal(value), [value[0], value[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SliderPrimitive.Root
      min={0}
      max={DURATION_MAX}
      step={30}
      minStepsBetweenThumbs={1}
      value={local}
      onValueChange={(v) => {
        const next: [number, number] = [v[0] ?? 0, v[1] ?? DURATION_MAX]
        setLocal(next)
        onChange(next)
      }}
      className="relative flex w-full touch-none select-none items-center py-2"
      aria-label="Duração"
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label="Duração mínima" className="block size-4 rounded-full border-2 border-primary bg-background shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <SliderPrimitive.Thumb aria-label="Duração máxima" className="block size-4 rounded-full border-2 border-primary bg-background shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    </SliderPrimitive.Root>
  )
}

type GroupKey = 'channel' | 'agent' | 'direction' | 'result' | 'status' | 'date' | 'duration'

/**
 * `agents`: opções do filtro "Agente" (agentLabel.agentFilterOptions) — assistentes atuais e, depois deles, os excluídos que
 * ainda têm conversas ("<nome> (excluído)" / "Assistente excluído"), filtráveis pelo agentId original.
 */
export function FilterMenu({ filters, onChange, agents }: { filters: InboxFilters; onChange: (f: InboxFilters) => void; agents: AgentOption[] }) {
  const set = (patch: Partial<InboxFilters>) => onChange({ ...filters, ...patch })
  const active = countActive(filters)
  // Telas estreitas (< 640px): submenus laterais não cabem ao lado do menu (ficavam cortados à esquerda em 390px);
  // os grupos passam a expandir dentro do próprio menu, com os mesmos controles.
  const compact = !useMediaQuery('(min-width: 640px)')
  const [expanded, setExpanded] = useState<GroupKey | null>(null)
  const today = new Date()
  const range: DateRange | undefined =
    filters.date.preset === 'custom' && filters.date.from ? { from: new Date(filters.date.from), to: filters.date.to ? new Date(filters.date.to) : undefined } : undefined
  const durationActive = filters.duration[0] > 0 || filters.duration[1] < DURATION_MAX

  const groups: { key: GroupKey; icon: ReactNode; label: string; active: number; subClass: string; content: ReactNode }[] = [
    {
      key: 'channel',
      icon: <Layers className={ICON} />,
      label: 'Canal',
      active: filters.channels.length,
      subClass: 'w-44',
      content: (['calls', 'chats'] as ChannelGroup[]).map((k) => {
        const Icon = CHANNEL_ICON[k]
        return (
          <CheckItem key={k} checked={filters.channels.includes(k)} onToggle={() => set({ channels: toggle(filters.channels, k) })}>
            <span className="flex items-center gap-2">
              <Icon className={OPTION_ICON} />
              {CHANNEL_GROUP_LABEL[k]}
            </span>
          </CheckItem>
        )
      }),
    },
    {
      key: 'agent',
      icon: <Bot className={ICON} />,
      label: 'Agente',
      active: filters.agentIds.length,
      // "<nome> (excluído)" precisa de mais largura que os nomes atuais
      subClass: agents.some((a) => a.deleted) ? 'w-60' : 'w-48',
      content: (
        <>
          {agents.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum assistente</p>}
          {agents.map((a, i) => {
            const Icon = a.type === 'chat' ? MessageSquare : Phone
            return (
              <Fragment key={a.id || '__none'}>
                {a.deleted && !agents[i - 1]?.deleted && i > 0 && <DropdownMenuSeparator />}
                <CheckItem checked={filters.agentIds.includes(a.id)} onToggle={() => set({ agentIds: toggle(filters.agentIds, a.id) })}>
                  <span className={cn('flex min-w-0 items-center gap-2', a.deleted && 'text-muted-foreground')} data-deleted-agent={a.deleted || undefined}>
                    <Icon className={OPTION_ICON} aria-label={a.type === 'chat' ? 'Assistente de chat' : 'Assistente de voz'} />
                    <span className="truncate" title={a.name}>
                      {a.name}
                    </span>
                  </span>
                </CheckItem>
              </Fragment>
            )
          })}
        </>
      ),
    },
    {
      key: 'direction',
      icon: <ArrowDownLeft className={ICON} />,
      label: 'Direção',
      active: filters.directions.length,
      subClass: 'w-44',
      content: (['inbound', 'outbound'] as const).map((k) => {
        const Icon = DIRECTION_ICON[k]
        return (
          <CheckItem key={k} checked={filters.directions.includes(k)} onToggle={() => set({ directions: toggle(filters.directions, k) })}>
            <span className="flex items-center gap-2">
              <Icon className={OPTION_ICON} />
              {DIRECTION_LABEL[k]}
            </span>
          </CheckItem>
        )
      }),
    },
    {
      key: 'result',
      icon: <Target className={ICON} />,
      label: 'Resultado',
      active: filters.results.length,
      // os 12 resultados cabem inteiros (442px), sem barra de rolagem; só rola se a janela for menor que a lista
      subClass: 'max-h-[var(--radix-dropdown-menu-content-available-height)] w-48 overflow-y-auto',
      content: RESULT_KEYS.map((k: ConversationResult) => (
        <CheckItem key={k} bare checked={filters.results.includes(k)} onToggle={() => set({ results: toggle(filters.results, k) })}>
          <ResultChip result={k} />
        </CheckItem>
      )),
    },
    {
      key: 'status',
      icon: <Eye className={ICON} />,
      label: 'Status',
      active: filters.statuses.length,
      subClass: 'w-44',
      content: (['starred', 'unread', 'read', 'mine'] as StatusKey[]).map((k) => {
        const Icon = STATUS_ICON[k]
        return (
          <CheckItem key={k} checked={filters.statuses.includes(k)} onToggle={() => set({ statuses: toggle(filters.statuses, k) })}>
            <span className="flex items-center gap-2">
              <Icon className={OPTION_ICON} />
              {STATUS_LABEL[k]}
            </span>
          </CheckItem>
        )
      }),
    },
    {
      key: 'date',
      icon: <CalendarDays className={ICON} />,
      label: 'Data',
      active: filters.date.preset !== 'all' ? 1 : 0,
      subClass: 'w-auto max-w-[calc(100vw-1rem)] p-0',
      content: (
        // fonio-live2/D-conversas/07: atalhos (Hoje … Mês passado, divisor, "Todo o período" em cinza) + calendário de 1 mês
        // em inglês com dias futuros desabilitados; escolher dias no calendário aplica um intervalo personalizado.
        <div className={cn('flex', compact && 'flex-col')}>
          <div className={cn('flex shrink-0 gap-0.5 p-1', compact ? 'w-full flex-row flex-wrap border-b' : 'w-36 flex-col border-r')}>
            {DATE_PRESETS.map((p) => [
              p.key === 'all' && !compact && <DropdownMenuSeparator key="sep-all" className="my-1" />,
              <DropdownMenuItem
                key={p.key}
                role="menuitemradio"
                aria-checked={filters.date.preset === p.key}
                onSelect={(e) => {
                  e.preventDefault()
                  set({ date: { preset: p.key } })
                }}
                className={cn('text-sm', p.key === 'all' && 'text-muted-foreground', p.key !== 'all' && filters.date.preset === p.key && 'bg-accent font-medium')}
              >
                <span className="flex-1">{p.label}</span>
              </DropdownMenuItem>,
            ])}
          </div>
          {/* p-1 do submenu em volta do calendário (largura medida na captura 07: ~259px) */}
          <div className="p-1" onKeyDown={stopNavKeys}>
            <EnCalendar
              mode="range"
              numberOfMonths={1}
              defaultMonth={range?.to ?? range?.from ?? today}
              selected={range}
              disabled={{ after: today }}
              onSelect={(r, day) => {
                if (!r?.from) return set({ date: { preset: 'custom', from: day.toISOString(), to: day.toISOString() } })
                set({ date: { preset: 'custom', from: r.from.toISOString(), to: (r.to ?? r.from).toISOString() } })
              }}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'duration',
      icon: <Timer className={ICON} />,
      label: 'Duração',
      active: durationActive ? 1 : 0,
      subClass: 'w-60 px-3 pb-2 pt-3',
      content: (
        // fonio-live2/D-conversas/08: rótulo centralizado ("Qualquer duração" ou o intervalo), slider duplo, 0:00 / 30:00+.
        // As setas movem os polegares do slider; sem isto, ← fecharia o submenu (tecla de fechar do Radix).
        <div className={cn(compact && 'px-2 pb-2 pt-1')} onKeyDown={stopNavKeys}>
          <p className="mb-1 text-center text-sm text-muted-foreground">{durationLabel(filters.duration)}</p>
          <DurationRange value={filters.duration} onChange={(duration) => set({ duration })} />
          <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>0:00</span>
            <span>30:00+</span>
          </div>
        </div>
      ),
    },
  ]

  return (
    <DropdownMenu modal={false} onOpenChange={(o) => !o && setExpanded(null)}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Filtrar"
          className={cn(
            'relative inline-flex h-full w-9 items-center justify-center rounded-md rounded-l-none text-muted-foreground transition-colors hover:bg-muted/50 data-[state=open]:bg-muted/50',
            active > 0 && 'text-brand',
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          {active > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />}
        </button>
      </DropdownMenuTrigger>
      {/* Fonio ao vivo (live-compare D-conversas/04): align start — o menu começa na borda esquerda do botão de filtro e
          abre para a direita, por cima da conversa */}
      <DropdownMenuContent
        align={compact ? 'end' : 'start'}
        collisionPadding={16}
        className={cn(compact ? 'max-h-[min(72vh,var(--radix-dropdown-menu-content-available-height))] w-[calc(100vw-2rem)] max-w-[358px] overflow-y-auto' : 'w-52')}
        data-compact={compact || undefined}
      >
        {groups.map((g) =>
          compact ? (
            <div key={g.key}>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setExpanded((cur) => (cur === g.key ? null : g.key))
                }}
                aria-expanded={expanded === g.key}
                className={cn(ITEM, expanded === g.key && 'bg-accent')}
              >
                {g.icon}
                <span className="flex-1">{g.label}</span>
                {!!g.active && <span className="mr-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand/10 px-1 text-[10px] font-semibold text-brand">{g.active}</span>}
                <ChevronDown className={cn('!size-3.5 text-muted-foreground transition-transform', expanded === g.key && 'rotate-180')} />
              </DropdownMenuItem>
              {expanded === g.key && (
                <div role="group" aria-label={g.label} className={cn('mb-1 ml-4 border-l pl-1', g.key === 'date' && 'ml-0 border-l-0 pl-0')}>
                  {g.content}
                </div>
              )}
            </div>
          ) : (
            <DropdownMenuSub key={g.key}>
              <SubTrigger icon={g.icon} label={g.label} active={g.active} />
              {/* live-compare D-conversas/03: o submenu começa 4px depois da borda do menu (8px depois do item) */}
              <DropdownMenuSubContent sideOffset={8} className={cn('shadow-lg', g.subClass)}>
                {g.content}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ),
        )}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            set({ showArchived: !filters.showArchived })
          }}
          role="menuitemcheckbox"
          aria-checked={filters.showArchived}
          className="text-sm"
        >
          <Archive className="mr-0 !size-3.5 text-muted-foreground" />
          <span className="flex-1">Mostrar arquivados</span>
          {filters.showArchived && <Check className="!size-3.5" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Chips de filtros ativos, removíveis (INFERIDO: não capturado na Fonio). */
export function ActiveFilterChips({ filters, onChange, agents }: { filters: InboxFilters; onChange: (f: InboxFilters) => void; agents: AgentOption[] }) {
  const chips: { key: string; label: string; clear: Partial<InboxFilters> }[] = []
  if (filters.channels.length) chips.push({ key: 'ch', label: `Canal: ${filters.channels.map((c) => CHANNEL_GROUP_LABEL[c]).join(', ')}`, clear: { channels: [] } })
  if (filters.agentIds.length)
    chips.push({ key: 'ag', label: `Agente: ${filters.agentIds.map((id) => agents.find((a) => a.id === id)?.name ?? '—').join(', ')}`, clear: { agentIds: [] } })
  if (filters.directions.length) chips.push({ key: 'dir', label: `Direção: ${filters.directions.map((d) => DIRECTION_LABEL[d]).join(', ')}`, clear: { directions: [] } })
  if (filters.results.length) chips.push({ key: 'res', label: `Resultado: ${filters.results.map((r) => RESULTS[r].label).join(', ')}`, clear: { results: [] } })
  if (filters.statuses.length) chips.push({ key: 'st', label: `Status: ${filters.statuses.map((s) => STATUS_LABEL[s]).join(', ')}`, clear: { statuses: [] } })
  if (filters.date.preset !== 'all') chips.push({ key: 'dt', label: `Data: ${dateFilterLabel(filters.date)}`, clear: { date: { preset: 'all' } } })
  if (filters.duration[0] > 0 || filters.duration[1] < DURATION_MAX) chips.push({ key: 'du', label: `Duração: ${durationLabel(filters.duration)}`, clear: { duration: [0, DURATION_MAX] } })
  if (filters.showArchived) chips.push({ key: 'ar', label: 'Inclui arquivados', clear: { showArchived: false } })
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1 px-4 pb-3" aria-label="Filtros ativos">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5 text-[11px] text-foreground">
          <span className="truncate">{c.label}</span>
          <button type="button" aria-label={`Remover filtro ${c.label}`} onClick={() => onChange({ ...filters, ...c.clear })} className="inline-flex h-4 w-4 items-center justify-center rounded-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
        Limpar
      </button>
    </div>
  )
}
