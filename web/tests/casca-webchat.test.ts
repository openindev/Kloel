import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Store } from '../../engine/src/store'
import { buildApp } from '../../engine/src/app'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createWebchatActions, hydrateWebchat, unsupportedWebchat, webchatAvailabilityMessage, createWebchatJournal } from '../src/services/casca/webchat'
import { webchatOf, widgetActive, validateOrigin } from '../src/app/pages/whatsapp/webchat/model'
import { EngineError } from '../src/services/engine/http'
import type { EngineContext } from '../src/services/engine/session'
import type { Agent } from '../src/domain/types'

const memory = () => { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } } }
async function fixture(t: any, active = true) {
  const tenantId = 'webchat-test', env = { PROVIDER_TENANT_ID: tenantId, OPENAI_API_KEY: 'synthetic-test-key', OPENAI_MODEL: 'synthetic-test-model', APP_ORIGIN: 'http://127.0.0.1:3004', PUBLIC_BASE_URL: 'http://127.0.0.1:3004' }, old = { ...process.env }
  Object.assign(process.env, env)
  const store = new Store(':memory:'), userId = 'webchat-owner', cookie = 'synthetic-session'
  seedMember(store, { tenantId, userId, role: 'owner' })
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(cookie).digest('hex'), userId, tenantId, Date.now() + 3600000)
  const agent = store.create(tenantId, 'agents', { name: 'Atendimento', status: active ? 'active' : 'draft', prompt: 'Test only', initialMessage: 'Olá', language: 'pt-BR', voice: 'marin', tools: [], settings: {}, rules: [] })
  const app = await buildApp(store, { workers: false }); await app.ready()
  t.after(async () => { await app.close(); for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k] } })
  const identityResponse = await app.inject({ url: '/api/v1/auth/me', headers: { cookie: `kloel_session=${cookie}` } }); assert.equal(identityResponse.statusCode, 200)
  const expected = identityResponse.json().context, calls: { path: string; method: string }[] = []
  const context: EngineContext = { tenantId, generation: 1, assertCurrent() {}, async request(path, options) {
    const method = options?.method ?? 'GET'; calls.push({ path, method })
    const query = new URLSearchParams(Object.entries(options?.query ?? {}).filter(([,v]) => v !== undefined).map(([k,v]) => [k, String(v)]))
    const response = await app.inject({ method: method as any, url: '/api/v1' + path + (query.size ? '?' + query : ''), headers: { cookie: `kloel_session=${cookie}`, 'x-kloel-expected-user': expected.userId, 'x-kloel-expected-tenant': tenantId, 'x-kloel-expected-membership': expected.membershipId, 'x-kloel-expected-authority': expected.authorityVersion }, ...(options?.body === undefined ? {} : { payload: options.body as any }) })
    const body = response.json(); if (response.statusCode >= 400) throw new EngineError(response.statusCode, body.error.code, body.error.message)
    return body
  } }
  const input = { name: agent.name as string, allowedSites: ['http://localhost:4555', 'https://customer.example.test'], greeting: 'Saudação privada do teste' }
  return { store, app, context, expected, agent, input, calls, writes: () => calls.filter(c => c.method !== 'GET') }
}

test('existing widget controls create/update/enable/disable through real CAS endpoints and expose only the authoritative script', async t => {
  const f = await fixture(t), storage = memory(), actions = createWebchatActions(f.context, f.expected, storage, f.agent.id)
  assert.equal(await actions.load(), null)
  const created = await actions.saveWidget(null, f.input); assert.equal(created.channel.readiness.available, true); assert.equal(created.channel.enabled, true)
  assert.equal(f.store.list(f.context.tenantId, 'channels').length, 1)
  assert.match(created.channel.installation!.snippet, /^<script src="http:\/\/127\.0\.0\.1:3004\/widget\/kloel\.js"/)
  assert.ok(created.channel.installation!.snippet.includes(`data-kloel-channel="${created.channel.id}"`))
  const script = await f.app.inject({ url: '/widget/kloel.js' }); assert.equal(script.statusCode, 200); assert.match(script.headers['content-type']!, /javascript/)
  const updated = await actions.saveWidget(created.channel, { ...f.input, greeting: 'Atualizada' }); assert.equal(updated.channel.configuration.greeting, 'Atualizada')
  const removed = await actions.removeWidget(updated.channel); assert.equal(removed.channel.enabled, false); assert.deepEqual(removed.channel.configuration.allowedOrigins, [])
  assert.deepEqual(f.writes().map(c => c.method + ':' + c.path.replaceAll(created.channel.id, ':id')), ['POST:/webchat/channels','POST:/webchat/channels/:id/enable','PATCH:/webchat/channels/:id','POST:/webchat/channels/:id/disable','PATCH:/webchat/channels/:id'])
  assert.equal(storage.data.size, 0)
})

test('lost create recovers the original receipt before validating changed input and never repeats create or enables on recovery', async t => {
  const f = await fixture(t), storage = memory(), original = f.context.request
  let lose = true
  f.context.request = async (path, options) => { const result = await original(path, options); if (path === '/webchat/channels' && options?.method === 'POST' && lose) { lose = false; throw Error('response lost') }; return result }
  await assert.rejects(createWebchatActions(f.context, f.expected, storage, f.agent.id).saveWidget(null, f.input), /response lost/)
  const journal = [...storage.data.values()].join(''); assert.ok(!journal.includes('Saudação') && !journal.includes('https://') && !journal.includes('synthetic-test-key'))
  const actions = createWebchatActions(f.context, f.expected, storage, f.agent.id)
  const recovered = await actions.saveWidget(null, { name: '', allowedSites: ['invalid'], greeting: '' })
  assert.equal(recovered.recovered, true); assert.equal(recovered.channel.enabled, false); assert.equal(f.writes().length, 1)
  const enabled = await actions.saveWidget(recovered.channel, f.input); assert.equal(enabled.channel.readiness.available, true)
  assert.equal(f.writes().filter(c => c.path === '/webchat/channels').length, 1)
})

test('unknown create stays blocked across reload and corrupted/unwritable journal stops before mutation', async t => {
  const f = await fixture(t), storage = memory(), original = f.context.request
  let posts = 0
  f.context.request = async (path, options) => { if (options?.method === 'POST') { posts++; throw Error('lost before delivery') }; return original(path, options) }
  const actions = () => createWebchatActions(f.context, f.expected, storage, f.agent.id)
  await assert.rejects(actions().saveWidget(null, f.input)); await assert.rejects(actions().load()); await assert.rejects(actions().saveWidget(null, f.input)); assert.equal(posts, 1)
  const broken = { getItem() { return null }, setItem() {}, removeItem() {} }
  await assert.rejects(createWebchatActions(f.context, f.expected, broken, f.agent.id).saveWidget(null, f.input), /referência/); assert.equal(posts, 1)
  storage.data.set([...storage.data.keys()][0], '{')
  await assert.rejects(actions().saveWidget(null, f.input), /referência/); assert.equal(posts, 1)
})

test('CAS conflict refuses stale edits and refresh is GET-only; a context change preserves the pending reference', async t => {
  const f = await fixture(t), storage = memory(), actions = createWebchatActions(f.context, f.expected, storage, f.agent.id)
  const first = (await actions.saveWidget(null, f.input)).channel
  await actions.saveWidget(first, { ...f.input, greeting: 'Mais nova' })
  await assert.rejects(actions.saveWidget(first, { ...f.input, greeting: 'Antiga' }), /mudou/); assert.equal(storage.data.size, 0)
  const before = f.writes().length, current = await actions.load(); assert.equal(current!.configuration.greeting, 'Mais nova'); assert.equal(f.writes().length, before)
  let currentContext = true; const original = f.context.request
  f.context.assertCurrent = () => { if (!currentContext) throw Error('context changed') }
  f.context.request = async (path, options) => { const result = await original(path, options); if (options?.method === 'PATCH') currentContext = false; return result }
  await assert.rejects(actions.saveWidget(current, { ...f.input, greeting: 'Mudança de sessão' }), /context changed/); assert.equal(storage.data.size, 1)
})

test('inactive or unbound configuration can be saved without claiming active or granting an agent activation', async t => {
  const f = await fixture(t, false), actions = createWebchatActions(f.context, f.expected, memory(), f.agent.id)
  const result = await actions.saveWidget(null, f.input)
  assert.equal(result.channel.enabled, false); assert.equal(result.channel.readiness.available, false); assert.match(webchatAvailabilityMessage(result.channel), /assistente precisa estar ativo/)
  assert.equal(f.store.get(f.context.tenantId, 'agents', f.agent.id)!.status, 'draft'); assert.equal(f.writes().length, 1)
})

test('catalog hydration is one paginated read and never picks an arbitrary channel when more than one belongs to the agent', async t => {
  const f = await fixture(t), actions = createWebchatActions(f.context, f.expected, memory(), f.agent.id)
  const channel = (await actions.saveWidget(null, f.input)).channel
  const agent = { id: f.agent.id, orgId: f.context.tenantId, name: 'Atendimento', type: 'chat' } as Agent
  const start = f.calls.length, [projected] = await hydrateWebchat(f.context, [agent, { ...agent, id: 'other' }]); assert.equal(f.calls.length - start, 1)
  assert.equal(projected.engineWebchat!.channels[0].id, channel.id); assert.equal(widgetActive(webchatOf(projected)), true)
  f.store.create(f.context.tenantId, 'channels', { type: 'webchat', provider: 'openai', enabled: false, agentId: f.agent.id, name: 'Segundo', configuration: { allowedOrigins: [], greeting: '' } })
  await assert.rejects(actions.load(), /mais de um canal/)
  const [ambiguous] = await hydrateWebchat(f.context, [agent]); assert.equal(widgetActive(webchatOf(ambiguous)), false)
})

test('editorial legacy flags never claim a published hosted link/widget and unsupported publication cannot write', () => {
  const old = { id: 'agent', name: 'Nome', webchatSetup: { allowedSites: ['https://example.test'], hostedEnabled: true, assistantSlug: 'active', widgetId: 'fake', engineAvailable: true } } as Agent
  const projected = webchatOf(old); assert.equal(widgetActive(projected), false); assert.equal(projected.hostedEnabled, false); assert.deepEqual(projected.allowedSites, [])
  assert.throws(() => unsupportedWebchat('hosted'), /ainda não está disponível/); assert.throws(() => unsupportedWebchat('customize'), /ainda não está disponível/)
  assert.equal(validateOrigin('http://127.0.0.1:3004', []), undefined); assert.ok(validateOrigin('http://example.test', [])); assert.ok(validateOrigin('https://name:password@example.test', [])); assert.ok(validateOrigin('https://example.test', ['https://EXAMPLE.test:443']))
})

test('journal is bound to user/tenant/membership/authority and cannot discard an unresolved prior authority', () => {
  const storage = memory(), expected = { userId: 'owner', tenantId: 'tenant', membershipId: 'membership', authorityVersion: 'a'.repeat(64) }
  const journal = createWebchatJournal(storage, expected, 'agent'); journal.reserve({ key: crypto.randomUUID(), kind: 'create' }, () => {})
  assert.throws(() => createWebchatJournal(storage, { ...expected, authorityVersion: 'b'.repeat(64) }, 'agent').read(), /referência/); assert.equal(storage.data.size, 1)
})
