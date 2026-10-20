import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { webchatFixture } from './engine-webchat-fixture'
import { createWebchatService, webchatFields, type WebchatAttempt } from '../src/services/engine/webchat'

const fields = () => ({ name: ' Site ', configuration: { allowedOrigins: ['https://WWW.example.test/', '', 'https://www.example.test'], greeting: 'Olá, em que posso ajudar?' } })
const attempt = (kind: WebchatAttempt['kind'], channel?: { id: string; version: string }): WebchatAttempt => ({ key: randomUUID(), kind, ...(channel ? { channelId: channel.id, expectedVersion: channel.version } : {}) })

test('typed webchat service creates disabled, canonicalizes origins and uses real widget routes without provider calls', async t => {
  const f = await webchatFixture(t), created = await f.client.write(attempt('create'), fields())
  assert.equal(created.channel.enabled, false); assert.equal(created.channel.agentId, f.agent.id); assert.deepEqual(created.channel.configuration.allowedOrigins, ['https://www.example.test'])
  assert.equal(created.channel.installation?.scriptUrl, 'https://engine.example.test/widget/kloel.js'); assert.match(created.channel.installation!.snippet, /data-kloel-tenant=/); assert.doesNotMatch(created.channel.installation!.snippet, /cdn\.|synthetic-test-never-external/)
  const listed = await f.client.list(); assert.equal(listed.items[0].id, created.channel.id)
  const enabled = await f.client.write(attempt('enable', created.channel)); assert.equal(enabled.channel.enabled, true)
  const widget = await f.app.inject('/widget/kloel.js'); assert.equal(widget.statusCode, 200); assert.match(widget.body, /kloelChannel/)
  const visitor = (origin: string) => f.app.inject({ method: 'POST', url: `/api/v1/public/chat/sessions?tenantId=${f.actor.tenantId}&channelId=${created.channel.id}`, headers: { origin }, payload: {} })
  assert.equal((await visitor('https://www.example.test')).statusCode, 201); assert.equal((await visitor('https://www.example.test.evil.test')).statusCode, 403)
  await f.client.write(attempt('disable', enabled.channel)); assert.equal((await visitor('https://www.example.test')).statusCode, 403)
  assert.equal(f.store.list(f.actor.tenantId, 'provider-usage').length, 0)
})

test('real CAS refuses stale writes and historical receipts remain distinct from current channel', async t => {
  const f = await webchatFixture(t), original = await f.client.write(attempt('create'), fields()), first = attempt('update', original.channel)
  const saved = await f.client.write(first, { ...fields(), name: 'Primeira alteração' })
  await assert.rejects(() => f.client.write(attempt('update', original.channel), { ...fields(), name: 'Perdida' }), (e: any) => e.status === 409 && e.code === 'webchat_changed')
  const last = await f.client.write(attempt('update', saved.channel), { ...fields(), name: 'Segunda alteração' })
  const receipt = await f.client.operation(first), current = await f.client.read(receipt.channelId)
  assert.equal(receipt.result.version, saved.channel.version); assert.equal(current.version, last.channel.version); assert.notEqual(receipt.result.version, current.version)
  const replay = await f.client.write(first, { ...fields(), name: 'Primeira alteração' }); assert.equal(replay.replayed, true); assert.equal(replay.channel.name, 'Segunda alteração')
})

test('lost creation response recovers receipt and current channel through GET without a second POST', async t => {
  const f = await webchatFixture(t), operation = attempt('create')
  f.state.after = async (_path, method, response) => { if (method === 'POST') { f.state.after = undefined; throw Error('Lost after commit') }; return response }
  await assert.rejects(() => f.client.write(operation, fields()))
  assert.equal(f.store.list(f.actor.tenantId, 'channels').length, 1)
  const receipt = await f.client.operation(operation); assert.equal((await f.client.read(receipt.channelId)).enabled, false)
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1)
  assert.doesNotMatch(JSON.stringify(receipt), /Olá|allowedOrigins|synthetic-test/)
})

test('only validated scoped installation and receipt projections survive transport tampering', async t => {
  const f = await webchatFixture(t), op = attempt('create'), created = await f.client.write(op, fields())
  for (const tamper of [
    (value: any) => { value.tenantId = 'foreign' },
    (value: any) => { value.agentId = 'foreign' },
    (value: any) => { value.installation.scriptUrl = 'javascript:alert(1)' },
    (value: any) => { value.installation.scriptUrl = 'https://evil.test/other.js' },
    (value: any) => { value.installation.channelId = 'foreign' },
  ]) {
    const client = createWebchatService({ ...f.context, request: async () => { const value = structuredClone(created.channel); tamper(value); return value as any } }, f.agent.id)
    await assert.rejects(() => client.read(created.channel.id))
  }
  const raw = { ...created.channel, secret: 'DO-NOT-PROJECT', installation: { ...created.channel.installation!, snippet: '<script>arbitrary</script>' } }
  const safe = createWebchatService({ ...f.context, request: async () => raw as any }, f.agent.id)
  assert.doesNotMatch(JSON.stringify(await safe.read(created.channel.id)), /DO-NOT-PROJECT|arbitrary/)
  const wrong = createWebchatService({ ...f.context, request: async () => ({ ...created.operation, channelId: 'foreign' }) as any }, f.agent.id)
  await assert.rejects(() => wrong.operation(op))
})

test('malformed input and late context changes cannot become successful local configuration', async t => {
  const f = await webchatFixture(t)
  for (const origin of ['http://example.test', 'https://example.test/path', 'https://user:password@example.test', 'https://*.example.test', 'https://example.test?x=1']) assert.throws(() => webchatFields({ ...fields(), configuration: { greeting: '', allowedOrigins: [origin] } }))
  assert.deepEqual(webchatFields({ ...fields(), configuration: { greeting: '', allowedOrigins: ['', '  '] } }).configuration.allowedOrigins, [])
  assert.throws(() => webchatFields({ ...fields(), configuration: { allowedOrigins: [], greeting: 'x'.repeat(1001) } }))
  f.state.after = async (_path, _method, response) => { f.state.current = false; return response }
  await assert.rejects(() => f.client.list(), (e: any) => e.code === 'superseded')
  assert.equal(f.requests.some(r => r.method !== 'GET'), false)
})
