import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('identity shell opens Stripe, recovers an interrupted create, and never labels a test verdict verified', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/app/billing/identity', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event']) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  const context = { userId: 'user', tenantId: 'tenant', membershipId: 'membership', authorityVersion: 'a'.repeat(64) }
  const identity = { ...context, email: 'test@example.invalid', role: 'owner', permissions: ['billing:manage', 'organization:read'], context,
    organizations: [{ id: 'tenant', tenantId: 'tenant', name: 'Empresa', membershipId: 'membership', role: 'owner', status: 'active', createdAt: '2026-10-19T12:00:00Z', joinedAt: '2026-10-19T12:00:00Z' }] }
  const time = '2026-10-19T12:00:00.000Z', id = '11111111-1111-4111-8111-111111111111'
  let verification: any = null, operationKey = '', lost = true, providerMode = 'test', holdRead: (() => void) | undefined
  let hold = false
  const calls: { path: string; method: string }[] = [], popups: any[] = []
  w.open = (() => { const p = { closed: false, location: { href: '' }, close() { this.closed = true } }; popups.push(p); return p }) as any
  globalThis.fetch = (async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'; calls.push({ path, method })
    if (path.endsWith('/auth/me')) return Response.json(identity)
    if (path.endsWith('/capabilities')) return Response.json({ role: identity.role, permissions: identity.permissions, items: [] })
    if (path.endsWith('/account/profile')) return Response.json({ id: 'user', email: identity.email, firstName: 'Nome', lastName: '', phone: null, language: 'pt-BR', revision: 0, profileCreatedAt: null, updatedAt: null })
    if (path.endsWith('/organization-settings')) return Response.json({ name: 'Empresa', timezone: 'America/Sao_Paulo' })
    if (path.endsWith('/identity')) {
      if (hold) await new Promise<void>(resolve => { holdRead = resolve })
      return Response.json({ configured: true, mode: providerMode, verification })
    }
    if (path.endsWith('/identity/start')) {
      const body = JSON.parse(String(init.body)); assert.equal(body.expectedTenantId, context.tenantId); operationKey = body.idempotencyKey
      verification = { id, state: 'requires_input', mode: 'test', verified: false, canResume: true, requiresReconciliation: true, confirmedAt: null, createdAt: time, updatedAt: time }
      if (lost) { lost = false; throw new Error('lost response') }
      assert.fail('Creation must not be repeated')
    }
    if (path.endsWith('/identity/operations/' + operationKey)) return Response.json({ key: operationKey, kind: 'stripe.identity.create', status: 'succeeded', automaticRetry: false, verification })
    if (path.endsWith('/identity/resume')) return Response.json({ verification: { ...verification, confirmedAt: time, requiresReconciliation: false }, url: 'https://verify.stripe.com/start/test_only' })
    if (path.endsWith('/identity/reconcile')) return Response.json(verification)
    assert.fail('Unexpected fixture request ' + path)
  }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { MemoryRouter } = await import('react-router-dom')
  const { default: Page } = await import('../src/app/pages/billing/IdentityVerificationPage'), { engineSession } = await import('../src/services/engine/session')
  const { startEngineProjection } = await import('../src/services/casca/data'), stopProjection = startEngineProjection()
  const root = createRoot(w.document.getElementById('root')!), settle = () => new Promise(resolve => setTimeout(resolve, 25))
  t.after(async () => { await React.act(async () => root.unmount()); stopProjection(); dom.window.close() })
  const button = (text: string) => { const found = [...w.document.querySelectorAll('button')].find(b => b.textContent?.trim() === text); assert.ok(found, 'Missing ' + text); return found }
  const click = (text: string) => React.act(async () => { button(text).click(); await settle() })
  await React.act(async () => { await engineSession.refresh(); root.render(<MemoryRouter><Page /></MemoryRouter>); await settle() })
  assert.ok(w.document.querySelector('[data-testid="identity-consent"]'))
  assert.equal(w.document.querySelector('input[type="file"]'), null)
  await click('Concordar e continuar')
  assert.ok(w.document.querySelector('[data-testid="identity-failed"]'))
  assert.equal(popups[0].closed, true)
  await click('Tentar novamente')
  await click('Continuar verificação')
  assert.equal(popups[1].location.href, 'https://verify.stripe.com/start/test_only')
  assert.equal(calls.filter(c => c.path.endsWith('/identity/start')).length, 1)
  assert.ok(calls.some(c => c.path.endsWith('/identity/operations/' + operationKey) && c.method === 'GET'))
  assert.equal(w.sessionStorage.length, 1)
  const journal = w.sessionStorage.getItem(w.sessionStorage.key(0)!)!
  assert.ok(!journal.includes('https:') && !journal.includes('@'))
  verification = { ...verification, state: 'verified', verified: false, canResume: false, confirmedAt: time, requiresReconciliation: false }
  await React.act(async () => { w.dispatchEvent(new w.Event('focus')); await settle() })
  assert.equal(w.document.querySelector('[data-testid="identity-verified"]'), null)
  assert.match(w.document.body.textContent!, /testes não conclui/)
  assert.equal(w.document.body.textContent!.includes('Identidade verificada'), false)
  verification = { ...verification, verified: true }
  await click('Consultar resultado')
  assert.ok(w.document.querySelector('[data-testid="identity-failed"]'))
  assert.equal(w.document.querySelector('[data-testid="identity-verified"]'), null)
  providerMode = 'live'; verification = { ...verification, mode: 'live', verified: true }
  await click('Tentar novamente')
  assert.ok(w.document.querySelector('[data-testid="identity-verified"]'))
  hold = true
  await React.act(async () => { await engineSession.refresh(); await settle() })
  assert.equal(w.document.querySelector('[data-testid="identity-verified"]'), null)
  assert.ok(w.document.querySelector('[data-identity-state="loading"]'))
  assert.equal(popups[1].closed, true)
  verification = null; hold = false
  await React.act(async () => { holdRead!(); await settle() })
  assert.ok(w.document.querySelector('[data-testid="identity-consent"]'))
})
