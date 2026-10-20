import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChartColumn, ChevronDown, FileText, Globe, PenLine, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Agent, KnowledgeEntry } from '@/domain/types'
import { cn } from '@/lib/utils'
import { knowledgeCommands } from '@/services/casca/knowledge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { AutoTextarea, FieldError } from './ui'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

function sourceMeta(e: KnowledgeEntry) {
  if (e.source === 'website') return { Icon: Globe, label: e.sourceLabel ?? 'Site' }
  if (e.source === 'auto') return { Icon: Sparkles, label: e.sourceLabel ? `Gerado automaticamente · ${e.sourceLabel}` : 'Gerado automaticamente' }
  if (e.source === 'document') return { Icon: FileText, label: e.sourceLabel ?? 'Documento' }
  return { Icon: PenLine, label: 'Adicionado manualmente' }
}

/** Grade de abertura animada observada: grid-rows-[0fr] → grid-rows-[1fr]. */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('grid transition-[grid-template-rows] duration-200 ease-in-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}

function NewEntryCard({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const [errors, setErrors] = useState<{ q?: string; a?: string }>({})
  const qRef = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)

  async function save(again: boolean) {
    if (pending.current) return
    const e: typeof errors = {}
    if (!q.trim()) e.q = 'A pergunta é obrigatória.'
    if (!a.trim()) e.a = 'A resposta é obrigatória.'
    setErrors(e)
    if (e.q || e.a) return
    pending.current = true; setBusy(true)
    try {
      await knowledgeCommands(agent.id, 'manual-entry').createText(q.trim(), a.trim())
      toast.success('Entrada salva'); setQ(''); setA('')
      if (again) requestAnimationFrame(() => qRef.current?.focus())
      else setOpen(false)
    } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o conteúdo e tente novamente.' }) }
    finally { pending.current = false; setBusy(false) }
  }
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault()
      save(ev.shiftKey)
    }
  }

  return (
    <div className={cn('rounded-xl border bg-white pl-3 pr-4 pt-1.5 transition-[padding] duration-200', open ? 'pb-4' : 'pb-1.5')}>
      <button
        type="button"
        className="flex w-full items-center gap-1"
        aria-expanded={open}
        // [559]: abrir "Nova entrada" não move o foco para "Pergunta" (o campo aparece sem anel de foco na referência)
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex h-8 w-4 shrink-0 items-center justify-center">
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </div>
        <span className={cn('flex h-8 flex-1 items-center pl-1.5 text-left text-sm font-semibold leading-5 transition-colors', open ? 'text-foreground' : 'text-foreground/40')}>Nova entrada</span>
      </button>
      <Collapse open={open}>
        <form className="flex flex-col gap-4 pl-5 pr-2 pt-2" onSubmit={(e) => e.preventDefault()} onKeyDown={onKey}>
          <div className="space-y-1">
            <label htmlFor="kb-new-q" className="text-sm font-medium leading-5 text-foreground">
              Pergunta
            </label>
            <Input
              ref={qRef}
              id="kb-new-q"
              tabIndex={open ? 0 : -1}
              className="h-10"
              placeholder="ex. Qual é o horário de funcionamento?"
              value={q}
              aria-invalid={!!errors.q}
              onChange={(e) => {
                setQ(e.target.value)
                setErrors((x) => ({ ...x, q: undefined }))
              }}
            />
            <FieldError>{errors.q}</FieldError>
          </div>
          <div className="space-y-1">
            <label htmlFor="kb-new-a" className="text-sm font-medium leading-5 text-foreground">
              Resposta
            </label>
            <AutoTextarea
              id="kb-new-a"
              tabIndex={open ? 0 : -1}
              minRows={2}
              className="min-h-[60px] w-full rounded-md border border-input px-3 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
              placeholder="Digite a resposta..."
              value={a}
              aria-invalid={!!errors.a}
              onChange={(e) => {
                setA(e.target.value)
                setErrors((x) => ({ ...x, a: undefined }))
              }}
            />
            <FieldError>{errors.a}</FieldError>
          </div>
          <div className="-mt-1.5 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cancelar"
              tabIndex={open ? 0 : -1}
              className="-ml-2 h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => {
                setQ('')
                setA('')
                setErrors({})
                setOpen(false)
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" tabIndex={open ? 0 : -1} className="h-9 gap-2 px-3 py-2 text-xs font-medium" disabled={busy} onClick={() => void save(true)}>
                Salvar + novo <Kbd>{isMac ? '⌘⇧⏎' : 'Ctrl⇧⏎'}</Kbd>
              </Button>
              <Button type="button" tabIndex={open ? 0 : -1} className="h-9 gap-2 px-3 py-2 text-xs font-medium" disabled={busy} onClick={() => void save(false)}>
                Salvar <Kbd inverted>{isMac ? '⌘⏎' : 'Ctrl⏎'}</Kbd>
              </Button>
            </div>
          </div>
        </form>
      </Collapse>
    </div>
  )
}

function EntryCard({ entry, expanded, onToggle }: { entry: KnowledgeEntry; expanded: boolean; onToggle: () => void }) {
  const [answer, setAnswer] = useState(entry.answer)
  const [question, setQuestion] = useState(entry.question)
  useEffect(() => {
    setAnswer(entry.answer)
    setQuestion(entry.question)
  }, [entry.answer, entry.question, expanded])
  const dirty = answer.trim() !== entry.answer || question.trim() !== entry.question
  const valid = !!answer.trim() && !!question.trim()
  const { Icon, label } = sourceMeta(entry)

  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!dirty || !valid || pending.current) return
    pending.current = true; setBusy(true)
    try { await knowledgeCommands(entry.agentId, entry.id).update(entry.id, question.trim(), answer.trim()); toast.success('Entrada atualizada') }
    catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o conteúdo e tente novamente.' }) }
    finally { pending.current = false; setBusy(false) }
  }
  async function del() {
    if (pending.current) return
    pending.current = true; setBusy(true)
    try { await knowledgeCommands(entry.agentId, entry.id).remove(entry.id); toast.success('Entrada excluída') }
    catch (error) { toast.error('Não foi possível excluir', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
    finally { pending.current = false; setBusy(false) }
  }

  return (
    <div className="rounded-xl border bg-white pb-1.5 pl-3 pr-4 pt-1.5">
      <div className="flex w-full items-start gap-1">
        <button type="button" aria-label={expanded ? 'Recolher' : 'Expandir'} aria-expanded={expanded} onClick={onToggle} className="flex h-8 w-4 shrink-0 items-center justify-center">
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {expanded ? (
            <input
              aria-label="Pergunta"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  save()
                }
              }}
              className="flex h-8 min-w-0 flex-1 items-center rounded-md bg-transparent pl-1.5 text-sm font-semibold leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          ) : (
            <button type="button" onClick={onToggle} className="flex h-8 min-w-0 flex-1 items-center pl-1.5 text-left">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-5">{entry.question}</span>
            </button>
          )}
          <span className={cn('flex shrink-0 items-center gap-2 transition-opacity duration-100', expanded ? 'opacity-0' : 'opacity-100')}>
            {entry.usageCount > 0 && (
              <span title={`Usada ${entry.usageCount} ${entry.usageCount === 1 ? 'vez' : 'vezes'} em conversas`} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                <ChartColumn className="h-3 w-3" />
                {entry.usageCount}×
              </span>
            )}
            <span className="inline-flex shrink-0 items-center text-muted-foreground" title={label}>
              <Icon className="h-3.5 w-3.5" />
            </span>
          </span>
        </div>
      </div>
      <Collapse open={expanded}>
        <div className="flex flex-col gap-4 pb-2.5 pl-5 pr-2 pt-1.5">
          <AutoTextarea
            aria-label="Resposta"
            tabIndex={expanded ? 0 : -1}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                save()
              }
            }}
            className="min-h-0 w-full border-0 bg-transparent p-1.5 text-sm leading-5 text-foreground shadow-none outline-none focus-visible:ring-0"
          />
          {!valid && <FieldError>A pergunta e a resposta não podem ficar vazias.</FieldError>}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex items-center gap-3">
              <Button type="button" variant="ghost" size="icon" aria-label="Excluir" tabIndex={expanded ? 0 : -1} className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => void del()}>
                <Trash2 className="h-4 w-4" />
              </Button>
              <span className="inline-flex max-w-[200px] shrink-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </span>
            </div>
            <Button type="button" tabIndex={expanded ? 0 : -1} disabled={!dirty || !valid || busy} className="h-9 gap-2 px-3 py-2 text-xs font-medium" onClick={save}>
              Salvar <Kbd inverted>{isMac ? '⌘⏎' : 'Ctrl⏎'}</Kbd>
            </Button>
          </div>
        </div>
      </Collapse>
    </div>
  )
}

/**
 * Aba "Informações" (OBSERVADO: fonio-live2/C-assistentes/87–89 + data/knowledge.json): rótulo "ENTRADAS (N)", cartão recolhível
 * "Nova entrada" (Pergunta/Resposta, "Salvar + novo ⌘⇧⏎", "Salvar ⌘⏎") e lista única de entradas (selo de uso "N×" e ícone de origem).
 */
export function KnowledgeEntries({ agent, entries }: { agent: Agent; entries: KnowledgeEntry[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const ordered = useMemo(() => {
    const idx = new Map(entries.map((e, i) => [e.id, i]))
    return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || idx.get(a.id)! - idx.get(b.id)!)
  }, [entries])

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entradas ({entries.length})</h3>
        <NewEntryCard agent={agent} />
        {ordered.map((e) => (
          <EntryCard key={e.id} entry={e} expanded={expanded === e.id} onToggle={() => setExpanded((x) => (x === e.id ? null : e.id))} />
        ))}
      </section>
    </div>
  )
}
