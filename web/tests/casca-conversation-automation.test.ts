import test from 'node:test'
import assert from 'node:assert/strict'
import { manualAdmissionUIFixture } from './engine-manual-admission-fixture'
import { recipientUIFixture } from './engine-recipient-attestation-fixture'
import { createConversationAutomation } from '../src/services/casca/conversation-automation'
import { createConversationActions } from '../src/services/casca/conversation-actions'
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }

test('preparation and sending stay separate; lost responses recover by GET without another generation', async t => {
  const f = await manualAdmissionUIFixture(t), identity = (await f.identity()).context, storage = memory()
  const api = createConversationAutomation(f.bound, f.conversationId, identity, storage), current = await api.admission()
  f.state.loseAfter = true
  await assert.rejects(api.prepare(current.state, f.evidence.id))
  const restored = createConversationAutomation(f.bound, f.conversationId, identity, storage), prepared = (await restored.admission()).prepared!
  assert.ok(prepared); assert.equal(prepared.executionStarted, false); assert.equal(f.calls.length, 0); assert.equal(f.writes().length, 1)
  f.hooks.provider = (url, init) => url === 'https://api.openai.com/v1/responses'
    ? Response.json({ id: 'synthetic', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta da validação isolada.' }] }], usage: {} })
    : Response.json({ messages: [{ id: 'wamid.casca-dialog-proof' }] })
  let lost = false
  f.state.after = (path, method, response) => { if (!lost && method === 'POST' && path.endsWith('/manual-once')) { lost = true; throw Error('Synthetic lost execution response') } return response }
  await assert.rejects(restored.run(prepared)); assert.equal(lost, true)
  const result = await restored.run(prepared)
  assert.equal(result.status, 'sent'); assert.equal(result.localLink, 'linked')
  assert.equal(f.requests.filter(r => r.method === 'POST' && r.path.endsWith('/manual-once')).length, 1)
  assert.equal(f.calls.length, 2)
})

test('explicit recipient declaration is recovered then actually used by the existing reply composer adapter', async t => {
  const f = await recipientUIFixture(t), identity = (await f.identity()).context, storage = memory()
  const api = createConversationAutomation(f.bound, f.conversationId, identity, storage), initial = await api.recipient()
  assert.equal(f.attestPosts().length, 0)
  f.state.loseAfter = '/recipient-attestations'
  await assert.rejects(api.attest(initial.state, f.evidence.id))
  const receipt = (await api.recipient()).receipt!
  assert.ok(receipt); assert.equal(f.attestPosts().length, 1); assert.equal(f.calls.length, 0)
  const conversation = { id: f.conversationId, orgId: f.tenant, channel: 'whatsapp' } as any
  const actions = createConversationActions(f.bound, conversation, identity, storage, async () => conversation)
  f.hooks.provider = () => Response.json({ messages: [{ id: 'wamid.casca-reviewed-reply' }] })
  await actions.command('reply', 'Resposta ao destinatário revisado.')
  assert.equal(f.replyPosts().length, 1); assert.equal(f.replyPosts()[0].body.recipientAttestationId, receipt.id)
  assert.equal(f.calls.length, 1)
})
