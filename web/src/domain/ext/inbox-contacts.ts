/**
 * Extensões de domínio do módulo "inbox-contacts" (Conversas + Contatos).
 * Module augmentation: não altera src/domain/types.ts.
 */
import type {} from '@/domain/types'

declare module '@/domain/types' {
  interface Conversation {
    /** Gravação simulada da chamada (somente quando o assistente grava o áudio). INFERIDO. */
    recording?: { durationSec: number; url?: string; peaks?: number[] }
    /**
     * Chat assumido pela equipe (Central de ajuda › WhatsApp › "4. Assumir uma conversa"): enquanto presente,
     * o assistente não responde e a equipe escreve pelo compositor de Conversas (envio simulado). INFERIDO.
     */
    handover?: { userId?: string; by: string; at: string | null }
    /**
     * Chat em andamento (Central de ajuda › WhatsApp, captura "Assumir conversas": chip "● Ativo", sem assunto/resumo ainda,
     * rodapé "A IA está atendendo este chat"). Enquanto ativo, o `result` não é exibido nem filtrado. OBSERVADO (WA-03).
     */
    chatActive?: boolean
    /**
     * Dados extraídos pelo assistente durante a conversa (Central de ajuda › Análise › "Extraction": pares chave/valor
     * definidos nas variáveis das ações). Exibidos na seção "Extração" do painel quando existem. OBSERVADO (AN-08).
     */
    extraction?: Record<string, string>
  }
  interface TranscriptLine {
    /** Mensagem escrita pela equipe depois de assumir o chat (speaker = 'assistant', lado da empresa). */
    author?: 'team'
    /** Nome de quem enviou (equipe). */
    authorName?: string
    /** Momento do envio (ISO) — exibido como horário em vez do deslocamento m:ss. */
    sentAt?: string
    /** Envio simulado (sem mensageria real nesta demonstração). */
    simulated?: boolean
  }
  interface Contact {
    /** "Configurações de comunicação" (Central de ajuda › Contatos): ligações deste contato não são atendidas. */
    blocked?: boolean
    /** "Configurações de comunicação": WhatsApp AI ativo para este contato (padrão: ativo). */
    whatsappAi?: boolean
    /**
     * Histórico de alterações do contato (ícone "histórico" ao lado do título, Central de ajuda › Contatos CO-01).
     * Eventos gravados pelas ações locais (criar, editar, importar, bloquear, WhatsApp IA). INFERIDO (conteúdo).
     */
    history?: ContactHistoryEvent[]
  }
  interface ContactHistoryEvent {
    at: string
    /** Quem fez a alteração (nome do usuário) ou "Importação"/"Conversa". */
    by: string
    kind: 'created' | 'updated' | 'imported' | 'blocked' | 'unblocked' | 'whatsapp_on' | 'whatsapp_off'
    /** Campos alterados (rótulos PT) — só para `updated`/`imported`. */
    fields?: string[]
  }
  interface SmartFieldDef {
    /** "Configurações avançadas": exemplo usado como placeholder no formulário do contato. */
    example?: string
    /** "Configurações avançadas": exibir o valor do campo na lista de contatos. */
    showInList?: boolean
  }
  interface UiPrefs {
    /**
     * Preferências persistidas de Contatos: largura da coluna de lista, ordenação e filtros por organização
     * (a busca digitada vale só para a sessão).
     */
    contacts?: {
      listWidth?: number
      sort?: 'name_asc' | 'name_desc' | 'recent' | 'updated'
      /** Legado (sem organização): ignorado e removido na próxima gravação. */
      filters?: { company?: string; owner?: string; source?: string; field?: string; comm?: string }
      /** Filtros por organização (empresa, responsável e campo inteligente só existem dentro da própria org). */
      filtersByOrg?: Record<string, { company?: string; owner?: string; source?: string; field?: string; comm?: string }>
    }
    /** Conversas: exibição do horário na lista (absoluto "01:35" ↔ relativo "há 38 min"), persistida. */
    inboxView?: { relativeTime?: boolean }
    /**
     * Painel "Detalhes" de Conversas em telas largas. Ausente = FECHADO (Fonio ao vivo, fonio-live2/D-conversas/01 e 12).
     * Gravado quando o usuário alterna o painel.
     */
    inboxDetailsPanel?: 'open' | 'closed'
    /** Player da gravação (AN-09): volume 0–1 e mudo, persistidos. */
    inboxPlayer?: { volume?: number; muted?: boolean }
  }
}

export {}
