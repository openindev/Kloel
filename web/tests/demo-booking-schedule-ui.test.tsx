import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('/agendar-demo shows the operator rule (Sat 17/10 18:02 → Mon 19 from 13:00, Tue 20, Wed 21) even from a Tokyo browser', async t => {
  const tz = process.env.TZ
  process.env.TZ = 'Asia/Tokyo'
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-17T21:02:00Z') })
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/agendar-demo', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w), sessionStorage: w.sessionStorage })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  for (const name of ['HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'FocusEvent', 'MouseEvent', 'PointerEvent']) if ((w as any)[name]) (globalThis as any)[name] = (w as any)[name]
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url))
    if (String(url) === '/api/v1/public/demo-booking/busy') return Response.json({ days: ['2026-10-19', '2026-10-20', '2026-10-21'], busy: ['2026-10-19 13:15'] })
    throw Error(`unexpected request ${url}`)
  }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { MemoryRouter, Routes, Route } = await import('react-router-dom')
  const { default: DemoBookingPage } = await import('../src/site/pages/demo/DemoBookingPage')
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close(); if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })
  await React.act(async () => root.render(<MemoryRouter initialEntries={['/agendar-demo']}><Routes><Route path="/agendar-demo" element={<DemoBookingPage />} /></Routes></MemoryRouter>))
  await React.act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.deepEqual(urls, ['/api/v1/public/demo-booking/busy'])

  const dayRadios = () => [...w.document.querySelectorAll('[role="radiogroup"][aria-label="Dia"] [role="radio"]')] as HTMLButtonElement[]
  const label = (b: Element) => b.textContent!.replace(/\s+/g, ' ').trim()
  assert.deepEqual(dayRadios().filter(b => !b.disabled).map(label), ['SEG.19', 'TER.20', 'QUA.21'])
  assert.deepEqual(dayRadios().filter(b => b.disabled).map(label), ['SÁB.17', 'DOM.18', 'QUI.22', 'SEX.23'])
  assert.equal(label(dayRadios().find(b => b.getAttribute('aria-checked') === 'true')!), 'SEG.19')
  const slots = () => [...w.document.querySelectorAll('[data-testid="slot-grid"] button')].map(b => b.textContent!.trim())
  assert.deepEqual(slots().slice(0, 3), ['13:00', '13:30', '13:45'], 'Monday is afternoon-only and the busy 13:15 is hidden')
  assert.equal(slots().at(-1), '18:30')
  assert.equal(slots().length, 22)

  await React.act(async () => { dayRadios().find(b => label(b) === 'TER.20')!.click() })
  assert.deepEqual(slots().slice(0, 2), ['09:00', '09:15'])
  assert.equal(slots().at(-1), '18:30')
  assert.equal(slots().length, 39)
})

test('/agendar-demo on a Monday morning keeps Monday afternoon as the first of the 3 business days', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-19T11:00:00Z') }) // seg 19/10 08:00 em São Paulo
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/agendar-demo', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w), sessionStorage: w.sessionStorage })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => Response.json({ days: [], busy: [] })) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { MemoryRouter, Routes, Route } = await import('react-router-dom')
  const { default: DemoBookingPage } = await import('../src/site/pages/demo/DemoBookingPage')
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close() })
  await React.act(async () => root.render(<MemoryRouter initialEntries={['/agendar-demo']}><Routes><Route path="/agendar-demo" element={<DemoBookingPage />} /></Routes></MemoryRouter>))
  await React.act(async () => { await Promise.resolve() })
  const label = (b: Element) => b.textContent!.replace(/\s+/g, ' ').trim()
  const enabled = ([...w.document.querySelectorAll('[role="radiogroup"][aria-label="Dia"] [role="radio"]')] as HTMLButtonElement[]).filter(b => !b.disabled).map(label)
  assert.deepEqual(enabled, ['SEG.19', 'TER.20', 'QUA.21'])
  assert.equal([...w.document.querySelectorAll('[data-testid="slot-grid"] button')][0]!.textContent!.trim(), '13:00')
})
