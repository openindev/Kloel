import test from 'node:test'
import assert from 'node:assert/strict'
import { createCRMImportJournal } from '../src/services/engine/crm-import-journal'
import type { ImportAttempt } from '../src/services/engine/crm-import'
const context = { userId: 'journal-user', tenantId: 'journal-tenant', membershipId: 'journal-member', authorityVersion: 'a'.repeat(64) }
const attempt = (n = 1): ImportAttempt => ({ key: `import-operation-${n}`, optionsDigest: 'b'.repeat(64), previewFingerprint: n.toString(16).padStart(64, '0') })
const current = () => {}
function storage() { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }

test('opaque journal survives remount, refuses competing keys and clears only exact active metadata', () => {
  const port = storage(), first = createCRMImportJournal(port, context); first.reserve(attempt(), current)
  const second = createCRMImportJournal(port, context); assert.deepEqual(second.read().active, attempt())
  assert.throws(() => second.reserve(attempt(2), current)); assert.throws(() => second.clear(attempt(2), current))
  const saved = port.getItem(first.key)!; for (const forbidden of ['fileName', 'contacts', 'bundle', 'notes', 'token']) assert.equal(saved.includes(forbidden), false)
  assert.throws(() => second.reserve({ ...attempt(), filename: 'private.csv' } as any, current))
  assert.equal(second.clear(attempt(), current).reviewRequired, true); assert.equal(second.read().active, null)
})

test('archive retains old pointer and requires fresh reviewed fingerprint before a new reserve', () => {
  const port = storage(), journal = createCRMImportJournal(port, context); journal.reserve(attempt(), current); const archived = journal.archive(attempt(), current)
  assert.equal(archived.active, null); assert.deepEqual(archived.archived[0].attempt, attempt()); assert.equal(archived.reviewRequired, true)
  assert.throws(() => journal.reserve(attempt(2), current)); journal.acknowledgePreview(attempt(2).previewFingerprint, current)
  assert.throws(() => journal.reserve(attempt(3), current)); journal.reserve(attempt(2), current); assert.deepEqual(journal.read().archived[0].attempt, attempt())
})

test('storage refusal/readback mismatch or authority change prevents safe reservation without evicting references', () => {
  const port = storage(), journal = createCRMImportJournal(port, context); journal.reserve(attempt(), current)
  const original = port.getItem(journal.key); const broken = createCRMImportJournal({ ...port, setItem: () => {} }, context)
  assert.throws(() => broken.archive(attempt(), current)); assert.equal(port.getItem(journal.key), original)
  assert.throws(() => journal.clear(attempt(), () => { throw Error('Authority changed') })); assert.equal(port.getItem(journal.key), original)
  const other = createCRMImportJournal(port, { ...context, authorityVersion: 'c'.repeat(64) }); assert.equal(other.read().active, null); assert.equal(port.getItem(journal.key), original)
  port.setItem(journal.key, JSON.stringify({ ...JSON.parse(original!), active: { ...attempt(), notes: 'forbidden PII' } })); assert.throws(() => journal.read())
})

test('archive cap preserves all 100 entries and the pending reference, with no silent eviction', () => {
  const port = storage(), journal = createCRMImportJournal(port, context)
  for (let n = 1; n <= 100; n++) { journal.acknowledgePreview(attempt(n).previewFingerprint, current); journal.reserve(attempt(n), current); journal.archive(attempt(n), current) }
  journal.acknowledgePreview(attempt(101).previewFingerprint, current); journal.reserve(attempt(101), current); const before = port.getItem(journal.key)
  assert.throws(() => journal.archive(attempt(101), current)); assert.equal(port.getItem(journal.key), before); assert.equal(journal.read().archived.length, 100); assert.deepEqual(journal.read().active, attempt(101))
})
