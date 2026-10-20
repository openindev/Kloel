/**
 * Extensões de tipo do módulo "agents-core" (Assistentes).
 * Campos opcionais — dados antigos/seed base continuam válidos.
 */
import type { ID } from '@/domain/types'

/** Entrada da conversa (Central de ajuda › Chatbot de IA, WC-04). */
export type ChatEntryMode = 'ai' | 'team' | 'condition'
/** Agenda de resposta da IA (WC-05). */
export type ChatResponseSchedule = 'always' | 'open' | 'closed'
/** Condições da transferência de conversa ativa (WC-06). */
export type ChatHandoverMode = 'standard' | 'standard_custom' | 'custom'

/** Assistente de chat: tempo limite e "Gestão de conversas" (Central de ajuda › Chatbot de IA, WC-03…WC-06). */
export interface ChatSettings {
  /** "Tempo limite da conversa" em minutos (15 min, 1 h, 4 h, 12 h, 24 h ou personalizado) */
  timeoutMinutes: number
  entry: { mode: ChatEntryMode; condition: string }
  schedule: ChatResponseSchedule
  handover: { enabled: boolean; mode: ChatHandoverMode; custom: string }
  /** "Notificações da equipe" (linha observada em WC-03 com "Desligado"; folha INFERIDA) */
  notifications: { enabled: boolean; onTeamEntry: boolean; onHandover: boolean; userIds: ID[] }
}

declare module '@/domain/types' {
  interface KnowledgeEntry {
    /** fonte (site/documento) que gerou a entrada; usada para excluir/atualizar as entradas junto com a fonte */
    sourceId?: ID
  }
  interface KnowledgeSource {
    /** URL normalizada do site importado (type = website) */
    url?: string
    /** nome do arquivo enviado (type = document) */
    fileName?: string
  }
  interface Agent {
    /**
     * "Formalidade" do Básico (assistentes de voz em idiomas com tratamento formal/informal — OBSERVADO com Alemão em
     * EM-01/FS-02; ausente na captura ao vivo em Português (Brasil)). Padrão: 'custom' = "Personalizado (via prompt)".
     */
    formality?: 'formal' | 'informal' | 'custom'
    /** Assistentes de chat: tempo limite e gestão de conversas. */
    chat?: ChatSettings
  }
  interface Conversation {
    /**
     * Nome do assistente gravado quando ele foi excluído (a conversa é mantida): Conversas exibe "<nome> (excluído)".
     * Ver `conversationAgentName` em src/app/pages/agents/core/agentOps.ts.
     */
    agentNameSnapshot?: string
    agentDeletedAt?: string
  }
}

export {}
