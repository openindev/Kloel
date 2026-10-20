import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

type Call = { path: string; method: string; headers: Record<string, string>; credentials?: string; body?: any; query: URLSearchParams }
const page = { tenantId: 'tenant-a', channelId: '9b2f3c5e-6a7d-4e8f-9a0b-1c2d3e4f5a6b', assistantName: 'Clara', greeting: 'Bem-vindo ao link da Clara!', orgSlug: 'clinica', assistantSlug: 'clara' }
const token = 'T'.repeat(43)
const json = (body: unknown, status = 200) => Response.json(body, { status })

async function setup(t: any, handler: (call: Call) => Response | Promise<Response>, url = 'http://127.0.0.1:3004/w/clinica/clara') {
  const dom = new JSDOM('<div id="root"></div>', { url, pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w) })
  for (const name of ['HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event']) (globalThis as any)[name] = (w as any)[name]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: w.navigator })
  const calls: Call[] = [], originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const u = new URL(String(input), w.location.origin)
    const call: Call = { path: u.pathname, method: init.method ?? 'GET', headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), credentials: init.credentials, body: init.body ? JSON.parse(String(init.body)) : undefined, query: u.searchParams }
    calls.push(call); return handler(call)
  }) as typeof fetch
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const { HostedWebchat } = await import('../src/app/pages/whatsapp/webchat/HostedWebchatPage')
  const root = createRoot(w.document.getElementById('root')!), settle = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))
  t.after(async () => { await React.act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close() })
  await React.act(async () => { root.render(<HostedWebchat orgSlug="clinica" assistantSlug="clara" />); await settle() })
  const text = () => w.document.body.textContent ?? ''
  async function type(value: string) {
    await React.act(async () => { const input = w.document.querySelector('[aria-label="Mensagem"]') as HTMLInputElement; assert.ok(input, 'campo de mensagem'); Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new w.Event('input', { bubbles: true })); await settle() })
  }
  async function send(value: string) {
    await type(value)
    await React.act(async () => { (w.document.querySelector('[aria-label="Enviar mensagem"]') as HTMLButtonElement).click(); await settle(60) })
  }
  return { w, calls, text, send, React, settle, input: () => (w.document.querySelector('[aria-label="Mensagem"]') as HTMLInputElement | null) }
}

test('hosted page resolves the published link and chats through the public pipeline without cookies', async t => {
  const history: any[] = []
  const f = await setup(t, ({ path, method, body, headers }) => {
    if (path === '/api/v1/public/webchat/hosted') return json(page)
    if (path === '/api/v1/public/chat/sessions') { assert.equal(headers.authorization, undefined); return json({ token, expiresAt: Date.now() + 3600000, assistantName: 'Clara', greeting: 'Bem-vindo ao link da Clara!', sheetsNotice: null }, 201) }
    if (path === '/api/v1/public/chat/messages') {
      assert.equal(method, 'POST'); assert.equal(headers.authorization, `Bearer ${token}`); assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/)
      const visitor = { id: 'm1', role: 'user', authorType: 'visitor', content: body.message, createdAt: '2026-10-20T04:00:00Z' }, answer = { id: 'm2', role: 'assistant', authorType: 'ai', content: 'Atendemos das 8h às 18h.', createdAt: '2026-10-20T04:00:01Z' }
      history.push(visitor, answer); return json({ status: 'answered', message: answer, visitorMessage: visitor })
    }
    if (path === '/api/v1/public/chat/history') return json({ items: history, cursor: history.at(-1)?.id ?? null, hasMore: false, mode: 'ai' })
    return assert.fail('Unexpected request ' + path)
  })
  assert.deepEqual(Object.fromEntries(f.calls[0].query), { orgSlug: 'clinica', assistantSlug: 'clara' })
  assert.match(f.text(), /Clara/); assert.match(f.text(), /Bem-vindo ao link da Clara!/); assert.equal(f.w.document.title, 'Clara · Kloel AI')
  assert.equal(f.calls.filter(c => c.path.startsWith('/api/v1/public/chat/')).length, 0, 'abrir o link não cria conversa')
  await f.send('Qual o horário?')
  assert.match(f.text(), /Qual o horário\?/); assert.match(f.text(), /Atendemos das 8h às 18h\./)
  const chat = f.calls.filter(c => c.path.startsWith('/api/v1/public/chat/'))
  assert.deepEqual(chat.slice(0, 2).map(c => c.path.split('/').pop()), ['sessions', 'messages'])
  for (const call of chat) { assert.equal(call.headers['x-kloel-hosted'], '1'); assert.equal(call.credentials, 'omit'); assert.equal(call.query.get('tenantId'), page.tenantId); assert.equal(call.query.get('channelId'), page.channelId) }
  assert.equal(JSON.parse(f.w.sessionStorage.getItem(`kloel-hosted:${page.tenantId}:${page.channelId}`)!).token, token)
  assert.equal(f.input()!.value, '')
  assert.equal([...f.w.document.body.textContent!.matchAll(/Atendemos das 8h/g)].length, 1, 'histórico não duplica mensagens')
})

test('unpublished link shows "Chatbot indisponível"; configuration failures are honest and retryable', async t => {
  const missing = await setup(t, () => json({ error: { code: 'hosted_unavailable', message: 'Este link de chat não está disponível.' } }, 404))
  assert.match(missing.text(), /Chatbot indisponível/); assert.match(missing.text(), /não está disponível/); assert.equal(missing.input(), null)
  let attempts = 0
  const offline = await setup(t, ({ path }) => { assert.equal(path, '/api/v1/public/webchat/hosted'); attempts++; return attempts === 1 ? json({ error: { code: 'chat_not_configured', message: 'Atendimento temporariamente indisponível.' } }, 503) : json(page) })
  assert.match(offline.text(), /Atendimento indisponível/); assert.match(offline.text(), /temporariamente indisponível/)
  await offline.React.act(async () => { [...offline.w.document.querySelectorAll('button')].find(b => b.textContent?.includes('Tentar novamente'))!.click(); await offline.settle() })
  assert.match(offline.text(), /Bem-vindo ao link da Clara!/); assert.equal(attempts, 2)
})

test('a failed reply never pretends success: recorded input is kept, unsent input returns to the box', async t => {
  let recorded = false, sessions = 0
  const f = await setup(t, ({ path, body }) => {
    if (path === '/api/v1/public/webchat/hosted') return json(page)
    if (path === '/api/v1/public/chat/sessions') { sessions++; return sessions === 1 ? json({ error: { code: 'rate_limit', message: 'Aguarde um momento antes de tentar novamente.' } }, 429) : json({ token, expiresAt: Date.now() + 3600000, assistantName: 'Clara', greeting: '' }, 201) }
    if (path === '/api/v1/public/chat/messages') { recorded = true; return json({ error: { code: 'chat_provider_failed', message: 'Não foi possível responder agora.' } }, 502) }
    if (path === '/api/v1/public/chat/history') return json({ items: recorded ? [{ id: 'v1', role: 'user', authorType: 'visitor', content: 'Oi', createdAt: '2026-10-20T04:00:00Z' }] : [], cursor: recorded ? 'v1' : null, hasMore: false, mode: 'ai' })
    return assert.fail('Unexpected request ' + path + JSON.stringify(body))
  })
  await f.send('Oi')
  assert.equal(f.input()!.value, 'Oi'); assert.match(f.w.document.querySelector('[data-testid="hosted-notice"]')!.textContent!, /Aguarde um momento.*não foi enviada/)
  await f.send('Oi')
  assert.match(f.w.document.querySelector('[data-testid="hosted-notice"]')!.textContent!, /Sua mensagem foi registrada, mas a resposta não foi confirmada\. Não foi possível responder agora\./)
  assert.equal(f.input()!.value, ''); assert.match(f.text(), /Oi/)
})

test('"Nova conversa" ends the visitor session on the engine before starting over', async t => {
  const f = await setup(t, ({ path }) => {
    if (path === '/api/v1/public/webchat/hosted') return json(page)
    if (path === '/api/v1/public/chat/sessions') return json({ token, expiresAt: Date.now() + 3600000, assistantName: 'Clara', greeting: '' }, 201)
    if (path === '/api/v1/public/chat/messages') return json({ status: 'answered', message: { id: 'a1', role: 'assistant', authorType: 'ai', content: 'Resposta', createdAt: '2026-10-20T04:00:01Z' }, visitorMessage: { id: 'v1', role: 'user', authorType: 'visitor', content: 'Oi', createdAt: '2026-10-20T04:00:00Z' } })
    if (path === '/api/v1/public/chat/history') return json({ items: [], cursor: null, hasMore: false, mode: 'ai' })
    if (path === '/api/v1/public/chat/end') return json({ ended: true })
    return assert.fail('Unexpected request ' + path)
  })
  await f.send('Oi'); assert.match(f.text(), /Resposta/)
  await f.React.act(async () => { (f.w.document.querySelector('[aria-label="Nova conversa"]') as HTMLButtonElement).click(); await f.settle() })
  const end = f.calls.find(c => c.path === '/api/v1/public/chat/end'); assert.ok(end); assert.equal(end.headers.authorization, `Bearer ${token}`)
  assert.doesNotMatch(f.text(), /Resposta/); assert.match(f.text(), /Conversa encerrada/); assert.equal(f.w.sessionStorage.getItem(`kloel-hosted:${page.tenantId}:${page.channelId}`), null)
})
