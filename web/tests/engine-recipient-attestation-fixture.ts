import assert from 'node:assert/strict'
import { recipientAttestationFixture } from '../../engine/tests/fixtures/recipient-attestation'
import { createEngineClient, EngineError, type RequestOptions } from '../src/services/engine/http'
import { createRecipientAttestationService } from '../src/services/engine/whatsapp-recipient-attestation'
import { createWhatsAppConversationReplyService } from '../src/services/engine/whatsapp-conversation-replies'
export async function recipientUIFixture(t: any) {
  const f = await recipientAttestationFixture(t), providerFetch = globalThis.fetch
  const state = { who: 'owner', current: true, loseBefore: '', loseAfter: '', failFocus: false,
    before: undefined as undefined | ((path: string, method: string) => void | Promise<void>), after: undefined as undefined | ((path: string, method: string, response: Response) => Response | Promise<Response>) }
  const requests: { path: string; method: string; body: any }[] = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'
    if (path === 'https://graph.facebook.com/v25.0/12345/messages') { assert.equal(method, 'POST'); return providerFetch(input, init) }
    assert.ok(path.startsWith('/api/v1/')); assert.equal(init.credentials, 'include')
    requests.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
    if (state.failFocus && path === '/api/v1/auth/me') return Response.json({ error: { code: 'controlled_unavailable', message: 'Controlled focus failure' } }, { status: 503 })
    await state.before?.(path, method)
    if (method === 'POST' && state.loseBefore && path.endsWith(state.loseBefore)) { state.loseBefore = ''; throw Error('Controlled before dispatch') }
    const raw = await f.app.inject({ method: method as any, url: path, headers: { ...Object.fromEntries(new Headers(init.headers)), cookie: 'kloel_session=' + f.cookies[state.who] }, ...(init.body ? { payload: String(init.body) } : {}) })
    const response = new Response(raw.statusCode === 204 ? null : raw.body, { status: raw.statusCode, headers: { 'Content-Type': 'application/json' } })
    if (method === 'POST' && state.loseAfter && path.endsWith(state.loseAfter)) { state.loseAfter = ''; throw Error('Controlled after commit') }
    return state.after ? state.after(path, method, response) : response
  }
  const identity = () => f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + f.cookies[state.who] } }).then(r => r.json())
  const captured = await identity(), client = createEngineClient(fetcher)
  const bound = { tenantId: f.tenant, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', '') }, request: <T>(path: string, options?: RequestOptions) => client<T>(path, { ...options, expectedContext: captured.context }) }
  return { ...f, state, identity, fetcher, bound, requests, service: createRecipientAttestationService(bound, f.conversationId), replies: createWhatsAppConversationReplyService(bound, f.conversationId),
    attestPosts: () => requests.filter(r => r.method === 'POST' && r.path.endsWith('/recipient-attestations')),
    replyPosts: () => requests.filter(r => r.method === 'POST' && r.path.endsWith('/replies')),
    lookups: () => requests.filter(r => r.method === 'GET' && r.path.includes('/recipient-attestations/')),
    loginAs(who: string) { assert.ok(f.cookies[who]); state.who = who },
  }
}
