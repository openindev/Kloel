import test from 'node:test'
import assert from 'node:assert/strict'
import { projectWhatsApp, loadWhatsApp, createWhatsAppActions, connectWhatsAppBusiness } from '../src/services/casca/whatsapp'
import { createMessagingAdapter } from '../src/services/casca/messaging'
import type { EngineContext } from '../src/services/engine/session'
import type { ConfiguredWhatsAppChannel } from '../src/services/engine/whatsapp-channels'
import type { WhatsAppConnectionVerification } from '../src/services/engine/whatsapp-connection'
const now = '2026-10-19T12:00:00.000Z', expected = { userId: 'owner', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
const channel: ConfiguredWhatsAppChannel = { id: 'channel', tenantId: 'tenant', name: 'Recepção', type: 'whatsapp', provider: 'meta', enabled: true, agentId: 'agent', externalId: '123', address: '+5511999999999', verificationStatus: 'unverified', revision: 1, version: 'a'.repeat(64), createdAt: now, updatedAt: now, readiness: { canEnable: true, reasons: [] } }
const proof: WhatsAppConnectionVerification = { channelId: 'channel', tenantId: 'tenant', version: channel.version, checkedAt: now, status: 'metadata_verified', appId: '789', wabaId: '456', phoneId: '123', token: { valid: true, expiresAt: null, dataAccessExpiresAt: null, scopes: ['whatsapp_business_management'] }, phone: { status: 'CONNECTED', qualityRating: 'GREEN', codeVerificationStatus: 'VERIFIED', nameStatus: 'APPROVED', accountMode: 'LIVE' }, proof: { webhookDelivery: false, messageSending: false } }
const ctx = (request: EngineContext['request']): EngineContext => ({ tenantId: 'tenant', generation: 1, assertCurrent() {}, request })
const memory = () => { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }
const page = (rows: ConfiguredWhatsAppChannel[]) => ({ items: rows, nextCursor: null, limit: 100 })

test('channel configuration alone never proves connected, high quality, traffic counts or connection date', () => {
  const projection = projectWhatsApp('tenant', [channel]), row = projection.whatsappAccounts[0]
  assert.equal(row.status, 'pending'); assert.equal(row.qualityRating, 'unknown'); assert.equal(row.messagesThisMonth, null); assert.equal(row.connectedAt, null)
  assert.equal(projection.phoneNumbers[0].verified, false); assert.deepEqual(projection.phoneNumbers[0].capabilities, ['whatsapp'])
  const confirmed = projectWhatsApp('tenant', [channel], new Map([[channel.id, proof]])); assert.equal(confirmed.whatsappAccounts[0].status, 'connected'); assert.equal(confirmed.whatsappAccounts[0].qualityRating, 'high'); assert.equal(confirmed.phoneNumbers[0].verified, true)
  assert.equal(projectWhatsApp('tenant', [{ ...channel, version: 'b'.repeat(64) }], new Map([[channel.id, proof]])).whatsappAccounts[0].status, 'pending')
  assert.throws(() => projectWhatsApp('foreign', [channel])); assert.throws(() => projectWhatsApp('tenant', [channel, channel]))
  assert.equal(projectWhatsApp('tenant', [{ ...channel, address: null }]).phoneNumbers.length, 0)
});
test('load is read-only by default and explicit verification binds metadata to the current channel version', async () => {
  const calls: string[] = [], context = ctx(async (path, options) => { calls.push(path); if (path.endsWith('/verify-connection')) { assert.deepEqual(options?.body, { expectedTenantId: 'tenant', expectedVersion: channel.version }); return proof as never } return page([channel]) as never })
  assert.equal((await loadWhatsApp(context)).whatsappAccounts[0].status, 'pending'); assert.equal(calls.length, 1)
  assert.equal((await loadWhatsApp(context, { verifyMetadata: true })).whatsappAccounts[0].qualityRating, 'high'); assert.equal(calls.length, 3)
});
test('failed verification cannot fabricate a successful connection and stale context fails the load', async () => {
  let changed = false
  const context = ctx(async path => { if (path.endsWith('/verify-connection')) throw Error('provider refused'); return page([channel]) as never })
  assert.equal((await loadWhatsApp(context, { verifyMetadata: true })).whatsappAccounts[0].status, 'pending')
  context.assertCurrent = () => { if (changed) throw Error('session changed') }
  context.request = async () => { changed = true; return page([channel]) as never }
  await assert.rejects(loadWhatsApp(context), /session changed/)
});
test('lost assignment response resolves the original operation without repeating a mutation or accepting a new value', async () => {
  let writes = 0, operation: any; const storage = memory()
  const context = ctx(async (path, options) => {
    if (options?.method === 'PATCH') { writes++; operation = { key: options.idempotencyKey, kind: 'update', tenantId: 'tenant', channelId: channel.id, status: 'succeeded', automaticRetry: false, createdAt: now, result: { channelId: channel.id, revision: 2, version: 'b'.repeat(64), enabled: true, deleted: false } }; throw Error('response lost') }
    if (path.startsWith('/whatsapp/channel-operations/')) return operation
    return page([{ ...channel, agentId: 'next', revision: 2, version: 'b'.repeat(64) }]) as never
  })
  const actions = createWhatsAppActions(context, expected, storage), account = projectWhatsApp('tenant', [channel]).whatsappAccounts[0]
  await assert.rejects(actions.assign(account, 'next')); await assert.rejects(actions.assign(account, 'agent'), /anterior foi confirmada/); assert.equal(writes, 1)
});
test('unlink disables the active channel before clearing assignment, with distinct confirmed CAS writes', async () => {
  let current = { ...channel }, writes: string[] = []
  const context = ctx(async (path, options) => {
    if (options?.method === 'POST' || options?.method === 'PATCH') {
      assert.equal((options.body as any).expectedVersion, current.version)
      const disable = path.endsWith('/disable'); writes.push(disable ? 'disable' : 'update')
      current = { ...current, enabled: false, agentId: disable ? current.agentId : null, revision: current.revision + 1, version: (disable ? 'b' : 'c').repeat(64), readiness: disable ? current.readiness : { canEnable: false, reasons: ['agent_missing'] } }
      return { replayed: false, operation: { key: options.idempotencyKey, kind: disable ? 'disable' : 'update', tenantId: 'tenant', channelId: channel.id, status: 'succeeded', automaticRetry: false, createdAt: now, result: { channelId: channel.id, revision: current.revision, version: current.version, enabled: false, deleted: false } } } as never
    }
    return (path.endsWith('/channel') ? current : page([current])) as never
  })
  await createWhatsAppActions(context, expected, memory()).assign(projectWhatsApp('tenant', [channel]).whatsappAccounts[0], null)
  assert.deepEqual(writes, ['disable', 'update']); assert.equal(current.agentId, null)
});
test('disconnect removes the backend channel and refreshes only after the confirmed receipt', async () => {
  let removed = false
  const context = ctx(async (path, options) => {
    if (options?.method === 'DELETE') { removed = true; return { replayed: false, operation: { key: options.idempotencyKey, kind: 'delete', tenantId: 'tenant', channelId: channel.id, status: 'succeeded', automaticRetry: false, createdAt: now, result: { channelId: channel.id, revision: 2, version: 'b'.repeat(64), enabled: false, deleted: true } } } as never }
    assert.equal(removed, true); return page([]) as never
  })
  await createWhatsAppActions(context, expected, memory()).disconnect(projectWhatsApp('tenant', [channel]).whatsappAccounts[0]); assert.equal(removed, true)
});
test('real messaging includes selected channel, preserves accepted semantics and does not retry a lost send', async () => {
  let posts = 0; const storage = memory(), context = ctx(async (path, options) => {
    if (options?.method === 'POST') { posts++; assert.equal((options.body as any).channelId, channel.id); throw Error('lost') }
    return { status: 'succeeded', result: { messageId: 'wamid.actual', status: 'accepted' }, automaticRetry: false } as never
  })
  const adapter = createMessagingAdapter(context, expected.userId, () => storage)
  await assert.rejects(adapter.send('whatsapp', '+5511888888888', 'Mensagem', { channelId: channel.id }))
  await assert.rejects(adapter.send('whatsapp', '+5511888888888', 'Outra', { channelId: channel.id }), /anterior foi confirmado/)
  assert.equal(posts, 1); assert.ok(![...storage.data.values()].join('').includes('Mensagem'))
});
test('new signup cannot insert a local account as a substitute for a real Meta handshake', async () => { await assert.rejects(connectWhatsAppBusiness()); });
