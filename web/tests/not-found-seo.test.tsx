import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// Rotas reais (RootLayout + páginas) num roteador de memória: o useRouteSeo do RootLayout roda junto, então o teste também
// prova que ele não apaga o noindex da página 404.
async function mount(t: { after: (fn: () => unknown) => void }, entry: string) {
  const dom = new JSDOM('<!doctype html><html><head><title>Kloel AI</title></head><body><div id="root"></div></body></html>', { url: `http://127.0.0.1:3004${entry}`, pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, sessionStorage: w.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  for (const name of ['HTMLElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'FocusEvent']) (globalThis as any)[name] = (w as any)[name]
  class NoopObserver { observe() {} unobserve() {} disconnect() {} }
  Object.assign(globalThis, { ResizeObserver: NoopObserver }); Object.assign(w, { ResizeObserver: NoopObserver, scrollTo: () => {} }); w.HTMLElement.prototype.scrollIntoView = () => {}
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { createMemoryRouter, RouterProvider } = await import('react-router-dom')
  const { RootLayout } = await import('../src/RootLayout')
  const { default: NotFoundPage } = await import('../src/NotFoundPage')
  const { default: HelpArticlePage } = await import('../src/help/pages/HelpArticlePage')
  const { default: SolutionPage } = await import('../src/site/pages/solutions/SolutionPage')
  const router = createMemoryRouter([{
    element: <RootLayout />,
    children: [
      { path: '/solucoes/:slug', element: <SolutionPage /> },
      { path: '/ajuda/:section', element: <HelpArticlePage /> },
      { path: '/ajuda/:section/:slug', element: <HelpArticlePage /> },
      { path: '/app/*', element: <p>app</p> },
      { path: '*', element: <NotFoundPage /> },
    ],
  }], { initialEntries: [entry] })
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  const settle = () => React.act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  await React.act(async () => root.render(<RouterProvider router={router} />)); await settle()
  const robots = () => [...w.document.head.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute('content'))
  const go = async (to: string) => { await React.act(async () => { await router.navigate(to) }); await settle() }
  return { w, router, robots, go, location: () => `${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}` }
}

test('help aliases replace the URL with the canonical article instead of rendering a duplicate copy', async (t) => {
  const { w, router, location, robots } = await mount(t, '/ajuda/legal/termos?ref=x#secao')
  assert.equal(location(), '/ajuda/legal/termos-e-condicoes?ref=x#secao')
  assert.equal(router.state.historyAction, 'REPLACE', 'o alias não fica no histórico')
  assert.equal(w.document.querySelectorAll('article[data-article]').length, 1)
  assert.ok(w.document.querySelector('article[data-article="legal/termos-e-condicoes"]'))
  assert.equal(w.document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'), 'http://127.0.0.1:3004/ajuda/legal/termos-e-condicoes')
  assert.deepEqual(robots(), [], 'artigo canônico continua indexável')
})

test('every help alias resolves to its canonical article URL', async (t) => {
  const { HELP_ALIASES } = await import('../src/help/content/nav')
  const { canonicalKey } = await import('../src/help/content')
  const { w, go, location } = await mount(t, '/ajuda/legal/privacy-policy')
  assert.equal(location(), '/ajuda/legal/politica-de-privacidade')
  for (const [alias, canonical] of Object.entries(HELP_ALIASES)) {
    assert.equal(canonicalKey(alias), canonical, alias)
    // artigos de integração renderizam logos com import.meta.env do Vite (indisponível no Node): o redirect é o mesmo dos demais
    if (canonical.startsWith('integrations/')) continue
    await go(`/ajuda/${alias}`)
    assert.equal(location(), `/ajuda/${canonical}`, alias)
    assert.ok(w.document.querySelector(`article[data-article="${canonical}"]`), alias)
  }
  // seção que só existe nos aliases (o motor serve 200 por help-routes.json): vai ao artigo canônico, não a um 404 suave
  for (const [section, canonical] of [['troubleshooting', 'get-started/troubleshooting'], ['channels', 'products/whatsapp'], ['assistant', 'get-started/contacts']]) {
    await go(`/ajuda/${section}`)
    assert.equal(location(), `/ajuda/${canonical}`, section)
    assert.equal(w.document.querySelector('[data-help-404]'), null, section)
  }
})

test('not-found states add robots noindex while mounted and remove it on leaving', async (t) => {
  const { w, go, robots } = await mount(t, '/ajuda/foo/bar')
  assert.ok(w.document.querySelector('[data-help-404]'))
  assert.deepEqual(robots(), ['noindex'], 'o useRouteSeo do RootLayout não apaga o noindex da página')
  await go('/ajuda/get-started/connect-your-number')
  assert.equal(w.document.querySelector('[data-help-404]'), null)
  assert.ok(w.document.querySelector('article[data-article="get-started/connect-your-number"]'))
  assert.deepEqual(robots(), [])

  await go('/solucoes/inexistente')
  assert.match(w.document.body.textContent!, /Solução não encontrada/)
  assert.deepEqual(robots(), ['noindex'])
  await go('/ajuda/legal/termos-e-condicoes')
  assert.ok(w.document.querySelector('article[data-article="legal/termos-e-condicoes"]'))
  assert.deepEqual(robots(), [])

  await go('/pagina-que-nao-existe')
  assert.match(w.document.body.textContent!, /Página não encontrada/)
  assert.deepEqual(robots(), ['noindex'])
  await go('/outra-pagina-que-nao-existe') // continua montada: o noindex fica
  assert.deepEqual(robots(), ['noindex'])
  await go('/app/agents') // rota privada: só o robots do RootLayout
  assert.deepEqual(robots(), ['noindex, nofollow'])
  await go('/ajuda/foo/bar')
  assert.deepEqual(robots(), ['noindex'])
})

test('known solution pages stay indexable', async (t) => {
  const { w, robots } = await mount(t, '/solucoes/agente-de-suporte-com-ia')
  assert.doesNotMatch(w.document.body.textContent!, /Solução não encontrada/)
  assert.match(w.document.body.textContent!, /Configurar agente de suporte com IA/)
  assert.deepEqual(robots(), [])
})
