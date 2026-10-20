import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

function dom(url: string) {
  const d = new JSDOM('<div id="root"></div>', { url, pretendToBeVisual: true }), w = d.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w), HTMLElement: w.HTMLElement, Node: w.Node, DOMParser: w.DOMParser, MutationObserver: w.MutationObserver, NodeFilter: w.NodeFilter, Event: w.Event, CustomEvent: w.CustomEvent, KeyboardEvent: w.KeyboardEvent, MouseEvent: w.MouseEvent, PointerEvent: (w as any).PointerEvent ?? w.MouseEvent, FocusEvent: w.FocusEvent, sessionStorage: w.sessionStorage, localStorage: w.localStorage })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  for (const key of Object.getOwnPropertyNames(w)) if (/^(HTML|SVG)\w*Element$|^(Element|Text|Document|DocumentFragment)$/.test(key)) (globalThis as any)[key] = (w as any)[key]
  ;(w as any).ResizeObserver = (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  ;(w.HTMLElement.prototype as any).scrollIntoView = () => {}
  ;(w.HTMLElement.prototype as any).hasPointerCapture = () => false
  ;(w.HTMLElement.prototype as any).releasePointerCapture = () => {}
  return d
}
const leafTexts = (root: Element) => [...root.querySelectorAll('*')].filter(el => el.children.length === 0 && el.textContent?.trim()).map(el => el.textContent!.trim())
const buttonByText = (w: Window, text: string) => [...w.document.querySelectorAll('button')].find(b => b.textContent?.trim() === text) as HTMLButtonElement | undefined
async function type(React: typeof import('react'), el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  await React.act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })) })
}
const tick = (React: typeof import('react')) => React.act(async () => { await new Promise(r => setTimeout(r, 0)) })

test('scheduler without event types shows Fonio controls "Adicionar ao agente" and "Abrir página de reserva" disabled; with a published event both work', async t => {
  const d = dom('http://127.0.0.1:4422/app/scheduling'), w = d.window
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { createMemoryRouter, RouterProvider } = await import('react-router-dom')
  const { default: SchedulingPage } = await import('../src/app/pages/scheduling/SchedulingPage')
  const routerAt = (path: string) => createMemoryRouter([{ path: '/app/scheduling/:eventTypeId?/:tab?', element: <SchedulingPage /> }], { initialEntries: [path] })
  const { useStore } = await import('../src/data/store')
  const original = useStore.getState().db
  useStore.setState({ db: { ...original, eventTypes: [], agents: [], engineScheduling: { publicBaseUrl: 'http://127.0.0.1:4422', bookingsReadable: true, calendars: [] } } as any })
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); useStore.setState({ db: original }); d.window.close() })
  await React.act(async () => root.render(<RouterProvider router={routerAt('/app/scheduling')} />))
  const texts = leafTexts(w.document.body)
  for (const expected of ['Selecione um tipo de evento', 'Geral', 'Disponibilidade', 'Notificações', 'Coleta de dados', 'Agentes', 'Avançado', 'Conecte um calendário do Google ou da Microsoft para usar nos seus agendamentos.', 'Adicionar ao agente', 'Abrir página de reserva'])
    assert.ok(texts.includes(expected), `missing leaf text: ${expected}`)
  assert.ok(texts.filter(x => x === 'Conecte um calendário e crie um tipo de evento').length >= 1)
  const add = w.document.querySelector('button[aria-label="Adicionar ao agente"]') as HTMLButtonElement, open = buttonByText(w, 'Abrir página de reserva')!
  assert.equal(add.disabled, true); assert.equal(open.disabled, true)

  // A published event type enables both: the page opens /c/<org>/<event> and the agent menu lists assistants.
  const { projectEvent } = await import('../src/services/casca/scheduling')
  const { newEventConfig } = await import('../src/services/engine/scheduling')
  const calendarId = '0c6f8e8a-6a9e-4c3c-9b5f-6c1f2c1d9a11'
  const orgId = 'tenant'
  const engineEvent = { ...newEventConfig(calendarId), id: '1d3c3b9e-7b51-4e8e-a8f0-5a7f1c0b2d22', tenantId: orgId, revision: 2, slug: 'avaliacao', name: 'Avaliação', createdAt: '2026-10-01T10:00:00.000Z', publicationStatus: 'published' as const, publicPath: '/c/o-0123456789abcdef01234567/avaliacao' }
  const opened: string[] = []; (w as any).open = (url: string) => { opened.push(url); return null }
  await React.act(async () => useStore.setState({ db: { ...useStore.getState().db, session: { userId: 'owner', orgId }, organizations: [{ id: orgId, name: 'Clínica', slug: 'clinica' } as any], eventTypes: [projectEvent(engineEvent)], agents: [{ id: 'agent-1', orgId, name: 'Roberta', scheduling: [] } as any],
    engineScheduling: { publicBaseUrl: 'http://127.0.0.1:4422', bookingsReadable: true, calendars: [{ id: calendarId, email: 'Agenda · dono@empresa.com', provider: 'google', timezone: 'America/Sao_Paulo' }] } } as any }))
  await React.act(async () => root.render(<RouterProvider router={routerAt(`/app/scheduling/${engineEvent.id}/general`)} />))
  await tick(React)
  const enabledOpen = [...w.document.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Abrir página de reserva').at(-1) as HTMLButtonElement
  const enabledAdd = w.document.querySelector('button[aria-label="Adicionar ao agente"]') as HTMLButtonElement
  assert.equal(enabledOpen.disabled, false); assert.equal(enabledAdd.disabled, false)
  await React.act(async () => enabledOpen.click()); assert.deepEqual(opened, ['/c/o-0123456789abcdef01234567/avaliacao'])
  await React.act(async () => { enabledAdd.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  assert.match(w.document.body.textContent!, /Adicionar a um assistente/); assert.match(w.document.body.textContent!, /Roberta/)
})

test('public booking page shows location, host, custom fields, meeting link and sends the cancellation reason', async t => {
  const org = 'o-0123456789abcdef01234567', tomorrow = new Date(Date.now() + 86400000), day = tomorrow.toISOString().slice(0, 10)
  const d = dom(`http://127.0.0.1:4422/c/${org}/avaliacao?date=${day}`), w = d.window
  const slotStart = new Date(`${day}T15:00:00.000Z`).toISOString(), slotEnd = new Date(Date.parse(slotStart) + 1800000).toISOString(), bookingRef = '5f0c2b1a-3d4e-4f5a-8b6c-7d8e9f0a1b2c'
  const token = (c: string) => c.repeat(43)
  const calls: { path: string; body?: any; auth?: string | null }[] = []
  let status = 'confirmed'
  const receipt = () => ({ bookingRef, revision: 1, status, startAt: slotStart, endAt: slotEnd, timezone: 'America/Sao_Paulo', notifications: 'not_sent', inviteeEmail: 'enabled', meetingUrl: 'https://meet.google.com/abc-defg-hij', rescheduleAllowed: true, cancelAllowed: true })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://127.0.0.1:4422'), path = url.pathname.replace('/api/v1/public/booking/', ''), body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, body, auth: new Headers(init.headers).get('authorization') })
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path === 'company') return json({ orgSlug: org, name: 'Clínica Bem Viver', page: 1, limit: 100, total: 1, totalPages: 1, items: [{ orgSlug: org, eventSlug: 'avaliacao', name: 'Avaliação', description: 'Primeira consulta', timezone: 'America/Sao_Paulo', durationMinutes: 30, horizonDays: 30, minimumNoticeMinutes: 0,
      form: [{ field: 'name', label: 'Nome', required: true }, { field: 'email', label: 'E-mail', required: true }, { field: 'phone', label: 'Telefone', required: false }], location: { kind: 'online', address: '', phone: '' },
      customFields: [{ id: 'dc_conv', label: 'Convênio', type: 'text', required: true }], hostDisplayName: 'Dra. Ana', confirmationMessage: 'Chegue 10 minutos antes.', allowCancel: true, allowReschedule: true, emailNotifications: 'enabled', listed: true }] })
    if (path === 'sessions') return json({ token: token('a'), expiresAt: Date.now() + 3600000 })
    if (path === 'slots') return json({ timezone: 'America/Sao_Paulo', slots: [{ startAt: slotStart, endAt: slotEnd, quote: token('q'), expiresAt: Date.now() + 300000 }], complete: true, remoteAvailabilityComplete: true, reservationsGuaranteed: false })
    if (path === 'bookings') return json(receipt())
    if (path === 'manage-token') return json({ token: token('m'), expiresAt: Date.now() + 86400000, bookingRef })
    if (path === 'manage-status') return json(receipt())
    if (path === 'cancel') { status = 'cancelled'; return json(receipt()) }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { MemoryRouter, Routes, Route } = await import('react-router-dom')
  const { default: BookingPublicPage } = await import('../src/app/pages/scheduling/BookingPublicPage')
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; d.window.close() })
  await React.act(async () => root.render(<MemoryRouter initialEntries={[`/c/${org}/avaliacao?date=${day}`]}><Routes><Route path="/c/:orgSlug/:eventSlug?" element={<BookingPublicPage />} /></Routes></MemoryRouter>))
  for (let i = 0; i < 5; i++) await tick(React)
  const text = w.document.body.textContent!
  assert.match(text, /Reunião online/); assert.match(text, /Dra\. Ana/)
  const time = [...w.document.querySelectorAll('button')].find(b => /^\d\d:\d\d$/.test(b.textContent!.trim()))!
  assert.ok(time, 'slot button'); await React.act(async () => time.click())
  assert.ok(w.document.querySelector('#f-c_dc_conv'), 'custom field rendered')
  await type(React, w.document.querySelector('#f-__name') as HTMLInputElement, 'Ana Souza')
  await type(React, w.document.querySelector('#f-__email') as HTMLInputElement, 'ana@cliente.com.br')
  await type(React, w.document.querySelector('#f-__phone') as HTMLInputElement, '(11) 99999-0000')
  await type(React, w.document.querySelector('#f-c_dc_conv') as HTMLInputElement, 'Unimed')
  await React.act(async () => { (w.document.querySelector('form') as HTMLFormElement).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })) })
  for (let i = 0; i < 5; i++) await tick(React)
  const booked = calls.find(c => c.path === 'bookings')!
  assert.deepEqual(booked.body.values, { name: 'Ana Souza', email: 'ana@cliente.com.br', phone: '+5511999990000', c_dc_conv: 'Unimed' })
  const after = w.document.body.textContent!
  assert.match(after, /Agendamento confirmado/); assert.match(after, /Você receberá a confirmação por e-mail/); assert.match(after, /Chegue 10 minutos antes\./)
  assert.equal((w.document.querySelector('[data-testid="meeting-link"]') as HTMLAnchorElement).href, 'https://meet.google.com/abc-defg-hij')
  await React.act(async () => buttonByText(w, 'Cancelar agendamento')!.click())
  await type(React, w.document.querySelector('#cancel-reason') as HTMLTextAreaElement, 'Surgiu um imprevisto')
  const confirm = [...w.document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find(b => b.textContent?.trim() === 'Cancelar agendamento') as HTMLButtonElement
  await React.act(async () => confirm.click()); for (let i = 0; i < 5; i++) await tick(React)
  const cancel = calls.find(c => c.path === 'cancel')!
  assert.equal(cancel.body.reason, 'Surgiu um imprevisto'); assert.equal(cancel.auth, `BookingManage ${token('m')}`)
  assert.match(w.document.body.textContent!, /Agendamento cancelado/)
})

test('notifications tab no longer claims sending is unavailable and its preferences can be changed', async t => {
  const d = dom('http://127.0.0.1:4422/app/scheduling/x/notifications'), w = d.window
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router-dom')
  const { NotificationsTab, NotificationPrefs, notificationErrors } = await import('../src/app/pages/scheduling/NotificationsTab')
  const { normalizeEventType } = await import('../src/app/pages/scheduling/model')
  let draft = normalizeEventType({ id: 'et', orgId: 'org', name: 'Consulta', slug: 'consulta', durationMin: 30, description: '', location: 'phone', availability: [], bufferMin: 0, minNoticeHours: 1, maxDaysAhead: 30,
    notifications: { confirmationEmail: true, reminderEmail: false, reminderHours: 24, smsReminder: false, notifyTeam: false }, dataCollection: [], agentIds: [], advanced: { allowCancel: true, allowReschedule: true, slotIntervalMin: 15, maxPerDay: 10 }, createdAt: '' } as any, 'Clínica')
  const set = (fn: (x: typeof draft) => typeof draft) => { draft = fn(draft) }
  const root = createRoot(w.document.getElementById('root')!)
  t.after(async () => { await React.act(async () => root.unmount()); d.window.close() })
  await React.act(async () => root.render(<MemoryRouter><NotificationPrefs draft={draft} set={set} /><NotificationsTab draft={draft} set={set} errors={{}} /></MemoryRouter>))
  const text = w.document.body.textContent!
  assert.doesNotMatch(text, /ainda não está disponível|não ativam envios/)
  assert.match(text, /via Kloel/)
  assert.deepEqual(notificationErrors({ ...draft, templates: { ...draft.templates!, emailSenderName: '' } }), {}, 'empty sender falls back to the company name')
  assert.ok(notificationErrors({ ...draft, templates: { ...draft.templates!, email: { ...draft.templates!.email, confirmation: { subject: '', body: 'x' } } } })['tpl-email-confirmation-subject'])
})
