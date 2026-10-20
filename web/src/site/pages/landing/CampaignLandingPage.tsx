import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { Check, ChevronDown, Headset, MapPin, Phone, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AuroraBackground, InitialsAvatar, LogoStrip } from '@/site/components/sections'
import { AbilitiesList, AssistantsTableMock, CallsHistoryMock, EditAssistantHeader, FloatingTestBar } from '@/site/components/mocks/AppMocks'
import { usePageTitle } from '@/site/components/usePageTitle'
import { DashboardMock, LpFooter, LpHeader, LpPricing, LpTestimonials, OfferBar, OpenQuote, scrollToId } from './lpParts'
import { LpBookingForm } from './lpBooking'

/*
 * /lp — landing de campanha (funil), referência "1. Externo/Landing Page/01–11 + FAQ" e nota [440].
 * Tipografia conferida nas capturas a 1470 px: H1 60/75 bold, H2 36/42 bold e H3 24 bold, todos com tracking −0,025 em (alturas e larguras de linha medidas em [423]/[424]); corpo 16–17 px #6B6D80.
 */

const H2 = 'text-[30px] font-bold leading-[36px] tracking-[-0.025em] text-ink sm:text-[36px] sm:leading-[42px]'
const SUB = 'text-[16px] leading-[26px] tracking-[-0.01em] text-[#6B6D80]'

/**
 * Mock do painel reduzido como nas capturas ([425]/[426]: painéis de ≈478×324–330 px a 1460 px, com a tela do app em miniatura).
 * A partir de 1024 px o conteúdo é diagramado com a largura natural `natural` e reduzido para caber na coluna; no celular fica em 100%.
 */
function FitMock({ natural, children }: { natural: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ s: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    const fit = () => {
      const s = window.innerWidth >= 1024 ? Math.min(1, o.clientWidth / natural) : 1
      setBox((prev) => {
        const h = Math.round(i.offsetHeight * s)
        return prev && prev.s === s && prev.h === h ? prev : { s, h }
      })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(o)
    ro.observe(i)
    window.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [natural])
  const s = box?.s ?? 1
  return (
    <div ref={outer} className="relative overflow-hidden" style={box && s < 1 ? { height: box.h } : undefined}>
      <div ref={inner} style={s < 1 ? { width: natural, transform: `scale(${s})`, transformOrigin: 'top left' } : undefined}>{children}</div>
    </div>
  )
}

const BLOCKS = [
  {
    tag: '01 · Atendimento',
    title: 'Nenhuma ligação fica sem resposta',
    text: 'Dia, noite, fim de semana, feriado. Seu cliente nunca mais cai na caixa postal — e seu concorrente nunca mais ganha o lead que era seu.',
    checks: ['24h por dia, 7 dias por semana', 'Voz natural em português brasileiro', 'Zero fila de espera'],
    natural: 554,
    mock: (
      <div className="overflow-hidden rounded-xl border border-[#E1E3F3] bg-white">
        <AssistantsTableMock rows={[{ name: 'Marina', type: 'Voz', conn: '+55 11 90000-0101' }, { name: 'Recepção | Ana', type: 'Voz', conn: '+55 11 90000-0102' }, { name: 'Lia', type: 'WhatsApp', conn: '+55 11 90000-0103' }, { name: 'Leo', type: 'Voz', conn: '+55 11 90000-0104' }, { name: 'Pós-venda', type: 'Webchat', conn: 'minhaempresa.com.br' }]} />
      </div>
    ),
  },
  {
    tag: '02 · Autonomia',
    title: 'A Kloel age. Não só responde.',
    text: 'Durante a ligação, a IA toma decisões: transfere para o especialista certo, agenda, envia e-mail, consulta seu sistema, qualifica o lead. Tudo sozinha, sem precisar de ninguém.',
    checks: ['Transferência inteligente para humanos', 'Agenda, manda e-mail e SMS', 'Conecta com seus sistemas antes, durante ou após a chamada'],
    natural: 960,
    mock: (
      <div className="relative overflow-hidden rounded-xl border border-[#E1E3F3] bg-white p-4 pb-16">
        <EditAssistantHeader name="Recepção | Ana" />
        <div className="mt-3"><AbilitiesList highlight={7} added={[1, 2, 3, 7]} name="Ana" /></div>
        <FloatingTestBar className="absolute bottom-3 left-1/2 -translate-x-1/2" items={['+55 11 90000-0102 ⌄']} primary="Testar ligação" />
      </div>
    ),
  },
  {
    tag: '03 · Inteligência',
    title: 'Cada ligação vira dado. Auditável.',
    text: 'Transcrição, resumo e áudio de cada chamada organizados e acessíveis. O que hoje se perde na memória do seu funcionário, com a Kloel vira registro permanente.',
    checks: ['Transcrição e resumo automáticos de cada chamada', 'Cada ligação gravada e disponível para escuta imediata', 'Dados customizados extraídos de cada conversa, prontos para usar onde quiser'],
    natural: 446,
    mock: <div className="overflow-hidden rounded-xl border border-[#E1E3F3] bg-white"><CallsHistoryMock /></div>,
  },
]

const FAQ = [
  { q: 'Vai soar robótico para os meus clientes?', a: 'Não. A Kloel usa vozes ultra-realistas em português brasileiro, com entonação natural e ritmo de conversa humano. A maioria dos clientes não percebe que está falando com uma IA — e isso é intencional.' },
  { q: 'Quanto tempo leva para colocar no ar?', a: 'A IA pode ser configurada em minutos. O tempo total depende do nível de integração com seus sistemas, mas a maioria dos clientes está operando no mesmo dia.' },
  { q: 'Preciso de equipe técnica para implementar?', a: 'Não. A Kloel foi criada para ser configurada por qualquer pessoa, sem código, sem TI, sem complicação. Se tiver dúvida, nosso time te ajuda.' },
  { q: 'E se a IA errar ou não souber responder?', a: 'A Kloel toma decisões com base nas informações que você fornece, o que minimiza erros. Quando não souber como proceder, ela pode transferir a ligação para um humano ou agendar um retorno — você define como.' },
  { q: 'Meus dados ficam seguros? A Kloel é compatível com a LGPD?', a: <>A Kloel trata dados pessoais conforme a LGPD, com controles de acesso e retenção configuráveis. Os detalhes de hospedagem e subprocessadores estão em <a className="text-brand-blue underline underline-offset-2" href="/ajuda/legal/protecao-de-dados" target="_blank" rel="noreferrer">Proteção de dados</a>.</> },
  { q: 'Tem fidelidade ou contrato longo?', a: <>Não. Sem fidelidade, sem contrato de longo prazo. E se em 30 dias você não estiver satisfeito, devolvemos seu dinheiro. Simples assim.</> },
]

function CheckDot() {
  return <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#BCC3F6]"><Check className="h-3 w-3 stroke-[3] text-ink" /></span>
}

/** Palavra "português" digitada/apagada em loop com brilho (INFERIDO de [423]). */
function TypingWord() {
  const word = 'português'
  const [n, setN] = useState(word.length)
  const [dir, setDir] = useState<-1 | 1>(-1)
  useEffect(() => {
    const id = setTimeout(() => {
      if (dir === -1 && n === 0) setDir(1)
      else if (dir === 1 && n === word.length) setDir(-1)
      else setN((v) => v + dir)
    }, n === word.length && dir === -1 ? 2200 : 110)
    return () => clearTimeout(id)
  }, [n, dir])
  return (
    <span className="ks-word-shimmer inline-block min-w-[62px] text-left font-semibold" aria-label={word}>
      <span aria-hidden>{word.slice(0, n) || ' '}</span>
    </span>
  )
}

function DemoLink({ className, children = 'Agendar demo' }: { className?: string; children?: React.ReactNode }) {
  return (
    <a href="#agendar" onClick={(e) => { e.preventDefault(); scrollToId('agendar') }} className={cn('inline-flex h-10 items-center rounded-lg bg-brand-blue px-8 text-[16px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#4a4fe6]', className)}>
      {children}
    </a>
  )
}

/** /lp — landing de campanha (funil): header simplificado com âncoras, oferta com contador, planos que levam ao agendamento, formulário de demo. */
export default function CampaignLandingPage() {
  usePageTitle('Assistentes de IA por voz — demonstração gratuita')
  const [plan, setPlan] = useState<string | null>(null)

  // Endereço direto com âncora (/lp#planos, /lp?agendado=…#agendar): rola até a seção após a montagem.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 150)
    return () => clearTimeout(t)
  }, [])

  const choose = (p: string) => {
    setPlan(p)
    scrollToId('agendar')
  }

  return (
    <div className="min-h-svh bg-white font-site text-ink" id="topo">
      <LpHeader />

      {/* 1 · HERO */}
      <section className="relative overflow-hidden pt-[112px] sm:pt-[124px]">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[980px] [mask-image:linear-gradient(180deg,#000_42%,transparent_90%)]">
          <AuroraBackground />
        </div>
        <div className="relative mx-auto flex max-w-[1100px] flex-col items-center px-5 text-center">
          <span className="inline-flex h-[30px] items-center gap-2 rounded-[10px] border border-[#E1E3F3] bg-white px-4 text-[12px] tracking-[0.11em] text-[#3F4152]">
            <span className="fi fi-br rounded-[1px] text-[8px]" role="img" aria-label="Brasil" /> Voz ultra-realista em <TypingWord />
          </span>
          <h1 className="mt-6 max-w-[880px] text-balance text-[38px] font-bold leading-[44px] tracking-[-0.025em] text-ink sm:text-[52px] sm:leading-[62px] lg:mt-[23px] lg:text-[60px] lg:leading-[75px]">
            Assistentes de IA por voz para nunca mais perder uma ligação
          </h1>
          <p className={cn('mt-[22px] max-w-[520px] text-pretty lg:mt-5', SUB)}>
            Atende, agenda, qualifica e transfere chamadas como uma funcionária real, 24h por dia, sem precisar de ninguém de TI.
          </p>
          <DemoLink className="mt-[30px] lg:mt-[29px]" />
        </div>
        <div className="relative mt-14 px-4"><DashboardMock /></div>
      </section>

      {/* prova social */}
      <section className="pb-6 pt-16 sm:pt-20">
        <div className="flex flex-col items-center gap-8">
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-5 text-center text-[16px] font-medium tracking-[-0.01em] text-ink sm:text-[17px]">
            <span className="rounded-md bg-brand-blue px-1.5 py-0.5 font-semibold text-white">1.000+</span> empresas já automatizam seu atendimento com a Kloel.
          </p>
          <LogoStrip variant="mono" className="w-full" />
        </div>
      </section>

      {/* 2 · COMO FUNCIONA */}
      <section id="como-funciona" className="scroll-mt-20 py-16 sm:py-24">
        <div className="mx-auto max-w-[1066px] px-5">
          <div className="text-center">
            <h2 className={H2}>Mais que um atendente. Um time inteiro.</h2>
            <p className={cn('mt-4', SUB)}>Atende, toma decisões e registra tudo, sem você precisar fazer nada.</p>
          </div>
          <div className="mt-16 flex flex-col gap-16 sm:mt-20 lg:gap-24">
            {BLOCKS.map((b, i) => (
              <div key={b.tag} className={cn('grid items-center gap-10 lg:grid-cols-2 lg:gap-[72px] [&>*]:min-w-0', i % 2 === 1 && 'lg:[&>*:first-child]:order-2')}>
                <div>
                  <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-brand-blue">{b.tag}</div>
                  <h3 className="mt-4 text-[24px] font-bold leading-[30px] tracking-[-0.025em] text-ink">{b.title}</h3>
                  <p className={cn('mt-5', SUB)}>{b.text}</p>
                  <ul className="mt-6 flex flex-col gap-[11px]">
                    {b.checks.map((c) => <li key={c} className="flex items-center gap-3 text-[15px] tracking-[-0.01em] text-ink"><CheckDot /> {c}</li>)}
                  </ul>
                </div>
                <div className="overflow-hidden rounded-[20px] border border-[#E1E3F3] bg-[#F7F8FC] p-4 sm:p-7"><FitMock natural={b.natural}>{b.mock}</FitMock></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3 · PLANOS */}
      <section id="planos" className="scroll-mt-20 py-16 sm:py-20">
        <div className="mx-auto max-w-[1017px] px-5">
          <OfferBar />
          <div className="mt-10 text-center sm:mt-12">
            <h2 className={H2}>Recupere seu tempo. Deixe o atendimento com a gente.</h2>
            {/* [427]: 44 px entre o subtítulo e os cartões */}
            <div className="relative">
              <p className={cn('mx-auto mt-4 max-w-[560px]', SUB)}>Planos flexíveis para qualquer volume de chamadas. Escolha o seu e comece a escalar hoje mesmo.</p>
            </div>
          </div>
          <div className="mt-12 sm:mt-10"><LpPricing onChoose={choose} chosen={plan} /></div>
          <div className="mx-auto mt-10 flex w-fit max-w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-xl border border-[#E1E3F3] px-5 py-3 text-center text-[16px] font-medium tracking-[-0.01em] text-ink">
            <ShieldCheck className="h-5 w-5 shrink-0 text-brand-blue" />
            <span>Garantia Risco Zero: Teste por 30 dias ou receba seu dinheiro de volta.</span>
          </div>
        </div>
      </section>

      {/* 4 · DEPOIMENTOS */}
      <section id="depoimentos" className="scroll-mt-20 bg-[#F7F8FC] py-16 sm:py-24">
        <div className="mx-auto max-w-[1066px] px-5 text-center">
          <h2 className={H2}>A recepcionista que nunca dorme.</h2>
          <p className={cn('mt-4', SUB)}>E nunca perde um lead. Veja o que quem já usa a Kloel tem a dizer.</p>
        </div>
        <div className="mt-12 sm:mt-14"><LpTestimonials /></div>
      </section>

      {/* 5 · CONSTRUÍDA DE BRASILEIROS PARA O BRASIL (nota [440]); células de números alinhadas pelo topo: valores da mesma linha na mesma altura mesmo quando a legenda quebra ([430]) */}
      <section id="brasil" className="scroll-mt-20 px-5 py-16 sm:py-20">
        <div className="mx-auto grid max-w-[1150px] overflow-hidden rounded-3xl border border-[#E1E3F3] lg:grid-cols-[1fr_1.006fr]">
          <div className="p-7 sm:p-12">
            <h2 className={cn(H2, 'sm:leading-[44px]')}>
              Construída de Brasileiros,<br />
              <em className="text-brand-blue [font-synthesis:style]">para o Brasil</em> <span className="fi fi-br rounded-[3px] align-[-2px] text-[26px]" role="img" aria-label="Brasil" />
            </h2>
            <p className={cn('mt-6 max-w-[460px]', SUB)}>
              Construímos a Kloel para que empresas de todos os tamanhos nunca mais percam um lead num telefone tocando. Atendimento em segundos. 24 horas por dia. Não é robô. É conversa natural, em português de verdade.
            </p>
            <div className="mt-8 flex w-fit max-w-full items-center gap-4 rounded-2xl border border-[#E1E3F3] bg-[#F7F8FC] px-4 py-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E1E3F3] bg-white"><MapPin className="h-5 w-5 text-brand-blue" /></span>
              <div>
                <div className="text-[16px] font-medium tracking-[-0.01em] text-ink">Comprometidos com o mercado brasileiro</div>
                <div className="text-[14px] text-[#6B6D80]">Produto em português · Time brasileiro · Suporte local</div>
              </div>
            </div>
          </div>
          <div className="relative grid grid-cols-2 bg-[#0F0F16] p-5 text-white sm:p-12">
            {[
              { v: '100%', l: 'produto e suporte em português', c: 'text-[#A5A8FF]' },
              { v: '24/7', l: 'atendimento sem pausas' },
              { v: '< 2s', l: 'para atender cada ligação' },
              { v: '100+', l: 'integrações disponíveis' },
            ].map((s, i) => (
              <div key={s.v} className={cn('flex flex-col justify-start gap-3 p-4 sm:px-7 sm:pb-7 sm:pt-[37px]', i % 2 === 0 && 'border-r border-white/10', i < 2 && 'border-b border-white/10')}>
                <div className={cn('text-[34px] font-bold leading-none tracking-[-0.04em] sm:text-[52px]', s.c)}>{s.v}</div>
                <div className="text-[14px] text-white/65">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6 · AGENDAR DEMO */}
      {/* [431] 09.png (medidas a 1460 px, relativas ao topo C do cartão do formulário): selo C+17…42 (25 px, texto 11 px),
          título com topo das maiúsculas em C+71,5, depoimento C+189…421 (citação 18/29,5, selo verde de 28 px), avatar em C+446,5,
          nome 14 px e cargo 12 px, fim do cinza #FCFCFE em C+581 e "Perguntas?" em C+670,5 */}
      <section id="agendar" className="scroll-mt-20 bg-[#FCFCFE] py-16 sm:pb-24 sm:pt-[76px] lg:pb-[81px]">
        <div className="mx-auto grid max-w-[1272px] items-start gap-12 px-5 lg:grid-cols-[minmax(0,1fr)_587px] lg:gap-16">
          <div>
            <span className="inline-flex h-[25px] items-center gap-2 rounded-lg border border-[#E1E3F3] bg-white px-3 text-[11px] font-medium uppercase tracking-[0.1em] text-[#3F4152]"><span className="h-1.5 w-1.5 rounded-full bg-brand-blue" /> Demo gratuita · 30 min</span>
            <h2 className={cn(H2, 'mt-5 sm:leading-[44px]')}>
              Veja como a Kloel pode<br className="hidden sm:block" /> <span className="text-brand-blue">transformar seu atendimento</span>.
            </h2>
            <figure className="relative mt-[37px] max-w-[460px]">
              <div className="relative rounded-[28px] border border-[#E1E3F3] bg-white p-7">
                <OpenQuote className="h-6 w-6" />
                <blockquote className="mt-5 text-[18px] font-medium leading-[29.5px] tracking-[-0.02em] text-ink">A Kloel resolve a maior parte das ligações sozinha: dúvidas gerais, agendamento, confirmações. Minha equipe só pega o que realmente precisa de gente.</blockquote>
                <span className="mt-4 inline-flex items-baseline rounded-full bg-[#D1F4C7] px-3 py-1 text-[13px] leading-5 text-ink"><b className="mr-1 font-semibold">+42%</b> <span className="text-[12.5px]">consultas agendadas</span></span>
                <span aria-hidden className="absolute -bottom-[9px] left-10 h-4 w-4 rotate-45 border-b border-r border-[#E1E3F3] bg-white" />
              </div>
              <figcaption className="mt-[25px] flex items-center gap-3 pl-7">
                <InitialsAvatar name="Renata M." className="h-10 w-10 text-[13px]" />
                <div>
                  <div className="text-[14px] font-medium leading-5 text-ink">Renata M.</div>
                  <div className="text-[12px] leading-4 text-[#6B6D80]">Coordenadora de Atendimento · Clínica médica</div>
                </div>
              </figcaption>
            </figure>
          </div>
          {/* [431]: o cartão começa ~25px acima do selo "Demo gratuita" da coluna esquerda */}
          <div className="lg:-mt-[17px]">
            <LpBookingForm plan={plan} onClearPlan={() => setPlan(null)} />
          </div>
        </div>
      </section>

      {/* 7 · DÚVIDAS */}
      <section id="duvidas" className="scroll-mt-20 py-16 sm:pb-20 sm:pt-[81px]">
        <div className="mx-auto grid max-w-[1016px] gap-8 px-5 lg:grid-cols-2 lg:gap-x-[82px]">
          <div>
            <h2 className="text-[34px] font-bold leading-[40px] tracking-[-0.025em] text-ink sm:text-[36px] sm:leading-[44px]">Perguntas?</h2>
            <p className="mt-2 text-[28px] font-medium leading-[36px] tracking-[-0.025em] text-ink sm:text-[30px]">A gente responde.</p>
          </div>
          <AccordionPrimitive.Root type="single" collapsible className="flex flex-col gap-[9px]" data-testid="lp-faq">
            {FAQ.map((it, i) => (
              <AccordionPrimitive.Item key={it.q} value={String(i)} className="rounded-xl border border-[#E1E3F3] bg-white transition-shadow data-[state=open]:shadow-[0_8px_24px_-14px_rgba(88,93,254,.35)]">
                <AccordionPrimitive.Header className="flex">
                  {/* [432]/[434]–[439]: pergunta de 14 px semibold (linha de 50 px), resposta 14/22 */}
                  <AccordionPrimitive.Trigger className="group flex flex-1 items-center justify-between gap-5 px-5 py-[15px] text-left text-[14px] font-semibold leading-5 tracking-[-0.01em] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
                    <span>{it.q}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 self-start text-[#3F4152] transition-transform duration-200 [margin-top:2px] group-data-[state=open]:rotate-180" />
                  </AccordionPrimitive.Trigger>
                </AccordionPrimitive.Header>
                <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                  <div className="px-5 pb-4 text-[14px] leading-[22px] text-[#6B6D80]">{it.a}</div>
                </AccordionPrimitive.Content>
              </AccordionPrimitive.Item>
            ))}
          </AccordionPrimitive.Root>
        </div>
      </section>

      {/* 8 · CTA FINAL */}
      <section className="px-3 sm:px-12">
        <div className="relative mx-auto max-w-[1374px] overflow-hidden rounded-[24px] bg-[#0F0F16] px-5 py-24 sm:py-[145px]">
          <div aria-hidden className="absolute inset-0 grid grid-cols-[repeat(auto-fill,62px)] justify-center gap-y-[44px] overflow-hidden pt-9 text-white/[0.07] [grid-auto-rows:18px]">
            {Array.from({ length: 23 * 12 }, (_, i) => (i % 3 === 0 ? <Headset key={i} className="mx-auto h-[18px] w-[18px]" /> : <Phone key={i} className="mx-auto h-[18px] w-[18px]" />))}
          </div>
          <div aria-hidden className="absolute left-1/2 top-1/2 h-[420px] w-[760px] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#585DFE]/15 blur-3xl" />
          <div className="relative mx-auto max-w-[720px] rounded-2xl border border-white/10 bg-white/[0.05] px-6 py-12 text-center backdrop-blur-[2px] sm:px-10 sm:py-[56px]">
            <h2 className="text-[30px] font-bold leading-[36px] tracking-[-0.025em] text-white sm:text-[36px] sm:leading-[42px]">Coloque seu atendimento no automático.</h2>
            <p className="mx-auto mt-5 max-w-[440px] text-[17px] leading-[26px] tracking-[-0.01em] text-white/65">Sua IA nunca atrasa, falta ou pede aumento — e ainda atende todas as ligações.</p>
            <DemoLink className="mt-8 px-[30px] text-[17px]" />
          </div>
        </div>
      </section>

      <LpFooter />
    </div>
  )
}
