import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Search, FileText, Hash, Sparkles, CornerDownLeft, Clock, X, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIncremental } from '@/components/app/Pagination'
import { getArticle } from '../content'
import { highlightParts, searchArticles, type SearchResult } from '../lib/search'
import { useHelpUi } from '../lib/ui'

const RECENT_KEY = 'kloel-help:recent-searches'
/** resultados exibidos por vez; "Carregar mais resultados" acrescenta outro lote (volta ao 1º lote quando o termo muda) */
const SEARCH_PAGE_SIZE = 8
/** a busca do diálogo considera todos os artigos/seções correspondentes (o lote limita só o que aparece) */
const SEARCH_LIMIT = 500
const SUGGESTED = ['get-started/first-steps', 'get-started/connect-your-number', 'get-started/write-a-great-prompt', 'actions/call-transfer', 'products/webchat', 'developers/http-request']

function readRecent(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
function pushRecent(q: string) {
  try {
    const list = [q, ...readRecent().filter((x) => x !== q)].slice(0, 5)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* indisponível */
  }
}

type Row =
  | { kind: 'ask'; id: string; query: string }
  | { kind: 'result'; id: string; r: SearchResult }
  | { kind: 'suggest'; id: string; key: string }
  | { kind: 'recent'; id: string; query: string }
  | { kind: 'more'; id: string; remaining: number }

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-brand/15 px-px text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

export function SearchDialog() {
  const open = useHelpUi((s) => s.searchOpen)
  const setOpen = useHelpUi((s) => s.setSearchOpen)
  const openAsk = useHelpUi((s) => s.openAsk)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  // todo caminho de fechamento (Esc, overlay, botão Esc, ⌘K de novo, escolher um resultado) limpa o termo
  useEffect(() => {
    if (open) {
      setRecent(readRecent())
      setActive(0)
    } else setQuery('')
  }, [open])

  const results = useMemo(() => searchArticles(query, SEARCH_LIMIT), [query])
  // lote visível: reinicia a cada termo novo (e ao reabrir o diálogo, que limpa o termo)
  const paged = useIncremental(results, SEARCH_PAGE_SIZE, query.trim())
  const shown = paged.visible
  // linhas agrupadas por aba › grupo (ordem do 1º resultado de cada grupo); o índice ativo segue a ordem visual
  const grouped = useMemo(() => {
    const q = query.trim()
    const base: Row[] = !q
      ? [
          ...recent.map((r, i) => ({ kind: 'recent' as const, id: `recent-${i}`, query: r })),
          ...SUGGESTED.filter((k) => getArticle(k)).map((k) => ({ kind: 'suggest' as const, id: `sug-${k}`, key: k })),
        ]
      : [
          { kind: 'ask' as const, id: 'ask', query: q },
          ...shown.map((r) => ({ kind: 'result' as const, id: r.key + (r.anchor ?? ''), r })),
          ...(paged.hasMore ? [{ kind: 'more' as const, id: 'more', remaining: paged.remaining }] : []),
        ]
    const groups: { label: string; rows: { row: Row; index: number }[] }[] = []
    for (const row of base) {
      const label =
        row.kind === 'ask' ? '' : row.kind === 'recent' ? 'Buscas recentes' : row.kind === 'suggest' ? 'Sugestões' : 'Resultados'
      const g = groups.find((x) => x.label === label)
      if (g) g.rows.push({ row, index: 0 })
      else groups.push({ label, rows: [{ row, index: 0 }] })
    }
    let i = 0
    for (const g of groups) for (const r of g.rows) r.index = i++
    return groups
  }, [query, shown, paged.hasMore, paged.remaining, recent])
  const rows: Row[] = useMemo(() => grouped.flatMap((g) => g.rows.map((r) => r.row)), [grouped])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (row: Row | undefined) => {
    if (!row) return
    const q = query.trim()
    if (row.kind === 'recent') {
      setQuery(row.query)
      return
    }
    if (row.kind === 'more') {
      // mantém o foco no 1º resultado do novo lote (a linha "Carregar mais" desce para o fim)
      const firstNew = rows.indexOf(row)
      paged.loadMore()
      setActive(firstNew)
      return
    }
    if (row.kind === 'ask') {
      pushRecent(q)
      setOpen(false)
      openAsk(row.query)
      setQuery('')
      return
    }
    if (q) pushRecent(q)
    const key = row.kind === 'result' ? row.r.key : row.key
    const hash = row.kind === 'result' && row.r.anchor ? `#${row.r.anchor}` : ''
    setOpen(false)
    setQuery('')
    navigate(`/ajuda/${key}${hash}`)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(rows[active])
    }
  }

  const q = query.trim()

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-3 z-50 flex max-h-[calc(100svh-24px)] w-[calc(100vw-24px)] max-w-[640px] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] sm:top-[12vh] sm:max-h-[70vh]"
        >
          <DialogPrimitive.Title className="sr-only">Buscar na central de ajuda</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-zinc-100 px-4">
            <Search className="size-[18px] shrink-0 text-zinc-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              aria-label="Buscar na central de ajuda"
              role="combobox"
              aria-expanded
              aria-controls="help-search-list"
              aria-activedescendant={rows[active] ? `help-row-${active}` : undefined}
              className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-400"
            />
            {query && (
              <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
                <X className="size-4" />
              </button>
            )}
            <DialogPrimitive.Close className="rounded-md border border-zinc-200 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-50">Esc</DialogPrimitive.Close>
          </div>
          <div ref={listRef} id="help-search-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
            {q && results.length === 0 && (
              <div className="px-4 pb-6 pt-8 text-center">
                <p className="text-sm font-medium text-zinc-900">Nenhum resultado para “{q}”</p>
                <p className="mt-1 text-sm text-zinc-500">Tente outras palavras ou pergunte ao assistente.</p>
              </div>
            )}
            {grouped.map((g) => (
              <div key={g.label || 'ask'} className={cn(g.label && 'mt-1')}>
                {g.label && <p className="px-3 pb-1 pt-2 text-xs font-medium text-zinc-500">{g.label}</p>}
                {g.rows.map(({ row, index }) => {
                  const isActive = index === active
                  const common = {
                    id: `help-row-${index}`,
                    'data-row': index,
                    role: 'option' as const,
                    'aria-selected': isActive,
                    onMouseMove: () => setActive(index),
                    onClick: () => choose(row),
                    className: cn('flex w-full cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-left', isActive ? 'bg-zinc-100' : 'hover:bg-zinc-50'),
                  }
                  if (row.kind === 'ask')
                    return (
                      <div key={row.id} {...common}>
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"><Sparkles className="size-4" /></span>
                        <span className="min-w-0 flex-1 pt-1 text-sm text-zinc-900">
                          Perguntar ao assistente: <span className="font-medium">“{row.query}”</span>
                        </span>
                        {isActive && <CornerDownLeft className="mt-1.5 size-3.5 shrink-0 text-zinc-400" />}
                      </div>
                    )
                  if (row.kind === 'more')
                    return (
                      <div key={row.id} {...common} data-search-more className={cn(common.className, 'items-center justify-center py-2 text-zinc-600', isActive && 'text-zinc-900')}>
                        <ChevronDown className="size-4 shrink-0 text-zinc-400" />
                        <span className="text-sm font-medium">
                          Carregar mais resultados <span className="font-normal tabular-nums text-zinc-400">({row.remaining})</span>
                        </span>
                      </div>
                    )
                  if (row.kind === 'recent')
                    return (
                      <div key={row.id} {...common}>
                        <Clock className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                        <span className="min-w-0 flex-1 truncate text-sm text-zinc-700">{row.query}</span>
                      </div>
                    )
                  if (row.kind === 'suggest') {
                    const a = getArticle(row.key)!
                    return (
                      <div key={row.id} {...common}>
                        <FileText className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-900">{a.title}</span>
                          <span className="block truncate text-xs text-zinc-500">{a.description}</span>
                        </span>
                      </div>
                    )
                  }
                  const r = row.r
                  return (
                    <div key={row.id} {...common}>
                      {r.anchor ? <Hash className="mt-[18px] size-4 shrink-0 text-zinc-400" /> : <FileText className="mt-[18px] size-4 shrink-0 text-zinc-400" />}
                      <span className="min-w-0 flex-1">
                        <span className="mb-0.5 block truncate text-[11px] font-medium text-zinc-400">
                          {r.tabLabel === r.groupLabel ? r.tabLabel : `${r.tabLabel} › ${r.groupLabel}`}
                        </span>
                        <span className="block truncate text-sm font-medium text-zinc-900">
                          <Highlight text={r.title} terms={r.terms} />
                          {r.anchorText && (
                            <span className="font-normal text-zinc-500">
                              {' '}
                              › <Highlight text={r.anchorText} terms={r.terms} />
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-xs leading-5 text-zinc-500">
                          <Highlight text={r.snippet} terms={r.terms} />
                        </span>
                      </span>
                      {isActive && <CornerDownLeft className="mt-1 size-3.5 shrink-0 text-zinc-400" />}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div className={cn('items-center gap-4 border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-500 sm:flex', q ? 'flex' : 'hidden')}>
            <span className="hidden items-center gap-1 sm:flex"><ArrowUp className="size-3" /><ArrowDown className="size-3" /> navegar</span>
            <span className="hidden items-center gap-1 sm:flex"><CornerDownLeft className="size-3" /> abrir</span>
            <span className="hidden sm:inline">Esc fechar</span>
            {q && (
              <span className="ml-auto tabular-nums" data-search-count>
                {paged.hasMore ? `${shown.length} de ${results.length} resultados` : `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}`}
              </span>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
