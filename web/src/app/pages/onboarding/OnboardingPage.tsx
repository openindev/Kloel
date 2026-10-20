import { useContext, useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react'
import { Navigate, UNSAFE_RouteContext, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, ChevronLeft, CornerDownLeft, Headset, CirclePlus, ShoppingCart, CircleCheck, UserRound, Info, MessageCircle, PackageCheck, Send, RotateCcw, XCircle, Bot } from 'lucide-react'
import '@/domain/ext/billing'
import '@/domain/ext/site-secondary'
import type { CartItem } from '@/domain/ext/billing'
import type { Agent, BillingInterval, Organization, ProductKey, Subscription, TranscriptLine } from '@/domain/types'
import { useStore, useCollection, useCurrentOrg, useCurrentUser, useEntity } from '@/data/store'
import { makeAgent } from '@/data/seed/defaults'
import { voiceById } from '@/data/catalogs/voices'
import { planOf } from '@/data/catalogs/plans'
import { captureEngineContext, engineSession, useEngineSession } from '@/services/engine/session'
import { accountClient } from '@/services/engine/account'
import { createProfileCommands } from '@/services/casca/profile'
import { initializeOnboarding, saveOnboardingFields } from '@/services/casca/onboarding'
import { ensureOnboardingAgent } from '@/services/casca/onboarding-setup'
import { loadAgents } from '@/services/casca/agents'
import { loadBilling } from '@/services/casca/billing'
import { publishSlice } from '@/services/casca/data'
import { createCascaChatSession, type CascaChatSession } from '@/services/casca/test-chat'
import { createPrivateChatBooking, type PrivateChatBooking, type PrivateBookingChoice } from '@/services/casca/private-chat-booking'
import { createConversationService } from '@/services/engine/conversations'
import { refreshConversation } from '@/services/casca/conversations'
import { PageLoadError, PageSkeleton } from '@/components/app/PageLoad'
import { languageLabel } from '@/data/catalogs/languages'
import { AppShell } from '@/app/layout/AppShell'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { DarkBarButton, DarkBarPrimary } from '@/components/app/ActionBar'
import { PlanCards } from '@/app/pages/billing/PlanCards'
import { GuaranteeBanner } from '@/app/pages/billing/components'
import { BillingDetailsStep, PaymentStep } from '@/app/pages/billing/CheckoutSteps'
import { CORE_PRODUCTS, PRODUCT_TAB_LABEL, cartTotals, money } from '@/app/pages/billing/lib'
import { signupPlanIntentOf } from '@/app/pages/billing/referral'
import { ScaleConfigDialog } from '@/app/pages/billing/ScaleConfigDialog'
import { TestCallDialog } from '@/app/pages/agents/TestCallDialog'
import { PrivateChatBookingControls } from '@/app/pages/agents/PrivateChatBookingControls'
import { AssignNumberDialog } from '@/app/pages/agents/AssignNumberDialog'
import { COMPANY_SIZES, REFERRAL_SOURCES, SECTORS, labelOf } from './setupOptions'

type OStep = 'plan' | 'billing' | 'payment' | 'name' | 'sector' | 'size' | 'referral' | 'done' | 'test-call'
const ALL_STEPS: OStep[] = ['plan', 'billing', 'payment', 'name', 'sector', 'size', 'referral', 'done', 'test-call']
const POST_PAYMENT: OStep[] = ['name', 'sector', 'size', 'referral', 'done', 'test-call']
const WIZARD_INDEX: Partial<Record<OStep, number>> = { name: 1, sector: 2, size: 3, referral: 4, done: 5, 'test-call': 5 }
const ONBOARDING_AGENT_NAME = 'Roberta'
type ChatChannel = 'whatsapp' | 'webchat'
const CHAT_CHANNEL_LABEL: Record<ChatChannel, string> = { whatsapp: 'WhatsApp', webchat: 'chat do site' }

/**
 * Assistente do primeiro acesso conforme os produtos contratados:
 * - Telefone IA (com ou sem produtos de chat) → assistente de VOZ + ligação de teste (com aviso dos canais de chat contratados);
 * - somente WhatsApp IA / Chatbot de IA → assistente de CHAT (tipo 'chat', como o seed agt_maria) nos canais contratados + chat de teste.
 */
function onboardingAssistantKind(subs: Subscription[]) {
  const active = subs.filter((x) => x.status === 'active')
  const hasVoice = active.some((x) => x.product === 'voice')
  const chatChannels = (['whatsapp', 'webchat'] as const).filter((p) => active.some((x) => x.product === p)) as ChatChannel[]
  const type: Agent['type'] = !hasVoice && chatChannels.length > 0 ? 'chat' : 'voice'
  return { type, hasVoice, chatChannels, mixed: hasVoice && chatChannels.length > 0 }
}
const channelsText = (chs: ChatChannel[]) => chs.map((c) => CHAT_CHANNEL_LABEL[c]).join(' e ')

/**
 * /app/onboarding — Primeiro acesso (spec 05 seção E): modal de planos sobre o app → Dados de faturamento →
 * pagamento confirmado pela Stripe → assistente de configuração 1/5…5/5 → ligação de teste → painel.
 * A etapa atual fica em Organization.onboardingStep (retoma após recarregar).
 */
export default function OnboardingPage() {
  const org = useCurrentOrg()
  const routeCtx = useContext(UNSAFE_RouteContext)
  const finishing = useRef(false)
  const [load, setLoad] = useState<'loading'|'ready'|'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let mounted = true
    setLoad('loading')
    void (async () => {
      const context = captureEngineContext()
      const onboarding = await initializeOnboarding()
      const [agents, billing] = await Promise.all([loadAgents(context), loadBilling(context)])
      context.assertCurrent()
      publishSlice(context, { agents, ...billing })
      if (onboarding.state.conversationId) await refreshConversation(onboarding.state.conversationId)
      if (mounted) setLoad('ready')
    })().catch(() => { if (mounted) setLoad('error') })
    return () => { mounted = false }
  }, [org?.id, attempt])
  if (!org) return null
  if (load === 'ready' && org.onboardingCompletionConfirmed && !finishing.current) return <Navigate to="/app" replace />
  return (
    <>
      <UNSAFE_RouteContext.Provider value={{ ...routeCtx, outlet: <OnboardingBackdrop /> }}>
        <AppShell />
      </UNSAFE_RouteContext.Provider>
      {load === 'ready' ? <OnboardingFlow onFinishing={() => (finishing.current = true)} /> : (
        <Dialog open><DialogContent hideClose className="max-w-[640px] p-5 sm:px-10 sm:py-8">
          <DialogTitle className="sr-only">Configurar Kloel</DialogTitle>
          {load === 'error' ? <PageLoadError onRetry={() => setAttempt(value => value + 1)} /> : <PageSkeleton rows={4} />}
        </DialogContent></Dialog>
      )}
    </>
  )
}

/**
 * Página ao fundo do primeiro acesso, como em [441]–[452]: título "Início" (a referência mostra "Home", sem tradução) e um único
 * cartão "Histórico" com o período (14 dias), contadores "Ligações"/"Minutos" à direita e a linha do gráfico vazia com o eixo de datas.
 */
function OnboardingBackdrop() {
  const days = useMemo(() => {
    const end = new Date()
    end.setHours(12, 0, 0, 0)
    return Array.from({ length: 14 }, (_, i) => new Date(end.getTime() - (13 - i) * 86_400_000))
  }, [])
  const long = (d: Date) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
  const short = (d: Date) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
  const ticks = [1, 4, 7, 10, 13].map((i) => days[i])
  return (
    <div className="pointer-events-none select-none px-4 pb-8 pt-10 sm:px-8 lg:pt-[76px]" aria-hidden>
      <div className="flex w-full flex-col gap-4">
        <span className="text-[32px] font-semibold leading-10 tracking-tight">Início</span>
        <div className="flex h-[404px] flex-col overflow-hidden rounded-xl border shadow-sm">
          <div className="flex h-[104px] shrink-0 border-b">
            <div className="min-w-0 flex-1 px-6 pt-[22px]">
              <div className="truncate text-2xl font-semibold tracking-tight">Histórico</div>
              <div className="truncate text-muted-foreground">{long(days[0])} – {long(days[13])}</div>
            </div>
            {[['Ligações', '0', 'w-[114px]'], ['Minutos', '0', 'w-[109px]']].map(([l, v, w]) => (
              <div key={l} className={cn('hidden shrink-0 flex-col gap-2 border-l px-8 pt-6 sm:flex', w)}>
                <span className="text-xs text-muted-foreground">{l}</span>
                <span className="text-3xl font-bold tabular-nums">{v}</span>
              </div>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="absolute inset-x-9 bottom-[54px] border-t-2 border-blue-500" />
            <div className="absolute inset-x-9 bottom-[24px] flex justify-between text-xs text-muted-foreground">
              {ticks.map((d) => (
                <span key={d.toISOString()}>{short(d)}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OnboardingFlow({ onFinishing }: { onFinishing: () => void }) {
  const navigate = useNavigate()
  const org = useCurrentOrg()!
  const subs = useCollection('subscriptions')
  const patchOrg = useStore((s) => s.patchOrg)
  const [plansClosed, setPlansClosed] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const onboardingAgent = useEntity('agents', org.onboardingAgentId)
  const hasActive = subs.some((s) => s.status === 'active')
  const cart = org.onboardingCart ?? []

  const storedStep = (ALL_STEPS.includes(org.onboardingStep as OStep) ? org.onboardingStep : 'plan') as OStep
  let step = storedStep
  if ((step === 'billing' || step === 'payment') && cart.length === 0) step = 'plan'
  if (POST_PAYMENT.includes(step) && !hasActive) step = 'plan'
  // Já existe assinatura ativa (ex.: pagamento concluído em outra aba/rota): os planos não são oferecidos de novo —
  // o primeiro acesso segue para o assistente de configuração 1/5 (spec 05 E).
  const prePayment = step === 'plan' || step === 'billing' || step === 'payment'
  if (prePayment && hasActive) step = 'name'
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = (action: () => Promise<unknown>) => {
    if (running.current) return
    running.current = true; setBusy(true)
    void action().catch(error => toast.error(error instanceof Error ? error.message : 'Não foi possível salvar a configuração.'))
      .finally(() => { running.current = false; setBusy(false) })
  }
  const persistStep = async (next: OStep, extra: Partial<Organization> = {}) => {
    const fields = { step: next,
      ...('sector' in extra ? { sector: extra.sector?.trim() || null } : {}),
      ...('size' in extra ? { size: extra.size?.trim() || null } : {}),
      ...('referralSource' in extra ? { referralSource: extra.referralSource?.trim() || null } : {}) }
    await saveOnboardingFields(fields)
    const { sector: _sector, size: _size, referralSource: _referral, ...draft } = extra
    patchOrg(draft)
  }
  const setStep = (next: OStep, extra: Partial<Organization> = {}) => run(() => persistStep(next, extra))
  const setCart = (value: CartItem[]) => patchOrg({ onboardingCart: value })
  const finish = (path: string) => run(async () => {
    await saveOnboardingFields({ step: 'done' }, true)
    onFinishing()
    patchOrg({ onboardingAddMode: undefined, onboardingCart: undefined })
    toast.success('Tudo pronto!', { description: 'Seu primeiro acesso foi concluído. Bem-vindo ao Kloel AI.' })
    navigate(path, { replace: true })
  })
  const startTestCall = () => setCallOpen(true)

  const isPlan = step === 'plan'
  const isCheckout = step === 'billing' || step === 'payment'
  // Durante a ligação de teste o modal do primeiro acesso sai da frente (a ligação flutua sobre o app, como na referência [462]).
  const open = !(isPlan && plansClosed) && !callOpen && !org.onboardingCompletionConfirmed

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => isPlan && !o && setPlansClosed(true)}>
        <DialogContent
          hideClose={!isPlan}
          // [441]: "×" cinza-400 de 20px com traço fino, a ~22px do canto do modal.
          closeClassName="right-5 top-5 text-gray-400 opacity-100 hover:text-foreground sm:right-[22px] sm:top-[21px] [&>svg]:h-5 [&>svg]:w-5 [&>svg]:stroke-[1.5]"
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            if (isPlan) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (!isPlan) e.preventDefault()
          }}
          className={cn(
            // coluna minmax(0,1fr): textos truncados (ex.: item anual do carrinho) não alargam o modal além da tela em 390 px
            'max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] grid-cols-[minmax(0,1fr)] gap-y-0 rounded-2xl sm:max-h-[calc(100dvh-2rem)]',
            isPlan && 'max-w-[1024px] p-5 pt-14 sm:px-10 sm:pb-8 sm:pt-9',
            isCheckout && 'max-w-[640px] p-5 sm:px-10 sm:py-8',
            !isPlan && !isCheckout && 'flex h-[calc(100dvh-1rem)] max-w-[1152px] flex-col overflow-hidden p-0 sm:h-[calc(100dvh-2rem)] sm:max-h-[824px]',
          )}
          data-testid={`onboarding-${step}`} aria-busy={busy}
        >
          {isPlan && <PlansStep cart={cart} onSelect={(item) => {
            const next = [...cart.filter((c) => c.product !== item.product), item]
            setStep('billing', { onboardingCart: next, onboardingAddMode: false })
          }} onBackToCart={() => setStep('billing', { onboardingAddMode: false })} />}
          {step === 'billing' && (
            <>
              <DialogTitle className="sr-only">Dados de faturamento</DialogTitle>
              <BillingDetailsStep
                cart={cart}
                discountCode={org.onboardingDiscount}
                onDiscountChange={(code) => patchOrg({ onboardingDiscount: code })}
                onRemoveItem={(p) => setCart(cart.filter((c) => c.product !== p))}
                onAddProduct={() => setStep('plan', { onboardingAddMode: true, onboardingTab: CORE_PRODUCTS.find((p) => !cart.some((c) => c.product === p)) ?? org.onboardingTab })}
                onBack={() => setStep('plan', { onboardingAddMode: false })}
                onContinue={() => setStep('payment')}
                keepDraftOnBack
              />
            </>
          )}
          {step === 'payment' && (
            <>
              <DialogTitle className="sr-only">Pagamento</DialogTitle>
              <PaymentStep
                cart={cart}
                discountCode={org.onboardingDiscount}
                onBack={() => setStep('billing')}
                onPaid={() => {
                  if (!useStore.getState().db.subscriptions.some(row => row.status === 'active')) { toast.error('A assinatura ativa ainda não foi confirmada. Consulte o faturamento antes de continuar.'); return }
                  setStep('name', { onboardingCart: [], onboardingDiscount: undefined, onboardingAddMode: false })
                }}
              />
            </>
          )}
          {!isPlan && !isCheckout && <SetupWizard step={step} setStep={persistStep} finish={finish} onTestCall={startTestCall} onAssign={() => setAssignOpen(true)} />}
        </DialogContent>
      </Dialog>

      {onboardingAgent && (
        <>
          <TestCallDialog
            agent={onboardingAgent}
            open={callOpen}
            onOpenChange={setCallOpen}
            onFinished={(conversationId) => {
              if (conversationId) run(async () => { await refreshConversation(conversationId); await saveOnboardingFields({ conversationId }) })
            }}
          />
          <AssignNumberDialog agent={onboardingAgent} open={assignOpen} onOpenChange={setAssignOpen} />
        </>
      )}

      {isPlan && plansClosed && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 md:left-[var(--sidebar-offset)]">
          <div className="flex max-w-full flex-wrap items-center gap-3 rounded-2xl border bg-background p-2 pl-4 shadow-lg" data-testid="plans-closed-bar">
            <ShoppingCart className="h-4 w-4 text-brand" />
            <span className="text-sm">Escolha um plano para ativar sua conta Kloel AI.</span>
            <Button size="sm" variant="brand" onClick={() => setPlansClosed(false)}>Ver planos</Button>
          </div>
        </div>
      )}
    </>
  )
}

/* ------------------------------- Planos ------------------------------- */

function PlansStep({ cart, onSelect, onBackToCart }: { cart: CartItem[]; onSelect: (item: CartItem) => void; onBackToCart: () => void }) {
  const navigate = useNavigate()
  const org = useCurrentOrg()!
  const patchOrg = useStore((s) => s.patchOrg)
  // Plano/ciclo escolhidos no cadastro público (/criar-conta?produto=&plano=&ciclo= → Organization.signupIntent).
  const intent = signupPlanIntentOf(org)
  const tab: ProductKey = CORE_PRODUCTS.includes(org.onboardingTab as ProductKey) ? (org.onboardingTab as ProductKey) : intent?.product ?? 'voice'
  const interval: BillingInterval = (org.onboardingAnnual ?? intent?.interval === 'annual') ? 'annual' : 'monthly'
  const addMode = !!org.onboardingAddMode && cart.length > 0
  const totals = cartTotals(cart)
  const inCart = cart.find((c) => c.product === tab)
  const intentPlan = intent?.tier ? planOf(intent.product, intent.tier) : undefined
  const showIntent = !!intent && !!intentPlan && !addMode && cart.length === 0 && !org.signupIntentDismissed
  const intentBuyable = !!intentPlan && intentPlan.monthly != null
  const [scaleOpen, setScaleOpen] = useState(false)
  return (
    <div className="flex flex-col items-center gap-6">
      <DialogTitle className="sr-only">Escolha seu plano</DialogTitle>
      {showIntent && intent && intentPlan && (
        <div className="-mt-6 flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-brand/30 bg-brand/5 px-4 py-2.5 text-sm sm:-mt-2" data-testid="signup-intent-banner">
          <PackageCheck className="h-4 w-4 shrink-0 text-brand" />
          <span className="min-w-0 flex-1">
            Plano escolhido no cadastro: <b className="font-semibold">{intentPlan.name}</b> · {PRODUCT_TAB_LABEL[intent.product]}
            {intentBuyable ? ` · cobrança ${interval === 'annual' ? 'anual' : 'mensal'}` : ' · preço individual'}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => patchOrg({ signupIntentDismissed: true })} className="h-8 rounded-md px-2.5 text-muted-foreground hover:bg-background hover:text-foreground">
              Escolher outro plano
            </button>
            {intentBuyable ? (
              <Button
                size="sm"
                variant="brand"
                className="h-8"
                onClick={() => onSelect({ product: intent.product, tier: intent.tier as CartItem['tier'], interval })}
                data-testid="signup-intent-continue"
              >
                Continuar com {intentPlan.name}
              </Button>
            ) : (
              <Button size="sm" variant="brand" className="h-8" onClick={() => setScaleOpen(true)}>
                Configurar plano
              </Button>
            )}
          </span>
        </div>
      )}
      {intent && !intentBuyable && <ScaleConfigDialog product={intent.product} open={scaleOpen} onOpenChange={setScaleOpen} interval={interval} />}
      {addMode && (
        <div className="-mt-6 flex w-full max-w-4xl flex-wrap items-center gap-3 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm sm:-mt-2">
          <button type="button" onClick={onBackToCart} className="inline-flex items-center gap-1.5 font-medium hover:underline">
            <ArrowLeft className="h-4 w-4" /> Voltar ao carrinho
          </button>
          <span className="ml-auto text-muted-foreground">
            {cart.length} {cart.length === 1 ? 'produto' : 'produtos'} no carrinho · {money(totals.total)}
          </span>
        </div>
      )}
      <div role="tablist" aria-label="Produto" className="inline-flex max-w-full items-center overflow-x-auto rounded-xl bg-muted p-1">
        {CORE_PRODUCTS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={tab === p}
            onClick={() => patchOrg({ onboardingTab: p })}
            className={cn('relative h-8 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors', tab === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            {PRODUCT_TAB_LABEL[p]}
            {cart.some((c) => c.product === p) && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand" aria-label="no carrinho" />}
          </button>
        ))}
      </div>
      {/* [441]: abas 328×40 (p-1 + abas h-8 px-3, 14px); 32px até o banner de garantia. */}
      <GuaranteeBanner className="mt-2 max-w-full" />
      <PlanCards
        product={tab}
        interval={interval}
        onSelect={(tier) => onSelect({ product: tab, tier: tier as CartItem['tier'], interval })}
        onIntervalChange={(i) => patchOrg({ onboardingAnnual: i === 'annual' })}
        variant="onboarding"
        selectedTier={inCart && inCart.interval === interval ? inCart.tier : undefined}
        highlightTier={showIntent && intent?.product === tab ? intent.tier : undefined}
        className="mt-2 pb-4"
      />
      {/* [441]: pílula 321×49 a 40 px dos cartões — bg #F5F5F5 com sombra leve, avatar 32 px, texto 14 px semibold. */}
      <button
        type="button"
        onClick={() => navigate('/agendar-demo')}
        className="inline-flex items-center gap-2 rounded-xl bg-[#f5f5f5] px-4 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-muted"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-brand">
          <UserRound className="h-4 w-4" />
        </span>
        Reservar uma demonstração gratuita
      </button>
    </div>
  )
}

/* ------------------------ Assistente de configuração ------------------------ */

/**
 * Moldura do assistente 1/5…5/5. Como nas referências [454]/[455], cabeçalho, conteúdo e rodapé rolam juntos
 * (o rodapé fica no fim do conteúdo, encostado na base quando o conteúdo é curto). No celular o rodapé fica fixo.
 */
function WizardFrame({ title, index, onBack, action, children }: { title: string; index: number; onBack?: () => void; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="wizard-scroll">
      <div className="shrink-0 px-6 pt-6 sm:px-8 sm:pt-8">
        <DialogTitle className="text-xl font-semibold">{title}</DialogTitle>
      </div>
      <div className="flex-1 px-6 sm:px-8">
        {/* [453]–[458]: pergunta a 152px do topo do modal (80px abaixo do cabeçalho). */}
        <div className="mx-auto w-full max-w-[512px] pb-6 pt-10 sm:pb-0 sm:pt-20">{children}</div>
      </div>
      <div className="sticky bottom-0 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t bg-background px-6 py-4 sm:static sm:border-t-0 sm:px-8 sm:pb-8 sm:pt-[18px]">
        <div>
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Voltar" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border bg-background hover:bg-accent">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3" aria-label={`Etapa ${index} de 5`}>
          <div className="h-2 w-14 overflow-hidden rounded-full bg-muted sm:w-[100px]">
            {/* [453]: preenchimento com ponta reta (só a trilha é arredondada); contador de 12px. */}
            <div className="h-full bg-brand transition-[width] duration-300" style={{ width: `${(index / 5) * 100}%` }} />
          </div>
          <span className="text-xs text-brand">{index}/5</span>
        </div>
        <div className="flex justify-end">{action}</div>
      </div>
    </div>
  )
}

function ChoiceCard({ label, icon: Icon, selected, onClick }: { label: string; icon: ComponentType<{ className?: string }>; selected?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={label}
      className={cn(
        'flex h-24 min-w-0 flex-col items-start justify-between rounded-[10px] border bg-background p-4 text-left text-sm font-medium transition-colors hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        selected && 'border-brand/70 ring-2 ring-brand/20',
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="w-full truncate">{label}</span>
    </button>
  )
}

function SetupWizard({
  step,
  setStep,
  finish,
  onTestCall,
  onAssign,
}: {
  step: OStep
  setStep: (s: OStep, extra?: Partial<Organization>) => Promise<void>
  finish: (path: string) => void
  onTestCall: () => void
  onAssign: () => void
}) {
  const org = useCurrentOrg()!
  const user = useCurrentUser()
  const profileCommands = useRef<ReturnType<typeof createProfileCommands> | null>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = (action: () => Promise<unknown>) => {
    if (running.current) return
    running.current = true; setBusy(true)
    void action().catch(error => toast.error(error instanceof Error ? error.message : 'Não foi possível salvar a configuração.'))
      .finally(() => { running.current = false; setBusy(false) })
  }
  const agentFromStore = useEntity('agents', org.onboardingAgentId)
  const subs = useCollection('subscriptions')
  const kind = useMemo(() => onboardingAssistantKind(subs), [subs])
  const [first, setFirst] = useState(user?.firstName ?? '')
  const [last, setLast] = useState(user?.lastName ?? '')
  const [nameError, setNameError] = useState(false)
  const index = WIZARD_INDEX[step] ?? 1

  const ensureAgent = async (): Promise<Agent> => {
    const sector = labelOf(SECTORS, org.sector)
    const size = labelOf(COMPANY_SIZES, org.size)
    const companyInfo = `${org.name}${sector ? ` atua no setor ${sector}` : ''}${size ? ` e tem ${size === 'Só eu' ? 'um único colaborador' : `${size} colaboradores`}` : ''}. Informações criadas no primeiro acesso — complete em Assistentes › Conhecimento.`
    const agent =
      kind.type === 'chat'
        ? // Assistente de chat no mesmo modelo do seed agt_maria (type 'chat' + webchat), só nos canais contratados.
          makeAgent(org.id, ONBOARDING_AGENT_NAME, 'chat', org.name, {
            companyInfo,
            channels: kind.chatChannels,
            webchat: { color: '#585DF5', position: 'right', title: `${ONBOARDING_AGENT_NAME} – ${org.name}`, welcome: `Olá! Eu sou a ${ONBOARDING_AGENT_NAME}, assistente virtual da ${org.name}. Como posso ajudar?`, website: org.website },
          })
        : makeAgent(org.id, ONBOARDING_AGENT_NAME, 'voice', org.name, { companyInfo })
    agent.technical.preciseExtraction = []
    return ensureOnboardingAgent(agent)
  }

  if (step === 'name') {
    const submit = (e: FormEvent) => {
      e.preventDefault()
      if (!first.trim()) {
        setNameError(true)
        return
      }
      run(async () => {
        const context = captureEngineContext(), userId = engineSession.getSnapshot().data!.identity.userId
        if (!profileCommands.current) profileCommands.current = createProfileCommands(context, await accountClient(context, userId).profile())
        const profile = await accountClient(context, userId).profile()
        const saved = await profileCommands.current.save({ ...profile, firstName: first.trim(), lastName: last.trim() })
        context.assertCurrent()
        useStore.getState().patchUser({ firstName: saved.firstName, lastName: saved.lastName })
        await setStep('sector')
      })
    }
    return (
      <form onSubmit={submit} noValidate className="contents" aria-busy={busy}>
        <WizardFrame
          title="Bem-vindo!"
          index={1}
          action={
            <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary pl-4 pr-2 text-[15px] font-medium text-primary-foreground hover:bg-primary/90">
              Continuar
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/15"><CornerDownLeft className="h-3.5 w-3.5" /></span>
            </button>
          }
        >
          <h3 className="mb-[34px] text-2xl font-normal">Vamos personalizar o Kloel em 1 minuto.</h3>
          {/* [453]: rótulos 14px medium a 6px do campo; erro em medium. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ob-first" className={cn('font-medium leading-5', nameError && 'text-destructive')}>Nome</Label>
              <Input
                id="ob-first"
                autoFocus
                value={first}
                onChange={(e) => {
                  setFirst(e.target.value)
                  if (e.target.value.trim()) setNameError(false)
                }}
                aria-invalid={nameError}
                aria-describedby={nameError ? 'ob-first-error' : undefined}
                className={cn('h-10 text-base', nameError && 'border-2 border-destructive focus-visible:ring-0')}
              />
              {nameError && <p id="ob-first-error" className="-mt-0.5 text-sm font-medium text-destructive">Este campo é obrigatório</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ob-last" className="font-medium leading-5">Sobrenome</Label>
              <Input id="ob-last" value={last} onChange={(e) => setLast(e.target.value)} className="h-10 text-base" />
            </div>
          </div>
        </WizardFrame>
      </form>
    )
  }

  if (step === 'sector') {
    return (
      <WizardFrame title="Configurar Kloel" index={2} onBack={() => run(() => setStep('name'))}>
        <h3 className="mb-8 text-2xl font-normal">Em qual setor você atua?</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {SECTORS.map((s) => (
            <ChoiceCard key={s.value} label={s.label} icon={s.icon} selected={org.sector === s.value} onClick={() => run(() => setStep('size', { sector: s.value }))} />
          ))}
        </div>
      </WizardFrame>
    )
  }

  if (step === 'size') {
    return (
      <WizardFrame title="Configurar Kloel" index={3} onBack={() => run(() => setStep('sector'))}>
        <h3 className="mb-8 text-2xl font-normal">Quantos colaboradores sua empresa tem?</h3>
        <div className="flex flex-wrap gap-2">
          {COMPANY_SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={org.size === s.value}
              onClick={() => run(() => setStep('referral', { size: s.value }))}
              className={cn('h-10 rounded-[10px] border bg-background px-4 text-sm font-medium transition-colors hover:border-brand/50', org.size === s.value && 'border-brand/70 ring-2 ring-brand/20')}
            >
              {s.label}
            </button>
          ))}
        </div>
      </WizardFrame>
    )
  }

  if (step === 'referral') {
    return (
      <WizardFrame title="Configurar Kloel" index={4} onBack={() => run(() => setStep('size'))}>
        <h3 className="mb-8 text-2xl font-normal">Como você ficou sabendo de nós?</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {REFERRAL_SOURCES.map((s) => (
            <ChoiceCard
              key={s.value}
              label={s.label}
              icon={s.icon}
              selected={org.referralSource === s.value}
              onClick={() => run(async () => {
                await setStep('referral', { referralSource: s.value })
                await ensureAgent()
                await setStep('done')
              })}
            />
          ))}
        </div>
      </WizardFrame>
    )
  }

  if (step === 'done') {
    const isChat = (agentFromStore?.type ?? kind.type) === 'chat'
    const chatChannels = agentFromStore?.type === 'chat' ? (agentFromStore.channels.filter((c) => c !== 'phone') as ChatChannel[]) : kind.chatChannels
    return (
      <WizardFrame title="Concluído" index={5} onBack={() => run(() => setStep('referral'))}>
        <h3 className="mb-8 text-2xl font-normal">Seu primeiro assistente está pronto!</h3>
        <p className="mb-[30px] text-sm text-muted-foreground">
          {isChat
            ? 'Recomendamos um primeiro chat de teste, no qual você já pode fazer perguntas simples sobre a sua empresa:'
            : 'Recomendamos uma primeira ligação de teste, na qual você já pode fazer perguntas simples sobre a sua empresa:'}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => run(async () => {
              await ensureAgent()
              await setStep('test-call')
            })}
            className="flex min-h-[128px] flex-col justify-between gap-6 rounded-xl bg-brand p-4 text-left text-white transition-colors hover:bg-[#464ac4]"
            data-testid={isChat ? 'onboarding-start-test-chat-card' : 'onboarding-start-test-call-card'}
          >
            {isChat ? <MessageCircle className="h-5 w-5" /> : <Headset className="h-5 w-5" />}
            <span>
              <span className="block text-sm font-medium">{isChat ? 'Iniciar chat de teste' : 'Iniciar ligação de teste'}</span>
              <span className="mt-1 block text-xs text-white/85">
                {isChat ? `Com seu assistente de atendimento no ${channelsText(chatChannels)}` : 'Com seu assistente pessoal de suporte ao cliente'}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => run(async () => {
              const a = await ensureAgent()
              finish(`/app/agents/${a.id}`)
            })}
            className="flex min-h-[128px] flex-col justify-between gap-6 rounded-xl border bg-background p-4 text-left transition-colors hover:border-brand/50"
          >
            {isChat ? <Bot className="h-5 w-5" /> : <Headset className="h-5 w-5" />}
            <span>
              <span className="block text-sm font-medium">Configurar assistente</span>
              <span className="mt-1 block text-xs text-muted-foreground">Expanda seu novo assistente</span>
            </span>
          </button>
        </div>
        {!isChat && kind.mixed && <ChannelNote channels={kind.chatChannels} finish={finish} className="mt-6" />}
      </WizardFrame>
    )
  }

  if (agentFromStore?.type === 'chat') return <TestChatStep agent={agentFromStore} onBack={() => run(() => setStep('done'))} finish={finish} />
  return <TestCallStep agent={agentFromStore} chatChannels={kind.mixed ? kind.chatChannels : []} onBack={() => run(() => setStep('done'))} finish={finish} onTestCall={onTestCall} onAssign={onAssign} />
}

/** Compra mista (Telefone IA + chat): o assistente criado atende ligações; os canais de chat contratados ganham um aviso com atalho. */
function ChannelNote({ channels, finish, className }: { channels: ChatChannel[]; finish: (path: string) => void; className?: string }) {
  if (!channels.length) return null
  const products = channels.map((c) => (c === 'whatsapp' ? 'WhatsApp IA' : 'Chatbot de IA')).join(' e ')
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border bg-muted/40 px-4 py-3 text-sm', className)} data-testid="onboarding-channel-note">
      <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
      <p className="min-w-0 flex-1 text-muted-foreground">
        Você também contratou <b className="font-medium text-foreground">{products}</b>. Este primeiro assistente atende ligações; para responder no {channelsText(channels)}, crie um assistente de chat em Assistentes.{' '}
        <button type="button" onClick={() => finish('/app/agents')} className="font-medium text-foreground underline underline-offset-2">
          Abrir Assistentes
        </button>
      </p>
    </div>
  )
}

/* --------------------------- Ligação de teste --------------------------- */

function TestCallStep({ agent, chatChannels, onBack, finish, onTestCall, onAssign }: { agent: Agent | undefined; chatChannels: ChatChannel[]; onBack: () => void; finish: (path: string) => void; onTestCall: () => void; onAssign: () => void }) {
  const org = useCurrentOrg()!
  const numbers = useCollection('phoneNumbers')
  const conversation = useEntity('conversations', org.onboardingTestConversationId)
  const assigned = useMemo(() => numbers.filter((n) => agent && n.agentId === agent.id), [numbers, agent])
  if (!agent) {
    return (
      <WizardFrame title="Ligação de teste" index={5} onBack={onBack}>
        <p className="text-sm text-muted-foreground">Assistente não encontrado. Volte uma etapa para recriá-lo.</p>
      </WizardFrame>
    )
  }
  const voice = voiceById(agent.voiceId)
  return (
    <WizardFrame
      title="Ligação de teste"
      index={5}
      onBack={onBack}
      action={
        <button type="button" onClick={() => finish('/app')} className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:px-4 sm:text-[15px]">
          Ir para o painel
        </button>
      }
    >
      <h3 className="mb-4 text-2xl font-normal">Teste seu assistente agora</h3>
      <p className="mb-6 text-sm text-muted-foreground">
        A ligação de teste acontece no navegador. Pergunte, por exemplo, o horário de atendimento ou os serviços da {org.name}. Depois, a conversa fica disponível em Conversas.
      </p>
      <div className="rounded-xl border p-4" data-testid="onboarding-agent-card">
        <div className="flex items-center gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white', voice.color)}>{voice.name[0]}</span>
          <div className="min-w-0">
            <div className="truncate font-medium">{agent.name}</div>
            <div className="truncate text-sm text-muted-foreground">Assistente de voz · Voz {voice.name} · {languageLabel(agent.language)}</div>
          </div>
        </div>
        <p className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-sm">“{agent.greeting}”</p>
        <div className="mt-3 text-xs text-muted-foreground">
          {assigned.length ? `Número atribuído: ${assigned.map((n) => n.number).join(', ')}` : 'Nenhum número atribuído — a ligação de teste usa o navegador.'}
        </div>
      </div>
      {conversation && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="onboarding-call-result">
          <CircleCheck className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">Ligação de teste registrada em Conversas ({conversation.durationSec == null ? '—' : Math.round(conversation.durationSec / 60)} min).</span>
          <button type="button" onClick={() => finish(`/app/inbox/${conversation.id}`)} className="shrink-0 font-medium underline underline-offset-2">Ver conversa</button>
        </div>
      )}
      <div className="mt-6 flex justify-center">
        <div className="flex items-center gap-1 rounded-2xl border border-slate-700/70 bg-[#16171B] p-1 shadow-[0px_6px_18px_rgba(15,18,28,0.35)]">
          <DarkBarButton onClick={onAssign}>
            <CirclePlus className="h-4 w-4" /> Atribuir número
          </DarkBarButton>
          <DarkBarPrimary onClick={onTestCall} data-testid="onboarding-start-test-call">
            <Headset className="h-4 w-4" /> Testar ligação
          </DarkBarPrimary>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        <Info className="mr-1.5 inline h-3.5 w-3.5 align-[-3px]" />
        Você pode testar de novo a qualquer momento na página do assistente.
      </p>
      <ChannelNote channels={chatChannels} finish={finish} className="mt-6" />
    </WizardFrame>
  )
}

/* ----------------------------- Chat de teste ----------------------------- */

const fmtT = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

/** The existing test flow uses the private agent chat and confirmed conversation records. */
export function TestChatStep({ agent, onBack, finish }: { agent: Agent; onBack: () => void; finish: (path: string) => void }) {
  const org = useCurrentOrg()!
  const identity = useEngineSession()
  const chatRef = useRef<CascaChatSession | null>(null)
  const bookingRef = useRef<PrivateChatBooking | null>(null)
  const [bookingChoices, setBookingChoices] = useState<PrivateBookingChoice[]>([])
  const [bookingError, setBookingError] = useState('')
  const [bookingView, setBookingView] = useState(0)
  const operationBusy = useRef<number | null>(null)
  const conversation = useEntity('conversations', org.onboardingTestConversationId)
  const chatChannels = agent.channels.filter((c) => c !== 'phone') as ChatChannel[]
  const greeting = agent.greeting
  const [lines, setLines] = useState<TranscriptLine[]>(() => [{ t: 0, speaker: 'assistant', text: greeting }])
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [failure, setFailure] = useState<{ message: string; error: string } | null>(null)
  /** Com a conversa de teste já salva (inclusive após recarregar), o painel do chat fica recolhido até "Novo chat de teste". */
  const [chatOpen, setChatOpen] = useState(!conversation)
  const linesRef = useRef(lines)
  linesRef.current = lines
  const startedAt = useRef(Date.now())
  const session = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ++session.current
    chatRef.current = null
    bookingRef.current = null
    operationBusy.current = null
    setBookingChoices([]); setBookingError(''); setFailure(null); setTyping(false); setText('')
    setLines([{ t: 0, speaker: 'assistant', text: greeting }])
    setChatOpen(!conversation)
    startedAt.current = Date.now()
    try {
      const context = captureEngineContext(), expected = engineSession.getSnapshot().data!.identity.context
      context.assertCurrent()
      if (context.tenantId !== org.id) throw Error('A organização mudou. Atualize a tela.')
      bookingRef.current = createPrivateChatBooking(context, expected, agent.id, window.sessionStorage)
      chatRef.current = createCascaChatSession(context, expected, window.sessionStorage, agent.id, { webSearch: agent.webSearch.enabled })
      if (chatRef.current.pending) setFailure({ message: '', error: 'Há uma resposta de chat aguardando consulta. Consulte antes de enviar outra mensagem.' })
    } catch (error) { setBookingError(error instanceof Error ? error.message : 'Não foi possível consultar as reservas.') }
    setBookingView(value => value + 1)
    return () => { ++session.current; chatRef.current = null; bookingRef.current = null }
  }, [agent.id, org.id, identity.generation, identity.phase])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines, typing, failure, bookingChoices, bookingError])

  const elapsed = () => Math.max(0, Math.round((Date.now() - startedAt.current) / 1000))
  const push = (l: TranscriptLine) => setLines((prev) => [...prev, l])
  const answered = lines.some((l) => l.speaker === 'caller') && lines.filter((l) => l.speaker === 'assistant').length > 1

  const ask = async (message: string) => {
    if (operationBusy.current !== null) return
    const my = ++session.current
    operationBusy.current = my
    setFailure(null)
    setTyping(true)
    try {
      const context = captureEngineContext(), expected = engineSession.getSnapshot().data!.identity.context
      const booking = bookingRef.current
      if (!booking) throw Error('Atualize a tela para iniciar o chat com sua sessão atual.')
      chatRef.current ??= createCascaChatSession(context, expected, window.sessionStorage, agent.id, { webSearch: agent.webSearch.enabled })
      const reply = chatRef.current.pending ? await chatRef.current.consult() : await chatRef.current.send(message)
      context.assertCurrent()
      if (my !== session.current) return
      push({ t: elapsed(), speaker: 'assistant', text: reply.text })
      // The message is already confirmed. A choice/journal error must never enable replaying it.
      try { setBookingChoices(booking.accept(reply)); setBookingError('') }
      catch (error) { setBookingChoices([]); setBookingError(error instanceof Error ? error.message : 'Não foi possível consultar as opções de reserva.') }
    } catch (error) {
      if (my === session.current) setFailure({ message, error: error instanceof Error ? error.message : 'Não foi possível consultar a resposta.' })
    } finally { if (my === session.current) setTyping(false); if (operationBusy.current === my) operationBusy.current = null }
  }

  const send = (e: FormEvent) => {
    e.preventDefault()
    const msg = text.trim()
    if (!msg || typing || failure || operationBusy.current !== null) return
    setText('')
    push({ t: elapsed(), speaker: 'caller', text: msg })
    void ask(msg)
  }

  const restart = () => {
    if (operationBusy.current !== null) return
    try { if (chatRef.current?.pending) throw Error('Consulte a resposta pendente antes de começar outro teste.') } catch (error) { toast.error(error instanceof Error ? error.message : 'Consulte a resposta pendente.'); return }
    chatRef.current = null
    session.current += 1
    setBookingChoices([])
    setBookingError('')
    setBookingView(value => value + 1)
    startedAt.current = Date.now()
    setLines([{ t: 0, speaker: 'assistant', text: greeting }])
    setTyping(false)
    setFailure(null)
    setText('')
  }

  const save = async () => {
    if (!answered || operationBusy.current !== null) return
    const my = ++session.current
    operationBusy.current = my; setTyping(true)
    try {
      const chat = chatRef.current
      if (!chat?.conversationId || chat.pending) throw Error('Consulte a resposta antes de encerrar o chat.')
      const context = captureEngineContext(), api = createConversationService(context)
      const current = await api.get(chat.conversationId)
      if (current.conversation.agentId !== agent.id || current.conversation.channel !== 'webchat') throw Error('O chat retornado não corresponde a este teste.')
      if (current.conversation.status !== 'closed') await api.update(current, { status: 'closed' })
      await refreshConversation(chat.conversationId)
      await saveOnboardingFields({ conversationId: chat.conversationId })
      context.assertCurrent()
      if (my !== session.current) return
      setChatOpen(false)
      toast.success('Chat de teste salvo em Conversas')
    } catch (error) { if (my === session.current) toast.error(error instanceof Error ? error.message : 'Não foi possível encerrar o chat.') }
    finally { if (operationBusy.current === my) operationBusy.current = null; if (my === session.current) setTyping(false) }
  }

  return (
    <WizardFrame
      title="Chat de teste"
      index={5}
      onBack={onBack}
      action={
        <button type="button" onClick={() => finish('/app')} className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:px-4 sm:text-[15px]">
          Ir para o painel
        </button>
      }
    >
      <h3 className="mb-4 text-2xl font-normal">Teste seu assistente agora</h3>
      <p className="mb-6 text-sm text-muted-foreground">
        Escreva como um cliente escreveria no {channelsText(chatChannels)}. Pergunte, por exemplo, o horário de atendimento ou os serviços da {org.name}. Ao encerrar, a conversa fica disponível em Conversas.
      </p>
      <div className="rounded-xl border p-4" data-testid="onboarding-agent-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: agent.webchat?.color ?? '#585DF5' }}>
            <MessageCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{agent.name}</div>
            <div className="truncate text-sm text-muted-foreground">Assistente de chat · {chatChannels.map((c) => (c === 'whatsapp' ? 'WhatsApp' : 'Chatbot do site')).join(' + ')} · {languageLabel(agent.language)}</div>
          </div>
        </div>
      </div>

      {conversation && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="onboarding-chat-result">
          <CircleCheck className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">Chat de teste registrado em Conversas ({conversation.transcript.length} mensagens).</span>
          <button type="button" onClick={() => finish(`/app/inbox/${conversation.id}`)} className="shrink-0 font-medium underline underline-offset-2">Ver conversa</button>
        </div>
      )}

      {!chatOpen ? (
        <div className="mt-6 space-y-3">
          {bookingRef.current && <PrivateChatBookingControls key={bookingView} client={bookingRef.current} choices={[]} disabled={typing} />}
          {bookingError && <p role="alert" data-engine-state="error" data-testid="onboarding-booking-error" className="text-sm text-destructive">{bookingError}</p>}
          <div className="flex justify-center">
          <Button type="button" variant="outline" className="gap-2" onClick={() => { restart(); setChatOpen(true) }} data-testid="onboarding-chat-new">
            <MessageCircle className="h-4 w-4" /> Novo chat de teste
          </Button>
          </div>
        </div>
      ) : (
      <div className="mt-4 flex flex-col overflow-hidden rounded-xl border" data-testid="onboarding-test-chat">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">Chat de teste · {agent.name}</p>
        </div>
        <div ref={scrollRef} className="flex h-56 flex-col gap-2 overflow-y-auto px-4 py-3" aria-live="polite">
          {lines.map((l, i) => (
            <div key={i} className={cn('flex', l.speaker === 'caller' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm leading-5', l.speaker === 'caller' ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-muted text-foreground')}>
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
                  {l.speaker === 'caller' ? 'Você' : agent.name} · {fmtT(l.t)}
                </p>
                {l.text}
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex">
              <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm text-muted-foreground">digitando…</div>
            </div>
          )}
          {bookingRef.current && <PrivateChatBookingControls key={bookingView} client={bookingRef.current} choices={bookingChoices} disabled={typing} />}
          {bookingError && <p role="alert" data-engine-state="error" data-testid="onboarding-booking-error" className="text-sm text-destructive">{bookingError}</p>}
          {failure && (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" data-engine-state="error" data-testid="onboarding-chat-error">
              <span className="flex items-start gap-2">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{failure.error}</span>
              </span>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 bg-background" onClick={() => void ask(failure.message)}>
                <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
              </Button>
            </div>
          )}
        </div>
        <form onSubmit={send} className="border-t p-2">
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva uma mensagem…" className="h-9" aria-label="Mensagem do cliente" disabled={!!failure} />
            <Button type="submit" size="icon-sm" className="size-9 shrink-0" aria-label="Enviar" disabled={!text.trim() || typing || !!failure}>
              <Send className="size-4" />
            </Button>
          </div>
        </form>
        <div className="flex flex-col gap-2 border-t p-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-9 flex-1" onClick={restart} disabled={lines.length <= 1 && !failure}>
            Recomeçar
          </Button>
          <Button type="button" className="h-9 flex-1" onClick={() => void save()} disabled={!answered || typing} data-testid="onboarding-chat-save">
            Encerrar e salvar em Conversas
          </Button>
        </div>
      </div>
      )}
    </WizardFrame>
  )
}
