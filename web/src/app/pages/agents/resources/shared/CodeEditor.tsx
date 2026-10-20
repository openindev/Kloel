import { useRef, useState, type ReactNode } from 'react'
import { Braces } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VariablePicker, insertAtCursor, type VariableContext } from './VariablePicker'
import { formatJson, labelToken } from './variables'
import { FieldError } from './ui'

/**
 * Editor escuro (refs. 540–547): fundo #1C1B2B, texto monoespaçado claro, barra com "{ } Formatar" e/ou
 * "Adicionar variável ⌄". Formatar valida/indenta o JSON (preservando {{variáveis}}).
 */
export function CodeEditor({
  value,
  onChange,
  placeholder,
  format = false,
  variables = false,
  rows = 4,
  error,
  ariaLabel,
  singleLine,
  disabled,
  id,
  compact,
  variableContext = 'default',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  format?: boolean
  variables?: boolean
  rows?: number
  error?: string
  ariaLabel: string
  singleLine?: boolean
  disabled?: boolean
  id?: string
  /** ref. 540: editores dentro dos acordeões do webhook de entrada têm 100px de conteúdo */
  compact?: boolean
  /** lista de variáveis do menu (ex. webhook de entrada: só dados da chamada que está tocando, ref. IW-04) */
  variableContext?: VariableContext
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [formatError, setFormatError] = useState<string>()
  const showBar = format || variables
  return (
    <div className="flex flex-col gap-2">
      {/* refs. 540–547 (P3 → sRGB): fundo #1E1E2E, barra #181825, bordas #313244, texto #CDD6F4, barra #A6ADC8, placeholder #888 */}
      <div className={cn('overflow-hidden rounded-lg border border-[#313244] bg-[#1E1E2E] text-[#CDD6F4]', error && 'ring-1 ring-destructive', disabled && 'opacity-60')}>
        {showBar && (
          <div className="flex min-h-10 items-center justify-between gap-2 border-b border-[#313244] bg-[#181825] px-3 py-1 text-sm">
            {format ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const f = formatJson(value)
                  if (f === null) setFormatError('Não foi possível formatar: o conteúdo não é um JSON válido.')
                  else {
                    setFormatError(undefined)
                    onChange(f)
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-[#A6ADC8] transition-colors hover:text-white"
              >
                <Braces className="size-3.5" /> Formatar
              </button>
            ) : (
              <span />
            )}
            {variables && (
              <VariablePicker
                variant="dark"
                context={variableContext}
                onPick={(v) => {
                  // refs. IW-03/HR-04: a variável entra pelo rótulo, ex. {{Chamada: Número de origem}}
                  const r = insertAtCursor(ref.current, value, labelToken(v.key))
                  onChange(r.value)
                  requestAnimationFrame(() => {
                    ref.current?.focus()
                    ref.current?.setSelectionRange(r.caret, r.caret)
                  })
                }}
              />
            )}
          </div>
        )}
        <textarea
          ref={ref}
          id={id}
          aria-label={ariaLabel}
          aria-invalid={!!error || undefined}
          value={value}
          disabled={disabled}
          spellCheck={false}
          rows={singleLine ? 1 : compact ? Math.min(rows, 3) : rows}
          placeholder={placeholder}
          onChange={(e) => {
            setFormatError(undefined)
            onChange(singleLine ? e.target.value.replace(/\n/g, '') : e.target.value)
          }}
          className={cn(
            'block w-full bg-transparent px-4 font-mono text-[13px] leading-5 text-[#CDD6F4] outline-none placeholder:text-[#888888]',
            // refs. 541/546: linha única com 40px; multilinha com 120px
            singleLine ? 'resize-none py-2.5' : cn('resize-y py-3', compact ? 'min-h-[100px]' : 'min-h-[120px]'),
          )}
        />
      </div>
      <FieldError>{error ?? formatError}</FieldError>
    </div>
  )
}

/** Bloco de código somente leitura (API Outbound). */
export function CodeBlock({ code, children }: { code: string; children?: ReactNode }) {
  return (
    // ref. 542: linhas de 16,75px, texto #CDD6F4 e strings #A6E3A1 sobre #1E1E2E
    <div className="relative overflow-hidden rounded-lg bg-[#1E1E2E]">
      <pre className="overflow-x-auto px-5 pb-[22px] pt-3 font-mono text-[13px] leading-[16.75px] text-[#CDD6F4]">
        <code>{highlightJson(code)}</code>
      </pre>
      {children && <div className="absolute right-3 top-3">{children}</div>}
    </div>
  )
}

/** Realce simples: strings de valores em verde-claro (como na ref. 542). */
function highlightJson(code: string) {
  const parts: ReactNode[] = []
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(code))) {
    if (m.index > last) parts.push(code.slice(last, m.index))
    const isKey = !!m[2]
    parts.push(
      <span key={i++} className={isKey ? 'text-[#CDD6F4]' : 'text-[#A6E3A1]'}>
        {m[1]}
      </span>,
    )
    if (m[2]) parts.push(m[2])
    last = m.index + m[0].length
  }
  if (last < code.length) parts.push(code.slice(last))
  return parts
}
