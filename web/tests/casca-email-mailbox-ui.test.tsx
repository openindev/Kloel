import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { emailFixture } from './engine-email-agents-fixture'

// The engine client binds fetch once per module graph: every test routes it to its own fixture engine.
let backend: typeof fetch = () => Promise.reject(Error('No fixture engine'))
const routed = ((input: string, init: RequestInit = {}) => backend(input, init)) as typeof fetch

/**
 * E-Mail IA de ponta a ponta na tela original: MessageDetail/FolderList/SettingsView → casca → cliente HTTP → motor real
 * (Fastify + Store) → Gmail simulado por fetch injetado. Nenhuma chamada externa real.
 */
test('E-Mail IA controls organize, reply, discard and disconnect a Gmail mailbox through the real engine', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4423/app/email-agents', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent']) if ((w as any)[name]) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  ;(w as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; (globalThis as any).ResizeObserver = (w as any).ResizeObserver
  ;(w.HTMLElement.prototype as any).scrollIntoView ??= () => {}; (w.HTMLElement.prototype as any).hasPointerCapture ??= () => false; (w.HTMLElement.prototype as any).releasePointerCapture ??= () => {}
  const f = await emailFixture(t, { organize: true }), originalFetch = globalThis.fetch
  backend = f.fetcher; globalThis.fetch = routed
  t.after(() => { globalThis.fetch = originalFetch })
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { MemoryRouter } = await import('react-router-dom'), { Toaster } = await import('sonner')
  const { useStore } = await import('../src/data/store'), { engineSession } = await import('../src/services/engine/session')
  const email = await import('../src/services/casca/email'), { MessageDetail, FolderList } = await import('../src/app/pages/email-agents/MailboxViews'), { SettingsView } = await import('../src/app/pages/email-agents/AssistantViews')
  const root = createRoot(w.document.getElementById('root')!), settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  const text = () => w.document.body.textContent ?? ''
  const button = (label: string) => { const found = [...w.document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label); assert.ok(found, 'Missing button ' + label); return found as HTMLButtonElement }
  const click = async (label: string, last = false) => { await React.act(async () => { const all = [...w.document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label); assert.ok(all.length, 'Missing ' + label); (last ? all.at(-1)! : all[0]!).click(); await settle() }); await React.act(async () => { await settle(120) }) }
  const writes = () => f.providerCalls.filter(c => c.method !== 'GET' && c.path !== '/v1/responses').map(c => c.path.split('/').at(-1))

  // The shared fixture seeds a raw knowledge row (not created through the knowledge API); this flow does not use it.
  const { mailboxConfig } = await import('../src/services/engine/email-agents'); await f.client.configure({ ...mailboxConfig(f.box!), knowledgeIds: [] }, f.box!)
  const { startEngineProjection } = await import('../src/services/casca/data'), stop = startEngineProjection(); t.after(() => stop())
  await React.act(async () => { await engineSession.refresh(); await settle(100) })
  assert.equal(engineSession.getSnapshot().phase, 'authenticated')
  await email.refreshEmail()
  await email.syncMailbox(useStore.getState().db.emailInboxes[0]!)
  const inbox = () => useStore.getState().db.emailInboxes[0]!
  assert.equal(inbox().engineEmail?.mailbox.canOrganize, true)
  const [first, second] = useStore.getState().db.emailMessages.filter(m => m.folder === 'inbox').sort((a, b) => a.subject.localeCompare(b.subject))
  assert.ok(first && second); assert.equal(first.read, false)
  let backs = 0
  function Detail({ id }: { id: string }) {
    const box = useStore(s => s.db.emailInboxes[0]), message = useStore(s => s.db.emailMessages.find(m => m.id === id))
    return box && message ? <MessageDetail key={id} inbox={box} message={message} canDraft canReply onBack={() => { backs++ }} onOpen={() => {}} /> : <p data-testid="gone">Mensagem fora da caixa</p>
  }
  const { TooltipProvider } = await import('../src/components/ui/tooltip')
  const show = async (node: React.ReactNode) => (await React.act(async () => { root.render(<MemoryRouter><TooltipProvider>{node}<Toaster /></TooltipProvider></MemoryRouter>); await settle(60) }), await React.act(async () => { await settle(150) }))

  // Abrir marca como lido no Gmail; "Marcar como não lido" devolve o rótulo UNREAD e volta para a lista.
  await show(<Detail id={first.id} />)
  assert.equal(first.subject, 'Pedido mail-1'); assert.deepEqual(f.labels.get('mail-1'), ['INBOX'])
  assert.equal(useStore.getState().db.emailMessages.find(m => m.id === first.id)!.read, true)
  assert.equal(button('Marcar como não lido').disabled, false)
  await click('Marcar como não lido')
  assert.deepEqual(f.labels.get('mail-1'), ['INBOX', 'UNREAD']); assert.equal(useStore.getState().db.emailMessages.find(m => m.id === first.id)!.read, false); assert.equal(backs, 1)
  assert.match(text(), /Marcado como não lido/)

  // Resposta manual: vira rascunho revisado no motor e é enviada pelo Gmail.
  await click('Responder manualmente')
  await React.act(async () => { const area = w.document.querySelector('textarea[aria-label="Texto da resposta"]') as HTMLTextAreaElement; Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'Olá! Seguimos com o seu pedido.'); area.dispatchEvent(new w.Event('input', { bubbles: true })); await settle() })
  await click('Enviar'); await React.act(async () => { await settle(200) })
  assert.ok(writes().includes('send'), 'manual reply was sent through Gmail')
  assert.match(text(), /Resposta aceita pelo provedor/)
  assert.equal(useStore.getState().db.emailMessages.find(m => m.id === first.id)!.status, 'replied')

  // Rascunho da IA descartado no motor (não volta ao recarregar).
  await show(<Detail id={second.id} />)
  await click('Gerar rascunho com IA'); await React.act(async () => { await settle(200) })
  assert.ok(w.document.querySelector('[data-testid="composer"]'))
  const drafted = useStore.getState().db.emailMessages.find(m => m.id === second.id)!; assert.ok(drafted.engineEmail?.draft)
  await click('Descartar')
  assert.equal(w.document.querySelector('[data-testid="composer"]'), null); assert.match(text(), /Rascunho descartado/)
  assert.deepEqual((await f.client.drafts(inbox().id)).filter(d => d.messageId === second.id), [])
  await email.refreshEmail(); assert.equal(useStore.getState().db.emailMessages.find(m => m.id === second.id)!.aiDraft, undefined)

  // Arquivar remove só o rótulo INBOX; Excluir move para a lixeira do Gmail após confirmação.
  await show(<Detail id={second.id} />)
  await click('Arquivar e-mail')
  assert.deepEqual(f.labels.get('mail-2'), []); assert.ok(w.document.querySelector('[data-testid="gone"]'))
  await email.refreshEmail()
  const remaining = useStore.getState().db.emailMessages.find(m => m.id === first.id)!
  await show(<Detail id={remaining.id} />)
  await click('Excluir e-mail')
  assert.match(text(), /lixeira do Gmail/)
  await click('Excluir', true)
  assert.deepEqual(f.labels.get('mail-1'), ['TRASH']); assert.match(text(), /E-mail movido para a lixeira/)
  assert.equal(useStore.getState().db.emailMessages.filter(m => m.folder === 'inbox').length, 0)
  // lido(1) · não lido(1) · lido(2) · arquivar(2) · lido(1, reaberto) · lixeira(1)
  assert.deepEqual(writes().filter(w => w !== 'send'), ['modify', 'modify', 'modify', 'modify', 'modify', 'trash'])

  // Conexão antiga (só leitura/envio): aviso honesto com "Reconectar caixa" e nenhuma escrita no provedor.
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { scopes: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send' })
  f.labels.clear(); await f.client.resetSync(inbox().id); await email.refreshEmail(); await email.syncMailbox(inbox())
  assert.equal(inbox().engineEmail?.mailbox.canOrganize, false); assert.equal(inbox().engineEmail?.mailbox.organizeOnReconnect, true)
  await show(<FolderList inbox={inbox()} folder="inbox" messages={useStore.getState().db.emailMessages} q="" filters={[]} onFiltersChange={() => {}} onClearSearch={() => {}} onOpen={() => {}} />)
  assert.ok(w.document.querySelector('[data-testid="email-organize-notice"]')); assert.match(text(), /Reconecte a caixa/); assert.ok(button('Reconectar caixa'))
  const before = writes().length, legacy = useStore.getState().db.emailMessages.find(m => m.folder === 'inbox')!
  await show(<Detail id={legacy.id} />)
  assert.equal(button('Arquivar e-mail').disabled, true); assert.equal(button('Excluir e-mail').disabled, true)
  await assert.rejects(email.trashMail(inbox(), legacy), /Reconecte a caixa/)
  assert.equal(writes().length, before)

  // Desativar e reativar o agente desta caixa (Configurações → "Ativar agente de e-mail").
  let activations = 0
  function Settings() { const box = useStore(s => s.db.emailInboxes[0]); return box ? <SettingsView inbox={box} onRequestActivate={() => { activations++ }} onDisconnected={() => {}} /> : null }
  await show(<Settings />)
  await React.act(async () => { (w.document.querySelector('[role="switch"][aria-label="Ativar agente de e-mail"]') as HTMLButtonElement).click(); await settle(200) })
  await React.act(async () => { await settle(150) })
  assert.match(text(), /Agente de e-mail desativado/); assert.equal(f.store.get(f.actor.tenantId, 'email-mailboxes', inbox().id)!.enabled, false); assert.equal(inbox().agentEnabled, false)
  await React.act(async () => { (w.document.querySelector('[role="switch"][aria-label="Ativar agente de e-mail"]') as HTMLButtonElement).click(); await settle() })
  assert.equal(activations, 1, 'turning on goes through the page activation (plan gate + capacity)')
  await email.activateEmail(inbox().id); assert.equal(f.store.get(f.actor.tenantId, 'email-mailboxes', inbox().id)!.enabled, true); assert.equal(inbox().agentEnabled, true)

  // Desconectar caixa em Configurações: remove a caixa do E-Mail IA e a conexão só de e-mail.
  await show(<SettingsView inbox={inbox()} onRequestActivate={() => {}} onDisconnected={() => { backs = -1 }} />)
  await click('Desconectar caixa de entrada')
  assert.match(text(), /Nada é apagado no Gmail/)
  await click('Desconectar', true)
  assert.equal(backs, -1); assert.equal(useStore.getState().db.emailInboxes.length, 0); assert.equal(useStore.getState().db.emailMessages.length, 0)
  assert.equal(f.store.get(f.actor.tenantId, 'oauth-connections', f.connection.id)!.status, 'disconnected')
  assert.equal(writes().length, before, 'disconnect never deletes anything at the provider')
})

test('activating the email agent creates its assistant and binds the connected mailbox (no rejected default settings)', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4423/app/email-agents', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  const f = await emailFixture(t, { empty: true, organize: true }), originalFetch = globalThis.fetch
  backend = f.fetcher; globalThis.fetch = routed
  t.after(() => { globalThis.fetch = originalFetch; dom.window.close() })
  const { useStore } = await import('../src/data/store'), { engineSession } = await import('../src/services/engine/session'), email = await import('../src/services/casca/email')
  await engineSession.refresh(); await email.refreshEmail()
  const inbox = useStore.getState().db.emailInboxes[0]!; assert.equal(inbox.engineEmail, undefined); assert.equal(inbox.agentEnabled, false)
  const id = await email.activateEmail(inbox.id)
  const box = f.store.get(f.actor.tenantId, 'email-mailboxes', id)!; assert.equal(box.enabled, true); assert.equal(box.connectionId, f.connection.id)
  const agent = f.store.get(f.actor.tenantId, 'agents', String(box.agentId))!; assert.equal(agent.name, 'Agente de e-mail')
  assert.equal(useStore.getState().db.emailInboxes[0]!.agentEnabled, true); assert.equal(useStore.getState().db.emailInboxes[0]!.engineEmail?.mailbox.canOrganize, true)
})
