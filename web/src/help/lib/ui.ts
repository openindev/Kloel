import { create } from 'zustand'
import '@/domain/ext/help'
import { useDB, useStore } from '@/data/store'
import { uid } from '@/lib/utils'
import { askAssistant, type AskOptions, type AssistantAnswer } from './assistant'
import { canonicalKey } from '../content'

/** Estado de interface da Central de ajuda (diálogos, painel do assistente e rascunho do suporte). */

export interface AskMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  answer?: AssistantAnswer
  /** queued = aguardando a resposta anterior terminar (as perguntas são respondidas em ordem) */
  status?: 'queued' | 'running' | 'success' | 'error'
  error?: string
  progressLabel?: string
  /** artigo a resumir (pedido feito pelo menu "Copiar página") */
  summaryOf?: string
  /** artigo aberto quando a pergunta foi feita */
  pageKey?: string
}

export interface SupportDraft {
  name: string
  email: string
  topic: string
  message: string
}

const ASK_KEY = 'kloel-help:assistant'
const DRAFT_KEY = 'kloel-help:support-draft'
const EMPTY_DRAFT: SupportDraft = { name: '', email: '', topic: '', message: '' }

function loadMessages(): AskMessage[] {
  try {
    const raw = window.localStorage.getItem(ASK_KEY)
    const parsed = raw ? (JSON.parse(raw) as AskMessage[]) : []
    // respostas interrompidas por recarga (em andamento ou na fila) viram erro recuperável
    return parsed.map((m) =>
      m.status === 'running' || m.status === 'queued' ? { ...m, status: 'error', progressLabel: undefined, error: 'A resposta foi interrompida. Tente novamente.' } : m,
    )
  } catch {
    return []
  }
}

function loadDraft(): SupportDraft {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<SupportDraft>) } : EMPTY_DRAFT
  } catch {
    return EMPTY_DRAFT
  }
}

/** Artigo aberto agora (contexto de "Resuma esta página"). */
function currentPageKey(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const m = window.location.pathname.match(/^\/ajuda\/([^/]+)\/([^/]+)\/?$/)
  return m ? canonicalKey(`${m[1]}/${m[2]}`) : undefined
}

interface HelpUiState {
  searchOpen: boolean
  askOpen: boolean
  supportOpen: boolean
  supportTopic?: string
  messages: AskMessage[]
  supportDraft: SupportDraft
  openSearch: () => void
  setSearchOpen: (o: boolean) => void
  /** abre o painel; com pergunta, ela entra na conversa (na fila, se outra resposta estiver em andamento) */
  openAsk: (question?: string, opts?: AskOptions) => void
  setAskOpen: (o: boolean) => void
  ask: (question: string, opts?: AskOptions) => void
  retryAnswer: (assistantId: string) => void
  cancelQueued: (assistantId: string) => void
  openSupport: (topic?: string) => void
  setSupportOpen: (o: boolean) => void
  setSupportDraft: (patch: Partial<SupportDraft>) => void
  setMessages: (fn: (m: AskMessage[]) => AskMessage[]) => void
}

export const useHelpUi = create<HelpUiState>()((set, get) => ({
  searchOpen: false,
  askOpen: false,
  supportOpen: false,
  messages: typeof window !== 'undefined' ? loadMessages() : [],
  supportDraft: typeof window !== 'undefined' ? loadDraft() : EMPTY_DRAFT,
  openSearch: () => set({ searchOpen: true }),
  setSearchOpen: (o) => set({ searchOpen: o }),
  openAsk: (question, opts) => {
    set({ askOpen: true, searchOpen: false })
    if (question?.trim()) get().ask(question, opts)
  },
  setAskOpen: (o) => set({ askOpen: o }),
  ask: (question, opts = {}) => {
    const q = question.trim()
    if (!q) return
    const pageKey = opts.pageKey ?? currentPageKey()
    const userMsg: AskMessage = { id: uid('ask'), role: 'user', text: q }
    const botMsg: AskMessage = { id: uid('ans'), role: 'assistant', text: q, status: 'queued', summaryOf: opts.summaryOf, pageKey }
    get().setMessages((ms) => [...ms, userMsg, botMsg])
    void pumpQueue()
  },
  retryAnswer: (assistantId) => {
    get().setMessages((ms) => ms.map((m) => (m.id === assistantId ? { ...m, status: 'queued', error: undefined, progressLabel: undefined, answer: undefined } : m)))
    void pumpQueue()
  },
  cancelQueued: (assistantId) =>
    get().setMessages((ms) => {
      const i = ms.findIndex((m) => m.id === assistantId)
      if (i < 0 || ms[i]!.status !== 'queued') return ms
      // remove a resposta na fila e a pergunta correspondente (mensagem do usuário logo antes)
      const drop = new Set([assistantId])
      const prev = ms[i - 1]
      if (prev && prev.role === 'user' && prev.text === ms[i]!.text) drop.add(prev.id)
      return ms.filter((m) => !drop.has(m.id))
    }),
  openSupport: (topic) => set({ supportOpen: true, supportTopic: topic, searchOpen: false }),
  setSupportOpen: (o) => set({ supportOpen: o }),
  setSupportDraft: (patch) => {
    const supportDraft = { ...get().supportDraft, ...patch }
    set({ supportDraft })
    try {
      if (Object.values(supportDraft).some((v) => v.trim())) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(supportDraft))
      else window.localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* armazenamento indisponível */
    }
  },
  setMessages: (fn) => {
    const messages = fn(get().messages)
    set({ messages })
    try {
      window.localStorage.setItem(ASK_KEY, JSON.stringify(messages.slice(-40)))
    } catch {
      /* armazenamento indisponível */
    }
  },
}))

/**
 * Fila do assistente: responde uma pergunta por vez, na ordem em que foram feitas. Fica fora dos componentes
 * para continuar ao trocar de artigo (o layout da central é remontado a cada navegação).
 */
let pumping = false
async function pumpQueue() {
  if (pumping) return
  const next = useHelpUi.getState().messages.find((m) => m.role === 'assistant' && m.status === 'queued')
  if (!next) return
  pumping = true
  const patch = (p: Partial<AskMessage>) => useHelpUi.getState().setMessages((ms) => ms.map((m) => (m.id === next.id ? { ...m, ...p } : m)))
  patch({ status: 'running', error: undefined, progressLabel: undefined })
  try {
    const answer = await askAssistant(next.text, { summaryOf: next.summaryOf, pageKey: next.pageKey }, (p) => patch({ progressLabel: p.label }))
    patch({ status: 'success', answer, progressLabel: undefined })
  } catch (e) {
    patch({ status: 'error', progressLabel: undefined, error: e instanceof Error ? e.message : 'Erro desconhecido' })
  } finally {
    pumping = false
    void pumpQueue()
  }
}

/* ----------------------------- Feedback ----------------------------- */

/**
 * "Esta página foi útil?" fica no store persistido (db.ui.helpFeedback, extensão em src/domain/ext/help.ts):
 * sobrevive a recargas, aparece no estado da demonstração e é limpo por "Restaurar demo".
 * Respostas antigas gravadas no localStorage (versão anterior) são migradas na primeira leitura.
 */
const LEGACY_FEEDBACK_KEY = 'kloel-help:feedback'

export interface PageFeedback {
  vote: 'yes' | 'no'
  comment?: string
  at: string
}

function migrateLegacyFeedback() {
  try {
    const raw = window.localStorage.getItem(LEGACY_FEEDBACK_KEY)
    if (!raw) return
    const legacy = JSON.parse(raw) as Record<string, PageFeedback>
    const st = useStore.getState()
    st.setUi({ helpFeedback: { ...legacy, ...(st.db.ui.helpFeedback ?? {}) } })
    window.localStorage.removeItem(LEGACY_FEEDBACK_KEY)
  } catch {
    /* armazenamento indisponível */
  }
}

export function usePageFeedback(key: string): PageFeedback | undefined {
  return useDB((db) => db.ui.helpFeedback?.[key])
}

export function readFeedback(key: string): PageFeedback | undefined {
  migrateLegacyFeedback()
  return useStore.getState().db.ui.helpFeedback?.[key]
}

export function writeFeedback(key: string, fb: PageFeedback | undefined) {
  const st = useStore.getState()
  const all = { ...(st.db.ui.helpFeedback ?? {}) }
  if (fb) all[key] = fb
  else delete all[key]
  st.setUi({ helpFeedback: all })
}

/* ----------------------------- Clipboard ----------------------------- */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* tenta o método alternativo */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
