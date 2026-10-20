import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { Copy, Minus, PhoneCall, Plus, MessageSquareText, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useStore } from '@/data/store'
import { PRODUCTS, productByKey } from '@/data/catalogs/plans'
import { SCALE_DEFAULTS, SCALE_RULES, brl, computeScale, num, scaleSummaryLines, type ScaleConfig, type ScaleProd } from './scale'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { WhatsAppIcon } from '@/components/brand/icons'
import { SitePills, siteButton } from '../company/kit'

/**
 * Calculadora do plano Scale ("Configurar plano").
 * INFERIDO: a nota [443] pede reproduzir a página `scale-calculator` da Fonio, mas não há captura dela.
 * Desenho próprio, consistente com a página de planos; preços demonstrativos derivados do catálogo
 * (preço "a partir de" do Scale + tarifas de complementos da tabela comparativa). Regras em ./scale.ts.
 */
type Prod = ScaleProd
type Config = ScaleConfig
const RULES = SCALE_RULES
const DEFAULTS = SCALE_DEFAULTS

export function ScaleCalculatorDialog({ open, onOpenChange, initialProduct, initialAnnual }: { open: boolean; onOpenChange: (o: boolean) => void; initialProduct: Prod; initialAnnual: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Foco inicial no próprio diálogo (não na 1ª pílula): aberto pela URL ou por clique, a pílula "Telefone" não acende o
          anel de foco sem interação de teclado; Tab continua entrando nos controles na ordem normal. */}
      <DialogContent
        className="max-h-[92svh] max-w-[920px] gap-0 gap-y-0 overflow-hidden p-0 font-site outline-none sm:rounded-2xl"
        closeClassName="right-5 top-5 z-10"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
        }}
      >
        {open && <Calculator key={`${initialProduct}-${initialAnnual}`} initialProduct={initialProduct} initialAnnual={initialAnnual} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Calculator({ initialProduct, initialAnnual, onClose }: { initialProduct: Prod; initialAnnual: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const insert = useStore((s) => s.insert)
  const [prod, setProd] = useState<Prod>(initialProduct)
  const [annual, setAnnual] = useState(initialAnnual)
  const [cfgs, setCfgs] = useState<Record<Prod, Config>>(DEFAULTS)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle')
  const cfg = cfgs[prod]
  const r = RULES[prod]
  const setCfg = (patch: Partial<Config>) => setCfgs((c) => ({ ...c, [prod]: { ...c[prod], ...patch } }))
  const result = useMemo(() => computeScale(prod, cfg, annual), [prod, cfg, annual])
  const product = productByKey(prod)

  // Texto copiado com espaços comuns (o espaço não separável é só para a exibição não quebrar "R$ 49").
  const summary = () => scaleSummaryLines(prod, cfg, annual, result.total).join('\n').replace(/\u00a0/g, ' ')

  const talkToSales = () => {
    const lead = insert('leads', {
      kind: 'contact',
      payload: {
        source: 'scale-calculator',
        product: prod,
        cycle: annual ? 'anual' : 'mensal',
        volume: String(cfg.volume),
        numbers: String(cfg.numbers),
        outbound: String(cfg.outbound),
        care: cfg.care,
        estimate: String(result.total),
      },
    })
    toast.success('Configuração salva. Escolha um horário com o nosso time.')
    onClose()
    // O lead segue na URL: o agendamento mostra o resumo da configuração e guarda o vínculo (leadId).
    navigate(`/agendar-demo?productType=${prod}&source=scale-calculator&lead=${lead.id}`)
  }

  return (
    <div className="grid max-h-[92svh] overflow-y-auto md:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-7 p-6 sm:p-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-[24px] font-medium tracking-[-0.3px] text-heading">Configurar plano Scale</DialogTitle>
          </div>
          <DialogDescription className="mt-2 text-[15px] leading-6 text-body">
            Monte o pacote ideal para o volume da sua operação. A proposta final é feita pelo nosso time comercial.
          </DialogDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SitePills<Prod>
            ariaLabel="Produto"
            value={prod}
            onChange={setProd}
            itemClassName="h-9 text-[14px] sm:text-[15px]"
            options={[
              { value: 'voice', label: 'Telefone', icon: <PhoneCall className="h-4 w-4" /> },
              { value: 'whatsapp', label: 'WhatsApp', icon: <WhatsAppIcon className="h-4 w-4" /> },
              { value: 'webchat', label: 'Webchat', icon: <MessageSquareText className="h-4 w-4" /> },
            ]}
          />
          <SitePills<'m' | 'a'>
            ariaLabel="Ciclo"
            value={annual ? 'a' : 'm'}
            onChange={(v) => setAnnual(v === 'a')}
            itemClassName="h-9 text-[14px] sm:text-[15px]"
            options={[
              { value: 'm', label: 'Mensal' },
              { value: 'a', label: <span>Anual <span className="text-brand-blue">-{Math.round((1 - result.factor) * 100) || 10}%</span></span> },
            ]}
          />
        </div>

        <Control label={r.unitPlural} value={`${num(cfg.volume)} ${r.unit === 'minuto' ? 'min' : 'conversas'}`} hint={prod === 'webchat' ? `Até ${num(cfg.volume * 10)} mensagens por mês` : undefined}>
          <BrandSlider min={r.min} max={r.max} step={r.step} value={cfg.volume} onChange={(v) => setCfg({ volume: v })} label={r.unitPlural} />
          <div className="mt-2 flex justify-between text-[12px] text-slate-400">
            <span>{num(r.min)}</span>
            <span>{num(r.max)}+</span>
          </div>
        </Control>

        {r.numbersMax > 0 && (
          <Control label={r.numbersLabel!} value={`${cfg.numbers}`} hint={`${r.numbersIncluded} incluídos · ${brl(r.numberPrice)}/mês por número extra`}>
            <Stepper value={cfg.numbers} min={1} max={r.numbersMax} onChange={(v) => setCfg({ numbers: v })} label={r.numbersLabel!} />
          </Control>
        )}

        {prod === 'voice' && (
          <Control label="Ligações ativas (campanhas)" value={`${num(cfg.outbound)} min/mês`} hint="Ligações feitas pelo assistente para a sua lista de contatos — R$ 0,24 por minuto iniciado.">
            <BrandSlider min={0} max={20000} step={500} value={cfg.outbound} onChange={(v) => setCfg({ outbound: v })} label="Ligações ativas" />
          </Control>
        )}

        <Control label="Acompanhamento Kloel Care (opcional)">
          <div className="grid gap-2 sm:grid-cols-2">
            {(['none', 'essential', 'pro', 'premium'] as const).map((c) => {
              const plan = c === 'none' ? null : PRODUCTS.find((p) => p.key === 'care')!.plans.find((p) => p.tier === c)!
              const active = cfg.care === c
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCfg({ care: c })}
                  className={cn('flex items-start gap-3 rounded-xl border p-3 text-left transition-colors', active ? 'border-brand-blue bg-[#F5F5FF]' : 'border-slate-200 hover:border-brand-blue/50')}
                >
                  <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', active ? 'border-brand-blue bg-brand-blue text-white' : 'border-slate-300')}>{active && <Check className="h-3 w-3" />}</span>
                  <span className="min-w-0">
                    <span className="block text-[15px] text-ink">{plan ? plan.name : 'Sem acompanhamento'}</span>
                    <span className="block text-[13px] leading-5 text-body">{plan ? `${brl(plan.monthly ?? 0)}/mês · ${plan.appTagline}` : 'Suporte padrão do plano Scale'}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </Control>

        <div className="rounded-xl bg-slate-50 p-4 text-[14px] leading-6 text-body">
          <div className="mb-1 font-medium text-ink">Sempre incluído no Scale</div>
          {product.plans.find((p) => p.tier === 'scale')!.publicIncluded.map((i) => i.text).concat(product.plans.find((p) => p.tier === 'scale')!.publicFeatures.filter((f) => !f.chip).map((f) => f.text)).join(' · ')}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-[#FAFAFE] md:border-l md:border-t-0">
      <aside className="flex flex-col gap-5 p-6 sm:p-8 md:sticky md:top-0 md:pt-14">
        <div>
          <div className="text-[14px] text-body">Estimativa {annual ? 'mensal (cobrança anual)' : 'mensal'}</div>
          <div className="mt-1 text-[38px] font-medium leading-[44px] tracking-[-0.6px] text-heading" data-testid="scale-total">
            {brl(result.total)}
            <span className="text-[16px] font-normal text-body"> /mês</span>
          </div>
          <div className="mt-1 text-[14px] text-body">
            equivale a {brl(result.perUnit, 2)}/{r.unit === 'minuto' ? 'min' : 'conversa'}
          </div>
        </div>
        <ul className="flex flex-col gap-2 border-t border-slate-200 pt-4 text-[14px]">
          {result.lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-3">
              <span className="text-body">{l.label}</span>
              <span className="shrink-0 text-ink">{brl(l.amount)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-col gap-2">
          <button type="button" className={cn(siteButton('brand'), 'w-full')} onClick={talkToSales}>
            Falar com vendas
          </button>
          <button
            type="button"
            className={cn(siteButton('outline', 'md'), 'w-full', copy === 'copied' && 'border-emerald-300 text-emerald-700')}
            data-testid="scale-copy"
            onClick={async () => {
              const text = summary()
              let ok = false
              try {
                await navigator.clipboard.writeText(text)
                ok = true
              } catch {
                // Alternativa para navegadores sem a API de área de transferência
                const ta = document.createElement('textarea')
                ta.value = text
                ta.style.position = 'fixed'
                ta.style.opacity = '0'
                document.body.appendChild(ta)
                ta.select()
                try {
                  ok = document.execCommand('copy')
                } catch {
                  ok = false
                }
                ta.remove()
              }
              setCopy(ok ? 'copied' : 'manual')
              if (ok) {
                toast.success('Resumo da configuração copiado.')
                setTimeout(() => setCopy((c) => (c === 'copied' ? 'idle' : c)), 2500)
              } else toast.error('Não foi possível copiar automaticamente. Selecione o resumo abaixo e copie.')
            }}
          >
            {copy === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copy === 'copied' ? 'Resumo copiado' : 'Copiar resumo'}
          </button>
          {copy === 'manual' && (
            <textarea readOnly aria-label="Resumo da configuração" value={summary()} onFocus={(e) => e.currentTarget.select()} className="h-28 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-[12px] leading-4 text-ink" />
          )}
          <p className="text-center text-[12px] leading-4 text-slate-400">Não é possível contratar o Scale diretamente: a proposta é enviada pelo time comercial.</p>
        </div>
      </aside>
      </div>
    </div>
  )
}

function Control({ label, value, hint, children }: { label: string; value?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-[16px] font-medium text-ink">{label}</span>
        {value !== undefined && <span className="text-[16px] text-brand-blue">{value}</span>}
      </div>
      {children}
      {hint && <p className="mt-2 text-[13px] text-body">{hint}</p>}
    </div>
  )
}

function BrandSlider({ min, max, step, value, onChange, label }: { min: number; max: number; step: number; value: number; onChange: (v: number) => void; label: string }) {
  return (
    <SliderPrimitive.Root className="relative flex h-5 w-full touch-none select-none items-center" min={min} max={max} step={step} value={[value]} onValueChange={(v) => onChange(v[0]!)} aria-label={label}>
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-slate-200">
        <SliderPrimitive.Range className="absolute h-full bg-brand-blue" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-brand-blue bg-white shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-blue/20" />
    </SliderPrimitive.Root>
  )
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-slate-200" role="group" aria-label={label}>
      <button type="button" aria-label={`Diminuir ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className="flex h-10 w-10 items-center justify-center text-ink hover:bg-slate-50 disabled:text-slate-300">
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-12 text-center text-[16px] tabular-nums text-ink">{value}</span>
      <button type="button" aria-label={`Aumentar ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className="flex h-10 w-10 items-center justify-center text-ink hover:bg-slate-50 disabled:text-slate-300">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}
