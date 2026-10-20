/**
 * Extensões de tipo do módulo "agents-resources" (folhas de Recursos/Ações do assistente).
 * Somente campos OPCIONAIS — dados antigos e o seed base continuam válidos.
 */
import type { ID } from '@/domain/types'

/** Janela de execução ("Ativo"): a qualquer momento, durante ou fora do horário de funcionamento. */
export type ActiveWindow = 'any' | 'during' | 'outside'
/** Momento de execução ("Execução"): antes, durante ou após a conversa. */
export type ExecutionTiming = 'before' | 'during' | 'after'

/** Configurações de um agendamento (aba Configurações / Configurações avançadas). Guardado em SchedulingAction.settings. */
export interface SchedulingSettings {
  timezone: string
  allowBookings: boolean
  destination: 'sms' | 'email'
  smsSenderName: string
  allowBookingLinks: boolean
  fallbackEmail: string
  durationMin?: number
  /** Agendador da Kloel (AP-11): não enviar confirmação/remarcação/cancelamento ao cliente. */
  disableNotifications?: boolean
}

export interface ResponseMappingRow {
  id: ID
  variable: string
  path: string
}

/**
 * Variável personalizada ({{nome}} digitada no texto que não existe no catálogo) — a IA preenche o valor durante a conversa
 * conforme a descrição (refs. da Central de ajuda SM-05 / HR-07: tipo Texto/Número/Booleano e descrição obrigatória).
 */
export interface CustomVariable {
  name: string
  type: 'string' | 'number' | 'boolean'
  description: string
}

/** Ação "Enviar SMS" (Central de ajuda, artigo actions/sms: SM-01…SM-05). Envio sempre simulado na demonstração. */
export interface SmsAction {
  id: ID
  name: string
  timing: ExecutionTiming
  activeWindow?: ActiveWindow
  when: 'always' | 'only_if'
  condition?: string
  /** Durante a conversa: "Quando a IA deve usar isto?" */
  aiUsage?: string
  /** Durante a conversa: "Ao enviar, diga" (vazio = silêncio) */
  sendingPhrase?: string
  /** Quem liga | Números fixos | Deixar a IA decidir */
  recipientsMode: 'caller' | 'fixed' | 'ai'
  recipients: string[]
  recipientsInstruction?: string
  messageMode: 'manual' | 'ai'
  message: string
  aiInstruction?: string
  /** Remetente exibido (até 11 letras/números). */
  sender: string
  customVariables?: CustomVariable[]
}

/** Ferramenta de um servidor MCP descoberta pela conexão (simulada). */
export interface McpTool {
  name: string
  description: string
  enabled: boolean
}

declare module '@/domain/types' {
  interface TransferTarget {
    activeWindow?: ActiveWindow
    /** Destino "PBX" (Central de ajuda CT-04): número da central da organização; `mode` fica 'phone' com o número em `destination`. */
    pbxNumberId?: ID
    /** "Atraso após transferência com falha" em segundos (CT-01, padrão 0). */
    failureDelaySec?: number
  }
  interface EmailAction {
    activeWindow?: ActiveWindow
    /** "Antes da conversa" não cabe em `timing`; este campo é a fonte da verdade quando presente. */
    executionTiming?: ExecutionTiming
    /** Nome de exibição do remetente ("<nome> via Kloel"). */
    fromName?: string
    /** Durante a conversa (EM-04): "Quando a IA deve usar isto?" */
    aiUsage?: string
    /** Durante a conversa (EM-04): "Ao enviar, diga" — vazio = silêncio. */
    sendingPhrase?: string
  }
  interface WhatsAppAction {
    activeWindow?: ActiveWindow
  }
  interface WebSearchAction {
    name?: string
    activeWindow?: ActiveWindow
    /** "Ao pesquisar, dizer" — vazio = silêncio. */
    searchingPhrase?: string
  }
  interface SchedulingAction {
    activeWindow?: ActiveWindow
    description?: string
    /** Conta conectada (Calendly / Cal.com) — conexão simulada. */
    connectedAccount?: string
    calendarConnectionId?: ID
  }
  interface IntegrationAction {
    activeWindow?: ActiveWindow
    description?: string
    connectedAt?: ISODate
    /** Integrações por webhook (Make, n8n, Zapier): resultado do último "Enviar teste" (simulado) para a URL salva. */
    lastTest?: { ok: boolean; at: ISODate; detail: string }
  }
  interface WebhookConfig {
    activeWindow?: ActiveWindow
    /** Avançado › Condição (linguagem natural). Vazio = sempre executar. */
    condition?: string
    timeoutMs?: number
    /** Webhook de entrada › Valores padrão (JSON usado quando a resposta falha). */
    defaults?: string
    responseMapping?: ResponseMappingRow[]
    /**
     * Contexto de teste › Contato de exemplo reconhecido na ligação/chat de teste (preenche "Contato: …" e as regras da
     * mensagem inicial). `''` = contato desconhecido; ausente = contato mais antigo da organização. INFERIDO.
     */
    sampleContactId?: ID
    /** Requisição HTTP › Avançado (HR-08): reutilizar o resultado de chamadas idênticas na mesma conversa (padrão ligado). */
    replayIdentical?: boolean
    /** Requisição HTTP › Avançado (HR-08) / servidor MCP: frase dita enquanto a chamada roda (vazio = silêncio). */
    waitingPhrase?: string
    /** Variáveis personalizadas {{x}} usadas na URL/cabeçalhos/corpo (HR-07). */
    customVariables?: CustomVariable[]
    /** "Adicionar novo webhook" › "Adicionar servidor MCP" (HR-02): guardado como kind http_request com variant 'mcp'. */
    variant?: 'http' | 'mcp'
    /** Servidor MCP: ferramentas descobertas na última conexão (simulada). */
    mcpTools?: McpTool[]
    mcpConnectedAt?: ISODate
  }
  interface Agent {
    /** Conectar contatos › detalhes que o assistente pode usar e associação por número fixo. */
    contactAccess?: { fields: string[]; matchLandline: boolean }
    /** Enviar SMS (SM-01…SM-05). */
    smsActions?: SmsAction[]
  }
  interface Organization {
    /** Números verificados por "Verificar propriedade do número" (destinatários de Enviar WhatsApp). */
    verifiedWhatsAppNumbers?: { number: string; verifiedAt: ISODate }[]
  }
}

export {}
