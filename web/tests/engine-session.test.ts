import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionController } from '../src/services/engine/controller'
import { createEngineClient, EngineError, safeNext, type EngineRequest } from '../src/services/engine/http'
import type { Identity } from '../src/services/engine/types'

const defer = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const org = (id: string) => ({ id, tenantId: id, name: id, membershipId: `membership-${id}`, role: 'owner' as const, status: 'active' as const, createdAt: '2026-01-01', joinedAt: '2026-01-01' })
const identity = (tenantId: string | null = 'A'): Identity => ({ userId: 'u', email: 'user@example.test', tenantId, role: tenantId ? 'owner' : null, permissions: tenantId ? ['organization:read', 'agents:read'] : [], organizations: [org('A'), org('B')], context: { userId: 'u', tenantId, membershipId: tenantId ? `membership-${tenantId}` : null, authorityVersion: 'a'.repeat(64) } })
const acceptance = (tenantId = 'B') => ({ userId: 'u', tenantId, membershipId: `membership-${tenantId}`, context: identity(tenantId).context })
function harness() {
  let current: Identity | undefined = identity()
  const calls: string[] = []
  let intercept: ((path: string, options: any) => Promise<unknown> | undefined) | undefined
  const request: EngineRequest = async <T,>(path: string, options: any = {}): Promise<T> => {
    calls.push(path)
    const interception = intercept?.(path, options)
    if (interception) return await interception as T
    if (path === '/auth/login' || path === '/auth/signup') current = identity()
    if (path === '/auth/logout') { current = undefined; return { ok: true } as T }
    if (!current) throw new EngineError(401, 'unauthorized', 'Autenticação necessária.')
    if (path === '/auth/select-organization') current = identity(options.body.tenantId)
    if (path === '/auth/me' || path.startsWith('/auth/')) return structuredClone(current) as T
    if (path === '/organizations') return org('C') as T
    if (path === '/account/profile') return { id: current.userId, email: current.email, firstName: 'Ana', lastName: '', language: 'pt-BR', phone: null, revision: 0, profileCreatedAt: null, updatedAt: null } as T
    if (path === '/capabilities') return { role: current.role, permissions: current.permissions, items: [] } as T
    if (path === '/organization-settings') return { name: current.tenantId, timezone: 'America/Sao_Paulo' } as T
    throw new Error(path)
  }
  return { controller: new SessionController(request), request, calls, setIdentity: (value: Identity | undefined) => { current = value }, intercept: (fn: typeof intercept) => { intercept = fn } }
}

test('bootstrap uses server profile, organization and permissions without onboarding/password', async () => {
  const h = harness(); await h.controller.refresh()
  assert.equal(h.controller.getSnapshot().phase, 'authenticated')
  assert.equal(h.controller.getSnapshot().data?.profile.firstName, 'Ana')
  assert.equal(h.controller.can('agents:read'), true); assert.equal(h.controller.can('billing:manage'), false)
  assert.equal(JSON.stringify(h.controller.getSnapshot()).includes('password'), false)
  assert.equal(JSON.stringify(h.controller.getSnapshot()).includes('onboardingCompleted'), false)
})
test('401 is anonymous; offline/403/500 never activate a local identity or fake seed', async () => {
  for (const status of [401, 403, 500, 0]) {
    const h = harness(); h.intercept(async () => { throw new EngineError(status, 'failure', 'Falha') }); await h.controller.refresh()
    assert.equal(h.controller.getSnapshot().phase, status === 401 ? 'anonymous' : 'error'); assert.equal(h.controller.getSnapshot().data, undefined)
  }
})
test('identity without memberships can reach organization creation, without inventing a tenant', async () => {
  const h = harness(); h.setIdentity({ ...identity(null), organizations: [] }); await h.controller.refresh()
  assert.equal(h.controller.getSnapshot().phase, 'organization_required'); assert.equal(h.calls.includes('/capabilities'), false)
  assert.equal(h.controller.can('agents:read'), false)
})
test('slow revalidation cannot resurrect identity after logout even if abort is ignored', async () => {
  const h = harness(), wait = defer<Identity>(); await h.controller.refresh(); let once = true
  h.intercept(path => path === '/auth/me' && once ? (once = false, wait.promise) : undefined)
  const refresh = h.controller.refresh(); await Promise.resolve()
  const logout = h.controller.logout(); assert.equal(h.controller.getSnapshot().data, undefined)
  await logout; wait.resolve(identity()); await refresh
  assert.equal(h.controller.getSnapshot().phase, 'anonymous')
})
test('tenant switch immediately clears authority and rejects an old profile response', async () => {
  const h = harness(); await h.controller.refresh(); const wait = defer<unknown>(); let once = true
  h.intercept(path => path === '/account/profile' && once ? (once = false, wait.promise) : undefined)
  const stale = h.controller.refresh(); await Promise.resolve(); await Promise.resolve()
  const selected = h.controller.selectOrganization('B'); assert.equal(h.controller.can('agents:read'), false); assert.equal(h.controller.getSnapshot().data, undefined)
  await selected; wait.resolve({ id: 'u', firstName: 'Old A' }); await stale
  assert.equal(h.controller.getSnapshot().data?.identity.tenantId, 'B'); assert.equal(h.controller.getSnapshot().data?.profile.firstName, 'Ana')
})
test('cookie mutations serialize: logout follows a pending login, and login cannot publish after logout intent', async () => {
  const h = harness(), wait = defer<unknown>(); h.setIdentity(undefined)
  h.intercept(path => path === '/auth/login' ? wait.promise.then(() => { h.setIdentity(identity()); return identity() }) : undefined)
  const login = h.controller.login('user@example.test', 'not-persisted-password'); const rejected = assert.rejects(login, /sessão mudou/)
  await Promise.resolve(); const logout = h.controller.logout(); await Promise.resolve()
  assert.equal(h.calls.includes('/auth/logout'), false)
  wait.resolve(identity()); await Promise.all([rejected, logout])
  assert.deepEqual(h.calls.slice(0, 2), ['/auth/login', '/auth/logout']); assert.equal(h.controller.getSnapshot().phase, 'anonymous')
})
test('invitation cookie mutations serialize with logout and cannot publish stale authority', async () => {
  const h = harness(), pending = defer<unknown>(); h.setIdentity(undefined)
  const calls: string[] = []
  const accepting = h.controller.acceptInvitation(async () => { calls.push('accept'); await pending.promise; h.setIdentity(identity('B')); return acceptance() })
  const rejected = assert.rejects(accepting, /sessão mudou/)
  await Promise.resolve(); await Promise.resolve()
  const logout = h.controller.logout(); await Promise.resolve()
  assert.deepEqual(calls, ['accept']); assert.equal(h.calls.includes('/auth/logout'), false)
  pending.resolve(undefined); await Promise.all([rejected, logout])
  assert.equal(h.controller.getSnapshot().phase, 'anonymous'); assert.equal(h.controller.getSnapshot().data, undefined)
})
test('invitation success bootstraps the accepted organization; failure never invents authority', async () => {
  const h = harness(); h.setIdentity(undefined)
  await h.controller.acceptInvitation(async () => { h.setIdentity(identity('B')); return acceptance() })
  assert.equal(h.controller.getSnapshot().data?.identity.tenantId, 'B')
  await assert.rejects(h.controller.acceptInvitation(async () => { throw new EngineError(0, 'network_error', 'Resposta perdida') }))
  assert.equal(h.controller.getSnapshot().phase, 'error'); assert.equal(h.controller.getSnapshot().data, undefined)
})
test('failed logout leaves an error requiring revalidation, not a false confirmation', async () => {
  const h = harness(); await h.controller.refresh(); h.intercept(path => path === '/auth/logout' ? Promise.reject(new EngineError(0, 'network_error', 'Resultado desconhecido')) : undefined)
  await assert.rejects(h.controller.logout()); assert.equal(h.controller.getSnapshot().phase, 'error'); assert.equal(h.controller.getSnapshot().data, undefined)
})
test('removed membership during bootstrap is detected by final identity revalidation', async () => {
  const h = harness(); let reads = 0
  h.intercept(path => path === '/auth/me' && ++reads === 2 ? Promise.resolve({ ...identity(null), organizations: [] }) : undefined)
  await h.controller.refresh(); assert.equal(h.controller.getSnapshot().phase, 'error'); assert.equal(h.controller.can('agents:read'), false)
})
test('create organization selects the returned identifier and fails closed if membership is missing', async () => {
  const h = harness(); await h.controller.refresh(); const start = h.calls.length; await assert.rejects(h.controller.createOrganization('Empresa real'), /sessão retornada/)
  assert.deepEqual(h.calls.slice(start, start + 2), ['/organizations', '/auth/select-organization'])
  // The mock directory does not contain C: fail closed instead of inventing a membership.
  assert.equal(h.controller.getSnapshot().phase, 'error')
})
test('verified settings refresh presentation without remounting or granting authority', async () => {
  const h = harness(); await h.controller.refresh()
  const before = h.controller.getSnapshot(), generation = before.generation
  assert.equal(h.controller.reconcileOrganizationSettings('A', generation, { name: 'Empresa atualizada', timezone: 'America/Manaus' }), true)
  const after = h.controller.getSnapshot()
  assert.equal(after.generation, generation); assert.equal(after.data?.identity.organizations[0].name, 'Empresa atualizada')
  assert.deepEqual(after.data?.identity.permissions, before.data?.identity.permissions)
  assert.equal(after.data?.identity.organizations[1].name, 'B')
  assert.equal(h.controller.reconcileOrganizationSettings('B', generation, { name: 'Tenant errado', timezone: 'UTC' }), false)
  assert.equal(h.controller.reconcileOrganizationSettings('A', generation - 1, { name: 'Resposta antiga', timezone: 'UTC' }), false)
  await h.controller.logout()
  assert.equal(h.controller.reconcileOrganizationSettings('A', generation, { name: 'Após logout', timezone: 'UTC' }), false)
  assert.equal(h.controller.getSnapshot().phase, 'anonymous')
})
test('HTTP uses cookie, JSON, CAS and idempotency, without automatic retries or redirects', async () => {
  const calls: any[] = []
  const client = createEngineClient(async (url, init) => { calls.push({ url, init }); return Response.json({ ok: true }) })
  await client('/crm/contacts', { method: 'POST', body: { name: 'Ana' }, query: { limit: 20, q: 'a & b' }, etag: '"2"', idempotencyKey: 'operation-123' })
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/v1/crm/contacts?limit=20&q=a+%26+b')
  assert.equal(calls[0].init.credentials, 'include'); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers['If-Match'], '"2"'); assert.equal(calls[0].init.headers['Idempotency-Key'], 'operation-123')
  for (const path of ['https://evil.test', '//evil.test', '/../admin', '/auth/me#token']) await assert.rejects(client(path))
})
test('HTTP handles 204, provider errors, timeout and malformed HTML without retrying a write', async () => {
  assert.equal(await createEngineClient(async () => new Response(null, { status: 204 }))('/agents/id', { method: 'DELETE' }), undefined)
  await assert.rejects(createEngineClient(async () => Response.json({ error: { code: 'conflict', message: 'Revisão mudou' } }, { status: 409 }))('/agents'), (error: any) => error.status === 409 && error.code === 'conflict')
  await assert.rejects(createEngineClient(async () => new Response('<html>wrong proxy</html>'))('/auth/me'), /resposta inválida/)
  let requests = 0
  const client = createEngineClient((_url, init) => new Promise((_resolve, reject) => { requests++; init!.signal!.addEventListener('abort', () => reject(new Error('timeout'))) }), 10)
  await assert.rejects(client('/auth/login', { method: 'POST', body: {} }), /confirmar a operação/); assert.equal(requests, 1)
})
test('post-login destinations reject external, slash/backslash encoded and control variants', () => {
  for (const bad of ['//evil.test', '/\\evil.test', 'https://evil.test/app', '/app/%2f%2fevil.test', '/app/../login', '/app\n', 'http://[', '/login']) assert.equal(safeNext(bad), '/app')
  assert.equal(safeNext('/app/agents?tab=voice'), '/app/agents?tab=voice')
})

test('bootstrap binds every read after the first handshake and rejects malformed or foreign context', async () => {
  const h = harness(), reads: Array<{ path: string; context: unknown }> = []
  h.intercept((path, options) => { reads.push({ path, context: options.expectedContext }); return undefined })
  await h.controller.refresh(); assert.equal(reads[0].context, undefined)
  for (const read of reads.slice(1)) assert.deepEqual(read.context, identity().context, read.path)
  for (const context of [undefined, { ...identity().context, userId: 'other' }, { ...identity().context, tenantId: 'B' }, { ...identity().context, membershipId: 'other' }, { ...identity().context, authorityVersion: 'bad' }, { ...identity().context, userId: '-' }]) {
    const invalid = harness(); invalid.setIdentity({ ...identity(), context } as Identity); await invalid.controller.refresh()
    assert.equal(invalid.controller.getSnapshot().phase, 'error'); assert.equal(invalid.calls.includes('/account/profile'), false)
  }
})

test('authority ABA during hydration never publishes a mixed identity', async () => {
  const h = harness(); let reads = 0
  h.intercept(path => path === '/auth/me' && ++reads === 2 ? Promise.resolve({ ...identity(), context: { ...identity().context, authorityVersion: 'b'.repeat(64) } }) : undefined)
  await h.controller.refresh(); assert.equal(h.controller.getSnapshot().phase, 'error'); assert.equal(h.controller.getSnapshot().data, undefined)
})

test('cookie commands without a verified intent fail before dispatch; missing acceptance proof cannot authorize queued logout', async () => {
  for (const command of [(h: ReturnType<typeof harness>) => h.controller.logout(), (h: ReturnType<typeof harness>) => h.controller.selectOrganization('B'), (h: ReturnType<typeof harness>) => h.controller.createOrganization('Other')]) {
    const h = harness(); await assert.rejects(command(h), (error: any) => error.code === 'identity_unverified'); assert.equal(h.calls.length, 0)
  }
  const h = harness(), deferred = defer<unknown>(), accepting = h.controller.acceptInvitation(() => deferred.promise), rejected = assert.rejects(accepting)
  const logout = h.controller.logout(), logoutRejected = assert.rejects(logout)
  deferred.resolve({ userId: 'u', tenantId: 'B', membershipId: 'membership-B' })
  await Promise.all([rejected, logoutRejected]); assert.equal(h.calls.length, 0)
})

test('queued logout after acceptance uses only the context returned by that acceptance', async () => {
  const h = harness(), deferred = defer<unknown>(), proof = acceptance('B')
  const accepting = h.controller.acceptInvitation(async () => { await deferred.promise; h.setIdentity(identity('B')); return proof }), rejected = assert.rejects(accepting, /sessão mudou/)
  let sent: unknown
  h.intercept((path, options) => { if (path === '/auth/logout') sent = options.expectedContext; return undefined })
  const logout = h.controller.logout(); deferred.resolve(undefined); await Promise.all([rejected, logout])
  assert.deepEqual(sent, proof.context); assert.equal(h.calls.includes('/auth/me'), false)
})

test('HTTP emits immutable expected context including null sentinels and preserves in-flight ambiguity without retry', async () => {
  const calls: any[] = [], context = { ...identity(null).context }, client = createEngineClient(async (_url, options) => { calls.push(options); return Response.json({ ok: true }) })
  const result = client('/account/profile', { expectedContext: context }); context.userId = 'changed'; await result
  assert.equal(calls[0].headers['X-Kloel-Expected-User'], 'u'); assert.equal(calls[0].headers['X-Kloel-Expected-Tenant'], '-'); assert.equal(calls[0].headers['X-Kloel-Expected-Membership'], '-')
  let writes = 0
  for (const code of ['context_mismatch', 'context_changed_in_flight']) {
    const api = createEngineClient(async () => { writes++; return Response.json({ error: { code, message: 'Context changed' } }, { status: 409 }) })
    await assert.rejects(api('/agents', { method: 'POST', body: {}, expectedContext: identity().context }), (error: any) => error.code === code && error.rawStatus === 409 && error.status === (code === 'context_mismatch' ? 409 : 0))
  }
  assert.equal(writes, 2)
})

test('focus probes coalesce, keep the authority generation and publish presentation only after validation', async () => {
  const h = harness(); await h.controller.refresh()
  const before = h.controller.getSnapshot(), wait = defer<Identity>(), seen: any[] = []; let once = true
  const renamed = { ...identity(), organizations: identity().organizations.map(org => ({ ...org, name: `Renamed ${org.name}` })), permissions: [...identity().permissions].reverse() }
  h.setIdentity(renamed)
  h.intercept((path, options) => { seen.push({ path, options }); return path === '/auth/me' && once ? (once = false, wait.promise) : undefined })
  const first = h.controller.revalidateOnFocus(), second = h.controller.revalidateOnFocus()
  assert.equal(first, second)
  assert.equal(h.controller.getSnapshot().phase, 'authenticated'); assert.equal(h.controller.getSnapshot().validation, 'checking')
  assert.equal(h.controller.getSnapshot().data, before.data); assert.equal(h.controller.can('agents:read'), true)
  assert.equal(h.controller.reconcileOrganizationSettings('A', before.generation, { name: 'Late', timezone: 'UTC' }), false)
  await Promise.resolve(); assert.equal(seen.length, 1)
  for (const read of seen) assert.deepEqual(read.options.expectedContext, identity().context)
  wait.resolve(renamed); await first
  const after = h.controller.getSnapshot()
  assert.equal(after.validation, 'ready'); assert.equal(after.generation, before.generation)
  assert.equal(after.data?.identity.organizations[0].name, 'Renamed A')
  assert.equal(seen.filter(call => call.path === '/auth/me').length, 2)
})

for (const status of [0, 500]) test(`focus failure ${status} retains only blocked memory and an equivalent retry restores its generation`, async () => {
  const h = harness(); await h.controller.refresh(); const prior = h.controller.getSnapshot()
  h.intercept(async () => { throw new EngineError(status, 'unavailable', 'Motor indisponível') })
  await h.controller.revalidateOnFocus()
  const failed = h.controller.getSnapshot()
  assert.equal(failed.phase, 'authenticated'); assert.equal(failed.validation, 'error'); assert.equal(failed.data, prior.data); assert.equal(failed.generation, prior.generation)
  await assert.rejects(h.controller.waitForValidation(prior.generation, prior.data!.identity.context), (error: any) => error.code === 'session_validation_failed' && error.status === 0)
  h.intercept(undefined); await h.controller.revalidateOnFocus()
  assert.equal(h.controller.getSnapshot().validation, 'ready'); assert.equal(h.controller.getSnapshot().generation, prior.generation)
})

test('focus has a total 15-second deadline even when the transport ignores abort, and late output cannot publish', async t => {
  const h = harness(); await h.controller.refresh(); const prior = h.controller.getSnapshot(), wait = defer<Identity>()
  h.intercept(path => path === '/auth/me' ? wait.promise : undefined)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const probe = h.controller.revalidateOnFocus()
  await Promise.resolve(); t.mock.timers.tick(15000); await probe
  assert.equal(h.controller.getSnapshot().validation, 'error'); assert.equal(h.controller.getSnapshot().data, prior.data)
  h.intercept(undefined); await h.controller.revalidateOnFocus()
  const restored = h.controller.getSnapshot()
  wait.resolve(identity('B')); await Promise.resolve(); await Promise.resolve()
  assert.equal(h.controller.getSnapshot(), restored)
})

for (const mutation of ['context', 'membership', 'permissions', 'available-membership'] as const) test(`focus invalidates the tree for a changed ${mutation}`, async () => {
  const h = harness(); await h.controller.refresh(); const prior = h.controller.getSnapshot(), states: any[] = []
  const next = identity()
  if (mutation === 'context') next.context = { ...next.context, authorityVersion: 'b'.repeat(64) }
  if (mutation === 'membership') { next.context = { ...next.context, membershipId: 'replacement' }; next.organizations[0].membershipId = 'replacement' }
  if (mutation === 'permissions') next.permissions = ['organization:read']
  if (mutation === 'available-membership') next.organizations[1].role = 'viewer' as any
  h.setIdentity(next); h.controller.subscribe(() => states.push(h.controller.getSnapshot()))
  await h.controller.revalidateOnFocus()
  const after = h.controller.getSnapshot()
  assert.equal(after.phase, 'authenticated'); assert.equal(after.validation, 'ready'); assert.ok(after.generation > prior.generation)
  assert.ok(states.some(state => state.phase === 'loading' && state.data === undefined))
  await assert.rejects(h.controller.waitForValidation(prior.generation, prior.data!.identity.context), (error: any) => error.code === 'superseded')
})

for (const status of [401, 403]) test(`focus ${status} clears retained data immediately without reopening cached access`, async () => {
  const h = harness(); await h.controller.refresh(); const generation = h.controller.getSnapshot().generation
  h.intercept(async () => { throw new EngineError(status, 'forbidden', 'Acesso revogado') }); await h.controller.revalidateOnFocus()
  const state = h.controller.getSnapshot()
  assert.equal(state.phase, status === 401 ? 'anonymous' : 'error'); assert.equal(state.data, undefined); assert.ok(state.generation > generation)
})

test('focus during cookie commands waits for that command and never begins another hydration or supersedes intent', async () => {
  const h = harness(), pending = defer<unknown>(); h.setIdentity(undefined)
  h.intercept(path => path === '/auth/login' ? pending.promise.then(() => { h.setIdentity(identity()); return identity() }) : undefined)
  const login = h.controller.login('user@example.test', 'password'), generation = h.controller.getSnapshot().generation
  const focus = h.controller.revalidateOnFocus(); await Promise.resolve(); await Promise.resolve()
  assert.equal(h.controller.getSnapshot().generation, generation); assert.equal(h.calls.filter(path => path === '/auth/me').length, 0)
  pending.resolve(undefined); await Promise.all([login, focus])
  assert.equal(h.calls.filter(path => path === '/auth/me').length, 2); assert.equal(h.controller.getSnapshot().phase, 'authenticated')
})

for (const command of ['logout', 'select', 'refresh'] as const) test(`${command} supersedes a focus probe that ignores abort without waiting for its late result`, async () => {
  const h = harness(); await h.controller.refresh(); const wait = defer<Identity>(); let once = true
  h.intercept(path => path === '/auth/me' && once ? (once = false, wait.promise) : undefined)
  const probe = h.controller.revalidateOnFocus(); await Promise.resolve()
  await (command === 'logout' ? h.controller.logout() : command === 'select' ? h.controller.selectOrganization('B') : h.controller.refresh())
  await probe; const stable = h.controller.getSnapshot()
  wait.resolve(identity()); await Promise.resolve(); await Promise.resolve()
  assert.equal(h.controller.getSnapshot(), stable)
  assert.equal(stable.phase, command === 'logout' ? 'anonymous' : 'authenticated')
})

test('validation wait is cancellable and refuses a different binding without dispatching any request', async () => {
  const h = harness(); await h.controller.refresh(); const state = h.controller.getSnapshot(), wait = defer<Identity>(); let once = true
  h.intercept(path => path === '/auth/me' && once ? (once = false, wait.promise) : undefined)
  const probe = h.controller.revalidateOnFocus(), abort = new AbortController()
  const blocked = h.controller.waitForValidation(state.generation, state.data!.identity.context, abort.signal), rejected = assert.rejects(blocked, (error: any) => error.code === 'superseded')
  abort.abort(); await rejected
  await assert.rejects(h.controller.waitForValidation(state.generation, identity('B').context), (error: any) => error.code === 'superseded')
  wait.resolve(identity()); await probe
})
