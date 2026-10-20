import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildApp } from '../../engine/src/app'
import { Store } from '../../engine/src/store'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { agentPayload, changedAgentFields, createAgentService, editableAgent, parseOverview } from '../src/services/engine/agents'

async function fixture(t: any) {
  const store = new Store(), actor = { tenantId: 'agent-ui', userId: 'agent-ui-owner', role: 'owner' as const }
  seedMember(store, actor)
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update('agent-test-cookie').digest('hex'), actor.userId, actor.tenantId, Date.now() + 60000)
  const app = await buildApp(store, { workers: false }); t.after(() => app.close())
  const seen: string[] = []
  const request = createEngineClient((async (url, options = {}) => {
    seen.push(String(url)); assert.equal(options.credentials, 'include'); assert.equal((options.headers as any).Authorization, undefined)
    const response = await app.inject({ method: options.method as any ?? 'GET', url: String(url), headers: { ...options.headers as Record<string, string>, cookie: 'kloel_session=agent-test-cookie' }, ...(options.body ? { payload: String(options.body) } : {}) })
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent() {}, request }
  return { store, actor, app, context, seen, client: createAgentService(context) }
}

test('agent frontend uses real domain CRUD and overview counts from stored tenant data', async t => {
  const f = await fixture(t)
  const first = await f.client.create({ name: 'Local assistant', prompt: 'Keep it brief.', voice: 'alloy' })
  const second = await f.client.create({ name: 'Second assistant' })
  assert.equal(first.tenantId, f.actor.tenantId); assert.equal(first.status, 'draft'); assert.equal(first.settings.timezone, 'America/Sao_Paulo')
  assert.equal((await f.client.list()).length, 2)
  const previous = editableAgent(first), next = structuredClone(previous)
  next.settings.maxResponseTokens = 512; next.rules = [{ name: 'Greeting', instruction: 'Speak Portuguese.', enabled: true }]
  const patch = changedAgentFields(previous, next)
  assert.deepEqual(patch.settings, { maxResponseTokens: 512 })
  const saved = await f.client.update(first.id, patch)
  assert.equal(saved.settings.maxResponseTokens, 512); assert.equal(saved.settings.timezone, first.settings.timezone); assert.deepEqual(saved.rules, next.rules)
  const conversation = f.store.create(f.actor.tenantId, 'conversations', { agentId: first.id, status: 'open', channel: 'webchat' })
  f.store.create(f.actor.tenantId, 'messages', { conversationId: conversation.id, role: 'user', content: 'Hello' })
  f.store.create('other-tenant', 'conversations', { agentId: first.id, status: 'open', channel: 'webchat' })
  const overview = await f.client.overview(7, first.id)
  assert.equal(overview.counts.agents, 1); assert.equal(overview.counts.conversations, 1); assert.equal(overview.periodCounts.messages, 1); assert.equal(overview.daily.length, 7)
  assert.equal(overview.usage.cost, null); assert.equal(overview.usage.callMinutes, null)
  await assert.rejects(f.client.remove(first.id), (error: any) => error.code === 'resource_in_use')
  await f.client.remove(second.id); assert.equal((await f.client.list()).length, 1)
  assert.ok(f.seen.some(path => path.includes('days=7') && path.includes(`agentId=${first.id}`)))
  f.store.db.prepare('DELETE FROM memberships WHERE tenant_id=? AND user_id=?').run(f.actor.tenantId, f.actor.userId)
  await assert.rejects(f.client.update(first.id, { name: 'Rejected' }), (error: any) => [401, 403].includes(error.status))
})

test('agent parser rejects tenant leakage, unsupported fields and fabricated analytics', async t => {
  const f = await fixture(t), created = await f.client.create({ name: 'Safe' })
  for (const value of [{ tenantId: 'other' }, { name: ' ' }, { settings: { timezone: 'invented-zone' } }, { settings: { temperature: Infinity } }, { tools: ['untrusted_tool'] }, { rules: [{ name: ' ', instruction: 'x', enabled: true }] }]) assert.throws(() => agentPayload(value), EngineError)
  const mismatched = createAgentService({ ...f.context, request: (async () => ({ ...created, tenantId: 'other' })) as EngineRequest })
  await assert.rejects(mismatched.create({ name: 'Wrong organization' }), EngineError)
  const overview = await f.client.overview(1)
  assert.throws(() => parseOverview({ ...overview, usage: { ...overview.usage, cost: 0 } }), EngineError)
  assert.throws(() => parseOverview({ ...overview, counts: { ...overview.counts, messages: -1 } }), EngineError)
})

test('uncertain agent creation sends once and stale responses cannot become saved state', async () => {
  let attempts = 0
  const failing = createAgentService({ tenantId: 'T', generation: 1, assertCurrent() {}, request: createEngineClient((async () => { attempts++; throw Error('lost response') }) as typeof fetch) })
  await assert.rejects(failing.create({ name: 'Uncertain' }), (error: any) => error.code === 'network_error'); assert.equal(attempts, 1)
  const stale = createAgentService({ tenantId: 'T', generation: 1, assertCurrent() { throw new EngineError(0, 'superseded', 'Changed session') }, request: (async () => ({ items: [], page: 1, limit: 100, total: 0, totalPages: 0 })) as EngineRequest })
  await assert.rejects(stale.list(), (error: any) => error.code === 'superseded')
})
