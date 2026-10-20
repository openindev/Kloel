import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { emailFixture } from './engine-email-agents-fixture'
import { createEmailReplyJournal, emailReplyReceiptClient, parseEmailReplyReceipt } from '../src/services/engine/email-reply-receipts'
import { resolveSessionContext } from '../../engine/src/request-context'

test('email receipt client reads original accepted attempt after disconnect, without another external call', async t => {
  const f = await emailFixture(t), box = f.box!; await f.client.sync(box.id)
  const message = (await f.client.messages(box.id)).items[0], draft = await f.client.generate(box.id, message.id, '', randomUUID()), key = randomUUID()
  await f.client.send(box.id, draft, key, true)
  f.store.remove(f.actor.tenantId, 'oauth-connections', f.connection.id)
  const before = f.providerCalls.length, attempt = { key, mailboxId: box.id, draftId: draft.id, expectedRevision: draft.revision }
  const result = await emailReplyReceiptClient(f.context).get(attempt)
  assert.equal(result.status, 'accepted'); assert.equal(f.providerCalls.length, before); assert.equal(result.delivered, false)
  assert.ok(!JSON.stringify(result).includes('providerMessageId'))
  for (const changed of [{ key: randomUUID() }, { mailboxId: randomUUID() }, { draftId: randomUUID() }, { expectedRevision: 2 }, { status: 'delivered' }, { delivered: true }, { requiresReconciliation: true }]) assert.throws(() => parseEmailReplyReceipt({ ...result, ...changed }, attempt))
})

test('email journal needs write/readback, preserves only opaque references and binds the session authority', async t => {
  const f = await emailFixture(t), context = resolveSessionContext(f.store, createHash('sha256').update(f.state.cookie).digest('hex'))!.context
  const bytes = new Map<string, string>(), storage = { getItem: (key: string) => bytes.get(key) ?? null, setItem: (key: string, value: string) => { bytes.set(key, value) } }
  const journal = createEmailReplyJournal(storage, context), attempt = { key: randomUUID(), mailboxId: f.box!.id, draftId: randomUUID(), expectedRevision: 1 }
  journal.reserve(attempt, () => {}); assert.deepEqual(journal.read()[0].attempt, attempt)
  assert.throws(() => journal.reserve({ ...attempt, key: randomUUID() }, () => {}))
  assert.throws(() => createEmailReplyJournal({ ...storage, setItem() { throw Error('quota') } }, context).reserve(attempt, () => {}))
  assert.throws(() => createEmailReplyJournal({ getItem: () => null, setItem() {} }, context).reserve(attempt, () => {}))
  assert.equal(createEmailReplyJournal(storage, { ...context, authorityVersion: 'a'.repeat(64) }).read().length, 0)
  assert.ok(![...bytes.values()].join('').includes('inbox@example.test'))
  assert.ok(![...bytes.values()].join('').includes('Conteúdo privado'))
})
