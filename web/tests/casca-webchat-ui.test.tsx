import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('original dialog recovers lost create, publishes the real snippet and the hosted link, and refuses fake customized publication', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/app/agents/agent', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement','HTMLFormElement','HTMLInputElement','HTMLButtonElement','Element','Node','NodeFilter','DocumentFragment','MutationObserver','CustomEvent','Event']) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  let copied = ''; Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text } } })
  const expected = { userId: 'owner', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }, now = '2026-10-19T12:00:00Z'
  const identity = { ...expected, email: 'test@example.invalid', role: 'owner', permissions: ['channels:read','channels:write','agents:read','organization:read'], context: expected, organizations: [{ id: 'tenant', tenantId: 'tenant', name: 'Empresa', membershipId: 'member', role: 'owner', status: 'active', createdAt: now, joinedAt: now }] }
  let channel: any = null, operation: any = null, lost = true, hosted: any = null
  const hostedView = () => ({ agentId: 'agent', channelId: channel?.id ?? null, orgSlug: 'o-' + 'a'.repeat(24), customOrgSlug: null, technicalSlug: 'o-' + 'a'.repeat(24), hosted, available: !!hosted?.published, reasons: [] })
  const calls: { path: string; method: string }[] = []
  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(String(input), w.location.origin), path = url.pathname, method = init.method ?? 'GET'; calls.push({ path, method })
    if (path.endsWith('/auth/me')) return Response.json(identity)
    if (path.endsWith('/capabilities')) return Response.json({ role: identity.role, permissions: identity.permissions, items: [] })
    if (path.endsWith('/account/profile')) return Response.json({ id: 'owner', email: identity.email, firstName: 'Nome', lastName: '', phone: null, language: 'pt-BR', revision: 0, profileCreatedAt: null, updatedAt: null })
    if (path.endsWith('/organization-settings')) return Response.json({ name: 'Empresa', timezone: 'America/Sao_Paulo' })
    if (path.endsWith('/webchat/channels') && method === 'GET') return Response.json({ items: channel ? [channel] : [], limit: 25, nextCursor: null })
    if (path === '/api/v1/public/webchat/hosted') return Response.json({ error: { code: 'hosted_unavailable', message: 'Este link de chat não está disponível.' } }, { status: 404 })
    if (path.endsWith('/webchat/hosted') && method === 'GET') return Response.json(hostedView())
    if (path.endsWith('/webchat/hosted') && method === 'PUT') { const body = JSON.parse(String(init.body)); assert.equal(body.expectedTenantId, 'tenant'); assert.equal(body.agentId, 'agent'); hosted = { published: true, assistantSlug: body.assistantSlug, greeting: body.greeting, path: `/w/o-${'a'.repeat(24)}/${body.assistantSlug}` }; return Response.json(hostedView()) }
    if (path.includes('/webchat/operations/')) { assert.equal(method, 'GET'); assert.ok(operation); return Response.json(operation) }
    if (method === 'GET' && path.endsWith('/webchat/channels/channel')) return Response.json(channel)
    if (method === 'POST' || method === 'PATCH') {
      const body = JSON.parse(String(init.body)); assert.equal(body.expectedTenantId, expected.tenantId)
      const kind = path.endsWith('/enable') ? 'enable' : path.endsWith('/disable') ? 'disable' : method === 'PATCH' ? 'update' : 'create'
      if (!channel) channel = { id: 'channel', tenantId: 'tenant', agentId: 'agent', type: 'webchat', provider: 'openai', enabled: false, name: body.name, configuration: body.configuration, revision: 0, version: 'a'.repeat(64), createdAt: now, updatedAt: now, readiness: { canEnable: true, available: false, reasons: [] }, installation: { scriptUrl: 'http://127.0.0.1:3004/widget/kloel.js', tenantId: 'tenant', channelId: 'channel' } }
      else assert.equal(body.expectedVersion, channel.version)
      channel = { ...channel, revision: channel.revision + 1, version: String(channel.revision + 1).repeat(64), enabled: kind === 'enable' ? true : kind === 'disable' ? false : channel.enabled, ...(body.configuration ? { configuration: body.configuration } : {}) }
      channel.readiness = { canEnable: channel.configuration.allowedOrigins.length > 0, available: channel.enabled && channel.configuration.allowedOrigins.length > 0, reasons: channel.configuration.allowedOrigins.length ? [] : ['origins_missing'] }
      operation = { key: body.idempotencyKey, kind, tenantId: 'tenant', channelId: channel.id, status: 'succeeded', automaticRetry: false, result: { channelId: channel.id, version: channel.version, revision: channel.revision, enabled: channel.enabled }, createdAt: now }
      if (lost) { lost = false; throw Error('Resposta interrompida') }
      return Response.json({ channel, operation, replayed: false })
    }
    assert.fail(`Unexpected request: ${path}`)
  }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { MemoryRouter } = await import('react-router-dom'), { Toaster } = await import('sonner')
  const { WebchatDialog } = await import('../src/app/pages/whatsapp/webchat/WebchatDialog'), { HostedWebchat } = await import('../src/app/pages/whatsapp/webchat/HostedWebchatPage')
  const { useStore } = await import('../src/data/store'), { engineSession } = await import('../src/services/engine/session'), { projectAgent } = await import('../src/services/casca/agents'), { startEngineProjection } = await import('../src/services/casca/data')
  const stop = startEngineProjection(), root = createRoot(w.document.getElementById('root')!), settle = () => new Promise(resolve => setTimeout(resolve, 40))
  const button = (text: string) => { const found = [...w.document.querySelectorAll('button')].find(b => b.textContent?.trim() === text); assert.ok(found, 'Missing ' + text); return found }
  const click = (text: string) => React.act(async () => { button(text).click(); await settle() })
  t.after(async () => { await React.act(async () => root.unmount()); stop(); dom.window.close() })
  await React.act(async () => {
    await engineSession.refresh()
    const a = projectAgent({ id: 'agent', tenantId: 'tenant', name: 'Atendimento', status: 'active', prompt: 'Teste', initialMessage: 'Olá', language: 'pt-BR', voice: 'marin', rules: [], tools: [], settings: {}, createdAt: now, updatedAt: now } as any)
    a.type = 'chat'; useStore.getState().mutate(db => ({ ...db, agents: [a], organizations: db.organizations.map(o => ({ ...o, slug: 'empresa' })) }))
    root.render(<MemoryRouter><WebchatDialog agentId="agent" open onOpenChange={() => {}} /><Toaster /></MemoryRouter>); await settle()
  })
  assert.equal(w.document.querySelector('[data-testid="wc-script"]'), null)
  await click('Adicionar site')
  await React.act(async () => { const input = w.document.querySelector('[aria-label="Site permitido 1"]') as HTMLInputElement; Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(input, 'http://localhost:4555'); input.dispatchEvent(new w.Event('input', { bubbles: true })); await settle() })
  await click('Salvar'); assert.ok(w.document.querySelector('[data-engine-state="error"]'))
  const posts = () => calls.filter(c => c.method !== 'GET').length
  assert.equal(posts(), 1)
  await click('Tentar novamente'); assert.equal(posts(), 1); assert.ok(calls.some(c => c.path.includes('/webchat/operations/') && c.method === 'GET'))
  assert.equal(w.document.querySelector('[data-testid="wc-script"]'), null)
  await click('Salvar'); assert.equal(posts(), 2)
  const script = w.document.querySelector('[data-testid="wc-script"]')!.textContent!
  assert.match(script, /127\.0\.0\.1:3004\/widget\/kloel\.js/); assert.match(script, /data-kloel-channel="channel"/); assert.ok(!script.includes('widget.kloel.ai'))
  await React.act(async () => { (w.document.querySelector('[aria-label="Copiar script"]') as HTMLButtonElement).click(); await settle() }); assert.equal(copied, script.trim())
  await click('Link hospedado'); assert.match(w.document.querySelector('[data-testid="wc-hosted-url"]')!.textContent!, /Não publicado/)
  assert.equal((w.document.querySelector('[aria-label="Copiar URL do Webchat"]') as HTMLButtonElement).disabled, true)
  await click('Salvar'); assert.equal(posts(), 3); assert.equal(hosted.assistantSlug, 'atendimento'); assert.equal(hosted.greeting, 'Olá')
  assert.equal(w.document.querySelector('[data-testid="wc-hosted-url"]')!.textContent, `http://127.0.0.1:3004/w/o-${'a'.repeat(24)}/atendimento`)
  await React.act(async () => { (w.document.querySelector('[aria-label="Copiar URL do Webchat"]') as HTMLButtonElement).click(); await settle() }); assert.equal(copied, `http://127.0.0.1:3004/w/o-${'a'.repeat(24)}/atendimento`)
  assert.equal((w.document.querySelector('a[aria-label="Abrir Webchat"]') as HTMLAnchorElement).href, copied)
  assert.deepEqual(channel.configuration.allowedOrigins, ['http://localhost:4555'], 'a origem da Kloel nunca vira site permitido')
  await click('Personalizar')
  await React.act(async () => { const input = w.document.querySelector('#wc-display-name') as HTMLInputElement; assert.ok(input); Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Outro nome'); input.dispatchEvent(new w.Event('input', { bubbles: true })); await settle() })
  await click('Salvar'); assert.equal(posts(), 3); assert.match(w.document.body.textContent!, /publicação da personalização ainda não está disponível/)
  await React.act(async () => { const tab = [...w.document.querySelectorAll('[role=tab]')].find(b => b.textContent?.startsWith('Widget')); assert.ok(tab); (tab as HTMLButtonElement).click(); await settle() })
  await click('Remover widget')
  await React.act(async () => { const confirms = [...w.document.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Remover widget'); confirms.at(-1)!.click(); await settle() })
  // Com o link hospedado publicado, remover o widget só apaga os sites (o canal segue atendendo o link).
  assert.equal(posts(), 4); assert.equal(channel.enabled, true); assert.deepEqual(channel.configuration.allowedOrigins, []); assert.equal(w.document.querySelector('[data-testid=wc-script]'), null)
  await React.act(async () => { root.render(<HostedWebchat orgSlug="empresa" assistantSlug="atendimento" />); await settle() })
  assert.match(w.document.body.textContent!, /Chatbot indisponível/); assert.equal(w.document.querySelector('[aria-label="Mensagem"]'), null); assert.equal(posts(), 4)
})
