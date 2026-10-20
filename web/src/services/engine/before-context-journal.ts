import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { beforeId, parseBeforeConfigOperation, parseBeforeOpening, validBeforeConfigAttempt, validBeforeOpeningAttempt, type BeforeConfigAttempt, type BeforeConfigOperation, type BeforeOpeningAttempt, type BeforeOpening } from './before-context'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
function fail(): never { throw Error('Não foi possível preservar o acompanhamento nesta aba. Novas solicitações estão bloqueadas.') }
function scope(storage: StoragePort, input: ExpectedContext, agentId: string, lane: string) {
  const context = parseExpectedContext(input); if (!beforeId(agentId) || !context.tenantId) fail()
  const key = `kloel-before-context-${lane}:${context.userId}:${context.tenantId}:${agentId}`
  function invalidate() { storage.removeItem(key); if (storage.getItem(key) !== null) fail() }
  function read(): unknown { const text = storage.getItem(key); if (text === null) return undefined; let raw: any; try { raw = JSON.parse(text) } catch { fail() } if (!object(raw) || raw.version !== 1 || Object.keys(raw).some(k => !['version', 'context', 'data'].includes(k))) fail(); if (!same(parseExpectedContext(raw.context), context)) { invalidate(); return undefined } return raw.data }
  function write<T>(data: T, fresh: () => void): T { fresh(); const encoded = JSON.stringify({ version: 1, context, data }); storage.setItem(key, encoded); fresh(); if (storage.getItem(key) !== encoded) fail(); fresh(); return structuredClone(data) }
  return { key, read, write, invalidate }
}
export function createBeforeConfigJournal(storage: StoragePort, context: ExpectedContext, agentId: string) {
  const store = scope(storage, context, agentId, 'configuration')
  function read(): { active: BeforeConfigAttempt | null; rejected: BeforeConfigAttempt[] } { const raw = store.read(); if (raw === undefined) return { active: null, rejected: [] }; if (!object(raw) || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'active') || !Object.hasOwn(raw, 'rejected') || raw.active !== null && (!validBeforeConfigAttempt(raw.active) || raw.active.agentId !== agentId) || !Array.isArray(raw.rejected) || raw.rejected.length > 20 || raw.rejected.some(a => !validBeforeConfigAttempt(a) || a.agentId !== agentId) || new Set([...raw.rejected, ...(raw.active ? [raw.active] : [])].map(a => a.key)).size !== raw.rejected.length + (raw.active ? 1 : 0)) fail(); return structuredClone(raw) as { active: BeforeConfigAttempt | null; rejected: BeforeConfigAttempt[] } }
  return { key: store.key, read, invalidate: store.invalidate,
    reserve(a: BeforeConfigAttempt, fresh: () => void) { fresh(); const state = read(); if (!validBeforeConfigAttempt(a) || a.agentId !== agentId || state.active || state.rejected.some(r => r.key === a.key) || state.rejected.length >= 20) fail(); return store.write({ ...state, active: a }, fresh) },
    resolve(a: BeforeConfigAttempt, op: BeforeConfigOperation, fresh: () => void) { fresh(); parseBeforeConfigOperation(op, a, parseExpectedContext(context).tenantId!); const state = read(); if (!same(state.active, a)) fail(); return store.write({ ...state, active: null }, fresh) },
    rejectVersion(a: BeforeConfigAttempt, fresh: () => void) { fresh(); const state = read(); if (!same(state.active, a) || state.rejected.length >= 20) fail(); return store.write({ active: null, rejected: [...state.rejected, a] }, fresh) },
  }
}
export function createBeforeOpeningJournal(storage: StoragePort, context: ExpectedContext, agentId: string) {
  const store = scope(storage, context, agentId, 'opening')
  function read(): { active: BeforeOpeningAttempt | null; history: BeforeOpeningAttempt[] } { const raw = store.read(); if (raw === undefined) return { active: null, history: [] }; if (!object(raw) || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'active') || !Object.hasOwn(raw, 'history') || raw.active !== null && (!validBeforeOpeningAttempt(raw.active) || raw.active.agentId !== agentId) || !Array.isArray(raw.history) || raw.history.length > 100 || raw.history.some(a => !validBeforeOpeningAttempt(a) || a.agentId !== agentId)) fail(); const all = [...raw.history, ...(raw.active ? [raw.active] : [])]; if (all.length > 100 || new Set(all.map(a => a.key)).size !== all.length) fail(); return structuredClone(raw) as { active: BeforeOpeningAttempt | null; history: BeforeOpeningAttempt[] } }
  return { key: store.key, read, invalidate: store.invalidate,
    reserve(a: BeforeOpeningAttempt, fresh: () => void) { fresh(); const state = read(); if (!validBeforeOpeningAttempt(a) || a.agentId !== agentId || state.active || state.history.length >= 100 || state.history.some(r => r.key === a.key)) fail(); return store.write({ ...state, active: a }, fresh) },
    archiveUnresolved(a: BeforeOpeningAttempt, fresh: () => void) { fresh(); const state = read(); if (!validBeforeOpeningAttempt(a) || !same(state.active, a) || state.history.length >= 100) fail(); return store.write({ active: null, history: [...state.history, a] }, fresh) },
    archiveReady(a: BeforeOpeningAttempt, op: BeforeOpening, fresh: () => void) { fresh(); parseBeforeOpening(op, a, parseExpectedContext(context).tenantId!); if (op.status !== 'ready') fail(); const state = read(); if (!same(state.active, a) || state.history.length >= 100) fail(); return store.write({ active: null, history: [...state.history, a] }, fresh) },
  }
}
