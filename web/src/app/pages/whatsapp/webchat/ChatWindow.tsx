import type { ReactNode } from 'react'
import { MessageSquarePlus, Paperclip, Send } from 'lucide-react'
import type { WebchatSetup } from '@/domain/ext/mais-a'
import { cn } from '@/lib/utils'

/** Avatares padrão ilustrados (desenho próprio da Kloel; a Fonio usa ilustrações próprias). */
export function DefaultAvatar({ kind, className }: { kind: 'feminino' | 'masculino'; className?: string }) {
  const f = kind === 'feminino'
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <circle cx="32" cy="32" r="32" fill={f ? '#EEF0FF' : '#E8F4FF'} />
      {f && <path d="M16 34c0-13 7-22 16-22s16 9 16 22v14H16z" fill="#2B2340" />}
      <path d="M14 64c1-11 8-17 18-17s17 6 18 17z" fill={f ? '#1F2A44' : '#1E3A5F'} />
      <path d="M27 44h10v6c0 3-2 5-5 5s-5-2-5-5z" fill="#E9B48F" />
      <path d="M26 47l6 7 6-7" fill="none" stroke={f ? '#22B5C8' : '#22B5C8'} strokeWidth="3" />
      <ellipse cx="32" cy="31" rx="11" ry="13" fill="#F2C29E" />
      {f ? <path d="M21 30c1-9 6-13 11-13s10 4 11 13c-4-5-8-6-11-6s-7 1-11 6z" fill="#2B2340" /> : <path d="M21 28c0-8 5-12 11-12s11 4 11 12c-3-3-7-5-11-5s-8 2-11 5z" fill="#2A1F1A" />}
      <circle cx="28" cy="32" r="1.4" fill="#2B2340" />
      <circle cx="36" cy="32" r="1.4" fill="#2B2340" />
      <path d="M29 37c2 1.5 4 1.5 6 0" fill="none" stroke="#B5674A" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function AgentPicture({ w, className }: { w: Pick<WebchatSetup, 'avatar' | 'avatarUpload' | 'avatarBorder'>; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 overflow-hidden rounded-full', w.avatarBorder && 'ring-1 ring-border ring-offset-1', className)}>
      {w.avatar === 'upload' && w.avatarUpload ? <img src={w.avatarUpload.dataUrl} alt="" className="size-full object-cover" /> : <DefaultAvatar kind={w.avatar === 'masculino' ? 'masculino' : 'feminino'} className="size-full" />}
    </span>
  )
}

export interface ChatMsg {
  id: string
  from: 'assistant' | 'visitor'
  text: string
  failed?: boolean
}

/** Janela de chat do Chatbot de IA (widget e página hospedada — WC-07/WC-13/WC-14). */
export function ChatWindow({
  w,
  name,
  messages,
  input,
  onInput,
  onSend,
  onNewChat,
  sending,
  className,
  footerNote,
  compact,
  onAttach,
}: {
  w: WebchatSetup
  name: string
  messages: ChatMsg[]
  input?: string
  onInput?: (v: string) => void
  onSend?: () => void
  onNewChat?: () => void
  sending?: boolean
  className?: string
  footerNote?: ReactNode
  compact?: boolean
  onAttach?: () => void
}) {
  const dark = w.theme === 'dark'
  const headerAccent = w.accentMode === 'header'
  const canSend = !!input?.trim() && !sending
  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden', dark ? 'bg-[#16161d] text-white' : 'bg-white text-foreground', className)} data-theme-preview={w.theme}>
      <div className={cn('flex items-center gap-3 border-b px-4', compact ? 'h-14' : 'h-16', dark && 'border-white/10')} style={headerAccent ? { backgroundColor: w.accent, color: '#fff', borderColor: 'transparent' } : undefined}>
        <AgentPicture w={w} className={compact ? 'size-7' : 'size-8'} />
        <span className={cn('min-w-0 flex-1 truncate font-semibold', compact ? 'text-sm' : 'text-[15px]')}>{name}</span>
        <button type="button" aria-label="Nova conversa" onClick={onNewChat} className={cn('rounded-md p-1.5', headerAccent ? 'hover:bg-white/15' : dark ? 'hover:bg-white/10' : 'hover:bg-muted')}>
          <MessageSquarePlus className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4" aria-live="polite">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-5',
              m.from === 'assistant' ? cn('self-start border', dark ? 'border-white/10 bg-white/5' : 'bg-muted/40') : 'self-end text-white',
              m.failed && 'border-destructive/40 text-destructive',
            )}
            style={m.from === 'visitor' ? { backgroundColor: w.accent } : undefined}
          >
            {m.text}
          </div>
        ))}
        {sending && <div className={cn('self-start rounded-xl border px-3.5 py-2.5 text-sm text-muted-foreground', dark ? 'border-white/10' : 'bg-muted/40')}>Digitando…</div>}
      </div>
      <form
        className={cn('flex items-center gap-2 border-t p-3', dark && 'border-white/10')}
        onSubmit={(e) => {
          e.preventDefault()
          if (canSend) onSend?.()
        }}
      >
        {w.attachments && (
          <button type="button" aria-label="Anexar arquivo" disabled={!onAttach} className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border disabled:cursor-default', dark ? 'border-white/15' : 'bg-background')} onClick={onAttach}>
            <Paperclip className="size-4" />
          </button>
        )}
        <input
          aria-label="Mensagem"
          value={input ?? ''}
          onChange={(e) => onInput?.(e.target.value)}
          readOnly={!onInput}
          placeholder="Escreva uma mensagem..."
          className={cn('h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring', dark ? 'border-white/15 bg-transparent placeholder:text-white/40' : 'bg-background')}
        />
        <button
          type="submit"
          aria-label="Enviar mensagem"
          disabled={!canSend}
          className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border text-white transition-colors disabled:cursor-not-allowed', !canSend && (dark ? 'border-white/15 bg-white/10 text-white/50' : 'bg-muted text-muted-foreground'))}
          style={canSend ? { backgroundColor: w.accent, borderColor: w.accent } : undefined}
        >
          <Send className="size-4" />
        </button>
      </form>
      {footerNote}
    </div>
  )
}
