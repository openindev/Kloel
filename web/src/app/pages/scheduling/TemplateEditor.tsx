import { useEffect, useRef } from 'react'
import { Bold, ChevronDown, Info, Italic, Underline } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TEMPLATE_VARIABLES, VARIABLE_BY_KEY, chip, escapeHtml } from './model'

/**
 * Editor de modelos de notificação do Agendador (AP-05): barra "Normal ⌄ · B · I · U" + "Adicionar variável ⌄"
 * com o catálogo "Agendamento: …" / "Convidado: …" / "Empresa: …" (opcionais marcados com "?" e ⓘ explicativo).
 * Guarda HTML simples com chips `<span data-var>`; nada além de div/p/br/b/i/u/h2/h3 sobrevive à limpeza.
 */

const BLOCK = new Set(['DIV', 'P', 'H2', 'H3'])
const INLINE: Record<string, string> = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u' }

export function sanitizeTemplate(html: string, singleLine = false): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml((node.textContent ?? '').replace(/ /g, ' ').replace(/\u200b/g, ''))
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    const key = el.getAttribute('data-var')
    if (key) return VARIABLE_BY_KEY[key] ? chip(key) : ''
    const inner = Array.from(el.childNodes).map(walk).join('')
    if (el.tagName === 'BR') return singleLine ? ' ' : '<br>'
    if (singleLine) return BLOCK.has(el.tagName) ? `${inner} ` : inner
    if (INLINE[el.tagName]) return inner ? `<${INLINE[el.tagName]}>${inner}</${INLINE[el.tagName]}>` : ''
    if (BLOCK.has(el.tagName)) {
      const tag = el.tagName === 'P' ? 'div' : el.tagName.toLowerCase()
      return `<${tag}>${inner || '<br>'}</${tag}>`
    }
    return inner
  }
  const out = Array.from(doc.body.firstElementChild!.childNodes).map(walk).join('')
  return singleLine ? out.replace(/\s+/g, ' ').trim() : out
}

/** Prévia (cartão "Notificações padrão"): mesmo HTML, chips com o rótulo da variável. */
export function TemplatePreview({ html, className, inline }: { html: string; className?: string; inline?: boolean }) {
  const Tag = inline ? 'span' : 'div'
  return <Tag className={cn('[&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold', className)} dangerouslySetInnerHTML={{ __html: sanitizeTemplate(html, inline) }} />
}

/** No DOM do editor cada chip fica entre espaços de largura zero: o Chrome não posiciona o cursor ao lado de um
 * elemento não editável na borda do campo (ex.: Home antes do 1º chip). `sanitizeTemplate` remove esses caracteres. */
const forEditing = (html: string) => html.replace(/(<span data-var="[^"]+"[^>]*>[^<]*<\/span>)/g, '\u200b$1\u200b')

const isEmpty = (html: string) => !html.replace(/<br>|<div>|<\/div>/g, '').trim()

export function TemplateEditor({
  value,
  onChange,
  ariaLabel,
  singleLine,
  minHeight = 140,
  invalid,
}: {
  value: string
  onChange: (html: string) => void
  ariaLabel: string
  singleLine?: boolean
  minHeight?: number
  invalid?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const range = useRef<Range | null>(null)

  // controlado: só reescreve o DOM quando o valor externo difere do conteúdo atual (não perde o cursor ao digitar)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (sanitizeTemplate(el.innerHTML, singleLine) !== sanitizeTemplate(value, singleLine)) el.innerHTML = forEditing(sanitizeTemplate(value, singleLine))
  }, [value, singleLine])

  const emit = () => {
    const el = ref.current
    if (el) onChange(sanitizeTemplate(el.innerHTML, singleLine))
  }
  const remember = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange()
  }
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus()
    if (range.current) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range.current)
    }
    document.execCommand(cmd, false, arg)
    emit()
  }
  const insertVar = (key: string) => {
    const el = ref.current
    if (!el) return
    const tpl = document.createElement('template')
    tpl.innerHTML = chip(key)
    const node = tpl.content.firstChild!
    const space = document.createTextNode(' ')
    const r = range.current && el.contains(range.current.startContainer) ? range.current : null
    if (r) {
      r.deleteContents()
      r.insertNode(space)
      r.insertNode(node)
    } else {
      const last = el.lastElementChild && !singleLine && /^(DIV|H2|H3)$/.test(el.lastElementChild.tagName) ? el.lastElementChild : el
      if (last.lastChild && (last.lastChild as HTMLElement).tagName === 'BR') last.removeChild(last.lastChild)
      last.appendChild(node)
      last.appendChild(space)
    }
    // cursor depois do chip
    const sel = window.getSelection()
    const after = document.createRange()
    after.setStartAfter(space)
    after.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(after)
    range.current = after.cloneRange()
    emit()
  }

  const variableMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-semibold hover:bg-accent data-[state=open]:bg-accent" onMouseDown={remember}>
          Adicionar variável <ChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-[19rem] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        {TEMPLATE_VARIABLES.map((v) => (
          <DropdownMenuItem key={v.key} onSelect={() => insertVar(v.key)} className="gap-2 py-2">
            <span className="min-w-0 flex-1">{v.label}</span>
            {v.optional && (
              <span className="text-xs font-semibold text-muted-foreground" aria-label="opcional">
                ?
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground" aria-label={`Sobre ${v.label}`}>
                  <Info className="size-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-60">
                {v.description}
                {v.optional ? ' Pode ficar vazia.' : ''}
              </TooltipContent>
            </Tooltip>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className={cn('rounded-xl border bg-background', invalid && 'border-destructive')}>
      {!singleLine ? (
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Estilo do parágrafo" className="inline-flex h-7 items-center gap-0.5 rounded-md px-2 text-sm hover:bg-accent data-[state=open]:bg-accent" onMouseDown={remember}>
                Normal <ChevronDown className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuItem onSelect={() => exec('formatBlock', 'div')}>Normal</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exec('formatBlock', 'h2')} className="text-base font-semibold">
                Título
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exec('formatBlock', 'h3')} className="font-semibold">
                Subtítulo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {([
            ['bold', Bold, 'Negrito'],
            ['italic', Italic, 'Itálico'],
            ['underline', Underline, 'Sublinhado'],
          ] as const).map(([cmd, Icon, label]) => (
            <button key={cmd} type="button" aria-label={label} className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent" onMouseDown={(e) => (e.preventDefault(), remember())} onClick={() => exec(cmd)}>
              <Icon className="size-4" />
            </button>
          ))}
          <div className="ml-auto">{variableMenu}</div>
        </div>
      ) : null}
      <div className={cn('relative', singleLine && 'flex items-center gap-2 pr-2')}>
        <div
          ref={ref}
          role="textbox"
          aria-multiline={!singleLine}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          data-empty={isEmpty(value) || undefined}
          className={cn(
            'min-w-0 flex-1 px-4 py-3 text-sm leading-7 outline-none [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold',
            singleLine && 'whitespace-nowrap overflow-x-auto py-2 leading-6 no-scrollbar',
          )}
          style={singleLine ? undefined : { minHeight }}
          onInput={emit}
          onBlur={() => {
            remember()
            emit()
          }}
          onKeyUp={remember}
          onMouseUp={remember}
          onKeyDown={(e) => {
            if (singleLine && e.key === 'Enter') e.preventDefault()
          }}
          onPaste={(e) => {
            // cola só texto (sem estilos externos)
            e.preventDefault()
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          }}
        />
        {singleLine && variableMenu}
      </div>
    </div>
  )
}
