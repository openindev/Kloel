import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { airtableAttempt, airtableConfiguration, airtableValues, bindingConfiguration, parseAirtableBinding, parseAirtableOperation } from '../src/services/engine/airtable'
import { airtableFixture, configuration, fieldId, numberId, checkboxId, computedId, fields, syntheticPAT, recordId } from './engine-airtable-fixture'
import { agentRuntimeTools, executeAgentTool } from '../../engine/src/providers/agent-tools'

test('native configuration uses real V2 receipts, preserves PAT on edit and refuses stale CAS without provider calls', async t => {
  const f = await airtableFixture(t), attempt = airtableAttempt('binding.create'), op = await f.client.configure(attempt, configuration({ enabled: false }))
  assert.equal(op.status, 'succeeded'); assert.equal(f.calls.length, 0); assert.equal(JSON.stringify(op).includes(syntheticPAT), false)
  const b = await f.client.get(op.bindingId); assert.equal(b.enabled, false); assert.equal((b as any).token, undefined)
  const update = airtableAttempt('binding.update', b), next = await f.client.configure(update, { ...bindingConfiguration(b), enabled: true })
  assert.equal(next.revision, 2); assert.deepEqual(await f.client.operation(update), next)
  await assert.rejects(f.client.configure(airtableAttempt('binding.update', b), { ...bindingConfiguration(b), name: 'stale' }), (e: any) => e.code === 'airtable_configuration_changed')
  assert.equal((await f.client.get(b.id)).name, b.name); assert.equal(f.calls.length, 0)
})

test('schema/read query bind authorized IDs, typed filters, cursor and post-read revision without conflating empty/false/zero', async t => {
  const f = await airtableFixture(t), b = await f.create(), schema = await f.client.fields(b)
  assert.equal(schema.length, fields.length)
  const query = { size: 1, filters: [{ fieldId: numberId, operator: 'equal' as const, value: 0 }], sort: [{ fieldId, direction: 'desc' as const }] }
  const first = await f.client.query(b, query); assert.equal(first.items[0].fields[numberId], 0); assert.equal(first.items[0].fields[checkboxId], false); assert.ok(first.nextCursor)
  assert.equal(first.items[0].fields[computedId], undefined)
  const second = await f.client.query(b, { ...query, cursor: first.nextCursor! }); assert.equal(second.nextCursor, null)
  assert.equal(f.calls.at(-1)!.url.searchParams.get('offset'), 'opaque-provider-offset')
  const before = f.calls.length; await assert.rejects(f.client.query(b, { ...query, cursor: first.nextCursor!, size: 2 }), (e: any) => e.code === 'invalid_airtable_cursor'); assert.equal(f.calls.length, before)
  f.state.after = async (path, method, response) => { if (path.endsWith('/fields')) { f.store.update(f.actor.tenantId, 'airtable-bindings', b.id, { revision: 2 }); f.state.after = undefined }; return response }
  await assert.rejects(f.client.fields(b), (e: any) => e.code === 'airtable_configuration_changed')
})

test('typed record creation confirms ID once, lost browser response reconciles with GET and canonical replay never resends', async t => {
  const f = await airtableFixture(t), b = await f.create(), schema = await f.client.fields(b), attempt = airtableAttempt('record.create', b)
  f.state.after = async (path, method, response) => { if (path.endsWith('/records')) { f.state.after = undefined; throw Error('lost accepted response') }; return response }
  await assert.rejects(f.client.create(attempt, { [fieldId]: 'Pessoa', [numberId]: 0, [checkboxId]: false }, schema))
  const result = await f.client.operation(attempt); assert.equal(result.status, 'created'); assert.equal(result.recordId, recordId)
  assert.deepEqual(await f.client.create(attempt, { [checkboxId]: false, [numberId]: 0, [fieldId]: 'Pessoa' }, schema), result)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  assert.equal(JSON.stringify(result).includes('Pessoa'), false); assert.equal(JSON.stringify(result).includes(syntheticPAT), false)
  for (const values of [{ [computedId]: 3 }, { [numberId]: '0' }, { [checkboxId]: null }, { [fieldId]: 4 }]) assert.throws(() => airtableValues(values, schema))
})

test('remote uncertainty remains distinct from rejected/not_sent and GET cannot create, refresh or resend', async t => {
  const f = await airtableFixture(t), b = await f.create(), schema = await f.client.fields(b), attempt = airtableAttempt('record.create', b)
  f.hooks.provider = async (url, _address, spec) => { if (spec.method === 'POST') throw Error('unknown outcome'); return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ tables: [{ id: b.tableId, fields }] })) } }
  const op = await f.client.create(attempt, { [fieldId]: 'A' }, schema); assert.equal(op.status, 'uncertain'); assert.equal(op.requiresReconciliation, true)
  const before = f.calls.length; assert.deepEqual(await f.client.operation(attempt), op); assert.equal(f.calls.length, before)
  assert.equal((await f.client.configure(airtableAttempt('binding.update', b), { ...bindingConfiguration(b), enabled: false })).status, 'succeeded')
  assert.equal((await f.client.operation(attempt)).status, 'uncertain'); assert.equal(f.calls.length, before)
})

test('session/authority and malformed receipt projections fail closed including role ABA after acceptance', async t => {
  const f = await airtableFixture(t), b = await f.create(), schema = await f.client.fields(b), attempt = airtableAttempt('record.create', b)
  f.hooks.provider = async (_url, _address, spec) => {
    if (spec.method === 'POST') { f.aba(); return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ records: [{ id: recordId, createdTime: '2026-10-18T12:00:00Z', fields: { [fieldId]: 'accepted-private' } }] })) } }
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ tables: [{ id: b.tableId, fields }] })) }
  }
  await assert.rejects(f.client.create(attempt, { [fieldId]: 'accepted-private' }, schema), (e: any) => e.code === 'context_changed_in_flight')
  assert.equal(f.store.list(f.actor.tenantId, 'airtable-operations').at(-1)!.status, 'created'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  await assert.rejects(f.client.operation(attempt)); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  assert.throws(() => parseAirtableBinding({ ...b, id: randomUUID() }, b.id))
  const raw = { key: attempt.key, kind: attempt.kind, status: 'created', bindingId: b.id, revision: b.revision, nativeOperationId: randomUUID(), recordId, errorCode: null, requiresReconciliation: false, automaticRetry: false, createdAt: b.createdAt, updatedAt: b.updatedAt }
  assert.throws(() => parseAirtableOperation({ ...raw, bindingId: randomUUID() }, attempt)); assert.throws(() => parseAirtableOperation({ ...raw, recordId: null }, attempt)); assert.throws(() => parseAirtableOperation({ ...raw, status: 'uncertain' }, attempt))
})

test('HTTP-configured assignment is consumed by real dispatcher only for trusted operator and is revoked without fake agent flags', async t => {
  const f = await airtableFixture(t), b = await f.create(), ctx = { tenantId: f.actor.tenantId, actor: f.actor, agent: f.store.get(f.actor.tenantId, 'agents', f.agent.id)!, conversationId: randomUUID(), trustedOperator: true, operatorSessionHash: f.hash }
  const tools = agentRuntimeTools(f.store, ctx); assert.equal(tools.filter(t => t.name.startsWith('airtable_')).length, 3)
  assert.equal(agentRuntimeTools(f.store, { ...ctx, trustedOperator: false }).filter(t => t.name.startsWith('airtable_')).length, 0)
  for (const action of ['fields', 'read', 'create'] as const) {
    const call = { id: randomUUID(), name: `airtable_${action}_${b.id.replaceAll('-', '')}`, arguments: JSON.stringify(action === 'create' ? { values: { [fieldId]: 'dispatch' } } : {}) }
    assert.equal((await executeAgentTool(f.store, ctx, call, { integrationTransport: f.transport })).ok, true)
  }
  await f.client.configure(airtableAttempt('binding.update', b), { ...bindingConfiguration(b), agentIds: [] })
  assert.equal(agentRuntimeTools(f.store, ctx).filter(t => t.name.startsWith('airtable_')).length, 0)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
})

test('input projection never emits unrelated fields, unsupported identifiers or raw PAT in binding DTO', () => {
  const raw = configuration(); assert.throws(() => airtableConfiguration({ ...raw, tableId: 'https://attacker.invalid' }))
  assert.throws(() => airtableConfiguration({ ...raw, fieldIds: [] })); assert.throws(() => airtableConfiguration({ ...raw, token: 'token with spaces' }))
  assert.equal((airtableConfiguration({ ...raw, unexpected: 'hidden' }) as any).unexpected, undefined)
})
