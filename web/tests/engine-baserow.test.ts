import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { baserowAttempt, baserowConfiguration, baserowQuery, baserowValues, bindingConfiguration, createBaserowService, parseBaserowBinding, parseBaserowFields, parseBaserowOperation, parseBaserowRows, validBaserowAttempt } from '../src/services/engine/baserow'
import { baserowFixture, configuration, fields, fieldId, numberId, checkboxId, selectId, multiId, dateId, computedId, rowId, tableId, providerResponse, syntheticToken } from './engine-baserow-fixture'
import { baserowBindings, baserowOperations } from '../../engine/src/integrations/baserow'
import { baserowHttpOperations } from '../../engine/src/integrations/baserow-http'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { sessionDigest } from '../../engine/src/auth'

const query = () => ({ page: 1, size: 20, filters: [], filterType: 'AND' as const, orderBy: [] })
const code = (expected: string, status?: number) => (error: any) => error instanceof EngineError && error.code === expected && (status === undefined || error.status === status)

test('four human Baserow intentions use authoritative CAS, canonical configuration and exact enabled replay without external reads', async t => {
  const f = await baserowFixture(t), initial = baserowAttempt('binding.create')
  const operation = await f.client.configure(initial, configuration({ instanceUrl: 'https://DATABASE.example.com:443/', enabled: false, allowedRoles: ['owner', 'admin', 'owner'] }))
  let binding = await f.client.get(operation.bindingId)
  assert.equal(binding.instanceUrl, 'https://database.example.com'); assert.equal(binding.status, 'disabled'); assert.equal(binding.liveValidation, 'not_inferred'); assert.equal(Object.hasOwn(binding, 'token'), false)
  const update = baserowAttempt('binding.update', binding)
  const changed = await f.client.configure(update, { ...bindingConfiguration(binding), name: 'Updated name' })
  assert.equal(changed.revision, 2); binding = await f.client.get(binding.id)
  const enable = baserowAttempt('binding.set_enabled', binding, randomUUID(), true)
  const enabled = await f.client.setEnabled(enable); assert.equal(enabled.kind, 'binding.set_enabled'); assert.equal(enabled.revision, 3)
  binding = await f.client.get(binding.id)
  await f.client.setEnabled(baserowAttempt('binding.set_enabled', binding, randomUUID(), false))
  assert.deepEqual(await f.client.setEnabled(enable), enabled, 'same-key historical intent does not toggle current state')
  assert.equal((await f.client.get(binding.id)).enabled, false)
  assert.equal((await f.client.list()).length, 1); assert.equal((await f.client.operation(initial)).revision, 1)
  await assert.rejects(f.client.configure(update, { ...bindingConfiguration(binding), name: 'Changed intent' }), code('idempotency_conflict', 409))
  assert.equal(f.counters.dns, 0); assert.deepEqual(f.calls, [])
  assert.doesNotMatch(JSON.stringify(operation), /token|encrypted|sessionHash|fingerprint/)
  for (const request of f.requests.filter(r => ['POST', 'PUT', 'PATCH'].includes(r.method))) { assert.equal(request.body.expectedTenantId, f.actor.tenantId); assert.equal(request.headers['X-Kloel-Expected-Authority'], f.identity.context.authorityVersion) }
})

test('schema, page/filter/sort and typed values preserve decimals, false, null and numeric options; one explicit row create', async t => {
  const f = await baserowFixture(t), binding = await f.create(), schema = await f.client.fields(binding)
  assert.deepEqual(schema, fields)
  const q = { ...query(), search: 'Nome', filterType: 'OR' as const, filters: [{ fieldId: 3, operator: 'boolean' as const, value: false }], orderBy: [{ fieldId: 2, descending: true }] }
  const result = await f.client.query(binding, q); assert.equal(result.nextPage, 2); assert.equal(result.items[0][checkboxId], false)
  const call = f.calls.at(-1)!
  assert.equal(call.url.searchParams.get('order_by'), '-field_2'); assert.equal(JSON.parse(call.url.searchParams.get('filters')!).filters[0].value, 'false')
  await f.client.query(binding, { ...q, page: 2 }); assert.equal(f.calls.at(-1)!.url.origin, binding.instanceUrl)
  const values = { [fieldId]: null, [numberId]: '123456789012345678901234567890.12345678901234567890', [checkboxId]: false, [selectId]: 41, [multiId]: [71, 72], [dateId]: '2026-10-18' }
  const op = await f.client.create(baserowAttempt('row.create', binding), values, schema)
  assert.equal(op.status, 'created'); assert.equal(op.rowId, rowId); assert.equal(typeof op.rowId, 'number')
  assert.deepEqual(f.calls.find(c => c.method === 'POST')!.body, values)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  for (const invalid of [{ [computedId]: 'no' }, { [selectId]: 'A' }, { [checkboxId]: null }, { [numberId]: Infinity }, { [dateId]: '2026-02-30' }, { field_999: 'unknown' }]) assert.throws(() => baserowValues(invalid, schema))
  assert.deepEqual(baserowValues({ [numberId]: 0, [fieldId]: '' }, schema), { [numberId]: 0, [fieldId]: '' })
})

test('accepted response loss recovers original row by GET and explicit same-key replay without provider I/O', async t => {
  const f = await baserowFixture(t), binding = await f.create(), attempt = baserowAttempt('row.create', binding)
  f.state.after = async (path, method, response) => { if (path.endsWith('/rows') && method === 'POST') { f.state.after = undefined; throw Error('lost after accept') }; return response }
  await assert.rejects(f.client.create(attempt, { [fieldId]: 'private row' }, fields))
  const calls = f.calls.length, recovered = await f.client.operation(attempt)
  assert.equal(recovered.status, 'created'); assert.equal(recovered.rowId, rowId); assert.equal(f.calls.length, calls)
  assert.deepEqual(await f.client.create(attempt, { [fieldId]: 'private row' }, fields), recovered); assert.equal(f.calls.length, calls)
  assert.equal(f.requests.at(-2)!.method, 'GET'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  assert.doesNotMatch(JSON.stringify(recovered), /private row|synthetic-baserow|encrypted|sessionHash/)
})

test('unknown or pending row receipt does not send again and configuration disable remains independently possible', async t => {
  const f = await baserowFixture(t), binding = await f.create(), attempt = baserowAttempt('row.create', binding)
  f.hooks.provider = async (_url, _address, spec) => { if (spec.method === 'GET') return providerResponse(fields); throw Error('accepted response unknown') }
  const uncertain = await f.client.create(attempt, { [fieldId]: 'value' }, fields)
  assert.equal(uncertain.status, 'uncertain'); assert.equal(uncertain.requiresReconciliation, true)
  const count = f.calls.length
  assert.equal((await f.client.operation(attempt)).status, 'uncertain'); assert.equal((await f.client.create(attempt, { [fieldId]: 'value' }, fields)).status, 'uncertain')
  await f.client.setEnabled(baserowAttempt('binding.set_enabled', binding, randomUUID(), false))
  assert.equal((await f.client.operation(attempt)).status, 'uncertain'); assert.equal(f.calls.length, count)
  f.store.update(f.actor.tenantId, baserowOperations, uncertain.nativeOperationId!, { status: 'pending', errorCode: undefined, encryptedResult: undefined })
  assert.equal((await f.client.operation(attempt)).status, 'pending'); assert.equal((await f.client.create(attempt, { [fieldId]: 'value' }, fields)).status, 'pending'); assert.equal(f.calls.length, count)
})

test('admission error is distinct from generic409 after accepted row; GET remains authoritative', async t => {
  const f = await baserowFixture(t), binding = await f.create(), stale = baserowAttempt('row.create', binding)
  f.store.update(f.actor.tenantId, baserowBindings, binding.id, { revision: 2 })
  await assert.rejects(f.client.create(stale, { [fieldId]: 'stale' }, fields), code('baserow_admission_revision_conflict', 409))
  await assert.rejects(f.client.operation(stale), code('baserow_operation_not_found', 404))
  assert.equal(f.calls.length, 0); assert.equal(f.counters.dns, 0)
  const current = await f.client.get(binding.id), late = baserowAttempt('row.create', current)
  f.hooks.provider = async (_url, _addr, spec) => { if (spec.method === 'GET') return providerResponse(fields); f.store.update(f.actor.tenantId, baserowBindings, binding.id, { revision: 3 }); return providerResponse({ id: rowId }) }
  await assert.rejects(f.client.create(late, { [fieldId]: 'accepted' }, fields), code('baserow_configuration_changed', 409))
  assert.equal((await f.client.operation(late)).status, 'created'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
})

test('readback after schema/query rejects newer binding without rebasing the caller draft', async t => {
  const f = await baserowFixture(t), binding = await f.create(), original = structuredClone(binding)
  f.state.after = async (path, _method, response) => { if (path.endsWith('/fields')) { f.state.after = undefined; f.store.update(f.actor.tenantId, baserowBindings, binding.id, { revision: 2 }) }; return response }
  await assert.rejects(f.client.fields(binding), code('baserow_configuration_changed', 409)); assert.deepEqual(binding, original)
  const current = await f.client.get(binding.id)
  f.state.after = async (path, _method, response) => { if (path.endsWith('/query')) { f.state.after = undefined; f.store.update(f.actor.tenantId, baserowBindings, binding.id, { revision: 3 }) }; return response }
  await assert.rejects(f.client.query(current, query()), code('baserow_configuration_changed', 409)); assert.equal(current.revision, 2)
})

test('local context invalidation suppresses late disclosure and rejects new commands before HTTP', async t => {
  const f = await baserowFixture(t), binding = await f.create()
  f.state.after = async (_path, _method, response) => { f.state.current = false; return response }
  await assert.rejects(f.client.get(binding.id), code('superseded', 0))
  const requests = f.requests.length
  await assert.rejects(f.client.list(), code('superseded', 0)); await assert.rejects(f.client.create(baserowAttempt('row.create', binding), { [fieldId]: 'blocked' }, fields), code('superseded', 0))
  assert.equal(f.requests.length, requests); assert.equal(f.calls.length, 0)
})

test('foreign cookie and role ABA cannot adopt a receipt; accepted receipt survives in-flight authority loss', async t => {
  const f = await baserowFixture(t), binding = await f.create(), attempt = baserowAttempt('row.create', binding)
  f.hooks.provider = async (_url, _addr, spec) => { if (spec.method === 'GET') return providerResponse(fields); f.aba(); return providerResponse({ id: rowId }) }
  await assert.rejects(f.client.create(attempt, { [fieldId]: 'accepted' }, fields), code('context_changed_in_flight', 0))
  const original = f.store.list(f.actor.tenantId, baserowHttpOperations).find(op => op.key === attempt.key)!
  assert.equal(f.store.get(f.actor.tenantId, baserowOperations, String(original.nativeOperationId))!.status, 'created')
  const request = createEngineClient(f.fetcher), fresh = await request<any>('/auth/me')
  const client = createBaserowService({ ...f.context, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: fresh.context }) })
  await assert.rejects(client.operation(attempt), code('baserow_operation_not_found', 404))
  await assert.rejects(client.create(attempt, { [fieldId]: 'accepted' }, fields), code('idempotency_conflict', 409))
  const other = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' as const }; seedMember(f.store, other)
  const token = randomUUID(); f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(token), other.userId, other.tenantId, Date.now() + 3600000); f.state.cookie = token
  await assert.rejects(client.setEnabled(baserowAttempt('binding.set_enabled', binding, randomUUID(), false)), code('context_mismatch', 409))
  assert.equal(f.store.list(other.tenantId, baserowBindings).length, 0); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
})

test('strict DTOs reject mismatched scope, unsafe numeric IDs, secrets and contradictory terminal states', async t => {
  const f = await baserowFixture(t), binding = await f.create(), attempt = baserowAttempt('row.create', binding), operation = await f.client.create(attempt, { [fieldId]: 'value' }, fields)
  for (const patch of [{ rowId: String(rowId) }, { rowId: Number.MAX_SAFE_INTEGER + 1 }, { kind: 'binding.set_enabled' }, { revision: 2 }, { bindingId: randomUUID() }, { key: randomUUID() }, { automaticRetry: true }, { requiresReconciliation: true }, { nativeOperationId: null }, { token: syntheticToken }, { status: 'rejected' }, { errorCode: 5 }]) assert.throws(() => parseBaserowOperation({ ...operation, ...patch }, attempt))
  for (const patch of [{ token: syntheticToken }, { nativeConnector: false }, { liveValidation: 'verified' }, { enabled: false }, { tableId: '123' }, { revision: 0 }]) assert.throws(() => parseBaserowBinding({ ...binding, ...patch }))
  const schema = { items: fields, tableId, source: 'baserow', dataSource: 'untrusted_external_content', providerVerified: true }
  assert.throws(() => parseBaserowFields({ ...schema, tableId: 999 }, binding)); assert.throws(() => parseBaserowFields({ ...schema, items: [fields[0], fields[0]] }, binding))
  const rows = { items: [{ id: rowId }], count: 1, page: 1, size: 20, nextPage: 2, tableId, source: 'baserow', dataSource: 'untrusted_external_content', providerVerified: true }
  for (const patch of [{ tableId: 999 }, { nextPage: 'https://bad.example' }, { nextPage: 3 }, { page: 2 }, { items: [{ id: '123' }] }]) assert.throws(() => parseBaserowRows({ ...rows, ...patch }, binding, query()))
  assert.equal(parseBaserowRows({ ...rows, page: 100000, nextPage: 100001 }, binding, { ...query(), page: 100000 }).nextPage, null)
})

test('invalid local inputs never dispatch; attempt stores explicit enabled and rejects foreign metadata', async t => {
  const f = await baserowFixture(t), binding = await f.create(), before = f.requests.length
  for (const patch of [{ instanceUrl: 'http://database.example.com' }, { instanceUrl: 'https://user:pass@database.example.com' }, { instanceUrl: 'https://database.example.com/path' }, { token: 'bad' }, { tableId: '123' }, { fieldIds: [1] }]) assert.throws(() => baserowConfiguration({ ...configuration(), ...patch }))
  assert.throws(() => baserowQuery({ ...query(), page: 100001 })); assert.throws(() => baserowQuery({ ...query(), filters: [{ fieldId: 1, operator: 'formula', value: '' }] }))
  const toggle = baserowAttempt('binding.set_enabled', binding, randomUUID(), false)
  assert.equal(toggle.kind === 'binding.set_enabled' && toggle.enabled, false); assert.ok(Object.isFrozen(toggle))
  assert.equal(validBaserowAttempt({ ...toggle, values: { secret: true } }), false)
  await assert.rejects(f.client.setEnabled(baserowAttempt('row.create', binding)), code('invalid_baserow_data', 0))
  await assert.rejects(f.client.create(toggle, { [fieldId]: 'blocked' }, fields), code('invalid_baserow_data', 0))
  assert.equal(f.requests.length, before)
})

test('GET404 after request loss performs no automatic replay; explicit original-key reentry is idempotent', async t => {
  const f = await baserowFixture(t), binding = await f.create(), attempt = baserowAttempt('row.create', binding), values = { [fieldId]: 'Original intention' }
  f.state.before = async (path, method) => { if (path.endsWith('/rows') && method === 'POST') { f.state.before = undefined; throw Error('lost before dispatch') } }
  await assert.rejects(f.client.create(attempt, values, fields))
  const requests = f.requests.length
  await assert.rejects(f.client.operation(attempt), code('baserow_operation_not_found', 404))
  assert.equal(f.requests.length, requests + 1); assert.equal(f.requests.at(-1)!.method, 'GET'); assert.deepEqual(f.calls, [])
  const confirmed = await f.client.create(attempt, values, fields); assert.equal(confirmed.status, 'created')
  assert.deepEqual(await f.client.operation(attempt), confirmed)
  await assert.rejects(f.client.create(attempt, { [fieldId]: 'Other intention' }, fields), code('idempotency_conflict', 409))
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  const writes = f.requests.filter(r => r.path.endsWith('/rows') && r.method === 'POST')
  assert.ok(writes.every(r => r.headers['Idempotency-Key'] === attempt.key))
})

test('an in-flight creation is discoverable as pending before acceptance and explicit replay never dispatches twice', async t => {
  const f = await baserowFixture(t), binding = await f.create(), attempt = baserowAttempt('row.create', binding), values = { [fieldId]: 'Pending intention' }
  let entered!: () => void, release!: () => void
  const providerEntered = new Promise<void>(yes => { entered = yes }), providerRelease = new Promise<void>(yes => { release = yes })
  t.after(() => release())
  f.hooks.provider = async (_url, _addr, spec) => { if (spec.method === 'GET') return providerResponse(fields); entered(); await providerRelease; return providerResponse({ id: rowId }) }
  const first = f.client.create(attempt, values, fields); await providerEntered
  const pending = await f.client.operation(attempt); assert.equal(pending.status, 'pending'); assert.equal(pending.requiresReconciliation, true); assert.ok(pending.nativeOperationId)
  assert.equal((await f.client.create(attempt, values, fields)).status, 'pending'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  release(); assert.equal((await first).status, 'created'); assert.equal((await f.client.operation(attempt)).status, 'created')
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
})
