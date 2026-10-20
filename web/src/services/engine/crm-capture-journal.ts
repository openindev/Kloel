import { parseExpectedContext } from './http'
import { validCaptureAttempt, type CaptureAttempt } from './crm-capture'
import type { ExpectedContext } from './types'

export type CaptureArchiveEntry = { attempt: CaptureAttempt; archivedAt: string }
export type CaptureArchive = { schemaVersion: 1; context: ExpectedContext; entries: CaptureArchiveEntry[]; reviewRequired: boolean }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const fail = (): never => { throw Error('O arquivo local de acompanhamentos não pôde ser verificado. A referência ativa foi preservada.') }

/** Only opaque operation metadata crosses into session storage. Never persist input or receipt payloads. */
function metadata(raw: CaptureAttempt): CaptureAttempt {
  if (!validCaptureAttempt(raw)) fail()
  return raw.kind === 'grant.create'
    ? { key: raw.key, kind: raw.kind, settingsRevision: raw.settingsRevision, previousGrantId: raw.previousGrantId, previousRevision: raw.previousRevision }
    : { key: raw.key, kind: raw.kind, targetId: raw.targetId, revision: raw.revision, ...(raw.kind === 'proposal.apply' ? { contactId: raw.contactId, contactRevision: raw.contactRevision } : {}) }
}
export function createCaptureArchive(storage: StoragePort, expected: ExpectedContext) {
  const context = parseExpectedContext(expected), key = `kloel-crm-capture:${context.userId}:${context.tenantId}:uncertain`
  const empty = (): CaptureArchive => ({ schemaVersion: 1, context, entries: [], reviewRequired: false })
  function read(): CaptureArchive {
    const source = storage.getItem(key)
    if (source === null) return empty()
    let raw: any; try { raw = JSON.parse(source) } catch { fail() }
    if (!raw || raw.schemaVersion !== 1 || typeof raw.reviewRequired !== 'boolean' || !Array.isArray(raw.entries) || raw.entries.length > 100) fail()
    const recordedContext = parseExpectedContext(raw.context)
    // A new authority cannot adopt old-session references or see their result.
    if (!same(recordedContext, context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return empty() }
    const entries = raw.entries.map((entry: any) => {
      if (!entry || typeof entry.archivedAt !== 'string' || !Number.isFinite(Date.parse(entry.archivedAt)) || !validCaptureAttempt(entry.attempt)) fail()
      const attempt = metadata(entry.attempt)
      if (Object.keys(entry).some(name => !['attempt', 'archivedAt'].includes(name)) || !same(Object.keys(entry.attempt).sort(), Object.keys(attempt).sort())) fail()
      return { attempt, archivedAt: entry.archivedAt }
    })
    if (new Set(entries.map((entry: CaptureArchiveEntry) => entry.attempt.key)).size !== entries.length) fail()
    return { schemaVersion: 1, context, entries, reviewRequired: raw.reviewRequired }
  }
  function persist(value: CaptureArchive, assertCurrent: () => void) {
    assertCurrent()
    const serialized = JSON.stringify(value); storage.setItem(key, serialized)
    assertCurrent()
    if (storage.getItem(key) !== serialized) fail()
    assertCurrent()
    return value
  }
  return {
    key, read,
    archive(attempt: CaptureAttempt, assertCurrent: () => void): CaptureArchive {
      assertCurrent(); const current = read(), opaque = metadata(attempt), existing = current.entries.find(entry => entry.attempt.key === opaque.key)
      if (existing && !same(existing.attempt, opaque)) fail()
      if (!existing && current.entries.length >= 100) throw Error('O arquivo local está cheio. Nenhuma referência foi removida.')
      return persist({ ...current, entries: existing ? current.entries : [...current.entries, { attempt: opaque, archivedAt: new Date().toISOString() }], reviewRequired: true }, assertCurrent)
    },
    setReviewRequired(required: boolean, assertCurrent: () => void): CaptureArchive {
      assertCurrent(); const current = read()
      return persist({ ...current, reviewRequired: required }, assertCurrent)
    },
  }
}
