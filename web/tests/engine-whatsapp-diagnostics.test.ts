import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { whatsappChannelUIFixture } from './engine-whatsapp-channel-fixture'
import { createWhatsAppService } from '../src/services/engine/whatsapp'
import type { EngineRequest } from '../src/services/engine/http'

test('real Fastify refusal survives client receipt recovery with only bounded Graph numeric metadata', async t => {
  const f = await whatsappChannelUIFixture(t), saved = await f.seed(), row = await f.change(saved, 'enable'), api = createWhatsAppService(f.bound), key = randomUUID()
  f.hooks.provider = async (_url, init) => { assert.equal(init.method, 'POST'); return Response.json({ error: { code: 131030, error_subcode: 2494010, message: 'PRIVATE-PROVIDER-TEXT', error_data: { details: 'PRIVATE-URL-TOKEN' } } }, { status: 400 }) }
  const body = { kind: 'text' as const, channelId: row.id, to: '+5511999999999', text: 'Synthetic only' }
  await assert.rejects(api.send(body, key), (e: any) => e.status === 502 && e.code === 'provider_recipient_not_allowed')
  const receipt = await api.operation(key)
  assert.deepEqual(receipt, { status: 'failed', errorCode: 'provider_recipient_not_allowed', graphCode: 131030, graphSubcode: 2494010, automaticRetry: false })
  assert.equal((receipt as any).message, undefined); assert.ok(!JSON.stringify(receipt).includes('PRIVATE-'))
  await assert.rejects(api.send(body, key), (e: any) => e.code === 'operation_requires_reconciliation')
  assert.equal(f.calls.length, 1)
})

test('diagnostic parser rejects invalid scalar types, bounds and diagnostics on ambiguous/success states', async () => {
  for (const metadata of [
    { graphCode: '131030' }, { graphCode: -1 }, { graphCode: 1.5 }, { graphCode: 2147483648 }, { graphCode: null },
    { graphSubcode: '42' }, { graphSubcode: -1 }, { graphSubcode: [] }, { graphSubcode: 2147483648 },
    { status: 'unknown', graphCode: 190 }, { status: 'pending', graphSubcode: 463 },
    { status: 'succeeded', graphCode: 190, result: { messageId: 'wamid.fake', status: 'accepted' } },
  ]) {
    const request = (async () => ({ status: 'failed', automaticRetry: false, ...metadata })) as EngineRequest
    await assert.rejects(createWhatsAppService({ tenantId: 'tenant', generation: 1, request, assertCurrent() {} }).operation('operation-key-123'), (e: any) => e.code === 'invalid_data')
  }
})

test('legacy failed receipts remain readable and unrelated provider strings are never retained', async () => {
  for (const metadata of [{}, { graphCode: 0, graphSubcode: 2147483647 }]) {
    const request = (async () => ({ status: 'failed', errorCode: 'provider_rejected', automaticRetry: false, ...metadata, message: 'private-body', errorMessage: 'private-url', diagnostics: { token: 'private-token' } })) as EngineRequest
    const result = await createWhatsAppService({ tenantId: 'tenant', generation: 1, request, assertCurrent() {} }).operation('operation-key-123')
    assert.deepEqual(result, { status: 'failed', errorCode: 'provider_rejected', automaticRetry: false, ...metadata })
  }
})

test('late receipt diagnostics cannot cross the captured context authority', async () => {
  const request = (async () => ({ status: 'failed', errorCode: 'provider_token_invalid', graphCode: 190, automaticRetry: false })) as EngineRequest
  await assert.rejects(createWhatsAppService({ tenantId: 'tenant', generation: 1, request, assertCurrent() { throw Error('authority-revoked') } }).operation('operation-key-123'), /authority-revoked/)
})
