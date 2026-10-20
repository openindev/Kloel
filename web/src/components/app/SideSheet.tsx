import { useRef, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Painel lateral padrão (Gerenciar tags, configurações de contatos, ações do assistente, regras):
 * "fixed md:rounded-xl inset-y-0 md:inset-y-5 right-0 md:right-5 w-[576px] max-md:w-full" + pane "p-8 gap-8".
 *
 * Foco ao abrir: por padrão o foco vai para o próprio painel (contêiner `tabIndex=-1`, sem anel), não para o primeiro
 * controle — assim um painel aberto por código/URL (?recurso=…, ?sheet=…) não mostra o anel focus-visible no lápis do
 * título ou na 1ª aba. O foco continua preso dentro do painel: Tab leva ao primeiro controle e Esc fecha.
 * Quem passar `onOpenAutoFocus` decide o próprio comportamento.
 */
export function SideSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  onSave,
  onCancel,
  saveLabel = 'Salvar',
  saveDisabled,
  saving,
  width = 576,
  footerLeft,
  hideFooter,
  overlay = true,
  onOpenAutoFocus,
  contentClassName,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  onSave?: () => void
  onCancel?: () => void
  saveLabel?: string
  saveDisabled?: boolean
  saving?: boolean
  width?: number
  footerLeft?: ReactNode
  hideFooter?: boolean
  overlay?: boolean
  /** foco inicial ao abrir (Radix). Padrão: foco no contêiner do painel (sem anel no 1º controle); passe o seu para outro comportamento */
  onOpenAutoFocus?: (e: Event) => void
  /** classes da área rolável (padrão "px-8 pt-2 pb-2"; a captura ao vivo da Fonio usa só "px-8" → passe "pt-0 pb-0") */
  contentClassName?: string
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const focusPanel = (e: Event) => {
    e.preventDefault()
    contentRef.current?.focus({ preventScroll: true })
  }
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {overlay && <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />}
        <DialogPrimitive.Content
          ref={contentRef}
          tabIndex={-1}
          aria-describedby={undefined}
          onOpenAutoFocus={onOpenAutoFocus ?? focusPanel}
          style={{ width }}
          className="outline-none fixed md:rounded-xl z-50 overflow-hidden bg-background shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-300 inset-y-0 md:inset-y-5 right-0 md:right-5 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right max-md:!w-full flex flex-col"
        >
          <div className="relative flex flex-1 min-h-0 overflow-hidden">
            <div className="w-full flex-shrink-0 flex flex-col gap-8 p-8">
              <div className="flex flex-col space-y-2 sm:text-left pr-10">
                <DialogPrimitive.Title className="text-xl font-semibold leading-8 text-foreground">{title}</DialogPrimitive.Title>
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
              </div>
              <div className="relative flex-1 min-h-0 -mx-8 overflow-y-auto">
                <div className={cn('px-8 pt-2 pb-2', contentClassName)}>{children}</div>
              </div>
              {!hideFooter &&
                (footer ?? (
                  <div className="flex flex-row items-center justify-between gap-2">
                    <div>{footerLeft}</div>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" type="button" onClick={() => (onCancel ? onCancel() : onOpenChange(false))}>
                        Cancelar
                      </Button>
                      {onSave && (
                        <Button type="button" onClick={onSave} disabled={saveDisabled || saving}>
                          {saving ? 'Salvando…' : saveLabel}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <DialogPrimitive.Close className="absolute right-8 top-[2.2rem] rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
            <X className="h-6 w-6" />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Linha "rótulo + switch" dos sheets: "flex min-h-8 items-center justify-between gap-4". */
export function SheetSwitchRow({ label, description, children }: { label: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-sm font-medium leading-none">{label}</div>
        {children}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

export function SheetSectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('text-sm font-semibold uppercase tracking-widest text-foreground/60', className)}>{children}</h3>
}
