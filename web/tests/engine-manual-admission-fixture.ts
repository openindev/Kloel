import assert from 'node:assert/strict'
import { manualAiAdmissionFixture } from '../../engine/tests/fixtures/manual-ai-admission'
import { createEngineClient, EngineError, type RequestOptions } from '../src/services/engine/http'
import { createManualAdmissionService } from '../src/services/engine/whatsapp-manual-admission'

export async function manualAdmissionUIFixture(t: any) {
  const f = await manualAiAdmissionFixture(t)
  const state = { who: 'owner', current: true, loseBefore: false, loseAfter: false, failFocus: false,
    before: undefined as undefined | ((path: string, method: string) => void | Promise<void>),
    after: undefined as undefined | ((path: string, method: string, response: Response) => Response | Promise<Response>) }
  const requests: { path: string; method: string; body: any }[] = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'; assert.ok(path.startsWith('/api/v1/'), 'UI transport must remain local'); assert.equal(init.credentials, 'include')
    requests.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
    if (state.failFocus && path === '/api/v1/auth/me') return Response.json({ error: { code: 'controlled_unavailable', message: 'Controlled validation failure' } }, { status: 503 })
    await state.before?.(path, method)
    const admission = method === 'POST' && path.endsWith('/manual-ai-admissions')
    if (admission && state.loseBefore) { state.loseBefore = false; throw Error('Controlled pre-dispatch loss') }
    const raw = await f.app.inject({ method: method as any, url: path, headers: { ...Object.fromEntries(new Headers(init.headers)), cookie: 'kloel_session=' + f.cookies[state.who] }, ...(init.body ? { payload: String(init.body) } : {}) })
    const response = new Response(raw.statusCode === 204 ? null : raw.body, { status: raw.statusCode, headers: { 'Content-Type': 'application/json' } })
    if (admission && state.loseAfter) { state.loseAfter = false; throw Error('Controlled post-commit response loss') }
    return state.after ? state.after(path, method, response) : response
  }
  const identity = () => f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + f.cookies[state.who] } }).then(r => r.json())
  const captured = await identity(), client = createEngineClient(fetcher)
  const bound = { tenantId: f.tenant, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', '') }, request: <T>(path: string, options?: RequestOptions) => client<T>(path, { ...options, expectedContext: captured.context }) }
  return { ...f, state, identity, fetcher, bound, requests, service: createManualAdmissionService(bound, f.conversationId),
    writes: () => requests.filter(r => r.method === 'POST' && r.path.endsWith('/manual-ai-admissions')),
    lookups: () => requests.filter(r => r.method === 'GET' && r.path.includes('/manual-ai-admissions/')),
    loginAs(who: string) { assert.ok(f.cookies[who]); state.who = who },
  }
}
