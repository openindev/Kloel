import { useEffect, useMemo } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { ArrowRight, Home, Search, Sparkles, Scale } from 'lucide-react'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { useNoIndex } from '@/lib/useNoIndex'
import { HelpLayout } from '../components/HelpLayout'
import { ArticleBody, IntegrationTiles } from '../components/ArticleBody'
import { CopyPageMenu, FloatingAskBar, PageFeedbackBox, PrevNext, TableOfContents } from '../components/ArticleChrome'
import { blocksToMarkdown, parseDoc } from '../lib/markdown'
import { searchArticles } from '../lib/search'
import { useHelpUi } from '../lib/ui'
import { useHelpTitle } from '../lib/title'
import {
  ALL_ARTICLES, HELP_TABS, canonicalKey, firstArticleOfSection, getArticle, locateArticle, tabForSection, type HelpArticle,
} from '../content'
import { HELP_ALIASES } from '../content/nav'

export default function HelpArticlePage() {
  const { section = '', slug } = useParams()
  const { search, hash } = useLocation()

  if (!slug) {
    if (section === 'integrations') return <IntegrationsIndex />
    if (section === 'legal') return <LegalIndex />
    // seção que só existe em aliases (/ajuda/troubleshooting, /ajuda/channels…): o motor responde 200, então vai ao artigo canônico
    const first = firstArticleOfSection(section) ?? aliasSectionTarget(section)
    if (first) return <Navigate to={`/ajuda/${first}`} replace />
    return <HelpNotFound path={`/ajuda/${section}`} />
  }

  const raw = `${section}/${slug}`
  const key = canonicalKey(raw)
  if (!key) return <HelpNotFound path={`/ajuda/${raw}`} />
  // alias (/ajuda/legal/termos) não vira segunda cópia do artigo: troca a URL pela canônica, com consulta e âncora
  if (key !== raw) return <Navigate to={{ pathname: `/ajuda/${key}`, search, hash }} replace />
  return <ArticleView key={key} articleKey={key} article={getArticle(key)!} />
}

function aliasSectionTarget(section: string): string | undefined {
  for (const alias of Object.keys(HELP_ALIASES)) if (alias.startsWith(`${section}/`)) { const key = canonicalKey(alias); if (key) return key }
  return undefined
}

function useScrollToHash(dep: string) {
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const id = decodeURIComponent(hash.slice(1))
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 60)
    return () => window.clearTimeout(t)
  }, [dep, hash])
}

function ArticleView({ articleKey, article }: { articleKey: string; article: HelpArticle }) {
  const doc = useMemo(() => parseDoc(article.body), [article.body])
  const loc = locateArticle(articleKey)
  const markdown = useMemo(
    () => `# ${article.title}\n\n> ${article.description}\n\n${blocksToMarkdown(doc.blocks)}\n\n---\nFonte: Central de ajuda da Kloel — /ajuda/${articleKey}\n`,
    [article, doc, articleKey],
  )
  useHelpTitle(article.title)
  useScrollToHash(articleKey)

  const prev = loc.index > 0 ? loc.sequence[loc.index - 1] : undefined
  const next = loc.index >= 0 && loc.index < loc.sequence.length - 1 ? loc.sequence[loc.index + 1] : undefined
  const related = (article.related ?? []).map((k) => canonicalKey(k)).filter((k): k is string => !!k && k !== articleKey)
  const uniqueRelated = [...new Set(related)].slice(0, 4)

  return (
    <HelpLayout activeTab={loc.tab.id} activeKey={articleKey}>
      <div className="flex justify-center gap-12 px-5 pb-6 pt-8 sm:px-8 lg:pl-10 lg:pr-12 lg:pt-10 lg:max-xl:group-data-[ask=open]/help:px-6">
        {/* @container: com o assistente aberto em 1024–1279 px a coluna fica estreita e o título empilha (como no celular) */}
        <article className="@container w-full min-w-0 max-w-[46rem]" data-article={articleKey}>
          <header>
            <p className="mb-2 text-sm font-semibold text-brand">{loc.group.label}</p>
            <div className="flex flex-col gap-3 @md:flex-row @md:items-start @md:justify-between @md:gap-6" data-title-row>
              <h1 className="min-w-0 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">{article.title}</h1>
              <div className="shrink-0 self-start @md:pt-1.5">
                <CopyPageMenu markdown={markdown} title={article.title} pageKey={articleKey} />
              </div>
            </div>
            <p className="mt-3 text-lg leading-7 text-zinc-600">{article.description}</p>
          </header>
          <div className="mt-8">
            <ArticleBody blocks={doc.blocks} />
          </div>

          {uniqueRelated.length > 0 && (
            <section className="mt-12" aria-label="Artigos relacionados">
              <h2 className="mb-3 text-sm font-semibold text-zinc-900">Artigos relacionados</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {uniqueRelated.map((k) => {
                  const a = getArticle(k)!
                  return (
                    <Link key={k} to={`/ajuda/${k}`} className="group rounded-xl border border-zinc-200 px-4 py-3 transition-colors hover:border-brand/50">
                      <span className="flex items-center justify-between gap-2 text-sm font-medium text-zinc-900">
                        {a.title}
                        <ArrowRight className="size-3.5 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-zinc-500">{a.description}</span>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          <PageFeedbackBox pageKey={articleKey} />
          <PrevNext prev={prev} next={next} />
          <HelpFooter />
        </article>
        <aside className="hidden w-[15.5rem] shrink-0 xl:block xl:group-data-[ask=open]/help:hidden">
          <div className="sticky top-[153px] max-h-[calc(100svh-180px)] overflow-y-auto pb-8">
            <TableOfContents items={doc.toc} />
          </div>
        </aside>
      </div>
      <FloatingAskBar />
    </HelpLayout>
  )
}

function HelpFooter() {
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pb-4 pt-6 text-xs text-zinc-400">
      <Link to="/ajuda" aria-label="Início da central de ajuda">
        <KloelLogo size="sm" className="opacity-70" />
      </Link>
      <span>Central de ajuda da Kloel</span>
    </footer>
  )
}

function IndexShell({ tabId, eyebrow, title, lead, children }: { tabId: 'get-started' | 'integrations'; eyebrow: string; title: string; lead: string; children: React.ReactNode }) {
  useHelpTitle(title)
  return (
    <HelpLayout activeTab={tabId}>
      <div className="flex justify-center px-5 pb-6 pt-8 sm:px-8 lg:pl-10 lg:pr-12 lg:pt-10">
        <div className="w-full min-w-0 max-w-[46rem]">
          <p className="mb-2 text-sm font-semibold text-brand">{eyebrow}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-lg leading-7 text-zinc-600">{lead}</p>
          <div className="mt-8">{children}</div>
          <HelpFooter />
        </div>
      </div>
      <FloatingAskBar />
    </HelpLayout>
  )
}

function IntegrationsIndex() {
  return (
    <IndexShell tabId="integrations" eyebrow="Integrações" title="Integrações" lead="Conecte seu assistente aos sistemas que você já usa. Escolha uma integração para ver o passo a passo.">
      <IntegrationTiles />
    </IndexShell>
  )
}

function LegalIndex() {
  const docs = ['legal/termos-e-condicoes', 'legal/politica-de-privacidade', 'legal/protecao-de-dados', 'legal/aviso-legal']
  return (
    <IndexShell tabId="get-started" eyebrow="Legal" title="Documentos legais" lead="Termos, privacidade e proteção de dados da Kloel.">
      <div className="grid gap-3 sm:grid-cols-2">
        {docs.map((k) => {
          const a = getArticle(k)!
          return (
            <Link key={k} to={`/ajuda/${k}`} className="group rounded-2xl border border-zinc-200 p-5 transition-colors hover:border-brand/50">
              <Scale className="size-4 text-zinc-400 group-hover:text-brand" />
              <p className="mt-3 font-semibold text-zinc-900">{a.title}</p>
              <p className="mt-1 text-sm leading-6 text-zinc-600">{a.description}</p>
            </Link>
          )
        })}
      </div>
    </IndexShell>
  )
}

function HelpNotFound({ path }: { path: string }) {
  const openSearch = useHelpUi((s) => s.openSearch)
  const openAsk = useHelpUi((s) => s.openAsk)
  const words = (path.split('/').pop() ?? '').split(/[_-]+/).filter((w) => w.length > 2)
  const suggestions = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const w of words) for (const r of searchArticles(w, 5)) if (r.score >= 5 && !seen.has(r.key)) (seen.add(r.key), out.push(r.key))
    return out.slice(0, 4)
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps
  const sectionTab = tabForSection(path.split('/')[2] ?? '')
  useHelpTitle('Página não encontrada')
  useNoIndex()
  return (
    // seção desconhecida: nenhuma aba aparece ativa (como na home); seção conhecida mantém a aba dela
    <HelpLayout activeTab={sectionTab?.id ?? 'get-started'} showActiveTab={!!sectionTab}>
      <div className="flex justify-center px-5 pb-16 pt-16 sm:px-8 lg:pt-24" data-help-404>
        <div className="w-full max-w-[34rem] text-center">
          <p className="text-sm font-semibold text-brand">Erro 404</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">Página não encontrada</h1>
          <p className="mt-3 text-[15px] leading-7 text-zinc-600">
            Não encontramos <span className="break-all rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[13px] text-zinc-800">{path}</span> nesta central. O endereço pode ter mudado ou o artigo ainda não existe.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link to="/ajuda" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white hover:bg-zinc-800">
              <Home className="size-4" /> Início da central
            </Link>
            <button type="button" onClick={openSearch} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-sm font-medium hover:bg-zinc-50">
              <Search className="size-4" /> Buscar artigos
            </button>
            <button type="button" onClick={() => openAsk()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-sm font-medium hover:bg-zinc-50">
              <Sparkles className="size-4 text-brand" /> Perguntar ao assistente
            </button>
          </div>
          <div className="mt-10 text-left">
            <p className="mb-2 text-sm font-semibold text-zinc-900">{suggestions.length ? 'Talvez você procure' : 'Artigos populares'}</p>
            <div className="space-y-2">
              {(suggestions.length ? suggestions : ['get-started/first-steps', 'get-started/connect-your-number', 'get-started/troubleshooting']).map((k) => {
                const a = getArticle(k)
                if (!a) return null
                return (
                  <Link key={k} to={`/ajuda/${k}`} className="group flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3 hover:border-brand/50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-900">{a.title}</span>
                      <span className="block truncate text-xs text-zinc-500">{locateArticle(k).group.label}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-zinc-400 group-hover:text-brand" />
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </HelpLayout>
  )
}

// contagem exposta para inspeção/testes automatizados
if (typeof window !== 'undefined') {
  ;(window as unknown as { __kloelHelp?: unknown }).__kloelHelp = { articles: ALL_ARTICLES.length, tabs: HELP_TABS.map((t) => t.id) }
}
