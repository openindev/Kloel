import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Normaliza o endereço digitado (remove protocolo, barra final, espaços). */
export function normalizeSite(input: string) {
  return input.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase()
}

/** Domínio reconhecível (ex.: minhaempresa.com.br). */
export function isValidSite(input: string) {
  const d = normalizeSite(input)
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)*\.[a-z]{2,}(\/.*)?$/i.test(d)
}

export function siteValidationMessage(input: string) {
  if (!input.trim()) return 'Digite o endereço do seu site.'
  if (!isValidSite(input)) return 'Digite um endereço de site válido, por exemplo minhaempresa.com.br.'
  return null
}

/** Hospedeiro (sem caminho) de um endereço válido; '' quando o endereço ainda não é reconhecível. */
export function siteHost(input: string) {
  return isValidSite(input) ? normalizeSite(input).split('/')[0]! : ''
}

/**
 * Favicon real do site digitado (E6 — referências 3. Webchat de IA novo/01.png e 01a. Gerar minha IA/01.png: com "klo" o campo
 * mostra o globo cinza; com "kloel.com" o globo vira o favicon do domínio, quadrado de 20 px). O ícone vem do serviço público de
 * favicons por domínio da DuckDuckGo (o mesmo desenho visto na referência para kloel.com) e, na falta dele, do /favicon.ico do
 * próprio site. Enquanto carrega, sem rede ou sem ícone, fica o globo. O domínio só é consultado depois de 300 ms sem digitação.
 */
const FAVICON_TIMEOUT_MS = 5000
const faviconSources = (host: string) => [`https://icons.duckduckgo.com/ip3/${host}.ico`, `https://${host}/favicon.ico`]

function loadFavicon(host: string, signal: { cancelled: boolean }, done: (src: string | null) => void) {
  const sources = faviconSources(host)
  const attempt = (i: number) => {
    if (signal.cancelled) return
    const src = sources[i]
    if (!src) return done(null)
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    const timer = setTimeout(() => { img.src = ''; attempt(i + 1) }, FAVICON_TIMEOUT_MS)
    img.onload = () => {
      clearTimeout(timer)
      if (signal.cancelled) return
      // sem ícone conhecido, o serviço responde 404 com um círculo cinza genérico de 48×48: trata como ausência
      if (i === 0 && img.naturalWidth === 48 && img.naturalHeight === 48) return attempt(i + 1)
      done(src)
    }
    img.onerror = () => { clearTimeout(timer); attempt(i + 1) }
    img.src = src
  }
  attempt(0)
}

export function SiteFavicon({ site, className }: { site: string; className?: string }) {
  const host = siteHost(site)
  const [icon, setIcon] = useState<{ host: string; src: string | null } | null>(null)
  useEffect(() => {
    if (!host) return
    const signal = { cancelled: false }
    const t = setTimeout(() => loadFavicon(host, signal, (src) => setIcon({ host, src })), 300)
    return () => { signal.cancelled = true; clearTimeout(t) }
  }, [host])
  const src = host && icon?.host === host ? icon.src : null
  if (!src) return <Globe className={cn('h-5 w-5 shrink-0 text-slate-400', className)} aria-hidden data-testid="site-favicon-globe" />
  return <img src={src} alt="" aria-hidden referrerPolicy="no-referrer" className={cn('h-5 w-5 shrink-0 rounded-[5px] object-contain', className)} data-testid="site-favicon" data-host={host} />
}

/** Fator de velocidade das simulações (localStorage kloel-demo:speed — usado nos testes automatizados). */
export function speedFactor() {
  try {
    const v = Number(window.localStorage.getItem('kloel-demo:speed'))
    return Number.isFinite(v) && v > 0 ? v : 1
  } catch {
    return 1
  }
}

export const newDemoId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

export function demoUrl(site?: string, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ productType: 'webchat', ...(site ? { website: normalizeSite(site) } : {}), language: 'pt-BR', id: newDemoId(), ...extra })
  return `/demo-ia?${p.toString()}`
}
