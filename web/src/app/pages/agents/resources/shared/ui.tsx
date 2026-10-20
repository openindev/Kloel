import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronRight, ChevronsUpDown, CircleAlert, CircleHelp, CirclePlus, Copy, Info, Pencil, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

/* ------------------------------------------------------------------ */
/* Campos                                                              */
/* ------------------------------------------------------------------ */

/** Ícone (?) com dica — "Verificar disponibilidade ⓘ(?)". */
export function HelpIcon({ label }: { label: ReactNode }) {
  return (
    <SimpleTooltip label={label}>
      <button type="button" aria-label="Ajuda" className="inline-flex text-muted-foreground hover:text-foreground">
        <CircleHelp className="size-4" />
      </button>
    </SimpleTooltip>
  )
}

export function FieldError({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="text-sm font-medium text-destructive">
      {children}
    </p>
  )
}

/**
 * Campo empilhado (rótulo acima, opcional ajuda/ação à direita, dica abaixo do rótulo).
 * Medidas das refs. 497/514/535: rótulo 14px (leading-none) → 8px → controle; com `aside` (segmentado de 32px) a linha
 * mede 24px (o segmentado avança 4px acima/abaixo, como na ref. 514) e quebra para baixo do rótulo em telas estreitas.
 */
export function Field({
  label,
  htmlFor,
  help,
  hint,
  error,
  aside,
  children,
  className,
  note,
}: {
  label: ReactNode
  htmlFor?: string
  help?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  /** texto auxiliar abaixo do controle */
  note?: ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className={cn('flex items-center justify-between gap-x-4', aside && 'min-h-6 flex-wrap gap-y-3')}>
        <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-medium leading-none">
          {label}
          {help && <HelpIcon label={help} />}
        </label>
        {aside && <div className="-my-1 max-w-full">{aside}</div>}
      </div>
      {/* refs. 519/521: a dica fica 4px acima do controle */}
      {hint && <p className="-mb-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
      {note && <p className="text-xs leading-5 text-muted-foreground">{note}</p>}
      <FieldError>{error}</FieldError>
    </div>
  )
}

/**
 * Campo em duas colunas usado nos painéis largos (Calendly, Requisição HTTP — refs. 527/545):
 * rótulo ocupa 25% da largura e o controle começa exatamente nessa coluna; linhas a cada 56px (controle 40 + 16).
 */
export function FieldRow({
  label,
  htmlFor,
  children,
  error,
  hint,
  labelClassName,
  centerLabel,
}: {
  label: ReactNode
  htmlFor?: string
  children: ReactNode
  error?: ReactNode
  hint?: ReactNode
  /** ajuste fino do rótulo (ex.: refs. 527/AP-09 — rótulos de campos de texto 2px acima do centro) */
  labelClassName?: string
  /** C-47: o rótulo fica centralizado na altura do controle + dica (ex. "Tipo de evento") */
  centerLabel?: boolean
}) {
  // ref. 527: o rótulo fica centralizado na altura do controle (rótulos de 2 linhas, ex. "URL de agendamento de evento");
  // com dica/erro abaixo do controle, volta a alinhar pelo topo para não descer junto com o texto auxiliar.
  const centered = centerLabel || (!hint && !error)
  return (
    <div className={cn('grid grid-cols-1 gap-2 sm:grid-cols-[25%_minmax(0,1fr)] sm:gap-0', centered ? 'sm:items-center' : 'sm:items-start')}>
      <label htmlFor={htmlFor} className={cn('pt-0 text-sm font-medium leading-5 sm:pr-4', !centered && 'sm:pt-2.5', labelClassName)}>
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-2">
        {children}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <FieldError>{error}</FieldError>
      </div>
    </div>
  )
}

/**
 * Controle segmentado dos painéis de recurso (refs. 497/514/522): trilho cinza sem borda, p-1, opções 24px com texto 13px;
 * em telas estreitas ocupa a largura toda e reduz o texto para não quebrar linhas.
 */
export function SheetSegmented<T extends string>(props: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; ariaLabel: string; className?: string; fullOnMobile?: boolean }) {
  const { fullOnMobile, className, ...rest } = props
  return (
    <Segmented<T>
      {...rest}
      className={cn(
        'shrink-0 gap-0 rounded-lg border-0 bg-muted p-1 [&>button]:h-6 [&>button]:whitespace-nowrap [&>button]:rounded-md [&>button]:px-3 [&>button]:text-xs',
        fullOnMobile && 'max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:px-1.5 max-sm:[&>button]:text-xs',
        className,
      )}
    />
  )
}

/**
 * Rodapé dos painéis de recurso: "Cancelar" com borda (refs. 514/522/535/527) ou cinza (refs. 540/543), "Salvar" preto.
 * `hideCancel` reproduz o painel de transferência (ref. 497: só "Salvar").
 */
export function SheetFooter({
  onSave,
  onCancel,
  left,
  cancelVariant = 'outline',
  hideCancel,
  saveLabel = 'Salvar',
  cancelLabel = 'Cancelar',
}: {
  onSave: () => void
  onCancel?: () => void
  left?: ReactNode
  cancelVariant?: 'outline' | 'secondary'
  hideCancel?: boolean
  saveLabel?: string
  cancelLabel?: string
}) {
  return (
    <div className="flex flex-row items-center justify-between gap-2">
      <div>{left}</div>
      <div className="flex items-center gap-2">
        {!hideCancel && onCancel && (
          <Button type="button" variant={cancelVariant} onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button type="button" onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
    </div>
  )
}

/** Rótulo de seção "OPÇÕES" / "MENSAGEM" (padrão SheetSectionTitle). */
export function SectionCaps({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('pt-2 text-sm font-semibold uppercase tracking-widest text-foreground/60', className)}>{children}</h3>
}

/**
 * Linha "rótulo (?) + switch" da seção OPÇÕES (refs. 497/498): 24px de altura (switch 22px), 48px entre linhas.
 * Difere do SheetSwitchRow compartilhado (min-h-8), que deixava as linhas 4px mais afastadas que a referência.
 */
export function OptionSwitchRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-4">
      <div className="flex items-center gap-1.5 text-sm font-medium leading-none">{label}</div>
      {children}
    </div>
  )
}

/**
 * Combobox com busca (refs. 530/531): gatilho h-10 com ⌃⌄, lista com "Pesquisar…" e ✓ à direita do item selecionado.
 */
export function ComboSelect<T extends string>({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  disabled,
  placeholder = 'Selecionar...',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  id?: string
  ariaLabel?: string
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            !current && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{current?.label ?? placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar..." />
          <CommandList>
            <CommandEmpty className="py-7 text-center text-sm text-foreground">Nenhum resultado encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.value === value && <Check className="size-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Linha de switch com descrição (refs. 530/532): rótulo à esquerda, switch de 22px à direita, descrição 12px abaixo. */
export function SwitchField({ label, description, children }: { label: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center justify-between gap-4">
        <div className="text-sm font-medium leading-none">{label}</div>
        {children}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Caixas                                                              */
/* ------------------------------------------------------------------ */

/**
 * Aviso laranja (refs. 498/505): caixa de 54px para uma linha (14px acima, 18px abaixo), texto e ícone orange-500 e borda orange-500/50.
 * As referências são capturas em Display P3: (232,123,53) P3 = #F97316 sRGB.
 */
export function WarningBox({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div role="status" data-testid={testId} className={cn('flex items-start gap-3 rounded-lg border border-orange-500/50 px-4 pb-[18px] pt-3.5 text-sm leading-5 text-orange-500', className)}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function InfoBox({
  children,
  className,
  tone = 'blue',
  title,
  icon = 'info',
  testId,
}: {
  children: ReactNode
  className?: string
  tone?: 'blue' | 'neutral'
  title?: ReactNode
  /** ref. 524: aviso de propriedade do número usa o círculo com "!" */
  icon?: 'info' | 'alert'
  testId?: string
}) {
  const Icon = icon === 'alert' ? CircleAlert : Info
  return (
    <div
      data-testid={testId}
      className={cn(
        // ref. 522 (P3 → sRGB): borda blue-200, fundo blue-50/70, ícone blue-700; texto 13px abaixo da borda e 19px de folga embaixo
        'flex items-start gap-3 rounded-lg border px-4 pb-[19px] pt-[13px] text-sm leading-5',
        tone === 'blue' ? 'border-blue-200 bg-blue-50/70 text-foreground' : 'bg-background text-foreground',
        className,
      )}
    >
      <Icon className={cn('mt-[3px] size-4 shrink-0', tone === 'blue' ? 'text-blue-700' : 'text-foreground')} />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        <div className={cn(title && 'mt-1 text-muted-foreground')}>{children}</div>
      </div>
    </div>
  )
}

/** Código em linha. `plain` = só fonte monoespaçada, como nos textos explicativos dos webhooks (ref. 540). */
export function InlineCode({ children, plain }: { children: ReactNode; plain?: boolean }) {
  if (plain) return <code className="font-mono text-[13px]">{children}</code>
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</code>
}

/* ------------------------------------------------------------------ */
/* Título editável (✎)                                                 */
/* ------------------------------------------------------------------ */

export function EditableTitle({
  value,
  onChange,
  placeholder = 'Sem nome',
  allowEmpty,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** apagar o nome é permitido (o painel mostra o campo de nome com "Nome é obrigatório", ref. CT-03) */
  allowEmpty?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  useEffect(() => {
    if (!editing) setText(value)
  }, [value, editing])
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])
  // O Dialog da Radix escuta Escape no `document` (fase de captura) e fecharia o painel inteiro, descartando o rascunho.
  // Um ouvinte de captura na `window` roda antes dele: marcar o evento como tratado (preventDefault) faz a Radix ignorá-lo,
  // e o onKeyDown do campo apenas cancela a renomeação.
  useEffect(() => {
    if (!editing) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && e.target === inputRef.current) e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editing])
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const t = text.trim()
    if (t) onChange(t)
    else if (allowEmpty) onChange('')
    else setText(value)
    setEditing(false)
  }
  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label="Nome do recurso"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            // o desmonte do campo dispara onBlur → commit(); `cancelled` evita gravar o texto descartado
            cancelled.current = true
            setText(value)
            setEditing(false)
          }
        }}
        className="-mx-1.5 w-full max-w-full rounded-md border border-input bg-background px-1.5 text-xl font-semibold leading-8 outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    )
  }
  return (
    <span className="inline-flex max-w-full items-center gap-2.5">
      <span className="truncate">{value || placeholder}</span>
      <button
        type="button"
        aria-label="Renomear"
        onClick={() => {
          cancelled.current = false
          setEditing(true)
        }} className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground">
        <Pencil className="size-4" strokeWidth={1.5} />
      </button>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Lista (cartão com linhas + "Adicionar…")                            */
/* ------------------------------------------------------------------ */

export function ListCard({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('divide-y overflow-hidden rounded-xl border bg-background', className)}>{children}</ul>
}

export function ListRow({ title, subtitle, pills, leading, onClick, testId, trailing }: { title: ReactNode; subtitle?: ReactNode; pills?: ReactNode; leading?: ReactNode; onClick: () => void; testId?: string; trailing?: ReactNode }) {
  return (
    <li className={trailing ? 'flex items-stretch' : undefined}>
      {/* < sm: grade (pílulas abaixo do título, que fica legível em 390px); ≥ sm: linha única como na ref. 539 */}
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        className={cn(
          'grid w-full items-center gap-x-3 px-5 py-4 text-left transition-colors hover:bg-muted/40 sm:flex',
          leading ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]',
          trailing && 'min-w-0 flex-1',
        )}
      >
        {leading && <span className="col-start-1 row-span-2 row-start-1 flex">{leading}</span>}
        <span className={cn('row-start-1 min-w-0 sm:flex-1', leading ? 'col-start-2' : 'col-start-1')}>
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          {subtitle && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>}
        </span>
        {pills && (
          <span className={cn('row-start-2 mt-2 flex min-w-0 flex-wrap items-center gap-1.5 sm:mt-0 sm:shrink-0 sm:flex-nowrap sm:justify-end', leading ? 'col-start-2' : 'col-start-1')}>{pills}</span>
        )}
        <ChevronRight className={cn('row-span-2 row-start-1 size-4 shrink-0 text-foreground', leading ? 'col-start-3' : 'col-start-2')} />
      </button>
      {trailing}
    </li>
  )
}

export function AddRow({ children, onClick, asChildTrigger }: { children: ReactNode; onClick?: () => void; asChildTrigger?: ReactNode }) {
  return (
    <li>
      {asChildTrigger ?? (
        <button type="button" onClick={onClick} className="flex h-auto w-full items-center justify-center gap-2 rounded-none px-5 py-4 text-sm font-medium text-brand transition-colors hover:bg-accent">
          <CirclePlus className="size-4" />
          {children}
        </button>
      )}
    </li>
  )
}

export function Pill({ children, className, tone = 'default', title }: { children: ReactNode; className?: string; tone?: 'default' | 'success' | 'error' | 'muted'; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        // ref. 539: pílula de 20px (texto 12/16 + 1px de respiro), linhas da lista com 53px
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-px text-xs font-medium',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
        tone === 'muted' && 'text-muted-foreground',
        tone === 'default' && 'text-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Copiar                                                              */
/* ------------------------------------------------------------------ */

export async function copyText(text: string, what = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} para a área de transferência`)
    return true
  } catch {
    // Fallback (headless / sem permissão): seleciona via textarea temporário
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    if (ok) toast.success(`${what} para a área de transferência`)
    else toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.')
    return ok
  }
}

export function CopyButton({ text, label = 'Copiar', what, className, dark }: { text: string; label?: string; what?: string; className?: string; dark?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        if (await copyText(text, what)) {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }
      }}
      className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors', dark ? 'text-slate-300 hover:bg-white/10 hover:text-white' : 'text-foreground hover:bg-accent', className)}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Entrada de itens confirmados com Enter (e-mails, sites)            */
/* ------------------------------------------------------------------ */

export function ChipsInput({
  values,
  onChange,
  placeholder,
  validate,
  normalize = (s) => s.trim(),
  invalid,
  id,
  ariaLabel,
  onPendingChange,
  separator = /[,;\s]+/,
  commaConfirms = true,
  chipClassName,
  keepPlaceholder,
}: {
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  /** retorna mensagem de erro ou undefined */
  validate?: (v: string, all: string[]) => string | undefined
  normalize?: (v: string) => string
  invalid?: boolean
  id?: string
  ariaLabel?: string
  /** texto digitado ainda não confirmado (para validação no "Salvar") */
  onPendingChange?: (v: string) => void
  /** separa várias entradas coladas de uma vez (e-mails: vírgula, ponto e vírgula ou espaço; URLs: só espaço/quebra de linha) */
  separator?: RegExp
  /** a tecla "," também confirma a entrada (e-mails); desligado para URLs, que podem conter vírgulas */
  commaConfirms?: boolean
  chipClassName?: string
  /** ref. WS-03: o placeholder continua visível depois dos chips */
  keepPlaceholder?: boolean
}) {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string>()
  const add = () => {
    const parts = text.split(separator).map(normalize).filter(Boolean)
    if (!parts.length) return
    const next = [...values]
    for (const p of parts) {
      const e = validate?.(p, next)
      if (e) {
        setErr(e)
        return
      }
      if (!next.includes(p)) next.push(p)
    }
    onChange(next)
    setText('')
    onPendingChange?.('')
    setErr(undefined)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || (commaConfirms && e.key === ',')) {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !text && values.length) {
      onChange(values.slice(0, -1))
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          // ref. 518: com foco, anel de 1px na cor do texto (não o cinza do --ring)
          'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-[5px] text-sm focus-within:ring-1 focus-within:ring-foreground',
          (invalid || err) && 'border-destructive focus-within:ring-destructive',
        )}
      >
        {values.map((v) => (
          <span key={v} className={cn('inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[13px]', chipClassName)}>
            <span className="truncate">{v}</span>
            <button type="button" aria-label={`Remover ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-label={ariaLabel}
          aria-invalid={invalid || !!err || undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onPendingChange?.(e.target.value)
            if (err) setErr(undefined)
          }}
          onKeyDown={onKey}
          onBlur={() => text.trim() && add()}
          placeholder={values.length && !keepPlaceholder ? '' : placeholder}
          className="h-7 min-w-[10rem] flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground aria-[invalid=true]:placeholder:text-destructive/50"
        />
      </div>
      <FieldError>{err}</FieldError>
    </div>
  )
}

/** Botão de exclusão para o rodapé esquerdo dos editores. */
export function DeleteFooterButton({ onClick, label = 'Excluir' }: { onClick: () => void; label?: string }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick} className="gap-2 px-3 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
      {label}
    </Button>
  )
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const isEmail = (v: string) => EMAIL_RE.test(v.trim())
export const digits = (v: string) => v.replace(/\D/g, '')
