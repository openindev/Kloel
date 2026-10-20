import test from 'node:test'
import assert from 'node:assert/strict'
import { captureFixture } from './engine-crm-capture-fixture'
import { activateCapture } from '../../engine/src/crm/capture/authority'
import { CRMCaptureWorker } from '../../engine/src/crm/capture/worker'
import { assertAutomaticContactSettings } from '../src/services/casca/contact-capture-guard'

test('the backend trigger invalidates a prechecked automatic grant while preserving the saved preferences', async t => {
  const f = await captureFixture(t)
  const scheduler = new CRMCaptureWorker(f.store, { fetch: async () => { throw Error('No provider call expected') } })
  scheduler.start(60000); t.after(() => scheduler.stop())
  activateCapture(f.store, f.actor, f.hash, { ...f.policy(), mode: 'auto_create_fill_empty' }, f.settings().revision, null, null)
  const before = await f.client.policy(), input = { autoCapture: true, smartFields: [] }
  assert.doesNotThrow(() => assertAutomaticContactSettings(input, before))
  const { createCRMClient } = await import('../src/services/engine/crm')
  await createCRMClient(f.context).saveSettings(f.settings(), { autoCapture: true, creationGate: 'Somente quando pedir retorno.', definitions: [] })
  const after = await f.client.policy()
  assert.equal(after.grant?.status, 'needs_reauthorization')
  assert.equal(f.settings().autoCapture, true)
  assert.equal(f.settings().creationGate, 'Somente quando pedir retorno.')
  assert.throws(() => assertAutomaticContactSettings(input, after), /captura automática/)
  assert.doesNotThrow(() => assertAutomaticContactSettings({ autoCapture: false, smartFields: [] }, after))
  assert.equal(f.modelCalls(), 0)
})

test('autofill needs each selected field in the automatic grant rather than an unrelated effective field', async t => {
  const f = await captureFixture(t)
  const scheduler = new CRMCaptureWorker(f.store, { fetch: async () => { throw Error('No provider call expected') } })
  scheduler.start(60000); t.after(() => scheduler.stop())
  activateCapture(f.store, f.actor, f.hash, { ...f.policy(), mode: 'auto_create_fill_empty' }, f.settings().revision, null, null)
  const state = await f.client.policy()
  const scoped = { ...state, grant: { ...state.grant!, aiFillEffective: true, policy: { ...state.grant!.policy, allowedFieldIds: ['granted'] } } }
  const field = { id: 'ungranted', label: 'Campo', type: 'text' as const, description: '', aiFill: true }
  assert.throws(() => assertAutomaticContactSettings({ autoCapture: false, smartFields: [field] }, scoped), /preenchimento automático/)
  assert.doesNotThrow(() => assertAutomaticContactSettings({ autoCapture: false, smartFields: [{ ...field, id: 'granted' }] }, scoped))
  assert.throws(() => assertAutomaticContactSettings({ autoCapture: true, smartFields: [] }, { ...state, grant: { ...state.grant!, policy: { ...state.grant!.policy, captureContacts: false } } }), /captura automática/)
})
