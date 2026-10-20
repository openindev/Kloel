import assert from 'node:assert/strict'
import { bookingOperatorFixture } from '../../engine/tests/fixtures/booking-operator'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { bookingOperationsClient } from '../src/services/engine/booking-operations'
import { bookingRescheduleClient } from '../src/services/engine/booking-reschedule'

export async function rescheduleFixture(t: any, provider: 'google' | 'microsoft' = 'google') {
  const f = await bookingOperatorFixture(t, provider), identity = (await f.request('/api/v1/auth/me')).json(), browser: Array<{ path: string; method: string; headers: Headers; body: any }> = []
  const wire: { before?: (path: string, method: string) => Promise<void>; after?: (path: string, method: string, response: Response) => Promise<Response> } = {}
  let current = true
  const fetcher: typeof fetch = async (input, options = {}) => {
    const path = String(input), method = options.method ?? 'GET'; assert.ok(path.startsWith('/api/v1/'))
    browser.push({ path, method, headers: new Headers(options.headers), body: options.body ? JSON.parse(String(options.body)) : undefined }); await wire.before?.(path, method)
    const result = await f.app.inject({ method: method as any, url: path, headers: { ...Object.fromEntries(new Headers(options.headers)), cookie: `kloel_session=${f.cookies.kloel_session}` }, ...(options.body ? { payload: String(options.body) } : {}) })
    const response = new Response(result.body, { status: result.statusCode, headers: { 'content-type': 'application/json' } }); return wire.after ? wire.after(path, method, response) : response
  }
  const request = createEngineClient(fetcher), context = { tenantId: f.actor.tenantId, generation: 1, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', 'Changed') }, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }) }
  return { ...f, identity, browser, wire, context, api: bookingRescheduleClient(context), cancelApi: bookingOperationsClient(context), invalidate: () => { current = false }, range: { bookingRef: f.booked.bookingRef, expectedRevision: 1, from: f.from, to: f.to } }
}
