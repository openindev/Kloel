/**
 * Extensões de tipo do módulo "mais-a" (Visão geral, Números de telefone, WhatsApp, Agendador, Campanhas).
 * Module augmentation: campos opcionais, para não quebrar dados persistidos antes desta extensão.
 */
import type { ID, ISODate, ConversationResult } from '@/domain/types'

/** Aviso SIMULADO de um agendamento (aba Notificações do Agendador). Nada é enviado de fato. */
export interface BookingNotice {
  kind: 'confirmation' | 'reminder' | 'team' | 'cancellation' | 'reschedule'
  channel: 'email' | 'sms' | 'team'
  to?: string
  /** quando o aviso foi (ou será, no caso de lembretes) disparado na simulação */
  at: ISODate
}

/* ------------------------------ Kloel PBX (central telefônica) ------------------------------ */

/** Quem é notificado quando alguém liga (OBSERVADO: central de ajuda phone-numbers/pbx, PB-05). */
export type PbxMode = 'nobody' | 'one' | 'group' | 'sequence' | 'ai'
/** Roteamento por pessoas (Uma pessoa / Grupo em paralelo / Um após o outro) — também usado pela lista de permissões. */
export interface PbxRouting {
  ownerUserId?: ID
  ringSeconds: number
  groupUserIds: ID[]
  steps: { id: ID; userId?: ID; seconds: number }[]
}
export interface PbxConfig extends PbxRouting {
  mode: PbxMode
  /** "Assistente de IA" (modo ai) */
  agentId?: ID
  allowlist: PbxRouting & { enabled: boolean; contactIds: ID[]; routing: 'one' | 'group' | 'sequence' }
  businessHours: {
    enabled: boolean
    timezone: string
    /** undefined = "Não configurado" */
    hours?: { day: number; enabled: boolean; from: string; to: string }[]
    outside: 'missed' | 'hangup' | 'voicemail' | 'agent'
  }
  /** "Quando ninguém atende" */
  missed: 'nothing' | 'voicemail' | 'agent'
  missedAgentId?: ID
  voicemail: { source: 'ai' | 'upload'; text: string; voiceId: string; generatedText?: string; generatedAt?: ISODate; fileName?: string }
  /** "Ação pós-chamada": e-mails enviados (SIMULADO) depois que a chamada é transcrita */
  postCallEmails: { id: ID; to: string }[]
  callerId: 'this' | 'hidden'
  recording: boolean
  /** "Acesso SIP" (credenciais demonstrativas para aparelhos de terceiros) */
  sipAccess?: { username: string; password: string; createdAt: ISODate }
}

/* ------------------------------ Chatbot de IA (Webchat) ------------------------------ */

export interface WebchatSetup {
  /** "Widget do site" ativo = pelo menos um site permitido salvo */
  allowedSites: string[]
  widgetGreeting: string
  /** "Link hospedado" ativo */
  hostedEnabled: boolean
  assistantSlug?: string
  hostedGreeting: string
  /** "Personalizar" */
  avatar: 'feminino' | 'masculino' | 'upload'
  avatarUpload?: { name: string; dataUrl: string }
  avatarBorder: boolean
  displayName: string
  attachments: boolean
  theme: 'light' | 'dark'
  accent: string
  accentMode: 'header' | 'buttons'
  widgetId: string
}

declare module '@/domain/types' {
  interface PhoneNumber {
    /** número criado ao conectar uma conta do WhatsApp Business (liberar o número desconecta a conta) */
    whatsappAccountId?: ID
    /** número PBX (Kloel PBX): roteamento da central telefônica */
    pbx?: PbxConfig
  }

  interface Membership {
    /** "Posição PBX" do usuário nesta organização (telefone do navegador + roteamento do PBX) */
    pbxSeat?: boolean
  }

  interface Agent {
    /** Chatbot de IA (Widget do site / Link hospedado / Personalizar) — fora do rascunho da página do assistente */
    webchatSetup?: WebchatSetup
    /** "Mensagem inicial" dos links wa.me deste assistente (Números de WhatsApp deste assistente) */
    whatsappStarter?: string
  }

  interface WhatsAppAccount {
    /** registro correspondente em Números de telefone (capacidade "whatsapp") */
    phoneNumberId?: ID
    testMessages?: { id: ID; to: string; body: string; at: ISODate }[]
  }

  interface EventType {
    /** página de reserva aceita novos agendamentos (padrão: true) */
    active?: boolean
    timezone?: string
    confirmationMessage?: string
  }

  interface Booking {
    /** respostas da "Coleta de dados" (id do campo → valor) */
    answers?: Record<ID, string>
    canceledAt?: ISODate
    createdAt?: ISODate
    /** avisos SIMULADOS registrados conforme a aba Notificações do tipo de evento (nada é enviado) */
    notices?: BookingNotice[]
    /** última remarcação feita pelo convidado na página de confirmação */
    rescheduledAt?: ISODate
  }

  interface Campaign {
    objective?: string
    startedAt?: ISODate
    completedAt?: ISODate
    /** resultado por contato (simulação de ligações outbound) */
    results?: Record<ID, { result: ConversationResult; conversationId?: ID; durationSec: number; at: ISODate }>
    lastError?: string
  }

  interface UiPrefs {
    /** ciclo de cobrança selecionado no cartão "Uso" da Visão geral (ISO do início do ciclo) */
    overviewUsageCycle?: string
    /** grupo "Mais" da sidebar aberto/recolhido (persistido; padrão: aberto após o pagamento) */
    sidebarMoreOpen?: boolean
    /** telefone do navegador (PBX): aberto/recolhido e disponibilidade para receber chamadas */
    pbxPhoneOpen?: boolean
    pbxPhoneAvailable?: boolean
    pbxPhoneNumberId?: string
  }
}

export {}
