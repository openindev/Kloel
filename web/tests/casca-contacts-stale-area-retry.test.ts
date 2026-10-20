import test from 'node:test'
import assert from 'node:assert/strict'
import { contactsConversationsFixture as fixture } from './engine-contacts-conversations-fixture'

/** Holds the engine responses whose URL matches until release(): the slow "Atividades" load of an org with many conversations (data read at T0, delivered later). */
function gate(app: any, match: (url: string) => boolean) {
  const inject = app.inject.bind(app); let open!: () => void, active = true, hits = 0
  const opened = new Promise<void>(resolve => { open = resolve })
  app.inject = async (options: any) => { const response = await inject(options); if (active && match(String(options.url))) { hits++; await opened } return response }
  return { release() { active = false; open() }, hits: () => hits }
}
const until = async (ok: () => boolean) => { for (let i = 0; i < 600 && !ok(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(ok(), 'condition not reached') }
const person = (firstName: string, phone: string) => ({ firstName, lastName: '', phones: [{ value: phone, label: '' as const }], emails: [], company: '', notes: '', fields: {} })
const conversationList = (url: string) => /^\/api\/v1\/conversations(\?|$)/.test(url)

test('Contatos: fatia nunca carregada por inteiro e gravada durante a leitura é lida de novo (não fica parcial nem antiga)', async t => {
  const f = await fixture(t)
  const { loadArea, registerAreaLoader } = await import('../src/services/casca/data')
  const { saveContact, linkConversationToContact } = await import('../src/services/casca/contacts')
  const { useStore } = await import('../src/data/store')
  const { loadContacts } = await import('../src/services/casca/contacts')
  const { loadConversations } = await import('../src/services/casca/conversations')
  // Mesmas leituras e o mesmo formato das áreas reais (loaders.ts), sem equipe/assistentes: a fixture não registra essas rotas.
  registerAreaLoader('contacts', loadContacts)
  registerAreaLoader('conversations', async context => { const [conversations, contacts] = await Promise.all([loadConversations(context), loadContacts(context)]); return { ...conversations, agents: [], ...contacts } })
  const first = f.store.create(f.tenant, 'conversations', { subject: 'Primeira', channel: 'webchat', status: 'open' })
  f.store.create(f.tenant, 'conversations', { subject: 'Segunda', channel: 'webchat', status: 'open' })
  await loadArea('contacts')
  const ana = await saveContact(person('Ana', '+5562991110031'))
  const slow = gate(f.app, conversationList)
  const background = loadArea('conversations')
  await until(() => slow.hits() > 0)
  // Vínculo gravado com db.conversations ainda vazio: a fatia publicada é parcial; a carga precisa reler.
  await linkConversationToContact(ana.id, first.id)
  slow.release(); await background
  const conversations = useStore.getState().db.conversations
  assert.equal(conversations.length, 2, 'lista completa, não a parcial')
  assert.equal(conversations.find(c => c.id === first.id)?.contactId, ana.id, 'e com o vínculo gravado durante a leitura')
})
