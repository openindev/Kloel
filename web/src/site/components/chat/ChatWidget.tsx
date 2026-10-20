import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, MessageSquarePlus, Paperclip, RotateCcw, SendHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SimMessage } from './useSimChat'

/**
 * Corpo de um widget de chat (cabeçalho, mensagens, rodapé com contador opcional, anexo, campo e enviar).
 * Componente de apresentação: recebe o estado de useSimChat.
 */
export function ChatWidget({
  title, subtitle, avatar, messages, typing, onSend, onAttach, onReset, onRetry, canRetry, remaining, limit, brandColor = '#585DFE', footerNote, limitReached, className, disabledReason,
}: {
  title: string; subtitle: string; avatar: ReactNode; messages: SimMessage[]; typing: boolean; onSend: (t: string) => boolean
  /** anexo escolhido no seletor de arquivos (o arquivo não é lido; só nome e tamanho) */
  onAttach?: (file: { name: string; size: number }) => boolean
  onReset: () => void; onRetry?: () => void; canRetry?: boolean
  remaining?: number; limit?: number; brandColor?: string; footerNote?: ReactNode; limitReached?: ReactNode; className?: string; disabledReason?: string
}) {
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, typing])
  const blocked = remaining !== undefined && Number.isFinite(remaining) && remaining <= 0
  const disabled = blocked || !!disabledReason

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (onSend(text)) setText('')
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-white font-site', className)}>
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-medium text-heading">{title}</div>
          <div className="truncate text-[14px] text-body">{subtitle}</div>
        </div>
        <button type="button" onClick={() => { onReset(); setText('') }} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Nova conversa" title="Nova conversa">
          <MessageSquarePlus className="h-[18px] w-[18px]" />
        </button>
      </div>
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-5" aria-live="polite">
        {messages.map((m) =>
          m.role === 'system' ? (
            <div key={m.id} role="alert" data-engine-state={m.error ? 'error' : undefined} className="flex flex-col items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-center text-[13px] text-red-700">
              {m.text}
              {canRetry && onRetry && (
                <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium underline"><RotateCcw className="h-3 w-3" /> Tentar novamente</button>
              )}
            </div>
          ) : (
            <div key={m.id} className={cn('ks-fade-up max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-[21px]', m.role === 'user' ? 'ml-auto rounded-br-md text-white' : 'rounded-tl-md border border-slate-100 bg-[#F4F5F7] text-ink')} style={m.role === 'user' ? { background: brandColor } : undefined}>
              {m.attachment ? (
                <span className="flex items-center gap-2.5" data-testid="chat-attachment">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/20"><FileText className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.attachment.name}</span>
                    <span className="block text-[12px] opacity-80">{m.attachment.size}</span>
                  </span>
                </span>
              ) : (
                m.text
              )}
            </div>
          ),
        )}
        {typing && (
          <div className="flex w-fit gap-1 rounded-2xl border border-slate-100 bg-[#F4F5F7] px-3.5 py-3" aria-label="digitando">
            {[0, 1, 2].map((i) => <span key={i} className="ks-typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />)}
          </div>
        )}
        {blocked && limitReached}
      </div>
      <div className="border-t border-slate-100 px-4 pb-3 pt-3">
        {limit !== undefined && remaining !== undefined && Number.isFinite(remaining) && (
          <div className="mb-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${(remaining / limit) * 100}%`, background: '#CBD5E1' }} />
            </div>
            <span className="shrink-0 text-[13px] text-body">{remaining === 1 ? 'Resta 1 mensagem' : `Restam ${remaining} mensagens`}</span>
          </div>
        )}
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx,image/*"
            data-testid="chat-file-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onAttach?.({ name: f.name, size: f.size })
              e.target.value = ''
            }}
          />
          <button type="button" disabled={disabled || typing || !onAttach} onClick={() => fileRef.current?.click()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50" aria-label="Anexar arquivo" title="Anexar arquivo">
            <Paperclip className="h-[18px] w-[18px]" />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={disabled}
            placeholder={disabledReason ?? (blocked ? 'Limite de mensagens atingido' : 'Escreva uma mensagem…')}
            aria-label="Escreva uma mensagem"
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 text-[15px] text-ink outline-none placeholder:text-slate-400 focus:border-slate-400 disabled:bg-slate-50"
          />
          <button type="submit" disabled={disabled || !text.trim() || typing} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50" aria-label="Enviar mensagem">
            <SendHorizontal className="h-[18px] w-[18px]" />
          </button>
        </form>
        {footerNote && <div className="mt-2 text-center text-[12px] text-body">{footerNote}</div>}
      </div>
    </div>
  )
}
