import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { emailFixture } from './engine-email-agents-fixture'

test('email client organizes a Microsoft mailbox through Graph and validates every confirmation', async t => {
  const f = await emailFixture(t, { provider: 'microsoft', organize: true }), box = f.box!
  await f.client.sync(box.id)
  const state = await f.client.mailboxState(); assert.equal(state.items[0]!.canOrganize, true); assert.deepEqual(state.detachedConnectionIds, [])
  const message = (await f.client.messages(box.id)).items[0]!
  assert.equal((await f.client.setRead(box.id, message.id, true)).read, true)
  assert.deepEqual(f.providerCalls.at(-1), { path: '/v1.0/me/messages/mail-1', method: 'PATCH' })
  const manual = await f.client.manualDraft(box.id, message.id, 'Resposta da equipe', randomUUID()); assert.equal(manual.manual, true); assert.equal(manual.automatic, false)
  assert.deepEqual((await f.client.discard(box.id, manual)).discarded, [manual.id])
  await assert.rejects(f.client.discard(box.id, manual), (e: any) => e.code === 'email_draft_changed')
  assert.equal((await f.client.archive(box.id, message.id)).deleted, true)
  assert.deepEqual(f.providerCalls.at(-1), { path: '/v1.0/me/messages/mail-1/move', method: 'POST' })
  await assert.rejects(f.client.trash(box.id, message.id), (e: any) => e.code === 'email_message_deleted')
  assert.equal((await f.client.messages(box.id, 'all')).total, 0)
})

test('legacy read-only authorization keeps reading but refuses organizing before reaching the provider', async t => {
  const f = await emailFixture(t), box = f.box!
  await f.client.sync(box.id)
  const mailbox = (await f.client.mailboxState()).items[0]!; assert.equal(mailbox.canOrganize, false); assert.equal(mailbox.organizeOnReconnect, true)
  const message = (await f.client.messages(box.id)).items[0]!, writes = f.providerCalls.length
  for (const action of [() => f.client.setRead(box.id, message.id, true), () => f.client.archive(box.id, message.id), () => f.client.trash(box.id, message.id)])
    await assert.rejects(action(), (e: any) => e.status === 403 && e.code === 'email_organize_scope_missing')
  assert.equal(f.providerCalls.length, writes)
})

test('disconnecting a calendar+email account hides the mailbox but keeps the calendar authorization', async t => {
  const f = await emailFixture(t, { organize: true }), box = f.box!
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { capabilities: ['calendar', 'calendar_write', 'email', 'email_send'] })
  await f.client.sync(box.id)
  const before = f.store.get(f.actor.tenantId, 'oauth-connections', f.connection.id)!
  assert.deepEqual(await f.client.disconnect(f.connection.id), { connection: 'kept_for_other_features', removedMailboxes: 1 })
  const after = f.store.get(f.actor.tenantId, 'oauth-connections', f.connection.id)!
  assert.equal(after.status, 'connected'); assert.equal(after.authorizationGeneration, before.authorizationGeneration); assert.deepEqual(after.capabilities, before.capabilities)
  assert.deepEqual(await f.client.mailboxState(), { items: [], detachedConnectionIds: [f.connection.id] })
  await assert.rejects(f.client.disconnect(f.connection.id).then(() => f.client.messages(box.id)), (e: any) => e.code === 'email_mailbox_not_found')
  assert.ok(!f.providerCalls.some(c => c.method === 'DELETE'))
})
