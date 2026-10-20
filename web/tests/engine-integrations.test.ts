import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerIntegrations } from '../../engine/src/integrations'
import { seedMember } from '../../engine/tests/fixtures/membership'
import type { IntegrationTransport } from '../../engine/src/integrations/transport'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { createIntegrationAttempt, createIntegrationService, integrationConfiguration, parseIntegrationAction, parseIntegrationOperation, type IntegrationConfiguration } from '../src/services/engine/integrations'

const input = (extra: Partial<IntegrationConfiguration> = {}): IntegrationConfiguration => ({
  name: 'Fixture n8n', description: 'Only mocked transport', template: 'n8n', method: 'POST', url: 'https://workflow.example.com/webhook/fixture-secret-path?token=fixture-url-token', headers: { Authorization: 'Bearer fixture-header-secret' },
  argumentsSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }, bodyTemplate: { customer: { $arg: '/name' } }, responsePaths: { result: '/result' }, signingSecret: 'fixture-hmac-secret-value', timeoutMs: 1000, allowedRoles: ['owner', 'admin'], agentIds: [], enabled: true, ...extra,
})
async function fixture(t: any, transport?: IntegrationTransport) {
  const before = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  const store = new Store(), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }, token = randomUUID()
  seedMember(store, actor)
  const hash = createHash('sha256').update(token).digest('hex')
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, actor.userId, actor.tenantId, Date.now() + 60000)
  const app = Fastify(); await app.register(cookie); await registerAuth(app, store)
  let sends = 0
  await registerIntegrations(app, store, transport ?? { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => { sends++; return { status: 202, headers: {}, body: Buffer.from(JSON.stringify({ result: { id: 'row', token: 'never expose fixture-header-secret' } })) } } })
  t.after(async () => { await app.close(); store.close(); if (before === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = before })
  const seen: Array<{ path: string; method: string; body: any; key?: string }> = []
  const request = createEngineClient((async (path, options = {}) => {
    assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store')
    assert.equal((options.headers as any).Authorization, undefined)
    seen.push({ path: String(path), method: options.method!, body: options.body ? JSON.parse(String(options.body)) : undefined, key: (options.headers as any)['Idempotency-Key'] })
    const response = await app.inject({ method: options.method as any ?? 'GET', url: String(path), headers: { ...options.headers as Record<string, string>, cookie: `kloel_session=${token}` }, ...(options.body ? { payload: String(options.body) } : {}) })
    return new Response(response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch)
  let current = true
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', 'Changed session') }, request }
  return { store, actor, hash, context, seen, sends: () => sends, invalidate: () => { current = false }, service: createIntegrationService(context) }
}

test('real HTTP contracts configure, replace and disable actions without leaking encrypted credentials or claiming native connection', async t => {
  const f = await fixture(t), registry = await f.service.registry(), capabilities = await f.service.capabilities()
  assert.equal(registry.find(r => r.id === 'n8n')?.configuredActions, 0)
  assert.equal(capabilities.find(r => r.name === 'n8n')?.implementation, 'generic_http_only')
  const calendly = capabilities.find(r => r.name === 'Calendly')
  assert.equal(calendly?.implementation, 'native_partial')
  assert.equal(calendly?.runtime.state, 'not_configured')
  assert.equal(calendly?.runtime.accessibleConnectedAccounts, 0)
  assert.ok(calendly?.capabilities.includes('explicit_event_cancellation'))
  assert.match(calendly!.limits.join(' '), /Cancelamento explícito somente no chat privado, com recibo original e confirmação humana/)
  assert.match(calendly!.limits.join(' '), /Sem reagendamento API, voz, WhatsApp, pagamento ou perguntas avançadas/)
  assert.match(calendly!.limits.join(' '), /conta real ainda não validada/)
  assert.doesNotMatch(calendly!.limits.join(' '), /Sem cancelamento/)
  const action = await f.service.save(input())
  assert.equal(action.status, 'configured_unverified'); assert.equal(action.targetOrigin, 'https://workflow.example.com'); assert.equal(f.sends(), 0)
  assert.equal((await f.service.registry()).find(r => r.id === 'n8n')?.configuredActions, 1)
  assert.equal((await f.service.capabilities()).find(r => r.name === 'n8n')?.runtime.state, 'configured_unverified')
  const replaced = await f.service.save(input({ name: 'Updated', headers: {}, signingSecret: undefined }), action.id)
  assert.equal(replaced.revision, 2); assert.equal(replaced.signed, false); assert.deepEqual(replaced.configuredSecretHeaders, [])
  const disabled = await f.service.enabled(action.id, false); assert.equal(disabled.status, 'disabled')
  await assert.rejects(f.service.execute(action.id, { name: 'A' }, randomUUID()), (e: any) => e.code === 'action_disabled')
  for (const secret of ['fixture-secret-path', 'fixture-url-token', 'fixture-header-secret', 'fixture-hmac-secret-value', 'encryptedConfig']) assert.equal(JSON.stringify([action, replaced, disabled, await f.service.actions()]).includes(secret), false)
  assert.equal(f.seen.find(s => s.method === 'PATCH')?.body.enabled, false)
  assert.equal(f.seen.find(s => s.method === 'POST')?.body.tenantId, undefined)
})

test('explicit attempts preserve immutable arguments/key, replay real receipts once and never expose response data', async t => {
  const f = await fixture(t), action = await f.service.save(input()), args = { name: 'Alice' }
  const attempt = createIntegrationAttempt(f.service, action.id, args, randomUUID()); args.name = 'Changed later'
  const first = await attempt.run(), replay = await attempt.run()
  assert.equal(first.ok, true); assert.equal(first.workflowCompletion, 'not_verified'); assert.equal(first.operation.status, 'endpoint_acknowledged')
  assert.deepEqual(replay, first); assert.equal(f.sends(), 1)
  assert.equal((first as any).data, undefined)
  const requests = f.seen.filter(s => s.path.endsWith('/execute')); assert.equal(requests.length, 2)
  assert.equal(requests[0].key, requests[1].key); assert.equal(requests[0].body.arguments.name, 'Alice')
  assert.equal((await f.service.operations())[0].id, first.operation.id)
  assert.equal((await f.service.actions())[0].status, 'endpoint_acknowledged')
  assert.equal(JSON.stringify(await f.service.operations()).includes('Alice'), false)
  await assert.rejects(f.service.execute(action.id, { name: 'Different' }, attempt.key), (e: any) => e.code === 'idempotency_conflict')
})

test('lost provider outcomes remain uncertain; repeat consultation does not resend and concurrent clicks share one request', async t => {
  let sends = 0, release!: () => void
  const f = await fixture(t, { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => { sends++; await new Promise<void>(resolve => { release = resolve }); throw Error('private transport details') } })
  const action = await f.service.save(input()), attempt = createIntegrationAttempt(f.service, action.id, { name: 'x' }, randomUUID())
  const first = attempt.run(), duplicate = attempt.run(); assert.equal(first, duplicate)
  while (!release) await new Promise(resolve => setImmediate(resolve))
  release(); const uncertain = await first
  assert.equal(uncertain.operation.status, 'uncertain'); assert.equal(uncertain.operation.automaticRetry, false); assert.equal(uncertain.operation.requiresReconciliation, true)
  assert.equal((await attempt.run()).operation.id, uncertain.operation.id); assert.equal(sends, 1)
  assert.equal(JSON.stringify(uncertain).includes('private transport'), false)
})

test('membership, session and tenant revocation remain authoritative for configuration and execution', async t => {
  const f = await fixture(t), action = await f.service.save(input())
  f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(f.actor.userId)
  await assert.rejects(f.service.save(input()), (e: any) => e.status === 403)
  await assert.rejects(f.service.enabled(action.id, false), (e: any) => e.status === 403)
  await assert.rejects(f.service.execute(action.id, { name: 'x' }, randomUUID()), (e: any) => e.status === 403)
  assert.deepEqual(await f.service.actions(), []); assert.equal(f.sends(), 0)
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.hash)
  await assert.rejects(f.service.operations(), (e: any) => e.status === 401)
  f.invalidate(); await assert.rejects(f.service.registry(), (e: any) => e.code === 'superseded')
})

test('DTOs drop unexpected secrets, reject false success and discard results from a replaced organization', async t => {
  const f = await fixture(t), action = await f.service.save(input()), result = await f.service.execute(action.id, { name: 'x' }, randomUUID())
  const raw = { ...action, transport: 'generic_http', nativeConnector: false, workflowCompletion: 'not_verified', encryptedConfig: 'private', url: 'https://private.example.com/secret', headers: { token: 'secret' } }
  assert.equal((parseIntegrationAction(raw) as any).headers, undefined); assert.equal((parseIntegrationOperation({ ...result.operation, arguments: 'private' }) as any).arguments, undefined)
  assert.throws(() => parseIntegrationAction({ ...raw, nativeConnector: true }), EngineError)
  assert.throws(() => parseIntegrationAction({ ...raw, targetOrigin: 'https://example.com/secret' }), EngineError)
  assert.throws(() => parseIntegrationOperation({ ...result.operation, status: 'uncertain', requiresReconciliation: false }), EngineError)
  let valid = true
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() { if (!valid) throw new EngineError(0, 'superseded', 'Changed') }, request: (async () => { valid = false; return { items: [raw] } }) as EngineRequest }
  await assert.rejects(createIntegrationService(context).actions(), (e: any) => e.code === 'superseded')
})

test('invalid input never reaches transport; browser network errors make one request only', async () => {
  for (const draft of [input({ url: 'http://example.com' }), input({ url: 'https://user:password@example.com/' }), input({ headers: [] as any }), input({ method: 'GET', bodyTemplate: {} }), input({ timeoutMs: 50000 }), input({ signingSecret: 'short' })]) assert.throws(() => integrationConfiguration(draft), EngineError)
  let calls = 0
  const service = createIntegrationService({ tenantId: 't', generation: 1, assertCurrent() {}, request: createEngineClient((async () => { calls++; throw Error('lost') }) as typeof fetch) })
  const attempt = createIntegrationAttempt(service, randomUUID(), {}, randomUUID())
  await assert.rejects(attempt.run(), (e: any) => e.code === 'network_error'); assert.equal(calls, 1)
})
