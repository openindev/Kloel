import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhoneConfigJournal } from '../src/services/engine/phone-config-journal'
import type { PhoneAttempt } from '../src/services/engine/phone-config'
const context = { userId: 'user', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
function fixture() { const entries = new Map<string, string>(); let deny = false; const storage = { getItem: (k: string) => entries.get(k) ?? null, setItem(k: string, v: string) { if (deny) throw Error('Storage denied'); entries.set(k, v) }, removeItem(k: string) { entries.delete(k) } }; return { entries, storage, journal: createPhoneConfigJournal(storage, context), deny: () => { deny = true } } }
const fresh = () => {}, attempt = (key = crypto.randomUUID()): PhoneAttempt => ({ key, kind: 'update', numberId: 'phone-id', expectedVersion: 'b'.repeat(64), expectedRevision: 0 })

test('journal survives remount with opaque original intention, blocks new key and retains terminal history', () => {
  const f = fixture(), a = attempt(); f.journal.reserve(a, fresh)
  const remounted = createPhoneConfigJournal(f.storage, context); assert.deepEqual(remounted.read()[0].attempt, a)
  assert.throws(() => remounted.reserve(attempt(), fresh)); assert.throws(() => remounted.reserve({ ...a, key: crypto.randomUUID(), kind: 'delete' }, fresh))
  remounted.finish(a, 'succeeded', fresh); const b = attempt(); remounted.reserve(b, fresh); assert.equal(remounted.read().length, 2)
  assert.deepEqual(Object.keys(JSON.parse(f.entries.get(f.journal.key)!).entries[0].attempt).sort(), ['expectedRevision', 'expectedVersion', 'key', 'kind', 'numberId'])
})
test('storage failures before reserve or terminal never release an unknown reference', () => {
  const f = fixture(), a = attempt(); f.journal.reserve(a, fresh); f.deny()
  assert.throws(() => f.journal.finish(a, 'succeeded', fresh)); assert.equal(f.journal.read()[0].terminal, undefined)
  assert.throws(() => f.journal.reserve(attempt(), fresh)); assert.equal(f.journal.read().length, 1)
  const empty = fixture(); empty.deny(); assert.throws(() => empty.journal.reserve(a, fresh)); assert.equal(empty.journal.read().length, 0)
})
test('only same attempt can finish; rejection is restricted to update/delete and authority change never adopts history', () => {
  const f = fixture(), a = attempt(); f.journal.reserve(a, fresh)
  assert.throws(() => f.journal.finish({ ...a, expectedRevision: 2 }, 'succeeded', fresh)); f.journal.finish(a, 'phone_configuration_changed', fresh)
  const create: PhoneAttempt = { key: crypto.randomUUID(), kind: 'create' }; f.journal.reserve(create, fresh); assert.throws(() => f.journal.finish(create, 'phone_configuration_changed', fresh))
  const other = createPhoneConfigJournal(f.storage, { ...context, authorityVersion: 'c'.repeat(64) }); assert.deepEqual(other.read(), []); assert.equal(f.storage.getItem(f.journal.key), null)
})
test('readback is required and malformed/private storage fields or capacity cannot be silently discarded', () => {
  const f = fixture(), a = attempt(); let text: string | null = null
  const drop = createPhoneConfigJournal({ getItem: () => text, setItem() {}, removeItem() {} }, context); assert.throws(() => drop.reserve(a, fresh))
  f.storage.setItem(f.journal.key, JSON.stringify({ schemaVersion: 1, context, entries: [{ attempt: { ...a, number: '+551155555555' }, createdAt: new Date().toISOString() }] })); assert.throws(() => f.journal.read())
  f.storage.removeItem(f.journal.key)
  for (let i = 0; i < 100; i++) { const n = attempt(); f.journal.reserve(n, fresh); f.journal.finish(n, 'succeeded', fresh) }
  assert.throws(() => f.journal.reserve(attempt(), fresh)); assert.equal(f.journal.read().length, 100)
})
