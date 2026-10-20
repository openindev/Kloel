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
import { createAirtableService, airtableAttempt, type AirtableConfiguration } from '../src/services/engine/airtable'

export const baseId = 'app00000000000001', tableId = 'tbl00000000000001', fieldId = 'fld00000000000001', numberId = 'fld00000000000002', checkboxId = 'fld00000000000003', selectId = 'fld00000000000004', dateId = 'fld00000000000005', computedId = 'fld00000000000006', recordId = 'rec00000000000001', syntheticPAT = 'synthetic-airtable-secret-only'
export const fields = [{ id: fieldId, name: 'Nome', type: 'singleLineText' }, { id: numberId, name: 'Quantidade', type: 'number' }, { id: checkboxId, name: 'Ativo', type: 'checkbox' }, { id: selectId, name: 'Categoria', type: 'singleSelect', options: { choices: [{ id: 'selA', name: 'A' }, { id: 'selB', name: 'B' }] } }, { id: dateId, name: 'Data', type: 'date' }, { id: computedId, name: 'Total calculado', type: 'formula' }]
export const configuration = (extra: Partial<AirtableConfiguration> = {}): AirtableConfiguration => ({ name: 'Tabela sintética', baseId, tableId, fieldIds: fields.map(f => f.id), token: syntheticPAT, allowedRoles: ['owner', 'admin'], agentIds: [], enabled: true, allowCreate: true, ...extra })
export async function airtableFixture(t: any) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 27).toString('base64')
  const store = new Store(':memory:'), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }; seedMember(store, actor)
  const token = randomUUID(), hash = createHash('sha256').update(token).digest('hex'); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, actor.userId, actor.tenantId, Date.now() + 3600000)
  const calls: Array<{ method: string; url: URL; body?: any }> = []
  const hooks: { dns?: () => void; provider?: NonNullable<IntegrationTransport['request']> } = {}
  const transport: IntegrationTransport = { resolve: async () => { hooks.dns?.(); return [{ address: '93.184.216.34', family: 4 }] }, request: async (...args) => {
    const [url, , spec] = args; assert.equal(url.origin, 'https://api.airtable.com'); assert.equal(spec.headers.authorization, `Bearer ${syntheticPAT}`)
    const body = spec.body ? JSON.parse(spec.body.toString()) : undefined; calls.push({ method: spec.method, url, body })
    if (hooks.provider) return hooks.provider(...args)
    const payload = url.pathname.includes('/meta/') ? { tables: [{ id: tableId, fields }] } : { records: [{ id: recordId, createdTime: '2026-10-18T12:00:00Z', fields: spec.method === 'POST' ? body.records[0].fields : { [fieldId]: '<img src=x onerror=alert(1)>', [numberId]: 0, [checkboxId]: false } }], ...(spec.method === 'GET' && !url.searchParams.has('offset') ? { offset: 'opaque-provider-offset' } : {}) }
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(payload)) }
  } }
  const app = Fastify({ logger: false }); await app.register(cookie)
  app.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? error.status ?? 500).send({ error: { code: error.code ?? 'fixture_error', message: error.message } }))
  await registerAuth(app, store); await registerAccountProfile(app, store); await registerDomains(app, store); await registerIntegrations(app, store, transport)
  const inject = (method: any, url: string, payload?: any) => app.inject({ method, url, headers: { cookie: `kloel_session=${token}` }, ...(payload ? { payload } : {}) })
  const agentResponse = await inject('POST', '/api/v1/agents', { name: 'Assistente Airtable', status: 'active' }); assert.equal(agentResponse.statusCode, 201); const agent = agentResponse.json()
  const identity = (await inject('GET', '/api/v1/auth/me')).json(), requests: Array<{ path: string; method: string; body: any; headers: any }> = []
  const state = { current: true, before: undefined as undefined | ((path: string, method: string, body: any) => Promise<Response | void>), after: undefined as undefined | ((path: string, method: string, response: Response) => Promise<Response>) }
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined; assert.ok(path.startsWith('/api/v1/'), 'External browser traffic prohibited'); requests.push({ path, method, body, headers: init.headers })
    const early = await state.before?.(path, method, body); if (early) return early
    const response = await app.inject({ method: method as any, url: path, headers: { ...init.headers as any, cookie: `kloel_session=${token}` }, ...(init.body ? { payload: String(init.body) } : {}) })
    const result = new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } }); return state.after ? state.after(path, method, result) : result
  }
  const request = createEngineClient(fetcher), context = { tenantId: actor.tenantId, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Changed') }, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }) }, client = createAirtableService(context)
  const create = async (extra = {}) => { const op = await client.configure(airtableAttempt('binding.create'), configuration({ agentIds: [agent.id], ...extra })); return client.get(op.bindingId) }
  const aba = () => { store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(actor.userId); store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(actor.userId) }
  t.after(async () => { await app.close(); store.close(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous })
  return { store, app, actor, token, hash, identity, agent, requests, calls, hooks, transport, state, fetcher, context, client, create, aba }
}
