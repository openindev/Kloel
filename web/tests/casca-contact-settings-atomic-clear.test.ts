import test from 'node:test'
import assert from 'node:assert/strict'
import { getContact, getSettings, saveSettings } from '../../engine/src/crm/service'
import { contactsConversationsFixture as fixture } from './engine-contacts-conversations-fixture'

let serial = 0
const person = (firstName: string, fields: Record<string, string>) => ({ firstName, lastName: '', phones: [{ value: `+55629911104${String(++serial).padStart(2, '0')}`, label: '' as const }], emails: [], company: '', notes: '', fields })

test('"Apagar esses valores ao salvar": nada é apagado se a configuração for recusada; aceita, a limpeza vai no mesmo PUT pela regra do motor', async t => {
  const f = await fixture(t)
  const { captureEngineContext, engineSession } = await import('../src/services/engine/session')
  const { loadContacts, saveContact, saveContactSettings, incompatibleContactIds } = await import('../src/services/casca/contacts')
  const { publishSlice } = await import('../src/services/casca/data')
  const { useStore } = await import('../src/data/store')
  const { fieldValueFits } = await import('../src/app/pages/contacts/lib')
  const context = captureEngineContext()
  publishSlice(context, await loadContacts(context))
  const base = { autoCapture: false, creationGate: '' }, settings = () => useStore.getState().db.contactSettings.find(s => s.orgId === f.tenant)!
  const contacts = () => useStore.getState().db.contacts.filter(c => c.orgId === f.tenant)
  await saveContactSettings({ ...base, smartFields: [{ id: 'draft', label: 'Convênio', type: 'text', description: '', aiFill: false }] })
  const field = settings().smartFields[0]!, stored = (id: string) => getContact(f.store, f.tenant, id).fieldValues[field.id]
  const a = await saveContact(person('A', { [field.id]: 'Unimed' })), b = await saveContact(person('B', { [field.id]: 'Plano antigo' })), c = await saveContact(person('C', { [field.id]: 'Bradesco' }))
  const next = { ...field, type: 'enum' as const, options: ['Unimed', 'Bradesco'] }
  const preview = () => incompatibleContactIds(next, contacts(), (def, value) => fieldValueFits(field, def, value))
  assert.deepEqual(preview(), [b.id])
  const journal = () => { const id = engineSession.getSnapshot().data!.identity.context; return [`kloel:casca:automatic-contacts:${id.userId}:${f.tenant}:${id.membershipId}:${id.authorityVersion}`, JSON.stringify({ context: id, pending: { stage: 'settings', expectedRevision: 0, hash: 'a'.repeat(64) } })] as const }

  // 1) Outra pessoa salvou as configurações antes (revisão antiga): PUT recusado, nenhum valor apagado.
  const now = getSettings(f.store, f.tenant)
  saveSettings(f.store, f.tenant, { ...base, definitions: now.definitions.map(({ revision: _r, ...d }) => d) }, now.revision, 'outra-pessoa')
  await assert.rejects(saveContactSettings({ ...base, smartFields: [next] }, [{ fieldId: field.id, contactIds: preview() }]))
  assert.equal(stored(b.id), 'Plano antigo'); assert.equal(getSettings(f.store, f.tenant).definitions[0]!.type, 'text')

  // 2) Falha antes do PUT (tentativa anterior não confirmada neste navegador): nada apagado.
  const [key, pending] = journal(); sessionStorage.setItem(key, pending)
  await assert.rejects(saveContactSettings({ ...base, smartFields: [next] }, [{ fieldId: field.id, contactIds: preview() }]))
  assert.equal(stored(b.id), 'Plano antigo'); sessionStorage.removeItem(key)

  // 3) C mudou no servidor depois da prévia (não listado): o motor recusa a troca de tipo e B continua salvo.
  const listed = preview(), row = getContact(f.store, f.tenant, c.id)
  f.store.update(f.tenant, 'contacts', c.id, { fieldValues: { [field.id]: 'Outro plano' }, revision: row.revision + 1 })
  await assert.rejects(saveContactSettings({ ...base, smartFields: [next] }, [{ fieldId: field.id, contactIds: listed }]), /não combina/)
  assert.equal(stored(b.id), 'Plano antigo'); assert.equal(getSettings(f.store, f.tenant).definitions[0]!.type, 'text')

  // 4) Aceita: um único PUT leva a limpeza; nenhuma chamada separada que apague antes.
  assert.deepEqual(preview().sort(), [b.id, c.id].sort())
  let sent = f.requests.length
  await saveContactSettings({ ...base, smartFields: [next] }, [{ fieldId: field.id, contactIds: preview() }])
  const choice = getSettings(f.store, f.tenant).definitions[0]!
  assert.equal(choice.type, 'choice'); assert.equal(stored(a.id), choice.options.find(o => o.label === 'Unimed')!.id); assert.equal(stored(b.id), undefined); assert.equal(stored(c.id), undefined)
  assert.equal(f.requests.slice(sent).filter(r => r.path === '/api/v1/crm/field-values/clear').length, 0)
  assert.deepEqual(f.requests.slice(sent).find(r => r.path === '/api/v1/crm/settings' && r.method === 'PUT')?.body.clear.map((item: any) => item.contactIds.sort()), [[b.id, c.id].sort()])

  // 5) Texto → número: a prévia da web marca exatamente o que o motor não converte ('007', '+5511999', '1 234', 'abc').
  await saveContactSettings({ ...base, smartFields: [settings().smartFields[0]!, { id: 'draft-age', label: 'Idade', type: 'text', description: '', aiFill: false }] })
  const age = settings().smartFields.find(s => s.label === 'Idade')!, ages = new Map<string, string>()
  for (const value of ['42', '1.500,5', '007', '+5511999', '1 234', 'abc']) ages.set(value, (await saveContact(person(`Idade ${value}`, { [age.id]: value }))).id)
  const toNumber = { ...age, type: 'number' as const }, incompatible = incompatibleContactIds(toNumber, contacts(), (def, value) => fieldValueFits(age, def, value))
  assert.deepEqual(incompatible.sort(), ['007', '+5511999', '1 234', 'abc'].map(v => ages.get(v)!).sort())
  await saveContactSettings({ ...base, smartFields: [settings().smartFields[0]!, toNumber] }, [{ fieldId: age.id, contactIds: incompatible }])
  const ageOf = (value: string) => getContact(f.store, f.tenant, ages.get(value)!).fieldValues[age.id]
  assert.equal(ageOf('42'), '42'); assert.equal(ageOf('1.500,5'), '1500.5'); for (const value of ['007', '+5511999', '1 234', 'abc']) assert.equal(ageOf(value), undefined)

  // 6) Sem mudança de configuração (opção já arquivada): só apaga depois de a gravação ser aceita.
  const d = await saveContact(person('D', { [field.id]: 'Bradesco' }))
  await saveContactSettings({ ...base, smartFields: [{ ...settings().smartFields.find(s => s.id === field.id)!, options: ['Unimed', 'Particular'] }, settings().smartFields.find(s => s.id === age.id)!] })
  assert.equal(stored(d.id), choice.options.find(o => o.label === 'Bradesco')!.id, 'sem "Apagar" o valor arquivado continua salvo')
  const same = settings(), current = same.smartFields.find(s => s.id === field.id)!
  const archived = incompatibleContactIds(current, contacts(), (def, value) => fieldValueFits(current, def, value))
  assert.deepEqual(archived, [d.id])
  sessionStorage.setItem(key, pending)
  await assert.rejects(saveContactSettings({ ...base, smartFields: same.smartFields }, [{ fieldId: field.id, contactIds: archived }]))
  assert.equal(stored(d.id), choice.options.find(o => o.label === 'Bradesco')!.id, 'gravação recusada: nada apagado'); sessionStorage.removeItem(key)
  sent = f.requests.length
  await saveContactSettings({ ...base, smartFields: same.smartFields }, [{ fieldId: field.id, contactIds: archived }])
  assert.equal(stored(d.id), undefined); assert.equal(stored(a.id), choice.options.find(o => o.label === 'Unimed')!.id)
  assert.equal(contacts().find(row => row.id === d.id)?.fields[field.id], undefined, 'lista recarregada')
  assert.equal(f.requests.slice(sent).filter(r => r.path === '/api/v1/crm/field-values/clear').length, 1)
})
