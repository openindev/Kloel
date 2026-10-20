/**
 * Extensões de domínio do módulo Cobrança / Primeiro acesso (module augmentation).
 * Campos opcionais: dados antigos continuam válidos sem migração.
 */
import type { BillingInterval, PlanTier, ProductKey } from '@/domain/types'

/** Item do carrinho de assinatura (primeiro acesso e checkout demonstrativo). */
export interface CartItem {
  product: ProductKey
  tier: PlanTier
  interval: BillingInterval
}

export type IdentityDocumentType = 'rg' | 'cnh' | 'passport'

/** Progresso da verificação de identidade em andamento (persistido: retomada após recarregar e guarda das etapas). */
export interface IdentityFlow {
  /** "Concordar e continuar" no consentimento. */
  consentAt?: string
  /** Lados capturados: "rg-Frente", "rg-Verso", "passport-Frente"... */
  captures?: string[]
  selfie?: boolean
}

declare module '@/domain/types' {
  interface Organization {
    /** Carrinho do primeiro acesso (persistido para retomar após recarregar). */
    onboardingCart?: CartItem[]
    /** Aba de produto aberta no modal de planos do primeiro acesso. */
    onboardingTab?: ProductKey
    /** Interruptor "cobrança anual" do modal de planos. */
    onboardingAnnual?: boolean
    /** true quando o modal de planos foi reaberto por "Adicionar produto adicional". */
    onboardingAddMode?: boolean
    /** Código de desconto aplicado no checkout do primeiro acesso. */
    onboardingDiscount?: string
    /** Assistente criado pelo assistente de configuração (evita duplicar ao voltar). */
    onboardingAgentId?: string
    /** Última conversa gerada pela ligação de teste do primeiro acesso. */
    onboardingTestConversationId?: string
    onboardingCompletedAt?: string
    /** Fatura em que o desconto de indicação (signupIntent.referralCode) foi aplicado — o benefício vale uma única vez. */
    referralDiscountInvoiceId?: string
    referralDiscountAppliedAt?: string
    /** "Escolher outro plano" no banner do plano escolhido no cadastro (signupIntent): o banner deixa de ser exibido. */
    signupIntentDismissed?: boolean
  }

  interface BillingProfile {
    phone?: string
    discountCode?: string
    identityUpdatedAt?: string
    identityDocument?: IdentityDocumentType
    /** Tentativa de verificação em andamento (consentimento → documento → selfie). */
    identityFlow?: IdentityFlow
    /** Motivo da última falha da verificação (exibido ao recarregar com status "Ação necessária"). */
    identityError?: string
    /** Histórico do saldo de crédito (BillingProfile.credits): créditos gerados e abatimentos. */
    creditLog?: { date: string; amount: number; label: string }[]
  }

  interface Subscription {
    canceledAt?: string
    cancelReason?: string
  }

  interface Invoice {
    lines?: { label: string; amount: number }[]
    cardLabel?: string
    simulated?: boolean
  }
}
