/**
 * Peças visuais do módulo Tarefas (TK-V01…TK-V03): status com ponto colorido, chip de prioridade, avatar do responsável,
 * chips de tag, seletor de data/hora de vencimento e editor de descrição ("Normal ⌄", B, I, U).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { Bold, CalendarDays, Check, ChevronDown, Italic, Plus, Sparkles, Underline, UserRound, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { sanitizeHtml } from '@/app/pages/agents/resources/shared/RichTextEditor'
import {
  MAX_TASK_TAGS, PRIORITY_ORDER, STATUS_ORDER, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, formatDue, normalizeTag,
  type Member, type TaskPriority, type TaskStatus,
} from './model'

/* ------------------------------- Estado ------------------------------- */

const STATUS_DOT: Record<TaskStatus, string> = {
  todo: 'border border-neutral-400 bg-transparent',
  in_progress: 'bg-sky-500',
  done: 'bg-emerald-500',
  canceled: 'bg-neutral-300',
}

export function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', STATUS_DOT[status], className)} />
}

/** "● Em andamento ⌄" (TK-V03): menu para trocar o estado. */
export function StatusMenu({ value, onChange, className, testId }: { value: TaskStatus; onChange: (s: TaskStatus) => void; className?: string; testId?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={`Estado: ${TASK_STATUS_LABEL[value]}`}
          onClick={(e) => e.stopPropagation()}
          className={cn('inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground', className)}
        >
          <StatusDot status={value} />
          <span className="whitespace-nowrap">{TASK_STATUS_LABEL[value]}</span>
          <ChevronDown className="size-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Estado</DropdownMenuLabel>
        {STATUS_ORDER.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onChange(s)}>
            <StatusDot status={s} className="size-2" />
            <span className="flex-1">{TASK_STATUS_LABEL[s]}</span>
            {s === value && <Check className="text-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ----------------------------- Prioridade ----------------------------- */

/** Observado: "Medium" âmbar e "No priority" cinza (TK-V03). Baixa (azul) e Alta (vermelho) são INFERIDAS. */
export const PRIORITY_CHIP: Record<TaskPriority, string> = {
  none: 'bg-muted text-muted-foreground',
  low: 'bg-sky-100 text-sky-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-red-100 text-red-700',
}

const PRIORITY_DOT: Record<TaskPriority, string> = { none: 'bg-neutral-300', low: 'bg-sky-500', medium: 'bg-amber-500', high: 'bg-red-500' }

export function PriorityMenu({ value, onChange, testId }: { value: TaskPriority; onChange: (p: TaskPriority) => void; testId?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={`Prioridade: ${TASK_PRIORITY_LABEL[value]}`}
          onClick={(e) => e.stopPropagation()}
          className={cn('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium hover:opacity-80', PRIORITY_CHIP[value])}
        >
          {TASK_PRIORITY_LABEL[value]}
          <ChevronDown className="size-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Prioridade</DropdownMenuLabel>
        {[...PRIORITY_ORDER].reverse().map((p) => (
          <DropdownMenuItem key={p} onSelect={() => onChange(p)}>
            <span className={cn('inline-block size-2 rounded-full', PRIORITY_DOT[p])} />
            <span className="flex-1">{TASK_PRIORITY_LABEL[p]}</span>
            {p === value && <Check className="text-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ----------------------------- Responsável ---------------------------- */

export function Avatar({ member, size = 20, ai }: { member?: Member; size?: number; ai?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }
  if (ai)
    return (
      <span style={style} className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand" title="IA">
        <Sparkles style={{ width: size * 0.6, height: size * 0.6 }} />
      </span>
    )
  if (!member) return <span style={style} aria-label="Sem responsável" className="inline-block shrink-0 rounded-full border border-neutral-300 bg-white" />
  return (
    <span style={style} title={member.name} className="inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-900 font-semibold leading-none text-white">
      {member.initials}
    </span>
  )
}

/**
 * Seletor de responsável. `variant="compact"`: avatar + ⌄ (cartão da lista); `variant="full"`: avatar + nome + ⌄ com borda
 * (detalhe e modal "Criar tarefa").
 */
export function AssigneeMenu({
  value,
  onChange,
  members,
  variant = 'full',
  id,
  testId,
  className,
}: {
  value: string | undefined
  onChange: (userId: string | undefined) => void
  members: Member[]
  variant?: 'compact' | 'full'
  id?: string
  testId?: string
  className?: string
}) {
  const current = members.find((m) => m.id === value)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === 'compact' ? (
          <button
            type="button"
            data-testid={testId}
            aria-label={`Responsável: ${current?.name ?? 'Sem responsável'}`}
            onClick={(e) => e.stopPropagation()}
            className={cn('inline-flex h-6 items-center gap-0.5 rounded-md px-1 hover:bg-accent', className)}
          >
            <Avatar member={current} size={18} />
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
        ) : (
          <button
            id={id}
            type="button"
            data-testid={testId}
            aria-label={`Responsável: ${current?.name ?? 'Sem responsável'}`}
            className={cn('inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent/50', className)}
          >
            {current ? <Avatar member={current} size={20} /> : <UserRound className="size-4 text-muted-foreground" />}
            <span className={cn('truncate', !current && 'text-muted-foreground')}>{current?.name ?? 'Sem responsável'}</span>
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Buscar pessoa…" />
          <CommandList>
            <CommandEmpty className="py-6 text-center text-sm">Ninguém encontrado.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="Sem responsável"
                onSelect={() => {
                  onChange(undefined)
                  setOpen(false)
                }}
              >
                <Avatar size={20} />
                <span className="flex-1 text-muted-foreground">Sem responsável</span>
                {!value && <Check className="size-4" />}
              </CommandItem>
              {members.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.name} ${m.email}`}
                  onSelect={() => {
                    onChange(m.id)
                    setOpen(false)
                  }}
                >
                  <Avatar member={m} size={20} />
                  <span className="flex-1 truncate">{m.name}</span>
                  {m.id === value && <Check className="size-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/* -------------------------------- Tags -------------------------------- */

export function TagChip({ label, onRemove, className }: { label: string; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted px-2 text-[11px] font-medium text-foreground/80', className)}>
      {label === 'Criada por IA' && <Sparkles className="size-3 text-brand" />}
      <span className="truncate">{label}</span>
      {onRemove && (
        <button type="button" aria-label={`Remover tag ${label}`} onClick={onRemove} className="-mr-1 rounded p-0.5 text-muted-foreground hover:bg-black/5 hover:text-foreground">
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

/** "+" / "+ Adicionar tags": busca entre as tags existentes ou cria uma nova (Enter). */
export function TagAdder({
  tags,
  known,
  onAdd,
  label,
  className,
  testId,
}: {
  tags: string[]
  known: string[]
  onAdd: (tag: string) => void
  /** texto ao lado do "+" (modal: "Adicionar tags"); sem texto = só o ícone (detalhe) */
  label?: string
  className?: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const full = tags.length >= MAX_TASK_TAGS
  const typed = normalizeTag(q)
  const exists = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase())
  const options = known.filter((t) => !exists(t))
  const canCreate = !!typed && !exists(typed) && !known.some((k) => k.toLowerCase() === typed.toLowerCase())
  const add = (t: string) => {
    onAdd(t)
    setQ('')
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o || setQ(''))}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          disabled={full}
          title={full ? 'Limite de 50 tags atingido' : undefined}
          aria-label={label ?? 'Adicionar tag'}
          className={cn('inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50', className)}
        >
          <Plus className="size-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command shouldFilter>
          <CommandInput
            placeholder="Buscar ou criar tag…"
            value={q}
            onValueChange={setQ}
            maxLength={40}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) {
                e.preventDefault()
                add(typed)
              }
            }}
          />
          <CommandList>
            <CommandEmpty className="px-3 py-4 text-center text-xs text-muted-foreground">{typed ? 'Pressione Enter para criar a tag.' : 'Nenhuma tag.'}</CommandEmpty>
            {canCreate && (
              <CommandGroup>
                <CommandItem value={`__criar ${typed}`} onSelect={() => add(typed)}>
                  <Plus className="size-4" /> Criar “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
            {options.length > 0 && (
              <CommandGroup heading="Tags existentes">
                {options.map((t) => (
                  <CommandItem key={t} value={t} onSelect={() => add(t)}>
                    {t}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/* --------------------------- Data de vencimento --------------------------- */

const pad = (n: number) => String(n).padStart(2, '0')

/** Botão com ícone de calendário (TK-V01 "Select due date…", TK-V03 "10/3/2026, 09:00 AM") + popover com dia e hora. */
export function DueDatePicker({
  value,
  onChange,
  placeholder = 'Selecione a data...',
  id,
  className,
  invalid,
  testId,
}: {
  value: string | undefined
  onChange: (iso: string | undefined) => void
  placeholder?: string
  id?: string
  className?: string
  invalid?: boolean
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState<Date | undefined>()
  const [time, setTime] = useState('09:00')
  const [error, setError] = useState('')
  const onOpen = (o: boolean) => {
    setOpen(o)
    if (o) {
      const d = value ? new Date(value) : undefined
      setDay(d)
      setTime(d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '09:00')
      setError('')
    }
  }
  const apply = () => {
    if (!day) return setError('Escolha um dia no calendário.')
    const m = /^(\d{2}):(\d{2})$/.exec(time)
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return setError('Informe um horário válido (HH:MM).')
    const d = new Date(day)
    d.setHours(Number(m[1]), Number(m[2]), 0, 0)
    onChange(d.toISOString())
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={onOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          data-testid={testId}
          aria-invalid={invalid || undefined}
          className={cn(
            'flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm hover:bg-accent/40 focus:outline-none focus:ring-1 focus:ring-ring',
            invalid && 'border-destructive',
            className,
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value ? formatDue(value) : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="single" selected={day} onSelect={(d) => (setDay(d ?? undefined), setError(''))} defaultMonth={day ?? new Date()} initialFocus />
        <div className="flex items-center gap-2 border-t px-3 py-3">
          <label htmlFor={`${id ?? 'due'}-time`} className="text-xs font-medium text-muted-foreground">
            Horário
          </label>
          <Input
            id={`${id ?? 'due'}-time`}
            type="time"
            value={time}
            onChange={(e) => (setTime(e.target.value), setError(''))}
            className="h-8 w-[110px] text-sm"
            aria-label="Horário de vencimento"
          />
          <span className="ml-auto text-xs text-muted-foreground">{day ? format(day, 'dd/MM/yyyy') : '—'}</span>
        </div>
        {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!value}
            onClick={() => {
              onChange(undefined)
              setOpen(false)
            }}
          >
            Remover data
          </Button>
          <Button type="button" size="xs" onClick={apply} data-testid={testId ? `${testId}-apply` : undefined}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ------------------------------ Descrição ------------------------------ */

const BLOCKS = [
  { value: 'div', label: 'Normal' },
  { value: 'h2', label: 'Título' },
  { value: 'h3', label: 'Subtítulo' },
]

/**
 * Editor rich text da descrição (TK-V01/TK-V03): "Normal ⌄", B, I, U. Guarda HTML sanitizado (somente formatação básica).
 * `onCommit` dispara ao sair do campo (o detalhe grava e registra "Atualizou a descrição" uma vez por edição).
 */
export function DescriptionEditor({
  value,
  onChange,
  onCommit,
  placeholder = 'Adicione mais detalhes (opcional)',
  minHeight = 96,
  ariaLabel = 'Descrição',
  testId,
}: {
  value: string
  onChange?: (html: string) => void
  onCommit?: (html: string) => void
  placeholder?: string
  minHeight?: number
  ariaLabel?: string
  testId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(!value)
  const [block, setBlock] = useState('div')
  const focused = useRef(false)

  // valor externo (outra tarefa selecionada, desfazer) sem perder o cursor durante a digitação
  useEffect(() => {
    const el = ref.current
    if (!el || focused.current) return
    const clean = sanitizeHtml(value)
    if (el.innerHTML !== clean) el.innerHTML = clean
    setEmpty(!el.textContent?.trim())
  }, [value])

  const read = () => sanitizeHtml(ref.current?.innerHTML ?? '')
  const emit = () => {
    const el = ref.current
    if (!el) return
    setEmpty(!el.textContent?.trim())
    onChange?.(read())
  }
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
  }
  const tool = 'inline-flex size-7 items-center justify-center rounded-md text-foreground hover:bg-accent'
  return (
    <div className="overflow-hidden rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" onMouseDown={(e) => e.preventDefault()} className="inline-flex h-7 items-center gap-0.5 rounded-md px-2 text-xs hover:bg-accent">
              {BLOCKS.find((b) => b.value === block)?.label} <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
            {BLOCKS.map((b) => (
              <DropdownMenuItem
                key={b.value}
                onSelect={() => {
                  setBlock(b.value)
                  exec('formatBlock', b.value)
                  if (onCommit) onCommit(read())
                }}
              >
                {b.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" aria-label="Negrito" className={tool} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
          <Bold className="size-3.5" />
        </button>
        <button type="button" aria-label="Itálico" className={tool} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
          <Italic className="size-3.5" />
        </button>
        <button type="button" aria-label="Sublinhado" className={tool} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>
          <Underline className="size-3.5" />
        </button>
      </div>
      <div className="relative">
        {empty && <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">{placeholder}</span>}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          data-testid={testId}
          contentEditable
          suppressContentEditableWarning
          onFocus={() => (focused.current = true)}
          onInput={emit}
          onBlur={() => {
            focused.current = false
            const html = read()
            onChange?.(html)
            onCommit?.(html)
          }}
          onPaste={(e) => {
            e.preventDefault()
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          }}
          style={{ minHeight }}
          className="px-3 py-2.5 text-sm leading-5 outline-none [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold"
        />
      </div>
    </div>
  )
}

/** Rótulo de seção com ícone (TK-V03: "🏷 Tags", "↺ Atividade"). */
export function SectionLabel({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-1.5 text-sm font-medium [&>svg]:size-4 [&>svg]:text-muted-foreground', className)}>{icon}{children}</div>
}
