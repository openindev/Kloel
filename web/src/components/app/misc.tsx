import type { ReactNode } from 'react'
import { Search, ListFilter, FlaskConical, RotateCcw, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RESULTS } from '@/data/catalogs/results'
import type { ConversationResult } from '@/domain/types'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { OperationStatus } from '@/hooks/useOperation'

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn('mx-auto w-full max-w-xl rounded-xl border px-8 py-12 text-center', className)}>
      {icon && <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted [&>svg]:size-5 [&>svg]:text-muted-foreground">{icon}</div>}
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      {description && <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </section>
  )
}

export function ResultChip({ result, className }: { result: ConversationResult; className?: string }) {
  const r = RESULTS[result]
  return (
    <span className={cn('inline-flex max-w-full shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide', r.chip, className)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', r.dot)} />
      <span className="truncate">{r.label}</span>
    </span>
  )
}

/** Caixa de busca com botão de filtro (Conversas / Contatos / E-Mail IA). */
export function SearchFilterBox({
  value,
  onChange,
  placeholder,
  onFilterClick,
  filterSlot,
  className,
  focusStyle = 'ring',
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onFilterClick?: () => void
  filterSlot?: ReactNode
  className?: string
  focusStyle?: 'ring' | 'primary'
}) {
  return (
    <div
      className={cn(
        'relative flex h-9 items-center rounded-md border bg-background shadow-xs',
        focusStyle === 'ring' ? 'border-input focus-within:ring-1 focus-within:ring-ring' : 'bg-white transition-shadow focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20',
        className,
      )}
    >
      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-w-0 flex-1 rounded-md bg-transparent pl-8 pr-2 text-sm placeholder:text-muted-foreground focus:outline-none"
      />
      <span className="h-5 w-px bg-border" />
      {filterSlot ?? (
        <button type="button" aria-label="Filtrar" onClick={onFilterClick} className="inline-flex h-full w-9 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted/50 hover:text-foreground">
          <ListFilter className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/** Selo que identifica resultados SIMULADOS (nenhuma operação externa real). */
export function SimulatedBadge({ className, children = 'Simulado' }: { className?: string; children?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-dashed border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800', className)}>
      <FlaskConical className="h-3 w-3" />
      {children}
    </span>
  )
}

/** Exibe o ciclo de uma operação simulada: processando (com etapas), sucesso, erro + repetir. */
export function OperationStatusView({
  status,
  progress,
  error,
  onRetry,
  successText,
  className,
}: {
  status: OperationStatus
  progress: { label: string; percent: number }
  error?: string
  onRetry?: () => void
  successText?: ReactNode
  className?: string
}) {
  if (status === 'idle') return null
  return (
    <div className={cn('rounded-lg border p-3 text-sm', status === 'error' ? 'border-destructive/40 bg-red-50/60' : 'bg-muted/30', className)}>
      {status === 'running' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{progress.label || 'Processando…'}</span>
          </div>
          <Progress value={progress.percent} />
        </div>
      )}
      {status === 'success' && (
        <div className="flex items-center gap-2 text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          <span>{successText ?? 'Concluído.'}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 text-destructive">
          <XCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          {onRetry && (
            <Button size="xs" variant="outline" onClick={onRetry} className="shrink-0 gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function CountBadge({ children }: { children: ReactNode }) {
  return <div className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border px-1 py-0.5 text-xs font-medium text-foreground">{children}</div>
}
