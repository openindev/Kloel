import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Archive, CloudOff, Download, MessageCircle, MessageSquareDashed, Phone, RotateCw, Search, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import type { Conversation } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import { cn } from '@/lib/utils'
import { useCollection, useCurrentRole, useStore, useUi } from '@/data/store'
import { Button } from '@/components/ui/button'
import { ResultChip, SearchFilterBox } from '@/components/app/misc'
import { LoadMoreButton, useIncremental } from '@/components/app/Pagination'
import { captureEngineContext } from '@/services/engine/session'
import { loadConversations, refreshConversation, updateConversationEditor, deleteConversation } from '@/services/casca/conversations'
import { useConversationSearch } from './useConversationSearch'
import { matchesConversationQuery } from './filters'
import { InboxLoadError as LoadError } from './InboxLoadError'
import { ActiveFilterChips, FilterMenu } from './FilterMenu'
import { ConversationDetail } from './ConversationDetail'
import { DetailsPanel, ListChannelIcon, channelLineLabel } from './DetailsPanel'
import { TagsSheet } from './TagsUi'
import { ExportDialog } from './ExportDialog'
import { agentFilterOptions, resolveConversationAgent } from './agentLabel'
import { ActiveChip, ColumnResizer, formatDuration, mainWidthGuess, revealInContainer, useElementWidth, useResizableWidth } from './shared'
import {
  applyFilters, callerName, dayGroupLabel, filtersFromParams, filtersToParams, isChat, matchContact, relativeLabel, setInboxView, useInboxView,
  type InboxFilters,
} from './filters'

/** Estilos de impressão ("Salvar como PDF"): imprime somente a conversa aberta, com a transcrição inteira. */
const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  body * { visibility: hidden !important; }
  .group\\/sidebar-wrapper > div:first-child { display: none !important; }
  *:has([data-print-area]) { display: block !important; position: static !important; overflow: visible !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; }
  [data-print-area], [data-print-area] * { visibility: visible !important; }
  [data-print-area] { display: block !important; position: static !important; width: 100% !important; height: auto !important; overflow: visible !important; }
  [data-print-area] * { overflow: visible !important; }
  [data-print-expand] { height: auto !important; max-height: none !important; }
}
`

function ConversationItem({
  c,
  selected,
  relative,
  contactName,
  onSelect,
  onToggleTime,
}: {
  c: Conversation
  selected: boolean
  relative: boolean
  /** Nome do contato correspondente (chats: "número · nome", como na captura WA-03). */
  contactName?: string
  onSelect: () => void
  onToggleTime: () => void
}) {
  const d = new Date(c.startedAt)
  const chat = isChat(c)
  // Chat em andamento (WA-03): a 3ª linha mostra a última mensagem (ainda não há resumo) e o chip "Ativo".
  const lastText = c.chatActive ? [...c.transcript].reverse().find((l) => l.speaker !== 'system')?.text ?? '' : ''
  return (
    <div className="px-2.5">
      <div
        role="option"
        id={`inbox-option-${c.id}`}
        aria-selected={selected}
        tabIndex={-1}
        data-conversation-id={c.id}
        onClick={onSelect}
        className={cn(
          'group relative flex cursor-pointer items-start gap-1 rounded-lg py-4 pl-1 pr-4 transition-colors',
          selected ? 'bg-brand/5 ring-1 ring-inset ring-brand/15' : 'hover:bg-muted/40',
        )}
      >
        <div className="flex w-2 shrink-0 flex-col items-center pt-[6px]">{!c.read && <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-label="Não lida" />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={cn('truncate text-[13px] font-medium leading-snug', !c.read && 'font-semibold')}>{c.title}</span>
            <button
              type="button"
              title={format(d, "EEEE, d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
              onClick={(e) => {
                e.stopPropagation()
                onToggleTime()
              }}
              className="shrink-0 cursor-pointer text-[11px] tabular-nums text-muted-foreground hover:text-foreground"
            >
              {relative ? relativeLabel(d) : format(d, 'HH:mm')}
            </button>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <ListChannelIcon conversation={c} />
            <span className="inline-flex min-w-0 items-center truncate text-[11.5px] text-muted-foreground">
              {/* Ligação: "↙ +55 11 … · 0:45" (AN-01); chamada web: "Chamada web · 3:02" (ao vivo); chats: "número · contato" (WA-03). */}
              <span className="truncate font-mono [word-spacing:-0.25em]">{channelLineLabel(c)}</span>
              {chat ? (
                contactName && (
                  <>
                    <span className="mx-[5px]">·</span>
                    <span className="truncate font-mono">{contactName}</span>
                  </>
                )
              ) : (
                <>
                  <span className="mx-[5px]">·</span>
                  <span className="tabular-nums">{formatDuration(c.durationSec)}</span>
                </>
              )}
              {c.starred && <span className="ml-1.5 text-amber-500" aria-label="Favorito">★</span>}
              {c.archived && <Archive className="ml-1.5 h-3 w-3 shrink-0" aria-label="Arquivada" />}
              {c.handover && <UserRound className="ml-1.5 h-3 w-3 shrink-0 text-emerald-700" aria-label="Assumida pela equipe" />}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            {/* Fonio ao vivo (live-compare D-conversas/01): na lista o resumo aparece sem o ponto final */}
            <span className="min-w-0 flex-1 truncate text-[11.5px] leading-snug text-muted-foreground">{c.chatActive ? lastText : listSummary(c.summary)}</span>
            {c.chatActive ? <ActiveChip /> : <ResultChip result={c.result} />}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Resumo da linha da lista: o mesmo texto do cabeçalho sem o ponto final (reticências são mantidas). */
const listSummary = (s: string) => s.replace(/(?<!\.)\.\s*$/, '')

/** Fator de velocidade das simulações (localStorage kloel-demo:speed, usado nos testes automatizados). */
type LoadState = 'loading' | 'error' | 'ready'
/** The session boundary has loaded the list before mounting this page. Retries perform a fresh API read. */
function useInboxLoad() {
  const [state, setState] = useState<LoadState>('ready')
  const retry = async () => {
    setState('loading')
    try {
      const context = captureEngineContext(), slice = await loadConversations(context)
      context.assertCurrent(); useStore.getState().mutate(db => ({ ...db, ...slice })); setState('ready')
    } catch { setState('error') }
  }
  return { state, retry }
}
function useInboxDetailLoad(selected: Conversation | undefined) {
  const [state, setState] = useState<LoadState>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    if (!selected) { setState('ready'); return }
    if (selected.engineConversation?.loaded) { setState('ready'); return }
    setState('loading')
    void refreshConversation(selected.id).then(() => { if (active) setState('ready') }).catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [selected?.id, selected?.engineConversation?.loaded, attempt])
  return { state: selected && !selected.engineConversation?.loaded && state === 'ready' ? 'loading' as const : state, retry: () => setAttempt(a => a + 1) }
}

function ListSkeleton() {
  return (
    <div data-engine-state="loading" role="status" aria-label="Carregando conversas" className="animate-pulse">
      <div className="flex items-center gap-2 px-4 py-1.5">
        <span className="h-2 w-10 rounded bg-brand/15" />
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="px-2.5">
          <div className="flex items-start gap-1 py-4 pl-1 pr-4">
            <span className="w-2 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="h-3 rounded bg-muted" style={{ width: `${[62, 48, 70, 55, 66, 44][i]}%` }} />
                <span className="h-2.5 w-8 rounded bg-muted" />
              </div>
              <span className="block h-2.5 w-24 rounded bg-muted/80" />
              <div className="flex items-center gap-2">
                <span className="h-2.5 flex-1 rounded bg-muted/70" />
                <span className="h-4 w-16 rounded bg-muted" />
              </div>
            </div>
          </div>
        </div>
      ))}
      <span className="sr-only">Carregando conversas…</span>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div data-engine-state="loading" aria-hidden className="flex min-w-0 flex-1 animate-pulse flex-col bg-white">
      <div className="px-6 pb-4 pt-6">
        <span className="block h-4 w-64 max-w-full rounded bg-muted" />
      </div>
      <div className="mx-6 mb-4 h-11 rounded-lg border bg-muted/30" />
      <div className="border-t px-6 py-4">
        <span className="block h-2.5 w-20 rounded bg-muted" />
        <div className="mt-6 space-y-4">
          {[80, 55, 70, 40, 65].map((w, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="h-2.5 w-8 rounded bg-muted/80" />
              <span className="h-2.5 w-14 rounded bg-muted" />
              <span className="h-2.5 rounded bg-muted/70" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


function NoConversations() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <h1 className="text-[18px] font-semibold tracking-tight">Conversas</h1>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        <div className="relative mb-6 h-[120px] w-[220px]" aria-hidden>
          <div className="absolute left-6 top-2 h-[64px] w-[180px] -rotate-3 rounded-xl border bg-white p-3 shadow-sm">
            <div className="h-2 w-20 rounded-full bg-muted" />
            <div className="mt-2 h-2 w-32 rounded-full bg-muted/70" />
            <div className="mt-2 h-2 w-14 rounded-full bg-brand/20" />
          </div>
          <div className="absolute left-0 top-12 h-[64px] w-[190px] rotate-2 rounded-xl border bg-white p-3 shadow-md">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand" />
              <div className="h-2 w-24 rounded-full bg-muted" />
            </div>
            <div className="mt-2 h-2 w-36 rounded-full bg-muted/70" />
            <div className="mt-2 h-2 w-16 rounded-full bg-green-100" />
          </div>
          <span className="absolute -right-1 top-0 flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white shadow-[0_0_18px_-2px_hsl(var(--brand)/0.6)]">
            <MessageCircle className="h-5 w-5" />
          </span>
        </div>
        <h2 className="text-lg font-semibold tracking-tight">Nenhuma conversa ainda</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Quando seus assistentes atenderem ligações ou chats, cada conversa aparece aqui com resumo, resultado e transcrição.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button asChild variant="brand" className="gap-2">
            <Link to="/app/agents">
              <Phone className="h-4 w-4" /> Testar ligação
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/phone-numbers">Conectar um número</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

/* Layout responsivo medido pela largura real da área de conteúdo (janela − barra lateral), não pela janela:
 * - colunas (lista + detalhe) só quando o detalhe mantém MIN_DETAIL px; abaixo disso, lista → detalhe em coluna única;
 * - painel "Detalhes" (280px) sempre sobreposto à direita, como na Fonio ao vivo (fonio-live2/D-conversas/12); em áreas
 *   estreitas (< 600px) ocupa a largura toda. */
const MIN_LIST = 260
const MAX_LIST = 600
const MIN_DETAIL = 440
/** Altura do cabeçalho fixo dos grupos ("Hoje", "Ontem"…), descontada ao revelar o item selecionado. */
const GROUP_HEADER_H = 28
/**
 * Carregamento incremental da lista (INFERIDO: a conta Fonio capturada tinha 1 conversa, sem paginação visível):
 * 30 conversas por vez; rolar até o fim da lista carrega mais (IntersectionObserver) e "Carregar mais (N)" faz o mesmo
 * pelo teclado/clique. A contagem volta a 30 quando a busca ou os filtros mudam.
 */
const LIST_STEP = 30

export default function InboxPage() {
  // URL da Fonio: /app/inbox?id=<conversa>&q=<busca> (forma canônica); /app/inbox/<id> continua aceita e é convertida.
  const { conversationId: pathId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryId = searchParams.get('id') || undefined
  const conversationId = pathId ?? queryId
  const navigate = useNavigate()
  const location = useLocation()
  const all = useCollection('conversations')
  const agents = useCollection('agents')
  const contacts = useCollection('contacts')
  const tags = useCollection('tags')
  const subscriptions = useCollection('subscriptions')
  // Opções do filtro "Agente": assistentes atuais + excluídos que ainda têm conversas ("<nome> (excluído)").
  const agentOptions = useMemo(() => agentFilterOptions(agents, all), [agents, all])
  const role = useCurrentRole()
  // Catálogo de papéis: Builder e Visualizador têm acesso somente leitura ao histórico de ligações e chats.
  const readOnly = role === 'viewer' || role === 'builder'
  const ui = useUi()
  const setUi = useStore((s) => s.setUi)
  // Busca e filtros vivem na URL (?q=, ?result=, ?agent=, ?channel=, ?status=, ?date=, ?dur=, ?archived=) — voltar/avançar/recarregar restauram.
  const { query, filters } = useMemo(() => filtersFromParams(searchParams), [searchParams])
  const { relativeTime } = useInboxView()
  const listSearch = useMemo(() => {
    const s = filtersToParams(query, filters).toString()
    return s ? `?${s}` : ''
  }, [query, filters])
  const to = useCallback(
    (id?: string) => {
      const sp = new URLSearchParams()
      if (id) sp.set('id', id)
      new URLSearchParams(listSearch).forEach((v, k) => sp.append(k, v))
      const s = sp.toString()
      return { pathname: '/app/inbox', search: s ? `?${s}` : '' }
    },
    [listSearch],
  )
  const applyView = (q: string, f: InboxFilters, replace = false) => {
    const sp = new URLSearchParams()
    if (conversationId) sp.set('id', conversationId)
    filtersToParams(q, f).forEach((v, k) => sp.append(k, v))
    setSearchParams(sp, { replace })
  }
  const applyViewRef = useRef(applyView)
  applyViewRef.current = applyView
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  // Campo de busca com valor local (como a Fonio: digitar rápido mantém todos os caracteres, "zzqx" → ?q=zzqx). Só a
  // gravação em ?q= é adiada; o campo nunca é reescrito pela URL enquanto tem o foco (a navegação é assíncrona e a
  // reescrita apagava as teclas digitadas entre uma gravação e outra). Sem foco, voltar/avançar/recarregar restauram ?q=.
  const [searchText, setSearchText] = useState(query)
  const searchTextRef = useRef(searchText)
  searchTextRef.current = searchText
  const searchFocused = useRef(false)
  const queryRef = useRef(query)
  queryRef.current = query
  const searchTimer = useRef<number | undefined>(undefined)
  const flushSearch = useCallback(() => {
    if (searchTimer.current === undefined) return
    window.clearTimeout(searchTimer.current)
    searchTimer.current = undefined
    applyViewRef.current(searchTextRef.current, filtersRef.current, true)
  }, [])
  const onSearchChange = (q: string) => {
    setSearchText(q)
    searchTextRef.current = q
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(flushSearch, 150)
  }
  useEffect(() => {
    if (!searchFocused.current && searchTimer.current === undefined) setSearchText(query)
  }, [query])
  useEffect(() => () => window.clearTimeout(searchTimer.current), [])
  // filtros/chips usam o texto digitado (inclusive o que ainda não foi gravado na URL)
  const applyFiltersView = (f: InboxFilters) => {
    window.clearTimeout(searchTimer.current)
    searchTimer.current = undefined
    applyView(searchTextRef.current, f)
  }
  const shellRef = useRef<HTMLDivElement>(null)
  const shellWidth = useElementWidth(shellRef, mainWidthGuess)
  const columns = shellWidth >= MIN_LIST + 1 + MIN_DETAIL
  const [tagsOpen, setTagsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const load = useInboxLoad()
  const ready = load.state === 'ready'
  const search = useConversationSearch(query)
  const listState = load.state === 'ready' ? search.state : load.state

  // Forma antiga /app/inbox/<id> → forma da Fonio /app/inbox?id=<id> (preserva busca, filtros e a origem da navegação).
  useEffect(() => {
    if (pathId) navigate(to(pathId), { replace: true, state: location.state })
  }, [pathId, navigate, to, location.state])

  const inboxUi = ui.inbox ?? { listWidth: 340, detailsOpen: false }
  const maxList = Math.max(MIN_LIST, Math.min(MAX_LIST, shellWidth - 1 - MIN_DETAIL))
  const resizer = useResizableWidth(inboxUi.listWidth, (listWidth) => setUi({ inbox: { ...useStore.getState().db.ui.inbox, listWidth } }), MIN_LIST, maxList)
  const listWidth = columns ? Math.max(MIN_LIST, Math.min(resizer.width, maxList)) : shellWidth

  const sorted = useMemo(() => [...all].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [all])
  const matched = useMemo(() => search.state !== 'ready' ? [] : applyFilters(sorted, filters, '', contacts).filter(c => !query.trim() || search.ids?.has(c.id) || matchesConversationQuery(c, query, contacts)), [sorted, filters, query, contacts, search.state, search.ids])
  // Conversas abertas a partir da lista permanecem nela enquanto a busca/os filtros não mudarem, mesmo que uma ação as tire
  // do filtro (abrir em "Não lido" marca como lida; arquivar; desfavoritar em "Favoritos"…). Uma conversa aberta que não faz
  // parte da lista (link direto, filtro mudado depois) fica só à direita. Mudar a busca/os filtros (ou recarregar) atualiza a lista.
  const keepRef = useRef<{ key: string; ids: Set<string>; prevId?: string; version: number }>({ key: listSearch, ids: new Set(), version: 0 })
  const keepState = keepRef.current
  if (keepState.key !== listSearch) {
    keepState.key = listSearch
    // a conversa aberta que já faz parte da nova lista passa a ser mantida (arquivar/marcar depois não a tira da lista);
    // fora da nova lista ela só continua aberta à direita, como na Fonio (FL2-D02)
    keepState.ids = new Set(conversationId && matched.some((c) => c.id === conversationId) ? [conversationId] : [])
    keepState.version++
  }
  if (conversationId !== keepState.prevId) {
    // só entra na lista mantida a conversa aberta que faz parte da lista atual; um link direto (?id=) para uma conversa
    // fora da busca/dos filtros a mostra à direita com a lista filtrada intacta (Fonio D-conversas/13: "0 Resultados"),
    // inclusive depois de recarregar
    if (conversationId && !keepState.ids.has(conversationId) && matched.some((c) => c.id === conversationId)) {
      keepState.ids.add(conversationId)
      keepState.version++
    }
    keepState.prevId = conversationId
  }
  const keepVersion = keepState.version
  const filtered = useMemo(() => {
    const keep = keepRef.current.ids
    if (!keep.size) return matched
    const ids = new Set(matched.map((c) => c.id))
    return sorted.filter((c) => ids.has(c.id) || keep.has(c.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, sorted, keepVersion])
  // Colunas sem conversa na URL: a primeira da lista já aparece aberta (sem o aviso "Selecione…" piscar) enquanto o
  // efeito abaixo grava ?id= na URL, como a Fonio, que abre a primeira conversa ao entrar.
  const autoId = ready && columns && !conversationId ? filtered[0]?.id : undefined
  const activeId = conversationId ?? autoId
  const selected = activeId ? all.find((c) => c.id === activeId) : undefined
  const detailLoad = useInboxDetailLoad(selected)
  const readAttempt = useRef<string>('')
  const deleting = useRef(false)

  // Carregamento incremental: a busca/os filtros (listSearch) reiniciam a contagem. A conversa aberta (link direto,
  // ?id=, ↑/↓/Home/End, voltar do detalhe) sempre está carregada: a contagem avança até incluí-la e não recua depois.
  const inc = useIncremental(filtered, LIST_STEP, listSearch)
  const selIdx = activeId ? filtered.findIndex((c) => c.id === activeId) : -1
  const loadedCount = inc.visible.length
  const shownCount = Math.min(filtered.length, Math.max(loadedCount, selIdx + 1))
  const remaining = filtered.length - shownCount
  // `loadMore` muda a cada render (closure do hook): os efeitos usam a versão mais recente por ref.
  const loadMoreRef = useRef(inc.loadMore)
  loadMoreRef.current = inc.loadMore
  const loadMore = useCallback(() => loadMoreRef.current(), [])
  useEffect(() => {
    if (selIdx >= loadedCount && inc.hasMore) loadMore()
  }, [selIdx, loadedCount, inc.hasMore, loadMore])
  const shown = useMemo(() => filtered.slice(0, shownCount), [filtered, shownCount])

  // Contagem do grupo = total do dia na lista filtrada (não só o que já foi carregado).
  const groupTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of filtered) {
      const k = format(new Date(c.startedAt), 'yyyy-MM-dd')
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [filtered])
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Conversation[] }[] = []
    const now = new Date()
    for (const c of shown) {
      const d = new Date(c.startedAt)
      const key = format(d, 'yyyy-MM-dd')
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(c)
      else out.push({ key, label: dayGroupLabel(d, now), items: [c] })
    }
    return out
  }, [shown])

  // fromList: o botão voltar (telas estreitas) desfaz a navegação em vez de empilhar outra entrada no histórico.
  const select = useCallback((id: string) => navigate(to(id), { state: { fromList: true } }), [navigate, to])
  const backToList = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1)
    else navigate(to(), { replace: true })
  }

  // Colunas: abre a primeira conversa da lista quando nenhuma está selecionada (grava ?id= sem nova entrada no histórico).
  // Mudar a busca/os filtros não troca a conversa aberta (Fonio: busca sem resultado mantém a conversa à direita).
  useEffect(() => {
    if (autoId) navigate(to(autoId), { replace: true })
  }, [autoId, navigate, to])

  // Selecionar marca como lida — só depois que a conversa está na URL (?id=): marcar o candidato automático (autoId)
  // antes disso tirava-o do filtro "Não lido" antes de ele entrar na lista mantida, e a seleção automática passava para a
  // próxima não lida, marcando TODAS como lidas em cascata.
  useEffect(() => {
    if (!ready || !conversationId || !selected?.engineConversation?.loaded || selected.read || readOnly) return
    const key = `${selected.id}:${selected.engineConversation.editor.version}`
    if (readAttempt.current === key) return
    readAttempt.current = key
    void updateConversationEditor(selected, { read: true }).catch(e => toast.error(e instanceof Error ? e.message : 'Não foi possível marcar como lida.'))
  }, [ready, conversationId, selected, readOnly])

  const showList = columns || !conversationId
  const showDetail = columns || !!conversationId

  // Mantém o item selecionado visível na lista — também depois do carregamento simulado (URL direta, recarregar, ?id=)
  // e ao voltar do detalhe em coluna única (restaura a rolagem e revela a última conversa aberta).
  const listMemory = useRef<{ top: number | null; lastId: string | null; first: boolean }>({ top: null, lastId: null, first: true })
  useEffect(() => {
    if (conversationId) listMemory.current.lastId = conversationId
  }, [conversationId])
  useLayoutEffect(() => {
    if (!ready || !showList) return
    const list = listRef.current
    if (!list) return
    const mem = listMemory.current
    if (!conversationId && mem.top != null) list.scrollTop = mem.top
    const id = conversationId ?? mem.lastId
    const el = id ? list.querySelector<HTMLElement>(`[data-conversation-id="${CSS.escape(id)}"]`) : null
    if (el) revealInContainer(list, el, mem.first ? 'center' : 'nearest', GROUP_HEADER_H)
    mem.first = false
  }, [conversationId, ready, showList, listSearch])

  // Rolar até o fim da lista carrega o próximo lote (o observador é recriado a cada lote: se o fim continuar visível,
  // por exemplo numa tela alta, carrega de novo até preencher a área).
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasRemaining = remaining > 0
  useEffect(() => {
    const root = listRef.current
    const el = sentinelRef.current
    if (!ready || !showList || !hasRemaining || !root || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { root, rootMargin: '0px 0px 160px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ready, showList, hasRemaining, shownCount, loadMore])

  // Teclado ↑/↓ (Home/End) move a seleção somente com o foco na lista de conversas (INFERIDO);
  // na transcrição, no painel e nas demais áreas as setas mantêm a rolagem nativa.
  const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
    if (!columns || !ready || !filtered.length) return
    e.preventDefault()
    const idx = filtered.findIndex((c) => c.id === activeId)
    const last = filtered.length - 1
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? last : idx < 0 ? 0 : Math.max(0, Math.min(last, idx + (e.key === 'ArrowDown' ? 1 : -1)))
    if (filtered[next] && filtered[next]!.id !== activeId) navigate(to(filtered[next]!.id), { replace: true })
  }

  // Painel "Detalhes da chamada": fechado por padrão e sobreposto à direita (Fonio ao vivo); a escolha fica salva em
  // ui.inboxDetailsPanel. Esc fecha.
  const detailsOpen = ui.inboxDetailsPanel === 'open'
  const setDetailsOpen = (open: boolean) => setUi({ inboxDetailsPanel: open ? 'open' : 'closed', inbox: { ...useStore.getState().db.ui.inbox, detailsOpen: open } })
  useEffect(() => {
    if (!detailsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="menu"], [role="alertdialog"]')) return
      useStore.getState().setUi({ inboxDetailsPanel: 'closed' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailsOpen])

  const deleteSelected = async () => {
    if (!selected || readOnly || deleting.current) return
    deleting.current = true
    const idx = filtered.findIndex(c => c.id === selected.id), next = filtered[idx + 1] ?? filtered[idx - 1]
    try {
      await deleteConversation(selected)
      toast.success(isChat(selected) ? 'Conversa excluída' : 'Chamada excluída')
      navigate(to(next && columns ? next.id : undefined), { replace: true })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível excluir a conversa.') }
    finally { deleting.current = false }
  }

  const agentInfo = selected ? resolveConversationAgent(selected, agents) : undefined
  const agent = agentInfo?.agent
  const contact = selected ? matchContact(selected, contacts) : undefined
  const contactName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : ''
  // Sobreposto: largura total quando a área é estreita; senão 280px colado à direita, por cima do detalhe.
  const panelFull = shellWidth < 600

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-8 pt-10 sm:px-8 lg:pt-20 print:block print:p-0">
      <style>{PRINT_CSS}</style>
      <div ref={shellRef} data-inbox-layout={columns ? 'columns' : 'single'} className="-mx-4 -mb-8 -mt-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-white sm:-mx-8 lg:-mt-20">
        {ready && all.length === 0 ? (
          <NoConversations />
        ) : (
          <div className="relative flex min-h-0 flex-1">
            {showList && (
              <div className={cn('shrink-0 overflow-hidden print:hidden', !columns && 'w-full')} style={columns ? { width: listWidth } : undefined}>
                <div className="flex h-full flex-col bg-white">
                  <div className="border-b">
                    <div className="flex items-center justify-between px-4 pb-3 pt-4">
                      <h1 className="text-[18px] font-semibold tracking-tight">Conversas</h1>
                    </div>
                    <div
                      className="px-4 pb-3"
                      onFocus={(e) => {
                        if (e.target instanceof HTMLInputElement) searchFocused.current = true
                      }}
                      onBlur={(e) => {
                        if (!(e.target instanceof HTMLInputElement)) return
                        searchFocused.current = false
                        // sem gravação pendente, o campo volta a refletir ?q= (ex.: voltar/avançar enquanto digitava)
                        if (searchTimer.current === undefined) setSearchText(queryRef.current)
                      }}
                    >
                      <SearchFilterBox
                        value={searchText}
                        onChange={onSearchChange}
                        placeholder="Pesquisar chamadas, chats..."
                        filterSlot={<FilterMenu filters={filters} onChange={applyFiltersView} agents={agentOptions} />}
                      />
                    </div>
                    <ActiveFilterChips filters={filters} onChange={applyFiltersView} agents={agentOptions} />
                  </div>
                  <div
                    ref={listRef}
                    role="listbox"
                    aria-label="Conversas"
                    aria-busy={listState === 'loading'}
                    aria-activedescendant={ready && activeId && filtered.some((c) => c.id === activeId) ? `inbox-option-${activeId}` : undefined}
                    tabIndex={0}
                    onKeyDown={onListKeyDown}
                    onScroll={(e) => {
                      listMemory.current.top = e.currentTarget.scrollTop
                    }}
                    className="min-h-0 flex-1 overflow-y-auto pb-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {listState === 'loading' ? (
                      <ListSkeleton />
                    ) : listState === 'error' ? (
                      <LoadError onRetry={load.state === 'error' ? load.retry : search.retry} />
                    ) : filtered.length === 0 ? (
                      // fonio-live2/D-conversas/13: lupa em círculo, "Nenhuma chamada encontrada", dica e rodapé "0 Resultados"
                      <div className="flex h-full flex-col items-center justify-center px-6 text-center" data-testid="inbox-empty-search">
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                          <Search className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-semibold">Nenhuma chamada encontrada</p>
                        <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">Ajuste os filtros ou selecione um período maior.</p>
                      </div>
                    ) : (
                      <>
                      {groups.map((g) => (
                        <div key={g.key} role="group" aria-label={g.label}>
                          <div className="sticky top-0 z-[1] flex items-center gap-2 bg-white px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
                            <span>{g.label}</span>
                            <span className="h-px flex-1 bg-transparent" />
                            <span className="text-[9px] font-medium tabular-nums">{groupTotals.get(g.key) ?? g.items.length}</span>
                          </div>
                          {g.items.map((c) => (
                            <ConversationItem
                              key={c.id}
                              c={c}
                              selected={c.id === activeId}
                              relative={relativeTime}
                              contactName={isChat(c) ? callerName(c, contacts) : undefined}
                              onSelect={() => select(c.id)}
                              onToggleTime={() => setInboxView({ relativeTime: !relativeTime })}
                            />
                          ))}
                        </div>
                      ))}
                      {remaining > 0 && (
                        <div role="presentation" data-testid="inbox-load-more">
                          <div ref={sentinelRef} aria-hidden className="h-px" />
                          <LoadMoreButton onClick={loadMore} remaining={remaining} />
                        </div>
                      )}
                      </>
                    )}
                  </div>
                  {/* coluna única: a lista encosta na borda direita — reserva espaço só para o selo fixo "Demonstração local"
                      (ícone de 28px abaixo de 640px; selo com texto a partir de sm) */}
                  <div className={cn('flex h-10 shrink-0 items-center justify-between border-t bg-muted/30 px-3', !columns && 'pr-12 sm:pr-[176px]')}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11.5px] font-medium tabular-nums">{ready && listState === 'ready' ? filtered.length : '–'}</span>
                      <span className="text-[11.5px] text-muted-foreground">Resultados</span>
                    </div>
                    <button
                      type="button"
                      data-e2e="inbox-export-open"
                      onClick={() => setExportOpen(true)}
                      disabled={!ready}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-white hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Download className="h-3 w-3" /> Exportar
                    </button>
                  </div>
                </div>
              </div>
            )}
            {columns && <ColumnResizer handleProps={resizer.handleProps} width={listWidth} min={resizer.min} max={resizer.max} />}
            {showDetail && !ready ? (
              load.state === 'loading' ? (
                <DetailSkeleton />
              ) : showList ? (
                <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                  <CloudOff className="h-5 w-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">As conversas não foram carregadas.</p>
                </div>
              ) : (
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <LoadError onRetry={load.retry} />
                </div>
              )
            ) : showDetail &&
              (selected ? detailLoad.state === 'loading' ? <DetailSkeleton /> : detailLoad.state === 'error' ? <div className="flex min-w-0 flex-1 flex-col justify-center" data-engine-state="error"><LoadError onRetry={detailLoad.retry} /></div> : (
                <>
                  <ConversationDetail
                    key={selected.id}
                    conversation={selected}
                    tags={tags}
                    detailsOpen={detailsOpen}
                    onToggleDetails={() => setDetailsOpen(!detailsOpen)}
                    onBack={backToList}
                    onDelete={deleteSelected}
                    onManageTags={() => setTagsOpen(true)}
                    agentName={agentInfo?.name}
                    contactLabel={contactName || selected.callerNumber}
                    readOnly={readOnly}
                    compact={!columns}
                    reserveCorner
                  />
                  {detailsOpen && (
                    <DetailsPanel
                      conversation={selected}
                      agent={agent}
                      agentLabel={agentInfo?.name}
                      contact={contact}
                      readOnly={readOnly}
                      onClose={() => setDetailsOpen(false)}
                      className={cn(
                        'absolute bottom-0 right-0 z-30 print:hidden',
                        panelFull ? 'top-0 w-full border-l-0' : 'top-[18px] shadow-[-8px_0_16px_-10px_rgba(0,0,0,0.12)]',
                      )}
                    />
                  )}
                </>
              ) : (
                <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                  {conversationId ? (
                    <>
                      <MessageSquareDashed className="h-6 w-6 text-muted-foreground" />
                      <p className="text-sm font-medium">Conversa não encontrada</p>
                      <p className="max-w-xs text-xs text-muted-foreground">Ela pode ter sido excluída ou pertencer a outra organização.</p>
                      <Button variant="outline" size="xs" className="mt-2" onClick={() => navigate(to(), { replace: true })}>
                        Voltar para Conversas
                      </Button>
                    </>
                  ) : (
                    <>
                      <Search className="h-5 w-5 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Selecione uma conversa para ver o resumo e a transcrição.</p>
                    </>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
      <TagsSheet open={tagsOpen && !readOnly} onOpenChange={setTagsOpen} />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        conversations={sorted}
        initialQuery={query}
        initialFilters={filters}
        agents={agents}
        agentOptions={agentOptions}
        contacts={contacts}
        tags={tags}
        subscriptions={subscriptions}
      />
    </div>
  )
}
