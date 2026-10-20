import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Calculator } from 'lucide-react'
import type { BillingInterval, ProductKey } from '@/domain/types'
import { PRODUCTS, productByKey } from '@/data/catalogs/plans'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
// Mesmas regras e o mesmo cálculo da calculadora pública (/planos → "Configurar plano"): mesmas entradas = mesmo total.
import { SCALE_DEFAULTS, SCALE_RULES, brl, careName, computeScale, num, type CareTier, type ScaleConfig, type ScaleProd } from '@/site/pages/pricing/scale'

const isScaleProd = (p: ProductKey): p is ScaleProd => p === 'voice' || p === 'whatsapp' || p === 'webchat'
const CARE_TIERS: CareTier[] = ['none', 'essential', 'pro', 'premium']
const OUTBOUND = { min: 0, max: 20000, step: 500 }

/**
 * "Configurar plano" do Scale (app): estimativa local; o envio depende de um serviço comercial disponível.
 * Usa `computeScale` de site/pages/pricing/scale.ts — as mesmas regras do configurador público — com o visual do app.
 */
export function ScaleConfigDialog({ product, open, onOpenChange, interval }: { product: ProductKey; open: boolean; onOpenChange: (o: boolean) => void; interval: BillingInterval }) {
  if (!isScaleProd(product)) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] rounded-2xl sm:max-w-[560px]" data-testid="scale-config-dialog">
        {open && <ScaleConfigForm key={`${product}-${interval}`} prod={product} initialAnnual={interval === 'annual'} />}
      </DialogContent>
    </Dialog>
  )
}

function ScaleConfigForm({ prod, initialAnnual }: { prod: ScaleProd; initialAnnual: boolean }) {
  const rules = SCALE_RULES[prod]
  const [cfg, setCfg] = useState<ScaleConfig>(SCALE_DEFAULTS[prod])
  const [billing, setBilling] = useState<BillingInterval>(initialAnnual ? 'annual' : 'monthly')
  const annual = billing === 'annual'
  const result = useMemo(() => computeScale(prod, cfg, annual), [prod, cfg, annual])
  const set = (patch: Partial<ScaleConfig>) => setCfg((c) => ({ ...c, ...patch }))
  const unitShort = rules.unit === 'minuto' ? 'min' : 'conversas'
  const carePlans = PRODUCTS.find((p) => p.key === 'care')?.plans ?? []

  const requestProposal = () => {
    toast.error('Não foi possível solicitar a proposta. Este serviço ainda não está disponível.')
  }
  const talkToSales = () => {
    toast.error('Não foi possível entrar em contato com vendas. Este serviço ainda não está disponível.')
  }

  return (
    <>
      <DialogHeader className="gap-y-2 pr-6 text-left">
        <DialogTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5 shrink-0 text-brand" /> Configurar plano Scale
        </DialogTitle>
        <DialogDescription>{productByKey(prod).name} — ajuste o volume para ver uma estimativa. O preço final é individual e definido com nosso time de vendas.</DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 flex-col gap-6">
        <Segmented
          ariaLabel="Cobrança"
          value={billing}
          onChange={setBilling}
          options={[{ value: 'monthly', label: 'Mensal' }, { value: 'annual', label: `Anual -${Math.round((1 - computeScale(prod, cfg, true).factor) * 100)}%` }]}
          className="self-start"
        />
        <SliderRow label={rules.unitPlural} value={`${num(cfg.volume)} ${unitShort}`} hint={`${num(rules.included)} incluídos no plano`}>
          <Slider value={[cfg.volume]} min={rules.min} max={rules.max} step={rules.step} aria-label={rules.unitPlural} onValueChange={([v]) => set({ volume: v ?? rules.min })} />
        </SliderRow>
        {rules.numbersMax > 0 && (
          <SliderRow label={rules.numbersLabel!} value={`${cfg.numbers} ${cfg.numbers === 1 ? 'número' : 'números'}`} hint={`${rules.numbersIncluded} incluídos · ${brl(rules.numberPrice)}/mês por número extra`}>
            <Slider value={[cfg.numbers]} min={1} max={rules.numbersMax} step={1} aria-label={rules.numbersLabel} onValueChange={([v]) => set({ numbers: v ?? 1 })} />
          </SliderRow>
        )}
        {prod === 'voice' && (
          <SliderRow label="Ligações ativas (campanhas)" value={`${num(cfg.outbound)} min`} hint={`${brl(0.24, 2)} por minuto iniciado`}>
            <Slider value={[cfg.outbound]} min={OUTBOUND.min} max={OUTBOUND.max} step={OUTBOUND.step} aria-label="Ligações ativas (campanhas)" onValueChange={([v]) => set({ outbound: v ?? 0 })} />
          </SliderRow>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Acompanhamento Kloel Care (opcional)</span>
          <Select value={cfg.care} onValueChange={(v) => set({ care: v as CareTier })}>
            <SelectTrigger aria-label="Acompanhamento Kloel Care" className="min-w-0 [&>span]:truncate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CARE_TIERS.map((t) => {
                const plan = carePlans.find((p) => p.tier === t)
                return (
                  <SelectItem key={t} value={t}>
                    {careName(t)}
                    {plan ? ` — ${brl(plan.monthly ?? 0)}/mês` : ''}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 px-4 py-3" data-testid="scale-estimate">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Estimativa {annual ? 'mensal (cobrança anual)' : 'mensal'}</div>
              <div className="text-xl font-semibold tracking-tight">
                <span data-testid="scale-total">{brl(result.total)}</span> <span className="text-sm font-normal text-muted-foreground">/ mês</span>
              </div>
              <div className="text-xs text-muted-foreground">
                equivale a {brl(result.perUnit, 2)}/{rules.unit === 'minuto' ? 'min' : 'conversa'}
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Estimativa</span>
          </div>
          <ul className="flex flex-col gap-1 border-t pt-2 text-xs" aria-label="Composição da estimativa">
            {result.lines.map((l) => (
              <li key={l.label} className="flex justify-between gap-3">
                <span className="min-w-0 text-muted-foreground">{l.label}</span>
                <span className="shrink-0 tabular-nums">{brl(l.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={talkToSales}>Falar com vendas</Button>
        <Button onClick={requestProposal}>Solicitar proposta</Button>
      </DialogFooter>
    </>
  )
}

function SliderRow({ label, value, hint, children }: { label: string; value: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{value}</span>
      </div>
      {children}
      {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
