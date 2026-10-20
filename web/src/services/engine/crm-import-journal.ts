import { parseExpectedContext } from './http'
import { validImportAttempt, type ImportAttempt } from './crm-import'
import type { ExpectedContext } from './types'

export type ImportArchiveEntry = { attempt: ImportAttempt; archivedAt: string }
export type ImportJournalState = { active: ImportAttempt | null; archived: ImportArchiveEntry[]; reviewRequired: boolean; reviewedFingerprint: string | null }
type Envelope = ImportJournalState & { schemaVersion: 1; context: ExpectedContext }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const fail = (): never => { throw Error('Não foi possível verificar a referência local da importação. Nenhuma nova confirmação será enviada.') }
const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const opaque = (value: ImportAttempt): ImportAttempt => { if (!validImportAttempt(value)) fail(); return { key: value.key, optionsDigest: value.optionsDigest, previewFingerprint: value.previewFingerprint } }
export function createCRMImportJournal(storage: StoragePort, input: ExpectedContext) {
  const context = parseExpectedContext(input); if (!context.tenantId || !context.membershipId) fail()
  // A different authority gets another namespace; old opaque references are not
  // adopted or silently evicted when another tab changes the logged-in identity.
  const key = `kloel-crm-import:${context.userId}:${context.tenantId}:${context.authorityVersion}`
  const empty = (): Envelope => ({ schemaVersion: 1, context, active: null, archived: [], reviewRequired: false, reviewedFingerprint: null })
  const project = ({ active, archived, reviewRequired, reviewedFingerprint }: Envelope): ImportJournalState => ({ active, archived, reviewRequired, reviewedFingerprint })
  function load(): Envelope {
    const text = storage.getItem(key); if (text === null) return empty()
    if (text.length > 200000) fail()
    let raw: any; try { raw = JSON.parse(text) } catch { fail() }
    if (!raw || raw.schemaVersion !== 1 || Object.keys(raw).sort().join() !== 'active,archived,context,reviewRequired,reviewedFingerprint,schemaVersion'
      || !raw.context || Object.keys(raw.context).sort().join() !== 'authorityVersion,membershipId,tenantId,userId'
      || !same(parseExpectedContext(raw.context), context) || typeof raw.reviewRequired !== 'boolean' || raw.reviewedFingerprint !== null && !fingerprint(raw.reviewedFingerprint)
      || !Array.isArray(raw.archived) || raw.archived.length > 100 || raw.active !== null && !validImportAttempt(raw.active)) fail()
    const active = raw.active === null ? null : opaque(raw.active)
    const archived: ImportArchiveEntry[] = raw.archived.map((entry: any) => {
      if (!entry || Object.keys(entry).sort().join() !== 'archivedAt,attempt' || !validImportAttempt(entry.attempt) || typeof entry.archivedAt !== 'string' || !Number.isFinite(Date.parse(entry.archivedAt))) fail()
      return { attempt: opaque(entry.attempt), archivedAt: entry.archivedAt }
    })
    if (new Set(archived.map(entry => entry.attempt.key)).size !== archived.length || active && archived.some(entry => entry.attempt.key === active.key)
      || raw.reviewRequired && raw.reviewedFingerprint !== null) fail()
    return { schemaVersion: 1, context, active, archived, reviewRequired: raw.reviewRequired, reviewedFingerprint: raw.reviewedFingerprint }
  }
  function persist(value: Envelope, assertCurrent: () => void): ImportJournalState {
    assertCurrent(); const serialized = JSON.stringify(value); storage.setItem(key, serialized); assertCurrent()
    if (storage.getItem(key) !== serialized) fail()
    assertCurrent(); return project(value)
  }
  return {
    key, read: (): ImportJournalState => project(load()),
    reserve(value: ImportAttempt, assertCurrent: () => void) {
      assertCurrent(); const current = load(), attempt = opaque(value)
      if (current.reviewRequired || current.reviewedFingerprint !== null && current.reviewedFingerprint !== attempt.previewFingerprint || current.archived.some(entry => entry.attempt.key === attempt.key)) fail()
      if (current.active && !same(current.active, attempt)) throw Error('Consulte a referência pendente antes de confirmar outra importação.')
      return persist({ ...current, active: attempt }, assertCurrent)
    },
    clear(value: ImportAttempt, assertCurrent: () => void) {
      assertCurrent(); const current = load(), attempt = opaque(value)
      if (!current.active || !same(current.active, attempt)) fail()
      return persist({ ...current, active: null, reviewRequired: true, reviewedFingerprint: null }, assertCurrent)
    },
    archive(value: ImportAttempt, assertCurrent: () => void) {
      assertCurrent(); const current = load(), attempt = opaque(value)
      if (!current.active || !same(current.active, attempt)) fail()
      if (current.archived.length >= 100) throw Error('O arquivo local está cheio. Nenhuma referência foi removida; consulte a importação pendente.')
      return persist({ ...current, active: null, archived: [...current.archived, { attempt, archivedAt: new Date().toISOString() }], reviewRequired: true, reviewedFingerprint: null }, assertCurrent)
    },
    /** UI calls this only after a newly completed, context-bound server preview. */
    acknowledgePreview(value: string, assertCurrent: () => void) {
      assertCurrent(); const current = load(); if (!fingerprint(value) || current.active) fail()
      return persist({ ...current, reviewRequired: false, reviewedFingerprint: value }, assertCurrent)
    },
  }
}
