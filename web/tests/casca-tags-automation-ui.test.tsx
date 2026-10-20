import test from 'node:test'
import assert from 'node:assert/strict'
import { contactsConversationsFixture as fixture } from './engine-contacts-conversations-fixture'

/** Gerenciar tags › Criar tag: "Adicionar automaticamente" deixa de ser um interruptor morto e explica o estado real do motor. */
test('automatic tag switch is enabled with the real engine status and the rule is saved', async t => {
  const f = await fixture(t), w = globalThis.window as any
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLTextAreaElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'PointerEvent', 'HTMLFormElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'SVGElement', 'Text', 'getSelection']) if (w[name]) (globalThis as any)[name] = w[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  if (!w.ResizeObserver) w.ResizeObserver = (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { MemoryRouter } = await import('react-router-dom')
  const { TagsSheet } = await import('../src/app/pages/inbox/TagsUi')
  const root = createRoot(w.document.getElementById('root')!), settle = () => new Promise(r => setTimeout(r, 30))
  t.after(async () => { await React.act(async () => root.unmount()) })
  const until = async (predicate: () => unknown, label: string) => { for (let i = 0; i < 80; i++) { if (predicate()) return; await React.act(settle) } assert.fail(label + ': ' + w.document.body.textContent) }
  const button = (text: string) => [...w.document.querySelectorAll('button')].find((b: any) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
  await React.act(async () => { root.render(<MemoryRouter><TagsSheet open onOpenChange={() => {}} /></MemoryRouter>); await settle() })
  await until(() => button('Adicionar nova tag') && !button('Adicionar nova tag')!.disabled, 'catalog')
  await React.act(async () => { button('Adicionar nova tag')!.click(); await settle() })
  await until(() => w.document.querySelector('[data-testid="tag-auto-status"]')?.textContent?.includes('depois que a conversa termina'), 'status')
  const toggle = w.document.getElementById('tag-auto') as HTMLButtonElement
  assert.equal(toggle.disabled, false)
  assert.doesNotMatch(w.document.body.textContent!, /indisponível no momento/)
  const name = w.document.getElementById('tag-name') as HTMLInputElement
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => { const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new w.Event('input', { bubbles: true })) }
  await React.act(async () => { setValue(name, 'Retornar ligação'); toggle.click(); await settle() })
  await until(() => w.document.getElementById('tag-cond'), 'condition field')
  await React.act(async () => { setValue(w.document.getElementById('tag-cond') as HTMLTextAreaElement, 'A pessoa pediu retorno da equipe.'); await settle() })
  const panelSave = [...w.document.querySelectorAll('button')].filter((b: any) => b.textContent?.trim() === 'Salvar')
  await React.act(async () => { (panelSave.at(-1) as HTMLButtonElement).click(); await settle() })
  await until(() => [...w.document.querySelectorAll('button')].filter((b: any) => b.textContent?.trim() === 'Salvar').length >= 1 && w.document.body.textContent!.includes('Regra: A pessoa pediu retorno da equipe.'), 'draft rule listed')
  const listSave = [...w.document.querySelectorAll('button')].find((b: any) => b.textContent?.trim() === 'Salvar' && !b.closest('[inert]')) as HTMLButtonElement
  await React.act(async () => { listSave.click(); await settle() })
  await until(() => f.requests.some(r => r.method === 'PUT' && r.path === '/api/v1/conversation-tags'), 'catalog saved')
  const saved = f.requests.find(r => r.method === 'PUT' && r.path === '/api/v1/conversation-tags')!.body.tags
  assert.deepEqual(saved.map((tag: any) => [tag.label, tag.autoAdd, tag.condition]), [['Retornar ligação', true, 'A pessoa pediu retorno da equipe.']])
  assert.ok(f.requests.some(r => r.path === '/api/v1/conversation-tags/automation'))
})
