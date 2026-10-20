import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('existing payment shell disables PAN entry, opens hosted Stripe, recovers a lost response and never applies a local purchase', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/app/checkout', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event']) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  const context = { userId: 'user', tenantId: 'tenant', membershipId: 'membership', authorityVersion: 'a'.repeat(64) }
  const identity = { ...context, email: 'test@example.invalid', role: 'owner', permissions: ['billing:manage', 'organization:read'], context, organizations: [{ id: 'tenant', tenantId: 'tenant', name: 'Empresa', membershipId: 'membership', role: 'owner', status: 'active', createdAt: '2026-10-19T12:00:00Z', joinedAt: '2026-10-19T12:00:00Z' }] }
  const calls: { path: string; method: string }[] = [], popups: any[] = []
  w.open = (() => { const p = { closed: false, opener: 'original', location: { href: '', replace(url: string) { this.href = url } }, close() { this.closed = true } }; popups.push(p); return p }) as any
  const { planOf } = await import('../src/data/catalogs/plans')
  const price = { priceId: 'price_actual', productName: 'Telefone', currency: 'brl', unitAmount: planOf('voice', 'solo')!.monthly! * 100, interval: 'month', intervalCount: 1, active: true, livemode: false, checkoutUsable: true, synthetic: true, kloelPlan: { product: 'voice', tier: 'solo', interval: 'monthly' } }
  const session = { sessionId: 'cs_test_actual', url: 'https://checkout.stripe.com/c/pay/cs_test_actual', expiresAt: Math.floor(Date.now() / 1000) + 600, paymentStatus: 'unpaid' }
  let key = ''
  globalThis.fetch = (async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'; calls.push({ path, method })
    if (path.endsWith('/auth/me')) return Response.json(identity)
    if (path.endsWith('/account/profile')) return Response.json({ id: 'user', email: identity.email, firstName: 'Nome', lastName: '', phone: null, language: 'pt-BR', revision: 0, profileCreatedAt: null, updatedAt: null })
    if (path.endsWith('/organization-settings')) return Response.json({ name: 'Empresa', timezone: 'America/Sao_Paulo' })
    if (path.endsWith('/capabilities')) return Response.json({ role: identity.role, permissions: identity.permissions, items: [] })
    if (path.endsWith('/billing/catalog')) return Response.json({ configured: true, mode: 'test', source: 'stripe_api', items: [price] })
    if (path.endsWith('/billing/checkout')) { const body = JSON.parse(String(init.body)); assert.deepEqual(Object.keys(body).sort(), ['idempotencyKey', 'priceId']); key = body.idempotencyKey; throw Error('lost response') }
    if (path.includes('/billing/operations/' + key)) return Response.json({ operation: 'stripe.checkout', status: 'succeeded', errorCode: null, result: session, requiresReconciliation: false })
    assert.fail('Unexpected fixture request ' + path)
  }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { MemoryRouter } = await import('react-router-dom')
  const { PaymentStep } = await import('../src/app/pages/billing/CheckoutSteps'), { engineSession } = await import('../src/services/engine/session'), { useStore } = await import('../src/data/store')
  const root = createRoot(w.document.getElementById('root')!), settle = () => new Promise(resolve => setTimeout(resolve, 30))
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  let applied = 0, paid = 0
  await React.act(async () => { await engineSession.refresh(); assert.equal(engineSession.getSnapshot().phase, 'authenticated'); root.render(<MemoryRouter><PaymentStep cart={[{ product: 'voice', tier: 'solo', interval: 'monthly' }]} onBeforeApply={() => { applied++ }} onPaid={() => { paid++ }} /></MemoryRouter>); await settle() })
  const before = JSON.stringify(useStore.getState().db)
  for (const id of ['cc-number', 'cc-expiry', 'cc-cvc', 'cc-holder']) assert.equal((w.document.getElementById(id) as HTMLInputElement).disabled, true)
  assert.equal(w.document.body.textContent!.includes('Cartões de teste'), false)
  assert.equal(w.document.body.textContent!.includes('Pagamento demonstrativo'), false)
  const click = (match: (s: string) => boolean) => React.act(async () => { const b = [...w.document.querySelectorAll('button')].find(b => match(b.textContent!.trim())); assert.ok(b); b.click(); await settle() })
  await click(s => s.startsWith('Pagar ')); assert.equal(popups[0].closed, true)
  await click(s => s === 'Tentar novamente')
  assert.equal(popups[1].location.href, session.url); assert.equal(popups[1].opener, null)
  assert.equal(calls.filter(c => c.path.endsWith('/billing/checkout') && c.method === 'POST').length, 1)
  assert.equal(applied, 0); assert.equal(paid, 0); assert.equal(JSON.stringify(useStore.getState().db), before)
  assert.equal(w.document.body.textContent!.includes('Pagamento aprovado.'), false)
  assert.match(w.document.body.textContent!, /modo de teste/)
  await React.act(async () => { await engineSession.refresh(); await settle() }); assert.equal(popups[1].closed, true)
})
