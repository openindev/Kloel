import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../../engine/src/app'
import { Store } from '../../engine/src/store'
import { createEngineClient } from '../src/services/engine/http'
import { SessionController } from '../src/services/engine/controller'

test('real Fastify/in-memory contract: signup, reload cookie, organization creation/switch, removal, logout and login', async t => {
  const store = new Store(), app = await buildApp(store, { workers: false }); t.after(() => app.close())
  let cookie = '', requests = 0
  const fetcher: typeof fetch = async (path, options) => {
    requests++
    assert.equal(options?.credentials, 'include'); assert.equal(options?.redirect, 'error')
    const response = await app.inject({ method: options?.method as any ?? 'GET', url: String(path), headers: { ...options?.headers as Record<string, string>, origin: 'http://127.0.0.1:5173', ...(cookie ? { cookie } : {}) }, ...(options?.body ? { payload: String(options.body) } : {}) })
    const received = response.cookies.find(item => item.name === 'kloel_session')
    if (received) cookie = received.value ? `kloel_session=${received.value}` : ''
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  }
  const client = createEngineClient(fetcher), session = new SessionController(client)
  await session.refresh(); assert.equal(session.getSnapshot().phase, 'anonymous')
  await assert.rejects(session.signup('Short password', 'short@example.test', 'eight123'))
  await session.signup('Minha empresa', 'connected@example.test', 'isolated-contract-password')
  const first = session.getSnapshot().data!.identity
  assert.equal(first.role, 'owner'); assert.ok(session.can('agents:write')); assert.ok(cookie)
  assert.equal(session.getSnapshot().data!.settings?.name, 'Minha empresa')
  const reloaded = new SessionController(client); await reloaded.refresh(); assert.equal(reloaded.getSnapshot().data!.identity.userId, first.userId)
  await session.createOrganization('Segunda empresa'); const second = session.getSnapshot().data!.identity
  assert.notEqual(first.tenantId, second.tenantId); assert.equal(second.organizations.length, 2)
  await session.selectOrganization(first.tenantId!); assert.equal(session.getSnapshot().data!.identity.tenantId, first.tenantId)
  store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(first.userId)
  await session.refresh(); assert.equal(session.getSnapshot().phase, 'organization_required'); assert.equal(session.can('agents:write'), false)
  await session.logout(); assert.equal(cookie, ''); assert.equal(session.getSnapshot().phase, 'anonymous')
  await assert.rejects(session.login('connected@example.test', 'wrong-password'), /Credenciais/)
  await session.login('connected@example.test', 'isolated-contract-password'); assert.equal(session.getSnapshot().phase, 'organization_required')
  assert.ok(requests > 20); assert.equal(JSON.stringify(session.getSnapshot()).includes('isolated-contract-password'), false)
})
