import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { PUBLIC_CHAT_WIDGET } from '../src/public-chat-widget.js';
import { humanFixture, origin } from './fixtures/human-webchat.js';

async function until(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('DOM did not settle'); }
type Fixture = Awaited<ReturnType<typeof humanFixture>>;
type Request = { url: URL; init: RequestInit; body: any };
function harness(f: Fixture, options: { saved?: string; intercept?: (request: Request, result: Response) => Promise<Response> } = {}) {
  const errors: unknown[] = [], console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM('<!doctype html><body></body>', { url: origin, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console }), w = dom.window;
  const script = w.document.createElement('script'); script.src = 'https://engine.example.test/widget/kloel.js'; script.dataset.kloelTenant = f.tenantId; script.dataset.kloelChannel = f.channel.id;
  Object.defineProperty(w.document, 'currentScript', { get: () => script }); Object.defineProperty(w.crypto, 'randomUUID', { value: randomUUID });
  (w as any).AbortSignal = AbortSignal;
  let root!: ShadowRoot; const attach = w.HTMLElement.prototype.attachShadow;
  w.HTMLElement.prototype.attachShadow = function (options) { const result = attach.call(this, options); root = result as any; return result; };
  const timers = new Map<number, () => void>(); let timerIndex = 0;
  w.setTimeout = ((callback: () => void) => { const id = ++timerIndex; timers.set(id, callback); return id; }) as any; w.clearTimeout = (id: number) => { timers.delete(id); };
  const storageKey = 'kloel-chat:https://engine.example.test:' + f.tenantId + ':' + f.channel.id;
  if (options.saved) w.sessionStorage.setItem(storageKey, options.saved);
  const requests: Request[] = [];
  (w as any).fetch = async (input: string, init: RequestInit) => {
    const url = new URL(input); assert.equal(url.origin, 'https://engine.example.test'); assert.equal(init.credentials, 'omit');
    const headers = new Headers(init.headers); assert.equal(headers.has('cookie'), false);
    const request = { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined }; requests.push(request);
    const response = await f.app.inject({ method: init.method as 'GET' | 'POST', url: url.pathname + url.search, headers: { origin, ...Object.fromEntries(headers) }, ...(request.body ? { payload: request.body } : {}) });
    const result = new Response(response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } });
    return options.intercept ? options.intercept(request, result) : result;
  };
  w.eval(PUBLIC_CHAT_WIDGET);
  const button = (label: string) => [...root.querySelectorAll('button')].find(node => node.textContent === label) as HTMLButtonElement;
  const input = () => root.querySelector('input') as HTMLInputElement;
  const status = () => root.querySelector('[role=status]')!.textContent!;
  const submit = (value: string) => { input().value = value; root.querySelector('form')!.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); };
  return { dom, w, root, requests, errors, timers, button, input, status, submit, stored: () => w.sessionStorage.getItem(storageKey), async open() { button('Conversar com a Kloel').click(); await until(() => requests.some(row => row.url.pathname.endsWith('/history')) && !status().includes('Conectando')); }, async poll() { const timer = timers.entries().next().value; assert.ok(timer, 'a visible active widget schedules polling'); timers.delete(timer[0]); timer[1](); await until(() => timers.size > 0); } };
}

test('widget DOM and real routes exchange human messages, label Equipe, escape content and never call AI', async t => {
  const f = await humanFixture(t), h = harness(f); t.after(() => h.dom.window.close()); await h.open();
  const conversation = f.store.list(f.tenantId, 'conversations')[0]; await f.command(conversation.id, 'takeover'); await h.poll(); assert.match(h.status(), /equipe/);
  h.submit('Pergunta para a equipe'); await until(() => !h.input().disabled); assert.equal(f.calls.length, 0);
  await f.command(conversation.id, 'replies', '<script>not executable</script> Resposta da equipe'); await h.poll();
  const rows = [...h.root.querySelectorAll('.message')]; const human = rows.find(row => row.textContent?.includes('Resposta da equipe'))!;
  assert.equal(human.querySelector('small')!.textContent, 'Equipe'); assert.equal(human.querySelector('script'), null);
  assert.equal(h.root.querySelectorAll('.message.user').length, 1); assert.equal(rows.filter(row => row.textContent?.includes('Resposta da equipe')).length, 1);
  await h.poll(); assert.equal([...h.root.querySelectorAll('.message')].filter(row => row.textContent?.includes('Resposta da equipe')).length, 1);
  h.button('Fechar').click(); assert.equal(h.timers.size, 0); assert.equal(f.calls.length, 0); assert.deepEqual(h.errors, []);
});

test('lost human-mode visitor response survives reload with opaque attempt key and resolves only by GET', async t => {
  const f = await humanFixture(t); let lose = true;
  const h = harness(f, { intercept: async (request, result) => { if (request.url.pathname.endsWith('/messages') && lose) { lose = false; throw Error('synthetic response loss'); } return result; } }); t.after(() => h.dom.window.close()); await h.open();
  const conversation = f.store.list(f.tenantId, 'conversations')[0]; await f.command(conversation.id, 'takeover'); await h.poll();
  h.submit('BODY-MUST-NOT-PERSIST'); await until(() => h.status().includes('synthetic response loss')); const saved = h.stored()!;
  assert.ok(!saved.includes('BODY-MUST-NOT-PERSIST')); assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['attemptKey', 'expiresAt', 'token']);
  const key = JSON.parse(saved).attemptKey; assert.equal(h.button('Enviar').disabled, true);
  h.button('Fechar').click(); assert.equal(JSON.parse(h.stored()!).attemptKey, key);
  const reloaded = harness(f, { saved }); t.after(() => reloaded.dom.window.close()); await reloaded.open(); await until(() => !reloaded.input().disabled);
  assert.equal(reloaded.requests.filter(row => row.init.method === 'POST').length, 0);
  assert.equal(reloaded.requests[0].url.searchParams.get('operationKey'), key); assert.equal(JSON.parse(reloaded.stored()!).attemptKey, undefined);
  assert.equal(f.store.list(f.tenantId, 'messages').filter(row => row.content === 'BODY-MUST-NOT-PERSIST').length, 1);
  assert.equal(reloaded.root.querySelectorAll('.message.user').length, 1); assert.equal(f.calls.length, 0);
});

test('denied recovery preserves attempt reference and never repeats a POST; explicit reopen can recheck authorization', async t => {
  const f = await humanFixture(t), visitor = await f.open(); await f.command(visitor.id, 'takeover');
  const key = randomUUID(), saved = JSON.stringify({ token: visitor.token, expiresAt: Date.now() + 60000, attemptKey: key });
  let deny = true;
  const h = harness(f, { saved, intercept: async (request, result) => deny && request.url.pathname.endsWith('/history') ? Response.json({ error: { message: 'Consulta negada' } }, { status: 403 }) : result }); t.after(() => h.dom.window.close()); await h.open();
  assert.match(h.status(), /negada/); assert.equal(JSON.parse(h.stored()!).attemptKey, key); assert.equal(h.button('Enviar').disabled, true); assert.equal(h.requests.filter(row => row.init.method === 'POST').length, 0);
  deny = false; h.button('Fechar').click(); await h.open(); assert.match(h.status(), /não localizado/); assert.equal(JSON.parse(h.stored()!).attemptKey, key); assert.equal(h.requests.filter(row => row.init.method === 'POST').length, 0);
});

for (const late of ['success', 'unauthorized'] as const) test(`late history ${late} after end/new session cannot leak content, clear new token or replace cursor`, async t => {
  const f = await humanFixture(t); let hold = false, release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const h = harness(f, { intercept: async (request, result) => {
    if (hold && request.url.pathname.endsWith('/history')) { hold = false; entered(); await new Promise<void>(resolve => { release = resolve; }); return late === 'unauthorized' ? Response.json({ error: { message: 'OLD-SESSION-ERROR' } }, { status: 401 }) : result; }
    return result;
  } }); t.after(() => h.dom.window.close()); await h.open();
  const conversation = f.store.list(f.tenantId, 'conversations')[0]; await f.command(conversation.id, 'takeover'); await f.command(conversation.id, 'replies', 'OLD-SESSION-CONTENT');
  hold = true; const pendingPoll = h.poll(); await started; h.button('Encerrar').click(); await until(() => h.status().includes('Conversa encerrada'));
  h.button('Fechar').click(); await h.open(); const newToken = JSON.parse(h.stored()!).token;
  release(); await pendingPoll; await until(() => !h.input().disabled);
  assert.ok(!h.root.textContent!.includes('OLD-SESSION-CONTENT')); assert.ok(!h.status().includes('OLD-SESSION-ERROR')); assert.equal(JSON.parse(h.stored()!).token, newToken);
  await h.poll(); assert.ok(!h.status().includes('histórico')); assert.equal(h.requests.filter(row => row.url.pathname.endsWith('/sessions')).length, 2);
});

test('widget disables and stops polling for a server-closed conversation without starting another session automatically', async t => {
  const f = await humanFixture(t), h = harness(f); t.after(() => h.dom.window.close()); await h.open();
  const conversation = f.store.list(f.tenantId, 'conversations')[0]; f.store.update(f.tenantId, 'conversations', conversation.id, { status: 'closed' });
  const timer = h.timers.entries().next().value!; h.timers.delete(timer[0]); timer[1](); await until(() => h.status().includes('encerrada'));
  assert.equal(h.button('Enviar').disabled, true); assert.equal(h.timers.size, 0); assert.equal(h.requests.filter(row => row.url.pathname.endsWith('/sessions')).length, 1);
});

test('a human answer not yet polled remains before a newer visitor message when POST finishes first', async t => {
  const f = await humanFixture(t), h = harness(f); t.after(() => h.dom.window.close()); await h.open();
  const conversation = f.store.list(f.tenantId, 'conversations')[0]; await f.command(conversation.id, 'takeover'); await h.poll();
  await f.command(conversation.id, 'replies', 'HUMAN-OLDER');
  h.submit('VISITOR-NEWER'); await until(() => !h.input().disabled);
  const content = [...h.root.querySelectorAll('.message span')].map(row => row.textContent);
  assert.ok(content.indexOf('HUMAN-OLDER') >= 0); assert.ok(content.indexOf('HUMAN-OLDER') < content.indexOf('VISITOR-NEWER'));
  assert.equal(f.calls.length, 0);
});

test('known successful input stays described as recorded if the following history request fails', async t => {
  const f = await humanFixture(t); let fail = false;
  const h = harness(f, { intercept: async (request, result) => {
    if (request.url.pathname.endsWith('/messages')) fail = true;
    else if (fail && request.url.pathname.endsWith('/history')) throw Error('synthetic history unavailable');
    return result;
  } }); t.after(() => h.dom.window.close()); await h.open(); const conversation = f.store.list(f.tenantId, 'conversations')[0]; await f.command(conversation.id, 'takeover');
  h.submit('Known recorded input'); await until(() => h.status().includes('history unavailable'));
  assert.match(h.status(), /Mensagem registrada/); assert.equal(JSON.parse(h.stored()!).attemptKey, undefined);
  assert.equal(f.store.list(f.tenantId, 'messages').length, 1);
});

test('widget keeps Fonio shell brand color without changing standalone geometry', () => {
  assert.match(PUBLIC_CHAT_WIDGET, /hsl\(238\.09 88\.7% 65\.29%\)/); assert.ok(!PUBLIC_CHAT_WIDGET.includes('#164e39'));
  assert.match(PUBLIC_CHAT_WIDGET, /width:min\(370px,calc\(100vw - 32px\)\)/);
});

test('definite pre-effect rejection can resume explicitly with the same key after GET proves absence', async t => {
  const f = await humanFixture(t), h = harness(f); t.after(() => h.dom.window.close()); await h.open();
  const conversation = f.store.list(f.tenantId, 'conversations')[0]; f.store.update(f.tenantId, 'agents', f.agent.id, { status: 'paused' });
  h.submit('Same original text'); await until(() => h.status().includes('pausado')); await h.poll();
  const attempts = () => h.requests.filter(row => row.url.pathname.endsWith('/messages'));
  assert.equal(attempts().length, 1); assert.equal(f.store.list(f.tenantId, 'messages').length, 0); assert.equal(h.button('Retomar tentativa').hidden, false);
  await f.command(conversation.id, 'takeover'); h.button('Retomar tentativa').click(); await until(() => !h.input().disabled && !JSON.parse(h.stored()!).attemptKey);
  assert.equal(attempts().length, 2); assert.deepEqual(attempts()[1].body, attempts()[0].body); assert.equal(f.store.list(f.tenantId, 'messages').length, 1); assert.equal(f.calls.length, 0);
});

test('reload with unknown absent attempt requires explicit text reentry and same-key retry, never auto POST', async t => {
  const f = await humanFixture(t), visitor = await f.open(); await f.command(visitor.id, 'takeover'); const key = randomUUID();
  const h = harness(f, { saved: JSON.stringify({ token: visitor.token, expiresAt: Date.now() + 60000, attemptKey: key }) }); t.after(() => h.dom.window.close()); await h.open();
  assert.equal(h.requests.filter(row => row.init.method === 'POST').length, 0); assert.equal(h.input().value, ''); assert.equal(h.input().disabled, false);
  h.input().value = 'Reentered original text'; h.button('Retomar tentativa').click(); await until(() => h.requests.some(row => row.url.pathname.endsWith('/messages')) && !h.input().disabled);
  assert.equal(h.requests.find(row => row.url.pathname.endsWith('/messages'))!.body.idempotencyKey, key); assert.equal(f.store.list(f.tenantId, 'messages').length, 1);
});

test('unknown AI outcome with proven recorded input and no inFlight permits a new human message while retaining only its reference', async t => {
  const f = await humanFixture(t), h = harness(f); t.after(() => h.dom.window.close()); await h.open();
  f.state.respond = async () => { throw Error('synthetic AI timeout'); };
  h.submit('RECORDED-PRIVATE-BODY'); await until(() => h.status().includes('repetida automaticamente')); const key = JSON.parse(h.stored()!).attemptKey;
  await h.poll(); assert.equal(h.input().disabled, false); assert.match(h.status(), /registrada.*não foi confirmada/);
  const stored = JSON.parse(h.stored()!); assert.equal(stored.attemptKey, undefined); assert.deepEqual(stored.responseReferences, [key]); assert.ok(!h.stored()!.includes('RECORDED-PRIVATE-BODY'));
  const conversation = f.store.list(f.tenantId, 'conversations')[0]; await f.command(conversation.id, 'takeover');
  h.submit('New input for the team'); await until(() => !h.input().disabled); assert.equal(f.calls.length, 1);
  const posts = h.requests.filter(row => row.url.pathname.endsWith('/messages')); assert.equal(posts.length, 2); assert.notEqual(posts[1].body.idempotencyKey, key);
  assert.deepEqual(JSON.parse(h.stored()!).responseReferences, [key]);
});

test('history backlog advances at most two pages per polling cycle with stable message order', async t => {
  const f = await humanFixture(t), h = harness(f); t.after(() => h.dom.window.close()); await h.open(); const conversation = f.store.list(f.tenantId, 'conversations')[0];
  for (let n = 0; n < 161; n++) f.store.create(f.tenantId, 'messages', { conversationId: conversation.id, role: 'assistant', source: 'webchat', authorType: 'human', content: 'Entry-' + n });
  const histories = () => h.requests.filter(row => row.url.pathname.endsWith('/history')).length, before = histories();
  await h.poll(); assert.equal(histories() - before, 2); assert.equal(h.root.querySelectorAll('[data-message-id]').length, 160);
  await h.poll(); assert.equal(h.root.querySelectorAll('[data-message-id]').length, 161);
  assert.deepEqual([...h.root.querySelectorAll('[data-message-id] span')].map(row => row.textContent), Array.from({ length: 161 }, (_, n) => 'Entry-' + n));
});
