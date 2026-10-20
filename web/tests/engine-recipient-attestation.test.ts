import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { recipientUIFixture } from './engine-recipient-attestation-fixture'
import { createRecipientAttestationService, createRecipientJournal, parseRecipientContext } from '../src/services/engine/whatsapp-recipient-attestation'
import { createWhatsAppConversationReplyService, createWhatsAppReplyJournal } from '../src/services/engine/whatsapp-conversation-replies'
import { EngineError } from '../src/services/engine/http'

test('real delivered evidence attests without send; selected context and one consumed reply keep origin/history separate', async t => {
  const f = await recipientUIFixture(t), c = await f.service.context(), originalMessages = f.store.list(f.tenant, 'messages')
  assert.equal(c.canAttest, true); assert.equal(c.evidence.items.length, 1); const e = c.evidence.items[0]
  assert.equal(e.deliveryStatus, 'delivered'); assert.notEqual(e.currentChannelVersion, e.observedChannelVersion); assert.equal(e.currentChannelRevision, 3)
  const ref = { key: randomUUID(), expectedVersion: c.version, evidenceId: e.evidenceId }, receipt = await f.service.attest(ref)
  assert.equal(f.calls.length, 0); assert.deepEqual(f.store.list(f.tenant, 'messages'), originalMessages); assert.equal(receipt.consumedByReplyKey, null)
  const normal = await f.replies.context(), selected = await f.replies.context(undefined, receipt.id)
  assert.equal(normal.destination?.provenance, 'signed_inbound'); assert.equal(normal.recipientAttestationId, undefined)
  assert.equal(selected.destination?.provenance, 'operator_attested'); assert.equal(selected.origin?.provenance, 'signed_inbound'); assert.equal(selected.recipientAttestationId, receipt.id)
  f.hooks.provider = () => Response.json({ messages: [{ id: 'wamid.reply-' + randomUUID() }] })
  const replyRef = { key: randomUUID(), expectedVersion: selected.version, recipientAttestationId: receipt.id }, reply = await f.replies.send(replyRef, 'Controlled human reply')
  assert.equal(reply.externalEffect, 'accepted'); assert.equal(f.calls.length, 1); assert.equal(f.replyPosts()[0].body.recipientAttestationId, receipt.id)
  assert.equal((await f.service.operation(ref)).consumedByReplyKey, replyRef.key)
  const consumed = await f.replies.context(undefined, receipt.id); assert.equal(consumed.canReply, false); assert.equal(consumed.reasonCode, 'attestation_consumed'); assert.equal(consumed.destination, null)
  const created = f.store.list(f.tenant, 'messages').filter(m => !originalMessages.some(a => a.id === m.id)); assert.equal(created.length, 1); assert.equal(created[0].conversationId, f.conversationId)
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.current().metaIdentityPolicy, 'manual_only')
})
test('lost attestation response recovers through GET only; post-commit stale evidence does not make a receipt a usable grant', async t => {
  const f = await recipientUIFixture(t), c = await f.service.context(), ref = { key: randomUUID(), expectedVersion: c.version, evidenceId: c.evidence.items[0].evidenceId }
  f.state.loseAfter = '/recipient-attestations'; await assert.rejects(f.service.attest(ref)); await f.control({ subject: 'Changed after decision' })
  const receipt = await f.service.operation(ref), context = await f.replies.context(undefined, receipt.id)
  assert.equal(receipt.status, 'attested'); assert.equal(context.canReply, false); assert.equal(context.destination, null); assert.equal(f.attestPosts().length, 1); assert.equal(f.calls.length, 0)
})
test('stale attestation intent is refused before commit and GET404 never initiates another decision', async t => {
  const f = await recipientUIFixture(t), c = await f.service.context(), ref = { key: randomUUID(), expectedVersion: c.version, evidenceId: c.evidence.items[0].evidenceId }
  await f.control({ subject: 'Concurrent edit' })
  await assert.rejects(f.service.attest(ref), e => e instanceof EngineError && e.status === 409 && e.code === 'recipient_attestation_not_admitted')
  await assert.rejects(f.service.operation(ref), e => e instanceof EngineError && e.status === 404)
  assert.equal(f.attestPosts().length, 1); assert.equal(f.calls.length, 0)
})
test('evidence parser rejects wrong scope, unmasked or inconsistent origin, unsigned delivery and incomplete admission', async t => {
  const f = await recipientUIFixture(t), c = await f.context(), e = c.evidence.items[0]
  for (const patch of [{ tenantId: 'foreign' }, { conversationId: 'other' }, { origin: { display: f.sender, provenance: 'signed_inbound' } }, { evidence: { complete: false, items: [e] } }, { evidence: { complete: true, items: [e, e] } }, { evidence: { complete: true, items: [{ ...e, deliveryStatus: 'accepted' }] } }, { evidence: { complete: true, items: [{ ...e, origin: { display: '••••1111', provenance: 'signed_inbound' } }] } }]) assert.throws(() => parseRecipientContext({ ...c, ...patch }, f.tenant, f.conversationId))
})
test('receipt parser binds selected proof, original version and operation; reply context cannot substitute an attestation or fallback provenance', async t => {
  const f = await recipientUIFixture(t), c = await f.service.context(), ref = { key: randomUUID(), expectedVersion: c.version, evidenceId: c.evidence.items[0].evidenceId }, r = await f.service.attest(ref)
  for (const patch of [{ evidenceId: 'other' }, { key: randomUUID() }, { conversationId: 'other' }, { originalVersion: 'a'.repeat(64) }, { automaticRetry: true }, { status: 'pending' }]) await assert.rejects(createRecipientAttestationService({ ...f.bound, async request<T>() { return { ...r, ...patch } as T } }, f.conversationId).operation(ref))
  const good = await f.replies.context(undefined, r.id)
  for (const patch of [{ recipientAttestationId: 'other' }, { origin: null }, { attestationExpiresAt: null }, { destination: { ...good.destination, provenance: 'signed_inbound' } }]) await assert.rejects(createWhatsAppConversationReplyService({ ...f.bound, async request<T>() { return { ...good, ...patch } as T } }, f.conversationId).context(undefined, r.id))
  await assert.rejects(createWhatsAppConversationReplyService({ ...f.bound, async request<T>() { return good as T } }, f.conversationId).context())
})
test('aborted or revoked captured context does not publish a late recipient context or start another request', async t => {
  const f = await recipientUIFixture(t), abort = new AbortController(); f.state.after = (_p, _m, response) => { abort.abort(); return response }
  await assert.rejects(f.service.context(abort.signal)); const count = f.requests.length; f.state.current = false; await assert.rejects(f.service.context()); assert.equal(f.requests.length, count)
})
function memoryStorage() { const map = new Map<string, string>(); return { map, storage: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } }, scope: { userId: 'user', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64), conversationId: 'conversation' } } }
test('attestation journal has opaque references only, fails closed on storage loss and rejects cleanup for another operation', () => {
  const f = memoryStorage(), j = createRecipientJournal(() => f.storage, f.scope), ref = { key: randomUUID(), expectedVersion: 'b'.repeat(64), evidenceId: 'evidence' }
  assert.throws(() => createRecipientJournal(() => ({ ...f.storage, setItem() {} }), f.scope).remember(ref)); j.remember(ref)
  assert.deepEqual(JSON.parse([...f.map.values()][0]), { version: 1, ...ref }); assert.equal(createRecipientJournal(() => f.storage, { ...f.scope, authorityVersion: 'c'.repeat(64) }).read(), undefined)
  const name = [...f.map.keys()][0], other = { ...ref, key: randomUUID() }; f.map.set(name, JSON.stringify({ version: 1, ...other })); assert.throws(() => j.clearResolved(ref)); assert.deepEqual(j.read(), other)
  f.map.set(name, JSON.stringify({ version: 1, ...ref, phone: 'secret' })); assert.throws(() => j.read())
})
test('reply journal preserves original no-attestation shape and binds optional opaque attestation ID without recipient data', () => {
  const f = memoryStorage(), j = createWhatsAppReplyJournal(() => f.storage, f.scope), ref = { key: randomUUID(), expectedVersion: 'b'.repeat(64) }
  j.remember(ref); assert.deepEqual(j.read(), ref); j.clearResolved(ref)
  const withAttestation = { ...ref, recipientAttestationId: 'attestation-id' }; j.remember(withAttestation); assert.deepEqual(j.read(), withAttestation); assert.throws(() => j.clearResolved(ref)); assert.deepEqual(j.read(), withAttestation)
  assert.deepEqual(JSON.parse([...f.map.values()][0]), { version: 1, ...withAttestation })
})
