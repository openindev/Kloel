import { useSyncExternalStore } from 'react'
import { createEngineClient, EngineError, parseExpectedContext, type RequestOptions } from './http'
import { SessionController } from './controller'

export const engineRequest = createEngineClient()
export const sessionChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window ? new BroadcastChannel('kloel-session') : undefined
export const engineSession = new SessionController(engineRequest, () => sessionChannel?.postMessage('changed'))
if (sessionChannel) sessionChannel.onmessage = () => { void engineSession.refresh() }
export const useEngineSession = () => useSyncExternalStore(engineSession.subscribe, engineSession.getSnapshot, engineSession.getSnapshot)
export const usePermission = (permission: string) => { useEngineSession(); return engineSession.can(permission) }

export function captureEngineContext(permission?: string) {
  const state = engineSession.getSnapshot(), tenantId = state.data?.identity.tenantId
  if (state.phase !== 'authenticated' || !tenantId || (permission && !engineSession.can(permission))) throw new EngineError(403, 'forbidden', 'Seu acesso não permite esta operação.')
  const generation = state.generation
  const expectedContext = parseExpectedContext(state.data!.identity.context)
  const assertAuthority = () => {
    const current = engineSession.getSnapshot()
    if (current.phase !== 'authenticated' || current.generation !== generation || current.data?.identity.tenantId !== tenantId || current.data.identity.userId !== expectedContext.userId || current.data.identity.context.authorityVersion !== expectedContext.authorityVersion || current.data.identity.context.membershipId !== expectedContext.membershipId) throw new EngineError(0, 'superseded', 'A organização ou sessão mudou. Atualize a tela.')
    if (permission && !engineSession.can(permission)) throw new EngineError(403, 'forbidden', 'Seu acesso mudou.')
  }
  const assertCurrent = () => {
    assertAuthority()
    const state = engineSession.getSnapshot()
    if (state.validation !== 'ready') throw new EngineError(0, state.validation === 'checking' ? 'session_validation_pending' : 'session_validation_failed', state.validationError ?? 'Sua sessão está sendo confirmada. Aguarde antes de continuar.')
  }
  return { tenantId, generation, assertCurrent, async request<T>(path: string, options?: RequestOptions): Promise<T> {
    assertAuthority()
    const abort = new AbortController()
    const cancel = () => abort.abort()
    options?.signal?.addEventListener('abort', cancel, { once: true })
    if (options?.signal?.aborted) cancel()
    const unsubscribe = engineSession.subscribe(() => { if (engineSession.getSnapshot().generation !== generation) cancel() })
    try {
      await engineSession.waitForValidation(generation, expectedContext, abort.signal)
      assertCurrent()
      const result = await engineRequest<T>(path, { ...options, signal: abort.signal, expectedContext })
      await engineSession.waitForValidation(generation, expectedContext, abort.signal)
      assertCurrent()
      return result
    } catch (error) {
      const captureRefusal = error instanceof EngineError && error.status === 403 && options?.method === 'POST' && /^\/crm\/capture\/proposals\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/apply$/.test(path) && ['capture_grant_inactive', 'capture_grant_changed'].includes(error.code)
      // A forbidden local read is revalidated without destroying its original references.
      const afterHttpReadRefusal = error instanceof EngineError && error.status === 403 && error.code === 'forbidden' && (!options?.method || options.method === 'GET') && /^\/(?:agents\/[a-f0-9-]{36}\/after-http|after-http\/(?:config-operations|operations)\/[a-f0-9-]{36}|conversations\/[a-f0-9-]{36}\/after-http-operations(?:\?cursor=[a-f0-9-]{36})?)$/i.test(path)
      if (captureRefusal || afterHttpReadRefusal) {
        assertAuthority()
        await engineSession.revalidateOnFocus()
        await engineSession.waitForValidation(generation, expectedContext, abort.signal)
        assertCurrent()
        throw error
      }
      // A 403 relayed from a third-party provider (wrong API key, table without permission) is not a change of Kloel access:
      // refreshing the session would unmount the open sheet and hide the error from the user.
      const upstreamRefusal = error instanceof EngineError && error.status === 403 && /^(?:baserow|airtable|provider)_|_permission_denied$/.test(error.code)
      if (!upstreamRefusal && error instanceof EngineError && (error.status === 401 || error.status === 403 || error.code === 'context_mismatch' || error.code === 'context_changed_in_flight')) {
        assertAuthority()
        void engineSession.refresh()
        throw error
      }
      await engineSession.waitForValidation(generation, expectedContext, abort.signal)
      assertCurrent()
      throw error
    } finally { unsubscribe(); options?.signal?.removeEventListener('abort', cancel) }
  } }
}
export type EngineContext = ReturnType<typeof captureEngineContext>
