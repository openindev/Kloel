import { parseCalendlyCancellationReceipt, validCalendlyCancellationAttempt, type CalendlyCancellationAttempt, type CalendlyCancellationReceipt } from './calendly'
import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { calendlyChatKey, calendlyId, parseCalendlyConfigReceipt, parseCalendlyReceipt, validCalendlyAttempt, validCalendlyConfigAttempt, type CalendlyAttempt, type CalendlyConfigAttempt, type CalendlyConfigReceipt, type CalendlyReceipt } from './calendly'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type CalendlyReferences = { chats: string[]; attempts: CalendlyAttempt[] }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
function fail(): never { throw Error('Não foi possível preservar o acompanhamento nesta aba. Novas solicitações estão bloqueadas.') }
function scope(storage: StoragePort, input: ExpectedContext, purpose: string, agentId?: string) {
  const context = parseExpectedContext(input); if (agentId && !/^[A-Za-z0-9_-]{1,200}$/.test(agentId)) fail()
  const key = `kloel-calendly-${purpose}:${context.userId}:${context.tenantId}:${agentId ?? 'connections'}`
  function read(): unknown {
    const encoded = storage.getItem(key); if (encoded === null) return undefined
    let raw: any; try { raw = JSON.parse(encoded) } catch { fail() }
    if (!obj(raw) || raw.version !== 1 || Object.keys(raw).some(k => !['version', 'context', 'data'].includes(k))) fail()
    if (!same(parseExpectedContext(raw.context), context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return undefined }
    return raw.data
  }
  function write<T>(before: unknown, data: T, fresh: () => void): T {
    fresh(); if (!same(read(), before)) fail()
    const encoded = JSON.stringify({ version: 1, context, data }); storage.setItem(key, encoded); fresh()
    if (storage.getItem(key) !== encoded) fail(); fresh(); return structuredClone(data)
  }
  return { key, read, write, invalidate() { storage.removeItem(key); if (storage.getItem(key) !== null) fail() } }
}
export function createCalendlyOAuthJournal(storage: StoragePort, context: ExpectedContext) {
  const s = scope(storage, context, 'oauth')
  function read(): string[] { const raw = s.read(); if (raw === undefined) return []; if (!Array.isArray(raw) || raw.length > 20 || new Set(raw).size !== raw.length) fail(); return raw.map(calendlyId) }
  return { key: s.key, read, invalidate: s.invalidate,
    reserve(key: string, fresh: () => void) { calendlyId(key); const before = s.read(), rows = read(); if (rows.length >= 20 || rows.includes(key)) fail(); return s.write(before, [...rows, key], fresh) },
    resolve(key: string, status: 'connected' | 'expired', fresh: () => void) { if (!['connected', 'expired'].includes(status)) fail(); const before = s.read(), rows = read(); if (!rows.includes(key)) fail(); return s.write(before, rows.filter(k => k !== key), fresh) },
  }
}
export function createCalendlyConfigJournal(storage: StoragePort, context: ExpectedContext, agentId?: string) {
  const s = scope(storage, context, 'configuration', agentId)
  function read(): CalendlyConfigAttempt[] { const raw = s.read(); if (raw === undefined) return []; if (!Array.isArray(raw) || raw.length > 20 || raw.some(v => !validCalendlyConfigAttempt(v) || (agentId ?? null) !== v.agentId) || new Set(raw.map(v => v.key)).size !== raw.length) fail(); return structuredClone(raw) }
  const lane = (a: CalendlyConfigAttempt) => a.kind === 'calendly.action.create' ? `${a.connectionId}:${a.eventTypeId}:${a.audience}:${a.channelId}` : a.resourceId
  return { key: s.key, read, invalidate: s.invalidate,
    reserve(a: CalendlyConfigAttempt, fresh: () => void) { const before = s.read(), rows = read(); if (!validCalendlyConfigAttempt(a) || (agentId ?? null) !== a.agentId || rows.length >= 20 || rows.some(r => r.key === a.key || lane(r) === lane(a))) fail(); return s.write(before, [...rows, structuredClone(a)], fresh) },
    resolve(a: CalendlyConfigAttempt, receipt: CalendlyConfigReceipt, fresh: () => void) { parseCalendlyConfigReceipt(receipt, a, context.tenantId); const before = s.read(), rows = read(); if (!rows.some(r => same(r, a))) fail(); return s.write(before, rows.filter(r => r.key !== a.key), fresh) },
  }
}
export function createCalendlyBookingJournal(storage: StoragePort, context: ExpectedContext, agentId: string) {
  const s = scope(storage, context, 'bookings', agentId)
  function read(): CalendlyReferences {
    const raw = s.read(); if (raw === undefined) return { chats: [], attempts: [] }
    if (!obj(raw) || Object.keys(raw).length !== 2 || !Array.isArray(raw.chats) || raw.chats.length > 100 || raw.chats.some(v => { try { calendlyChatKey(v); return false } catch { return true } }) || new Set(raw.chats).size !== raw.chats.length || !Array.isArray(raw.attempts) || raw.attempts.length > 100 || raw.attempts.some(a => !validCalendlyAttempt(a) || !raw.chats.includes(a.chatOperationKey)) || new Set(raw.attempts.map(a => a.key)).size !== raw.attempts.length) fail()
    return structuredClone(raw) as CalendlyReferences
  }
  return { key: s.key, read, invalidate: s.invalidate,
    rememberChat(key: string, fresh: () => void) { calendlyChatKey(key); const before = s.read(), state = read(); fresh(); if (state.chats.includes(key)) return state; if (state.chats.length >= 100) fail(); return s.write(before, { ...state, chats: [...state.chats, key] }, fresh) },
    reserve(a: CalendlyAttempt, fresh: () => void) { const before = s.read(), state = read(); if (!validCalendlyAttempt(a) || !state.chats.includes(a.chatOperationKey) || state.attempts.length >= 100 || state.attempts.some(r => r.key === a.key || r.conversationId === a.conversationId && r.eventTypeId === a.eventTypeId)) fail(); return s.write(before, { ...state, attempts: [...state.attempts, structuredClone(a)] }, fresh) },
    discover(chatKey: string, receipts: CalendlyReceipt[], fresh: () => void) {
      const before = s.read(), state = read(); if (!state.chats.includes(chatKey)) fail(); const next = [...state.attempts]
      for (const raw of receipts) { const o = parseCalendlyReceipt(raw, undefined, context.tenantId), prior = next.find(a => a.key === o.key); if (prior) { parseCalendlyReceipt(o, prior, context.tenantId); if (prior.chatOperationKey !== chatKey) fail(); continue } next.push({ key: o.key, conversationId: o.conversationId, actionId: o.actionId, actionRevision: o.actionRevision, eventTypeId: o.eventTypeId, chatOperationKey: chatKey }) }
      if (next.length > 100) fail(); return s.write(before, { ...state, attempts: next }, fresh)
    },
    releaseNoEffect(a: CalendlyAttempt, receipt: CalendlyReceipt, fresh: () => void) { const o = parseCalendlyReceipt(receipt, a, context.tenantId), before = s.read(), state = read(); if (!['not_sent', 'failed'].includes(o.status) || o.needsReconciliation || !state.attempts.some(r => same(r, a))) fail(); return s.write(before, { ...state, attempts: state.attempts.filter(r => r.key !== a.key) }, fresh) },
  }
}

export function createCalendlyCancellationJournal(storage: StoragePort, context: ExpectedContext, agentId: string) {
  const s = scope(storage, context, 'cancellations', agentId)
  const target = (a: CalendlyCancellationAttempt, b: Pick<CalendlyCancellationAttempt, 'creationKey' | 'bookingRef'>) => a.creationKey === b.creationKey && a.bookingRef === b.bookingRef
  function read(): CalendlyCancellationAttempt[] {
    const raw = s.read(); if (raw === undefined) return []
    if (!Array.isArray(raw) || raw.length > 100 || raw.some(a => !validCalendlyCancellationAttempt(a)) || new Set(raw.map(a => a.key)).size !== raw.length) fail()
    for (const a of raw) if (a.previousNotSentKey && !raw.some(p => p.key === a.previousNotSentKey && target(p, a))) fail()
    return structuredClone(raw)
  }
  return { key: s.key, read, invalidate: s.invalidate,
    discover(creationKey: string, bookingRef: string, receipts: CalendlyCancellationReceipt[], fresh: () => void) {
      const expected = { creationKey: calendlyId(creationKey), bookingRef: calendlyId(bookingRef) }, before = s.read(), rows = read(), keys = new Set<string>()
      for (const raw of receipts) {
        const o = parseCalendlyCancellationReceipt(raw, expected, context.tenantId); if (keys.has(o.key)) fail(); keys.add(o.key)
        const prior = rows.find(a => a.key === o.key)
        if (prior) { if (!target(prior, o)) fail() }
        else rows.push({ key: o.key, creationKey: o.creationKey, bookingRef: o.bookingRef })
      }
      if (rows.length > 100) fail()
      return s.write(before, rows, fresh)
    },
    reserve(a: CalendlyCancellationAttempt, observed: CalendlyCancellationReceipt[], fresh: () => void) {
      const before = s.read(), rows = read()
      if (!validCalendlyCancellationAttempt(a) || rows.length >= 100 || rows.some(r => r.key === a.key)) fail()
      const related = rows.filter(r => target(r, a)), receipts = observed.map(r => parseCalendlyCancellationReceipt(r, { creationKey: a.creationKey, bookingRef: a.bookingRef }, context.tenantId))
      if (new Set(receipts.map(r => r.key)).size !== receipts.length || receipts.length !== related.length || related.some(r => !receipts.some(o => o.key === r.key))) fail()
      if (a.previousNotSentKey) {
        if (!related.some(r => r.key === a.previousNotSentKey) || receipts.some(r => r.status !== 'not_sent') || rows.some(r => r.previousNotSentKey === a.previousNotSentKey)) fail()
      } else if (related.length) fail()
      return s.write(before, [...rows, structuredClone(a)], fresh)
    },
  }
}
