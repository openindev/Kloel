import { parseExpectedContext } from './http'
import { validSheetAttempt, type SheetAttempt } from './sheets'
import type { ExpectedContext } from './types'

export type SheetTerminal = 'succeeded' | 'appended' | 'not_sent' | 'sheets_admission_revision_conflict' | 'spreadsheet_configuration_changed'
export type SheetReference = { attempt: SheetAttempt; createdAt: string; closed: boolean; terminal?: SheetTerminal }
type Journal = { schemaVersion: 1; context: ExpectedContext; entries: SheetReference[] }
const fail = (): never => { throw Error('Não foi possível verificar as referências locais. Nenhuma nova escrita será iniciada.') }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function terminalAllowed(a: SheetAttempt, terminal: unknown): terminal is SheetTerminal {
  return a.kind === 'rows.append' ? ['appended', 'not_sent', 'sheets_admission_revision_conflict'].includes(String(terminal)) : terminal === 'succeeded' || terminal === 'spreadsheet_configuration_changed' && a.kind !== 'binding.create'
}
function opaque(a: SheetAttempt): SheetAttempt {
  if (!validSheetAttempt(a)) fail()
  return { key: a.key, kind: a.kind, connectionId: a.connectionId, ...(a.kind === 'binding.create' ? {} : { bindingId: a.bindingId, expectedRevision: a.expectedRevision }), ...(a.kind === 'binding.set_enabled' ? { enabled: a.enabled } : {}) } as SheetAttempt
}
export function createSheetsJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, input: ExpectedContext) {
  const context = parseExpectedContext(input), key = `kloel-sheets:${context.userId}:${context.tenantId}`
  if (!context.tenantId || !context.membershipId) fail()
  function read(): Journal {
    const text = storage.getItem(key); if (text === null) return { schemaVersion: 1, context, entries: [] }
    let raw: any; try { raw = JSON.parse(text) } catch { fail() }
    if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 100 || Object.keys(raw).some(k => !['schemaVersion', 'context', 'entries'].includes(k))) fail()
    const old = parseExpectedContext(raw.context)
    if (Object.keys(raw.context).sort().join() !== Object.keys(context).sort().join()) fail()
    if (!same(old, context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return { schemaVersion: 1, context, entries: [] } }
    const entries: SheetReference[] = raw.entries.map((r: any) => {
      if (!r || !validSheetAttempt(r.attempt) || typeof r.closed !== 'boolean' || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt)) || Object.keys(r).some(k => !['attempt', 'createdAt', 'closed', 'terminal'].includes(k)) || r.terminal !== undefined && !terminalAllowed(r.attempt, r.terminal) || r.closed && !r.terminal) fail()
      return { attempt: opaque(r.attempt), createdAt: r.createdAt, closed: r.closed, ...(r.terminal === undefined ? {} : { terminal: r.terminal }) }
    })
    const open = entries.filter(e => !e.closed), append = open.filter(e => e.attempt.kind === 'rows.append')
    if (new Set(entries.map(e => e.attempt.key)).size !== entries.length || open.filter(e => e.attempt.kind !== 'rows.append').length > 1 || new Set(append.map(e => (e.attempt as Extract<SheetAttempt, { kind: 'binding.update' | 'rows.append' }>).bindingId)).size !== append.length) fail()
    return { schemaVersion: 1, context, entries }
  }
  function save(next: Journal, assertCurrent: () => void) { assertCurrent(); const bytes = JSON.stringify(next); storage.setItem(key, bytes); assertCurrent(); if (storage.getItem(key) !== bytes) fail(); assertCurrent(); return next.entries }
  return {
    key, read: () => read().entries,
    reserve(input: SheetAttempt, assertCurrent: () => void) {
      assertCurrent(); const current = read(), attempt = opaque(input), old = current.entries.find(r => r.attempt.key === attempt.key)
      if (old) { if (!same(old.attempt, attempt) || old.closed || old.terminal) fail(); return save(current, assertCurrent) }
      if (current.entries.length >= 100 || current.entries.some(r => !r.closed && (attempt.kind === 'rows.append' ? r.attempt.kind === 'rows.append' && r.attempt.bindingId === attempt.bindingId : r.attempt.kind !== 'rows.append'))) throw Error('Consulte a referência em aberto. Uma nova chave poderia duplicar o efeito.')
      return save({ ...current, entries: [...current.entries, { attempt, createdAt: new Date().toISOString(), closed: false }] }, assertCurrent)
    },
    terminal(input: SheetAttempt, terminal: SheetTerminal, assertCurrent: () => void) {
      assertCurrent(); const current = read(), attempt = opaque(input), old = current.entries.find(r => r.attempt.key === attempt.key)
      if (!old || !same(old.attempt, attempt) || !terminalAllowed(attempt, terminal) || old.terminal && old.terminal !== terminal) fail()
      return save({ ...current, entries: current.entries.map(r => r === old ? { ...r, terminal } : r) }, assertCurrent)
    },
    close(input: SheetAttempt, assertCurrent: () => void) {
      assertCurrent(); const current = read(), attempt = opaque(input), old = current.entries.find(r => r.attempt.key === attempt.key)
      if (!old || !same(old.attempt, attempt) || !old.terminal) fail()
      return save({ ...current, entries: current.entries.map(r => r === old ? { ...r, closed: true } : r) }, assertCurrent)
    },
  }
}
