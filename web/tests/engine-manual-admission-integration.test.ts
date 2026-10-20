import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { manualAdmissionUIFixture } from './engine-manual-admission-fixture'
import { createWhatsAppService } from '../src/services/engine/whatsapp'
import { createWhatsAppJobOnceService } from '../src/services/engine/whatsapp-job-once'

test('real client preparation → queue → once preserves selected recipient and recovers a lost execution response without another generation', async t => {
  const f = await manualAdmissionUIFixture(t), current = await f.service.context(), reference = { key: randomUUID(), expectedVersion: current.version }
  const admission = await f.service.admit(reference, current.sourceMessageId!, f.evidence.id)
  assert.equal(admission.executionStarted, false); assert.equal(f.calls.length, 0)
  const queued = (await createWhatsAppService(f.bound).jobs()).items.find(job => job.id === admission.jobId)
  assert.ok(queued); assert.equal(queued.version, admission.jobVersion); assert.equal(queued.status, 'queued'); assert.equal(queued.attempts, 0)
  const originalMessages = f.store.list(f.tenant, 'messages').filter(m => m.conversationId !== f.conversationId)
  f.hooks.provider = (url, init) => {
    if (url === 'https://api.openai.com/v1/responses') {
      const body = JSON.parse(String(init.body)); assert.equal(body.store, false); assert.equal(body.tools, undefined)
      return Response.json({ id: 'controlled-response', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta controlada da IA' }] }], usage: {} })
    }
    assert.ok(url.startsWith('https://graph.facebook.com/')); assert.equal(JSON.parse(String(init.body)).to, f.destination.slice(1))
    return Response.json({ messages: [{ id: 'wamid.client-admission-' + randomUUID() }] })
  }
  const once = createWhatsAppJobOnceService(f.bound), execution = { jobId: queued.id, expectedVersion: queued.version }
  let lost = false
  f.state.after = (path, method, response) => {
    if (!lost && method === 'POST' && path.endsWith('/manual-once')) { lost = true; throw Error('Controlled loss after execution response') }
    return response
  }
  await assert.rejects(once.run(execution)); assert.equal(lost, true)
  const receipt = await once.operation(execution)
  assert.equal(receipt.externalEffect, 'accepted'); assert.equal(receipt.localLink, 'linked'); assert.equal(receipt.status, 'sent'); assert.equal(receipt.replayed, true)
  const message = f.store.get(f.tenant, 'messages', receipt.messageId!)!
  assert.equal(message.conversationId, f.conversationId); assert.equal(message.recipient, f.destination)
  assert.deepEqual(f.store.list(f.tenant, 'messages').filter(m => m.conversationId !== f.conversationId), originalMessages)
  assert.equal(f.calls.length, 2); assert.equal(f.writes().length, 1); assert.equal(f.requests.filter(r => r.method === 'POST' && r.path.endsWith('/manual-once')).length, 1)
  assert.equal((await f.service.operation(reference)).jobId, admission.jobId); assert.equal(f.calls.length, 2)
})
