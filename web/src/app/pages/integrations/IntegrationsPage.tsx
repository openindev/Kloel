import { captureEngineContext } from '@/services/engine/session'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Bell, BellRing, Check, ExternalLink, KeyRound, Search, SearchX } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import {
  INTEGRATIONS,
  INTEGRATION_ALL_CATEGORY,
  INTEGRATION_CATEGORIES,
  INTEGRATION_CTA,
  INTEGRATION_STATUS_BADGE_CLASS,
  INTEGRATION_STATUS_LABEL,
  type CatalogIntegration,
  type IntegrationCategory,
} from '@/data/catalogs/integrations'
import { useCollection, useStore } from '@/data/store'
import { PageTitle } from '@/components/app/Page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IntegrationLogo } from '@/components/brand/IntegrationLogo'
import { cn } from '@/lib/utils'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'

/** "/whatsapp" (rota original da Fonio) → "/app/whatsapp". */
export const internalPath = (p: string) => (p.startsWith('/app') ? p : `/app${p}`)

/**
 * Guia da integração → artigo local da Central de ajuda: `/ajuda/${cta.path}` (o caminho do catálogo já é
 * um caminho de ajuda, podendo incluir âncora, ex.: phone-systems/sip-numbers#twilio).
 */
export function guideHref(path: string) {
  return `/ajuda/${path.replace(/^\/+/, '')}`
}

const ALL = INTEGRATION_ALL_CATEGORY
type Cat = typeof ALL | IntegrationCategory

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR')

/** Ícones lucide dos CTAs (nomes no DOM da Fonio, catálogo INTEGRATION_CTA). */
const CTA_ICON = { 'arrow-right': ArrowRight, 'external-link': ExternalLink, 'key-round': KeyRound, bell: Bell } as const

/**
 * OBSERVADO (fonio-live2/J-integracoes + data/integrations.json): 113 cartões na ordem do catálogo, categoria única por
 * cartão (CRM 23, Agenda 8, Comunicação 6, PABX 17, E-commerce 5, Automação 14, Saúde 10, Gestão de imóveis 11, Hotelaria 11,
 * Beleza & Fitness 4, Ofícios 4); status, badge e CTA vêm dos campos do catálogo (27 Disponível · 20 Acesso antecipado ·
 * 66 Em breve). Ícone depois do texto nos links ("Começar agora! →", "Abrir guia ↗") e antes nos botões (🔑, 🔔).
 */
export default function IntegrationsPage() {
  const load = usePageLoad('integrations')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const q = params.get('q') ?? ''
  const catParam = params.get('categoria')
  const cat: Cat = INTEGRATION_CATEGORIES.includes(catParam as IntegrationCategory) ? (catParam as IntegrationCategory) : ALL
  // "Solicitar acesso" / "Notificar": gravados no motor (/integration-requests).
  const [requests, setRequests] = useState<{ integration: string; kind: string; requestedAt: string }[]>([])
  useEffect(() => { const c = captureEngineContext(); void c.request<{ items: { integration: string; kind: string; requestedAt: string }[] }>('/integration-requests').then(r => { c.assertCurrent(); setRequests(r.items) }).catch(() => {}) }, [])
  const requested = useMemo(() => new Map(requests.map((r) => [r.integration, r])), [requests])

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const list = useMemo(() => {
    const term = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return INTEGRATIONS.filter((i) => {
      if (cat !== ALL && i.category !== cat) return false
      if (!term) return true
      const hay = `${i.name} ${i.description} ${i.category}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      return hay.includes(term)
    })
  }, [q, cat])

  const request = async (it: CatalogIntegration) => {
    try { const c = captureEngineContext(); const r = await c.request<{ integration: string; kind: string; requestedAt: string }>('/integration-requests', { method: 'POST', body: { integration: it.slug, kind: 'request' } }); setRequests(x => [...x.filter(y => y.integration !== it.slug), r]); toast.success('Acesso solicitado', { description: `Avisaremos quando ${it.name} for liberado para sua conta.` }) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível solicitar o acesso.') }
  }
  const toggleNotify = async (it: CatalogIntegration) => {
    const on = requested.has(it.slug)
    try {
      const c = captureEngineContext()
      if (on) { await c.request(`/integration-requests/${encodeURIComponent(it.slug)}/notify`, { method: 'DELETE' }); setRequests(x => x.filter(y => y.integration !== it.slug)); toast.success('Notificação cancelada') }
      else { const r = await c.request<{ integration: string; kind: string; requestedAt: string }>('/integration-requests', { method: 'POST', body: { integration: it.slug, kind: 'notify' } }); setRequests(x => [...x, r]); toast.success('Você será notificado', { description: `Avisaremos quando ${it.name} estiver disponível.` }) }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.') }
  }

  if (load.isLoading || load.isError) {
    return (
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[1200px]">{load.isError ? <PageLoadError onRetry={load.retry} /> : <PageSkeleton rows={6} />}</div>
      </div>
    )
  }

  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <div className="mx-auto w-full max-w-[1200px]">
        <PageTitle className="mb-4 md:mb-8">Integrações</PageTitle>
        <p className="mb-6 text-muted-foreground">
          Aqui você tem uma visão geral de todas as integrações. Para adicionar uma, abra seu assistente e acesse “Integrações”.
        </p>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setParam('q', e.target.value)} placeholder="Pesquisar" aria-label="Pesquisar integrações" className="h-10 pl-9" />
        </div>

        <h2 className="mb-4 mt-8 text-lg font-semibold">Escolha uma categoria</h2>
        <div className="flex gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible" role="radiogroup" aria-label="Categoria">
          {[ALL, ...INTEGRATION_CATEGORIES].map((c) => {
            const active = c === cat
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setParam('categoria', c === ALL ? null : c)}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {c}
              </button>
            )
          })}
        </div>

        {list.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <SearchX className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-medium">Nenhuma integração encontrada</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {q ? <>Não encontramos integrações para “{q}”{cat !== ALL ? <> em {cat}</> : null}.</> : <>Não há integrações nesta categoria.</>}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Limpar busca e filtros
            </Button>
          </div>
        ) : (
          // A Fonio exibe todos os cartões de uma vez (sem "Carregar mais" nem contador).
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" data-testid="integrations-grid">
            {list.map((it) => {
              const req = requested.get(it.slug)
              const cta = INTEGRATION_CTA[it.cta.kind]
              const Icon = CTA_ICON[cta.icon]
              return (
                <div key={it.slug} className="flex h-full flex-col rounded-lg border bg-card text-card-foreground shadow-sm" data-testid="integration-card" data-status={it.status}>
                  <div className="flex flex-1 flex-col gap-4 p-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border bg-background">
                        <IntegrationLogo slug={it.slug} name={it.name} className="h-7 w-7" surface="app" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-lg font-semibold leading-tight">{it.name}</p>
                        <span className={cn('mt-1.5 inline-flex items-center rounded-full border border-transparent px-3 py-0.5 text-sm font-semibold', INTEGRATION_STATUS_BADGE_CLASS[it.status])}>
                          {INTEGRATION_STATUS_LABEL[it.status]}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{it.description}</p>
                    <div className="mt-auto pt-1">
                      {it.cta.kind === 'internal' ? (
                        <Button variant={cta.variant} size="sm" className="w-full gap-1.5" onClick={() => it.cta.kind === 'internal' && navigate(internalPath(it.cta.path))}>
                          {cta.label} <Icon className="h-3.5 w-3.5" />
                        </Button>
                      ) : it.cta.kind === 'guide' ? (
                        <Button variant={cta.variant} size="sm" className="w-full gap-1.5" asChild>
                          <a href={guideHref(it.cta.path)} target="_blank" rel="noreferrer">
                            {cta.label} <Icon className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      ) : it.cta.kind === 'notify' ? (
                        <Button variant={cta.variant} size="sm" className="w-full gap-1.5" aria-pressed={!!req} onClick={() => toggleNotify(it)} data-testid="notify-me">
                          {req ? <BellRing className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                          {req ? 'Você será notificado' : cta.label}
                        </Button>
                      ) : req ? (
                        <Button variant={cta.variant} size="sm" className="w-full gap-1.5" disabled aria-label={`Acesso solicitado em ${fmtDate(req.requestedAt)}`}>
                          <Check className="h-3.5 w-3.5" /> Acesso solicitado · {fmtDate(req.requestedAt)}
                        </Button>
                      ) : (
                        <Button variant={cta.variant} size="sm" className="w-full gap-1.5" onClick={() => request(it)}>
                          <Icon className="h-3.5 w-3.5" /> {cta.label}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
