import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

/**
 * "URL do Webchat": o endereço exibido é o mesmo que Copiar, QR e Abrir usam — o `hosted.path` devolvido pelo motor.
 * Se o motor responder com o endereço técnico enquanto a empresa tem apelido (ex.: motor anterior com o endereço do apelido
 * ainda reservado a outra empresa), o painel nunca exibe /w/<apelido>/<assistente>, que levaria ao chat de outra empresa.
 */
test('the hosted URL shown in the panel is the working link the engine returns, in every state', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/app/agents/agent', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement','HTMLFormElement','HTMLInputElement','HTMLButtonElement','Element','Node','NodeFilter','DocumentFragment','MutationObserver','CustomEvent','Event']) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  let copied = ''; Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text } } })
  const expected = { userId: 'owner', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }, now = '2026-10-19T12:00:00Z'
  const identity = { ...expected, email: 'test@example.invalid', role: 'owner', permissions: ['channels:read','channels:write','agents:read','organization:read'], context: expected, organizations: [{ id: 'tenant', tenantId: 'tenant', name: 'Empresa', membershipId: 'member', role: 'owner', status: 'active', createdAt: now, joinedAt: now }] }
  const technical = 'o-' + 'a'.repeat(24)
  let path = `/w/${technical}/atendimento`
  const hostedView = () => ({ agentId: 'agent', channelId: 'channel', orgSlug: 'clinica-sol', customOrgSlug: 'clinica-sol', technicalSlug: technical, hosted: { published: true, assistantSlug: 'atendimento', greeting: 'Olá', path, publishedAt: now, updatedAt: now }, available: true, reasons: [] })
  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(String(input), w.location.origin), p = url.pathname, method = init.method ?? 'GET'
    if (p.endsWith('/auth/me')) return Response.json(identity)
    if (p.endsWith('/capabilities')) return Response.json({ role: identity.role, permissions: identity.permissions, items: [] })
    if (p.endsWith('/account/profile')) return Response.json({ id: 'owner', email: identity.email, firstName: 'Nome', lastName: '', phone: null, language: 'pt-BR', revision: 0, profileCreatedAt: null, updatedAt: null })
    if (p.endsWith('/organization-settings')) return Response.json({ name: 'Empresa', timezone: 'America/Sao_Paulo' })
    if (p.endsWith('/webchat/channels') && method === 'GET') return Response.json({ items: [], limit: 25, nextCursor: null })
    if (p.endsWith('/webchat/hosted') && method === 'GET') return Response.json(hostedView())
    assert.fail(`Unexpected request: ${method} ${p}`)
  }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { MemoryRouter } = await import('react-router-dom'), { Toaster } = await import('sonner')
  const { WebchatDialog } = await import('../src/app/pages/whatsapp/webchat/WebchatDialog')
  const { useStore } = await import('../src/data/store'), { engineSession } = await import('../src/services/engine/session'), { projectAgent } = await import('../src/services/casca/agents'), { startEngineProjection } = await import('../src/services/casca/data')
  const stop = startEngineProjection(), root = createRoot(w.document.getElementById('root')!), settle = () => new Promise(resolve => setTimeout(resolve, 40))
  t.after(async () => { await React.act(async () => root.unmount()); stop(); dom.window.close() })
  await React.act(async () => {
    await engineSession.refresh()
    const a = projectAgent({ id: 'agent', tenantId: 'tenant', name: 'Atendimento', status: 'active', prompt: 'Teste', initialMessage: 'Olá', language: 'pt-BR', voice: 'marin', rules: [], tools: [], settings: {}, createdAt: now, updatedAt: now } as any)
    a.type = 'chat'; useStore.getState().mutate(db => ({ ...db, agents: [a], organizations: db.organizations.map(o => ({ ...o, slug: 'clinica-sol' })) }))
  })
  const render = (key: string) => React.act(async () => { root.render(<MemoryRouter><WebchatDialog key={key} agentId="agent" open initialTab="hosted" onOpenChange={() => {}} /><Toaster /></MemoryRouter>); await settle() })
  const links = async () => {
    const shown = w.document.querySelector('[data-testid="wc-hosted-url"]')!.textContent
    await React.act(async () => { (w.document.querySelector('[aria-label="Copiar URL do Webchat"]') as HTMLButtonElement).click(); await settle() })
    return { shown, copied, open: (w.document.querySelector('a[aria-label="Abrir Webchat"]') as HTMLAnchorElement).href }
  }
  // Motor devolve o endereço técnico com o apelido definido: o texto exibido é o técnico, igual ao copiado/aberto.
  await render('technical')
  const working = `http://127.0.0.1:3004/w/${technical}/atendimento`
  assert.deepEqual(await links(), { shown: working, copied: working, open: working })
  // Estado normal: o endereço do apelido.
  path = '/w/clinica-sol/atendimento'
  await render('custom')
  const custom = 'http://127.0.0.1:3004/w/clinica-sol/atendimento'
  assert.deepEqual(await links(), { shown: custom, copied: custom, open: custom })
})
