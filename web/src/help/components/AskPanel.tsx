import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, Sparkles, X, RotateCcw, Loader2, XCircle, Mail, Search, FileText, Trash2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SUGGESTED_QUESTIONS, type AssistantAnswer } from '../lib/assistant'
import { useHelpUi, type AskMessage } from '../lib/ui'
import { Inline } from './Inline'
import { useAutoGrow } from '../lib/useAutoGrow'

function CitationChip({ n, answer, onNavigate }: { n: number; answer: AssistantAnswer; onNavigate: () => void }) {
  const c = answer.citations.find((x) => x.n === n)
  if (!c) return null
  return (
    <Link
      to={`/ajuda/${c.key}${c.anchor ? `#${c.anchor}` : ''}`}
      onClick={onNavigate}
      title={c.section ? `${c.title} › ${c.section}` : c.title}
      className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-full bg-brand/10 px-1 align-middle text-[10px] font-semibold text-brand hover:bg-brand/20"
    >
      {n}
    </Link>
  )
}

function AnswerView({ m, onRetry, onCancel, onNavigate }: { m: AskMessage; onRetry: () => void; onCancel: () => void; onNavigate: () => void }) {
  const openSupport = useHelpUi((s) => s.openSupport)
  const openSearch = useHelpUi((s) => s.openSearch)
  if (m.status === 'queued')
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-zinc-500" role="status" data-queued>
        <span className="flex items-center gap-2">
          <Clock className="size-4 text-zinc-400" />
          Na fila: respondo assim que terminar a pergunta anterior.
        </span>
        <button type="button" onClick={onCancel} className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline">
          Cancelar pergunta
        </button>
      </div>
    )
  if (m.status === 'running')
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500" role="status">
        <Loader2 className="size-4 animate-spin text-brand" />
        {m.progressLabel || 'Pesquisando na central de ajuda…'}
      </div>
    )
  if (m.status === 'error')
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/70 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-red-700">
          <XCircle className="size-4 shrink-0" />
          Não foi possível responder agora.
        </p>
        <p className="mt-1 text-red-700/80">{m.error}</p>
        <button type="button" onClick={onRetry} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50">
          <RotateCcw className="size-3.5" /> Tentar novamente
        </button>
      </div>
    )
  const a = m.answer
  if (!a) return null
  if (!a.found)
    return (
      <div className="space-y-3 text-sm leading-6 text-zinc-700">
        <p>Não encontrei uma resposta para isso na central de ajuda da Kloel. Tente reformular a pergunta, buscar um termo específico ou falar com o time.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openSupport(m.text)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium hover:bg-zinc-50">
            <Mail className="size-3.5" /> Mandar e-mail ao time
          </button>
          <button type="button" onClick={openSearch} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium hover:bg-zinc-50">
            <Search className="size-3.5" /> Buscar na central
          </button>
        </div>
      </div>
    )
  const cite = (n: number) => <CitationChip n={n} answer={a} onNavigate={onNavigate} />
  return (
    <div className="space-y-3 text-sm leading-6 text-zinc-700">
      <p>
        <Inline text={a.intro} />
      </p>
      <ul className="list-disc space-y-1.5 pl-5 marker:text-zinc-300">
        {a.points.map((p, i) => (
          <li key={i}>
            <Inline text={p} onCite={cite} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-500">Fontes</p>
        <div className="space-y-1.5">
          {a.citations.map((c) => (
            <Link
              key={c.n}
              to={`/ajuda/${c.key}${c.anchor ? `#${c.anchor}` : ''}`}
              onClick={onNavigate}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs transition-colors hover:border-brand/40 hover:bg-zinc-50"
            >
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand">{c.n}</span>
              <FileText className="size-3.5 shrink-0 text-zinc-400" />
              <span className="truncate font-medium text-zinc-800">{c.title}</span>
              {c.section && <span className="truncate text-zinc-500">› {c.section}</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AskPanel() {
  const open = useHelpUi((s) => s.askOpen)
  const setOpen = useHelpUi((s) => s.setAskOpen)
  const messages = useHelpUi((s) => s.messages)
  const setMessages = useHelpUi((s) => s.setMessages)
  const ask = useHelpUi((s) => s.ask)
  const retryAnswer = useHelpUi((s) => s.retryAnswer)
  const cancelQueued = useHelpUi((s) => s.cancelQueued)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(inputRef, draft)
  const running = messages.some((m) => m.status === 'running' || m.status === 'queued')

  // perguntas feitas durante uma resposta entram na fila (nunca são descartadas)
  const send = useCallback(
    (text: string) => {
      if (!text.trim()) return
      ask(text)
      setDraft('')
    },
    [ask],
  )

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  // mantém a última pergunta visível no topo enquanto a resposta aparece
  const lastStatus = messages[messages.length - 1]?.status
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const users = el.querySelectorAll<HTMLElement>('[data-role="user"]')
    const last = users[users.length - 1]
    if (last) el.scrollTop = Math.max(0, last.offsetTop - 16)
    else el.scrollTop = el.scrollHeight
  }, [messages.length, lastStatus, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // Radix (diálogos/menus por cima) trata o Esc antes e chama preventDefault: só fecha o painel se nada mais o consumiu
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  const closeOnMobile = () => {
    if (window.innerWidth < 1024) setOpen(false)
  }

  return (
    <aside
      aria-label="Assistente da central de ajuda"
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-zinc-200 bg-white shadow-2xl lg:top-[113px] lg:z-30 lg:shadow-[0_0_24px_rgba(0,0,0,0.06)] transition-[transform,visibility] duration-300 ease-out sm:w-[420px]',
        open ? 'visible translate-x-0' : 'pointer-events-none invisible translate-x-full',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-100 px-4">
        <Sparkles className="size-4 text-brand" />
        <h2 className="text-[15px] font-semibold text-zinc-900">Assistente</h2>
        <div className="flex-1" />
        {messages.length > 0 && (
          <button type="button" aria-label="Limpar conversa" title="Limpar conversa" disabled={running} onClick={() => setMessages(() => [])} className="flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40">
            <Trash2 className="size-4" />
          </button>
        )}
        <button type="button" aria-label="Fechar assistente" onClick={() => setOpen(false)} className="flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
          <X className="size-4" />
        </button>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end">
            <div className="mb-auto mt-8 text-center">
              <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <Sparkles className="size-5" />
              </span>
              <p className="mt-3 text-[15px] font-semibold text-zinc-900">Pergunte qualquer coisa sobre a Kloel</p>
              <p className="mx-auto mt-1 max-w-[300px] text-sm text-zinc-500">As respostas vêm da central de ajuda da Kloel, com links para os artigos usados.</p>
            </div>
            <p className="mb-2 text-xs font-medium text-zinc-500">Sugestões</p>
            <div className="space-y-1.5">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button key={q} type="button" onClick={() => send(q)} className="block w-full rounded-xl border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:border-brand/40 hover:bg-zinc-50">
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} data-role="user" className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-100 px-3.5 py-2 text-sm text-zinc-900">
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                    <Sparkles className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <AnswerView m={m} onRetry={() => retryAnswer(m.id)} onCancel={() => cancelQueued(m.id)} onNavigate={closeOnMobile} />
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>
      <form
        className="shrink-0 border-t border-zinc-100 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 pl-3 focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/10">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(draft)
              }
            }}
            placeholder="Pergunte qualquer coisa sobre a Kloel…"
            aria-label="Pergunta para o assistente"
            className="max-h-32 min-h-[32px] flex-1 resize-none bg-transparent py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
          />
          <button
            type="submit"
            aria-label="Enviar pergunta"
            disabled={!draft.trim()}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-colors hover:bg-[#464ac4] disabled:bg-brand/40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 pl-1 pr-10 text-[11px] leading-4 text-zinc-400 sm:pr-[150px]">
          {running ? 'Pode enviar outra pergunta: ela entra na fila e é respondida em seguida.' : 'Respostas montadas a partir dos artigos desta central.'}
        </p>
      </form>
    </aside>
  )
}
