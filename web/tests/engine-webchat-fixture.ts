import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerDomains } from '../../engine/src/domains'
import { registerWebchatChannels } from '../../engine/src/webchat-channels'
import { registerPublicChat } from '../../engine/src/public-chat'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { createWebchatService } from '../src/services/engine/webchat'

export async function webchatFixture(t: any, role = 'owner') {
  const store = new Store(), actor = { tenantId: randomUUID(), userId: randomUUID(), role: role as any }; seedMember(store, actor)
  const originalEnv = Object.fromEntries(['PROVIDER_TENANT_ID', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'PUBLIC_BASE_URL'].map(name => [name, process.env[name]]))
  Object.assign(process.env, { PROVIDER_TENANT_ID: actor.tenantId, OPENAI_API_KEY: 'synthetic-test-never-external', OPENAI_MODEL: 'synthetic', PUBLIC_BASE_URL: 'https://engine.example.test' })
  const cookieValue = 'webchat-fixture-' + randomUUID(), hash = createHash('sha256').update(cookieValue).digest('hex')
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, actor.userId, actor.tenantId, Date.now() + 600000)
  const app = Fastify({ logger: false }); await app.register(cookie)
  app.setErrorHandler((error: any, _request: any, reply: any) => reply.code(error.statusCode ?? error.status ?? 500).send({ error: { code: error.code ?? 'internal_error', message: error.message } }))
  await registerAuth(app, store); await registerAccountProfile(app, store); await registerDomains(app, store); await registerWebchatChannels(app, store); await registerPublicChat(app, store)
  const agentResult = await app.inject({ method: 'POST', url: '/api/v1/agents', headers: { cookie: `kloel_session=${cookieValue}` }, payload: { name: 'Assistente sintético', status: 'active' } })
  if (role === 'owner') assert.equal(agentResult.statusCode, 201, agentResult.body)
  const agent = agentResult.statusCode === 201 ? agentResult.json() : store.create(actor.tenantId, 'agents', { name: 'Assistente sintético', status: 'active' })
  const identity = (await app.inject({ url: '/api/v1/auth/me', headers: { cookie: `kloel_session=${cookieValue}` } })).json()
  const requests: Array<{ path: string; method: string; body: any }> = []
  const state = { current: true, before: undefined as undefined | ((path: string, method: string, body: any) => Promise<Response | void>), after: undefined as undefined | ((path: string, method: string, response: Response) => Promise<Response>) }
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined
    assert.ok(path.startsWith('/api/v1/'), 'No provider network is permitted'); requests.push({ path, method, body })
    const early = await state.before?.(path, method, body); if (early) return early
    const result = await app.inject({ method: method as any, url: path, headers: { ...init.headers as any, cookie: `kloel_session=${cookieValue}` }, ...(init.body ? { payload: String(init.body) } : {}) })
    const response = new Response(result.statusCode === 204 ? null : result.body, { status: result.statusCode, headers: { 'Content-Type': 'application/json' } })
    return state.after ? state.after(path, method, response) : response
  }
  const request = createEngineClient(fetcher), context = { tenantId: actor.tenantId, generation: 1, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }), assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Sessão alterada.') } }
  t.after(async () => { await app.close(); store.close(); for (const [name, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value } })
  return { app, store, actor, agent, identity, state, requests, cookieValue, hash, fetcher, context, client: createWebchatService(context, agent.id) }
}
