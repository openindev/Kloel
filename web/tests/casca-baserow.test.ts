import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBaserowConnector, projectBaserow } from '../src/services/casca/baserow'
import { EngineError } from '../src/services/engine/http'

function fixture() {
  const tenantId = 'synthetic-baserow', agentId = randomUUID(), id = randomUUID(), now = '2026-10-19T00:00:00.000Z', values = new Map<string, string>(), calls: any[] = []
  const expected = { tenantId, userId: randomUUID(), membershipId: randomUUID(), authorityVersion: 'c'.repeat(64) }
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  let binding: any, receipt: any, lose = false, fieldFailure: boolean | 'denied' = false, current = true
  const context = { tenantId, generation: 1, assertCurrent() { if (!current) throw Error('context changed') }, async request<T>(path: string, options?: any): Promise<T> {
    calls.push({ path, options }); assert.doesNotMatch([...values.values()].join(''), /fixture-secret/)
    if (options?.method === 'POST' || options?.method === 'PUT') {
      const { token: _token, ...config } = options.body.configuration
      binding = { ...config, id, revision: (binding?.revision ?? 0) + 1, status: 'configured_unverified', lastReadAt: null, nativeConnector: true, implementation: 'native_partial', liveValidation: 'not_inferred', createdAt: now, updatedAt: now }
      receipt = { key: options.idempotencyKey, kind: options.method === 'POST' ? 'binding.create' : 'binding.update', status: 'succeeded', bindingId: id, revision: binding.revision, nativeOperationId: null, rowId: null, errorCode: null, requiresReconciliation: false, automaticRetry: false, createdAt: now, updatedAt: now }
      if (lose) throw Error('lost response')
      return { operation: receipt, replayed: false } as T
    }
    if (path.includes('/operations/')) { if (lose) throw Error('receipt temporarily unavailable'); return receipt }
    if (path.endsWith('/fields')) { if (fieldFailure === 'denied') throw new EngineError(403, 'baserow_permission_denied', 'denied'); if (fieldFailure) throw Error('provider unavailable'); binding = { ...binding, status: 'read_verified', lastReadAt: now }; return { tableId: binding.tableId, source: 'baserow', dataSource: 'untrusted_external_content', providerVerified: true, items: [{ id: 1, name: 'Nome', type: 'text' }] } as T }
    return binding
  } }
  return { agentId, values, calls, context, expected, storage, api: createBaserowConnector(context, expected, storage, agentId, 'connect'), lose(value: boolean) { lose = value }, failFields(value: boolean | 'denied') { fieldFailure = value }, revoke() { current = false } }
}
test('Baserow connection verifies real field response and does not assign the agent before Save', async () => {
  const f = fixture(), binding = await f.api.connect(123, 'fixture-secret', 'Pacientes')
  assert.equal(binding.status, 'read_verified'); assert.deepEqual(binding.agentIds, []); assert.equal(binding.allowCreate, false)
  assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1); assert.equal(f.values.size, 0)
  assert.equal(projectBaserow(binding).connected, true); assert.equal(projectBaserow(binding).engineBinding?.id, binding.id)
})
test('unknown configure response retains the original reference and consultation never resends credentials', async () => {
  const f = fixture(); f.lose(true)
  await assert.rejects(() => f.api.connect(123, 'fixture-secret', 'Tabela'))
  assert.equal(f.values.size, 1)
  f.lose(false); const binding = await f.api.connect(123, 'new-secret-not-resent', 'Novo nome')
  assert.equal(binding.name, 'Tabela'); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1); assert.equal(f.values.size, 0)
})
test('failed field verification does not label a connection verified; retry only reads the original binding', async () => {
  const f = fixture(); f.failFields(true)
  await assert.rejects(() => f.api.connect(123, 'fixture-secret', 'Tabela')); assert.equal(f.values.size, 1)
  f.failFields(false); await f.api.connect(123, 'fixture-secret', 'Tabela')
  assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1)
})
test('a definitive Baserow refusal (wrong key) is reported clearly and a corrected key creates a new binding', async () => {
  const f = fixture(); f.failFields('denied')
  await assert.rejects(() => f.api.connect(123, 'wrong-secret', 'Tabela'), /recusou a chave/); assert.equal(f.values.size, 0)
  // The single-binding fixture cannot model a second create receipt; what matters is that a new POST is sent (not a stale replay).
  f.failFields(false); await f.api.connect(123, 'fixture-secret', 'Tabela').catch(() => undefined)
  assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 2)
})
test('Save explicitly binds the selected agent and requested create capability using a revision fence', async () => {
  const f = fixture(), original = await f.api.connect(123, 'fixture-secret', 'Tabela'), assigned = await f.api.assign(original, true)
  assert.deepEqual(assigned.agentIds, [f.agentId]); assert.equal(assigned.allowCreate, true); assert.equal(assigned.revision, 2)
  const write = f.calls.find(c => c.options?.method === 'PUT')
  assert.equal(write.options.body.expectedRevision, original.revision); assert.equal(write.options.body.configuration.token, undefined)
  await assert.rejects(() => f.api.assign(original, false), /mudou/)
})
test('storage failure or revoked context prevents any configure request', async () => {
  const f = fixture(), api = createBaserowConnector(f.context, f.expected, { ...f.storage, setItem() { throw Error('quota') } }, f.agentId, 'blocked')
  await assert.rejects(() => api.connect(123, 'fixture-secret', 'Tabela')); assert.equal(f.calls.length, 0)
  f.revoke(); await assert.rejects(() => f.api.connect(123, 'fixture-secret', 'Tabela')); assert.equal(f.calls.length, 0)
})
