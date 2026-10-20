import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createIdentityReviewJournal, createIdentityReviewService, parseIdentityReview } from '../src/services/engine/whatsapp-identity-review'
import { EngineError } from '../src/services/engine/http'
import { identityUIFixture } from './engine-identity-review-fixture'

test('real HTTP review preserves history and controls, records manual-only without provider/job effects, and uses exact original receipt', async t => {
  const f = await identityUIFixture(t), before = f.current(), history = f.store.list(f.tenant, 'messages'), legacy = f.store.get(f.tenant, 'conversations', f.legacy.id)
  const current = await f.service.context(), ref = { key: randomUUID(), expectedVersion: current.version }
  assert.equal(current.canReview, true); assert.equal(current.reviewState, 'required'); assert.equal(current.collisions.items[0].conversationId, f.legacy.id)
  assert.ok(!JSON.stringify(current).includes(f.sender)); assert.ok(!JSON.stringify(current).includes('Private historical'))
  const receipt = await f.service.apply(ref), now = await f.service.context()
  assert.equal(receipt.originalVersion, ref.expectedVersion); assert.equal(receipt.status, 'applied'); assert.equal(now.reviewState, 'valid'); assert.notEqual(receipt.resultVersion, now.version)
  assert.equal(f.current().status, before.status); assert.deepEqual(f.current().tags, before.tags); assert.equal(f.current().metaIdentityPolicy, 'manual_only')
  assert.deepEqual(f.store.list(f.tenant, 'messages'), history); assert.deepEqual(f.store.get(f.tenant, 'conversations', f.legacy.id), legacy)
  const snapshot = f.snapshot(); assert.deepEqual(await f.service.operation(ref), receipt); assert.deepEqual(f.snapshot(), snapshot)
  assert.equal(f.calls.length, 0); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.writes().length, 1)
})
test('post-commit loss recovers by GET after route becomes stale, without installing the receipt as current context', async t => {
  const f = await identityUIFixture(t), current = await f.service.context(), ref = { key: randomUUID(), expectedVersion: current.version }
  f.state.loseAfter = true; await assert.rejects(f.service.apply(ref))
  f.store.update(f.tenant, 'conversations', f.legacy.id, { tags: ['human_handoff'] })
  const receipt = await f.service.operation(ref), state = await f.service.context()
  assert.equal(receipt.status, 'applied'); assert.equal(state.reviewState, 'stale'); assert.notEqual(state.version, receipt.originalVersion)
  assert.equal(f.writes().length, 1); assert.equal(f.lookups().length, 1); assert.equal(f.calls.length, 0)
})
test('real stale CAS is narrow precommit refusal; original GET404 does not initiate a second POST', async t => {
  const f = await identityUIFixture(t), current = await f.service.context(), ref = { key: randomUUID(), expectedVersion: current.version }
  await f.control({ status: 'open' }); await f.control({ status: 'pending' })
  await assert.rejects(f.service.apply(ref), e => e instanceof EngineError && e.status === 409 && e.code === 'whatsapp_identity_review_not_admitted')
  await assert.rejects(f.service.operation(ref), e => e instanceof EngineError && e.status === 404)
  assert.equal(f.store.list(f.tenant, 'whatsapp-identity-reviews').length, 0); assert.equal(f.writes().length, 1); assert.equal(f.calls.length, 0)
})
test('parser rejects forged scope, unmasked origin, incomplete admission, duplicated collisions and false validity', async t => {
  const f = await identityUIFixture(t), current = await f.context()
  for (const patch of [{ tenantId: 'foreign' }, { conversationId: 'other' }, { version: 'bad' }, { destination: { display: f.sender, provenance: 'signed_inbound' } }, { canReview: true, reasonCode: 'forbidden' }, { collisions: { ...current.collisions, complete: false } }, { collisions: { complete: true, items: [current.collisions.items[0], current.collisions.items[0]] } }, { reviewState: 'valid', policy: null }]) assert.throws(() => parseIdentityReview({ ...current, ...patch }, f.tenant, f.conversationId))
})
test('receipt parser binds original version/key/conversation and rejects a different decision or retry flag', async t => {
  const f = await identityUIFixture(t), current = await f.service.context(), ref = { key: randomUUID(), expectedVersion: current.version }, receipt = await f.service.apply(ref)
  for (const patch of [{ key: randomUUID() }, { conversationId: 'other' }, { originalVersion: 'f'.repeat(64) }, { policy: 'automatic' }, { status: 'pending' }, { automaticRetry: true }, { resultVersion: 'bad' }]) {
    const service = createIdentityReviewService({ ...f.bound, async request<T>() { return { ...receipt, ...patch } as T } }, f.conversationId)
    await assert.rejects(service.operation(ref))
  }
})
test('abort and revoked captured context fence late projection, without repeating requests', async t => {
  const f = await identityUIFixture(t), abort = new AbortController()
  f.state.after = (_p, _m, response) => { abort.abort(); return response }
  await assert.rejects(f.service.context(abort.signal)); const count = f.requests.length
  f.state.current = false; await assert.rejects(f.service.context()); assert.equal(f.requests.length, count)
})
function storageFixture() {
  const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
  const scope = { userId: 'user', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64), conversationId: 'conversation' }, ref = { key: randomUUID(), expectedVersion: 'b'.repeat(64) }
  return { data, storage, scope, ref, journal: createIdentityReviewJournal(() => storage, scope) }
}
test('journal stores only opaque metadata; another conversation or authority cannot adopt it', () => {
  const f = storageFixture(); f.journal.remember(f.ref); assert.deepEqual(f.journal.read(), f.ref); assert.deepEqual(JSON.parse([...f.data.values()][0]), { version: 1, ...f.ref })
  for (const patch of [{ userId: 'other' }, { tenantId: 'other' }, { membershipId: 'other' }, { authorityVersion: 'c'.repeat(64) }, { conversationId: 'other' }]) assert.equal(createIdentityReviewJournal(() => f.storage, { ...f.scope, ...patch }).read(), undefined)
})
test('journal rejects extra private fields/write loss and CAS protects a replacement pointer', () => {
  const f = storageFixture(); assert.throws(() => createIdentityReviewJournal(() => ({ ...f.storage, setItem() {} }), f.scope).remember(f.ref))
  f.journal.remember(f.ref); const name = [...f.data.keys()][0], other = { key: randomUUID(), expectedVersion: 'c'.repeat(64) }
  assert.throws(() => f.journal.remember(other)); f.data.set(name, JSON.stringify({ version: 1, ...other })); assert.throws(() => f.journal.clearResolved(f.ref)); assert.deepEqual(f.journal.read(), other)
  f.data.set(name, JSON.stringify({ version: 1, ...f.ref, destination: 'private' })); assert.throws(() => f.journal.read()); assert.throws(() => f.journal.clearResolved(f.ref))
})
