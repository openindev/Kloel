import test from 'node:test'
import assert from 'node:assert/strict'
import { createIdentityService, createIdentityJournal, identityDestination, parseIdentityState, prepareIdentity, type IdentityView } from '../src/services/casca/stripe-identity'
import type { EngineContext } from '../src/services/engine/session'

const id = '11111111-1111-4111-8111-111111111111'
const key = '22222222-2222-4222-8222-222222222222'
const time = '2026-10-19T12:00:00.000Z'
const view = (fields: Partial<IdentityView> = {}): IdentityView => ({ id, state: 'requires_input', mode: 'test', verified: false, canResume: true, requiresReconciliation: false, confirmedAt: time, createdAt: time, updatedAt: time, ...fields })
const op = (fields = {}) => ({ key, kind: 'stripe.identity.create', status: 'succeeded', automaticRetry: false, verification: view(), ...fields })
function fixture(responder: (path: string, options?: any) => Promise<unknown>) {
  const calls: { path: string; options?: any }[] = [], values = new Map<string, string>()
  let current = true
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() { if (!current) throw new Error('context changed') },
    async request(path: string, options?: any) { calls.push({ path, options }); return responder(path, options) },
  } as EngineContext
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  return { api: createIdentityService(context), journal: createIdentityJournal(storage, { tenantId: 'tenant', userId: 'user' }), calls, values, expire() { current = false } }
}

test('test-mode verified status cannot become real identity approval', () => {
  assert.throws(() => parseIdentityState({ configured: true, mode: 'test', verification: view({ state: 'verified', canResume: false, verified: true }) }))
  assert.equal(parseIdentityState({ configured: true, mode: 'test', verification: view({ state: 'verified', canResume: false }) }).verification?.verified, false)
})
test('live approval requires a confirmed timestamp and verified state', () => {
  for (const fields of [{ confirmedAt: null }, { state: 'processing' as const }]) assert.throws(() => parseIdentityState({ configured: true, mode: 'live', verification: view({ mode: 'live', state: 'verified', canResume: false, verified: true, ...fields }) }))
  assert.equal(parseIdentityState({ configured: true, mode: 'live', verification: view({ mode: 'live', state: 'verified', canResume: false, verified: true }) }).verification?.verified, true)
})
test('unavailable configuration can retain history but cannot grant approval or resume', () => {
  assert.equal(parseIdentityState({ configured: false, mode: 'unavailable', verification: view({ canResume: false }) }).verification?.id, id)
  assert.throws(() => parseIdentityState({ configured: false, mode: 'unavailable', verification: view() }))
  assert.throws(() => parseIdentityState({ configured: false, mode: 'unavailable', verification: view({ mode: 'live', state: 'verified', verified: true, canResume: false }) }))
})
test('Identity destinations accept only the hosted Stripe start path', () => {
  assert.equal(identityDestination('https://verify.stripe.com/start/test_token'), 'https://verify.stripe.com/start/test_token')
  for (const url of ['http://verify.stripe.com/start/test', 'https://verify.stripe.com.evil.test/start/test', 'https://evil.test/start/test', 'https://user@verify.stripe.com/start/test', 'https://verify.stripe.com:444/start/test', 'https://verify.stripe.com/', 'https://verify.stripe.com/redirect']) assert.throws(() => identityDestination(url))
})
test('response projections omit provider URLs, client secrets and documents', () => {
  const result = parseIdentityState({ configured: true, mode: 'test', verification: { ...view(), url: 'secret_url', client_secret: 'secret', verified_outputs: { first_name: 'private' } } })
  assert.ok(!JSON.stringify(result).includes('secret') && !JSON.stringify(result).includes('private'))
})
test('journal persists only opaque operation and verification identifiers', () => {
  const f = fixture(async () => assert.fail('no request'))
  f.journal.write({ key, verificationId: id })
  assert.deepEqual(f.journal.read(), { key, verificationId: id })
  assert.throws(() => f.journal.write({ key, verificationId: id, url: 'secret' } as any))
  assert.throws(() => f.journal.write({ key: id }))
  f.journal.clearResolved(key)
  assert.equal(f.values.size, 0)
})
test('lost creation response is recovered only by GET of the original operation', async () => {
  let operationKey = ''
  const f = fixture(async (path, options) => {
    if (path === '/billing/identity') return { configured: true, mode: 'test', verification: null }
    if (path === '/billing/identity/start') { operationKey = options.body.idempotencyKey; throw new Error('connection lost') }
    assert.equal(path, '/billing/identity/operations/' + operationKey)
    return op({ key: operationKey, status: 'unknown', verification: view({ state: 'unknown', canResume: false }) })
  })
  await assert.rejects(prepareIdentity(f.api, f.journal), /connection lost/)
  await assert.rejects(prepareIdentity(f.api, f.journal), /anterior/)
  assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1)
  assert.equal(f.journal.read()?.key, operationKey)
})
test('recovered completed creation resumes the same Stripe session without another create', async () => {
  const f = fixture(async path => path.includes('/operations/') ? op() : { verification: view(), url: 'https://verify.stripe.com/start/test_token' })
  f.journal.write({ key })
  const result = await prepareIdentity(f.api, f.journal)
  assert.equal(result.verification.id, id)
  assert.deepEqual(f.calls.map(c => c.path), ['/billing/identity/operations/' + key, '/billing/identity/resume'])
  assert.deepEqual(f.journal.read(), { key, verificationId: id })
  assert.ok(![...f.values.values()].join('').includes('https:'))
})
test('an existing processing session is consulted without opening a hosted link or creating again', async () => {
  const verification = view({ state: 'processing', canResume: false })
  const f = fixture(async path => path.endsWith('/resume') ? { verification, url: null } : { configured: true, mode: 'test', verification })
  const result = await prepareIdentity(f.api, f.journal)
  assert.equal(result.url, null)
  assert.equal(f.calls.filter(c => c.path.endsWith('/start')).length, 0)
})
test('late Stripe results cannot be published into another session', async () => {
  const f = fixture(async () => { f.expire(); return { configured: true, mode: 'test', verification: null } })
  await assert.rejects(f.api.state(), /context changed/)
})
test('resume rejects mismatched verification, forbidden destinations and nonresumable URLs', async () => {
  for (const response of [
    { verification: view({ id: key }), url: null },
    { verification: view(), url: 'https://evil.test/start/token' },
    { verification: view({ state: 'processing', canResume: false }), url: 'https://verify.stripe.com/start/token' },
  ]) {
    const f = fixture(async () => response)
    await assert.rejects(f.api.resume(id))
  }
})
test('start includes the expected tenant and an explicit opaque operation key', async () => {
  const f = fixture(async () => ({ operation: op() }))
  await f.api.start(key)
  assert.deepEqual(f.calls[0].options.body, { expectedTenantId: 'tenant', idempotencyKey: key })
  assert.equal(f.calls[0].options.method, 'POST')
})
