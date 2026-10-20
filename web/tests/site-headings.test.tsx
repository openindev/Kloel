import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// O /demo-ia não tem título visível (vídeo [77]/01b): precisa de exatamente um <h1> sr-only, com texto, em todas as fases do fluxo.
// As demais rotas públicas são auditadas no navegador (Vite + Chrome); aqui fica a página que não tinha h1.
const ROUTES: [path: string, url: string][] = [
  ['/demo-ia', '/demo-ia?id=demo-generico'], ['/demo-ia', '/demo-ia?website=exemplo.com.br&id=demo-site'], ['/demo-ia', '/demo-ia?website=exemplo.com.br&from=criar&id=demo-intro'],
]

test('/demo-ia renders exactly one meaningful, visually hidden h1 in every phase', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w), localStorage: w.localStorage, sessionStorage: w.sessionStorage })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  for (const name of Object.getOwnPropertyNames(w).filter(n => /^(HTML\w*Element|Element|Node|NodeFilter|DocumentFragment|MutationObserver|CustomEvent|Event|KeyboardEvent|FocusEvent|MouseEvent|PointerEvent)$/.test(n))) (globalThis as any)[name] = (w as any)[name]
  class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  for (const name of ['IntersectionObserver', 'ResizeObserver']) (globalThis as any)[name] = (w as any)[name] = NoopObserver
  ;(w as any).matchMedia = (globalThis as any).matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })
  w.HTMLElement.prototype.scrollIntoView = () => {}
  ;(w as any).scrollTo = () => {}
  Object.defineProperty(w.HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(w.HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('{"error":{"message":"offline"}}', { status: 503, headers: { 'content-type': 'application/json' } })) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { MemoryRouter, Routes, Route } = await import('react-router-dom')
  const pages: Record<string, () => Promise<{ default: React.ComponentType<any> }>> = { '/demo-ia': () => import('../src/site/pages/products/WebchatDemoPage') }
  const host = w.document.getElementById('root')!
  t.after(() => { globalThis.fetch = originalFetch; dom.window.close() })
  const inventory: string[] = []
  for (const [path, url] of ROUTES) {
    const { default: Page } = await pages[path]!()
    const root = createRoot(host)
    await React.act(async () => root.render(<MemoryRouter initialEntries={[url]}><Routes><Route path={path} element={<Page />} /></Routes></MemoryRouter>))
    await React.act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const h1 = [...w.document.querySelectorAll('h1')]
    const text = (h1[0]?.textContent ?? '').replace(/\s+/g, ' ').trim()
    inventory.push(`${url} -> ${h1.length} h1: ${text}`)
    assert.equal(h1.length, 1, `${url}: esperado 1 h1, achei ${h1.length} (${h1.map(h => h.textContent).join(' | ')})`)
    assert.ok(text.length >= 5, `${url}: h1 sem texto significativo`)
    if (path === '/demo-ia') {
      assert.ok(h1[0]!.classList.contains('sr-only'), '/demo-ia: o h1 não pode mudar o visual (sr-only)')
      assert.equal(text, url.includes('website=') ? 'Sua IA de demonstração para exemplo.com.br' : 'Sua IA de demonstração')
    }
    await React.act(async () => root.unmount())
  }
  t.diagnostic(inventory.join('\n'))
})
