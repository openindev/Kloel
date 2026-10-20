import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { engineSession, useEngineSession } from '@/services/engine/session'
import { PrivatePortalProvider } from './PrivatePortal'
import { PrivateNavigationCoordinator } from './PrivateNavigation'

/** Hides an unverified tree without changing form, portal, or draft identity. */
export function PrivateSessionBoundary({ children }: { children: ReactNode }) {
  const session = useEngineSession(), [container, setContainer] = useState<HTMLDivElement | null>(null)
  const blocked = session.validation !== 'ready'
  // Input is blocked at once; the tree is only hidden (and the dialog shown) when a check fails or takes longer than a
  // quick focus revalidation, so returning to the tab does not flash a full-screen barrier every time.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (session.validation !== 'checking') { setSlow(false); return }
    const timer = setTimeout(() => setSlow(true), 700)
    return () => clearTimeout(timer)
  }, [session.validation])
  const hidden = session.validation === 'error' || (session.validation === 'checking' && slow)
  const guard = useCallback((event: SyntheticEvent) => {
    const current = engineSession.getSnapshot()
    if (current.phase !== 'authenticated' || current.validation !== 'ready') { event.preventDefault(); event.stopPropagation() }
  }, [])
  return <PrivateNavigationCoordinator>
    <div data-private-surface="" data-engine-state={blocked ? session.validation === 'error' ? 'error' : 'loading' : 'ready'} hidden={hidden} {...(blocked ? { inert: '' } : {})} aria-hidden={blocked || undefined}
      style={{ display: hidden ? 'none' : 'contents' }} onClickCapture={guard} onSubmitCapture={guard}
      onInputCapture={guard} onChangeCapture={guard} onKeyDownCapture={guard} onPointerDownCapture={guard}>
      <div data-private-portal-host="" ref={setContainer} />
      {container && <PrivatePortalProvider container={container}>{children}</PrivatePortalProvider>}
    </div>
    {/* A separate modal focus scope pauses private Radix dialogs without unmounting them. */}
    <Dialog.Root open={hidden}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1000] bg-background/90" />
        <Dialog.Content aria-describedby="private-validation-description" className="fixed left-1/2 top-1/2 z-[1001] w-[min(90vw,28rem)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg border bg-background p-6 shadow-lg"
          onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
          <Dialog.Title className="text-lg font-semibold">{session.validation === 'error' ? 'Confirme sua sessão para continuar' : 'Confirmando sua sessão…'}</Dialog.Title>
          <Dialog.Description id="private-validation-description" className="text-sm text-muted-foreground">
            {session.validation === 'error' ? 'Não foi possível confirmar seu acesso. Seus rascunhos continuam nesta aba; o conteúdo ficará oculto até a confirmação.' : 'Seus rascunhos estão preservados. Aguarde a confirmação do seu acesso.'}
          </Dialog.Description>
          {session.validation === 'error' ? <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => void engineSession.revalidateOnFocus()}>Tentar confirmar novamente</button> : <p role="status" className="text-sm">Aguarde…</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </PrivateNavigationCoordinator>
}
