/**
 * Extensões de tipo do Agendador (telas observadas na central de ajuda pública — AP-01…AP-08,
 * docs/reference/specs/08-central-ajuda-telas.md). Somente campos OPCIONAIS: dados antigos e o seed base continuam
 * válidos; `normalizeEventType` (src/app/pages/scheduling/model.ts) preenche os padrões e migra os campos legados.
 */
import type { ID, ISODate } from '@/domain/types'
import '@/domain/ext/mais-a'

/** AP-01/AP-02: Reunião online / Ligação telefônica / Local físico / Sem local. */
export type LocationKind = 'online' | 'phone' | 'physical' | 'none'
/** Notificações padrão (AP-04): Confirmação / Reagendamento / Cancelamento. */
export type TemplateKind = 'confirmation' | 'reschedule' | 'cancellation'
/** AP-06: telefone no agendamento web — Obrigatório / Opcional / Não solicitado. */
export type WebPhoneMode = 'required' | 'optional' | 'hidden'
/** AP-08: eventos que disparam os webhooks do tipo de evento. */
export type BookingEvent = 'created' | 'rescheduled' | 'canceled'

/** Modelo de mensagem: HTML simples (div/b/i/u/h2/h3/br) com chips `<span data-var="chave">`. */
export interface MessageTemplate {
  subject: string
  body: string
}

export interface NotificationTemplates {
  /** "Nome do remetente do e-mail" (exibido como "<nome> via Kloel") */
  emailSenderName: string
  /** remetente das mensagens de texto (SMS: 3 a 11 letras ou números) */
  smsSenderName: string
  email: Record<TemplateKind, MessageTemplate>
  /** mensagens de texto não têm assunto (subject fica vazio) */
  sms: Record<TemplateKind, MessageTemplate>
  /** convite do calendário: subject = título do evento no calendário, body = descrição */
  calendar: MessageTemplate
}

/** AP-04 "Lembretes": cada lembrete é enviado N horas antes do compromisso, por e-mail ou mensagem de texto. */
export interface EventReminder {
  id: ID
  channel: 'email' | 'sms'
  hoursBefore: number
}

/** AP-08 "Webhooks": POST real (motor) quando um agendamento é criado, reagendado ou cancelado. */
export interface EventWebhook {
  id: ID
  url: string
  events: BookingEvent[]
  createdAt: ISODate
}

/** Entrega SIMULADA de um webhook (nada é enviado): resultado determinístico pela URL ("erro"/"fail"/"500" falham). */
export interface WebhookDelivery {
  webhookId: ID
  url: string
  event: BookingEvent
  at: ISODate
  ok: boolean
  code: number
}

declare module '@/domain/types' {
  interface EventType {
    locationKind?: LocationKind
    /** endereço exibido quando o local é "Local físico" */
    locationAddress?: string
    /** "Ligação telefônica": número a ser chamado pelo convidado (vazio = a empresa liga para o telefone do convidado) */
    locationPhone?: string
    /** AP-01 "Convidados fixos": e-mails convidados para todo agendamento (disponibilidade deles não é verificada) */
    staticInvitees?: string[]
    /** botão de ajustes do Calendário: outros calendários conectados cujos compromissos também bloqueiam horários */
    conflictCalendarIds?: ID[]
    templates?: NotificationTemplates
    reminders?: EventReminder[]
    webPhone?: WebPhoneMode
    /** true = `dataCollection` guarda só os campos personalizados (Nome/E-mail/Telefone são sempre coletados) */
    customFieldsV2?: boolean
    /** AP-08: não listar na página de reserva da empresa (/c/:org); o link direto continua funcionando */
    hideFromCompanyPage?: boolean
    /** AP-08 "Nome de exibição na página de reserva" (vazio = e-mail do calendário) */
    hostDisplayName?: string
    webhooks?: EventWebhook[]
  }

  interface Booking {
    /** link da reunião online criado pelo calendário conectado (Google Meet / Microsoft Teams) */
    meetingLink?: string
    /** convidados fixos copiados do tipo de evento no momento da reserva */
    invitees?: string[]
    /** motivo informado ao cancelar (variável "Agendamento: Motivo do cancelamento") */
    cancelReason?: string
    webhookDeliveries?: WebhookDelivery[]
  }
}

declare module '@/domain/ext/mais-a' {
  interface BookingNotice {
    /** assunto/mensagem renderidos com os valores do agendamento (modelos da aba Notificações) */
    subject?: string
    body?: string
    /** lembretes: antecedência em horas */
    hoursBefore?: number
    /** destinatário é um convidado fixo (convite de calendário) */
    audience?: 'invitee'
    /** remetente exibido ("<nome> via Kloel" no e-mail; ID do remetente no SMS) */
    from?: string
  }
}

export {}
