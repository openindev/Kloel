import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { emailFixture } from './engine-email-agents-fixture'
import { automationPolicy, defaultAutomationPolicy, defaultReplyPolicy, emailAgentClient, mailboxConfig } from '../src/services/engine/email-agents'
import { seedMember } from '../../engine/tests/fixtures/membership'

test('email client persists full mailbox configuration with CAS and fresh tenant authority', async t => {
  const f = await emailFixture(t, { empty: true }), box = await f.client.configure(f.config)
  assert.equal(box.name, 'Atendimento real'); assert.equal(box.autoSend, false); assert.equal(box.schedulerRunning, false)
  assert.equal((await f.client.choices('agents'))[0].id, f.agent.id); assert.equal((await f.client.choices('knowledge'))[0].name, 'Horários reais')
  const updated = await f.client.configure({ ...mailboxConfig(box), context: 'Contexto novo', rules: [{ text: 'Não inventar prazos', active: true }] }, box)
  assert.equal(updated.revision, 2)
  await assert.rejects(f.context.request(`/email-agents/mailboxes/${box.id}`, { method: 'PUT', body: f.config }), (e: any) => e.status === 400)
  await assert.rejects(f.client.configure(f.config, box), (e: any) => e.code === 'email_mailbox_revision_conflict')
  assert.equal((await f.client.mailboxes())[0].context, 'Contexto novo'); assert.equal(f.providerCalls.length, 0)
  const count = f.requests.length; f.state.current = false
  await assert.rejects(f.client.sync(box.id)); assert.equal(f.requests.length, count)
})

for (const provider of ['google', 'microsoft'] as const) test(`email client ${provider} sync, draft review and explicit send return real receipts without claiming delivery`, async t => {
  const f = await emailFixture(t, { provider }), box = f.box!
  const synced = await f.client.sync(box.id); assert.equal(synced.initialComplete, true)
  const messages = await f.client.messages(box.id), message = await f.client.message(box.id, messages.items[0].id)
  assert.ok(message.text?.includes('Conteúdo privado')); assert.equal(messages.items[0].text, undefined)
  assert.equal((await f.client.thread(box.id, message.threadId))[0].id, message.id)
  const key = randomUUID(), draft = await f.client.generate(box.id, message.id, '', key)
  assert.equal((await f.client.generation(box.id, message.id, key)).draftId, draft.id)
  assert.equal((await f.client.generate(box.id, message.id, '', key)).id, draft.id)
  assert.equal(f.providerCalls.filter(c => c.path === '/v1/responses').length, 1)
  assert.equal(f.providerCalls.filter(c => c.method === 'POST' && c.path !== '/v1/responses').length, 0)
  const edited = await f.client.edit(box.id, draft, 'Resposta revisada pela pessoa.'); assert.equal(edited.revision, 2)
  await assert.rejects(f.client.edit(box.id, draft, 'Versão antiga'), (e: any) => e.code === 'email_draft_changed')
  await assert.rejects(f.client.send(box.id, edited, randomUUID(), false))
  const sendKey = randomUUID(), result = await f.client.send(box.id, edited, sendKey, true)
  assert.equal(result.status, 'accepted'); assert.equal(result.delivered, false); assert.equal(result.delivery, 'not_confirmed'); assert.equal(result.automaticRetry, false)
  assert.equal((await f.client.send(box.id, edited, sendKey, true)).id, result.id)
  assert.equal(f.providerCalls.filter(c => c.method === 'POST' && c.path !== '/v1/responses').length, 1)
  assert.equal((await f.client.operations(box.id))[0].id, result.id)
  const receipt = await f.client.generation(box.id, message.id, key); assert.equal(receipt.status, 'draft'); assert.equal(receipt.draftId, draft.id)
  assert.equal(JSON.stringify(result).includes('providerMessageId'), false)
})

test('email generation recovery is scoped to creator and message and reads after a lost response without another POST', async t => {
  const f = await emailFixture(t), box = f.box!; await f.client.sync(box.id)
  const messages = await f.client.messages(box.id), key = randomUUID(); f.state.loseNext = '/drafts'
  await assert.rejects(f.client.generate(box.id, messages.items[0].id, '', key), (e: any) => e.code === 'network_error')
  const receipt = await f.client.generation(box.id, messages.items[0].id, key); assert.equal(receipt.status, 'draft')
  assert.equal((await f.client.generation(box.id, messages.items[1].id, key)).status, 'not_found')
  assert.equal(f.requests.filter(r => r.method === 'POST' && r.path.endsWith('/drafts')).length, 1)
  assert.equal(f.providerCalls.filter(c => c.path === '/v1/responses').length, 1)
  const other = { ...f.actor, userId: randomUUID() }; seedMember(f.store, other); f.state.cookie = f.session(other.userId, other.tenantId)
  assert.equal((await f.client.generation(box.id, messages.items[0].id, key)).status, 'not_found')
  const foreign = { ...f.actor, tenantId: randomUUID(), userId: randomUUID() }; seedMember(f.store, foreign); f.state.cookie = f.session(foreign.userId, foreign.tenantId)
  assert.equal((await f.client.mailboxes()).length, 0)
  await assert.rejects(f.client.message(box.id, messages.items[0].id), (e: any) => e.status === 404)
})

test('email uncertain send stays uncertain and revoked sessions cannot send again', async t => {
  const f = await emailFixture(t), box = f.box!; await f.client.sync(box.id); const m = (await f.client.messages(box.id)).items[0]
  const draft = await f.client.generate(box.id, m.id, '', randomUUID()); f.state.providerFailure = true
  const result = await f.client.send(box.id, draft, randomUUID(), true); assert.equal(result.status, 'uncertain'); assert.equal(result.requiresReconciliation, true)
  assert.equal((await f.client.drafts(box.id))[0].status, 'uncertain')
  await assert.rejects(f.client.send(box.id, draft, randomUUID(), true), (e: any) => e.code === 'email_draft_changed')
  assert.equal(f.providerCalls.filter(c => c.path.endsWith('/messages/send')).length, 1)
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(createHash('sha256').update(f.state.cookie).digest('hex'))
  await assert.rejects(f.client.operations(box.id), (e: any) => e.status === 401)
})

test('email automation requires separate explicit send policy, uses revision receipts and distinguishes stopped scheduler', async t => {
  const f = await emailFixture(t), box = f.box!, policy = { ...defaultAutomationPolicy(), mode: 'auto_reply' as const, replyPolicy: defaultReplyPolicy() }
  assert.throws(() => automationPolicy({ ...policy, replyPolicy: undefined }))
  const grant = await f.client.activate(box.id, policy); assert.equal(grant.status, 'baselining')
  const state = await f.client.automation(box.id); assert.equal(state.schedulerRunning, false); assert.equal(state.automaticSending, false); assert.equal(state.grant?.id, grant.id)
  const paused = await f.client.stop(box.id, grant, 'pause'); assert.equal(paused.status, 'paused')
  await assert.rejects(f.client.stop(box.id, grant, 'revoke'), (e: any) => e.code === 'email_automation_revision_conflict')
  assert.equal((await f.client.stop(box.id, paused, 'revoke')).status, 'revoked'); assert.equal((await f.client.jobs(box.id)).total, 0)
  assert.equal(f.providerCalls.length, 0)
})

test('email DTO rejects foreign mailbox records and drops provider secrets from visible state', async t => {
  const f = await emailFixture(t), box = f.box!; await f.client.sync(box.id); const source = (await f.client.messages(box.id)).items[0]
  const context = { ...f.context, request: async () => ({ ...source, mailboxId: randomUUID(), text: 'body', accessToken: 'NEVER_EXPOSE' }) as any }
  await assert.rejects(emailAgentClient(context).message(box.id, source.id), (e: any) => e.code === 'invalid_response')
  const cleanContext = { ...f.context, request: async () => ({ ...source, text: 'body', accessToken: 'NEVER_EXPOSE', remoteId: 'private-provider-id' }) as any }
  const parsed = await emailAgentClient(cleanContext).message(box.id, source.id)
  assert.equal(JSON.stringify(parsed).includes('NEVER_EXPOSE'), false); assert.equal(JSON.stringify(parsed).includes('private-provider-id'), false)
})
