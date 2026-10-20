import { PRODUCTS, productByKey } from '@/data/catalogs/plans'

/**
 * Regras e cálculo da calculadora do plano Scale (valores demonstrativos derivados do catálogo).
 * Compartilhado entre a calculadora (/planos?configurar=scale) e o agendamento de demo, que mostra a
 * configuração salva no lead (`?lead=<id>`).
 */
export type ScaleProd = 'voice' | 'whatsapp' | 'webchat'
export type CareTier = 'none' | 'essential' | 'pro' | 'premium'

export interface ScaleConfig {
  volume: number
  numbers: number
  outbound: number
  care: CareTier
}

export const SCALE_RULES: Record<ScaleProd, { unit: string; unitPlural: string; min: number; max: number; step: number; included: number; rate: number; numbersIncluded: number; numberPrice: number; numbersMax: number; numbersLabel?: string; numberSingular?: string }> = {
  voice: { unit: 'minuto', unitPlural: 'Minutos por mês', min: 6000, max: 60000, step: 1000, included: 6000, rate: 0.5, numbersIncluded: 5, numberPrice: 49, numbersMax: 50, numbersLabel: 'Números de telefone', numberSingular: 'número de telefone' },
  whatsapp: { unit: 'conversa', unitPlural: 'Conversas por mês', min: 5000, max: 50000, step: 500, included: 5000, rate: 0.8, numbersIncluded: 5, numberPrice: 114, numbersMax: 20, numbersLabel: 'Números de WhatsApp', numberSingular: 'número de WhatsApp' },
  webchat: { unit: 'conversa', unitPlural: 'Conversas por mês', min: 2000, max: 30000, step: 500, included: 2000, rate: 1.2, numbersIncluded: 0, numberPrice: 0, numbersMax: 0 },
}

export const SCALE_DEFAULTS: Record<ScaleProd, ScaleConfig> = {
  voice: { volume: 6000, numbers: 5, outbound: 0, care: 'none' },
  whatsapp: { volume: 5000, numbers: 5, outbound: 0, care: 'none' },
  webchat: { volume: 2000, numbers: 0, outbound: 0, care: 'none' },
}

/** "R$ 1.234" com espaço não separável (o valor nunca quebra entre "R$" e o número). */
export const brl = (n: number, frac = 0) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: frac, maximumFractionDigits: frac })}`
export const num = (n: number) => n.toLocaleString('pt-BR')

export const carePlan = (tier: CareTier) => (tier === 'none' ? undefined : PRODUCTS.find((p) => p.key === 'care')?.plans.find((p) => p.tier === tier))
/** Nome de exibição do acompanhamento Kloel Care ("Pro Care"), nunca a chave interna. */
export const careName = (tier: CareTier) => carePlan(tier)?.name ?? 'Sem acompanhamento'

export function computeScale(prod: ScaleProd, cfg: ScaleConfig, annual: boolean) {
  const plan = productByKey(prod).plans.find((p) => p.tier === 'scale')!
  const from = plan.fromPrice!
  const factor = annual ? from.annual / from.monthly : 1
  const r = SCALE_RULES[prod]
  const lines: { label: string; amount: number }[] = [{ label: `Plano Scale (inclui ${num(r.included)} ${r.unit === 'minuto' ? 'minutos' : 'conversas'})`, amount: from.monthly * factor }]
  const extraVol = Math.max(0, cfg.volume - r.included)
  if (extraVol > 0) lines.push({ label: `${num(extraVol)} ${r.unit === 'minuto' ? 'minutos' : 'conversas'} adicionais × ${brl(r.rate * factor, 2)}`, amount: extraVol * r.rate * factor })
  const extraNumbers = Math.max(0, cfg.numbers - r.numbersIncluded)
  if (extraNumbers > 0)
    lines.push({
      label: extraNumbers === 1 ? `1 ${r.numberSingular} adicional × ${brl(r.numberPrice)}` : `${extraNumbers} ${r.numbersLabel?.toLowerCase()} adicionais × ${brl(r.numberPrice)}`,
      amount: extraNumbers * r.numberPrice,
    })
  if (prod === 'voice' && cfg.outbound > 0) lines.push({ label: `Ligações ativas: ${num(cfg.outbound)} min × ${brl(0.24, 2)}`, amount: cfg.outbound * 0.24 })
  const care = carePlan(cfg.care)
  if (care) lines.push({ label: `${care.name} (acompanhamento)`, amount: care.monthly ?? 0 })
  const total = lines.reduce((s, l) => s + l.amount, 0)
  const perUnit = (from.monthly * factor + extraVol * r.rate * factor) / cfg.volume
  return { lines, total: Math.round(total), perUnit, factor }
}

/** Resumo em linhas (texto copiado em "Copiar resumo" e exibido no agendamento). */
export function scaleSummaryLines(prod: ScaleProd, cfg: ScaleConfig, annual: boolean, total: number) {
  const r = SCALE_RULES[prod]
  return [
    `Plano Scale — ${productByKey(prod).name} (${annual ? 'anual' : 'mensal'})`,
    `${r.unitPlural}: ${num(cfg.volume)}`,
    r.numbersMax > 0 ? `${r.numbersLabel}: ${cfg.numbers}` : '',
    prod === 'voice' ? `Ligações ativas: ${num(cfg.outbound)} min/mês` : '',
    cfg.care !== 'none' ? `Acompanhamento: ${careName(cfg.care)}` : '',
    `Estimativa: ${brl(total)}/mês`,
  ].filter(Boolean)
}

/** Lê a configuração salva no lead da calculadora (payload em texto). `undefined` se não for um lead do Scale. */
export function scaleFromLead(payload: Record<string, string> | undefined) {
  if (!payload || payload.source !== 'scale-calculator') return undefined
  const prod: ScaleProd = payload.product === 'whatsapp' || payload.product === 'webchat' ? payload.product : 'voice'
  const care: CareTier = payload.care === 'essential' || payload.care === 'pro' || payload.care === 'premium' ? payload.care : 'none'
  const cfg: ScaleConfig = {
    volume: Number(payload.volume) || SCALE_DEFAULTS[prod].volume,
    numbers: Number(payload.numbers) || 0,
    outbound: Number(payload.outbound) || 0,
    care,
  }
  const annual = payload.cycle === 'anual'
  const total = Number(payload.estimate) || computeScale(prod, cfg, annual).total
  const r = SCALE_RULES[prod]
  return {
    prod,
    cfg,
    annual,
    total,
    productName: productByKey(prod).name,
    /** "8.000 min/mês · 6 números · Pro Care" */
    short: [
      `${num(cfg.volume)} ${r.unit === 'minuto' ? 'min' : 'conversas'}/mês`,
      r.numbersMax > 0 ? `${cfg.numbers} ${cfg.numbers === 1 ? 'número' : 'números'}` : '',
      prod === 'voice' && cfg.outbound > 0 ? `${num(cfg.outbound)} min de ligações ativas` : '',
      cfg.care !== 'none' ? careName(cfg.care) : '',
    ]
      .filter(Boolean)
      .join(' · '),
    lines: scaleSummaryLines(prod, cfg, annual, total),
  }
}
