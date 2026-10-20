import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { parseBeforeVoiceIntent, parseBeforeVoiceMetadata } from './before-voice'
import type { VoiceOperation } from './agent-test'
export type BeforeVoiceReference = { key: string; agentId: string; expectedRevision: number; expectedHttpRevision?: number; mode: 'live' | 'test' }
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function fail(): never { throw Error('Não foi possível preservar a referência de voz nesta aba. Novas chamadas estão bloqueadas.') }
export function createBeforeVoiceJournal(storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>, input: ExpectedContext, agentId: string) {
  const context = parseExpectedContext(input); if (!uuid(agentId) || !context.tenantId) fail()
  const key = `kloel-before-voice:${context.userId}:${context.tenantId}:${context.membershipId}:${context.authorityVersion}:${agentId}`
  function parse(raw: unknown): BeforeVoiceReference {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['agentId','expectedRevision','expectedHttpRevision','key','mode'].includes(k))) fail()
    const r = raw as BeforeVoiceReference; if (!uuid(r.key) || r.agentId !== agentId) fail(); parseBeforeVoiceIntent({ expectedRevision:r.expectedRevision, mode:r.mode, ...(r.expectedHttpRevision === undefined ? {} : {expectedHttpRevision:r.expectedHttpRevision}) }); return structuredClone(r)
  }
  function read(): BeforeVoiceReference | undefined {
    const value = storage.getItem(key); if (value === null) return undefined
    let raw: any; try { raw = JSON.parse(value) } catch { fail() }
    if (!raw || Object.keys(raw).sort().join(',') !== 'context,reference,version' || raw.version !== 1 || !same(parseExpectedContext(raw.context),context)) fail()
    return parse(raw.reference)
  }
  return { key, read,
    reserve(reference: BeforeVoiceReference, fresh: () => void) {
      fresh(); const r = parse(reference); if (read()) fail()
      const text = JSON.stringify({version:1,context,reference:r}); storage.setItem(key,text); fresh(); if (storage.getItem(key) !== text) fail(); fresh(); return r
    },
    clearResolved(reference: BeforeVoiceReference, operation: VoiceOperation, fresh: () => void) {
      fresh(); parse(reference); if (!same(read(),reference) || operation.operationKey !== reference.key || !(operation.hangupStatus === 'accepted' || operation.status === 'failed' && !operation.callId)) fail()
      if (operation.beforeContext) parseBeforeVoiceMetadata(operation.beforeContext,undefined,{expectedRevision:reference.expectedRevision,mode:reference.mode,...(reference.expectedHttpRevision === undefined ? {} : {expectedHttpRevision:reference.expectedHttpRevision})})
      storage.removeItem(key); fresh(); if (storage.getItem(key) !== null) fail(); fresh()
    },
  }
}
