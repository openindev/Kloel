import { cn } from '@/lib/utils'

// Barra de progresso Fonio: "h-1.5 overflow-hidden rounded-full bg-muted" > "h-full rounded-full bg-brand"
export function Progress({ value, className, barClassName }: { value: number; className?: string; barClassName?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full bg-brand transition-[width] duration-500', barClassName)} style={{ width: `${v}%` }} />
    </div>
  )
}
