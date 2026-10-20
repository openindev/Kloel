/**
 * Extensões de tipos do módulo "mais-b" (E-Mail IA, Integrações, Chaves de API, Configurações da empresa,
 * Usuários, Conta, Bônus grátis). Somente campos OPCIONAIS — o modelo base (src/domain/types.ts) não muda.
 */
import type { ID, ISODate } from '@/domain/types'

/** Entrada de conhecimento do agente de e-mail (Assistente → Conhecimento). */
export interface EmailKnowledgeItem {
  id: ID
  title: string
  content: string
  createdAt: ISODate
  updatedAt?: ISODate
}

/** Solicitação de desconto (Bônus grátis → "Registrar envio"). Guardada no perfil de cobrança da organização. */
export interface CreditClaim {
  id: ID
  rewardId: string
  label: string
  /** valor demonstrativo em R$; null = "Personalizado" */
  amount: number | null
  evidence: string
  note?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: ISODate
  decidedAt?: ISODate
  createdByUserId?: ID
}

export type EmailTone = 'professional' | 'friendly' | 'formal' | 'casual' | 'empathetic'

declare module '@/domain/types' {
  interface EmailInbox {
    /** conexão (Configurações da empresa → Conexões de contas) de onde vem a caixa */
    connectionId?: ID
    ownerUserId?: ID
    displayName?: string
    knowledgeItems?: EmailKnowledgeItem[]
    lastSyncedAt?: ISODate
    activatedAt?: ISODate
    /** quantas vezes a sincronização simulada já trouxe novos e-mails (controla o pool de exemplos) */
    syncCursor?: number
  }
  interface EmailMessage {
    fromName?: string
    toName?: string
    /** e-mail enviado/gerado pela simulação local (nenhum e-mail real sai da demonstração) */
    simulated?: boolean
    inReplyTo?: ID
    starred?: boolean
    autoSent?: boolean
    draftAt?: ISODate
    draftError?: string
    /** origem do rascunho salvo em `aiDraft`: gerado pela IA (simulada) ou escrito manualmente */
    draftSource?: 'ai' | 'manual'
  }
  interface ApiKey {
    last4?: string
    createdByUserId?: ID
  }
  interface IntegrationRequest {
    requestedByUserId?: ID
  }
  interface Invite {
    invitedByUserId?: ID
    acceptedAt?: ISODate
    revokedAt?: ISODate
    sendCount?: number
  }
  interface BillingProfile {
    creditClaims?: CreditClaim[]
  }
}
