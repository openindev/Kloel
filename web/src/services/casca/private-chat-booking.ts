import type { EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import type { AgentChatResult } from '../engine/agent-test'
import { createAssistantBookingService, parseBookingChoice, bookingValues, type BookingChoice, type BookingSlot, type BookingAttempt, type BookingOperation, type BookingValues } from '../engine/assistant-booking'
import { createAssistantBookingJournal } from '../engine/assistant-booking-journal'
import { createCalendlyService, parseCalendlyChoice, calendlyValues, type CalendlyChoice, type CalendlyAttempt, type CalendlyReceipt } from '../engine/calendly'
import { createCalendlyBookingJournal } from '../engine/calendly-journal'
import { bookingOperationsClient } from '../engine/booking-operations'

export type PrivateBookingChoice = { provider: 'kloel'; value: BookingChoice } | { provider: 'calendly'; value: CalendlyChoice }
export type PrivateBookingReference = { provider: 'kloel'; attempt: BookingAttempt } | { provider: 'calendly'; attempt: CalendlyAttempt }
export type PrivateBookingReceipt = { provider: 'kloel'; value: BookingOperation } | { provider: 'calendly'; value: CalendlyReceipt }
export type PrivateBookingSlot = { choice: PrivateBookingChoice; slot: BookingSlot }
export function privateBookingStatus(receipt: PrivateBookingReceipt) {
  return { confirmed: 'Criação da reserva confirmada', accepted: 'Pedido de reserva aceito; confirmação pendente', pending: 'Confirmação da criação pendente', unknown: 'Resultado da criação ainda não confirmado', conflict: 'Criação da reserva requer verificação', not_sent: 'Pedido de reserva não enviado', failed: 'Pedido de reserva recusado' }[receipt.value.status]
}

/** Only private chat results and responses to private scoped endpoints enter this adapter. */
export function createPrivateChatBooking(context: EngineContext, identity: ExpectedContext, agentId: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const native = createAssistantBookingService(context, agentId), calendly = createCalendlyService(context), operator = bookingOperationsClient(context)
  const nativeJournal = createAssistantBookingJournal(storage, identity, agentId), calendlyJournal = createCalendlyBookingJournal(storage, identity, agentId)
  const choices = new Map<string, PrivateBookingChoice>(), retired = new Set<string>(); let busy = false
  const choiceKey = (c: PrivateBookingChoice) => `${c.provider}:${c.value.choiceId}`
  function remember(c: PrivateBookingChoice) {
    context.assertCurrent()
    const value = c.provider === 'kloel' ? parseBookingChoice(c.value) : parseCalendlyChoice(c.value)
    const copy = { provider: c.provider, value } as PrivateBookingChoice
    if (c.provider === 'kloel') nativeJournal.rememberChat(value.chatOperationKey, context.assertCurrent)
    else calendlyJournal.rememberChat(value.chatOperationKey, context.assertCurrent)
    choices.set(choiceKey(copy), copy); return copy
  }
  function known(c: PrivateBookingChoice) { context.assertCurrent(); const saved = choices.get(choiceKey(c)); if (!saved || JSON.stringify(saved) !== JSON.stringify(c)) throw Error('Atualize as opções desta conversa antes de reservar.'); return saved }
  function references(): PrivateBookingReference[] {
    context.assertCurrent()
    return [...nativeJournal.read().attempts.map(attempt => ({ provider: 'kloel' as const, attempt })), ...calendlyJournal.read().attempts.map(attempt => ({ provider: 'calendly' as const, attempt }))]
  }
  function checked(ref: PrivateBookingReference) {
    context.assertCurrent()
    if (!references().some(r => r.provider === ref.provider && JSON.stringify(r.attempt) === JSON.stringify(ref.attempt))) throw Error('A reserva não pertence a este acompanhamento.')
  }
  async function consult(ref: PrivateBookingReference): Promise<PrivateBookingReceipt> {
    checked(ref)
    return ref.provider === 'kloel' ? { provider: 'kloel', value: await native.operation(ref.attempt) } : { provider: 'calendly', value: await calendly.operation(ref.attempt) }
  }
  async function locked<T>(fn: () => Promise<T>): Promise<T> { context.assertCurrent(); if (busy) throw Error('Aguarde a operação atual.'); busy = true; try { return await fn() } finally { busy = false } }
  return {
    accept(result: AgentChatResult): PrivateBookingChoice[] {
      context.assertCurrent()
      const values: PrivateBookingChoice[] = [
        ...result.bookingChoices.map(value => ({ provider: 'kloel' as const, value: parseBookingChoice(value, { conversationId: result.conversationId }) })),
        ...(result.calendlyChoices ?? []).map(value => ({ provider: 'calendly' as const, value: parseCalendlyChoice(value, { conversationId: result.conversationId, chatOperationKey: value.chatOperationKey }) })),
      ]
      return values.map(remember)
    },
    references,
    consult,
    initialSlots(choice: PrivateBookingChoice): PrivateBookingSlot[] { known(choice); return retired.has(choiceKey(choice)) ? [] : choice.value.slots.map(slot => ({ choice, slot })) },
    slots: (choice: PrivateBookingChoice, from: string, to: string) => locked(async () => {
      known(choice)
      const result: PrivateBookingSlot[] = [], seen = new Set<string>(); let cursor = from
      for (let page = 0; page < 20; page++) {
        const next: PrivateBookingChoice = choice.provider === 'kloel'
          ? { provider: 'kloel', value: await native.slots(choice.value, cursor, to) }
          : { provider: 'calendly', value: await calendly.slots(choice.value, cursor, to) }
        if (next.value.eventTypeId !== choice.value.eventTypeId || next.value.actionId !== choice.value.actionId || next.value.actionRevision !== choice.value.actionRevision) throw Error('O evento mudou. Consulte novamente na conversa.')
        const current = remember(next)
        for (const slot of current.value.slots) { if (seen.has(slot.startAt)) throw Error('Os horários mudaram. Consulte novamente.'); seen.add(slot.startAt); result.push({ choice: current, slot }) }
        if (current.value.complete) return result
        if (!current.value.nextFrom || current.value.nextFrom <= cursor) throw Error('Não foi possível consultar todos os horários.')
        cursor = current.value.nextFrom
        await new Promise(resolve => setTimeout(resolve, 650))
      }
      throw Error('Não foi possível consultar todos os horários.')
    }),
    create: (selected: PrivateBookingSlot, values: BookingValues, acknowledgeNotifications: boolean) => locked(async (): Promise<PrivateBookingReceipt> => {
      const choice = known(selected.choice), c = choice.value
      const previous = references().find(r => r.provider === choice.provider && r.attempt.conversationId === c.conversationId && r.attempt.eventTypeId === c.eventTypeId)
      if (previous) return consult(previous)
      if (retired.has(choiceKey(choice))) throw Error('Consulte os horários novamente antes de tentar outra reserva.')
      if (!c.allowCreate || !c.slots.some(slot => JSON.stringify(slot) === JSON.stringify(selected.slot)) || Date.parse(selected.slot.expiresAt) <= Date.now()) throw Error('Atualize os horários e selecione uma opção disponível.')
      if (choice.provider === 'calendly' && !acknowledgeNotifications) throw Error('Confirme que está ciente das notificações do Calendly.')
      const attempt = { key: crypto.randomUUID(), conversationId: c.conversationId, actionId: c.actionId, actionRevision: c.actionRevision, eventTypeId: c.eventTypeId, chatOperationKey: c.chatOperationKey }
      if (choice.provider === 'kloel') {
        const valid = bookingValues(choice.value, values)
        nativeJournal.reserve(attempt, context.assertCurrent)
        return { provider: 'kloel', value: await native.create(attempt, choice.value, selected.slot, valid) }
      }
      const valid = calendlyValues({ name: values.name ?? '', email: values.email ?? '', timezone: c.timezone })
      calendlyJournal.reserve(attempt, context.assertCurrent)
      return { provider: 'calendly', value: await calendly.create(attempt, choice.value, selected.slot.quote, valid) }
    }),
    verify: (ref: PrivateBookingReference) => locked(async (): Promise<PrivateBookingReceipt> => {
      const receipt = await consult(ref)
      if (ref.provider === 'calendly') return { provider: 'calendly', value: await calendly.verify(ref.attempt) }
      if (receipt.value.needsReconciliation) await operator.reconcile(receipt.value.bookingRef)
      return consult(ref)
    }),
    releaseNotSent: (ref: PrivateBookingReference) => locked(async () => {
      const receipt = await consult(ref)
      if (ref.provider === 'kloel' && receipt.provider === 'kloel') nativeJournal.releaseNotSent(ref.attempt, receipt.value, context.assertCurrent)
      else if (ref.provider === 'calendly' && receipt.provider === 'calendly') calendlyJournal.releaseNoEffect(ref.attempt, receipt.value, context.assertCurrent)
      else throw Error('Não foi possível consultar esta reserva.')
      for (const choice of choices.values()) if (choice.provider === ref.provider && choice.value.conversationId === ref.attempt.conversationId && choice.value.eventTypeId === ref.attempt.eventTypeId) retired.add(choiceKey(choice))
    }),
    management: (ref: PrivateBookingReference) => locked(async () => {
      const receipt = await consult(ref)
      if (receipt.value.status !== 'confirmed') throw Error('Aguarde a confirmação da reserva antes de abrir o gerenciamento.')
      if (ref.provider === 'kloel' && receipt.provider === 'kloel') {
        const link = await native.management(receipt.value)
        return [{ label: 'Gerenciar reserva', url: link.url }]
      }
      if (ref.provider !== 'calendly' || receipt.provider !== 'calendly') throw Error('Não foi possível consultar esta reserva.')
      const links = await calendly.management(ref.attempt, receipt.value)
      return [...(links.cancelUrl ? [{ label: 'Cancelar no Calendly', url: links.cancelUrl }] : []), ...(links.rescheduleUrl ? [{ label: 'Reagendar no Calendly', url: links.rescheduleUrl }] : [])]
    }),
  }
}
export type PrivateChatBooking = ReturnType<typeof createPrivateChatBooking>
