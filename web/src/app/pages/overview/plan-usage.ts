import { useMemo } from 'react'
import { addMonths, subMonths } from 'date-fns'
import type { ProductKey, Subscription, BillingProfile, PhoneNumber, WhatsAppAccount } from '@/domain/types'
import { useBillingProfile, useCollection } from '@/data/store'
import { orgPlanLimit, planOf, productByKey, type PlanDef } from '@/data/catalogs/plans'
import { engineSession } from '@/services/engine/session'

/**
 * Cotas e limites derivados das assinaturas (catálogo de planos) + add-ons do perfil de cobrança.
 * Usado por Visão geral (cartão "Uso"), Números de telefone, WhatsApp e Campanhas.
 */

export function activeSubscription(subs: Subscription[], product: ProductKey) {
  return subs.find((s) => s.product === product && s.status === 'active')
}

export function useProductPlan(product: ProductKey): { sub?: Subscription; plan?: PlanDef; productName: string } {
  const subs = useCollection('subscriptions')
  return useMemo(() => {
    const sub = activeSubscription(subs, product)
    return { sub, plan: sub ? planOf(product, sub.plan) : undefined, productName: productByKey(product).name }
  }, [subs, product])
}

/** Minutos incluídos + add-on "Minutos de ligação" (cada unidade do add-on = 100 min). */
export function minutesQuota(plan: PlanDef | undefined, billing: BillingProfile | undefined) {
  return (plan?.limits.minutes ?? 0) + (billing?.addOns?.minutes ?? 0) * 100
}

/** Números comprados na plataforma contam na cota "Números de telefone" (SIP e importados não). */
export function numberQuota(plan: PlanDef | undefined, billing: BillingProfile | undefined, numbers: PhoneNumber[]) {
  const included = plan?.limits.numbers ?? 0
  const extra = billing?.addOns?.numbers ?? 0
  const used = numbers.filter((n) => n.kind === 'purchased').length
  const limit = included + extra
  return { included, extra, used, limit, reached: used >= limit }
}

export function useNumberQuota() {
  const { sub, plan } = useProductPlan('voice')
  const billing = useBillingProfile()
  const numbers = useCollection('phoneNumbers')
  return useMemo(() => {
    const q = numberQuota(plan, billing, numbers)
    return { ...q, sub, plan, sipAllowed: !!sub && (sub.plan === 'team' || sub.plan === 'scale') }
  }, [plan, billing, numbers, sub])
}

export function whatsappQuota(plan: PlanDef | undefined, billing: BillingProfile | undefined, accounts: WhatsAppAccount[]) {
  const included = plan?.limits.whatsappNumbers ?? 0
  const extra = billing?.addOns?.waNumbers ?? 0
  const limit = included + extra
  return { included, extra, used: accounts.length, limit, reached: accounts.length >= limit }
}

export function useWhatsAppQuota() {
  const { sub, plan } = useProductPlan('whatsapp')
  const billing = useBillingProfile()
  const accounts = useCollection('whatsappAccounts')
  return useMemo(() => ({ ...whatsappQuota(plan, billing, accounts), sub, plan }), [plan, billing, accounts, sub])
}

/** Incluído quando nenhum plano ativo define `limits.workspaceConnections` (mesmo padrão do add-on "Conexões de workspace"). */
export const WORKSPACE_CONNECTIONS_FALLBACK = 2

/**
 * "Conexões do workspace" (FS-01 "Workspace connections 1 / 5", AN-10 "0 / 3"): contas Google/Microsoft distintas
 * conectadas à organização (Configurações da empresa › Conexões de contas e caixas da IA de e-mail, contadas por e-mail —
 * mesma regra do "Uso" em Assinatura e faturamento). Limite = `orgPlanLimit(subs, 'workspaceConnections')` (maior valor entre
 * os planos ativos; leitura defensiva com fallback 2 se o catálogo não definir) + add-on "Conexões de workspace" (+1/unidade).
 * `Infinity` (Scale) = ilimitado.
 */
export function workspaceConnectionsQuota(
  subs: Subscription[],
  billing: BillingProfile | undefined,
  calendarConnections: { email: string }[],
  emailInboxes: { address: string }[],
) {
  const fromCatalog = orgPlanLimit(subs, 'workspaceConnections')
  const included = typeof fromCatalog === 'number' && !Number.isNaN(fromCatalog) && fromCatalog >= 0 ? fromCatalog : WORKSPACE_CONNECTIONS_FALLBACK
  const extra = billing?.addOns?.workspaces ?? 0
  const used = new Set([...calendarConnections.map((c) => c.email.trim().toLowerCase()), ...emailInboxes.map((i) => i.address.trim().toLowerCase())].filter(Boolean)).size
  const limit = included + extra
  return { included, extra, used, limit, fromCatalog: fromCatalog !== undefined, reached: used >= limit }
}

/** "Campanhas outbound": disponível a partir do plano Voice Team (mesma regra da sidebar). */
export function useCampaignsUnlocked() {
  return engineSession.can('campaigns:read')
}

export interface BillingCycle {
  key: string // ISO do início
  from: Date
  to: Date
  current: boolean
}

/** Ciclos de cobrança mensais da assinatura de telefone (ou da primeira ativa), do atual para trás. */
export function billingCycles(subs: Subscription[], now = new Date(), max = 6): BillingCycle[] {
  const sub = activeSubscription(subs, 'voice') ?? subs.find((s) => s.status === 'active')
  if (!sub || !sub.startedAt || !sub.renewsAt) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return [{ key: from.toISOString(), from, to: addMonths(from, 1), current: true }]
  }
  const started = new Date(sub.startedAt)
  let end = new Date(sub.renewsAt)
  while (end.getTime() <= now.getTime()) end = addMonths(end, 1)
  const out: BillingCycle[] = []
  for (let i = 0; i < max; i++) {
    const to = subMonths(end, i)
    const from = subMonths(end, i + 1)
    if (i > 0 && to.getTime() <= started.getTime()) break
    out.push({ key: from.toISOString(), from, to, current: i === 0 })
  }
  return out
}

const shortFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
const longFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtShortDate = (d: Date) => shortFmt.format(d)
export const fmtLongDate = (d: Date) => longFmt.format(d)
export const cycleLabel = (c: BillingCycle) => `${fmtShortDate(c.from)} – ${fmtShortDate(c.to)}`
/** Opção da lista "Período de cobrança": "18 de out. de 2026 – 18 de nov. de 2026" (+ " · atual" no ciclo vigente). */
export const cycleLongLabel = (c: BillingCycle) => `${fmtLongDate(c.from)} – ${fmtLongDate(c.to)}`
