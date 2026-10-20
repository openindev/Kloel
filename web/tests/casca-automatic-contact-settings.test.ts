import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { captureFixture } from './engine-crm-capture-fixture'
import { CRMCaptureWorker } from '../../engine/src/crm/capture/worker'
import { recordCaptureIngress } from '../../engine/src/crm/capture/source-events'
import { transaction } from '../../engine/src/crm/service'
import { createCRMClient } from '../src/services/engine/crm'
import { createAutomaticContactSettings, type ContactSettingsInput } from '../src/services/casca/automatic-contact-settings'
import { loadContacts, projectContact, projectContactSettings, settingsPayload } from '../src/services/casca/contacts'
import { toCRMContact } from '../src/services/engine/crm'
import { useStore } from '../src/data/store'

/** loadContacts publica a projeção do snapshot na loja (único escritor de db.contactSettings): a tela lê de lá. */
const shownSettings = async (context: Parameters<typeof loadContacts>[0]) => { await loadContacts(context); return useStore.getState().db.contactSettings[0]! }
const memory = () => { const map = new Map<string, string>(); return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) }, removeItem: (key: string) => { map.delete(key) } } }
const input = (autoCapture = true): ContactSettingsInput => ({ autoCapture, creationGate: '', definitions: [] })
async function fixture(t: any) {
  const f = await captureFixture(t, false), storage = memory()
  const scheduler = new CRMCaptureWorker(f.store, { fetch: async () => { throw Error('No provider request expected') } })
  scheduler.start(60000); t.after(() => scheduler.stop())
  return { ...f, storage, commands: () => createAutomaticContactSettings(f.context, f.identity.context, storage) }
}

test('explicit save creates automatic grant on existing eligible channels and reauthorizes after the settings trigger', async t => {
  const f = await fixture(t)
  const phone = f.store.create(f.actor.tenantId, 'channels', { type: 'phone', provider: 'twilio', agentId: f.agent.id, enabled: true, name: 'Phone' })
  f.store.create(f.actor.tenantId, 'channels', { type: 'whatsapp', provider: 'unsupported', agentId: f.agent.id, enabled: true, name: 'Unsupported' })
  f.store.create(f.actor.tenantId, 'channels', { type: 'webchat', provider: 'openai', agentId: f.agent.id, enabled: false, name: 'Disabled' })
  const first = await f.commands().save(f.settings(), () => input())
  assert.equal(first.policy.grant?.automaticApplication, true)
  assert.equal(first.policy.grant?.policy.mode, 'auto_create_fill_empty')
  assert.deepEqual(first.policy.grant?.policy.channelIds, [f.channel.id, phone.id].sort())
  assert.equal(first.policy.grant?.policy.allowTransportMatch, false)
  assert.equal(first.policy.grant?.policy.expiresInDays, 90); assert.equal(first.policy.grant?.policy.jobsPerDay, 100)
  const firstId = first.policy.grant!.id
  const changed = await f.commands().save(f.settings(), () => ({ ...input(), creationGate: 'Quando solicitar retorno.' }))
  assert.notEqual(changed.policy.grant?.id, firstId)
  assert.equal(changed.policy.grant?.effective, true)
  assert.equal(f.store.get(f.actor.tenantId, 'crm-capture-grants', firstId)?.status, 'revoked')
  assert.equal(f.store.get(f.actor.tenantId, 'crm-capture-grants', firstId)?.reason, 'explicit_replacement')
  const writes = f.requests.filter(row => row.method !== 'GET').length
  await f.commands().save(f.settings(), () => ({ ...input(), creationGate: 'Quando solicitar retorno.' }))
  assert.equal(f.requests.filter(row => row.method !== 'GET').length, writes, 'unchanged confirmed settings and grant do not renew silently')
  await f.commands().save(f.settings(), () => input(false))
  const disabled = await f.client.policy()
  assert.equal(disabled.grant?.status, 'revoked'); assert.equal(disabled.grant?.effective, false)
  assert.equal(f.settings().autoCapture, false); assert.equal(f.storage.map.size, 0)
})

test('lost grant response is recovered only by GET, ignores new payload and never sends a second grant', async t => {
  const f = await fixture(t)
  f.state.after = async (path, method, response) => { if (method === 'POST' && path.endsWith('/crm/capture/grants')) throw Error('lost after commit'); return response }
  await assert.rejects(f.commands().save(f.settings(), () => input()))
  assert.equal(f.storage.map.size, 1)
  assert.doesNotMatch([...f.storage.map.values()][0]!, /creationGate|channelIds|synthetic|apiKey|cookie/)
  const writes = f.requests.filter(row => row.method !== 'GET').length
  f.state.after = undefined
  const recovered = await f.commands().save(f.settings(), () => { throw Error('new payload must not be read while recovering') })
  assert.equal(recovered.recovered, true); assert.equal(recovered.complete, true)
  assert.equal(recovered.policy.grant?.automaticApplication, true)
  assert.equal(f.requests.filter(row => row.method !== 'GET').length, writes)
  assert.equal(f.storage.map.size, 0)
})

test('lost settings response confirms current settings by GET before a later explicit save authorizes capture', async t => {
  const f = await fixture(t)
  f.state.after = async (path, method, response) => { if (method === 'PUT' && path.endsWith('/crm/settings')) throw Error('lost settings commit'); return response }
  await assert.rejects(f.commands().save(f.settings(), () => input()))
  const writes = f.requests.filter(row => row.method !== 'GET').length
  f.state.after = undefined
  const recovered = await f.commands().save(f.settings(), () => { throw Error('must recover first') })
  assert.equal(recovered.complete, false); assert.equal(recovered.recovered, true)
  assert.equal(f.requests.filter(row => row.method !== 'GET').length, writes)
  const complete = await f.commands().save(f.settings(), () => input())
  assert.equal(complete.policy.grant?.effective, true)
  assert.equal(f.requests.filter(row => row.method === 'PUT' && row.path.endsWith('/crm/settings')).length, 1)
})

test('channel changes and stale sessions cannot turn a recovered old grant into effective automation', async t => {
  const f = await fixture(t)
  f.state.after = async (path, method, response) => { if (method === 'POST' && path.endsWith('/crm/capture/grants')) throw Error('lost'); return response }
  await assert.rejects(f.commands().save(f.settings(), () => input()))
  f.state.after = undefined
  f.store.update(f.actor.tenantId, 'channels', f.channel.id, { enabled: false })
  const writes = f.requests.filter(row => row.method !== 'GET').length
  await assert.rejects(f.commands().save(f.settings(), () => input()), /mudou depois/)
  assert.equal(f.requests.filter(row => row.method !== 'GET').length, writes)
  f.state.current = false
  await assert.rejects(f.commands().save(f.settings(), () => input()), /Changed session/)
  assert.equal(f.requests.filter(row => row.method !== 'GET').length, writes)
})

test('unknown grant admission keeps its original reference and a retry performs only GET even when no receipt exists yet', async t => {
  const f = await fixture(t)
  f.state.before = async (path, method) => { if (method === 'POST' && path.endsWith('/crm/capture/grants')) throw Error('connection lost before admission') }
  await assert.rejects(f.commands().save(f.settings(), () => input()))
  const reference = [...f.storage.map.values()][0]!, writes = f.requests.filter(row => row.method !== 'GET').length
  f.state.before = undefined
  await assert.rejects(f.commands().save(f.settings(), () => input()))
  assert.equal(f.requests.filter(row => row.method !== 'GET').length, writes)
  assert.equal([...f.storage.map.values()][0], reference)
  assert.equal(f.store.list(f.actor.tenantId, 'crm-capture-grants').length, 0)
})

test('an empty channel scope saves the preferences without creating a grant and explains how to activate', async t => {
  const f = await fixture(t)
  f.store.update(f.actor.tenantId, 'channels', f.channel.id, { enabled: false })
  const result = await f.commands().save(f.settings(), () => input())
  assert.equal('waitingForChannel' in result && result.waitingForChannel, true)
  assert.equal(f.settings().autoCapture, true); assert.equal(result.policy.grant, null)
  assert.equal(f.requests.filter(row => row.method === 'POST' && row.path.includes('/crm/capture/grants')).length, 0)
  assert.match((await shownSettings(f.context)).automationError!, /Reativar/)
  f.store.update(f.actor.tenantId, 'channels', f.channel.id, { enabled: true })
  const reactivated = await f.commands().save(f.settings(), () => input())
  assert.equal(reactivated.policy.grant?.effective, true)
})

test('a lost revoke response is confirmed by GET without a second revoke or reactivation', async t => {
  const f = await fixture(t)
  await f.commands().save(f.settings(), () => input())
  f.state.after = async (path, method, response) => { if (method === 'POST' && path.endsWith('/revoke')) throw Error('lost revoke'); return response }
  await assert.rejects(f.commands().save(f.settings(), () => input(false)))
  const writes = f.requests.filter(row => row.method !== 'GET').length
  f.state.after = undefined
  const recovered = await f.commands().save(f.settings(), () => { throw Error('do not reactivate during recovery') })
  assert.equal(recovered.recovered, true); assert.equal(recovered.policy.grant?.status, 'revoked')
  assert.equal(recovered.settings.autoCapture, false)
  assert.equal(f.requests.filter(row => row.method !== 'GET').length, writes)
  assert.equal(f.storage.map.size, 0)
})

test('a concurrent settings change rejects the stale CAS without issuing a grant', async t => {
  const f = await fixture(t), previous = f.settings()
  await createCRMClient(f.context).saveSettings(previous, { ...input(false), creationGate: 'Outra pessoa alterou.' })
  const before = f.requests.length
  await assert.rejects(f.commands().save(previous, () => input()))
  assert.equal(f.store.list(f.actor.tenantId, 'crm-capture-grants').length, 0)
  assert.equal(f.settings().creationGate, 'Outra pessoa alterou.')
  assert.equal(f.settings().autoCapture, false)
  assert.equal(f.requests.slice(before).filter(row => row.method === 'POST').length, 0)
  assert.equal(f.storage.map.size, 0, 'confirmed rejection releases only the failed attempt')
})

test('two adapters in the same session cannot submit a second settings mutation while one is awaiting a response', async t => {
  const f = await fixture(t)
  let release!: () => void, arrived!: () => void
  const held = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { arrived = resolve })
  f.state.before = async (path, method) => { if (method === 'PUT' && path.endsWith('/crm/settings')) { arrived(); await held } }
  const first = f.commands().save(f.settings(), () => input())
  await ready
  await assert.rejects(f.commands().save(f.settings(), () => input()), /Aguarde/)
  release()
  assert.equal((await first).policy.grant?.effective, true)
  assert.equal(f.requests.filter(row => row.method === 'PUT').length, 1)
  assert.equal(f.requests.filter(row => row.method === 'POST').length, 1)
})

test('reload preserves saved automatic preferences but exposes a persistent error after failed grant or revocation', async t => {
  const f = await fixture(t)
  await createCRMClient(f.context).saveSettings(f.settings(), input())
  const missing = (await shownSettings(f.context))
  assert.equal(missing.autoCapture, true)
  assert.match(missing.automationError!, /ainda não foi autorizada/)
  const confirmed = await f.commands().save(f.settings(), () => input())
  assert.equal((await shownSettings(f.context)).automationError, undefined)
  f.store.update(f.actor.tenantId, 'channels', f.channel.id, { enabled: false })
  await assert.rejects(f.commands().confirm(confirmed), /mudou/)
  const revoked = (await shownSettings(f.context))
  assert.equal(revoked.autoCapture, true)
  assert.match(revoked.automationError!, /pausados.*Reativar/)
  f.state.before = async path => { if (path.endsWith('/crm/capture/policy')) throw Error('read unavailable') }
  const unavailable = (await shownSettings(f.context))
  assert.equal(unavailable.autoCapture, true)
  assert.match(unavailable.automationError!, /não foi possível confirmar/)
})

test('automatic phone ingress creates one contact with preserved automation provenance and no communication consent', async t => {
  const f = await fixture(t)
  const phone = f.store.create(f.actor.tenantId, 'channels', { type: 'phone', provider: 'twilio', agentId: f.agent.id, enabled: true, name: 'Phone' })
  await f.commands().save(f.settings(), () => input())
  const now = Date.now() + 5000, transport = '+5511999990000'
  const conversation = f.store.create(f.actor.tenantId, 'conversations', { channel: 'phone', channelId: phone.id, agentId: f.agent.id, externalContact: transport, status: 'open' })
  transaction(f.store, () => {
    const message = f.store.create(f.actor.tenantId, 'messages', { conversationId: conversation.id, role: 'user', content: 'Ana Silva pediu retorno.' })
    const receipt = recordCaptureIngress(f.store, { tenantId: f.actor.tenantId, conversationId: conversation.id, messageId: message.id, channelId: phone.id, agentId: f.agent.id, kind: 'voice_final_user_transcript', receiptId: randomUUID(), occurredAt: now, sessionStartedAt: now - 100, transportIdentifier: transport }, () => {}, now)
    assert.equal(receipt.jobs, 1)
  })
  let calls = 0
  const worker = new CRMCaptureWorker(f.store, { now: () => now, fetch: (async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); calls++
    const source = JSON.parse(JSON.parse(String(init?.body)).input).sources.at(-1)
    const evidence = [{ sourceEventId: source.id, start: 0, end: 9, quote: 'Ana Silva' }]
    const result = { candidate: 'person', subject: 'current_participant', gate: { satisfied: true, evidence }, values: [{ fieldId: 'firstName', value: 'Ana', evidence }, { fieldId: 'lastName', value: 'Silva', evidence }], identityClaims: [] }
    return Response.json({ id: 'synthetic-response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }], usage: { input_tokens: 20, output_tokens: 20 } })
  }) as typeof fetch })
  t.after(() => worker.stop())
  const job = f.store.list(f.actor.tenantId, 'crm-capture-jobs').at(-1)!
  assert.equal((await worker.generate(f.actor.tenantId, job.id)).status, 'applied')
  const rows = f.store.list(f.actor.tenantId, 'contacts'); assert.equal(rows.length, 1)
  const raw = await f.client.contact(rows[0]!.id)
  assert.equal(raw.source, 'automation')
  const projected = projectContact(toCRMContact(raw, f.actor.tenantId), f.settings(), new Map())
  assert.equal(projected.source, 'conversation'); assert.equal(projected.engineSource, 'automation')
  assert.equal(projected.captureProvenance?.firstName?.origin, 'automation')
  assert.equal(f.store.list(f.actor.tenantId, 'contact-permission-events').length, 0)
  assert.equal(calls, 1)
  await f.propose()
  assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 1, 'anonymous webchat remains a proposal under backend identity rules')
})

test('"Manter atualizado", "Como encontrar" and "Atualizar somente quando" are saved, granted and projected back', async t => {
  const f = await fixture(t), shell = projectContactSettings(f.settings(), f.actor.tenantId)
  const field = { id: 'new_field', label: 'Preferência', type: 'text' as const, description: '', aiFill: true, keepUpdated: false }
  const fillEmpty = settingsPayload({ ...shell, smartFields: [{ ...field, updateWhen: 'ignorado sem manter atualizado' }] }, f.settings())
  assert.equal(fillEmpty.definitions[0]?.aiFill, true); assert.equal(fillEmpty.definitions[0]?.keepUpdated, false); assert.equal(fillEmpty.definitions[0]?.updateWhen, '')
  const payload = settingsPayload({ ...shell, smartFields: [{ ...field, keepUpdated: true, updateWhen: 'Quando mudar', findHint: 'Procure “prefiro …”.' }] }, f.settings())
  assert.equal(payload.definitions[0]?.keepUpdated, true); assert.equal(payload.definitions[0]?.updateWhen, 'Quando mudar'); assert.equal(payload.definitions[0]?.findHint, 'Procure “prefiro …”.')
  assert.equal(settingsPayload({ ...shell, smartFields: [{ ...field, keepUpdated: undefined }] }, f.settings()).definitions[0]?.keepUpdated, true, 'new fields default to the switch shown on')
  const result = await f.commands().save(f.settings(), () => payload)
  assert.deepEqual(result.policy.grant?.policy.allowedFieldIds, [f.settings().definitions[0]!.id])
  const projected = projectContactSettings(f.settings(), f.actor.tenantId).smartFields[0]
  assert.equal(projected?.keepUpdated, true); assert.equal(projected?.updateWhen, 'Quando mudar'); assert.equal(projected?.findHint, 'Procure “prefiro …”.')
})
