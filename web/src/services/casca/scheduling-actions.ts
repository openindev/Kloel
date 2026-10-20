import type { EventType, Booking } from '@/domain/types'
import { useStore } from '@/data/store'
import { captureEngineContext, engineSession, type EngineContext } from '@/services/engine/session'
import type { Identity } from '@/services/engine/types'
import { schedulingClient } from '@/services/engine/scheduling'
import { createAssistantBookingService, type BookingActionAttempt, type BookingPolicy } from '@/services/engine/assistant-booking'
import { createBookingActionJournal } from '@/services/engine/assistant-booking-journal'
import { bookingCancellationAttempt, bookingOperationTerminal, bookingOperationsClient } from '@/services/engine/booking-operations'
import { createBookingOperationsJournal } from '@/services/engine/booking-operations-journal'
import { createRescheduleJournal } from '@/services/engine/booking-reschedule-journal'
import { configFromDraft, projectEvent, refreshScheduling } from './scheduling'

function ownerContext() {
  const context = captureEngineContext('calendars:write'), identity = engineSession.getSnapshot().data!.identity
  if (identity.role !== 'owner') throw Error('Esta ação exige o proprietário da organização.')
  return { context, identity }
}
function scopedStorage() {
  const identity = engineSession.getSnapshot().data!.identity.context
  const prefix = `kloel:casca:scheduling:${identity.membershipId}:${identity.authorityVersion}:`
  return { getItem: (key: string) => sessionStorage.getItem(prefix + key), setItem: (key: string, value: string) => sessionStorage.setItem(prefix + key, value), removeItem: (key: string) => sessionStorage.removeItem(prefix + key) }
}

/** Configuration and grants are separate, confirmed operations. Recovery reads the original receipt. */
export async function bindEventToAgent(event: EventType, agentId: string, enabled: boolean, allowCreate = true, ports?: {
  context: EngineContext; identity: Pick<Identity, 'role' | 'context'>; storage: ReturnType<typeof scopedStorage>
  refresh: (context: EngineContext) => Promise<{ eventTypes: EventType[] }>
}) {
  const { context, identity } = ports ?? ownerContext(), service = createAssistantBookingService(context, agentId)
  if (identity.role !== 'owner') throw Error('Esta ação exige o proprietário da organização.')
  const journal = createBookingActionJournal(ports?.storage ?? scopedStorage(), identity.context, agentId)
  for (const attempt of journal.read()) {
    const operation = await service.actionOperation(attempt)
    journal.resolve(attempt, operation, context.assertCurrent)
  }
  const existing = await service.list()
  let current = (await schedulingClient(context).events()).find(row => row.id === event.id)
  if (!current || current.tenantId !== context.tenantId) throw Error('Atualize o tipo de evento.')
  if (enabled && !current.agentIds.includes(agentId)) {
    const client = schedulingClient(context), config = { ...configFromDraft(projectEvent(current), current), agentIds: [...current.agentIds, agentId] }
    if (current.publicationStatus === 'published') { await client.unpublish(current.id); current = { ...current, publicationStatus: 'unpublished' } }
    current = await client.save(current, config)
    const publication = await client.publish(current)
    current = { ...current, publicationStatus: 'published', publicPath: publication.publicPath }
  }
  const configure = async (attempt: BookingActionAttempt, policy?: BookingPolicy) => {
    journal.reserve(attempt, context.assertCurrent)
    const operation = await service.configure(attempt, policy)
    // Confirm the live action list before discarding its durable receipt.
    const rows = await service.list(); context.assertCurrent()
    journal.resolve(attempt, operation, context.assertCurrent)
    return rows
  }
  if (enabled) {
    const options = await service.options()
    if (!options.eventTypes.some(row => row.id === event.id)) throw Error('Este assistente ainda não pode usar este calendário. Confira o calendário Google e a página publicada.')
    // Existing shell has one assistant selection. Its private chat and enabled webchat channels share that binding.
    const audiences = [{ audience: 'private' as const, channelId: null as string | null }, ...options.channels.map(c => ({ audience: 'webchat' as const, channelId: c.id }))]
    let rows = existing
    for (const audience of audiences) {
      let action = rows.find(a => a.eventTypeId === event.id && a.audience === audience.audience && a.channelId === audience.channelId)
      if (!action) {
        rows = await configure({ key: crypto.randomUUID(), kind: 'booking.action.create', agentId, eventTypeId: event.id, ...audience })
        action = rows.find(a => a.eventTypeId === event.id && a.audience === audience.audience && a.channelId === audience.channelId)
      }
      if (!action) throw Error('Não foi possível confirmar o vínculo.')
      if (!action.available || action.allowCreate !== allowCreate) rows = await configure({ key: crypto.randomUUID(), kind: 'booking.action.update', agentId, actionId: action.id, expectedRevision: action.revision },
        { enabled: true, allowCreate, expiresInDays: 30, maxBookingsPerDay: Math.min(100, current.dailyLimit) })
    }
    if (!rows.filter(a => a.eventTypeId === event.id).some(a => a.available && a.allowCreate === allowCreate)) throw Error('O vínculo não ficou disponível. Consulte novamente.')
  } else {
    for (const action of existing.filter(a => a.eventTypeId === event.id && a.enabled)) {
      await configure({ key: crypto.randomUUID(), kind: 'booking.action.update', agentId, actionId: action.id, expectedRevision: action.revision },
        { enabled: false, allowCreate: false, expiresInDays: 1, maxBookingsPerDay: action.maxBookingsPerDay })
    }
    const client = schedulingClient(context), config = { ...configFromDraft(projectEvent(current), current), agentIds: current.agentIds.filter(id => id !== agentId) }
    if (current.publicationStatus === 'published') { await client.unpublish(current.id); current = { ...current, publicationStatus: 'unpublished' } }
    current = await client.save(current, config)
    if (current.enabled) await client.publish(current)
  }
  const slice = await (ports?.refresh ?? refreshScheduling)(context)
  return slice.eventTypes.find(e => e.id === event.id) ?? event
}

/** Repeated clicks after uncertainty consult the existing receipt; they never repeat the cancellation. */
export async function cancelBooking(booking: Booking, reason = '') {
  const { context, identity } = ownerContext(), client = bookingOperationsClient(context)
  if (createRescheduleJournal(scopedStorage(), identity.context).read().some(row => !row.closed && row.attempt.bookingRef === booking.id)) throw Error('Consulte o reagendamento pendente antes de cancelar.')
  const journal = createBookingOperationsJournal(scopedStorage(), identity.context)
  const previous = journal.read().find(row => !row.closed && row.attempt.bookingRef === booking.id)
  let attempt = previous?.attempt
  let operation
  if (attempt) operation = await client.operation(attempt)
  else {
    const current = (await client.list()).find(row => row.bookingRef === booking.id)
    if (!current?.adminCancellation.eligible) throw Error('Este agendamento não está disponível para cancelamento.')
    attempt = bookingCancellationAttempt(current, crypto.randomUUID(), reason); journal.reserve(attempt, context.assertCurrent)
    operation = (await client.cancel(attempt)).operation
  }
  await refreshScheduling(context)
  if (!bookingOperationTerminal(operation)) throw Error('O cancelamento ainda não foi confirmado. Consulte a tentativa novamente.')
  journal.close(attempt, operation, context.assertCurrent)
  if (operation.status !== 'succeeded') throw Error('O agendamento não foi cancelado.')
  return useStore.getState().db.bookings.find(b => b.id === booking.id)
}

/** Explicit reconciliation only reads the provider; it never resends create/cancel/reschedule. */
export async function consultBooking(booking: Booking) {
  const { context, identity } = ownerContext(), client = bookingOperationsClient(context)
  await client.reconcile(booking.id)
  const journal = createBookingOperationsJournal(scopedStorage(), identity.context)
  const pending = journal.read().find(row => !row.closed && row.attempt.bookingRef === booking.id)
  const operation = pending ? await client.operation(pending.attempt) : undefined
  await refreshScheduling(context)
  if (pending && operation && bookingOperationTerminal(operation)) journal.close(pending.attempt, operation, context.assertCurrent)
}
