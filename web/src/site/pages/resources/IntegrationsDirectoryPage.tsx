import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Blocks, BookOpen, Building2, CalendarDays, ChevronDown, Contact, HeartPulse, MessageSquare, Search, SearchX, ShoppingBag, Sparkles, Stethoscope, UtensilsCrossed, Wrench, X, ArrowRight, BellRing,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { IntegrationLogo } from '@/components/brand/IntegrationLogo'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageTitle } from '@/site/components/usePageTitle'
import { useReturnFocus } from '@/site/layout/useReturnFocus'
import { Chip, FinalCtaBand, GradientHero, SiteHeading, siteButton } from '../company/kit'
import { LeadDialog } from '../company/LeadDialog'
import { ALL_DIRECTORY_ITEMS, DIRECTORY_CATEGORIES, EXTRA_STEP, HERO_ICONS, catalogEntry, type DirectoryCategoryId, type DirectoryItem } from './integrations-directory'

const CAT_ICON: Record<(typeof DIRECTORY_CATEGORIES)[number]['icon'], typeof CalendarDays> = {
  calendar: CalendarDays, message: MessageSquare, contact: Contact, bag: ShoppingBag, building: Building2, sparkles: Sparkles, utensils: UtensilsCrossed, stethoscope: Stethoscope, heart: HeartPulse,
}
/**
 * Fundo do hero de [16] (amostrado a 1470 px): laterais em ciano-claro → azul → índigo (#6167F4) só na base e elipse branca
 * central que desce até logo abaixo da busca. O gradiente padrão do kit (Parceiros) segue inalterado.
 */
const integrationsGlowStyle: CSSProperties = {
  backgroundImage: [
    'radial-gradient(42% 64% at 50% 28%, #ffffff 0%, #ffffff 70%, rgba(255,255,255,.55) 85%, rgba(255,255,255,0) 100%)',
    'linear-gradient(180deg, #ffffff 0%, #ffffff 24%, #fbfdff 27%, #eff9fa 33%, #d8f0f3 41%, #c7e5f3 47%, #b8d7f1 54%, #a5c0f1 63%, #93a7f1 73%, #7f90f4 82%, #6e78f3 90%, #6167f4 99%)',
  ].join(','),
}

/** Tamanho da imagem por diâmetro do círculo do hero (px): 64→28, 56→24, 48→20, 40→20. */
const HERO_IMG: Record<number, number> = { 64: 28, 56: 24, 48: 20, 40: 20 }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** /integracoes — diretório público de integrações (OBSERVADO [16]–[24]). */
export default function IntegrationsDirectoryPage() {
  usePageTitle('Integrações')
  const [params, setParams] = useSearchParams()
  const q = params.get('busca') ?? ''
  const setQ = (v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v) n.set('busca', v)
        else n.delete('busca')
        return n
      },
      { replace: true, preventScrollReset: true },
    )
  const [active, setActive] = useState<DirectoryCategoryId | null>(null)
  const [detail, setDetail] = useState<DirectoryItem | null>(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [waitlist, setWaitlist] = useState<DirectoryItem | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const detailFocus = useReturnFocus(!!detail)

  // No celular a lista de categorias rola na horizontal: mantém a categoria ativa visível.
  useEffect(() => {
    const nav = navRef.current
    if (!nav || nav.scrollWidth <= nav.clientWidth + 1) return
    const btn = nav.querySelector<HTMLElement>('[aria-current="true"]')
    if (!btn) return
    nav.scrollTo({ left: btn.offsetLeft - nav.clientWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' })
  }, [active])

  // A busca cobre os cartões da referência e o restante do catálogo do app (ALL_DIRECTORY_ITEMS).
  const filtered = useMemo(() => (q.trim() ? ALL_DIRECTORY_ITEMS.filter((i) => norm(`${i.name} ${i.description}`).includes(norm(q.trim()))) : ALL_DIRECTORY_ITEMS), [q])
  const sections = DIRECTORY_CATEGORIES.map((c) => ({ ...c, items: filtered.filter((i) => i.category === c.id) })).filter((s) => s.items.length > 0)

  // ⌘K / Ctrl+K foca a busca (atalho observado no campo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Scroll-spy: categoria ativa acompanha a seção visível (OBSERVADO na sequência [16]→[24]): fica ativa a última
  // categoria cujo título já passou da metade superior da janela; no topo da página ([16]) nenhuma está ativa.
  const spy = useCallback(() => {
    const els = DIRECTORY_CATEGORIES.map((c) => document.getElementById(`cat-${c.id}`)).filter(Boolean) as HTMLElement[]
    if (!els.length) return
    let current: string | null = null
    for (const el of els) if (el.getBoundingClientRect().top <= window.innerHeight * 0.5) current = el.id
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
    if (atBottom) {
      // perto do fim: a última seção visível com topo dentro da tela vira a ativa
      const visible = els.filter((el) => el.getBoundingClientRect().top < window.innerHeight * 0.6)
      if (visible.length) current = visible[visible.length - 1]!.id
    }
    setActive(current ? (current.replace('cat-', '') as DirectoryCategoryId) : null)
  }, [])
  useEffect(() => {
    spy()
    window.addEventListener('scroll', spy, { passive: true })
    window.addEventListener('resize', spy)
    return () => {
      window.removeEventListener('scroll', spy)
      window.removeEventListener('resize', spy)
    }
  }, [spy, q])

  // Deslocamento da rolagem até a categoria: no desktop, só o header (71 px) + folga; no celular, a barra de chips
  // também fica fixa sob o header, então o título da seção precisa parar logo abaixo dela.
  const goTo = (id: DirectoryCategoryId) => {
    const el = document.getElementById(`cat-${id}`)
    if (!el) return
    const nav = navRef.current
    const aside = nav?.parentElement
    // barra de chips horizontal (celular): fica presa em `top` (71 px) com a própria altura
    const chipBar = nav && aside && getComputedStyle(nav).flexDirection === 'row' ? (parseFloat(getComputedStyle(aside).top) || 71) + aside.offsetHeight : 0
    const offset = chipBar ? chipBar + 12 : 96
    const top = el.getBoundingClientRect().top + window.scrollY - offset
    window.scrollTo({ top, behavior: 'smooth' })
    setActive(id)
  }

  return (
    <main className="font-site">
      <GradientHero style={integrationsGlowStyle}>
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
          {HERO_ICONS.map((ic) => (
            <span
              key={ic.name}
              className="absolute flex items-center justify-center rounded-full border border-[#EEEFF5] bg-white shadow-[0_4px_14px_rgba(15,15,22,.06)]"
              style={{ [ic.side]: ic.x, top: ic.top, width: ic.size, height: ic.size }}
            >
              {/* Fonio: círculos size-16/14/12/10 com a imagem em size-7/6/5/5 */}
              <span className="flex" style={{ width: HERO_IMG[ic.size] ?? 20, height: HERO_IMG[ic.size] ?? 20, fontSize: Math.max(9, Math.round(ic.size * 0.17)) }}>
                <IntegrationLogo name={ic.name} surface="site" decorative className="h-full w-full rounded-[6px] text-[length:inherit]" />
              </span>
            </span>
          ))}
        </div>
        <div className="relative mx-auto flex max-w-[860px] flex-col items-center px-5 pb-16 pt-16 text-center sm:pb-[71px] sm:pt-20">
          <Chip icon={<Blocks className="h-[18px] w-[18px] text-ink" />}>Integrações</Chip>
          <SiteHeading as="h1" size="hero" className="mt-4 max-w-[720px] sm:mt-[13px]">Conecte a Kloel aos sistemas que você já usa</SiteHeading>
          <p className="mt-5 max-w-[450px] text-[16px] leading-6 text-body sm:mt-[14px]">A Kloel conversa com seus clientes e registra os detalhes na agenda, no CRM e nas planilhas que sua equipe já utiliza.</p>
          <label className="relative mt-10 block w-full max-w-[352px] sm:mt-[37px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Pesquisar entre ${ALL_DIRECTORY_ITEMS.length} integrações...`}
              aria-label="Pesquisar integrações"
              className="h-11 w-full rounded-[10px] border border-line bg-white pl-10 pr-12 text-[15px] text-ink shadow-[0_6px_24px_rgba(15,15,22,.08)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            />
            {q ? (
              <button type="button" aria-label="Limpar busca" onClick={() => setQ('')} className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-site text-[11px] text-slate-400">⌘K</kbd>
            )}
          </label>
        </div>
      </GradientHero>

      <section className="mx-auto grid max-w-[1192px] grid-cols-[minmax(0,1fr)] gap-8 px-5 pb-20 pt-10 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-[86px] lg:pt-[59px]">
        <aside className="sticky top-[71px] z-10 min-w-0 self-start lg:top-[100px]">
          <nav ref={navRef} aria-label="Categorias de integrações" className="relative -mx-5 flex gap-2 overflow-x-auto bg-white px-5 py-3 no-scrollbar lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:bg-transparent lg:p-0">
            <div className="hidden pb-2 text-[14px] font-medium leading-5 text-ink lg:block">Conheça todas as integrações</div>
            {DIRECTORY_CATEGORIES.map((c) => {
              const Icon = CAT_ICON[c.icon]
              const has = sections.some((s) => s.id === c.id)
              const isActive = active === c.id && has
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!has}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => goTo(c.id)}
                  className={cn(
                    'group flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[10px] border px-3 py-2 text-left text-[14px] leading-5 transition-colors lg:gap-2 lg:border-transparent lg:px-0 lg:py-[6px]',
                    isActive ? 'border-brand-blue/40 text-heading' : 'border-slate-200 text-[#3F4454] hover:text-ink',
                    !has && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand-blue' : 'text-[#3F4454] group-hover:text-ink')} />
                  {c.label}
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="min-w-0 [overflow-anchor:none]">
          {sections.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 p-12 text-center" data-testid="integrations-empty">
              <SearchX className="h-8 w-8 text-slate-400" />
              <p className="text-[17px] text-ink">Nenhuma integração encontrada para “{q}”.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className={siteButton('outline', 'md')} onClick={() => setQ('')}>
                  Limpar busca
                </button>
                <button type="button" className={siteButton('dark', 'md')} onClick={() => setRequestOpen(true)}>
                  Solicitar integração
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-10">
            {sections.map((s) => (
              <DirectorySection key={s.id} id={s.id} label={s.label} items={s.items} query={q} onOpen={setDetail} />
            ))}
          </div>

          <div className="mt-10 border-t border-[#ECEDF5] pt-10">
            <div className="grid gap-4 sm:grid-cols-2">
              <HelpCard icon={<Blocks className="h-5 w-5" />} title="Falta alguma integração?" text="Conte para a gente de qual ferramenta você precisa e vamos avaliar a integração com a Kloel." action={<button type="button" className={siteButton('outline', 'md')} onClick={() => setRequestOpen(true)}>Solicitar integração</button>} />
              <HelpCard
                icon={<Wrench className="h-5 w-5" />}
                title="Precisa de um setup mais complexo?"
                text="Sejam conexões de API, workflows sob medida ou integração profunda com seus sistemas: agende uma conversa com nossos especialistas e a gente ajuda."
                action={
                  <Link to="/agendar-demo?source=integracoes" className={siteButton('outline', 'md')}>
                    Fale com um especialista
                  </Link>
                }
              />
            </div>
          </div>
        </div>
      </section>

      <FinalCtaBand />

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-[560px] gap-y-6 font-site sm:rounded-2xl" onCloseAutoFocus={detailFocus}>{detail && <Detail item={detail} onWaitlist={() => { setWaitlist(detail); setDetail(null) }} onRequest={() => { setDetail(null); setRequestOpen(true) }} />}</DialogContent>
      </Dialog>

      <LeadDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        kind="contact"
        payload={{ type: 'solicitar-integracao' }}
        initial={q ? { ferramenta: q } : undefined}
        title="Solicitar integração"
        description="Diga qual ferramenta você usa e como imagina a integração. Avaliamos todos os pedidos."
        fields={[
          { name: 'ferramenta', label: 'Ferramenta', required: true, half: true, placeholder: 'ex.: RD Station' },
          { name: 'site', label: 'Site da ferramenta', type: 'url', half: true, placeholder: 'ferramenta.com.br' },
          { name: 'email', label: 'Seu e-mail', type: 'email', required: true, placeholder: 'voce@empresa.com.br' },
          { name: 'uso', label: 'O que o assistente deveria fazer nessa ferramenta?', type: 'textarea', required: true },
        ]}
        submitLabel="Enviar pedido"
        successTitle="Pedido enviado!"
        successText="Obrigado! Avisaremos por e-mail quando a integração estiver disponível."
      />
      <LeadDialog
        open={!!waitlist}
        onOpenChange={(o) => !o && setWaitlist(null)}
        kind="contact"
        payload={{ type: 'lista-de-espera-integracao', integracao: waitlist?.name ?? '' }}
        title={`Avise-me: ${waitlist?.name ?? ''}`}
        description="Esta integração ainda não está disponível. Deixe seu e-mail e avisaremos no lançamento."
        fields={[{ name: 'email', label: 'Seu e-mail', type: 'email', required: true, placeholder: 'voce@empresa.com.br' }]}
        submitLabel="Avise-me"
        successTitle="Você está na lista!"
        successText="Enviaremos um e-mail assim que a integração for lançada."
      />
    </main>
  )
}

/**
 * Seção de uma categoria. Sem busca, mostra exatamente os cartões da referência ([16]–[24]); as demais integrações do
 * catálogo do app entram nos resultados da busca ("Pesquisar entre N integrações"), com pelo menos 6 por categoria e
 * "Carregar mais" (de 6 em 6) só nesse estado. A contagem volta ao início quando a busca muda.
 */
function DirectorySection({ id, label, items, query, onOpen }: { id: DirectoryCategoryId; label: string; items: DirectoryItem[]; query: string; onOpen: (it: DirectoryItem) => void }) {
  const base = items.filter((i) => !i.extra).length
  const initial = query.trim() ? Math.max(base, EXTRA_STEP) : base
  const [count, setCount] = useState(initial)
  useEffect(() => setCount(initial), [query, initial])
  const visible = items.slice(0, Math.max(count, 1))
  const remaining = query.trim() ? items.length - visible.length : 0
  return (
    <div id={`cat-${id}`} data-testid={`cat-${id}`} className="scroll-mt-[146px] lg:scroll-mt-24">
      <h2 className="text-[20px] font-medium leading-7 tracking-[-0.15px] text-heading">{label}</h2>
      <div className="mt-4 grid gap-4 sm:mt-[18px] sm:grid-cols-2">
        {visible.map((it) => (
          <button
            key={it.name}
            type="button"
            onClick={() => onOpen(it)}
            data-extra={it.extra ? 'true' : undefined}
            className={cn(
              'relative flex flex-col rounded-xl border bg-white p-4 pb-[17px] text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30',
              it.soon ? 'border-dashed border-slate-300' : 'border-line hover:shadow-[0_8px_30px_rgba(15,15,22,.07)]',
            )}
          >
            {it.soon && <span className="absolute right-4 top-4 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium tracking-[0.06em] text-ink">EM BREVE</span>}
            {it.earlyAccess && <span className="absolute right-4 top-4 rounded-full bg-[#EEF0FF] px-2 py-1 text-[11px] font-medium tracking-[0.06em] text-brand-blue">ACESSO ANTECIPADO</span>}
            {/* Fonio: relative flex size-12 shrink-0 items-center justify-center rounded-md border bg-white (+ opacity-50 grayscale em "Em breve") */}
            <span className={cn('relative flex size-12 shrink-0 items-center justify-center rounded-md border border-line bg-white', it.soon && 'opacity-50 grayscale')}>
              <IntegrationLogo slug={it.catalogSlug} name={it.name} surface="site" decorative logoClassName="size-6 rounded-[0.25rem] object-contain" className="size-6" />
            </span>
            <span className={cn('mt-[17px] block text-[16px] font-medium leading-6', it.soon ? 'text-slate-400' : 'text-heading')}>{it.name}</span>
            <span className={cn('mt-1 block text-[14px] leading-5', it.soon ? 'text-slate-400' : 'text-body')}>{it.description}</span>
          </button>
        ))}
      </div>
      {remaining > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setCount((c) => c + EXTRA_STEP)}
            className={cn(siteButton('outline', 'md'), 'gap-1.5')}
            aria-label={`Carregar mais integrações de ${label} (${remaining} restantes)`}
            data-testid={`more-${id}`}
          >
            Carregar mais ({remaining}) <ChevronDown className="h-4 w-4" />
          </button>
          <span className="text-[14px] text-body">
            Mostrando {visible.length} de {items.length}
          </span>
        </div>
      )}
    </div>
  )
}

function HelpCard({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action: ReactNode }) {
  return (
    // [23]: cartão cinza-claro com borda lilás, ícone em quadrado tracejado de 40 px, título 16 px e texto 14 px
    <div className="flex flex-col rounded-xl border border-line bg-[#F7F8FB] p-6">
      <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-dashed border-slate-300 text-body [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>
      <h3 className="mt-5 text-[16px] font-semibold leading-6 text-heading">{title}</h3>
      <p className="mt-1 flex-1 text-[14px] leading-5 text-body">{text}</p>
      <div className="mt-4">{action}</div>
    </div>
  )
}

function Detail({ item, onWaitlist, onRequest }: { item: DirectoryItem; onWaitlist: () => void; onRequest: () => void }) {
  const cat = DIRECTORY_CATEGORIES.find((c) => c.id === item.category)!
  const entry = catalogEntry(item)
  return (
    <>
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-200">
          <IntegrationLogo slug={item.catalogSlug} name={item.name} className="h-9 w-9" logoClassName="h-7 w-7" />
        </span>
        <div>
          <DialogTitle className="text-[22px] font-medium text-heading">{item.name}</DialogTitle>
          <DialogDescription className="mt-1 text-[14px] text-body">
            {cat.label} · {item.soon ? 'Em breve' : entry?.status === 'early_access' ? 'Acesso antecipado' : 'Disponível'}
          </DialogDescription>
        </div>
      </div>
      <p className="text-[16px] leading-7 text-ink">{item.description}</p>
      {entry && entry.description !== item.description && (
        <div className="rounded-xl bg-slate-50 p-4 text-[14px] leading-6 text-body">
          <div className="mb-1 font-medium text-ink">No painel da Kloel</div>
          {entry.description}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {item.soon ? (
          <button type="button" className={siteButton('dark', 'md')} onClick={onWaitlist}>
            <BellRing className="h-4 w-4" /> Avise-me quando estiver disponível
          </button>
        ) : entry?.cta.kind === 'internal' ? (
          <Link to={`/app${entry.cta.path}`} className={siteButton('dark', 'md')}>
            Configurar no app <ArrowRight className="h-4 w-4" />
          </Link>
        ) : entry?.cta.kind === 'guide' ? (
          <Link to={`/ajuda/${entry.cta.path}`} className={siteButton('dark', 'md')}>
            <BookOpen className="h-4 w-4" /> Ler o guia de integração
          </Link>
        ) : entry?.cta.kind === 'request' ? (
          <Link to="/app/integrations" className={siteButton('dark', 'md')}>
            Pedir acesso antecipado no app <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <Link to="/agendar-demo?source=integracoes" className={siteButton('dark', 'md')}>
            Falar com um especialista
          </Link>
        )}
        <Link to="/criar-conta" className={siteButton('outline', 'md')}>
          Criar conta grátis
        </Link>
        {!entry && !item.soon && (
          <button type="button" className={siteButton('outline', 'md')} onClick={onRequest}>
            Solicitar detalhes
          </button>
        )}
      </div>
    </>
  )
}
