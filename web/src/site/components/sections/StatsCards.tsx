import { cn } from '@/lib/utils'
import { Container } from './primitives'

export interface StatItem {
  value: string
  label: string
}

/** Valores do template de Soluções (24/7, 15, 35+, 80%). */
export const TEMPLATE_STATS: StatItem[] = [
  { value: '24/7', label: 'Disponibilidade' },
  { value: '15', label: 'Chamadas simultâneas' },
  { value: '35+', label: 'Idiomas' },
  { value: '80%', label: 'Redução de custos' },
]

/**
 * 4 cartões brancos lado a lado com número índigo grande e rótulo cinza.
 * props: items? (padrão TEMPLATE_STATS), className
 */
export function StatsCards({ items = TEMPLATE_STATS, className }: { items?: StatItem[]; className?: string }) {
  return (
    <Container className={cn('py-10', className)}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
        {items.map((s) => (
          <div key={s.label} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-8 text-center sm:py-10">
            <div className="text-[36px] font-medium leading-none tracking-[-0.03em] text-[#5653F0] sm:text-[48px]">{s.value}</div>
            <div className="text-[15px] text-body sm:text-[16px]">{s.label}</div>
          </div>
        ))}
      </div>
    </Container>
  )
}
