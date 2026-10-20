import type { Agent, KnowledgeEntry, TranscriptLine, ConversationResult, CalendarConnection } from '@/domain/types'
import type { ProgressFn } from './runtime'

/**
 * Contratos dos serviços externos. A interface (UI) depende apenas destes tipos.
 * Para conectar um motor real basta fornecer outra implementação em src/services/index.ts.
 */

export interface GeneratedAssistant {
  companyName: string
  website: string
  brandColor: string
  faviconLetter: string
  assistantName: string
  greeting: string
  companyInfo: string
  faq: { question: string; answer: string }[]
  pagesAnalyzed: number
}

export interface ChatReply {
  text: string
  usedKnowledgeIds: string[]
  /**
   * true quando a resposta é uma FALHA simulada (painel "Simular falha na próxima operação"): `text` traz a mensagem de erro
   * e nada foi respondido. Quem exibe a conversa deve mostrar essa linha como erro e permitir reenviar.
   * (Não lança exceção para não deixar consumidores sem try/catch com a conversa travada.)
   */
  failed?: boolean
}

export interface AIEngine {
  generateAssistantFromWebsite(url: string, onProgress?: ProgressFn, context?: { agentId: string }): Promise<GeneratedAssistant>
  generateGenericAssistant(): GeneratedAssistant
  chatReply(agent: Pick<Agent, 'name' | 'companyInfo' | 'greeting'> & Partial<Pick<Agent, 'id' | 'orgId'>>, knowledge: KnowledgeEntry[], message: string, history: { role: 'user' | 'assistant'; text: string }[]): Promise<ChatReply>
  generateCompanyInfo(url: string, onProgress?: ProgressFn, context?: { agentId: string }): Promise<string>
  crawlWebsite(url: string, onProgress?: ProgressFn, context?: { agentId: string }): Promise<{ pages: number; entries: { question: string; answer: string }[] }>
  processDocument(file: File, onProgress?: ProgressFn, context?: { agentId: string; title?: string }): Promise<{ entries: { question: string; answer: string }[] }>
  draftEmailReply(input: { subject: string; body: string; tone: string; signature: string; context?: string; rules?: string[]; knowledge?: string; senderName?: string; mailboxId?: string; messageId?: string; instruction?: string }, onProgress?: ProgressFn): Promise<string>
  summarizeTranscript(lines: TranscriptLine[], kind?: 'call' | 'chat'): { title: string; summary: string; result: ConversationResult }
}

export interface LiveCallEvent {
  type: 'status' | 'line' | 'ended'
  status?: 'connecting' | 'ringing' | 'live'
  line?: TranscriptLine
  reason?: string
  conversationId?: string
  stopStatus?: 'not_started' | 'accepted' | 'unconfirmed'
}

export interface CallHandle {
  readonly conversationId?: string
  readonly operationKey?: string
  hangup: () => void
  say: (text: string) => void
  mute?: (muted: boolean) => void
}

export interface TelephonyService {
  /** Site público: "Receber ligação da IA agora" (simulado — nenhuma ligação real é feita). */
  requestDemoCallback(phone: string, onProgress?: ProgressFn, meta?: { name?: string; notes?: string; context?: string }): Promise<{ reference: string }>
  /** App: ligação de teste no navegador. Emite eventos de transcrição simulada. */
  startTestCall(agent: Agent, knowledge: KnowledgeEntry[], onEvent: (e: LiveCallEvent) => void): CallHandle
  searchAvailableNumbers(countryCode: string): Promise<string[]>
  purchaseNumber(countryLabel: string, onProgress?: ProgressFn): Promise<{ number: string }>
  verifyImportedNumber(number: string, onProgress?: ProgressFn): Promise<{ code: string }>
  confirmImportCode(number: string, code: string): Promise<boolean>
}

export interface MessagingService {
  connectWhatsAppBusiness(onProgress?: ProgressFn): Promise<{ businessName: string; number: string }>
  verifyNumberOwnership(number: string, onProgress?: ProgressFn): Promise<{ verified: true }>
  sendTestMessage(channel: 'whatsapp' | 'email' | 'sms', to: string, body: string, context?: { channelId?: string; conversationId?: string; subject?: string }): Promise<{ id: string; simulated: boolean; status?: 'accepted'; conversationId?: string }>
}

export interface OAuthService {
  connect(provider: 'google' | 'microsoft', purpose: string, onProgress?: ProgressFn, options?: {
    scope: 'personal' | 'shared'; features: ('calendar' | 'email')[]
  }): Promise<{ email: string; connection?: CalendarConnection }>
}

export interface CheckoutLine { label: string; amount: number }
export interface CardInput { number: string; expiry: string; cvc: string; holder: string }

export interface BillingService {
  checkout(lines: CheckoutLine[], card: CardInput, onProgress?: ProgressFn): Promise<{ invoiceNumber: string; last4: string; brand: string }>
  verifyIdentity(onProgress?: ProgressFn): Promise<{ status: 'verified' }>
}

export interface WebhookService {
  test(cfg: { url?: string; method?: string; body?: string; agentId?: string; actionId?: string; arguments?: Record<string, unknown> }, onProgress?: ProgressFn): Promise<{ status: 'success' | 'error'; code: number; ms: number; response: string }>
}

export interface KloelServices {
  ai: AIEngine
  telephony: TelephonyService
  messaging: MessagingService
  oauth: OAuthService
  billing: BillingService
  webhooks: WebhookService
  /** Identifica o registro; o aplicativo conectado usa somente resultados da API. */
  simulated: boolean
}
