import { useState } from 'react'
import { cn } from '@/lib/utils'
import { INTEGRATIONS, integrationBySlug, type CatalogIntegration } from '@/data/catalogs/integrations'
import { AGENT_LOGOS, BRAND_LOGOS, LOGO_FILES, SITE_LOGOS } from '@/data/catalogs/integration-logos'
import { Monogram } from './KloelLogo'

/**
 * Logo de integração = o arquivo ORIGINAL exibido pela Fonio (pedido do operador, problema E5), baixado e higienizado por
 * scripts/fetch-integration-logos.mjs em public/integrations/ e servido localmente:
 *  - app (/app/integrations, ajuda): arquivo de app.fonio.ai/images/integrations (campo `logo` do catálogo);
 *  - assistente (/app/agents/…: diálogo "Adicionar integração" e lista da folha Integrações): o ícone próprio do manifesto que
 *    a Fonio mostra ali (Airtable sem margem, Google Sheets 100×100, n8n rosa, wordmark "_zapier", Slack/Notion maiores,
 *    GoHighLevel arredondado — public/integrations/agent/, AGENT_LOGOS); Baserow, Make, Stora e WinCasa usam o arquivo do app;
 *  - site público (/integracoes, hero, órbitas): a imagem própria do site quando a Fonio tem uma (Storyblok/www), senão a
 *    mesma do app; itens só do site (Wix, Oracle OPERA, mydr EDM, Topchef) usam o arquivo do site.
 * Monograma só quando não existe arquivo (nome desconhecido) ou se a imagem falhar ao carregar.
 *
 * Tamanhos da Fonio por tela (o chamador passa as classes): /app/integrations caixa h-12 w-12 rounded-lg border, img h-7 w-7;
 * diálogo do assistente img size-8 object-contain; diretório do site caixa size-12 rounded-md border bg-white, img size-6
 * rounded-[0.25rem] (Em breve: caixa opacity-50 grayscale); hero do site círculos size-16/14/12/10 com img size-7/6/5/5.
 */

/** Normalizador de nomes (sem acentos, minúsculas, só [a-z0-9] separados por espaço). */
export const normLogoName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const compact = (s: string) => normLogoName(s).replace(/ /g, '')

/** URL de um arquivo de public/ respeitando o `base` do Vite. */
export const publicAsset = (file: string) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/, '')}`

/** Slugs e nomes alternativos usados pelas telas (artigos da ajuda, site, mockups) → slug do catálogo. */
const ALIASES: Record<string, string> = {
  makecom: 'make',
  simplybook: 'simplybook-me',
  oddo: 'odoo',
  whatsapp: 'whatsapp-business',
  gmail: 'google-mail',
  googleagenda: 'google-calendar',
  googlemaps: 'google-address-validation',
  outlook: 'microsoft-outlook-mail',
  microsoftoutlook: 'microsoft-outlook-mail',
}

const CATALOG_BY_KEY = new Map<string, CatalogIntegration>()
for (const i of INTEGRATIONS) {
  CATALOG_BY_KEY.set(compact(i.slug), i)
  if (!CATALOG_BY_KEY.has(compact(i.name))) CATALOG_BY_KEY.set(compact(i.name), i)
}
const SITE_BY_KEY = new Map(Object.entries(SITE_LOGOS).map(([name, file]) => [compact(name), file]))

function findCatalog(slug?: string, name?: string): CatalogIntegration | undefined {
  const direct = integrationBySlug(slug)
  if (direct) return direct
  for (const key of [slug, name]) {
    if (!key) continue
    const k = compact(key)
    const hit = CATALOG_BY_KEY.get(k) ?? integrationBySlug(ALIASES[k])
    if (hit) return hit
  }
  return undefined
}

export type LogoSurface = 'app' | 'agent' | 'site'

/**
 * Pela rota: /app/agents/… = assistente (ícones do diálogo "Adicionar integração"); demais /app e /ajuda = app (a central de
 * ajuda usa os logos do app); o resto = site público.
 */
const inferSurface = (): LogoSurface => {
  if (typeof window === 'undefined') return 'app'
  const p = window.location.pathname
  if (/^\/app\/agents(\/|$)/.test(p)) return 'agent'
  return /^\/(app|ajuda)(\/|$)/.test(p) ? 'app' : 'site'
}

/** Arquivo (relativo a public/) do logo original para o slug/nome, ou undefined quando não há arquivo. */
export function resolveIntegrationLogo(slug?: string, name?: string, surface: LogoSurface = inferSurface()): string | undefined {
  const entry = findCatalog(slug, name)
  const site = (n?: string) => (n ? SITE_BY_KEY.get(compact(n)) : undefined)
  if (surface === 'agent') {
    const own = AGENT_LOGOS[entry?.slug ?? slug ?? '']
    if (own) return own
  }
  if (surface === 'site') {
    const own = site(name) ?? site(entry?.name)
    if (own) return own
  }
  if (entry && LOGO_FILES[entry.logo]) return entry.logo
  return site(name) ?? site(slug)
}

/** URL pronta do logo original (para quem precisa só do src, ex.: selo do WhatsApp no diálogo Criar assistente). */
export const integrationLogoSrc = (slugOrName: string, surface: LogoSurface = 'app') => {
  const file = resolveIntegrationLogo(slugOrName, slugOrName, surface)
  return file ? publicAsset(file) : undefined
}

/**
 * props: `slug` (id do catálogo, preferencial) e `name` (nome exibido; também alt e monograma). `className` vale para
 * logo e monograma; `logoClassName`, quando informado, substitui `className` só na imagem. `surface` força app/agent/site
 * (padrão: pela rota). `decorative` deixa alt="" quando o nome já está escrito ao lado (como no site da Fonio).
 */
export function IntegrationLogo({
  slug,
  name,
  className,
  logoClassName,
  surface,
  decorative,
}: {
  slug?: string
  name: string
  className?: string
  logoClassName?: string
  surface?: LogoSurface
  decorative?: boolean
}) {
  const file = resolveIntegrationLogo(slug, name, surface)
  const [failed, setFailed] = useState<string | null>(null)
  if (file && failed !== file) {
    return (
      <img
        src={publicAsset(file)}
        alt={decorative ? '' : name}
        className={cn('h-7 w-7 shrink-0 object-contain', logoClassName ?? className)}
        decoding="async"
        draggable={false}
        data-integration-logo={file}
        onError={() => setFailed(file)}
      />
    )
  }
  return <Monogram name={name} className={className} />
}

/** Marcas de terceiros da página Bônus grátis, com o tamanho de cada uma na Fonio (K-admin/14-bonus-gratis.txt). */
export type BrandLogoKey = keyof typeof BRAND_LOGOS
export const BRAND_LOGO_META: Record<BrandLogoKey, { alt: string; className: string }> = {
  omr: { alt: 'OMR', className: 'h-10' },
  capterra: { alt: 'Capterra', className: 'h-6' },
  g2: { alt: 'G2', className: 'h-7 rounded ml-1' },
  linkedin: { alt: 'LinkedIn', className: 'h-6 ml-1' },
  youtube: { alt: 'YouTube', className: 'h-6' },
}

export function BrandLogo({ brand, className }: { brand: BrandLogoKey; className?: string }) {
  const meta = BRAND_LOGO_META[brand]
  return <img src={publicAsset(BRAND_LOGOS[brand])} alt={meta.alt} className={cn('w-auto shrink-0 object-contain', meta.className, className)} decoding="async" draggable={false} data-brand-logo={brand} />
}
