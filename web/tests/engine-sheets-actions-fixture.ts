import type { TestContext } from 'node:test'
import { sheetsActionsFixture } from '../../engine/tests/fixtures/sheets-actions'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerWebchatChannels } from '../../engine/src/webchat-channels'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { createSheetActionsService } from '../src/services/engine/sheets-actions'

export async function sheetActionUIFixture(t: TestContext) {
  const f = await sheetsActionsFixture(t)
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { email: 'sheets@example.test', displayName: 'Conta de teste' })
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { voice: 'alloy', rules: [], initialMessage: '', settings: { temperature: 0.7, maxResponseTokens: 1024, timezone: 'UTC', recordingEnabled: false, humanHandoffEnabled: false } })
  await registerAccountProfile(f.app, f.store); await registerWebchatChannels(f.app, f.store)
  const identity = (await f.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: f.cookies })).json()
  const calls: { path: string; method: string; body: any; headers: Headers }[] = [], providerFetch = globalThis.fetch
  const state = { current: true, before: undefined as undefined | ((r: typeof calls[number]) => Promise<Response | void>), after: undefined as undefined | ((r: typeof calls[number], response: Response) => Promise<Response>) }
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input); if (!path.startsWith('/api/v1/')) return providerFetch(input, init)
    const request = { path, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) }; calls.push(request)
    const early = await state.before?.(request); if (early) return early
    const response = await f.app.inject({ method: request.method as any, url: path, cookies: f.cookies, headers: Object.fromEntries(request.headers), ...(init.body ? { payload: String(init.body) } : {}) })
    const result = new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
    return state.after ? state.after(request, result) : result
  }
  globalThis.fetch = fetcher
  const request = createEngineClient(fetcher), context = { tenantId: f.actor.tenantId, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Context changed') }, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }) }
  return { ...f, identity, calls, state, fetcher, providerFetch, context, client: createSheetActionsService(context, f.agent.id, f.actor.userId), writes: () => calls.filter(r => r.path.includes('/sheets-actions') && r.method !== 'GET' && !r.path.endsWith('/preview')) }
}
