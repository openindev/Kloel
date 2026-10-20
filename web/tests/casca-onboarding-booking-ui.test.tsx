import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { assistantBookingUIFixture } from './engine-assistant-booking-fixture'

test('onboarding private chat offers real booking choices and recovers original reservations without replaying confirmed chat', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3004/app/onboarding', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, sessionStorage: w.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'MouseEvent']) globalThis[name] = w[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollTo = () => {}; globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  const f = await assistantBookingUIFixture(t), action = await f.create(); f.toolRound(action)
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { MemoryRouter } = await import('react-router-dom')
  const { TestChatStep } = await import('../src/app/pages/onboarding/OnboardingPage'), { Dialog, DialogContent } = await import('../src/components/ui/dialog'), { TooltipProvider } = await import('../src/components/ui/tooltip'), { Toaster } = await import('sonner')
  const { engineSession } = await import('../src/services/engine/session'), { useStore } = await import('../src/data/store'), { emptyEngineDB, projectIdentity } = await import('../src/data/engine-state'), { makeAgent } = await import('../src/data/seed/defaults')
  await engineSession.refresh(); assert.equal(engineSession.getSnapshot().phase, 'authenticated', engineSession.getSnapshot().error)
  useStore.getState().replace({ ...emptyEngineDB(), ...projectIdentity(engineSession.getSnapshot().data!) })
  const agent = makeAgent(f.actor.tenantId, String(f.agent.name), { type: 'chat', channels: ['webchat'], greeting: 'Como posso ajudar?' }); agent.id = f.agent.id; agent.technical.preciseExtraction = []
  let root = createRoot(w.document.getElementById('root')!)
  const settle = () => new Promise(resolve => setTimeout(resolve, 25))
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  const mount = async () => React.act(async () => { root.render(<MemoryRouter><TooltipProvider><Dialog open><DialogContent><TestChatStep agent={agent} onBack={() => {}} finish={() => {}} /></DialogContent></Dialog><Toaster /></TooltipProvider></MemoryRouter>); await settle() })
  const until = async (predicate: () => unknown, label: string) => { for (let i = 0; i < 160; i++) { if (predicate()) return; await React.act(settle) } assert.fail(label + '\n' + w.document.body.textContent + '\n' + JSON.stringify(f.calls.slice(-8).map(x => ({ path: x.path, method: x.method })))) }
  const button = (label: string) => [...w.document.querySelectorAll('button')].find(el => el.textContent?.trim() === label)
  const click = async (label: string) => React.act(async () => { const el = button(label); assert.ok(el, 'Missing button ' + label); assert.equal(el.disabled, false, 'Disabled ' + label); el.click(); await settle() })
  const send = async (message: string) => React.act(async () => {
    const input = w.document.querySelector<HTMLInputElement>('[aria-label="Mensagem do cliente"]'); assert.ok(input)
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(input, message); input.dispatchEvent(new w.Event('input', { bubbles: true })); await settle()
    input.closest('form')!.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle()
  })
  const chats = () => f.calls.filter(x => x.method === 'POST' && x.path.endsWith('/ai/chat'))
  const bookings = () => f.calls.filter(x => x.method === 'POST' && x.path.endsWith('/bookings'))
  let firstChoice: any
  f.state.after = async (r, response) => { if (r.method === 'POST' && r.path.endsWith('/ai/chat')) firstChoice = (await response.clone().json()).bookingChoices[0]; return response }
  await mount(); assert.equal(button('Consultar reservas'), undefined)
  await send('Quero agendar.'); await until(() => button(String(f.page.name)), 'Real booking choice was not rendered')
  assert.equal(chats().length, 1); assert.equal(bookings().length, 0); assert.ok(firstChoice.slots.length)
  await click(String(f.page.name))
  const slotLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: firstChoice.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(firstChoice.slots[0].startAt))
  await click(slotLabel); assert.equal(bookings().length, 0, 'Selecting a time is not booking confirmation')
  f.state.after = async (r, response) => { if (r.method === 'POST' && r.path.endsWith('/bookings')) { assert.equal(response.status, 200); f.state.after = undefined; throw Error('booking response lost after commit') } return response }
  await click('Confirmar reserva'); await until(() => button('Consultar reserva'), 'Lost response did not retain original reservation')
  assert.equal(bookings().length, 1); assert.equal(chats().length, 1)
  await click('Consultar reserva'); await until(() => w.document.body.textContent?.includes('Criação da reserva confirmada'), 'Reservation receipt was not recovered')
  assert.equal(bookings().length, 1); assert.equal(chats().length, 1)
  // A remount models closing/reopening this step in the same browser tab. Only opaque references survive.
  await React.act(async () => root.unmount()); root = createRoot(w.document.getElementById('root')!)
  const writesBeforeRemount = f.calls.filter(x => x.method !== 'GET').length
  await mount(); await until(() => button('Consultar reservas'), 'Reopened step lost its reservation journal')
  await click('Consultar reservas'); await click('Consultar reserva 1 · Agendador')
  await until(() => w.document.body.textContent?.includes('Criação da reserva confirmada'), 'Reopened journal could not recover receipt')
  assert.equal(f.calls.filter(x => x.method !== 'GET').length, writesBeforeRemount)
  const journal = Object.keys(w.sessionStorage).filter(key => key.startsWith('kloel-assistant-booking-execution:')).map(key => w.sessionStorage.getItem(key)).join()
  assert.doesNotMatch(journal, /quote|values|email|phone|token|timezone/)
  await React.act(async () => root.unmount()); root = createRoot(w.document.getElementById('root')!); await mount()

  // The server already committed the message, but a malformed response fails parsing. Recovery must only GET.
  let corrupt = true
  f.state.after = async (r, response) => {
    if (corrupt && (r.path.endsWith('/ai/chat') || r.path.includes('/ai/chat/operations/')) && response.status === 200) {
      const body = await response.json(); const result = r.path.endsWith('/ai/chat') ? body : body.result
      if (result?.bookingChoices?.length) result.bookingChoices[0].conversationId = 'foreign-conversation'
      return Response.json(body)
    }
    return response
  }
  await send('Quero outro horário.'); await until(() => w.document.querySelector('[data-testid="onboarding-chat-error"]'), 'Malformed choices were not rejected')
  const confirmedChats = chats().length; assert.equal(confirmedChats, 2)
  corrupt = false
  await click('Tentar novamente'); await until(() => !w.document.querySelector('[data-testid="onboarding-chat-error"]') && button(String(f.page.name)), 'Malformed response was not recovered by original operation')
  assert.equal(chats().length, confirmedChats, 'Choice parsing failure must never resend confirmed chat')
  assert.equal(bookings().length, 1)

  // A local booking-journal failure happens after chat acceptance and must not become a chat retry.
  await click('Recomeçar')
  const originalSetItem = w.Storage.prototype.setItem
  t.after(() => { w.Storage.prototype.setItem = originalSetItem })
  w.Storage.prototype.setItem = function (key: string, value: string) { if (key.startsWith('kloel-assistant-booking-execution:')) throw Error('booking journal unavailable'); return originalSetItem.call(this, key, value) }
  await send('Mostre os horários disponíveis.'); await until(() => w.document.querySelector('[data-testid="onboarding-booking-error"]'), 'Booking journal failure was not isolated')
  w.Storage.prototype.setItem = originalSetItem
  assert.equal(chats().length, 3); assert.equal(bookings().length, 1)
  assert.equal(w.document.querySelector('[data-testid="onboarding-chat-error"]'), null)
  assert.equal(button('Tentar novamente'), undefined)
  assert.match(w.document.querySelector('[data-testid="onboarding-test-chat"]')!.textContent!, /Escolha um horário e confirme no cartão/)
  assert.equal(button(String(f.page.name)), undefined)

  // A late response from an invalidated context cannot repopulate this step's controls.
  await click('Recomeçar')
  let release = () => {}, arrived = false, finished = false
  const held = new Promise<void>(resolve => { release = resolve }); t.after(() => release())
  f.state.after = async (r, response) => { if (r.method === 'POST' && r.path.endsWith('/ai/chat')) { arrived = true; await held; finished = true } return response }
  await send('Horários antes da troca de sessão.')
  await until(() => arrived, 'The in-flight chat did not reach the response fence')
  await React.act(async () => { await engineSession.refresh(); await settle() })
  assert.equal(chats().length, 4); assert.equal(bookings().length, 1)
  assert.equal(button(String(f.page.name)), undefined)
  assert.match(w.document.querySelector('[data-testid="onboarding-chat-error"]')!.textContent!, /resposta de chat aguardando consulta/)
  assert.doesNotMatch(w.document.querySelector('[data-testid="onboarding-test-chat"]')!.textContent!, /Escolha um horário e confirme no cartão/)
  await click('Tentar novamente')
  await until(() => !w.document.querySelector('[data-testid="onboarding-chat-error"]') && button(String(f.page.name)), 'The current session could not recover its pending chat')
  assert.equal(chats().length, 4, 'Session refresh must recover the pending operation using GET')
  assert.equal(finished, false, 'Recovery must not depend on the stale transport finishing')
  let releaseCurrent = () => {}, currentArrived = false
  const currentHeld = new Promise<void>(resolve => { releaseCurrent = resolve }); t.after(() => releaseCurrent())
  f.state.after = async (r, response) => { if (r.method === 'POST' && r.path.endsWith('/ai/chat')) { currentArrived = true; await currentHeld } return response }
  await send('Horários com a sessão atual.')
  await until(() => currentArrived, 'The current request did not reach its response fence')
  await React.act(async () => { release(); await settle() })
  await until(() => finished, 'The stale transport did not finish')
  assert.match(w.document.querySelector('[data-testid="onboarding-test-chat"]')!.textContent!, /digitando…/, 'A stale finally must not clear the current busy state')
  const transcript = w.document.querySelector('[aria-live="polite"]')!.textContent
  await send('Mensagem bloqueada durante a resposta atual.')
  assert.equal(chats().length, 5)
  assert.equal(w.document.querySelector('[aria-live="polite"]')!.textContent, transcript, 'A busy send must not append an unsent message')
  assert.equal(w.document.querySelector<HTMLInputElement>('[aria-label="Mensagem do cliente"]')!.value, 'Mensagem bloqueada durante a resposta atual.')
  await React.act(async () => { releaseCurrent(); await settle() })
  await until(() => chats().length === 5 && !w.document.body.textContent?.includes('digitando…'), 'The current session could not complete a fresh chat')
  assert.ok(button(String(f.page.name)))
  assert.equal(chats().length, 5); assert.equal(bookings().length, 1)
})
