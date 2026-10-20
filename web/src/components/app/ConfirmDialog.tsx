import { useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useRestoreFocus } from '@/hooks/useRestoreFocus'

/**
 * Confirmação padrão ("Tem certeza?") com ação destrutiva ou primária.
 * Foco: ao fechar, volta ao controle que abriu a confirmação (ver `useRestoreFocus`). Quem precisar de outra regra
 * passa `onCloseAutoFocus` (ex.: `useReturnFocus(open)` do site) ou qualquer prop do `DialogContent` em `contentProps`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title = 'Tem certeza?',
  description,
  confirmLabel,
  onConfirm,
  destructive = true,
  children,
  onCloseAutoFocus,
  contentProps,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title?: ReactNode
  description?: ReactNode
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  destructive?: boolean
  children?: ReactNode
  onCloseAutoFocus?: (e: Event) => void
  contentProps?: Omit<ComponentPropsWithoutRef<typeof DialogContent>, 'children'>
}) {
  const restoreFocus = useRestoreFocus(open)
  const submitting = useRef(false)
  const [pending, setPending] = useState(false)
  const confirm = async () => {
    if (submitting.current) return
    submitting.current = true
    setPending(true)
    try { await onConfirm(); onOpenChange(false) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a operação.') }
    finally { submitting.current = false; setPending(false) }
  }
  return (
    <Dialog open={open} onOpenChange={value => !submitting.current && onOpenChange(value)}>
      <DialogContent {...contentProps} onCloseAutoFocus={onCloseAutoFocus ?? contentProps?.onCloseAutoFocus ?? restoreFocus}>
        <DialogHeader className="gap-y-2">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
