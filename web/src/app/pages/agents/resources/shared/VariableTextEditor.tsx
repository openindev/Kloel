import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { resolveVariable, variableLabel } from './variables'
import { useVariableScope } from './variableScope'

/**
 * Campo de texto com variáveis em CHIPS (Central de ajuda SM-05: "kunde_name" como chip lilás dentro da mensagem do SMS;
 * EM-02/EM-06: chips roxos de variável no texto). O valor continua sendo texto puro com `{{chave}}` — só a exibição muda:
 * cada `{{…}}` vira um chip não editável (contenteditable=false) com o rótulo da variável (catálogo, campo inteligente ou o
 * próprio nome nas variáveis personalizadas). Digitar `{{nome}}` converte o token em chip ao fechar as chaves.
 *
 * Desfazer/refazer: todas as edições passam por `document.execCommand` (digitação nativa, insertHTML, insertLineBreak,
 * insertText), então ⌘Z/⌘⇧Z do navegador continuam funcionando. Contadores usam o valor serializado (com `{{chave}}`).
 */
export interface VariableTextEditorHandle {
  /** Insere `{{key}}` como chip na posição do cursor (ou no fim) — usado pelo menu "{ }". */
  insertVariable: (key: string) => void
  focus: () => void
}

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g
const ZWSP = '​'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Mesmo nó "mention" da Fonio usado no corpo do e-mail (pílula rounded-full, font-medium). */
export const VAR_TEXT_CHIP_CLASS = 'mention mx-0.5 inline-flex items-center rounded-full px-1.5 py-0 align-baseline font-medium bg-brand/10 text-brand'

function chipHtml(raw: string, label: string) {
  return `<span data-var="${esc(raw)}" data-key="${esc(resolveVariable(raw))}" contenteditable="false" class="${VAR_TEXT_CHIP_CLASS}">${esc(label)}</span>`
}

/** Texto com {{…}} → HTML do editor (quebras de linha = <br>; linha final vazia precisa de um <br> extra para aparecer). */
function toHtml(text: string, label: (raw: string) => string, multiline: boolean) {
  let html = ''
  let last = 0
  for (const m of text.matchAll(TOKEN_RE)) {
    html += textHtml(text.slice(last, m.index), multiline)
    html += chipHtml(m[1]!.trim(), label(m[1]!.trim()))
    last = m.index! + m[0].length
  }
  html += textHtml(text.slice(last), multiline)
  if (multiline && text.endsWith('\n')) html += '<br>'
  // cursor depois de um chip no fim da linha (o Chrome não posiciona o cursor depois de contenteditable=false sem um nó de texto)
  return html.replace(/(<\/span>)(?=<br>|$)/g, `$1${ZWSP}`)
}

function textHtml(t: string, multiline: boolean) {
  const e = esc(t)
  return multiline ? e.replace(/\n/g, '<br>') : e.replace(/\n/g, ' ')
}

/** DOM do editor → texto com {{…}}. */
function fromDom(root: HTMLElement, multiline: boolean) {
  let out = ''
  const walk = (node: Node, top: boolean) => {
    node.childNodes.forEach((child, i) => {
      if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? ''
      else if (child instanceof HTMLElement) {
        if (child.dataset.var) out += `{{${child.dataset.var}}}`
        else if (child.tagName === 'BR') {
          // <br> final de um bloco só sustenta a linha vazia (não é uma quebra a mais)
          const isLast = i === node.childNodes.length - 1
          if (!(top && isLast)) out += multiline ? '\n' : ' '
        } else if (child.tagName === 'DIV' || child.tagName === 'P') {
          if (out && !out.endsWith('\n')) out += multiline ? '\n' : ' '
          walk(child, false)
        } else walk(child, false)
      }
    })
  }
  walk(root, true)
  return out.replace(/ /g, ' ').replace(/​/g, '')
}

export const VariableTextEditor = forwardRef<
  VariableTextEditorHandle,
  {
    value: string
    onChange: (v: string) => void
    multiline?: boolean
    placeholder?: string
    ariaLabel: string
    id?: string
    invalid?: boolean
    /** chaves indisponíveis (EM-03: chip vermelho riscado) */
    unavailable?: string[]
    className?: string
    contentClassName?: string
    /** controles sobrepostos no canto (ex.: botão "{ }") */
    adornment?: ReactNode
  }
>(function VariableTextEditor({ value, onChange, multiline = true, placeholder, ariaLabel, id, invalid, unavailable, className, contentClassName, adornment }, ref) {
  const scopeId = useId()
  const el = useRef<HTMLDivElement>(null)
  const scope = useVariableScope()
  const labelOf = (raw: string) => variableLabel(resolveVariable(raw), scope)
  const labelRef = useRef(labelOf)
  labelRef.current = labelOf
  const lastEmitted = useRef<string | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [empty, setEmpty] = useState(!value)

  // valor externo (abrir, inserir pelo menu, restaurar) → DOM; o que o próprio editor emitiu não re-renderiza (mantém o cursor)
  useLayoutEffect(() => {
    const node = el.current
    if (!node || value === lastEmitted.current) return
    node.innerHTML = toHtml(value, labelRef.current, multiline)
    lastEmitted.current = value
    setEmpty(!value)
  }, [value, multiline])

  // rótulos dos campos inteligentes podem mudar (Conectar contatos) — atualiza o texto dos chips sem mexer no valor
  useEffect(() => {
    el.current?.querySelectorAll<HTMLElement>('[data-var]').forEach((c) => {
      const label = labelOf(c.dataset.var!)
      if (c.textContent !== label) c.textContent = label
    })
  })

  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection()
      if (sel && sel.rangeCount && el.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange()
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const emit = () => {
    const node = el.current
    if (!node) return
    const v = fromDom(node, multiline)
    lastEmitted.current = v
    setEmpty(!v && !node.querySelector('[data-var]'))
    if (v !== value) onChange(v)
  }

  const placeCaret = () => {
    const node = el.current
    if (!node) return
    node.focus()
    const sel = window.getSelection()
    if (!sel) return
    const r = savedRange.current && node.contains(savedRange.current.startContainer) ? savedRange.current : null
    sel.removeAllRanges()
    if (r) sel.addRange(r)
    else {
      const end = document.createRange()
      end.selectNodeContents(node)
      end.collapse(false)
      sel.addRange(end)
    }
  }

  const insertHtml = (html: string) => {
    document.execCommand('insertHTML', false, html)
    // guarda já o cursor depois do que foi inserido (o selectionchange chega depois; um focus() imediato voltaria para antes)
    const sel = window.getSelection()
    if (sel && sel.rangeCount && el.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange()
    emit()
  }

  useImperativeHandle(ref, () => ({
    insertVariable: (key: string) => {
      placeCaret()
      const sel = window.getSelection()
      const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null
      // texto (serializado) antes do cursor: separa a nova variável de uma palavra ou de outro chip com um espaço
      let before = ''
      if (r && el.current) {
        const head = document.createRange()
        head.selectNodeContents(el.current)
        head.setEnd(r.startContainer, r.startOffset)
        const box = document.createElement('div')
        box.appendChild(head.cloneContents())
        before = fromDom(box, multiline)
      }
      const needsSpace = !!before && !/\s$/.test(before)
      insertHtml(`${needsSpace ? ' ' : ''}${chipHtml(key, labelRef.current(key))}&nbsp;`)
    },
    focus: () => placeCaret(),
  }))

  // "{{nome}}" digitado: ao fechar as chaves o token vira chip (SM-05), como uma única operação desfazível
  const onInput = (e: FormEvent<HTMLDivElement>) => {
    const native = e.nativeEvent as InputEvent
    const sel = window.getSelection()
    if (native.inputType === 'insertText' && native.data?.includes('}') && sel && sel.rangeCount) {
      const r = sel.getRangeAt(0)
      const node = r.startContainer
      if (node.nodeType === Node.TEXT_NODE) {
        const upto = (node.textContent ?? '').slice(0, r.startOffset)
        const m = upto.match(/\{\{\s*([^{}]+?)\s*\}\}$/)
        if (m) {
          const range = document.createRange()
          range.setStart(node, r.startOffset - m[0].length)
          range.setEnd(node, r.startOffset)
          sel.removeAllRanges()
          sel.addRange(range)
          insertHtml(`${chipHtml(m[1]!.trim(), labelRef.current(m[1]!.trim()))}${ZWSP}`)
          return
        }
      }
    }
    emit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (multiline) {
      document.execCommand('insertLineBreak')
      emit()
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const html = toHtml(multiline ? text.replace(/\r\n?/g, '\n') : text.replace(/\s*\n\s*/g, ' '), labelRef.current, multiline)
    // sem variáveis/quebras: insertText (mais leve e igualmente desfazível)
    if (!/[<&]/.test(html.replace(/&amp;|&lt;|&gt;|&quot;/g, ''))) document.execCommand('insertText', false, multiline ? text : text.replace(/\s*\n\s*/g, ' '))
    else document.execCommand('insertHTML', false, html)
    emit()
  }

  const offCss = unavailable?.length
    ? `${unavailable.map((k) => `[data-kv-text="${scopeId}"] [data-key="${CSS.escape(k)}"]`).join(',')}{background:rgb(254 226 226);color:rgb(185 28 28);text-decoration:line-through}`
    : ''

  return (
    <div data-kv-text={scopeId} className={cn('relative', className)}>
      {offCss && <style>{offCss}</style>}
      {empty && placeholder && <span className={cn('pointer-events-none absolute left-3 text-sm leading-6 text-muted-foreground', multiline ? 'top-[9px]' : 'top-[8px]')}>{placeholder}</span>}
      <div
        ref={el}
        id={id}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline={multiline}
        aria-invalid={invalid || undefined}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={emit}
        className={cn(
          'w-full rounded-md border border-input bg-background px-3 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive',
          multiline ? 'min-h-[68px] whitespace-pre-wrap break-words py-2' : 'h-10 overflow-x-auto overflow-y-hidden whitespace-nowrap py-[7px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          contentClassName,
        )}
      />
      {adornment}
    </div>
  )
})
