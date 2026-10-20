import type { ReactNode } from 'react'
import { services } from '@/services'
import { Phone, MessageSquare, Mail, LifeBuoy, Shield, Check, FlaskConical, CreditCard, Info } from 'lucide-react'
import type { ProductKey } from '@/domain/types'
import { WhatsAppIcon } from '@/components/brand/icons'
import { cn } from '@/lib/utils'

/** Ícone do produto no quadrado azul-claro (lista "Ativo" / add-ons). */
export function ProductIconBox({ product, muted, className }: { product: ProductKey; muted?: boolean; className?: string }) {
  return (
    <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md', muted ? 'bg-muted' : 'bg-blue-50', className)}>
      <ProductGlyph product={product} muted={muted} className="h-5 w-5" />
    </div>
  )
}

/** Ícone de linha do produto (carrinho / resumo). */
export function ProductGlyph({ product, muted, className }: { product: ProductKey; muted?: boolean; className?: string }) {
  const tone = muted ? 'text-muted-foreground' : 'text-blue-500'
  switch (product) {
    case 'whatsapp':
      return <WhatsAppIcon className={cn('h-4 w-4', muted ? 'text-muted-foreground' : 'text-[#25D366]', className)} />
    case 'voice':
      return <Phone className={cn('h-4 w-4', tone, className)} />
    case 'webchat':
      return <MessageSquare className={cn('h-4 w-4', tone, className)} />
    case 'email':
      return <Mail className={cn('h-4 w-4', tone, className)} />
    case 'care':
      return <LifeBuoy className={cn('h-4 w-4', tone, className)} />
  }
}

/**
 * Banner verde "Teste por 30 dias…" (modal de planos e Dados de faturamento).
 * Medidas de [441]/[450]: altura 58px (py-3 + 2 linhas de 16px + 2px), textos de 12px — título semibold emerald-900,
 * subtítulo emerald-800 — e escudo preenchido emerald-600 com check branco; fundo #ECFDF5; texto começa 52px após a borda.
 */
export function GuaranteeBanner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-xl bg-[#ECFDF5] py-3 pl-4 pr-8', className)} data-testid="guarantee-banner">
      {/* [441]/[450]: escudo cheio 18×22 sem contorno branco, com check branco. */}
      <span className="relative flex h-7 w-6 shrink-0 items-center justify-center">
        <Shield className="h-6 w-6 shrink-0 fill-[#059669] text-[#059669]" strokeWidth={1.75} />
        <Check className="absolute h-3 w-3 text-white" strokeWidth={3.25} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold leading-4 text-[#064e3b]">Teste por 30 dias ou receba seu dinheiro de volta</p>
        <p className="mt-0.5 text-xs leading-4 text-[#065f46]">Experimente o kloel.ai sem riscos. Reembolso total em até 30 dias.</p>
      </div>
    </div>
  )
}

/** Aviso obrigatório das telas de pagamento demonstrativo. */
export function DemoPaymentNotice({ className, children }: { className?: string; children?: ReactNode }) {
  if (!services.simulated) return null
  return (
    <div role="note" className={cn('flex items-start gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-amber-900', className)}>
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">Pagamento demonstrativo — nenhuma cobrança real</p>
        <p className="text-amber-900/80">
          {children ?? 'Nenhum dado sai deste navegador. Do cartão, guardamos somente a bandeira, os 4 últimos dígitos e a validade.'}
        </p>
      </div>
    </div>
  )
}

export function FieldError({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null
  return (
    <p id={id} className="text-sm text-destructive">
      {children}
    </p>
  )
}

/** Logotipo simplificado de bandeira (sem marcas de terceiros). */
export function CardBrandMark({ brand, className }: { brand?: string; className?: string }) {
  const b = (brand ?? '').toLowerCase()
  return (
    <span
      className={cn(
        'inline-flex h-6 w-9 shrink-0 items-center justify-center rounded-[4px] text-[8px] font-bold uppercase tracking-wide',
        b === 'visa' ? 'bg-[#1a1f71] text-white' : b === 'mastercard' ? 'bg-[#111] text-[#f79e1b]' : 'bg-muted text-muted-foreground',
        className,
      )}
      aria-hidden
    >
      {b === 'visa' ? 'Visa' : b === 'mastercard' ? 'MC' : <CreditCard className="h-3.5 w-3.5" />}
    </span>
  )
}

/** Aviso de permissão: telas de cobrança acessadas por quem não é administrador (controles ficam desabilitados). */
export function AdminOnlyNotice({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div role="note" data-testid="admin-only" className={cn('flex w-full max-w-4xl items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground', className)}>
      <Info className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{children ?? 'Somente administradores podem alterar assinaturas, add-ons e dados de cobrança.'}</span>
    </div>
  )
}
