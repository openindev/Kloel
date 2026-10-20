import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createAfterHttpService, parseAfterHttpConfig, parseAfterHttpConfigOperation, parseAfterHttpDetail, parseAfterHttpPage, type AfterHttpAttempt, type AfterHttpJob } from '../src/services/engine/after-http'
import { createAfterHttpJournal } from '../src/services/engine/after-http-journal'
import { EngineError } from '../src/services/engine/http'

const agentId = randomUUID(), tenantId = 'tenant-opaque-fixture', conversationId = randomUUID(), actionId = randomUUID(), now = new Date().toISOString()
const action = { id: actionId, name: 'Destino de teste', template: 'n8n', targetOrigin: 'https://hooks.example.com', method: 'POST', revision: 2 }
const config = () => ({ agentId, revision: 0, configuration: { enabled: false, actionId: null }, authorization: { state: 'disabled', reasonCode: null }, action: null, eligibleActions: [action] })
const attempt = (): AfterHttpAttempt => ({ kind: 'after_http.configure', key: randomUUID(), agentId, expectedRevision: 0 })
const receipt = (a: AfterHttpAttempt) => ({ ...a, tenantId, revision: a.expectedRevision + 1, status: 'succeeded' as const, createdAt: now, automaticRetry: false as const })
const job = (epoch = 1): AfterHttpJob => ({ id: randomUUID(), conversationId, agentId, closureId: randomUUID(), epoch, configRevision: 1, actionId, actionRevision: 2, status: 'queued', reasonCode: null, closedAt: now, messageCount: 3, startedAt: null, attemptedAt: null, completedAt: null, httpStatus: null, integrationOperationId: null, dispatchCount: 0, automaticRetry: false, workflowCompletion: 'not_verified' })
function transport() { const calls: { path: string; options: any }[] = []; let current = true, response: any = config(), after = () => {}; const service = createAfterHttpService({ tenantId, generation: 1, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', 'Changed') }, async request<T>(path: string, options?: any) { calls.push({ path, options }); after(); if (response instanceof Error) throw response; return structuredClone(response) as T } }); return { service, calls, set: (value: any) => { response = value }, revoke: () => { current = false }, after: (fn: () => void) => { after = fn } } }
function memory() { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } } }
const context = { userId: randomUUID(), tenantId, membershipId: randomUUID(), authorityVersion: 'a'.repeat(64) }

test('HTTP config parser rejects credentials, URL paths, unsupported methods and cross-agent receipts', () => {
  assert.deepEqual(parseAfterHttpConfig(config(), agentId), config())
  for (const raw of [{ ...config(), token: 'secret' }, { ...config(), action: { ...action, id: randomUUID() } }, { ...config(), eligibleActions: [{ ...action, targetOrigin: 'https://hooks.example.com/private?token=secret' }] }, { ...config(), eligibleActions: [{ ...action, method: 'GET' }] }, { ...config(), eligibleActions: [action, action] }]) assert.throws(() => parseAfterHttpConfig(raw, agentId))
  const a = attempt(); assert.deepEqual(parseAfterHttpConfigOperation(receipt(a), a, tenantId), receipt(a))
  for (const patch of [{ agentId: randomUUID() }, { tenantId: randomUUID() }, { revision: 3 }, { automaticRetry: true }, { secret: 'remote' }]) assert.throws(() => parseAfterHttpConfigOperation({ ...receipt(a), ...patch }, a, tenantId))
})
test('consent and action revision are validated before PUT; disabled writes use canonical null and false', async () => {
  const f = transport(), a = attempt()
  for (const [revision, ack] of [[null, true], [2, false], [0, true]] as const) await assert.rejects(() => f.service.configure(a, { enabled: true, actionId }, revision, ack))
  await assert.rejects(() => f.service.configure(a, { enabled: false, actionId }, 2, false)); assert.equal(f.calls.length, 0)
  f.set({ operation: receipt(a), replayed: false }); await f.service.configure(a, { enabled: false, actionId }, null, false)
  assert.deepEqual(f.calls[0].options.body, { expectedTenantId: tenantId, expectedRevision: 0, idempotencyKey: a.key, configuration: { enabled: false, actionId }, expectedActionRevision: null, externalSendAcknowledged: false })
  assert.equal(f.calls[0].options.method, 'PUT')
})
test('lost response recovery reads only original key; 404, late authority and abort never cause another write', async () => {
  const f = transport(), a = attempt(); f.set(new EngineError(404, 'not_found', 'missing'))
  await assert.rejects(() => f.service.operation(a)); assert.equal(f.calls[0].path, `/after-http/config-operations/${a.key}`); assert.equal(f.calls[0].options, undefined)
  f.set(config()); f.after(f.revoke); await assert.rejects(() => f.service.config(agentId), /Changed/)
  const g = transport(), controller = new AbortController(); g.after(() => controller.abort()); await assert.rejects(() => g.service.config(agentId, controller.signal))
  assert.equal([...f.calls, ...g.calls].filter(c => c.options?.method === 'PUT').length, 0)
})
test('history parser enforces scope, descending epochs, echoed cursors and factual HTTP acknowledgement', () => {
  const a = job(2), b = job(1), page = { items: [a, b], cursor: b.id, hasMore: false }; assert.deepEqual(parseAfterHttpPage(page, conversationId), page)
  assert.deepEqual(parseAfterHttpPage({ items: [], cursor: b.id, hasMore: false }, conversationId, b.id), { items: [], cursor: b.id, hasMore: false })
  for (const bad of [{ ...page, items: [b, a] }, { ...page, items: [a, { ...b, epoch: 2 }] }, { items: [], cursor: null, hasMore: false }, { ...page, items: [{ ...a, conversationId: randomUUID() }, b] }, { ...page, items: [{ ...a, transcript: 'private' }, b] }, { ...page, items: [{ ...a, status: 'endpoint_acknowledged', httpStatus: 500 }, b] }, { ...page, items: [{ ...a, workflowCompletion: 'completed' }, b] }]) assert.throws(() => parseAfterHttpPage(bad, conversationId, randomUUID()))
  const accepted = { ...a, status: 'endpoint_acknowledged', httpStatus: 204 }; assert.equal(parseAfterHttpPage({ items: [accepted], cursor: a.id, hasMore: false }, conversationId).items[0].workflowCompletion, 'not_verified')
})
test('detail binds the original job and reciprocal executor receipt without accepting foreign content', () => {
  const a = job(), integrationId = randomUUID(), operation = { ...a, status: 'endpoint_acknowledged', httpStatus: 200, integrationOperationId: integrationId, dispatchCount: 1 }, integrationOperation = { id: integrationId, actionId, revision: 2, status: 'endpoint_acknowledged', httpStatus: 200, errorCode: null, attempts: 1, createdAt: now, updatedAt: now, requiresReconciliation: false, automaticRetry: false }, detail = { operation, integrationOperation }
  assert.equal(parseAfterHttpDetail(detail, a).operation.id, a.id)
  for (const raw of [{ ...detail, operation: { ...operation, closureId: randomUUID() } }, { ...detail, integrationOperation: null }, { ...detail, integrationOperation: { ...integrationOperation, id: randomUUID() } }, { ...detail, integrationOperation: { ...integrationOperation, revision: 3 } }, { ...detail, integrationOperation: { ...integrationOperation, body: 'secret' } }]) assert.throws(() => parseAfterHttpDetail(raw, a))
})
test('journal retains unknown A, refuses replacing B from old receipt and stores no payload or consent', () => {
  const storage = memory(), journal = createAfterHttpJournal(storage, context, agentId), a = attempt(), b = attempt(), fresh = () => {}
  journal.reserve(a, fresh); assert.throws(() => journal.reserve(b, fresh)); journal.archive(a, fresh); journal.reserve(b, fresh)
  assert.throws(() => journal.resolve(a, receipt(a), fresh)); assert.equal(journal.read().active?.key, b.key)
  assert.throws(() => journal.forgetConfirmed(a, { ...receipt(a), agentId: randomUUID() }, fresh)); journal.forgetConfirmed(a, receipt(a), fresh)
  assert.equal(journal.read().active?.key, b.key); assert.equal(journal.read().archived.length, 0)
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(journal.key)!).data.active).sort(), ['agentId', 'expectedRevision', 'key', 'kind'])
  assert.doesNotMatch(storage.getItem(journal.key)!, /actionId|configuration|acknowledged|https:|payload/)
})
test('journal fails closed on corrupt/refused/readback storage and authority guard before mutation', () => {
  const storage = memory(), journal = createAfterHttpJournal(storage, context, agentId), a = attempt()
  assert.throws(() => journal.reserve(a, () => { throw Error('old authority') })); assert.equal(storage.values.size, 0)
  const refuse = createAfterHttpJournal({ ...storage, setItem() { throw Error('quota') } }, context, agentId); assert.throws(() => refuse.reserve(a, () => {})); assert.equal(storage.values.size, 0)
  const discard = createAfterHttpJournal({ ...storage, setItem() {} }, context, agentId); assert.throws(() => discard.reserve(a, () => {}))
  storage.setItem(journal.key, '{invalid'); assert.throws(() => journal.read())
  storage.removeItem(journal.key); journal.reserve(a, () => {}); const envelope = JSON.parse(storage.getItem(journal.key)!); envelope.data.active.actionId = actionId; storage.setItem(journal.key, JSON.stringify(envelope)); assert.throws(() => journal.read())
})
