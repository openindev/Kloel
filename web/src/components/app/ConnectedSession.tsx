import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { engineSession, useEngineSession } from '@/services/engine/session'
import { areaForPath, loadArea } from '@/services/casca/data'
import { OperationStatusView } from './misc'
import { PrivateSessionBoundary } from './PrivateSessionBoundary'

/** Same shell after loading. No extra navigation, banner, panel or technical footer. */
export function ConnectedSession({ children }: { children: ReactNode }) {
  const session = useEngineSession()
  const loc = useLocation()
  const area = areaForPath(loc.pathname)
  const key = `${session.generation}:${area}`
  const [loaded, setLoaded] = useState('')
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (session.phase !== 'authenticated' || session.validation !== 'ready') return
    let active = true
    setError(undefined)
    void loadArea(area).then(() => { if (active) setLoaded(key) }, e => { if (active) setError(e instanceof Error ? e.message : 'Não foi possível carregar os dados.') })
    return () => { active = false }
  }, [session.phase, session.validation, session.generation, area, retry])
  if (session.phase === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (session.phase === 'error') return <div data-engine-state="error" className="mx-auto max-w-xl p-8"><OperationStatusView status="error" progress={{ label: '', percent: 0 }} error={session.error} onRetry={() => void engineSession.refresh()} /></div>
  if (session.phase === 'organization_required') return <div data-engine-state="error" className="mx-auto max-w-xl p-8"><OperationStatusView status="error" progress={{ label: '', percent: 0 }} error="Sua conta precisa de acesso a uma organização." onRetry={() => void engineSession.refresh()} /></div>
  if (error) return <div data-engine-state="error" className="mx-auto max-w-xl p-8"><OperationStatusView status="error" progress={{ label: '', percent: 0 }} error={error} onRetry={() => setRetry(v => v + 1)} /></div>
  if (session.phase === 'loading' || loaded !== key) return <div data-engine-state="loading" role="status" aria-label="Carregando" className="flex min-h-[50vh] items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  return <PrivateSessionBoundary>{children}</PrivateSessionBoundary>
}
