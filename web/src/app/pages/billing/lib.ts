import '@/domain/ext/billing'
import type { BillingInterval, BillingProfile, DemoDB, Invoice, PlanTier, ProductKey, Subscription } from '@/domain/types'
import type { CartItem } from '@/domain/ext/billing'
import { ADDONS, PRODUCTS, orgPlanLimit, planOf, productByKey, type PlanDef } from '@/data/catalogs/plans'
import { formatNumber } from '@/lib/utils'
import { smsQuotaOf } from '@/app/pages/scheduling/slots'

/** Ordem observada na lista "Ativo" de Assinatura e faturamento: WhatsApp, Telefone, Chatbot (depois E-mail e Care). */
export const PRODUCT_ORDER: ProductKey[] = ['whatsapp', 'voice', 'webchat', 'email', 'care']
/** Produtos do modal de primeiro acesso (abas). */
export const CORE_PRODUCTS: ProductKey[] = ['voice', 'whatsapp', 'webchat']
export const PRODUCT_TAB_LABEL: Record<ProductKey, string> = {
  voice: 'Telefone IA',
  whatsapp: 'WhatsApp IA',
  webchat: 'Chatbot de IA',
  email: 'E-Mail IA',
  care: 'Care & Setups',
}

export const isProductKey = (v: string | undefined | null): v is ProductKey => !!v && PRODUCTS.some((p) => p.key === v)

/**
 * Produto de um endereço "Alterar plano"/"Adicionar assinatura": aceita a chave da Kloel (voice, whatsapp…) e os slugs da Fonio
 * (fonio-live2/data/admin.json): /change-plan/sub-solo · sub-team · sub-scale (telefone), sub-whatsapp-solo-brasil ·
 * sub-whatsapp-team-brasil · sub-whatsapp-scale-brasil, sub-webchat-solo · sub-webchat-team · sub-webchat-scale e o
 * `productType` de /add-product (email-ai, care, voice, whatsapp, webchat).
 */
export function productFromSlug(slug: string | undefined | null): ProductKey | undefined {
  if (!slug) return undefined
  if (isProductKey(slug)) return slug
  const s = slug.trim().toLowerCase()
  if (s === 'email-ai' || s === 'email-agent' || s === 'e-mail-ia') return 'email'
  if (!/^sub-[a-z0-9-]+$/.test(s)) return undefined
  if (s.includes('whatsapp')) return 'whatsapp'
  if (s.includes('webchat') || s.includes('chatbot')) return 'webchat'
  if (s.includes('email')) return 'email'
  if (s.includes('care')) return 'care'
  return 'voice'
}

/** Slug da Fonio da assinatura (links "Alterar plano" — fonio-live2/data/admin.json). */
export function fonioPlanSlug(product: ProductKey, tier: PlanTier) {
  if (product === 'whatsapp') return `sub-whatsapp-${tier}-brasil`
  if (product === 'webchat') return `sub-webchat-${tier}`
  if (product === 'voice') return `sub-${tier}`
  return product
}

/** "R$ 1.517,00" (espaço comum, como na referência). */
export function money(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n).replace(/ /g, ' ')
}
/** "R$ 2.159" (cartões de plano). */
export function moneyInt(n: number) {
  return `R$ ${formatNumber(Math.round(n))}`
}

const dateShort = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
const dateLong = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
/** "18 de out. de 2026" */
export const fmtDateShort = (d: string | Date | null) => d === null ? '—' : dateShort.format(new Date(d))
/** "18 de novembro de 2026" */
export const fmtDateLong = (d: string | Date | null) => d === null ? '—' : dateLong.format(new Date(d))

/** Preço mensal exibido do plano (anual = valor mensal equivalente). */
export function planMonthly(plan: PlanDef | undefined, interval: BillingInterval): number | null {
  if (!plan) return null
  return interval === 'annual' ? plan.annual : plan.monthly
}

/** Valor cobrado por ciclo (mensal → 1 mês; anual → 12 × valor mensal equivalente). */
export function cyclePrice(monthly: number, interval: BillingInterval) {
  return interval === 'annual' ? monthly * 12 : monthly
}

/**
 * Nome da assinatura como aparece na cobrança. Telefone/WhatsApp/Chatbot com a marca em minúsculas, como os produtos da Fonio
 * (fonio-live2/K-admin/01: "fonio Assinatura WhatsApp Solo", "fonio Assinatura Solo", "fonio Chatbot de IA Solo");
 * E-Mail IA e Care com maiúscula ("Fonio E-Mail IA", "Fonio Essential Care").
 */
export function subscriptionLabel(product: ProductKey, tier: PlanTier) {
  const p = productByKey(product)
  const plan = planOf(product, tier)
  if (product === 'email') return p.subscriptionName
  const name = product === 'voice' || product === 'whatsapp' || product === 'webchat' ? p.subscriptionName.replace(/^Kloel\b/, 'kloel') : p.subscriptionName
  return `${name} ${plan?.name ?? tier}`
}

/** Nome do produto "disponível para adicionar". */
export function availableLabel(product: ProductKey) {
  if (product === 'email') return 'Kloel E-Mail IA'
  if (product === 'care') return 'Kloel Essential Care'
  return subscriptionLabel(product, 'solo')
}

export function addMonths(d: Date, n: number) {
  const r = new Date(d)
  const day = r.getDate()
  r.setMonth(r.getMonth() + n)
  if (r.getDate() < day) r.setDate(0)
  return r
}

export function activeSubs(subs: Subscription[]) {
  return subs
    .filter((s) => s.status === 'active')
    .sort((a, b) => PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product))
}

export function cartLines(cart: CartItem[]) {
  return [...cart].sort((a, b) => PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product)).map((c) => {
    const plan = planOf(c.product, c.tier)
    const monthly = planMonthly(plan, c.interval) ?? 0
    return { ...c, label: subscriptionLabel(c.product, c.tier), monthly, amount: cyclePrice(monthly, c.interval) }
  })
}

/** Códigos de desconto DEMONSTRATIVOS (nenhuma promoção real). */
export const DEMO_DISCOUNTS: Record<string, { percent: number; label: string }> = {
  DEMO10: { percent: 10, label: '10% na primeira fatura (demonstrativo)' },
}

/**
 * Benefício de indicação (texto do programa em Bônus grátis, Fonio ao vivo 2026-10-19: "Ele ganha 50% de desconto por 2 meses").
 * Na primeira fatura entram os meses que ela cobre (anual: os 2; mensal: o 1º); o 2º mês de uma assinatura mensal vira crédito
 * (BillingProfile.credits), abatido automaticamente da próxima cobrança.
 */
export const REFERRAL_DISCOUNT = { percent: 50, months: 2 } as const

/**
 * Totais do carrinho, na ordem em que são abatidos:
 * 1. `referral` (cadastro por /r/:code, só na primeira fatura): desconto de indicação sobre UMA assinatura — a de maior valor;
 * 2. código de desconto demonstrativo (DEMO10) sobre o valor restante;
 * 3. `credit` = saldo de crédito da organização (BillingProfile.credits: downgrade proporcional, Bônus grátis, indicações),
 *    abatido automaticamente até o valor devido.
 */
export function cartTotals(cart: CartItem[], discountCode?: string, credit = 0, referral?: { code: string } | null) {
  const lines = cartLines(cart)
  const subtotal = lines.reduce((s, l) => s + l.amount, 0)
  const refLine = referral && lines.length ? lines.reduce((best, l) => (l.amount > best.amount ? l : best)) : undefined
  const { percent: referralPercent, months: referralMonths } = REFERRAL_DISCOUNT
  /** meses do benefício cobertos por esta fatura (mensal: 1; anual: 2) */
  const coveredMonths = refLine ? Math.min(referralMonths, refLine.interval === 'annual' ? 12 : 1) : 0
  const referralDiscount = refLine ? roundMoney(Math.min(refLine.amount, (refLine.monthly * coveredMonths * referralPercent) / 100)) : 0
  const referralInfo = refLine && referral
    ? {
        code: referral.code,
        percent: referralPercent,
        product: refLine.product,
        coveredMonths,
        /** desconto dos meses seguintes (mensal: 2º mês), creditado para a próxima cobrança */
        carryCredit: roundMoney((refLine.monthly * (referralMonths - coveredMonths) * referralPercent) / 100),
        /** "50% por 2 meses" */
        short: `${referralPercent}% por ${referralMonths} meses`,
        /** linha da fatura */
        invoiceLabel: `Desconto de indicação (${referral.code}): ${referralPercent}% em ${coveredMonths === 1 ? '1 mês' : `${coveredMonths} meses`} de ${refLine.label}`,
        targetLabel: refLine.label,
      }
    : undefined
  const afterReferral = subtotal - referralDiscount
  const disc = discountCode ? DEMO_DISCOUNTS[discountCode] : undefined
  const discount = disc ? Math.round(afterReferral * disc.percent) / 100 : 0
  const creditApplied = roundMoney(Math.max(0, Math.min(credit || 0, afterReferral - discount)))
  const intervals = new Set(lines.map((l) => l.interval))
  const period = intervals.size === 1 ? (lines[0]?.interval === 'annual' ? 'Ano' : 'Mês') : undefined
  return { lines, subtotal, referralDiscount, referral: referralInfo, discount, creditApplied, total: roundMoney(afterReferral - discount - creditApplied), period }
}

export const roundMoney = (n: number) => Math.round(n * 100) / 100

/**
 * Pacote de cada add-on (quantidade por clique em "+" e preço mensal do pacote) — valores da Fonio ao vivo
 * (fonio-live2/K-admin/07 · data/admin.json, tooltips "Adicionar N por R$ X / mês"). SMS e Conversas do Chatbot de IA não
 * mostraram tooltip: seguem o catálogo (src/data/catalogs/plans.ts#ADDONS).
 */
const ADDON_PACK_OVERRIDES: Record<string, { unit: number; price: number }> = {
  minutes: { unit: 100, price: 90 },
  outbound: { unit: 5, price: 30 },
  numbers: { unit: 1, price: 49 },
  workspaces: { unit: 1, price: 36 },
  waNumbers: { unit: 1, price: 119 },
  waConversations: { unit: 20, price: 24 },
  waActions: { unit: 100, price: 90 },
}
export function addonPack(key: string): { unit: number; price: number } {
  const o = ADDON_PACK_OVERRIDES[key]
  if (o) return o
  const a = ADDONS.find((x) => x.key === key)
  return { unit: a?.unit ?? 1, price: a?.unitPrice ?? 0 }
}
/** Texto do tooltip do botão "+" (Fonio: "Adicionar 100 por R$ 90,00 / mês"); undefined = sem tooltip (SMS, Chatbot). */
export function addonPlusTooltip(key: string) {
  const o = ADDON_PACK_OVERRIDES[key]
  return o ? `Adicionar ${o.unit} por ${money(o.price)} / mês` : undefined
}

/**
 * Minutos de ligação consumidos (MESMA regra do cartão "Uso" da Visão geral — overview/OverviewCards.tsx):
 * somente ligações por telefone, sem as não atendidas, cada ligação arredondada para cima ao minuto.
 * A ligação de teste no navegador (canal "web") não consome a cota (observação da referência [472]).
 */
export function billedMinutes(convs: { channel: string; result?: string; durationSec: number | null }[]) {
  return convs.filter((c) => c.channel === 'phone' && c.result !== 'missed').reduce<number | null>((s, c) => s == null || c.durationSec == null ? null : s + Math.ceil(c.durationSec / 60), 0)
}

/* ------------------------------ Uso / cotas ------------------------------ */

export interface BillingPeriod {
  id: string
  from: Date
  to: Date
  label: string
  current: boolean
}

/**
 * Ciclos de cobrança (mesma regra da Visão geral — overview/plan-usage.ts): âncora = renovação da assinatura de telefone
 * (ou da primeira ativa); até 6 ciclos para trás, sem passar do início da assinatura.
 */
export function billingPeriods(subs: Subscription[], orgCreatedAt: string | undefined, now = new Date()): BillingPeriod[] {
  const anchor = subs.find((s) => s.product === 'voice' && s.status === 'active') ?? subs.find((s) => s.status === 'active')
  if (anchor && (!anchor.renewsAt || !anchor.startedAt)) {
    const from = new Date(now.getFullYear(), now.getMonth(), 1), to = addMonths(from, 1)
    return [{ id: from.toISOString().slice(0, 10), from, to, current: true, label: `${fmtDateShort(from)} – ${fmtDateShort(to)} · mês civil` }]
  }
  let to = anchor?.renewsAt ? new Date(anchor.renewsAt) : addMonths(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1)
  while (to.getTime() <= now.getTime()) to = addMonths(to, 1)
  while (to.getTime() - now.getTime() > 31 * 86400000) to = addMonths(to, -1)
  const started = anchor?.startedAt ? new Date(anchor.startedAt) : orgCreatedAt ? new Date(orgCreatedAt) : addMonths(now, -1)
  const out: BillingPeriod[] = []
  for (let i = 0; i < 6; i++) {
    const from = addMonths(to, -1)
    if (i > 0 && to.getTime() <= started.getTime()) break
    out.push({
      id: from.toISOString().slice(0, 10),
      from,
      to,
      current: i === 0,
      label: `${fmtDateShort(from)} – ${fmtDateShort(to)}${i === 0 ? ' · atual' : ''}`,
    })
    to = from
  }
  return out
}

function limitsFor(subs: Subscription[], product: ProductKey): Record<string, number> | undefined {
  const s = activeSubs(subs).find((x) => x.product === product)
  return s ? planOf(product, s.plan)?.limits : undefined
}

export type UsageKey = 'minutes' | 'outbound' | 'sms' | 'numbers' | 'workspaces' | 'waNumbers' | 'waConversations' | 'chatConversations' | 'waActions' | 'users' | 'concurrent'

export interface UsageItem {
  key: UsageKey
  label: string
  used: number | null
  /** null = ilimitado */
  quota: number | null
  unit?: string
}

/**
 * Consumo calculado a partir dos dados locais do período:
 * minutos = ligações por telefone atendidas, cada uma arredondada para cima (billedMinutes, mesma regra da Visão geral);
 * a ligação de teste no navegador não consome cota; WhatsApp/Chatbot = nº de conversas do canal;
 * números, números do WhatsApp, usuários e conexões = estado atual da organização.
 */
export function computeUsage(db: DemoDB, orgId: string, period: { from: Date; to: Date; current?: boolean }, profile: BillingProfile | undefined): Record<UsageKey, UsageItem> {
  const subs = db.subscriptions.filter((s) => s.orgId === orgId)
  const add = profile?.addOns ?? {}
  const inPeriod = (iso: string) => {
    const t = new Date(iso).getTime()
    return t >= period.from.getTime() && t < period.to.getTime()
  }
  const convs = db.conversations.filter((c) => c.orgId === orgId && inPeriod(c.startedAt))
  const callMinutes = billedMinutes(convs)
  const outboundMinutes = billedMinutes(convs.filter((c) => c.direction === 'outbound'))
  const voice = limitsFor(subs, 'voice')
  const wa = limitsFor(subs, 'whatsapp')
  const chat = limitsFor(subs, 'webchat')
  const act = activeSubs(subs)
  const unlimitedUsers = act.some((s) => s.plan === 'team' || s.plan === 'scale')
  const workspaceEmails = new Set([
    ...db.calendarConnections.filter((c) => c.orgId === orgId).map((c) => c.email.toLowerCase()),
    ...db.emailInboxes.filter((c) => c.orgId === orgId).map((c) => c.address.toLowerCase()),
  ])
  const waActions = db.agents.filter((a) => a.orgId === orgId).reduce((s, a) => s + a.whatsapps.length, 0)
  // Conexões de workspace: MESMA regra do cartão Uso da Visão geral (overview/plan-usage.ts#workspaceConnectionsQuota) — o maior
  // `limits.workspaceConnections` entre as assinaturas ativas (Infinity = sob medida), 2 quando nenhum plano define, + add-on.
  // Antes era fixo em 2 aqui: no Voice Team/Scale a Assinatura mostrava 1 / 2 enquanto a Visão geral mostrava 1 / 3 ou ∞.
  const wsPlan = orgPlanLimit(subs, 'workspaceConnections')
  const wsIncluded = typeof wsPlan === 'number' && !Number.isNaN(wsPlan) && wsPlan >= 0 ? wsPlan : 2
  const q = (base: number | undefined, key: string) => (base ?? 0) + (add[key] ?? 0) * addonPack(key).unit
  // SMS: MESMA regra do Agendador (scheduling/slots.ts#smsQuotaOf) — cota = add-on SMS × 100, uso = lembretes por SMS registrados
  // nos agendamentos. Ciclo atual: valor idêntico ao da aba Notificações; ciclos anteriores: lembretes com data dentro do período.
  const smsNow = smsQuotaOf(db, orgId)
  const smsUsed = period.current
    ? smsNow.used
    : db.bookings.filter((b) => b.orgId === orgId).flatMap((b) => b.notices ?? []).filter((n) => n.channel === 'sms' && inPeriod(n.at)).length
  return {
    minutes: { key: 'minutes', label: 'Minutos de ligação', used: callMinutes, quota: q(voice?.minutes, 'minutes'), unit: 'min' },
    outbound: { key: 'outbound', label: 'Créditos outbound', used: outboundMinutes, quota: q(0, 'outbound') },
    sms: { key: 'sms', label: 'SMS', used: smsUsed, quota: smsNow.quota },
    numbers: { key: 'numbers', label: 'Números de telefone', used: db.phoneNumbers.filter((p) => p.orgId === orgId && p.kind === 'purchased').length, quota: q(voice ? voice.numbers : 0, 'numbers') },
    workspaces: { key: 'workspaces', label: 'Conexões de workspace', used: workspaceEmails.size, quota: wsIncluded === Infinity ? null : q(wsIncluded, 'workspaces') },
    waNumbers: { key: 'waNumbers', label: 'Números do WhatsApp', used: db.whatsappAccounts.filter((w) => w.orgId === orgId).length, quota: q(wa?.whatsappNumbers, 'waNumbers') },
    waConversations: { key: 'waConversations', label: 'Conversas do WhatsApp', used: convs.filter((c) => c.channel === 'whatsapp').length, quota: q(wa?.conversations, 'waConversations') },
    chatConversations: { key: 'chatConversations', label: 'Conversas do Chatbot de IA', used: convs.filter((c) => c.channel === 'webchat').length, quota: q(chat?.conversations, 'chatConversations') },
    waActions: { key: 'waActions', label: 'Mensagens de ação do WhatsApp', used: waActions, quota: q(0, 'waActions') },
    users: { key: 'users', label: 'Usuários', used: db.memberships.filter((m) => m.orgId === orgId).length, quota: unlimitedUsers ? null : 3 },
    concurrent: { key: 'concurrent', label: 'Chamadas simultâneas', used: 0, quota: voice ? Math.max(1, voice.concurrent ?? 1) : 0 },
  }
}

export const nextRenewal = (subs: Subscription[]) => activeSubs(subs).flatMap((s) => s.renewsAt ? [s.renewsAt] : []).sort()[0]

export function monthlyTotal(subs: Subscription[], profile: BillingProfile | undefined) {
  const plans = activeSubs(subs).reduce((s, x) => s + x.priceMonthly, 0)
  const addons = ADDONS.reduce((s, a) => s + (profile?.addOns?.[a.key] ?? 0) * addonPack(a.key).price, 0)
  return { plans, addons, total: plans + addons }
}

export function cardBrandFromNumber(num: string) {
  const d = num.replace(/\D/g, '')
  if (/^4/.test(d)) return 'Visa'
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard'
  if (/^3[47]/.test(d)) return 'Amex'
  if (/^(606282|3841|636368|438935|504175|451416|636297|5067|4576|4011)/.test(d)) return 'Elo'
  return 'Cartão'
}

export function formatCardNumber(v: string) {
  return v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ')
}
export function formatExpiry(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}
export function formatCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}
export function formatCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

/** Validação de CNPJ (dígitos verificadores). */
export function isValidCnpj(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const s = w.reduce((acc, wi, i) => acc + Number(d[i]) * wi, 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

export const COUNTRIES = ['Brasil', 'Portugal', 'Argentina', 'Chile', 'Colômbia', 'México', 'Estados Unidos', 'Alemanha', 'Espanha', 'Outro']
export const BR_STATES: [string, string][] = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'],
  ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'],
  ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins'],
]
export const stateName = (uf: string) => BR_STATES.find(([u]) => u === uf)?.[1] ?? uf

/** Serializa/parseia itens do carrinho em query string: "voice:team:monthly,email:standard:monthly". */
export function encodeItems(items: CartItem[]) {
  return items.map((i) => `${i.product}:${i.tier}:${i.interval}`).join(',')
}
export function decodeItems(s: string | null): CartItem[] {
  if (!s) return []
  const out: CartItem[] = []
  for (const part of s.split(',')) {
    const [product, tier, interval] = part.split(':')
    if (!isProductKey(product)) continue
    const plan = planOf(product, tier as PlanTier)
    if (!plan || plan.monthly == null) continue
    if (out.some((o) => o.product === product)) continue
    out.push({ product, tier: plan.tier, interval: interval === 'annual' ? 'annual' : 'monthly' })
  }
  return out
}

export function invoiceTitle(inv: Invoice) {
  return inv.description || 'Assinatura Kloel'
}

/** Aceita somente caminhos internos do app em ?returnTo= (evita redirecionamento aberto). */
export function safeReturnTo(v: string | null | undefined, fallback = '/app/billing') {
  if (!v) return fallback
  return /^\/app(\/|$|\?)/.test(v) && !v.startsWith('//') ? v : fallback
}

/** Campos obrigatórios de "Dados de faturamento" preenchidos (mesma regra da validação do formulário). */
export function isProfileComplete(p: BillingProfile | undefined) {
  if (!p) return false
  const cepOk = p.country !== 'Brasil' || p.postalCode.replace(/\D/g, '').length === 8
  return !!(p.organizationName.trim() && p.line1.trim() && p.city.trim() && p.state.trim() && p.postalCode.trim() && cepOk)
}
