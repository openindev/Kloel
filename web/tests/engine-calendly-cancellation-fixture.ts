import type { TestContext } from 'node:test'
import type { FastifyInstance } from 'fastify'
import type { Store } from '../../engine/src/store'
import { calendlyCancellationFixture } from '../../engine/tests/fixtures/calendly-cancellation'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerScheduling } from '../../engine/src/scheduling'
import { registerWebchatChannels } from '../../engine/src/webchat-channels'
import { registerConversationAnalysis } from '../../engine/src/conversation-analysis/routes'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { createCalendlyService, type CalendlyAttempt } from '../src/services/engine/calendly'

export async function calendlyCancellationUIFixture(t: TestContext, setup?: (app: FastifyInstance, store: Store) => void | Promise<void>) {
  const f = await calendlyCancellationFixture(t, async (app, store) => {
    await registerAccountProfile(app, store)
    await registerScheduling(app, store)
    await registerWebchatChannels(app, store)
    // Providers already registers Before. After is registered separately in buildApp.
    await registerConversationAnalysis(app, store)
    await setup?.(app, store)
  })
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { voice: 'alloy', rules: [], initialMessage: '', settings: { temperature: 0.7, maxResponseTokens: 1024, timezone: 'UTC', recordingEnabled: false, humanHandoffEnabled: false } })
  const identity = (await f.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: f.cookies })).json()
  const providerFetch = globalThis.fetch
  const calls: { path: string; method: string; body: any; headers: Headers }[] = []
  const state = {
    current: true,
    before: undefined as undefined | ((request: typeof calls[number]) => Response | void | Promise<Response | void>),
    after: undefined as undefined | ((request: typeof calls[number], response: Response) => Response | Promise<Response>),
  }
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input)
    // The captured provider transport rejects every host outside the controlled fixture.
    if (!path.startsWith('/api/v1/')) return providerFetch(input, init)
    const request = { path, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) }
    calls.push(request)
    const early = await state.before?.(request)
    if (early) return early
    const response = await f.app.inject({ method: request.method as any, url: path, cookies: f.cookies, headers: Object.fromEntries(request.headers), ...(init.body ? { payload: String(init.body) } : {}) })
    const result = new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
    return state.after ? state.after(request, result) : result
  }
  globalThis.fetch = fetcher
  const request = createEngineClient(fetcher)
  const context = {
    tenantId: f.actor.tenantId,
    generation: 1,
    assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Context changed') },
    request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }),
  }
  const choices = async () => {
    const connection = await f.connect()
    const action = await f.createAction(connection.id)
    f.toolRound(action)
    const response = await f.askPrivate()
    if (response.statusCode !== 200) throw new Error(response.body)
    return response.json().calendlyChoices
  }
  const client = createCalendlyService(context)
  const confirmedCreation = async () => {
    const prepared = await f.prepare(), choice = prepared.choice
    const attempt: CalendlyAttempt = { key: prepared.creationKey, conversationId: choice.conversationId, actionId: choice.actionId, actionRevision: choice.actionRevision, eventTypeId: choice.eventTypeId, chatOperationKey: choice.chatOperationKey }
    const receipt = await client.operation(attempt)
    return { ...prepared, attempt, receipt }
  }
  return { ...f, identity, calls, state, fetcher, providerFetch, context, client, choices, confirmedCreation, writes: () => calls.filter(call => call.method !== 'GET' && call.path.startsWith('/api/v1/calendly/')) }
}
