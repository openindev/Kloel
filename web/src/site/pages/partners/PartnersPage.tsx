import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BadgeCheck, Check, ChevronDown, CircleHelp, Database, Link2, Pause, Play, Plus, Store, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { InitialsAvatar, Stars } from '@/site/components/sections/primitives'
import { usePageTitle } from '@/site/components/usePageTitle'
import { useReturnFocus } from '@/site/layout/useReturnFocus'
import { Chip, FaqAccordion, FinalCtaBand, GradientHero, SiteHeading, SitePills, siteButton } from '../company/kit'
import { LeadDialog } from '../company/LeadDialog'
import { ADVANTAGES, PARTNER_TESTIMONIALS, TIERS_REFER, TIERS_RESELL, partnerFaq, type FaqTab } from './content'

const BOOK = '/parceiros/agendar'

/** /parceiros — "Torne-se um parceiro" (OBSERVADO [251]–[273], [256], [257]). */
export default function PartnersPage() {
  usePageTitle('Torne-se um parceiro')
  const [params, setParams] = useSearchParams()
  const customOpen = params.get('parceria') === 'personalizada'
  const setCustom = (o: boolean) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (o) n.set('parceria', 'personalizada')
        else n.delete('parceria')
        return n
      },
      { replace: true, preventScrollReset: true },
    )
  const [videoOpen, setVideoOpen] = useState(false)

  return (
    <main className="font-site">
      <Hero />
      <Advantages onPlay={() => setVideoOpen(true)} />
      <ReferOrResell />
      <TiersSection />
      <TrustSection />
      <FaqSection openCustom={() => setCustom(true)} />
      <FinalCtaBand
        className="mt-10"
        title="Você procura uma parceria personalizada?"
        text="Contratos enterprise, co-branding ou algo que ainda nem imaginamos? Deixe seus dados de contato e falaremos com você pessoalmente."
        cta="Você procura uma parceria personalizada?"
        onClick={() => setCustom(true)}
      />
      <VideoDialog open={videoOpen} onOpenChange={setVideoOpen} />
      <LeadDialog
        open={customOpen}
        onOpenChange={setCustom}
        kind="partner"
        payload={{ type: 'parceria-personalizada' }}
        title="Parceria personalizada"
        description="Conte um pouco sobre a sua empresa e o tipo de parceria que procura. Nosso time de parcerias entra em contato."
        fields={[
          { name: 'nome', label: 'Nome', required: true, half: true, placeholder: 'Maria Silva' },
          { name: 'empresa', label: 'Empresa', required: true, half: true, placeholder: 'Acme Ltda.' },
          { name: 'email', label: 'E-mail corporativo', type: 'email', required: true, half: true, placeholder: 'maria@empresa.com.br' },
          { name: 'telefone', label: 'Telefone', type: 'tel', half: true, placeholder: '+55 11 91234-5678' },
          { name: 'modelo', label: 'Tipo de parceria', type: 'select', required: true, options: ['Contrato enterprise', 'Co-branding / white label', 'Integração tecnológica', 'Outro'] },
          { name: 'mensagem', label: 'Como podemos trabalhar juntos?', type: 'textarea', required: true, placeholder: 'Descreva sua base de clientes e o que você imagina.' },
        ]}
        submitLabel="Enviar proposta"
        successTitle="Proposta enviada!"
        successText="Nosso time de parcerias vai analisar e responder pelo e-mail informado."
        consent="Concordo com o tratamento dos meus dados para contato comercial, conforme a política de privacidade."
      />
    </main>
  )
}

function Hero() {
  return (
    <GradientHero>
      <div className="mx-auto flex max-w-[900px] flex-col items-center px-5 pb-24 pt-16 text-center sm:pb-[124px] sm:pt-[128px]">
        <Chip icon={<BadgeCheck className="h-[18px] w-[18px] fill-brand-blue text-white" />}>Programa de parceria kloel.ai</Chip>
        <SiteHeading as="h1" size="hero" className="mt-6 max-w-[760px]">
          Receba até 35% de comissão sobre as vendas
        </SiteHeading>
        {/* [257]: 38px entre a 2ª linha do título e a descrição */}
        <p className="mt-4 max-w-[660px] text-[16px] leading-6 text-body">
          Torne-se parceiro da Kloel e transforme a sua rede de contatos em receita recorrente. Entrada simples, configuração flexível.
        </p>
        <Link to={BOOK} className={cn(siteButton('dark'), 'mt-6')}>
          Agende agora uma conversa inicial
        </Link>
        <div className="mt-10 flex items-center gap-3 text-left">
          <span className="flex -space-x-2">
            {['NA', 'CI', 'AT', 'PD'].map((t, i) => (
              <span key={t} className={cn('flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-white text-[13px] font-bold shadow-sm', ['text-[#585DFE]', 'text-emerald-600', 'text-slate-900', 'text-rose-600'][i])}>
                {t}
              </span>
            ))}
          </span>
          <span className="text-[15px] leading-[22px] text-ink">
            Mais de <span className="text-brand-blue">120+ parceiros</span>
            <br />
            já confiam na kloel.ai
          </span>
        </div>
      </div>
    </GradientHero>
  )
}

function Advantages({ onPlay }: { onPlay: () => void }) {
  return (
    <section className="mx-auto max-w-[1192px] px-5 pt-16 sm:pt-20">
      <SiteHeading className="mx-auto max-w-[560px] text-center">Vantagens de ser um parceiro da Kloel</SiteHeading>
      {/* [251]: cartões a 63px da 2ª linha do título, 147px de altura, texto com as quebras da referência */}
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {ADVANTAGES.map((a) => (
          <div key={a} className="flex min-h-[146px] flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F1FE]">
              <Check className="h-4 w-4 text-brand-blue" />
            </span>
            <p className="text-[16px] leading-[22px] text-ink">
              {a.split('\n').map((part, i) => (
                <span key={part}>
                  {i > 0 && (
                    <>
                      <br className="hidden lg:inline" />
                      <span className="lg:hidden"> </span>
                    </>
                  )}
                  {part}
                </span>
              ))}
            </p>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onPlay}
        aria-label="Assistir ao vídeo: O programa de parceria Kloel"
        className="group relative mt-8 block aspect-[4/5] w-full overflow-hidden rounded-3xl bg-[#0B0C1E] text-left sm:aspect-[16/9]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(70%_80%_at_30%_40%,#3B3F9E_0%,#1A1B45_45%,#0B0C1E_100%)]" />
        <div className="absolute inset-y-0 left-0 w-2/3 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,.04)_0_18px,transparent_18px_42px)]" />
        <div className="absolute left-[18%] top-[22%] h-56 w-56 rounded-full bg-[#585DFE]/40 blur-3xl sm:h-80 sm:w-80" />
        <span className="absolute left-1/2 top-[38%] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-heading shadow-lg transition-transform group-hover:scale-105 sm:left-[34%] sm:top-1/2 sm:h-20 sm:w-20">
          <Play className="ml-1 h-7 w-7 fill-current" />
        </span>
        <PortalMock />
        <span className="absolute bottom-6 left-6 right-6 text-[26px] font-medium leading-8 tracking-[-0.4px] text-white sm:bottom-10 sm:left-10 sm:text-[36px] sm:leading-[42px]">O programa de parceria Kloel</span>
      </button>
    </section>
  )
}

function PortalMock() {
  return (
    <div className="absolute bottom-24 right-0 hidden w-[44%] rounded-l-xl bg-white text-ink shadow-2xl sm:block lg:bottom-[12%]">
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-5 py-3 text-[11px] text-slate-400">
        Início <span>›</span> <span className="text-ink">Painel de indicações</span>
      </div>
      <div className="px-5 pb-5 pt-4">
        <div className="text-[18px] font-medium">Portal do parceiro</div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-[10px] text-slate-400">Comissão total</div>
            <div className="mt-1 text-[16px] font-medium">R$ 12.360</div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-[10px] text-slate-400">Participação em novos clientes</div>
            <div className="mt-1 text-[16px] font-medium">
              35% <span className="text-[10px] font-normal">vitalício</span>
            </div>
            <div className="text-[10px] text-brand-blue">Status Diamond</div>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <div className="text-[10px] text-slate-400">Nome</div>
          {[70, 55, 80].map((w) => (
            <div key={w} className="mt-2.5 h-2.5 rounded bg-slate-100" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ReferOrResell() {
  const dots = { backgroundImage: 'radial-gradient(rgba(15,15,22,.10) 1px, transparent 1px)', backgroundSize: '14px 14px' }
  return (
    <section className="mt-24 bg-[#F7F8FB] py-20 sm:mt-32 sm:py-28">
      <div className="mx-auto max-w-[1360px] px-5">
        {/* [252]: subtítulo a 17px do título, cartões a 63px do subtítulo e botão 40px abaixo; cartões do meio com 231px */}
        <div className="flex flex-col items-center gap-[17px] text-center">
          <SiteHeading>Indicar ou revender</SiteHeading>
          <p className="text-[16px] leading-6 text-body">
            Uma conta de parceiro, flexibilidade máxima. <b className="font-medium text-ink">Você escolhe o que melhor se adapta a cada cliente!</b>
          </p>
        </div>
        <div className="mt-[63px] grid gap-4 lg:grid-cols-3">
          <BentoCard n="01" icon={<Plus className="h-4 w-4" />} title="Novo cliente" text="Decida por cliente se a Kloel emitirá a nota fiscal (indicar) ou você mesmo (revender)." tall>
            <div className="relative mx-auto mt-6 h-[260px] w-full max-w-[360px] rounded-xl" style={dots}>
              <div className="absolute left-1/2 top-6 -translate-x-1/2">
                <InitialsAvatar name="Nova Cliente" tone={2} className="h-[84px] w-[84px] border-4 border-white text-[22px] shadow" />
                <span className="absolute -bottom-2 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-brand-blue text-white ring-4 ring-white">
                  <Plus className="h-4 w-4" />
                </span>
              </div>
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 360 260" fill="none" aria-hidden>
                <path d="M180 118 C 120 118, 80 120, 80 190" stroke="#585DFE" strokeWidth="1.5" strokeDasharray="5 5" />
                <path d="M180 118 C 240 118, 280 120, 280 190" stroke="#585DFE" strokeWidth="1.5" strokeDasharray="5 5" />
              </svg>
              <span className="absolute left-[10%] top-[190px] inline-flex -rotate-3 items-center gap-1.5 rounded-lg border-l-2 border-brand-blue bg-white px-3 py-2 text-[14px] shadow-md">
                <Link2 className="h-3.5 w-3.5 text-brand-blue" /> Indicar
              </span>
              <span className="absolute right-[10%] top-[186px] inline-flex rotate-2 items-center gap-1.5 rounded-lg border-l-2 border-brand-blue bg-white px-3 py-2 text-[14px] shadow-md">
                <Store className="h-3.5 w-3.5 text-brand-blue" /> Revender
              </span>
            </div>
          </BentoCard>
          <div className="flex flex-col gap-4">
            <BentoCard n="02" accent icon={<Link2 className="h-4 w-4" />} title="Indicar" text={<><b className="font-medium text-ink">Indique a Kloel</b>, nós enviamos a nota fiscal e você ganha uma comissão. Opcional: venda seus próprios serviços ao mesmo tempo.</>} />
            <BentoCard n="02" icon={<Store className="h-4 w-4" />} title="Revender" text={<><b className="font-medium text-ink">Revenda a Kloel</b>, emita a nota fiscal você mesmo e receba um desconto na compra. Opcional: não entraremos em contato com o seu cliente final.</>} />
          </div>
          <BentoCard n="03" icon={<Database className="h-4 w-4" />} title="Suporte ao cliente" text="Ofereça suporte contínuo aos seus clientes e mantenha até 35% de participação na receita." tall>
            <div className="relative mx-auto mt-6 h-[260px] w-full max-w-[380px]">
              {[
                { tag: 'Indicar', icon: Link2, cls: 'left-0 top-2 -rotate-1' },
                { tag: 'Revender', icon: Store, cls: 'left-8 top-16 rotate-1' },
                { tag: 'Indicar', icon: Link2, cls: 'left-16 top-[124px] rotate-[3deg]' },
              ].map((c, i) => (
                <div key={i} className={cn('absolute w-[78%] rounded-xl border border-slate-200 bg-white p-3 shadow-md', c.cls)}>
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="inline-flex items-center gap-1 rounded-md bg-[#F1F1FE] px-1.5 py-0.5 text-brand-blue">
                      <c.icon className="h-3 w-3" /> {c.tag}
                    </span>
                    <span className="font-medium">Diamond</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <InitialsAvatar name={['Ana Lima', 'Caio Reis', 'Eva Melo'][i]!} tone={i + 3} className="h-7 w-7 text-[10px]" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-1.5 w-3/4 rounded bg-slate-200" />
                      <div className="h-1.5 w-1/2 rounded bg-slate-100" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </BentoCard>
        </div>
        <div className="mt-10 flex justify-center">
          <Link to={BOOK} className={siteButton('dark')}>
            Agende agora uma conversa inicial
          </Link>
        </div>
      </div>
    </section>
  )
}

function BentoCard({ n, icon, title, text, children, tall, accent }: { n: string; icon: ReactNode; title: string; text: ReactNode; children?: ReactNode; tall?: boolean; accent?: boolean }) {
  return (
    <div className={cn('flex flex-col rounded-2xl border border-slate-200 bg-white p-4', tall ? 'min-h-[480px]' : 'flex-1')}>
      <div className="flex items-center justify-between">
        <span className={cn('text-[15px]', accent ? 'text-brand-blue' : 'text-slate-400')}>{n}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F4F5FB] text-brand-blue">{icon}</span>
      </div>
      {children}
      <div className={cn('flex flex-col gap-2.5', tall ? 'mt-auto pt-6' : 'mt-[28px] pb-6')}>
        <h3 className="text-[20px] font-medium leading-7 tracking-[-0.15px] text-heading">{title}</h3>
        <p className="text-[16px] leading-6 text-body">{text}</p>
      </div>
    </div>
  )
}

function TiersSection() {
  const [mode, setMode] = useState<'indicar' | 'revender'>('indicar')
  const [open, setOpen] = useState<string | null>(null)
  const tiers = mode === 'indicar' ? TIERS_REFER : TIERS_RESELL
  const shades = mode === 'indicar' ? ['#F7F7FD', '#F1F1FC', '#ECECFB', '#E5E5FA', '#DDDDF8'] : ['#F1F1FC', '#ECECFB', '#E5E5FA', '#DDDDF8']
  return (
    <section className="mx-auto max-w-[820px] px-5 pt-24 sm:pt-32">
      {/* [253]/[254]: subtítulo a 12px do título, abas de 41px a 30px do subtítulo */}
      <div className="flex flex-col items-center gap-3 text-center">
        <SiteHeading>Nível de parceria</SiteHeading>
        <p className="text-[16px] leading-6 text-body">
          Decida por cliente quem emite a nota fiscal: você ou a Kloel.
        </p>
        <SitePills<'indicar' | 'revender'>
          className="mt-[30px]"
          itemClassName="h-[33px] rounded-[8px] px-3"
          ariaLabel="Modelo de parceria"
          value={mode}
          onChange={(v) => {
            setMode(v)
            setOpen(null)
          }}
          options={[
            { value: 'indicar', label: 'Indicar', icon: <Link2 className="h-4 w-4 text-brand-blue" /> },
            { value: 'revender', label: 'Revender', icon: <Store className="h-4 w-4 text-brand-blue" /> },
          ]}
        />
      </div>
      <div className="mx-auto mt-10 max-w-[576px] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_6px_24px_rgba(15,15,22,.04)] sm:p-4" data-testid="tiers">
        <div className="flex justify-between px-2 pb-8 pt-0 text-[16px] font-medium text-ink">
          <span>Nível</span>
          <span>{mode === 'indicar' ? 'Comissão' : 'Desconto'}</span>
        </div>
        <div className="flex flex-col gap-2">
          {tiers.map((t, i) => {
            const isOpen = open === t.name
            return (
              <div key={t.name} className="rounded-xl" style={{ background: shades[i] }}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.name)} className="flex w-full items-center justify-between gap-4 rounded-xl px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
                  <span>
                    <span className="block text-[16px] font-medium leading-6 text-heading">{t.name}</span>
                    <span className="block text-[14px] leading-5 text-body">
                      Faturamento anual <b className="whitespace-nowrap font-medium text-ink">{t.revenue}</b>
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="flex items-center justify-end gap-2 text-[16px] font-medium leading-6 text-heading">
                      <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
                      {t.pct}
                    </span>
                    <span className="block text-[14px] leading-5 text-body">
                      até <b className="whitespace-nowrap font-medium text-ink">{t.cap}</b>
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <ul className="flex flex-col gap-2 px-4 pb-5 text-[14px] text-body" data-testid={`tier-details-${t.name}`}>
                    {t.details.map((d) => (
                      <li key={d} className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" /> {d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-10 flex justify-center">
        <Link to={BOOK} className={siteButton('dark')}>
          Agende agora uma conversa inicial
        </Link>
      </div>
    </section>
  )
}

function TrustSection() {
  return (
    // [255]: grade de 1320px, cartões de 473px (desktop)
    <section className="mx-auto max-w-[1360px] px-5 pt-24 sm:pt-32">
      <div className="flex flex-col items-center gap-[15px] text-center">
        <SiteHeading className="max-w-[560px]">Confiança na qual os parceiros se apoiam</SiteHeading>
        <p className="max-w-[580px] text-[16px] leading-6 text-body">
          Nossa infraestrutura segue a LGPD, e nossos parceiros confirmam o valor agregado na colaboração diária.
        </p>
        <div className="mt-2 flex max-w-[680px] flex-wrap justify-center gap-3">
          {['Em conformidade com a LGPD', 'Dados criptografados', 'Infraestrutura em nuvem segura'].map((c) => (
            <Chip key={c} icon={<BadgeCheck className="h-[18px] w-[18px] fill-brand-blue text-white" />}>
              {c}
            </Chip>
          ))}
        </div>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PARTNER_TESTIMONIALS.map((t) => (
          <figure key={t.name} className="flex flex-col justify-between gap-10 rounded-2xl border border-slate-200 bg-white p-7 lg:min-h-[473px]">
            <div>
              <Stars />
              <blockquote className="mt-[21px] text-[16px] leading-6 text-[#3F4454]">{t.quote}</blockquote>
            </div>
            <figcaption className="flex items-center gap-3">
              <InitialsAvatar name={t.name} className="h-11 w-11" />
              <span>
                <span className="block text-[16px] font-medium text-heading">{t.name}</span>
                <span className="block text-[14px] text-body">{t.company}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}

function FaqSection({ openCustom }: { openCustom: () => void }) {
  const [tab, setTab] = useState<FaqTab>('geral')
  const faq = useMemo(() => partnerFaq(openCustom), [openCustom])
  return (
    <section id="faq" className="mx-auto max-w-[680px] scroll-mt-20 px-5 pb-12 pt-24 sm:pt-32">
      {/* [258]–[273]: abas de 41px a ≈90px do título; perguntas com 59px; resposta 16/24 quase na largura da lista */}
      <div className="flex flex-col items-center gap-[46px] text-center">
        <SiteHeading>Perguntas frequentes</SiteHeading>
        <SitePills<FaqTab>
          itemClassName="h-[33px] rounded-[8px] px-3"
          ariaLabel="Categoria das perguntas"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'geral', label: 'Geral', icon: <CircleHelp className="h-4 w-4 text-brand-blue" /> },
            { value: 'indicar', label: 'Indicar', icon: <Link2 className="h-4 w-4 text-brand-blue" /> },
            { value: 'revender', label: 'Revender', icon: <Store className="h-4 w-4 text-brand-blue" /> },
          ]}
        />
      </div>
      <div className="mt-[34px]" data-testid="partner-faq">
        <FaqAccordion
          key={tab}
          idPrefix={`faq-${tab}`}
          items={faq[tab]}
          defaultOpen={tab === 'geral' ? 0 : undefined}
          compact
        />
      </div>
    </section>
  )
}

const CHAPTERS = [
  { t: 0, label: 'Como funciona a parceria' },
  { t: 25, label: 'Indicar ou revender' },
  { t: 52, label: 'Portal do parceiro' },
  { t: 74, label: 'Níveis e comissões' },
]
const DURATION = 96

/** Player SIMULADO (não há vídeo real da Kloel): reproduz/pausa, barra de progresso e capítulos. */
function VideoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [t, setT] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval>>()
  useEffect(() => {
    if (!open) {
      setPlaying(false)
      setT(0)
    }
  }, [open])
  useEffect(() => {
    if (!playing) return
    timer.current = setInterval(() => setT((x) => (x + 1 >= DURATION ? (setPlaying(false), DURATION) : x + 1)), 1000)
    return () => clearInterval(timer.current)
  }, [playing])
  const onCloseAutoFocus = useReturnFocus(open)
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const chapter = [...CHAPTERS].reverse().find((c) => t >= c.t)!
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[860px] gap-y-4 bg-[#0B0C1E] p-4 text-white font-site sm:rounded-2xl sm:p-5" closeClassName="text-white" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle className="pr-8 text-[18px] font-medium">O programa de parceria Kloel</DialogTitle>
        <DialogDescription className="sr-only">Vídeo de apresentação do programa de parceria Kloel, com capítulos.</DialogDescription>
        <div className="relative aspect-video overflow-hidden rounded-xl bg-[radial-gradient(70%_80%_at_30%_40%,#3B3F9E_0%,#1A1B45_45%,#0B0C1E_100%)]">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <span className="text-[13px] uppercase tracking-[0.12em] text-white/60">Capítulo</span>
            <span className="px-6 text-[24px] font-medium sm:text-[30px]">{chapter.label}</span>
          </div>
          <button type="button" aria-label={playing ? 'Pausar' : 'Reproduzir'} onClick={() => setPlaying((p) => (t >= DURATION ? (setT(0), true) : !p))} className="absolute bottom-4 left-4 flex h-11 w-11 items-center justify-center rounded-full bg-white text-heading">
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
          </button>
          <button type="button" aria-label={muted ? 'Ativar som' : 'Desativar som'} aria-pressed={muted} onClick={() => setMuted((m) => !m)} className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20">
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          {muted && <span className="absolute bottom-7 right-16 text-[12px] text-white/70">Sem som</span>}
        </div>
        <div className="flex items-center gap-3 text-[13px] tabular-nums text-white/70">
          <span>{mmss(t)}</span>
          <input type="range" min={0} max={DURATION} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Posição do vídeo" className="h-1 flex-1 accent-[#585DFE]" />
          <span>{mmss(DURATION)}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {CHAPTERS.map((c) => (
            <button key={c.label} type="button" onClick={() => { setT(c.t); setPlaying(true) }} className={cn('rounded-lg border px-3 py-2 text-left text-[13px] transition-colors', chapter.label === c.label ? 'border-brand-blue bg-brand-blue/20 text-white' : 'border-white/10 text-white/70 hover:bg-white/5')}>
              <span className="block tabular-nums text-white/50">{mmss(c.t)}</span>
              {c.label}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
