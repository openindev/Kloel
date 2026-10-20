import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarCheck, ChevronDown, ClipboardList, Headset, Minus, Plus, Quote, SearchX, Truck, Voicemail } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AuroraBackground, CallbackWidget, Container, CtaLink, FinalCta, HeroSocialProof, LogoStrip, ReadMore, SectionTitle, TEMPLATE_STATS, TestimonialsSection, HeroOrb,
} from '@/site/components/sections'
import { usePageTitle } from '@/site/components/usePageTitle'
import { useNoIndex } from '@/lib/useNoIndex'
import { SOLUTIONS, solutionBySlug, type SolutionData } from './solutionsData'
import { ILLUSTRATIONS, ReceptionIllustration } from './illustrations'

/*
 * Template único das 5 landings de solução (spec 03). Medidas conferidas contra as capturas do operador a 1470 px
 * (2. Soluções/**): grade de conteúdo de 1096 px, cartões com título 18 px, números "1, 2, 3" em círculo slate-100,
 * bordas #CAD5E2 sobre fundo cinza (#F7F8FC) e #E1E3F3 sobre fundo branco, corpo #45556C, "Leia mais" #90A1B9,
 * estatísticas em #585DFE 33 px semibold, seções brancas de passos com 126 px de respiro no topo, botão "Conhecer a plataforma"
 * de 236×48 px (rótulo 15 px medium), acordeão de 640 px e carrossel alinhado à calha de 47 px do cabeçalho.
 */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'agente-de-suporte-com-ia': Headset,
  'agendamentos-e-perguntas-frequentes': CalendarCheck,
  'recepcionista-virtual-com-ia': ClipboardList,
  'atendedor-automatico-por-ia': Voicemail,
  'assistente-de-ia-para-equipe-externa': Truck,
}

const BODY = 'text-[16px] leading-6 text-[#45556C]'
/** "Leia mais" das soluções: rótulo de 14 px (58 px de largura medidos em [103] e [121]), chevron de 16 px. */
const TOGGLE = 'text-[14px]'

/** Contêiner das seções de miolo (1096 px úteis a 1470 px — referência [103], [124], [127], [143]). */
function Grid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1160px] px-5 lg:px-8', className)}>{children}</div>
}

function Band({ id, children, gray, className }: { id?: string; children: ReactNode; gray?: boolean; className?: string }) {
  return (
    <section id={id} className={cn('relative scroll-mt-24 py-16 sm:py-20', gray && 'bg-[#F7F8FC]', className)}>
      {children}
    </section>
  )
}

function NotFound({ slug }: { slug?: string }) {
  usePageTitle('Solução não encontrada')
  useNoIndex()
  return (
    <main className="font-site">
      <section className="relative overflow-hidden py-20 sm:py-28">
        <AuroraBackground variant="soft" />
        <Container size="md" className="relative flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F3F4F8] text-ink"><SearchX className="h-6 w-6" /></span>
          <SectionTitle as="h1" size="hero" title="Solução não encontrada" subtitle={<>Não encontramos a página <b className="break-all font-medium text-heading">/solucoes/{slug}</b>. Veja abaixo os casos de uso disponíveis.</>} className="mt-6" />
          <div className="mt-10 grid w-full gap-3 text-left sm:grid-cols-2">
            {SOLUTIONS.map((s) => {
              const Icon = ICONS[s.slug] ?? Headset
              return (
                <Link key={s.slug} to={`/solucoes/${s.slug}`} className="group flex items-center gap-3 rounded-xl border border-[#E1E3F3] bg-white px-4 py-3.5 text-[16px] text-heading transition-shadow hover:shadow-md">
                  <Icon className="h-5 w-5 text-body" />
                  <span className="flex-1">{s.menuLabel}</span>
                  <ArrowUpRight className="h-4 w-4 text-body transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </Link>
              )
            })}
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <CtaLink to="/">Ir para o início</CtaLink>
            <CtaLink to="/agendar-demo" variant="outline">Agendar uma demo</CtaLink>
          </div>
        </Container>
      </section>
    </main>
  )
}

function Hero({ s }: { s: SolutionData }) {
  return (
    // [101]/[111]/[121]/[138]/[154] a 1460 px: título 190 px abaixo do topo, orbe de ≈160 px, 71 px entre orbe e widget,
    // prova social 56 px abaixo de "Agendar demo"
    <section className="relative isolate overflow-hidden pb-6 pt-14 sm:pt-[110px]">
      <AuroraBackground variant="ribbon" />
      <Container className="relative flex flex-col items-center text-center">
        <SectionTitle as="h1" size="hero" title={s.hero.title} className="max-w-[760px]" />
        <div className="mt-4 max-w-[680px]">
          {s.hero.subtitleFull ? (
            <ReadMore center text={s.hero.subtitleFull} lines={2} className="text-[16px] leading-6" toggleClassName={TOGGLE} />
          ) : (
            <p className="text-[16px] leading-6 text-body">{s.hero.subtitle}</p>
          )}
        </div>
        <HeroOrb className="my-11 sm:mb-[54px] sm:mt-[71px]" />
        {/* referência: widget de ~290 px a 1470 px; "Agendar demo" sem seta logo abaixo */}
        <CallbackWidget source={`solucao:${s.slug}`} demoLabel="Agendar demo" demoTo={`/agendar-demo?source=solucao-${s.slug}`} demoArrow={false} className="sm:max-w-[292px]" />
        <HeroSocialProof className="mt-9 sm:mt-[47px]" />
      </Container>
    </section>
  )
}

/**
 * Soluções cuja faixa de logos é ≈10 px mais alta nas referências (logos de clientes mais altos em [123]/[139]/[155]):
 * os cartões ficam 275 px abaixo da linha de avaliação da prova social, contra 265 px em [102]/[112].
 */
const TALL_LOGO_BAND = new Set(['recepcionista-virtual-com-ia', 'atendedor-automatico-por-ia', 'assistente-de-ia-para-equipe-externa'])

/**
 * G4 — 4 cartões de estatística. Medidas de [102]/[139]: 1151 px, cartões de 136 px, valor 33 px
 * semibold #585DFE ("24/7" com 66 px de largura). Posições conferidas por perfil de pixels contra [102]/[112]/[123]/[139]/[155]
 * (alinhadas pela linha de avaliação): topo do cartão, valor, rótulo, base do cartão e início da seção cinza a ≤ 1 px.
 */
function SolutionStats({ tallLogoBand }: { tallLogoBand?: boolean }) {
  return (
    <section className={cn('pb-14 pt-16 sm:pb-[80px]', tallLogoBand ? 'sm:pt-[135px]' : 'sm:pt-[125px]')}>{/* cartões → fim da seção = 80 px como em [102] */}
      <div className="mx-auto w-full max-w-[1215px] px-5 lg:px-8">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {TEMPLATE_STATS.map((st) => (
            <div key={st.label} data-testid="solution-stat" className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white px-4 py-7 text-center sm:gap-3 sm:pb-8 sm:pt-[34px]">
              <div className="text-[30px] font-semibold leading-none text-brand-blue sm:text-[33px]">{st.value}</div>
              <div className="text-[15px] leading-6 text-body sm:text-[16px]">{st.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[18px] font-medium leading-[26px] tracking-[-0.1px] text-heading">{children}</h3>
}

/** M1 — passos numerados ("1", "2"…) com texto truncado em 2 linhas e "Leia mais" condicional. */
function SolutionSteps({ steps }: { steps: SolutionData['steps'] }) {
  const gray = steps.background === 'gray'
  const basis = steps.columns === 3 ? 'lg:basis-[calc((100%-32px)/3)]' : ''
  // seção branca: ~134 px da borda superior até o topo das letras do título ([124] e [139]); a cinza mantém os 80 px de [103]
  return (
    <Band id="passos" gray={gray} className={gray ? undefined : 'sm:pt-[126px]'}>
      <Grid>
        <SectionTitle title={steps.title} />
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          {steps.items.map((it, i) => (
            <article key={it.title} className={cn('flex w-full flex-col rounded-2xl border bg-white p-6 sm:basis-[calc((100%-16px)/2)] sm:p-7', basis, gray ? 'border-[#CAD5E2]' : 'border-[#E1E3F3]')}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F1F5F9] text-[15px] font-medium text-heading">{i + 1}</span>
              <div className="mt-6"><CardTitle>{it.title}</CardTitle></div>
              <div className="mt-2"><ReadMore text={it.text} lines={2} className={BODY} toggleClassName={TOGGLE} /></div>
            </article>
          ))}
        </div>
        {steps.cta && (
          <div className="mt-10 flex justify-center">
            <CtaLink to="/criar-conta" className="font-medium">Conhecer a plataforma agora</CtaLink>
          </div>
        )}
      </Grid>
    </Band>
  )
}

function WhatIs({ w }: { w: NonNullable<SolutionData['whatIs']> }) {
  return (
    <Band id="o-que-e" gray>
      <Grid>
        <SectionTitle title={w.title} />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {w.items.map((it) => (
            <article key={it.title} className="flex flex-col rounded-2xl border border-[#CAD5E2] bg-white p-6 sm:p-7">
              <CardTitle>{it.title}</CardTitle>
              <div className="mt-2"><ReadMore text={it.text} lines={2} className={BODY} toggleClassName={TOGGLE} /></div>
            </article>
          ))}
        </div>
        {w.cta && (
          <div className="mt-10 flex justify-center">
            <CtaLink to="/criar-conta" className="font-medium">Conhecer a plataforma agora</CtaLink>
          </div>
        )}
      </Grid>
    </Band>
  )
}

/** Calha lateral do carrossel: alinha o 1º cartão à margem de 47 px do cabeçalho em 1470 px (contêiner de ~1376 px). */
const GUTTER = 'px-5 scroll-px-5 lg:px-[max(32px,calc((100vw-1376px)/2))] lg:scroll-px-[max(32px,calc((100vw-1376px)/2))]'

/** M2 — carrossel "Vantagens…": 1 cartão por clique; "→" desabilita no fim (OBSERVADO em [130]/[142]). */
function Advantages({ a }: { a: NonNullable<SolutionData['advantages']> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(true)
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanPrev(el.scrollLeft > 4)
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])
  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [update])
  const step = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const card = el.querySelector<HTMLElement>('[data-adv-card]')
    el.scrollBy({ left: dir * (card ? card.offsetWidth + 16 : el.clientWidth * 0.8), behavior: 'smooth' })
  }
  return (
    <section id="vantagens" className="scroll-mt-24 overflow-hidden py-16 sm:py-20">
      <div className={cn('mx-auto flex w-full flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-16', GUTTER)}>
        <SectionTitle align="left" title={a.title} className="max-w-[640px]" />
        <div className="lg:mt-[-10px] lg:w-[440px] lg:shrink-0">
          <ReadMore text={a.intro} lines={2} className="text-[16px] leading-6 text-body" toggleClassName={TOGGLE} />
        </div>
      </div>
      <div ref={ref} onScroll={update} className={cn('no-scrollbar mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2', GUTTER)} role="region" aria-roledescription="carrossel" aria-label="Vantagens">
        {a.cards.map((c) => {
          const Ill = ILLUSTRATIONS[c.illustration]
          return (
            <article key={c.title} data-adv-card className="flex w-[82vw] shrink-0 snap-start flex-col self-start overflow-hidden rounded-2xl border border-[#E1E3F3] bg-white sm:w-[382px]">
              <Ill />
              <div className="flex flex-col gap-2 px-6 pb-7 pt-[22px] sm:px-7">
                <CardTitle>{c.title}</CardTitle>
                <ReadMore text={c.text} lines={2} className={BODY} toggleClassName={TOGGLE} />
              </div>
            </article>
          )
        })}
      </div>
      <div className="mt-6 flex justify-center gap-2.5">
        {(['prev', 'next'] as const).map((d) => {
          const disabled = d === 'prev' ? !canPrev : !canNext
          return (
            <button
              key={d}
              type="button"
              onClick={() => step(d === 'prev' ? -1 : 1)}
              disabled={disabled}
              aria-label={d === 'prev' ? 'Vantagem anterior' : 'Próxima vantagem'}
              className="flex h-[46px] w-[46px] items-center justify-center rounded-full border border-[#E1E3F3] bg-white text-ink transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-[#CAD5E2] disabled:hover:bg-white"
            >
              {d === 'prev' ? <ArrowLeft className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** M3 — "Para quem é adequado…": texto + imagem inclinada com citação à esquerda; acordeão "+ / −" de item único à direita ([143]–[146]). */
function Audience({ a }: { a: NonNullable<SolutionData['audience']> }) {
  return (
    <Band id="para-quem" gray className="sm:py-[110px]">
      <Grid>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_406px] lg:gap-x-[76px]">
          <div>
            <SectionTitle align="left" title={a.title} />
            <div className="mt-6"><ReadMore text={a.intro} lines={2} className="text-[16px] leading-6 text-body" toggleClassName={TOGGLE} /></div>
            {/* a foto fica POR CIMA do cartão de citação ([143]/[144]); no celular o cartão desce para baixo da foto, sem cobrir o conteúdo dela */}
            <div className="relative mt-12 flex flex-col sm:mt-14 sm:block sm:pl-[184px]">
              <ReceptionIllustration className="relative z-[1] w-full sm:w-[394px]" />
              <figure className="relative z-0 -mt-8 ml-3 mr-10 rounded-2xl border border-[#E1E3F3] bg-white px-5 pb-5 pt-12 shadow-[0_10px_30px_-12px_rgba(15,15,22,.18)] sm:absolute sm:left-0 sm:top-1/2 sm:m-0 sm:w-[234px] sm:-translate-y-1/2 sm:p-5">
                <Quote className="h-4 w-4 fill-[#90A1B9] text-[#90A1B9]" />
                <blockquote className="mt-3 text-[16px] leading-6 text-[#171717]">{a.quote}</blockquote>
              </figure>
            </div>
          </div>
          <AccordionPrimitive.Root type="single" collapsible className="flex flex-col gap-3 self-start">
            {a.items.map((it, i) => (
              <AccordionPrimitive.Item key={it.q} value={String(i)} className="rounded-xl border border-[#E1E3F3] bg-white">
                <AccordionPrimitive.Header className="flex">
                  <AccordionPrimitive.Trigger className="group flex flex-1 items-center justify-between gap-6 px-[17px] py-[17px] text-left text-[16px] font-medium leading-6 text-heading outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
                    <span>{it.q}</span>
                    <Plus className="h-5 w-5 shrink-0 stroke-[1.6] text-[#171717] group-data-[state=open]:hidden" />
                    <Minus className="hidden h-5 w-5 shrink-0 stroke-[1.6] text-[#171717] group-data-[state=open]:block" />
                  </AccordionPrimitive.Trigger>
                </AccordionPrimitive.Header>
                <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                  <p className="px-[17px] pb-[17px] text-[14px] leading-5 text-body">{it.a}</p>
                </AccordionPrimitive.Content>
              </AccordionPrimitive.Item>
            ))}
          </AccordionPrimitive.Root>
        </div>
      </Grid>
    </Band>
  )
}

/** G6 — acordeão de benefícios (640 px; título 35 px; chevron 16 px; um item aberto por vez; todos fechados ao carregar). */
function Benefits({ acc }: { acc: NonNullable<SolutionData['accordion']> }) {
  return (
    // [105]/[115]: 181 px entre os depoimentos e o título; 201 px entre a última pergunta e o título do CTA final
    <section id="perguntas" className="scroll-mt-24 pb-16 pt-6 sm:pb-[79px] sm:pt-[81px]">
      <div className="mx-auto w-full max-w-[680px] px-5">
        <h2 className="text-balance text-center text-[28px] font-medium leading-[34px] tracking-[-0.3px] text-heading sm:text-[35px] sm:leading-[40px] sm:tracking-[-0.5px]">{acc.title}</h2>
        <AccordionPrimitive.Root type="single" collapsible className="mt-8">
          {acc.items.map((it, i) => (
            <AccordionPrimitive.Item key={it.q} value={String(i)} className="border-b border-[#E1E3F3] last:border-b-0">
              <AccordionPrimitive.Header className="flex">
                <AccordionPrimitive.Trigger className="group flex flex-1 items-center justify-between gap-6 py-[17px] text-left text-[16px] font-medium leading-6 text-[#0A0A0A] outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
                  <span>{it.q}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                <p className="pb-[17px] pr-8 text-[16px] leading-6 text-body">{it.a}</p>
              </AccordionPrimitive.Content>
            </AccordionPrimitive.Item>
          ))}
        </AccordionPrimitive.Root>
      </div>
    </section>
  )
}

/** /solucoes/:slug — template único das 5 landings de solução (spec 03), dados em solutionsData.ts. */
export default function SolutionPage() {
  const { slug } = useParams()
  const s = solutionBySlug(slug)
  usePageTitle(s ? s.menuLabel : 'Solução não encontrada')
  if (!s) return <NotFound slug={slug} />
  return (
    <main className="font-site" key={s.slug}>
      <Hero s={s} />
      <section className="pt-6">
        <Container size="full"><LogoStrip /></Container>
      </section>
      <SolutionStats tallLogoBand={TALL_LOGO_BAND.has(s.slug)} />

      {s.whatIs && <WhatIs w={s.whatIs} />}
      <SolutionSteps steps={s.steps} />
      {s.advantages && <Advantages a={s.advantages} />}
      {s.audience && <Audience a={s.audience} />}

      {/* referência: grade de depoimentos com 1319 px úteis a 1470 px (Container xl daria 1256 px) */}
      {/* [104]/[114]/[131]/[147]/[157]: cartões de 324 px, 57 px abaixo do título */}
      <TestimonialsSection subtitle={s.testimonialsSubtitle} containerClassName="max-w-[1383px]" listClassName="sm:mt-[50px]" cardClassName="sm:min-h-[324px]" />

      {s.accordion && <Benefits acc={s.accordion} />}

      <FinalCta
        // [159]: sem o acordeão, 261 px entre os depoimentos e o título do CTA
        className={s.accordion ? undefined : 'sm:pt-[159px]'}
        title={<>Atendimento por voz<br className="hidden sm:block" /> reinventado, com a Kloel</>}
        subtitle="Teste a Kloel e veja como nosso assistente de IA por voz automatiza suas ligações e libera sua equipe. Simples, eficiente e 24 horas por dia."
        primary={{ label: 'Criar minha própria IA agora', to: '/criar-conta' }}
      />
    </main>
  )
}
