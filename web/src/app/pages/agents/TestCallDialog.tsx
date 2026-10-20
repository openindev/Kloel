import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { create } from 'zustand'
import { AlertCircle, ChevronDown, Headset, Loader2, Mic, PhoneOff, RotateCcw, Send, Settings, X, CheckCircle2, XCircle, MessageCircle, MessageSquarePlus, UserRound, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import type { Agent, TranscriptLine } from '@/domain/types'
import { cn } from '@/lib/utils'
import { services } from '@/services'
import type { CallHandle } from '@/services/types'
import { createCascaChatSession, type CascaChatSession } from '@/services/casca/test-chat'
import { createPrivateChatBooking, type PrivateChatBooking, type PrivateBookingChoice } from '@/services/casca/private-chat-booking'
import { PrivateChatBookingControls } from './PrivateChatBookingControls'
import { captureEngineContext, engineSession, useEngineSession, type EngineContext } from '@/services/engine/session'
import { createAgentTestService, type AgentChatResult } from '@/services/engine/agent-test'
import { createConversationService } from '@/services/engine/conversations'
import { useStore } from '@/data/store'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResultChip } from '@/components/app/misc'
import { KloelMark } from '@/components/brand/KloelLogo'
import '@/domain/ext/inbox-contacts'
import { useBrowserMicPermission } from './core/audio'
import { MicPicker } from './core/ui'
import { pickGreeting, renderMessage, smartVariables, variableLabel } from './core/variables'
import { TEST_VAR_SOURCE_LABEL, buildTestVariables, contactFullName, testContextHref, variableKeysIn, type TestVariables } from './core/testContext'
import { displayNameOf, webchatOf } from '@/app/pages/whatsapp/webchat/model'

/**
 * Estado global da ligação de teste em andamento: a barra escura do assistente mostra "Cancelar ligação" (conectando)
 * ou "Encerrar ligação" (ao vivo) e chama hangup().
 */
export const useTestCallState = create<{ live: { agentId: string; phase: 'connecting' | 'live'; hangup: () => void } | null }>(() => ({ live: null }))

type Phase = 'idle' | 'permission' | 'audio' | 'connecting' | 'live' | 'ended' | 'failed'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** Real test sessions. Only confirmed backend records and WebRTC transcripts are displayed. */
export function TestCallDialog({
  agent,
  open,
  onOpenChange,
  onFinished,
  startKey,
}: {
  agent: Agent
  open: boolean
  onOpenChange: (o: boolean) => void
  onFinished?: (conversationId?: string) => void
  startKey?: number
}) {
  const isChat = agent.type === 'chat'
  const browserPermission = useBrowserMicPermission()
  const session = useEngineSession()
  const [phase, setPhase] = useState<Phase>('idle')
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [error, setError] = useState<string>()
  const [elapsed, setElapsed] = useState(0)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ id: string; title: string; summary: string; result?: Parameters<typeof ResultChip>[0]['result']; duration: number } | null>(null)
  const [testVars] = useState<TestVariables | null>(null)
  const [usedKeys] = useState<string[]>([])
  const [varsOpen, setVarsOpen] = useState(false)
  const [replyError, setReplyError] = useState<{ detail: string } | null>(null)
  const [bookingChoices, setBookingChoices] = useState<PrivateBookingChoice[]>([])
  const [bookingError, setBookingError] = useState('')
  const [actionLog] = useState<string[]>([])
  const location = useLocation()
  const linesRef = useRef<TranscriptLine[]>([])
  const phaseRef = useRef<Phase>('idle')
  const liveSince = useRef(0)
  const handleRef = useRef<CallHandle | null>(null)
  const scopeRef = useRef<EngineContext | null>(null)
  const chatRef = useRef<CascaChatSession | null>(null)
  const bookingRef = useRef<PrivateChatBooking | null>(null)
  const finishReference = useRef<{ id?: string; voiceKey?: string } | null>(null)
  const sessionRef = useRef(0)
  const mounted = useRef(true)
  const busy = useRef(false)
  const finishedRef = useRef(false)
  const agentRef = useRef(agent)
  agentRef.current = agent
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished
  const scrollRef = useRef<HTMLDivElement>(null)
  const setP = (p: Phase) => { phaseRef.current = p; if (mounted.current) setPhase(p) }
  const pushLine = (line: TranscriptLine) => { linesRef.current = [...linesRef.current, line]; setLines(linesRef.current) }
  const fresh = (ticket: number, context: EngineContext) => {
    context.assertCurrent()
    if (!mounted.current || ticket !== sessionRef.current) throw Error('O teste mudou. Consulte a operação na sessão original.')
  }
  const finish = (id?: string) => {
    if (finishedRef.current) return
    finishedRef.current = true
    onFinishedRef.current?.(id)
  }
  const clearPanel = () => {
    linesRef.current = []; setLines([]); setError(undefined); setResult(null)
    setElapsed(0); setTyping(false); setText(''); setReplyError(null); setVarsOpen(false); setBookingChoices([]); setBookingError('')
  }
  const showClosed = async (id: string, context: EngineContext, ticket: number) => {
    const current = await createConversationService(context).get(id)
    fresh(ticket, context)
    if (current.conversation.agentId !== agentRef.current.id || current.conversation.status !== 'closed') throw Error('O encerramento da conversa ainda não foi confirmado. Consulte o estado novamente.')
    setResult({ id, title: current.conversation.subject || agentRef.current.name, summary: 'O histórico está disponível em Conversas.', duration: Math.max(0, Math.round((Date.now() - liveSince.current) / 1000)) })
    finishReference.current = null
    handleRef.current = null
    useTestCallState.setState({ live: null })
    setP('ended'); finish(id)
  }
  const consultFinish = async () => {
    const ref = finishReference.current, context = scopeRef.current, ticket = sessionRef.current
    if (!ref || !context || busy.current) return
    busy.current = true
    try {
      fresh(ticket, context)
      if (ref.voiceKey) {
        const operation = await createAgentTestService(context, agentRef.current.id).voiceOperation(ref.voiceKey)
        fresh(ticket, context)
        if (operation.hangupStatus !== 'accepted') throw Error('O encerramento da ligação ainda não foi confirmado. Consulte novamente, sem iniciar outra chamada.')
        if (operation.conversationId) ref.id = operation.conversationId
      }
      if (!ref.id) throw Error('Ainda não foi possível confirmar a conversa desta operação.')
      await showClosed(ref.id, context, ticket)
    } catch (err) { if (mounted.current && ticket === sessionRef.current) { setError(err instanceof Error ? err.message : 'Falha ao consultar o encerramento.'); setP('failed') } }
    finally { busy.current = false }
  }
  const finishChat = async () => {
    const context = scopeRef.current, chat = chatRef.current, ticket = sessionRef.current
    if (!context || !chat || busy.current) return false
    try {
      fresh(ticket, context)
      if (chat.pending) throw Error('Consulte a resposta pendente antes de encerrar a conversa.')
      if (!chat.conversationId) { useTestCallState.setState({ live: null }); setP('idle'); finish(); return true }
      busy.current = true
      finishReference.current = { id: chat.conversationId }
      const api = createConversationService(context), current = await api.get(chat.conversationId)
      fresh(ticket, context)
      if (current.conversation.agentId !== agentRef.current.id) throw Error('A conversa não pertence a este assistente.')
      if (current.conversation.status !== 'closed') {
        try { await api.update(current, { status: 'closed' }) }
        catch { /* Read-only recovery below also handles a lost committed response. */ }
      }
      await showClosed(chat.conversationId, context, ticket)
      return true
    } catch (err) {
      if (mounted.current && ticket === sessionRef.current) {
        const detail = err instanceof Error ? err.message : 'Não foi possível confirmar o encerramento.'
        if (finishReference.current) { setError(detail); setP('failed') } else setReplyError({ detail })
      }
      return false
    } finally { busy.current = false }
  }
  const hangup = () => {
    if (isChat) { void finishChat(); return }
    if (handleRef.current && ['connecting', 'live'].includes(phaseRef.current)) handleRef.current.hangup()
  }
  const startVoice = () => {
    if (busy.current || ['connecting', 'live'].includes(phaseRef.current)) return
    const ticket = ++sessionRef.current
    clearPanel(); finishedRef.current = false
    try {
      const context = captureEngineContext(); context.assertCurrent(); scopeRef.current = context
      if (context.tenantId !== agentRef.current.orgId) throw Error('A organização mudou.')
      setP('connecting')
      useTestCallState.setState({ live: { agentId: agentRef.current.id, phase: 'connecting', hangup } })
      handleRef.current = services.telephony.startTestCall(agentRef.current, [], (event) => {
        try { fresh(ticket, context) } catch { return }
        if (event.type === 'status' && event.status === 'live') {
          liveSince.current = Date.now(); setP('live')
          useTestCallState.setState({ live: { agentId: agentRef.current.id, phase: 'live', hangup } })
        } else if (event.type === 'line' && event.line) pushLine(event.line)
        else if (event.type === 'ended') {
          useTestCallState.setState({ live: null })
          const id = event.conversationId ?? handleRef.current?.conversationId
          finishReference.current = { id, voiceKey: handleRef.current?.operationKey }
          if (event.stopStatus === 'accepted' && id) {
            void showClosed(id, context, ticket).catch(err => { if (ticket === sessionRef.current && mounted.current) { setError(err.message); setP('failed') } })
          } else if (event.stopStatus === 'not_started') {
            finishReference.current = null; handleRef.current = null
            setError(event.reason ?? 'A chamada não foi iniciada.'); setP('failed'); finish()
          } else { setError(event.reason ?? 'O encerramento da ligação ainda não foi confirmado.'); setP('failed') }
        }
      })
    } catch (err) { useTestCallState.setState({ live: null }); setError(err instanceof Error ? err.message : 'Falha ao iniciar a chamada.'); setP('failed') }
  }
  const startChat = async () => {
    if (busy.current || finishReference.current) return
    const ticket = ++sessionRef.current; clearPanel(); finishedRef.current = false
    busy.current = true; setP('connecting')
    try {
      const context = captureEngineContext(); context.assertCurrent(); scopeRef.current = context
      if (context.tenantId !== agentRef.current.orgId) throw Error('A organização mudou.')
      const expected = engineSession.getSnapshot().data!.identity.context
      const before = agentRef.current.engineBefore?.context
      chatRef.current = createCascaChatSession(context, expected, window.sessionStorage, agentRef.current.id, { webSearch: agentRef.current.webSearch.enabled, ...(before?.configuration.enabled ? { beforeRevision: before.revision } : {}) })
      bookingRef.current = createPrivateChatBooking(context, expected, agentRef.current.id, window.sessionStorage)
      const history = await chatRef.current.prepare(); fresh(ticket, context)
      for (const line of history) pushLine({ speaker: line.role === 'assistant' ? 'assistant' : 'caller', text: line.content, t: Math.max(0, Math.floor((Date.parse(line.createdAt) - Date.parse(history[0].createdAt)) / 1000)) })
      liveSince.current = Date.now(); setP('live')
      useTestCallState.setState({ live: { agentId: agentRef.current.id, phase: 'live', hangup } })
      if (chatRef.current.pending) setReplyError({ detail: 'Há uma resposta pendente desta aba. Consulte a operação original antes de enviar outra mensagem.' })
    } catch (err) { if (mounted.current && ticket === sessionRef.current) { setError(err instanceof Error ? err.message : 'Não foi possível abrir o chat.'); setP('failed') } }
    finally { busy.current = false }
  }
  const newChat = async () => {
    if (busy.current || finishReference.current) return
    if (phaseRef.current === 'live' && !await finishChat()) return
    startChat()
  }
  const begin = () => {
    if (finishReference.current) { setP('failed'); return }
    if (isChat) startChat()
    else { clearPanel(); finishedRef.current = false; setP(browserPermission === 'granted' ? 'audio' : 'permission') }
  }
  const allowMicrophone = async () => {
    const ticket = sessionRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      if (mounted.current && ticket === sessionRef.current && phaseRef.current === 'permission') setP('audio')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Não foi possível acessar o microfone.') }
  }
  useEffect(() => {
    if (open && ['idle', 'ended', 'failed'].includes(phaseRef.current)) begin()
    if (!open && ['permission', 'audio'].includes(phaseRef.current)) { ++sessionRef.current; setP('idle') }
    // Closing a live test is explicit in close()/hangup(); rerendering never sends commands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startKey])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; ++sessionRef.current; handleRef.current?.hangup(); useTestCallState.setState({ live: null }) }
  }, [])
  useEffect(() => {
    const context = scopeRef.current
    if (!context) return
    try { context.assertCurrent() } catch {
      ++sessionRef.current; linesRef.current = []; setLines([]); setResult(null); setReplyError(null); setText(''); setTyping(false)
      handleRef.current?.hangup(); useTestCallState.setState({ live: null })
      setError('A sessão precisa ser confirmada. Consulte o teste novamente quando o acesso for restabelecido.'); setP('failed')
    }
  }, [session.generation, session.validation, session.phase])
  useEffect(() => {
    if (phase !== 'live') return
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - liveSince.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [phase])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [lines, typing])
  const acceptReply = (reply: AgentChatResult) => {
    pushLine({ t: Math.round((Date.now() - liveSince.current) / 1000), speaker: 'assistant', text: reply.text })
    setReplyError(null)
    try { setBookingChoices(bookingRef.current?.accept(reply) ?? []); setBookingError('') }
    catch (cause) { setBookingChoices([]); setBookingError(cause instanceof Error ? cause.message : 'Não foi possível carregar as opções de agendamento.') }
  }
  async function consultReply() {
    const chat = chatRef.current, context = scopeRef.current, ticket = sessionRef.current
    if (!chat || !context || busy.current) return
    busy.current = true; setTyping(true)
    try { const reply = await chat.consult(); fresh(ticket, context); acceptReply(reply) }
    catch (err) { if (mounted.current && ticket === sessionRef.current) setReplyError({ detail: err instanceof Error ? err.message : 'Não foi possível consultar a resposta.' }) }
    finally { busy.current = false; if (mounted.current && ticket === sessionRef.current) setTyping(false) }
  }
  async function send(event: FormEvent) {
    event.preventDefault()
    const msg = text.trim(), chat = chatRef.current, context = scopeRef.current, ticket = sessionRef.current
    if (!isChat || !msg || !chat || !context || busy.current || phaseRef.current !== 'live') return
    try { fresh(ticket, context); if (chat.pending) throw Error('Consulte a resposta pendente antes de enviar outra mensagem.') }
    catch (err) { setReplyError({ detail: err instanceof Error ? err.message : 'Não foi possível enviar.' }); return }
    busy.current = true; setText(''); setTyping(true); setReplyError(null)
    pushLine({ t: Math.round((Date.now() - liveSince.current) / 1000), speaker: 'caller', text: msg })
    try { const reply = await chat.send(msg); fresh(ticket, context); acceptReply(reply) }
    catch (err) { if (mounted.current && ticket === sessionRef.current) setReplyError({ detail: err instanceof Error ? err.message : 'Não foi possível confirmar a resposta.' }) }
    finally { busy.current = false; if (mounted.current && ticket === sessionRef.current) setTyping(false) }
  }
  const retryOrConsult = () => finishReference.current ? void consultFinish() : isChat ? startChat() : startVoice()
  const close = () => {
    if (['connecting', 'live'].includes(phaseRef.current)) { hangup(); return }
    onOpenChange(false)
  }
  const cancelSetup = () => { ++sessionRef.current; setP('idle'); onOpenChange(false) }
  const panelOpen = open && (phase === 'connecting' || phase === 'live' || phase === 'ended' || phase === 'failed')

  return (
    <>
      {/* Permissão real do microfone, solicitada somente pelo clique. */}
      {/* [459]: layout original da solicitação de permissão. */}
      <Dialog open={open && phase === 'permission'} onOpenChange={(o) => !o && cancelSetup()}>
        {/* [459]/[460]: ícone → título → descrição a 6px, blocos a 16px (sem respiro extra no topo) */}
        <DialogContent hideClose className="gap-y-4 sm:max-w-[512px]">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Mic className="size-5" />
            </span>
            <DialogTitle className="text-lg font-semibold leading-none">Acesso ao microfone necessário</DialogTitle>
            <p className="text-sm text-muted-foreground">Para iniciar uma chamada de teste, precisamos de acesso ao seu microfone. O navegador pedirá permissão.</p>
          </div>
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Settings className="mt-0.5 size-4 shrink-0" />
            <span>Um popup do navegador aparecerá — permita o acesso ao microfone para continuar.</span>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={cancelSetup}>
              Cancelar
            </Button>
            <Button
              onClick={() => void allowMicrophone()}
            >
              Permitir
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Configurações de áudio — spec 05 [460]/[461] */}
      <Dialog open={open && phase === 'audio'} onOpenChange={(o) => !o && cancelSetup()}>
        <DialogContent className="gap-y-4 sm:max-w-[512px]">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Mic className="size-5" />
            </span>
            <DialogTitle className="text-lg font-semibold leading-none">Configurações de áudio</DialogTitle>
            <p className="text-sm text-muted-foreground">Selecione qual microfone usar para a chamada de teste.</p>
          </div>
          <MicPicker active={open && phase === 'audio'} size="lg" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={cancelSetup}>
              Cancelar
            </Button>
            <Button className="gap-2" onClick={startVoice}>
              <Headset className="size-4" />
              Iniciar chamada
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/*
        "Testar chat" no formato do widget (Central de ajuda WC-07): cabeçalho com a marca + nome do assistente, "Nova conversa"
        e ×; bolhas do assistente cinza-claro com borda e do cliente roxas; "Escreva uma mensagem..." + enviar quadrado cinza.
      */}
      {panelOpen &&
        isChat &&
        createPortal(
          <div
            role="dialog"
            aria-label="Chat de teste"
            data-testid="test-chat-widget"
            className="fixed bottom-24 right-4 z-[45] flex h-[min(600px,calc(100svh-8rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-[0_12px_32px_rgba(15,18,28,0.18)] sm:right-6"
          >
            <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
              <KloelMark className="size-7 shrink-0" />
              <p className="min-w-0 flex-1 truncate text-base font-semibold">{displayNameOf(webchatOf(agent), agent)}</p>
              <button
                type="button"
                aria-label="Nova conversa"
                title="Nova conversa"
                disabled={phase === 'connecting' || typing || !!finishReference.current}
                onClick={newChat}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <MessageSquarePlus className="size-[18px]" />
              </button>
              <button
                type="button"
                aria-label={phase === 'live' ? 'Encerrar e fechar' : 'Fechar'}
                onClick={() => (phase === 'live' || phase === 'connecting' ? hangup() : close())}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-[18px]" />
              </button>
            </div>

            {phase === 'connecting' && (
              <div className="flex flex-1 items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Abrindo chat…
              </div>
            )}

            {phase === 'live' && (
              <>
                {testVars && (
                  <TestVarsStrip
                    orgId={agent.orgId}
                    vars={testVars}
                    usedKeys={usedKeys}
                    open={varsOpen}
                    onToggle={() => setVarsOpen((o) => !o)}
                    configHref={location.pathname.startsWith('/app/agents/') ? testContextHref(agent.id) : undefined}
                  />
                )}
                <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
                  {lines.map((l, i) =>
                    l.speaker === 'system' ? (
                      <p key={i} data-chat-system="" className="mx-auto max-w-[90%] rounded-lg bg-muted/60 px-3 py-1.5 text-center text-xs leading-5 text-muted-foreground">
                        {l.text}
                      </p>
                    ) : (
                      <div key={i} className={cn('flex', l.speaker === 'caller' ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cn(
                            'max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-6',
                            l.speaker === 'caller' ? 'bg-[#585DFE] text-white' : 'border bg-neutral-50 text-foreground',
                          )}
                        >
                          {l.text}
                        </div>
                      </div>
                    ),
                  )}
                  {typing && (
                    <div className="flex">
                      <div className="rounded-xl border bg-neutral-50 px-3.5 py-2.5 text-sm text-muted-foreground">digitando…</div>
                    </div>
                  )}
                  {bookingRef.current && <PrivateChatBookingControls key={sessionRef.current} client={bookingRef.current} choices={bookingChoices} disabled={typing} />}
                  {bookingError && <p role="alert" className="text-sm text-destructive">{bookingError}</p>}
                  {replyError && !typing && (
                    <div role="alert" data-testid="chat-reply-error" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Não foi possível responder agora.</p>
                        <p className="text-xs leading-5">{replyError.detail}</p>
                        <Button type="button" size="sm" variant="outline" className="mt-2 h-7 gap-1 px-2 text-xs" onClick={() => void consultReply()}>
                          <RotateCcw className="size-3.5" />
                          Consultar resposta
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <form onSubmit={send} className="shrink-0 border-t p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Escreva uma mensagem..."
                      className="h-10 rounded-lg"
                      aria-label="Mensagem do cliente"
                    />
                    <button
                      type="submit"
                      aria-label="Enviar"
                      disabled={!isChat || !text.trim() || typing}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#585DFE] text-white transition-colors disabled:bg-neutral-400"
                    >
                      <Send className="size-4" />
                    </button>
                  </div>
                </form>
              </>
            )}

            {phase === 'ended' && result && (
              <div className="space-y-3 px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="size-4" />
                  Chat encerrado · {fmt(result.duration)}
                </div>
                <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <MessageCircle className="size-3.5 text-muted-foreground" />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{result.title}</p>
                    {result.result && <ResultChip result={result.result} />}
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{result.summary}</p>
                </div>
                <ActionLog items={actionLog} />
                <p className="text-xs text-muted-foreground">A conversa foi salva em Conversas.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-9 flex-1" onClick={close}>
                    Fechar
                  </Button>
                  <Button asChild className="h-9 flex-1">
                    <Link to={`/app/inbox?id=${encodeURIComponent(result.id)}`} onClick={close}>
                      Ver em Conversas
                    </Link>
                  </Button>
                </div>
                <Button variant="ghost" className="h-9 w-full gap-2" onClick={newChat}>
                  <MessageSquarePlus className="size-4" />
                  Nova conversa
                </Button>
              </div>
            )}

            {phase === 'failed' && (
              <div className="space-y-3 px-4 py-4">
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">Não foi possível abrir o chat de teste.</p>
                    <p className="text-xs">{error}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-9 flex-1" onClick={close}>
                    Fechar
                  </Button>
                  <Button className="h-9 flex-1 gap-2" onClick={retryOrConsult}>
                    <RotateCcw className="size-4" />
                    {finishReference.current ? 'Consultar encerramento' : 'Tentar novamente'}
                  </Button>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}

      {/* Painel flutuante da ligação (não modal: a página continua utilizável, como na Fonio) */}
      {panelOpen &&
        !isChat &&
        createPortal(
          <div
            role="dialog"
            aria-label={isChat ? 'Chat de teste' : 'Ligação de teste'}
            className="fixed bottom-24 right-4 z-[45] flex max-h-[min(560px,calc(100svh-8rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-[0_12px_32px_rgba(15,18,28,0.18)] sm:right-6"
          >
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  phase === 'live' ? 'animate-pulse bg-red-500' : phase === 'connecting' ? 'animate-pulse bg-amber-500' : phase === 'failed' ? 'bg-destructive' : 'bg-emerald-500',
                )}
              />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                {isChat ? 'Chat de teste' : 'Ligação de teste'} · {agent.name}
              </p>
              {phase === 'live' && <span className="font-mono text-xs tabular-nums text-muted-foreground">{fmt(elapsed)}</span>}
              <button
                type="button"
                aria-label={phase === 'live' ? 'Encerrar e fechar' : 'Fechar'}
                onClick={() => (phase === 'live' || phase === 'connecting' ? hangup() : close())}
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {phase === 'connecting' && (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {isChat ? 'Abrindo chat…' : 'Conectando ligação…'}
              </div>
            )}

            {phase === 'live' && (
              <>
                {testVars && (
                  <TestVarsStrip
                    orgId={agent.orgId}
                    vars={testVars}
                    usedKeys={usedKeys}
                    open={varsOpen}
                    onToggle={() => setVarsOpen((o) => !o)}
                    configHref={location.pathname.startsWith('/app/agents/') ? testContextHref(agent.id) : undefined}
                  />
                )}
                <div ref={scrollRef} className="min-h-[160px] flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
                  {lines.map((l, i) =>
                    l.speaker === 'system' ? (
                      <p key={i} data-call-system="" className="mx-auto max-w-[92%] rounded-lg bg-muted/60 px-3 py-1.5 text-center text-xs leading-5 text-muted-foreground">
                        {l.text}
                      </p>
                    ) : (
                    <div key={i} className={cn('flex', l.speaker === 'caller' ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-5', l.speaker === 'caller' ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-muted text-foreground')}>
                        <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
                          {l.speaker === 'caller' ? 'Você' : agent.name} · {fmt(l.t)}
                        </p>
                        {l.text}
                      </div>
                    </div>
                    ),
                  )}
                  {typing && (
                    <div className="flex">
                      <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm text-muted-foreground">digitando…</div>
                    </div>
                  )}
                  {replyError && !typing && (
                    <div role="alert" data-testid="chat-reply-error" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Não foi possível responder agora.</p>
                        <p className="text-xs leading-5">{replyError.detail}</p>
                        <Button type="button" size="sm" variant="outline" className="mt-2 h-7 gap-1 px-2 text-xs" onClick={() => void consultReply()}>
                          <RotateCcw className="size-3.5" />
                          Consultar resposta
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <form onSubmit={send} className="border-t p-2">
                  <div className="flex gap-2">
                    <Input value={text} onChange={(e) => setText(e.target.value)} disabled={!isChat || typing} placeholder={isChat ? 'Escreva uma mensagem…' : 'Use o microfone para falar'} className="h-9" aria-label="Fala de quem liga" />
                    <Button type="submit" size="icon-sm" className="size-9 shrink-0" aria-label="Enviar" disabled={!isChat || !text.trim() || typing}>
                      <Send className="size-4" />
                    </Button>
                  </div>
                </form>
                <div className="border-t p-2">
                  <Button onClick={hangup} className="h-9 w-full gap-2 bg-red-600 text-white hover:bg-red-700">
                    <PhoneOff className="size-4" />
                    {isChat ? 'Encerrar chat' : 'Encerrar ligação'}
                  </Button>
                </div>
              </>
            )}

            {phase === 'ended' && result && (
              <div className="space-y-3 px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="size-4" />
                  {isChat ? 'Chat encerrado' : 'Ligação encerrada'} · {fmt(result.duration)}
                </div>
                <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    {isChat ? <MessageCircle className="size-3.5 text-muted-foreground" /> : <Headset className="size-3.5 text-muted-foreground" />}
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{result.title}</p>
                    {result.result && <ResultChip result={result.result} />}
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{result.summary}</p>
                </div>
                <ActionLog items={actionLog} />
                <p className="text-xs text-muted-foreground">A conversa foi salva em Conversas.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-9 flex-1" onClick={close}>
                    Fechar
                  </Button>
                  <Button asChild className="h-9 flex-1">
                    <Link to={`/app/inbox?id=${encodeURIComponent(result.id)}`} onClick={close}>
                      Ver em Conversas
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {phase === 'failed' && (
              <div className="space-y-3 px-4 py-4">
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">{isChat ? 'Não foi possível abrir o chat de teste.' : 'Não foi possível conectar a ligação.'}</p>
                    <p className="text-xs">{error}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-9 flex-1" onClick={close}>
                    Fechar
                  </Button>
                  <Button className="h-9 flex-1 gap-2" onClick={retryOrConsult}>
                    <RotateCcw className="size-4" />
                    {finishReference.current ? 'Consultar encerramento' : 'Tentar novamente'}
                  </Button>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

/** Ações com confirmação do motor, quando disponíveis. */
function ActionLog({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div className="space-y-1.5 rounded-lg border p-3" data-testid="test-action-log">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <ListChecks className="size-3.5 text-muted-foreground" />
        Ações do assistente
      </p>
      <ul className="max-h-32 space-y-1 overflow-y-auto text-xs leading-5 text-muted-foreground">
        {items.map((t, i) => (
          <li key={i}>{t.replace(/\s*\(Simulado\)\.?$/, '')}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Faixa "Testando como …" do painel: contato de exemplo/desconhecido e, ao expandir, cada variável usada (ou definida no
 * contexto de teste) com o valor aplicado e a origem. INFERIDO (acréscimo da casca: a Fonio não mostra o contexto na chamada).
 */
function TestVarsStrip({ orgId, vars, usedKeys, open, onToggle, configHref }: { orgId: string; vars: TestVariables; usedKeys: string[]; open: boolean; onToggle: () => void; configHref?: string }) {
  const settings = useStore((s) => s.db.contactSettings.find((c) => c.orgId === orgId))
  const defs = smartVariables(settings?.smartFields ?? [])
  const keys = [...usedKeys, ...vars.contextKeys.filter((k) => !usedKeys.includes(k))]
  const who = vars.contact ? `Contato de exemplo: ${contactFullName(vars.contact)}` : 'Contato desconhecido'
  const why =
    vars.noContactReason === 'disabled'
      ? '“Conectar contatos” está desligado neste assistente: o contato não é reconhecido e as variáveis de contato ficam vazias.'
      : vars.noContactReason === 'unknown'
        ? 'O contexto de teste está com “Contato desconhecido”: as variáveis de contato ficam vazias.'
        : vars.noContactReason === 'empty'
          ? 'A organização não tem contatos: as variáveis de contato ficam vazias.'
          : undefined
  const label = (k: string) => {
    const l = variableLabel(k, defs)
    return l === k ? `{{${k}}}` : l
  }
  return (
    <div className="border-b bg-muted/30 px-4 py-2 text-xs" data-testid="test-vars">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-muted-foreground hover:text-foreground">
        <UserRound className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{who}</span>
        <span className="shrink-0 tabular-nums">
          {keys.length} {keys.length === 1 ? 'variável' : 'variáveis'}
        </span>
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">
          {why && <p className="text-muted-foreground">{why}</p>}
          {keys.length === 0 && <p className="text-muted-foreground">Nenhuma variável nas mensagens nem no contexto de teste.</p>}
          {keys.map((k) => {
            const has = Object.prototype.hasOwnProperty.call(vars.values, k)
            const v = has ? vars.values[k] : ''
            const src = vars.sources[k]
            return (
              <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-baseline gap-2" data-var-key={k}>
                <span className="truncate font-medium text-foreground" title={`{{${k}}}`}>
                  {label(k)}
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate', v ? 'text-foreground' : 'italic text-muted-foreground')} title={v || undefined}>
                    {v || 'vazio'}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">{src ? TEST_VAR_SOURCE_LABEL[src] : 'Não definida no teste'}</span>
                </span>
              </div>
            )
          })}
          {vars.contextError && <p className="text-destructive">Contexto de teste inválido: {vars.contextError}</p>}
          {configHref ? (
            <Link to={configHref} className="inline-flex pt-1 font-medium text-brand hover:underline">
              Editar contexto de teste
            </Link>
          ) : (
            <p className="pt-1 text-muted-foreground">Edite em Assistentes › Webhooks › Contexto de teste.</p>
          )}
        </div>
      )}
    </div>
  )
}
