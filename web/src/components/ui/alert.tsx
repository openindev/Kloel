import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Alert Fonio: "relative w-full flex flex-col gap-1 rounded-md text-sm border p-4 [&>svg~*]:pl-7 [&>svg]:size-4 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4"
const alertVariants = cva(
  'relative w-full flex flex-col gap-1 rounded-md text-sm border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:size-4 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground [&>svg]:text-foreground',
        info: 'border-blue-200 bg-blue-50/70 text-blue-950 [&>svg]:text-blue-700',
        destructive: 'border-destructive/50 text-destructive [&>svg]:text-destructive',
        warning: 'border-amber-200 bg-amber-50/70 text-amber-900 [&>svg]:text-amber-600',
        success: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 [&>svg]:text-emerald-600',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />,
)
Alert.displayName = 'Alert'
export const AlertTitle = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('font-medium leading-none tracking-tight', className)} {...p} />
export const AlertDescription = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('text-sm [&_p]:leading-relaxed', className)} {...p} />
