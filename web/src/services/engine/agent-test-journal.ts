import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { parseSheetAppendOperation, type SheetAppendOperation } from './agent-test'

export type ChatReference = { key: string; conversationId?: string }
export type TestReferences = { pending: ChatReference | null; operations: string[] }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function fail(): never { throw Error('Não foi possível preservar o acompanhamento nesta aba. Novos envios estão bloqueados.') }
function reference(raw: any): ChatReference { if (!raw || !uuid(raw.key) || Object.keys(raw).some(k => !['key', 'conversationId'].includes(k)) || raw.conversationId !== undefined && (typeof raw.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(raw.conversationId))) fail(); return { key: raw.key, ...(raw.conversationId ? { conversationId: raw.conversationId } : {}) } }
export function createAgentTestJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, input: ExpectedContext, agentId: string) {
  const context = parseExpectedContext(input), key = `kloel-agent-test:${context.userId}:${context.tenantId}:${agentId}`
  function read(): TestReferences {
    const value = storage.getItem(key); if (value === null) return { pending: null, operations: [] }
    let raw: any; try { raw = JSON.parse(value) } catch { fail() }
    if (!raw || raw.version !== 1 || Object.keys(raw).some(k => !['version', 'context', 'pending', 'operations'].includes(k))) fail()
    if (!same(parseExpectedContext(raw.context), context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return { pending: null, operations: [] } }
    if (!Array.isArray(raw.operations) || raw.operations.length > 100 || raw.operations.some((v: unknown) => !uuid(v)) || new Set(raw.operations).size !== raw.operations.length) fail()
    return { pending: raw.pending === null ? null : reference(raw.pending), operations: [...raw.operations] }
  }
  function write(value: TestReferences, fresh: () => void) {
    fresh(); if (value.operations.length > 100) fail()
    const text = value.pending || value.operations.length ? JSON.stringify({ version: 1, context, ...value }) : null
    if (text === null) storage.removeItem(key); else storage.setItem(key, text)
    fresh(); if (storage.getItem(key) !== text) fail(); fresh(); return value
  }
  return {
    key, read,
    reserve(attempt: ChatReference, fresh: () => void) { fresh(); const a = reference(attempt), state = read(); if (state.pending || state.operations.length > 80) fail(); return write({ ...state, pending: a }, fresh) },
    record(attempt: ChatReference, operations: SheetAppendOperation[], complete: boolean, fresh: () => void) {
      fresh(); const state = read(); if (!same(state.pending, reference(attempt))) fail()
      const refs = operations.map(value => parseSheetAppendOperation(value).operationRef)
      return write({ pending: complete ? null : state.pending, operations: [...new Set([...state.operations, ...refs])] }, fresh)
    },
    forget(operation: SheetAppendOperation, fresh: () => void) {
      fresh(); const value = parseSheetAppendOperation(operation); if (!['appended', 'not_sent'].includes(value.status)) fail()
      const state = read(); if (!state.operations.includes(value.operationRef)) fail()
      return write({ ...state, operations: state.operations.filter(id => id !== value.operationRef) }, fresh)
    },
    invalidate() { storage.removeItem(key); if (storage.getItem(key) !== null) fail() },
  }
}
