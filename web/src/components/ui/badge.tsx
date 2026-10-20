import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        brand: 'border-transparent bg-brand/10 text-brand hover:bg-brand/10',
        success: 'border-transparent bg-emerald-500/10 text-emerald-700',
        warning: 'border-transparent bg-amber-500/10 text-amber-700',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

// Selo BETA animado (sidebar "E-Mail IA")
export function BetaBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 animate-gradient-shift items-center rounded-full bg-[linear-gradient(110deg,hsl(var(--brand)/0.65),hsl(var(--brand)),hsl(var(--brand)/0.65))] bg-[length:200%_100%] px-2 text-[10px] font-semibold uppercase tracking-wide text-white shadow-[0_0_12px_-2px_hsl(var(--brand)/0.55)]',
        className,
      )}
    >
      Beta
    </span>
  )
}
