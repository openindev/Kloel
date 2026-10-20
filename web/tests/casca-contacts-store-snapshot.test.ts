import test from 'node:test'
import assert from 'node:assert/strict'
import { getContact, updateContact } from '../../engine/src/crm/service'
import { contactsConversationsFixture as fixture } from './engine-contacts-conversations-fixture'

/** Holds the first `limit` engine responses that match until release() (a slow read: data taken at T0, delivered later); later matches pass. */
function hold(app: any, match: (url: string, method: string) => boolean, limit = 1) {
  const inject = app.inject.bind(app); let open!: () => void, hits = 0
  const opened = new Promise<void>(resolve => { open = resolve })
  app.inject = async (options: any) => { const response = await inject(options); if (hits < limit && match(String(options.url), String(options.method ?? 'GET'))) { hits++; await opened } return response }
  return { release() { open() }, hits: () => hits }
}
/** The next `count` responses that match fail with 500 (a read that does not come back). */
function fail(app: any, match: (url: string, method: string) => boolean, count = 1) {
  const inject = app.inject.bind(app); let left = count
  app.inject = async (options: any) => { const response = await inject(options); return left > 0 && match(String(options.url), String(options.method ?? 'GET')) && left-- ? { ...response, statusCode: 500, body: JSON.stringify({ error: 'internal', message: 'Falha sintética.' }), json: () => ({ error: 'internal' }) } : response }
}
const until = async (ok: () => boolean) => { for (let i = 0; i < 600 && !ok(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(ok(), 'condition not reached') }
const pause = () => new Promise(resolve => setTimeout(resolve, 30))
const person = (firstName: string, phone: string, company = '') => ({ firstName, lastName: '', phones: [{ value: phone, label: '' as const }], emails: [], company, notes: '', fields: {} })
const conversationList = (url: string) => /^\/api\/v1\/conversations(\?|$)/.test(url)
const contactList = (url: string) => url.startsWith('/api/v1/crm/contacts?')
const communication = (url: string, method: string) => method === 'GET' && url === '/api/v1/crm/contact-communication'

test('Contatos: a tela mostra o mesmo snapshot que dá a revisão do salvamento — dado mais novo do servidor nunca é desfeito em silêncio', async t => {
  const f = await fixture(t)
  const { loadArea, registerAreaLoader } = await import('../src/services/casca/data')
  const contacts = await import('../src/services/casca/contacts')
  const { saveContact, saveContactSettings, setContactCommunication } = contacts
  const { useStore } = await import('../src/data/store')
  const { loadConversations } = await import('../src/services/casca/conversations')
  const { draftFrom, cleanDraft } = await import('../src/app/pages/contacts/ContactForm')
  // Mesmas leituras e o mesmo formato das áreas reais (loaders.ts), sem equipe/assistentes: a fixture não registra essas rotas.
  registerAreaLoader('contacts', contacts.loadContacts)
  registerAreaLoader('conversations', async context => { const [conversations, c] = await Promise.all([loadConversations(context), contacts.loadContacts(context)]); return { ...conversations, agents: [], ...c } })
  f.store.create(f.tenant, 'conversations', { subject: 'Retorno', channel: 'webchat', status: 'open' })
  await loadArea('contacts')
  await saveContactSettings({ autoCapture: false, creationGate: '', smartFields: [{ id: 'draft', label: 'Convênio', type: 'text', description: '', aiFill: false }] })
  const plan = useStore.getState().db.contactSettings.find(s => s.orgId === f.tenant)!.smartFields.find(s => s.label === 'Convênio')!.id
  const shown = (id: string) => useStore.getState().db.contacts.find(c => c.id === id)!
  /** O que a pessoa salva ao abrir o formulário do contato que está na tela e mudar só as notas. */
  const editNotes = (id: string, notes: string) => saveContact({ ...cleanDraft(draftFrom(shown(id))), notes }, id)
  const external = (id: string, patch: Record<string, unknown>) => updateContact(f.store, f.tenant, id, patch, getContact(f.store, f.tenant, id).revision, 'outra-sessao')
  const xavier = await saveContact(person('Xavier', '+5562991110081', 'Empresa A')), ze = await saveContact(person('Zé', '+5562991110082')), yara = await saveContact(person('Yara', '+5562991110083'))

  // 1) Outra sessão muda Xavier; abrir Zé carrega Conversas (lista lenta) e Zé é editado enquanto as Atividades carregam.
  external(xavier.id, { company: 'Empresa B', fieldValues: { [plan]: 'Unimed' } })
  const slow = hold(f.app, conversationList), reads = () => f.requests.filter(r => r.path === '/api/v1/crm/contact-communication').length, before = reads()
  const background = loadArea('conversations')
  await until(() => slow.hits() > 0 && reads() > before); await pause() // a lista de contatos da área já foi lida (Xavier novo)
  await saveContact(person('Zeca', '+5562991110082'), ze.id)
  slow.release(); await background
  assert.equal(shown(xavier.id).company, 'Empresa B', 'a tela mostra o Xavier que o snapshot (revisão do salvamento) já tem')
  assert.equal(shown(xavier.id).fields[plan], 'Unimed')
  assert.equal(shown(ze.id).firstName, 'Zeca', 'e a edição feita durante a carga continua na tela')
  await editNotes(xavier.id, 'Ligar amanhã')
  assert.deepEqual([getContact(f.store, f.tenant, xavier.id).company, getContact(f.store, f.tenant, xavier.id).fieldValues[plan], getContact(f.store, f.tenant, xavier.id).notes], ['Empresa B', 'Unimed', 'Ligar amanhã'], 'editar as notas não desfaz a empresa nem o convênio gravados pela outra sessão')

  // 2) Outra sessão muda Xavier de novo; Bloquear Yara (e a recarga que ela fizer) termina depois de Zé ser salvo.
  external(xavier.id, { company: 'Empresa C' })
  const list = hold(f.app, (url, method) => method === 'GET' && contactList(url))
  let settled = false
  const block = setContactCommunication(yara.id, { blocked: true }).finally(() => { settled = true })
  await until(() => list.hits() > 0 || settled)
  await saveContact(person('Zeca Lima', '+5562991110082'), ze.id)
  list.release(); await block
  assert.equal(shown(yara.id).blocked, true)
  // O que a tela mostra de Xavier e a revisão usada no salvamento são o mesmo dado: ou a tela já tem "Empresa C", ou o motor recusa a edição.
  const outcome = await editNotes(xavier.id, 'Retornar sexta').then(() => 'salvo', (error: unknown) => error instanceof Error ? error.message : String(error))
  assert.equal(getContact(f.store, f.tenant, xavier.id).company, 'Empresa C', `a edição a partir da tela não desfaz a empresa gravada pela outra sessão (${outcome})`)
  if (outcome !== 'salvo') {
    await loadArea('contacts', true)
    await editNotes(xavier.id, 'Retornar sexta')
  }
  assert.deepEqual([getContact(f.store, f.tenant, xavier.id).company, getContact(f.store, f.tenant, xavier.id).notes], ['Empresa C', 'Retornar sexta'])

  // 3) WhatsApp IA ligado durante uma recarga iniciada antes (os interruptores dela foram lidos antes do clique): a recarga não o desliga na tela.
  const again = hold(f.app, communication), reload = loadArea('contacts', true)
  await until(() => again.hits() > 0)
  await setContactCommunication(ze.id, { whatsappAi: true })
  again.release(); await reload
  assert.equal(shown(ze.id).whatsappAi, true, 'a recarga antiga não desfaz o interruptor ligado durante ela')
  assert.equal(shown(yara.id).blocked, true)
  assert.equal(f.store.list(f.tenant, 'contact-communication').find(r => r.contactId === ze.id)?.whatsappAi, true)

  // 4) Recarga cuja leitura dos interruptores falha: não chuta "desligado" por cima do que já foi confirmado.
  fail(f.app, communication)
  await loadArea('contacts', true)
  assert.equal(shown(yara.id).blocked, true)
  assert.equal(shown(ze.id).whatsappAi, true)
})
