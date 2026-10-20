import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { parseActionReceipt, validActionAttempt, type ActionAttempt, type ActionReceipt } from './sheets-actions'

export type ActionReference = { attempt: ActionAttempt; resolved: boolean }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function fail(): never { throw Error('Não foi possível preservar o acompanhamento nesta aba. Novas solicitações estão bloqueadas.') }
export function actionLane(a: ActionAttempt) { return a.kind === 'action.create' ? `create:${a.agentId}` : a.kind === 'grant.create' ? `grant:${a.actionId}:${a.channelId}` : a.kind === 'grant.revoke' ? `revoke:${a.grantId}` : `action:${a.actionId}` }
export function createSheetActionJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, input: ExpectedContext) {
  const context = parseExpectedContext(input), key = `kloel-sheets-actions:${context.userId}:${context.tenantId}`
  if (!context.tenantId || !context.membershipId) fail()
  function read(): ActionReference[] {
    const value = storage.getItem(key); if (value === null) return []
    let raw: any; try { raw = JSON.parse(value) } catch { fail() }
    if (!raw || raw.version !== 1 || Object.keys(raw).some(k => !['version', 'context', 'references'].includes(k)) || !Array.isArray(raw.references) || raw.references.length > 40) fail()
    const previous = parseExpectedContext(raw.context)
    if (!same(previous, context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return [] }
    const refs: ActionReference[] = raw.references.map((r: any) => {
      if (!r || Object.keys(r).some(k => !['attempt', 'resolved'].includes(k)) || !validActionAttempt(r.attempt) || typeof r.resolved !== 'boolean') fail()
      return { attempt: structuredClone(r.attempt), resolved: r.resolved }
    })
    const open = refs.filter(r => !r.resolved)
    if (new Set(refs.map(r => r.attempt.key)).size !== refs.length || new Set(open.map(r => actionLane(r.attempt))).size !== open.length) fail()
    return refs
  }
  function write(refs: ActionReference[], fresh: () => void) { fresh(); const value = JSON.stringify({ version: 1, context, references: refs }); storage.setItem(key, value); fresh(); if (storage.getItem(key) !== value) fail(); fresh(); return refs }
  return {
    key, read,
    reserve(attempt: ActionAttempt, fresh: () => void) {
      fresh(); if (!validActionAttempt(attempt)) fail(); const refs = read(), old = refs.find(r => r.attempt.key === attempt.key)
      if (old) { if (old.resolved || !same(old.attempt, attempt)) fail(); return write(refs, fresh) }
      if (refs.length >= 40) throw Error('O acompanhamento está cheio. Encerre referências confirmadas antes de iniciar outra intenção.')
      if (refs.some(r => !r.resolved && actionLane(r.attempt) === actionLane(attempt))) throw Error('Consulte a referência em aberto. Uma nova chave poderia repetir a intenção.')
      return write([...refs, { attempt: structuredClone(attempt), resolved: false }], fresh)
    },
    resolve(attempt: ActionAttempt, receipt: ActionReceipt, fresh: () => void) {
      fresh(); parseActionReceipt(receipt, attempt); const refs = read(), old = refs.find(r => r.attempt.key === attempt.key)
      if (!old || !same(old.attempt, attempt)) fail()
      return write(refs.map(r => r === old ? { ...r, resolved: true } : r), fresh)
    },
    removeResolved(attempt: ActionAttempt, fresh: () => void) {
      fresh(); const refs = read(), old = refs.find(r => r.attempt.key === attempt.key)
      if (!old?.resolved || !same(old.attempt, attempt)) fail()
      return write(refs.filter(r => r !== old), fresh)
    },
  }
}
