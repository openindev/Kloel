import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, Download, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { services } from '@/services'
import '@/domain/ext/billing'
import type { CartItem } from '@/domain/ext/billing'
import type { PlanTier, Subscription } from '@/domain/types'
import { useStore, useBillingProfile, useCollection, useCurrentOrg, useCurrentRole } from '@/data/store'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/app/misc'
import { BillingDetailsStep, PaymentStep } from './CheckoutSteps'
import { AddItemDialog } from './AddItemDialog'
import { decodeItems, encodeItems, fmtDateShort, isProfileComplete, money, safeReturnTo, subscriptionLabel } from './lib'
import { downloadInvoice, printInvoice } from './invoice'

type Step = 'dados' | 'pagamento' | 'concluido'

/**
 * /app/checkout — checkout DEMONSTRATIVO avulso (usado por "Adicionar assinatura" e "Alterar plano" sem cartão).
 * Query: ?items=produto:plano:ciclo,... (ou ?product=&plan=&interval=), &returnTo=, &step=dados|pagamento|concluido, &invoice=
 */
export default function CheckoutPage() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const org = useCurrentOrg()
  const profile = useBillingProfile()
  const subs = useCollection('subscriptions')
  const invoices = useCollection('invoices')
  const role = useCurrentRole()
  const patchOrg = useStore((s) => s.patchOrg)
  const [addOpen, setAddOpen] = useState(false)
  /** true entre a aprovação do pagamento e a troca para "concluído" (o produto recém-comprado já aparece como ativo). */
  const justPaid = useRef(false)

  const items: CartItem[] = useMemo(() => {
    const fromItems = decodeItems(sp.get('items'))
    if (fromItems.length) return fromItems
    const p = sp.get('product')
    if (!p) return []
    return decodeItems(`${p}:${sp.get('plan') ?? ''}:${sp.get('interval') ?? 'monthly'}`)
  }, [sp])
  const rawStep = (sp.get('step') as Step) || 'dados'
  const returnTo = safeReturnTo(sp.get('returnTo'))
  const from = sp.get('from') ? safeReturnTo(sp.get('from'), returnTo) : null
  const discount = sp.get('discount') || undefined

  const update = (patch: Record<string, string | undefined>, replace = true) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    }
    next.delete('product')
    next.delete('plan')
    next.delete('interval')
    if (!patch.items && items.length && !next.get('items')) next.set('items', encodeItems(items))
    setSp(next, { replace })
  }

  const setItems = (list: CartItem[]) => update({ items: encodeItems(list) || undefined })
  const invoice = invoices.find((i) => i.id === sp.get('invoice'))
  // URL direta: "concluído" só com a fatura gerada; "pagamento" só com os dados de faturamento obrigatórios preenchidos.
  const step: Step =
    rawStep === 'concluido' ? (invoice && services.simulated ? 'concluido' : 'dados') : rawStep === 'pagamento' ? (!services.simulated || isProfileComplete(profile) ? 'pagamento' : 'dados') : 'dados'
  useEffect(() => {
    if (step === 'concluido') justPaid.current = false
  }, [step])

  // Primeiro acesso: a contratação acontece no fluxo do onboarding (planos → dados → pagamento → assistente 1/5).
  const inOnboarding = services.simulated && !!org && !org.onboardingCompleted
  const redirected = useRef(false)
  useEffect(() => {
    if (!inOnboarding || redirected.current) return
    redirected.current = true
    const hasActive = subs.some((s) => s.status === 'active')
    if (!hasActive && items.length) patchOrg({ onboardingCart: items, onboardingStep: 'billing', onboardingAddMode: false, onboardingDiscount: discount })
    navigate('/app/onboarding', { replace: true })
  }, [inOnboarding, subs, items, discount, patchOrg, navigate])

  // Produtos já ativos não são cobrados de novo: troca de plano é feita em "Alterar plano" (cobrança proporcional, spec 05 [466]/[468]).
  const activeSubsList = subs.filter((s) => s.status === 'active')
  const alreadyActive = step === 'concluido' || justPaid.current ? [] : items.filter((i) => activeSubsList.some((s) => s.product === i.product))
  const cart = items.filter((i) => !alreadyActive.some((a) => a.product === i.product))

  if (inOnboarding) return null

  const shell = (children: ReactNode) => (
    <main className="min-h-svh w-full bg-muted/30">
      <header className="flex items-center justify-between gap-3 border-b bg-background px-4 py-4 sm:px-8">
        <Link to="/app" aria-label="Início"><KloelLogo /></Link>
      </header>
      <div className="mx-auto w-full max-w-[640px] px-4 py-8 sm:py-12">
        <div className="rounded-2xl border bg-background p-5 shadow-sm sm:p-10">{children}</div>
      </div>
    </main>
  )

  if (role !== 'admin') {
    return shell(
      <EmptyState
        className="border-0 px-0 py-6"
        title="Somente administradores podem contratar assinaturas"
        description="Peça a um administrador da organização para concluir esta contratação."
        action={<Button onClick={() => navigate('/app/billing')}>Ir para Assinatura e faturamento</Button>}
      />,
    )
  }

  if (step === 'concluido') {
    return shell(
      <div className="flex flex-col items-center gap-5 text-center" data-testid="checkout-success">
        <CircleCheck className="h-12 w-12 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assinatura ativada</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pagamento aprovado.</p>
        </div>
        {invoice && (
          <div className="w-full rounded-xl border bg-[#FAFAFA] p-4 text-left text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Fatura</span><span className="font-medium">{invoice.number}</span></div>
            <div className="mt-2 flex justify-between"><span className="text-muted-foreground">Data</span><span>{fmtDateShort(invoice.date)}</span></div>
            <div className="mt-2 flex justify-between"><span className="text-muted-foreground">Forma de pagamento</span><span>{invoice.cardLabel ?? '—'}</span></div>
            <div className="my-3 border-t" />
            <ul className="flex flex-col gap-1.5">
              {invoice.lines?.map((l) => (
                <li key={l.label} className="flex justify-between gap-4"><span className="text-muted-foreground">{l.label}</span><span className="tabular-nums">{money(l.amount)}</span></li>
              ))}
            </ul>
            <div className="my-3 border-t" />
            <div className="flex justify-between font-semibold"><span>Total pago</span><span className="tabular-nums">{money(invoice.amount)}</span></div>
          </div>
        )}
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          {invoice && (
            <>
              <Button variant="outline" className="flex-1 gap-2" onClick={() => downloadInvoice(invoice, profile, org)}><Download className="h-4 w-4" /> Baixar fatura</Button>
              <Button variant="outline" className="flex-1 gap-2" onClick={() => printInvoice(invoice, profile, org)}><Printer className="h-4 w-4" /> Imprimir</Button>
            </>
          )}
          <Button className="flex-1" onClick={() => navigate(returnTo)}>Concluir</Button>
        </div>
      </div>,
    )
  }

  const activeProducts = activeSubsList.map((s) => s.product)
  const exclude = [...cart.map((i) => i.product), ...activeProducts]
  const addDialog = (
    <AddItemDialog open={addOpen} onOpenChange={setAddOpen} exclude={exclude} onAdd={(it) => setItems([...cart, { ...it, tier: it.tier as PlanTier }])} />
  )
  const backLabel = returnTo.startsWith('/app/billing') ? 'Voltar para Assinatura e faturamento' : 'Voltar'

  if (alreadyActive.length > 0 && cart.length === 0) {
    return shell(
      <div className="flex flex-col items-center gap-5 text-center" data-testid="checkout-already-active">
        <CircleCheck className="h-12 w-12 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{alreadyActive.length === 1 ? 'Assinatura já ativa' : 'Assinaturas já ativas'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nada foi cobrado. Para trocar de plano, use “Alterar plano”: a diferença é calculada proporcionalmente aos dias restantes do ciclo.
          </p>
        </div>
        <ActiveItemsList items={alreadyActive} subs={activeSubsList} returnTo={returnTo} onChangePlan={(path) => navigate(path)} />
        <Button className="w-full sm:w-auto" onClick={() => navigate(returnTo)}>{backLabel}</Button>
      </div>,
    )
  }

  if (items.length === 0) {
    return shell(
      <>
      {addDialog}
      <EmptyState
        className="border-0 px-0 py-6"
        title="Nenhum produto selecionado"
        description="Escolha um plano em Assinatura e faturamento para iniciar o checkout."
        action={
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setAddOpen(true)}>Adicionar produto</Button>
            <Button onClick={() => navigate('/app/billing')}>Ir para Assinatura e faturamento</Button>
          </div>
        }
      />
      </>,
    )
  }

  const activeNotice = alreadyActive.length > 0 && (
    <div role="note" className="mb-6 flex flex-col gap-3 rounded-xl border bg-muted/40 px-4 py-3 text-left text-sm" data-testid="checkout-active-removed">
      <span>
        {alreadyActive.length === 1 ? 'Este produto já está ativo e foi retirado do carrinho:' : 'Estes produtos já estão ativos e foram retirados do carrinho:'}
      </span>
      <ActiveItemsList items={alreadyActive} subs={activeSubsList} returnTo={returnTo} onChangePlan={(path) => navigate(path)} />
    </div>
  )

  return shell(
    <>
      {activeNotice}
      {step === 'dados' ? (
        <BillingDetailsStep
          cart={cart}
          discountCode={discount}
          onDiscountChange={(code) => update({ discount: code })}
          onRemoveItem={(p) => setItems(cart.filter((i) => i.product !== p))}
          onAddProduct={() => setAddOpen(true)}
          onBack={() => navigate(from || returnTo)}
          onContinue={() => update({ step: 'pagamento' }, false)}
        />
      ) : (
        <PaymentStep
          cart={cart}
          discountCode={discount}
          onBack={() => update({ step: 'dados' })}
          description={cart.length === 1 ? `Assinatura ${cart[0]!.product === 'email' ? 'E-Mail IA' : 'Kloel'}` : 'Assinatura Kloel'}
          onBeforeApply={() => {
            justPaid.current = true
          }}
          onPaid={(inv) => {
            toast.success('Assinatura ativada')
            update({ step: 'concluido', invoice: inv?.id, items: encodeItems(cart) || undefined })
          }}
        />
      )}
      {addDialog}
    </>,
  )
}


/** Lista de produtos já ativos com atalho para "Alterar plano" (cobrança proporcional). */
function ActiveItemsList({
  items,
  subs,
  returnTo,
  onChangePlan,
}: {
  items: CartItem[]
  subs: Subscription[]
  returnTo: string
  onChangePlan: (path: string) => void
}) {
  return (
    <ul className="w-full divide-y rounded-xl border bg-[#FAFAFA] text-left text-sm">
      {items.map((i) => {
        const sub = subs.find((s) => s.product === i.product)
        if (!sub) return null
        const requested = sub.plan !== i.tier ? subscriptionLabel(i.product, i.tier) : null
        return (
          <li key={i.product} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{subscriptionLabel(sub.product, sub.plan)}</div>
              <div className="text-xs text-muted-foreground">
                Ativa · {money(sub.priceMonthly)} / mês{requested ? ` · você escolheu ${requested}` : ''}
              </div>
            </div>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => onChangePlan(`/app/change-plan/${i.product}?returnTo=${encodeURIComponent(returnTo)}`)}>
              Alterar plano
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
