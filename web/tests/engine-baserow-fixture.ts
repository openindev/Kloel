import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerDomains } from '../../engine/src/domains'
import { registerIntegrations } from '../../engine/src/integrations'
import { seedMember } from '../../engine/tests/fixtures/membership'
import type { IntegrationTransport } from '../../engine/src/integrations/transport'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { createBaserowService, baserowAttempt, type BaserowConfiguration } from '../src/services/engine/baserow'

export const instanceUrl = 'https://database.example.com', tableId = 123, rowId = 1234
export const fieldId = 'field_1', numberId = 'field_2', checkboxId = 'field_3', selectId = 'field_4', dateId = 'field_5', computedId = 'field_6', multiId = 'field_7'
export const syntheticToken = 'synthetic-baserow-database-token'
export const fields = [
  { id: 1, name: 'Nome', type: 'text', primary: true },
  { id: 2, name: 'Quantidade', type: 'number', number_decimal_places: 20 },
  { id: 3, name: 'Ativo', type: 'boolean' },
  { id: 4, name: 'Categoria', type: 'single_select', select_options: [{ id: 41, value: 'A' }, { id: 42, value: 'B' }] },
  { id: 5, name: 'Data', type: 'date' },
  { id: 6, name: 'Total calculado', type: 'formula', read_only: true },
  { id: 7, name: 'Categorias', type: 'multiple_select', select_options: [{ id: 71, value: 'Um' }, { id: 72, value: 'Dois' }] },
]
export const configuration = (extra: Partial<BaserowConfiguration> = {}): BaserowConfiguration => ({ name: 'Tabela sintética', instanceUrl, tableId, token: syntheticToken, allowedRoles: ['owner', 'admin'], agentIds: [], enabled: true, allowCreate: true, ...extra })
export const providerResponse = (body: unknown, status = 200) => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) })
export async function baserowFixture(t: any) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 28).toString('base64')
  const store = new Store(':memory:'), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }; seedMember(store, actor)
  const token = randomUUID(), hash = createHash('sha256').update(token).digest('hex'); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, actor.userId, actor.tenantId, Date.now() + 3600000)
  const calls: Array<{ method: string; url: URL; body?: any }> = [], counters = { dns: 0 }
  const hooks: { dns?: () => void; provider?: NonNullable<IntegrationTransport['request']> } = {}
  const transport: IntegrationTransport = { resolve: async () => { counters.dns++; hooks.dns?.(); return [{ address: '93.184.216.34', family: 4 }] }, request: async (...args) => {
    const [url, , spec] = args; assert.equal(url.origin, instanceUrl); assert.equal(spec.headers.authorization, `Token ${syntheticToken}`)
    const body = spec.body ? JSON.parse(spec.body.toString()) : undefined; calls.push({ method: spec.method, url, body })
    if (hooks.provider) return hooks.provider(...args)
    if (url.pathname.includes('/fields/')) return providerResponse(fields)
    if (spec.method === 'POST') return providerResponse({ id: rowId, ...body })
    return providerResponse({ count: 2, next: url.searchParams.get('page') === '1' ? 'https://untrusted.example.test/never-follow' : null, previous: null, results: [{ id: rowId, [fieldId]: '<img src=x onerror=alert(1)>', [numberId]: '0.00', [checkboxId]: false }] })
  } }
  const app = Fastify({ logger: false }); await app.register(cookie)
  app.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? error.status ?? 500).send({ error: { code: error.code ?? 'fixture_error', message: error.message } }))
  await registerAuth(app, store); await registerAccountProfile(app, store); await registerDomains(app, store); await registerIntegrations(app, store, transport)
  const inject = (method: any, url: string, payload?: any) => app.inject({ method, url, headers: { cookie: `kloel_session=${token}` }, ...(payload ? { payload } : {}) })
  const agentResponse = await inject('POST', '/api/v1/agents', { name: 'Assistente Baserow', status: 'active' }); assert.equal(agentResponse.statusCode, 201); const agent = agentResponse.json()
  const identity = (await inject('GET', '/api/v1/auth/me')).json(), requests: Array<{ path: string; method: string; body: any; headers: any }> = []
  const state = { current: true, cookie: token, before: undefined as undefined | ((path: string, method: string, body: any) => Promise<Response | void>), after: undefined as undefined | ((path: string, method: string, response: Response) => Promise<Response>) }
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined; assert.ok(path.startsWith('/api/v1/'), 'External browser traffic prohibited'); requests.push({ path, method, body, headers: init.headers })
    const early = await state.before?.(path, method, body); if (early) return early
    const response = await app.inject({ method: method as any, url: path, headers: { ...init.headers as any, cookie: `kloel_session=${state.cookie}` }, ...(init.body ? { payload: String(init.body) } : {}) })
    const result = new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } }); return state.after ? state.after(path, method, result) : result
  }
  const request = createEngineClient(fetcher), context = { tenantId: actor.tenantId, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Changed context') }, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }) }, client = createBaserowService(context)
  const create = async (extra: Partial<BaserowConfiguration> = {}) => { const operation = await client.configure(baserowAttempt('binding.create'), configuration({ agentIds: [agent.id], ...extra })); return client.get(operation.bindingId) }
  const aba = () => { store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(actor.userId); store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(actor.userId) }
  t.after(async () => { await app.close(); store.close(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous })
  return { store, app, actor, token, hash, identity, agent, requests, calls, counters, hooks, transport, state, fetcher, context, client, create, aba }
}
