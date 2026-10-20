import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { buildApp } from '../../engine/src/app'
import { Store } from '../../engine/src/store'
import { createEngineClient } from '../src/services/engine/http'
import { SessionController } from '../src/services/engine/controller'
import { createInvitationAcceptance } from '../src/services/engine/team'
import type { Identity } from '../src/services/engine/types'

const defer = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
async function fixture(t: any) {
  const store = new Store(':memory:'), app = await buildApp(store, { workers: false })
  const state = { cookie: '', calls: [] as Array<{ path: string; headers: Record<string, string>; method: string }>, before: undefined as undefined | ((path: string) => Promise<void>), after: undefined as undefined | ((path: string, body: any) => Promise<void>) }
  const raw = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await app.inject({ method: method as any, url: '/api/v1' + path, headers: { origin: 'http://127.0.0.1:5173', ...(state.cookie ? { cookie: state.cookie } : {}), ...headers }, ...(body === undefined ? {} : { payload: body }) })
    const cookie = response.cookies.find(item => item.name === 'kloel_session')
    if (cookie) state.cookie = cookie.value ? `kloel_session=${cookie.value}` : ''
    return response
  }
  const client = createEngineClient(async (url, options = {}) => {
    const path = String(url).replace('/api/v1', ''), headers = options.headers as Record<string, string>
    state.calls.push({ path, headers, method: options.method ?? 'GET' })
    await state.before?.(path)
    const response = await raw(options.method ?? 'GET', path, options.body ? JSON.parse(String(options.body)) : undefined, headers)
    await state.after?.(path, response.statusCode === 204 ? null : response.json())
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  })
  const session = new SessionController(client)
  t.after(() => app.close())
  await session.signup('Context A', 'owner-context@example.test', 'isolated-context-password')
  return { store, app, raw, state, client, session, first: session.getSnapshot().data!.identity }
}

test('real handshake binds parallel reads/final identity and create/select to the original verified context', async t => {
  const f = await fixture(t), session = new SessionController(f.client), start = f.state.calls.length
  await session.refresh()
  const reads = f.state.calls.slice(start)
  assert.equal(reads[0].path, '/auth/me'); assert.equal(reads[0].headers['X-Kloel-Expected-User'], undefined)
  for (const read of reads.slice(1)) { assert.equal(read.headers['X-Kloel-Expected-User'], f.first.userId); assert.equal(read.headers['X-Kloel-Expected-Authority'], f.first.context.authorityVersion) }
  const offset = f.state.calls.length
  await session.createOrganization('Context B')
  const writes = f.state.calls.slice(offset).filter(call => call.method === 'POST')
  assert.deepEqual(writes.map(call => call.path), ['/organizations', '/auth/select-organization'])
  for (const write of writes) assert.equal(write.headers['X-Kloel-Expected-Authority'], f.first.context.authorityVersion)
  assert.notEqual(session.getSnapshot().data!.identity.context.authorityVersion, f.first.context.authorityVersion)
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(f.first.userId)
  await session.refresh(); assert.equal(session.getSnapshot().phase, 'organization_required')
  const profile = f.state.calls.filter(call => call.path === '/account/profile').at(-1)!
  assert.equal(profile.headers['X-Kloel-Expected-Tenant'], '-'); assert.equal(profile.headers['X-Kloel-Expected-Membership'], '-')
  await session.logout(); assert.equal(f.state.cookie, '')
})

test('a cookie changed by another tab cannot redirect organization creation, selection or logout', async t => {
  for (const action of ['create', 'select', 'logout'] as const) await t.test(action, async sub => {
    const f = await fixture(sub)
    await f.session.createOrganization('Context B'); const tenantB = f.session.getSnapshot().data!.identity.tenantId!
    await f.session.selectOrganization(f.first.tenantId!)
    const captured = f.session.getSnapshot().data!.identity.context, switched = await f.raw('POST', '/auth/select-organization', { tenantId: tenantB })
    assert.equal(switched.statusCode, 200)
    const start = f.state.calls.length
    await assert.rejects(action === 'create' ? f.session.createOrganization('Must not be created') : action === 'select' ? f.session.selectOrganization(f.first.tenantId!) : f.session.logout(), (error: any) => error.code === 'context_mismatch' && error.status === 409)
    const writes = f.state.calls.slice(start).filter(call => call.method === 'POST')
    assert.equal(writes.length, 1); assert.equal(writes[0].headers['X-Kloel-Expected-Authority'], captured.authorityVersion)
    const identity = await f.raw('GET', '/auth/me'); assert.equal(identity.statusCode, 200); assert.equal(identity.json().tenantId, tenantB)
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM organizations WHERE name='Must not be created'").get()!.n, 0)
    await f.session.refresh()
  })
})

test('queued logout after login is bound to that login proof and cannot log out a foreign cookie arriving before dispatch', async t => {
  const f = await fixture(t), started = defer(), release = defer(); let proof: Identity | undefined
  f.state.after = async (path, body) => { if (path === '/auth/login') { proof = body; started.resolve(); await release.promise } }
  const login = f.session.login('owner-context@example.test', 'isolated-context-password'), rejectedLogin = assert.rejects(login, /sessão mudou/)
  await started.promise
  const logout = f.session.logout(), rejectedLogout = assert.rejects(logout, (error: any) => error.code === 'context_mismatch')
  const foreign = await f.raw('POST', '/auth/signup', { organization: 'Foreign', email: 'foreign-context@example.test', password: 'isolated-foreign-password' }); assert.equal(foreign.statusCode, 201)
  release.resolve(); await Promise.all([rejectedLogin, rejectedLogout])
  const calls = f.state.calls.filter(call => call.path === '/auth/logout'); assert.equal(calls.length, 1)
  assert.equal(calls[0].headers['X-Kloel-Expected-User'], proof!.userId); assert.equal(calls[0].headers['X-Kloel-Expected-Authority'], proof!.context.authorityVersion)
  assert.equal((await f.raw('GET', '/auth/me')).json().userId, foreign.json().userId)
  await f.session.refresh()
})

test('queued logout after actual invitation acceptance uses the returned receipt proof rather than a replacement cookie', async t => {
  const old = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
  t.after(() => { if (old === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = old })
  const f = await fixture(t), invitation = await f.raw('POST', '/invitations', { expectedTenantId: f.first.tenantId, email: 'invited-context@example.test', role: 'member', expiresInHours: 24, idempotencyKey: randomUUID() })
  assert.equal(invitation.statusCode, 201)
  const token = new URL('https://local.invalid' + invitation.json().localAcceptancePath).hash.slice('#token='.length), started = defer(), release = defer()
  let proof: any
  f.state.after = async (path, body) => { if (path === '/auth/accept-invite') { proof = body; started.resolve(); await release.promise } }
  const operation = createInvitationAcceptance(f.client)
  const accepting = f.session.acceptInvitation(() => operation.accept({ token, email: 'invited-context@example.test', password: 'isolated-invited-password' })), rejected = assert.rejects(accepting, /sessão mudou/)
  await started.promise
  const logout = f.session.logout(), rejectedLogout = assert.rejects(logout, (error: any) => error.code === 'context_mismatch')
  const foreign = await f.raw('POST', '/auth/login', { email: 'owner-context@example.test', password: 'isolated-context-password' }); assert.equal(foreign.statusCode, 200)
  release.resolve(); await Promise.all([rejected, rejectedLogout])
  const call = f.state.calls.find(item => item.path === '/auth/logout')!
  assert.equal(call.headers['X-Kloel-Expected-User'], proof.userId); assert.equal(call.headers['X-Kloel-Expected-Authority'], proof.context.authorityVersion)
  assert.notEqual(proof.userId, f.first.userId); assert.equal((await f.raw('GET', '/auth/me')).json().userId, f.first.userId)
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM memberships WHERE user_id=?').get(proof.userId)!.n, 1)
  await f.session.refresh()
})

test('bootstrap does not combine an old handshake with profile data from a replaced cookie', async t => {
  const f = await fixture(t); let switched = false
  f.state.before = async path => { if (path === '/account/profile' && !switched) { switched = true; await f.raw('POST', '/auth/login', { email: 'owner-context@example.test', password: 'isolated-context-password' }) } }
  await f.session.refresh(); assert.equal(f.session.getSnapshot().phase, 'error'); assert.equal(f.session.getSnapshot().data, undefined)
  assert.equal(f.state.calls.filter(call => call.method === 'POST' && call.path === '/auth/login').length, 0)
})

test('real focus revalidation keeps generation for presentation changes and binds every GET to the original context', async t => {
  const f = await fixture(t), before = f.session.getSnapshot(), start = f.state.calls.length
  const settingsResponse = await f.raw('GET', '/organization-settings')
  assert.equal(settingsResponse.statusCode, 200)
  const { id: _settingsId, tenantId: _settingsTenantId, version, ...settings } = settingsResponse.json()
  const renamed = await f.raw('PUT', '/organization-settings', { ...settings, name: 'Renamed without changing authority', expectedVersion: version })
  assert.equal(renamed.statusCode, 200)
  await f.session.revalidateOnFocus()
  const after = f.session.getSnapshot(), calls = f.state.calls.slice(start)
  assert.equal(after.validation, 'ready'); assert.equal(after.generation, before.generation)
  assert.equal(after.data!.identity.organizations[0].name, 'Renamed without changing authority')
  for (const call of calls) { assert.equal(call.method, 'GET'); assert.equal(call.headers['X-Kloel-Expected-Authority'], f.first.context.authorityVersion) }
})

for (const change of ['cookie-rotation', 'role-aba'] as const) test(`real focus discovers ${change} through the opaque context and discards the old tree before hydration`, async t => {
  const f = await fixture(t), before = f.session.getSnapshot(), states: ReturnType<SessionController['getSnapshot']>[] = []
  if (change === 'cookie-rotation') assert.equal((await f.raw('POST', '/auth/login', { email: 'owner-context@example.test', password: 'isolated-context-password' })).statusCode, 200)
  else {
    f.store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND tenant_id=?").run(f.first.userId, f.first.tenantId!)
    f.store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=? AND tenant_id=?").run(f.first.userId, f.first.tenantId!)
  }
  f.session.subscribe(() => states.push(f.session.getSnapshot()))
  const start = f.state.calls.length
  await f.session.revalidateOnFocus()
  const after = f.session.getSnapshot(), calls = f.state.calls.slice(start)
  assert.equal(after.phase, 'authenticated'); assert.equal(after.validation, 'ready'); assert.ok(after.generation > before.generation)
  assert.notEqual(after.data!.identity.context.authorityVersion, f.first.context.authorityVersion)
  assert.ok(states.some(state => state.phase === 'loading' && state.data === undefined))
  assert.equal(calls[0].headers['X-Kloel-Expected-Authority'], f.first.context.authorityVersion)
  assert.ok(calls.every(call => call.method === 'GET'))
})
