import test from 'node:test'
import assert from 'node:assert/strict'
import { contactsConversationsFixture as fixture } from './engine-contacts-conversations-fixture'

/** Consentimento (LGPD) por destino: o registro vai ao motor com a revisão atual do contato e volta no estado consultado. */
test('consent decisions are recorded with evidence, revoked later and never invented from the contact form', async t => {
  const f = await fixture(t)
  const { captureEngineContext } = await import('../src/services/engine/session')
  const { loadContacts, saveContact, loadContactPermissions, recordContactPermission } = await import('../src/services/casca/contacts')
  const { publishSlice } = await import('../src/services/casca/data')
  const context = captureEngineContext()
  publishSlice(context, await loadContacts(context))
  const contact = await saveContact({ firstName: 'Lia', lastName: 'Rocha', phones: [{ value: '+55 62 99111-0300', label: '' }], emails: [{ value: 'lia@example.test', label: '' }], company: '', notes: '', fields: {} })
  assert.deepEqual((await loadContactPermissions(contact.id)).items, [])
  await recordContactPermission(contact.id, { channel: 'whatsapp', identifier: '+5562991110300', purpose: 'service', event: 'granted', occurredAt: new Date(Date.now() - 60000).toISOString(), source: 'Pediu lembretes pelo WhatsApp.' })
  let state = await loadContactPermissions(contact.id)
  assert.equal(state.items.length, 1); assert.equal(state.items[0]!.effective, true); assert.equal(state.items[0]!.source, 'Pediu lembretes pelo WhatsApp.'); assert.ok(state.items[0]!.occurredAt)
  await recordContactPermission(contact.id, { channel: 'whatsapp', identifier: '+5562991110300', purpose: 'service', event: 'revoked', occurredAt: new Date().toISOString(), source: 'Pediu para parar.' })
  state = await loadContactPermissions(contact.id); assert.equal(state.items[0]!.status, 'revoked'); assert.equal(state.items[0]!.effective, false)
  await assert.rejects(recordContactPermission(contact.id, { channel: 'email', identifier: 'outra@example.test', purpose: 'marketing', event: 'granted', occurredAt: new Date().toISOString(), source: 'x' }), /Destino não pertence/)
  await assert.rejects(recordContactPermission(contact.id, { channel: 'email', identifier: 'lia@example.test', purpose: 'marketing', event: 'granted', occurredAt: new Date().toISOString(), source: '  ' }), /Informe como/)
  assert.equal(f.store.list(f.tenant, 'contact-permission-events').length, 2)
})
