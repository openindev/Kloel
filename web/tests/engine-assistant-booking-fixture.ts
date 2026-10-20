import type { TestContext } from 'node:test'
import type { FastifyInstance } from 'fastify'
import type { Store } from '../../engine/src/store'
import { assistantBookingFixture } from '../../engine/tests/fixtures/assistant-booking'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerScheduling } from '../../engine/src/scheduling'
import { registerWebchatChannels } from '../../engine/src/webchat-channels'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { createAssistantBookingService } from '../src/services/engine/assistant-booking'

export async function assistantBookingUIFixture(t: TestContext, setup?: (app: FastifyInstance, store: Store) => void | Promise<void>) {
  const f = await assistantBookingFixture(t, async (app, store) => { await registerAccountProfile(app, store); await registerScheduling(app, store); await registerWebchatChannels(app, store); await setup?.(app, store) })
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { voice: 'alloy', rules: [], initialMessage: '', settings: { temperature: 0.7, maxResponseTokens: 1024, timezone: 'UTC', recordingEnabled: false, humanHandoffEnabled: false } })
  const identity = (await f.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: f.cookies })).json(), providerFetch = globalThis.fetch
  const calls: { path: string; method: string; body: any; headers: Headers }[] = []
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
  const choices = async () => { const action = await f.create(); f.toolRound(action); const result = await f.askPrivate(); if (result.statusCode !== 200) throw Error(result.body); return result.json().bookingChoices }
  return { ...f, identity, calls, state, fetcher, providerFetch, context, client: createAssistantBookingService(context, f.agent.id), choices, writes: () => calls.filter(r => r.method !== 'GET' && (/\/booking-actions(?:\/[^/]+)?$/.test(r.path) || /\/bookings$/.test(r.path))) }
}
