import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { HelpLayout } from '../components/HelpLayout'
import { useHelpUi } from '../lib/ui'
import { useAutoGrow } from '../lib/useAutoGrow'
import { useHelpTitle } from '../lib/title'

/** Home da Central de ajuda (referência [218]): hero centralizado com caixa de pergunta ao assistente. */
export default function HelpHomePage() {
  const openAsk = useHelpUi((s) => s.openAsk)
  const openSupport = useHelpUi((s) => s.openSupport)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, q)
  useHelpTitle('Início')

  useEffect(() => {
    ref.current?.focus()
  }, [])

  // a pergunta vai para a conversa do assistente (na fila, se outra resposta estiver em andamento)
  const submit = () => {
    if (!q.trim()) return
    openAsk(q)
    setQ('')
  }

  return (
    <HelpLayout activeTab="get-started" showActiveTab={false}>
      <section className="relative isolate flex min-h-[calc(100svh-113px)] flex-col items-center overflow-hidden px-4 pb-24 pt-16 sm:pt-[114px] lg:px-10">
        {/* brilho lilás + grade de 32px centralizada (medidas da referência [218]: topo #f1f1fe, linhas zinc-200 ~35%) */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(ellipse_490px_480px_at_50%_0%,rgba(88,93,254,0.095),rgba(88,93,254,0.084)_26%,rgba(88,93,254,0.045)_63%,transparent_100%)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 [background-image:linear-gradient(to_right,rgb(228_228_231/0.34)_1px,transparent_1px),linear-gradient(to_bottom,rgb(228_228_231/0.34)_1px,transparent_1px)] [background-position:calc(50%+16px)_-1px] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_600px_470px_at_50%_0%,#000,rgba(0,0,0,0.55)_55%,rgba(0,0,0,0.42)_85%,transparent_100%)]"
        />

        <KloelLogo className="text-[30px] sm:text-[34px]" />
        <h1 className="mt-5 max-w-[720px] sm:mt-[19px] text-center text-[34px] font-semibold leading-[1.08] tracking-[-0.9px] text-zinc-950 sm:text-[48px] sm:leading-[48px] sm:tracking-[-1.2px]">
          Tudo o que você precisa para o seu agente de voz
        </h1>

        <form
          className="mt-12 w-full max-w-[670px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] focus-within:border-zinc-300"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="flex items-start gap-3 p-4 pl-6">
            <textarea
              ref={ref}
              rows={1}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Pergunte qualquer coisa sobre a Kloel…"
              aria-label="Pergunte qualquer coisa sobre a Kloel"
              className="mt-1.5 max-h-40 min-h-[56px] flex-1 resize-none sm:min-h-[30px] bg-transparent text-[16px] leading-7 text-zinc-900 outline-none placeholder:text-zinc-500"
            />
            <button
              type="submit"
              aria-label="Perguntar ao assistente"
              disabled={!q.trim()}
              className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-colors', q.trim() ? 'bg-brand hover:bg-[#464ac4]' : 'bg-brand/40')}
            >
              <ArrowUp className="size-[18px]" />
            </button>
          </div>
          <div className="flex flex-col gap-2 border-t border-zinc-200/80 bg-zinc-50/70 px-5 py-3 text-xs leading-4 text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
            <span>As respostas vêm da central de ajuda da Kloel.</span>
            <button type="button" onClick={() => openSupport()} className="inline-flex items-center gap-1.5 self-start text-zinc-500 transition-colors hover:text-zinc-900 sm:self-auto">
              <Mail className="size-[15px]" /> Mandar e-mail ao time
            </button>
          </div>
        </form>
      </section>
    </HelpLayout>
  )
}
