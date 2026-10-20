import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import { Store } from '../../engine/src/store'
import { registerDomains } from '../../engine/src/domains'
import { registerTwilioTelephony } from '../../engine/src/providers/telephony'
import { routeSignedTwilioCall } from '../../engine/src/providers/voice-routing'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { createPhonesService } from '../src/services/engine/phones'
import { createPhoneConfigService, phoneAttempt } from '../src/services/engine/phone-config'
import { registerPhoneConfig } from '../../engine/src/phone-config'

const account = `AC${'a'.repeat(32)}`, sid = `PN${'b'.repeat(32)}`, callerSid = `PN${'c'.repeat(32)}`, number = '+551155555555', callerNumber = '+551166666666'
async function fixture(t: any) {
  const oldFetch = globalThis.fetch, saved = { ...process.env }
  const config = { PROVIDER_TENANT_ID: 'phones-tenant', TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'isolated-telephony-test-token', TWILIO_VOICE_WEBHOOK_URL: 'https://example.test/api/v1/webhooks/twilio/voice', TWILIO_CALLER_ID_WEBHOOK_URL: 'https://example.com/api/v1/webhooks/twilio/caller-id', OAUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'), OPENAI_SIP_URI: 'sip:fixture@sip.api.openai.com;transport=tls' }
  Object.assign(process.env, config)
  const store = new Store(), app = Fastify(), actor = { tenantId: 'phones-tenant', userId: 'phone-operator', role: 'owner' as any }
  seedMember(store, actor); const sessionHash = createHash('sha256').update('phone-cookie').digest('hex')
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionHash, actor.userId, Date.now() + 3600000, actor.tenantId)
  app.addHook('onRequest', async request => { request.actor = { ...actor }; request.cookies = { kloel_session: 'phone-cookie' } })
  await registerDomains(app, store); await registerTwilioTelephony(app, store); await registerPhoneConfig(app, store)
  const state = { confirmed: false, ownedExists: true, next: false, lose: '', remote: [] as Array<{ url: URL; method: string; form: URLSearchParams }>, local: [] as Array<{ path: string; method: string; body?: any }>, hook: undefined as undefined | (() => void) }
  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.hostname, 'api.twilio.com'); assert.equal(init.redirect, 'error')
    state.remote.push({ url, method: init.method ?? 'GET', form: new URLSearchParams(String(init.body ?? '')) }); state.hook?.()
    if (url.pathname.includes('/AvailablePhoneNumbers/')) return Response.json({ available_phone_numbers: [{ phone_number: '+551177777777', friendly_name: 'Catálogo fixture', iso_country: 'BR', capabilities: { voice: true, SMS: true }, address_requirements: 'local', locality: 'São Paulo', region: 'SP' }] })
    if (url.pathname.endsWith('/IncomingPhoneNumbers.json')) return Response.json({ incoming_phone_numbers: state.ownedExists ? [{ sid, account_sid: account, phone_number: number, friendly_name: 'Número próprio', capabilities: { voice: true, sms: true }, status: 'in-use', voice_url: config.TWILIO_VOICE_WEBHOOK_URL }] : [], next_page_uri: state.next ? '/provider-private-next' : null })
    if (url.pathname.endsWith('/OutgoingCallerIds.json') && init.method === 'POST') return Response.json({ account_sid: account, call_sid: `CA${'d'.repeat(32)}`, phone_number: callerNumber, validation_code: '123456' })
    if (url.pathname.endsWith('/OutgoingCallerIds.json')) return Response.json({ outgoing_caller_ids: state.confirmed ? [{ sid: callerSid, account_sid: account, phone_number: callerNumber, friendly_name: 'Saída verificada' }] : [], next_page_uri: null })
    throw Error(`Unexpected provider fixture path ${url.pathname}`)
  }) as typeof fetch
  const request = createEngineClient((async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'; state.local.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const response = await app.inject({ url: path, method: method as any, headers: init.headers as any, ...(init.body ? { payload: String(init.body) } : {}) })
    if (state.lose === `${method} ${path}`) { state.lose = ''; throw Error('fixture response lost after commit') }
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, request, assertCurrent() {} }, privateConfig = createPhoneConfigService(context)
  const service = { ...createPhonesService(context), listLocal: privateConfig.list,
    async registerOwned(own: any, fields: any) { const r = await privateConfig.create(phoneAttempt('create'), { ...fields, number: own.phoneNumber, providerNumberId: own.sid }); return privateConfig.get(r.operation.numberId) },
    async updateLocal(row: any, fields: any) { const r = await privateConfig.update(phoneAttempt('update', row), fields); return privateConfig.get(r.operation.numberId) },
    removeLocal: (row: any) => privateConfig.remove(phoneAttempt('delete', row)),
  }
  const agent = store.create(actor.tenantId, 'agents', { name: 'Agente ativo', status: 'active', tools: [] })
  const channel = store.create(actor.tenantId, 'channels', { name: 'Telefone', type: 'phone', provider: 'twilio', enabled: true, agentId: agent.id })
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = oldFetch; for (const key of Object.keys(config)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key] } })
  return { actor, store, app, state, context, service, agent, channel }
}

test('provider catalogs, own numbers and caller IDs use real bounded read contracts without buying or claiming inbound caller-ID service', async t => {
  const f = await fixture(t); f.state.next = true
  const own = await f.service.listOwned(2); assert.equal(own.nextPage, 3); assert.equal(own.items[0].configuredVoiceWebhook, true)
  assert.equal(f.state.remote[0].url.searchParams.get('Page'), '2')
  const catalog = await f.service.available({ country: 'BR', type: 'local', areaCode: '11', contains: '55*' }); assert.equal(catalog[0].capabilities.sms, true)
  assert.equal(f.state.remote[1].url.searchParams.get('VoiceEnabled'), 'true'); assert.equal(f.state.remote[1].url.searchParams.get('AreaCode'), '11')
  f.state.confirmed = true; const callers = await f.service.listCallerIds()
  assert.equal(callers.items[0].outboundOnly, true); assert.equal(callers.items[0].inboundRoutingConfigured, false)
  assert.equal(f.store.list(f.actor.tenantId, 'phone-numbers').length, 0)
  assert.ok(f.state.remote.every(row => row.method === 'GET')); assert.ok(!JSON.stringify(own).includes('provider-private'))
})

test('owned-number registration, validated local routing, rename, unlink and local removal use private versioned endpoints', async t => {
  const f = await fixture(t), owned = (await f.service.listOwned()).items[0]
  const created = await f.service.registerOwned(owned, { name: 'Atendimento', agentId: f.agent.id, channelId: f.channel.id })
  assert.equal(created.provisioningStatus, 'unverified'); assert.deepEqual(created.capabilities, ['voice', 'sms'])
  assert.equal(created.providerNumberId, sid)
  const routed = routeSignedTwilioCall(f.store, f.actor.tenantId, { Direction: 'inbound', To: number, CallSid: `CA${'e'.repeat(32)}` }, 'sip:fixture@sip.api.openai.com;transport=tls')
  assert.equal(routed.agentId, f.agent.id); assert.match(routed.sipUri, /x-kloel-route=/)
  const updated = await f.service.updateLocal(created, { name: 'Nome alterado', agentId: null, channelId: null })
  assert.equal(updated.agentId, null); assert.equal(updated.channelId, null); assert.equal(updated.name, 'Nome alterado')
  await f.service.removeLocal(updated); assert.deepEqual(await f.service.listLocal(), [])
  assert.ok(f.state.remote.every(row => row.method === 'GET')); assert.equal(f.state.remote.some(row => row.method === 'DELETE'), false)
})

test('server routing validation rejects absent ownership, inactive agents and incompatible channels without a local effect', async t => {
  const f = await fixture(t), own = (await f.service.listOwned()).items[0]
  f.state.ownedExists = false; await assert.rejects(f.service.registerOwned(own, { name: 'Teste' }), (error: any) => error.code === 'phone_ownership_unconfirmed')
  f.state.ownedExists = true; f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'paused' })
  await assert.rejects(f.service.registerOwned(own, { name: 'Teste', agentId: f.agent.id }), (error: any) => error.code === 'phone_route_invalid')
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'active' }); f.store.update(f.actor.tenantId, 'channels', f.channel.id, { provider: 'local' })
  await assert.rejects(f.service.registerOwned(own, { name: 'Teste', agentId: f.agent.id, channelId: f.channel.id }), (error: any) => error.code === 'phone_route_invalid')
  assert.equal(f.store.list(f.actor.tenantId, 'phone-numbers').length, 0); assert.ok(f.state.remote.every(row => row.method === 'GET'))
})

test('already changed local records fail server CAS and never overwrite a concurrent saved name', async t => {
  const f = await fixture(t), own = (await f.service.listOwned()).items[0], original = await f.service.registerOwned(own, { name: 'Original' })
  f.store.update(f.actor.tenantId, 'phone-numbers', original.id, { name: 'Alteração concorrente' })
  await assert.rejects(f.service.updateLocal(original, { name: 'Stale' }), (error: any) => error.code === 'phone_configuration_changed')
  await assert.rejects(f.service.removeLocal(original), (error: any) => error.code === 'phone_configuration_changed')
  assert.equal(f.store.get(f.actor.tenantId, 'phone-numbers', original.id)!.name, 'Alteração concorrente')
})

test('uncertain local writes are never retried and can be reconciled by reading their actual saved state', async t => {
  const f = await fixture(t), own = (await f.service.listOwned()).items[0]
  f.state.lose = 'POST /api/v1/phone-config/numbers'
  await assert.rejects(f.service.registerOwned(own, { name: 'Resposta perdida' }), (error: any) => error.code === 'network_error')
  let rows = await f.service.listLocal(); assert.equal(rows.length, 1); assert.equal(rows[0].name, 'Resposta perdida')
  f.state.lose = `PATCH /api/v1/phone-config/numbers/${rows[0].id}`
  await assert.rejects(f.service.updateLocal(rows[0], { name: 'Nome persistido' }), (error: any) => error.code === 'network_error')
  rows = await f.service.listLocal(); assert.equal(rows[0].name, 'Nome persistido')
  f.state.lose = `DELETE /api/v1/phone-config/numbers/${rows[0].id}`; await assert.rejects(f.service.removeLocal(rows[0]), (error: any) => error.code === 'network_error')
  assert.deepEqual(await f.service.listLocal(), [])
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal(f.state.local.filter(row => row.method === method).length, 1)
})

test('caller-ID verification requires explicit call confirmation, hides codes in lists and reconciles only provider reads', async t => {
  const f = await fixture(t)
  await assert.rejects(f.service.requestValidation({ phoneNumber: callerNumber, confirmCall: false }, randomUUID()), EngineError)
  assert.equal(f.state.remote.length, 0)
  const started = await f.service.requestValidation({ phoneNumber: callerNumber, friendlyName: 'Saída', confirmCall: true }, randomUUID())
  assert.equal(started.validationCode, '123456'); assert.equal(started.verified, false); assert.equal(started.status, 'awaiting_confirmation')
  const list = await f.service.validations(); assert.equal(list.length, 1); assert.equal(list[0].validationCode, undefined)
  const absent = await f.service.reconcileValidation(list[0]); assert.equal(absent.verified, false); assert.equal(absent.found, false)
  f.state.confirmed = true; const confirmed = await f.service.reconcileValidation(absent)
  assert.equal(confirmed.verified, true); assert.equal(confirmed.confirmationSource, 'twilio_api_reconciliation')
  assert.equal(confirmed.validationCode, undefined); assert.equal(f.store.list(f.actor.tenantId, 'phone-numbers').length, 0)
  assert.equal(f.state.remote.filter(row => row.method === 'POST').length, 1)
})

test('lost verification response is found by receipt and confirmed without another verification call', async t => {
  const f = await fixture(t); f.state.lose = 'POST /api/v1/voice/caller-ids/validation-requests'
  await assert.rejects(f.service.requestValidation({ phoneNumber: callerNumber, confirmCall: true }, randomUUID()), (error: any) => error.code === 'network_error')
  const receipts = await f.service.validations(); assert.equal(receipts.length, 1); assert.equal(receipts[0].status, 'awaiting_confirmation')
  f.state.confirmed = true; assert.equal((await f.service.reconcileValidation(receipts[0])).verified, true)
  assert.equal(f.state.remote.filter(row => row.method === 'POST').length, 1)
})

test('server permissions and revoked session stop mutations/provider disclosure even with a stale client context', async t => {
  const f = await fixture(t), own = (await f.service.listOwned()).items[0], row = await f.service.registerOwned(own, { name: 'Visible' })
  f.actor.role = 'viewer'; f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('viewer', f.actor.userId)
  assert.equal((await f.service.listLocal()).length, 1)
  await assert.rejects(f.service.updateLocal(row, { name: 'Denied' }), (error: any) => error.status === 403)
  await assert.rejects(f.service.listOwned(), (error: any) => error.status === 403)
  f.actor.role = 'owner'; f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('owner', f.actor.userId)
  f.state.hook = () => f.store.db.exec('DELETE FROM sessions')
  await assert.rejects(f.service.listOwned(), (error: any) => error.status === 403)
})

test('typed service discards foreign tenant data, stale session results and inconsistent provider provenance', async () => {
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() {}, request: (async () => ({ items: [], page: 0, nextPage: null, source: 'demo', providerVerified: true })) as EngineRequest }
  await assert.rejects(createPhonesService(context).listOwned(), EngineError)
  const stale = { ...context, assertCurrent() { throw new EngineError(0, 'superseded', 'Changed') }, request: (async () => ({ items: [], page: 0, nextPage: null, source: 'twilio', providerVerified: true })) as EngineRequest }
  await assert.rejects(createPhonesService(stale).listOwned(), (error: any) => error.code === 'superseded')
  const foreign = { ...context, request: (async () => ({ items: [{ id: 'phone', tenantId: 'foreign' }], page: 1, limit: 100, total: 1, totalPages: 1 })) as EngineRequest }
  await assert.rejects(createPhonesService(foreign).listLocal(), EngineError)
})
