import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDownUp, Ban, Check, ChevronDown, Download, Filter, Plus, Search, Settings2, Sparkles, Trash2, Upload, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Contact } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import { cn } from '@/lib/utils'
import { useCollection, useContactSettings, useCurrentUser, useDB, useStore, useUi } from '@/data/store'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SearchFilterBox } from '@/components/app/misc'
import { PaginationBar, usePagination } from '@/components/app/Pagination'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'
import { ColumnResizer, isTypingTarget, useIsDesktop, useResizableWidth } from '../inbox/shared'
import { ContactForm } from './ContactForm'
import { ContactView } from './ContactView'
import { ContactSettingsSheet } from './ContactSettingsSheet'
import { ImportDialog } from './ImportDialog'
import { ContactQuotaAlert } from './QuotaAlert'
import { exportContacts } from './exportContacts'
import { loadArea, sliceLoaded } from '@/services/casca/data'
import { usePermission } from '@/services/engine/session'
import { saveContact as saveContactRemote, removeContacts, setContactCommunication } from '@/services/casca/contacts'
import {
  EMPTY_CONTACT_FILTERS, SORT_LABEL, SOURCE_LABEL, applyContactView, changedFieldLabels, historyEvent, contactInitials, conversationsOf, countContactFilters, displayName, formatInt, fullName, groupKeyOf, pruneContactFilters, setContactsView, useContactQuota, useContactsView,
  type ContactFilters, type ContactSort,
} from './lib'

/**
 * Largura mínima útil do detalhe: formulário de 440px + respiro, e a barra Cancelar/Salvar (centralizada no detalhe)
 * fica à esquerda do selo fixo "Demonstração local". Abaixo disso a página usa uma coluna, como no celular.
 */
const MIN_DETAIL = 500
const MIN_LIST = 260
/**
 * Paginação da lista de contatos: 20 por página (INFERIDO — a conta Fonio capturada não tinha contatos; o briefing pede 20
 * na falta de referência). Busca, filtros e ordenação voltam à página 1; o contato aberto (link direto, ↑/↓, recém-criado)
 * leva a lista à página dele.
 */
const PAGE_SIZE = 20

/** Entrada do histórico empilhada pela própria página (lista → contato, "+" → novo): voltar usa navigate(-1). */
type NavState = { fromList?: boolean; pushed?: string } | null


function ContactItem({
  c,
  selected,
  onSelect,
  listFields,
  checked,
  selectionMode,
  onCheck,
}: {
  c: Contact
  selected: boolean
  onSelect: () => void
  listFields: { id: string; label: string }[]
  checked: boolean
  selectionMode: boolean
  onCheck: (v: boolean) => void
}) {
  const name = fullName(c)
  const label = displayName(c)
  const sub = [c.phones[0]?.value, c.company || c.emails[0]?.value].filter((v) => v && v !== label).join(' · ')
  const shown = listFields.filter((f) => (c.fields[f.id] ?? '').trim())
  return (
    <div className="px-2.5">
      <div
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        data-contact-id={c.id}
        onClick={onSelect}
        className={cn('group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors', selected ? 'bg-brand/5 ring-1 ring-inset ring-brand/15' : checked ? 'bg-muted/50' : 'hover:bg-muted/40')}
      >
        {/* Avatar ↔ caixa de seleção: no hover (ou com seleção ativa) vira checkbox; tocar no avatar também seleciona (telas de toque). */}
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={`Selecionar ${label}`}
          onClick={(e) => {
            e.stopPropagation()
            onCheck(!checked)
          }}
          className="relative h-8 w-8 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground', selectionMode || checked ? 'invisible' : 'group-hover:invisible')}>
            {contactInitials(c)}
          </span>
          <span className={cn('absolute inset-0 flex items-center justify-center', selectionMode || checked ? 'visible' : 'invisible group-hover:visible')}>
            <span
              data-state={checked ? 'checked' : 'unchecked'}
              className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
            >
              {checked && <Check className="h-4 w-4" />}
            </span>
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate text-[13px] font-medium leading-snug', !name && 'text-muted-foreground')}>{label}</span>
            {c.blocked && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                <Ban className="h-2.5 w-2.5" /> Bloqueado
              </span>
            )}
          </p>
          {sub && <p className="truncate text-[11.5px] text-muted-foreground">{sub}</p>}
          {shown.length > 0 && (
            <p className="mt-0.5 flex flex-wrap gap-1">
              {shown.map((f) => (
                <span key={f.id} title={f.label} className="inline-flex max-w-full items-center gap-1 rounded bg-brand/5 px-1.5 py-0.5 text-[10px] text-brand">
                  <Sparkles className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{c.fields[f.id]}</span>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function FilterPopover({ filters, onChange, companies, members, smartFields }: { filters: ContactFilters; onChange: (f: ContactFilters) => void; companies: string[]; members: { id: string; name: string }[]; smartFields: { id: string; label: string }[] }) {
  const n = countContactFilters(filters)
  const sel = (label: string, value: string, set: (v: string) => void, options: { v: string; l: string }[], all: string) => (
    <div className="space-y-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      <Select value={value || '__all'} onValueChange={(v) => set(v === '__all' ? '' : v)}>
        <SelectTrigger className="h-9" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{all}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.v} value={o.v}>
              {o.l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Filtro" className={cn('relative inline-flex h-full w-9 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted/50 data-[state=open]:bg-muted/50', n > 0 && 'text-brand')}>
          <Filter className="h-3.5 w-3.5" />
          {n > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <p className="text-sm font-semibold">Filtrar contatos</p>
        {sel('Empresa', filters.company, (company) => onChange({ ...filters, company }), [{ v: '__none', l: 'Sem empresa' }, ...companies.map((c) => ({ v: c, l: c }))], 'Todas as empresas')}
        {sel('Responsável', filters.owner, (owner) => onChange({ ...filters, owner }), [{ v: '__none', l: 'Sem responsável' }, ...members.map((m) => ({ v: m.id, l: m.name }))], 'Todos')}
        {sel('Origem', filters.source, (source) => onChange({ ...filters, source: source as ContactFilters['source'] }), (Object.keys(SOURCE_LABEL) as Contact['source'][]).map((s) => ({ v: s, l: SOURCE_LABEL[s] })), 'Todas as origens')}
        {sel('Campo inteligente preenchido', filters.field, (field) => onChange({ ...filters, field }), smartFields.map((f) => ({ v: f.id, l: f.label })), 'Qualquer')}
        {sel('Comunicação', filters.comm, (comm) => onChange({ ...filters, comm: comm as ContactFilters['comm'] }), [{ v: 'blocked', l: 'Bloqueados' }, { v: 'no_whatsapp', l: 'WhatsApp IA desativado' }], 'Todos')}
        <div className="flex justify-end border-t pt-2">
          <Button variant="ghost" size="xs" disabled={n === 0} onClick={() => onChange(EMPTY_CONTACT_FILTERS)}>
            Limpar filtros
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function EmptyScreen({ onImport, onCreate, onSettings }: { onImport: () => void; onCreate: () => void; onSettings: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-8 px-6 pb-16 pt-24">
        <h1 className="text-[30px] font-semibold leading-none tracking-[-0.025em]">Contatos</h1>
        <div className="flex flex-col gap-3">
          <Button variant="brand" className="h-9 w-full gap-2 rounded-md bg-brand text-sm text-white shadow-[0_1px_2px_0_rgb(0_0_0/0.05)] hover:bg-brand/90" onClick={onImport}>
            <Plus className="h-4 w-4" /> Importar contatos
          </Button>
          <Button variant="outline" className="h-9 w-full text-sm shadow-[0_1px_2px_0_rgb(0_0_0/0.05)]" onClick={onCreate}>
            Criar primeiro contato
          </Button>
        </div>
        <p className="text-sm leading-5 text-foreground">Com os campos inteligentes você pode definir informações específicas do cliente que o assistente preenche e mantém atualizadas automaticamente:</p>
        <div>
          <p className="mb-3 px-3 text-xs font-medium text-muted-foreground">Campos inteligentes</p>
          <div className="overflow-hidden rounded-lg border bg-white">
            {[
              ['Preferências pessoais', 'nenhuma conhecida'],
              ['Disponibilidade', 'apenas à noite'],
            ].map(([k, v]) => (
              <div key={k} className="flex h-[52px] items-center gap-4 border-b py-4 pl-5 pr-6">
                <div className="flex flex-1 items-center gap-4 opacity-40">
                  <span className="flex-1 text-sm font-medium">{k}</span>
                  <span className="inline-flex items-center gap-2 text-sm">
                    <Sparkles className="h-3 w-3" /> {v}
                  </span>
                </div>
              </div>
            ))}
            <div className="flex p-2">
              <button type="button" onClick={onSettings} className="flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-brand hover:bg-muted/40">
                <Sparkles className="h-4 w-4" /> Definir campos gerenciados por IA
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ContactsPage() {
  const { contactId } = useParams()
  const [sp, setSp] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const contacts = useCollection('contacts')
  const conversations = useCollection('conversations')
  const memberships = useCollection('memberships')
  const users = useDB((db) => db.users)
  const settings = useContactSettings()
  const ui = useUi()
  const setUi = useStore((s) => s.setUi)
  const view0 = useContactsView()
  const isDesktop = useIsDesktop()
  const quota = useContactQuota(contacts.length)
  const listRef = useRef<HTMLDivElement>(null)
  // Carregamento simulado da página (chave fixa: trocar de contato não recarrega). Painel de demonstração
  // "Simular erro ao carregar a próxima página" → erro + "Tentar novamente".
  const load = usePageLoad('contacts')
  const ready = !load.isLoading && !load.isError
  // Seleção múltipla para exclusão em lote (Central de ajuda › Contatos › Excluir contatos)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)

  /*
   * Sub-estados na URL: ?sheet=settings|import (painéis) e ?edit=1 (edição do contato).
   * Abrir empilha uma entrada no histórico; fechar volta a ela (o "Voltar" do navegador também fecha).
   * Aberto por URL direta (sem entrada empilhada), fechar apenas remove o parâmetro.
   */
  const pushedParam = (location.state as { pushed?: string } | null)?.pushed
  const pushParam = (name: string, value: string) => {
    if (sp.get(name) === value) return
    const n = new URLSearchParams(sp)
    n.set(name, value)
    setSp(n, { state: { pushed: name } })
  }
  const popParam = (name: string) => {
    if (!sp.has(name)) return
    if (pushedParam === name) {
      navigate(-1)
      return
    }
    const n = new URLSearchParams(sp)
    n.delete(name)
    setSp(n, { replace: true })
  }

  const sheet = sp.get('sheet')
  const openSheet = (name: 'settings' | 'import') => pushParam('sheet', name)
  const closeSheet = () => popParam('sheet')

  // Novo contato: forma da Fonio /app/contacts?create=1 (página inline); /app/contacts/new continua aceita.
  const isNew = contactId === 'new' || (!contactId && sp.get('create') === '1')
  const selected = !isNew && contactId ? contacts.find((c) => c.id === contactId) : undefined
  const editing = !!selected && sp.get('edit') === '1'
  const smartFields = settings?.smartFields ?? []
  const currentUser = useCurrentUser()
  const actorName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() || currentUser.email : 'Equipe'
  const members = useMemo(
    () =>
      memberships
        .map((m) => users.find((u) => u.id === m.userId))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() || u.email })),
    [memberships, users],
  )
  const companies = useMemo(() => [...new Set(contacts.map((c) => c.company.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [contacts])
  // Filtros cujo valor não existe mais entre as opções (empresa, membro, campo inteligente) são ignorados e limpos.
  const filterOpts = useMemo(() => ({ companies, memberIds: members.map((m) => m.id), fieldIds: smartFields.map((f) => f.id) }), [companies, members, smartFields])
  const view = useMemo(() => {
    const filters = pruneContactFilters(view0.filters, filterOpts)
    return countContactFilters(filters) === countContactFilters(view0.filters) ? view0 : { ...view0, filters }
  }, [view0, filterOpts])
  useEffect(() => {
    if (view !== view0) setContactsView({ filters: view.filters })
  }, [view, view0])
  const filtered = useMemo(() => applyContactView(contacts, view), [contacts, view])
  const listFields = smartFields.filter((f) => f.showInList)
  const activeFilters = countContactFilters(view.filters)

  // A seleção em lote vale para os resultados da busca/dos filtros atuais (todas as páginas): contatos excluídos ou que
  // saíram do resultado deixam de estar selecionados — "Excluir" nunca atinge um contato que não está na lista.
  useEffect(() => {
    setChecked((prev) => {
      if (!prev.size) return prev
      const ids = new Set(filtered.map((c) => c.id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filtered])

  // Paginação: busca, filtros e ordenação voltam à página 1.
  const viewKey = useMemo(() => JSON.stringify([view.query.trim(), view.filters, view.sort]), [view])
  const pg = usePagination(filtered, PAGE_SIZE, viewKey)
  const { setPage } = pg
  const pageItems = pg.pageItems
  const groupTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of filtered) m.set(groupKeyOf(c), (m.get(groupKeyOf(c)) ?? 0) + 1)
    return m
  }, [filtered])
  const groups = useMemo(() => {
    if (view.sort !== 'name_asc' && view.sort !== 'name_desc') return [{ key: 'all', label: '', items: pageItems }]
    const out: { key: string; label: string; items: Contact[] }[] = []
    for (const c of pageItems) {
      const key = groupKeyOf(c)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(c)
      else out.push({ key, label: key, items: [c] })
    }
    return out
  }, [pageItems, view.sort])
  const pageAllChecked = pageItems.length > 0 && pageItems.every((c) => checked.has(c.id))
  const allChecked = filtered.length > 0 && checked.size >= filtered.length && filtered.every((c) => checked.has(c.id))

  const width0 = ui.contacts?.listWidth ?? 340
  const resizer = useResizableWidth(width0, (listWidth) => setUi({ contacts: { ...useStore.getState().db.ui.contacts, listWidth } }), MIN_LIST, 560)

  /*
   * Duas colunas só quando o detalhe ganha largura útil (MIN_DETAIL). Entre 768px e ~1000px (barra lateral de 260px)
   * a lista encolhe até 260px; se ainda não couber, a página usa uma coluna (lista OU detalhe, com seta voltar).
   */
  const shellRef = useRef<HTMLDivElement>(null)
  const [shellW, setShellW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440))
  useLayoutEffect(() => {
    const el = shellRef.current
    if (!el) return
    setShellW(el.clientWidth)
    const ro = new ResizeObserver(() => setShellW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const split = isDesktop && shellW - 1 - MIN_LIST >= MIN_DETAIL
  const listWidth = split ? Math.max(MIN_LIST, Math.min(resizer.width, shellW - 1 - MIN_DETAIL)) : 0

  // Ao abrir outro contato, entrar/sair da edição ou criar, o detalhe começa do topo (título e "Editar" visíveis).
  const detailRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (detailRef.current) detailRef.current.scrollTop = 0
  }, [contactId, editing])

  // O contato aberto (link direto, ↑/↓, recém-criado/importado) leva a lista à página dele — uma vez por contato:
  // depois disso "Anterior"/"Próxima" e a busca/os filtros mandam na página.
  const followed = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!ready || !contactId || followed.current === contactId) return
    const idx = filtered.findIndex((c) => c.id === contactId)
    if (idx < 0) return
    followed.current = contactId
    setPage(Math.floor(idx / PAGE_SIZE))
  }, [ready, contactId, filtered, setPage])

  // Trocar de página começa do topo da lista; o contato aberto continua visível quando está na página.
  const prevPage = useRef(pg.page)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || !ready) return
    if (prevPage.current !== pg.page) list.scrollTop = 0
    prevPage.current = pg.page
    if (contactId) list.querySelector(`[data-contact-id="${CSS.escape(contactId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [contactId, pg.page, ready])

  // ↑/↓ na lista (quando o foco não está em um campo e não há edição em andamento)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return
      if ((e.target as HTMLElement)?.closest?.('[role="separator"],[data-grip]')) return
      if (!ready || !filtered.length || isNew || editing) return
      e.preventDefault()
      const idx = filtered.findIndex((c) => c.id === contactId)
      const next = idx < 0 ? 0 : Math.max(0, Math.min(filtered.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))
      // substitui a entrada atual mantendo a origem (fromList) para o "voltar"
      navigate(`/app/contacts/${filtered[next]!.id}`, { replace: true, state: location.state })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, filtered, contactId, isNew, editing, navigate, location.state])

  const showEmpty = contacts.length === 0 && !isNew
  // Sem contatos, "Novo contato" ocupa a área toda (fonio-live2/I-contatos/05: formulário centralizado, sem lista lateral).
  const soloNew = contacts.length === 0 && isNew
  const showList = !showEmpty && !soloNew && (split || (!contactId && !isNew))
  const showDetail = !showEmpty && (soloNew || split || !!contactId || isNew)
  const barLeft = split && showList ? `calc(var(--sidebar-offset) + ${listWidth + 1}px)` : isDesktop ? 'var(--sidebar-offset)' : '0px'

  /*
   * Histórico: entradas empilhadas pela página (clique na lista, "+", "Criar primeiro contato") levam `fromList`.
   * Voltar à lista (seta no celular/coluna única, Cancelar no novo, excluir) usa navigate(-1) nesses casos, sem
   * criar entradas duplicadas; aberto por URL direta, substitui a entrada atual.
   */
  const navState = location.state as NavState
  const fromList = !!navState?.fromList
  const openContact = (id: string) => {
    if (id === contactId && !sp.toString()) return // já aberto: não empilha entrada repetida
    navigate(`/app/contacts/${id}`, { state: { fromList: true } })
  }
  const openNew = () => {
    if (isNew) return
    navigate('/app/contacts?create=1', { state: { fromList: true } })
  }
  const backToList = () => {
    if (fromList) navigate(-1)
    else navigate('/app/contacts', { replace: true })
  }
  // "Atividades" do contato: as conversas vêm da área Conversas; carrega uma vez se ainda não foram lidas nesta sessão.
  const canReadConversations = usePermission('conversations:read')
  const conversationsRequested = useRef(false)
  useEffect(() => {
    if (!selected || conversations.length || !canReadConversations || conversationsRequested.current) return
    conversationsRequested.current = true
    // Terminou sem a lista inteira (releitura falhou ou gravações seguidas durante as leituras): tenta de novo ao abrir outro contato.
    void loadArea('conversations').then(() => { if (!sliceLoaded('conversations')) conversationsRequested.current = false }, () => { conversationsRequested.current = false })
  }, [selected, conversations.length, canReadConversations])
  const fromId = sp.get('from') ?? undefined
  const fromConversation = fromId ? conversations.find((c) => c.id === fromId) : undefined

  const saveContact = async (data: Parameters<React.ComponentProps<typeof ContactForm>['onSave']>[0]) => {
    if (isNew) {
      if (quota.reached) return
      const c = await saveContactRemote(data, undefined, fromConversation?.id ?? fromId)
      toast.success('Contato criado', { description: displayName(c) })
      navigate(`/app/contacts/${c.id}`, { replace: true, state: fromList ? { fromList: true } : null })
    } else if (selected) {
      const c = await saveContactRemote(data, selected.id)
      toast.success('Contato salvo', { description: displayName(c) })
      popParam('edit')
    }
  }

  const patchContact = (p: Partial<Contact>, message: string) => {
    if (!selected) return
    const patch = { ...(p.blocked !== undefined ? { blocked: p.blocked } : {}), ...(p.whatsappAi !== undefined ? { whatsappAi: p.whatsappAi } : {}) }
    if (!Object.keys(patch).length) return
    setContactCommunication(selected.id, patch).then(() => toast.success(message), (e) => toast.error('Não foi possível salvar', { description: e instanceof Error ? e.message : undefined }))
  }

  const deleteContact = async () => {
    if (!selected) return
    const id = selected.id
    await removeContacts([id])
    toast.success('Contato excluído', { description: displayName(selected) })
    backToList()
  }

  // Quantidade congelada ao abrir a confirmação: o título não muda enquanto o diálogo fecha.
  const [bulkCount, setBulkCount] = useState(0)
  const bulkDelete = async () => {
    const ids = new Set(checked)
    await removeContacts([...ids])
    toast.success(`${formatInt(ids.size)} ${ids.size === 1 ? 'contato excluído' : 'contatos excluídos'}`)
    setChecked(new Set())
    if (contactId && ids.has(contactId)) navigate('/app/contacts', { replace: true })
  }

  const topActions = (
    <div className={cn('fixed right-5 top-5 z-40 flex items-center gap-3 print:hidden max-md:right-3 max-md:top-[66px] max-md:gap-1', ((!split && (contactId || isNew)) || soloNew || !ready) && 'hidden')}>
      {/* fonio-live/app-contacts_half.jpg: "Configurações" e "Importar" ficam encostados (só o padding px-3 entre eles);
          o gap-3 separa o par do botão "+". */}
      <div className="flex items-center">
        <Button variant="ghost" className="h-8 gap-2 px-3 text-xs max-sm:px-2" onClick={() => openSheet('settings')} aria-label="Configurações">
          <Settings2 className="h-4 w-4" /> <span className="max-sm:sr-only">Configurações</span>
        </Button>
        <Button variant="ghost" className="h-8 gap-2 px-3 text-xs max-sm:px-2" onClick={() => openSheet('import')} aria-label="Importar">
          <Download className="h-4 w-4" /> <span className="max-sm:sr-only">Importar</span>
        </Button>
        {contacts.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 gap-2 px-3 text-xs max-sm:px-2" aria-label="Exportar">
                <Upload className="h-4 w-4" /> <span className="max-sm:sr-only">Exportar</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {activeFilters || view.query.trim() ? `Exportar ${formatInt(filtered.length)} contatos da busca/dos filtros` : `Exportar todos os ${formatInt(contacts.length)} contatos`}
              </DropdownMenuLabel>
              <DropdownMenuItem className="text-sm" disabled={!filtered.length} onSelect={() => toast.success(`${formatInt(exportContacts('csv', filtered, smartFields, members))} contatos exportados (CSV)`)}>
                CSV (.csv)
              </DropdownMenuItem>
              <DropdownMenuItem className="text-sm" disabled={!filtered.length} onSelect={() => toast.success(`${formatInt(exportContacts('xlsx', filtered, smartFields, members))} contatos exportados (Excel)`)}>
                Excel (.xlsx)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <button type="button" aria-label="Novo" onClick={openNew} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-background hover:bg-foreground/90">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-8 pt-10 sm:px-8 lg:pt-20">
      <div ref={shellRef} className="relative -mx-4 -mb-8 -mt-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-white sm:-mx-8 lg:-mt-20">
        {topActions}
        {load.isLoading ? (
          <div className="min-h-0 flex-1 overflow-hidden px-6 pt-6 md:pt-[26px]" data-testid="contacts-loading">
            <PageSkeleton rows={8} className="max-w-[440px]" />
            <span className="sr-only">Carregando contatos…</span>
          </div>
        ) : load.isError ? (
          <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 pt-16 md:pt-24">
            <PageLoadError onRetry={load.retry} title="Não foi possível carregar os contatos" description="Nenhum contato foi perdido. Tente novamente." />
          </div>
        ) : showEmpty ? (
          <EmptyScreen onImport={() => openSheet('import')} onCreate={openNew} onSettings={() => openSheet('settings')} />
        ) : (
          <div className="relative flex min-h-0 flex-1">
            {showList && (
              <div className={cn('flex shrink-0 flex-col overflow-hidden bg-white', !split && 'w-full')} style={split ? { width: listWidth } : undefined}>
                {/* coluna única (≥768px): reserva a faixa das ações fixas (Configurações / Importar / +) à direita do cabeçalho */}
                <div className={cn('flex h-[76px] shrink-0 items-center justify-between gap-2 px-6 max-md:pr-[190px]', !split && 'md:pr-[430px]')}>
                  <h1 className="min-w-0 truncate text-base font-semibold leading-none">Contatos</h1>
                  <span className="shrink-0 py-0.5 text-xs leading-none text-muted-foreground" aria-label="Total de contatos">
                    {activeFilters || view.query.trim() ? `${formatInt(filtered.length)} de ${formatInt(contacts.length)}` : formatInt(contacts.length)}
                  </span>
                </div>
                {/* captura app-10: busca "px-4 pb-3 pt-[50px]" (alinha com o título do detalhe, pt-[90px] + pt-8) */}
                <div className="px-4 pb-3 md:pt-[50px]">
                  <SearchFilterBox
                    focusStyle="primary"
                    value={view.query}
                    onChange={(query) => setContactsView({ query })}
                    placeholder="Buscar por nome, telefone ou e-mail…"
                    filterSlot={<FilterPopover filters={view.filters} onChange={(filters) => setContactsView({ filters })} companies={companies} members={members} smartFields={smartFields} />}
                  />
                </div>
                {contacts.length > 0 &&
                  (checked.size > 0 ? (
                    <div className="mx-4 mb-2 flex h-7 items-center justify-between gap-2 rounded-md bg-muted/60 pl-2 pr-1" role="toolbar" aria-label="Ações em lote">
                      <span className="min-w-0 truncate text-[11.5px] font-medium tabular-nums" data-testid="contacts-selected-count" title={`${formatInt(checked.size)} de ${formatInt(filtered.length)} resultados selecionados (todas as páginas)`}>
                        {allChecked && pg.pageCount > 1
                          ? `Todos os ${formatInt(checked.size)} selecionados`
                          : `${formatInt(checked.size)} de ${formatInt(filtered.length)} ${checked.size === 1 ? 'selecionado' : 'selecionados'}`}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        {/* A seleção vale para os resultados da busca/dos filtros (todas as páginas); o menu deixa explícito o alcance. */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-white hover:text-foreground data-[state=open]:bg-white" aria-label="Selecionar">
                              Selecionar <ChevronDown className="h-3 w-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Selecionar contatos</DropdownMenuLabel>
                            <DropdownMenuItem
                              className="text-sm"
                              disabled={pageAllChecked}
                              onSelect={() => setChecked((prev) => new Set([...prev, ...pageItems.map((c) => c.id)]))}
                            >
                              <span className="flex-1">{pg.pageCount > 1 ? `Todos desta página (${formatInt(pageItems.length)})` : `Todos da lista (${formatInt(pageItems.length)})`}</span>
                              {pageAllChecked && <Check className="text-brand" />}
                            </DropdownMenuItem>
                            {pg.pageCount > 1 && (
                              <DropdownMenuItem className="text-sm" disabled={allChecked} onSelect={() => setChecked(new Set(filtered.map((c) => c.id)))}>
                                <span className="flex-1">
                                  Todos os resultados ({formatInt(filtered.length)})
                                  <span className="block text-[11px] text-muted-foreground">{activeFilters || view.query.trim() ? 'Da busca e dos filtros, em todas as páginas' : 'Em todas as páginas'}</span>
                                </span>
                                {allChecked && <Check className="text-brand" />}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <button
                          type="button"
                          onClick={() => {
                            setBulkCount(checked.size)
                            setConfirmBulk(true)
                          }}
                          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50">
                          <Trash2 className="h-3 w-3" /> Excluir
                        </button>
                        <button type="button" aria-label="Limpar seleção" onClick={() => setChecked(new Set())} className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-white">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 px-4 pb-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-muted/50 hover:text-foreground" aria-label="Ordenar">
                            <ArrowDownUp className="h-3 w-3" /> {SORT_LABEL[view.sort]}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                          {(Object.keys(SORT_LABEL) as ContactSort[]).map((s) => (
                            <DropdownMenuItem key={s} onSelect={() => setContactsView({ sort: s })} className="text-sm">
                              <span className="flex-1">{SORT_LABEL[s]}</span>
                              {view.sort === s && <Check className="text-brand" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {activeFilters > 0 && (
                        <button type="button" onClick={() => setContactsView({ filters: EMPTY_CONTACT_FILTERS })} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px]" aria-label="Limpar filtros">
                          {activeFilters} {activeFilters === 1 ? 'filtro' : 'filtros'} <X className="h-3 w-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  ))}
                <div ref={listRef} role="listbox" aria-label="Contatos" className={cn('min-h-0 flex-1 overflow-y-auto', contacts.length === 0 ? 'flex flex-col' : pg.pageCount > 1 ? 'pb-4' : 'pb-24')}>
                  {contacts.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Search className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="max-w-[260px] text-xs text-muted-foreground">Nenhum contato ainda. Adicione um para começar.</p>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-center">
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Search className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="max-w-[260px] text-xs text-muted-foreground">Nenhum contato encontrado para a busca ou os filtros atuais.</p>
                      <Button variant="outline" size="xs" className="mt-3" onClick={() => setContactsView({ query: '', filters: EMPTY_CONTACT_FILTERS })}>
                        Limpar busca e filtros
                      </Button>
                    </div>
                  ) : (
                    groups.map((g) => (
                      <div key={g.key} role="group" aria-label={g.label || 'Contatos'}>
                        {g.label && (
                          <div className="sticky top-0 z-[1] flex items-center gap-2 bg-white px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
                            <span>{g.label}</span>
                            <span className="h-px flex-1 bg-transparent" />
                            <span className="text-[9px] font-medium tabular-nums">{formatInt(groupTotals.get(g.key) ?? g.items.length)}</span>
                          </div>
                        )}
                        {g.items.map((c) => (
                          <ContactItem
                            key={c.id}
                            c={c}
                            selected={c.id === contactId}
                            listFields={listFields}
                            onSelect={() => openContact(c.id)}
                            checked={checked.has(c.id)}
                            selectionMode={checked.size > 0}
                            onCheck={(v) =>
                              setChecked((prev) => {
                                const next = new Set(prev)
                                if (v) next.add(c.id)
                                else next.delete(c.id)
                                return next
                              })
                            }
                          />
                        ))}
                      </div>
                    ))
                  )}
                </div>
                {/* coluna única: reserva o espaço do selo fixo "Demonstração local" à direita (como o rodapé de Conversas) */}
                <PaginationBar
                  {...pg}
                  className={cn(
                    'shrink-0 flex-wrap gap-x-2 gap-y-1 border-t bg-white px-3 py-2 text-xs [&>div>span]:hidden [&_button]:h-7 [&_button]:px-1.5 [&_button]:text-xs',
                    !split && 'pr-12 sm:pr-[176px]',
                  )}
                />
              </div>
            )}
            {split && showList && <ColumnResizer handleProps={resizer.handleProps} width={listWidth} min={resizer.min} max={resizer.max} />}
            {showDetail && (
              // faixa superior (76px) reservada às ações fixas: o conteúdo rola abaixo dela, sem passar sob os botões
              <div className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col', split && !soloNew ? 'pt-[76px]' : 'pt-0')}>
                <div ref={detailRef} data-testid="contact-detail-scroll" className={cn('min-h-0 flex-1 overflow-y-auto', soloNew ? 'pt-0' : split ? 'pt-[14px]' : 'pt-4 md:pt-10')}>
                  {/* soloNew: título "Novo contato" a 137px do topo, como a captura 05 (pt-24 da página vazia + respiro) */}
                  <div className={cn('px-8 pb-28 pt-8 max-md:px-4 max-md:pt-2', soloNew ? 'md:pt-[122px]' : !split && 'md:pt-2')}>
                    {isNew || editing ? (
                      <ContactForm
                        key={contactId}
                        contact={selected}
                        prefillPhone={isNew ? sp.get('phone') ?? undefined : undefined}
                        fromConversation={isNew ? fromConversation : undefined}
                        contacts={contacts}
                        members={members}
                        smartFields={smartFields}
                        barLeft={barLeft}
                        restriction={isNew && quota.reached ? <ContactQuotaAlert quota={quota} /> : undefined}
                        onSave={saveContact}
                        showBack={!split && !soloNew}
                        onCancel={() => {
                          if (!isNew) popParam('edit')
                          else if (fromList) navigate(-1)
                          else navigate(fromConversation ? `/app/inbox?id=${encodeURIComponent(fromConversation.id)}` : '/app/contacts', { replace: true })
                        }}
                        onBack={() => (isNew ? backToList() : popParam('edit'))}
                        onOpenSettings={() => openSheet('settings')}
                      />
                    ) : selected ? (
                      <ContactView
                        key={contactId}
                        contact={selected}
                        members={members}
                        smartFields={smartFields}
                        conversations={conversationsOf(selected, conversations)}
                        onEdit={() => pushParam('edit', '1')}
                        onDelete={deleteContact}
                        showBack={!split}
                        onBack={backToList}
                        onPatch={patchContact}
                        onOpenSettings={() => openSheet('settings')}
                        barLeft={barLeft}
                      />
                    ) : contactId ? (
                      <div className="mx-auto flex max-w-[440px] flex-col items-center gap-2 py-16 text-center">
                        <UserRound className="h-6 w-6 text-muted-foreground" />
                        <p className="text-sm font-medium">Contato não encontrado</p>
                        <p className="text-xs text-muted-foreground">Ele pode ter sido excluído.</p>
                        <Button variant="outline" size="xs" className="mt-2" onClick={() => navigate('/app/contacts', { replace: true })}>
                          Voltar para Contatos
                        </Button>
                      </div>
                    ) : (
                      <div className="mx-auto flex max-w-[440px] flex-col items-center gap-2 py-16 text-center">
                        <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                          <UserRound className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium">Selecione um contato</p>
                        <p className="max-w-[280px] text-xs text-muted-foreground">Escolha um contato na lista para ver e editar os detalhes, ou crie um novo.</p>
                        <Button variant="outline" size="xs" className="mt-2 gap-1" onClick={openNew}>
                          <Plus className="h-3.5 w-3.5" /> Novo contato
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <ContactSettingsSheet open={ready && sheet === 'settings'} onOpenChange={(o) => (o ? openSheet('settings') : closeSheet())} />
      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Excluir ${formatInt(bulkCount)} ${bulkCount === 1 ? 'contato' : 'contatos'}?`}
        description="Os contatos selecionados serão removidos permanentemente. As conversas continuam em Conversas, sem correspondência de contato."
        confirmLabel="Excluir"
        onConfirm={bulkDelete}
      />
      <ImportDialog open={ready && sheet === 'import'} onOpenChange={(o) => (o ? openSheet('import') : closeSheet())} contacts={contacts} smartFields={smartFields} quota={quota} />
    </div>
  )
}
