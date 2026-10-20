import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, BadgeCheck, MapPin, Search, SearchX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DemoLogoMark } from '@/site/components/sections/LogoStrip'
import { DEMO_LOGOS } from '@/site/components/sections/demoContent'
import { InitialsAvatar, Stars } from '@/site/components/sections/primitives'
import { usePageTitle } from '@/site/components/usePageTitle'
import { useReturnFocus } from '@/site/layout/useReturnFocus'
import { Chip, FinalCtaBand, SiteHeading, SitePills, SoftAurora, siteButton } from './kit'
import { PRODUCT_NAMES, SECTORS, STORIES, type Story } from './stories-content'

const ALL = 'todos'

function Logo({ company }: { company: string }) {
  const logo = DEMO_LOGOS.find((l) => l.name === company)
  if (logo) return <DemoLogoMark logo={logo} />
  return <span className="text-[18px] font-bold text-ink">{company}</span>
}

/** /casos-de-sucesso — "Histórias de clientes" (INFERIDO: sem referência visual). Conteúdo ilustrativo. */
export default function CustomerStoriesPage() {
  usePageTitle('Histórias de clientes')
  const [params, setParams] = useSearchParams()
  const sector = params.get('setor') ?? ALL
  const q = params.get('busca') ?? ''
  const update = (patch: Record<string, string | null>, replace = true) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '' || v === ALL) n.delete(k)
          else n.set(k, v)
        }
        return n
      },
      { replace, preventScrollReset: true },
    )
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const list = useMemo(
    () =>
      STORIES.filter((s) => (sector === ALL || s.sector === sector) && (!q.trim() || norm(`${s.company} ${s.title} ${s.excerpt} ${s.sector} ${s.city}`).includes(norm(q.trim())))),
    [sector, q],
  )
  const open = STORIES.find((s) => s.slug === params.get('historia'))
  const storyFocus = useReturnFocus(!!open)

  return (
    <main className="font-site">
      <section className="relative overflow-hidden">
        <SoftAurora intensity={0.6} fade />
        <div className="relative mx-auto flex max-w-[860px] flex-col items-center px-5 pb-14 pt-16 text-center sm:pt-20">
          <Chip icon={<BadgeCheck className="h-[18px] w-[18px] fill-brand-blue text-white" />}>Histórias de clientes</Chip>
          <SiteHeading as="h1" size="hero" className="mt-4 max-w-[720px]">Empresas que nunca mais perdem um cliente</SiteHeading>
          <p className="mt-5 max-w-[640px] text-[17px] leading-[26px] text-body sm:text-[18px]">Veja como pequenas e médias empresas usam a Kloel para atender por telefone, WhatsApp e chat — 24 horas por dia.</p>
        </div>
      </section>

      {/* overflow-anchor: none — ao filtrar, o navegador não "segue" um cartão que mudou de lugar (a rolagem fica onde estava) */}
      <section className="mx-auto max-w-[1180px] px-5 pb-24 [overflow-anchor:none]">
        <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-center lg:justify-between">
          <SitePills<string>
            ariaLabel="Setor"
            value={sector}
            onChange={(v) => update({ setor: v })}
            options={[ALL, ...SECTORS].map((s) => ({
              value: s,
              label: (
                <span>
                  {s === ALL ? 'Todos' : s} <span className="text-[13px] text-slate-400">{s === ALL ? STORIES.length : STORIES.filter((x) => x.sector === s).length}</span>
                </span>
              ),
            }))}
          />
          <label className="relative block lg:w-[300px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => update({ busca: e.target.value })} placeholder="Buscar empresa ou assunto…" aria-label="Buscar histórias" className="h-11 w-full rounded-[10px] border border-slate-200 bg-white pl-10 pr-3 text-[15px] text-ink placeholder:text-slate-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15" />
          </label>
        </div>

        {list.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 p-12 text-center" data-testid="stories-empty">
            <SearchX className="h-8 w-8 text-slate-400" />
            <p className="text-[17px] text-ink">Nenhuma história encontrada.</p>
            <button type="button" className={siteButton('outline', 'md')} onClick={() => update({ setor: null, busca: null })}>
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="stories-grid">
            {list.map((s) => (
              <button key={s.slug} type="button" onClick={() => update({ historia: s.slug }, false)} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 text-left transition-shadow hover:shadow-[0_8px_30px_rgba(15,15,22,.08)]">
                <div className="flex items-start justify-between gap-3">
                  <Logo company={s.company} />
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-body">{s.sector}</span>
                </div>
                <h3 className="mt-6 text-[20px] font-medium leading-7 tracking-[-0.15px] text-heading">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-6 text-body">{s.excerpt}</p>
                <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5">
                  {s.metrics.map((m) => (
                    <div key={m.label}>
                      <div className="text-[24px] font-medium tracking-[-0.3px] text-brand-blue">{m.value}</div>
                      <div className="text-[13px] leading-4 text-body">{m.label}</div>
                    </div>
                  ))}
                </div>
                <span className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-medium text-ink group-hover:text-brand-blue">
                  Ler história <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <FinalCtaBand title="Sua empresa pode ser a próxima história." text="Crie o seu assistente de IA em minutos ou converse com um especialista para entender o melhor caminho para o seu atendimento." secondary={{ label: "Agendar uma demo", to: "/agendar-demo?source=casos-de-sucesso" }} />

      <Dialog open={!!open} onOpenChange={(o) => !o && update({ historia: null }, false)}>
        <DialogContent className="max-h-[90svh] max-w-[760px] gap-y-6 overflow-y-auto font-site sm:rounded-2xl" onCloseAutoFocus={storyFocus}>{open && <StoryDetail s={open} />}</DialogContent>
      </Dialog>
    </main>
  )
}

function StoryDetail({ s }: { s: Story }) {
  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Logo company={s.company} />
        </div>
        <DialogTitle className="pr-8 text-[26px] font-medium leading-8 tracking-[-0.3px] text-heading">{s.title}</DialogTitle>
        <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-body">
          <span>{s.sector}</span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> {s.city}
          </span>
          <span>{s.products.map((p) => PRODUCT_NAMES[p]).join(' · ')}</span>
        </DialogDescription>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {s.metrics.map((m) => (
          <div key={m.label} className="rounded-xl bg-[#F5F5FF] p-4">
            <div className="text-[30px] font-medium tracking-[-0.4px] text-brand-blue">{m.value}</div>
            <div className="text-[14px] text-body">{m.label}</div>
          </div>
        ))}
      </div>
      <Block title="O desafio" text={s.challenge} />
      <Block title="A solução com a Kloel" text={s.solution} />
      <div>
        <h4 className="text-[17px] font-medium text-heading">Resultados</h4>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-6 text-body">
          {s.results.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <figure className="rounded-2xl border border-slate-200 p-6">
        <Stars />
        <blockquote className="mt-4 text-[17px] leading-7 text-ink">“{s.quote}”</blockquote>
        <figcaption className="mt-4 flex items-center gap-3">
          <InitialsAvatar name={s.person} className="h-10 w-10 text-[13px]" />
          <span className="text-[15px]">
            <b className="block font-medium text-heading">{s.person}</b>
            <span className="text-body">
              {s.role}, {s.company}
            </span>
          </span>
        </figcaption>
      </figure>
      <div className="flex flex-wrap gap-3">
        <Link to="/criar-conta" className={cn(siteButton('dark', 'md'))}>
          Criar minha própria IA agora
        </Link>
        <Link to={`/agendar-demo?productType=${s.products[0]}&source=casos-de-sucesso`} className={siteButton('outline', 'md')}>
          Agendar uma demo
        </Link>
      </div>
    </>
  )
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h4 className="text-[17px] font-medium text-heading">{title}</h4>
      <p className="mt-1.5 text-[15px] leading-6 text-body">{text}</p>
    </div>
  )
}
