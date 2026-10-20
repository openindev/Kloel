import { createContext, useContext, type ReactNode } from 'react'

// Undefined is reserved for public surfaces. Private children mount only after
// their attached host exists, so a portal never moves from body into the host.
const PrivatePortalContext = createContext<HTMLElement | undefined>(undefined)

export function PrivatePortalProvider({ container, children }: { container: HTMLElement; children: ReactNode }) {
  return <PrivatePortalContext.Provider value={container}>{children}</PrivatePortalContext.Provider>
}

export function usePrivatePortalContainer(): HTMLElement | undefined {
  return useContext(PrivatePortalContext)
}
