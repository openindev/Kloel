import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createAirtableJournal } from '../src/services/engine/airtable-journal'
import type { AirtableAttempt } from '../src/services/engine/airtable'
const expected = { userId: 'u', tenantId: 't', membershipId: 'm', authorityVersion: 'a'.repeat(64) }
function fixture() { const map = new Map<string, string>(), storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) }, removeItem: (key: string) => { map.delete(key) } }; return { map, storage, journal: createAirtableJournal(storage, expected) } }
const attempt = (bindingId = randomUUID()): AirtableAttempt => ({ key: randomUUID(), kind: 'record.create', bindingId, expectedRevision: 1 })
test('opaque record references block equivalent new keys across reload while configuration/other bindings remain independent', () => {
  const f = fixture(), first = attempt(); f.journal.reserve({ ...first, token: 'private', values: { name: 'private' } } as any, () => {})
  const reloaded = createAirtableJournal(f.storage, expected); assert.throws(() => reloaded.reserve(attempt((first as any).bindingId), () => {}))
  reloaded.reserve({ kind: 'binding.update', key: randomUUID(), bindingId: (first as any).bindingId, expectedRevision: 1 }, () => {})
  reloaded.reserve(attempt(), () => {}); assert.equal(reloaded.read().length, 3); assert.equal(JSON.stringify([...f.map.values()]).includes('private'), false)
  reloaded.close(first, () => {}); reloaded.reserve(attempt((first as any).bindingId), () => {}); assert.equal(reloaded.read().length, 4)
})
test('write/readback, current-context barriers and capacity fail closed without discarding references', () => {
  const f = fixture(); const first = attempt(); f.storage.setItem = () => {}; assert.throws(() => f.journal.reserve(first, () => {})); assert.equal(f.journal.read().length, 0)
  const other = fixture(); let checks = 0; assert.throws(() => other.journal.reserve(first, () => { if (++checks >= 3) throw Error('revoked') })); assert.equal(other.journal.read().length, 1)
  const full = fixture(); for (let i = 0; i < 100; i++) full.journal.reserve(attempt(), () => {}); assert.throws(() => full.journal.reserve(attempt(), () => {})); assert.equal(full.journal.read().length, 100)
})
test('foreign authority never adopts old references; malformed/duplicated metadata is rejected', () => {
  const f = fixture(); f.journal.reserve(attempt(), () => {}); assert.equal(createAirtableJournal(f.storage, { ...expected, authorityVersion: 'b'.repeat(64) }).read().length, 0)
  f.journal.reserve(attempt(), () => {}); const raw = JSON.parse(f.map.get(f.journal.key)!); raw.entries[0].attempt.values = { private: true }; f.map.set(f.journal.key, JSON.stringify(raw)); assert.throws(() => f.journal.read())
})
test('refusal proofs retain only narrow revision codes and cannot classify generic record errors or another key', () => {
  const f = fixture(), record = attempt(); f.journal.reserve(record, () => {})
  assert.throws(() => f.journal.close(record, () => {}, 'airtable_configuration_changed')); assert.equal(f.journal.read()[0].closed, false)
  f.journal.close(record, () => {}, 'airtable_admission_revision_conflict'); const entries = createAirtableJournal(f.storage, expected).read()
  assert.equal(entries[0].closed, true); assert.equal(entries[0].refusalCode, 'airtable_admission_revision_conflict'); assert.equal(entries[0].attempt.key, record.key)
  const another = attempt(); f.journal.reserve(another, () => {}); assert.equal(f.journal.read()[1].closed, false)
  const raw = JSON.parse(f.map.get(f.journal.key)!); raw.entries[1].refusalCode = 'airtable_admission_revision_conflict'; f.map.set(f.journal.key, JSON.stringify(raw)); assert.throws(() => f.journal.read())
})
