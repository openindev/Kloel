import test from 'node:test'
import assert from 'node:assert/strict'
import { apiKeyCommands, apiKeyView } from '../src/services/engine/api-keys'
import { createEngineClient } from '../src/services/engine/http'

const id = '3af410a2-d396-4fe4-b2a5-ef28136625f1', secret = 'klo_key_' + 'A'.repeat(43)
const row = { id, name: 'Local test', prefix: 'klo_key_', last4: 'AAAA', secret, scopes: ['agents:read'], permissions: ['agents:read'], createdAt: '2026-10-18T00:00:00Z', expiresAt: '2027-01-16T00:00:00Z', lastUsedAt: null, status: 'active' as const }
test('API key commands use cookie transport and separate a one-time secret from list metadata', async () => {
  const seen: { url: string; init: RequestInit }[] = []
  const request = createEngineClient((async (url, init = {}) => {
    seen.push({ url: String(url), init }); assert.equal(init.credentials, 'include'); assert.equal((init.headers as any).Authorization, undefined)
    if (init.method === 'DELETE') return new Response(null, { status: 204 })
    if (init.method === 'POST') return Response.json({ ...row, secretDisplayedOnce: true }, { status: 201 })
    if (init.method === 'PATCH') return Response.json({ ...row, name: 'Changed' })
    return Response.json({ items: [row], availableScopes: ['agents:read'] })
  }) as typeof fetch)
  const service = apiKeyCommands({ request })
  assert.ok(!JSON.stringify(await service.list()).includes(secret))
  const created = await service.create(' Local test ', ['agents:read', 'agents:read'])
  assert.equal(created.secret, secret); assert.ok(!JSON.stringify(created.key).includes(secret))
  assert.deepEqual(JSON.parse(String(seen[1].init.body)), { name: 'Local test', scopes: ['agents:read'] })
  assert.equal((await service.rename(id, ' Changed ')).name, 'Changed'); await service.revoke(id)
  assert.equal(seen[3].url, `/api/v1/api-keys/${id}`)
})
test('a network failure after key creation is never automatically retried or converted into success', async () => {
  let attempts = 0
  const service = apiKeyCommands({ request: createEngineClient((async () => { attempts++; throw new Error('unknown transport outcome') }) as typeof fetch) })
  await assert.rejects(service.create('One', ['agents:read']), (error: any) => error.code === 'network_error'); assert.equal(attempts, 1)
})
test('metadata rejects malformed identities and commands cannot traverse to another endpoint', async () => {
  let calls = 0
  const service = apiKeyCommands({ request: (async () => { calls++; return row }) as any })
  await assert.rejects(service.revoke('../auth/logout'), (error: any) => error.code === 'invalid_key_id'); assert.equal(calls, 0)
  assert.throws(() => apiKeyView({ ...row, last4: secret }), (error: any) => error.code === 'invalid_response')
})
