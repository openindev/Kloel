import assert from 'node:assert/strict'
import { whatsappChannelsFixture } from '../../engine/tests/fixtures/whatsapp-channels'
import { createEngineClient, EngineError, type RequestOptions } from '../src/services/engine/http'
import { createWhatsAppChannelsService, type ConfiguredWhatsAppChannel } from '../src/services/engine/whatsapp-channels'
export async function whatsappChannelUIFixture(t: any) {
  const f = await whatsappChannelsFixture(t), providerFetch = globalThis.fetch
  const state = { who: 'owner', current: true, before: undefined as undefined | ((path: string, method: string) => void | Promise<void>), after: undefined as undefined | ((path: string, method: string, response: Response) => Response | Promise<Response>), lose: '' }
  const requests: { path: string; method: string; body: any; headers: Record<string, string> }[] = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input); if (!path.startsWith('/api/v1/')) return providerFetch(input, init)
    const method = init.method ?? 'GET', headers = Object.fromEntries(new Headers(init.headers))
    assert.equal(init.credentials, 'include'); requests.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined, headers })
    await state.before?.(path, method)
    const raw = await f.app.inject({ method: method as any, url: path, headers: { ...headers, cookie: 'kloel_session=' + f.cookies[state.who] }, ...(init.body ? { payload: String(init.body) } : {}) })
    const response = new Response(raw.statusCode === 204 ? null : raw.body, { status: raw.statusCode, headers: { 'Content-Type': 'application/json' } })
    if (state.lose === method + ' ' + path) { state.lose = ''; throw Error('Controlled response loss after commit') }
    return state.after ? state.after(path, method, response) : response
  }
  const identity = () => f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + f.cookies[state.who] } }).then(r => r.json())
  const captured = await identity(), client = createEngineClient(fetcher)
  const bound = { tenantId: f.tenant, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Changed') }, request: <T>(path: string, options?: RequestOptions) => client<T>(path, { ...options, expectedContext: captured.context }) }
  const service = createWhatsAppChannelsService(bound)
  const seed = async () => { const created = await f.create(); return service.get(created.row.id) }
  async function updateOther(row: ConfiguredWhatsAppChannel, name: string) { const response = await f.request('PATCH', '/channels/' + row.id, f.control(row, { name }), crypto.randomUUID(), 'other'); assert.equal(response.statusCode, 200, response.body); return service.get(row.id) }
  return { ...f, state, requests, fetcher, providerFetch, identity, service, bound, seed, updateOther, readCurrent: (row: ConfiguredWhatsAppChannel) => service.get(row.id), loginAs(name: string) { assert.ok(f.cookies[name]); state.who = name }, writes: () => requests.filter(r => r.path.startsWith('/api/v1/whatsapp/channels') && r.method !== 'GET') }
}

