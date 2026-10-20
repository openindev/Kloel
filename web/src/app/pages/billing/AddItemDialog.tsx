import { useEffect, useMemo, useState } from 'react'
import '@/domain/ext/billing'
import type { CartItem } from '@/domain/ext/billing'
import type { BillingInterval, PlanTier, ProductKey } from '@/domain/types'
import { PRODUCTS, planOf } from '@/data/catalogs/plans'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { BetaBadge } from '@/components/ui/badge'
import { ProductIconBox } from './components'
import { PRODUCT_ORDER, moneyInt, planMonthly } from './lib'

/**
 * Seleção de "produto adicional" no checkout avulso (INFERIDO — a tela de seleção não foi capturada).
 * Lista produtos que ainda não estão no carrinho nem ativos; planos de preço individual (Scale) não entram no carrinho.
 */
export function AddItemDialog({ open, onOpenChange, exclude, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; exclude: ProductKey[]; onAdd: (item: CartItem) => void }) {
  const excludeKey = exclude.join(',')
  const options = useMemo(() => PRODUCT_ORDER.filter((p) => !excludeKey.split(',').includes(p)), [excludeKey])
  const [product, setProduct] = useState<ProductKey | undefined>(options[0])
  const [tier, setTier] = useState<PlanTier | undefined>()
  const [interval, setBillingInterval] = useState<BillingInterval>('monthly')
  useEffect(() => {
    if (open) {
      setProduct(options[0])
      setTier(undefined)
      setBillingInterval('monthly')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const def = PRODUCTS.find((p) => p.key === product)
  const plans = def?.plans.filter((p) => p.monthly != null) ?? []
  const chosenTier = tier ?? plans[0]?.tier
  const core = product === 'voice' || product === 'whatsapp' || product === 'webchat'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-y-6 rounded-2xl sm:max-w-[560px]">
        <DialogHeader className="gap-y-2">
          <DialogTitle>Adicionar produto adicional</DialogTitle>
          <DialogDescription>Escolha o produto e o plano. Planos com preço individual (Scale) são contratados com nosso time de vendas.</DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todos os produtos já estão no carrinho ou ativos.</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid gap-2" role="radiogroup" aria-label="Produto">
              {options.map((p) => {
                const d = PRODUCTS.find((x) => x.key === p)!
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={product === p}
                    onClick={() => {
                      setProduct(p)
                      setTier(undefined)
                    }}
                    className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm', product === p ? 'border-brand ring-2 ring-brand/15' : 'hover:bg-accent')}
                  >
                    <ProductIconBox product={p} className="h-8 w-8" />
                    <span className="flex-1 font-medium">{d.name}</span>
                    {p === 'email' && <BetaBadge />}
                  </button>
                )
              })}
            </div>
            {plans.length > 1 && (
              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium">Plano</div>
                <div className="flex flex-wrap gap-2">
                  {plans.map((pl) => (
                    <button
                      key={pl.tier}
                      type="button"
                      aria-pressed={chosenTier === pl.tier}
                      onClick={() => setTier(pl.tier)}
                      className={cn('rounded-lg border px-3 py-2 text-sm', chosenTier === pl.tier ? 'border-brand bg-brand/5 font-medium' : 'hover:bg-accent')}
                    >
                      {pl.name} · {moneyInt(planMonthly(pl, core ? interval : 'monthly') ?? 0)}/mês
                    </button>
                  ))}
                </div>
              </div>
            )}
            {core && (
              <Segmented
                ariaLabel="Cobrança"
                value={interval}
                onChange={setBillingInterval}
                options={[{ value: 'monthly', label: 'Mensal' }, { value: 'annual', label: 'Anual (-20%)' }]}
                className="self-start"
              />
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!product || !chosenTier || options.length === 0}
            onClick={() => {
              if (!product || !chosenTier || !planOf(product, chosenTier)) return
              onAdd({ product, tier: chosenTier, interval: core ? interval : 'monthly' })
              onOpenChange(false)
            }}
          >
            Adicionar ao carrinho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
