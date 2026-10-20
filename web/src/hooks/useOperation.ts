import { useCallback, useRef, useState } from 'react'
import type { ProgressFn } from '@/services/runtime'

export type OperationStatus = 'idle' | 'running' | 'success' | 'error'

/**
 * Ciclo de vida de uma operação simulada: iniciar → processar (progresso) → concluir | falhar → repetir.
 */
export function useOperation<TArgs extends unknown[], TResult>(fn: (onProgress: ProgressFn, ...args: TArgs) => Promise<TResult>) {
  const [status, setStatus] = useState<OperationStatus>('idle')
  const [progress, setProgress] = useState({ step: 0, total: 0, label: '', percent: 0 })
  const [result, setResult] = useState<TResult | undefined>()
  const [error, setError] = useState<string | undefined>()
  const lastArgs = useRef<TArgs | null>(null)

  const run = useCallback(
    async (...args: TArgs) => {
      lastArgs.current = args
      setStatus('running')
      setError(undefined)
      setProgress({ step: 0, total: 0, label: '', percent: 0 })
      try {
        const r = await fn((p) => setProgress(p), ...args)
        setResult(r)
        setStatus('success')
        return r
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro desconhecido')
        setStatus('error')
        return undefined
      }
    },
    [fn],
  )
  const retry = useCallback(() => (lastArgs.current ? run(...lastArgs.current) : undefined), [run])
  const reset = useCallback(() => {
    setStatus('idle')
    setError(undefined)
    setResult(undefined)
  }, [])
  return { status, progress, result, error, run, retry, reset, isRunning: status === 'running' }
}
