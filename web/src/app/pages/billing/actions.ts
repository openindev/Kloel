import '@/domain/ext/billing'
import type { BillingProfile, Invoice, PlanTier, Subscription } from '@/domain/types'
import type { CartItem } from '@/domain/ext/billing'
import type { CardInput } from '@/services'
import { useStore } from '@/data/store'
import { planOf } from '@/data/catalogs/plans'
import { addMonths, cartTotals, money, planMonthly, roundMoney, subscriptionLabel } from './lib'
import { REFERRAL_AMOUNT, referralBenefitOf } from './referral'

export type SavedCard = NonNullable<BillingProfile['card']>

/** Converte os dados digitados no formato salvo (somente bandeira, 4 últimos dígitos e validade — nunca o número completo). */
export function toSavedCard(card: CardInput, brand: string, last4: string): SavedCard {
  const [mm, yy] = card.expiry.split('/').map((s) => Number(s.trim()))
  return { brand, last4, expMonth: mm || 1, expYear: 2000 + (yy || 0), holder: card.holder.trim().toUpperCase() }
}

/**
 * Cartão salvo → entrada do serviço simulado de cobrança.
 * O número completo NUNCA é armazenado: reconstruímos um número de teste com os mesmos 4 últimos dígitos.
 */
export function savedCardAsInput(card: SavedCard): CardInput {
  const last4 = card.last4.padStart(4, '0')
  const number = last4 === '0002' ? '4000000000000002' : `424242424242${last4}`
  return { number, expiry: `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`, cvc: '000', holder: card.holder }
}

/** Cartão salvo vencido (válido até o último dia do mês de validade) ou com mês inválido. */
export function isSavedCardExpired(card: SavedCard | undefined, now = new Date()) {
  if (!card) return false
  if (!(card.expMonth >= 1 && card.expMonth <= 12)) return true
  return new Date(card.expYear, card.expMonth, 1).getTime() <= now.getTime()
}

export const savedCardExpiry = (card: SavedCard) => `${String(card.expMonth).padStart(2, '0')}/${card.expYear}`

/** Movimenta o saldo de crédito (BillingProfile.credits) e registra no histórico exibido no portal. */
function moveCredit(amount: number, label: string) {
  if (!amount) return
  const st = useStore.getState()
  st.patchBilling((b) => ({
    ...b,
    credits: roundMoney(Math.max(0, (b.credits ?? 0) + amount)),
    creditLog: [...(b.creditLog ?? []), { date: new Date().toISOString(), amount: roundMoney(amount), label }],
  }))
}

/** Saldo de crédito atual da organização. */
function currentCredits() {
  const st = useStore.getState()
  return st.db.billingProfiles.find((b) => b.orgId === st.db.session.orgId)?.credits ?? 0
}

function nextRenew(now: Date, interval: CartItem['interval']) {
  return addMonths(now, interval === 'annual' ? 12 : 1).toISOString()
}

/** Ativa as assinaturas do carrinho, gera a fatura (paga, simulada) e salva o cartão. */
export function applyPurchase(opts: { items: CartItem[]; discountCode?: string; invoiceNumber: string; card?: SavedCard; description?: string }) {
  const st = useStore.getState()
  const orgId = st.db.session.orgId
  if (!orgId) return undefined
  const now = new Date()
  const org = st.db.organizations.find((o) => o.id === orgId)
  // Indicação (/r/:code → signupIntent.referralCode): desconto somente na primeira fatura da organização.
  const referral = referralBenefitOf(st.db, org)
  const totals = cartTotals(opts.items, opts.discountCode, currentCredits(), referral)
  for (const item of opts.items) {
    const plan = planOf(item.product, item.tier)
    const monthly = planMonthly(plan, item.interval) ?? 0
    const existing = st.db.subscriptions.find((s) => s.orgId === orgId && s.product === item.product)
    const fields: Partial<Subscription> = {
      plan: item.tier,
      interval: item.interval,
      status: 'active',
      priceMonthly: monthly,
      startedAt: now.toISOString(),
      renewsAt: nextRenew(now, item.interval),
      canceledAt: undefined,
      cancelReason: undefined,
    }
    if (existing) st.patch('subscriptions', existing.id, fields)
    else st.insert('subscriptions', { ...fields, product: item.product })
  }
  const lines = totals.lines.map((l) => ({ label: `${l.label}${l.interval === 'annual' ? ' (anual)' : ''}`, amount: l.amount }))
  if (totals.referral && totals.referralDiscount) lines.push({ label: totals.referral.invoiceLabel, amount: -totals.referralDiscount })
  if (totals.discount) lines.push({ label: `Desconto ${opts.discountCode}`, amount: -totals.discount })
  if (totals.creditApplied) lines.push({ label: 'Crédito aplicado', amount: -totals.creditApplied })
  lines.push({ label: 'IVA 0% (autoliquidação)', amount: 0 })
  const invoice = st.insert('invoices', {
    number: opts.invoiceNumber,
    date: now.toISOString(),
    amount: totals.total,
    status: 'paid',
    description: opts.description ?? 'Assinatura Kloel',
    lines,
    cardLabel: opts.card ? `${opts.card.brand} •••• ${opts.card.last4}` : undefined,
    simulated: true,
  } as Partial<Invoice>)
  if (opts.card) st.patchBilling({ card: opts.card })
  if (opts.discountCode) st.patchBilling({ discountCode: opts.discountCode })
  if (totals.creditApplied) moveCredit(-totals.creditApplied, `Abatido da fatura ${opts.invoiceNumber}`)
  if (referral && totals.referralDiscount) {
    // "50% por 2 meses": o mês ainda não coberto por esta fatura (mensal → 2º mês) entra como crédito para a próxima cobrança.
    if (totals.referral?.carryCredit) moveCredit(totals.referral.carryCredit, `Desconto de indicação (${totals.referral.code}): ${totals.referral.percent}% no 2º mês de ${totals.referral.targetLabel}`)
    // O benefício vale uma vez; quem indicou passa a ver o indicado como "Cliente ativo" (crédito a liberar após 1 mês) em Bônus grátis.
    st.patchOrg({ referralDiscountInvoiceId: invoice.id, referralDiscountAppliedAt: now.toISOString() }, orgId)
    const email = st.db.users.find((u) => u.id === st.db.session.userId)?.email.toLowerCase()
    const ref = st.db.referrals.find((r) => r.orgId === referral.referrerId && r.email.toLowerCase() === email && (r.status === 'invited' || r.status === 'signed_up'))
    if (ref) st.patch('referrals', ref.id, { status: 'active', credit: REFERRAL_AMOUNT })
  }
  return invoice
}

/** Quanto do saldo de crédito é abatido de uma cobrança proporcional (upgrade). */
export function planChangeCharge(prorated: number, credits: number) {
  const due = roundMoney(Math.max(0, prorated))
  const creditApplied = roundMoney(Math.min(Math.max(0, credits), due))
  return { due, creditApplied, charge: roundMoney(due - creditApplied) }
}

/**
 * Troca de plano de uma assinatura existente.
 * - Upgrade (prorated > 0): gera fatura da diferença proporcional, abatendo o saldo de crédito disponível.
 * - Downgrade (prorated < 0): o crédito proporcional entra no saldo (BillingProfile.credits) e é abatido da próxima cobrança.
 */
export function applyPlanChange(sub: Subscription, tier: PlanTier, opts: { invoiceNumber?: string; prorated: number; card?: SavedCard }) {
  const st = useStore.getState()
  const plan = planOf(sub.product, tier)
  const monthly = planMonthly(plan, sub.interval) ?? sub.priceMonthly
  const from = subscriptionLabel(sub.product, sub.plan)
  const to = subscriptionLabel(sub.product, tier)
  st.patch('subscriptions', sub.id, { plan: tier, priceMonthly: monthly, status: 'active' })
  if (opts.prorated > 0 && opts.invoiceNumber) {
    const { due, creditApplied, charge } = planChangeCharge(opts.prorated, currentCredits())
    const lines = [{ label: `Diferença proporcional: ${from} → ${to}`, amount: due }]
    if (creditApplied) lines.push({ label: 'Crédito aplicado', amount: -creditApplied })
    st.insert('invoices', {
      number: opts.invoiceNumber,
      date: new Date().toISOString(),
      amount: charge,
      status: 'paid',
      description: `Alteração de plano — ${to}`,
      lines,
      cardLabel: opts.card ? `${opts.card.brand} •••• ${opts.card.last4}` : undefined,
      simulated: true,
    } as Partial<Invoice>)
    if (creditApplied) moveCredit(-creditApplied, `Abatido da fatura ${opts.invoiceNumber}`)
  } else if (opts.prorated < 0) {
    moveCredit(-opts.prorated, `Crédito proporcional: ${from} → ${to} (${money(-opts.prorated)})`)
  }
}

/** Valor proporcional (dias restantes do ciclo) de uma troca de plano. Negativo = crédito para o próximo ciclo. */
export function proratedDifference(sub: Subscription, tier: PlanTier, now = new Date()) {
  const plan = planOf(sub.product, tier)
  const newMonthly = planMonthly(plan, sub.interval) ?? sub.priceMonthly
  const diffMonthly = newMonthly - sub.priceMonthly
  if (!sub.renewsAt) throw new Error('Consulte a cobrança proporcional no portal financeiro.')
  const end = new Date(sub.renewsAt).getTime()
  const cycleDays = sub.interval === 'annual' ? 365 : 30
  const daysLeft = Math.max(0, Math.min(cycleDays, Math.ceil((end - now.getTime()) / 86400000)))
  const factor = sub.interval === 'annual' ? (daysLeft / 365) * 12 : daysLeft / 30
  return { newMonthly, diffMonthly, daysLeft, amount: Math.round(diffMonthly * factor * 100) / 100 }
}
