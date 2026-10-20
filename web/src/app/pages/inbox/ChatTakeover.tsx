import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Loader2, RotateCw, SendHorizontal, UserRound, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { Conversation } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import { useCurrentUser } from '@/data/store'
import { captureEngineContext, useEngineSession } from '@/services/engine/session'
import { createConversationActions, type Handling } from '@/services/casca/conversation-actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const MAX_LEN = 1000
const emptyHandling: Handling = { mode: 'closed', takeover: false, release: false, reply: false, maxLength: 0 }

export function useChatTakeover(conversation: Conversation) {
  const user = useCurrentUser(), session = useEngineSession()
  const userName = user ? `${user.firstName} ${user.lastName}`.trim() : 'Equipe'
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [focusToken, setFocusToken] = useState(0)
  const [handling, setHandling] = useState<Handling>(emptyHandling)
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [unresolved, setUnresolved] = useState(false)
  const busy = useRef(false)
  const actions = useMemo(() => {
    if (session.phase !== 'authenticated' || !session.data || !['webchat','whatsapp'].includes(conversation.channel)) return null
    const identity = session.data.identity.context
    if (!identity.tenantId || !identity.membershipId) return null
    try { return createConversationActions(captureEngineContext(), conversation, { ...identity, tenantId: identity.tenantId, membershipId: identity.membershipId }, window.sessionStorage) }
    catch { return null }
  }, [conversation.id, conversation.channel, session.generation])
  useEffect(() => {
    let active = true
    setHandling(emptyHandling)
    if (!actions) return
    void actions.handling().then(value => { if (active) { setHandling(value); setUnresolved(actions.pending()) } }).catch(e => { if (active) { setError(e instanceof Error ? e.message : 'Não foi possível carregar o atendimento.'); setStatus('error') } })
    return () => { active = false }
  }, [actions, conversation.engineConversation?.control?.version])
  const validationReady = session.phase === 'authenticated' && session.validation === 'ready'
  const run = async (kind: 'takeover' | 'release' | 'reply' | 'recover', content?: string) => {
    if (!actions || busy.current || !validationReady) return false
    busy.current = true; setStatus('running'); setError(null)
    if (kind === 'reply') setPendingText(content ?? '')
    try {
      let recoveredFailure = false
      if (kind === 'recover') recoveredFailure = (await actions.recover()).outcome === 'failed'
      else await actions.command(kind, content)
      const updatedHandling = await actions.handling()
      setHandling(updatedHandling); setUnresolved(actions.pending())
      if (recoveredFailure) { setStatus('error'); setError('A tentativa falhou. Você pode editar a mensagem ou iniciar um novo envio.'); toast.error('A tentativa não foi concluída.'); return false }
      setStatus('idle'); setPendingText(null)
      if (kind === 'takeover') { setFocusToken(n => n + 1); toast.success('Conversa assumida pela equipe') }
      if (kind === 'release') toast.success('Conversa devolvida ao assistente')
      if (kind === 'recover') toast.info('Situação da tentativa atualizada')
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Não foi possível confirmar esta ação.'
      let pending = true
      try { pending = actions.pending() } catch { /* Preserve unresolved state when the journal cannot be read. */ }
      setUnresolved(pending); setError(message); setStatus('error')
      if (kind !== 'reply' || !content) toast.error(message)
      return false
    } finally { busy.current = false }
  }
  const takenOver = handling.mode === 'human'
  const mine = !!conversation.handover?.userId && conversation.handover.userId === user?.id
  const blocked = !validationReady || status === 'running'
  return {
    takenOver, mine, userName, focusToken, pendingText, unresolved,
    canTakeover: !blocked && handling.takeover && !unresolved,
    canRelease: !blocked && handling.release && !unresolved,
    canReply: !blocked && handling.reply && !unresolved,
    assume: () => run('takeover'), release: () => run('release'), send: (text: string) => run('reply', text), recover: () => run('recover'),
    editFailed: () => { if (unresolved) return ''; const text = pendingText ?? ''; setPendingText(null); setStatus('idle'); setError(null); return text },
    op: { status, error, progress: { label: 'Confirmando a ação…' } },
  }
}

export type ChatTakeoverState = ReturnType<typeof useChatTakeover>

/** Balão provisório da mensagem em envio/falha (à esquerda, lado da empresa, como as mensagens da equipe — WA-03). */
export function PendingMessageRow({ state, onEdit }: { state: ChatTakeoverState; onEdit: (text: string) => void }) {
  if (!state.pendingText) return null
  const failed = state.op.status === 'error'
  return (
    <div className="flex justify-start py-1 pr-10" data-testid="inbox-pending-message" aria-live="polite">
      <div className={cn('max-w-[min(75%,560px)] rounded-xl border px-3 py-2 text-[13px] leading-[1.45]', failed ? 'border-destructive/40 bg-destructive/5' : 'border-dashed bg-muted/20')}>
        <span className="mb-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
          {failed ? <AlertCircle className="h-2.5 w-2.5 shrink-0 text-destructive" /> : <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />}
          <span className="truncate">Equipe{state.userName ? ` · ${state.userName}` : ''}</span>
        </span>
        <p className={failed ? 'whitespace-pre-wrap break-words text-foreground/60' : 'whitespace-pre-wrap break-words text-foreground/50'}>{state.pendingText}</p>
        {failed ? (
          <div role="alert" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
            <span className="text-destructive">{state.unresolved ? 'Envio não confirmado' : 'Não enviada'}: {state.op.error}</span>
            <button type="button" onClick={() => state.op.status === 'error' && (state.unresolved ? state.recover() : state.send(state.pendingText!))} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
              <RotateCw className="h-3 w-3" /> {state.unresolved ? 'Consultar tentativa' : 'Tentar novamente'}
            </button>
            <button type="button" disabled={state.unresolved} onClick={() => onEdit(state.editFailed())} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
              <Pencil className="h-3 w-3" /> Editar
            </button>
          </div>
        ) : (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{state.op.progress.label || 'Enviando…'}</p>
        )}
      </div>
    </div>
  )
}

/**
 * Rodapé do chat atendido pelo assistente (captura WA-03): "● A IA está atendendo este chat" + botão roxo "Assumir".
 * Chats encerrados mostram quem atendeu; o botão continua disponível (Central de ajuda: "Você pode assumir qualquer chat").
 */
export function ChatHandlingBar({
  conversation,
  state,
  readOnly,
  readOnlyHint,
  reserveCorner,
}: {
  conversation: Conversation
  state: ChatTakeoverState
  readOnly: boolean
  readOnlyHint: string
  reserveCorner?: boolean
}) {
  const transferred = !conversation.chatActive && conversation.result === 'transferred'
  const label = conversation.chatActive ? 'A IA está atendendo este chat' : transferred ? 'Chat transferido para a equipe' : 'A IA atendeu este chat'
  const dot = conversation.chatActive ? 'bg-green-500' : transferred ? 'bg-brand' : 'bg-muted-foreground/50'
  const button = (
    <Button size="sm" variant="brand" className="h-8 shrink-0 gap-1.5 px-3 text-[13px]" disabled={readOnly || (!state.canTakeover && !state.unresolved)} onClick={state.unresolved ? state.recover : state.assume} aria-label="Assumir conversa">
      <UserRound className="h-3.5 w-3.5" /> {state.unresolved ? 'Consultar tentativa' : 'Assumir'}
    </Button>
  )
  return (
    <div
      className={cn('flex shrink-0 items-center justify-between gap-3 border-t bg-white px-6 py-3 max-md:px-4 print:hidden', reserveCorner && 'max-sm:pr-12 sm:pr-[176px]')}
      data-testid="inbox-takeover"
    >
      <span className="inline-flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground" data-testid="inbox-takeover-status">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
        <span className="truncate">{label}</span>
      </span>
      {readOnly ? (
        <SimpleTooltip label={readOnlyHint}>
          <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring">
            {button}
          </span>
        </SimpleTooltip>
      ) : (
        button
      )}
    </div>
  )
}

/** Compositor da equipe (somente com o chat assumido), no rodapé da coluna da transcrição. */
export function ChatComposer({
  conversation,
  state,
  readOnly,
  readOnlyHint,
  contactLabel,
  draft,
  setDraft,
}: {
  conversation: Conversation
  state: ChatTakeoverState
  readOnly: boolean
  readOnlyHint: string
  contactLabel: string
  draft: string
  setDraft: (v: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sending = state.op.status === 'running'
  const blockedByFailure = state.op.status === 'error' && !!state.pendingText

  useEffect(() => {
    if (state.focusToken) inputRef.current?.focus()
  }, [state.focusToken])

  if (!state.takenOver) return null

  const submit = async () => {
    const text = draft.trim()
    if (!text) {
      setError('Escreva uma mensagem antes de enviar.')
      inputRef.current?.focus()
      return
    }
    if (text.length > MAX_LEN) {
      setError(`A mensagem pode ter no máximo ${MAX_LEN} caracteres.`)
      return
    }
    if (blockedByFailure) {
      setError('Confira a tentativa pendente antes de enviar outra mensagem.')
      return
    }
    setError(null)
    setDraft('')
    await state.send(text)
  }

  const by = state.mine ? 'Você assumiu' : `${conversation.handover?.by ?? 'A equipe'} assumiu`
  return (
    <div className="shrink-0 border-t bg-white px-6 pb-4 pt-3 max-md:px-4 print:hidden" data-testid="inbox-composer">
      <div className="mb-2 flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <UserRound className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">{by} esta conversa</span>
          <span className="max-sm:hidden"> · o assistente não responde enquanto a equipe atende</span>
        </span>
        {!readOnly && (
          <button type="button" onClick={state.unresolved ? state.recover : state.release} disabled={sending || (!state.canRelease && !state.unresolved)} className="shrink-0 font-medium text-foreground hover:underline disabled:opacity-50">
            {state.unresolved ? 'Consultar tentativa' : 'Devolver ao assistente'}
          </button>
        )}
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          ref={inputRef}
          rows={2}
          value={draft}
          disabled={readOnly || !state.canReply}
          aria-label="Mensagem para o contato"
          aria-invalid={!!error}
          placeholder={readOnly ? readOnlyHint : `Escreva para ${contactLabel}…`}
          onChange={(e) => {
            setDraft(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (!sending && state.canReply) void submit()
            }
          }}
          className="min-h-[60px] flex-1 resize-none text-[13px]"
        />
        <Button type="button" size="sm" className="shrink-0 gap-1.5" onClick={() => void submit()} disabled={readOnly || sending || !state.canReply} aria-label="Enviar mensagem">
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
          <span className="max-sm:sr-only">Enviar</span>
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="max-sm:hidden">Enter envia · Shift+Enter quebra a linha</span>
      </div>
    </div>
  )
}
