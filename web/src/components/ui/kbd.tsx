import { cn } from '@/lib/utils'
export function Kbd({ children, inverted, className }: { children: React.ReactNode; inverted?: boolean; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs px-1 font-sans text-[13px] font-medium leading-none',
        inverted ? 'bg-white/20 text-primary-foreground' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
