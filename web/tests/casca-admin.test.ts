import test from 'node:test'
import assert from 'node:assert/strict'
import { createPasswordCommands } from '../src/services/casca/password'
import { createApiKeyCommands, projectApiKey } from '../src/services/casca/api-keys'
import { EngineError } from '../src/services/engine/http'
import type { EngineContext } from '../src/services/engine/session'
import { useStore } from '../src/data/store'

const identity = { userId: 'user', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
const memory = () => { const map = new Map<string, string>(); return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) }, removeItem: (key: string) => { map.delete(key) } } }
test('lost password response recovers by GET without replaying credentials or storing passwords', async () => {
  const storage = memory(), calls: string[] = []; let key = ''
  const context = { generation: 1, tenantId: 'tenant', assertCurrent() {}, async request(path: string, options: any) { calls.push(path); if (options?.method === 'POST') { key = options.body.operationKey; throw new Error('lost') } return { operationKey: key, changed: true, changedAt: new Date().toISOString(), otherSessionsRevoked: true } } } as EngineContext
  const commands = createPasswordCommands(context, storage, identity)
  await assert.rejects(commands.save('previous-password', 'replacement-password', 'replacement-password'), /lost/)
  assert.equal(storage.map.size, 1); assert.equal(JSON.stringify([...storage.map]).includes('password"'), false)
  assert.equal((await commands.save('previous-password', 'replacement-password', 'replacement-password')).changed, true)
  assert.deepEqual(calls, ['/account/password', `/account/password/operations/${key}`]); assert.equal(storage.map.size, 0)
})
test('definite wrong-password rejection permits a corrected request; stale authority retains unresolved receipt', async () => {
  const storage = memory(); let active = true, reject = true
  const context = { generation: 1, tenantId: 'tenant', assertCurrent() { if (!active) throw new Error('superseded') }, async request(_path: string, options: any) { if (reject) throw new EngineError(400, 'current_password_invalid', 'incorreta'); active = false; return { operationKey: options.body.operationKey, changed: true, changedAt: new Date().toISOString(), otherSessionsRevoked: true } } } as EngineContext
  const commands = createPasswordCommands(context, storage, identity)
  await assert.rejects(commands.save('previous-password', 'replacement-password', 'replacement-password'), /incorreta/); assert.equal(storage.map.size, 0)
  reject = false
  await assert.rejects(commands.save('corrected-password', 'replacement-password', 'replacement-password'), /superseded/); assert.equal(storage.map.size, 1)
})
test('password write never starts when the recovery reference cannot be read back', async () => {
  let requests = 0
  const context: EngineContext = { generation: 1, tenantId: 'tenant', assertCurrent() {}, async request() { requests++; throw Error('request must not start') } }
  const storage = { getItem: (_key: string) => null, setItem(_key: string, _value: string) {}, removeItem(_key: string) {} }
  await assert.rejects(createPasswordCommands(context, storage, identity).save('previous-password', 'replacement-password', 'replacement-password'), /guardar/)
  assert.equal(requests, 0)
})
const key = { id: '11111111-1111-4111-8111-111111111111', name: 'Leitura', prefix: 'klo_key_', secret: 'klo_key_' + 'a'.repeat(43), last4: 'aaaa', scopes: ['agents:read'], permissions: ['agents:read'], createdAt: '2026-10-19T10:00:00Z', expiresAt: '2027-10-19T10:00:00Z', lastUsedAt: null, status: 'active' as const }
test('API secret lives only in creation result; metadata projection is masked and revocation removes the confirmed key', async () => {
  const calls: any[] = []
  const context = { generation: 1, tenantId: 'tenant', assertCurrent() {}, async request(path: string, options: any) { calls.push({ path, options }); if (options?.method === 'POST') return { ...key, secretDisplayedOnce: true }; if (options?.method === 'DELETE') return undefined; return { items: [], availableScopes: ['agents:read', 'agents:write'] } } } as EngineContext
  const commands = createApiKeyCommands(context), result = await commands.create('Leitura')
  assert.equal(result.secret, key.secret); assert.equal(useStore.getState().db.apiKeys[0]?.secret, 'klo_key_••••••••••••aaaa')
  assert.deepEqual(calls[1].options.body.scopes, ['agents:read']); assert.equal(projectApiKey(key, 'tenant').lastUsedAt, undefined)
  await commands.revoke(key.id); assert.equal(useStore.getState().db.apiKeys.some(k => k.id === key.id), false)
})
test('ambiguous API key creation refreshes metadata once and never generates or replays a secret', async () => {
  let writes = 0, reads = 0
  const context = { generation: 1, tenantId: 'tenant', assertCurrent() {}, async request(_path: string, options: any) { if (options?.method === 'POST') { writes++; throw new Error('lost') } reads++; return { items: writes ? [key] : [], availableScopes: ['agents:read'] } } } as EngineContext
  await assert.rejects(createApiKeyCommands(context).create('Leitura'), /lost/)
  assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(useStore.getState().db.apiKeys[0]?.secret.includes('•'), true)
})
