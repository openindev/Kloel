import test from 'node:test'
import assert from 'node:assert/strict'
import { createWhatsAppAttemptReference } from '../src/services/engine/whatsapp-attempt'

function fixture() {
  const values = new Map<string, string>()
  const storage = { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value) }, removeItem: (name: string) => { values.delete(name) } }
  return { values, storage, reference: (user = 'user', tenant = 'tenant') => createWhatsAppAttemptReference(() => storage, user, tenant) }
}

test('WhatsApp recovery pointer is isolated by user and tenant and contains only opaque key/version', () => {
  const f = fixture(), reference = f.reference(); reference.remember('opaque-operation-1')
  assert.deepEqual(f.reference().load(), { key: 'opaque-operation-1' })
  assert.deepEqual(f.reference('other').load(), { key: undefined }); assert.deepEqual(f.reference('user', 'other').load(), { key: undefined })
  assert.deepEqual(JSON.parse([...f.values.values()][0]), { version: 1, key: 'opaque-operation-1' })
  assert.throws(() => reference.remember('replacement-operation'), /referência/)
  assert.throws(() => reference.forgetResolved('different-operation'), /mantida/)
  assert.equal(reference.load().key, 'opaque-operation-1')
  reference.forgetResolved('opaque-operation-1'); assert.equal(f.values.size, 0)
})

test('blocked/corrupted browser storage fails closed without erasing a recoverable reference', () => {
  const f = fixture(), reference = f.reference(); reference.remember('opaque-operation-2')
  const name = [...f.values.keys()][0]; f.values.set(name, '{malformed')
  assert.ok(reference.load().error); assert.throws(() => reference.remember('another-operation')); assert.equal(f.values.get(name), '{malformed')
  const unavailable = createWhatsAppAttemptReference(() => { throw Error('blocked'); }, 'user', 'tenant')
  assert.ok(unavailable.load().error); assert.throws(() => unavailable.remember('opaque-operation-3'))
  const quota = createWhatsAppAttemptReference(() => ({ ...f.storage, setItem() { throw Error('quota'); } }), 'new-user', 'tenant')
  assert.throws(() => quota.remember('opaque-operation-4')); assert.equal(f.values.size, 1)
})
