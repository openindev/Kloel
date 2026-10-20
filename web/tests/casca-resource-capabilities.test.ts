import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Agent } from '../src/domain/types'
import { assertExecutableResourceChanges } from '../src/services/casca/resource-capabilities'

const base = { transfers: [], emails: [], whatsapps: [] } as Pick<Agent, 'transfers' | 'emails' | 'whatsapps'>
test('automatic resources without executors cannot be added, including disabled editorial drafts', () => {
  for (const key of ['transfers', 'emails', 'whatsapps'] as const) {
    assert.throws(() => assertExecutableResourceChanges(base, { [key]: [{ id: 'new', enabled: true }] } as any), /Nenhuma configuração foi ativada/)
    assert.throws(() => assertExecutableResourceChanges(base, { [key]: [{ id: 'new', enabled: false }] } as any), /Nenhuma configuração foi ativada/)
  }
})
test('old inert drafts may be retained or removed but cannot be modified or duplicated', () => {
  const old = { id: 'existing', enabled: false, destination: '+5511999999999' }
  const previous = { ...base, transfers: [old] } as any
  assert.doesNotThrow(() => assertExecutableResourceChanges(previous, {}))
  assert.doesNotThrow(() => assertExecutableResourceChanges(previous, { transfers: structuredClone(previous.transfers) }))
  assert.doesNotThrow(() => assertExecutableResourceChanges(previous, { transfers: [] }))
  assert.throws(() => assertExecutableResourceChanges(previous, { transfers: [{ ...old, enabled: true }] } as any))
  assert.throws(() => assertExecutableResourceChanges(previous, { transfers: [old, old] } as any))
})
test('removing one inert family cannot authorize creation in another', () => {
  const previous = { ...base, emails: [{ id: 'old' }] } as any
  assert.throws(() => assertExecutableResourceChanges(previous, { emails: [], whatsapps: [{ id: 'new' }] } as any))
  assert.deepEqual(previous.emails, [{ id: 'old' }])
})
