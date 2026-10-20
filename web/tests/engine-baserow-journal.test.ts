import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBaserowJournal } from '../src/services/engine/baserow-journal'
import type { BaserowAttempt } from '../src/services/engine/baserow'

const expected = { userId: randomUUID(), tenantId: randomUUID(), membershipId: randomUUID(), authorityVersion: 'a'.repeat(64) }
const attempt = (bindingId = randomUUID()): BaserowAttempt => ({ kind: 'row.create', key: randomUUID(), bindingId, expectedRevision: 1 })
function fixture() {
  const map = new Map<string, string>(), storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) }, removeItem: (key: string) => { map.delete(key) } }
  return { map, storage, journal: createBaserowJournal(storage, expected) }
}

test('uncertain row reference survives remount and independently allows an explicit fixed enabled intention', () => {
  const f = fixture(), row = attempt(); f.journal.reserve(row, () => {})
  const reloaded = createBaserowJournal(f.storage, expected)
  assert.throws(() => reloaded.reserve(attempt(row.kind === 'row.create' ? row.bindingId : undefined), () => {}))
  const toggle: BaserowAttempt = { kind: 'binding.set_enabled', key: randomUUID(), bindingId: (row as any).bindingId, expectedRevision: 1, enabled: false }
  reloaded.reserve(toggle, () => {}); assert.deepEqual(createBaserowJournal(f.storage, expected).read()[1].attempt, toggle)
  assert.throws(() => reloaded.reserve({ ...toggle, enabled: true }, () => {}), 'same key cannot silently invert desired action')
  assert.throws(() => reloaded.reserve({ kind: 'binding.create', key: randomUUID() }, () => {}), 'one configuration lane remains locked')
  reloaded.close(toggle, () => {}); assert.equal(reloaded.read()[0].closed, false)
  assert.throws(() => reloaded.reserve(attempt((row as any).bindingId), () => {}), 'closing config does not release unknown row')
  reloaded.close(row, () => {}); reloaded.reserve(attempt((row as any).bindingId), () => {})
  assert.equal(reloaded.read().length, 3)
})

test('only opaque validated metadata is stored; secret/config/value extras are rejected', () => {
  const f = fixture(), row = attempt()
  for (const extra of [{ token: 'private' }, { values: { name: 'private' } }, { configuration: { token: 'private' } }, { expectedTenantId: expected.tenantId }]) assert.throws(() => f.journal.reserve({ ...row, ...extra } as any, () => {}))
  assert.equal(f.storage.getItem(f.journal.key), null)
  f.journal.reserve(row, () => {}); assert.doesNotMatch(f.storage.getItem(f.journal.key)!, /private|token|values|configuration|sessionHash/)
  const raw = JSON.parse(f.storage.getItem(f.journal.key)!); raw.entries[0].attempt.values = { name: 'corrupt' }; f.map.set(f.journal.key, JSON.stringify(raw)); assert.throws(() => f.journal.read())
})

test('refusal whitelist closes only exclusive row admission or local update/toggle conflicts', () => {
  const f = fixture(), row = attempt(); f.journal.reserve(row, () => {})
  assert.throws(() => f.journal.close(row, () => {}, 'baserow_configuration_changed')); assert.equal(f.journal.read()[0].closed, false)
  f.journal.close(row, () => {}, 'baserow_admission_revision_conflict')
  assert.equal(f.journal.read()[0].refusalCode, 'baserow_admission_revision_conflict')
  for (const kind of ['binding.update', 'binding.set_enabled'] as const) {
    const config: BaserowAttempt = { key: randomUUID(), kind, bindingId: randomUUID(), expectedRevision: 2, ...(kind === 'binding.set_enabled' ? { enabled: false } : {}) } as BaserowAttempt
    f.journal.reserve(config, () => {}); assert.throws(() => f.journal.close(config, () => {}, 'baserow_admission_revision_conflict'))
    f.journal.close(config, () => {}, 'baserow_configuration_changed')
  }
  const create: BaserowAttempt = { key: randomUUID(), kind: 'binding.create' }; f.journal.reserve(create, () => {})
  assert.throws(() => f.journal.close(create, () => {}, 'baserow_configuration_changed'))
  assert.throws(() => f.journal.close({ ...row, key: randomUUID() }, () => {}, 'baserow_admission_revision_conflict'))
})

test('failed write/readback/current barriers never authorize sending or discard the open original reference', () => {
  const f = fixture(), first = attempt(); f.storage.setItem = () => {}
  assert.throws(() => f.journal.reserve(first, () => {})); assert.equal(f.journal.read().length, 0)
  const g = fixture(); g.journal.reserve(first, () => {}); const saved = g.storage.getItem(g.journal.key)
  g.storage.setItem = () => { throw Error('quota') }; assert.throws(() => g.journal.close(first, () => {})); assert.equal(g.storage.getItem(g.journal.key), saved)
  const h = fixture(); let checks = 0
  assert.throws(() => h.journal.reserve(first, () => { if (++checks === 3) throw Error('revoked') }))
  assert.equal(h.journal.read().length, 1, 'reference written before revocation remains tracked, caller saw failure and cannot send')
  const j = fixture(); j.journal.reserve(first, () => {}); const originalSet = j.storage.setItem
  j.storage.setItem = (key, value) => originalSet(key, value.replace('"closed":true', '"closed":false'))
  assert.throws(() => j.journal.close(first, () => {})); assert.equal(j.journal.read()[0].closed, false)
})

test('same authority re-instantiation preserves references; different membership/authority never adopts them', () => {
  const f = fixture(); f.journal.reserve(attempt(), () => {})
  assert.equal(createBaserowJournal(f.storage, { ...expected }).read().length, 1)
  assert.equal(createBaserowJournal(f.storage, { ...expected, authorityVersion: 'b'.repeat(64) }).read().length, 0)
  f.journal.reserve(attempt(), () => {})
  assert.equal(createBaserowJournal(f.storage, { ...expected, membershipId: randomUUID() }).read().length, 0)
  assert.throws(() => createBaserowJournal(f.storage, { ...expected, tenantId: null, membershipId: null }))
})

test('capacity and malformed storage fail closed without eviction, false closure or competing open intents', () => {
  const f = fixture(); for (let i = 0; i < 100; i++) f.journal.reserve(attempt(), () => {})
  const saved = f.storage.getItem(f.journal.key); assert.throws(() => f.journal.reserve(attempt(), () => {})); assert.equal(f.storage.getItem(f.journal.key), saved)
  const g = fixture(), first = attempt(); g.journal.reserve(first, () => {})
  const raw = JSON.parse(g.storage.getItem(g.journal.key)!)
  raw.entries.push({ ...raw.entries[0], attempt: { ...raw.entries[0].attempt, key: randomUUID() } }); g.map.set(g.journal.key, JSON.stringify(raw)); assert.throws(() => g.journal.read())
  raw.entries.pop(); raw.entries[0].refusalCode = 'baserow_admission_revision_conflict'; g.map.set(g.journal.key, JSON.stringify(raw)); assert.throws(() => g.journal.read())
  g.map.set(g.journal.key, '{broken'); assert.throws(() => g.journal.read())
})
