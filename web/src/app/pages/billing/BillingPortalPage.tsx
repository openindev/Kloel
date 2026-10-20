import { useMemo, useState, type ComponentProps, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, ChevronDown, Pencil, Plus, Search, MoreHorizontal, Download, Printer, X } from 'lucide-react'
import '@/domain/ext/billing'
import type { Invoice, Subscription } from '@/domain/types'
import { ADDONS } from '@/data/catalogs/plans'
import { useStore, useBillingProfile, useCollection, useCurrentOrg, useCurrentRole } from '@/data/store'
import { cn } from '@/lib/utils'
import { KloelMark } from '@/components/brand/KloelLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { OperationStatusView } from '@/components/app/misc'
import { PaginationBar, usePagination } from '@/components/app/Pagination'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'
import { BR_STATES, COUNTRIES, activeSubs, addMonths, addonPack, fmtDateLong, fmtDateShort, formatCep, formatCnpj, isValidCnpj, money, monthlyTotal, nextRenewal, subscriptionLabel } from './lib'
import { CardBrandMark, DemoPaymentNotice, FieldError } from './components'
import { CardFields, EMPTY_CARD, useCardCheckout, validateCard } from './CheckoutSteps'
import { isSavedCardExpired, savedCardExpiry, toSavedCard } from './actions'
import { downloadInvoice, printInvoice } from './invoice'
import { services, type CardInput } from '@/services'
import { openStripePortal } from '@/services/casca/billing'
import { useOperation } from '@/hooks/useOperation'

const SECTION = 'text-sm font-medium uppercase text-[#1a1f36]'
/** Faturas por página no histórico (INFERIDO: a conta capturada [467] tinha uma única fatura). */
const INVOICES_PAGE_SIZE = 5
const CANCEL_REASONS = ['O preço está alto', 'Não uso o suficiente', 'Faltam recursos de que preciso', 'Vou usar outra solução', 'Problemas técnicos', 'Outro motivo']

/**
 * /app/billing/portal — portal financeiro DEMONSTRATIVO (na Fonio é o portal hospedado da Stripe; referência [467]).
 * Painel esquerdo índigo + painel direito com plano atual, forma de pagamento, dados de faturamento e histórico de faturas.
 */
export default function BillingPortalPage() {
  const load = usePageLoad('billing-portal')
  const portal = useOperation(() => openStripePortal())
  const org = useCurrentOrg()
  const profile = useBillingProfile()
  const role = useCurrentRole()
  const subs = useCollection('subscriptions')
  const invoices = useCollection('invoices')
  const { patch, patchBilling } = useStore.getState()
  const active = useMemo(() => activeSubs(subs), [subs])
  const canceled = useMemo(() => subs.filter((s) => s.status === 'canceled'), [subs])
  const [cardOpen, setCardOpen] = useState(false)
  const [removeCardOpen, setRemoveCardOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reactivate, setReactivate] = useState<Subscription | null>(null)
  const [editing, setEditing] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openInvoice, setOpenInvoice] = useState<Invoice | null>(null)
  const canManage = role === 'admin'

  const sortedInvoices = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...invoices]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((i) => !q || [i.number, i.description, money(i.amount), fmtDateShort(i.date)].some((v) => v.toLowerCase().includes(q)))
  }, [invoices, query])
  // Paginação local do histórico: volta para a 1ª página quando a busca muda (ou é fechada).
  const invoicePages = usePagination(sortedInvoices, INVOICES_PAGE_SIZE, `${searchOpen}|${query.trim().toLowerCase()}`)

  if (!org || !profile) return null
  const totals = monthlyTotal(subs, profile)
  const renewal = nextRenewal(subs)
  const card = profile.card

  return (
    <main className="flex min-h-svh w-full flex-col bg-background lg:flex-row">
      {/* Painel esquerdo */}
      {/* Medidas de [467]: painel ~39% da largura, padding 64px, marca 28px, texto 24/32. */}
      <aside className="flex shrink-0 flex-col justify-between bg-brand px-6 py-8 text-white lg:sticky lg:top-0 lg:h-svh lg:w-[39%] lg:px-16 lg:pb-10 lg:pt-16">
        <div>
          <div className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] bg-white">
            <KloelMark className="h-6 w-6" />
          </div>
          <p className="mt-8 max-w-[300px] text-2xl font-medium leading-8 lg:mt-20">{services.simulated ? 'A Kloel AI usa este portal demonstrativo para simplificar o faturamento.' : 'A Kloel AI usa a Stripe para simplificar o faturamento.'}</p>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
          <span title={services.simulated ? "Nenhum pagamento real é processado" : "Gerenciado pela Stripe"}>{services.simulated ? "Portal demonstrativo" : "Portal financeiro"}</span>
          <span className="h-4 w-px bg-white/40" aria-hidden />
          <a href="/ajuda/legal/termos-e-condicoes" target="_blank" rel="noreferrer" className="hover:underline">Termos</a>
          <a href="/ajuda/legal/politica-de-privacidade" target="_blank" rel="noreferrer" className="hover:underline">Privacidade</a>
        </div>
      </aside>

      {/* Painel direito */}
      <div className="min-w-0 flex-1 px-5 py-8 sm:px-10 lg:px-20 lg:py-14">
        {load.isLoading || load.isError ? (
          <div className="flex max-w-[736px] flex-col gap-8">
            <Link to="/app/billing" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1a1f36]/80 hover:text-[#1a1f36]">
              <ArrowLeft className="h-4 w-4" /> Voltar para Kloel AI
            </Link>
            {load.isError ? <PageLoadError onRetry={load.retry} title="Não foi possível carregar o portal financeiro" className="mx-0" /> : <PageSkeleton rows={6} />}
          </div>
        ) : (
        <div className="flex max-w-[736px] flex-col gap-14 text-[#1a1f36]">
          <div className="flex items-center justify-between gap-3">
            <Link to="/app/billing" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1a1f36]/80 hover:text-[#1a1f36]">
              <ArrowLeft className="h-4 w-4" /> Voltar para Kloel AI
            </Link>
          </div>

          <OperationStatusView status={portal.status} progress={portal.progress} error={portal.error} onRetry={() => void portal.run()} successText="Continue no portal financeiro da Stripe." />
          {/* Plano atual */}
          <section className="flex flex-col gap-4" data-testid="portal-plan">
            <h2 className={SECTION}>Plano atual</h2>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">{profile.engineBilling?.status.subscriptions.length ? 'Consulte o estado da sua assinatura no portal financeiro.' : 'Nenhuma assinatura ativa.'}</p>
            ) : (
              <>
                <div>
                  <div className="text-lg font-medium">Assinatura Kloel</div>
                  <div className="text-3xl font-semibold tracking-tight">
                    {money(totals.total)} <span className="text-base font-normal text-muted-foreground">por mês</span>
                  </div>
                </div>
                <Collapsible>
                  <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm font-semibold text-[#1a1f36]/80 hover:text-[#1a1f36]">
                    Ver detalhes <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                    <ul className="mt-3 flex flex-col divide-y rounded-lg border text-sm">
                      {active.map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                          <span>
                            {subscriptionLabel(s.product, s.plan)}
                            {s.interval === 'annual' && <span className="ml-1 text-xs text-muted-foreground">(cobrança anual)</span>}
                          </span>
                          <span className="tabular-nums text-muted-foreground">{money(s.priceMonthly)} / mês</span>
                        </li>
                      ))}
                      {ADDONS.filter((a) => (profile.addOns[a.key] ?? 0) > 0).map((a) => (
                        <li key={a.key} className="flex items-center justify-between gap-4 px-4 py-3">
                          <span>Add-on: {a.label} × {profile.addOns[a.key]}</span>
                          <span className="tabular-nums text-muted-foreground">{money((profile.addOns[a.key] ?? 0) * addonPack(a.key).price)} / mês</span>
                        </li>
                      ))}
                    </ul>
                    {/* [467]: a vista padrão do portal não tem botão de cancelamento; a ação fica nos detalhes do plano. */}
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => services.simulated ? setCancelOpen(true) : void portal.run()} disabled={!canManage}>Cancelar assinatura</Button>
                  </CollapsibleContent>
                </Collapsible>
                {/* [467]: "Ver detalhes" → data → cartão a cada ~32px. */}
                {renewal && <p className="-mt-1.5 text-[15px]">Sua próxima data de faturamento é {fmtDateLong(renewal)}.</p>}
                {(profile.credits ?? 0) > 0 && (
                  <div className="flex flex-col gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="portal-credit">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">Saldo de crédito</span>
                      <span className="font-semibold tabular-nums">{money(profile.credits)}</span>
                    </div>
                    <span className="text-emerald-800">Abatido automaticamente da próxima cobrança (alteração de plano ou nova assinatura).</span>
                    {profile.creditLog?.length ? (
                      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-emerald-800/90">
                        {[...profile.creditLog].reverse().slice(0, 4).map((c) => (
                          <li key={c.date + c.label} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate">{fmtDateShort(c.date)} · {c.label}</span>
                            <span className="shrink-0 tabular-nums">{c.amount > 0 ? '+' : '−'}{money(Math.abs(c.amount))}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
                {card && (
                  <div className="-mt-1.5 flex items-center gap-2 text-[15px]">
                    <CardBrandMark brand={card.brand} className="h-4 w-6 rounded-[3px] text-[6px]" />
                    <span>{card.brand} •••• {card.last4}</span>
                    <button type="button" aria-label="Alterar forma de pagamento" onClick={() => services.simulated ? setCardOpen(true) : void portal.run()} disabled={!canManage} className="ml-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
            {canceled.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Canceladas</div>
                {canceled.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{subscriptionLabel(s.product, s.plan)}</div>
                      <div className="text-xs text-muted-foreground">Cancelada{s.canceledAt ? ` em ${fmtDateShort(s.canceledAt)}` : ''}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => services.simulated ? setReactivate(s) : void portal.run()} disabled={!canManage}>Reativar</Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Forma de pagamento */}
          <section className="flex flex-col gap-4" data-testid="portal-payment">
            <h2 className={SECTION}>Forma de pagamento</h2>
            {card ? (
              // [467]: linha do cartão com ~456px (o "…" fica ao lado, não na borda), ícone 26px e validade de 13px.
              <div className="flex max-w-[456px] items-center gap-3">
                <CardBrandMark brand={card.brand} className="h-[26px] w-[26px] rounded-md text-[7px]" />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[15px]">{card.brand} •••• {card.last4}</div>
                  {isSavedCardExpired(card) ? (
                    <div className="text-[13px] text-destructive" data-testid="portal-card-expired">Vencido em {savedCardExpiry(card)} — substitua o cartão para as próximas cobranças</div>
                  ) : (
                    <div className="text-[13px] text-[#1a1f36]/90">Vence em {savedCardExpiry(card)}</div>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="Opções da forma de pagamento" disabled={!canManage} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                      <MoreHorizontal className="h-5 w-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => services.simulated ? setCardOpen(true) : void portal.run()}>Substituir cartão</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => services.simulated ? setRemoveCardOpen(true) : void portal.run()}>Remover</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{services.simulated ? 'Nenhuma forma de pagamento cadastrada.' : 'Consulte sua forma de pagamento na Stripe.'}</p>
            )}
            <button type="button" onClick={() => services.simulated ? setCardOpen(true) : void portal.run()} disabled={!canManage} className="mt-2 inline-flex w-fit items-center gap-2 text-[15px] font-medium hover:underline disabled:opacity-50">
              <Plus className="h-4 w-4" /> Adicionar forma de pagamento
            </button>
          </section>

          {/* Dados de faturamento */}
          <section className="flex flex-col gap-4" data-testid="portal-details">
            <h2 className={SECTION}>Dados de faturamento</h2>
            {editing ? (
              <BillingInfoForm onDone={() => setEditing(false)} />
            ) : (
              <>
                <dl className="grid grid-cols-[minmax(96px,140px)_1fr] gap-x-5 gap-y-5 text-[15px]">
                  <dt className="text-muted-foreground">Nome</dt>
                  <dd>{profile.organizationName || '—'}</dd>
                  <dt className="text-muted-foreground">E-mail</dt>
                  <dd className="break-all">{profile.email || '—'}</dd>
                  <dt className="text-muted-foreground">Endereço de cobrança</dt>
                  <dd>
                    {[profile.line1, profile.line2, [profile.city, profile.state].filter(Boolean).join(' – '), profile.postalCode, profile.country === 'Brasil' ? 'BR' : profile.country]
                      .filter(Boolean)
                      .map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    {!profile.line1 && '—'}
                  </dd>
                  <dt className="text-muted-foreground">Telefone</dt>
                  <dd>{profile.phone || '—'}</dd>
                  {profile.taxId && (
                    <>
                      <dt className="text-muted-foreground">CNPJ</dt>
                      <dd>{profile.taxId}</dd>
                    </>
                  )}
                </dl>
                <button type="button" onClick={() => services.simulated ? setEditing(true) : void portal.run()} disabled={!canManage} className="inline-flex w-fit items-center gap-2 text-[15px] underline underline-offset-2 disabled:opacity-50">
                  <Pencil className="h-4 w-4" /> Atualizar informações
                </button>
              </>
            )}
          </section>

          {/* Histórico de faturas */}
          <section className="flex flex-col gap-3" data-testid="portal-invoices">
            <div className="flex items-center justify-between gap-3">
              <h2 className={SECTION}>Histórico de faturas</h2>
              <button type="button" aria-label="Buscar faturas" onClick={() => { if (!services.simulated) { void portal.run(); return }; setSearchOpen((o) => !o); setQuery('') }} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
              </button>
            </div>
            {searchOpen && <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por número, data ou valor" aria-label="Buscar faturas" />}
            <ul className="flex flex-col" data-testid="portal-invoice-list">
              {invoicePages.pageItems.map((inv) => (
                <li key={inv.id}>
                  <button type="button" onClick={() => setOpenInvoice(inv)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-md px-2 py-3 text-left text-[15px] hover:bg-accent sm:grid-cols-[108px_137px_79px_1fr]">
                    <span>{fmtDateShort(inv.date)}</span>
                    <span className="text-right tabular-nums sm:text-left">{money(inv.amount)}</span>
                    <span className={cn('w-fit rounded-md px-1.5 py-0.5 text-xs font-medium', inv.status === 'paid' ? 'bg-[#d7f7c2] text-[#05690d]' : inv.status === 'open' ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground')}>
                      {inv.status === 'paid' ? 'Paga' : inv.status === 'open' ? 'Em aberto' : 'Anulada'}
                    </span>
                    <span className="truncate text-muted-foreground sm:text-foreground">{inv.description || 'Assinatura Kloel'}</span>
                  </button>
                </li>
              ))}
              {sortedInvoices.length === 0 && <li className="py-3 text-sm text-muted-foreground">{!services.simulated ? <button type="button" onClick={() => void portal.run()}>Consultar faturas na Stripe</button> : query ? 'Nenhuma fatura encontrada.' : 'Nenhuma fatura ainda.'}</li>}
            </ul>
            <PaginationBar {...invoicePages} className="border-t px-2" />
          </section>
        </div>
        )}
      </div>

      <CardDialog open={cardOpen} onOpenChange={setCardOpen} />
      <ConfirmDialog
        open={removeCardOpen}
        onOpenChange={setRemoveCardOpen}
        title="Remover forma de pagamento?"
        description={active.length ? 'Você tem assinaturas ativas. Gerencie a forma de pagamento e as próximas renovações no portal financeiro.' : 'Gerencie a forma de pagamento no portal financeiro.'}
        confirmLabel="Remover"
        onConfirm={async () => {
          if (!services.simulated) { await openStripePortal(); return }
          patchBilling({ card: undefined })
          toast.success('Forma de pagamento removida')
        }}
      />
      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} active={active} />
      <ConfirmDialog
        open={!!reactivate}
        onOpenChange={(o) => !o && setReactivate(null)}
        title="Reativar assinatura?"
        description={reactivate ? `${subscriptionLabel(reactivate.product, reactivate.plan)} volta a ficar ativa por ${money(reactivate.priceMonthly)} / mês (demonstrativo).` : undefined}
        confirmLabel="Reativar"
        destructive={false}
        onConfirm={async () => {
          if (!services.simulated) { await openStripePortal(); return }
          if (!reactivate) return
          const now = new Date()
          patch('subscriptions', reactivate.id, { status: 'active', canceledAt: undefined, cancelReason: undefined, renewsAt: addMonths(now, reactivate.interval === 'annual' ? 12 : 1).toISOString() })
          toast.success('Assinatura reativada', { description: subscriptionLabel(reactivate.product, reactivate.plan) })
        }}
      />
      <Dialog open={!!openInvoice} onOpenChange={(o) => !o && setOpenInvoice(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] gap-y-5 rounded-2xl sm:max-w-[520px]">
          {openInvoice && (
            <>
              <DialogHeader className="gap-y-2">
                <DialogTitle>Fatura {openInvoice.number}</DialogTitle>
                <DialogDescription>{fmtDateLong(openInvoice.date)} · {openInvoice.status === 'paid' ? 'Paga' : openInvoice.status === 'open' ? 'Em aberto' : 'Anulada'}</DialogDescription>
              </DialogHeader>
              <div className="rounded-xl border bg-[#FAFAFA] p-4 text-sm">
                <ul className="flex flex-col gap-2">
                  {(openInvoice.lines?.length ? openInvoice.lines : [{ label: openInvoice.description || 'Assinatura Kloel', amount: openInvoice.amount }]).map((l) => (
                    <li key={l.label} className="flex justify-between gap-4"><span className="text-muted-foreground">{l.label}</span><span className="tabular-nums">{money(l.amount)}</span></li>
                  ))}
                </ul>
                <div className="my-3 border-t" />
                <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{money(openInvoice.amount)}</span></div>
                <div className="mt-2 flex justify-between text-muted-foreground"><span>Forma de pagamento</span><span>{openInvoice.cardLabel || (card ? `${card.brand} •••• ${card.last4}` : '—')}</span></div>
              </div>
              <p className="text-xs text-muted-foreground">{services.simulated ? 'Documento demonstrativo, sem valor fiscal.' : 'Cobrança processada pela Stripe.'}</p>
              <DialogFooter>
                <Button variant="outline" className="gap-2" onClick={() => printInvoice(openInvoice, profile, org)}><Printer className="h-4 w-4" /> Imprimir</Button>
                <Button
                  className="gap-2"
                  onClick={() => {
                    downloadInvoice(openInvoice, profile, org)
                    toast.success('Fatura baixada', { description: `fatura-${openInvoice.number}-demonstrativa.html` })
                  }}
                >
                  <Download className="h-4 w-4" /> Baixar fatura
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}

/** Adicionar / substituir cartão (validação simulada via services.billing.checkout com valor zero). */
function CardDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const patchBilling = useStore((s) => s.patchBilling)
  const [card, setCard] = useState<CardInput>(EMPTY_CARD)
  const [errors, setErrors] = useState<Partial<Record<keyof CardInput, string>>>({})
  const op = useCardCheckout()
  const running = op.status === 'running'
  const close = (o: boolean) => {
    if (running) return
    onOpenChange(o)
    if (!o) {
      setCard(EMPTY_CARD)
      setErrors({})
      op.reset()
    }
  }
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    // Mesmas regras do checkout: obrigatórios, mês 01–12, cartão não vencido, CVC.
    const errs = validateCard(card)
    setErrors(errs)
    if (Object.keys(errs).length) {
      setTimeout(() => (document.querySelector('[role="dialog"] [aria-invalid="true"]') as HTMLElement | null)?.focus(), 0)
      return
    }
    const r = await op.run([{ label: 'Verificação do cartão', amount: 0 }], card)
    if (!r) return
    patchBilling({ card: toSavedCard(card, r.brand, r.last4) })
    toast.success('Forma de pagamento atualizada', { description: `${r.brand} •••• ${r.last4}` })
    close(false)
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-y-5 rounded-2xl sm:max-w-[520px]">
        <DialogHeader className="gap-y-2">
          <DialogTitle>Adicionar forma de pagamento</DialogTitle>
          <DialogDescription>O novo cartão passa a ser a forma de pagamento padrão das assinaturas.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} noValidate className="flex flex-col gap-4">
          <DemoPaymentNotice>Nenhum valor é cobrado. Guardamos apenas a bandeira, os 4 últimos dígitos e a validade.</DemoPaymentNotice>
          <CardFields value={card} onChange={(v) => { setCard(v); setErrors({}) }} errors={errors} disabled={running} />
          <OperationStatusView status={op.status} progress={op.progress} error={op.error} onRetry={() => void save()} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={running}>Cancelar</Button>
            <Button type="submit" disabled={running}>{running ? 'Verificando…' : 'Salvar cartão'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Fluxo de cancelamento: escolher assinatura + motivo → confirmar. */
function CancelDialog({ open, onOpenChange, active }: { open: boolean; onOpenChange: (o: boolean) => void; active: Subscription[] }) {
  const patch = useStore((s) => s.patch)
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  const [subId, setSubId] = useState<string | undefined>()
  const [reason, setReason] = useState<string | undefined>()
  const sub = active.find((s) => s.id === subId) ?? active[0]
  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      setStep('choose')
      setSubId(undefined)
      setReason(undefined)
    }
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-y-5 rounded-2xl sm:max-w-[520px]">
        {step === 'choose' ? (
          <>
            <DialogHeader className="gap-y-2">
              <DialogTitle>Cancelar assinatura</DialogTitle>
              <DialogDescription>Escolha qual assinatura deseja cancelar.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Assinatura">
              {active.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={sub?.id === s.id}
                  onClick={() => setSubId(s.id)}
                  className={cn('flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm', sub?.id === s.id ? 'border-brand ring-2 ring-brand/15' : 'hover:bg-accent')}
                >
                  <span className="font-medium">{subscriptionLabel(s.product, s.plan)}</span>
                  <span className="tabular-nums text-muted-foreground">{money(s.priceMonthly)} / mês</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cancel-reason">Motivo (opcional)</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="cancel-reason"><SelectValue placeholder="Selecione um motivo" /></SelectTrigger>
                <SelectContent>
                  {CANCEL_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>Manter assinatura</Button>
              <Button variant="destructive" disabled={!sub} onClick={() => setStep('confirm')}>Continuar</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="gap-y-2">
              <DialogTitle>Confirmar cancelamento?</DialogTitle>
              <DialogDescription>
                {sub ? `${subscriptionLabel(sub.product, sub.plan)} será cancelada agora nesta demonstração.` : ''}
              </DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>Os recursos e cotas do plano deixam de valer imediatamente.</li>
              {sub?.product === 'voice' && <li>Campanhas outbound voltam a ficar bloqueadas no menu.</li>}
              <li>Você pode reativar a assinatura depois neste portal.</li>
              <li>Nenhum valor real é cobrado ou estornado (simulação).</li>
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('choose')}>Voltar</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!sub) return
                  patch('subscriptions', sub.id, { status: 'canceled', canceledAt: new Date().toISOString(), cancelReason: reason })
                  toast.success('Assinatura cancelada', { description: subscriptionLabel(sub.product, sub.plan) })
                  close(false)
                }}
              >
                Confirmar cancelamento
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Edição de "Dados de faturamento" no portal. */
function BillingInfoForm({ onDone }: { onDone: () => void }) {
  const profile = useBillingProfile()!
  const patchBilling = useStore((s) => s.patchBilling)
  const [v, setV] = useState({
    organizationName: profile.organizationName,
    email: profile.email,
    phone: profile.phone ?? '',
    country: profile.country,
    line1: profile.line1,
    line2: profile.line2,
    city: profile.city,
    state: profile.state,
    postalCode: profile.postalCode,
    taxId: profile.taxId,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isBR = v.country === 'Brasil'
  const set = (k: keyof typeof v, val: string) => {
    setV((s) => ({ ...s, [k]: val }))
    setErrors((e) => ({ ...e, [k]: '' }))
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!v.organizationName.trim()) errs.organizationName = 'Este campo é obrigatório'
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errs.email = 'E-mail inválido.'
    if (isBR && v.postalCode && v.postalCode.replace(/\D/g, '').length !== 8) errs.postalCode = 'Código postal inválido.'
    if (v.taxId && !isValidCnpj(v.taxId)) errs.taxId = 'CNPJ inválido.'
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    patchBilling(v)
    toast.success('Dados de faturamento atualizados')
    onDone()
  }
  const text = (k: keyof typeof v, label: string, extra: Partial<ComponentProps<'input'>> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`pf-${k}`} className={cn('font-normal', errors[k] && 'text-destructive')}>{label}</Label>
      <Input id={`pf-${k}`} value={v[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k]} {...extra} />
      <FieldError>{errors[k]}</FieldError>
    </div>
  )
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" data-testid="portal-details-form">
      {text('organizationName', 'Nome')}
      {text('email', 'E-mail', { type: 'email', placeholder: 'financeiro@empresa.com.br' })}
      {text('phone', 'Telefone', { placeholder: '+55 11 90000-0000' })}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pf-country" className="font-normal">País ou região</Label>
        <Select value={v.country} onValueChange={(c) => setV((s) => ({ ...s, country: c, state: c === 'Brasil' ? s.state : '' }))}>
          <SelectTrigger id="pf-country"><SelectValue /></SelectTrigger>
          <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {text('line1', 'Linha 1 do endereço')}
      {text('line2', 'Linha 2 do endereço')}
      {text('city', 'Cidade')}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pf-state" className="font-normal">Estado</Label>
          {isBR ? (
            <Select value={v.state || undefined} onValueChange={(s) => set('state', s)}>
              <SelectTrigger id="pf-state"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{BR_STATES.map(([uf, n]) => <SelectItem key={uf} value={uf}>{n}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input id="pf-state" value={v.state} onChange={(e) => set('state', e.target.value)} />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pf-postalCode" className={cn('font-normal', errors.postalCode && 'text-destructive')}>Código postal</Label>
          <Input id="pf-postalCode" value={v.postalCode} onChange={(e) => set('postalCode', isBR ? formatCep(e.target.value) : e.target.value)} aria-invalid={!!errors.postalCode} />
          <FieldError>{errors.postalCode}</FieldError>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pf-taxId" className={cn('font-normal', errors.taxId && 'text-destructive')}>CNPJ (opcional)</Label>
        <Input id="pf-taxId" value={v.taxId} placeholder="00.000.000/0000-00" onChange={(e) => set('taxId', formatCnpj(e.target.value))} aria-invalid={!!errors.taxId} />
        <FieldError>{errors.taxId}</FieldError>
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="submit">Salvar</Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  )
}
