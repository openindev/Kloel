import { useEffect, useId, useRef, useState } from 'react'
import { Bold, ChevronDown, Italic, Underline } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { VariablePicker, type VariableContext } from './VariablePicker'
import { VARIABLE_BY_KEY } from './variables'

/**
 * Classe do chip de variável = nó "mention" do editor da Fonio ao vivo (pílula rounded-full, peso 500, brand sobre brand/10;
 * docs/evidence/live-compare/C-assistentes/13-email-corpo-fonio.png e fonio-live2 data/initial-message.json › insertedToken).
 */
export const VAR_CHIP_CLASS = 'mention mx-0.5 inline-flex items-center rounded-full px-1.5 py-0 align-baseline font-medium bg-brand/10 text-brand'

export function chipHtml(key: string, labelOverride?: string) {
  const label = VARIABLE_BY_KEY[key]?.label ?? labelOverride ?? key
  return `<span data-var="${key}" contenteditable="false" class="${VAR_CHIP_CLASS}">${escapeHtml(label)}</span>`
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Corpo padrão do e-mail (ref. 514). */
export const DEFAULT_EMAIL_BODY = [
  '<div>Olá,</div>',
  '<div>Uma nova conversa acaba de acontecer. Veja os detalhes:</div>',
  `<div><b>De:</b> ${chipHtml('caller.phoneNumber')}</div>`,
  // Fonio ao vivo (live-compare 13-email-corpo-fonio.png): quebra de linha depois de "Resumo:" — o chip fica na linha de baixo,
  // como em "Transcrição:"
  `<div><b>Resumo:</b><br>${chipHtml('conversation.summary')}</div>`,
  '<div><b>Transcrição:</b></div>',
  `<div>${chipHtml('conversation.transcript')}</div>`,
  `<div>Abra a conversa completa: ${chipHtml('conversation.link')}</div>`,
].join('')

const ALLOWED = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'SPAN', 'UL', 'OL', 'LI'])

/**
 * Sanitiza o HTML do editor: mantém apenas a formatação suportada e os chips de variável.
 * `mode="preview"` troca cada chip pelo valor de exemplo.
 */
export function sanitizeHtml(html: string, mode: 'edit' | 'preview' = 'edit', samples: Record<string, string> = {}) {
  if (typeof DOMParser === 'undefined') return ''
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild!
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    const key = el.getAttribute('data-var')
    if (key) {
      if (mode === 'preview') return escapeHtml(samples[key] ?? VARIABLE_BY_KEY[key]?.sample ?? `[${key}]`)
      // campos inteligentes não estão no catálogo fixo: preserva o rótulo do chip
      return chipHtml(key, el.textContent?.trim() || undefined)
    }
    const inner = Array.from(el.childNodes).map(walk).join('')
    if (!ALLOWED.has(el.tagName)) return inner
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') return '<br>'
    if (tag === 'span') return inner
    return `<${tag}>${inner}</${tag}>`
  }
  return Array.from(root.childNodes).map(walk).join('')
}

/** Texto puro (para validar "mensagem vazia"). */
export function htmlHasContent(html: string) {
  if (/data-var=/.test(html)) return true
  const div = typeof document !== 'undefined' ? document.createElement('div') : null
  if (!div) return !!html.trim()
  div.innerHTML = html
  return !!div.textContent?.trim()
}

/** Seletor de bloco do editor de e-mail (fonio-live2 data/resources.json › Enviar e-mail › Mensagem). */
const BLOCKS = [
  { value: 'div', label: 'Normal' },
  { value: 'ul', label: 'Lista com marcadores' },
  { value: 'ol', label: 'Lista numerada' },
  { value: 'h2', label: 'Título grande' },
  { value: 'h3', label: 'Título pequeno' },
]

/**
 * Editor rich text do e-mail (ref. 514): barra "Normal ⌄", B, I, U e "Adicionar variável ⌄";
 * variáveis entram como chips não editáveis.
 */
export function RichTextEditor({
  value,
  onChange,
  invalid,
  ariaLabel,
  unavailable,
  variableContext,
}: {
  value: string
  onChange: (html: string) => void
  invalid?: boolean
  ariaLabel: string
  /** chaves indisponíveis neste momento (ref. EM-03: "Antes da conversa" → chips vermelhos riscados) */
  unavailable?: string[]
  variableContext?: VariableContext
}) {
  const scopeId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [block, setBlock] = useState('div')

  // Sincroniza valor externo sem perder o cursor durante a digitação.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.innerHTML !== value) el.innerHTML = value
  }, [value])

  const emit = () => {
    const el = ref.current
    if (el) onChange(el.innerHTML)
  }
  const saveSelection = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange()
  }
  const restoreSelection = () => {
    const el = ref.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    if (savedRange.current) sel.addRange(savedRange.current)
    else {
      const r = document.createRange()
      r.selectNodeContents(el)
      r.collapse(false)
      sel.addRange(r)
    }
  }
  const exec = (cmd: string, arg?: string) => {
    restoreSelection()
    document.execCommand(cmd, false, arg)
    saveSelection()
    emit()
  }
  const insertVariable = (key: string, label?: string) => {
    restoreSelection()
    const sel = window.getSelection()
    // cursor caído dentro de um chip (clique no fim de uma linha que termina em variável): insere logo depois do chip
    const inChip = sel?.anchorNode ? (sel.anchorNode.nodeType === Node.ELEMENT_NODE ? (sel.anchorNode as Element) : sel.anchorNode.parentElement)?.closest('[data-var]') : null
    if (sel && inChip && ref.current?.contains(inChip)) {
      const after = document.createRange()
      after.setStartAfter(inChip)
      after.collapse(true)
      sel.removeAllRanges()
      sel.addRange(after)
    }
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null
    const prev = r && r.startContainer.nodeType === Node.TEXT_NODE ? (r.startContainer.textContent ?? '').slice(0, r.startOffset) : ''
    const needsSpace = !!r && (r.startContainer.nodeType !== Node.TEXT_NODE ? r.startOffset > 0 : prev.length > 0 && !/\s$/.test(prev))
    document.execCommand('insertHTML', false, `${needsSpace ? '&nbsp;' : ''}${chipHtml(key, label)}&nbsp;`)
    saveSelection()
    emit()
  }

  const toolBtn = 'inline-flex size-8 items-center justify-center rounded-md text-foreground hover:bg-accent'
  // ref. EM-03: chip de variável indisponível = fundo vermelho claro, texto vermelho e riscado (CSS escopado, sem mexer no HTML editado)
  const offCss = unavailable?.length
    ? `${unavailable.map((k) => `[data-kv-editor="${scopeId}"] [data-var="${k}"]`).join(',')}{background:rgb(254 226 226);color:rgb(185 28 28);text-decoration:line-through}`
    : ''
  return (
    <div data-kv-editor={scopeId} className={cn('overflow-hidden rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring', invalid && 'border-destructive focus-within:ring-destructive')}>
      {offCss && <style>{offCss}</style>}
      {/* Fonio ao vivo (live-compare 13 e "Ordem Funil" 4/2/3 a 2x): barra com 49px internos + borda (50px) */}
      <div className="flex min-h-[50px] items-center gap-1 border-b px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" onMouseDown={saveSelection} className="inline-flex h-8 items-center gap-0.5 rounded-md px-2 text-sm hover:bg-accent">
              {BLOCKS.find((b) => b.value === block)?.label} <ChevronDown className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
            {BLOCKS.map((b) => (
              <DropdownMenuItem
                key={b.value}
                onSelect={() => {
                  setBlock(b.value)
                  if (b.value === 'ul') exec('insertUnorderedList')
                  else if (b.value === 'ol') exec('insertOrderedList')
                  else exec('formatBlock', b.value)
                }}
              >
                {b.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" aria-label="Negrito" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
          <Bold className="size-4" />
        </button>
        <button type="button" aria-label="Itálico" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
          <Italic className="size-4" />
        </button>
        <button type="button" aria-label="Sublinhado" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>
          <Underline className="size-4" />
        </button>
        <span className="ml-auto whitespace-nowrap" onMouseDown={saveSelection}>
          <VariablePicker context={variableContext} onPick={(v) => insertVariable(v.key, v.label)} triggerClassName="gap-2 px-3" />
        </span>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={() => {
          saveSelection()
          emit()
        }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onPaste={(e) => {
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, text)
        }}
        // corpo py-2: as 8 linhas do modelo padrão medem 176px na Fonio ao vivo (live-compare 13: borda da barra 275 → borda inferior 452)
        className="min-h-[176px] px-3 py-2 text-sm leading-5 outline-none [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  )
}
