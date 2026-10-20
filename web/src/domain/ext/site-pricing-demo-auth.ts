/**
 * Extensões de domínio do módulo "site-pricing-demo-auth" (agendamento público de demo).
 * Module augmentation — campos opcionais (agendamentos antigos continuam válidos).
 */
import type {} from '@/domain/types'
import '@/domain/ext/site-secondary'

declare module '@/domain/types' {
  interface DemoBooking {
    /** lead da calculadora do plano Scale que originou o agendamento (/planos?configurar=scale → "Falar com vendas") */
    leadId?: string
    /** horário anterior quando a reunião foi reagendada (o agendamento mantém o mesmo id) */
    rescheduledFrom?: { date: string; time: string; timezone?: string }
    rescheduledAt?: string
  }
}

export {}
