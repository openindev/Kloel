import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createAgentTestService, parseSheetAppendOperation } from '../src/services/engine/agent-test'
import { createAgentTestJournal } from '../src/services/engine/agent-test-journal'
const context = { userId: 'user', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
const metadata = (operationRef = randomUUID(), status: any = 'appended') => ({ kind: 'append' as const, operationRef, status, rowsAppended: status === 'appended' ? 1 as const : null, requiresReconciliation: ['pending', 'uncertain'].includes(status), automaticRetry: false as const })
test('append parser preserves exact states and rejects forged refs, cells, inconsistent effects and automatic retry', () => {
  for (const status of ['pending', 'appended', 'not_sent', 'uncertain']) assert.equal(parseSheetAppendOperation(metadata(undefined, status)).status, status)
  for (const value of [{ ...metadata(), status: 'accepted' }, { ...metadata(), rowsAppended: null }, { ...metadata(), requiresReconciliation: true }, { ...metadata(), cells: [['secret']] }, { ...metadata(), operationRef: '../secret' }, { ...metadata(), automaticRetry: true }]) assert.throws(() => parseSheetAppendOperation(value))
  assert.throws(() => parseSheetAppendOperation(metadata(), randomUUID()))
})
test('opaque private journal original CAS, cap without eviction, context/readback fences and terminal-only forget', () => {
  const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } }, journal = createAgentTestJournal(storage, context, 'agent'), fresh = () => {}, a = { key: randomUUID() }
  journal.reserve(a, fresh); assert.throws(() => journal.reserve({ key: randomUUID() }, fresh)); const value = metadata(); journal.record(a, [value], true, fresh); const b = { key: randomUUID() }; journal.reserve(b, fresh); assert.throws(() => journal.record(a, [], true, fresh)); assert.equal(journal.read().pending!.key, b.key)
  assert.throws(() => journal.forget(metadata(value.operationRef, 'uncertain'), fresh)); journal.forget(value, fresh); assert.equal(journal.read().pending!.key, b.key)
  journal.record(b, Array.from({ length: 81 }, () => metadata()), true, fresh); assert.throws(() => journal.reserve({ key: randomUUID() }, fresh)); assert.equal(journal.read().operations.length, 81)
  const changed = createAgentTestJournal(storage, { ...context, authorityVersion: 'b'.repeat(64) }, 'agent'); assert.deepEqual(changed.read(), { pending: null, operations: [] })
  const broken = createAgentTestJournal({ ...storage, setItem() {} }, context, 'agent'); assert.throws(() => broken.reserve(a, fresh))
})
test('chat service reads only explicit local receipt endpoints and does not derive refs from model text', async () => {
  const item = metadata(), seen: string[] = [], key = randomUUID(); let response: any = { conversationId: 'conversation', responseId: 'response', text: randomUUID(), usage: {} }
  const service = createAgentTestService({ tenantId: 'tenant', generation: 1, assertCurrent() {}, request: async (p: string) => { seen.push(p); return response } } as any, 'agent')
  assert.deepEqual((await service.chat('test', key)).sheetOperations, [])
  response = { sheetOperations: [item] }; assert.deepEqual(await service.chatSheetOperations(key), [item]); response = item; assert.deepEqual(await service.sheetOperation(item.operationRef), item)
  assert.deepEqual(seen.slice(1), ['/oauth/sheets/chat-operations/' + key, '/oauth/sheets/action-executions/' + item.operationRef])
  response = { status: 'unknown', sheetOperations: [item] }; assert.deepEqual((await service.chatOperation(key)).sheetOperations, [item]); response.sheetOperations.push(item); await assert.rejects(service.chatOperation(key))
})
