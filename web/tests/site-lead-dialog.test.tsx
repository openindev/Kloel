import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('site lead form posts the filled fields to the engine and shows success only after it is accepted', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/carreiras', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'FocusEvent']) (globalThis as any)[name] = (w as any)[name]
  const originalFetch = globalThis.fetch
  const calls: { url: string; body: any }[] = []
  let status = 202
  globalThis.fetch = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ status: 'received', id: 'lead-1' }), { status }) }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { LeadDialog } = await import('../src/site/pages/company/LeadDialog')
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close() })
  await React.act(async () => root.render(
    <LeadDialog open onOpenChange={() => undefined} kind="career" title="Candidatura espontânea" payload={{ vaga: 'Candidatura espontânea', slug: 'espontanea' }}
      fields={[{ name: 'nome', label: 'Nome completo', required: true }, { name: 'email', label: 'E-mail', type: 'email', required: true }, { name: 'mensagem', label: 'Mensagem', type: 'textarea', required: true }]}
      consent="Autorizo o uso dos meus dados." submitLabel="Enviar candidatura" successTitle="Candidatura enviada!" />,
  ))
  const set = async (id: string, value: string) => {
    const el = w.document.getElementById(id) as HTMLInputElement
    const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype
    await React.act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new w.Event('input', { bubbles: true })) })
  }
  const submit = async () => { await React.act(async () => { (w.document.querySelector('button[type="submit"]') as HTMLButtonElement).click() }); await React.act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

  await submit()
  assert.equal(calls.length, 0, 'invalid form is not sent')
  await set('lead-nome', 'Maria Souza'); await set('lead-email', 'maria@exemplo.com.br'); await set('lead-mensagem', 'Quero trabalhar na Kloel.')
  await React.act(async () => { (w.document.querySelector('input[type="checkbox"]') as HTMLInputElement).click() })
  status = 500
  await submit()
  assert.equal(calls.length, 1)
  assert.match(w.document.body.textContent!, /Não foi possível enviar agora/)
  assert.doesNotMatch(w.document.body.textContent!, /Candidatura enviada!/)
  status = 202
  await submit()
  assert.equal(calls.length, 2)
  const { url, body } = calls[1]!
  assert.equal(url, '/api/v1/public/leads')
  assert.deepEqual(body, { kind: 'career', page: '/carreiras', consent: true, title: 'Candidatura espontânea', context: { vaga: 'Candidatura espontânea', slug: 'espontanea' }, fields: { 'Nome completo': 'Maria Souza', 'E-mail': 'maria@exemplo.com.br', Mensagem: 'Quero trabalhar na Kloel.' } })
  assert.match(w.document.body.textContent!, /Candidatura enviada!/)
})
