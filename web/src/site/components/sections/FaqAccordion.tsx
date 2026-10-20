import type { ReactNode } from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SectionTitle } from './primitives'

export interface FaqItem {
  q: string
  a: ReactNode
}

/**
 * Acordeão de perguntas (um item aberto por vez; todos fechados ao carregar — OBSERVADO nas referências).
 * props:
 *  - items: { q, a }[]
 *  - variant: 'lines' (divisórias, chevron — home/produtos/soluções) | 'cards' (cartões com borda lilás — landing) | 'plus' (cartões com +/− — "Para quem é adequado")
 *  - title?: título H2 centralizado acima ; numbered?: prefixa "01", "02"… (ex.: "Veja como funciona")
 *  - value/onValueChange?: controle externo do item aberto (string do índice) ; className
 *  - size: 'md' (padrão; perguntas de 16 px, 17 px em `cards`/`plus` a partir de sm) | 'sm' (16 px em todas as variantes e
 *    linhas de 59 px com respostas 16/24 e pr-6 — Parceiros [259]/[265]/[270]); substitui a sobrescrita `[&_button]` que também
 *    atingia botões das respostas. /contato usa 'md' (linhas de 59 px como em [246])
 */
export function FaqAccordion({
  items, variant = 'lines', title, numbered, className, value, onValueChange, id, size = 'md', titleClassName,
}: {
  items: FaqItem[]; variant?: 'lines' | 'cards' | 'plus'; title?: ReactNode; numbered?: boolean; className?: string; value?: string; onValueChange?: (v: string) => void; id?: string; size?: 'md' | 'sm'
  /** classes extras do título (ex.: a home usa 28px até a 1ª pergunta, medidos em 8.png) */
  titleClassName?: string
}) {
  const controlled = value !== undefined ? { value, onValueChange: (v: string) => onValueChange?.(v) } : {}
  return (
    <div id={id} className={cn('w-full', className)}>
      {title && <SectionTitle title={title} className={cn('mb-10', titleClassName)} />}
      <AccordionPrimitive.Root type="single" collapsible {...controlled} className={cn(variant !== 'lines' && 'flex flex-col gap-3')}>
        {items.map((it, i) => (
          <AccordionPrimitive.Item
            key={it.q}
            value={String(i)}
            className={cn(
              variant === 'lines' && 'border-b border-[#E6E8EE] last:border-b-0',
              variant === 'cards' && 'rounded-2xl border border-[#E3E4FB] bg-white transition-shadow data-[state=open]:shadow-[0_6px_24px_-12px_rgba(88,93,254,.35)]',
              variant === 'plus' && 'rounded-2xl border border-[#E6E8EE] bg-white',
            )}
          >
            <AccordionPrimitive.Header className="flex">
              <AccordionPrimitive.Trigger
                className={cn(
                  'group flex flex-1 items-center justify-between gap-6 text-left font-site text-heading outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30',
                  // referência (8.png / 08.png a 1470px): pergunta 16px/500, linha de ~59px, chevron cinza
                  variant === 'lines' ? 'py-[17px] text-[16px] font-medium leading-6' : cn('px-5 py-5 text-[16px] font-medium leading-6 sm:px-6', size === 'md' && 'sm:text-[17px]'),
                )}
              >
                <span className="flex items-baseline gap-4">
                  {numbered && <span className="w-6 shrink-0 text-[16px] font-medium text-body">{String(i + 1).padStart(2, '0')}</span>}
                  <span>{it.q}</span>
                </span>
                {variant === 'plus' ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#E6E8EE] text-ink">
                    <Plus className="h-4 w-4 group-data-[state=open]:hidden" />
                    <Minus className="hidden h-4 w-4 group-data-[state=open]:block" />
                  </span>
                ) : (
                  // 8.png (1460px): na variante de linhas o chevron tem 16px e fica alinhado ao topo da linha da pergunta (y 242 = topo do texto)
                  <ChevronDown
                    className={cn(
                      'shrink-0 text-slate-400 transition-transform duration-200 group-data-[state=open]:rotate-180',
                      variant === 'lines' && size === 'md' ? 'h-4 w-4 self-start' : 'h-[18px] w-[18px]',
                    )}
                  />
                )}
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>
            <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
              {/* size 'sm' (Parceiros [259]/[265]/[270]): linhas de 59 px e resposta 16/24 quase na largura toda da lista */}
              <div className={cn('text-[16px] text-body', size === 'sm' ? 'leading-6' : 'leading-[26px]', variant === 'lines' ? cn('pb-[17px]', size === 'sm' ? 'pr-6' : 'pr-10') : 'px-5 pb-5 sm:px-6', numbered && variant === 'lines' && 'pl-10')}>{it.a}</div>
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        ))}
      </AccordionPrimitive.Root>
    </div>
  )
}
