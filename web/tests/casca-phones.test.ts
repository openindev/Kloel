import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhoneActions, createCallerVerification, loadPhones, projectPhones, createSipNumber, purchaseNumber } from '../src/services/casca/phones'
import type { EngineContext } from '../src/services/engine/session'
import type { ConfiguredPhone } from '../src/services/engine/phone-config'
import type { CallerId, OwnedPhone } from '../src/services/engine/phones'
const now = '2026-10-19T12:00:00.000Z', pn = 'PN' + '1'.repeat(32), phone = '+551155555555'
const expected = { userId: 'owner', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
const owned: OwnedPhone = { sid: pn, phoneNumber: phone, friendlyName: 'Número real', capabilities: { voice: true }, status: 'in-use', configuredVoiceWebhook: false }
const caller: CallerId = { sid: 'PN' + '2'.repeat(32), phoneNumber: '+5511999999999', friendlyName: 'Importado', verified: true, outboundOnly: true, inboundRoutingConfigured: false }
const configured: ConfiguredPhone = { id: 'local', tenantId: 'tenant', createdAt: now, updatedAt: now, name: 'Recepção', number: phone, provider: 'twilio', providerNumberId: pn, agentId: 'agent', channelId: null, capabilities: ['voice'], provisioningStatus: 'unverified', revision: 1, version: 'a'.repeat(64), ownership: { source: 'twilio', checkedAt: now, scope: 'registration' } }
const context = (request: EngineContext['request']): EngineContext => ({ tenantId: 'tenant', generation: 1, assertCurrent() {}, request })
const memory = () => { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }
function providerPage(items: unknown[]) { return { items, source: 'twilio', providerVerified: true, page: 0, nextPage: null } }
function providerStatus(tenantBound = true, configured = true) { return { scope: 'single-tenant-pilot', tenantBound, providers: { twilioCatalog: { configured, missing: configured ? [] : ['PROVIDER_TENANT_ID'], verifiedLive: false } } } }

test('real inventory merges without invented usage, dates or inbound routing success', () => {
  const rows = projectPhones('tenant', [configured], [owned], [caller])
  assert.equal(rows.length, 2); assert.equal(rows[0].id, configured.id); assert.equal(rows[0].minutesUsed, null); assert.equal(rows[0].enginePhone?.inboundReady, false)
  assert.equal(rows[1].kind, 'imported'); assert.deepEqual(rows[1].capabilities, ['outbound']); assert.equal(rows[1].createdAt, null)
  assert.equal(projectPhones('tenant', [], [owned], [caller])[0].id, 'twilio_' + pn)
  assert.throws(() => projectPhones('other', [configured], [owned], []))
  assert.throws(() => projectPhones('tenant', [{ ...configured, providerNumberId: 'PN' + '3'.repeat(32) }], [owned], []))
});

test('load pages all three inventories and never calls mutations', async () => {
  const calls: string[] = []
  const ctx = context(async (path, options) => { calls.push(path); assert.ok(!options?.method || options.method === 'GET')
    if (path === '/providers/status') return providerStatus() as never
    if (path === '/phone-config/numbers') return { items: [configured], limit: 100, nextCursor: null } as never
    if (path === '/voice/numbers/owned') return providerPage([owned]) as never
    if (path === '/voice/caller-ids') return providerPage([caller]) as never
    throw Error('unexpected')
  })
  assert.equal((await loadPhones(ctx)).phoneNumbers.length, 2); assert.equal(calls.length, 4)
});

test('missing inventory proof never becomes verified and inconsistent pagination fails', async () => {
  assert.equal(projectPhones('tenant', [configured], [], [])[0].verified, false)
  const ctx = context(async path => path === '/providers/status' ? providerStatus() as never : path === '/phone-config/numbers' ? { items: [], limit: 100, nextCursor: null } as never : path === '/voice/caller-ids' ? providerPage([]) as never : { ...providerPage([owned]), nextPage: 1 } as never)
  await assert.rejects(loadPhones(ctx))
});

test('caller validation starts one real call, keeps code only in memory and resumes by GET after reload', async () => {
  const storage = memory(), calls: { path: string; method?: string }[] = []
  let validation: any, verified = false
  const ctx = context(async (path, options) => { calls.push({ path, method: options?.method })
    if (path === '/providers/status') return providerStatus() as never
    if (path === '/voice/caller-ids/validation-requests' && options?.method === 'POST') {
      const body = options.body as any; assert.equal(body.phoneNumber, caller.phoneNumber); assert.equal(body.confirmCall, true)
      validation = { id: 'validation', phoneNumber: caller.phoneNumber, friendlyName: '', status: 'awaiting_confirmation', verified: false, providerCallSid: null, callerIdSid: null, callbackStatus: null, confirmationSource: null, errorCode: null, requiresReconciliation: true, automaticRetry: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      return { ...validation, validationCode: '535353', codeExpiresAt: Date.now() + 60000 } as never
    }
    if (path === '/voice/caller-ids/validation-requests') return { items: [validation] } as never
    if (path.endsWith('/reconcile')) return { ...validation, status: verified ? 'verified' : 'awaiting_confirmation', verified, callerIdSid: verified ? caller.sid : null, requiresReconciliation: !verified } as never
    if (path === '/phone-config/numbers') return { items: [], limit: 100, nextCursor: null } as never
    return providerPage(path === '/voice/caller-ids' ? [caller] : []) as never
  })
  const first = createCallerVerification(ctx, expected, storage), accepted = await first.start(caller.phoneNumber)
  assert.equal(accepted.validationCode, '535353'); assert.ok(![...storage.data.values()].join('').includes('535353')); assert.ok(![...storage.data.values()].join('').includes(caller.phoneNumber))
  const resumed = createCallerVerification(ctx, expected, storage); assert.equal((await resumed.start(caller.phoneNumber)).validationCode, undefined); assert.equal(await resumed.confirm(caller.phoneNumber), false)
  verified = true; assert.equal(await resumed.confirm(caller.phoneNumber), true); assert.equal(storage.data.size, 0)
  assert.equal(calls.filter(call => call.path === '/voice/caller-ids/validation-requests' && call.method === 'POST').length, 1)
});

test('lost caller creation response is recovered without another call and cannot switch recipient', async () => {
  const storage = memory(); let posts = 0, validation: any
  const ctx = context(async (path, options) => {
    if (options?.method === 'POST') { posts++; validation = { id: 'validation', phoneNumber: phone, friendlyName: '', status: 'unknown', verified: false, providerCallSid: null, callerIdSid: null, callbackStatus: null, confirmationSource: null, errorCode: null, requiresReconciliation: true, automaticRetry: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; throw Error('transport lost') }
    return { items: [validation] } as never
  })
  const service = createCallerVerification(ctx, expected, storage); await assert.rejects(service.start(phone)); assert.equal((await service.start(phone)).status, 'unknown'); await assert.rejects(service.start(caller.phoneNumber)); assert.equal(posts, 1)
});

test('local rename recovers original operation after response loss and never repeats mutation', async () => {
  const storage = memory(); let mutation: any, count = 0
  const ctx = context(async (path, options) => {
    if (options?.method === 'PATCH') { count++; mutation = { key: options.idempotencyKey, kind: 'update', tenantId: 'tenant', numberId: 'local', status: 'succeeded', automaticRetry: false, createdAt: now, result: { numberId: 'local', revision: 2, version: 'b'.repeat(64), deleted: false } }; throw Error('lost') }
    if (path === '/providers/status') return providerStatus() as never
    if (path.startsWith('/phone-config/operations/')) return mutation
    if (path === '/phone-config/numbers') return { items: [{ ...configured, name: 'New name', revision: 2, version: 'b'.repeat(64) }], limit: 100, nextCursor: null } as never
    return providerPage(path === '/voice/numbers/owned' ? [owned] : []) as never
  })
  const actions = createPhoneActions(ctx, expected, storage), number = projectPhones('tenant', [configured], [owned], [])[0]
  await assert.rejects(actions.update(number, { name: 'New name' })); await assert.rejects(actions.update(number, { name: 'Different name' }), /anterior foi confirmada/); assert.equal(count, 1)
});

test('unimplemented purchase, release and SIP never create fake inventory or provider requests', async () => {
  let calls = 0; const ctx = context(async () => { calls++; throw Error('unexpected') })
  await assert.rejects(purchaseNumber()); await assert.rejects(createSipNumber()); await assert.rejects(createPhoneActions(ctx, expected, memory()).release(projectPhones('tenant', [], [owned], [])[0])); assert.equal(calls, 0)
});

test('unbound or unconfigured provider keeps local numbers unverified and never queries Twilio', async () => {
  for (const status of [providerStatus(false, false), providerStatus(true, false)]) {
    const calls: string[] = []
    const ctx = context(async path => {
      calls.push(path)
      if (path === '/providers/status') return status as never
      if (path === '/phone-config/numbers') return { items: [configured], limit: 100, nextCursor: null } as never
      throw Error('Twilio must not be queried')
    })
    const { phoneNumbers } = await loadPhones(ctx)
    assert.equal(phoneNumbers.length, 1); assert.equal(phoneNumbers[0].verified, false)
    assert.equal(phoneNumbers[0].enginePhone?.inboundReady, false)
    assert.deepEqual(calls.sort(), ['/phone-config/numbers', '/providers/status'])
  }
})

test('provider status errors and inconsistent status never become empty successful inventories', async () => {
  for (const status of [null, providerStatus(false, true), { ...providerStatus(), scope: 'wrong' }]) {
    let providerReads = 0
    const ctx = context(async path => {
      if (path === '/phone-config/numbers') return { items: [], limit: 100, nextCursor: null } as never
      if (path === '/providers/status') { if (!status) throw Error('status unavailable'); return status as never }
      providerReads++; throw Error('unexpected provider read')
    })
    await assert.rejects(loadPhones(ctx)); assert.equal(providerReads, 0)
  }
})

test('local-only permission path never requests provider status or proof', async () => {
  const calls: string[] = []
  const ctx = context(async path => { calls.push(path); assert.equal(path, '/phone-config/numbers'); return { items: [configured], limit: 100, nextCursor: null } as never })
  const result = await loadPhones(ctx, { verifyProvider: false })
  assert.equal(result.phoneNumbers[0].verified, false); assert.equal(calls.length, 1)
})
