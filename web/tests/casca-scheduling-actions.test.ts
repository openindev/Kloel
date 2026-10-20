import test from 'node:test'
import assert from 'node:assert/strict'
import { assistantBookingFixture } from '../../engine/tests/fixtures/assistant-booking'
import { registerScheduling } from '../../engine/src/scheduling'
import { createEngineClient } from '../src/services/engine/http'
import { schedulingClient } from '../src/services/engine/scheduling'
import { createAssistantBookingService } from '../src/services/engine/assistant-booking'
import { projectEvent } from '../src/services/casca/scheduling'
import { bindEventToAgent } from '../src/services/casca/scheduling-actions'

async function fixture(t: any) {
  const f = await assistantBookingFixture(t, registerScheduling)
  const me = (await f.app.inject({ url: '/api/v1/auth/me', cookies: f.cookies })).json()
  const entries = new Map<string, string>(), writes: { method: string; path: string }[] = []
  let lose = false
  const fetcher = (async (input: any, init: RequestInit = {}) => {
    const method = init.method ?? 'GET', path = String(input), headers = new Headers(init.headers)
    if (method !== 'GET') writes.push({ method, path })
    const response = await f.app.inject({ url: path, method: method as any, cookies: f.cookies, headers: Object.fromEntries(headers), ...(init.body ? { payload: String(init.body) } : {}) })
    if (lose && method === 'PUT' && path.includes('/booking-actions/')) { lose = false; throw Error('Synthetic lost grant response') }
    return new Response(response.body, { status: response.statusCode, headers: response.headers as Record<string, string> })
  }) as typeof fetch
  const request = createEngineClient(fetcher)
  const context = { tenantId: f.actor.tenantId, generation: 1, assertCurrent() {}, request: <T>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: me.context }) }
  const ports = { context, identity: { role: 'owner' as const, context: me.context }, storage: { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => { entries.set(k, v) }, removeItem: (k: string) => { entries.delete(k) } }, refresh: async () => ({ eventTypes: (await schedulingClient(context).events()).map(projectEvent) }) }
  const event = projectEvent((await schedulingClient(context).events())[0])
  return { ...f, event, ports, entries, writes, lose: () => { lose = true }, actions: () => createAssistantBookingService(context, f.agent.id).list() }
}

test('binding grants existing private and webchat audiences and disabling revokes them', async t => {
  const f = await fixture(t)
  await bindEventToAgent(f.event, f.agent.id, true, false, f.ports)
  let actions = await f.actions()
  assert.equal(actions.length, 2); assert.deepEqual(actions.map(a => a.audience).sort(), ['private', 'webchat'])
  assert.ok(actions.every(a => a.enabled && a.available && !a.allowCreate))
  assert.ok(actions.every(a => a.expiresAt && Date.parse(a.expiresAt) > Date.now()))
  assert.ok(f.writes.some(w => w.method === 'PUT'))
  await bindEventToAgent(f.event, f.agent.id, false, false, f.ports)
  actions = await f.actions(); assert.ok(actions.every(a => !a.enabled && !a.allowCreate))
  assert.ok([...f.entries.values()].every(value => JSON.parse(value).data.length === 0))
})

test('uncertain grant update is recovered from its receipt before continuing, without duplicate actions', async t => {
  const f = await fixture(t); f.lose()
  await assert.rejects(bindEventToAgent(f.event, f.agent.id, true, true, f.ports))
  assert.ok(f.entries.size > 0)
  await bindEventToAgent(f.event, f.agent.id, true, true, f.ports)
  const actions = await f.actions()
  assert.equal(actions.length, 2); assert.ok(actions.every(a => a.available && a.allowCreate))
  assert.equal(f.writes.filter(w => w.method === 'POST' && /booking-actions$/.test(w.path)).length, 2)
  assert.equal(f.writes.filter(w => w.method === 'PUT' && w.path.includes('/booking-actions/')).length, 2)
  assert.ok([...f.entries.values()].every(value => JSON.parse(value).data.length === 0))
})
