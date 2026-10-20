import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useStore, useUi } from '@/data/store'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { Switch } from '@/components/ui/switch'

const KEY = 'cookies:demo-ia'
const OPTIONS = [
  { key: 'necessary', label: 'Necessários', desc: 'Essenciais para a página funcionar (ex.: lembrar esta escolha). Sempre ativos.', locked: true },
  { key: 'preferences', label: 'Preferências', desc: 'Lembram ajustes como idioma.' },
  { key: 'statistics', label: 'Estatísticas', desc: 'Ajudam a entender o uso da página de forma agregada.' },
  { key: 'marketing', label: 'Marketing', desc: 'Personalizam anúncios e comunicações.' },
] as const

/**
 * Banner de cookies da página de demonstração (OBSERVADO nos vídeos em app.fonio.ai/demo).
 * Adaptação LGPD: categorias opcionais começam DESLIGADAS (na referência vinham ligadas). A escolha é persistida no store (ui.dismissed).
 * Nesta casca local nenhum cookie de rastreamento é criado.
 */
export function CookieBanner() {
  const ui = useUi()
  const setUi = useStore((s) => s.setUi)
  const [sel, setSel] = useState<Record<string, boolean>>({ necessary: true, preferences: false, statistics: false, marketing: false })
  const [details, setDetails] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const open = !ui.dismissed[KEY]
  // publica a altura real do banner em --cookie-banner-h: modais da página reservam esse espaço na base
  // (a 390px o banner cobria a última linha do modal "Último passo")
  useEffect(() => {
    const el = ref.current
    const root = document.documentElement
    if (!open || !el) {
      root.style.removeProperty('--cookie-banner-h')
      return
    }
    const set = () => root.style.setProperty('--cookie-banner-h', `${el.offsetHeight}px`)
    set()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--cookie-banner-h')
    }
  }, [open])
  if (!open) return null
  const save = (all: boolean) => {
    const choice = all ? { preferences: true, statistics: true, marketing: true } : sel
    setUi({ dismissed: { ...ui.dismissed, [KEY]: true, 'cookies:preferences': !!choice.preferences, 'cookies:statistics': !!choice.statistics, 'cookies:marketing': !!choice.marketing } })
  }
  return (
    <div ref={ref} className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white font-site shadow-[0_-10px_40px_-20px_rgba(15,15,22,.3)]" role="dialog" aria-label="Preferências de cookies">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:gap-8 lg:px-8">
        <KloelLogo className="hidden text-[24px] lg:inline-flex" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-heading">Este site utiliza cookies</div>
          <p className="mt-1 text-[14px] text-body">
            Utilizamos cookies para melhorar nosso site, analisar seu uso e fornecer recursos opcionais.{' '}
            <a href="/ajuda/legal/politica-de-privacidade" target="_blank" rel="noreferrer" className="font-medium text-brand-blue hover:underline">Política de Privacidade</a>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            {OPTIONS.map((o) => (
              <label key={o.key} className="flex items-center gap-2 text-[14px] font-medium text-heading">
                {o.label}
                <Switch checked={sel[o.key]} disabled={'locked' in o && o.locked} onCheckedChange={(v) => setSel((s) => ({ ...s, [o.key]: v }))} aria-label={o.label} />
              </label>
            ))}
            <button type="button" onClick={() => setDetails((v) => !v)} className="flex items-center gap-1 text-[14px] font-medium text-brand-blue">
              {details ? 'Ocultar detalhes' : 'Exibir detalhes'} {details ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          {details && (
            <ul className="mt-3 grid gap-1 text-[13px] text-body sm:grid-cols-2">
              {OPTIONS.map((o) => <li key={o.key}><b className="font-medium text-heading">{o.label}:</b> {o.desc}</li>)}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 gap-2 lg:mb-5 lg:w-[260px] lg:flex-col">
          <button type="button" onClick={() => save(true)} className="h-11 flex-1 rounded-lg bg-brand-blue lg:flex-none px-4 text-[15px] font-medium text-white hover:bg-[#4a4fe6]">Permitir todos</button>
          <button type="button" onClick={() => save(false)} className="h-11 flex-1 rounded-lg border-2 lg:flex-none border-brand-blue px-4 text-[15px] font-medium text-heading hover:bg-indigo-50">Permitir a seleção</button>
        </div>
      </div>
    </div>
  )
}
