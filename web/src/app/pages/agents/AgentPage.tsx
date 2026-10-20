import { usePrivateNavigationBlocker } from '@/components/app/PrivateNavigation'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Bot, ChevronDown, CirclePlus, Ellipsis, Headset, Loader2, MessageCircle, PhoneOff, Settings2, UserRoundX } from 'lucide-react'
import { WhatsAppIcon } from '@/components/brand/icons'
import { toast } from 'sonner'
import type { Agent, AgentType } from '@/domain/types'
import '@/domain/ext/agents'
import { uid } from '@/lib/utils'
import { useCollection, useStore, useUi } from '@/data/store'
import { ActionBar, DarkBarButton, DarkBarPrimary } from '@/components/app/ActionBar'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { EmptyState } from '@/components/app/misc'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TestCallDialog, useTestCallState } from './TestCallDialog'
import { AssignNumberDialog } from './AssignNumberDialog'
import { AgentAside, MobileAgentNav, tabsFor, type AgentTab } from './core/AgentNav'
import { CreateAgentDialog } from './core/CreateAgentDialog'
import { DraftContext, countChanges, normalizeDraft, pickDraft, validateDraft, type AgentDraftCtx, type DraftFields } from './core/draft'
import { GeneralTab } from './core/GeneralTab'
import { RulesTab } from './core/RulesTab'
import { KnowledgeTab } from './core/KnowledgeTab'
import { PromptTab } from './core/PromptTab'
import { TechnicalTab } from './core/TechnicalTab'
import { MicPicker, FieldError } from './core/ui'
import { ManageWebchatDialog, legacyWebchatMigration, webchatLive as isWebchatLive } from './core/ManageWebchat'
import { deleteAgentCascade } from './core/agentOps'
import { agentCommands, copyAgentKnowledge, saveAgentFields, setAgentActive } from '@/services/casca/agents'
import { AssistantWhatsAppDialog } from '@/app/pages/whatsapp/AssistantWhatsAppDialog'
import { defaultWebchat } from '@/app/pages/whatsapp/webchat/model'

/** /app/agents/:agentId/:tab — tab ∈ general | rules | knowledge | prompt | technical (chat: sem technical). */
export default function AgentPage() {
  const { agentId, tab } = useParams()
  const agents = useCollection('agents')
  const agent = agents.find((a) => a.id === agentId)
  if (!agent) return <AgentNotFound agents={agents} />
  const valid = tabsFor(agent.type).some((t) => t.id === tab)
  if (!valid) return <Navigate to={`/app/agents/${agent.id}/general`} replace />
  return <AgentWorkspace key={`${agent.orgId}:${agent.id}:${agent.cascaEditor?.generation ?? 0}`} agent={agent} tab={tab as AgentTab} />
}

/**
 * Assistente inexistente (excluído, de outra organização ou endereço digitado errado): estado explícito em vez de
 * redirecionar em silêncio (INFERIDO, mesmo padrão de "Conversa não encontrada"/"Contato não encontrado").
 */
function AgentNotFound({ agents }: { agents: Agent[] }) {
  const first = useMemo(() => [...agents].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0], [agents])
  return (
    <div className="mx-auto w-full max-w-[764px] grow px-4 pb-8 pt-10 sm:px-8 lg:pt-20" data-testid="agent-not-found">
      <EmptyState
        className="mt-4"
        icon={<UserRoundX />}
        title="Assistente não encontrado"
        description="Este assistente pode ter sido excluído ou pertencer a outra organização. Confira o endereço ou abra outro assistente."
        action={
          <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
            {first ? (
              <Button asChild>
                <Link to={`/app/agents/${first.id}/general`} replace>
                  Abrir {first.name}
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link to="/app/agents" replace>
                  Ver assistentes
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to="/app">Ir para a visão geral</Link>
            </Button>
          </div>
        }
      />
    </div>
  )
}

/**
 * Na Fonio a barra flutuante do assistente fica centralizada na área de conteúdo, à direita da coluna do assistente
 * (captura ao vivo 1512px: centro em x≈1016 = (260+260+1512)/2). O ActionBar compartilhado centraliza a partir de
 * --sidebar-offset; nesta página (lg+, coluna de 260px visível) o deslocamento soma a coluna do assistente.
 */
function AgentBarOffset() {
  const collapsed = useUi().sidebarCollapsed
  const base = collapsed ? 62 : 260
  return <style>{`@media (min-width: 1024px) { :root { --sidebar-offset: ${base + 260}px !important; } }`}</style>
}

/** Popover "Configurações de áudio" do ícone settings2 da barra escura (OBSERVADO ao vivo: app-agent-general-audio-popover.jpg). */
function AudioSettingsPopover() {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* DarkBarIcon não encaminha ref; botão equivalente com as mesmas classes */}
        <button type="button" aria-label="Configurações de áudio" className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-100 hover:bg-white/10 hover:text-white data-[state=open]:bg-white/10">
          <Settings2 className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" alignOffset={-5} sideOffset={8} className="w-[344px] max-w-[calc(100vw-1rem)] rounded-xl border p-4 shadow-md">
        <p className="mb-3 text-sm font-medium">Configurações de áudio</p>
        <MicPicker active={open} segments={5} />
      </PopoverContent>
    </Popover>
  )
}

/** Sigla do país de um número para os chips da barra (WC/EM-01: "Números de telefone [DE][AT] ⌄"). SIP → "SIP". */
const DIAL_CODES: [string, string][] = [
  ['+55', 'BR'], ['+351', 'PT'], ['+54', 'AR'], ['+56', 'CL'], ['+57', 'CO'], ['+52', 'MX'], ['+34', 'ES'], ['+49', 'DE'], ['+43', 'AT'], ['+41', 'CH'], ['+44', 'GB'], ['+33', 'FR'], ['+39', 'IT'], ['+1', 'US'],
]
export function numberCountryCode(n: { number: string; country: string; kind: string }) {
  if (n.kind === 'sip' || !n.number.trim().startsWith('+')) return 'SIP'
  const hit = DIAL_CODES.find(([p]) => n.number.replace(/\s/g, '').startsWith(p))
  return hit ? hit[1] : n.country.toUpperCase()
}

/** Ponto verde dos canais ativos na barra do assistente de chat (WC-02/WC-03: "Chatbot de IA ●"). */
function ActiveDot({ label }: { label: string }) {
  return (
    <span className="ml-1 inline-flex size-1.5 rounded-full bg-emerald-400" aria-hidden title={label}>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Chip "Assinar plano" da barra escura (WC-02/WC-03: "WhatsApp | Get plan"). */
function PlanChip() {
  return <span className="ml-1 rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-slate-100">Assinar plano</span>
}

/** Chip "Configurar" da barra escura: plano ativo, canal ainda não configurado (TK-V05: "WhatsApp | Set up", "AI Chatbot | Set up"). */
function SetupChip() {
  // no celular a barra não comporta o texto: vira um ponto âmbar (o rótulo continua acessível)
  return (
    <>
      <span className="ml-1 rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-amber-200 max-sm:hidden">Configurar</span>
      <span className="ml-1 inline-flex size-1.5 rounded-full bg-amber-300 sm:hidden" aria-hidden title="Configurar" />
      <span className="sr-only sm:hidden">(configurar)</span>
    </>
  )
}

function DuplicateDialog({ agent, open, onOpenChange, onDone }: { agent: Agent; open: boolean; onOpenChange: (o: boolean) => void; onDone: (id: string) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setName('')
      setError(undefined)
    }
  }, [open])
  const [busy, setBusy] = useState(false)
  const pending = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending.current) return
    const n = name.trim()
    if (!n) return setError('O nome é obrigatório.')
    if (n.length > 60) return setError('O nome pode ter no máximo 60 caracteres.')
    pending.current = true; setBusy(true); setError(undefined)
    try {
      const input = structuredClone(agent); input.name = n
      if (input.webchat) input.webchat = { ...input.webchat, title: n }
      if (input.webchatSetup) input.webchatSetup = { ...input.webchatSetup, hostedEnabled: false, assistantSlug: undefined, widgetId: defaultWebchat({ ...input, id: uid('agt') }).widgetId }
      const created = await agentCommands(`duplicate:${agent.id}`).create(input)
      if (!mounted.current || useStore.getState().db.session.orgId !== agent.orgId) return
      useStore.getState().insert('agents', created)
      let incomplete = false
      try {
        const copied = await copyAgentKnowledge(agent.id, created.id)
        if (!mounted.current || useStore.getState().db.session.orgId !== agent.orgId) return
        for (const entry of copied.knowledgeEntries) useStore.getState().insert('knowledgeEntries', entry)
        for (const source of copied.knowledgeSources) useStore.getState().insert('knowledgeSources', source)
        if (copied.incomplete) { incomplete = true; toast.error('Assistente criado; cópia do conhecimento incompleta', { description: copied.incomplete }) }
      } catch (error) { incomplete = true; if (mounted.current) toast.error('Assistente criado; cópia do conhecimento incompleta', { description: error instanceof Error ? error.message : 'Confira as fontes do novo assistente.' }) }
      if (!mounted.current || useStore.getState().db.session.orgId !== agent.orgId) return
      onOpenChange(false)
      if (!incomplete) toast.success('Assistente duplicado', { description: `${created.name} foi criado a partir de ${agent.name}.` })
      onDone(created.id)
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Não foi possível duplicar o assistente.') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !pending.current && onOpenChange(value)}>
      {/* OBSERVADO (fonio-live2/C-assistentes/08): max-w-lg p-6 gap-y-8, sem descrição; "Nome" vazio e sem placeholder */}
      <DialogContent className="gap-y-8">
        <DialogHeader>
          <DialogTitle>Duplicar assistente</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <div className="grid gap-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              className="h-10"
              autoFocus
              value={name}
              aria-invalid={!!error}
              onChange={(e) => {
                setName(e.target.value)
                setError(undefined)
              }}
            />
            <FieldError>{error}</FieldError>
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>{busy ? 'Duplicando…' : 'Duplicar assistente'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Descartar alterações?" — usado ao sair do assistente e ao duplicar com alterações pendentes. */
function UnsavedChangesDialog({
  open,
  changes,
  agentName,
  description,
  discardLabel = 'Descartar e sair',
  saveLabel = 'Salvar e sair',
  onCancel,
  onDiscard,
  onSave,
}: {
  open: boolean
  changes: number
  agentName: string
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
            Você tem {changes} {changes === 1 ? 'alteração não salva' : 'alterações não salvas'} em {agentName}.{' '}
            {description ?? 'Se sair agora, elas serão perdidas.'}
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

function AgentWorkspace({ agent, tab }: { agent: Agent; tab: AgentTab }) {
  const navigate = useNavigate()
  const base = useMemo(() => pickDraft(agent), [agent])
  const [draft, setDraft] = useState<DraftFields>(base)
  const [saving, setSaving] = useState(false)
  const writing = useRef(false), mounted = useRef(true), draftBase = useRef(agent)
  const [toggling, setToggling] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [createType, setCreateType] = useState<AgentType>('voice')
  const [createOpen, setCreateOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  /** cada clique em "Testar ligação" inicia uma nova ligação, mesmo com o painel da anterior (encerrada/falhou) aberto */
  const [testKey, setTestKey] = useState(0)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  /** "Duplicar assistente" com alterações pendentes: pergunta antes (a cópia é feita da versão salva) */
  const [duplicateGuard, setDuplicateGuard] = useState(false)
  const skipBlock = useRef(false)
  const live = useTestCallState((s) => s.live)
  const liveHere = !!live && live.agentId === agent.id

  // Ligação de teste pedida por outra tela (primeiro acesso → "Testar ligação"): na referência [459]–[462] a ligação acontece na
  // página Geral do assistente, com a barra escura em "Encerrar ligação". Aceita `state.openTestCall` ou `?testCall=1`; o pedido é
  // consumido (removido da URL/estado) para não reabrir ao recarregar ou voltar.
  const location = useLocation()
  const testRequestHandled = useRef<string>()
  useEffect(() => {
    if (testRequestHandled.current === location.key) return
    testRequestHandled.current = location.key
    const params = new URLSearchParams(location.search)
    const requested = (location.state as { openTestCall?: boolean } | null)?.openTestCall === true || params.get('testCall') === '1'
    if (!requested) return
    params.delete('testCall')
    const search = params.toString()
    navigate({ pathname: `/app/agents/${agent.id}/general`, search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: null })
    setTestOpen(true)
    setTestKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // sincroniza com alterações externas enquanto não há edição pendente
  const lastBase = useRef(base)
  useEffect(() => {
    if (lastBase.current === base) return
    setDraft((d) => { if (countChanges(lastBase.current, d) !== 0) return d; draftBase.current = agent; return base })
    lastBase.current = base
  }, [base])

  const changes = useMemo(() => countChanges(base, draft), [base, draft])
  const issues = useMemo(() => validateDraft(draft, agent.type), [draft, agent.type])

  const update = useCallback<AgentDraftCtx['update']>((p) => { if (!writing.current) setDraft((d) => ({ ...d, ...(typeof p === 'function' ? p(d) : p) })) }, [])
  const ctx = useMemo<AgentDraftCtx>(
    () => ({ agent, draft, update, changes, issues, issueFor: (f) => issues.find((i) => i.field === f)?.message }),
    [agent, draft, update, changes, issues],
  )

  const save = useCallback(async () => {
    if (writing.current) return false
    if (issues.length) {
      const first = issues[0]!
      toast.error('Não foi possível salvar', { description: first.message })
      if (first.tab !== tab) navigate(`/app/agents/${agent.id}/${first.tab}`)
      return false
    }
    writing.current = true; setSaving(true)
    try {
      const confirmed = await saveAgentFields(draftBase.current, normalizeDraft(draft, agent.type))
      if (!mounted.current || useStore.getState().db.session.orgId !== agent.orgId) return false
      useStore.getState().patch('agents', agent.id, confirmed)
      draftBase.current = confirmed; setDraft(pickDraft(confirmed))
      toast.success('Alterações salvas')
      return true
    } catch (error) { if (mounted.current) toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente consultar novamente.' }); return false }
    finally { writing.current = false; if (mounted.current) setSaving(false) }
  }, [issues, draft, agent.id, agent.orgId, agent.type, tab, navigate])

  const discard = () => {
    if (writing.current) return
    draftBase.current = agent
    setDraft(base)
    toast('Alterações descartadas')
  }

  // confirmação ao sair com alterações não salvas (troca de aba do mesmo assistente mantém o rascunho)
  const blocker = usePrivateNavigationBlocker(({ nextLocation }) => !skipBlock.current && (writing.current || changes > 0) && nextLocation.pathname.split('/')[3] !== agent.id)
  useEffect(() => {
    if (!changes) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [changes])

  const leave = (path: string) => {
    skipBlock.current = true
    navigate(path)
  }

  async function deleteAgent() {
    if (writing.current) return
    writing.current = true; setSaving(true)
    try {
      await agentCommands(agent.id).remove(agent.id)
      if (!mounted.current || useStore.getState().db.session.orgId !== agent.orgId) return
      const st = useStore.getState(), remaining = st.db.agents.filter((a) => a.orgId === agent.orgId && a.id !== agent.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), kept = st.db.conversations.filter((c) => c.agentId === agent.id).length
      deleteAgentCascade(agent.id)
      setDeleteOpen(false); skipBlock.current = true
      navigate(remaining[0] ? `/app/agents/${remaining[0].id}/general` : '/app/agents', { replace: true })
      toast.success('Assistente excluído', { description: kept ? `${agent.name} foi excluído. ${kept} ${kept === 1 ? 'conversa continua' : 'conversas continuam'} em Conversas.` : `${agent.name} foi excluído permanentemente.` })
    } catch (error) { if (mounted.current) toast.error('Não foi possível excluir', { description: error instanceof Error ? error.message : 'Consulte o assistente antes de tentar novamente.' }) }
    finally { writing.current = false; if (mounted.current) setSaving(false) }
  }

  const openCreate = (type: AgentType = 'voice') => {
    setCreateType(type)
    setCreateOpen(true)
  }

  const moreActions = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-8 rounded-md">
          <Ellipsis className="h-4 w-4" />
          <span className="sr-only">Mais ações</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="text-red-500 focus:text-red-500" onSelect={() => setDeleteOpen(true)}>
          Excluir assistente
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => (changes > 0 ? setDuplicateGuard(true) : setDuplicateOpen(true))}>Duplicar assistente</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const isChat = agent.type === 'chat'
  const testLabel = isChat ? 'Testar chat' : 'Testar ligação'
  // barra: voz com números → "Números de telefone [BR] ⌄"; chat → "WhatsApp" / "Chatbot de IA" com estado do canal e do plano
  const assigned = useCollection('phoneNumbers').filter((n) => n.agentId === agent.id)
  const countries = [...new Set(assigned.map(numberCountryCode))]
  const subscriptions = useCollection('subscriptions')
  const hasPlan = (p: string) => subscriptions.some((x) => x.product === p && x.status === 'active')
  const waAccount = useCollection('whatsappAccounts').find((w) => w.agentId === agent.id)
  const webchatLive = hasPlan('webchat') && isWebchatLive(agent)
  const [webchatOpen, setWebchatOpen] = useState(false)
  const [waOpen, setWaOpen] = useState(false)

  // dados antigos do Canal (Agent.webchat: título/cor/site) → modelo único do Chatbot de IA (Agent.webchatSetup)
  useEffect(() => {
    const migrated = legacyWebchatMigration(agent)
    if (migrated) useStore.getState().patch('agents', agent.id, { webchatSetup: migrated })
  }, [agent])
  // o teste usa a versão salva; com alterações pendentes o botão fica esmaecido (OBSERVADO)
  const testButton = (
    <DarkBarPrimary
      disabled={changes > 0}
      onClick={() => {
        setTestOpen(true)
        setTestKey((k) => k + 1)
      }}
    >
      {isChat ? <MessageCircle className="h-4 w-4" /> : <Headset className="h-4 w-4" />}
      {testLabel}
    </DarkBarPrimary>
  )

  return (
    <DraftContext.Provider value={ctx}>
      <AgentBarOffset />
      <main className="flex min-h-0 flex-1">
        <AgentAside agent={agent} tab={tab} onCreate={openCreate} />
        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-auto">
          <div className="mx-auto w-full max-w-[764px] grow px-4 pb-8 pt-10 sm:px-8 lg:pt-20">
            <MobileAgentNav agent={agent} tab={tab} onCreate={openCreate} />
            <div className="pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:pb-24">
              {tab === 'general' && <GeneralTab headerActions={moreActions} />}
              {tab === 'rules' && <RulesTab />}
              {tab === 'knowledge' && <KnowledgeTab />}
              {tab === 'prompt' && <PromptTab />}
              {tab === 'technical' && <TechnicalTab />}
            </div>
          </div>
        </div>
      </main>

      <ActionBar changes={changes} onDiscard={discard} onSave={save} saving={saving}>
        {/* Ativar/Desativar: assistentes nascem em rascunho; o motor recusa (402 plan_required) sem plano ou concessão de teste. */}
        <DarkBarButton
          className="whitespace-nowrap max-sm:px-2"
          data-testid="agent-activation-toggle"
          aria-label={agent.runtimeStatus === 'active' ? 'Desativar assistente' : 'Ativar assistente'}
          disabled={toggling || saving || changes > 0}
          onClick={async () => {
            const activate = agent.runtimeStatus !== 'active'
            setToggling(true)
            try { await setAgentActive(agent, activate); toast.success(activate ? 'Assistente ativado' : 'Assistente desativado') }
            catch (e) {
              const code = (e as { code?: string })?.code, status = (e as { status?: number })?.status
              if (code === 'plan_required' || status === 402) toast.error('Assine um plano para ativar o assistente.', { action: { label: 'Ver planos', onClick: () => navigate('/app/change-plan') } })
              else toast.error(e instanceof Error ? e.message : 'Não foi possível alterar o status do assistente.')
            } finally { if (mounted.current) setToggling(false) }
          }}
        >
          {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className={agent.runtimeStatus === 'active' ? 'h-2 w-2 rounded-full bg-emerald-400' : 'h-2 w-2 rounded-full bg-slate-400'} />}
          {agent.runtimeStatus === 'active' ? 'Desativar' : 'Ativar assistente'}
        </DarkBarButton>
        {isChat ? (
          <>
            <DarkBarButton
              className="whitespace-nowrap max-sm:px-2 max-sm:[&>svg:first-child]:hidden"
              aria-label={hasPlan('whatsapp') ? (waAccount ? 'Números de WhatsApp deste assistente' : 'Configurar WhatsApp') : 'WhatsApp: assinar plano'}
              data-testid="bar-whatsapp"
              onClick={() => (hasPlan('whatsapp') ? setWaOpen(true) : navigate('/app/change-plan/whatsapp'))}
            >
              <WhatsAppIcon className="h-4 w-4 text-slate-300" />
              WhatsApp
              {!hasPlan('whatsapp') ? <PlanChip /> : waAccount ? <ActiveDot label="Conectado" /> : <SetupChip />}
            </DarkBarButton>
            <DarkBarButton
              className="whitespace-nowrap max-sm:px-2 max-sm:[&>svg:first-child]:hidden"
              aria-label={hasPlan('webchat') ? (webchatLive ? 'Chatbot de IA ativo' : 'Configurar Chatbot de IA') : 'Chatbot de IA: assinar plano'}
              onClick={() => (hasPlan('webchat') ? setWebchatOpen(true) : navigate('/app/change-plan/webchat'))}
            >
              <Bot className="h-4 w-4 text-slate-300" />
              Chatbot de IA
              {!hasPlan('webchat') ? <PlanChip /> : webchatLive ? <ActiveDot label="Ativo" /> : <SetupChip />}
            </DarkBarButton>
          </>
        ) : assigned.length ? (
          <DarkBarButton aria-label="Números de telefone" className="whitespace-nowrap max-sm:px-2" onClick={() => setAssignOpen(true)}>
            <span className="max-sm:hidden">Números de telefone</span>
            <span className="sm:hidden">Números</span>
            <span className="ml-1 flex items-center gap-1">
              {countries.map((c) => (
                <span key={c} className="rounded-[5px] bg-white/15 px-1 text-[10px] font-semibold leading-4 text-slate-100">
                  {c}
                </span>
              ))}
            </span>
            <ChevronDown className="ml-0.5 h-4 w-4 text-slate-300 max-sm:hidden" />
          </DarkBarButton>
        ) : (
          <DarkBarButton onClick={() => setAssignOpen(true)}>
            <CirclePlus className="h-4 w-4 text-slate-300" />
            Atribuir número
          </DarkBarButton>
        )}
        {liveHere && live.phase === 'connecting' ? (
          // conectando: a ação principal cancela a tentativa (nunca um "Testar ligação" sem efeito)
          <DarkBarPrimary className="bg-red-600 hover:bg-red-700" onClick={() => live.hangup()}>
            <Loader2 className="h-4 w-4 animate-spin" />
            {isChat ? 'Cancelar chat' : 'Cancelar ligação'}
          </DarkBarPrimary>
        ) : liveHere ? (
          <DarkBarPrimary className="bg-red-600 hover:bg-red-700" onClick={() => live.hangup()}>
            <PhoneOff className="h-4 w-4" />
            {isChat ? 'Encerrar chat' : 'Encerrar ligação'}
          </DarkBarPrimary>
        ) : changes > 0 ? (
          <span className="inline-flex cursor-not-allowed" title="Salve ou descarte as alterações para testar.">
            {testButton}
          </span>
        ) : (
          testButton
        )}
        {/* microfone só faz sentido para assistentes de voz */}
        {!isChat && <AudioSettingsPopover />}
      </ActionBar>

      <TestCallDialog agent={agent} open={testOpen} onOpenChange={setTestOpen} startKey={testKey} />
      <AssignNumberDialog agent={agent} open={assignOpen} onOpenChange={setAssignOpen} />
      {isChat && <ManageWebchatDialog agentId={agent.id} open={webchatOpen} onOpenChange={setWebchatOpen} />}
      {isChat && <AssistantWhatsAppDialog agentId={agent.id} open={waOpen} onOpenChange={setWaOpen} />}
      <CreateAgentDialog open={createOpen} onOpenChange={setCreateOpen} initialType={createType} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(value) => !writing.current && setDeleteOpen(value)}
        title="Tem certeza?"
        description="Esta ação não pode ser desfeita. As informações do assistente serão excluídas permanentemente."
        confirmLabel={saving ? 'Excluindo…' : 'Excluir assistente'}
        onConfirm={deleteAgent}
      />
      <DuplicateDialog agent={agent} open={duplicateOpen} onOpenChange={setDuplicateOpen} onDone={(id) => leave(`/app/agents/${id}/general`)} />

      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        changes={changes}
        agentName={agent.name}
        onCancel={() => blocker.state === 'blocked' && blocker.reset()}
        onDiscard={() => {
          if (writing.current) return
          draftBase.current = agent; setDraft(base)
          if (blocker.state === 'blocked') blocker.proceed()
        }}
        onSave={async () => {
          if (blocker.state !== 'blocked' || writing.current) return
          if (issues.length) {
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
        agentName={agent.name}
        description="A cópia é criada a partir da versão salva."
        discardLabel="Descartar e duplicar"
        saveLabel="Salvar e duplicar"
        onCancel={() => setDuplicateGuard(false)}
        onDiscard={() => {
          if (writing.current) return
          draftBase.current = agent; setDraft(base)
          setDuplicateGuard(false)
          setDuplicateOpen(true)
        }}
        onSave={async () => {
          if (writing.current) return
          setDuplicateGuard(false)
          // save() valida; com erro mostra a mensagem e leva à aba do problema (sem duplicar)
          if (await save()) setDuplicateOpen(true)
        }}
      />
    </DraftContext.Provider>
  )
}
