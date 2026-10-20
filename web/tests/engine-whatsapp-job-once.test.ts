import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../src/services/engine/http'
import { createWhatsAppJobOnceJournal, createWhatsAppJobOnceService, whatsappJobOnceResolved } from '../src/services/engine/whatsapp-job-once'
const ref = { jobId: 'job-a', expectedVersion: 'a'.repeat(64) }
const op = { jobId: 'job-a', version: 'b'.repeat(64), status: 'sent', executionMode: 'manual_once', replayed: false, automaticRetry: false, externalEffect: 'accepted', localLink: 'linked', messageId: 'message-a', requiresReconciliation: false, errorCode: null }
const envelope = { tenantId: 'tenant-a', jobId: 'job-a', initialVersion: ref.expectedVersion, operation: op }
function fixture() {
  const calls: { path: string; options: any }[] = []; let current = true, result: unknown = envelope
  const context = { tenantId: 'tenant-a', generation: 1, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', '') }, async request<T>(path: string, options: any): Promise<T> { calls.push({ path, options }); return result as T } }
  return { api: createWhatsAppJobOnceService(context), calls, set(value: unknown) { result = value }, revoke() { current = false } }
}
test('once POST uses only captured tenant/job/version and GET retains the original version', async () => {
  const f = fixture(); assert.deepEqual(await f.api.run(ref), op); assert.deepEqual(await f.api.operation(ref), op)
  assert.deepEqual(f.calls, [
    { path: '/whatsapp/jobs/job-a/manual-once', options: { method: 'POST', body: { expectedTenantId: 'tenant-a', expectedVersion: ref.expectedVersion, confirm: true } } },
    { path: '/whatsapp/jobs/job-a/manual-once', options: { query: { expectedVersion: ref.expectedVersion } } },
  ])
})
test('cross-tenant, cross-job and different-original-version receipts cannot be adopted', async () => {
  const f = fixture()
  for (const patch of [{ tenantId: 'tenant-b' }, { jobId: 'job-b' }, { initialVersion: 'c'.repeat(64) }, { operation: { ...op, jobId: 'job-b' } }]) {
    f.set({ ...envelope, ...patch }); await assert.rejects(f.api.operation(ref), /confirmar/)
  }
})
test('malformed or contradictory results cannot release a guarded execution', async () => {
  const f = fixture()
  for (const patch of [{ status: 'invented' }, { version: 'secret' }, { automaticRetry: true }, { executionMode: 'automatic' }, { replayed: null }, { externalEffect: 'unconfirmed' }, { localLink: 'not_linked' }, { messageId: null }, { requiresReconciliation: true }, { errorCode: 'private data https://example.com' }, { status: 'sending', externalEffect: 'unconfirmed', localLink: 'not_linked', messageId: null }]) {
    f.set({ ...envelope, operation: { ...op, ...patch } }); await assert.rejects(f.api.operation(ref), /confirmar/)
  }
})
test('accepted-unlinked remains blocked; known unsent failure is terminal without any retry', async () => {
  const f = fixture(); f.set({ ...envelope, operation: { ...op, status: 'requires_reconciliation', localLink: 'not_linked', messageId: null, requiresReconciliation: true } })
  const unknown = await f.api.operation(ref); assert.equal(whatsappJobOnceResolved(unknown), false)
  for (const externalEffect of ['not_dispatched', 'not_accepted']) {
    f.set({ ...envelope, operation: { ...op, status: 'failed', externalEffect, localLink: 'not_linked', messageId: null } })
    assert.equal(whatsappJobOnceResolved(await f.api.operation(ref)), true)
  }
  assert.ok(f.calls.every(call => !call.options.method))
})
test('GET of sent accepted after conversation deletion remains valid and unresolved without a local link', async () => {
  const f = fixture()
  f.set({ ...envelope, operation: { ...op, status: 'sent', externalEffect: 'accepted', localLink: 'not_linked', messageId: null, requiresReconciliation: true } })
  const result = await f.api.operation(ref)
  assert.equal(result.status, 'sent'); assert.equal(result.externalEffect, 'accepted'); assert.equal(result.localLink, 'not_linked'); assert.equal(whatsappJobOnceResolved(result), false)
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options.method, undefined)
})
test('lost transport is attempted once, and revoked context has zero dispatch', async () => {
  let calls = 0
  const api = createWhatsAppJobOnceService({ tenantId: 'tenant-a', generation: 1, assertCurrent() {}, async request<T>(): Promise<T> { calls++; throw new EngineError(0, 'network_error', 'lost') } })
  await assert.rejects(api.run(ref), /lost/); assert.equal(calls, 1)
  const f = fixture(); f.revoke(); await assert.rejects(f.api.run(ref)); assert.equal(f.calls.length, 0)
})
function journalFixture() {
  const values = new Map<string, string>(), scope = { userId: 'user-a', tenantId: 'tenant-a', membershipId: 'member-a', authorityVersion: 'd'.repeat(64) }
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  return { values, scope, storage, journal: createWhatsAppJobOnceJournal(() => storage, scope) }
}
test('journal stores only original opaque job/version and cannot overwrite a concurrent reference', () => {
  const f = journalFixture(); f.journal.remember(ref); assert.deepEqual(f.journal.read(), ref)
  assert.deepEqual(JSON.parse([...f.values.values()][0]), { version: 2, active: ref, archived: [] })
  const other = { jobId: 'job-b', expectedVersion: 'f'.repeat(64) }
  assert.throws(() => f.journal.remember(other)); assert.throws(() => f.journal.clearResolved(other)); assert.deepEqual(f.journal.read(), ref)
  f.journal.clearResolved(ref); f.journal.remember(other); assert.throws(() => f.journal.clearResolved(ref)); assert.deepEqual(f.journal.read(), other)
})
test('corruption, private fields and silent write loss never silently clear the recovery pointer', () => {
  const f = journalFixture(); f.journal.remember(ref); const name = [...f.values.keys()][0]
  for (const raw of ['corrupt', JSON.stringify({ version: 2, active: { ...ref, text: 'private' }, archived: [] }), JSON.stringify({ version: 2, active: ref, archived: [], recipient: '+5511999999999' })]) {
    f.values.set(name, raw); assert.throws(() => f.journal.read()); assert.throws(() => f.journal.remember(ref)); assert.equal(f.values.get(name), raw)
  }
  const lost = journalFixture(); assert.throws(() => createWhatsAppJobOnceJournal(() => ({ ...lost.storage, setItem() {} }), lost.scope).remember(ref)); assert.equal(lost.values.size, 0)
})
test('new user, tenant, membership or authority cannot adopt the previous recovery pointer', () => {
  const f = journalFixture(); f.journal.remember(ref)
  for (const patch of [{ userId: 'user-b' }, { tenantId: 'tenant-b' }, { membershipId: 'member-b' }, { authorityVersion: 'e'.repeat(64) }]) assert.equal(createWhatsAppJobOnceJournal(() => f.storage, { ...f.scope, ...patch }).read(), undefined)
  assert.deepEqual(f.journal.read(), ref)
})

test('archive frees the active slot without losing A; resume is an exact local move, never an execution', () => {
  const f = journalFixture(), b = { jobId: 'job-b', expectedVersion: 'b'.repeat(64) }
  f.journal.remember(ref); f.journal.archive(ref)
  assert.equal(f.journal.read(), undefined); assert.deepEqual(f.journal.archived(), [ref])
  f.journal.remember(b); assert.throws(() => f.journal.resume(ref)); assert.throws(() => f.journal.archive(ref))
  assert.deepEqual(f.journal.read(), b); assert.deepEqual(f.journal.archived(), [ref])
  f.journal.archive(b)
  const reloaded = createWhatsAppJobOnceJournal(() => f.storage, f.scope)
  assert.equal(reloaded.read(), undefined); assert.deepEqual(reloaded.archived(), [ref, b])
  assert.throws(() => reloaded.resume({ ...ref, expectedVersion: 'f'.repeat(64) }))
  reloaded.resume(ref)
  assert.deepEqual(reloaded.read(), ref); assert.deepEqual(reloaded.archived(), [b])
  reloaded.clearResolved(ref)
  assert.equal(reloaded.read(), undefined); assert.deepEqual(reloaded.archived(), [b])
})

test('same archived job cannot acquire another version or a new execution pointer', () => {
  const f = journalFixture(); f.journal.remember(ref); f.journal.archive(ref)
  for (const candidate of [ref, { ...ref, expectedVersion: 'e'.repeat(64) }]) assert.throws(() => f.journal.remember(candidate))
  assert.deepEqual(f.journal.archived(), [ref]); assert.equal(f.journal.read(), undefined)
  f.journal.resume(ref); assert.throws(() => f.journal.remember(ref)); assert.deepEqual(f.journal.read(), ref)
})

test('twenty simultaneous references are bounded, and terminal cleanup frees capacity without evicting unknowns', () => {
  const f = journalFixture(), refs = Array.from({ length: 20 }, (_, i) => ({ jobId: `job-${i}`, expectedVersion: ref.expectedVersion }))
  for (const entry of refs) { f.journal.remember(entry); f.journal.archive(entry) }
  const before = [...f.values.values()][0]
  assert.throws(() => f.journal.remember({ jobId: 'job-21', expectedVersion: ref.expectedVersion }))
  assert.equal([...f.values.values()][0], before); assert.deepEqual(f.journal.archived(), refs)
  f.journal.resume(refs[0]); assert.equal(f.journal.archived().length, 19)
  f.journal.clearResolved(refs[0]); f.journal.remember({ jobId: 'job-21', expectedVersion: ref.expectedVersion })
  assert.equal(f.journal.archived().length, 19); assert.equal(f.journal.read()?.jobId, 'job-21')
})

test('duplicate jobs, private archived data and oversized journals fail closed without changing storage', () => {
  const f = journalFixture(); f.journal.remember(ref); const name = [...f.values.keys()][0]
  for (const value of [
    { version: 2, active: ref, archived: [ref] },
    { version: 2, active: null, archived: [ref, { ...ref, expectedVersion: 'e'.repeat(64) }] },
    { version: 2, active: null, archived: [{ ...ref, message: 'private content' }] },
    { version: 2, active: null, archived: Array.from({ length: 21 }, (_, i) => ({ ...ref, jobId: `job-${i}` })) },
    { version: 2, archived: [] },
  ]) {
    const raw = JSON.stringify(value); f.values.set(name, raw)
    assert.throws(() => f.journal.read()); assert.throws(() => f.journal.archived()); assert.throws(() => f.journal.archive(ref)); assert.throws(() => f.journal.resume(ref))
    assert.equal(f.values.get(name), raw)
  }
})

test('archive requires verified storage, retains active on write failure, and preserves the durable archive if readback fails after writing', () => {
  const f = journalFixture(); f.journal.remember(ref); const name = [...f.values.keys()][0], original = f.values.get(name)
  for (const setItem of [() => { throw Error('blocked') }, () => {}]) {
    const journal = createWhatsAppJobOnceJournal(() => ({ ...f.storage, setItem }), f.scope)
    assert.throws(() => journal.archive(ref)); assert.equal(f.values.get(name), original)
  }
  let written = false
  const journal = createWhatsAppJobOnceJournal(() => ({ ...f.storage,
    setItem(k, v) { f.storage.setItem(k, v); written = true },
    getItem(k) { if (written) throw Error('readback blocked'); return f.storage.getItem(k) },
  }), f.scope)
  assert.throws(() => journal.archive(ref))
  assert.equal(f.journal.read(), undefined); assert.deepEqual(f.journal.archived(), [ref])
})

test('CAS before writing preserves another consumer’s active pointer and its history', () => {
  const f = journalFixture(); f.journal.remember(ref); const name = [...f.values.keys()][0]
  const b = { jobId: 'job-b', expectedVersion: 'b'.repeat(64) }, other = JSON.stringify({ version: 2, active: b, archived: [ref] })
  let reads = 0
  const journal = createWhatsAppJobOnceJournal(() => ({ ...f.storage, getItem(k) { if (++reads === 2) f.values.set(k, other); return f.storage.getItem(k) } }), f.scope)
  assert.throws(() => journal.archive(ref)); assert.equal(f.values.get(name), other)
  assert.deepEqual(f.journal.read(), b); assert.deepEqual(f.journal.archived(), [ref]); assert.throws(() => f.journal.clearResolved(ref))
})

test('archive projections are defensive and authority changes cannot adopt stored history', () => {
  const f = journalFixture(); f.journal.remember(ref); f.journal.archive(ref)
  const copy = f.journal.archived(); copy[0].jobId = 'tampered'; copy.push({ ...ref, jobId: 'injected' })
  assert.deepEqual(f.journal.archived(), [ref])
  for (const patch of [{ userId: 'user-b' }, { tenantId: 'tenant-b' }, { membershipId: 'member-b' }, { authorityVersion: 'e'.repeat(64) }]) {
    const journal = createWhatsAppJobOnceJournal(() => f.storage, { ...f.scope, ...patch })
    assert.deepEqual(journal.archived(), []); assert.throws(() => journal.resume(ref))
  }
  assert.deepEqual(f.journal.archived(), [ref])
})
