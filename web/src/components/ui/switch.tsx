import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

// Fonio: h-[22px] min-w-10, thumb h-4 w-4 translate-x-[19px], checked bg-brand
export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        'peer inline-flex cursor-pointer items-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-brand data-[state=unchecked]:bg-input border-transparent h-[22px] min-w-10',
        className,
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb className="pointer-events-none block rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=unchecked]:translate-x-0 h-4 w-4 data-[state=checked]:translate-x-[19px]" />
    </SwitchPrimitives.Root>
  ),
)
Switch.displayName = SwitchPrimitives.Root.displayName
