import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { validRescheduleAttempt, parseRescheduleOperation, rescheduleTerminal, type BookingRescheduleAttempt, type RescheduleOperation } from './booking-reschedule'

export type RescheduleReference = { attempt: BookingRescheduleAttempt; createdAt: string; closed: boolean; resolution?: 'not_sent' | 'not_applied' | 'succeeded' | 'booking_reschedule_admission_revision_conflict' }
function fail(): never { throw Error('Não foi possível verificar a referência local de reagendamento. Nenhum pedido será enviado.') }
export function createRescheduleJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, input: ExpectedContext) {
  const context = parseExpectedContext(input), key = `kloel-booking-reschedule:${context.userId}:${context.tenantId}`
  if (!context.tenantId || !context.membershipId) fail()
  const attempt = (a: BookingRescheduleAttempt) => { if (!validRescheduleAttempt(a)) fail(); return { key: a.key, kind: a.kind, bookingRef: a.bookingRef, expectedRevision: a.expectedRevision } }
  function read(): RescheduleReference[] {
    const bytes = storage.getItem(key); if (bytes === null) return []
    let value: any; try { value = JSON.parse(bytes) } catch { fail() }
    if (!value || value.schemaVersion !== 1 || Object.keys(value).sort().join() !== 'context,entries,schemaVersion' || !Array.isArray(value.entries) || value.entries.length > 100) fail()
    if (JSON.stringify(parseExpectedContext(value.context)) !== JSON.stringify(context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return [] }
    const entries = value.entries.map((row: any): RescheduleReference => {
      if (!row || !validRescheduleAttempt(row.attempt) || typeof row.closed !== 'boolean' || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || Object.keys(row).some(k => !['attempt', 'createdAt', 'closed', 'resolution'].includes(k)) || row.closed !== (row.resolution !== undefined) || row.resolution !== undefined && !['not_sent', 'not_applied', 'succeeded', 'booking_reschedule_admission_revision_conflict'].includes(row.resolution)) fail()
      return { attempt: attempt(row.attempt), createdAt: row.createdAt, closed: row.closed, ...(row.resolution ? { resolution: row.resolution } : {}) }
    })
    const active = entries.filter((e: RescheduleReference) => !e.closed)
    if (new Set(entries.map((e: RescheduleReference) => e.attempt.key)).size !== entries.length || new Set(active.map((e: RescheduleReference) => e.attempt.bookingRef)).size !== active.length) fail()
    return entries
  }
  function save(entries: RescheduleReference[], fresh: () => void) { fresh(); const bytes = JSON.stringify({ schemaVersion: 1, context, entries }); storage.setItem(key, bytes); fresh(); if (storage.getItem(key) !== bytes) fail(); fresh(); return entries }
  return { key, read,
    reserve(a: BookingRescheduleAttempt, fresh: () => void) {
      fresh(); const entries = read(), next = attempt(a), old = entries.find(e => e.attempt.key === a.key)
      if (old) { if (old.closed || JSON.stringify(old.attempt) !== JSON.stringify(next)) fail(); return save(entries, fresh) }
      if (entries.length >= 100 || entries.some(e => !e.closed && e.attempt.bookingRef === a.bookingRef)) fail()
      return save([...entries, { attempt: next, createdAt: new Date().toISOString(), closed: false }], fresh)
    },
    close(a: BookingRescheduleAttempt, result: RescheduleOperation | 'booking_reschedule_admission_revision_conflict', fresh: () => void) {
      fresh(); const entries = read(), next = attempt(a), old = entries.find(e => e.attempt.key === a.key)
      if (!old || JSON.stringify(old.attempt) !== JSON.stringify(next)) fail()
      const parsed = typeof result === 'string' ? undefined : parseRescheduleOperation(result, a)
      if (parsed ? !rescheduleTerminal(parsed) : result !== 'booking_reschedule_admission_revision_conflict') fail()
      const resolution = (parsed?.status ?? result) as RescheduleReference['resolution']
      if (old.closed && old.resolution !== resolution) fail()
      return save(entries.map(e => e === old ? { ...e, closed: true, resolution } : e), fresh)
    },
  }
}
