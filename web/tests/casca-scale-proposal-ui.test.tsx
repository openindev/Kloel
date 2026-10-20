import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('Scale proposal and sales buttons preserve the shell but never record local leads or navigate as success', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/app/add-product', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event']) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as any
  const originalFetch = globalThis.fetch
  let requests = 0, closed = 0
  globalThis.fetch = (async () => { requests++; throw Error('No lead contract is configured') }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { Toaster } = await import('sonner')
  const { ScaleConfigDialog } = await import('../src/app/pages/billing/ScaleConfigDialog')
  const { useStore } = await import('../src/data/store')
  const root = createRoot(w.document.getElementById('root')!), settle = () => new Promise(resolve => setTimeout(resolve, 30))
  t.after(async () => { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close() })
  await React.act(async () => { root.render(<><Toaster /><ScaleConfigDialog product="voice" interval="monthly" open onOpenChange={() => { closed++ }} /></>); await settle() })
  const before = JSON.stringify(useStore.getState().db), estimate = w.document.querySelector('[data-testid="scale-total"]')!.textContent
  for (const label of ['Solicitar proposta', 'Falar com vendas']) {
    await React.act(async () => { const button = [...w.document.querySelectorAll('button')].find(node => node.textContent!.trim() === label); assert.ok(button); button.click(); await settle() })
    assert.equal(JSON.stringify(useStore.getState().db), before)
    assert.equal(w.location.pathname, '/app/add-product')
    assert.ok(w.document.querySelector('[data-testid="scale-config-dialog"]'))
  }
  assert.equal(closed, 0)
  assert.equal(requests, 0)
  assert.equal(w.document.querySelector('[data-testid="scale-total"]')!.textContent, estimate)
  assert.match(w.document.body.textContent!, /Não foi possível solicitar a proposta/)
  assert.match(w.document.body.textContent!, /Não foi possível entrar em contato com vendas/)
  assert.doesNotMatch(w.document.body.textContent!, /Pedido de proposta registrado|Demonstração/)
})
