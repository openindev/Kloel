import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Mail, Search, ListFilter, Inbox, Send, Sparkles, ChevronsUpDown, Plus, Check, CircleCheck, Circle } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import type { EmailInbox } from '@/domain/types'
import { useCollection, useCurrentRole, useStore } from '@/data/store'
import { BetaBadge, Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { OpStatus } from '@/app/pages/phone-numbers/OpStatus'
import { useOperation } from '@/hooks/useOperation'
import { activateEmail, refreshEmail } from '@/services/casca/email'
import { cn } from '@/lib/utils'
import { useEmailCapacity, canManageShared } from '@/app/pages/company-settings/plan'
import { ConnectAccountDialog, ProviderIcon } from '@/app/pages/company-settings/connections'
import { MAIL_VIEWS, VIEW_LABEL, useInboxAccess, type MailView } from './mailbox'
import { FolderList, MessageDetail, FILTER_LABEL, type MailFilter } from './MailboxViews'
import { ContextView, RulesView, KnowledgeView, SettingsView } from './AssistantViews'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'
import { areaForPath, loadArea } from '@/services/casca/data'

const NAV_BTN =
  'inline-flex w-full items-center gap-2 whitespace-nowrap text-sm h-10 justify-start rounded-lg px-4 font-normal transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 data-[active=true]:bg-muted data-[active=true]:font-semibold [&>svg]:size-4 [&>svg]:shrink-0'
const ASSIST_LINK =
  'flex h-10 items-center rounded-lg px-4 text-sm font-normal leading-none hover:bg-muted data-[active=true]:bg-muted data-[active=true]:font-semibold aria-disabled:pointer-events-none aria-disabled:opacity-40'

const FILTERS: MailFilter[] = ['unread', 'draft', 'replied']
const ASSISTANT_VIEWS: MailView[] = ['context', 'rules', 'knowledge', 'settings']

/** Diálogo de assinatura (OBSERVADO ao abrir /email-agents sem assinatura E-Mail IA). */
function PlanGateDialog({ open, onOpenChange, exhausted, included, price }: { open: boolean; onOpenChange: (o: boolean) => void; exhausted?: boolean; included: number; price: number }) {
  const ret = encodeURIComponent('/app/email-agents')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-screen w-full max-w-lg flex-col justify-start gap-y-4 overflow-y-auto border-0 p-8 lg:min-w-[700px]" data-testid="email-plan-gate">
        <DialogHeader className="mb-4 text-xl font-semibold">
          <DialogTitle>
            <span className="flex items-center gap-2">Kloel E-Mail IA <BetaBadge /></span>
          </DialogTitle>
        </DialogHeader>
        {exhausted && (
          <p className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900">
            Todas as caixas incluídas nas suas assinaturas já estão em uso ({included} de {included}). Adicione outra assinatura ou desative o agente em outra caixa.
          </p>
        )}
        <p className="text-base text-foreground">Um agente de e-mail para uma caixa de entrada.</p>
        <ul className="list-disc space-y-1.5 pl-5 text-left">
          <li>Uma caixa de entrada incluída (R$ {price} / caixa de entrada adicional)</li>
          <li>Uma conexão com Google ou Microsoft incluída</li>
          <li>E-mails ilimitados*</li>
        </ul>
        <p className="text-xs text-muted-foreground">* Sujeitos a uso justo</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" className="h-10">Cancelar</Button>
          </DialogClose>
          <Button asChild className="h-10">
            <Link to={`/app/add-product/email?returnTo=${ret}`}>Adicionar assinatura</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InboxSwitcher({ inboxes, current, onConnect, className }: { inboxes: EmailInbox[]; current?: EmailInbox; onConnect?: () => void; className?: string }) {
  const navigate = useNavigate()
  if (!current) {
    return (
      <div className={cn('flex h-10 w-full items-center gap-3 px-3 text-sm text-muted-foreground', className)}>
        <Mail className="size-4 shrink-0" />
        <span>Nenhuma caixa de entrada disponível</span>
      </div>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-muted data-[state=open]:bg-muted', className)} aria-label="Selecionar caixa de entrada">
          <ProviderIcon provider={current.provider} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium">{current.address}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width] min-w-[236px]">
        <DropdownMenuLabel>Caixas de entrada</DropdownMenuLabel>
        {inboxes.map((i) => (
          <DropdownMenuItem key={i.id} onSelect={() => navigate(`/app/email-agents/${i.id}/inbox`)}>
            <ProviderIcon provider={i.provider} className="size-4" />
            <span className="min-w-0 flex-1 truncate">{i.address}</span>
            {i.id === current.id && <Check className="text-brand" />}
          </DropdownMenuItem>
        ))}
        {onConnect && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onConnect}><Plus className="text-muted-foreground" /> Conectar outra caixa</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function EmailAgentsPage() {
  const load = usePageLoad('email-agents')
  const { inboxId, view: viewParam } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // Abrir/recarregar /app/email-agents/:id/inbox carrega a área "Conversas" (o caminho termina em /inbox): sem as caixas
  // a página redirecionava para a primeira caixa. Carrega a área do E-Mail IA antes de decidir qualquer redirecionamento.
  const [emailArea, setEmailArea] = useState<'ready' | 'loading' | 'error'>(() => (areaForPath(location.pathname) === 'email' ? 'ready' : 'loading'))
  useEffect(() => {
    if (emailArea !== 'loading') return
    let alive = true
    loadArea('email').then(() => alive && setEmailArea('ready'), () => alive && setEmailArea('error'))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailArea])
  const [params, setParams] = useSearchParams()
  const inboxes = useCollection('emailInboxes')
  const allMessages = useCollection('emailMessages')
  const cap = useEmailCapacity()
  const role = useCurrentRole()
  const inbox = inboxes.find((i) => i.id === inboxId)
  const access = useInboxAccess(inbox)
  const view: MailView | undefined = MAIL_VIEWS.includes(viewParam as MailView) ? (viewParam as MailView) : undefined
  const enabled = cap.accessAllowed && !!inbox
  const [gateOpen, setGateOpen] = useState(!cap.accessAllowed)
  const [gateExhausted, setGateExhausted] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  // Cada caixa de busca (aside ≥ lg e barra compacta < lg) tem o seu popover: um estado único abria os dois
  // ao mesmo tempo e o popover oculto fechava o visível no mesmo clique.
  const [filterOpen, setFilterOpen] = useState<null | 'aside' | 'bar'>(null)

  useEffect(() => {
    if (cap.accessAllowed) setGateOpen(false)
  }, [cap.accessAllowed])

  const q = params.get('q') ?? ''
  const filters = (params.get('f') ?? '').split(',').filter((f): f is MailFilter => FILTERS.includes(f as MailFilter))
  const selectedId = params.get('m')
  const setQuery = (patch: Record<string, string | null>, targetView?: MailView) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (targetView && inbox && targetView !== view) navigate(`/app/email-agents/${inbox.id}/${targetView}?${next.toString()}`, { replace: false })
    else setParams(next, { replace: true })
  }
  // Abrir um e-mail empilha uma entrada no histórico (Voltar do navegador retorna à lista; Avançar reabre o e-mail).
  const openFromList = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('m', id)
    setParams(next, { state: { mailFromList: true } })
  }
  const backToList = () => {
    if ((location.state as { mailFromList?: boolean } | null)?.mailFromList) navigate(-1)
    else setQuery({ m: null })
  }

  const msgs = useMemo(() => allMessages.filter((m) => m.inboxId === inbox?.id), [allMessages, inbox?.id])
  const folder: 'inbox' | 'sent' = view === 'sent' ? 'sent' : 'inbox'
  const folderMsgs = useMemo(() => msgs.filter((m) => m.folder === folder), [msgs, folder])
  const unread = msgs.filter((m) => m.folder === 'inbox' && !m.read).length
  const selected = selectedId ? msgs.find((m) => m.id === selectedId) : undefined

  const activateOp = useOperation(async (onProgress, id: string) => activateEmail(id, onProgress))
  // O estado da ativação pertence à caixa aberta: trocar de caixa limpa progresso/erro anteriores.
  const resetActivation = activateOp.reset
  useEffect(() => {
    resetActivation()
  }, [inbox?.id, resetActivation])

  const requestActivate = async () => {
    if (activateOp.isRunning) return
    // Fonio (H-email-ia/02): sem assinatura E-Mail IA, "Ativar agente de e-mail" abre o diálogo de assinatura.
    if (!cap.hasSubscription || !cap.accessAllowed) {
      setGateExhausted(false)
      setGateOpen(true)
      return
    }
    if (!inbox) { setConnectOpen(true); return }
    if (!access.canManage) return
    if (!cap.accessAllowed) {
      setGateExhausted(false)
      setGateOpen(true)
      return
    }
    if (!cap.canActivate) {
      setGateExhausted(true)
      setGateOpen(true)
      return
    }
    const r = await activateOp.run(inbox.id)
    if (r) { toast.success('Agente de e-mail ativado', { description: inbox.address }); if (r !== inbox.id) navigate(`/app/email-agents/${r}/inbox`, { replace: true }) }
  }

  // Carregamento simulado da página (o diálogo de assinatura, quando aplicável, aparece depois de carregar).
  if (load.isLoading || load.isError || emailArea !== 'ready') {
    return (
      <div className="mx-auto w-full max-w-[764px] px-4 pb-24 pt-10 sm:px-8 lg:pt-20">
        {load.isError || emailArea === 'error' ? <PageLoadError onRetry={emailArea === 'error' ? () => setEmailArea('loading') : load.retry} /> : <PageSkeleton rows={5} />}
      </div>
    )
  }

  // Redirecionamentos de rota (depois de todos os hooks)
  if (!inboxId && inboxes.length > 0) return <Navigate to={`/app/email-agents/${inboxes[0]!.id}/inbox`} replace />
  if (inboxId && !inbox) return <Navigate to="/app/email-agents" replace />
  if (inbox && !view) return <Navigate to={`/app/email-agents/${inbox.id}/inbox`} replace />

  const linkFor = (v: MailView) => (inbox ? `/app/email-agents/${inbox.id}/${v}` : '#')
  const connectScope = canManageShared(role) ? 'shared' : 'personal'
  const openConnect = () => setConnectOpen(true)

  /* ------------------------------ Conteúdo central ------------------------------ */
  const activationCard = (
    <section className="w-full max-w-xl rounded-xl border px-8 py-12 text-center" data-testid="email-activate-card">
      <Sparkles className="mx-auto size-6 text-muted-foreground" />
      <h1 className="mt-4 text-lg font-semibold">Ativar agente de e-mail</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Ative a IA de e-mail para esta caixa de correio.</p>
      {enabled && !access.canManage ? (
        <SimpleTooltip label={access.manageReason}>
          <span tabIndex={0} className="mt-6 inline-flex"><Button className="h-10 px-4" disabled>Ativar agente de e-mail</Button></span>
        </SimpleTooltip>
      ) : (
        <Button className="mt-6 h-10 px-4" disabled={activateOp.isRunning} onClick={() => void requestActivate()}>
          {activateOp.isRunning ? 'Ativando…' : 'Ativar agente de e-mail'}
        </Button>
      )}
      {enabled && !access.canManage && <p className="mx-auto mt-3 max-w-md text-xs text-muted-foreground">{access.manageReason}</p>}
      <OpStatus className="mt-4 text-left" status={activateOp.status === 'success' ? 'idle' : activateOp.status} progress={activateOp.progress} error={activateOp.error} onRetry={() => void activateOp.retry()} />
    </section>
  )

  // Com assinatura e sem caixa (estado não observável na conta ao vivo): passos para conectar a caixa. Sem assinatura a
  // Fonio não deixa ficar na página (fechar o diálogo leva ao Início), então este bloco nunca aparece nesse caso.
  const setupSteps = !inbox && !gateOpen && cap.accessAllowed && (
    <div className="mt-6 w-full max-w-xl rounded-xl border border-dashed p-5 text-sm" data-testid="email-setup-steps">
      <ol className="space-y-4">
        <li className="flex flex-wrap items-start gap-x-3 gap-y-2">
          {cap.hasSubscription ? <CircleCheck className="mt-0.5 size-4 text-emerald-600" /> : <Circle className="mt-0.5 size-4 text-muted-foreground" />}
          <div className="min-w-0 flex-1 basis-[220px]">
            <p className="font-medium">Assinatura Kloel E-Mail IA</p>
            <p className="text-muted-foreground">{cap.hasSubscription ? (cap.hasAuthoritativeQuota ? `Ativa · ${cap.included} ${cap.included === 1 ? 'caixa incluída' : 'caixas incluídas'}.` : 'Ativa') : '—'}</p>
          </div>
          {!cap.hasSubscription && <Button size="sm" variant="outline" className="ml-7 sm:ml-0" onClick={() => { setGateExhausted(false); setGateOpen(true) }}>Ver assinatura</Button>}
        </li>
        <li className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <Circle className="mt-0.5 size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1 basis-[220px]">
            <p className="font-medium">Caixa de correio Google ou Microsoft</p>
            <p className="text-muted-foreground">
              Conecte aqui ou em{' '}
              <Link to="/app/company-settings?tab=connections" className="font-medium text-foreground underline underline-offset-4">Configurações da empresa → Conexões de contas</Link>{' '}
              com o recurso “IA de e-mail”.
            </p>
          </div>
          <Button size="sm" className="ml-7 sm:ml-0" disabled={!cap.accessAllowed} onClick={openConnect}>Conectar caixa de entrada</Button>
        </li>
      </ol>
    </div>
  )

  let content: ReactNode
  if (!inbox || !enabled) {
    content = (
      <>
        {activationCard}
        {setupSteps}
      </>
    )
  } else if (view === 'inbox' || view === 'sent') {
    content = selected ? (
      <MessageDetail
        key={selected.id}
        inbox={inbox}
        message={selected}
        canDraft={inbox.agentEnabled}
        canReply={access.canManage}
        readOnlyReason={access.manageReason}
        onBack={backToList}
        onOpen={(id) => {
          const m = msgs.find((x) => x.id === id)
          const next = new URLSearchParams(params)
          next.set('m', id)
          navigate(`/app/email-agents/${inbox.id}/${m?.folder === 'sent' ? 'sent' : 'inbox'}?${next.toString()}`)
        }}
      />
    ) : (
      <>
        {!inbox.agentEnabled && view === 'inbox' && <div className="mb-10">{activationCard}</div>}
        <FolderList
          inbox={inbox}
          folder={folder}
          messages={folderMsgs}
          q={q}
          filters={filters}
          onFiltersChange={(f) => setQuery({ f: f.join(',') || null })}
          onClearSearch={() => setQuery({ q: null })}
          onOpen={openFromList}
        />
      </>
    )
  } else if (view === 'context') content = <ContextView inbox={inbox} canEdit={access.canEdit} readOnlyReason={access.editReason} />
  else if (view === 'rules') content = <RulesView inbox={inbox} canEdit={access.canEdit} readOnlyReason={access.editReason} />
  else if (view === 'knowledge') content = <KnowledgeView inbox={inbox} canEdit={access.canEdit} readOnlyReason={access.editReason} />
  else
    content = (
      <SettingsView
        inbox={inbox}
        canManage={access.canManage}
        readOnlyReason={access.manageReason}
        activation={{ status: activateOp.status, progress: activateOp.progress, error: activateOp.error, isRunning: activateOp.isRunning, retry: () => void activateOp.retry(), reset: activateOp.reset }}
        onRequestActivate={() => void requestActivate()}
        onDisconnected={() => navigate('/app/email-agents', { replace: true })}
      />
    )

  const searchBox = (where: 'aside' | 'bar') => (
    <div className={cn('relative flex h-10 items-center rounded-md border border-input bg-background shadow-xs focus-within:ring-1 focus-within:ring-ring', !enabled && 'opacity-40')}>
      <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
      <input
        value={q}
        disabled={!enabled}
        onChange={(e) => setQuery({ q: e.target.value || null, m: null }, view && ASSISTANT_VIEWS.includes(view) ? 'inbox' : undefined)}
        placeholder="Buscar e-mails"
        aria-label="Buscar e-mails"
        className="h-full min-w-0 flex-1 rounded-md bg-transparent pl-9 pr-2 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
      />
      <span className="h-5 w-px bg-border" />
      <Popover open={filterOpen === where} onOpenChange={(o) => setFilterOpen(o ? where : null)}>
        <PopoverTrigger asChild>
          <button type="button" disabled={!enabled} aria-label="Adicionar filtro" className="relative inline-flex h-full w-10 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none">
            <ListFilter className="size-4" />
            {filters.length > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-2">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Filtrar e-mails</p>
          {FILTERS.map((f) => (
            <label key={f} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
              <Checkbox
                checked={filters.includes(f)}
                onCheckedChange={(v) => {
                  const next = v ? [...filters, f] : filters.filter((x) => x !== f)
                  setQuery({ f: next.join(',') || null, m: null }, view && ASSISTANT_VIEWS.includes(view) ? 'inbox' : undefined)
                }}
              />
              {FILTER_LABEL[f]}
            </label>
          ))}
          {filters.length > 0 && (
            <Button variant="ghost" size="xs" className="mt-1 w-full" onClick={() => setQuery({ f: null })}>Limpar filtros</Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1">
      {/* ASIDE (lg) */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r bg-background lg:flex">
        <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
          <div className="flex h-[68px] shrink-0 items-start px-3 pt-4">
            <InboxSwitcher inboxes={inboxes} current={inbox} onConnect={cap.accessAllowed ? openConnect : undefined} />
          </div>
          <div className="shrink-0 px-3 py-2">{searchBox('aside')}</div>
          <nav aria-label="Caixa de correio" className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
            <ul className="mb-5 flex flex-col gap-0">
              <li>
                <button type="button" className={NAV_BTN} disabled={!enabled} data-active={enabled && view === 'inbox'} onClick={() => inbox && navigate(linkFor('inbox'))}>
                  <Inbox /> <span className="flex-1 text-left">Caixa de entrada</span>
                  {enabled && unread > 0 && <span className="text-xs tabular-nums text-muted-foreground">{unread}</span>}
                </button>
              </li>
              <li>
                <button type="button" className={NAV_BTN} disabled={!enabled} data-active={enabled && view === 'sent'} onClick={() => inbox && navigate(linkFor('sent'))}>
                  <Send /> Enviados
                </button>
              </li>
            </ul>
          </nav>
          <div className="shrink-0 border-t bg-muted/30 px-3 py-3">
            <h2 className="mb-2 flex items-center gap-2 px-4 py-2 text-[18px] font-semibold tracking-tight">
              Assistente
              {inbox && enabled && <Badge variant={inbox.agentEnabled ? 'success' : 'secondary'} className="px-2 text-[10px] font-medium">{inbox.agentEnabled ? 'Ativo' : 'Inativo'}</Badge>}
            </h2>
            <nav aria-label="Navegação do agente de e-mail" className="flex flex-col">
              {ASSISTANT_VIEWS.map((v) => (
                <Link
                  key={v}
                  to={enabled ? linkFor(v) : '#'}
                  aria-disabled={!enabled || undefined}
                  tabIndex={enabled ? undefined : -1}
                  onClick={(e) => !enabled && e.preventDefault()}
                  data-active={enabled && view === v}
                  className={ASSIST_LINK}
                >
                  {VIEW_LABEL[v]}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </aside>

      {/* CONTEÚDO */}
      <div className="h-full min-w-0 flex-1 overflow-y-auto bg-background">
        {/* Barra compacta (< lg): seletor de caixa, seção e busca */}
        <div className="border-b px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><InboxSwitcher inboxes={inboxes} current={inbox} onConnect={cap.accessAllowed ? openConnect : undefined} className="px-2" /></div>
            <Select value={enabled && view ? view : ''} onValueChange={(v) => navigate(linkFor(v as MailView))} disabled={!enabled}>
              <SelectTrigger className="h-10 w-[160px] shrink-0" aria-label="Seção do E-Mail IA"><SelectValue placeholder="Caixa de entrada" /></SelectTrigger>
              <SelectContent>
                {MAIL_VIEWS.map((v) => <SelectItem key={v} value={v}>{VIEW_LABEL[v]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-2">{searchBox('bar')}</div>
        </div>
        <div className="mx-auto w-full max-w-[764px] px-4 pb-24 pt-10 sm:px-8 lg:pt-20">{content}</div>
      </div>

      {/* OBSERVADO (fonio-live2/H-email-ia/02): sem assinatura, fechar o diálogo (Cancelar, X ou Esc) leva ao Início ("/" → /app) */}
      <PlanGateDialog
        open={gateOpen}
        onOpenChange={(o) => {
          setGateOpen(o)
          if (!o && !cap.accessAllowed) navigate('/app')
        }}
        exhausted={gateExhausted}
        included={cap.included}
        price={cap.price}
      />
      <ConnectAccountDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        scope={connectScope}
        defaultFeatures={['email']}
        onConnected={(connection) => { void refreshEmail().then(result => { const box = result.emailInboxes.find(i => i.connectionId === connection.id); if (box) navigate(`/app/email-agents/${box.id}/inbox`) }).catch(error => toast.error(error instanceof Error ? error.message : 'Não foi possível carregar a caixa.')) }}
      />
    </div>
  )
}
