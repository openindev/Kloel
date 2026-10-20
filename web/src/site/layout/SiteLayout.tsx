import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'

/** Recarregar ou voltar/avançar entre documentos: o navegador / ScrollRestoration já restauram a posição. */
function isRestoreLoad() {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return nav?.type === 'reload' || nav?.type === 'back_forward'
  } catch {
    return false
  }
}

/**
 * Layout do site público (header sticky + footer). Sem barra/balão flutuante de "Agendar demo" (a Fonio não tem; E2).
 * Rolagem:
 * - mudança de página (pathname) por link → topo;
 * - URL com âncora (ex.: /parceiros#faq) → rola até a seção, tentando de novo enquanto a página monta;
 * - mudança só de query (?departamento=, ?busca=, ?release=…) ou remoção da âncora → mantém a posição (filtros e diálogos na URL);
 * - voltar/avançar (POP) → restauração do navegador (ScrollRestoration no RootLayout).
 */
export function SiteLayout() {
  const loc = useLocation()
  const navType = useNavigationType()
  const prev = useRef<{ pathname: string; hash: string } | null>(null)
  useEffect(() => {
    const before = prev.current
    prev.current = { pathname: loc.pathname, hash: loc.hash }
    const first = before === null
    const pathChanged = first || before.pathname !== loc.pathname
    const hashChanged = first || before.hash !== loc.hash
    if (loc.hash && hashChanged && (navType !== 'POP' || (first && !isRestoreLoad()))) {
      const id = decodeURIComponent(loc.hash.slice(1))
      let tries = 0
      let t: ReturnType<typeof setTimeout>
      const go = () => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ block: 'start' })
        else if (tries++ < 10) t = setTimeout(go, 50)
      }
      t = setTimeout(go, 0)
      return () => clearTimeout(t)
    }
    if (!first && pathChanged && !loc.hash && navType !== 'POP') window.scrollTo(0, 0)
  }, [loc.pathname, loc.hash, navType])
  return (
    <div className="min-h-svh bg-white font-site text-ink">
      <SiteHeader />
      <Outlet />
      <SiteFooter />
    </div>
  )
}
