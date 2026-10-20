import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { emailFixture } from './engine-email-agents-fixture'
import { oauthAuthorizationGeneration, oauthAuthorizationIdentity } from '../../engine/src/oauth/access'
import { activateAutomation, resolveAutomation } from '../../engine/src/email-automation/authority'
import { digest } from '../../engine/src/oauth/crypto'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { randomUUID } from 'node:crypto'

// The engine client binds fetch once per module graph: every test routes it to its own fixture engine (+ simulated provider).
let backend: typeof fetch = () => Promise.reject(Error('No fixture engine'))
const routed = ((input: string, init: RequestInit = {}) => backend(input, init)) as typeof fetch

const LEGACY = {
  google: 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/spreadsheets',
  microsoft: 'offline_access User.Read Calendars.ReadWrite Mail.Read Mail.Send',
}

/**
 * "Reconectar caixa" no E-Mail IA (caixa conectada só com leitura/envio): a mesma conta também serve a Agenda de uma página de
 * agendamento publicada e uma automação de e-mail ativa. A tela pede confirmação dizendo o que continua funcionando, reautoriza
 * o mesmo provedor com todas as permissões que a conexão já tem e nada é revogado. Tela original → casca → cliente HTTP →
 * motor real (Fastify + Store) → provedor OAuth simulado por fetch injetado. Nenhuma chamada externa real.
 */
type Mode = 'same' | 'other' | 'colleague' | 'renamed'
async function scenario(t: any, provider: 'google' | 'microsoft', mode: Mode = 'same') {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4423/app/email-agents', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent']) if ((w as any)[name]) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  ;(w as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; (globalThis as any).ResizeObserver = (w as any).ResizeObserver
  ;(w.HTMLElement.prototype as any).scrollIntoView ??= () => {}; (w.HTMLElement.prototype as any).hasPointerCapture ??= () => false; (w.HTMLElement.prototype as any).releasePointerCapture ??= () => {}
  const env = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID', 'PUBLIC_BASE_URL'], previous = Object.fromEntries(env.map(n => [n, process.env[n]]))
  for (const n of env) delete process.env[n]
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'google-test', GOOGLE_CLIENT_SECRET: 'test-google-secret', MICROSOFT_CLIENT_ID: 'microsoft-test', MICROSOFT_CLIENT_SECRET: 'test-microsoft-secret' })
  t.after(() => { for (const [n, v] of Object.entries(previous)) if (v === undefined) delete process.env[n]; else process.env[n] = v })
  const f = await emailFixture(t, { provider }), originalFetch = globalThis.fetch, tenant = f.actor.tenantId
  // Simulated provider: token endpoint returns previously granted + requested scopes (Google include_granted_scopes); same account identity.
  let requestedScopes = ''
  backend = (async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    if (url === 'https://oauth2.googleapis.com/token' || /^https:\/\/login\.microsoftonline\.com\/[^/]+\/oauth2\/v2\.0\/token$/.test(url)) return Response.json({ access_token: 'fixture-provider-token-2', refresh_token: 'fixture-refresh-2', token_type: 'Bearer', expires_in: 3600, scope: provider === 'google' ? `${LEGACY.google} ${requestedScopes}` : requestedScopes })
    // Modo 'other': o provedor entra com OUTRA conta já conectada pela mesma pessoa (sessão do navegador).
    // Modo 'renamed': a MESMA conta, mas o endereço principal mudou no provedor (Workspace renomeou o usuário).
    const who = mode === 'other' ? { id: 'fixture-provider-other', mail: 'agenda@example.test' } : { id: 'fixture-provider-owner', mail: mode === 'renamed' ? 'atendimento@example.test' : 'inbox@example.test' }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: who.id, email: who.mail })
    if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) return Response.json({ id: who.id, mail: who.mail, displayName: 'Atendimento' })
    return f.fetcher(input, init)
  }) as typeof fetch
  globalThis.fetch = routed
  t.after(() => { globalThis.fetch = originalFetch })
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { MemoryRouter } = await import('react-router-dom'), { Toaster } = await import('sonner')
  const { useStore } = await import('../src/data/store'), { engineSession } = await import('../src/services/engine/session'), { TooltipProvider } = await import('../src/components/ui/tooltip')
  const email = await import('../src/services/casca/email'), { FolderList } = await import('../src/app/pages/email-agents/MailboxViews'), { mailboxConfig } = await import('../src/services/engine/email-agents')
  const root = createRoot(w.document.getElementById('root')!), settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  const text = () => w.document.body.textContent ?? ''
  const buttons = (label: string) => [...w.document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)

  // Same connection: Agenda (+ Planilhas) + E-mail, authorized before gmail.modify / Mail.ReadWrite existed.
  const capabilities = mode === 'other' ? ['email', 'email_send'] : provider === 'google' ? ['calendar', 'calendar_write', 'email', 'email_send', 'sheets_read', 'sheets_append'] : ['calendar', 'calendar_write', 'email', 'email_send']
  if (mode !== 'other') f.store.update(tenant, 'oauth-connections', f.connection.id, { capabilities, scopes: LEGACY[provider] })
  // Modo 'colleague': a conexão compartilhada da caixa foi autorizada por outro admin.
  if (mode === 'colleague') { const colleague = { tenantId: tenant, userId: randomUUID(), role: 'admin' as const }; seedMember(f.store, colleague); f.store.update(tenant, 'oauth-connections', f.connection.id, { userId: colleague.userId }) }
  // Modo 'other': a outra conta da mesma pessoa tem Agenda e uma página de agendamento publicada.
  const other = mode === 'other' ? f.store.create(tenant, 'oauth-connections', { provider, remoteId: 'fixture-provider-other', email: 'agenda@example.test', userId: f.actor.userId, visibility: 'shared', status: 'connected', capabilities: ['calendar', 'calendar_write', 'email', 'email_send'], scopes: LEGACY[provider], authorizationGeneration: 1 }) : undefined
  const otherGrant = other ? f.store.create(tenant, 'booking-grants', { pageId: 'page-other', status: 'active', connectionId: other.id, provider, remoteAccountId: 'fixture-provider-other', connectionGeneration: 1, connectionIdentity: oauthAuthorizationIdentity(other) }) : undefined
  await f.client.configure({ ...mailboxConfig(f.box!), knowledgeIds: [] }, f.box!)
  const connection = () => f.store.get(tenant, 'oauth-connections', f.connection.id)!
  const identity = oauthAuthorizationIdentity(connection())
  const bookingGrant = f.store.create(tenant, 'booking-grants', { pageId: 'page-fixture', status: 'active', connectionId: f.connection.id, provider, remoteAccountId: 'fixture-provider-owner', connectionGeneration: 1, connectionIdentity: identity })
  const sheetGrant = f.store.create(tenant, 'sheets-assistant-grants', { actionId: 'action-fixture', connectionIdentity: identity })
  const automation = mode === 'colleague' ? undefined : activateAutomation(f.store, f.actor, digest(f.state.cookie), f.box!.id, { mode: 'draft_review', optIn: true })
  if (automation) assert.ok(resolveAutomation(f.store, tenant, automation.id))

  const { startEngineProjection } = await import('../src/services/casca/data'), stop = startEngineProjection(); t.after(() => stop())
  await React.act(async () => { await engineSession.refresh(); await settle(100) })
  await email.refreshEmail()
  const inbox = () => useStore.getState().db.emailInboxes[0]!
  assert.equal(inbox().engineEmail?.mailbox.canOrganize, false); assert.equal(inbox().engineEmail?.mailbox.organizeOnReconnect, true)
  assert.deepEqual(useStore.getState().db.calendarConnections.find(c => c.id === f.connection.id)?.features, mode === 'other' ? ['email'] : ['calendar', 'email'])
  // The published booking page lives on this account's calendar (scheduling area projection).
  useStore.getState().mutate(db => ({ ...db,
    engineScheduling: { publicBaseUrl: 'http://127.0.0.1:4310', bookingsReadable: true, calendars: [{ id: 'calendar-fixture', email: 'Agenda', provider, timezone: 'UTC', calendar: { id: 'calendar-fixture', tenantId: tenant, name: 'Agenda', timezone: 'UTC', provider, connectionId: f.connection.id, externalCalendarId: 'primary', agentId: null, enabled: true } }] },
    eventTypes: [{ id: 'event-fixture', orgId: tenant, name: 'Consulta inicial', slug: 'consulta-inicial', calendarId: 'calendar-fixture', engineEvent: { publicationStatus: 'published' } } as any],
  }))

  // window.open → simulated consent: the provider redirects to the real engine callback in the same session.
  const navigations: string[] = []
  const popup = { closed: false, close() { popup.closed = true }, location: { set href(value: string) { navigations.push(value); void consent(value) } } }
  async function consent(value: string) {
    const url = new URL(value); if (url.protocol !== 'https:') return
    requestedScopes = url.searchParams.get('scope')!
    // Modo 'renamed': a janela é o navegador (Accept text/html), como na produção.
    const browser = mode === 'renamed' ? { headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } } : {}
    const done = await f.fetcher(`/api/v1/oauth/${provider}/callback?state=${encodeURIComponent(url.searchParams.get('state')!)}&code=test-code`, { credentials: 'include', ...browser })
    if (mode === 'same') { assert.equal(done.status, 200, await done.clone().text()); return }
    if (mode === 'renamed') {
      // A janela mostra a recusa legível, não JSON cru: nada foi alterado, o que pararia e os passos para usar o novo endereço.
      const page = await done.text()
      assert.equal(done.status, 409, page); assert.doesNotMatch(page, /"error"/)
      assert.match(page, /<h1[^>]*>A conexão não foi concluída<\/h1>/)
      assert.match(page, /Nada foi alterado: a conexão continua com inbox@example\.test/)
      assert.match(page, /pararia .*Consulta|pararia .*caixa/)
      assert.match(page, /1\) no E-Mail IA, use “Desconectar caixa de entrada”/)
      popup.closed = true
      return
    }
    // Outra conta: o motor recusa sem gravar; a pessoa lê o aviso na janela do provedor e a fecha.
    assert.equal(done.status, 409, await done.clone().text()); assert.equal((await done.json()).error.code, mode === 'renamed' ? 'oauth_reauthorization_address_changed' : 'oauth_reauthorization_account_mismatch')
    popup.closed = true
  }
  ;(w as any).open = () => popup

  const show = async (node: React.ReactNode) => (await React.act(async () => { root.render(<MemoryRouter><TooltipProvider>{node}<Toaster /></TooltipProvider></MemoryRouter>); await settle(60) }), await React.act(async () => { await settle(150) }))
  await show(<FolderList inbox={inbox()} folder="inbox" messages={[]} q="" filters={[]} onFiltersChange={() => {}} onClearSearch={() => {}} onOpen={() => {}} />)
  assert.ok(w.document.querySelector('[data-testid="email-organize-notice"]'))
  if (mode === 'colleague') {
    // Só quem autorizou a conta pode reconectá-la (o motor recusa os demais): sem botão, e o aviso diz quem deve fazer.
    assert.equal(buttons('Reconectar caixa').length, 0)
    assert.match(w.document.querySelector('[data-testid="email-organize-notice"]')!.textContent ?? '', /quem conectou inbox@example\.test/)
    return
  }
  await React.act(async () => { buttons('Reconectar caixa')[0]!.click(); await settle() })

  // Confirmation first: says which account to pick and exactly what keeps working. Nothing was started yet.
  const dialog = () => w.document.querySelector('[role="dialog"]')?.textContent ?? ''
  assert.match(dialog(), /Reconectar caixa\?/)
  assert.match(dialog(), /inbox@example\.test/)
  assert.match(dialog(), new RegExp(provider === 'google' ? 'Google' : 'Microsoft'))
  if (mode === 'same') assert.match(dialog(), /Consulta inicial/, 'published booking page on this account is named')
  assert.match(dialog(), /Automação de e-mail desta caixa/)
  assert.match(dialog(), /Nada é desconectado/)
  assert.match(dialog(), /Se você escolher outra conta, a reconexão é recusada e nada é alterado/)
  assert.match(dialog(), /O mesmo vale se o endereço desta conta mudou.*recusada sem alterar nada.*como passar a usar o novo endereço/)
  assert.doesNotMatch(dialog(), /nada para de funcionar/)
  assert.equal(f.requests.filter(r => r.path.endsWith('/start')).length, 0, 'no authorization before confirmation')

  await React.act(async () => { buttons('Reconectar').at(-1)!.click(); await settle(200) })
  const start = f.requests.find(r => r.path.endsWith('/start'))!
  assert.equal(start.body.connectionId, f.connection.id, 'the engine knows which connection is being reconnected')
  assert.equal(new URL(navigations[0]!).searchParams.get('login_hint'), 'inbox@example.test', 'the provider is asked for the inbox account')
  if (mode === 'other') {
    for (let i = 0; i < 40 && !/nada mudou em inbox@example\.test/.test(text()); i++) await React.act(async () => { await settle(100) })
    assert.match(text(), /A reconexão não foi concluída e nada mudou em inbox@example\.test/)
    assert.doesNotMatch(text(), /Caixa reconectada/)
    // Nada foi gravado: a outra conta mantém Agenda, geração e a página de agendamento; a caixa também não muda.
    assert.deepEqual(f.store.get(tenant, 'oauth-connections', other!.id), other)
    assert.equal(f.store.get(tenant, 'booking-grants', otherGrant!.id)!.connectionIdentity, oauthAuthorizationIdentity(other!))
    assert.equal(oauthAuthorizationGeneration(connection()), 1)
    assert.equal(f.store.list(tenant, 'oauth-connections').length, 2)
    return
  }
  if (mode === 'renamed') {
    for (let i = 0; i < 40 && !/nada mudou em inbox@example\.test/.test(text()); i++) await React.act(async () => { await settle(100) })
    assert.match(text(), /A reconexão não foi concluída e nada mudou em inbox@example\.test.*endereço dessa conta mudou.*como passar a usar o novo endereço/)
    assert.doesNotMatch(text(), /Caixa reconectada/)
    // Nada foi gravado: endereço, geração e vínculos seguem os de antes; página, planilha e automação continuam funcionando.
    assert.equal(connection().email, 'inbox@example.test'); assert.equal(oauthAuthorizationGeneration(connection()), 1)
    assert.equal(oauthAuthorizationIdentity(connection()), identity)
    assert.equal(f.store.get(tenant, 'booking-grants', bookingGrant.id)!.connectionIdentity, identity)
    assert.equal(f.store.get(tenant, 'sheets-assistant-grants', sheetGrant.id)!.connectionIdentity, identity)
    assert.doesNotThrow(() => resolveAutomation(f.store, tenant, automation!.id), 'email automation keeps running')
    return
  }
  for (let i = 0; i < 40 && !/Caixa reconectada/.test(text()); i++) await React.act(async () => { await settle(100) })
  assert.match(text(), /Caixa reconectada/)

  // Same provider and visibility, every capability the connection already had (+ e-mail): the engine can keep all dependents.
  assert.equal(start.path, `/api/v1/oauth/${provider}/start`)
  assert.equal(start.body.visibility, 'shared'); assert.deepEqual([...start.body.capabilities].sort(), [...capabilities].sort())
  assert.equal(navigations.length, 1); assert.equal(popup.closed, true)
  assert.equal(oauthAuthorizationGeneration(connection()), 2)
  assert.deepEqual([...(connection().capabilities as string[])].sort(), [...capabilities].sort())
  // Dependents follow the new authorization instead of being revoked.
  assert.equal(f.store.get(tenant, 'booking-grants', bookingGrant.id)!.connectionIdentity, oauthAuthorizationIdentity(connection()))
  assert.equal(f.store.get(tenant, 'booking-grants', bookingGrant.id)!.connectionGeneration, 2)
  assert.equal(f.store.get(tenant, 'sheets-assistant-grants', sheetGrant.id)!.connectionIdentity, oauthAuthorizationIdentity(connection()))
  assert.doesNotThrow(() => resolveAutomation(f.store, tenant, automation!.id), 'email automation keeps running')
  // The mailbox can organize now; the notice is gone.
  assert.equal(inbox().engineEmail?.mailbox.canOrganize, true)
  await show(<FolderList inbox={inbox()} folder="inbox" messages={[]} q="" filters={[]} onFiltersChange={() => {}} onClearSearch={() => {}} onOpen={() => {}} />)
  assert.equal(w.document.querySelector('[data-testid="email-organize-notice"]'), null)
}

test('Reconectar caixa (Gmail) confirms what keeps working and upgrades the same connection without revoking booking, automation or sheets', async t => { await scenario(t, 'google') })
test('Reconectar caixa (Outlook) re-authorizes Microsoft, not the default Google, and keeps booking and automation', async t => { await scenario(t, 'microsoft') })
test('Reconectar caixa when the provider signs in another connected account: refused, nothing changes, and the screen says so', async t => { await scenario(t, 'google', 'other') })
test('a shared inbox connected by another admin shows no Reconectar button and says who must reconnect it', async t => { await scenario(t, 'google', 'colleague') })
test('Reconectar caixa when the account primary address changed at the provider: refused, nothing stops, and the screen says so', async t => { await scenario(t, 'google', 'renamed') })

test('reauthorize names the connection to the engine, asks again for every capability, and only finishes with that connection', async () => {
  const { connectAccount } = await import('../src/services/casca/oauth')
  const target = { id: '11111111-1111-4111-8111-111111111111', provider: 'google', email: 'inbox@example.test', displayName: 'Caixa', visibility: 'shared', status: 'connected', capabilities: ['calendar', 'calendar_write', 'email', 'email_send', 'sheets_read'], authorizationGeneration: 3, owned: true, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T12:00:00Z' }
  const other = { ...target, id: '22222222-2222-4222-8222-222222222222', email: 'other@example.test', authorizationGeneration: 1 }
  const run = (after: unknown[], closeAfter = Infinity, first: unknown = target) => {
    let listed = 0, closed = false, waited = 0; const calls: { path: string; options: any }[] = []
    const context = { tenantId: 'tenant', generation: 1, assertCurrent() {}, async request(path: string, options: any) { calls.push({ path, options }); return path === '/oauth/connections' ? { items: listed++ ? after : [first] } : { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' } } } as any
    const environment = { open: () => ({ get closed() { return closed }, close() { closed = true }, navigate() {} }), now: () => 0, wait: async () => { if (++waited >= closeAfter) closed = true } }
    return { calls, promise: connectAccount(context, 'user', 'google', { scope: 'shared', features: ['calendar', 'email'], reauthorize: target.id }, undefined, environment) }
  }
  const same = run([{ ...target, authorizationGeneration: 4 }])
  assert.equal((await same.promise).id, target.id)
  const body = same.calls.find(c => c.path.endsWith('/start'))!.options.body
  assert.equal(body.connectionId, target.id); assert.deepEqual([...body.capabilities].sort(), [...target.capabilities].sort())
  // The engine refused another account (nothing changed); another connection changing meanwhile is not this reconnection.
  const wrong = run([target, { ...other, authorizationGeneration: 2 }], 3)
  await assert.rejects(wrong.promise, /A reconexão não foi concluída e nada mudou em inbox@example\.test.*escolha inbox@example\.test/)
  // A shared connection authorized by another admin: refused before any authorization starts.
  const colleague = run([target], Infinity, { ...target, owned: false })
  await assert.rejects(colleague.promise, /Só quem conectou inbox@example\.test pode reconectá-la/)
  assert.equal(colleague.calls.filter(c => c.path.endsWith('/start')).length, 0)
})

test('a connect dialog closed after an engine refusal points to the reason shown in the window instead of a bare failure', async () => {
  const { connectAccount } = await import('../src/services/casca/oauth')
  const row = { id: '33333333-3333-4333-8333-333333333333', provider: 'google', email: 'agenda@example.test', displayName: 'Agenda', visibility: 'personal', status: 'connected', capabilities: ['calendar', 'calendar_write'], authorizationGeneration: 2, owned: true, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T12:00:00Z' }
  let closed = false, waited = 0
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() {}, async request(path: string) { return path === '/oauth/connections' ? { items: [row] } : { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' } } } as any
  // Configurações/Agenda (sem reautorização dirigida): o motor recusou (endereço mudou) e a pessoa fecha a janela depois de ler o motivo.
  const environment = { open: () => ({ get closed() { return closed }, close() { closed = true }, navigate() {} }), now: () => 0, wait: async () => { if (++waited >= 2) closed = true } }
  await assert.rejects(connectAccount(context, 'user', 'google', { scope: 'personal', features: ['calendar'] }, undefined, environment), /A conexão não foi concluída\. Se a janela de autorização mostrou o motivo \(por exemplo, que o endereço da conta mudou\), nada foi alterado por essa recusa/)
})
