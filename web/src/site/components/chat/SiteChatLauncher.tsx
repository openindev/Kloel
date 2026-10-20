import { useEffect, useRef, useState } from 'react'
import { MessageSquareText, X } from 'lucide-react'
import { KloelMark } from '@/components/brand/KloelLogo'
import { cn } from '@/lib/utils'
import { KLOEL_KNOWLEDGE, KLOEL_SITE_AGENT } from '../kloelKnowledge'
import { useSimChat } from './useSimChat'
import { ChatWidget } from './ChatWidget'

/** Atributo que marca áreas que o lançador flutuante nunca pode cobrir (ex.: formulário "Gerar minha IA" do hero). */
export const LAUNCHER_AVOID_ATTR = 'data-chat-launcher-avoid'

/**
 * Esconde o lançador enquanto a posição dele cruzaria um controle marcado com `data-chat-launcher-avoid`.
 * A medição usa a caixa do botão (a opacidade não altera o layout), refeita em rolagem, redimensionamento e mudanças de layout.
 */
function useAvoidOverlap(ref: React.RefObject<HTMLElement>, deps: unknown[]) {
  const [overlap, setOverlap] = useState(false)
  useEffect(() => {
    let raf = 0
    const check = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const m = 8
      const hit = [...document.querySelectorAll(`[${LAUNCHER_AVOID_ATTR}]`)].some((a) => {
        const b = a.getBoundingClientRect()
        return b.width > 0 && b.left < r.right + m && b.right > r.left - m && b.top < r.bottom + m && b.bottom > r.top - m
      })
      setOverlap(hit)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check)
    }
    check()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('transitionend', schedule)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(document.body)
    const late = [350, 900].map((ms) => setTimeout(schedule, ms))
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('transitionend', schedule)
      ro?.disconnect()
      late.forEach(clearTimeout)
      if (raf) cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return overlap
}

/**
 * Posição medida nas referências da página Webchat (3. Webchat de IA novo/02.png, 03.png, 6.png a 1470 px): círculo de 56 px a
 * 16 px da direita e da base. O site não tem barra/balão flutuante de "Agendar demo" (removido — E2), então não há deslocamento.
 */
const LAUNCHER_BOTTOM = '16px'
const PANEL_BOTTOM = '88px'

/** Lançador flutuante de chat (círculo índigo no canto inferior direito — OBSERVADO na página Webchat) que abre o webchat da Kloel (respostas do motor local). */
export function SiteChatLauncher() {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  // No celular o lançador pode cruzar o botão "Gerar minha IA" do hero: enquanto houver cruzamento ele sai de cena
  // (sem receber toques nem foco) e volta assim que a página rola para longe do controle.
  const overlap = useAvoidOverlap(btnRef, [])
  const hidden = overlap && !open
  const chat = useSimChat({
    agent: KLOEL_SITE_AGENT,
    knowledge: KLOEL_KNOWLEDGE,
    greeting: 'Olá! Bem-vindo à Kloel. Como posso ajudar? Ou prefere conhecer rapidamente o que posso fazer?',
    persist: { key: 'kloel-site:launcher-chat', storage: 'session' },
  })
  return (
    <>
      {open && (
        <div
          className={cn('ks-pop fixed right-4 z-40 flex h-[min(540px,70vh)] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-20px_rgba(15,15,22,.45)]')}
          style={{ bottom: PANEL_BOTTOM }}
        >
          <ChatWidget
            title="Kloel"
            subtitle="Chatbot de IA da Kloel"
            avatar={<KloelMark className="h-10 w-10 rounded-full" />}
            messages={chat.messages}
            typing={chat.typing}
            onSend={chat.send}
            onAttach={chat.attach}
            onReset={chat.reset}
            onRetry={chat.retry}
            canRetry={chat.canRetry}
          />
        </div>
      )}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-hidden={hidden || undefined}
        tabIndex={hidden ? -1 : undefined}
        data-hidden={hidden || undefined}
        className={cn(
          'fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-blue text-white shadow-[0_12px_30px_-8px_rgba(88,93,254,.8)] transition-[opacity,transform] duration-200 hover:scale-105',
          hidden && 'pointer-events-none opacity-0',
        )}
        style={{ bottom: LAUNCHER_BOTTOM }}
        aria-label={open ? 'Fechar chat' : 'Abrir chat com a Kloel'}
        data-testid="site-chat-launcher"
      >
        {open ? <X className="h-6 w-6" /> : <MessageSquareText className="h-6 w-6" />}
      </button>
    </>
  )
}
