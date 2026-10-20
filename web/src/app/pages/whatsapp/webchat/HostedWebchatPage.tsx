import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, MessageSquareOff, RotateCcw } from 'lucide-react'
import type { WebchatSetup } from '@/domain/ext/mais-a'
import { ChatWindow, type ChatMsg } from './ChatWindow'
import { PrivateChatBookingControls } from '@/app/pages/agents/PrivateChatBookingControls'
import { HostedChatError, createHostedBooking, createHostedChat, resolveHostedPage, type HostedBookingCards, type HostedBookingChoice, type HostedPage, type HostedSession, type PublicMessage } from '@/services/engine/hosted-webchat'

/**
 * Link hospedado do Chatbot de IA (Fonio WC-13): `/w/<empresa>/<assistente>` abre o assistente em tela cheia, sem o widget do site.
 * A conversa usa o mesmo atendimento público do widget (sessão do visitante, limites e registro em Conversas). A sessão só é criada
 * na primeira mensagem e fica guardada nesta aba (sessionStorage) para sobreviver a um recarregamento.
 * Os cartões de agendamento (Agendador e Calendly) são os mesmos do widget/chat privado e confirmam pela API pública do widget.
 */
const LOOK: WebchatSetup = { allowedSites: [], widgetGreeting: '', hostedEnabled: true, hostedGreeting: '', avatar: 'feminino', avatarBorder: false, displayName: '', attachments: false, theme: 'light', accent: '#585DFE', accentMode: 'buttons', widgetId: '' }
type Phase = { kind: 'loading' } | { kind: 'unavailable'; message: string } | { kind: 'error'; message: string } | { kind: 'ready'; page: HostedPage }
type Stored = { token: string; expiresAt: number }
const storageKey = (page: HostedPage) => `kloel-hosted:${page.tenantId}:${page.channelId}`
function readStored(page: HostedPage): Stored | null {
  try { const raw = JSON.parse(window.sessionStorage.getItem(storageKey(page)) || 'null'); return raw && /^[A-Za-z0-9_-]{43}$/.test(raw.token) && Number(raw.expiresAt) > Date.now() ? { token: raw.token, expiresAt: Number(raw.expiresAt) } : null } catch { return null }
}
function writeStored(page: HostedPage, value: Stored | null) {
  try { if (value) window.sessionStorage.setItem(storageKey(page), JSON.stringify(value)); else window.sessionStorage.removeItem(storageKey(page)) } catch { /* aba sem armazenamento: a conversa vale até recarregar */ }
}
/** sessionStorage bloqueado não derruba a página; o diário de reservas confere cada gravação antes de enviar. */
const tabStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: key => { try { return window.sessionStorage.getItem(key) } catch { return null } },
  setItem: (key, value) => { try { window.sessionStorage.setItem(key, value) } catch { /* conferido pela leitura seguinte */ } },
  removeItem: key => { try { window.sessionStorage.removeItem(key) } catch { /* idem */ } },
}
const sameCards = (a: HostedBookingChoice[], b: HostedBookingChoice[]) => JSON.stringify(a) === JSON.stringify(b)
/** Um cartão por evento agendável: o oferecido pelo assistente no turno mais recente (horários de outros dias consultados no cartão não viram botões novos). */
function latestCards(list: HostedBookingChoice[]) {
  const shown = new Map<string, HostedBookingChoice>()
  for (const choice of list) { const key = `${choice.provider}:${choice.value.actionId}`, prior = shown.get(key); if (!prior || prior.value.chatOperationKey !== choice.value.chatOperationKey) { shown.delete(key); shown.set(key, choice) } }
  return [...shown.values()]
}
const toChat = (m: PublicMessage): ChatMsg => ({ id: m.id, from: m.role === 'user' ? 'visitor' : 'assistant', text: m.content })
const uuid = () => crypto.randomUUID()

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-[#fafafa] px-4 text-center">{children}</div>
}

function HostedChat({ page }: { page: HostedPage }) {
  const chat = useRef(createHostedChat(page)).current
  const session = useRef<Stored | null>(readStored(page))
  const booking = useRef(createHostedBooking(page, () => session.current, tabStorage)).current
  const [choices, setChoices] = useState<HostedBookingChoice[]>([])
  const [bookingError, setBookingError] = useState('')
  const [server, setServer] = useState<PublicMessage[]>([])
  const [pending, setPending] = useState<ChatMsg | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [closed, setClosed] = useState(false)
  const cursor = useRef<string | null>(null)
  const syncing = useRef(false)
  const busyRef = useRef(false)
  /** Contexto inicial ainda não aberto nesta sessão (refeito no próximo envio se a abertura falhar). */
  const opening = useRef<{ before: NonNullable<HostedSession['beforeContext']>; key: string } | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const merge = useCallback((items: PublicMessage[]) => setServer(old => { const seen = new Set(old.map(m => m.id)); return [...old, ...items.filter(m => !seen.has(m.id))] }), [])
  /** Cartões de agendamento da sessão atual: o histórico traz o conjunto vigente; a resposta de um envio acrescenta os seus. */
  const showCards = useCallback((cards: HostedBookingCards, replace: boolean) => {
    let next: HostedBookingChoice[]
    try { next = booking.accept(cards); setBookingError('') } catch (error) { setBookingError(error instanceof Error ? error.message : 'Não foi possível exibir os horários.'); return }
    setChoices(old => { const merged = latestCards(replace ? next : [...old.filter(o => !next.some(n => n.provider === o.provider && n.value.choiceId === o.value.choiceId)), ...next]); return sameCards(merged, old) ? old : merged })
  }, [booking])
  const drop = useCallback((message: string) => { session.current = null; cursor.current = null; opening.current = null; writeStored(page, null); setChoices([]); setNotice(message) }, [page])
  /** Falha de sessão: 401 = expirou (outra conversa pode começar); 403/410 = atendimento indisponível ou encerrado. */
  const sessionFailure = useCallback((error: unknown) => {
    if (!(error instanceof HostedChatError)) return false
    if (error.status === 401) { drop('Sua conversa expirou. Envie uma mensagem para começar outra.'); setServer([]); return true }
    if (error.status === 403 || error.status === 410) { drop(error.message); setClosed(true); return true }
    return false
  }, [drop])

  const sync = useCallback(async () => {
    const current = session.current; if (!current || syncing.current) return
    syncing.current = true
    try {
      for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
        const result = await chat.history(current.token, cursor.current)
        if (!alive.current || session.current?.token !== current.token) return
        merge(result.items); cursor.current = result.cursor ?? cursor.current; showCards(result, true)
        if (result.mode === 'human') setNotice(n => n || 'Sua conversa está com a equipe.')
        if (!result.hasMore) break
      }
    } catch (error) { if (alive.current && !sessionFailure(error)) setNotice(error instanceof Error ? error.message : 'Não foi possível atualizar a conversa.') }
    finally { syncing.current = false }
  }, [chat, merge, sessionFailure, showCards])

  // Conversa desta aba (recarregamento) e novas respostas da equipe enquanto a página está visível.
  useEffect(() => {
    void sync()
    const timer = window.setInterval(() => { if (!document.hidden && !busyRef.current) void sync() }, 5000)
    return () => window.clearInterval(timer)
  }, [sync])

  async function send() {
    const text = input.trim(); if (!text || busy || closed) return
    const key = uuid()
    busyRef.current = true; setBusy(true); setNotice(''); setInput(''); setPending({ id: 'local-' + key, from: 'visitor', text })
    let token = session.current?.token
    try {
      if (!token) {
        const started = await chat.start(); token = started.token
        session.current = { token, expiresAt: started.expiresAt }; cursor.current = null; writeStored(page, session.current)
        opening.current = started.beforeContext ? { before: started.beforeContext, key: uuid() } : null
      }
      if (opening.current) { await chat.open(token, opening.current.before, opening.current.key); opening.current = null; await sync() }
      const reply = await chat.send(token, text, key)
      if (!alive.current) return
      merge([reply.visitorMessage, reply.message].filter((m): m is PublicMessage => !!m)); setPending(null); showCards(reply, false)
      if (reply.status === 'human_pending') setNotice('Mensagem registrada para a equipe.')
      else if (reply.suppressed) setNotice('Mensagem registrada. A resposta automática foi interrompida pelo atendimento.')
      await sync()
    } catch (error) {
      if (!alive.current) return
      const message = error instanceof Error ? error.message : 'Não foi possível responder agora.'
      if (sessionFailure(error)) { setPending(null); setInput(text); return }
      // Confere o que o atendimento realmente registrou antes de dizer qualquer coisa ao visitante.
      let recorded = false
      if (session.current?.token === token && token) {
        try { const result = await chat.history(token, null); merge(result.items); recorded = result.items.some(m => m.role === 'user' && m.content === text) } catch { /* sem confirmação */ }
      }
      setPending(null)
      if (recorded) setNotice(`Sua mensagem foi registrada, mas a resposta não foi confirmada. ${message}`)
      else { setInput(text); setNotice(`${message} A mensagem não foi enviada; ela voltou para a caixa de texto.`) }
    } finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }

  async function restart() {
    if (busy) return
    const current = session.current
    if (current) {
      busyRef.current = true; setBusy(true)
      try { await chat.end(current.token) } catch (error) { if (!(error instanceof HostedChatError && [401, 403, 410].includes(error.status))) { setNotice(error instanceof Error ? error.message : 'Não foi possível encerrar a conversa.'); busyRef.current = false; setBusy(false); return } }
      busyRef.current = false; setBusy(false)
    }
    drop(current ? 'Conversa encerrada. Envie uma mensagem para começar outra.' : ''); setServer([]); setPending(null); setClosed(false)
  }

  const messages: ChatMsg[] = [{ id: 'greeting', from: 'assistant', text: page.greeting }, ...server.map(toChat), ...(pending ? [pending] : [])]
  return (
    <div className="flex h-dvh justify-center bg-[#fafafa]">
      <ChatWindow
        w={LOOK}
        name={page.assistantName}
        messages={messages}
        input={input}
        onInput={closed ? undefined : (v) => setInput(v.slice(0, 4000))}
        onSend={() => void send()}
        onNewChat={() => void restart()}
        sending={busy}
        className="h-dvh w-full max-w-[760px] border-x shadow-sm"
        footerNote={
          <div className="space-y-1 px-4 pb-3 text-center">
            <div className="max-h-[45dvh] space-y-2 overflow-y-auto pt-3 text-left empty:hidden" data-testid="hosted-bookings">
              <PrivateChatBookingControls key={session.current?.token ?? 'sem-conversa'} client={booking} choices={choices} disabled={busy} />
              {bookingError && <p role="alert" className="text-sm text-destructive">{bookingError}</p>}
            </div>
            {notice && <p role="status" className="text-xs text-muted-foreground" data-testid="hosted-notice">{notice}</p>}
            <p className="text-[11px] text-muted-foreground">Atendimento por IA · Kloel AI</p>
          </div>
        }
      />
    </div>
  )
}

/** Página pública: resolve o link no motor; despublicado/assistente pausado → "Chatbot indisponível". */
export function HostedWebchat({ orgSlug = '', assistantSlug = '' }: { orgSlug?: string; assistantSlug?: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const abort = new AbortController(); setPhase({ kind: 'loading' })
    resolveHostedPage(orgSlug, assistantSlug, abort.signal).then(page => { if (!abort.signal.aborted) setPhase({ kind: 'ready', page }) }, error => {
      if (abort.signal.aborted) return
      if (error instanceof HostedChatError && error.status === 404) setPhase({ kind: 'unavailable', message: error.message })
      else setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'Atendimento indisponível no momento.' })
    })
    return () => abort.abort()
  }, [orgSlug, assistantSlug, attempt])
  useEffect(() => { if (phase.kind === 'ready') document.title = `${phase.page.assistantName} · Kloel AI` }, [phase])

  if (phase.kind === 'loading') return <Centered><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Carregando o chat" /></Centered>
  if (phase.kind === 'ready') return <HostedChat key={`${phase.page.tenantId}:${phase.page.channelId}`} page={phase.page} />
  return (
    <Centered>
      <div className="max-w-sm space-y-2">
        <MessageSquareOff className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <p className="text-lg font-semibold">{phase.kind === 'unavailable' ? 'Chatbot indisponível' : 'Atendimento indisponível'}</p>
        <p className="text-sm text-muted-foreground">{phase.message}</p>
        {phase.kind === 'error' && (
          <button type="button" onClick={() => setAttempt(a => a + 1)} className="mt-2 inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
            <RotateCcw className="size-4" /> Tentar novamente
          </button>
        )}
      </div>
    </Centered>
  )
}

export default function HostedWebchatPage() {
  const { orgSlug, assistantSlug } = useParams()
  return <HostedWebchat orgSlug={orgSlug} assistantSlug={assistantSlug} />
}
