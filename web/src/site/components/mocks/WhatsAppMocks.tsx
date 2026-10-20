import type { ReactNode } from 'react'
import { ChevronLeft, Phone, Video, CheckCheck, Loader2, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Bolha de mensagem no estilo WhatsApp (in = recebida, branca; out = enviada, verde-clara). */
export function WaBubble({ from, children, time, ticks = true, italic, spinner, className }: { from: 'in' | 'out'; children: ReactNode; time?: string; ticks?: boolean; italic?: boolean; spinner?: boolean; className?: string }) {
  return (
    <div className={cn('flex', from === 'out' ? 'justify-end' : 'justify-start', className)}>
      <div
        className={cn(
          'relative max-w-[82%] rounded-lg px-2.5 py-1.5 font-sans text-[13px] leading-[18px] text-[#111B21] shadow-[0_1px_.5px_rgba(11,20,26,.13)]',
          from === 'out' ? 'rounded-tr-none bg-[#D9FDD3]' : 'rounded-tl-none bg-white',
          italic && 'italic text-[#3b4a54]',
        )}
      >
        <span className="flex items-center gap-1.5">
          {spinner && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#667781]" />}
          <span className="whitespace-pre-wrap break-words">{children}</span>
        </span>
        {time && (
          <span className="float-right ml-2 mt-1 flex items-center gap-0.5 text-[10px] leading-none text-[#667781]">
            {time}
            {from === 'out' && ticks && <CheckCheck className="h-3 w-3 text-[#53BDEB]" />}
          </span>
        )}
      </div>
    </div>
  )
}

export function WaDayLabel({ children = 'Hoje' }: { children?: ReactNode }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-md bg-white px-2 py-0.5 font-sans text-[11px] font-medium text-[#54656F] shadow-[0_1px_.5px_rgba(11,20,26,.13)]">{children}</span>
    </div>
  )
}

export function WaSystemNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center">
      <span className="flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 font-sans text-[11.5px] text-[#54656F] shadow-[0_1px_.5px_rgba(11,20,26,.13)]">
        <UserRound className="h-3 w-3" /> {children}
      </span>
    </div>
  )
}

/**
 * Celular com conversa do WhatsApp: barra de status, cabeçalho (voltar, avatar, nome, vídeo, telefone) e fundo com padrão.
 * children = mensagens ; footer opcional (campo de digitação).
 */
export function WaPhone({ title = 'Cliente', subtitle, time = '23:59', children, footer, className, bodyClassName, avatar }: { title?: string; subtitle?: string; time?: string; children: ReactNode; footer?: ReactNode; className?: string; bodyClassName?: string; avatar?: ReactNode }) {
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-[34px] border-[6px] border-[#111] bg-white font-sans shadow-[0_30px_80px_-30px_rgba(15,15,22,.5)]', className)}>
      <div className="flex items-center justify-between bg-[#F7F8FA] px-5 pb-1 pt-2 text-[11px] font-semibold text-[#111]">
        <span>{time}</span>
        <span className="h-4 w-16 rounded-full bg-black" />
        <span className="tracking-tight">▮▮▮ 100</span>
      </div>
      <div className="flex items-center gap-2 border-b border-black/5 bg-[#F7F8FA] px-2.5 py-2">
        <ChevronLeft className="h-5 w-5 text-[#111]" />
        {avatar ?? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#DFE5E7] text-[#8696A0]">
            <UserRound className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-[#111B21]">{title}</div>
          {subtitle && <div className="truncate text-[10.5px] text-[#667781]">{subtitle}</div>}
        </div>
        <Video className="h-4 w-4 text-[#111]" />
        <Phone className="ml-2 h-4 w-4 text-[#111]" />
      </div>
      <div className={cn('ks-wa-doodle flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3', bodyClassName)}>{children}</div>
      {footer}
    </div>
  )
}
