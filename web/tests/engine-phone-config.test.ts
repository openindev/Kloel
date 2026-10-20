import test from 'node:test'
import assert from 'node:assert/strict'
import { phoneUIFixture, phone, sid } from './engine-phone-config-fixture'
import { createPhoneConfigService, phoneAttempt, phoneCreate, phonePatch, phoneRefusal, validPhoneAttempt } from '../src/services/engine/phone-config'
import { EngineError } from '../src/services/engine/http'

test('private create/routing uses server proof; rename/unlink/delete and historic receipt are local even after recreation', async t => {
  const f = await phoneUIFixture(t), create = phoneAttempt('create')
  const result = await f.service.create(create, { name: ' Entrada ', number: phone, providerNumberId: sid, agentId: f.agent.id, channelId: f.channel.id })
  let row = await f.service.get(result.operation.numberId); assert.equal(row.name, 'Entrada'); assert.equal(row.revision, 1); assert.equal(row.provisioningStatus, 'unverified'); assert.equal(row.ownership?.scope, 'registration')
  const calls = f.calls.length; delete process.env.TWILIO_AUTH_TOKEN
  const update = phoneAttempt('update', row); await f.service.update(update, { name: 'Renamed', agentId: null, channelId: null }); row = await f.service.get(row.id)
  const remove = phoneAttempt('delete', row); const deleted = await f.service.remove(remove); assert.equal(deleted.operation.result.deleted, true)
  assert.equal(f.calls.length, calls); assert.deepEqual(await f.service.list(), [])
  process.env.TWILIO_AUTH_TOKEN = 'synthetic-phone-token'; const replacement = await f.seed(); assert.notEqual(replacement.id, row.id)
  const before = f.calls.length, receipt = await f.service.operation(remove); assert.equal(receipt.numberId, row.id); assert.equal(receipt.result.revision, 3); assert.equal(f.calls.length, before)
  assert.equal((await f.service.get(replacement.id)).id, replacement.id)
  assert.ok(f.writes().every(r => r.path.startsWith('/api/v1/phone-config/'))); assert.ok(f.calls.every(c => c.method === 'GET'))
})

test('CAS rejects stale update/delete after no-op and ABA; narrow refusal never classifies generic errors', async t => {
  const f = await phoneUIFixture(t), row = await f.seed(), stale = phoneAttempt('update', row)
  await f.updateOther(row, row.name); const latest = await f.service.get(row.id); assert.equal(latest.revision, row.revision + 1); assert.notEqual(latest.version, row.version)
  await assert.rejects(f.service.update(stale, { name: 'Stale' }), e => phoneRefusal(e, stale))
  const deletion = phoneAttempt('delete', row); await assert.rejects(f.service.remove(deletion), e => phoneRefusal(e, deletion))
  assert.equal((await f.service.get(row.id)).version, latest.version)
  for (const e of [new EngineError(409, 'idempotency_conflict', ''), new EngineError(0, 'context_changed_in_flight', ''), new EngineError(404, 'operation_not_found', '')]) assert.equal(phoneRefusal(e, stale), false)
  assert.equal(phoneRefusal(new EngineError(409, 'phone_configuration_changed', ''), phoneAttempt('create')), false)
})

for (const kind of ['create', 'update', 'delete'] as const) test(`lost ${kind} response recovers by original key without replay or provider effect`, async t => {
  const f = await phoneUIFixture(t), row = kind === 'create' ? undefined : await f.seed(), attempt = kind === 'create' ? phoneAttempt('create') : phoneAttempt(kind, row!)
  f.state.lose = (kind === 'create' ? 'POST /api/v1/phone-config/numbers' : `${kind === 'update' ? 'PATCH' : 'DELETE'} /api/v1/phone-config/numbers/${row!.id}`)
  await assert.rejects(kind === 'create' ? f.service.create(attempt, { name: 'Lost', number: phone, providerNumberId: sid }) : kind === 'update' ? f.service.update(attempt, { name: 'Lost' }) : f.service.remove(attempt), (e: any) => e.status === 0)
  const calls = f.calls.length, writes = f.writes().length
  const recovered = await createPhoneConfigService(f.bound).operation(JSON.parse(JSON.stringify(attempt)))
  assert.equal(recovered.key, attempt.key); assert.equal(recovered.kind, kind); assert.equal(recovered.result.deleted, kind === 'delete'); assert.equal(f.writes().length, writes); assert.equal(f.calls.length, calls)
})

test('GET404 does not create a receipt or any effect; original session authority is required after role ABA', async t => {
  const f = await phoneUIFixture(t), attempt = phoneAttempt('create')
  await assert.rejects(f.service.operation(attempt), (e: any) => e.status === 404); assert.equal(f.calls.length, 0); assert.equal(f.writes().length, 0)
  const created = await f.service.create(attempt, { name: 'Original', number: phone, providerNumberId: sid })
  f.aba(); await assert.rejects(f.service.operation(attempt), (e: any) => e.code === 'context_mismatch')
  await f.refreshContext(); const r = await f.request('GET', '/operations/' + attempt.key); assert.equal(r.statusCode, 404)
  assert.equal(f.store.get(f.tenant, 'phone-numbers', created.operation.numberId)!.name, 'Original')
})

test('fresh cookie switched before dispatch cannot save in another organization and late result is discarded', async t => {
  const f = await phoneUIFixture(t), row = await f.seed(), attempt = phoneAttempt('update', row)
  f.loginAs('foreign'); await assert.rejects(f.service.update(attempt, { name: 'Foreign' }), (e: any) => e.code === 'context_mismatch')
  assert.equal(f.store.get(f.tenant, 'phone-numbers', row.id)!.name, row.name)
  f.loginAs('owner'); f.state.after = async (_p, _m, response) => { f.state.current = false; return response }
  await assert.rejects(f.service.get(row.id), (e: any) => e.code === 'superseded')
})

test('strict receipt parser rejects foreign tenant, wrong key/kind/ID/revision/status and never discloses raw fields', async t => {
  const f = await phoneUIFixture(t), row = await f.seed(), attempt = phoneAttempt('update', row)
  const result = await f.service.update(attempt, { name: 'Confirmed' }), good = result.operation
  for (const delta of [{ tenantId: 'foreign' }, { key: 'different-key' }, { kind: 'delete' }, { numberId: 'foreign' }, { status: 'pending' }, { result: { ...good.result, revision: good.result.revision + 1 } }, { result: { ...good.result, deleted: true } }, { automaticRetry: true }]) {
    f.state.after = async () => Response.json({ ...good, ...delta }); await assert.rejects(f.service.operation(attempt), (e: any) => e.code === 'invalid_phone_configuration')
  }
  f.state.after = async () => Response.json({ ...good, secret: 'never-project' }); assert.equal(JSON.stringify(await f.service.operation(attempt)).includes('never-project'), false)
})

test('pagination follows empty pages, rejects cursor loops and duplicate IDs without returning partial lists', async t => {
  const f = await phoneUIFixture(t), row = await f.seed(); let page = 0
  f.state.after = async () => Response.json(++page === 1 ? { items: [], nextCursor: 'cursor-one', limit: 100 } : { items: [row], nextCursor: null, limit: 100 })
  assert.equal((await f.service.list())[0].id, row.id); assert.match(f.requests.at(-1)!.path, /cursor=cursor-one/)
  f.state.after = async () => Response.json({ items: [], nextCursor: 'loop', limit: 100 }); await assert.rejects(f.service.list(), EngineError)
  f.state.after = async () => Response.json({ items: [row, row], nextCursor: null, limit: 100 }); await assert.rejects(f.service.list(), EngineError)
})

test('local validation normalizes supported fields and denies invalid keys/identity before HTTP', async t => {
  const f = await phoneUIFixture(t)
  assert.deepEqual(phonePatch({ name: ' Name ', agentId: null }), { name: 'Name', agentId: null })
  assert.equal(phoneCreate({ name: ' Name ', number: phone, providerNumberId: sid }).name, 'Name')
  assert.equal(validPhoneAttempt({ key: 'valid-key', kind: 'create', number: phone }), false)
  for (const value of [{ name: '' }, { name: 'Name', number: phone }, { agentId: 'a/b' }]) assert.throws(() => phonePatch(value as any), EngineError)
  await assert.rejects(f.service.remove({ key: '../bad', kind: 'delete', numberId: 'a', expectedRevision: 0, expectedVersion: 'a'.repeat(64) }), EngineError)
  assert.equal(f.writes().length, 0); assert.equal(f.calls.length, 0)
})
