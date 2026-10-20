import { parseExpectedContext } from './http'
import { validAirtableAttempt, type AirtableAttempt } from './airtable'
import type { ExpectedContext } from './types'

type RevisionRefusal = 'airtable_admission_revision_conflict' | 'airtable_configuration_changed'
export type AirtableReference = { attempt: AirtableAttempt; createdAt: string; closed: boolean; refusalCode?: RevisionRefusal }
type Journal = { schemaVersion: 1; context: ExpectedContext; entries: AirtableReference[] }
const fail = (): never => { throw Error('Não foi possível verificar as referências locais. Nenhuma nova escrita será iniciada.') }
function opaque(attempt: AirtableAttempt): AirtableAttempt {
  if (!validAirtableAttempt(attempt)) fail()
  return attempt.kind === 'binding.create' ? { kind: attempt.kind, key: attempt.key } : { kind: attempt.kind, key: attempt.key, bindingId: attempt.bindingId, expectedRevision: attempt.expectedRevision }
}
export function createAirtableJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, input: ExpectedContext) {
  const context = parseExpectedContext(input), key = `kloel-airtable:${context.userId}:${context.tenantId}`
  const empty = (): Journal => ({ schemaVersion: 1, context, entries: [] })
  function read(): Journal {
    const serialized = storage.getItem(key); if (serialized === null) return empty()
    let raw: any; try { raw = JSON.parse(serialized) } catch { fail() }
    if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 100) fail()
    if (JSON.stringify(parseExpectedContext(raw.context)) !== JSON.stringify(context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return empty() }
    const entries = raw.entries.map((row: any) => {
      if (!row || !validAirtableAttempt(row.attempt) || typeof row.closed !== 'boolean' || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || Object.keys(row).some(k => !['attempt', 'createdAt', 'closed', 'refusalCode'].includes(k))) fail()
      if (row.refusalCode !== undefined && (!row.closed || (row.refusalCode === 'airtable_admission_revision_conflict' ? row.attempt.kind !== 'record.create' : row.refusalCode !== 'airtable_configuration_changed' || row.attempt.kind !== 'binding.update'))) fail()
      const attempt = opaque(row.attempt); if (Object.keys(row.attempt).sort().join() !== Object.keys(attempt).sort().join()) fail()
      return { attempt, createdAt: row.createdAt, closed: row.closed, ...(row.refusalCode ? { refusalCode: row.refusalCode } : {}) }
    })
    if (new Set(entries.map((r: AirtableReference) => r.attempt.key)).size !== entries.length) fail()
    return { schemaVersion: 1, context, entries }
  }
  function save(value: Journal, assertCurrent: () => void) {
    assertCurrent(); const bytes = JSON.stringify(value); storage.setItem(key, bytes); assertCurrent(); if (storage.getItem(key) !== bytes) fail(); assertCurrent(); return value.entries
  }
  return {
    key, read: () => read().entries,
    reserve(input: AirtableAttempt, assertCurrent: () => void) {
      assertCurrent(); const current = read(), attempt = opaque(input), old = current.entries.find(r => r.attempt.key === attempt.key)
      if (old) { if (JSON.stringify(old.attempt) !== JSON.stringify(attempt) || old.closed) fail(); return save(current, assertCurrent) }
      if (current.entries.length >= 100) fail()
      const conflict = current.entries.some(r => !r.closed && (attempt.kind === 'record.create' ? r.attempt.kind === 'record.create' && r.attempt.bindingId === attempt.bindingId : r.attempt.kind !== 'record.create'))
      if (conflict) throw Error('Consulte a referência em aberto. Uma nova chave poderia duplicar o efeito.')
      return save({ ...current, entries: [...current.entries, { attempt, createdAt: new Date().toISOString(), closed: false }] }, assertCurrent)
    },
    close(attempt: AirtableAttempt, assertCurrent: () => void, refusalCode?: RevisionRefusal) {
      assertCurrent(); const current = read(), row = current.entries.find(r => r.attempt.key === attempt.key)
      if (!row || JSON.stringify(row.attempt) !== JSON.stringify(opaque(attempt))) fail()
      if (refusalCode !== undefined && (refusalCode === 'airtable_admission_revision_conflict' ? attempt.kind !== 'record.create' : refusalCode !== 'airtable_configuration_changed' || attempt.kind !== 'binding.update')) fail()
      return save({ ...current, entries: current.entries.map(r => r === row ? { attempt: r.attempt, createdAt: r.createdAt, closed: true, ...(refusalCode ? { refusalCode } : {}) } : r) }, assertCurrent)
    },
  }
}
