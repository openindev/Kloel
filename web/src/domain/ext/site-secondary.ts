/**
 * Extensões de domínio do módulo "site-secondary" (planos, agendamentos públicos, cadastro, parceiros, empresa).
 * Module augmentation — todos os campos são opcionais (dados antigos continuam válidos).
 */
import type {} from '@/domain/types'

declare module '@/domain/types' {
  interface DemoBooking {
    /** origem do agendamento (ex.: contact, pricing, scale-calculator, integracoes, header) */
    source?: string
    /** fuso escolhido pelo visitante para exibir os horários (o horário salvo é sempre America/Sao_Paulo) */
    timezone?: string
    /** e-mails adicionais convidados para a reunião */
    guests?: string[]
    /** canais por onde os clientes entram em contato (demo de cliente) */
    channels?: string[]
    otherChannel?: string
    /** parceria: clientes ativos atendidos e quantos começariam nas próximas 3 semanas */
    partnerClients?: string
    startingSoon?: string
    /** anfitrião (fictício) da reunião */
    hostName?: string
    canceledAt?: string
  }
  interface Organization {
    /** intenção registrada no cadastro público (plano/ciclo escolhido em /planos, código de indicação) */
    signupIntent?: { product?: string; plan?: string; cycle?: 'mensal' | 'anual'; referralCode?: string }
  }
}

export {}
