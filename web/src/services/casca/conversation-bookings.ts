import type { EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { EngineError } from '../engine/http'
import { parseBookingOperation, type BookingOperation } from '../engine/assistant-booking'
import { parseOperatorBooking, bookingOperationsClient, type OperatorBooking } from '../engine/booking-operations'
import { createBookingOperationsJournal } from '../engine/booking-operations-journal'
import { bookingRescheduleClient, bookingRescheduleAttempt, rescheduleTerminal, type RescheduleSlot } from '../engine/booking-reschedule'
import { createRescheduleJournal } from '../engine/booking-reschedule-journal'
import { projectBooking } from './scheduling'
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
function invalid(): never { throw Error('Não foi possível confirmar as reservas desta conversa.') }

export async function loadConversationBookings(context: EngineContext, conversationId: string, signal?: AbortSignal) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(conversationId)) invalid()
  const bookings = new Map<string, OperatorBooking>(), operations: BookingOperation[] = [], seen = new Set<string>(); let count: number | undefined
  for (let page = 1; page <= 1000; page++) {
    const raw = await context.request<unknown>(`/conversations/${conversationId}/bookings`, { signal, query: { page, limit: 100 } })
    if (!object(raw) || raw.conversationId !== conversationId || raw.page !== page || raw.limit !== 100 || !Number.isSafeInteger(raw.total) || raw.total < 0 || raw.totalPages !== Math.ceil(raw.total / 100) || !Array.isArray(raw.items) || raw.items.length > 100 || count !== undefined && raw.total !== count) invalid()
    count = raw.total
    for (const item of raw.items) {
      if (!object(item)) invalid()
      const operation = parseBookingOperation(item.operation, { conversationId })
      if (seen.has(operation.key)) invalid(); seen.add(operation.key); operations.push(operation)
      if (item.booking !== null) {
        const booking = parseOperatorBooking(item.booking)
        if (booking.bookingRef !== operation.bookingRef || booking.pageId !== operation.eventTypeId) invalid()
        const previous = bookings.get(booking.bookingRef)
        if (previous && JSON.stringify(previous) !== JSON.stringify(booking)) invalid()
        bookings.set(booking.bookingRef, booking)
      }
    }
    if (page >= raw.totalPages) { if (seen.size !== count) invalid(); context.assertCurrent(); return { bookings: [...bookings.values()].map(row => projectBooking(row, context.tenantId)), operations: operations.filter(row => !bookings.has(row.bookingRef)) } }
    if (page === 1000) invalid()
  }
  return invalid()
}

export function createBookingRescheduling(context: EngineContext, identity: ExpectedContext, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const prefix = `kloel:casca:scheduling:${identity.membershipId}:${identity.authorityVersion}:`
  const scoped = { getItem: (key: string) => storage.getItem(prefix + key), setItem: (key: string, value: string) => storage.setItem(prefix + key, value), removeItem: (key: string) => storage.removeItem(prefix + key) }
  const journal = createRescheduleJournal(scoped, identity), cancels = createBookingOperationsJournal(scoped, identity)
  const api = bookingRescheduleClient(context), bookings = bookingOperationsClient(context)
  let busy = false
  const pending = (id: string) => journal.read().find(row => !row.closed && row.attempt.bookingRef === id)
  const cancellation = (id: string) => cancels.read().some(row => !row.closed && row.attempt.bookingRef === id)
  return {
    pending: (id: string) => !!pending(id),
    async slots(booking: OperatorBooking, from: string, to: string, signal?: AbortSignal) {
      if (pending(booking.bookingRef) || cancellation(booking.bookingRef)) throw Error('Consulte a tentativa pendente antes de escolher outro horário.')
      const slots: RescheduleSlot[] = [], seen = new Set<string>(); let cursor = from
      for (let page = 0; page < 100; page++) {
        const result = await api.slots({ bookingRef: booking.bookingRef, expectedRevision: booking.revision, from: cursor, to }, signal)
        for (const slot of result.slots) { if (seen.has(slot.startAt)) throw Error('Os horários mudaram. Consulte novamente.'); seen.add(slot.startAt); slots.push(slot) }
        if (result.complete) { context.assertCurrent(); return slots }
        if (!result.nextFrom || result.nextFrom <= cursor) throw Error('Não foi possível carregar todos os horários.')
        cursor = result.nextFrom
      }
      throw Error('Não foi possível carregar todos os horários.')
    },
    async change(booking: OperatorBooking, slot?: RescheduleSlot) {
      context.assertCurrent(); if (busy) throw Error('Aguarde a operação atual.'); busy = true
      try {
        if (cancellation(booking.bookingRef)) throw Error('Consulte o cancelamento pendente antes de reagendar.')
        const prior = pending(booking.bookingRef)
        let operation, attempt = prior?.attempt
        if (attempt) { await bookings.reconcile(booking.bookingRef); operation = await api.operation(attempt) }
        else {
          const current = (await bookings.list()).find(row => row.bookingRef === booking.bookingRef)
          if (!slot || !current?.adminRescheduling?.eligible || current.revision !== booking.revision) throw Error('Atualize a reserva e escolha um horário disponível.')
          attempt = bookingRescheduleAttempt(current); journal.reserve(attempt, context.assertCurrent)
          try { operation = (await api.reschedule(attempt, slot, { startAt: current.startAt, endAt: current.endAt })).operation }
          catch (error) {
            if (error instanceof EngineError && error.code === 'booking_reschedule_admission_revision_conflict') journal.close(attempt, error.code, context.assertCurrent)
            throw error
          }
        }
        const current = (await bookings.list()).find(row => row.bookingRef === booking.bookingRef)
        if (rescheduleTerminal(operation)) journal.close(attempt!, operation, context.assertCurrent)
        if (operation.status !== 'succeeded' || current?.status !== 'confirmed' || current.startAt !== operation.requestedTime.startAt || current.endAt !== operation.requestedTime.endAt) throw Error('O novo horário ainda não foi confirmado. Consulte a tentativa antes de continuar.')
        return current
      } finally { busy = false }
    },
  }
}
