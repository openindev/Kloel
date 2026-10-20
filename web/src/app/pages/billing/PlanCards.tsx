import { useEffect, useState } from 'react'
import { captureEngineContext } from '@/services/engine/session'
import { createBillingService, type BillingCatalog } from '@/services/engine/billing'
import { useNavigate } from 'react-router-dom'
import { CircleCheck, CircleX, CircleHelp, Star, ArrowRight, Check } from 'lucide-react'
import type { BillingInterval, ProductKey } from '@/domain/types'
import { productByKey, type PlanDef } from '@/data/catalogs/plans'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { BetaBadge } from '@/components/ui/badge'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { moneyInt, planMonthly } from './lib'
import { ScaleConfigDialog } from './ScaleConfigDialog'

// Desabilitado = opacity-50 (medido em [468]: "Selecionar plano (Atual)" com tinta #848485 = #09090B a 50%).
const OUTLINE_BTN = 'inline-flex w-full h-10 items-center justify-center rounded-lg text-sm font-medium shadow-sm transition-colors border bg-white hover:bg-[#f5f6ff] disabled:pointer-events-none disabled:opacity-50'
const BRAND_BTN = 'inline-flex w-full h-10 items-center justify-center rounded-lg text-sm font-medium shadow-sm transition-colors bg-[#585dfe] text-primary-foreground border-none hover:bg-[#464ac4] disabled:opacity-60'

/**
 * Preços ao vivo do Stripe (GET /billing/catalog, STRIPE_PRICE_IDS). Valor em centavos por ciclo:
 * mensal = por mês; anual = total do ano. Sem catálogo (sessão/plano indisponível) usa o catálogo estático.
 */
let liveCatalog: Promise<BillingCatalog | null> | null = null
function useLiveCatalog() {
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null)
  useEffect(() => {
    let alive = true
    if (!liveCatalog) {
      try { liveCatalog = createBillingService(captureEngineContext()).catalog().catch(() => { liveCatalog = null; return null }) }
      catch { liveCatalog = null }
    }
    void liveCatalog?.then((c) => alive && setCatalog(c && c.configured ? c : null))
    return () => { alive = false }
  }, [])
  return catalog
}
/** Valor exibido: mensal equivalente + total cobrado no ciclo. */
export function planPricing(catalog: BillingCatalog | null, product: ProductKey, plan: PlanDef, interval: BillingInterval) {
  const live = catalog?.items.find((p) => p.currency === 'brl' && p.unitAmount != null && p.kloelPlan?.product === product && p.kloelPlan.tier === plan.tier && p.kloelPlan.interval === interval)
  if (live) { const cycle = live.unitAmount! / 100; return { perMonth: interval === 'annual' ? cycle / 12 : cycle, cycle, live: true } }
  const perMonth = planMonthly(plan, interval)
  return perMonth == null ? null : { perMonth, cycle: interval === 'annual' ? perMonth * 12 : perMonth, live: false }
}

/** Tooltips (?) dos cartões "Alterar plano" — textos da Fonio ao vivo (fonio-live2/K-admin/09, 12, 13 · data/admin.json). */
const FEATURE_INFO: { product: ProductKey; match: RegExp; text: string }[] = [
  { product: 'webchat', match: /^\d+ conversas$/, text: '1 conversa = até 10 mensagens' },
  { product: 'webchat', match: /^Agendamento de horários incluído/, text: '1 integração de calendário' },
  { product: 'voice', match: /^A partir de \d+ minutos$/, text: 'A partir de R$ 0,50 por minuto.' },
]

function perMinute(plan: PlanDef, interval: BillingInterval) {
  const price = planMonthly(plan, interval)
  const minutes = plan.limits.minutes
  if (!price || !minutes) return null
  return (price / minutes).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function FeatureText({ text }: { text: string }) {
  const m = /^Tudo de (.+)$/.exec(text)
  if (m) return <>Tudo de <strong className="font-semibold">{m[1]}</strong></>
  return <>{text}</>
}

export interface PlanCardsProps {
  product: ProductKey
  interval: 'monthly' | 'annual'
  currentTier?: string
  onSelect: (tier: string) => void
  /** Exibe o interruptor "cobrança anual -20%" em cada cartão (modal de primeiro acesso). */
  onIntervalChange?: (interval: BillingInterval) => void
  /** 'onboarding' = modal de primeiro acesso; 'change' = "Alterar plano"/"Adicionar assinatura" (todos com "Falar com vendas"). */
  variant?: 'onboarding' | 'change'
  /** Plano já escolhido no carrinho (primeiro acesso). */
  selectedTier?: string
  /** Plano escolhido no cadastro público (signupIntent): destacado com "Escolhido no cadastro" até ser confirmado. */
  highlightTier?: string
  onTalkToSales?: () => void
  /** Desabilita somente "Selecionar plano" (ex.: usuário sem permissão de administrador). "Falar com vendas"/"Configurar plano" continuam ativos. */
  disabled?: boolean
  className?: string
}

/**
 * CONTRATO: cartões de plano do app (moldura "Alterar plano" / modal de primeiro acesso).
 * Implementado pelo módulo Cobrança/Onboarding. `onSelect` recebe o tier escolhido.
 * Classes conforme captura ao vivo (app-12-billing.txt, "/change-plan").
 */
export function PlanCards({ product, interval, currentTier, onSelect, onIntervalChange, variant, selectedTier, highlightTier, onTalkToSales, disabled, className }: PlanCardsProps) {
  const navigate = useNavigate()
  const def = productByKey(product)
  const mode = variant ?? (onIntervalChange ? 'onboarding' : 'change')
  const [scaleOpen, setScaleOpen] = useState(false)
  const [moreOf, setMoreOf] = useState<PlanDef | null>(null)
  const talk = onTalkToSales ?? (() => navigate('/agendar-demo'))
  const single = def.plans.length === 1
  const catalog = useLiveCatalog()

  return (
    <>
      <div
        className={cn(
          'grid w-full grid-cols-1 gap-8 pb-6 lg:gap-5',
          single ? 'max-w-sm' : 'max-w-4xl lg:grid-cols-3',
          className,
        )}
        data-product={product}
        data-interval={interval}
        data-current={currentTier}
      >
        {def.plans.map((plan) => {
          const recommended = !!plan.recommended
          const isCurrent = currentTier === plan.tier
          const isSelected = selectedTier === plan.tier
          const isHighlighted = !isSelected && highlightTier === plan.tier
          const custom = plan.monthly == null
          const pricing = custom ? null : planPricing(catalog, product, plan, interval)
          const price = pricing?.perMonth ?? planMonthly(plan, interval)
          const otherAnnual = !custom && interval === 'monthly' ? planPricing(catalog, product, plan, 'annual') : null
          const pm = product === 'voice' ? perMinute(plan, interval) : null
          return (
            <div
              key={plan.tier}
              data-tier={plan.tier}
              className={cn(
                'group relative w-full rounded-lg border bg-white shadow-sm transition border-gray-200 hover:-translate-y-1 hover:border-[#585dfe] hover:shadow-lg',
                recommended && 'border-2 border-[#585dfe]',
                isSelected && 'ring-2 ring-[#585dfe]/30',
                isHighlighted && 'ring-2 ring-[#585dfe]/40',
              )}
              data-highlighted={isHighlighted || undefined}
            >
              {isHighlighted && (
                <span className="absolute right-3 top-3 rounded-full bg-[#585dfe]/10 px-2 py-0.5 text-[11px] font-semibold text-[#585dfe]">Escolhido no cadastro</span>
              )}
              {recommended && (
                <div className="absolute -top-[16px] left-1/2 flex translate-x-[-50%] items-center gap-1 whitespace-nowrap rounded-xl bg-[#585dfe] px-3 py-1 text-xs font-semibold text-primary-foreground">
                  <Star className="h-3 w-3" /> Nossa recomendação
                </div>
              )}
              <div className="p-5 pb-0">
                <h3 className="flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight">
                  {plan.name}
                  {product === 'email' && <BetaBadge />}
                </h3>
                {/* Medido nas referências: WhatsApp/Chatbot reservam 46px no subtítulo (fonio-live2/K-admin/10–11, [444], [447], [468]);
                    Telefone IA não reserva — nem no primeiro acesso ([441]/[442]) nem em "Alterar plano" (fonio-live2/K-admin/08:
                    divisor 23px abaixo do subtítulo, live-compare/K-admin/08). */}
                <p className={cn('pt-[6px] text-sm text-muted-foreground', product !== 'voice' && 'min-h-[46px]')}>{plan.appTagline}</p>
                <hr className="my-3 border-gray-200" />
                {custom ? (
                  // [441]/[468]: "Preço individual" com tracking-tight e alinhado ao topo da caixa de 36px (não centralizado).
                  <div className="h-[36px] text-lg font-semibold tracking-tight">Preço individual</div>
                ) : (
                  <div className="text-2xl font-semibold tracking-tight">
                    {moneyInt(price ?? 0)}
                    <span className="ml-2 text-sm font-normal tracking-normal text-gray-500">/ mês</span>
                    <div className="mt-1 text-xs font-normal tracking-normal text-gray-500" data-testid="plan-billing-line">
                      {interval === 'annual' && pricing
                        ? `${moneyInt(pricing.cycle)} cobrados anualmente`
                        : otherAnnual && otherAnnual.perMonth < (price ?? 0)
                          ? `cobrança mensal · ${moneyInt(otherAnnual.perMonth)}/mês no anual`
                          : 'cobrança mensal'}
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-4">
                  {mode === 'onboarding' && !custom && onIntervalChange && (
                    // [441]/[442]: rótulo de 12px; pílula -20% com 52×22 (px-2.5 + borda), alinhada ao interruptor.
                    <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs">
                      <Switch
                        checked={interval === 'annual'}
                        onCheckedChange={(v) => onIntervalChange(v ? 'annual' : 'monthly')}
                        aria-label="cobrança anual"
                        className="data-[state=checked]:bg-[#3FA34D]"
                      />
                      <span>cobrança anual</span>
                      <span className="rounded-full border border-transparent bg-[#3FA34D] px-2.5 py-0.5 text-xs font-semibold text-white">-20%</span>
                    </label>
                  )}
                  {(mode === 'change' || custom) && (
                    <button type="button" className={OUTLINE_BTN} onClick={talk}>
                      Falar com vendas
                    </button>
                  )}
                  {custom ? (
                    <button type="button" className={OUTLINE_BTN} onClick={() => setScaleOpen(true)}>
                      Configurar plano
                    </button>
                  ) : isCurrent ? (
                    <button type="button" className={OUTLINE_BTN} disabled>
                      Selecionar plano <span className="ml-2">(Atual)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={recommended ? BRAND_BTN : OUTLINE_BTN}
                      onClick={() => onSelect(plan.tier)}
                      disabled={disabled}
                    >
                      {isSelected ? (
                        <>
                          <Check className="mr-1.5 h-4 w-4" /> No carrinho
                        </>
                      ) : (
                        'Selecionar plano'
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div className="p-5 pt-0">
                <hr className="my-3 border-gray-200" />
                <div className="mb-1 flex justify-center text-[10px] font-semibold tracking-widest text-gray-500">RECURSOS PRINCIPAIS</div>
                <ul>
                  {plan.appFeatures.map((f) => {
                    const info = FEATURE_INFO.find((i) => i.product === product && i.match.test(f.text))
                    // "R$ 0,60" não quebra entre símbolo e valor (espaço rígido, como o Intl da referência): [441] "corresponde a / R$ 0,60 / min",
                    // [444]/[468] "3 integrações de / calendário (R$ 36 / integração extra)".
                    const extra = (pm && f.extra?.startsWith('corresponde a') ? `corresponde a R$ ${pm} / min` : f.extra)?.replace(/R\$ (?=\d)/g, 'R$\u00a0')
                    return (
                      <li key={f.text} className="flex items-start py-[5px]">
                        {f.negative ? (
                          <CircleX className="mr-1.5 mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        ) : (
                          <CircleCheck className="mr-1.5 mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        {/* Medido em [441]/[444]/[447]/[468]: texto a 6px do ícone e com traço de peso 400 (a classe capturada é font-medium, mas a Fonio renderiza 400). */}
                        <span className={cn('min-w-0 text-sm font-normal text-gray-700', !info && 'flex-1', f.negative && 'text-gray-400')}>
                          <FeatureText text={f.text} />
                          {extra && <span className="ml-2 text-xs italic text-gray-500">{extra}</span>}
                        </span>
                        {info && (
                          <SimpleTooltip label={info.text}>
                            <button type="button" aria-label="Mais informações" className="ml-2 shrink-0 self-center text-gray-500 hover:text-foreground">
                              <CircleHelp className="h-4 w-4" />
                            </button>
                          </SimpleTooltip>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {product === 'care' && (
                  <button type="button" onClick={() => setMoreOf(plan)} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                    e mais <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
                {product === 'email' && <p className="mt-2 text-[10px] text-muted-foreground">* Sujeitos a uso justo</p>}
              </div>
            </div>
          )
        })}
      </div>
      <ScaleConfigDialog product={product} open={scaleOpen} onOpenChange={setScaleOpen} interval={interval} />
      <Dialog open={!!moreOf} onOpenChange={(o) => !o && setMoreOf(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="gap-y-2">
            <DialogTitle>{moreOf?.name}</DialogTitle>
            <DialogDescription>{moreOf?.appTagline}</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2 text-sm">
            {moreOf?.appFeatures.map((f) => (
              <li key={f.text} className="flex items-start gap-2">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <span><FeatureText text={f.text} /></span>
              </li>
            ))}
            <li className="flex items-start gap-2 text-muted-foreground">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Agendamento das sessões 1:1 diretamente com o time Kloel após a contratação.</span>
            </li>
          </ul>
          <div className="flex justify-end">
            <Button onClick={() => setMoreOf(null)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
