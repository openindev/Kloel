import test from 'node:test'
import assert from 'node:assert/strict'
import { whatsappChannelUIFixture } from './engine-whatsapp-channel-fixture'
import { createWhatsAppChannelsService, whatsappChannelAttempt, whatsappChannelFields, whatsappChannelPatch, whatsappChannelRefusal } from '../src/services/engine/whatsapp-channels'
import { EngineError } from '../src/services/engine/http'

test('private configuration uses five explicit operations, exact versions and local receipts without provider I/O', async t => {
  const f = await whatsappChannelUIFixture(t), a = whatsappChannelAttempt('create')
  const r = await f.service.create(a, { name: ' Canal ', externalId: '12345', address: null, agentId: f.agent.id })
  assert.equal(r.operation.result.enabled, false); let row = await f.service.get(r.operation.channelId)
  assert.equal(row.name, 'Canal'); assert.equal(row.revision, 1); assert.equal(row.verificationStatus, 'unverified')
  const patch = whatsappChannelAttempt('update', row); await f.service.update(patch, { name: 'Renamed' }); row = await f.service.get(row.id)
  for (const kind of ['enable', 'disable'] as const) { const intent = whatsappChannelAttempt(kind, row); const result = await f.service.setEnabled(intent); assert.equal(result.operation.result.enabled, kind === 'enable'); assert.deepEqual(await f.service.operation(intent), result.operation); row = await f.service.get(row.id) }
  const deletion = whatsappChannelAttempt('delete', row); await f.service.remove(deletion); assert.equal((await f.service.operation(deletion)).result.deleted, true)
  assert.equal(f.writes().length, 5); assert.equal(f.calls.length, 0); assert.equal(f.requests.some(v => v.method !== 'GET' && v.path.startsWith('/api/v1/channels')), false)
  for (const w of f.writes()) { assert.ok(w.headers['idempotency-key']); assert.equal(w.body.expectedTenantId, f.tenant); assert.equal(Object.hasOwn(w.body, 'enabled'), false) }
})

test('loss after each configuration write recovers only its original receipt; same phone replacement remains separate', async t => {
  const f = await whatsappChannelUIFixture(t), create = whatsappChannelAttempt('create')
  f.state.lose = 'POST /api/v1/whatsapp/channels'
  await assert.rejects(f.service.create(create, { name: 'Lost', externalId: '12345', address: null, agentId: f.agent.id }))
  const created = await f.service.operation(create); let row = await f.service.get(created.channelId)
  for (const kind of ['update', 'enable', 'disable', 'delete'] as const) {
    const a = whatsappChannelAttempt(kind, row), method = kind === 'update' ? 'PATCH' : kind === 'delete' ? 'DELETE' : 'POST', suffix = ['enable', 'disable'].includes(kind) ? '/' + kind : ''
    f.state.lose = method + ' /api/v1/whatsapp/channels/' + row.id + suffix
    await assert.rejects(kind === 'update' ? f.service.update(a, { name: 'Lost rename' }) : kind === 'delete' ? f.service.remove(a) : f.service.setEnabled(a))
    const before = f.writes().length, receipt = await f.service.operation(a); assert.equal(receipt.kind, kind); assert.equal(f.writes().length, before)
    if (kind !== 'delete') row = await f.service.get(row.id)
  }
  const replacement = await f.create({ name: 'Replacement' })
  assert.notEqual(replacement.row.id, created.channelId); assert.equal((await f.service.operation(create)).channelId, created.channelId)
  assert.equal(f.writes().length, 5); assert.equal(f.calls.length, 0)
})

test('CAS and ABA never rebase old intent; only the specific pre-write refusal is terminal', async t => {
  const f = await whatsappChannelUIFixture(t), row = await f.seed(), old = whatsappChannelAttempt('delete', row)
  await f.updateOther(row, 'Other'); const now = await f.service.get(row.id); await f.updateOther(now, row.name)
  await assert.rejects(f.service.remove(old), e => whatsappChannelRefusal(e, old))
  assert.equal((await f.service.get(row.id)).name, row.name)
  for (const code of ['idempotency_conflict', 'channel_not_ready', 'resource_in_use', 'context_changed_in_flight']) assert.equal(whatsappChannelRefusal(new EngineError(409, code, code), old), false)
  assert.equal(whatsappChannelRefusal(new EngineError(409, 'whatsapp_channel_configuration_changed', ''), whatsappChannelAttempt('create')), false)
  assert.equal(f.calls.length, 0)
})

test('receipt original authority, cross-cookie admission and post-await generation fencing fail closed', async t => {
  const f = await whatsappChannelUIFixture(t), row = await f.seed(), a = whatsappChannelAttempt('update', row)
  await f.service.update(a, { name: 'Receipt' }); f.loginAs('other')
  await assert.rejects(f.service.operation(a), (e: any) => e.code === 'context_mismatch')
  f.loginAs('owner'); f.aba(); await assert.rejects(f.service.operation(a), (e: any) => e.code === 'context_mismatch')
  await f.refreshContext(); const identity = await f.identity()
  const renewed = createWhatsAppChannelsService({ ...f.bound, request: (path, options) => f.bound.request(path, { ...options, expectedContext: identity.context }) })
  // Original bound wrapper deliberately cannot be made to adopt a new stamp via options.
  await assert.rejects(renewed.operation(a))
  f.state.current = false; const before = f.requests.length; await assert.rejects(f.service.get(row.id)); assert.equal(f.requests.length, before)
  const late = createWhatsAppChannelsService({ ...f.bound, assertCurrent() { if (!f.state.current) throw new EngineError(0, 'superseded', '') }, request: async () => { f.state.current = false; return row as any } })
  f.state.current = true; await assert.rejects(late.get(row.id), (e: any) => e.code === 'superseded')
})

test('channel parser keeps unsupported legacy records inspectable and rejects forged scope/readiness/cursors', async t => {
  const f = await whatsappChannelUIFixture(t), row = await f.seed()
  f.store.create(f.tenant, 'channels', { name: 'Legacy', type: 'whatsapp', provider: 'unsupported', enabled: false, agentId: null, configuration: { token: 'never-project', externalId: 'bad' }, verificationStatus: 'unverified' })
  const first = await f.service.list({ limit: 1 }), second = await f.service.list({ limit: 1, cursor: first.nextCursor! })
  assert.equal(first.items[0].provider, 'unsupported'); assert.equal(first.items[0].revision, 0); assert.equal(first.items[0].readiness.canEnable, false); assert.equal(JSON.stringify(first).includes('never-project'), false)
  assert.equal(second.items[0].id, row.id); assert.equal(second.nextCursor, null)
  for (const bad of [{ ...row, tenantId: 'foreign' }, { ...row, revision: -1 }, { ...row, readiness: { canEnable: true, reasons: ['agent_missing'] } }, { ...row, readiness: { canEnable: false, reasons: ['invented'] } }]) {
    const api = createWhatsAppChannelsService({ ...f.bound, request: async () => bad as any }); await assert.rejects(api.get(row.id), EngineError)
  }
  await assert.rejects(f.service.list({ cursor: '../secret' }), EngineError)
})

test('receipt parser validates key kind target version revision and enabled/deleted semantics', async t => {
  const f = await whatsappChannelUIFixture(t), row = await f.seed(), a = whatsappChannelAttempt('enable', row), accepted = (await f.service.setEnabled(a)).operation
  const malformed = [
    { ...accepted, key: crypto.randomUUID() }, { ...accepted, kind: 'disable' }, { ...accepted, channelId: 'foreign' }, { ...accepted, tenantId: 'foreign' },
    ...[{ revision: row.revision }, { version: row.version }, { enabled: false }, { deleted: true }, { channelId: 'foreign' }].map(result => ({ ...accepted, result: { ...accepted.result, ...result } })),
    { ...accepted, automaticRetry: true }, { ...accepted, status: 'pending' },
  ]
  for (const raw of malformed) { const api = createWhatsAppChannelsService({ ...f.bound, request: async () => raw as any }); await assert.rejects(api.operation(a), EngineError) }
  const projected = createWhatsAppChannelsService({ ...f.bound, request: async () => ({ ...accepted, token: 'secret', result: { ...accepted.result, externalId: '12345' } }) as any })
  assert.equal(JSON.stringify(await projected.operation(a)).includes('secret'), false); assert.equal(Object.hasOwn((await projected.operation(a)).result, 'externalId'), false)
})

test('input cannot smuggle enabled, credentials or arbitrary configuration; scope errors stay distinct', async t => {
  const f = await whatsappChannelUIFixture(t)
  assert.throws(() => whatsappChannelFields({ name: 'A', externalId: '12345', agentId: null, address: null, token: 'no' } as any))
  assert.throws(() => whatsappChannelPatch({ enabled: true } as any)); assert.throws(() => whatsappChannelPatch({})); assert.throws(() => whatsappChannelPatch({ address: '123' }))
  assert.deepEqual(whatsappChannelPatch({ name: ' Renamed ' }), { name: 'Renamed' })
  const row = await f.seed(), before = f.requests.length
  await assert.rejects(f.service.update(whatsappChannelAttempt('enable', row), { name: 'bad' })); assert.equal(f.requests.length, before)
  f.loginAs('editor')
  const r = await f.request('POST', '/channels/' + row.id + '/enable', f.control(row), crypto.randomUUID(), 'editor')
  assert.equal(r.statusCode, 403); assert.equal(f.calls.length, 0)
})

