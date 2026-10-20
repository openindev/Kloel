import { useMemo } from 'react'
import '@/domain/ext/billing'
import '@/domain/ext/site-secondary'
import type { DemoDB, Organization, PlanTier, ProductKey } from '@/domain/types'
import { useCollection, useCurrentOrg, useStore } from '@/data/store'

/**
 * Benefício de indicação ("Indique um amigo") — DEMONSTRATIVO.
 * Texto do programa (Fonio ao vivo 2026-10-19 — Bônus grátis: "Ele ganha 50% de desconto por 2 meses"; cartão da barra lateral:
 * "Você ganha R$ 1.800 e seu contato ganha 50% de desconto por 2 meses"): quem indicou recebe R$ 1.800 depois que o indicado
 * completar um mês como cliente.
 * Aplicação: a partir da PRIMEIRA fatura da organização indicada (checkout do primeiro acesso), sobre UMA assinatura — a de maior
 * valor do carrinho (INFERIDO). A fatura anual já cobre os 2 meses; na mensal, o 2º mês vira crédito para a próxima cobrança
 * (lib.ts#REFERRAL_DISCOUNT).
 */
export const REFERRAL_AMOUNT = 1800
export { REFERRAL_DISCOUNT } from './lib'

/** FNV-1a de 32 bits com semente (determinístico, sem dependências). */
function fnv1a(text: string, seed: number) {
  let h = (0x811c9dc5 ^ seed) >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Código de indicação no formato da Fonio (`/register?ref=<uuid>`, A-sidebar/10): um UUID v4 DERIVADO do id da organização
 * (estável entre recarregamentos e entre navegadores, sem precisar ser gravado). `Organization.referralCode` (opcional) tem
 * prioridade quando existir.
 */
export function referralCodeOf(org: Pick<Organization, 'id'> & { referralCode?: string }) {
  if (org.referralCode) return org.referralCode
  const hex = [1, 2, 3, 4].map((s) => fnv1a(`kloel-ref:${org.id}`, s * 0x9e3779b1).toString(16).padStart(8, '0')).join('')
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Organização dona de um código de indicação: aceita o UUID de `referralCodeOf` e, por compatibilidade, o slug (/r/:slug). */
export function orgByReferralCode<T extends Pick<Organization, 'id' | 'slug'> & { referralCode?: string }>(orgs: T[], code: string | null | undefined) {
  const c = (code ?? '').trim().toLowerCase()
  if (!c) return undefined
  return orgs.find((o) => referralCodeOf(o).toLowerCase() === c) ?? orgs.find((o) => o.slug === c)
}

/** Link de indicação copiado pelo cartão "Indique um amigo" e por Bônus grátis: `<origem>/register?ref=<uuid>`. */
export function referralLinkOf(org: (Pick<Organization, 'id'> & { referralCode?: string }) | undefined, origin = window.location.origin) {
  return `${origin}/register?ref=${org ? referralCodeOf(org) : ''}`
}

export interface ReferralBenefit {
  /** código de indicação (slug da organização que indicou), vindo de Organization.signupIntent.referralCode */
  code: string
  referrerId: string
  referrerName: string
}

/** Benefício ainda disponível para a organização: cadastro por /r/:code com indicador existente e nenhuma fatura emitida. */
export function referralBenefitOf(db: Pick<DemoDB, 'organizations' | 'invoices'>, org: Organization | undefined): ReferralBenefit | undefined {
  const code = org?.signupIntent?.referralCode
  if (!org || !code || org.referralDiscountInvoiceId) return undefined
  const referrer = db.organizations.find((o) => o.slug === code && o.id !== org.id)
  if (!referrer) return undefined
  if (db.invoices.some((i) => i.orgId === org.id)) return undefined
  return { code, referrerId: referrer.id, referrerName: referrer.name }
}

export function useReferralBenefit(): ReferralBenefit | undefined {
  const org = useCurrentOrg()
  const organizations = useStore((s) => s.db.organizations)
  const invoices = useCollection('invoices')
  return useMemo(() => referralBenefitOf({ organizations, invoices }, org), [organizations, invoices, org])
}

/** Intenção de compra registrada no cadastro público (/criar-conta?produto=&plano=&ciclo=). Somente valores válidos. */
export interface SignupPlanIntent {
  product: Extract<ProductKey, 'voice' | 'whatsapp' | 'webchat'>
  tier?: Extract<PlanTier, 'solo' | 'team' | 'scale'>
  interval?: 'monthly' | 'annual'
}

export function signupPlanIntentOf(org: Organization | undefined): SignupPlanIntent | undefined {
  const i = org?.signupIntent
  const product = i?.product === 'voice' || i?.product === 'whatsapp' || i?.product === 'webchat' ? i.product : undefined
  if (!product) return undefined
  const tier = i?.plan === 'solo' || i?.plan === 'team' || i?.plan === 'scale' ? i.plan : undefined
  const interval = i?.cycle === 'anual' ? 'annual' : i?.cycle === 'mensal' ? 'monthly' : undefined
  return { product, tier, interval }
}
