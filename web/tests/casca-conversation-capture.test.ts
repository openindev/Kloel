import test from 'node:test'
import assert from 'node:assert/strict'
import { captureFixture } from './engine-crm-capture-fixture'
import { createConversationCapture } from '../src/services/casca/conversation-capture'
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }

test('conversation capture shows only its actual proposals and lost application cannot create a second contact', async t => {
  const f = await captureFixture(t), proposal = await f.propose(), foreign = await f.propose(), storage = memory()
  const api = createConversationCapture(f.context, proposal.conversationId, f.identity.context, storage)
  const list = await api.list(); assert.equal(list.rows.length, 1); assert.equal(list.rows[0].id, proposal.id)
  await assert.rejects(api.proposal(foreign.id), /outra conversa/)
  f.state.after = async (_path, method, response) => { if (method === 'POST') { f.state.after = undefined; throw Error('Synthetic loss after commit') } return response }
  await assert.rejects(api.apply(proposal, ['firstName', 'lastName']))
  const writes = f.requests.filter(r => r.method === 'POST').length
  const restored = createConversationCapture(f.context, proposal.conversationId, f.identity.context, storage), receipt = await restored.apply(proposal, ['firstName', 'lastName'])
  assert.equal(receipt.status, 'succeeded'); assert.equal(receipt.kind, 'proposal.apply'); assert.equal(f.requests.filter(r => r.method === 'POST').length, writes)
  assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 1); assert.equal(f.store.list(f.actor.tenantId, 'contact-permission-events').length, 0)
})

test('opening proposal review neither grants capture nor calls a model; stale session cannot mutate', async t => {
  const f = await captureFixture(t), api = createConversationCapture(f.context, 'conversation-without-proposals', f.identity.context, memory())
  assert.equal((await api.list()).rows.length, 0); assert.equal(f.modelCalls(), 0); assert.equal((await f.client.policy()).grant, null)
  const proposal = await f.propose(), before = f.requests.filter(r => r.method === 'POST').length
  f.state.current = false
  await assert.rejects(api.apply(proposal, ['firstName', 'lastName']))
  assert.equal(f.requests.filter(r => r.method === 'POST').length, before)
})
