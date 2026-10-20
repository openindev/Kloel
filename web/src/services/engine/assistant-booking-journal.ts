import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { bookingChatKey, bookingId, parseBookingActionOperation, parseBookingOperation, validBookingActionAttempt, validBookingAttempt, type BookingActionAttempt, type BookingActionOperation, type BookingAttempt, type BookingOperation } from './assistant-booking'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type BookingReferences = { chats: string[]; attempts: BookingAttempt[] }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
function fail(): never { throw Error('Não foi possível preservar o acompanhamento nesta aba. Novas solicitações estão bloqueadas.') }
function scope(storage: StoragePort, input: ExpectedContext, agentId: string, purpose: string) {
  const context = parseExpectedContext(input); if (!/^[A-Za-z0-9_-]{1,200}$/.test(agentId)) fail()
  const key = `kloel-assistant-booking-${purpose}:${context.userId}:${context.tenantId}:${agentId}`
  function read(): unknown { const encoded = storage.getItem(key); if (encoded === null) return undefined; let raw: any; try { raw = JSON.parse(encoded) } catch { fail() } if (!obj(raw) || raw.version !== 1 || Object.keys(raw).some(k => !['version', 'context', 'data'].includes(k))) fail(); if (!same(parseExpectedContext(raw.context), context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return undefined } return raw.data }
  function write<T>(data: T, fresh: () => void): T { fresh(); const encoded = JSON.stringify({ version: 1, context, data }); storage.setItem(key, encoded); fresh(); if (storage.getItem(key) !== encoded) fail(); fresh(); return structuredClone(data) }
  return { key, read, write, invalidate() { storage.removeItem(key); if (storage.getItem(key) !== null) fail() } }
}
export function createBookingActionJournal(storage: StoragePort, context: ExpectedContext, agentId: string) {
  const store = scope(storage, context, agentId, 'configuration')
  function read(): BookingActionAttempt[] { const raw = store.read(); if (raw === undefined) return []; if (!Array.isArray(raw) || raw.length > 20 || raw.some(v => !validBookingActionAttempt(v) || v.agentId !== agentId) || new Set(raw.map(v => v.key)).size !== raw.length) fail(); return structuredClone(raw) }
  const lane = (a: BookingActionAttempt) => a.kind === 'booking.action.update' ? a.actionId : `${a.eventTypeId}:${a.audience}:${a.channelId}`
  return { key: store.key, read, invalidate: store.invalidate,
    reserve(a: BookingActionAttempt, fresh: () => void) { fresh(); if (!validBookingActionAttempt(a) || a.agentId !== agentId) fail(); const rows = read(); if (rows.length >= 20 || rows.some(r => r.key === a.key || lane(r) === lane(a))) fail(); return store.write([...rows, structuredClone(a)], fresh) },
    resolve(a: BookingActionAttempt, operation: BookingActionOperation, fresh: () => void) { fresh(); parseBookingActionOperation(operation, a); const rows = read(); if (!rows.some(r => same(r, a))) fail(); return store.write(rows.filter(r => r.key !== a.key), fresh) },
  }
}
export function createAssistantBookingJournal(storage: StoragePort, context: ExpectedContext, agentId: string) {
  const store = scope(storage, context, agentId, 'execution')
  function read(): BookingReferences {
    const raw = store.read(); if (raw === undefined) return { chats: [], attempts: [] }
    if (!obj(raw) || Object.keys(raw).some(k => !['chats', 'attempts'].includes(k)) || !Array.isArray(raw.chats) || raw.chats.length > 100 || raw.chats.some(v => !bookingChatKey(v)) || new Set(raw.chats).size !== raw.chats.length || !Array.isArray(raw.attempts) || raw.attempts.length > 100 || raw.attempts.some(v => !validBookingAttempt(v) || !raw.chats.includes(v.chatOperationKey)) || new Set(raw.attempts.map(v => v.key)).size !== raw.attempts.length) fail()
    return structuredClone(raw) as BookingReferences
  }
  return { key: store.key, read, invalidate: store.invalidate,
    rememberChat(key: string, fresh: () => void) { fresh(); if (!bookingChatKey(key)) fail(); const state = read(); if (state.chats.includes(key)) return state; if (state.chats.length >= 100) fail(); return store.write({ ...state, chats: [...state.chats, key] }, fresh) },
    reserve(a: BookingAttempt, fresh: () => void) { fresh(); if (!validBookingAttempt(a)) fail(); const state = read(); if (state.attempts.length >= 100 || state.attempts.some(r => r.key === a.key || r.conversationId === a.conversationId && r.eventTypeId === a.eventTypeId) || !state.chats.includes(a.chatOperationKey)) fail(); return store.write({ ...state, attempts: [...state.attempts, structuredClone(a)] }, fresh) },
    discover(chatKey: string, operations: BookingOperation[], fresh: () => void) { fresh(); const state = read(); if (!state.chats.includes(chatKey)) fail(); const next = [...state.attempts]; for (const item of operations) { const op = parseBookingOperation(item), prior = next.find(a => a.key === op.key); if (prior) { parseBookingOperation(op, prior); if (prior.chatOperationKey !== chatKey) fail(); continue } const a: BookingAttempt = { key: op.key, conversationId: op.conversationId, actionId: op.actionId, actionRevision: op.actionRevision, eventTypeId: op.eventTypeId, chatOperationKey: chatKey }; next.push(a) } if (next.length > 100) fail(); return store.write({ ...state, attempts: next }, fresh) },
    releaseNotSent(a: BookingAttempt, operation: BookingOperation, fresh: () => void) { fresh(); const op = parseBookingOperation(operation, a), state = read(); if (op.status !== 'not_sent' || !state.attempts.some(r => same(r, a))) fail(); return store.write({ ...state, attempts: state.attempts.filter(r => r.key !== a.key) }, fresh) },
  }
}
