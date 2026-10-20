import test from 'node:test'
import assert from 'node:assert/strict'
import { getSettings } from '../../engine/src/crm/service'
import { contactsConversationsFixture as fixture } from './engine-contacts-conversations-fixture'

test('Configurações de contatos: "Apagar esses valores ao salvar" limpa só os valores incompatíveis e converte o restante', async t => {
  const f = await fixture(t)
  const { captureEngineContext } = await import('../src/services/engine/session')
  const { loadContacts, saveContact, saveContactSettings, incompatibleContactIds } = await import('../src/services/casca/contacts')
  const { publishSlice } = await import('../src/services/casca/data')
  const { useStore } = await import('../src/data/store')
  const { fieldValueFits } = await import('../src/app/pages/contacts/lib')
  const context = captureEngineContext()
  publishSlice(context, await loadContacts(context))
  await saveContactSettings({ autoCapture: false, creationGate: '', smartFields: [{ id: 'draft', label: 'Convênio', type: 'text', description: '', aiFill: false }] })
  const field = useStore.getState().db.contactSettings.find(s => s.orgId === f.tenant)!.smartFields[0]!
  await saveContact({ firstName: 'A', lastName: '', phones: [{ value: '+5562991110011', label: '' }], emails: [], company: '', notes: '', fields: { [field.id]: 'Unimed' } })
  const b = await saveContact({ firstName: 'B', lastName: '', phones: [{ value: '+5562991110012', label: '' }], emails: [], company: '', notes: '', fields: { [field.id]: 'Plano antigo' } })
  const next = { ...field, type: 'enum' as const, options: ['Unimed', 'Bradesco'] }
  const contacts = useStore.getState().db.contacts.filter(c => c.orgId === f.tenant), fits = (def: typeof next, value: string | undefined) => fieldValueFits(field, def, value)
  assert.deepEqual(incompatibleContactIds(next, contacts, fits), [b.id])
  await assert.rejects(saveContactSettings({ autoCapture: false, creationGate: '', smartFields: [next] }), /não combina/)
  await saveContactSettings({ autoCapture: false, creationGate: '', smartFields: [next] }, [{ fieldId: field.id, contactIds: incompatibleContactIds(next, contacts, fits) }])
  const definition = getSettings(f.store, f.tenant).definitions[0]!
  assert.equal(definition.type, 'choice')
  const rows = useStore.getState().db.contacts.filter(c => c.orgId === f.tenant)
  assert.equal(rows.find(c => c.firstName === 'A')?.fields[field.id], 'Unimed'); assert.equal(rows.find(c => c.id === b.id)?.fields[field.id], undefined)
  // A limpeza vai no mesmo PUT da configuração (transação única), sem chamada separada que apague antes.
  assert.equal(f.requests.filter(r => r.path === '/api/v1/crm/field-values/clear').length, 0)
  assert.deepEqual(f.requests.filter(r => r.path === '/api/v1/crm/settings' && r.method === 'PUT').at(-1)?.body.clear, [{ fieldId: field.id, contactIds: [b.id] }])
})

