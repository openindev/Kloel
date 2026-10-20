import { parseExpectedContext } from './http'
import { bookingOperationTerminal, validBookingAttempt, parseBookingOperation, type BookingCancellationAttempt, type BookingOperation } from './booking-operations'
import type { ExpectedContext } from './types'

export type BookingOperationReference = { attempt: BookingCancellationAttempt; createdAt: string; closed: boolean; resolution?: 'not_sent' | 'not_applied' | 'succeeded' | 'booking_cancel_admission_revision_conflict' }
type Journal = { schemaVersion: 1; context: ExpectedContext; entries: BookingOperationReference[] }
function fail(): never { throw Error('Não foi possível verificar o acompanhamento local. Nenhum cancelamento será enviado.') }
function opaque(attempt: BookingCancellationAttempt) { if (!validBookingAttempt(attempt)) fail(); return { key: attempt.key, kind: attempt.kind, bookingRef: attempt.bookingRef, expectedRevision: attempt.expectedRevision } }
export function createBookingOperationsJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, input: ExpectedContext) {
  const context = parseExpectedContext(input), key = `kloel-booking-operations:${context.userId}:${context.tenantId}`
  if (!context.tenantId || !context.membershipId) fail()
  const empty = (): Journal => ({ schemaVersion: 1, context, entries: [] })
  function read(): Journal {
    const bytes = storage.getItem(key); if (bytes === null) return empty()
    let raw: any; try { raw = JSON.parse(bytes) } catch { fail() }
    if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 100 || Object.keys(raw).some(k => !['schemaVersion', 'context', 'entries'].includes(k))) fail()
    if (JSON.stringify(parseExpectedContext(raw.context)) !== JSON.stringify(context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return empty() }
    const entries = raw.entries.map((row: any): BookingOperationReference => {
      if (!row || !validBookingAttempt(row.attempt) || typeof row.closed !== 'boolean' || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || Object.keys(row).some(k => !['attempt', 'createdAt', 'closed', 'resolution'].includes(k)) || row.closed !== (row.resolution !== undefined) || row.resolution !== undefined && !['not_sent', 'not_applied', 'succeeded', 'booking_cancel_admission_revision_conflict'].includes(row.resolution)) fail()
      return { attempt: opaque(row.attempt), createdAt: row.createdAt, closed: row.closed, ...(row.resolution ? { resolution: row.resolution } : {}) }
    })
    if (new Set(entries.map((row: BookingOperationReference) => row.attempt.key)).size !== entries.length || new Set(entries.filter((row: BookingOperationReference) => !row.closed).map((row: BookingOperationReference) => row.attempt.bookingRef)).size !== entries.filter((row: BookingOperationReference) => !row.closed).length) fail()
    return { schemaVersion: 1, context, entries }
  }
  function save(value: Journal, assertCurrent: () => void) { assertCurrent(); const bytes = JSON.stringify(value); storage.setItem(key, bytes); assertCurrent(); if (storage.getItem(key) !== bytes) fail(); assertCurrent(); return value.entries }
  return {
    key, read: () => read().entries,
    reserve(input: BookingCancellationAttempt, assertCurrent: () => void) {
      assertCurrent(); const current = read(), attempt = opaque(input), previous = current.entries.find(row => row.attempt.key === attempt.key)
      if (previous) { if (previous.closed || JSON.stringify(previous.attempt) !== JSON.stringify(attempt)) fail(); return save(current, assertCurrent) }
      if (current.entries.length >= 100 || current.entries.some(row => !row.closed && row.attempt.bookingRef === attempt.bookingRef)) fail()
      return save({ ...current, entries: [...current.entries, { attempt, createdAt: new Date().toISOString(), closed: false }] }, assertCurrent)
    },
    close(input: BookingCancellationAttempt, result: BookingOperation | 'booking_cancel_admission_revision_conflict', assertCurrent: () => void) {
      assertCurrent(); const current = read(), attempt = opaque(input), row = current.entries.find(item => item.attempt.key === attempt.key)
      if (!row || JSON.stringify(row.attempt) !== JSON.stringify(attempt)) fail()
      const operation = typeof result === 'string' ? undefined : parseBookingOperation(result, attempt)
      if (operation && !bookingOperationTerminal(operation)) fail()
      const resolution = operation ? operation.status as 'not_sent' | 'not_applied' | 'succeeded' : result as 'booking_cancel_admission_revision_conflict'
      if (typeof result === 'string' && result !== 'booking_cancel_admission_revision_conflict' || row.closed && row.resolution !== resolution) fail()
      return save({ ...current, entries: current.entries.map(item => item === row ? { ...item, closed: true, resolution } : item) }, assertCurrent)
    },
  }
}
