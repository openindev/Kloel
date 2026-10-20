import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createManualAdmissionJournal, createManualAdmissionService, parseManualAdmissionContext } from '../src/services/engine/whatsapp-manual-admission'
import { EngineError } from '../src/services/engine/http'
import type { EngineContext } from '../src/services/engine/session'

const version = 'a'.repeat(64), tenantId = 'tenant', conversationId = 'conversation'
const contextFixture = () => ({ tenantId, conversationId, version, canAdmit: true, reasonCode: null, sourceMessageId: 'source', windowExpiresAt: '2026-10-20T05:00:00.000Z', origin: { display: '••••1234', provenance: 'signed_inbound' }, evidence: { complete: true, items: [{ evidenceId: 'evidence', observedAt: '2026-10-19T05:00:00.000Z', expiresAt: '2026-10-20T05:00:00.000Z', deliveryStatus: 'delivered', origin: { display: '••••1234', provenance: 'signed_inbound' }, destination: { display: '••••1234', provenance: 'meta_send_response_contact' } }] } })
const ref = () => ({ key: randomUUID(), expectedVersion: version })
const receiptFixture = (reference: ReturnType<typeof ref>, evidence: string | null = null) => ({ id: 'admission', key: reference.key, tenantId, conversationId, kind: 'manual_ai_admission', status: 'admitted', sourceMessageId: 'source', recipientEvidenceId: evidence, originalVersion: reference.expectedVersion, jobId: 'job', jobVersion: 'b'.repeat(64), executionStarted: false, automaticRetry: false, createdAt: '2026-10-19T05:00:00.000Z' })
function bound(response: unknown) {
  const requests: { path: string; options: any }[] = [], state = { current: true, after: undefined as (() => void) | undefined }
  const context = { tenantId, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', '') }, async request(path: string, options?: unknown) { requests.push({ path, options }); state.after?.(); return response } } as unknown as EngineContext
  return { service: createManualAdmissionService(context, conversationId), requests, state }
}
test('preparation service sends source and optional evidence identifiers only, never executes a job', async () => {
  for (const evidence of [undefined, 'evidence']) {
    const reference = ref(), f = bound({ operation: receiptFixture(reference, evidence ?? null), replayed: false })
    const result = await f.service.admit(reference, 'source', evidence)
    assert.equal(result.jobId, 'job'); assert.equal(result.executionStarted, false); assert.equal(f.requests.length, 1)
    assert.deepEqual(f.requests[0], { path: '/whatsapp/conversations/conversation/manual-ai-admissions', options: { method: 'POST', body: { expectedTenantId: tenantId, expectedVersion: version, key: reference.key, sourceMessageId: 'source', ...(evidence ? { recipientEvidenceId: evidence } : {}), confirm: true } } })
  }
})
test('a response for a different input or authority cannot become a confirmed preparation', async () => {
  const reference = ref()
  for (const patch of [{ key: randomUUID() }, { originalVersion: 'c'.repeat(64) }, { tenantId: 'foreign' }, { conversationId: 'foreign' }, { sourceMessageId: 'other' }, { recipientEvidenceId: 'other' }, { jobVersion: 'invalid' }, { executionStarted: true }, { automaticRetry: true }]) {
    const f = bound({ operation: { ...receiptFixture(reference), ...patch }, replayed: false })
    await assert.rejects(f.service.admit(reference, 'source')); assert.equal(f.requests.length, 1)
  }
})
test('original receipt lookup is GET-only, and neither missing response nor malformed receipt repeats admission', async () => {
  const reference = ref(), f = bound(receiptFixture(reference)); assert.equal((await f.service.operation(reference)).jobId, 'job')
  assert.deepEqual(f.requests, [{ path: '/whatsapp/conversations/conversation/manual-ai-admissions/' + reference.key, options: undefined }])
  const malformed = bound(null); await assert.rejects(malformed.service.admit(reference, 'source')); assert.equal(malformed.requests.length, 1)
  await assert.rejects(malformed.service.operation(reference)); assert.equal(malformed.requests.length, 2); assert.equal(malformed.requests[1].options, undefined)
})
test('late authority changes and abort fence projection without issuing another request', async () => {
  const reference = ref(), f = bound({ operation: receiptFixture(reference), replayed: false }); f.state.after = () => { f.state.current = false }
  await assert.rejects(f.service.admit(reference, 'source'), e => e instanceof EngineError && e.code === 'superseded')
  await assert.rejects(f.service.operation(reference)); assert.equal(f.requests.length, 1)
  const abort = new AbortController(), g = bound(contextFixture()); g.state.after = () => abort.abort()
  await assert.rejects(g.service.context(abort.signal)); assert.equal(g.requests.length, 1)
})
test('context permits exact origin with incomplete alternatives but rejects raw numbers, duplicate choices and invalid eligibility', () => {
  const original = contextFixture(); assert.equal(parseManualAdmissionContext(original, tenantId, conversationId).canAdmit, true)
  assert.equal(parseManualAdmissionContext({ ...original, evidence: { complete: false, items: [] } }, tenantId, conversationId).canAdmit, true, 'exact signed route does not require an alternative evidence list')
  for (const patch of [{ tenantId: 'other' }, { conversationId: 'other' }, { version: 'invalid' }, { origin: { display: '+15551231234', provenance: 'signed_inbound' } }, { sourceMessageId: null }, { canAdmit: true, reasonCode: 'blocked' }, { canAdmit: false, reasonCode: null }, { evidence: { complete: true, items: [original.evidence.items[0], original.evidence.items[0]] } }, { evidence: { complete: true, items: [{ ...original.evidence.items[0], destination: { display: '+15551231234', provenance: 'meta_send_response_contact' } }] } }, { evidence: { complete: true, items: [{ ...original.evidence.items[0], deliveryStatus: 'accepted' }] } }]) assert.throws(() => parseManualAdmissionContext({ ...original, ...patch }, tenantId, conversationId))
})
function storageFixture() {
  const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
  const scope = { userId: 'user', tenantId, membershipId: 'membership', authorityVersion: version, conversationId }
  return { data, storage, scope, journal: createManualAdmissionJournal(() => storage, scope) }
}
test('reload journal contains only opaque recovery data and isolates original authority and conversation', () => {
  const f = storageFixture(), reference = ref(); f.journal.remember(reference)
  assert.deepEqual(createManualAdmissionJournal(() => f.storage, f.scope).read(), reference)
  assert.deepEqual(JSON.parse([...f.data.values()][0]), { version: 1, ...reference })
  for (const patch of [{ userId: 'other' }, { tenantId: 'other' }, { membershipId: 'other' }, { authorityVersion: 'c'.repeat(64) }, { conversationId: 'other' }]) assert.equal(createManualAdmissionJournal(() => f.storage, { ...f.scope, ...patch }).read(), undefined)
})
test('journal rejects lost persistence, private fields and replacement pointers without clearing another operation', () => {
  const f = storageFixture(), reference = ref()
  assert.throws(() => createManualAdmissionJournal(() => ({ ...f.storage, setItem() {} }), f.scope).remember(reference))
  f.journal.remember(reference); const name = [...f.data.keys()][0], other = { ...ref(), expectedVersion: 'c'.repeat(64) }
  assert.throws(() => f.journal.remember(other)); f.data.set(name, JSON.stringify({ version: 1, ...other })); assert.throws(() => f.journal.clearResolved(reference)); assert.deepEqual(f.journal.read(), other)
  f.data.set(name, JSON.stringify({ version: 1, ...reference, message: 'private body' })); assert.throws(() => f.journal.read()); assert.throws(() => f.journal.clearResolved(reference))
})
