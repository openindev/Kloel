import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, CreditCard } from 'lucide-react'
import '@/domain/ext/billing'
import type { PlanTier } from '@/domain/types'
import { planOf, productByKey } from '@/data/catalogs/plans'
import { useStore, useBillingProfile, useCollection, useCurrentRole } from '@/data/store'
import { services, type CardInput } from '@/services'
import { openStripePortal } from '@/services/casca/billing'
import { useOperation } from '@/hooks/useOperation'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EmptyState, OperationStatusView } from '@/components/app/misc'
import { PlanCards } from './PlanCards'
import { PlanPageFrame } from './PlanPageFrame'
import { encodeItems, fmtDateShort, money, moneyInt, productFromSlug, safeReturnTo, subscriptionLabel } from './lib'
import { applyPlanChange, isSavedCardExpired, planChangeCharge, proratedDifference, savedCardAsInput, savedCardExpiry, toSavedCard } from './actions'
import { AdminOnlyNotice, CardBrandMark, DemoPaymentNotice } from './components'
import { CardFields, EMPTY_CARD, validateCard } from './CheckoutSteps'

/** /app/change-plan/:product — "Alterar plano" (página cheia sem sidebar, captura app-12 + referência [468]). */
export default function ChangePlanPage() {
  // Aceita a chave da Kloel (/change-plan/voice) e os slugs da Fonio (/change-plan/sub-solo, sub-whatsapp-solo-brasil…).
  const product = productFromSlug(useParams().product)
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const subs = useCollection('subscriptions')
  const profile = useBillingProfile()
  const role = useCurrentRole()
  const returnTo = safeReturnTo(sp.get('returnTo'))
  const sub = useMemo(() => (product ? subs.find((s) => s.product === product && s.status === 'active') : undefined), [subs, product])
  const [target, setTarget] = useState<PlanTier | null>(null)
  const [newCard, setNewCard] = useState<CardInput>(EMPTY_CARD)
  const [cardErrors, setCardErrors] = useState<Partial<Record<keyof CardInput, string>>>({})
  const patchBilling = useStore((s) => s.patchBilling)
  const op = useOperation((onProgress, lines: { label: string; amount: number }[], card: Parameters<typeof services.billing.checkout>[1]) =>
    services.billing.checkout(lines, card, onProgress),
  )
  const hosted = useOperation(() => openStripePortal())

  if (!product) {
    return (
      <PlanPageFrame title="Alterar plano" onBack={() => navigate(returnTo)}>
        <EmptyState title="Produto não encontrado" description="Verifique o endereço ou volte para Assinatura e faturamento." action={<Button onClick={() => navigate('/app/billing')}>Ir para Assinatura e faturamento</Button>} />
      </PlanPageFrame>
    )
  }

  const interval = sub?.interval ?? 'monthly'
  const card = profile?.card
  const cardExpired = isSavedCardExpired(card)
  const credits = profile?.credits ?? 0
  const diff = services.simulated && sub && target ? proratedDifference(sub, target) : undefined
  const charge = diff ? planChangeCharge(diff.amount, credits) : undefined
  // Sem cartão salvo (ou vencido): o cartão é informado no próprio diálogo e passa a ser a forma de pagamento padrão.
  const needsCard = !card || cardExpired
  const targetLabel = target ? subscriptionLabel(product, target) : ''

  const canManage = role === 'admin'
  const onSelect = (tier: string) => {
    if (!canManage) return
    if (!sub) {
      // Sem assinatura ativa: segue para o checkout demonstrativo
      navigate(`/app/checkout?items=${encodeItems([{ product, tier: tier as PlanTier, interval }])}&returnTo=${encodeURIComponent(returnTo)}`)
      return
    }
    if (!services.simulated) { void hosted.run(); return }
    op.reset()
    setNewCard(EMPTY_CARD)
    setCardErrors({})
    setTarget(tier as PlanTier)
  }

  const confirm = async () => {
    if (!sub || !target || !diff || !charge) return
    let input: CardInput
    if (needsCard) {
      const errs = validateCard(newCard)
      setCardErrors(errs)
      if (Object.keys(errs).length) {
        setTimeout(() => (document.querySelector('[role="dialog"] [aria-invalid="true"]') as HTMLElement | null)?.focus(), 0)
        return
      }
      input = newCard
    } else input = savedCardAsInput(card!)
    const lines = [{ label: `Alteração de plano: ${subscriptionLabel(product, sub.plan)} → ${targetLabel}`, amount: charge.due }]
    if (charge.creditApplied) lines.push({ label: 'Crédito aplicado', amount: -charge.creditApplied })
    const r = await op.run(lines, input)
    if (!r) return
    const paidWith = needsCard ? toSavedCard(newCard, r.brand, r.last4) : card!
    if (needsCard) patchBilling({ card: paidWith })
    // diff.amount < 0 (downgrade) → o crédito proporcional entra no saldo da organização (BillingProfile.credits).
    applyPlanChange(sub, target, { invoiceNumber: r.invoiceNumber, prorated: diff.amount, card: paidWith })
    const unlocks = product === 'voice' && (target === 'team' || target === 'scale') && sub.plan === 'solo'
    const creditNote = diff.amount < 0 ? ` Crédito de ${money(-diff.amount)} adicionado ao saldo (portal financeiro).` : ''
    toast.success(`Plano alterado para ${planOf(product, target)?.name}`, {
      description: `${unlocks ? 'Campanhas outbound liberadas no menu Mais.' : ''}${creditNote}`.trim() || undefined,
    })
    setTarget(null)
    navigate(returnTo)
  }

  const running = op.status === 'running'
  return (
    <PlanPageFrame title="Alterar plano" onBack={() => navigate(returnTo)} subtitle={!sub ? `Você ainda não tem uma assinatura ativa de ${productByKey(product).name}. Escolha um plano para continuar.` : undefined}>
      {!canManage && <AdminOnlyNotice className="mb-8">Somente administradores podem alterar o plano. Peça a um administrador da organização.</AdminOnlyNotice>}
      <PlanCards product={product} interval={interval} currentTier={sub?.plan} onSelect={onSelect} variant="change" disabled={!canManage} />
      <OperationStatusView status={hosted.status} progress={hosted.progress} error={hosted.error} onRetry={() => void hosted.run()} successText="Escolha e confirme a alteração no portal financeiro da Stripe. Os valores serão apresentados antes da confirmação." />

      <Dialog open={!!target} onOpenChange={(o) => !running && !o && setTarget(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] gap-y-6 overflow-y-auto rounded-2xl sm:max-w-[480px]">
          <DialogHeader className="gap-y-2">
            <DialogTitle>Confirmar alteração de plano</DialogTitle>
            <DialogDescription>Revise a alteração antes de confirmar.</DialogDescription>
          </DialogHeader>
          {sub && target && diff && (
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">Atual</div>
                  <div className="font-medium">{subscriptionLabel(product, sub.plan)}</div>
                  <div className="text-muted-foreground">{moneyInt(sub.priceMonthly)} / mês</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">Novo</div>
                  <div className="font-medium">{targetLabel}</div>
                  <div className="text-muted-foreground">{moneyInt(diff.newMonthly)} / mês</div>
                </div>
              </div>
              <ul className="flex flex-col gap-2">
                <li className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{diff.amount >= 0 ? `Cobrança proporcional agora (${diff.daysLeft} dias restantes)` : `Crédito proporcional (${diff.daysLeft} dias restantes)`}</span>
                  <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{money(Math.abs(diff.amount))}</span>
                </li>
                {charge && charge.creditApplied > 0 && (
                  <>
                    <li className="flex justify-between gap-4 text-emerald-700" data-testid="change-credit-applied">
                      <span>Crédito aplicado (saldo de {money(credits)})</span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">−{money(charge.creditApplied)}</span>
                    </li>
                    <li className="flex justify-between gap-4 font-medium">
                      <span>Total cobrado agora</span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">{money(charge.charge)}</span>
                    </li>
                  </>
                )}
                <li className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Próxima renovação</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">{fmtDateShort(sub.renewsAt)}</span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Forma de pagamento</span>
                  {card ? (
                    <span className={cn('inline-flex items-center gap-2', cardExpired && 'text-destructive')}>
                      <CardBrandMark brand={card.brand} /> {card.brand} •••• {card.last4}
                      {cardExpired && <span data-testid="change-card-expired">· vencido em {savedCardExpiry(card)}</span>}
                    </span>
                  ) : (
                    <span className="text-destructive">Nenhuma cadastrada</span>
                  )}
                </li>
              </ul>
              {diff.amount < 0 && (
                <p className="text-xs text-muted-foreground">
                  O crédito de {money(-diff.amount)} entra no saldo da organização (visível no portal financeiro) e é abatido automaticamente da próxima cobrança.
                </p>
              )}
              {needsCard && (
                <div className="flex flex-col gap-3" data-testid="change-new-card">
                  <p className={cn('text-sm', cardExpired ? 'text-destructive' : 'text-muted-foreground')}>
                    {cardExpired ? 'O cartão salvo está vencido. Informe um novo cartão para confirmar a alteração.' : 'Nenhuma forma de pagamento cadastrada. Informe um cartão para confirmar a alteração.'}
                  </p>
                  <DemoPaymentNotice />
                  <CardFields value={newCard} onChange={(v) => { setNewCard(v); setCardErrors({}) }} errors={cardErrors} disabled={running} />
                </div>
              )}
              <OperationStatusView status={op.status} progress={op.progress} error={op.error} onRetry={() => void confirm()} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={running}>Cancelar</Button>
            <Button className={cn(needsCard && 'gap-2')} onClick={() => void confirm()} disabled={running}>
              {needsCard && <CreditCard className="h-4 w-4" />}
              {running ? 'Processando…' : needsCard ? 'Pagar e confirmar' : 'Confirmar alteração'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlanPageFrame>
  )
}
