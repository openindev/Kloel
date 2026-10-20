import { parseExpectedContext } from './http'
import { validBaserowAttempt, type BaserowAttempt } from './baserow'
import type { ExpectedContext } from './types'

export type BaserowRevisionRefusal = 'baserow_admission_revision_conflict' | 'baserow_configuration_changed'
export type BaserowReference = { attempt: BaserowAttempt; createdAt: string; closed: boolean; refusalCode?: BaserowRevisionRefusal }
type Journal = { schemaVersion: 1; context: ExpectedContext; entries: BaserowReference[] }
const fail = (): never => { throw Error('Não foi possível verificar as referências locais. Nenhuma nova escrita será iniciada.') }
function opaque(raw: BaserowAttempt): BaserowAttempt {
  if (!validBaserowAttempt(raw)) fail()
  if (raw.kind === 'binding.create') return { key: raw.key, kind: raw.kind }
  return { key: raw.key, kind: raw.kind, bindingId: raw.bindingId, expectedRevision: raw.expectedRevision, ...(raw.kind === 'binding.set_enabled' ? { enabled: raw.enabled } : {}) } as BaserowAttempt
}
function validRefusal(attempt: BaserowAttempt, code: unknown): code is BaserowRevisionRefusal {
  return code === 'baserow_admission_revision_conflict' ? attempt.kind === 'row.create' : code === 'baserow_configuration_changed' && ['binding.update', 'binding.set_enabled'].includes(attempt.kind)
}
export function createBaserowJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, input: ExpectedContext) {
  const context = parseExpectedContext(input), key = `kloel-baserow:${context.userId}:${context.tenantId}`
  if (!context.tenantId || !context.membershipId) fail()
  const empty = (): Journal => ({ schemaVersion: 1, context, entries: [] })
  function read(): Journal {
    const serialized = storage.getItem(key); if (serialized === null) return empty()
    let raw: any; try { raw = JSON.parse(serialized) } catch { fail() }
    if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 100 || Object.keys(raw).some(k => !['schemaVersion', 'context', 'entries'].includes(k))) fail()
    const storedContext = parseExpectedContext(raw.context)
    if (Object.keys(raw.context).sort().join() !== Object.keys(context).sort().join()) fail()
    if (JSON.stringify(storedContext) !== JSON.stringify(context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return empty() }
    const entries: BaserowReference[] = raw.entries.map((row: any) => {
      if (!row || !validBaserowAttempt(row.attempt) || typeof row.closed !== 'boolean' || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || Object.keys(row).some(k => !['attempt', 'createdAt', 'closed', 'refusalCode'].includes(k))) fail()
      if (row.refusalCode !== undefined && (!row.closed || !validRefusal(row.attempt, row.refusalCode))) fail()
      return { attempt: opaque(row.attempt), createdAt: row.createdAt, closed: row.closed, ...(row.refusalCode === undefined ? {} : { refusalCode: row.refusalCode }) }
    })
    if (new Set(entries.map(row => row.attempt.key)).size !== entries.length) fail()
    const openRows = entries.filter(row => !row.closed && row.attempt.kind === 'row.create')
    if (entries.filter(row => !row.closed && row.attempt.kind !== 'row.create').length > 1 || new Set(openRows.map(row => (row.attempt as Extract<BaserowAttempt, { kind: 'row.create' | 'binding.update' }>).bindingId)).size !== openRows.length) fail()
    return { schemaVersion: 1, context, entries }
  }
  function save(value: Journal, assertCurrent: () => void) {
    assertCurrent(); const bytes = JSON.stringify(value); storage.setItem(key, bytes); assertCurrent(); if (storage.getItem(key) !== bytes) fail(); assertCurrent(); return value.entries
  }
  return {
    key, read: () => read().entries,
    reserve(input: BaserowAttempt, assertCurrent: () => void) {
      assertCurrent(); const current = read(), attempt = opaque(input), old = current.entries.find(row => row.attempt.key === attempt.key)
      if (old) { if (JSON.stringify(old.attempt) !== JSON.stringify(attempt) || old.closed) fail(); return save(current, assertCurrent) }
      if (current.entries.length >= 100) fail()
      if (current.entries.some(row => !row.closed && (attempt.kind === 'row.create' ? row.attempt.kind === 'row.create' && row.attempt.bindingId === attempt.bindingId : row.attempt.kind !== 'row.create'))) throw Error('Consulte a referência em aberto. Uma nova chave poderia duplicar o efeito.')
      return save({ ...current, entries: [...current.entries, { attempt, createdAt: new Date().toISOString(), closed: false }] }, assertCurrent)
    },
    close(input: BaserowAttempt, assertCurrent: () => void, refusalCode?: BaserowRevisionRefusal) {
      assertCurrent(); const current = read(), attempt = opaque(input), row = current.entries.find(row => row.attempt.key === attempt.key)
      if (!row || JSON.stringify(row.attempt) !== JSON.stringify(attempt) || refusalCode !== undefined && !validRefusal(attempt, refusalCode) || row.closed && row.refusalCode !== refusalCode) fail()
      return save({ ...current, entries: current.entries.map(item => item === row ? { attempt, createdAt: item.createdAt, closed: true, ...(refusalCode === undefined ? {} : { refusalCode }) } : item) }, assertCurrent)
    },
  }
}
