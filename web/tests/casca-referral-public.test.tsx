import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('public referral never exposes a private organization or confirms an unverified benefit', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/r/private-slug', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = (async () => { requests++; throw Error('No public referral contract exists') }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { MemoryRouter, Routes, Route } = await import('react-router-dom')
  const { default: ReferralLandingPage } = await import('../src/site/pages/resources/ReferralLandingPage')
  const { useStore } = await import('../src/data/store')
  const original = useStore.getState().db
  useStore.setState({ db: { ...original, organizations: [{ id: 'private-org', name: 'Private organization must stay private', slug: 'private-slug' } as any] } })
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); useStore.setState({ db: original }); globalThis.fetch = originalFetch; dom.window.close() })
  await React.act(async () => root.render(<MemoryRouter initialEntries={['/r/private-slug']}><Routes><Route path="/r/:code" element={<ReferralLandingPage />} /></Routes></MemoryRouter>))
  const text = w.document.body.textContent!
  assert.doesNotMatch(text, /Private organization must stay private|50%|Criar conta com desconto|fica registrada na conta/)
  assert.match(text, /nenhum benefício de indicação foi confirmado/)
  assert.match(text, /Criar minha conta/)
  assert.match(text, /private-slug/)
  assert.equal(requests, 0)
  assert.ok(w.document.querySelector('a[href="/criar-conta?ref=private-slug"]'))
  assert.ok(w.document.querySelector('a[href="/login"]'))
})

test('a code confirmed by the engine shows only the referring organization returned by the public endpoint', async t => {
  const code = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
  const dom = new JSDOM('<div id="root"></div>', { url: `http://127.0.0.1:3004/r/${code}`, pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify({ valid: true, referrerName: 'Clínica Indicadora', benefit: { percentOff: 50, months: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } }) }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { MemoryRouter, Routes, Route } = await import('react-router-dom')
  const { default: ReferralLandingPage } = await import('../src/site/pages/resources/ReferralLandingPage')
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close() })
  await React.act(async () => root.render(<MemoryRouter initialEntries={[`/r/${code}`]}><Routes><Route path="/r/:code" element={<ReferralLandingPage />} /></Routes></MemoryRouter>))
  await React.act(async () => { await new Promise(r => setTimeout(r, 0)) })
  assert.deepEqual(urls, [`/api/v1/public/referrals/${code}`])
  const text = w.document.body.textContent!
  assert.match(text, /Convite de Clínica Indicadora/)
  assert.doesNotMatch(text, /nenhum benefício de indicação foi confirmado/)
  assert.ok(w.document.querySelector(`a[href="/criar-conta?ref=${code}"]`))
})
