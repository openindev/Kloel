import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlignLeft, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileText, Sparkles, ThumbsDown, ThumbsUp, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import type { TocItem } from '../lib/markdown'
import { copyText, readFeedback, useHelpUi, usePageFeedback, writeFeedback, type PageFeedback } from '../lib/ui'
import { getArticle } from '../content'

/* ------------------------------ Sumário ------------------------------ */

const SPY_OFFSET = 150

export function TableOfContents({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | undefined>(items[0]?.id)
  useEffect(() => {
    if (!items.length) return
    let raf = 0
    const compute = () => {
      raf = 0
      let current = items[0]!.id
      for (const it of items) {
        const el = document.getElementById(it.id)
        if (el && el.getBoundingClientRect().top - SPY_OFFSET <= 0) current = it.id
      }
      // no fim da página, destaca o último item
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = items[items.length - 1]!.id
      setActive(current)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute)
    }
    compute()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [items])
  if (!items.length) return null
  return (
    <nav aria-label="Nesta página" className="text-sm">
      <p className="mb-3 flex items-center gap-2 font-medium text-zinc-900">
        <AlignLeft className="size-3.5" /> Nesta página
      </p>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              data-active={active === it.id || undefined}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                window.history.replaceState(window.history.state, '', `#${it.id}`)
                setActive(it.id)
              }}
              className={cn(
                'block py-1 leading-5 transition-colors',
                it.level === 3 && 'pl-4',
                active === it.id ? 'font-medium text-brand' : 'text-zinc-500 hover:text-zinc-900',
              )}
            >
              {it.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/* --------------------------- Copiar página --------------------------- */

export function CopyPageMenu({ markdown, title, pageKey }: { markdown: string; title: string; pageKey: string }) {
  const [copied, setCopied] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const openAsk = useHelpUi((s) => s.openAsk)
  const copy = async () => {
    if (await copyText(markdown)) {
      setCopied(true)
      toast.success('Página copiada como Markdown')
      setTimeout(() => setCopied(false), 1800)
    } else toast.error('Não foi possível copiar a página.')
  }
  return (
    <>
      <div className="flex shrink-0 items-stretch overflow-hidden rounded-xl border border-zinc-200 bg-white text-sm text-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <button type="button" onClick={copy} className="flex h-8 items-center gap-1.5 px-2.5 hover:bg-zinc-50">
          {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
          <span>Copiar página</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Mais opções da página" className="flex h-8 items-center border-l border-zinc-200 px-1.5 hover:bg-zinc-50">
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-1.5">
            <DropdownMenuItem onSelect={copy} className="items-start gap-3 rounded-lg p-2">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border"><Copy className="size-3.5" /></span>
              <span>
                <span className="block font-medium">Copiar página</span>
                <span className="block text-xs text-muted-foreground">Copiar a página como Markdown para LLMs</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setViewOpen(true)} className="items-start gap-3 rounded-lg p-2">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border"><FileText className="size-3.5" /></span>
              <span>
                <span className="block font-medium">Ver como Markdown</span>
                <span className="block text-xs text-muted-foreground">Ver esta página como texto simples</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAsk(`Resuma o artigo “${title}”`, { summaryOf: pageKey, pageKey })} className="items-start gap-3 rounded-lg p-2">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border"><Sparkles className="size-3.5 text-brand" /></span>
              <span>
                <span className="block font-medium">Perguntar ao assistente</span>
                <span className="block text-xs text-muted-foreground">Tirar dúvidas sobre esta página</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-3xl gap-y-4 font-sans">
          <DialogHeader>
            <DialogTitle>{title}.md</DialogTitle>
            <DialogDescription>Conteúdo desta página em Markdown.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl border bg-zinc-50 p-4 font-mono text-[12.5px] leading-5 text-zinc-800">{markdown}</pre>
          <div className="flex justify-end">
            <button type="button" onClick={copy} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800">
              <Copy className="size-4" /> Copiar Markdown
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ------------------------------ Feedback ------------------------------ */

export function PageFeedbackBox({ pageKey }: { pageKey: string }) {
  const fb = usePageFeedback(pageKey)
  const [comment, setComment] = useState('')
  const [commentSent, setCommentSent] = useState(false)
  useEffect(() => {
    readFeedback(pageKey) // migra respostas antigas do localStorage para o store
    setComment('')
    setCommentSent(false)
  }, [pageKey])
  const setFb = (next: PageFeedback | undefined) => writeFeedback(pageKey, next)
  const vote = (v: 'yes' | 'no') => {
    setFb({ vote: v, at: new Date().toISOString() })
    setCommentSent(false)
  }
  return (
    <div className="mt-14 rounded-2xl border border-zinc-200 px-5 py-4" data-feedback>
      {!fb ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-zinc-900">Esta página foi útil?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => vote('yes')} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-700 hover:bg-zinc-50">
              <ThumbsUp className="size-3.5" /> Sim
            </button>
            <button type="button" onClick={() => vote('no')} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-700 hover:bg-zinc-50">
              <ThumbsDown className="size-3.5" /> Não
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-zinc-700">
              {fb.vote === 'yes' ? <ThumbsUp className="size-4 text-emerald-600" /> : <ThumbsDown className="size-4 text-amber-600" />}
              {fb.vote === 'yes' ? 'Obrigado! Você marcou esta página como útil.' : 'Obrigado pelo retorno. Você marcou que esta página não ajudou.'}
            </p>
            <button
              type="button"
              onClick={() => setFb(undefined)}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"
            >
              <Undo2 className="size-3.5" /> Desfazer
            </button>
          </div>
          {fb.vote === 'no' && !fb.comment && !commentSent && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!comment.trim()) return
                setFb({ ...fb, comment: comment.trim() })
                setCommentSent(true)
              }}
            >
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="O que podemos melhorar nesta página?"
                aria-label="Comentário sobre a página"
                className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/10"
              />
              <div className="flex justify-end">
                <button type="submit" disabled={!comment.trim()} className="inline-flex h-8 items-center rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-40">
                  Enviar comentário
                </button>
              </div>
            </form>
          )}
          {fb.comment && <p className="mt-2 text-xs text-zinc-500">Comentário registrado: “{fb.comment}”.</p>}
        </div>
      )}
    </div>
  )
}

/* ---------------------------- Anterior/Próximo ---------------------------- */

export function PrevNext({ prev, next }: { prev?: string; next?: string }) {
  const p = prev ? getArticle(prev) : undefined
  const n = next ? getArticle(next) : undefined
  if (!p && !n) return null
  return (
    <nav aria-label="Navegação entre artigos" className="mt-10 flex items-start justify-between gap-4 border-t border-zinc-200 pt-6 text-sm" data-prev-next>
      {p ? (
        <Link to={`/ajuda/${prev}`} aria-label={`Anterior: ${p.title}`} className="group flex min-w-0 max-w-[48%] flex-col items-start gap-0.5 text-zinc-600 hover:text-zinc-900">
          <span className="flex items-center gap-1 font-medium text-zinc-900">
            <ChevronLeft className="size-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />
            Anterior
          </span>
          <span className="max-w-full truncate pl-5 text-xs text-zinc-500 group-hover:text-zinc-700">{p.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {n && (
        <Link to={`/ajuda/${next}`} aria-label={`Próximo: ${n.title}`} className="group ml-auto flex min-w-0 max-w-[48%] flex-col items-end gap-0.5 text-right text-zinc-600 hover:text-zinc-900">
          <span className="flex items-center gap-1 font-medium text-zinc-900">
            Próximo
            <ChevronRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="max-w-full truncate pr-5 text-xs text-zinc-500 group-hover:text-zinc-700">{n.title}</span>
        </Link>
      )}
    </nav>
  )
}

/* ---------------------------- Barra flutuante ---------------------------- */

export function FloatingAskBar() {
  const askOpen = useHelpUi((s) => s.askOpen)
  const openAsk = useHelpUi((s) => s.openAsk)
  const [q, setQ] = useState('')
  if (askOpen) return null
  return (
    <>
      <div className="pointer-events-none sticky bottom-16 z-30 sm:bottom-5 flex justify-center px-4 pb-1" data-floating-ask>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            openAsk(q)
            setQ('')
          }}
          className="pointer-events-auto flex w-full max-w-[440px] items-center gap-2 rounded-2xl border border-zinc-200 bg-white/95 p-1.5 pl-4 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pergunte qualquer coisa sobre a Kloel…"
            aria-label="Pergunte qualquer coisa sobre a Kloel"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
          />
          <button type="submit" aria-label="Perguntar ao assistente" className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-white transition-colors', q.trim() ? 'bg-brand hover:bg-[#464ac4]' : 'bg-brand/40')}>
            <ArrowUp className="size-4" />
          </button>
        </form>
      </div>
      {/* espaço final do tamanho do recuo da barra: no fim da página ela não cobre o rodapé do artigo */}
      <div aria-hidden className="h-16 sm:h-6" />
    </>
  )
}
