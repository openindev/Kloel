import type { TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { billingQuotaFixture } from '../../../engine/tests/fixtures/billing-quotas'
import { registerAccountProfile } from '../../../engine/src/account-profile'
import { capabilitiesFor } from '../../../engine/src/memberships/permissions'
import { chatRoundMeter } from '../../../engine/src/billing/usage'
import { createEngineClient, EngineError } from '../../src/services/engine/http'
import { createBillingUsageService } from '../../src/services/engine/billing-usage'

export async function billingUsageFixture(t: TestContext) {
  const f = await billingQuotaFixture(t)
  await registerAccountProfile(f.app, f.store)
  Object.assign(f.price, { currency: 'brl', unit_amount: 100, billing_scheme: 'per_unit', recurring: { usage_type: 'licensed', interval: 'month', interval_count: 1 }, product: { id: 'prod_Quota', name: 'Plano sintético', active: true, metadata: { kloel_synthetic: 'true' } }, metadata: {} })
  const identity = (await f.request('GET', '/api/v1/auth/me')).json(), providerFetch = globalThis.fetch
  const calls: Array<{ path: string; method: string; body: any; headers: Headers }> = []
  const state = { current: true, before: undefined as undefined | ((r: typeof calls[number]) => Promise<Response | void>), after: undefined as undefined | ((r: typeof calls[number], response: Response) => Promise<Response>) }
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input)
    if (!path.startsWith('/api/v1/')) return providerFetch(input, init)
    const r = { path, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) }; calls.push(r)
    const early = await state.before?.(r); if (early) return early
    if (path === '/api/v1/capabilities') { const role = f.store.db.prepare('SELECT role FROM memberships WHERE user_id=?').get(f.actor.userId)!.role as 'owner'; return Response.json({ role, permissions: capabilitiesFor(role), items: [] }) }
    const response = await f.app.inject({ method: r.method as any, url: path, cookies: f.cookies, headers: Object.fromEntries(r.headers), ...(init.body ? { payload: String(init.body) } : {}) })
    const result = new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
    return state.after ? state.after(r, result) : result
  }
  globalThis.fetch = fetcher
  const request = createEngineClient(fetcher), context = { tenantId: f.actor.tenantId, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Context changed') }, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }) }
  async function round(kind: 'observed' | 'unknown' = 'observed', model = 'synthetic-model') {
    const meter = chatRoundMeter(f.store, { tenantId: f.actor.tenantId, sourceKind: 'private_chat', operationId: randomUUID(), authorityHash: 'a'.repeat(64), model }, () => {})
    try { await meter.run(0, async observer => { if (kind === 'unknown') throw new Error('synthetic response lost'); observer.http(200); observer.parsed({ id: 'response_synthetic', usage: { input_tokens: 0, output_tokens: 2, total_tokens: 2 } }) }) }
    catch (e) { if (kind !== 'unknown') throw e }
  }
  return { ...f, identity, context, fetcher, providerFetch, calls, state, round, client: createBillingUsageService(context) }
}
