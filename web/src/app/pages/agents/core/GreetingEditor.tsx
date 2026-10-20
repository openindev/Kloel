import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CONTACT_OPTIONAL_NOTE, splitVariables, variableLabel, type VariableDef } from './variables'
import { useGreetingMenuVariables, useGreetingVariableDefs } from './greetingVariables'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function chipHtml(key: string, vars: VariableDef[]) {
  return `<span contenteditable="false" data-var="${esc(key)}" class="var-chip rounded-full text-sm font-normal">${esc(variableLabel(key, vars))}</span>`
}

function toHtml(text: string, vars: VariableDef[]) {
  return splitVariables(text)
    .map((p) => (p.type === 'text' ? esc(p.value) : chipHtml(p.key, vars)))
    .join('')
}

function fromDom(el: Node): string {
  let out = ''
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? ''
    else if (node instanceof HTMLElement) {
      if (node.dataset.var) out += `{{${node.dataset.var}}}`
      else if (node.tagName === 'BR') out += ' '
      else out += (node.tagName === 'DIV' || node.tagName === 'P' ? ' ' : '') + fromDom(node)
    }
  })
  return out.replace(/ /g, ' ')
}

/** Item do menu de variáveis: "?" = pode estar vazio; ⓘ = descrição. */
function VarItem({ v, onPick, indent }: { v: VariableDef; onPick: (key: string) => void; indent?: boolean }) {
  return (
    <CommandItem value={v.label} onSelect={() => onPick(v.key)} className={cn('justify-between py-2', indent && 'pl-[22px]')}>
      <span className="truncate">{v.label}</span>
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        {v.optional && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] font-semibold">?</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px]">{CONTACT_OPTIONAL_NOTE}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="!size-4" />
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px]">{v.description}</TooltipContent>
        </Tooltip>
      </span>
    </CommandItem>
  )
}

/**
 * Menu "Adicionar variável" (OBSERVADO: fonio-live2/C-assistentes/15–17 + data/initial-message.json): busca "Buscar variáveis...",
 * Assistente: Nome, Empresa: Nome e o grupo "Contato" recolhido (5 campos com "?" e ⓘ), rodapé "{{variableName}}".
 * O grupo Contato inclui os campos inteligentes configurados em Contatos ("Contato: <campo>", {{contact.smart.<id>}}).
 */
export function VariableMenu({ onPick, align = 'end' }: { onPick: (key: string) => void; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [contactOpen, setContactOpen] = useState(false)
  const { vars } = useGreetingMenuVariables()
  const top = vars.filter((v) => !v.group)
  const contact = vars.filter((v) => v.group === 'Contato')
  const pick = (k: string) => {
    setOpen(false)
    setSearch('')
    onPick(k)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onMouseDown={(e) => e.preventDefault()} className="-mr-3 inline-flex items-center gap-1.5 rounded-md px-4 py-2.5 text-sm font-medium text-foreground hover:text-foreground/80">
          Adicionar variável
          <ChevronDown className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        data-greeting-popover=""
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(640px,calc(100vw-2rem))] flex-col p-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandInput placeholder="Buscar variáveis..." value={search} onValueChange={setSearch} />
          <CommandList className="max-h-[300px]">
            <CommandEmpty>Nenhuma variável encontrada.</CommandEmpty>
            <CommandGroup>
              {top.map((v) => (
                <VarItem key={v.key} v={v} onPick={pick} />
              ))}
            </CommandGroup>
            {!search && contact.length > 0 && (
              <button
                type="button"
                onClick={() => setContactOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                aria-expanded={contactOpen}
              >
                <ChevronRight className={cn('size-3 transition-transform', contactOpen && 'rotate-90')} />
                Contato
              </button>
            )}
            {(contactOpen || !!search) && contact.length > 0 && (
              <CommandGroup>
                {contact.map((v) => (
                  <VarItem key={v.key} v={v} onPick={pick} indent={!search} />
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">
            Não encontrou sua variável? Esta lista não é completa; outras variáveis ainda podem funcionar, por ex.{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground/80">{'{{variableName}}'}</code>
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Editor rico em linha (contentEditable) da mensagem inicial: texto + chips de variáveis. Valor serializado como texto com {{chave}}.
 * Classes da referência (Lexical "fonio-lexical-editor"): contêiner `relative rounded-md border border-input bg-background text-sm
 * focus-within:outline outline-1`, área `outline-none px-3 py-2 overflow-auto`. Na aba Geral abre SEM foco (sem anel nem cursor).
 */
export function GreetingEditor({
  value,
  onChange,
  autoFocus,
  placeholder = 'Digite a mensagem…',
  invalid,
  ariaLabel = 'Mensagem inicial',
  className,
  contentClassName,
}: {
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  placeholder?: string
  invalid?: boolean
  ariaLabel?: string
  className?: string
  contentClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const vars = useGreetingVariableDefs()
  const varsRef = useRef(vars)
  varsRef.current = vars
  const lastEmitted = useRef<string | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [empty, setEmpty] = useState(!value)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (value !== lastEmitted.current) {
      el.innerHTML = toHtml(value, varsRef.current)
      lastEmitted.current = value
      setEmpty(!value)
    }
  }, [value])

  useEffect(() => {
    if (!autoFocus || !ref.current) return
    const el = ref.current
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
  }, [autoFocus])

  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection()
      if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange()
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const emit = () => {
    const el = ref.current
    if (!el) return
    const v = fromDom(el)
    lastEmitted.current = v
    setEmpty(!v)
    onChange(v)
  }

  const insertVariable = (key: string) => {
    const el = ref.current
    if (!el) return
    el.focus()
    let range = savedRange.current && el.contains(savedRange.current.startContainer) ? savedRange.current : null
    if (!range) {
      range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
    }
    range.deleteContents()
    const holder = document.createElement('span')
    holder.innerHTML = chipHtml(key, varsRef.current)
    const chip = holder.firstChild!
    const space = document.createTextNode(' ')
    range.insertNode(space)
    range.insertNode(chip)
    const after = document.createRange()
    after.setStartAfter(space)
    after.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(after)
    savedRange.current = after.cloneRange()
    emit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') e.preventDefault()
  }
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ')
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const r = sel.getRangeAt(0)
    r.deleteContents()
    const node = document.createTextNode(text)
    r.insertNode(node)
    r.setStartAfter(node)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
    emit()
  }

  return (
    <div data-greeting-editor="" className={cn('kloel-lexical-editor relative rounded-md border border-input bg-background text-sm outline-1 focus-within:outline', invalid && 'border-destructive', className)}>
      <div className="flex h-[50px] items-center justify-end border-b px-4">
        <VariableMenu onPick={insertVariable} />
      </div>
      <div className="relative">
        {empty && <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">{placeholder}</span>}
        <div
          ref={ref}
          role="textbox"
          aria-label={ariaLabel}
          aria-multiline="false"
          aria-invalid={invalid || undefined}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className={cn('min-h-[72px] overflow-auto whitespace-pre-wrap break-words px-3 py-2 outline-none', contentClassName)}
        />
      </div>
    </div>
  )
}
