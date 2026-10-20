import type { Agent } from '@/domain/types'
import type { ChatEntryMode, ChatHandoverMode, ChatResponseSchedule, ChatSettings } from '@/domain/ext/agents'
import '@/domain/ext/agents'

/**
 * Assistente de chat — "Tempo limite da conversa" e "Gestão de conversas" (Central de ajuda › Chatbot de IA,
 * capturas WC-03…WC-06). Padrões: 1 hora (✓ em WC-03), IA atende tudo, Sempre, transferência ligada com condições padrão.
 */
export const defaultChatSettings = (): ChatSettings => ({
  timeoutMinutes: 60,
  entry: { mode: 'ai', condition: '' },
  schedule: 'always',
  handover: { enabled: true, mode: 'standard', custom: '' },
  notifications: { enabled: false, onTeamEntry: true, onHandover: true, userIds: [] },
})

/** Configuração efetiva (dados antigos sem `chat` usam os padrões). */
export function chatSettingsOf(agent: Pick<Agent, 'chat'>): ChatSettings {
  const d = defaultChatSettings()
  const c = agent.chat
  if (!c) return d
  return {
    timeoutMinutes: c.timeoutMinutes ?? d.timeoutMinutes,
    entry: { ...d.entry, ...c.entry },
    schedule: c.schedule ?? d.schedule,
    handover: { ...d.handover, ...c.handover },
    notifications: { ...d.notifications, ...c.notifications },
  }
}

/** Opções do menu "Tempo limite da conversa" (WC-03): 15 minutos, 1 hora, 4 horas, 12 horas, 24 horas, Personalizado... */
export const TIMEOUT_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 15, label: '15 minutos' },
  { minutes: 60, label: '1 hora' },
  { minutes: 240, label: '4 horas' },
  { minutes: 720, label: '12 horas' },
  { minutes: 1440, label: '24 horas' },
]
export const TIMEOUT_MIN = 5
export const TIMEOUT_MAX = 10080 // 7 dias

export function timeoutLabel(minutes: number) {
  const preset = TIMEOUT_PRESETS.find((p) => p.minutes === minutes)
  if (preset) return preset.label
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? 'dia' : 'dias'}`
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'hora' : 'horas'}`
  if (minutes > 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
  return `${minutes} minutos`
}

export const ENTRY_OPTIONS: { value: ChatEntryMode; label: string; short: string; description: string }[] = [
  { value: 'ai', label: 'A IA atende todas as conversas', short: 'IA', description: 'Toda nova conversa começa com a IA.' },
  { value: 'team', label: 'A equipe atende todas as conversas', short: 'Equipe', description: 'Toda nova conversa começa sem atribuição para a sua equipe. A IA fica em silêncio.' },
  {
    value: 'condition',
    label: 'Decidir usando uma condição',
    short: 'Condição',
    description: 'A IA começa, a menos que a sua condição corresponda. Conversas que correspondem vão para a equipe.',
  },
]

export const SCHEDULE_OPTIONS: { value: ChatResponseSchedule; label: string; short: string; description: string }[] = [
  { value: 'always', label: 'Sempre', short: 'Sempre', description: 'A IA responde a toda nova mensagem.' },
  {
    value: 'open',
    label: 'Durante o horário de funcionamento',
    short: 'No horário',
    description: 'A IA responde somente enquanto a sua empresa está aberta. As outras mensagens ficam não lidas para a sua equipe.',
  },
  {
    value: 'closed',
    label: 'Fora do horário de funcionamento',
    short: 'Fora do horário',
    description: 'A IA responde somente enquanto a sua empresa está fechada. As outras mensagens ficam não lidas para a sua equipe.',
  },
]

export const HANDOVER_OPTIONS: { value: ChatHandoverMode; label: string; short: string; description: string }[] = [
  { value: 'standard', label: 'Condições padrão', short: 'Padrão', description: 'Use as condições integradas para situações comuns de transferência.' },
  { value: 'standard_custom', label: 'Condições padrão e personalizadas', short: 'Padrão · Personalizado', description: 'Mantenha as condições padrão e adicione as suas próprias regras.' },
  { value: 'custom', label: 'Apenas condições personalizadas', short: 'Personalizado', description: 'Ignore as condições padrão e use somente as suas próprias regras.' },
]

export const STANDARD_HANDOVER_TEXT =
  'O assistente transfere quando o cliente pede uma pessoa ou o suporte da equipe, fica irritado ou escala o problema, tem uma solicitação urgente ou sensível, ou quando o assistente não consegue resolver a solicitação com segurança.'

export const entrySummary = (c: ChatSettings) => ENTRY_OPTIONS.find((o) => o.value === c.entry.mode)!.short
export const scheduleSummary = (c: ChatSettings) => SCHEDULE_OPTIONS.find((o) => o.value === c.schedule)!.short
export const handoverSummary = (c: ChatSettings) => (c.handover.enabled ? HANDOVER_OPTIONS.find((o) => o.value === c.handover.mode)!.short : 'Desligado')
export const notificationsSummary = (c: ChatSettings) =>
  c.notifications.enabled ? `Ligado · ${c.notifications.userIds.length} ${c.notifications.userIds.length === 1 ? 'pessoa' : 'pessoas'}` : 'Desligado'

/* ------------------------- mensagem de saudação do chat ------------------------- */

export const CHAT_GREETING_LIMIT = 500

/** Saudação padrão do idioma do assistente (WC-09: "Deixe vazio para usar o padrão do idioma do assistente"). */
export function defaultChatGreeting(language: string) {
  const l = language.toLowerCase()
  if (l.startsWith('en')) return 'Hello! How can I help you today?'
  if (l.startsWith('es')) return '¡Hola! ¿Cómo puedo ayudarte hoy?'
  if (l.startsWith('de')) return 'Hallo! Wie kann ich Ihnen heute helfen?'
  if (l.startsWith('fr')) return 'Bonjour ! Comment puis-je vous aider aujourd’hui ?'
  if (l.startsWith('it')) return 'Ciao! Come posso aiutarti oggi?'
  return 'Olá! Como posso ajudar hoje?'
}

/** Saudação efetiva do chat: o texto salvo ou, vazio, o padrão do idioma. */
export const chatGreetingOf = (a: Pick<Agent, 'greeting' | 'language'>) => (a.greeting.replace(/\{\{[^}]*\}\}/g, 'x').trim() ? a.greeting : defaultChatGreeting(a.language))

/* ------------------------------- formalidade ------------------------------- */

/**
 * Idiomas com tratamento formal/informal em que a linha "Formalidade" aparece (OBSERVADO com Alemão em EM-01/FS-02;
 * a captura ao vivo em Português (Brasil) não tem a linha). Demais idiomas da lista: INFERIDO.
 */
export const FORMALITY_LANGUAGES = new Set(['de', 'de-CH', 'fr', 'es', 'it', 'nl', 'pl', 'ru', 'cs', 'sk', 'uk'])
export const FORMALITY_OPTIONS: { value: NonNullable<Agent['formality']>; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'informal', label: 'Informal' },
  { value: 'custom', label: 'Personalizado (via prompt)' },
]

/* ------------------------- simulação no "Testar chat" ------------------------- */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const STOP = new Set([
  'quando', 'sobre', 'comece', 'comecar', 'equipe', 'conversa', 'conversas', 'todas', 'todos', 'outras', 'outros', 'sempre', 'assistente', 'cliente',
  'clientes', 'pedir', 'perguntar', 'perguntas', 'duvidas', 'pessoas', 'alguem', 'transfira', 'transferir', 'transferencia', 'quiser', 'estiver', 'forem',
])

/** Palavras-chave de uma condição escrita em texto livre (simulação: radicais de 5 letras, sem palavras genéricas). */
export function conditionKeywords(text: string) {
  return [...new Set(norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w)).map((w) => w.slice(0, 5)))]
}

/** A mensagem corresponde à condição? Devolve a palavra que correspondeu (simulação local, sem modelo de IA). */
export function matchCondition(condition: string, message: string): string | null {
  const words = norm(message).split(/[^a-z0-9]+/).filter(Boolean)
  for (const k of conditionKeywords(condition)) {
    const hit = words.find((w) => w.startsWith(k))
    if (hit) return hit
  }
  return null
}

/** Condições padrão de transferência (simulação por palavras-chave). */
const STANDARD_HANDOVER: [string, RegExp][] = [
  ['pediu para falar com uma pessoa', /\b(atendente|humano|humana|pessoa real|falar com alguem|falar com uma pessoa|gerente|suporte da equipe)\b/],
  ['cliente irritado ou escalando o problema', /\b(absurdo|pessim\w*|irritad\w*|reclama\w*|inaceitavel|procon|processar)\b/],
  ['solicitação urgente ou sensível', /\b(urgente|urgencia|emergencia|advogad\w*|juridic\w*|privacidade|lgpd)\b/],
]

/** Decide se uma mensagem ativa a transferência de conversa ativa; devolve o motivo ou null. */
export function handoverReason(c: ChatSettings, message: string): string | null {
  if (!c.handover.enabled) return null
  const m = norm(message)
  if (c.handover.mode !== 'custom') {
    const std = STANDARD_HANDOVER.find(([, re]) => re.test(m))
    if (std) return `condição padrão: ${std[0]}`
  }
  if (c.handover.mode !== 'standard' && c.handover.custom.trim()) {
    const hit = matchCondition(c.handover.custom, message)
    if (hit) return `condição personalizada (“${hit}”)`
  }
  return null
}
