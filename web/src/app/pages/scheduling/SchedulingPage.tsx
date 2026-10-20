import { forwardRef, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, Navigate, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CalendarCheck2, CalendarPlus, Check, ChevronsUpDown, CirclePause, CirclePlay, CirclePlus, Copy, Ellipsis, ExternalLink, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { EventType } from '@/domain/types'
import '@/domain/ext/mais-a'
import '@/domain/ext/scheduling'
import { cn } from '@/lib/utils'
import { useCollection, useCurrentOrg, useStore, useUi } from '@/data/store'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { ActionBar, DarkBarPrimary } from '@/components/app/ActionBar'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { EmptyState } from '@/components/app/misc'
import { SectionHeading } from '@/components/app/Page'
import { ConnectCalendarDialog, CreateEventTypeDialog } from './SchedulingDialogs'
import { AdvancedTab, AgentsTab, AvailabilityTab, DataCollectionTab, GeneralTab, type Draft, type Errors } from './EventTypeTabs'
import { NotificationPrefs, NotificationsTab, notificationErrors } from './NotificationsTab'
import { BookingsSheet } from './BookingsSheet'
import { TABS, uniqueSlug, type TabSlug } from './slots'
import { deleteEvent, duplicateEvent, e164, eventPublicPath, saveEvent, useSchedulingCalendars } from '@/services/casca/scheduling'
import { bindEventToAgent } from '@/services/casca/scheduling-actions'
import { LOCATION_KIND_ICON, LOCATION_KIND_LABEL, locationKindOf, normalizeEventType, withLegacyFields } from './model'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'

const MENU_BTN =
  'peer/menu-button flex w-full items-center overflow-hidden rounded-md p-2 text-left outline-none ring-ring transition-[width,height,padding] focus-visible:ring-2 active:bg-accent active:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-accent data-[active=true]:font-medium data-[active=true]:text-accent-foreground hover:bg-accent hover:text-accent-foreground'

const EDITABLE: (keyof EventType)[] = [
  'name', 'slug', 'durationMin', 'description', 'calendarId', 'locationKind', 'locationAddress', 'locationPhone', 'staticInvitees', 'conflictCalendarIds',
  'availability', 'bufferMin', 'minNoticeHours', 'maxDaysAhead', 'notifications', 'templates', 'reminders', 'dataCollection', 'webPhone',
  'agentIds', 'advanced', 'active', 'timezone', 'confirmationMessage', 'hideFromCompanyPage', 'hostDisplayName', 'webhooks',
]
const norm = (v: unknown) => JSON.stringify(v ?? null)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** Conta alterações por campo (dias da disponibilidade, campos da coleta e chaves de notificações/avançado contam individualmente). */
function diffCount(a: unknown, b: unknown): number {
  if (norm(a) === norm(b)) return 0
  if (Array.isArray(a) && Array.isArray(b)) {
    const byId = (arr: unknown[]) => new Map(arr.map((x, i) => [isObj(x) && typeof x.id === 'string' ? x.id : isObj(x) && typeof x.day === 'number' ? `d${x.day}` : String(i), x]))
    const ma = byId(a)
    const mb = byId(b)
    let n = 0
    for (const k of new Set([...ma.keys(), ...mb.keys()])) if (norm(ma.get(k)) !== norm(mb.get(k))) n++
    return Math.max(1, n)
  }
  if (isObj(a) && isObj(b)) return Math.max(1, [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => norm(a[k]) !== norm(b[k])).length)
  return 1
}
const countChanges = (a: EventType, b: EventType) => EDITABLE.reduce((n, k) => n + diffCount(a[k], b[k]), 0)

function validate(d: Draft, all: EventType[]): Errors {
  const e: Errors = {}
  if (d.name.trim().length < 2) e.name = 'O título deve ter pelo menos 2 caracteres.'
  if (!Number.isFinite(d.durationMin) || d.durationMin < 5 || d.durationMin > 720) e.durationMin = 'Informe uma duração entre 5 e 720 minutos.'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)) e.slug = 'Use apenas letras minúsculas sem acento, números e hífens.'
  else if (all.some((o) => o.id !== d.id && o.slug === d.slug)) e.slug = 'Este endereço já é usado por outro tipo de evento.'
  d.availability.forEach((a) => {
    if (a.enabled && (!a.from || !a.to || a.from >= a.to)) e.availability = 'O horário final deve ser depois do inicial.'
  })
  if (!d.availability.some((a) => a.enabled)) e.availability = 'Ative pelo menos um dia da semana.'
  if ((d.hostDisplayName ?? '').trim().length > 60) e.hostDisplayName = 'Use no máximo 60 caracteres.'
  if (d.locationKind === 'phone' && (d.locationPhone ?? '').trim() && !e164(d.locationPhone)) e.locationPhone = 'Informe o telefone com DDI e DDD, ex.: +55 11 3000-0000.'
  if ((d.webhooks ?? []).some((w) => !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(w.url))) e.webhooks = 'Revise as URLs dos webhooks (https).'
  Object.assign(e, notificationErrors(d))
  const seen = new Set<string>()
  d.dataCollection.forEach((f) => {
    const l = f.label.trim().toLowerCase()
    if (!l) e[`dc-${f.id}`] = 'Dê um nome ao campo.'
    else if (seen.has(l)) e[`dc-${f.id}`] = 'Já existe um campo com este nome.'
    seen.add(l)
  })
  return e
}
const tabOfError = (key: string): TabSlug =>
  key === 'name' || key === 'slug' || key === 'durationMin' || key === 'locationPhone'
    ? 'general'
    : key === 'availability'
      ? 'availability'
      : key.startsWith('dc-')
        ? 'data-collection'
        : key.startsWith('tpl-') || key.startsWith('rem-') || key.startsWith('sender-')
          ? 'notifications'
          : 'advanced'

/* --------------------------------- Moldura --------------------------------- */

/**
 * Seletor de tipo de evento (OBSERVADO: fonio-live2/G-agendador/02 + dump): gatilho "Selecione um tipo de evento" +
 * chevrons-up-down; Popover com busca "Pesquisar tipos de evento…", lista, vazio "Nenhum tipo de evento encontrado" e
 * rodapé "⊕ Adicionar novo evento" (text-brand). Habilitado também sem tipos de evento.
 */
function Switcher({ current, eventTypes, onCreate, className }: { current?: EventType; eventTypes: EventType[]; onCreate?: () => void; className?: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent',
            className,
          )}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-4">{current?.name ?? 'Selecione um tipo de evento'}</span>
            {current && <SwitcherSubtitle et={current} />}
          </span>
          <ChevronsUpDown className="size-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[350px] max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar tipos de evento…" />
          <CommandList>
            <CommandEmpty className="py-7 text-center text-sm">Nenhum tipo de evento encontrado</CommandEmpty>
            {eventTypes.length > 0 && (
              <CommandGroup>
                {eventTypes.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`${e.name} ${e.id}`}
                    onSelect={() => {
                      setOpen(false)
                      if (e.id !== current?.id) navigate(`/app/scheduling/${e.id}/general`)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    <span className="text-xs text-muted-foreground">{e.durationMin} min</span>
                    <Check className={cn('text-brand', e.id === current?.id ? 'opacity-100' : 'opacity-0')} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="border-t px-1 py-[3px]">
            <button
              type="button"
              disabled={!onCreate}
              onClick={() => {
                setOpen(false)
                onCreate?.()
              }}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm text-sm text-brand hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <CirclePlus className="size-4" />
              Adicionar novo evento
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** "▢ Reunião online | 30 min" (AP-01/AP-03: ícone do local + rótulo + duração). */
function SwitcherSubtitle({ et }: { et: EventType }) {
  const k = locationKindOf(et)
  const Icon = LOCATION_KIND_ICON[k]
  return (
    <span className="mt-1 flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground" data-testid="switcher-subtitle">
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{LOCATION_KIND_LABEL[k]}</span>
      <span className="text-muted-foreground/50">|</span>
      <span className="shrink-0">{et.durationMin} min</span>
    </span>
  )
}

function Shell({ current, tab, eventTypes, onCreate, children }: { current?: EventType; tab?: TabSlug; eventTypes: EventType[]; onCreate?: () => void; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-0 flex-1">
      <SchedulingBarOffset />
      <aside className="hidden lg:flex w-[260px] shrink-0 flex-col overflow-visible border-r bg-background">
        <div className="flex h-full flex-col">
          <div className="flex h-[68px] shrink-0 items-start px-3 pt-4">
            <div className="flex w-full min-w-0 items-center gap-1">
              <Switcher current={current} eventTypes={eventTypes} onCreate={onCreate} />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <nav aria-label="Navegação do agendador">
              <ul className="flex w-full min-w-0 flex-col gap-1 shrink-0 px-3 pt-14">
                {TABS.map((t) => (
                  <li key={t.slug}>
                    <Link
                      to={current ? `/app/scheduling/${current.id}/${t.slug}` : '#'}
                      aria-disabled={!current || undefined}
                      tabIndex={current ? undefined : -1}
                      data-active={current && tab === t.slug}
                      className={cn(MENU_BTN, 'text-sm h-10 justify-between rounded-lg px-4', !current && 'pointer-events-none text-muted-foreground')}
                    >
                      <span className="truncate text-sm">{t.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="px-4 pt-6 sm:px-8 lg:hidden">
          <div className="mb-2 flex items-center gap-1">
            <Switcher current={current} eventTypes={eventTypes} onCreate={onCreate} className="max-w-xs" />
          </div>
          <div className="-mx-4 overflow-x-auto px-4 no-scrollbar">
            <Tabs value={tab ?? ''} onValueChange={(v) => current && navigate(`/app/scheduling/${current.id}/${v}`)}>
              <TabsList aria-label="Navegação do agendador" className="w-max">
                {TABS.map((t) => (
                  <TabsTrigger key={t.slug} value={t.slug} disabled={!current} className="gap-2">
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ------------------------------ Barra escura ------------------------------ */

/**
 * Na Fonio a barra escura do Agendador fica centralizada na área à direita da coluna do agendador
 * (captura ao vivo 1512px: centro em x≈1016 = (260+260+1512)/2). O ActionBar compartilhado centraliza a partir de
 * --sidebar-offset; com a coluna visível (lg+) o deslocamento soma os 260px dela.
 */
function SchedulingBarOffset() {
  const collapsed = useUi().sidebarCollapsed
  const base = collapsed ? 62 : 260
  return <style>{`@media (min-width: 1024px) { :root { --sidebar-offset: ${base + 260}px !important; } }`}</style>
}

/** Mesmo visual de DarkBarButton, com forwardRef (necessário como gatilho de menu). */
const DarkTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(({ className, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn('inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-xl px-3 text-sm font-medium leading-5 text-slate-100 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-white/10', className)}
    {...props}
  >
    {children}
  </button>
))
DarkTrigger.displayName = 'DarkTrigger'

function DarkBar({ et, onAdd }: { et?: EventType; onAdd: (agentId: string) => void }) {
  const agents = useCollection('agents')
  const org = useCurrentOrg()
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!et}>
          <DarkTrigger aria-label="Adicionar ao agente" title={et ? undefined : 'Crie um tipo de evento para adicioná-lo a um assistente'}>
            <CirclePlus className="h-4 w-4 text-slate-300" />
            <span>Adicionar ao agente</span>
          </DarkTrigger>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          <DropdownMenuLabel>Adicionar a um assistente</DropdownMenuLabel>
          {agents.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Nenhum assistente</div>}
          {agents.map((a) => {
            const added = !!et?.agentIds.includes(a.id)
            return (
              <DropdownMenuItem key={a.id} disabled={added} onSelect={() => onAdd(a.id)}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand">{a.name[0]}</span>
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                {added && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="size-3.5" /> Adicionado
                  </span>
                )}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Fonio: ícone external-link à esquerda e cor da marca cheia mesmo sem tipo de evento (link desabilitado não esmaece) */}
      <DarkBarPrimary disabled={!et || !eventPublicPath(et)} title={!et ? 'Crie um tipo de evento para ter uma página de reserva' : !eventPublicPath(et) ? 'A página é publicada quando o tipo de evento está ativo' : undefined} className="disabled:bg-brand" onClick={() => et && eventPublicPath(et) && window.open(eventPublicPath(et)!, '_blank', 'noopener')}>
        <ExternalLink className="h-4 w-4" />
        <span>Abrir página de reserva</span>
      </DarkBarPrimary>
    </>
  )
}

/* ------------------------- Alterações não salvas ------------------------- */

/** Mesmo diálogo do editor de Assistentes (AgentPage): continuar editando, descartar ou salvar antes de sair. */
function UnsavedChangesDialog({
  open,
  changes,
  name,
  description,
  discardLabel = 'Descartar e sair',
  saveLabel = 'Salvar e sair',
  onCancel,
  onDiscard,
  onSave,
}: {
  open: boolean
  changes: number
  name: string
  description?: string
  discardLabel?: string
  saveLabel?: string
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader className="gap-y-2">
          <DialogTitle>Descartar alterações?</DialogTitle>
          <DialogDescription>
            Você tem {changes} {changes === 1 ? 'alteração não salva' : 'alterações não salvas'} em {name}. {description ?? 'Se sair agora, elas serão perdidas.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="secondary" onClick={onCancel}>
            Continuar editando
          </Button>
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={onDiscard}>
            {discardLabel}
          </Button>
          <Button onClick={onSave}>{saveLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------- Editor --------------------------------- */

function Editor({ et: stored, tab, eventTypes, onCreate }: { et: EventType; tab: TabSlug; eventTypes: EventType[]; onCreate: () => void }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const agents = useCollection('agents')
  const org = useCurrentOrg()
  const calendars = useSchedulingCalendars()
  // Vínculos também podem ser criados pelo painel "Agendar compromissos" do assistente: união com as ações dos agentes.
  // Campos observados (AP-01…AP-08) preenchidos/migrados por normalizeEventType — sem "alterações" fantasmas ao abrir.
  const et = useMemo<EventType>(() => normalizeEventType(stored, org?.name), [stored, org?.name])
  const [draft, setDraftState] = useState<Draft>(et)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [duplicateGuard, setDuplicateGuard] = useState(false)
  const [addCalendar, setAddCalendar] = useState(false)
  const changes = countChanges(draft, et)
  const errors = useMemo(() => (showErrors ? validate(draft, eventTypes) : {}), [showErrors, draft, eventTypes])
  const bookingsOpen = params.get('agendamentos') === '1'
  const setBookingsOpen = (o: boolean) => {
    const next = new URLSearchParams(params)
    if (o) next.set('agendamentos', '1')
    else next.delete('agendamentos')
    setParams(next)
  }

  const set = (fn: (d: Draft) => Draft) => setDraftState(fn)

  // Confirmação ao sair com alterações não salvas (trocar de aba do mesmo tipo de evento mantém o rascunho).
  const skipBlock = useRef(false)
  const blocker = useBlocker(({ nextLocation }) => !skipBlock.current && changes > 0 && nextLocation.pathname.split('/')[3] !== et.id)
  useEffect(() => {
    if (!changes) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [changes])

  async function save(): Promise<boolean> {
    if (saving) return false
    const errs = validate(draft, eventTypes)
    if (Object.keys(errs).length) {
      setShowErrors(true)
      const first = Object.keys(errs)[0]!
      const target = tabOfError(first)
      if (target !== tab) navigate(`/app/scheduling/${et.id}/${target}`)
      toast.error('Corrija os campos destacados antes de salvar.')
      return false
    }
    setSaving(true)
    const next: Draft = {
      ...draft,
      name: draft.name.trim(),
      locationAddress: (draft.locationAddress ?? '').trim(),
      hostDisplayName: (draft.hostDisplayName ?? '').trim(),
      dataCollection: draft.dataCollection.map((f) => ({ ...f, label: f.label.trim() })),
      templates: draft.templates && { ...draft.templates, emailSenderName: draft.templates.emailSenderName.trim() },
    }
    try {
      const saved = await saveEvent(withLegacyFields(next))
      setDraftState(saved); setShowErrors(false)
      toast.success('Alterações salvas')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.')
      return false
    } finally { setSaving(false) }
  }

  async function addToAgent(agentId: string) {
    if (saving) return
    setSaving(true)
    try {
      const saved = await bindEventToAgent(et, agentId, true)
      setDraftState(d => ({ ...d, agentIds: saved.agentIds, engineEvent: saved.engineEvent }))
      toast.success('Agendamento vinculado ao assistente')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível vincular.') }
    finally { setSaving(false) }
  }
  async function removeFromAgent(agentId: string) {
    if (saving) return
    setSaving(true)
    try {
      const saved = await bindEventToAgent(et, agentId, false)
      setDraftState(d => ({ ...d, agentIds: saved.agentIds, engineEvent: saved.engineEvent }))
      toast.success('Agendamento desvinculado do assistente')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível desvincular.') }
    finally { setSaving(false) }
  }
  async function duplicate(force = false) {
    if (saving) return
    if (changes > 0 && !force) { setDuplicateGuard(true); return }
    setSaving(true)
    try {
      const latest = useStore.getState().db.eventTypes.find(e => e.id === et.id) ?? et
      const copy = await duplicateEvent(latest, uniqueSlug(`${latest.slug}-copia`, useStore.getState().db.eventTypes.map(e => e.slug)))
      toast.success('Tipo de evento duplicado'); skipBlock.current = true
      navigate(`/app/scheduling/${copy.id}/general`)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível duplicar.') }
    finally { setSaving(false) }
  }
  async function remove() {
    await deleteEvent(et)
    toast.success('Tipo de evento excluído', { description: et.name })
    skipBlock.current = true; navigate('/app/scheduling', { replace: true })
  }

  const label = TABS.find((t) => t.slug === tab)!.label
  const calMissing = !calendars.some((c) => c.id === draft.calendarId)
  const url = eventPublicPath(et)
  const paused = draft.active === false

  const generalMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Mais ações">
          <Ellipsis className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={() => setBookingsOpen(true)}>
          <CalendarCheck2 className="text-muted-foreground" />
          Ver agendamentos
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!url} onSelect={() => url && window.open(url, '_blank', 'noopener')}>
          <ExternalLink className="text-muted-foreground" />
          Abrir página de reserva
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => set((d) => ({ ...d, active: d.active === false }))}>
          {paused ? <CirclePlay className="text-muted-foreground" /> : <CirclePause className="text-muted-foreground" />}
          {paused ? 'Retomar novos agendamentos' : 'Pausar novos agendamentos'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => duplicate()}>
          <Copy className="text-muted-foreground" />
          Duplicar tipo de evento
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(true)}>
          <Trash2 />
          Excluir tipo de evento
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <Shell current={et} tab={tab} eventTypes={eventTypes} onCreate={onCreate}>
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8 grow w-full max-w-[764px] mx-auto">
        <div className="pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:pb-24">
          <SectionHeading actions={tab === 'general' ? generalMenu : tab === 'notifications' ? <NotificationPrefs draft={draft} set={set} /> : undefined}>{label}</SectionHeading>
          {calMissing && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Este tipo de evento não tem um calendário conectado. Escolha um calendário em Geral ou conecte um em{' '}
                <Link to="/app/company-settings?tab=connections" className="underline underline-offset-4">
                  Configurações da empresa
                </Link>
                .
              </span>
            </div>
          )}
          {paused && tab === 'general' && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900" data-testid="paused-banner">
              <CirclePause className="h-4 w-4 shrink-0 text-amber-600" />
              <span className="min-w-0 flex-1">Novos agendamentos pausados: a página de reserva não oferece horários{changes ? ' (depois de salvar)' : ''}.</span>
              <Button type="button" size="xs" variant="outline" className="bg-background" onClick={() => set((d) => ({ ...d, active: true }))}>
                Retomar
              </Button>
            </div>
          )}
          {tab === 'general' && <GeneralTab draft={draft} set={set} errors={errors} saved={et} onAddCalendar={() => setAddCalendar(true)} />}
          {tab === 'availability' && <AvailabilityTab draft={draft} set={set} errors={errors} />}
          {tab === 'notifications' && <NotificationsTab draft={draft} set={set} errors={errors} />}
          {tab === 'data-collection' && <DataCollectionTab draft={draft} set={set} errors={errors} />}
          {tab === 'agents' && <AgentsTab et={{ ...et, agentIds: draft.agentIds }} onAdd={addToAgent} onRemove={removeFromAgent} />}
          {tab === 'advanced' && <AdvancedTab draft={draft} set={set} errors={errors} saved={et} />}
        </div>
      </div>
      <ActionBar
        changes={changes}
        saving={saving}
        onSave={save}
        onDiscard={() => {
          setDraftState(et)
          setShowErrors(false)
        }}
      >
        <DarkBar et={{ ...et, agentIds: draft.agentIds }} onAdd={addToAgent} />
      </ActionBar>
      <BookingsSheet et={et} open={bookingsOpen} onOpenChange={setBookingsOpen} />
      <ConnectCalendarDialog
        open={addCalendar}
        onOpenChange={setAddCalendar}
        onConnected={(c) => set((d) => ({ ...d, calendarId: c.id, conflictCalendarIds: (d.conflictCalendarIds ?? []).filter((x) => x !== c.id) }))}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Excluir tipo de evento?"
        description={`"${et.name}" será removido se não houver reservas ou vínculos que impeçam a exclusão. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        onConfirm={remove}
      />
      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        changes={changes}
        name={et.name}
        onCancel={() => blocker.state === 'blocked' && blocker.reset()}
        onDiscard={() => {
          setDraftState(et)
          setShowErrors(false)
          if (blocker.state === 'blocked') blocker.proceed()
        }}
        onSave={async () => {
          if (blocker.state !== 'blocked') return
          if (Object.keys(validate(draft, eventTypes)).length) {
            blocker.reset()
            save()
            return
          }
          if (await save()) blocker.proceed()
        }}
      />
      <UnsavedChangesDialog
        open={duplicateGuard}
        changes={changes}
        name={et.name}
        description="A cópia é criada a partir da versão salva."
        discardLabel="Descartar e duplicar"
        saveLabel="Salvar e duplicar"
        onCancel={() => setDuplicateGuard(false)}
        onDiscard={() => {
          setDuplicateGuard(false)
          setDraftState(et)
          setShowErrors(false)
          duplicate(true)
        }}
        onSave={async () => {
          setDuplicateGuard(false)
          if (await save()) void duplicate(true)
        }}
      />
    </Shell>
  )
}

/* ---------------------------------- Página ---------------------------------- */

export default function SchedulingPage() {
  const load = usePageLoad('scheduling')
  const { eventTypeId, tab } = useParams()
  const calendars = useSchedulingCalendars()
  const all = useCollection('eventTypes')
  const eventTypes = useMemo(() => [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [all])
  const [connectOpen, setConnectOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const current = eventTypes.find((e) => e.id === eventTypeId)

  if (!eventTypeId && eventTypes.length > 0) return <Navigate to={`/app/scheduling/${eventTypes[0]!.id}/general`} replace />
  if (eventTypeId && !current) return <Navigate to="/app/scheduling" replace />
  if (current && !TABS.some((t) => t.slug === tab)) return <Navigate to={`/app/scheduling/${current.id}/general`} replace />

  if (load.isLoading || load.isError) {
    return (
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8 grow w-full max-w-[764px] mx-auto">
        {load.isError ? <PageLoadError onRetry={load.retry} /> : <PageSkeleton rows={5} />}
      </div>
    )
  }

  const dialogs = (
    <>
      <ConnectCalendarDialog open={connectOpen} onOpenChange={setConnectOpen} />
      <CreateEventTypeDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )

  if (current) {
    return (
      <>
        <Editor key={current.id} et={current} tab={tab as TabSlug} eventTypes={eventTypes} onCreate={() => (calendars.length ? setCreateOpen(true) : setConnectOpen(true))} />
        {dialogs}
      </>
    )
  }

  // Sem tipos de evento: o MESMO estado vazio da Fonio (fonio-live2/G-agendador/01) — com calendário já conectado, o CTA
  // e "Adicionar novo evento" abrem direto a criação do tipo de evento.
  const hasCalendar = calendars.length > 0
  const startCreate = () => (hasCalendar ? setCreateOpen(true) : setConnectOpen(true))
  return (
    <>
      <Shell eventTypes={eventTypes} onCreate={startCreate}>
        {/* Posição fixa (não centralizada): nas capturas ao vivo 1512×746 e 1355×661 o cartão fica em y 112 nos dois tamanhos. */}
        <div className="flex flex-1 flex-col pb-24">
          <div className="flex justify-center px-4 pt-10 sm:px-8 lg:pt-[112px]">
            <EmptyState
              icon={<CalendarPlus />}
              title="Conecte um calendário e crie um tipo de evento"
              description="Conecte um calendário do Google ou da Microsoft para usar nos seus agendamentos."
              action={
                <Button className="px-4 py-2 h-auto min-h-10 whitespace-normal" onClick={startCreate}>
                  Conecte um calendário e crie um tipo de evento
                </Button>
              }
            />
          </div>
        </div>
        <ActionBar>
          <DarkBar onAdd={() => undefined} />
        </ActionBar>
      </Shell>
      {dialogs}
    </>
  )
}
