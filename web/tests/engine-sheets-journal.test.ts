import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createSheetsJournal } from '../src/services/engine/sheets-journal'
import type { SheetAttempt } from '../src/services/engine/sheets'

const context = () => ({ userId: randomUUID(), tenantId: randomUUID(), membershipId: randomUUID(), authorityVersion: 'a'.repeat(64) })
const memory = () => { const map = new Map<string, string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } } }
const attempt = (connectionId = randomUUID(), bindingId = randomUUID()): SheetAttempt => ({ key: randomUUID(), kind: 'rows.append', connectionId, bindingId, expectedRevision: 1 })
const fresh = () => {}

test('Sheets journal reserves opaque intent with readback and independent config slot', () => {
  const storage = memory(), c = context(), j = createSheetsJournal(storage, c), a = attempt(); j.reserve(a, fresh)
  const config: SheetAttempt = { ...a, key: randomUUID(), kind: 'binding.set_enabled', enabled: false }; j.reserve(config, fresh)
  assert.throws(() => j.reserve({ ...a, key: randomUUID(), expectedRevision: 99 }, fresh)); assert.throws(() => j.reserve({ key: randomUUID(), kind: 'binding.create', connectionId: randomUUID() }, fresh))
  assert.deepEqual(createSheetsJournal(storage, c).read().map(r => r.attempt), [a, config]); assert.ok(!storage.getItem(j.key)!.includes('rowsText'))
  assert.throws(() => j.reserve({ ...a, rows: [['secret']] } as any, fresh))
})

test('Sheets terminal receipt is not released until explicit close; unknown cannot close', () => {
  const j = createSheetsJournal(memory(), context()), a = attempt(); j.reserve(a, fresh); assert.throws(() => j.close(a, fresh))
  j.terminal(a, 'not_sent', fresh); assert.equal(j.read()[0].closed, false); assert.throws(() => j.reserve({ ...a, key: randomUUID() }, fresh))
  j.close(a, fresh); j.reserve({ ...a, key: randomUUID() }, fresh); assert.equal(j.read().length, 2); assert.equal(j.read()[0].terminal, 'not_sent')
})

test('Sheets refuses generic post-effect conflict as terminal append and mismatched metadata', () => {
  const j = createSheetsJournal(memory(), context()), a = attempt(); j.reserve(a, fresh)
  assert.throws(() => j.terminal(a, 'spreadsheet_configuration_changed', fresh)); assert.throws(() => j.terminal({ ...a, expectedRevision: 2 }, 'appended', fresh))
  j.terminal(a, 'sheets_admission_revision_conflict', fresh); assert.throws(() => j.terminal(a, 'appended', fresh)); assert.equal(j.read()[0].closed, false)
})

test('Sheets storage failure/readback mismatch and authority changes fail closed', () => {
  const s = memory(), c = context(), j = createSheetsJournal(s, c), a = attempt(); s.setItem = () => {}; assert.throws(() => j.reserve(a, fresh))
  const real = memory(), j2 = createSheetsJournal(real, c); let checks = 0; assert.throws(() => j2.reserve(a, () => { if (++checks > 2) throw Error('revoked') })); assert.equal(j2.read().length, 1)
  assert.deepEqual(createSheetsJournal(real, { ...c, authorityVersion: 'b'.repeat(64) }).read(), []); assert.equal(real.getItem(j2.key), null)
})

test('Sheets journal rejects payload injection/corruption and never silently evicts capacity', () => {
  const s = memory(), j = createSheetsJournal(s, context()); for (let i = 0; i < 100; i++) { const a = attempt(); j.reserve(a, fresh); j.terminal(a, 'appended', fresh); j.close(a, fresh) }
  assert.throws(() => j.reserve(attempt(), fresh)); assert.equal(j.read().length, 100)
  const raw = JSON.parse(s.getItem(j.key)!); raw.entries[0].range = 'private-range'; s.setItem(j.key, JSON.stringify(raw)); assert.throws(() => j.read())
})

test('Sheets terminal/readback failures retain original open reference', () => {
  const s = memory(), j = createSheetsJournal(s, context()), a = attempt(); j.reserve(a, fresh); const old = s.getItem(j.key); s.setItem = () => { throw Error('storage full') }
  assert.throws(() => j.terminal(a, 'appended', fresh)); assert.equal(s.getItem(j.key), old); assert.equal(j.read()[0].closed, false)
})
