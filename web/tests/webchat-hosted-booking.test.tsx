import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { assistantBookingUIFixture } from './engine-assistant-booking-fixture'
import { calendlyUIFixture } from './engine-calendly-fixture'
import { registerWebchatHosted } from '../../engine/src/webchat-hosted'
import { technicalOrgSlug } from '../../engine/src/company-slug'
import { randomUUID } from 'node:crypto'

/**
 * Link hospedado (/w/<empresa>/<assistente>) com o motor real em processo: o visitante vê os mesmos cartões de agendamento do widget
 * (Agendador Kloel e Calendly) e confirma a reserva pela API pública, marcada com X-Kloel-Hosted, sem cookie nem Origin.
 */
type Fixture = { calls: { path: string; method: string; body: any; headers: Headers }[]; actor: { tenantId: string }; agent: { id: string }; request: (method: any, url: string, payload?: unknown) => Promise<any> }

async function hostedPage(t: any, f: Fixture) {
  const published = await f.request('PUT', '/api/v1/webchat/hosted', { agentId: f.agent.id, assistantSlug: 'clara', greeting: 'Olá! Posso agendar para você.' }); assert.equal(published.statusCode, 200, published.body)
  const org = technicalOrgSlug(f.actor.tenantId)
  const dom = new JSDOM('<div id="root"></div>', { url: `http://127.0.0.1:4310/w/${org}/clara`, pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, sessionStorage: w.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent']) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollTo = () => {}; (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  const React = await import('react'), { createRoot } = await import('react-dom/client'), { HostedWebchat } = await import('../src/app/pages/whatsapp/webchat/HostedWebchatPage')
  let root = createRoot(w.document.getElementById('root')!)
  const settle = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
  const mount = async () => React.act(async () => { root.render(<HostedWebchat orgSlug={org} assistantSlug="clara" />); await settle() })
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  const text = () => w.document.body.textContent ?? ''
  const until = async (predicate: () => unknown, label: string) => { for (let i = 0; i < 200; i++) { if (predicate()) return; await React.act(() => settle()) } assert.fail(label + '\n' + text() + '\n' + JSON.stringify(f.calls.slice(-6).map(c => [c.method, c.path.split('?')[0]]))) }
  const button = (label: string) => [...w.document.querySelectorAll('button')].find(el => el.textContent?.trim() === label)
  const click = async (label: string) => React.act(async () => { const el = button(label); assert.ok(el, 'Botão ausente: ' + label + '\n' + text()); assert.equal(el.disabled, false, 'Botão desabilitado: ' + label); el.click(); await settle() })
  const fill = async (input: HTMLInputElement, value: string) => React.act(async () => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new w.Event('input', { bubbles: true })); await settle() })
  const send = async (message: string) => {
    await fill(w.document.querySelector('[aria-label="Mensagem"]') as HTMLInputElement, message)
    await React.act(async () => { (w.document.querySelector('[aria-label="Enviar mensagem"]') as HTMLButtonElement).click(); await settle(60) })
  }
  const remount = async () => { await React.act(async () => root.unmount()); root = createRoot(w.document.getElementById('root')!); await mount() }
  const publicCalls = (suffix: string) => f.calls.filter(c => c.path.split('?')[0] === '/api/v1/public/chat/' + suffix)
  await mount(); await until(() => text().includes('Olá! Posso agendar para você.'), 'O link hospedado não abriu')
  return { w, React, text, until, button, click, fill, send, remount, publicCalls, settle }
}
const hostedOnly = (calls: Fixture['calls']) => {
  const chat = calls.filter(c => c.path.startsWith('/api/v1/public/chat/')); assert.ok(chat.length)
  for (const c of chat) { assert.equal(c.headers.get('x-kloel-hosted'), '1', c.path); assert.equal(c.headers.get('origin'), null, c.path); assert.ok(c.path.includes('tenantId='), c.path) }
}

test('hosted link renders the Kloel booking card from chat and the visitor confirms one real reservation', async t => {
  const f = await assistantBookingUIFixture(t, (app, store) => registerWebchatHosted(app, store))
  const h = await hostedPage(t, f)
  let choice: any
  f.state.after = async (r, response) => { if (r.path.startsWith('/api/v1/public/chat/messages')) choice = (await response.clone().json()).bookingChoices?.[0]; return response }
  const action = await f.create('webchat'); f.toolRound(action)
  const googleWrites = () => f.requests.filter(r => r.method === 'POST').length, before = googleWrites()
  await h.send('Quero agendar.')
  await h.until(() => h.button(String(f.page.name)), 'O cartão de agendamento não apareceu no link hospedado')
  assert.match(h.text(), /Escolha um horário e confirme no cartão/)
  assert.equal(h.publicCalls('bookings').length, 0); assert.equal(googleWrites(), before)
  assert.ok(choice?.slots.length, 'a resposta do chat hospedado trouxe o cartão'); f.state.after = undefined
  await h.click(String(f.page.name))
  const slotLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: choice.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(choice.slots[0].startAt))
  await h.click(slotLabel); assert.equal(h.publicCalls('bookings').length, 0, 'escolher o horário não reserva')
  await h.click('Confirmar reserva')
  await h.until(() => h.text().includes('Criação da reserva confirmada'), 'A reserva iniciada no chat hospedado não foi confirmada')
  assert.equal(h.publicCalls('bookings').length, 1); assert.equal(googleWrites(), before + 1)
  const [booking] = h.publicCalls('bookings'); assert.match(booking.headers.get('authorization')!, /^Bearer [A-Za-z0-9_-]{43}$/); assert.equal(booking.body.confirm, true)
  await h.click('Gerenciar reserva')
  await h.until(() => h.w.document.querySelector('a[href*="#booking="]'), 'Link de gerenciamento ausente')
  assert.match((h.w.document.querySelector('a[href*="#booking="]') as HTMLAnchorElement).href, /^http:\/\/127\.0\.0\.1:4310\/c\/o-[a-f0-9]{24}\/[a-z0-9-]+#booking=.*&manage=/)
  hostedOnly(f.calls)
  const journal = Object.keys(h.w.sessionStorage).filter(k => k.startsWith('kloel-hosted-booking:')).map(k => h.w.sessionStorage.getItem(k)).join()
  assert.ok(journal); assert.doesNotMatch(journal, /quote|values|email|phone|manage/)
  // Recarregar a página: a referência original continua consultável só com GET, sem novo envio.
  await h.React.act(async () => { h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await h.settle() })
  // Horários de outro dia consultados pelo cartão (novo registro no mesmo turno) não viram um segundo botão.
  const token = JSON.parse(h.w.sessionStorage.getItem(`kloel-hosted:${f.actor.tenantId}:${f.channel.id}`)!).token
  const browsed = await fetch(`/api/v1/public/chat/booking-slots?${new URLSearchParams({ tenantId: f.actor.tenantId, channelId: f.channel.id })}`, { method: 'POST', headers: { 'X-Kloel-Hosted': '1', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ actionId: choice.actionId, expectedRevision: choice.actionRevision, from: choice.slots[1].startAt, to: f.to }) })
  assert.equal(browsed.status, 200, await browsed.clone().text())
  const writes = f.calls.filter(c => c.method !== 'GET').length
  await h.remount(); await h.until(() => h.button('Consultar reservas'), 'A referência da reserva não sobreviveu ao recarregamento')
  assert.equal([...h.w.document.querySelectorAll('button')].filter(b => b.textContent?.trim() === String(f.page.name)).length, 1, 'um cartão por evento agendável')
  await h.click('Consultar reservas'); await h.click('Consultar reserva 1 · Agendador')
  await h.until(() => h.text().includes('Criação da reserva confirmada'), 'A reserva não pôde ser consultada depois do recarregamento')
  assert.equal(f.calls.filter(c => c.method !== 'GET').length, writes); assert.equal(googleWrites(), before + 1)
})

test('hosted link renders the Calendly card and confirms with explicit notifications acknowledgement', async t => {
  const f = await calendlyUIFixture(t, (app, store) => registerWebchatHosted(app, store))
  const connection = await f.connect(), h = await hostedPage(t, f as unknown as Fixture)
  const action = await f.createAction(connection.id, 'webchat'); f.toolRound(action)
  const invitees = () => f.requests.filter(r => r.method === 'POST' && r.url.endsWith('/invitees')).length
  let choice: any
  f.state.after = async (r, response) => { if (r.path.startsWith('/api/v1/public/chat/messages')) choice = (await response.clone().json()).calendlyChoices?.[0]; return response }
  await h.send('Quero agendar pelo Calendly.')
  await h.until(() => h.button('Calendly sintético'), 'O cartão do Calendly não apareceu no link hospedado')
  assert.ok(choice?.slots.length, 'a resposta do chat hospedado trouxe o cartão Calendly'); f.state.after = undefined
  await h.click('Calendly sintético')
  await h.click(new Intl.DateTimeFormat('pt-BR', { timeZone: choice.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(choice.slots[0].startAt)))
  const inputs = [...h.w.document.querySelectorAll('[role="dialog"] input')] as HTMLInputElement[]
  await h.fill(inputs.find(i => i.type === 'text')!, 'Pessoa Visitante'); await h.fill(inputs.find(i => i.type === 'email')!, 'visitante@example.test')
  await h.click('Confirmar reserva'); await h.until(() => /Confirme que está ciente das notificações/.test(h.text()), 'Sem o aviso do Calendly a reserva não pode seguir')
  assert.equal(h.publicCalls('calendly-bookings').length, 0); assert.equal(invitees(), 0)
  await h.React.act(async () => { (h.w.document.querySelector('[role="dialog"] [role="checkbox"]') as HTMLButtonElement).click(); await h.settle() })
  await h.click('Confirmar reserva')
  await h.until(() => h.publicCalls('calendly-bookings').length === 1 && /Criação da reserva|Pedido de reserva aceito|Confirmação da criação pendente/.test(h.text()), 'A reserva Calendly não foi enviada pelo link hospedado')
  const [created] = h.publicCalls('calendly-bookings'); assert.equal(created.body.acknowledgeNotifications, true); assert.deepEqual(created.body.values, { name: 'Pessoa Visitante', email: 'visitante@example.test', timezone: choice.timezone })
  assert.equal(invitees(), 1)
  // Calendly aceito → o visitante verifica o evento pela rota pública e só então obtém os links do Calendly.
  if (h.button('Verificar reserva')) await h.click('Verificar reserva')
  await h.until(() => h.text().includes('Criação da reserva confirmada'), 'A reserva Calendly não foi verificada pelo link hospedado')
  await h.click('Gerenciar reserva'); await h.until(() => h.w.document.querySelector('a[href^="https://calendly.com/cancellations/"]'), 'Links do Calendly ausentes')
  assert.equal(invitees(), 1); assert.equal(h.publicCalls('calendly-bookings').length, 1); hostedOnly(f.calls)
})

test('admin view accepts the technical path when the custom address belongs to another company, and nothing else', async () => {
  const { parseHostedView } = await import('../src/services/engine/hosted-webchat')
  const view = (path: string) => ({ agentId: 'a1', channelId: 'c1', orgSlug: 'clinica-sol', customOrgSlug: 'clinica-sol', technicalSlug: 'o-0123456789abcdef01234567', available: true, reasons: [], hosted: { published: true, assistantSlug: 'clara', greeting: '', path } })
  assert.equal(parseHostedView(view('/w/clinica-sol/clara'), 'a1').hosted!.path, '/w/clinica-sol/clara')
  assert.equal(parseHostedView(view('/w/o-0123456789abcdef01234567/clara'), 'a1').hosted!.path, '/w/o-0123456789abcdef01234567/clara')
  for (const path of ['/w/outra-empresa/clara', '/w/clinica-sol/outra', 'https://evil.test/w/clinica-sol/clara']) assert.throws(() => parseHostedView(view(path), 'a1'), path)
})

test('hosted booking client: lost confirmation is recovered by its original reference, never re-sent, and survives the end of the chat', async t => {
  const f = await assistantBookingUIFixture(t, (app, store) => registerWebchatHosted(app, store))
  assert.equal((await f.request('PUT', '/api/v1/webchat/hosted', { agentId: f.agent.id, assistantSlug: 'clara' })).statusCode, 200)
  const action = await f.create('webchat'); f.toolRound(action)
  const { createHostedChat, createHostedBooking } = await import('../src/services/engine/hosted-webchat')
  const page = { tenantId: f.actor.tenantId, channelId: f.channel.id }, chat = createHostedChat(page), values = new Map<string, string>()
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  let session: { token: string; expiresAt: number } | null = await chat.start()
  const client = createHostedBooking(page, () => session, storage), reply = await chat.send(session.token, 'Quero agendar.', randomUUID())
  const [choice] = client.accept(reply); assert.equal(choice.provider, 'kloel'); assert.equal(reply.bookingChoices.length, 1)
  const rows = await client.slots(choice, f.from, f.to); assert.ok(rows.length)
  const bookings = () => f.calls.filter(c => c.method === 'POST' && c.path.startsWith('/api/v1/public/chat/bookings?'))
  f.state.after = async (r, response) => { if (r.path.startsWith('/api/v1/public/chat/bookings?')) { f.state.after = undefined; throw Error('resposta perdida depois do envio') } return response }
  await assert.rejects(client.create(rows[0], {}, false))
  const [reference] = client.references(); assert.equal(reference.provider, 'kloel'); assert.equal(bookings().length, 1)
  assert.equal((await client.consult(reference)).value.status, 'confirmed')
  assert.equal((await client.create(rows[0], {}, false)).value.key, reference.attempt.key, 'a mesma conversa/evento consulta a reserva original')
  assert.equal(bookings().length, 1)
  assert.doesNotMatch([...values.values()].join(), /quote|values|email|phone/)
  // "Nova conversa": a sessão antiga encerra; a referência continua consultável com a credencial original, mas o cartão antigo não reserva mais.
  await chat.end(session.token); session = await chat.start()
  assert.equal((await createHostedBooking(page, () => session, storage).consult(reference)).value.status, 'confirmed')
  await assert.rejects(client.create(rows[1], {}, false), /conversa foi encerrada/)
  assert.equal(bookings().length, 1)
  for (const c of f.calls.filter(c => c.path.startsWith('/api/v1/public/chat/'))) assert.equal(c.headers.get('x-kloel-hosted'), '1')
})
