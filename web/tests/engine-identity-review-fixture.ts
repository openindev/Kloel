import assert from 'node:assert/strict'
import { whatsappIdentityReviewFixture } from '../../engine/tests/fixtures/whatsapp-identity-review'
import { createEngineClient, EngineError, type RequestOptions } from '../src/services/engine/http'
import { createIdentityReviewService } from '../src/services/engine/whatsapp-identity-review'
export async function identityUIFixture(t: any) {
  const f = await whatsappIdentityReviewFixture(t)
  const state = { who: 'owner', current: true, loseBefore: false, loseAfter: false, failFocus: false,
    before: undefined as undefined | ((path: string, method: string) => void | Promise<void>),
    after: undefined as undefined | ((path: string, method: string, response: Response) => Response | Promise<Response>) }
  const requests: { path: string; method: string; body: any }[] = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'; assert.ok(path.startsWith('/api/v1/'), 'no external fetch'); assert.equal(init.credentials, 'include')
    requests.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
    if (state.failFocus && path === '/api/v1/auth/me') return Response.json({ error: { code: 'controlled_unavailable', message: 'Controlled validation failure' } }, { status: 503 })
    await state.before?.(path, method)
    const decision = method === 'POST' && path.endsWith('/whatsapp-identity-review')
    if (decision && state.loseBefore) { state.loseBefore = false; throw Error('Controlled pre-dispatch loss') }
    const raw = await f.app.inject({ method: method as any, url: path, headers: { ...Object.fromEntries(new Headers(init.headers)), cookie: 'kloel_session=' + f.cookies[state.who] }, ...(init.body ? { payload: String(init.body) } : {}) })
    const response = new Response(raw.statusCode === 204 ? null : raw.body, { status: raw.statusCode, headers: { 'Content-Type': 'application/json' } })
    if (decision && state.loseAfter) { state.loseAfter = false; throw Error('Controlled post-commit response loss') }
    return state.after ? state.after(path, method, response) : response
  }
  const identity = () => f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + f.cookies[state.who] } }).then(r => r.json())
  const captured = await identity(), client = createEngineClient(fetcher)
  const bound = { tenantId: f.tenant, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', '') }, request: <T>(path: string, options?: RequestOptions) => client<T>(path, { ...options, expectedContext: captured.context }) }
  return { ...f, state, identity, fetcher, bound, requests, service: createIdentityReviewService(bound, f.conversationId),
    writes: () => requests.filter(r => r.method === 'POST' && r.path.endsWith('/whatsapp-identity-review')),
    lookups: () => requests.filter(r => r.path.includes('/whatsapp-identity-operations/')),
    loginAs(who: string) { assert.ok(f.cookies[who]); state.who = who },
  }
}
