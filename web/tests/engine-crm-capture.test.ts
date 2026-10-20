import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { captureFixture } from './engine-crm-capture-fixture'
import { createCRMCaptureService, type CaptureAttempt } from '../src/services/engine/crm-capture'

test('fresh tenant settings revision zero is readable without activating a grant or model', async t => {
  const f = await captureFixture(t, false)
  assert.equal((await f.client.policy()).settingsRevision, 0); assert.equal((await f.client.settings()).revision, 0)
  assert.equal((await f.client.policy()).grant, null); assert.equal(f.modelCalls(), 0)
  assert.equal(f.store.list(f.actor.tenantId, 'crm-capture-grants').length, 0)
  assert.equal((await f.client.channels()).items[0].eligible, true)
})

test('grant create, pause and revoke recover lost responses using receipts only and reject stale predecessor IDs', async t => {
  const f = await captureFixture(t)
  let state = await f.client.policy()
  const create: CaptureAttempt = { key: randomUUID(), kind: 'grant.create', settingsRevision: state.settingsRevision, previousGrantId: null, previousRevision: null }
  const lose = () => { f.state.after = async (_path, method, response) => { if (method === 'POST') { f.state.after = undefined; throw Error('Lost after commit') }; return response } }
  lose(); await assert.rejects(f.client.write(create, f.policy()))
  const receipt = await f.client.operation(create); assert.equal(receipt.kind, 'grant.create')
  state = await f.client.policy(); assert.equal(state.grant!.id, receipt.targetId)
  for (const [kind, status] of [['grant.pause', 'paused'], ['grant.revoke', 'revoked']] as const) {
    const attempt: CaptureAttempt = { key: randomUUID(), kind, targetId: state.grant!.id, revision: state.grant!.revision }
    lose(); await assert.rejects(f.client.write(attempt)); const recovered = await f.client.operation(attempt)
    assert.equal(recovered.result.status, status); state = await f.client.policy()
  }
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 3); assert.equal(f.modelCalls(), 0)
  const old = state.grant!
  await f.activate()
  await assert.rejects(f.client.write({ key: randomUUID(), kind: 'grant.create', settingsRevision: state.settingsRevision, previousGrantId: old.id, previousRevision: old.revision }, f.policy()), (e: any) => e.code === 'capture_grant_revision_conflict')
  assert.equal((await f.client.operation(create)).result.status, 'active', 'Receipt remains historical after revocation/replacement')
})

test('proposal application verifies identities, recovers one contact after loss and grants no consent', async t => {
  const f = await captureFixture(t), proposal = await f.propose()
  assert.deepEqual(new Set(proposal.creationIdentifiers.map(v => v.value)), new Set(['ana@example.test', '+5511999990000']))
  const attempt: CaptureAttempt = { key: randomUUID(), kind: 'proposal.apply', targetId: proposal.id, revision: proposal.revision, contactId: null, contactRevision: null }
  f.state.after = async (_path, method, response) => { if (method === 'POST') { f.state.after = undefined; throw Error('Lost after commit') }; return response }
  await assert.rejects(f.client.write(attempt, { selectedFieldIds: ['firstName', 'lastName'], overrides: {} }))
  const before = f.requests.filter(r => r.method === 'POST').length, result = await f.client.operation(attempt)
  assert.equal(result.result.appliedFields!.length, 2); assert.equal(f.requests.filter(r => r.method === 'POST').length, before)
  const contact = await f.client.contact(result.result.contactId!); assert.equal(contact.emails.length, 1); assert.equal(contact.phones.length, 1)
  assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 1); assert.equal(f.store.list(f.actor.tenantId, 'contact-permission-events').length, 0)
  assert.equal((await f.client.proposal(proposal.id)).status, 'applied'); assert.equal(f.modelCalls(), 1)
  assert.doesNotMatch(JSON.stringify(result), /ana@example|551199|quote|encrypted|cookie|synthetic/)
})

test('dismissed proposal recovery never applies and revoked authority cannot read another session receipt', async t => {
  const f = await captureFixture(t), proposal = await f.propose()
  const attempt: CaptureAttempt = { key: randomUUID(), kind: 'proposal.dismiss', targetId: proposal.id, revision: proposal.revision }
  f.state.after = async (_path, method, response) => { if (method === 'POST') { f.state.after = undefined; throw Error('Lost') }; return response }
  await assert.rejects(f.client.write(attempt)); assert.equal((await f.client.operation(attempt)).result.status, 'dismissed')
  assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 0)
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.hash)
  await assert.rejects(f.client.operation(attempt), (e: any) => [401, 403, 404].includes(e.status))
})

test('malformed receipt or proposal binding cannot be projected as a successful operation', async t => {
  const f = await captureFixture(t), proposal = await f.propose()
  const attempt: CaptureAttempt = { key: randomUUID(), kind: 'proposal.dismiss', targetId: proposal.id, revision: proposal.revision }
  const result = await f.client.write(attempt)
  const wrong = createCRMCaptureService({ ...f.context, request: async () => ({ ...result, targetId: randomUUID() }) as any })
  await assert.rejects(wrong.operation(attempt), (e: any) => e.code === 'invalid_capture')
  const mismatched = createCRMCaptureService({ ...f.context, request: async () => ({ ...proposal, id: randomUUID() }) as any })
  await assert.rejects(mismatched.proposal(proposal.id), (e: any) => e.code === 'invalid_capture')
  const hidden = createCRMCaptureService({ ...f.context, request: async () => ({ ...proposal, evidenceAvailable: false }) as any })
  await assert.rejects(hidden.proposal(proposal.id), (e: any) => e.code === 'invalid_capture')
})
