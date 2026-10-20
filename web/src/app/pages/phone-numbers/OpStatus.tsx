import type { ReactNode } from 'react'
import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { OperationStatus } from '@/hooks/useOperation'

/** Rótulo de etapa dos serviços simulados sem os sufixos "(simulado)"/"(simulada)" — a tela não exibe selos de simulação. */
export const cleanStepLabel = (label: string) => label.replace(/\s*\((simulad[oa]s?|demonstra[^)]*)\)/gi, '').trim()

/**
 * Ciclo de uma operação (processando com etapas → concluído | erro + repetir), igual ao OperationStatusView da casca,
 * mas sem o selo "Simulado": as telas de Números, WhatsApp, Agendador, E-Mail IA e Integrações não mostram selos de
 * simulação (as operações continuam passando pelos serviços simulados).
 */
export function OpStatus({
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
            <span>{cleanStepLabel(progress.label) || 'Processando…'}</span>
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

/** Só o erro (com repetir) — para fluxos em que a Fonio mostra apenas o spinner no botão enquanto processa. */
export function OpError({ error, onRetry, className }: { error?: string; onRetry?: () => void; className?: string }) {
  if (!error) return null
  return <OpStatus status="error" progress={{ label: '', percent: 0 }} error={error} onRetry={onRetry} className={className} />
}
