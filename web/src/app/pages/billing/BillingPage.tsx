import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { services } from '@/services'
import { openStripePortal, reconcileBillingReturn } from '@/services/casca/billing'
import { useOperation } from '@/hooks/useOperation'
import { OperationStatusView } from '@/components/app/misc'
import { Minus, Plus, PhoneCall, PhoneOutgoing, MessageSquare, Phone, Users, Smartphone, ShieldCheck, Info } from 'lucide-react'
import '@/domain/ext/billing'
import '@/domain/ext/mais-b'
import type { ProductKey } from '@/domain/types'
import { ADDONS } from '@/data/catalogs/plans'
import { useStore, useBillingProfile, useCollection, useCurrentOrg, useCurrentRole, useCurrentUser, useDB } from '@/data/store'
import { cn, initials } from '@/lib/utils'
import { PageContainer, PageTitle } from '@/components/app/Page'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { BetaBadge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { WhatsAppIcon } from '@/components/brand/icons'
import { PRODUCT_ORDER, activeSubs, addonPack, addonPlusTooltip, availableLabel, billingPeriods, computeUsage, fonioPlanSlug, money, subscriptionLabel, type UsageItem, type UsageKey } from './lib'
import { ProductIconBox } from './components'

/** Tooltip (i) de "Créditos outbound" — texto da Fonio ao vivo (fonio-live2/K-admin/06). */
const ADDON_INFO: Record<string, string> = {
  outbound: 'Ao fazer ligações ativas, é cobrada em média R$ 0,24 por minuto iniciado, e o crédito é adicionado à sua conta em pacotes de R$ 30 (5 créditos).',
}
/** productType de /add-product na Fonio ("Disponível para adicionar": email-ai, care). */
const addProductType = (p: ProductKey) => (p === 'email' ? 'email-ai' : p)

const SECTION_TITLE = 'text-lg font-semibold'
const GROUP_LABEL = 'mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground'

const ADDON_ICON: Record<string, (p: { className?: string }) => JSX.Element> = {
  'phone-call': (p) => <PhoneCall {...p} />,
  'phone-outgoing': (p) => <PhoneOutgoing {...p} />,
  'message-square': (p) => <MessageSquare {...p} />,
  phone: (p) => <Phone {...p} />,
  users: (p) => <Users {...p} />,
  smartphone: (p) => <Smartphone {...p} />,
  whatsapp: (p) => <WhatsAppIcon className={cn(p.className, 'text-[#25D366]')} />,
}

/** Usage key de cada add-on (para "X de Y em uso"). */
const ADDON_USAGE: Record<string, UsageKey> = {
  minutes: 'minutes', outbound: 'outbound', sms: 'sms', numbers: 'numbers', workspaces: 'workspaces', waNumbers: 'waNumbers',
  waConversations: 'waConversations', chatConversations: 'chatConversations', waActions: 'waActions',
}

const fmtN = (n: number) => n.toLocaleString('pt-BR')

export function IdentityBadge({ status }: { status: 'not_started' | 'pending' | 'verified' | 'action_required' }) {
  const map = {
    not_started: { label: 'Não iniciado', cls: 'border-border bg-background text-foreground' },
    pending: { label: 'Em análise', cls: 'border-transparent bg-amber-500/10 text-amber-700' },
    verified: { label: 'Verificado', cls: 'border-transparent bg-emerald-500/10 text-emerald-700' },
    action_required: { label: 'Ação necessária', cls: 'border-transparent bg-destructive text-destructive-foreground' },
  }[status]
  return <span className={cn('inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', map.cls)}>{map.label}</span>
}

export default function BillingPage() {
  // Carregamento simulado (estado "carregando" + "Simular erro ao carregar a próxima página" do painel de demonstração).
  const load = usePageLoad('billing')
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const reconciliation = useOperation((_progress, sessionId: string) => reconcileBillingReturn(sessionId))
  const portal = useOperation(() => openStripePortal())
  const seenReturn = useRef<string>()
  const returnedSession = search.get('session_id')
  useEffect(() => {
    if (services.simulated || !returnedSession || seenReturn.current === returnedSession) return
    seenReturn.current = returnedSession
    void reconciliation.run(returnedSession)
  }, [returnedSession, reconciliation.run])
  const org = useCurrentOrg()
  const user = useCurrentUser()
  const role = useCurrentRole()
  const canManage = role === 'admin'
  const subs = useCollection('subscriptions')
  const profile = useBillingProfile()
  const patchBilling = useStore((s) => s.patchBilling)
  const db = useDB((d) => d)
  const active = useMemo(() => activeSubs(subs), [subs])
  const available = useMemo(
    () => PRODUCT_ORDER.filter((p) => !active.some((s) => s.product === p)).filter((p) => p === 'email' || p === 'care' || subs.some((s) => s.product === p)),
    [active, subs],
  )
  const periods = useMemo(() => billingPeriods(subs, org?.createdAt), [subs, org?.createdAt])
  const [periodId, setPeriodId] = useState<string | undefined>(undefined)
  const period = periods.find((p) => p.id === periodId) ?? periods[0]!
  const current = periods[0]!
  const usage = useMemo(() => (org ? computeUsage(db, org.id, period, profile) : undefined), [db, org, period, profile])
  const currentUsage = useMemo(() => (org ? computeUsage(db, org.id, current, profile) : undefined), [db, org, current, profile])
  const [identityOpen, setIdentityOpen] = useState(false)

  if (load.isLoading || load.isError) {
    return (
      <PageContainer width="narrow">
        {load.isError ? <PageLoadError onRetry={load.retry} title="Não foi possível carregar Assinatura e faturamento" /> : <PageSkeleton rows={6} />}
      </PageContainer>
    )
  }
  if (!org || !profile || !usage || !currentUsage) return null
  const identity = profile.identity
  const fullName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.email || 'Representante'

  const setAddon = (key: string, qty: number) => {
    if (!services.simulated) { toast.error('A contratação de add-ons ainda não está disponível.'); return }
    patchBilling((b) => ({ ...b, addOns: { ...b.addOns, [key]: Math.max(0, qty) } }))
  }

  return (
    <PageContainer width="narrow">
      <PageTitle className="mb-8">Assinatura e faturamento</PageTitle>
      <OperationStatusView status={reconciliation.status} progress={reconciliation.progress} error={reconciliation.error} onRetry={() => returnedSession && void reconciliation.run(returnedSession)} successText={profile.engineBilling?.catalog.mode === 'test' ? 'Contratação consultada em modo de teste. Nenhuma assinatura de produção foi ativada.' : reconciliation.result?.checkoutStatus === 'complete' ? 'Contratação confirmada pela Stripe.' : 'O pagamento ainda não foi concluído.'} />
      {!canManage && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" /> Somente administradores podem alterar assinaturas, add-ons e dados de cobrança.
        </div>
      )}
      <div className="mb-8 flex flex-col gap-8">
        {/* 1. Portal financeiro */}
        <section>
          <div className={cn(SECTION_TITLE, 'mb-1')}>Portal financeiro</div>
          <div className="text-sm text-muted-foreground">Gerencie seu método de pagamento, endereço de cobrança e veja o histórico de faturas</div>
          <Button variant="outline" className="mt-4 h-10 px-4" onClick={() => services.simulated ? navigate('/app/billing/portal') : void portal.run()} disabled={!canManage || portal.isRunning}>
            Abrir portal financeiro
          </Button>
          <OperationStatusView status={portal.status} progress={portal.progress} error={portal.error} onRetry={() => void portal.run()} successText="Continue no portal financeiro da Stripe." />
        </section>

        {/* 2. Assinaturas */}
        <section className="flex flex-col gap-6">
          <div className={SECTION_TITLE}>Assinaturas</div>
          <div>
            <div className={GROUP_LABEL}>Ativo</div>
            <div className="flex flex-col gap-3">
              {active.length === 0 && <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{profile.engineBilling?.status.subscriptions.length ? 'Consulte o estado da sua assinatura no portal financeiro.' : 'Nenhuma assinatura ativa no momento.'}</div>}
              {active.map((s) => (
                <div key={s.id} className="flex items-center gap-4 rounded-xl border px-4 py-4" data-testid={`sub-${s.product}`}>
                  {s.product === 'whatsapp' ? (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50">
                      <WhatsAppIcon className="h-5 w-5 scale-[1.35] text-[#25D366]" />
                    </div>
                  ) : (
                    <ProductIconBox product={s.product} />
                  )}
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
                    <span className="truncate">{subscriptionLabel(s.product, s.plan)}</span>
                    {s.product === 'email' && <BetaBadge />}
                    {s.interval === 'annual' && <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline">anual</span>}
                    {s.grant && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700" data-testid={`grant-${s.product}`}>Acesso de teste até {new Date(s.grant.expiresAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}</span>}
                  </div>
                  <Button variant="outline" className="h-9 shrink-0 rounded-md px-3" onClick={() => navigate(`/app/change-plan/${fonioPlanSlug(s.product, s.plan)}`)} disabled={!canManage || !!s.grant}>
                    Alterar plano
                  </Button>
                </div>
              ))}
            </div>
          </div>
          {available.length > 0 && (
            <div>
              <div className={GROUP_LABEL}>Disponível para adicionar</div>
              <div className="flex flex-col gap-3">
                {available.map((p: ProductKey) => {
                  const last = subs.filter((s) => s.product === p).sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0]
                  return (
                    <div key={p} className="flex flex-col gap-4 rounded-xl border border-dashed bg-muted/30 px-4 py-4 sm:flex-row sm:items-center" data-testid={`available-${p}`}>
                      <div className="flex min-w-0 flex-1 items-center gap-4">
                        <ProductIconBox product={p} muted />
                        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
                          <span className="truncate">{last && p !== 'email' && p !== 'care' ? subscriptionLabel(p, last.plan) : availableLabel(p)}</span>
                          {p === 'email' && <BetaBadge />}
                          {last && <span className="shrink-0 text-xs font-normal text-muted-foreground">cancelada</span>}
                        </div>
                      </div>
                      <Button className="h-9 w-full rounded-md px-3 sm:w-auto" onClick={() => navigate(`/app/add-product?productType=${addProductType(p)}&returnTo=${encodeURIComponent('/app/billing')}`)} disabled={!canManage}>
                        <Plus className="h-4 w-4" /> Adicionar assinatura
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {/* 3. Add-ons */}
        <section>
          <div className={cn(SECTION_TITLE, 'mb-5')}>Add-ons</div>
          <div className="divide-y rounded-lg border">
            {ADDONS.filter(a => a.key !== 'sms').map((a) => {
              const qty = profile.addOns[a.key] ?? 0
              const u = currentUsage[ADDON_USAGE[a.key]!]
              const Icon = ADDON_ICON[a.icon]!
              const pack = addonPack(a.key)
              const plusTip = addonPlusTooltip(a.key)
              const info = ADDON_INFO[a.key]
              const plusBtn = (
                <button
                  type="button"
                  aria-label="Aumentar"
                  disabled={!canManage}
                  onClick={() => setAddon(a.key, qty + 1)}
                  className="inline-flex h-9 items-center justify-center rounded-md rounded-l-none border border-input bg-background px-3 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )
              return (
                <div key={a.key} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3" data-testid={`addon-${a.key}`}>
                  <div className="flex min-w-[180px] flex-1 items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50">
                      <Icon className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <span>{a.label}</span>
                        {info && (
                          <Tooltip delayDuration={150}>
                            <TooltipTrigger asChild>
                              <button type="button" aria-label={info} className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <Info className="size-3.5" />
                              </button>
                            </TooltipTrigger>
                            {/* K-admin/06: 3 linhas com entrelinha de 20px, largura máx. 320px. */}
                            <TooltipContent side="top" sideOffset={4} className="leading-5">{info}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {services.simulated ? `${u.used ?? '—'} de ${u.quota == null ? 'ilimitado' : u.quota} em uso` : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-4">
                    <div className="flex items-stretch" role="group" aria-label={`Quantidade de ${a.label}`}>
                      <button
                        type="button"
                        aria-label="Diminuir"
                        disabled={qty <= 0 || !canManage}
                        onClick={() => setAddon(a.key, qty - 1)}
                        className="inline-flex h-9 items-center justify-center rounded-md rounded-r-none border border-input bg-background px-3 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                      >
                        {/* [469]: botões h-9 px-3 com ícones de 12px (37px de largura). */}
                        <Minus className="h-3 w-3" />
                      </button>
                      <div className="flex items-center justify-center gap-2 border-y border-input bg-muted px-4 text-sm font-medium tabular-nums shadow-xs" aria-live="polite">
                        {services.simulated ? qty : '—'}
                      </div>
                      {plusTip ? (
                        <Tooltip delayDuration={150}>
                          <TooltipTrigger asChild>{plusBtn}</TooltipTrigger>
                          <TooltipContent side="top">{plusTip}</TooltipContent>
                        </Tooltip>
                      ) : (
                        plusBtn
                      )}
                    </div>
                    <div className="min-w-24 whitespace-nowrap text-right text-sm text-muted-foreground">
                      {services.simulated ? `${money(qty * pack.price)} / mês` : '—'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <Separator className="my-4" />
          <div className="flex items-center justify-between gap-x-6">
            <div>
              <div className="text-sm font-medium">Compra automática de add-ons</div>
              <div className="text-xs text-muted-foreground">
                Quando uma cota incluída é ultrapassada, o add-on correspondente é comprado automaticamente. Por exemplo, se um cliente está em uma ligação após todos os minutos inclusos terem sido consumidos, minutos adicionais são adquiridos para que a chamada não caia.
              </div>
            </div>
            <Switch checked={profile.autoBuyAddOns} onCheckedChange={(v) => services.simulated ? patchBilling({ autoBuyAddOns: v }) : toast.error('A compra automática de add-ons ainda não está disponível.')} disabled={!canManage} aria-label="Compra automática de add-ons" />
          </div>
        </section>

        {/* 4. Verificação de identidade */}
        <section>
          <div className={cn(SECTION_TITLE, 'mb-5')}>Verificação de identidade</div>
          <div className="divide-y rounded-lg border">
            <div className="flex flex-col gap-4 px-4 py-3 sm:flex-row sm:items-center" data-testid="identity-card">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50">
                  <ShieldCheck className="h-5 w-5 text-blue-500" />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-sm text-muted-foreground">Verifique a identidade de um representante da empresa.</span>
                  <IdentityBadge status={identity} />
                </div>
              </div>
              {identity === 'verified' ? (
                <Button variant="outline" className="h-9" onClick={() => navigate('/app/billing/identity')}>Ver detalhes</Button>
              ) : identity === 'pending' ? (
                <Button className="h-9" onClick={() => navigate('/app/billing/identity')} disabled={!canManage}>Continuar verificação</Button>
              ) : (
                <Button className="h-9" onClick={() => setIdentityOpen(true)} disabled={!canManage}>
                  {identity === 'action_required' ? 'Tentar novamente' : 'Verificar identidade'}
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* 5. Uso */}
        <section className="@container flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Uso</h2>
              <p className="mt-1 text-sm text-muted-foreground">Consumo e cotas por período de cobrança</p>
            </div>
            <Select value={period.id} onValueChange={setPeriodId}>
              <SelectTrigger className="h-10 w-full sm:w-80" aria-label="Período de cobrança">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ul className="grid gap-x-8 gap-y-4 rounded-lg border p-4 @lg:grid-cols-2" data-testid="usage-grid">
            {/* Ordem e itens de [472]/captura ao vivo; SMS só aparece quando há cota ou uso (add-on SMS contratado — R2-08). */}
            {(['minutes', 'waConversations', 'chatConversations', 'numbers', 'waNumbers', 'users', 'workspaces', 'sms', 'concurrent'] as UsageKey[])
              .filter((k) => k !== 'sms')
              .map((k) => (
                <UsageRow key={k} item={usage[k]} known={services.simulated} />
              ))}
          </ul>
        </section>
      </div>

      <Dialog open={identityOpen} onOpenChange={setIdentityOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] gap-y-5 rounded-2xl sm:max-w-[448px]" hideClose>
          {/* Medidas de [470]: ícone 48px, título, cartão do representante e texto centralizado. */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <DialogTitle className="mt-2 text-lg">Iniciar verificação</DialogTitle>
            <div className="mt-3 flex w-full items-center gap-3 rounded-xl border bg-muted/30 px-4 py-4 text-left">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{initials(fullName) || 'K'}</span>
              <div className="min-w-0">
                <div className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{org.name}</div>
                {/* [470]: nome com entrelinha de 24px — o rótulo da organização fica colado ao nome. */}
                <div className="truncate text-lg font-semibold leading-6">{fullName}</div>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Confirmo que sou {fullName} e inicio a verificação de identidade.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIdentityOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                setIdentityOpen(false)
                // Nova tentativa: começa sempre pelo consentimento (o progresso anterior é descartado).
                patchBilling({ identityFlow: undefined })
                navigate('/app/billing/identity?step=consentimento')
              }}
            >
              Iniciar verificação
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

function UsageRow({ item, known = true }: { item: UsageItem; known?: boolean }) {
  const isConcurrent = item.key === 'concurrent'
  const pct = !known || item.used == null ? null : item.quota == null || item.quota === 0 ? (item.used > 0 && item.quota === 0 ? 100 : 0) : (item.used / item.quota) * 100
  const over = known && item.quota != null && item.used != null && item.used > item.quota
  const value = !known ? '—' : isConcurrent
    ? item.quota ? `até ${item.quota}` : 'não incluído'
    : `${item.used == null ? '—' : fmtN(item.used)} / ${item.quota == null ? 'ilimitado' : fmtN(item.quota)}${item.unit ? ` ${item.unit}` : ''}`
  return (
    <li className="flex min-w-0 flex-col gap-1.5" data-testid={`usage-${item.key}`}>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="truncate font-medium">{item.label}</span>
        <span className={cn('shrink-0 tabular-nums text-muted-foreground', over && 'text-destructive')}>{value}</span>
      </div>
      {!isConcurrent && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={item.label} aria-valuenow={pct == null ? undefined : Math.round(Math.min(100, pct))} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full rounded-full', over ? 'bg-destructive' : 'bg-brand')} style={{ width: pct == null ? undefined : `${Math.min(100, pct)}%`, visibility: pct == null ? 'hidden' : undefined }} />
        </div>
      )}
    </li>
  )
}
