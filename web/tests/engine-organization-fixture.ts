import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerDomains } from '../../engine/src/domains'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { organizationClient } from '../src/services/engine/organization'

export async function organizationFixture(t: any, options: { role?: 'owner' | 'member' | 'viewer'; empty?: boolean } = {}) {
  const store = new Store(), actor = { tenantId: randomUUID(), userId: randomUUID(), role: options.role ?? 'owner' }
  seedMember(store, actor)
  const cookieValue = 'organization-fixture-' + randomUUID(), hash = createHash('sha256').update(cookieValue).digest('hex')
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, actor.userId, actor.tenantId, Date.now() + 600000)
  const config = { name: 'Empresa persistida', legalName: 'Empresa de Testes Ltda.', country: 'BR', locale: 'pt-BR', timezone: 'America/Sao_Paulo', website: 'https://example.test', supportEmail: 'suporte@example.test', currency: 'BRL', notifications: { newConversation: true, appointmentCreated: false, usageWarnings: true } }
  const row = options.empty ? undefined : store.create(actor.tenantId, 'organization-settings', config)
  const app = Fastify({ logger: false }); await app.register(cookie)
  app.setErrorHandler((error: any, _req: any, reply: any) => reply.code(error.statusCode ?? error.status ?? 500).send({ error: { code: error.code ?? 'internal_error', message: error.message } }))
  await registerAuth(app, store); await registerAccountProfile(app, store); await registerDomains(app, store)
  const requests: Array<{ path: string; method: string; body: any }> = []
  const state = { current: true, loseNext: false, hold: undefined as undefined | ((path: string, method: string, response: Response) => Promise<Response>), before: undefined as undefined | ((path: string, method: string) => Promise<void>) }
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'
    assert.ok(path.startsWith('/api/v1/'), 'No external network is allowed'); assert.equal(init.credentials, 'include'); assert.equal(new Headers(init.headers).get('Authorization'), null)
    requests.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
    await state.before?.(path, method)
    const result = await app.inject({ method: method as any, url: path, headers: { ...init.headers as any, cookie: `kloel_session=${cookieValue}` }, ...(init.body ? { payload: String(init.body) } : {}) })
    const response = new Response(result.statusCode === 204 ? null : result.body, { status: result.statusCode, headers: { 'Content-Type': 'application/json' } })
    if (state.loseNext && method === 'PUT') { state.loseNext = false; throw Error('Synthetic response loss after commit') }
    return state.hold ? state.hold(path, method, response) : response
  }
  const context = { tenantId: actor.tenantId, generation: 1, request: createEngineClient(fetcher), assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Sessão alterada.') } }
  t.after(async () => { await app.close(); store.close() })
  return { store, actor, row, config, app, hash, cookieValue, requests, state, context, client: organizationClient(context), fetcher }
}
