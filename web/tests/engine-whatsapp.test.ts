import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerWhatsAppChannels } from '../../engine/src/whatsapp-channels'
import { createWhatsAppChannelsService, whatsappChannelAttempt, type WhatsAppChannelFields } from '../src/services/engine/whatsapp-channels'
import { registerDomains } from '../../engine/src/domains'
import { registerWhatsAppOperator, setWhatsAppSchedulerRunning } from '../../engine/src/providers/whatsapp-operator'
import { enqueueInboundReply, createWhatsAppWorker } from '../../engine/src/providers/worker'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { createWhatsAppService } from '../src/services/engine/whatsapp'

async function fixture(t: any) {
  const env = { PROVIDER_TENANT_ID: 'wa-tenant', META_ACCESS_TOKEN: 'test-meta-token', META_PHONE_NUMBER_ID: '12345', META_GRAPH_VERSION: 'v25.0', META_WABA_ID: '67890', META_APP_SECRET: 'test-meta-signature', META_VERIFY_TOKEN: 'test-verify', OPENAI_API_KEY: 'test-openai-token', OPENAI_MODEL: 'fixture', WHATSAPP_AUTOREPLY_ENABLED: 'true' }, old = { ...process.env }
  Object.assign(process.env, env)
  const store = new Store(), app = Fastify(), actor = { userId: 'wa-user', tenantId: env.PROVIDER_TENANT_ID, role: 'owner' as const }
  seedMember(store, actor); store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(createHash('sha256').update('test-wa-cookie').digest('hex'), actor.userId, Date.now() + 3600000, actor.tenantId)
  await app.register(cookie); await registerAuth(app, store); await registerDomains(app, store); await registerWhatsAppChannels(app, store)
  const state = { requests: [] as Array<{ path: string; method: string; body?: any }>, remote: [] as Array<{ url: URL; init: RequestInit }>, lose: '', providerUnknown: false, hook: undefined as undefined | (() => void) }
  await registerWhatsAppOperator(app, store, { fetcher: (async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.hostname, 'graph.facebook.com'); assert.equal(init.redirect, 'error'); state.remote.push({ url, init }); state.hook?.()
    if (init.method === 'POST') { if (state.providerUnknown) throw Error('lost provider response'); return Response.json({ messages: [{ id: `wamid.fixture${state.remote.length}` }] }) }
    return Response.json({ data: [{ id: '99', name: 'welcome', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}}' }], secret: 'never-project' }], paging: { cursors: { after: 'not-a-next-page' } } })
  }) as typeof fetch })
  const request = createEngineClient((async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'; state.requests.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const response = await app.inject({ url: path, method: method as any, headers: { ...(init.headers as any), cookie: 'kloel_session=test-wa-cookie' }, ...(init.body ? { payload: String(init.body) } : {}) })
    if (state.lose === `${method} ${path}`) { state.lose = ''; throw Error('response lost after commit') }
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent() {}, request }, api = createWhatsAppService(context), config = createWhatsAppChannelsService(context)
  const agent = store.create(actor.tenantId, 'agents', { name: 'Assistente ativo', status: 'active', prompt: 'Fixture', tools: [] })
  const fields: WhatsAppChannelFields = { name: 'Canal real', externalId: env.META_PHONE_NUMBER_ID, address: '+551155555555', agentId: agent.id }
  t.after(async () => { await app.close(); store.close(); for (const key of Object.keys(env)) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key] })
  return { api, config, context, actor, store, app, state, agent, fields, async createEnabled() { const created = await config.create(whatsappChannelAttempt('create'), fields); const row = await config.get(created.operation.channelId); await config.setEnabled(whatsappChannelAttempt('enable', row)); return config.get(row.id) } }
}

test('private WhatsApp CRUD preserves opaque legacy metadata and sender-compatible reads', async t => {
  const f = await fixture(t), result = await f.config.create(whatsappChannelAttempt('create'), f.fields), channel = await f.config.get(result.operation.channelId)
  assert.equal(channel.enabled, false); assert.equal(channel.verificationStatus, 'unverified'); assert.equal(f.state.remote.length, 0)
  f.store.update(f.actor.tenantId, 'channels', channel.id, { configuration: { externalId: '12345', address: f.fields.address, greeting: 'preserved', allowedOrigins: ['https://example.test'] } })
  const current = await f.config.get(channel.id); await f.config.update(whatsappChannelAttempt('update', current), { name: 'Nome novo' })
  const updated = await f.config.get(channel.id); await f.config.setEnabled(whatsappChannelAttempt('enable', updated))
  assert.equal((await f.api.getChannel(channel.id)).enabled, true); assert.equal((f.store.get(f.actor.tenantId, 'channels', channel.id)!.configuration as any).greeting, 'preserved')
  await assert.rejects(f.config.update(whatsappChannelAttempt('update', current), { name: 'Sobrescrever' }), (e: any) => e.code === 'whatsapp_channel_configuration_changed')
  await f.config.setEnabled(whatsappChannelAttempt('disable', await f.config.get(channel.id))); await f.config.remove(whatsappChannelAttempt('delete', await f.config.get(channel.id)))
  assert.deepEqual(await f.api.listChannels(), []); assert.equal(f.state.remote.length, 0)
})

test('activation is a distinct private intention and never silently provisions Meta', async t => {
  const f = await fixture(t)
  await assert.rejects(f.config.create(whatsappChannelAttempt('create'), { ...f.fields, token: 'do-not-send' } as any), EngineError)
  const r = await f.config.create(whatsappChannelAttempt('create'), { ...f.fields, externalId: '99999' }), row = await f.config.get(r.operation.channelId)
  assert.equal(row.enabled, false)
  await assert.rejects(f.config.setEnabled(whatsappChannelAttempt('enable', row)), (e: any) => e.code === 'channel_not_ready')
  await f.config.update(whatsappChannelAttempt('update', row), { externalId: '12345' })
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'paused' })
  await assert.rejects(f.config.setEnabled(whatsappChannelAttempt('enable', await f.config.get(row.id))), (e: any) => e.code === 'channel_not_ready')
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'active' }); await f.config.setEnabled(whatsappChannelAttempt('enable', await f.config.get(row.id)))
  await assert.rejects(f.config.create(whatsappChannelAttempt('create'), f.fields), (e: any) => e.code === 'duplicate_channel'); assert.equal(f.state.remote.length, 0)
})

test('lost private configuration responses reconcile through receipts without duplicate writes', async t => {
  const f = await fixture(t), create = whatsappChannelAttempt('create'); f.state.lose = 'POST /api/v1/whatsapp/channels'
  await assert.rejects(f.config.create(create, f.fields)); const created = await f.config.operation(create), original = await f.config.get(created.channelId)
  const update = whatsappChannelAttempt('update', original); f.state.lose = 'PATCH /api/v1/whatsapp/channels/' + original.id
  await assert.rejects(f.config.update(update, { name: 'Salvo' })); assert.equal((await f.config.operation(update)).kind, 'update')
  const saved = await f.config.get(original.id), remove = whatsappChannelAttempt('delete', saved); f.state.lose = 'DELETE /api/v1/whatsapp/channels/' + saved.id
  await assert.rejects(f.config.remove(remove)); assert.equal((await f.config.operation(remove)).result.deleted, true); assert.deepEqual(await f.api.listChannels(), [])
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal(f.state.requests.filter(row => row.method === method).length, 1)
})

test('status exposes runtime truth and approved template contract with no credentials/private provider payloads', async t => {
  const f = await fixture(t); let status = await f.api.status(); assert.deepEqual(status.autoreply, { enabled: true, schedulerRunning: false }); assert.equal(status.verifiedLive, false)
  setWhatsAppSchedulerRunning(f.store, true); status = await f.api.status(); assert.equal(status.autoreply.schedulerRunning, true)
  const list = await f.api.templates(); assert.equal(list.items[0].sendable, true); assert.equal(list.items[0].bodyParameterCount, 1); assert.equal(list.nextCursor, null)
  assert.ok(!JSON.stringify(list).includes('never-project')); assert.ok(!JSON.stringify(status).includes('test-meta-token'))
})

test('text/template sends use actual Fastify adapter, lost acceptance resolves by GET and uncertain provider outcome never repeats', async t => {
  const f = await fixture(t), channel = await f.createEnabled(), key = randomUUID()
  f.state.lose = 'POST /api/v1/whatsapp/send'
  await assert.rejects(f.api.send({ kind: 'text', channelId: channel.id, to: '+5511999999999', text: 'Olá' }, key), (e: any) => e.code === 'network_error')
  let receipt = await f.api.operation(key); assert.equal(receipt.status, 'succeeded'); assert.equal(receipt.deliveryStatus, 'accepted'); assert.equal(f.state.remote.length, 1)
  const msg = f.store.list(f.actor.tenantId, 'messages')[0]; f.store.update(f.actor.tenantId, 'messages', msg.id, { providerStatus: 'read' }); receipt = await f.api.operation(key); assert.equal(receipt.deliveryStatus, 'read')
  const template = (await f.api.templates()).items[0]
  await f.api.send({ kind: 'template', channelId: channel.id, to: '+5511888888888', name: template.name, language: template.language, bodyParameters: ['Maria'] }, randomUUID())
  assert.equal(JSON.parse(String(f.state.remote.at(-1)!.init.body)).template.name, 'welcome')
  const uncertainKey = randomUUID(); f.state.providerUnknown = true
  await assert.rejects(f.api.send({ kind: 'text', channelId: channel.id, to: '+5511777777777', text: 'Não repetir' }, uncertainKey))
  const before = f.state.remote.length; assert.equal((await f.api.operation(uncertainKey)).status, 'unknown')
  await assert.rejects(f.api.send({ kind: 'text', channelId: channel.id, to: '+5511777777777', text: 'Não repetir' }, randomUUID()), (e: any) => e.code === 'recipient_requires_reconciliation')
  assert.equal(f.state.remote.length, before); assert.equal(f.state.requests.some(row => row.path.includes('/providers/operations')), false)
})

test('configured channels feed actual inbound worker queue; jobs resume via CAS and reflect distinct accepted/delivered states', async t => {
  const f = await fixture(t), channel = await f.createEnabled(), conversation = f.store.create(f.actor.tenantId, 'conversations', { channel: 'whatsapp', status: 'open', externalContact: '+5511999999999' })
  const message = f.store.create(f.actor.tenantId, 'messages', { conversationId: conversation.id, role: 'user', source: 'meta', content: 'Olá', externalContact: '+5511999999999', providerMessageId: 'wamid.incoming' })
  const job = enqueueInboundReply(f.store, f.actor.tenantId, { conversation, message, phoneNumberId: channel.externalId!, messageType: 'text', providerTimestamp: String(Math.floor(Date.now() / 1000)) })!
  f.store.update(f.actor.tenantId, 'reply-jobs', job.id, { status: 'paused' })
  const paused = (await f.api.jobs()).items[0], queued = await f.api.resumeJob(paused); assert.equal(queued.status, 'queued')
  await assert.rejects(f.api.resumeJob(paused), (e: any) => e.code === 'job_not_resumable')
  const worker = createWhatsAppWorker(f.store, { generate: async () => ({ text: 'Resposta fixture', responseId: 'test-response', usage: {} }), send: async () => 'wamid.worker' })
  assert.equal((await worker.tick()).status, 'sent'); await worker.stop()
  let sent = (await f.api.jobs()).items[0]; assert.equal(sent.status, 'sent'); assert.equal(sent.deliveryStatus, 'accepted')
  const outbound = f.store.list(f.actor.tenantId, 'messages').find(row => row.providerMessageId === 'wamid.worker')!; f.store.update(f.actor.tenantId, 'messages', outbound.id, { providerStatus: 'delivered' })
  sent = (await f.api.jobs()).items[0]; assert.equal(sent.deliveryStatus, 'delivered'); assert.equal(f.state.remote.length, 0)
})

test('actual cookie revocation and membership permissions deny reads/writes; late transport results respect tenant generation', async t => {
  const f = await fixture(t); f.state.hook = () => f.store.db.exec('DELETE FROM sessions')
  await assert.rejects(f.api.templates(), (e: any) => e.status === 403)
  const request = (async () => ({ scope: 'single-tenant-pilot' })) as EngineRequest
  await assert.rejects(createWhatsAppService({ ...f.context, request, assertCurrent() { throw new EngineError(0, 'superseded', 'Changed') } }).status(), (e: any) => e.code === 'superseded')
  const foreign = (async () => ({ items: [{ tenantId: 'foreign', id: 'id' }], page: 1, limit: 100, total: 1, totalPages: 1 })) as EngineRequest
  await assert.rejects(createWhatsAppService({ ...f.context, request: foreign }).listChannels(), EngineError)
  await assert.rejects(f.api.operation('key.with.unsupported.punctuation'), EngineError)
})
