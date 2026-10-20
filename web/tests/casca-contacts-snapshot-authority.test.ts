import test from 'node:test'
import assert from 'node:assert/strict'
import { deleteContact, getContact, getSettings, updateContact } from '../../engine/src/crm/service'
import { contactsConversationsFixture as fixture } from './engine-contacts-conversations-fixture'

/** Holds the first `limit` engine responses that match until release() (a slow read: data taken at T0, delivered later); later matches pass. */
function hold(app: any, match: (url: string, method: string) => boolean, limit = 1) {
  const inject = app.inject.bind(app); let open!: () => void, hits = 0
  const opened = new Promise<void>(resolve => { open = resolve })
  app.inject = async (options: any) => { const response = await inject(options); if (hits < limit && match(String(options.url), String(options.method ?? 'GET'))) { hits++; await opened } return response }
  return { release() { open() }, hits: () => hits }
}
const until = async (ok: () => boolean) => { for (let i = 0; i < 600 && !ok(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(ok(), 'condition not reached') }
const person = (firstName: string, phone: string, fields: Record<string, string> = {}) => ({ firstName, lastName: '', phones: [{ value: phone, label: '' as const }], emails: [], company: '', notes: '', fields })
const contactList = (url: string) => url.startsWith('/api/v1/crm/contacts?')

async function setup(t: any) {
  const f = await fixture(t)
  const { loadArea, registerAreaLoader } = await import('../src/services/casca/data')
  const contacts = await import('../src/services/casca/contacts')
  const { useStore } = await import('../src/data/store')
  const { captureEngineContext } = await import('../src/services/engine/session')
  const { loadConversations } = await import('../src/services/casca/conversations')
  // Mesmas leituras e o mesmo formato das áreas reais (loaders.ts), sem equipe/assistentes: a fixture não registra essas rotas.
  registerAreaLoader('contacts', contacts.loadContacts)
  registerAreaLoader('conversations', async context => { const [conversations, c] = await Promise.all([loadConversations(context), contacts.loadContacts(context)]); return { ...conversations, agents: [], ...c } })
  f.store.create(f.tenant, 'conversations', { subject: 'Retorno', channel: 'webchat', status: 'open' })
  await loadArea('contacts')
  return { f, loadArea, ...contacts, useStore, captureEngineContext }
}

test('Contatos: o snapshot que monta os salvamentos não volta atrás por causa de uma leitura antiga (configurações, edições, criações e exclusões)', async t => {
  const { f, loadArea, saveContact, saveContactSettings, removeContacts, loadContacts, recordContactPermission, useStore, captureEngineContext } = await setup(t)
  // 1) Configurações salvas durante a carga de Conversas valem para o próximo salvamento: o valor digitado no campo novo não some.
  const ana = await saveContact(person('Ana', '+5562991110051'))
  const list = hold(f.app, contactList), background = loadArea('conversations')
  await until(() => list.hits() > 0)
  await saveContactSettings({ autoCapture: false, creationGate: '', smartFields: [{ id: 'draft', label: 'Idade', type: 'text', description: '', aiFill: false }] })
  list.release(); await background
  const idade = useStore.getState().db.contactSettings.find(s => s.orgId === f.tenant)!.smartFields.find(s => s.label === 'Idade')
  assert.ok(idade, 'a tela mostra o campo novo')
  assert.equal((await saveContact(person('Ana', '+5562991110051', { [idade!.id]: '42' }), ana.id)).fields[idade!.id], '42')
  assert.equal(getContact(f.store, f.tenant, ana.id).fieldValues[idade!.id], '42', 'o motor recebeu o valor do campo novo')
  // A próxima alteração das configurações parte da revisão atual (sem "O recurso mudou").
  const shown = useStore.getState().db.contactSettings.find(s => s.orgId === f.tenant)!
  await saveContactSettings({ autoCapture: false, creationGate: '', smartFields: shown.smartFields.map(s => ({ ...s, description: 'Anos completos' })) })
  assert.equal(getSettings(f.store, f.tenant).definitions.find(d => d.id === idade!.id)?.description, 'Anos completos')

  // 2) Edição cuja resposta chega depois que uma carga de fundo trocou o snapshot: a revisão nova fica (a próxima edição não vira conflito).
  const again = hold(f.app, contactList), refresh = loadArea('conversations', true)
  await until(() => again.hits() > 0)
  const patch = hold(f.app, (url, method) => method === 'PATCH' && url.startsWith(`/api/v1/crm/contacts/${ana.id}`))
  const edit = saveContact(person('Ana Paula', '+5562991110051'), ana.id)
  await until(() => patch.hits() > 0)
  again.release(); await refresh
  patch.release(); await edit
  assert.equal(useStore.getState().db.contacts.find(c => c.id === ana.id)?.firstName, 'Ana Paula')
  assert.equal((await saveContact(person('Ana Lima', '+5562991110051'), ana.id)).firstName, 'Ana Lima', 'sem "O recurso mudou"')

  // 3) Recarga direta segurada depois da última página (entre ler as linhas e instalar o snapshot): edição, criação e exclusão feitas nela ficam.
  const caio = await saveContact(person('Caio', '+5562991110072'))
  const policy = hold(f.app, url => url.startsWith('/api/v1/crm/capture/policy')), read = loadContacts(captureEngineContext())
  await until(() => policy.hits() > 0)
  await saveContact(person('Ana Paula', '+5562991110051'), ana.id)
  const bia = await saveContact(person('Bia', '+5562991110073'))
  await removeContacts([caio.id])
  policy.release()
  await read
  const shownRows = useStore.getState().db.contacts.filter(c => c.orgId === f.tenant), ids = shownRows.map(c => c.id)
  assert.equal(shownRows.find(c => c.id === ana.id)?.firstName, 'Ana Paula', 'a leitura antiga não desfaz a edição')
  assert.ok(ids.includes(bia.id), 'nem esquece o contato criado')
  assert.ok(!ids.includes(caio.id), 'nem ressuscita o contato excluído')
  assert.equal((await saveContact(person('Bia Souza', '+5562991110073'), bia.id)).firstName, 'Bia Souza', 'o contato criado continua editável')
  await assert.rejects(removeContacts([caio.id]), /Atualize a lista/)

  // 4) Registrar consentimento recarrega a lista: uma edição de outro contato feita durante essa recarga continua na tela e no snapshot.
  const comm = hold(f.app, (url, method) => method === 'GET' && url === '/api/v1/crm/contact-communication')
  const consent = recordContactPermission(ana.id, { channel: 'whatsapp', identifier: '+5562991110051', purpose: 'service', event: 'granted', occurredAt: new Date(Date.now() - 60000).toISOString(), source: 'Pediu lembretes pelo WhatsApp.' })
  await until(() => comm.hits() > 0)
  await saveContact(person('Bia Lima', '+5562991110073'), bia.id)
  comm.release(); await consent
  assert.equal(useStore.getState().db.contacts.find(c => c.id === bia.id)?.firstName, 'Bia Lima', 'a recarga não desfaz a edição feita enquanto ela lia')
  assert.equal((await saveContact(person('Bia Maria', '+5562991110073'), bia.id)).firstName, 'Bia Maria')
  assert.equal((await saveContact(person('Ana Maria', '+5562991110051'), ana.id)).firstName, 'Ana Maria', 'a revisão nova de Ana (consentimento) chegou ao snapshot')

  // 5) Recarga direta que termina depois de uma leitura iniciada após ela (outra sessão editou e excluiu no meio): a leitura mais nova fica.
  const dani = await saveContact(person('Dani', '+5562991110074'))
  const late = hold(f.app, contactList)
  const consentAgain = recordContactPermission(bia.id, { channel: 'whatsapp', identifier: '+5562991110073', purpose: 'service', event: 'granted', occurredAt: new Date(Date.now() - 60000).toISOString(), source: 'Pediu lembretes pelo WhatsApp.' })
  await until(() => late.hits() > 0)
  const external = getContact(f.store, f.tenant, ana.id)
  updateContact(f.store, f.tenant, ana.id, { company: 'Clínica Externa' }, external.revision, 'outra-sessao')
  deleteContact(f.store, f.tenant, dani.id, getContact(f.store, f.tenant, dani.id).revision, 'outra-sessao')
  await loadArea('contacts', true)
  late.release(); await consentAgain
  const rows = useStore.getState().db.contacts.filter(c => c.orgId === f.tenant)
  assert.equal(rows.find(c => c.id === ana.id)?.company, 'Clínica Externa', 'a recarga mais antiga não troca a leitura mais nova na tela')
  assert.ok(!rows.some(c => c.id === dani.id), 'nem ressuscita na tela o contato excluído em outra sessão')
  await assert.rejects(removeContacts([dani.id]), /Atualize a lista/, 'nem no snapshot')
  assert.equal((await saveContact({ ...person('Ana Maria', '+5562991110051'), company: 'Clínica Externa' }, ana.id)).company, 'Clínica Externa')
})
