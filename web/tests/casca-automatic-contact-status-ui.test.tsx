import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('the existing contact settings paragraph persistently exposes ineffective automation while preserving the preference and controls', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/app/contacts?sheet=settings', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event']) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as any
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = (async () => { requests++; throw Error('No action was requested') }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { ContactSettingsSheet } = await import('../src/app/pages/contacts/ContactSettingsSheet')
  const { useStore } = await import('../src/data/store')
  const root = createRoot(w.document.getElementById('root')!), settle = () => new Promise(resolve => setTimeout(resolve, 30))
  const error = 'As preferências estão salvas, mas a captura ou o preenchimento automáticos estão inativos.'
  useStore.getState().mutate(db => ({ ...db, session: { orgId: 'org', userId: 'user' }, contactSettings: [{ orgId: 'org', autoCapture: true, creationGate: '', smartFields: [], automationError: error }] }))
  t.after(async () => { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close() })
  for (const key of ['first-open', 'reopened']) {
    await React.act(async () => { root.render(<ContactSettingsSheet key={key} open onOpenChange={() => {}} />); await settle() })
    const status = w.document.querySelector('[data-engine-state="error"]')
    assert.equal(status?.tagName, 'P'); assert.equal(status?.getAttribute('role'), 'alert')
    assert.equal(status?.className, 'text-xs text-muted-foreground')
    assert.equal(status?.textContent, error)
    assert.equal(w.document.querySelector('#cs-auto')?.getAttribute('aria-checked'), 'true')
    const save = [...w.document.querySelectorAll('button')].find(button => button.textContent === 'Salvar')
    assert.ok(save); assert.equal(save.disabled, false)
  }
  await React.act(async () => { useStore.getState().patchContactSettings({ automationError: undefined }); await settle() })
  assert.equal(w.document.querySelector('[data-engine-state="error"]'), null)
  assert.match(w.document.body.textContent!, /Salve novos contatos automaticamente das interações com clientes/)
  assert.equal(requests, 0)
  assert.equal(useStore.getState().db.contactSettings[0]?.autoCapture, true)
})
