import { EngineError } from './http'
import { parseRescheduleCapability, type RescheduleCapability } from './booking-reschedule'
import type { EngineContext } from './session'

export type BookingCancellationAttempt = { key: string; kind: 'booking.cancel'; bookingRef: string; expectedRevision: number; reason?: string }
export type BookingOperationStatus = 'pending' | 'not_sent' | 'not_applied' | 'unknown' | 'accepted' | 'succeeded'
export type BookingNotifications = 'not_sent' | 'provider_managed_unknown'
export type BookingOperation = BookingCancellationAttempt & { reservedRevision: number; status: BookingOperationStatus; effect: 'not_sent' | 'not_applied' | 'unconfirmed' | 'delete_accepted' | 'event_absent'; errorCode: string | null; needsReconciliation: boolean; automaticRetry: false; createdAt: string; updatedAt: string; notifications: BookingNotifications }
export type OperatorBooking = { bookingRef: string; pageId?: string; revision: number; status: string; startAt: string; endAt: string; timezone: string; requestedTime?: { startAt: string; endAt: string }; needsReconciliation: boolean; notifications: BookingNotifications; adminCancellation: { supported: boolean; eligible: boolean }; adminRescheduling?: RescheduleCapability
  invitee?: { name: string; email: string; phone: string }; source?: 'agent' | 'booking_page'; cancelReason?: string; meetingUrl?: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const validNotifications = (value: unknown): value is BookingNotifications => value === 'not_sent' || value === 'provider_managed_unknown'
function invalid(): never { throw new EngineError(0, 'invalid_booking_operation', 'Foi recebida uma referência de reserva inválida. A operação não será repetida.') }
export function validBookingAttempt(value: unknown): value is BookingCancellationAttempt {
  const keys = Object.keys(value ?? {}).sort().join()
  return object(value) && (keys === 'bookingRef,expectedRevision,key,kind' || keys === 'bookingRef,expectedRevision,key,kind,reason' && typeof value.reason === 'string' && value.reason.length > 0 && value.reason.length <= 300) && value.kind === 'booking.cancel' && identifier(value.key) && identifier(value.bookingRef) && revision(value.expectedRevision)
}
export function bookingCancellationAttempt(booking: Pick<OperatorBooking, 'bookingRef' | 'revision'>, key = crypto.randomUUID(), reason = ''): BookingCancellationAttempt {
  const why = reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300)
  const attempt: BookingCancellationAttempt = { key, kind: 'booking.cancel', bookingRef: booking.bookingRef, expectedRevision: booking.revision, ...(why ? { reason: why } : {}) }
  if (!validBookingAttempt(attempt)) invalid()
  return Object.freeze(attempt)
}
export function parseBookingOperation(raw: unknown, attempt: BookingCancellationAttempt): BookingOperation {
  if (!validBookingAttempt(attempt) || !object(raw) || raw.key !== attempt.key || raw.kind !== attempt.kind || raw.bookingRef !== attempt.bookingRef || raw.expectedRevision !== attempt.expectedRevision || !revision(raw.reservedRevision) || raw.reservedRevision !== attempt.expectedRevision + 1 || raw.automaticRetry !== false || !validNotifications(raw.notifications) || !date(raw.createdAt) || !date(raw.updatedAt) || typeof raw.needsReconciliation !== 'boolean' || raw.errorCode !== null && (typeof raw.errorCode !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(raw.errorCode))) invalid()
  const effects: Record<BookingOperationStatus, string[]> = { pending: ['unconfirmed'], not_sent: ['not_sent'], not_applied: ['not_applied'], unknown: ['unconfirmed'], accepted: ['delete_accepted'], succeeded: ['event_absent'] }
  const status = raw.status as BookingOperationStatus
  if (!Object.hasOwn(effects, status) || !effects[status].includes(String(raw.effect)) || ['pending', 'unknown', 'accepted'].includes(status) && !raw.needsReconciliation || ['not_sent', 'not_applied', 'succeeded'].includes(status) && raw.needsReconciliation) invalid()
  return { ...attempt, reservedRevision: raw.reservedRevision as number, status, effect: raw.effect as BookingOperation['effect'], errorCode: raw.errorCode as string | null, needsReconciliation: raw.needsReconciliation as boolean, automaticRetry: false, createdAt: raw.createdAt as string, updatedAt: raw.updatedAt as string, notifications: raw.notifications }
}
export function parseOperatorBooking(raw: unknown): OperatorBooking {
  if (!object(raw) || !identifier(raw.bookingRef) || !revision(raw.revision) || !['pending', 'confirmed', 'unknown', 'failed', 'conflict', 'cancel_pending', 'cancelled', 'reschedule_pending', 'reschedule_unknown', 'reschedule_conflict'].includes(String(raw.status)) || !date(raw.startAt) || !date(raw.endAt) || typeof raw.timezone !== 'string' || raw.needsReconciliation !== undefined && typeof raw.needsReconciliation !== 'boolean' || !validNotifications(raw.notifications) || !object(raw.adminCancellation) || typeof raw.adminCancellation.supported !== 'boolean' || typeof raw.adminCancellation.eligible !== 'boolean' || raw.adminCancellation.eligible && !raw.adminCancellation.supported || raw.pageId !== undefined && !identifier(raw.pageId)) invalid()
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: raw.timezone as string }) } catch { invalid() }
  let requestedTime: OperatorBooking['requestedTime']
  if (raw.requestedTime !== undefined) { if (!object(raw.requestedTime) || !date(raw.requestedTime.startAt) || !date(raw.requestedTime.endAt) || Date.parse(raw.requestedTime.startAt) >= Date.parse(raw.requestedTime.endAt)) invalid(); requestedTime = { startAt: raw.requestedTime.startAt, endAt: raw.requestedTime.endAt } }
  const invitee = object(raw.invitee) && ['name', 'email', 'phone'].every(k => typeof (raw.invitee as any)[k] === 'string') ? { name: String((raw.invitee as any).name), email: String((raw.invitee as any).email), phone: String((raw.invitee as any).phone) } : undefined
  const extra = { ...(invitee ? { invitee } : {}), ...(raw.source === 'agent' || raw.source === 'booking_page' ? { source: raw.source as 'agent' | 'booking_page' } : {}), ...(typeof raw.cancelReason === 'string' ? { cancelReason: raw.cancelReason.slice(0, 300) } : {}), ...(typeof raw.meetingUrl === 'string' && /^https:\/\//.test(raw.meetingUrl) ? { meetingUrl: raw.meetingUrl } : {}) }
  return { ...extra, adminRescheduling: parseRescheduleCapability(raw.adminRescheduling), bookingRef: raw.bookingRef as string, ...(raw.pageId ? { pageId: raw.pageId as string } : {}), revision: raw.revision as number, status: String(raw.status), startAt: raw.startAt as string, endAt: raw.endAt as string, timezone: raw.timezone as string, ...(requestedTime ? { requestedTime } : {}), needsReconciliation: raw.needsReconciliation === true, notifications: raw.notifications, adminCancellation: { supported: (raw.adminCancellation as any).supported, eligible: (raw.adminCancellation as any).eligible } }
}
export function bookingOperationTerminal(operation: BookingOperation) { return operation.status === 'succeeded' || operation.status === 'not_sent' || operation.status === 'not_applied' && !operation.needsReconciliation }
export function bookingOperationsClient(context: EngineContext) {
  const assertAttempt = (attempt: BookingCancellationAttempt) => { context.assertCurrent(); if (!validBookingAttempt(attempt)) invalid() }
  return {
    async list(signal?: AbortSignal) {
      const response = await context.request<{ items: unknown[] }>('/scheduling/bookings', { signal }); context.assertCurrent()
      if (!object(response) || !Array.isArray(response.items)) invalid()
      const items = response.items.map(parseOperatorBooking)
      if (new Set(items.map(item => item.bookingRef)).size !== items.length) invalid()
      return items
    },
    async cancel(attempt: BookingCancellationAttempt) {
      assertAttempt(attempt)
      const response = await context.request<{ operation: unknown; replayed: boolean }>(`/scheduling/bookings/${attempt.bookingRef}/cancel`, { method: 'POST', idempotencyKey: attempt.key, body: { expectedTenantId: context.tenantId, expectedRevision: attempt.expectedRevision, confirm: true, ...(attempt.reason ? { reason: attempt.reason } : {}) } })
      context.assertCurrent(); if (!object(response) || typeof response.replayed !== 'boolean') invalid()
      return { operation: parseBookingOperation(response.operation, attempt), replayed: response.replayed }
    },
    async operation(attempt: BookingCancellationAttempt) {
      assertAttempt(attempt); const response = await context.request(`/scheduling/operations/${attempt.key}`); context.assertCurrent(); return parseBookingOperation(response, attempt)
    },
    async reconcile(bookingRef: string) {
      context.assertCurrent(); if (!identifier(bookingRef)) invalid()
      // Explicit remote read. This is never called by receipt lookup or recovery.
      const response = await context.request<Record<string, unknown>>(`/scheduling/bookings/${bookingRef}/reconcile`, { method: 'POST', body: {} }); context.assertCurrent()
      if (!object(response) || response.bookingRef !== bookingRef || !revision(response.revision) || typeof response.status !== 'string') invalid()
      return { bookingRef, revision: response.revision as number, status: response.status as string }
    },
  }
}
