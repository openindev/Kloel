import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronDown, Columns3, GripVertical, Info } from 'lucide-react'
import { toast } from 'sonner'
import type { Agent, Contact, Conversation, Subscription, Tag } from '@/domain/types'
import { cn } from '@/lib/utils'
import { CHANNEL_LABEL, RESULTS } from '@/data/catalogs/results'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SearchFilterBox } from '@/components/app/misc'
import { FilterMenu } from './FilterMenu'
import { resolveConversationAgent, type AgentOption } from './agentLabel'
import { DIRECTION_LABEL, applyFilters, callerName, type InboxFilters } from './filters'
import { downloadBlob, toCsv } from './shared'
import { buildXlsx } from './xlsx'
import { useConversationSearch } from './useConversationSearch'
import { matchesConversationQuery } from './filters'
import { InboxLoadError } from './InboxLoadError'
import './outcomes'
import { captureEngineContext } from '@/services/engine/session'
import { loadConversation } from '@/services/casca/conversations'

/* ------------------------------------------------------------------ */
/* "Exportar conversas" (fonio-live2/D-conversas/14–16)                */
/* ------------------------------------------------------------------ */

export const EXPORT_COLUMNS = ['date', 'channel', 'direction', 'subject', 'summary', 'contact', 'caller', 'callee', 'agent', 'duration', 'result', 'tags', 'link'] as const
export type ExportColumn = (typeof EXPORT_COLUMNS)[number]

/** Rótulos e ordem do menu "Colunas" da Fonio ao vivo (13 caixas, todas marcadas por padrão). */
export const EXPORT_COLUMN_LABEL: Record<ExportColumn, string> = {
  date: 'Data',
  channel: 'Canal',
  direction: 'Direção',
  subject: 'Assunto',
  summary: 'Resumo',
  contact: 'Contato',
  caller: 'Chamador',
  callee: 'Destinatário',
  agent: 'Agente',
  duration: 'Duração',
  result: 'Resultado',
  tags: 'Tags',
  link: 'Link',
}

/** Preferência de colunas (ordem + ocultas) do diálogo, persistida neste navegador. */
const PREF_KEY = 'kloel-inbox-export:columns'
type ColumnPref = { order: ExportColumn[]; hidden: ExportColumn[] }
function loadPref(): ColumnPref {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? 'null') as Partial<ColumnPref> | null
    const valid = (a: unknown): ExportColumn[] => (Array.isArray(a) ? a.filter((x): x is ExportColumn => (EXPORT_COLUMNS as readonly string[]).includes(x)) : [])
    const order = [...new Set(valid(raw?.order))]
    // colunas novas (ou ausentes) entram no fim, na ordem padrão
    for (const c of EXPORT_COLUMNS) if (!order.includes(c)) order.push(c)
    return { order, hidden: valid(raw?.hidden) }
  } catch {
    return { order: [...EXPORT_COLUMNS], hidden: [] }
  }
}
function savePref(p: ColumnPref) {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(p))
  } catch {
    /* armazenamento indisponível: a escolha vale só para a sessão */
  }
}

/** Duração no formato da exportação da Fonio: "0:03:02" (h:mm:ss). */
export function hms(sec: number | null) {
  if (sec == null || !Number.isFinite(sec)) return ''
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function exportCell(col: ExportColumn, c: Conversation, ctx: { agents: Agent[]; contacts: Contact[]; tags: Tag[]; origin: string }): string {
  switch (col) {
    case 'date':
      return format(new Date(c.startedAt), 'yyyy-MM-dd HH:mm')
    case 'channel':
      return CHANNEL_LABEL[c.channel] ?? c.channel
    case 'direction':
      // referência: chamada web sem direção (célula vazia); ligações telefônicas "Entrada"/"Saída"
      return c.channel === 'phone' ? DIRECTION_LABEL[c.direction] : ''
    case 'subject':
      return c.title
    case 'summary':
      return c.summary
    case 'contact':
      return callerName(c, ctx.contacts)
    case 'caller':
      return c.callerNumber ?? ''
    case 'callee':
      return c.calleeNumber ?? ''
    case 'agent':
      return resolveConversationAgent(c, ctx.agents).name
    case 'duration':
      return hms(c.durationSec)
    case 'result':
      // Fonio ao vivo: desfechos adicionais da análise antes do resultado ("Informação fornecida, Resolvido")
      return c.chatActive ? 'Ativo' : [...(c.outcomes ?? []), RESULTS[c.result].label].join(', ')
    case 'tags':
      return c.tagIds
        .map((id) => ctx.tags.find((t) => t.id === id)?.label ?? '')
        .filter(Boolean)
        .join(', ')
    case 'link':
      return `${ctx.origin}/app/inbox?id=${encodeURIComponent(c.id)}`
  }
}

/** Exportação do WhatsApp / Chatbot de IA: só nos planos Team ou superiores de cada produto. */
function exportAllowed(subs: Subscription[], product: 'whatsapp' | 'webchat') {
  const s = subs.find((x) => x.product === product && x.status === 'active')
  return !!s && s.plan !== 'solo'
}

const PREVIEW_ROWS = 50

export function ExportDialog({
  open,
  onOpenChange,
  conversations,
  initialQuery,
  initialFilters,
  agents,
  agentOptions,
  contacts,
  tags,
  subscriptions,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Todas as conversas da organização, já ordenadas (mais recentes primeiro). */
  conversations: Conversation[]
  initialQuery: string
  initialFilters: InboxFilters
  agents: Agent[]
  agentOptions: AgentOption[]
  contacts: Contact[]
  tags: Tag[]
  subscriptions: Subscription[]
}) {
  const [exporting, setExporting] = useState(false)
  const exportBusy = useRef(false), exportOpen = useRef(open)
  exportOpen.current = open
  useEffect(() => () => { exportOpen.current = false }, [])
  const [query, setQuery] = useState(initialQuery)
  const [filters, setFilters] = useState<InboxFilters>(initialFilters)
  const [pref, setPref] = useState<ColumnPref>(loadPref)
  const [dragCol, setDragCol] = useState<ExportColumn | null>(null)
  const [overCol, setOverCol] = useState<ExportColumn | null>(null)
  const gripRefs = useRef(new Map<ExportColumn, HTMLButtonElement>())

  // Ao abrir, parte da busca e dos filtros atuais da lista (a busca/os filtros do diálogo não mudam a lista).
  useEffect(() => {
    if (!open) return
    setQuery(initialQuery)
    setFilters(initialFilters)
    setPref(loadPref())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const updatePref = (p: ColumnPref) => {
    setPref(p)
    savePref(p)
  }

  const search = useConversationSearch(query, open)
  const waOk = exportAllowed(subscriptions, 'whatsapp')
  const wcOk = exportAllowed(subscriptions, 'webchat')
  const rows = useMemo(
    () =>
      (search.state === 'ready' ? applyFilters(conversations, filters, '', contacts).filter(c => !query.trim() || search.ids?.has(c.id) || matchesConversationQuery(c, query, contacts)) : []).filter(
        (c) => (c.channel !== 'whatsapp' || waOk) && (c.channel !== 'webchat' || wcOk),
      ),
    [conversations, filters, query, contacts, waOk, wcOk, search.state, search.ids],
  )
  const columns = pref.order.filter((c) => !pref.hidden.includes(c))
  const ctx = useMemo(() => ({ agents, contacts, tags, origin: window.location.origin }), [agents, contacts, tags])

  const move = (col: ExportColumn, to: number) => {
    const vis = [...columns]
    const from = vis.indexOf(col)
    if (from < 0 || to < 0 || to >= vis.length || from === to) return
    vis.splice(from, 1)
    vis.splice(to, 0, col)
    // as ocultas mantêm suas posições; as visíveis assumem a nova ordem
    let vi = 0
    updatePref({ order: pref.order.map((c) => (pref.hidden.includes(c) ? c : vis[vi++]!)), hidden: pref.hidden })
  }
  const onGripKey = (col: ExportColumn) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = columns.indexOf(col)
    const to = i + (e.key === 'ArrowLeft' ? -1 : 1)
    if (to < 0 || to >= columns.length) return
    move(col, to)
    requestAnimationFrame(() => gripRefs.current.get(col)?.focus())
  }
  const dragProps = (col: ExportColumn) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLTableCellElement>) => {
      setDragCol(col)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', col)
    },
    onDragOver: (e: DragEvent<HTMLTableCellElement>) => {
      if (!dragCol) return
      e.preventDefault()
      if (overCol !== col) setOverCol(col)
    },
    onDrop: (e: DragEvent<HTMLTableCellElement>) => {
      e.preventDefault()
      if (dragCol && dragCol !== col) move(dragCol, columns.indexOf(col))
      setDragCol(null)
      setOverCol(null)
    },
    onDragEnd: () => {
      setDragCol(null)
      setOverCol(null)
    },
  })

  const download = async (kind: 'csv' | 'xlsx') => {
    if (!rows.length || !columns.length || exportBusy.current) return
    exportBusy.current = true; setExporting(true)
    try {
      const context = captureEngineContext(), complete: Conversation[] = []
      for (const row of rows) {
        if (!exportOpen.current) return
        if (row.engineConversation?.loaded) complete.push(row)
        else {
          complete.push(await loadConversation(context, row.id))
          // Four bounded detail reads per row; leave room under the shared API rate limit.
          await new Promise(resolve => setTimeout(resolve, 2400))
        }
      }
      context.assertCurrent()
      if (!exportOpen.current) return
      const header = columns.map(c => EXPORT_COLUMN_LABEL[c]), data = complete.map(c => columns.map(col => exportCell(col, c, ctx)))
      const base = `conversas-kloel-${format(new Date(), 'yyyy-MM-dd')}`
      if (kind === 'csv') downloadBlob(`${base}.csv`, new Blob([toCsv(header, data)], { type: 'text/csv;charset=utf-8' }))
      else downloadBlob(`${base}.xlsx`, buildXlsx('Conversas', header, data))
      toast.success('Exportação concluída', { description: `${complete.length} ${complete.length === 1 ? 'conversa exportada' : 'conversas exportadas'} (${kind === 'csv' ? 'CSV' : 'Excel'}).` })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível exportar as conversas.') }
    finally { exportBusy.current = false; setExporting(false) }
  }

  const missing: { key: string; label: string; to: string }[] = []
  if (!waOk) missing.push({ key: 'wa', label: 'WhatsApp Team', to: subscriptions.some((s) => s.product === 'whatsapp' && s.status === 'active') ? '/app/change-plan/whatsapp' : '/app/add-product/whatsapp' })
  if (!wcOk) missing.push({ key: 'wc', label: 'Chatbot de IA Team', to: subscriptions.some((s) => s.product === 'webchat' && s.status === 'active') ? '/app/change-plan/webchat' : '/app/add-product/webchat' })
  const alertText =
    missing.length === 2
      ? 'As conversas do WhatsApp e do Chatbot de IA não estão incluídas nesta exportação. A exportação está disponível no plano Team de cada produto.'
      : missing[0]?.key === 'wa'
        ? 'As conversas do WhatsApp não estão incluídas nesta exportação. A exportação está disponível no plano Team.'
        : 'As conversas do Chatbot de IA não estão incluídas nesta exportação. A exportação está disponível no plano Team.'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-4rem)] max-w-[1200px] flex-col gap-0 gap-y-0 p-6 max-sm:h-full max-sm:max-h-full max-sm:w-full max-sm:p-4" data-testid="inbox-export-dialog">
        <DialogTitle className="pr-8">Exportar conversas</DialogTitle>

        <div className="mt-6 flex items-center gap-2">
          <SearchFilterBox
            className="min-w-0 flex-1"
            value={query}
            onChange={setQuery}
            placeholder="Pesquisar chamadas, chats..."
            filterSlot={<FilterMenu filters={filters} onChange={setFilters} agents={agentOptions} />}
          />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              {/* live-compare D-conversas/07: h-9 px-3 gap-1.5, ícones de 14px (botão de 119px) */}
              <Button variant="outline" className="h-9 shrink-0 gap-1.5 rounded-md px-3 [&_svg]:size-3.5">
                <Columns3 className="size-3.5" />
                <span className="max-sm:sr-only">Colunas</span>
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[188px]">
              {pref.order.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c}
                  checked={!pref.hidden.includes(c)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(v) =>
                    updatePref({ order: pref.order, hidden: v ? pref.hidden.filter((x) => x !== c) : [...pref.hidden, c] })
                  }
                >
                  {EXPORT_COLUMN_LABEL[c]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {missing.length > 0 && (
          <div role="note" className="mt-6 flex items-start gap-3 rounded-lg border border-sky-200/70 bg-sky-50 px-4 py-4 text-sm text-slate-900" data-testid="inbox-export-plan-note">
            <Info className="mt-0.5 size-4 shrink-0 text-blue-950" />
            <p className="min-w-0 leading-5">
              {alertText}
              {missing.map((m) => (
                <Link key={m.key} to={m.to} onClick={() => onOpenChange(false)} className="ml-2 inline-block font-medium underline underline-offset-2 hover:text-foreground/80">
                  {m.label}
                </Link>
              ))}
            </p>
          </div>
        )}

        <div className="mt-6 flex min-h-0 flex-col">
          <p className="mb-2 text-sm text-muted-foreground">Prévia</p>
          <div className="min-h-0 overflow-auto rounded-lg border">
            {search.state === 'loading' ? <p data-engine-state="loading" role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando conversas…</p> : search.state === 'error' ? <InboxLoadError onRetry={search.retry} /> : columns.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Selecione ao menos uma coluna.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    {columns.map((col) => (
                      <th
                        key={col}
                        {...dragProps(col)}
                        data-column={col}
                        className={cn(
                          // live-compare D-conversas/07: th "pl-3 pr-8 h-9 … border-r border-border/60 cursor-grab" com a alça
                          // "Reordenar <coluna>, use as setas" no espaço à direita, visível ao passar o mouse
                          'group/th relative h-9 cursor-grab whitespace-nowrap border-r border-border/60 pl-3 pr-8 text-left font-medium text-muted-foreground last:border-r-0 active:cursor-grabbing',
                          dragCol === col && 'opacity-50',
                          overCol === col && dragCol !== col && 'bg-muted/60',
                        )}
                      >
                        {EXPORT_COLUMN_LABEL[col]}
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) gripRefs.current.set(col, el)
                            else gripRefs.current.delete(col)
                          }}
                          aria-label={`Reordenar ${EXPORT_COLUMN_LABEL[col]}, use as setas`}
                          onKeyDown={onGripKey(col)}
                          className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover/th:opacity-100 active:cursor-grabbing"
                        >
                          <GripVertical className="size-3.5" />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_ROWS).map((c) => (
                    <tr key={c.id} className="border-b last:border-b-0">
                      {columns.map((col) => {
                        const v = exportCell(col, c, ctx)
                        return (
                          // live-compare D-conversas/07: td "h-9 px-3 py-2 border-r border-border/60"; texto truncado em 200px
                          // (Resultado e Link com 225px) e o Resumo em 320px (345px)
                          <td key={col} title={v.length > 28 ? v : undefined} className="h-9 whitespace-nowrap border-r border-border/60 px-3 py-2 last:border-r-0">
                            <div className={cn('truncate', col === 'summary' ? 'max-w-[320px]' : 'max-w-[200px]')}>{v}</div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length} className="h-9 px-3 text-muted-foreground">
                        Nenhuma conversa encontrada
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          <p className="mt-2 px-3 text-right text-xs text-muted-foreground tabular-nums" data-testid="inbox-export-count">
            {search.state !== 'ready' ? '—' : rows.length === 1 ? '1 conversa será exportada' : `${rows.length.toLocaleString('pt-BR')} conversas serão exportadas`}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" className="h-10 px-4" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button className="h-10 gap-2 px-4" disabled={exporting || !rows.length || !columns.length}>
                {exporting ? 'Preparando…' : 'Baixar como'} <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem onSelect={() => download('csv')}>CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => download('xlsx')}>Excel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DialogContent>
    </Dialog>
  )
}
