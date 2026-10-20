import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

// Segmented radiogroup Fonio: container "inline-flex items-center gap-0.5 rounded-md border border-input bg-muted/50 p-0.5"
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  ariaLabel: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex items-center gap-0.5 rounded-md border border-input bg-muted/50 p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 h-7 rounded-[5px] px-2.5 text-sm',
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
