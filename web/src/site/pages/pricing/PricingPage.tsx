import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BadgeCheck, Bot, Check, CirclePlus, Gauge, Info, LayoutGrid, LifeBuoy, MessageSquareText, Palette, Phone, PhoneCall, Sparkles, Webhook, X, MessageCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { productByKey, type PlanDef } from '@/data/catalogs/plans'
import { WhatsAppIcon } from '@/components/brand/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FinalCta } from '@/site/components/sections/FinalCta'
import { AvatarStack, SitePills, SoftAurora, siteButton } from '../company/kit'
import { CARD_INFO, COMPARISON, PRODUCT_TABS, PUBLIC_TAGLINE_OVERRIDE, type Cell, type CompareGroup } from './comparison'
import { publicPlanPrice, publicPlanSavings } from '@/site/components/sections/PricingCards'
import { ScaleCalculatorDialog } from './ScaleCalculatorDialog'

type Prod = 'voice' | 'whatsapp' | 'webchat'
const PRODUCT_ICON: Record<Prod, ReactNode> = {
  voice: <PhoneCall className="h-4 w-4" />,
  whatsapp: <WhatsAppIcon className="h-4 w-4" />,
  webchat: <MessageSquareText className="h-4 w-4" />,
}
const GROUP_ICON: Record<CompareGroup['icon'], typeof Gauge> = {
  gauge: Gauge, bot: Bot, phone: Phone, sparkles: Sparkles, webhook: Webhook, 'life-buoy': LifeBuoy, grid: LayoutGrid, plus: CirclePlus, message: MessageCircle, palette: Palette,
}

const fmt = (n: number) => n.toLocaleString('pt-BR')

/** Preço exibido na página pública (Scale = "a partir de"; anual = `plan.publicAnnual ?? plan.annual`). */
function publicPrice(_prod: Prod, plan: PlanDef, annual: boolean) {
  return publicPlanPrice(plan, annual ? 'annual' : 'monthly')
}

/** "equivalem a R$0,71/min" recalculado para o ciclo escolhido (valores do catálogo; arredondado para baixo como na referência). */
function perMinute(price: number, minutes: number) {
  const v = Math.floor((price / minutes) * 100) / 100
  return `equivalem a R$${v.toFixed(2).replace('.', ',')}/min`
}

/**
 * ⓘ explicativo dos cartões e da tabela. Abre ao passar o mouse (como o tooltip da referência) e também ao
 * tocar/clicar — em telas de toque não existe hover. Um segundo toque/clique, Esc ou um toque fora fecha.
 */
function InfoTip({ text }: { text?: string }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(leaveTimer.current), [])
  if (!text) return null
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        setPinned(o)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Mais informações"
          className="inline-flex align-[-2px] text-slate-400 hover:text-ink data-[state=open]:text-ink"
          onPointerEnter={(e) => {
            if (e.pointerType !== 'mouse') return
            clearTimeout(leaveTimer.current)
            setOpen(true)
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== 'mouse' || pinned) return
            leaveTimer.current = setTimeout(() => setOpen(false), 80)
          }}
          onClick={(e) => {
            // Aberto pelo hover: o clique fixa a explicação em vez de fechá-la.
            if (open && !pinned) {
              e.preventDefault()
              setPinned(true)
            }
          }}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="tooltip"
        side="top"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-auto max-w-[260px] border-0 bg-primary px-3 py-1.5 font-site text-[13px] leading-5 text-primary-foreground shadow-md"
      >
        {text}
      </PopoverContent>
    </Popover>
  )
}

export default function PricingPage() {
  const [params, setParams] = useSearchParams()
  const prodParam = params.get('produto')
  const prod: Prod = prodParam === 'whatsapp' || prodParam === 'webchat' ? prodParam : 'voice'
  const annual = params.get('ciclo') === 'anual'
  const scaleOpen = params.get('configurar') === 'scale'

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) n.delete(k)
          else n.set(k, v)
        }
        return n
      },
      { replace: true, preventScrollReset: true },
    )

  const product = productByKey(prod)
  const signupHref = (tier: string) => `/criar-conta?produto=${prod}&plano=${tier}&ciclo=${annual ? 'anual' : 'mensal'}`
  const openScale = () => update({ configurar: 'scale' })

  return (
    <main className="font-site">
      <section className="relative">
        <SoftAurora intensity={0.75} />
        {/* Medidas conferidas com [274]/[293] em 1470 px: título 48px, garantia 16px, abas 15px, cartões a 345px do topo. */}
        <div className="relative mx-auto max-w-[1180px] px-4 pb-10 pt-14 sm:pt-20">
          <div className="flex flex-col items-center gap-2.5 text-center">
            <h1 className="text-[40px] font-medium leading-[46px] tracking-[-0.8px] text-heading sm:text-[48px] sm:leading-[55.2px] sm:tracking-[-0.96px]">Planos &amp; Preços</h1>
            <p className="max-w-[640px] text-balance text-[15px] leading-6 text-neutral-900 sm:max-w-none sm:text-[16px]">
              <BadgeCheck className="mr-2 inline h-[18px] w-[18px] shrink-0 fill-brand-blue align-[-4px] text-white" />
              Garantia Risco Zero: Teste por 30 dias ou receba seu dinheiro de volta
            </p>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 sm:mt-9 md:flex-row md:justify-between">
            <SitePills<Prod>
              ariaLabel="Produto"
              value={prod}
              onChange={(v) => update({ produto: v === 'voice' ? null : v })}
              className="max-w-full gap-0.5 p-[5px]"
              itemClassName="h-[29px] rounded-[8px] px-3 text-[14px] sm:px-3.5 sm:text-[15px]"
              options={PRODUCT_TABS.map((t) => ({ value: t.key, label: <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></>, icon: PRODUCT_ICON[t.key] }))}
            />
            <SitePills<'mensal' | 'anual'>
              ariaLabel="Ciclo de cobrança"
              value={annual ? 'anual' : 'mensal'}
              onChange={(v) => update({ ciclo: v === 'anual' ? 'anual' : null })}
              className="p-1.5"
              itemClassName="h-[34px] rounded-[9px] px-3.5 text-[15px] sm:text-[15px]"
              options={[
                { value: 'mensal', label: 'Mensal' },
                { value: 'anual', label: <span>Anual <span className="ml-1.5 text-[14px] text-brand-blue">-20%</span></span> },
              ]}
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3" data-testid="plan-cards">
            {product.plans.map((plan) => (
              <PlanCard key={`${prod}-${plan.tier}`} prod={prod} plan={plan} annual={annual} href={signupHref(plan.tier)} onConfigure={openScale} />
            ))}
          </div>

          <div className="mt-10 flex justify-center">
            <Link to={`/agendar-demo?productType=${prod}&source=pricing`} className="inline-flex h-[47px] items-center gap-4 rounded-2xl border border-slate-200 bg-white pl-[22px] pr-5 text-[16px] text-ink shadow-[0_1px_2px_rgba(15,15,22,.04)] transition-colors hover:border-brand-blue/40 hover:bg-slate-50">
              Fale com um especialista
              <AvatarStack names={['Ana Especialista', 'Bruno Consultor', 'Carla Vendas']} size="sm" />
            </Link>
          </div>
        </div>
      </section>

      <ComparisonSection prod={prod} annual={annual} signupHref={signupHref} onConfigure={openScale} />

      {/* [285]: título com ponto final e subtítulo com travessão, como na referência (marca trocada) */}
      <FinalCta
        className="mt-20"
        title={<>Atendimento por voz<br className="hidden sm:block" /> reinventado, com a Kloel.</>}
        subtitle="Teste a kloel.ai e veja como nosso assistente de IA por voz automatiza suas ligações e libera sua equipe - simples, eficiente e 24 horas por dia."
        primary={{ label: 'Criar minha própria IA agora', to: '/criar-conta' }}
      />

      <ScaleCalculatorDialog open={scaleOpen} onOpenChange={(o) => update({ configurar: o ? 'scale' : null })} initialProduct={prod} initialAnnual={annual} />
    </main>
  )
}

function PlanCard({ prod, plan, annual, href, onConfigure }: { prod: Prod; plan: PlanDef; annual: boolean; href: string; onConfigure: () => void }) {
  const isScale = plan.tier === 'scale'
  const price = publicPrice(prod, plan, annual)
  const minutes = prod === 'voice' ? plan.limits.minutes : undefined
  // Economia exibida: no anual, mensal − preço público exibido (ex.: R$299 → R$250 = "Economize R$49", como em [295]).
  const savings = publicPlanSavings(plan, annual ? 'annual' : 'monthly')
  return (
    <div className={cn('relative flex flex-col rounded-2xl border bg-white px-6 pb-6 pt-8', plan.recommended ? 'border-brand-blue' : 'border-slate-200')} data-testid={`plan-${plan.tier}`}>
      {plan.recommended && <span className="absolute right-4 top-4 inline-flex h-[23px] items-center rounded-[8px] bg-brand-blue px-[9px] text-[11px] font-semibold uppercase tracking-[0.02em] text-white">Popular</span>}
      <h3 className="text-[20px] font-semibold leading-7 tracking-[-0.15px] text-heading">{plan.name}</h3>
      <p className="mt-1 text-[16px] leading-6 text-body">{PUBLIC_TAGLINE_OVERRIDE[prod]?.[plan.tier as 'solo' | 'team' | 'scale'] ?? plan.publicTagline}</p>
      <div className={cn('mt-5 flex flex-wrap gap-x-2.5', isScale ? 'items-baseline' : 'items-center')}>
        {isScale && <span className="text-[14px] text-body">a partir de</span>}
        <span className="text-[32px] font-semibold leading-10 tracking-[-0.3px] text-heading" data-testid={`price-${plan.tier}`}>
          R${fmt(price)}
        </span>
        {annual && !isScale && <span className="inline-flex h-[22px] items-center rounded-[6px] border border-brand-blue/50 px-2 text-[12px] font-medium text-brand-blue" data-testid={`savings-${plan.tier}`}>{savings}</span>}
      </div>
      {/* Scale: linha do selo "Tarifas personalizadas" (reservada também no mensal, como em [274]) */}
      {isScale && (
        <div className="mt-2 h-[22px]">
          {annual && <span className="inline-flex h-[22px] items-center rounded-[6px] border border-brand-blue/50 px-2 text-[12px] font-medium text-brand-blue" data-testid="savings-scale">{plan.savings}</span>}
        </div>
      )}
      <p className={cn('text-[14px] leading-5 text-body', isScale ? 'mt-0' : 'mt-0.5')}>{annual ? 'Por mês, cobrado anualmente' : 'Por mês'}</p>
      {isScale ? (
        <button type="button" onClick={onConfigure} className={cn(siteButton('dark'), 'mt-7 w-full text-[15px]')}>
          Configurar plano
        </button>
      ) : (
        <Link to={href} className={cn(siteButton(plan.recommended ? 'brand' : 'dark'), 'mt-7 w-full text-[15px]')}>
          Começar agora
        </Link>
      )}
      <div className="mt-6 h-px bg-slate-200" />
      <h4 className="mt-6 text-[16px] font-semibold leading-6 text-heading">Incluído</h4>
      <ul className="mt-3 flex flex-col gap-1">
        {plan.publicIncluded.map((it) => {
          const extra = it.extra?.startsWith('equivalem') && minutes ? perMinute(price, minutes) : it.extra
          return (
            <li key={it.text} className={cn('flex items-start gap-2 text-[16px] leading-6', it.negative ? 'text-slate-400' : 'text-ink')}>
              {it.negative ? <X className="mt-1 h-4 w-4 shrink-0" /> : <Check className="mt-1 h-4 w-4 shrink-0 text-brand-blue" />}
              <span>
                {it.text}
                {/* Telefone: complemento na mesma linha ([274]); WhatsApp/Webchat: linha menor abaixo, depois do ⓘ ([291]/[292]) */}
                {extra && prod === 'voice' && <span className="ml-1 text-[13px] text-body">{extra}</span>} {(it.info || CARD_INFO[it.text]) && <InfoTip text={CARD_INFO[it.text] ?? 'Detalhes do item do plano.'} />}
                {extra && prod !== 'voice' && <span className="block text-[13px] leading-5 text-body">{extra}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      <h4 className="mt-6 text-[16px] font-semibold leading-6 text-heading">Funcionalidades</h4>
      <ul className="mt-3 flex flex-col gap-1">
        {plan.publicFeatures.map((f) => (
          <li key={f.text} className="flex items-start gap-2 text-[16px] leading-6 text-ink">
            <Check className="mt-1 h-4 w-4 shrink-0 text-brand-blue" />
            <span>
              {f.text}
              {f.chip && <span className="ml-1.5 rounded-[6px] bg-slate-100 px-1.5 py-0.5 text-[14px] font-medium text-ink">{f.chip}</span>} {(f.info || CARD_INFO[f.text]) && <InfoTip text={CARD_INFO[f.text] ?? 'Detalhes da funcionalidade.'} />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CellValue({ v }: { v: Cell }) {
  if (v === true) return <Check className="mx-auto h-[18px] w-[18px] text-brand-blue" aria-label="Incluído" />
  if (v === false) return <X className="mx-auto h-[18px] w-[18px] text-slate-400" aria-label="Não incluído" />
  return <span>{v}</span>
}

function ComparisonSection({ prod, annual, signupHref, onConfigure }: { prod: Prod; annual: boolean; signupHref: (tier: string) => string; onConfigure: () => void }) {
  const product = productByKey(prod)
  const groups = COMPARISON[prod]
  const plans = product.plans
  const priceOf = (p: PlanDef) => publicPrice(prod, p, annual)
  return (
    <section id="comparar" className="relative mx-auto mt-16 max-w-[1180px] scroll-mt-24 px-4 sm:mt-24">
      <h2 className="text-balance text-center text-[28px] font-medium leading-[34px] tracking-[-0.28px] text-heading sm:text-[38px] sm:leading-[45.6px] sm:tracking-[-0.38px]">
        Comparar planos do {product.name}
      </h2>
      {prod !== 'voice' && (
        <p className="mt-3 text-center text-[14px] text-body">
          Resumo dos recursos de cada plano.
        </p>
      )}

      {/* Cabeçalho fixo dos planos (medidas de [279]/[280]: nome 24px, preço 14px, botões 37px; colunas terminam 12px antes da borda dos grupos) */}
      <div className="sticky top-[71px] z-20 mt-6 bg-white pb-4 pt-4 md:mt-8 md:pb-[26px] md:pt-[30px]">
        <div className="grid grid-cols-3 gap-2 md:grid-cols-[30.5%_1fr_1fr_1fr] md:gap-x-8 md:pr-3">
          <div className="hidden md:block" />
          {plans.map((p) => (
            <div key={p.tier} className="flex min-w-0 flex-col">
              <div className="text-[18px] font-semibold leading-6 tracking-[-0.2px] text-heading sm:text-[24px] sm:leading-[30px]">{p.name}</div>
              <div className="text-[12px] leading-5 text-body sm:text-[14px]">
                R$ {fmt(priceOf(p))} / mês
              </div>
              {p.tier === 'scale' ? (
                <button type="button" onClick={onConfigure} className="mt-2 inline-flex h-[34px] w-full items-center justify-center rounded-[10px] border border-line bg-white px-2 text-[13px] text-neutral-950 hover:bg-slate-50 sm:h-[37px] sm:text-[15px]">
                  <span className="truncate">Configurar plano</span>
                </button>
              ) : (
                <Link
                  to={signupHref(p.tier)}
                  className={cn(
                    'mt-2 inline-flex h-[34px] w-full items-center justify-center rounded-[10px] px-2 text-[13px] sm:h-[37px] sm:text-[15px]',
                    p.recommended ? 'bg-heading text-white hover:bg-heading/90' : 'border border-line bg-white text-neutral-950 hover:bg-slate-50',
                  )}
                >
                  <span className="truncate">Começar agora</span>
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((g) => {
          const Icon = GROUP_ICON[g.icon]
          return (
            <div key={g.title} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4 md:py-[15px]">
                <Icon className="h-4 w-4 text-brand-blue" />
                <h3 className="text-[16px] font-semibold leading-6 text-heading">{g.title}</h3>
              </div>
              {g.rows.map((r, i) => (
                <Fragment key={r.label}>
                  <div className={cn('grid grid-cols-3 gap-x-2 border-b border-slate-200/80 px-4 py-3 text-[14px] last:border-b-0 sm:text-[15px] md:min-h-[52px] md:grid-cols-[calc(30.5%-14.6px)_1fr_1fr_1fr] md:items-center md:gap-x-8 md:py-0 md:pl-5 md:pr-[11px]', i % 2 === 0 ? 'bg-[#FAFAFD]' : 'bg-white')}>
                    {/* [281]: rótulos longos quebram em linhas equilibradas ("Base de conhecimento com / aprendizado autônomo"), linha de 24px */}
                    <div className="col-span-3 mb-2 flex items-center gap-2 text-body md:col-span-1 md:mb-0 md:py-3 md:leading-6">
                      <span className="text-balance">{r.label}</span>
                      <InfoTip text={r.info} />
                    </div>
                    {r.values.map((v, j) => (
                      <div key={j} className="text-center text-body md:py-3">
                        <CellValue v={v} />
                      </div>
                    ))}
                  </div>
                </Fragment>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
