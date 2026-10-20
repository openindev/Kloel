import test from 'node:test'
import assert from 'node:assert/strict'
import { calendlyUIFixture } from './engine-calendly-fixture'
import { createCalendlyResourceActions, loadCalendlyResources } from '../src/services/casca/calendly-resource'
const memory = () => { const rows = new Map<string, string>(); return { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => { rows.set(k, v) }, removeItem: (k: string) => { rows.delete(k) } } }

test('existing calendar controls configure native private and current webchat scopes with explicit reservation permission', async t => {
  const f = await calendlyUIFixture(t), connection = await f.connect(), api = createCalendlyResourceActions(f.context, f.agent.id, f.identity.context, memory())
  const readsOnly = await loadCalendlyResources(f.context, f.agent.id)
  assert.equal(readsOnly.length, 0); assert.equal(f.writes().length, 0)
  const saved = await api.save(connection.id, f.remote.eventTypeId, false)
  assert.equal(saved.actions.length, 2); assert.deepEqual(new Set(saved.actions.map(a => a.audience)), new Set(['private', 'webchat']))
  for (const action of saved.actions) { assert.equal(action.enabled, true); assert.equal(action.available, true); assert.equal(action.allowCreate, false); assert.equal(action.maxBookingsPerDay, 100) }
  const before = f.writes().length
  const projected = await loadCalendlyResources(f.context, f.agent.id)
  assert.equal(projected.length, 1); assert.equal(projected[0].name, saved.event.name); assert.equal(projected[0].url, saved.event.schedulingUrl)
  assert.equal(projected[0].settings!.allowBookings, false); assert.equal(f.writes().length, before)
  const enabled = await api.save(connection.id, f.remote.eventTypeId, true)
  assert.ok(enabled.actions.every(a => a.allowCreate))
  await api.remove(connection.id, f.remote.eventTypeId)
  assert.equal((await loadCalendlyResources(f.context, f.agent.id)).length, 0)
  assert.ok((await f.client.actions(f.agent.id)).every(a => !a.enabled && !a.allowCreate))
})

test('lost configuration response is recovered by receipt without another creation; existing stricter quota is retained', async t => {
  const f = await calendlyUIFixture(t), connection = await f.connect(), storage = memory(), api = createCalendlyResourceActions(f.context, f.agent.id, f.identity.context, storage)
  let lost = false
  f.state.after = async (r, response) => { if (!lost && r.method === 'POST' && r.path.endsWith('/actions')) { lost = true; throw Error('Synthetic response loss') } return response }
  await assert.rejects(api.save(connection.id, f.remote.eventTypeId, false))
  const saved = await createCalendlyResourceActions(f.context, f.agent.id, f.identity.context, storage).save(connection.id, f.remote.eventTypeId, false)
  assert.equal(f.writes().filter(r => r.method === 'POST' && r.path.endsWith('/actions')).length, 2)
  assert.equal(saved.actions.find(a => a.audience === 'private')?.maxBookingsPerDay, 10)
  assert.equal(saved.actions.find(a => a.audience === 'webchat')?.maxBookingsPerDay, 100)
  assert.ok(f.calls.some(r => r.method === 'GET' && r.path.includes('/configuration-operations/')))
})

test('disconnect uses provider connection CAS; stale contexts cannot mutate', async t => {
  const f = await calendlyUIFixture(t), connection = await f.connect(), api = createCalendlyResourceActions(f.context, f.agent.id, f.identity.context, memory())
  await api.save(connection.id, f.remote.eventTypeId, false)
  await api.disconnect(connection.id)
  assert.equal((await f.client.connections()).find(c => c.id === connection.id)?.status, 'disconnected')
  const rows = await loadCalendlyResources(f.context, f.agent.id)
  assert.equal(rows.length, 1); assert.ok(rows[0].engineCalendly!.actions.every(a => !a.available))
  const count = f.writes().length; f.state.current = false
  await assert.rejects(api.save(connection.id, f.remote.eventTypeId, true), /Context changed/)
  assert.equal(f.writes().length, count)
})
