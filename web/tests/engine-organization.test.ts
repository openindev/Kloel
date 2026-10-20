import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { organizationFixture } from './engine-organization-fixture'
import { organizationClient, organizationFingerprint, organizationRecovery } from '../src/services/engine/organization'
import { EngineError } from '../src/services/engine/http'

test('organization client reads and saves the actual normalized CAS contract without leaking extra stored fields', async t => {
  const f = await organizationFixture(t)
  f.store.update(f.actor.tenantId, 'organization-settings', f.row!.id, { internalSecret: 'fixture-private-secret' })
  const initial = await f.client.get()
  assert.equal(initial.tenantId, f.actor.tenantId); assert.equal(initial.settings.country, 'BR'); assert.match(initial.version, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(initial).includes('fixture-private-secret'), false)
  const saved = await f.client.save(initial, { ...initial.settings, name: '  Empresa atualizada  ', supportEmail: '  SUPORTE@EXAMPLE.TEST  ', website: null, notifications: { newConversation: false, appointmentCreated: true, usageWarnings: false } })
  assert.equal(saved.settings.name, 'Empresa atualizada'); assert.equal(saved.settings.supportEmail, 'suporte@example.test'); assert.notEqual(saved.version, initial.version)
  assert.equal((await f.client.get()).version, saved.version)
  const put = f.requests.find(r => r.method === 'PUT')!; assert.equal(put.body.expectedVersion, initial.version); assert.equal(put.body.tenantId, undefined); assert.equal(put.body.internalSecret, undefined)
})

test('organization client preserves the original CAS revision and rejects a stale save', async t => {
  const f = await organizationFixture(t), original = await f.client.get()
  const other = await f.client.save(original, { ...original.settings, legalName: 'Alteração concorrente' })
  await assert.rejects(f.client.save(original, { ...original.settings, name: 'Rascunho antigo' }), (e: any) => e.status === 409 && e.code === 'organization_settings_conflict')
  const current = await f.client.get(); assert.equal(current.version, other.version); assert.equal(current.settings.name, original.settings.name); assert.equal(current.settings.legalName, 'Alteração concorrente')
  const direct = await f.app.inject({ method: 'PUT', url: '/api/v1/organization-settings', headers: { cookie: `kloel_session=${f.cookieValue}` }, payload: current.settings })
  assert.equal(direct.statusCode, 400)
})

test('organization client resolves lost responses only by GET and distinguishes matching, conflicting and unknown state', async t => {
  const f = await organizationFixture(t), initial = await f.client.get(), desired = { ...initial.settings, name: 'Estado enviado' }
  const attempt = { version: initial.version, fingerprint: await organizationFingerprint(desired) }
  assert.equal(await organizationRecovery(attempt, initial), 'unknown')
  f.state.loseNext = true
  await assert.rejects(f.client.save(initial, desired), (e: any) => e.code === 'network_error')
  const matched = await f.client.get(); assert.equal(await organizationRecovery(attempt, matched), 'corresponds')
  f.store.update(f.actor.tenantId, 'organization-settings', f.row!.id, { name: 'Outra alteração posterior' })
  assert.equal(await organizationRecovery(attempt, await f.client.get()), 'conflict')
  assert.equal(f.requests.filter(r => r.method === 'PUT').length, 1)
})

test('organization settings permissions and session revocation are enforced by Fastify', async t => {
  const f = await organizationFixture(t, { role: 'viewer' }), current = await f.client.get()
  await assert.rejects(f.client.save(current, { ...current.settings, name: 'Não autorizado' }), (e: any) => e.status === 403)
  assert.equal(f.store.get(f.actor.tenantId, 'organization-settings', f.row!.id)!.name, 'Empresa persistida')
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.hash)
  await assert.rejects(f.client.get(), (e: any) => e.status === 401)
})

test('organization client rejects foreign tenant DTOs, malformed state, unsafe URLs and superseded replies', async t => {
  const f = await organizationFixture(t), initial = await f.client.get()
  const raw = (await f.app.inject({ url: '/api/v1/organization-settings', headers: { cookie: `kloel_session=${f.cookieValue}` } })).json()
  const client = (value: unknown) => organizationClient({ ...f.context, request: async () => value as any })
  await assert.rejects(client({ ...raw, tenantId: randomUUID() }).get(), (e: any) => e.code === 'invalid_data')
  await assert.rejects(client({ ...raw, notifications: { newConversation: 'true' } }).get(), (e: any) => e.code === 'invalid_data')
  await assert.rejects(f.client.save(initial, { ...initial.settings, website: 'javascript:alert(1)' }), (e: any) => e.code === 'invalid_data')
  assert.equal(f.requests.some(r => r.method === 'PUT'), false)
  f.state.hold = async (_path, _method, response) => { f.state.current = false; return response }
  await assert.rejects(f.client.get(), (e: any) => e instanceof EngineError && e.code === 'superseded')
})

test('organization client supports the server defaults when no settings entity has been created', async t => {
  const f = await organizationFixture(t, { empty: true }), initial = await f.client.get()
  assert.equal(initial.settings.country, 'BR'); assert.equal(initial.settings.currency, 'BRL'); assert.equal(initial.settings.website, null)
  await f.client.save(initial, { ...initial.settings, name: 'Primeira configuração' })
  assert.equal(f.store.list(f.actor.tenantId, 'organization-settings').length, 1)
})
