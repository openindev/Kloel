import { forwardRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Barra flutuante inferior (escura) + painel de alterações não salvas, como na Fonio.
 * Posição: fixed bottom-5, centralizada na área de conteúdo (left = --sidebar-offset em md+).
 */
export function ActionBar({
  changes = 0,
  onDiscard,
  onSave,
  saving,
  children,
  hideDark,
}: {
  changes?: number
  onDiscard?: () => void
  onSave?: () => void
  saving?: boolean
  children?: ReactNode
  hideDark?: boolean
}) {
  const open = changes > 0
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 transition-[left] duration-200 ease-linear sm:bottom-5 md:left-[var(--sidebar-offset)]">
      <div className="flex min-w-0 max-w-full flex-col items-stretch gap-1">
        {/* Fechado (sem alterações) o painel fica no DOM só para a animação: fora da árvore de acessibilidade e da ordem do Tab
            (antes "Descartar alterações"/"Salvar" invisíveis recebiam foco pelo teclado e eram anunciados com "0 alterações"). */}
        <div aria-hidden={open ? undefined : true} className={cn('grid min-w-0 max-w-full transition-[grid-template-rows,opacity] duration-150 ease-in-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
          <div className="min-w-0 overflow-hidden rounded-2xl shadow-md">
            <div className="pointer-events-auto flex min-w-0 max-w-full items-center justify-between gap-6 rounded-2xl border bg-white p-1 pl-4">
              <p className="min-w-0 truncate text-sm text-foreground">
                {changes} {changes > 1 ? 'alterações' : 'alteração'}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="Descartar alterações"
                  tabIndex={open ? undefined : -1}
                  onClick={onDiscard}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-red-500"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  tabIndex={open ? undefined : -1}
                  disabled={saving}
                  className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl bg-brand px-3.5 text-sm font-medium text-primary-foreground shadow-none hover:bg-[#464ac4] disabled:opacity-60"
                >
                  {saving ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
        {!hideDark && children && (
          <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-1 self-center rounded-2xl border border-slate-700/70 bg-[#16171B] p-1 shadow-[0px_6px_18px_rgba(15,18,28,0.35)]">
            {children}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export const DarkBarButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(({ children, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn('inline-flex h-9 items-center gap-1 rounded-xl px-3 text-sm font-medium leading-5 text-slate-100 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50', className)}
    {...props}
  >
    {children}
  </button>
))
DarkBarButton.displayName = 'DarkBarButton'

export const DarkBarPrimary = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(({ children, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn('inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-brand px-3.5 py-2 text-sm font-medium text-[#FAFAFA] shadow-none transition hover:bg-[#464ac4] disabled:pointer-events-none disabled:bg-[#464ac4]/70', className)}
    {...props}
  >
    {children}
  </button>
))
DarkBarPrimary.displayName = 'DarkBarPrimary'

export const DarkBarIcon = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(({ children, className, ...props }, ref) => (
  <button ref={ref} type="button" className={cn('inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-100 hover:bg-white/10 hover:text-white', className)} {...props}>
    {children}
  </button>
))
DarkBarIcon.displayName = 'DarkBarIcon'
