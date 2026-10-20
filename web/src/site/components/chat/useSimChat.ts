import { useCallback, useState } from 'react'
import type { KnowledgeEntry } from '@/domain/types'

export interface SimMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  at: Date
  error?: boolean
  /** anexo enviado pelo visitante (somente nome/tamanho — o arquivo não é lido nem enviado) */
  attachment?: { name: string; size: string }
}

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} kB`)

let seq = 0
const mid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`

/** Onde guardar a conversa: 'session' (aba atual) ou 'local' (navegador, ex.: por id de demonstração). */
export interface SimChatPersist {
  key: string
  storage?: 'session' | 'local'
}

interface Saved {
  messages: (Omit<SimMessage, 'at'> & { at: string })[]
  sent: number
  lastFailed: string | null
}

function storageOf(p?: SimChatPersist): Storage | null {
  if (!p) return null
  try {
    return p.storage === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function loadSaved(p?: SimChatPersist): Saved | null {
  const st = storageOf(p)
  if (!st || !p) return null
  try {
    const raw = st.getItem(p.key)
    if (!raw) return null
    const s = JSON.parse(raw) as Saved
    return Array.isArray(s.messages) && typeof s.sent === 'number' ? s : null
  } catch {
    return null
  }
}

/**
 * Mantém os controles públicos até existir um canal de visitante explicitamente configurado.
 * Não reutiliza respostas locais, não envia pela sessão privada e não confirma anexos.
 */
export function useSimChat({ greeting, limit }: { agent: { name: string; companyInfo: string; greeting: string }; knowledge: KnowledgeEntry[]; greeting?: string; limit?: number; persist?: SimChatPersist }) {
  const initial = (): SimMessage[] => greeting ? [{ id: 'greeting', role: 'assistant', text: greeting, at: new Date() }] : []
  // No public visitor channel is configured; client snapshots cannot prove delivery.
  const [messages, setMessages] = useState<SimMessage[]>(initial)
  const [canRetry, setCanRetry] = useState(false)
  const unavailable = useCallback(() => {
    setCanRetry(true)
    setMessages(current => [...current.filter(row => !row.error), { id: 'public-chat-unavailable', role: 'system', text: 'O chat ainda não está disponível. Nenhuma mensagem ou arquivo foi enviado.', at: new Date(), error: true }])
    return false
  }, [])
  return { messages, typing: false, send: (_text: string) => unavailable(), attach: (_file: { name: string; size: number }) => unavailable(),
    retry: unavailable, canRetry, remaining: limit ?? Infinity, sent: 0, reset: () => { setMessages(initial()); setCanRetry(false) } }
}
