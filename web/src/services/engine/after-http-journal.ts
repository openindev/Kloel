import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { afterHttpId, parseAfterHttpConfigOperation, validAfterHttpAttempt, type AfterHttpAttempt, type AfterHttpConfigOperation } from './after-http'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type AfterHttpJournalState = { active: AfterHttpAttempt | null; archived: AfterHttpAttempt[] }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function fail(): never { throw Error('Não foi possível preservar o acompanhamento HTTP nesta aba. Novas solicitações estão bloqueadas.') }
export function createAfterHttpJournal(storage: StoragePort, input: ExpectedContext, agentId: string) {
  const context = parseExpectedContext(input)
  if (!afterHttpId(agentId) || !context.tenantId) fail()
  const key = `kloel-after-http:${context.userId}:${context.tenantId}:${agentId}`
  const valid = (a: unknown): a is AfterHttpAttempt => validAfterHttpAttempt(a) && a.agentId === agentId
  function read(): AfterHttpJournalState {
    const text = storage.getItem(key); if (text === null) return { active: null, archived: [] }
    let r: any; try { r = JSON.parse(text) } catch { fail() }
    if (!r || typeof r !== 'object' || Object.keys(r).sort().join(',') !== 'context,data,version' || r.version !== 1) fail()
    if (!same(parseExpectedContext(r.context), context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return { active: null, archived: [] } }
    const d = r.data
    if (!d || Object.keys(d).sort().join(',') !== 'active,archived' || d.active !== null && !valid(d.active) || !Array.isArray(d.archived) || d.archived.some((a: unknown) => !valid(a))) fail()
    const all = [...d.archived, ...(d.active ? [d.active] : [])]
    if (all.length > 20 || new Set(all.map(a => a.key)).size !== all.length) fail()
    return structuredClone(d)
  }
  function write(data: AfterHttpJournalState, fresh: () => void) { fresh(); const text = JSON.stringify({ version: 1, context, data }); storage.setItem(key, text); fresh(); if (storage.getItem(key) !== text) fail(); fresh(); return structuredClone(data) }
  return { key, read,
    reserve(a: AfterHttpAttempt, fresh: () => void) { fresh(); const s = read(); if (!valid(a) || s.active || s.archived.length >= 20 || s.archived.some(v => v.key === a.key)) fail(); return write({ ...s, active: a }, fresh) },
    resolve(a: AfterHttpAttempt, op: AfterHttpConfigOperation, fresh: () => void) { fresh(); parseAfterHttpConfigOperation(op, a, context.tenantId!); const s = read(); if (!same(s.active, a)) fail(); return write({ ...s, active: null }, fresh) },
    archive(a: AfterHttpAttempt, fresh: () => void) { fresh(); const s = read(); if (!same(s.active, a)) fail(); return write({ active: null, archived: [...s.archived, a] }, fresh) },
    forgetConfirmed(a: AfterHttpAttempt, op: AfterHttpConfigOperation, fresh: () => void) { fresh(); parseAfterHttpConfigOperation(op, a, context.tenantId!); const s = read(); if (!s.archived.some(v => same(v, a))) fail(); return write({ ...s, archived: s.archived.filter(v => !same(v, a)) }, fresh) },
  }
}
