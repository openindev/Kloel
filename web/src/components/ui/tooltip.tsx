import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { usePrivatePortalContainer } from '@/components/app/PrivatePortal'

export const TooltipProvider = TooltipPrimitive.Provider

/**
 * Tooltip Radix com suporte a toque: além do hover, TOCAR no gatilho (quando ele não é link nem abre outro
 * componente — menu, popover, diálogo) alterna o conteúdo, para os ícones ⓘ funcionarem no celular.
 * Cliques de mouse seguem o comportamento padrão do Radix e nunca são cancelados (gatilhos aninhados —
 * PopoverTrigger/DialogTrigger dentro de SimpleTooltip — continuam abrindo).
 */
const TapCtx = React.createContext<{ toggle: () => void } | null>(null)

export function Tooltip({ open: openProp, onOpenChange, defaultOpen, children, ...props }: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) {
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : inner
  // o Radix fecha o tooltip no clique do gatilho; logo após um toque que abriu, esse fechamento é ignorado
  const ignoreCloseUntil = React.useRef(0)
  const setOpen = React.useCallback(
    (o: boolean) => {
      if (!o && performance.now() < ignoreCloseUntil.current) return
      if (!controlled) setInner(o)
      onOpenChange?.(o)
    },
    [controlled, onOpenChange],
  )
  const ctx = React.useMemo(
    () => ({
      toggle: () => {
        const next = !open
        if (next) ignoreCloseUntil.current = performance.now() + 120
        if (!controlled) setInner(next)
        onOpenChange?.(next)
      },
    }),
    [open, controlled, onOpenChange],
  )
  return (
    <TapCtx.Provider value={ctx}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen} {...props}>
        {children}
      </TooltipPrimitive.Root>
    </TapCtx.Provider>
  )
}

/** O gatilho é link ou abre outro componente (menu, popover, diálogo, select)? Então o toque é dele. */
function opensSomethingElse(el: HTMLElement) {
  return !!el.closest('a') || el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls')
}

export const TooltipTrigger = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>>(
  ({ onClick, onPointerDown, ...props }, ref) => {
    const tap = React.useContext(TapCtx)
    const lastPointer = React.useRef<string>('mouse')
    return (
      <TooltipPrimitive.Trigger
        ref={ref}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType
          onPointerDown?.(e)
        }}
        onClick={(e) => {
          onClick?.(e)
          if (tap && lastPointer.current === 'touch' && !opensSomethingElse(e.currentTarget)) tap.toggle()
          lastPointer.current = 'mouse'
        }}
        {...props}
      />
    )
  },
)
TooltipTrigger.displayName = 'TooltipTrigger'

/**
 * Conteúdo do tooltip no padrão da Fonio ao vivo (shadcn atual): caixa preta text-xs com SETA em losango
 * (fonio-live2/K-admin/06–07, A-sidebar/06 e 08). `sideOffset` 0 + a altura da seta (10px) que o Radix soma ao afastamento.
 * `arrow={false}` para os avisos que na Fonio são Popover sem seta (ex.: "Campanhas outbound").
 */
export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & { arrow?: boolean }
>(({ className, sideOffset = 0, arrow = true, children, ...props }, ref) => (
    <TooltipPrimitive.Portal container={usePrivatePortalContainer()}>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[70] max-w-xs rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    >
      {children}
      {arrow && <TooltipPrimitive.Arrow width={10} height={10} className="z-[70] size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-primary fill-primary" asChild><span /></TooltipPrimitive.Arrow>}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export function SimpleTooltip({ label, children, side }: { label: React.ReactNode; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
