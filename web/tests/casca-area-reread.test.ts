import test from 'node:test'
import assert from 'node:assert/strict'
import { contactsConversationsFixture as fixture } from './engine-contacts-conversations-fixture'

/** Holds the n-th engine response whose URL matches (1-based) until release(): one slow read of the area (data taken at T0, delivered later). */
function holdNth(app: any, match: (url: string) => boolean, nth: number) {
  const inject = app.inject.bind(app); let open!: () => void, seen = 0, held = false
  const opened = new Promise<void>(resolve => { open = resolve })
  app.inject = async (options: any) => { const response = await inject(options); if (match(String(options.url)) && ++seen === nth) { held = true; await opened } return response }
  return { release() { open() }, held: () => held }
}
/** The n-th matching response fails (500): a re-read that does not come back. */
function failNth(app: any, match: (url: string) => boolean, nth: number) {
  const inject = app.inject.bind(app); let seen = 0
  app.inject = async (options: any) => { const response = await inject(options); return match(String(options.url)) && ++seen === nth ? { ...response, statusCode: 500, body: JSON.stringify({ error: 'internal', message: 'Falha sintética.' }), json: () => ({ error: 'internal' }) } : response }
}
const until = async (ok: () => boolean) => { for (let i = 0; i < 600 && !ok(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(ok(), 'condition not reached') }
const person = (firstName: string, phone: string) => ({ firstName, lastName: '', phones: [{ value: phone, label: '' as const }], emails: [], company: '', notes: '', fields: {} })
const conversationList = (url: string) => /^\/api\/v1\/conversations(\?|$)/.test(url)

test('Áreas: releitura que falha não descarta a leitura válida; fatia parcial gravada também durante a releitura é lida de novo', async t => {
  const f = await fixture(t)
  const { loadArea, registerAreaLoader, sliceLoaded } = await import('../src/services/casca/data')
  const { saveContact, linkConversationToContact, loadContacts } = await import('../src/services/casca/contacts')
  const { useStore } = await import('../src/data/store')
  const { loadConversations } = await import('../src/services/casca/conversations')
  // Mesmas leituras e o mesmo formato das áreas reais (loaders.ts), sem equipe/assistentes: a fixture não registra essas rotas.
  registerAreaLoader('contacts', loadContacts)
  registerAreaLoader('conversations', async context => { const [conversations, contacts] = await Promise.all([loadConversations(context), loadContacts(context)]); return { ...conversations, agents: [], ...contacts } })
  const [first, second, third] = ['Primeira', 'Segunda', 'Terceira'].map(subject => f.store.create(f.tenant, 'conversations', { subject, channel: 'webchat', status: 'open' }))
  await loadArea('contacts')
  const ana = await saveContact(person('Ana', '+5562991110041')), bia = await saveContact(person('Bia', '+5562991110042')), caio = await saveContact(person('Caio', '+5562991110043'))
  assert.equal(useStore.getState().db.conversations.length, 0)

  // 1) Vínculo com db.conversations ainda vazio pede releitura; a releitura falha: a área não rejeita e a 1ª leitura (válida) é publicada.
  const held = holdNth(f.app, conversationList, 1); failNth(f.app, conversationList, 2)
  const opening = loadArea('conversations')
  await until(held.held)
  await linkConversationToContact(ana.id, first!.id)
  held.release()
  await opening // antes: a área inteira rejeitava ("Não foi possível carregar…") embora a 1ª leitura tivesse vindo
  assert.ok(sliceLoaded('tags'), 'as etiquetas da 1ª leitura foram publicadas')
  assert.equal(sliceLoaded('conversations'), false, 'a lista de conversas segue parcial e não é dada como carregada (Contatos tenta de novo)')

  // 2) Gravação durante a 1ª leitura e outra durante a releitura: a área lê de novo e chega inteira, com os dois vínculos.
  const one = holdNth(f.app, conversationList, 1), two = holdNth(f.app, conversationList, 2)
  const background = loadArea('conversations')
  await until(one.held)
  await linkConversationToContact(bia.id, second!.id)
  one.release(); await until(two.held)
  await linkConversationToContact(caio.id, third!.id)
  two.release(); await background
  const conversations = useStore.getState().db.conversations
  assert.equal(conversations.length, 3, 'lista completa, não a parcial')
  assert.deepEqual([first, second, third].map(c => conversations.find(row => row.id === c!.id)?.contactId), [ana.id, bia.id, caio.id])
  assert.ok(sliceLoaded('conversations'))
})
