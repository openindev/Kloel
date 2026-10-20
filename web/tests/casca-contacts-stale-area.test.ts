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

test('Contatos: a carga de Conversas iniciada ao abrir um contato não desfaz edições, criações e exclusões feitas durante a leitura', async t => {
  const f = await fixture(t)
  const { loadArea, registerAreaLoader } = await import('../src/services/casca/data')
  const { saveContact, removeContacts } = await import('../src/services/casca/contacts')
  const { useStore } = await import('../src/data/store')
  const { loadContacts } = await import('../src/services/casca/contacts')
  const { loadConversations } = await import('../src/services/casca/conversations')
  // Mesmas leituras e o mesmo formato das áreas reais (loaders.ts), sem equipe/assistentes: a fixture não registra essas rotas.
  registerAreaLoader('contacts', loadContacts)
  registerAreaLoader('conversations', async context => { const [conversations, contacts] = await Promise.all([loadConversations(context), loadContacts(context)]); return { ...conversations, agents: [], ...contacts } })
  f.store.create(f.tenant, 'conversations', { subject: 'Retorno', channel: 'webchat', status: 'open' })
  await loadArea('contacts')
  const ana = await saveContact(person('Ana', '+5562991110021')), caio = await saveContact(person('Caio', '+5562991110022'))
  // /app/contacts aberto direto: db.conversations vazio, então abrir Ana dispara loadArea('conversations') (lenta).
  assert.equal(useStore.getState().db.conversations.length, 0)
  const slow = gate(f.app, conversationList), reads = () => f.requests.filter(r => r.path === '/api/v1/crm/contact-communication').length, before = reads()
  const background = loadArea('conversations')
  await until(() => slow.hits() > 0 && reads() > before); await new Promise(resolve => setTimeout(resolve, 30))
  // Enquanto as conversas ainda carregam, a pessoa edita Ana, cria Bia e exclui Caio.
  await saveContact({ ...person('Ana Paula', '+5562991110021') }, ana.id)
  const bia = await saveContact(person('Bia', '+5562991110023'))
  await removeContacts([caio.id])
  slow.release(); await background
  const rows = useStore.getState().db.contacts.filter(c => c.orgId === f.tenant)
  assert.equal(rows.find(c => c.id === ana.id)?.firstName, 'Ana Paula', 'a leitura antiga não desfaz a edição')
  assert.ok(rows.some(c => c.id === bia.id), 'a leitura antiga não apaga o contato criado')
  assert.ok(!rows.some(c => c.id === caio.id), 'a leitura antiga não ressuscita o contato excluído')
  assert.equal(useStore.getState().db.conversations.length, 1, 'as conversas (Atividades) continuam chegando')
  // O snapshot local também guarda a revisão mais nova: editar de novo não vira conflito de revisão.
  assert.equal((await saveContact({ ...person('Ana P.', '+5562991110021') }, ana.id)).firstName, 'Ana P.')
  // Edição entre a leitura da lista e a troca do snapshot: o snapshot novo mantém a revisão mais nova de Ana.
  const list = gate(f.app, url => url.startsWith('/api/v1/crm/contacts?')), reload = loadArea('contacts', true)
  await until(() => list.hits() > 0)
  await saveContact({ ...person('Ana Souza', '+5562991110021') }, ana.id)
  list.release(); await reload
  assert.equal(useStore.getState().db.contacts.find(c => c.id === ana.id)?.firstName, 'Ana Souza')
  assert.equal((await saveContact({ ...person('Ana Lima', '+5562991110021') }, ana.id)).firstName, 'Ana Lima', 'sem conflito de revisão')
})
