import test from 'node:test'
import assert from 'node:assert/strict'
import { metaConnectionFixture } from './engine-meta-connection-fixture'
import { createWhatsAppConnectionService, parseWhatsAppConnection, metaVerificationMessage } from '../src/services/engine/whatsapp-connection'
import { EngineError } from '../src/services/engine/http'

test('typed client uses exact observed context and projects only bounded metadata from real routes', async t => {
  const f = await metaConnectionFixture(t), row = await f.seed(), api = createWhatsAppConnectionService(f.bound), before = f.snapshot()
  const value = await api.verify(row); assert.equal(value.status, 'metadata_verified'); assert.equal(value.token.expiresAt, 0); assert.equal(value.proof.messageSending, false)
  const request = f.requests.at(-1)!; assert.equal(request.method, 'POST'); assert.deepEqual(request.body, { expectedTenantId: row.tenantId, expectedVersion: row.version })
  assert.equal(request.headers['x-kloel-expected-tenant'], row.tenantId); assert.equal(request.headers['x-kloel-expected-authority'], f.contexts.owner['x-kloel-expected-authority']); assert.equal(f.calls.length, 3)
  assert.deepEqual(f.snapshot(), before); assert.equal(JSON.stringify(value).includes('synthetic-meta-token'), false)
});

test('parser rejects mismatched bindings, remote strings and false proof claims', async t => {
  const f = await metaConnectionFixture(t), row = await f.seed(), value = await createWhatsAppConnectionService(f.bound).verify(row)
  for (const change of [{ channelId: 'different' }, { tenantId: 'foreign' }, { phoneId: '999' }, { version: 'f'.repeat(64) }, { appId: 'secret' }, { proof: { webhookDelivery: true, messageSending: false } }, { phone: { ...value.phone, qualityRating: 'secret' } }, { token: { ...value.token, scopes: ['email'] } }]) assert.throws(() => parseWhatsAppConnection({ ...value, ...change }, row), (e: any) => e.code === 'invalid_meta_verification')
  assert.equal('accessToken' in parseWhatsAppConnection({ ...value, accessToken: 'secret' }, row), false)
});

test('stale frontend context and stale channel revision cannot start another provider query', async t => {
  const f = await metaConnectionFixture(t), row = await f.seed(), api = createWhatsAppConnectionService(f.bound)
  f.state.current = false; await assert.rejects(api.verify(row), (e: any) => e.code === 'superseded'); assert.equal(f.calls.length, 0)
  f.state.current = true; await f.updateOther(row, 'Changed'); await assert.rejects(api.verify(row), (e: any) => e.code === 'whatsapp_channel_configuration_changed'); assert.equal(f.calls.length, 0)
});

test('lost verification response is read-only and never retried automatically', async t => {
  const f = await metaConnectionFixture(t), row = await f.seed(), api = createWhatsAppConnectionService(f.bound), before = f.snapshot()
  f.state.lose = 'POST /api/v1/whatsapp/channels/' + row.id + '/verify-connection'
  await assert.rejects(api.verify(row)); assert.equal(f.calls.length, 3); assert.deepEqual(f.snapshot(), before)
  assert.equal((await api.verify(row)).status, 'metadata_verified'); assert.equal(f.calls.length, 6)
});

test('late HTTP authority rejection is retained as an error, without metadata or automatic repeat', async t => {
  const f = await metaConnectionFixture(t), row = await f.seed(), api = createWhatsAppConnectionService(f.bound)
  f.hooks.provider = () => { f.aba(); return Response.json(f.responses.debug_token) }
  await assert.rejects(api.verify(row), (e: any) => e.status === 0 && e.rawStatus === 409 && e.code === 'context_changed_in_flight'); assert.equal(f.calls.length, 1)
});

test('error presentation uses fixed copy even if upstream or transport exception contains secrets', () => {
  for (const error of [new Error('secret-token'), new EngineError(502, 'unknown', 'secret-token'), { message: 'secret-token' }]) assert.equal(metaVerificationMessage(error).includes('secret-token'), false)
  assert.match(metaVerificationMessage(new EngineError(422, 'meta_app_mismatch', 'secret-token')), /outro aplicativo/)
});
