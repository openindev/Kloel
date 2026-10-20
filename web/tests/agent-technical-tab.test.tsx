import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

test('the Técnico tab no longer says its settings are coming soon and describes what precise extraction really does', () => {
  const source = readFileSync(new URL('../src/app/pages/agents/core/TechnicalTab.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /serão liberados em breve|Ativos hoje|Em breve/)
  assert.doesNotMatch(source, /modelo mais forte \(e mais lento\)/)
  assert.match(source, /confirma o valor com a pessoa/)
})

test('every Técnico change reaches the draft that is saved (no field is silently dropped)', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/app/agents/a1', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'SVGElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'FocusEvent', 'PointerEvent', 'ResizeObserver']) (globalThis as any)[name] = (w as any)[name] ?? class { observe() {} unobserve() {} disconnect() {} }
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { TechnicalTab } = await import('../src/app/pages/agents/core/TechnicalTab')
  const { DraftContext } = await import('../src/app/pages/agents/core/draft')
  const { makeAgent } = await import('../src/data/seed/defaults')
  const agent = makeAgent('org', 'Clara', 'voice', 'Empresa')
  let draft: any = { technical: { ...agent.technical, preciseExtraction: [] } }
  function Harness() {
    const [d, setD] = React.useState(draft); draft = d
    const update = (patch: any) => setD((prev: any) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }))
    return <DraftContext.Provider value={{ agent, draft: d, update, changes: 0, issues: [], issueFor: () => undefined } as any}><TechnicalTab /></DraftContext.Provider>
  }
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  await React.act(async () => root.render(<Harness />))
  const type = async (id: string, value: string) => {
    const el = w.document.getElementById(id) as HTMLInputElement
    await React.act(async () => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new w.Event('input', { bubbles: true })) })
  }
  await type('maxCallDuration', '45')
  await type('endCallAfterSilenceTimeout', '30')
  assert.equal(draft.technical.maxCallDuration, 45)
  assert.equal(draft.technical.silenceTimeout, 30)
  await React.act(async () => { (w.document.getElementById('autoDelete') as HTMLButtonElement).click() })
  assert.equal(draft.technical.autoDeleteOnRefusal, !agent.technical.autoDeleteOnRefusal)
  await type('technical-terms', 'Caldas Novas')
  await React.act(async () => { w.document.getElementById('technical-terms')!.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  assert.deepEqual(draft.technical.technicalTerms, ['Caldas Novas'])
  assert.doesNotMatch(w.document.body.textContent!, /Em breve|serão liberados/)
})
