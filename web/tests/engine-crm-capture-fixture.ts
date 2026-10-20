import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerDomains } from '../../engine/src/domains'
import { registerCRM } from '../../engine/src/crm'
import { registerCRMCapture } from '../../engine/src/crm-capture'
import { CRMCaptureWorker } from '../../engine/src/crm/capture/worker'
import { recordCaptureIngress } from '../../engine/src/crm/capture/source-events'
import { registerWebchatChannels } from '../../engine/src/webchat-channels'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { getSettings, saveSettings, transaction } from '../../engine/src/crm/service'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { createCRMCaptureService, newCapturePolicy } from '../src/services/engine/crm-capture'

export async function captureFixture(t: any, configured = true, creationGateSatisfied = true) {
  const store = new Store(), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }; seedMember(store, actor)
  const envNames = ['PROVIDER_TENANT_ID', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OAUTH_ENCRYPTION_KEY', 'PUBLIC_BASE_URL'], previous = Object.fromEntries(envNames.map(k => [k, process.env[k]]))
  Object.assign(process.env, { PROVIDER_TENANT_ID: actor.tenantId, OPENAI_API_KEY: 'synthetic-never-external', OPENAI_MODEL: 'synthetic', OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64'), PUBLIC_BASE_URL: 'https://engine.example.test' })
  const token = randomUUID(), hash = createHash('sha256').update(token).digest('hex'); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, actor.userId, actor.tenantId, Date.now() + 600000)
  let now = Date.now(), modelCalls = 0
  const worker = new CRMCaptureWorker(store, { now: () => now, fetch: (async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); modelCalls++
    const body = JSON.parse(String(init?.body)), source = JSON.parse(body.input).sources.at(-1), evidence = (value: string) => [{ sourceEventId: source.id, quote: value, start: source.text.indexOf(value), end: source.text.indexOf(value) + value.length }]
    const extraction = { candidate: 'person', subject: 'current_participant', gate: { satisfied: creationGateSatisfied, evidence: evidence('Ana Silva') }, values: [{ fieldId: 'firstName', value: 'Ana', evidence: evidence('Ana') }, { fieldId: 'lastName', value: 'Silva', evidence: evidence('Silva') }], identityClaims: [{ kind: 'email', value: 'ana@example.test', evidence: evidence('ana@example.test') }, { kind: 'phone', value: '+5511999990000', evidence: evidence('+5511999990000') }] }
    return Response.json({ id: 'synthetic-response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(extraction) }] }], usage: { input_tokens: 70, output_tokens: 60 } })
  }) as typeof fetch })
  const app = Fastify({ logger: false }); await app.register(cookie)
  app.setErrorHandler((error: any, _request: any, reply: any) => reply.code(error.statusCode ?? error.status ?? 500).send({ error: { code: error.code ?? 'internal_error', message: error.message } }))
  await registerAuth(app, store); await registerAccountProfile(app, store); await registerDomains(app, store); await registerCRM(app, store); await registerWebchatChannels(app, store); await registerCRMCapture(app, store, worker)
  if (configured) saveSettings(store, actor.tenantId, { autoCapture: true, creationGate: '', definitions: [] }, 0, actor.userId)
  const inject = (method: any, url: string, payload?: any) => app.inject({ method, url, headers: { cookie: `kloel_session=${token}` }, ...(payload ? { payload } : {}) })
  const agentResult = await inject('POST', '/api/v1/agents', { name: 'Review assistant', status: 'active' }); assert.equal(agentResult.statusCode, 201, agentResult.body); const agent = agentResult.json()
  const channelResult = await inject('POST', '/api/v1/webchat/channels', { expectedTenantId: actor.tenantId, agentId: agent.id, name: 'Review website', configuration: { allowedOrigins: ['https://site.example.test'], greeting: '' }, idempotencyKey: randomUUID() }); assert.equal(channelResult.statusCode, 201, channelResult.body)
  const disabledChannel = channelResult.json().channel, enabled = await inject('POST', `/api/v1/webchat/channels/${disabledChannel.id}/enable`, { expectedTenantId: actor.tenantId, expectedVersion: disabledChannel.version, idempotencyKey: randomUUID() }); assert.equal(enabled.statusCode, 200, enabled.body); const channel = enabled.json().channel
  const identity = (await inject('GET', '/api/v1/auth/me')).json(), requests: Array<{ path: string; method: string; body: any; headers: any }> = []
  const state = { current: true, before: undefined as undefined | ((path: string, method: string, body: any) => Promise<Response | void>), after: undefined as undefined | ((path: string, method: string, response: Response) => Promise<Response>) }
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined; assert.ok(path.startsWith('/api/v1/'), 'UI transport cannot contact external providers'); requests.push({ path, method, body, headers: init.headers })
    const early = await state.before?.(path, method, body); if (early) return early
    const result = await app.inject({ method: method as any, url: path, headers: { ...init.headers as any, cookie: `kloel_session=${token}` }, ...(init.body ? { payload: String(init.body) } : {}) })
    const response = new Response(result.statusCode === 204 ? null : result.body, { status: result.statusCode, headers: { 'Content-Type': 'application/json' } }); return state.after ? state.after(path, method, response) : response
  }
  const request = createEngineClient(fetcher), context = { tenantId: actor.tenantId, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Changed session') }, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }) }, client = createCRMCaptureService(context)
  const policy = () => ({ ...newCapturePolicy(), captureContacts: true, channelIds: [channel.id] })
  async function activate() { const old = await client.policy(); return client.write({ key: randomUUID(), kind: 'grant.create', settingsRevision: old.settingsRevision, previousGrantId: old.grant?.id ?? null, previousRevision: old.grant?.revision ?? null }, policy()) }
  async function propose() {
    const current = await client.policy(); if (!current.grant?.effective) await activate()
    now = Date.now() + 5000
    const conversation = store.create(actor.tenantId, 'conversations', { channel: 'webchat', channelId: channel.id, agentId: agent.id, status: 'open' })
    transaction(store, () => { const message = store.create(actor.tenantId, 'messages', { conversationId: conversation.id, role: 'user', content: 'Meu nome é Ana Silva. Meu email é ana@example.test e meu telefone +5511999990000.' }); recordCaptureIngress(store, { tenantId: actor.tenantId, channelId: channel.id, agentId: agent.id, conversationId: conversation.id, messageId: message.id, kind: 'public_chat_visitor_message', receiptId: randomUUID(), occurredAt: now }, () => {}, now) })
    const job = store.list(actor.tenantId, 'crm-capture-jobs').at(-1)!; assert.ok(job); await worker.generate(actor.tenantId, job.id)
    const proposal = store.list(actor.tenantId, 'crm-capture-proposals').at(-1)!; assert.ok(proposal); return client.proposal(proposal.id)
  }
  t.after(async () => { await app.close(); store.close(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
  return { store, app, actor, token, hash, channel, agent, identity, requests, state, fetcher, context, client, policy, activate, propose, settings: () => getSettings(store, actor.tenantId), modelCalls: () => modelCalls }
}
