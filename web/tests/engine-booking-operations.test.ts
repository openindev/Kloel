import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { bookingOperatorFixture } from '../../engine/tests/fixtures/booking-operator'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { bookingCancellationAttempt, bookingOperationsClient, parseBookingOperation } from '../src/services/engine/booking-operations'

async function fixture(t: any, provider: 'google' | 'microsoft' = 'google') {
  const f = await bookingOperatorFixture(t, provider), identity = (await f.request('/api/v1/auth/me')).json(), browser: Array<{ path: string; method: string; headers: Headers; body: any }> = []
  const hooks: { before?: (path: string, method: string) => Promise<void>; after?: (path: string, method: string, response: Response) => Promise<Response> } = {}
  let current = true
  const fetcher: typeof fetch = async (input, options = {}) => {
    const path = String(input), method = options.method ?? 'GET'; assert.ok(path.startsWith('/api/v1/'))
    browser.push({ path, method, headers: new Headers(options.headers), body: options.body ? JSON.parse(String(options.body)) : undefined }); await hooks.before?.(path, method)
    const result = await f.app.inject({ method: method as any, url: path, headers: { ...Object.fromEntries(new Headers(options.headers)), cookie: `kloel_session=${f.cookies.kloel_session}` }, ...(options.body ? { payload: String(options.body) } : {}) })
    const response = new Response(result.body, { status: result.statusCode, headers: { 'content-type': 'application/json' } }); return hooks.after ? hooks.after(path, method, response) : response
  }
  const request = createEngineClient(fetcher), context = { tenantId: f.actor.tenantId, generation: 1, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', 'Changed') }, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }) }
  return { ...f, browser, hooks, context, client: bookingOperationsClient(context), invalidate: () => { current = false } }
}
test('real Google cancel returns accepted, local receipt GET never repeats DELETE, explicit reconcile confirms absence', async t => {
  const f = await fixture(t), booking = (await f.client.list())[0]; assert.equal(booking.adminCancellation.eligible, true)
  const attempt = bookingCancellationAttempt(booking), result = await f.client.cancel(attempt)
  assert.equal(result.operation.status, 'accepted'); assert.equal(result.operation.effect, 'delete_accepted'); assert.equal(f.record().status, 'cancel_pending')
  const providerCount = f.requests.length; assert.equal((await f.client.operation(attempt)).status, 'accepted'); assert.equal(f.requests.length, providerCount)
  assert.equal((await f.client.cancel(attempt)).replayed, true); assert.equal(f.requests.length, providerCount)
  await f.client.reconcile(booking.bookingRef); assert.equal((await f.client.operation(attempt)).status, 'succeeded'); assert.equal(f.record().status, 'cancelled')
  assert.equal(f.requests.filter(row => row.method === 'DELETE').length, 1)
  const posted = f.browser.find(row => row.method === 'POST' && row.path.endsWith('/cancel'))!
  assert.deepEqual(posted.body, { expectedTenantId: f.actor.tenantId, expectedRevision: 1, confirm: true }); assert.equal(posted.headers.get('idempotency-key'), attempt.key)
  assert.equal(JSON.stringify(result).includes('synthetic-booking-token'), false)
})
test('a lost accepted response is recovered by GET with no second POST and no new key', async t => {
  const f = await fixture(t), attempt = bookingCancellationAttempt((await f.client.list())[0])
  f.hooks.after = async (path, method, response) => { if (method === 'POST' && path.endsWith('/cancel')) throw Error('Lost response after accepted'); return response }
  await assert.rejects(f.client.cancel(attempt), (e: any) => e.code === 'network_error')
  assert.equal((await f.client.operation(attempt)).status, 'accepted'); assert.equal(f.browser.filter(row => row.method === 'POST').length, 1); assert.equal(f.requests.filter(row => row.method === 'DELETE').length, 1)
})
test('absence before dispatch allows only explicit same-key request and its replay has no remote effect', async t => {
  const f = await fixture(t), attempt = bookingCancellationAttempt((await f.client.list())[0]); let lost = false
  f.hooks.before = async (_path, method) => { if (method === 'POST' && !lost) { lost = true; throw Error('Lost before dispatch') } }
  await assert.rejects(f.client.cancel(attempt)); await assert.rejects(f.client.operation(attempt), (e: any) => e.status === 404)
  assert.equal(f.requests.length, 0); await f.client.cancel(attempt); const before = f.requests.length; await f.client.cancel(attempt); assert.equal(f.requests.length, before)
  assert.equal(new Set(f.browser.filter(row => row.method === 'POST').map(row => row.headers.get('idempotency-key'))).size, 1)
})
test('Microsoft cancellation capability is independent of reschedule and stale admission makes zero provider requests', async t => {
  const f = await fixture(t, 'microsoft'), booking = (await f.client.list())[0]
  assert.equal(booking.adminCancellation.supported, true); assert.equal(booking.adminRescheduling?.supported, false); assert.equal(booking.notifications, 'provider_managed_unknown')
  await assert.rejects(f.client.cancel(bookingCancellationAttempt({ ...booking, revision: 2 })), (e: any) => e.code === 'booking_cancel_admission_revision_conflict'); assert.equal(f.requests.length, 0)
})
test('stale revision is narrowly rejected before receipt/provider while source tenant and authority are enforced', async t => {
  const f = await fixture(t), booking = (await f.client.list())[0], attempt = bookingCancellationAttempt({ ...booking, revision: 2 })
  await assert.rejects(f.client.cancel(attempt), (e: any) => e.code === 'booking_cancel_admission_revision_conflict'); assert.equal(f.requests.length, 0); await assert.rejects(f.client.operation(attempt), (e: any) => e.status === 404)
  // This minimal Fastify fixture retains Fastify's flat error serializer for hook errors.
  f.aba(); await assert.rejects(f.client.cancel(bookingCancellationAttempt(booking)), (e: any) => e.status === 409); assert.equal(f.requests.length, 0)
})
test('parser rejects substituted receipts, accepted-as-succeeded claims, and data from a superseded context', async t => {
  const f = await fixture(t), attempt = bookingCancellationAttempt((await f.client.list())[0]), operation = (await f.client.cancel(attempt)).operation
  for (const patch of [{ key: randomUUID() }, { bookingRef: randomUUID() }, { expectedRevision: 2 }, { status: 'succeeded' }, { automaticRetry: true }, { notifications: 'sent' }, { errorCode: '<raw-secret>' }]) assert.throws(() => parseBookingOperation({ ...operation, ...patch }, attempt))
  f.hooks.after = async (_path, _method, response) => { f.invalidate(); return response }; await assert.rejects(f.client.operation(attempt), (e: any) => e.code === 'superseded')
})
