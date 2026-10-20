import { EngineError } from './http'
import type { EngineContext } from './session'

export type BookingRescheduleAttempt = { key: string; kind: 'booking.reschedule'; bookingRef: string; expectedRevision: number }
export type BookingTime = { startAt: string; endAt: string }
export type RescheduleSlot = BookingTime & { quote: string; expiresAt: number }
export type RescheduleSlots = { bookingRef: string; expectedRevision: number; timezone: string; slots: RescheduleSlot[]; complete: boolean; nextFrom?: string; remoteAvailabilityComplete: true; reservationsGuaranteed: false }
export type RescheduleOperation = BookingRescheduleAttempt & { reservedRevision: number; originalTime: BookingTime; requestedTime: BookingTime; status: 'pending' | 'unknown' | 'not_sent' | 'not_applied' | 'accepted' | 'succeeded'; effect: 'unconfirmed' | 'not_sent' | 'not_applied' | 'patch_accepted' | 'target_confirmed'; needsReconciliation: boolean; errorCode: string | null; automaticRetry: false; notifications: 'not_sent'; createdAt: string; updatedAt: string }
export type RescheduleRange = { bookingRef: string; expectedRevision: number; from: string; to: string }
export type RescheduleCapability = { supported: boolean; eligible: boolean; reason: 'provider_unsupported' | 'booking_state' | 'configuration_unavailable' | null }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const stamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v))
const quote = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v)
function invalid(): never { throw new EngineError(0, 'invalid_booking_reschedule', 'Os dados de reagendamento recebidos são inválidos. Nenhum pedido será repetido.') }
function time(v: unknown): BookingTime { if (!object(v) || !stamp(v.startAt) || !stamp(v.endAt) || Date.parse(v.startAt) >= Date.parse(v.endAt)) invalid(); return { startAt: v.startAt, endAt: v.endAt } }
export function validRescheduleAttempt(v: unknown): v is BookingRescheduleAttempt { return object(v) && Object.keys(v).sort().join() === 'bookingRef,expectedRevision,key,kind' && v.kind === 'booking.reschedule' && uuid(v.key) && uuid(v.bookingRef) && revision(v.expectedRevision) }
export function bookingRescheduleAttempt(booking: { bookingRef: string; revision: number }, key = crypto.randomUUID()): BookingRescheduleAttempt {
  const a: BookingRescheduleAttempt = { key, kind: 'booking.reschedule', bookingRef: booking.bookingRef, expectedRevision: booking.revision }; if (!validRescheduleAttempt(a)) invalid(); return Object.freeze(a)
}
export function parseRescheduleCapability(v: unknown): RescheduleCapability | undefined {
  if (v === undefined) return undefined
  if (!object(v) || typeof v.supported !== 'boolean' || typeof v.eligible !== 'boolean' || v.eligible && !v.supported || ![null, 'provider_unsupported', 'booking_state', 'configuration_unavailable'].includes(v.reason as any) || v.eligible && v.reason !== null) invalid()
  return { supported: v.supported, eligible: v.eligible, reason: v.reason as RescheduleCapability['reason'] }
}
export function parseRescheduleSlots(raw: unknown, range: RescheduleRange): RescheduleSlots {
  if (!object(raw) || raw.bookingRef !== range.bookingRef || raw.expectedRevision !== range.expectedRevision || typeof raw.timezone !== 'string' || !Array.isArray(raw.slots) || raw.slots.length > 200 || typeof raw.complete !== 'boolean' || raw.remoteAvailabilityComplete !== true || raw.reservationsGuaranteed !== false) invalid()
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: raw.timezone }) } catch { invalid() }
  const slots = raw.slots.map((v): RescheduleSlot => { const w = time(v); if (!object(v) || !quote(v.quote) || !Number.isSafeInteger(v.expiresAt) || Number(v.expiresAt) <= 0 || Date.parse(w.startAt) < Date.parse(range.from) || Date.parse(w.endAt) > Date.parse(range.to)) invalid(); return { ...w, quote: v.quote, expiresAt: Number(v.expiresAt) } })
  if (new Set(slots.map(s => s.quote)).size !== slots.length || slots.some((s, i) => i > 0 && Date.parse(s.startAt) <= Date.parse(slots[i - 1].startAt))) invalid()
  if (raw.complete ? raw.nextFrom !== undefined : !stamp(raw.nextFrom) || Date.parse(raw.nextFrom) <= Date.parse(range.from) || Date.parse(raw.nextFrom) >= Date.parse(range.to) || slots.length > 0 && Date.parse(raw.nextFrom) <= Date.parse(slots.at(-1)!.startAt)) invalid()
  return { bookingRef: range.bookingRef, expectedRevision: range.expectedRevision, timezone: raw.timezone, slots, complete: raw.complete, ...(raw.nextFrom ? { nextFrom: raw.nextFrom as string } : {}), remoteAvailabilityComplete: true, reservationsGuaranteed: false }
}
export function parseRescheduleOperation(raw: unknown, a: BookingRescheduleAttempt): RescheduleOperation {
  if (!validRescheduleAttempt(a) || !object(raw) || raw.key !== a.key || raw.kind !== a.kind || raw.bookingRef !== a.bookingRef || raw.expectedRevision !== a.expectedRevision || !revision(raw.reservedRevision) || raw.reservedRevision !== a.expectedRevision + 1 || typeof raw.needsReconciliation !== 'boolean' || raw.automaticRetry !== false || raw.notifications !== 'not_sent' || !stamp(raw.createdAt) || !stamp(raw.updatedAt) || raw.errorCode !== null && (typeof raw.errorCode !== 'string' || !/^[a-zA-Z0-9_:-]{1,100}$/.test(raw.errorCode))) invalid()
  const effects = { pending: 'unconfirmed', unknown: 'unconfirmed', not_sent: 'not_sent', not_applied: 'not_applied', accepted: 'patch_accepted', succeeded: 'target_confirmed' } as const, status = raw.status as RescheduleOperation['status']
  if (!Object.hasOwn(effects, status) || raw.effect !== effects[status] || ['pending', 'unknown', 'accepted'].includes(status) && !raw.needsReconciliation || status === 'succeeded' && raw.needsReconciliation) invalid()
  const originalTime = time(raw.originalTime), requestedTime = time(raw.requestedTime)
  if (originalTime.startAt === requestedTime.startAt || Date.parse(originalTime.endAt) - Date.parse(originalTime.startAt) !== Date.parse(requestedTime.endAt) - Date.parse(requestedTime.startAt)) invalid()
  return { ...a, reservedRevision: raw.reservedRevision, originalTime, requestedTime, status, effect: effects[status], needsReconciliation: raw.needsReconciliation, errorCode: raw.errorCode as string | null, automaticRetry: false, notifications: 'not_sent', createdAt: raw.createdAt, updatedAt: raw.updatedAt }
}
export function rescheduleTerminal(o: RescheduleOperation) { return !o.needsReconciliation && ['not_sent', 'not_applied', 'succeeded'].includes(o.status) }
export function bookingRescheduleClient(context: EngineContext) {
  return {
    async slots(range: RescheduleRange, signal?: AbortSignal) {
      context.assertCurrent(); if (!uuid(range.bookingRef) || !revision(range.expectedRevision) || !stamp(range.from) || !stamp(range.to) || Date.parse(range.to) <= Date.parse(range.from) || Date.parse(range.to) - Date.parse(range.from) > 7 * 86400000) invalid()
      const raw = await context.request(`/scheduling/bookings/${range.bookingRef}/reschedule-slots`, { method: 'POST', signal, body: { expectedTenantId: context.tenantId, expectedRevision: range.expectedRevision, from: range.from, to: range.to } }); context.assertCurrent(); return parseRescheduleSlots(raw, range)
    },
    async reschedule(a: BookingRescheduleAttempt, selected: RescheduleSlot, original: BookingTime) {
      context.assertCurrent(); if (!validRescheduleAttempt(a) || !quote(selected.quote) || !Number.isSafeInteger(selected.expiresAt) || selected.expiresAt <= Date.now()) invalid(); time(selected); time(original)
      const raw = await context.request(`/scheduling/bookings/${a.bookingRef}/reschedule`, { method: 'POST', idempotencyKey: a.key, body: { expectedTenantId: context.tenantId, expectedRevision: a.expectedRevision, quote: selected.quote, confirm: true } }); context.assertCurrent()
      if (!object(raw) || typeof raw.replayed !== 'boolean') invalid()
      const operation = parseRescheduleOperation(raw.operation, a)
      if (operation.requestedTime.startAt !== selected.startAt || operation.requestedTime.endAt !== selected.endAt || operation.originalTime.startAt !== original.startAt || operation.originalTime.endAt !== original.endAt) invalid()
      return { operation, replayed: raw.replayed }
    },
    async operation(a: BookingRescheduleAttempt) { context.assertCurrent(); if (!validRescheduleAttempt(a)) invalid(); const raw = await context.request(`/scheduling/reschedule-operations/${a.key}`); context.assertCurrent(); return parseRescheduleOperation(raw, a) },
  }
}
