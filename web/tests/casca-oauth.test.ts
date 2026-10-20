import test from 'node:test'
import assert from 'node:assert/strict'
import { connectAccount, capabilitiesFor, type OAuthEnvironment } from '../src/services/casca/oauth'
import type { EngineContext } from '../src/services/engine/session'

const row = { id: '11111111-1111-4111-8111-111111111111', provider: 'google', email: 'account@kloel.test',
  displayName: 'Conta', visibility: 'shared', status: 'connected', capabilities: ['calendar', 'calendar_write'],
  authorizationGeneration: 3, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T12:00:00Z' }
const options = { scope: 'shared' as const, features: ['calendar' as const] }

function fixture(pages: unknown[][], url = 'https://accounts.google.com/o/oauth2/v2/auth?state=test') {
  let closed = false, clock = 0, current = true, listIndex = 0
  const calls: { path: string; options: unknown }[] = [], navigations: string[] = []
  const environment: OAuthEnvironment = {
    open: () => ({ get closed() { return closed }, close() { closed = true }, navigate(value) { navigations.push(value) } }),
    now: () => clock, wait: async ms => { clock += ms },
  }
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() { if (!current) throw new Error('superseded') },
    async request(path: string, options: unknown) {
      calls.push({ path, options })
      if (path === '/oauth/connections') return { items: pages[Math.min(listIndex++, pages.length - 1)] }
      return { authorizationUrl: url }
    },
  } as EngineContext
  return { context, environment, calls, navigations, close: () => { closed = true }, expire: () => { current = false }, closed: () => closed }
}

test('OAuth selects only the features and visibility chosen in the existing shell dialog', async () => {
  const f = fixture([[], [row]])
  const result = await connectAccount(f.context, 'user', 'google', options, undefined, f.environment)
  assert.deepEqual(f.calls[1], { path: '/oauth/google/start', options: { method: 'POST', body: { visibility: 'shared', capabilities: ['calendar', 'calendar_write'] } } })
  assert.equal(result.id, row.id)
  assert.equal(result.orgId, 'tenant')
  assert.equal(result.email, row.email)
  assert.equal(result.connectedAt, row.createdAt)
  assert.deepEqual(result.features, ['calendar'])
  assert.equal(f.closed(), true)
})

test('an existing unchanged connection does not count as a new authorization', async () => {
  const f = fixture([[row], [row]])
  f.environment.wait = async () => f.close()
  await assert.rejects(connectAccount(f.context, 'user', 'google', options, undefined, f.environment), /não foi concluída/)
  assert.equal(f.calls.filter(c => c.path.endsWith('/start')).length, 1)
})

test('reauthorization is confirmed by changed server authorization generation', async () => {
  const f = fixture([[row], [{ ...row, authorizationGeneration: 4 }]])
  assert.equal((await connectAccount(f.context, 'user', 'google', options, undefined, f.environment)).id, row.id)
})

test('missing requested capability cannot complete OAuth', async () => {
  const f = fixture([[], [{ ...row, capabilities: ['calendar'] }]])
  f.environment.wait = async () => f.close()
  await assert.rejects(connectAccount(f.context, 'user', 'google', options, undefined, f.environment), /não foi concluída/)
})

test('a changed session closes the owned window and cannot publish a connected account', async () => {
  const f = fixture([[], [row]])
  f.environment.wait = async () => f.expire()
  await assert.rejects(connectAccount(f.context, 'user', 'google', options, undefined, f.environment), /superseded/)
  assert.equal(f.closed(), true)
  assert.equal(f.calls.length, 2)
})

test('invalid authorization destination is never opened', async () => {
  const f = fixture([[]], 'https://untrusted.invalid/oauth')
  await assert.rejects(connectAccount(f.context, 'user', 'google', options, undefined, f.environment), /não reconhecido/)
  assert.deepEqual(f.navigations, [])
  assert.equal(f.closed(), true)
})

test('ambiguous changes are not attributed to the current popup', async () => {
  const f = fixture([[], [row, { ...row, id: '22222222-2222-4222-8222-222222222222' }]])
  await assert.rejects(connectAccount(f.context, 'user', 'google', options, undefined, f.environment), /Mais de uma conta mudou/)
})

test('blocked popup creates no authorization request', async () => {
  const f = fixture([[]]); f.environment.open = () => null
  await assert.rejects(connectAccount(f.context, 'user', 'google', options, undefined, f.environment), /Permita/)
  assert.equal(f.calls.length, 0)
  assert.deepEqual(capabilitiesFor({ scope: 'personal', features: ['email'] }), ['email', 'email_send'])
})
