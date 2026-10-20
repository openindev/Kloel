import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useBlocker, type Blocker, type BlockerFunction } from 'react-router-dom'
import { engineSession, useEngineSession } from '@/services/engine/session'

type Predicate = BlockerFunction | boolean
type Guard = { read: () => Predicate }
type Coordination = { register: (id: string, guard: Guard) => () => void; owner: string | null; blocker: Blocker }
const NavigationContext = createContext<Coordination | null>(null)
const unblocked: Blocker = { state: 'unblocked', location: undefined, proceed: undefined, reset: undefined }

/** Exactly one router blocker protects the private tree, including pages without drafts. */
export function PrivateNavigationCoordinator({ children }: { children: ReactNode }) {
  const session = useEngineSession(), generation = session.generation
  const guards = useRef(new Map<string, Guard>()), owner = useRef<string | null>(null), barrierOnly = useRef(false)
  const blocker = useBlocker(args => {
    owner.current = null
    for (const [id, guard] of guards.current) {
      const predicate = guard.read()
      if (typeof predicate === 'function' ? predicate(args) : predicate) { owner.current = id; break }
    }
    const current = engineSession.getSnapshot()
    const blocked = current.phase !== 'authenticated' || current.generation !== generation || current.validation !== 'ready'
    barrierOnly.current = blocked && owner.current === null
    return blocked || owner.current !== null
  })
  const currentBlocker = useRef(blocker)
  currentBlocker.current = blocker
  const register = useMemo(() => (id: string, guard: Guard) => {
    guards.current.set(id, guard)
    return () => { guards.current.delete(id) }
  }, [])
  const coordinated: Blocker = blocker.state === 'blocked' ? {
    ...blocker,
    proceed() {
      const current = engineSession.getSnapshot()
      // A delayed page callback must not escape the gate or resume a foreign session.
      if (currentBlocker.current === blocker && current.phase === 'authenticated' && current.generation === generation && current.validation === 'ready') blocker.proceed()
    },
    reset() { if (currentBlocker.current === blocker) { owner.current = null; barrierOnly.current = false; blocker.reset() } },
  } : blocker
  useEffect(() => {
    // Focus validation never replays a back/forward/link intent automatically.
    if (session.validation === 'ready' && blocker.state === 'blocked' && barrierOnly.current) {
      owner.current = null; barrierOnly.current = false; blocker.reset()
    }
  }, [session.validation, blocker])
  // No global "leave site?" prompt: while the session is being revalidated no write can pass the barrier, so leaving loses
  // nothing, and a failed/expired check (background tab, sleep) would otherwise prompt on every close. Pages with real drafts
  // (assistant, scheduler) keep their own beforeunload guard.
  return <NavigationContext.Provider value={{ register, owner: owner.current, blocker: coordinated }}>{children}</NavigationContext.Provider>
}

/** Page-local policy and confirmation UI, backed by the coordinator's single blocker. */
export function usePrivateNavigationBlocker(predicate: Predicate): Blocker {
  const context = useContext(NavigationContext), id = useId(), latest = useRef(predicate)
  latest.current = predicate
  if (!context) throw new Error('Private page navigation requires PrivateNavigationCoordinator.')
  const register = context.register
  useLayoutEffect(() => register(id, { read: () => latest.current }), [id, register])
  return context.owner === id ? context.blocker : unblocked
}
