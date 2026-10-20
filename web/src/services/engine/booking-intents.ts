import { parseExpectedContext } from './http'
import { validBookingAttempt, type BookingCancellationAttempt } from './booking-operations'
import { validRescheduleAttempt, type BookingRescheduleAttempt } from './booking-reschedule'
import type { ExpectedContext } from './types'

export type BookingIntent = BookingCancellationAttempt | BookingRescheduleAttempt
const same = (a: BookingIntent, b: BookingIntent) => a.key === b.key && a.kind === b.kind && a.bookingRef === b.bookingRef && a.expectedRevision === b.expectedRevision
export function createBookingIntentCoordinator(storage: Pick<Storage, 'getItem' | 'setItem'>, input: ExpectedContext) {
  const context = parseExpectedContext(input), key = `kloel-booking-intents:${context.userId}:${context.tenantId}:${context.authorityVersion}`
  if (!context.tenantId || !context.membershipId) throw Error('Contexto de reservas indisponível.')
  function fail(): never { throw Error('Há acompanhamento de reserva pendente ou armazenamento indisponível. Consulte a referência original antes de outra ação.') }
  const opaque = (a: BookingIntent): BookingIntent => { if (!validBookingAttempt(a) && !validRescheduleAttempt(a)) fail(); return { key: a.key, kind: a.kind, bookingRef: a.bookingRef, expectedRevision: a.expectedRevision } }
  function document(): { entries: BookingIntent[]; released: BookingIntent[] } {
    const bytes = storage.getItem(key); if (bytes === null) return { entries: [], released: [] }
    let value: any; try { value = JSON.parse(bytes) } catch { fail() }
    if (!value || Object.keys(value).sort().join() !== 'context,entries,released,schemaVersion' || value.schemaVersion !== 1 || JSON.stringify(parseExpectedContext(value.context)) !== JSON.stringify(context) || !Array.isArray(value.entries) || !Array.isArray(value.released) || value.entries.length + value.released.length > 100) fail()
    const entries = value.entries.map(opaque), released = value.released.map(opaque)
    if (new Set(entries.map((e: BookingIntent) => e.bookingRef)).size !== entries.length || new Set([...entries, ...released].map((e: BookingIntent) => e.key)).size !== entries.length + released.length) fail()
    return { entries, released }
  }
  const read = () => document().entries
  function save(entries: BookingIntent[], released: BookingIntent[], fresh: () => void) {
    fresh(); const bytes = JSON.stringify({ schemaVersion: 1, context, entries, released }); storage.setItem(key, bytes); fresh(); if (storage.getItem(key) !== bytes) fail(); fresh()
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('kloel-booking-intents-changed', { detail: key }))
    return entries
  }
  return { key, read, wasReleased(a: BookingIntent) { opaque(a); return document().released.some(e => same(e, a)) },
    available(a: BookingIntent) { opaque(a); const old = read().find(e => e.bookingRef === a.bookingRef); if (old && !same(old, a)) fail() },
    claim(a: BookingIntent, fresh: () => void) {
      fresh(); const next = opaque(a), { entries, released } = document(), old = entries.find(e => e.bookingRef === a.bookingRef)
      if (released.some(e => e.key === a.key) || old && !same(old, next) || !old && entries.length + released.length >= 100) fail()
      if (old) { fresh(); return entries }
      return save([...entries, next], released, fresh)
    },
    release(a: BookingIntent, fresh: () => void) {
      fresh(); opaque(a); const { entries, released } = document(), old = entries.find(e => e.bookingRef === a.bookingRef)
      // A late receipt for A must never remove a newer claim B.
      if (!old || !same(old, a)) return entries
      return save(entries.filter(e => e !== old), [...released, old], fresh)
    },
  }
}
// This read/check/write signal is not an atomic inter-tab lock. Server CAS and
// the shared booking lease remain the authority for simultaneous admissions.
export type BookingIntentCoordinator = ReturnType<typeof createBookingIntentCoordinator>
