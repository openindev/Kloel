import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCcw, CloudOff } from 'lucide-react'
import { useStore } from '@/data/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { loadArea, areaForPath } from '@/services/casca/data';

/** The route boundary loads data before mount; retry refreshes its actual API projection. */
export function usePageLoad(key: string, _delayMs = 350) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('ready')
  const attempt = useRef(0)
  useEffect(() => { attempt.current++; setStatus('ready'); return () => { attempt.current++ } }, [key])
  const run = useCallback(() => {
    const current = ++attempt.current
    setStatus('loading')
    void loadArea(areaForPath(window.location.pathname), true).then(
      () => { if (current === attempt.current) setStatus('ready') },
      () => { if (current === attempt.current) setStatus('error') },
    )
  }, [key])
  return { status, retry: run, isLoading: status === 'loading', isError: status === 'error' }
}

export function PageSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('animate-pulse space-y-3', className)} aria-busy="true" aria-label="Carregando">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="h-10 w-full max-w-md rounded-md bg-muted" />
      <div className="space-y-2 rounded-xl border p-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-9 rounded-md bg-muted/70" />
        ))}
      </div>
    </div>
  )
}

export function PageLoadError({ onRetry, title = 'Não foi possível carregar os dados', description = 'Ocorreu um erro ao carregar esta página. Nenhum dado foi perdido.', className }: { onRetry: () => void; title?: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <section role="alert" data-engine-state="error" className={cn('mx-auto w-full max-w-xl rounded-xl border px-8 py-12 text-center', className)}>
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-destructive">
        <CloudOff className="size-5" />
      </div>
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      <Button className="mt-6 gap-1.5" variant="outline" onClick={onRetry}>
        <RotateCcw className="h-4 w-4" /> Tentar novamente
      </Button>
    </section>
  )
}
