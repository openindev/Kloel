import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { captureFixture } from './engine-crm-capture-fixture'
import { createCaptureArchive } from '../src/services/engine/crm-capture-journal'
import type { CaptureAttempt, CaptureKind } from '../src/services/engine/crm-capture'

function memoryStorage() { const map = new Map<string, string>(); return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) }, removeItem: (key: string) => { map.delete(key) } } }
const identity = { userId: 'owner', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
const attempt = (): CaptureAttempt => ({ key: randomUUID(), kind: 'proposal.apply', targetId: 'proposal', revision: 1, contactId: null, contactRevision: null })

test('uncertain archive projects metadata only, deduplicates, persists review barrier and never evicts', () => {
  const storage = memoryStorage(), archive = createCaptureArchive(storage, identity), original = attempt(), assertCurrent = () => {}
  const saved = archive.archive({ ...original, content: 'DO-NOT-STORE', overrides: { name: 'PRIVATE' } } as any, assertCurrent)
  assert.equal(saved.reviewRequired, true); assert.doesNotMatch(storage.getItem(archive.key)!, /DO-NOT-STORE|PRIVATE|overrides|content/)
  archive.archive(original, assertCurrent); assert.equal(archive.read().entries.length, 1)
  archive.setReviewRequired(false, assertCurrent); assert.equal(archive.read().reviewRequired, false)
  for (let index = 1; index < 100; index++) archive.archive(attempt(), assertCurrent)
  const before = storage.getItem(archive.key); assert.throws(() => archive.archive(attempt(), assertCurrent), /cheio/); assert.equal(storage.getItem(archive.key), before)
})

test('storage readback and context changes fail closed without deleting the active pointer', () => {
  const storage = memoryStorage(), active = 'active-original', original = attempt(); storage.setItem(active, JSON.stringify(original))
  const archive = createCaptureArchive(storage, identity), previous = storage.setItem
  storage.setItem = (key, value) => { previous(key, value); if (key === archive.key) previous(key, '{}') }
  assert.throws(() => archive.archive(original, () => {})); assert.ok(storage.getItem(active))
  storage.removeItem(archive.key); let current = true
  storage.setItem = (key, value) => { previous(key, value); current = false }
  assert.throws(() => archive.archive(original, () => { if (!current) throw Error('authority changed') }), /authority changed/)
  assert.ok(storage.getItem(active)); assert.ok(storage.getItem(archive.key))
  storage.setItem = previous
  const foreign = createCaptureArchive(storage, { ...identity, authorityVersion: 'b'.repeat(64) }); assert.deepEqual(foreign.read().entries, []); assert.equal(storage.getItem(archive.key), null)
})

test('malformed and duplicated stored references are rejected instead of becoming a new active operation', () => {
  const storage = memoryStorage(), archive = createCaptureArchive(storage, identity), value = archive.archive(attempt(), () => {})
  storage.setItem(archive.key, JSON.stringify({ ...value, entries: [value.entries[0], value.entries[0]] })); assert.throws(() => archive.read())
  storage.setItem(archive.key, JSON.stringify({ ...value, entries: [{ ...value.entries[0], attempt: { ...value.entries[0].attempt, email: 'private@example.test' } }] })); assert.throws(() => archive.read())
})

for (const kind of ['grant.create', 'grant.pause', 'grant.revoke', 'proposal.apply', 'proposal.dismiss'] as const) test(`${kind}: a late original and explicit competing action have one winner in either commit order`, async t => {
  for (const originalFirst of [true, false]) await t.test(originalFirst ? 'original commits first' : 'new action commits first', async t => {
    const f = await captureFixture(t), proposal = kind.startsWith('proposal.') ? await f.propose() : undefined
    if (kind !== 'grant.create' && !proposal) await f.activate()
    const state = await f.client.policy(), grant = state.grant
    const original: CaptureAttempt = kind === 'grant.create'
      ? { key: randomUUID(), kind, settingsRevision: state.settingsRevision, previousGrantId: null, previousRevision: null }
      : kind.startsWith('grant.') ? { key: randomUUID(), kind, targetId: grant!.id, revision: grant!.revision }
      : { key: randomUUID(), kind, targetId: proposal!.id, revision: proposal!.revision, ...(kind === 'proposal.apply' ? { contactId: null, contactRevision: null } : {}) }
    const paired: CaptureKind = kind === 'grant.create' ? 'grant.create' : kind === 'grant.pause' ? 'grant.revoke' : kind === 'grant.revoke' ? 'grant.pause' : kind === 'proposal.apply' ? 'proposal.dismiss' : 'proposal.apply'
    const competitor: CaptureAttempt = { ...original, key: randomUUID(), kind: paired, ...(paired === 'proposal.apply' ? { contactId: null, contactRevision: null } : {}) }
    const data = (value: CaptureAttempt) => value.kind === 'grant.create' ? f.policy() : value.kind === 'proposal.apply' ? { selectedFieldIds: ['firstName', 'lastName'], overrides: {} } : undefined
    f.state.before = async (_path, method) => { if (method === 'POST') { f.state.before = undefined; throw Error('Original request disconnected before delivery') } }
    await assert.rejects(f.client.write(original, data(original))); const envelope = f.requests.at(-1)!
    const archive = createCaptureArchive(memoryStorage(), f.identity.context); archive.archive(original, () => {}); archive.setReviewRequired(false, () => {})
    // Deliver the captured original transport envelope; this is not a UI retry.
    const deliverOriginal = () => f.app.inject({ method: 'POST', url: envelope.path, headers: { ...envelope.headers, cookie: `kloel_session=${f.token}` }, payload: envelope.body })
    if (originalFirst) {
      const result = await deliverOriginal(); assert.ok([200, 201].includes(result.statusCode), result.body)
      await assert.rejects(f.client.write(competitor, data(competitor)))
      assert.equal((await f.client.operation(original)).key, original.key)
    } else {
      await f.client.write(competitor, data(competitor)); const result = await deliverOriginal(); assert.ok(result.statusCode >= 400, result.body)
      await assert.rejects(f.client.operation(original), (error: any) => error.status === 404)
    }
    assert.equal(archive.read().entries[0].attempt.key, original.key)
    assert.equal(f.store.list(f.actor.tenantId, 'crm-capture-http-operations').filter(row => [original.key, competitor.key].includes(String(row.key))).length, 1)
    assert.ok(f.store.list(f.actor.tenantId, 'contacts').length <= 1)
  })
})
