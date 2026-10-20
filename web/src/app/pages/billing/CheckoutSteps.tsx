import { useEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, CirclePlus, CircleMinus, Plus, X, Lock, Gift } from 'lucide-react'
import '@/domain/ext/billing'
import type { CartItem } from '@/domain/ext/billing'
import type { BillingProfile, Invoice, ProductKey } from '@/domain/types'
import { services, type CardInput } from '@/services'
import { openStripeCheckout } from '@/services/casca/billing'
import { useStore, useBillingProfile } from '@/data/store'
import { useOperation } from '@/hooks/useOperation'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { OperationStatusView } from '@/components/app/misc'
import {
  BR_STATES, COUNTRIES, DEMO_DISCOUNTS, cartTotals, cardBrandFromNumber, formatCardNumber, formatCep, formatCnpj, formatExpiry, isValidCnpj, money,
} from './lib'
import { CardBrandMark, DemoPaymentNotice, FieldError, GuaranteeBanner, ProductGlyph } from './components'
import { applyPurchase, isSavedCardExpired, savedCardAsInput, savedCardExpiry, toSavedCard } from './actions'
import { useReferralBenefit } from './referral'

/** Campos de "Dados de faturamento"/cartão: 44,5px de altura e texto #30313D (medidos em [450]–[452]). */
// Foco azul com anel de 3px, como o campo focado de [450]/[451] (borda #0570DE, anel a 20%).
const FIELD_INPUT = 'h-[44.5px] text-base text-[#30313d] focus-visible:ring-[3px] focus-visible:ring-[#0570de]/20 focus-visible:ring-offset-0 focus-visible:border-[#0570de]'
const FIELD_SELECT = 'h-[44.5px] text-base text-[#30313d]'
/** Rótulo → campo: 5px (período de 77,5px entre campos em [450]). */
const FIELD_WRAP = 'flex flex-col gap-[5px]'
/** Rótulos de "Dados de faturamento": 15px, peso normal, cor #30313D (medido em [450]). */
const LABEL = 'text-[15px] font-normal leading-4 text-[#30313d]'
const BRAND_FULL = 'inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium text-white transition-colors hover:bg-[#464ac4] disabled:opacity-60'
const OUTLINE_FULL = 'inline-flex h-10 w-full items-center justify-center rounded-lg border bg-white text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50'

/** Foca (e rola até) o primeiro campo inválido após a validação. */
function focusFirstInvalid() {
  setTimeout(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus(), 0)
}

export function StepHeader({ title, onBack, children }: { title: ReactNode; onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Voltar" className="-ml-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent">
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <h2 className="min-w-0 text-2xl font-semibold">{title}</h2>
      {children}
    </div>
  )
}

/** Resumo do carrinho ("Valor total devido"). */
export function CartSummary({
  cart,
  discountCode,
  onRemove,
  onAddProduct,
  compact,
  credit = 0,
}: {
  cart: CartItem[]
  discountCode?: string
  onRemove?: (p: ProductKey) => void
  onAddProduct?: () => void
  compact?: boolean
  /** Saldo de crédito da organização (abatido automaticamente). */
  credit?: number
}) {
  const referral = useReferralBenefit()
  const t = services.simulated ? cartTotals(cart, discountCode, credit, referral) : cartTotals(cart)
  // Valores com algarismos proporcionais (medido em [450]: "R$ 299,00" 2px mais largo que com tabular-nums).
  return (
    <div className="rounded-xl border border-[#eaeaec] bg-[#FBFBFB] px-4 py-3 text-sm shadow-sm" data-testid="cart-summary">
      <ul className="flex flex-col gap-3">
        {t.lines.map((l) => (
          <li key={l.product} className="flex items-center gap-2 text-muted-foreground">
            <ProductGlyph product={l.product} muted={l.product !== 'whatsapp'} className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate">
              {l.label}
              {l.interval === 'annual' && <span className="ml-1 text-xs">(cobrança anual · {money(l.monthly)}/mês)</span>}
            </span>
            <span className="shrink-0">{money(l.amount)}</span>
            {/* [452]: "×" cinza de 14px em caixa de 24px; com gap-3 os itens ficam a cada 36px. */}
            {onRemove && cart.length > 1 && (
              <button type="button" aria-label={`Remover ${l.label}`} onClick={() => onRemove(l.product)} className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
        {t.lines.length === 0 && <li className="text-muted-foreground">Nenhum produto no carrinho.</li>}
      </ul>
      {onAddProduct && !compact && (
        <button type="button" onClick={onAddProduct} className="mt-3 flex w-fit items-center gap-1.5 font-medium text-foreground hover:underline">
          <Plus className="h-3.5 w-3.5" /> Adicionar produto adicional
        </button>
      )}
      {t.referral && t.referralDiscount > 0 && (
        <div className="mt-3 flex flex-col gap-0.5 text-emerald-700" data-testid="cart-referral">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <Gift className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />
              Desconto de indicação · {t.referral.short}
            </span>
            <span className="shrink-0">−{money(t.referralDiscount)}</span>
          </div>
          <span className="text-xs text-emerald-800/80">
            Indicado por {referral?.referrerName} (código {t.referral.code}) · aplicado em {t.referral.targetLabel}
            {t.referral.carryCredit > 0 ? `: ${t.referral.percent}% nesta fatura e ${money(t.referral.carryCredit)} (${t.referral.percent}% do 2º mês) como crédito para a próxima cobrança.` : `: ${t.referral.coveredMonths} meses com ${t.referral.percent}% nesta fatura.`}
          </span>
        </div>
      )}
      {t.discount > 0 && (
        <div className="mt-3 flex items-center justify-between text-emerald-700">
          <span>Desconto ({discountCode})</span>
          <span>−{money(t.discount)}</span>
        </div>
      )}
      {t.creditApplied > 0 && (
        <div className="mt-3 flex items-center justify-between text-emerald-700" data-testid="cart-credit">
          <span>Crédito aplicado (saldo de {money(credit)})</span>
          <span>−{money(t.creditApplied)}</span>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-muted-foreground">
        <span>{services.simulated ? 'IVA 0% (autoliquidação)' : 'Impostos'}</span>
        <span>{services.simulated ? money(0) : 'Confirmados na Stripe'}</span>
      </div>
      <div className="my-3 border-t" />
      <div className="flex items-center justify-between font-semibold">
        <span className="font-medium">Valor total devido</span>
        <span>
          {money(t.total)}
          {t.period ? ` / ${t.period}` : ''}
        </span>
      </div>
    </div>
  )
}

type DetailsErrors = Partial<Record<'organizationName' | 'line1' | 'city' | 'state' | 'postalCode' | 'taxId' | 'cart', string>>

type AddressDraft = Pick<BillingProfile, 'organizationName' | 'country' | 'line1' | 'line2' | 'city' | 'state' | 'postalCode' | 'taxId'>
const DRAFT_FIELDS = ['organizationName', 'country', 'line1', 'line2', 'city', 'state', 'postalCode', 'taxId'] as const
const draftKey = (orgId: string) => `kloel-demo:billing-draft:${orgId}`

/** Rascunho da etapa "Dados de faturamento" (sessionStorage da aba: sobrevive a recarregar, não altera o perfil salvo). */
function readDraft(orgId: string): Partial<AddressDraft> | null {
  try {
    const raw = sessionStorage.getItem(draftKey(orgId))
    if (!raw) return null
    const v = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<AddressDraft> = {}
    for (const k of DRAFT_FIELDS) if (typeof v[k] === 'string') out[k] = v[k] as string
    return out
  } catch {
    return null
  }
}
function writeDraft(orgId: string, d: AddressDraft | null) {
  try {
    if (d) sessionStorage.setItem(draftKey(orgId), JSON.stringify(d))
    else sessionStorage.removeItem(draftKey(orgId))
  } catch {
    /* armazenamento indisponível: o rascunho fica só em memória */
  }
}

/**
 * Etapa "Dados de faturamento" — campos exatamente como na referência [450]–[452].
 * As edições ficam em RASCUNHO (estado local + sessionStorage para retomar após recarregar) e só são gravadas no perfil de
 * cobrança da organização depois da validação de "Continuar". Sair sem continuar não altera os dados salvos.
 */
export function BillingDetailsStep(props: {
  cart: CartItem[]
  discountCode?: string
  onDiscountChange: (code?: string) => void
  onRemoveItem: (p: ProductKey) => void
  onAddProduct?: () => void
  onBack?: () => void
  onContinue: () => void
  title?: string
  showGuarantee?: boolean
  /** Mantém o rascunho ao voltar (primeiro acesso: voltar aos planos não abandona o checkout). */
  keepDraftOnBack?: boolean
}) {
  const profile = useBillingProfile()
  if (!profile) return null
  return <BillingDetailsForm key={profile.orgId} profile={profile} {...props} />
}

function BillingDetailsForm({
  profile,
  cart,
  discountCode,
  onDiscountChange,
  onRemoveItem,
  onAddProduct,
  onBack,
  onContinue,
  title = 'Dados de faturamento',
  showGuarantee = true,
  keepDraftOnBack,
}: Parameters<typeof BillingDetailsStep>[0] & { profile: BillingProfile }) {
  const patchBilling = useStore((s) => s.patchBilling)
  const orgId = profile.orgId
  const [draft, setDraft] = useState<AddressDraft>(() => {
    const saved = Object.fromEntries(DRAFT_FIELDS.map((k) => [k, profile[k] ?? ''])) as AddressDraft
    return { ...saved, ...(services.simulated ? readDraft(orgId) ?? {} : {}) }
  })
  const [errors, setErrors] = useState<DetailsErrors>({})
  const [cnpjOpen, setCnpjOpen] = useState(!!draft.taxId)
  const [discOpen, setDiscOpen] = useState(!!discountCode)
  const [discInput, setDiscInput] = useState(discountCode ?? '')
  const [discMsg, setDiscMsg] = useState<{ ok: boolean; text: string } | null>(services.simulated && discountCode ? { ok: true, text: DEMO_DISCOUNTS[discountCode]?.label ?? '' } : null)
  const isBR = draft.country === 'Brasil'

  // Atualização funcional: duas edições no mesmo ciclo (ex.: Estado + Código postal) não se sobrescrevem.
  const touched = useRef(false)
  const update = (patch: Partial<AddressDraft>) => {
    touched.current = true
    setDraft((d) => ({ ...d, ...patch }))
  }
  useEffect(() => {
    if (services.simulated && touched.current) writeDraft(orgId, draft)
  }, [orgId, draft])
  const set = (k: keyof AddressDraft, v: string) => {
    update({ [k]: v })
    if (errors[k as keyof DetailsErrors]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const validate = () => {
    const e: DetailsErrors = {}
    const req = 'Este campo é obrigatório'
    if (!draft.organizationName.trim()) e.organizationName = req
    if (!draft.line1.trim()) e.line1 = req
    if (!draft.city.trim()) e.city = req
    if (!draft.state.trim()) e.state = req
    if (!draft.postalCode.trim()) e.postalCode = req
    else if (isBR && draft.postalCode.replace(/\D/g, '').length !== 8) e.postalCode = 'Código postal inválido (use o formato 00000-000).'
    if (cnpjOpen && draft.taxId.trim() && !isValidCnpj(draft.taxId)) e.taxId = 'CNPJ inválido.'
    if (cart.length === 0) e.cart = 'Adicione pelo menos um produto para continuar.'
    setErrors(e)
    if (Object.keys(e).length) focusFirstInvalid()
    return Object.keys(e).length === 0
  }

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    if (!services.simulated) {
      if (!cart.length) return setErrors({ cart: 'Adicione pelo menos um produto para continuar.' })
      onContinue()
      return
    }
    if (!validate()) return
    // Somente aqui (dados válidos) o rascunho vira o perfil de cobrança salvo.
    const commit: AddressDraft = { ...draft, organizationName: draft.organizationName.trim(), line1: draft.line1.trim(), line2: draft.line2.trim(), city: draft.city.trim(), taxId: cnpjOpen ? draft.taxId : profile.taxId }
    patchBilling(commit)
    touched.current = false
    writeDraft(orgId, null)
    onContinue()
  }

  const back = onBack
    ? () => {
        if (!keepDraftOnBack) {
          touched.current = false
          writeDraft(orgId, null)
        }
        onBack()
      }
    : undefined

  const applyDiscount = () => {
    if (!services.simulated) {
      onDiscountChange(undefined)
      setDiscMsg({ ok: false, text: 'Consulte as condições disponíveis na página de pagamento.' })
      return
    }
    const code = discInput.trim().toUpperCase()
    if (!code) return setDiscMsg({ ok: false, text: 'Informe um código.' })
    if (DEMO_DISCOUNTS[code]) {
      onDiscountChange(code)
      setDiscMsg({ ok: true, text: `Código aplicado: ${DEMO_DISCOUNTS[code].label}` })
    } else {
      onDiscountChange(undefined)
      setDiscMsg({ ok: false, text: 'Código de desconto inválido ou expirado.' })
    }
  }

  const field = (id: keyof DetailsErrors & keyof typeof profile, label: string, props: Partial<ComponentProps<'input'>> = {}) => (
    <div className={FIELD_WRAP}>
      <Label htmlFor={`bd-${id}`} className={cn(LABEL, errors[id] && 'text-destructive')}>
        {label}
      </Label>
      <Input
        id={`bd-${id}`}
        value={String(draft[id] ?? '')}
        onChange={(e) => set(id, e.target.value)}
        aria-invalid={!!errors[id]}
        className={FIELD_INPUT}
        disabled={!services.simulated}
        {...props}
      />
      <FieldError>{errors[id]}</FieldError>
    </div>
  )

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <StepHeader title={title} onBack={back} />
      {showGuarantee && <GuaranteeBanner /> }
      {!services.simulated && <p className="text-sm text-muted-foreground">Os dados de faturamento serão informados diretamente na Stripe na próxima etapa.</p>}
      <div className="flex flex-col gap-3">
        {field('organizationName', 'Nome da organização', { autoComplete: 'organization' })}
        <div className={FIELD_WRAP}>
          <Label htmlFor="bd-country" className={LABEL}>País ou região</Label>
          <Select disabled={!services.simulated} value={draft.country} onValueChange={(v) => update({ country: v, state: v === 'Brasil' ? draft.state : '' })}>
            <SelectTrigger id="bd-country" className={FIELD_SELECT}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {field('line1', 'Linha 1 do endereço', { autoComplete: 'address-line1' })}
        <div className={FIELD_WRAP}>
          <Label htmlFor="bd-line2" className={LABEL}>Linha 2 do endereço</Label>
          <Input disabled={!services.simulated} id="bd-line2" value={draft.line2} onChange={(e) => set('line2', e.target.value)} className={FIELD_INPUT} autoComplete="address-line2" />
        </div>
        {field('city', 'Cidade', { autoComplete: 'address-level2' })}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={FIELD_WRAP}>
            <Label htmlFor="bd-state" className={cn(LABEL, errors.state && 'text-destructive')}>Estado</Label>
            {isBR ? (
              <Select disabled={!services.simulated} value={draft.state || undefined} onValueChange={(v) => set('state', v)}>
                <SelectTrigger id="bd-state" className={FIELD_SELECT} aria-invalid={!!errors.state}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {BR_STATES.map(([uf, name]) => (
                    <SelectItem key={uf} value={uf}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input disabled={!services.simulated} id="bd-state" value={draft.state} onChange={(e) => set('state', e.target.value)} className={FIELD_INPUT} aria-invalid={!!errors.state} />
            )}
            <FieldError>{errors.state}</FieldError>
          </div>
          <div className={FIELD_WRAP}>
            <Label htmlFor="bd-postalCode" className={cn(LABEL, errors.postalCode && 'text-destructive')}>Código postal</Label>
            <Input
              id="bd-postalCode"
              disabled={!services.simulated}
              value={draft.postalCode}
              inputMode={isBR ? 'numeric' : undefined}
              onChange={(e) => set('postalCode', isBR ? formatCep(e.target.value) : e.target.value)}
              aria-invalid={!!errors.postalCode}
              className={FIELD_INPUT}
              autoComplete="postal-code"
            />
            <FieldError>{errors.postalCode}</FieldError>
          </div>
        </div>
        {/* [450]: ⊕ com traço 2 e 4px até o texto; 23px entre "CNPJ" e "Código de desconto". */}
        <div className="flex flex-wrap items-center gap-x-[23px] gap-y-2 pt-1">
          <button type="button" onClick={() => setCnpjOpen((o) => !o)} aria-expanded={cnpjOpen} className="inline-flex items-center gap-1 text-sm font-medium text-[#30313d] hover:underline">
            {cnpjOpen ? <CircleMinus className="h-5 w-5" /> : <CirclePlus className="h-5 w-5" />} CNPJ
          </button>
          <button type="button" onClick={() => setDiscOpen((o) => !o)} aria-expanded={discOpen} className="inline-flex items-center gap-1 text-sm font-medium text-[#30313d] hover:underline">
            {discOpen ? <CircleMinus className="h-5 w-5" /> : <CirclePlus className="h-5 w-5" />} Código de desconto
          </button>
        </div>
        {cnpjOpen && (
          <div className={FIELD_WRAP}>
            <Label htmlFor="bd-taxId" className={cn(LABEL, errors.taxId && 'text-destructive')}>CNPJ</Label>
            <Input
              id="bd-taxId"
              disabled={!services.simulated}
              value={draft.taxId}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              onChange={(e) => set('taxId', formatCnpj(e.target.value))}
              aria-invalid={!!errors.taxId}
              className={FIELD_INPUT}
            />
            <FieldError>{errors.taxId}</FieldError>
          </div>
        )}
        {discOpen && (
          <div className={FIELD_WRAP}>
            <Label htmlFor="bd-discount" className={LABEL}>Código de desconto</Label>
            <div className="flex gap-2">
              <Input
                id="bd-discount"
                value={discInput}
                onChange={(e) => setDiscInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applyDiscount()
                  }
                }}
                placeholder={services.simulated ? "Ex.: DEMO10" : "Código de desconto"}
                className={FIELD_INPUT}
              />
              <button type="button" onClick={applyDiscount} className="h-[44.5px] shrink-0 rounded-md border bg-white px-4 text-sm font-medium hover:bg-accent">
                Aplicar
              </button>
              {discountCode && (
                <button
                  type="button"
                  onClick={() => {
                    onDiscountChange(undefined)
                    setDiscInput('')
                    setDiscMsg(null)
                  }}
                  className="h-[44.5px] shrink-0 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent"
                >
                  Remover
                </button>
              )}
            </div>
            {discMsg && <p className={cn('text-sm', discMsg.ok ? 'text-emerald-700' : 'text-destructive')}>{discMsg.text}</p>}
          </div>
        )}
      </div>
      <div>
        <CartSummary cart={cart} discountCode={discountCode} onRemove={onRemoveItem} onAddProduct={onAddProduct} credit={profile.credits} />
        <FieldError>{errors.cart}</FieldError>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <button type="submit" className={cn(BRAND_FULL, 'text-base')}>Continuar</button>
        {onAddProduct && (
          <button type="button" onClick={onAddProduct} className={cn(OUTLINE_FULL, 'h-9 font-normal')}>
            Adicionar produto adicional
          </button>
        )}
      </div>
    </form>
  )
}

const TEST_CARDS = [
  { number: '4242 4242 4242 4242', label: 'aprovado' },
  { number: '4000 0000 0000 0002', label: 'recusado' },
]

type CardErrors = Partial<Record<keyof CardInput, string>>

/** Validação do cartão (checkout e portal financeiro): campos obrigatórios, mês 01–12 e cartão não vencido. */
export function validateCard(c: CardInput): CardErrors {
  const e: CardErrors = {}
  if (!c.holder.trim()) e.holder = 'Este campo é obrigatório'
  const digits = c.number.replace(/\D/g, '')
  if (!digits) e.number = 'Este campo é obrigatório'
  else if (digits.length < 13) e.number = 'Número do cartão incompleto.'
  const m = /^(\d{2})\/(\d{2})$/.exec(c.expiry)
  if (!c.expiry) e.expiry = 'Este campo é obrigatório'
  else if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) e.expiry = 'Validade inválida (use MM/AA).'
  else {
    const exp = new Date(2000 + Number(m[2]), Number(m[1]), 1)
    if (exp.getTime() <= Date.now()) e.expiry = 'Cartão vencido.'
  }
  if (!/^\d{3,4}$/.test(c.cvc)) e.cvc = c.cvc ? 'CVC inválido.' : 'Este campo é obrigatório'
  return e
}

/** Campos de cartão (DEMONSTRATIVO). Reutilizado no checkout e no portal financeiro. */
export function CardFields({ value, onChange, errors, disabled }: { value: CardInput; onChange: (v: CardInput) => void; errors: CardErrors; disabled?: boolean }) {
  disabled = disabled || !services.simulated
  const brand = cardBrandFromNumber(value.number)
  return (
    <div className="flex flex-col gap-3">
      {services.simulated && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Cartões de teste:</span>
        {TEST_CARDS.map((t) => (
          <button
            key={t.number}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, number: t.number, expiry: value.expiry || '12/30', cvc: value.cvc || '123', holder: value.holder || 'TITULAR DEMONSTRATIVO' })}
            className="rounded-md border bg-white px-2 py-1 font-mono text-[11px] text-foreground hover:bg-accent"
          >
            {t.number} · {t.label}
          </button>
        ))}
      </div>}
      <div className={FIELD_WRAP}>
        <Label htmlFor="cc-holder" className={cn(LABEL, errors.holder && 'text-destructive')}>Nome no cartão</Label>
        <Input id="cc-holder" value={value.holder} disabled={disabled} onChange={(e) => onChange({ ...value, holder: e.target.value })} aria-invalid={!!errors.holder} className={FIELD_INPUT} autoComplete="off" />
        <FieldError>{errors.holder}</FieldError>
      </div>
      <div className={FIELD_WRAP}>
        <Label htmlFor="cc-number" className={cn(LABEL, errors.number && 'text-destructive')}>Número do cartão</Label>
        <div className="relative">
          <Input
            id="cc-number"
            value={value.number}
            disabled={disabled}
            inputMode="numeric"
            placeholder="0000 0000 0000 0000"
            onChange={(e) => onChange({ ...value, number: formatCardNumber(e.target.value) })}
            aria-invalid={!!errors.number}
            className={cn(FIELD_INPUT, 'pr-14 font-mono tracking-wide')}
            autoComplete="off"
          />
          <CardBrandMark brand={value.number ? brand : undefined} className="absolute right-3 top-1/2 -translate-y-1/2" />
        </div>
        <FieldError>{errors.number}</FieldError>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={FIELD_WRAP}>
          <Label htmlFor="cc-expiry" className={cn(LABEL, errors.expiry && 'text-destructive')}>Validade</Label>
          <Input id="cc-expiry" value={value.expiry} disabled={disabled} inputMode="numeric" placeholder="MM/AA" onChange={(e) => onChange({ ...value, expiry: formatExpiry(e.target.value) })} aria-invalid={!!errors.expiry} className={FIELD_INPUT} autoComplete="off" />
          <FieldError>{errors.expiry}</FieldError>
        </div>
        <div className={FIELD_WRAP}>
          <Label htmlFor="cc-cvc" className={cn(LABEL, errors.cvc && 'text-destructive')}>CVC</Label>
          <Input id="cc-cvc" value={value.cvc} disabled={disabled} inputMode="numeric" placeholder="123" onChange={(e) => onChange({ ...value, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })} aria-invalid={!!errors.cvc} className={FIELD_INPUT} autoComplete="off" />
          <FieldError>{errors.cvc}</FieldError>
        </div>
      </div>
    </div>
  )
}

export const EMPTY_CARD: CardInput = { holder: '', number: '', expiry: '', cvc: '' }

/** Hook do formulário de cartão + chamada ao serviço simulado (usado no checkout e no portal). */
export function useCardCheckout() {
  const op = useOperation((onProgress, lines: { label: string; amount: number }[], card: CardInput) => services.billing.checkout(lines, card, onProgress))
  return op
}

/**
 * Etapa de pagamento (INFERIDO — não há captura da tela de cartão na referência).
 * Pagamento local simulado: services.billing.checkout com progresso, falha (cartão 4000 0000 0000 0002 ou painel) e nova tentativa.
 */
export function PaymentStep({
  cart,
  discountCode,
  onBack,
  onPaid,
  onBeforeApply,
  description,
  title = 'Pagamento',
}: {
  cart: CartItem[]
  discountCode?: string
  onBack?: () => void
  onPaid: (invoice: Invoice | undefined) => void
  /** Chamado com o pagamento aprovado, imediatamente antes de ativar as assinaturas. */
  onBeforeApply?: () => void
  description?: string
  title?: string
}) {
  const profile = useBillingProfile()
  const saved = profile?.card
  const savedExpired = isSavedCardExpired(saved)
  const credit = profile?.credits ?? 0
  const [useSaved, setUseSaved] = useState<'saved' | 'new'>(saved && !savedExpired ? 'saved' : 'new')
  const [card, setCard] = useState<CardInput>({ ...EMPTY_CARD, holder: '' })
  const [errors, setErrors] = useState<CardErrors>({})
  const [savedError, setSavedError] = useState<string | null>(null)
  const op = useCardCheckout()
  const hosted = useOperation(() => openStripeCheckout(cart))
  const referral = useReferralBenefit()
  const totals = useMemo(() => services.simulated ? cartTotals(cart, discountCode, credit, referral) : cartTotals(cart), [cart, discountCode, credit, referral])
  const lines = [
    ...totals.lines.map((l) => ({ label: l.label, amount: l.amount })),
    ...(totals.referral && totals.referralDiscount ? [{ label: totals.referral.invoiceLabel, amount: -totals.referralDiscount }] : []),
    ...(totals.discount ? [{ label: `Desconto ${discountCode}`, amount: -totals.discount }] : []),
    ...(totals.creditApplied ? [{ label: 'Crédito aplicado', amount: -totals.creditApplied }] : []),
  ]

  const pay = async () => {
    if (!services.simulated) { await hosted.run(); return }
    let input: CardInput
    if (useSaved === 'saved' && saved) {
      if (savedExpired) {
        setSavedError(`Cartão vencido (${savedCardExpiry(saved)}). Use outro cartão.`)
        return
      }
      input = savedCardAsInput(saved)
    } else {
      const e = validateCard(card)
      setErrors(e)
      if (Object.keys(e).length) {
        focusFirstInvalid()
        return
      }
      input = card
    }
    const r = await op.run(lines, input)
    if (!r) return
    const savedCard = useSaved === 'saved' && saved ? saved : toSavedCard(input, r.brand, r.last4)
    onBeforeApply?.()
    const inv = applyPurchase({ items: cart, discountCode, invoiceNumber: r.invoiceNumber, card: savedCard, description })
    onPaid(inv)
  }

  const paymentOperation = services.simulated ? op : hosted
  const running = paymentOperation.status === 'running'
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (!running) void pay()
      }}
      className="flex flex-col gap-6"
    >
      <StepHeader title={title} onBack={running ? undefined : onBack} />
      <DemoPaymentNotice />
      {saved && (
        <RadioGroup value={useSaved} onValueChange={(v) => { setUseSaved(v as 'saved' | 'new'); setSavedError(null) }} className="gap-2" aria-label="Forma de pagamento" disabled={running}>
          <label className={cn('flex items-center gap-3 rounded-lg border px-4 py-3 text-sm', savedExpired ? 'cursor-not-allowed opacity-70' : 'cursor-pointer', useSaved === 'saved' && 'border-brand ring-2 ring-brand/15')}>
            <RadioGroupItem value="saved" disabled={savedExpired} />
            <CardBrandMark brand={saved.brand} />
            <span className="flex-1">
              {saved.brand} •••• {saved.last4}
              {savedExpired ? (
                <span className="ml-2 text-destructive" data-testid="saved-card-expired">vencido em {savedCardExpiry(saved)} — use outro cartão</span>
              ) : (
                <span className="ml-2 text-muted-foreground">vence em {savedCardExpiry(saved)}</span>
              )}
            </span>
          </label>
          <label className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm', useSaved === 'new' && 'border-brand ring-2 ring-brand/15')}>
            <RadioGroupItem value="new" />
            <span>Usar outro cartão</span>
          </label>
        </RadioGroup>
      )}
      <FieldError>{savedError}</FieldError>
      {(useSaved === 'new' || !saved) && <CardFields value={card} onChange={(v) => { setCard(v); setErrors({}) }} errors={errors} disabled={running} />}
      <CartSummary cart={cart} discountCode={discountCode} compact credit={credit} />
      <OperationStatusView status={paymentOperation.status} progress={paymentOperation.progress} error={paymentOperation.error} onRetry={() => void pay()} successText={services.simulated ? 'Pagamento aprovado.' : `${hosted.result?.recovered ? 'Contratação anterior retomada. Revise o plano na Stripe. ' : ''}${hosted.result?.mode === 'test' ? 'Continue na Stripe em modo de teste. Nenhuma assinatura de produção foi ativada.' : 'Continue o pagamento na Stripe.'}`} />
      <div className="flex flex-col gap-2">
        <button type="submit" className={BRAND_FULL} disabled={running || cart.length === 0}>
          <Lock className="h-4 w-4" />
          {running ? 'Processando…' : `Pagar ${money(totals.total)}`}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          {services.simulated ? `Ao continuar, você ativa ${cart.length === 1 ? 'a assinatura' : 'as assinaturas'} nesta demonstração local. Nenhum valor é cobrado.` : 'Informe os dados de pagamento diretamente na Stripe. A contratação será confirmada após a verificação do pagamento.'}
        </p>
      </div>
    </form>
  )
}
