import test from 'node:test'
import assert from 'node:assert/strict'
import { captureFixture } from './engine-crm-capture-fixture'
import { assertAutomaticContactSettings } from '../src/services/casca/contact-capture-guard'

test('an actual review grant cannot make automatic capture or autofill settings appear operational', async t => {
  const f = await captureFixture(t); await f.activate()
  const policy = await f.client.policy(), writes = f.requests.filter(r => r.method === 'POST').length
  assert.equal(policy.grant?.automaticApplication, false)
  assert.throws(() => assertAutomaticContactSettings({ autoCapture: true, smartFields: [] }, policy), /captura automática/)
  assert.throws(() => assertAutomaticContactSettings({ autoCapture: false, smartFields: [{ id: 'field', label: 'Campo', type: 'text', description: '', aiFill: true }] }, policy), /preenchimento automático/)
  assert.doesNotThrow(() => assertAutomaticContactSettings({ autoCapture: false, smartFields: [] }, policy))
  assert.equal(f.requests.filter(r => r.method === 'POST').length, writes)
})
