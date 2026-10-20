import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import Fastify from 'fastify';
import { PUBLIC_BOOKING_HTML, PUBLIC_BOOKING_JS, PUBLIC_BOOKING_CSS, registerPublicBookingUI } from '../src/public-booking-ui.js';
import { registerPublicBooking } from '../src/public-booking.js';
import { PublicBookingService } from '../src/public-booking/service.js';
import { Store } from '../src/store.js';
import { seedMember } from './fixtures/membership.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { tokenContext } from '../src/oauth/access.js';
import { validateEventTypeConfig } from '../src/scheduling/service.js';

const origin = 'http://127.0.0.1:4310'; const path = '/c/o-0123456789abcdef01234567/consulta'; const visitor = 'v'.repeat(43), manage = 'm'.repeat(43), quote = 'q'.repeat(43); const reference = randomUUID();
const page = { name: 'Consulta Kloel', description: 'Uma conversa de 30 minutos.', durationMinutes: 30, timezone: 'America/Sao_Paulo', form: [{ field: 'name', label: 'Nome completo', required: true }, { field: 'email', label: 'Seu e-mail', required: true }] };
const receipt = { bookingRef: reference, revision: 1, status: 'confirmed', startAt: '2026-10-20T12:00:00.000Z', endAt: '2026-10-20T12:30:00.000Z', timezone: 'America/Sao_Paulo' };
type Request = { url: URL; init: RequestInit; body?: any };
type Handler = (r: Request) => Response | Promise<Response>;
async function until(predicate: () => boolean) { for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('DOM did not reach expected state'); }
function harness(handler: Handler, options: { hash?: string; stored?: string; path?: string } = {}) {
  const errors: unknown[] = []; const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error));
  const browserPath = options.path ?? path;
  const dom = new JSDOM(PUBLIC_BOOKING_HTML, { url: origin + browserPath + (options.hash ?? ''), runScripts: 'outside-only', virtualConsole }); const w = dom.window; const requests: Request[] = [];
  Object.defineProperty(w.crypto, 'randomUUID', { value: randomUUID });
  if (options.stored) w.sessionStorage.setItem('kloel.booking.v1:' + browserPath, options.stored);
  (w as any).fetch = async (input: string, init: RequestInit) => {
    const url = new URL(input, origin); assert.equal(url.origin, origin); assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.cache, 'no-store');
    assert.equal(w.location.hash, ''); assert.ok(!url.toString().includes(visitor)); assert.ok(!url.toString().includes(manage));
    const request = { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined }; requests.push(request); return handler(request);
  };
  const $ = (id: string) => w.document.getElementById(id) as HTMLInputElement & HTMLButtonElement;
  const submit = (id: string) => $(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  w.eval(PUBLIC_BOOKING_JS);
  return { dom, w, $, submit, requests, errors, stored: () => w.sessionStorage.getItem('kloel.booking.v1:' + browserPath)! };
}
function defaults(r: Request): Response {
  const part = r.url.pathname.split('/').at(-1);
  if (part === 'page') return Response.json(page);
  if (part === 'sessions') return Response.json({ token: visitor, expiresAt: Date.now() + 43200000 });
  if (part === 'slots') return Response.json({ timezone: page.timezone, slots: [{ startAt: receipt.startAt, endAt: receipt.endAt, quote, expiresAt: Date.now() + 300000 }], complete: true, remoteAvailabilityComplete: true });
  if (part === 'bookings' || part === 'status') return Response.json(receipt);
  if (part === 'manage-status') return Response.json({ ...receipt, rescheduleAllowed: true });
  if (part === 'manage-token') return Response.json({ token: manage, expiresAt: Date.now() + 86400000, bookingRef: reference });
  if (part === 'cancel') return Response.json({ ...receipt, status: 'cancelled' });
  throw new Error('unexpected route');
}
async function selectAndFill(h: ReturnType<typeof harness>) {
  await until(() => !h.$('choose').hidden && !h.$('search-fields').disabled);
  h.$('booking-date').value = '2026-10-20'; h.submit('search-form'); await until(() => !!h.$('slots').querySelector('button'));
  (h.$('slots').querySelector('button') as HTMLButtonElement).click(); h.$('visitor-name').value = 'Visitante de teste'; h.$('visitor-email').value = 'visitor@example.test';
}

test('HTML and static assets use local CSP, no-store, accessible controls and mapped palette', async t => {
  const app = Fastify(); t.after(() => app.close()); await registerPublicBookingUI(app);
  const response = await app.inject(path); assert.equal(response.statusCode, 200); assert.match(String(response.headers['content-security-policy']), /script-src 'self'/); assert.match(String(response.headers['content-security-policy']), /form-action 'none'/); assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.match(response.body, /lang="pt-BR"/); assert.match(response.body, /aria-live="polite"/); assert.match(response.body, /<label for="booking-date">/); assert.match(PUBLIC_BOOKING_CSS, /238\.09 88\.7% 65\.29%/); assert.match(PUBLIC_BOOKING_CSS, /prefers-reduced-motion/);
  assert.ok(!PUBLIC_BOOKING_JS.includes('innerHTML')); assert.ok(!PUBLIC_BOOKING_JS.includes('console.')); assert.ok(!PUBLIC_BOOKING_HTML.includes('https://')); assert.ok(!PUBLIC_BOOKING_CSS.includes('@import'));
  assert.equal((await app.inject('/booking.js')).headers['cache-control'], 'no-store'); assert.equal((await app.inject('/booking.css')).headers['cache-control'], 'no-store'); assert.equal((await app.inject('/c/o-invalid/consulta')).statusCode, 404);
});

test('DOM books actual configured fields and uses displayed timezone boundaries without cookie authority', async t => {
  const h = harness(defaults); t.after(() => h.dom.window.close()); await selectAndFill(h);
  const slots = h.requests.find(r => r.url.pathname.endsWith('/slots'))!; assert.deepEqual(slots.body, { from: '2026-10-20T03:00:00.000Z', to: '2026-10-21T03:00:00.000Z' });
  assert.equal(new Headers(slots.init.headers).get('authorization'), 'Booking ' + visitor); assert.match(h.$('selected-time').textContent!, /09:00/);
  h.submit('booking-form'); await until(() => h.$('result-title').textContent === 'Reserva confirmada');
  const booking = h.requests.find(r => r.url.pathname.endsWith('/bookings'))!; assert.deepEqual(booking.body.values, { name: 'Visitante de teste', email: 'visitor@example.test' }); assert.match(booking.body.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(h.$('visitor-email').value, ''); assert.ok(!h.stored().includes('visitor@example.test')); assert.match(h.$('result-detail').textContent!, /Nenhum e-mail/); assert.deepEqual(h.errors, []);
});

test('lost response and reload preserve exact idempotency key and payload until own receipt arrives', async t => {
  const attempts: any[] = []; let fail = true;
  const handler: Handler = r => { if (r.url.pathname.endsWith('/bookings')) { attempts.push(r.body); if (fail) throw new Error('synthetic lost response'); } return defaults(r); };
  const first = harness(handler); t.after(() => first.dom.window.close()); await selectAndFill(first); first.submit('booking-form'); await until(() => first.$('result-title').textContent === 'Resultado ainda não confirmado');
  assert.equal(attempts.length, 1); assert.equal(first.$('retry-request').hidden, false); const saved = first.stored();
  fail = false; const reloaded = harness(handler, { stored: saved }); t.after(() => reloaded.dom.window.close()); await until(() => reloaded.$('retry-request').hidden === false && reloaded.$('page-title').textContent === page.name);
  assert.equal(attempts.length, 1); reloaded.$('retry-request').click(); await until(() => reloaded.$('result-title').textContent === 'Reserva confirmada');
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[1], attempts[0]); assert.ok(!reloaded.stored().includes('visitor@example.test')); assert.equal(JSON.parse(reloaded.stored()).pending, undefined);
});

test('uncertain server state is displayed honestly and does not offer a second booking', async t => {
  const h = harness(r => r.url.pathname.endsWith('/bookings') ? Response.json({ ...receipt, status: 'unknown' }) : defaults(r)); t.after(() => h.dom.window.close()); await selectAndFill(h); h.submit('booking-form'); await until(() => h.$('result-title').textContent === 'Aguardando verificação');
  assert.equal(h.$('new-booking').hidden, true); assert.equal(h.$('choose').hidden, true); assert.equal(h.$('ask-cancel').hidden, true); assert.equal(h.$('refresh-status').hidden, false); assert.match(h.$('result-detail').textContent!, /Não faça outra reserva/);
});

test('fragment capability is consumed before fetch and cancellation requires explicit confirmation even if page unpublished', async t => {
  const h = harness(r => r.url.pathname.endsWith('/page') ? Response.json({ error: { code: 'booking_page_unavailable' } }, { status: 403 }) : defaults(r), { hash: '#booking=' + reference + '&manage=' + manage }); t.after(() => h.dom.window.close());
  await until(() => h.$('notice').textContent!.includes('não está disponível')); assert.equal(h.w.location.hash, ''); assert.equal(h.requests.length, 2); assert.equal(h.$('ask-cancel').hidden, false); assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 0); assert.ok(!h.$('page-description').textContent!.includes('Carregando'));
  h.$('ask-cancel').click(); assert.equal(h.requests.length, 2); assert.equal(h.$('cancel-confirm').hidden, false); h.$('keep-booking').click(); assert.equal(h.requests.length, 2);
  h.$('ask-cancel').click(); h.$('confirm-cancel').click(); await until(() => h.$('result-title').textContent === 'Reserva cancelada');
  const cancel = h.requests.find(r => r.url.pathname.endsWith('/cancel'))!; assert.equal(new Headers(cancel.init.headers).get('authorization'), 'BookingManage ' + manage); assert.equal(cancel.body.bookingRef, reference); assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/sessions')).length, 0);
});

test('management link uses fragment, and cancel timeout cannot become confirmed on reload', async t => {
  let timeoutCancel = false;
  const h = harness(r => { if (timeoutCancel && r.url.pathname.endsWith('/cancel')) throw new Error('synthetic timeout'); return defaults(r); }); t.after(() => h.dom.window.close()); await selectAndFill(h); h.submit('booking-form'); await until(() => h.$('result-title').textContent === 'Reserva confirmada');
  h.$('get-link').click(); await until(() => !h.$('link-box').hidden); const link = new URL(h.$('management-link').value); assert.equal(link.search, ''); assert.ok(link.hash.includes(manage)); assert.ok(!link.href.includes('visitor@example.test'));
  timeoutCancel = true; h.$('ask-cancel').click(); h.$('confirm-cancel').click(); await until(() => h.$('result-title').textContent === 'Cancelamento ainda não confirmado');
  const stored = JSON.parse(h.stored()); assert.equal(stored.cancelUnconfirmed, true);
  const reloaded = harness(r => /\/(status|manage-status)$/.test(r.url.pathname) ? Response.json({ ...receipt, status: 'cancel_pending' }) : defaults(r), { stored: h.stored() }); t.after(() => reloaded.dom.window.close()); await until(() => reloaded.$('result-title').textContent === 'Cancelamento em verificação'); assert.equal(reloaded.$('new-booking').hidden, true);
});

test('slot pagination uses server cursor and preserves distinct choices', async t => {
  let count = 0; const later = { startAt: '2026-10-20T13:00:00.000Z', endAt: '2026-10-20T13:30:00.000Z', quote: 'r'.repeat(43), expiresAt: Date.now() + 300000 };
  const h = harness(r => { if (r.url.pathname.endsWith('/slots')) return Response.json(++count === 1 ? { slots: [{ startAt: receipt.startAt, endAt: receipt.endAt, quote }], complete: false, nextFrom: later.startAt } : { slots: [later], complete: true }); return defaults(r); }); t.after(() => h.dom.window.close()); await until(() => !h.$('choose').hidden); h.$('booking-date').value = '2026-10-20'; h.submit('search-form'); await until(() => !h.$('more-slots').hidden); h.$('more-slots').click(); await until(() => h.$('slots').children.length === 2);
  assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/slots'))[1].body.from, later.startAt); assert.equal(h.$('more-slots').hidden, true);
});

test('untrusted names and labels render as text, never markup or executable handlers', async t => {
  const hostile = '<img src=x onerror="window.pwned=1">'; const h = harness(r => r.url.pathname.endsWith('/page') ? Response.json({ ...page, name: hostile, description: '<script>window.pwned=2</script>', form: [{ field: 'name', label: hostile, required: true }] }) : defaults(r)); t.after(() => h.dom.window.close()); await until(() => !h.$('choose').hidden);
  assert.equal(h.$('page-title').textContent, hostile); assert.equal(h.$('form-fields').querySelectorAll('img,script').length, 0); assert.equal((h.w as any).pwned, undefined); assert.equal(h.w.document.querySelectorAll('script').length, 1);
});

test('configured phone field accepts Brazilian formats, rejects garbage and submits E.164 only for enabled fields', async t => {
  const h = harness(r => r.url.pathname.endsWith('/page') ? Response.json({ ...page, form: [{ field: 'phone', label: 'Telefone', required: true }] }) : defaults(r)); t.after(() => h.dom.window.close()); await until(() => !h.$('choose').hidden);
  h.$('booking-date').value = '2026-10-20'; h.submit('search-form'); await until(() => !!h.$('slots').querySelector('button')); (h.$('slots').querySelector('button') as HTMLButtonElement).click();
  const input = h.$('visitor-phone'); input.value = '+5511999999999'; assert.equal(input.checkValidity(), true); input.value = 'abc'; assert.equal(input.checkValidity(), false); input.value = '(11) 99999-9999'; assert.equal(input.checkValidity(), true);
  h.submit('booking-form'); await until(() => h.$('result-title').textContent === 'Reserva confirmada'); assert.deepEqual(h.requests.find(r => r.url.pathname.endsWith('/bookings'))!.body.values, { phone: '+5511999999999' });
});

test('DOM integrates real routes and persistence through create, conditional reschedule and cancel', async t => {
  const previousFetch = globalThis.fetch, previousKey = process.env.OAUTH_ENCRYPTION_KEY, previousBase = process.env.PUBLIC_BASE_URL;
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64'); process.env.PUBLIC_BASE_URL = origin;
  const store = new Store(); const app = Fastify();
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previousBase; });
  const actor = { userId: 'ui-owner', tenantId: 'ui-tenant', role: 'owner' as const }; seedMember(store, actor);
  const sessionHash = digest('ui-owner-session'); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, actor.tenantId, Date.now() + 86400000);
  const scopes = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
  const connection = store.create(actor.tenantId, 'oauth-connections', { userId: actor.userId, provider: 'google', status: 'connected', remoteId: 'ui-remote-owner', scopes, capabilities: ['calendar', 'calendar_write'], visibility: 'personal' });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'test-calendar-token', scope: scopes, expiresAt: Date.now() + 86400000 }, tokenContext(connection)) });
  const calendar = store.create(actor.tenantId, 'calendars', { enabled: true, provider: 'google', connectionId: connection.id, externalCalendarId: 'primary', timezone: 'UTC' });
  const config = validateEventTypeConfig({ name: 'Consulta real do teste', slug: 'consulta', calendarId: calendar.id, timezone: 'UTC', durationMinutes: 30, minimumNoticeMinutes: 0, availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' })), form: page.form });
  const pageRecord = store.create(actor.tenantId, 'booking-pages', { ...config, revision: 1, publicationStatus: 'draft' });
  const events = new Map<string, any>(); let writes = 0, deletes = 0, patches = 0;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input)); assert.equal(url.hostname, 'www.googleapis.com'); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-calendar-token');
    if (url.pathname.includes('/calendarList/')) return Response.json({ id: 'ui-canonical', accessRole: 'owner', primary: true });
    if (init.method === 'POST') { writes++; const event = { ...JSON.parse(String(init.body)), etag: '"ui-v1"' }; assert.deepEqual(event.attendees, []); events.set(event.id, event); return Response.json(event, { status: 201 }); }
    const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
    if (init.method === 'PATCH') { patches++; assert.equal(new Headers(init.headers).get('if-match'), '"ui-v1"'); const event = { ...events.get(id), ...JSON.parse(String(init.body)), etag: '"ui-v2"' }; events.set(id, event); return Response.json(event); }
    if (init.method === 'DELETE') { deletes++; events.delete(id); return new Response(null, { status: 204 }); }
    if (id === 'events') return Response.json({ items: [...events.values()], timeZone: 'UTC' });
    return events.has(id) ? Response.json(events.get(id)) : Response.json({}, { status: 404 });
  }) as typeof fetch;
  const published = await new PublicBookingService(store).publish(actor, sessionHash, pageRecord.id, 1);
  await registerPublicBooking(app, store); await registerPublicBookingUI(app);
  const h = harness(async r => { const headers: Record<string, string> = { origin }; new Headers(r.init.headers).forEach((value, key) => { headers[key] = value; }); const response = await app.inject({ method: r.init.method as 'GET' | 'POST', url: r.url.pathname + r.url.search, headers, ...(r.init.body ? { payload: String(r.init.body) } : {}) }); return new Response(response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } }); }, { path: published.publicPath });
  t.after(() => h.dom.window.close()); await until(() => !h.$('choose').hidden);
  h.$('booking-date').value = new Date(Date.now() + 86400000).toISOString().slice(0, 10); h.submit('search-form'); await until(() => h.$('slots').children.length > 0);
  (h.$('slots').querySelector('button') as HTMLButtonElement).click(); h.$('visitor-name').value = 'Pessoa do teste'; h.$('visitor-email').value = 'person@example.test'; h.submit('booking-form'); await until(() => h.$('result-title').textContent === 'Reserva confirmada');
  assert.equal(writes, 1); assert.equal(store.list(actor.tenantId, 'public-bookings')[0].status, 'confirmed'); assert.ok(!h.stored().includes('person@example.test'));
  const oldStart = store.list(actor.tenantId, 'public-bookings')[0].startAt;
  h.$('ask-reschedule').click(); await until(() => !h.$('choose').hidden); h.submit('search-form'); await until(() => h.$('slots').children.length > 0); (h.$('slots').querySelector('button') as HTMLButtonElement).click();
  assert.equal(patches, 0); assert.equal(h.$('reschedule-review').hidden, false); h.$('confirm-reschedule').click(); await until(() => store.list(actor.tenantId, 'public-bookings')[0].revision === 2 && h.$('result-title').textContent === 'Reserva confirmada');
  assert.equal(patches, 1); assert.equal(writes, 1); assert.equal(deletes, 0); assert.notEqual(store.list(actor.tenantId, 'public-bookings')[0].startAt, oldStart);
  h.$('ask-cancel').click(); h.$('confirm-cancel').click(); await until(() => h.$('result-title').textContent === 'Reserva cancelada');
  assert.equal(deletes, 1); assert.equal(events.size, 0); assert.equal(store.list(actor.tenantId, 'appointments')[0].status, 'cancelled'); assert.deepEqual(h.errors, []);
});

test('missing agenda closes the loading state without enabling booking', async t => {
  const h = harness(() => Response.json({ error: { code: 'booking_page_unavailable' } }, { status: 404 })); t.after(() => h.dom.window.close());
  await until(() => h.$('page-title').textContent === 'Agenda indisponível'); assert.ok(!h.$('page-description').textContent!.includes('Carregando')); assert.equal(h.$('choose').hidden, true); assert.equal(h.requests.length, 1);
});

const replacement = { startAt: '2026-10-20T14:00:00.000Z', endAt: '2026-10-20T14:30:00.000Z', quote: 'x'.repeat(43), expiresAt: Date.now() + 300000 };
function moveDefaults(r: Request): Response {
  if (r.url.pathname.endsWith('/reschedule-slots')) return Response.json({ expectedRevision: 1, slots: [replacement], complete: true });
  if (r.url.pathname.endsWith('/reschedule')) return Response.json({ ...receipt, ...replacement, revision: 2, lastRescheduleResult: 'applied' });
  return defaults(r);
}
async function selectReplacement(h: ReturnType<typeof harness>) {
  await until(() => h.$('result-title').textContent === 'Reserva confirmada'); h.$('ask-reschedule').click(); await until(() => !h.$('choose').hidden && !h.$('search-fields').disabled);
  h.$('booking-date').value = '2026-10-20'; h.submit('search-form'); await until(() => h.$('slots').children.length > 0); (h.$('slots').querySelector('button') as HTMLButtonElement).click();
}

test('management link reads own status, selects replacement and requires explicit confirmation without visitor PII', async t => {
  const h = harness(moveDefaults, { hash: '#booking=' + reference + '&manage=' + manage }); t.after(() => h.dom.window.close()); await selectReplacement(h);
  assert.equal(h.$('reschedule-review').hidden, false); assert.match(h.$('previous-time').textContent!, /09:00/); assert.match(h.$('replacement-time').textContent!, /11:00/); assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/reschedule')).length, 0);
  h.$('keep-current').click(); assert.equal(h.$('result-title').textContent, 'Reserva confirmada'); assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/reschedule')).length, 0);
  await selectReplacement(h); h.$('confirm-reschedule').click(); await until(() => JSON.parse(h.stored()).receipt.revision === 2);
  const sent = h.requests.find(r => r.url.pathname.endsWith('/reschedule'))!; assert.equal(new Headers(sent.init.headers).get('authorization'), 'BookingManage ' + manage); assert.deepEqual(Object.keys(sent.body).sort(), ['bookingRef', 'expectedRevision', 'idempotencyKey', 'quote']); assert.equal(sent.body.expectedRevision, 1); assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/sessions')).length, 0); assert.deepEqual(h.errors, []);
});

test('lost reschedule response survives reload with same key and does not mistake old revision for success', async t => {
  const attempts: any[] = []; let fail = true;
  const handler: Handler = r => { if (r.url.pathname.endsWith('/reschedule')) { attempts.push(r.body); if (fail) throw new Error('lost response'); } return moveDefaults(r); };
  const h = harness(handler, { hash: '#booking=' + reference + '&manage=' + manage }); t.after(() => h.dom.window.close()); await selectReplacement(h); h.$('confirm-reschedule').click(); await until(() => h.$('result-title').textContent === 'Resultado do reagendamento não confirmado');
  assert.equal(h.$('ask-cancel').hidden, true); assert.equal(h.$('new-booking').hidden, true); const saved = h.stored();
  const reload = harness(handler, { stored: saved }); t.after(() => reload.dom.window.close()); await until(() => reload.requests.some(r => r.url.pathname.endsWith('/manage-status')) && !reload.$('refresh-status').disabled);
  assert.equal(reload.$('result-title').textContent, 'Resultado do reagendamento não confirmado'); assert.equal(attempts.length, 1); assert.ok(JSON.parse(reload.stored()).movePending);
  fail = false; reload.$('retry-request').click(); await until(() => JSON.parse(reload.stored()).receipt.revision === 2); assert.deepEqual(attempts[1], attempts[0]); assert.equal(JSON.parse(reload.stored()).movePending, undefined); assert.equal(reload.$('result-title').textContent, 'Reserva confirmada');
});

test('server unknown reschedule shows both times and disables cancel/new request; definitive 412 keeps old time explicit', async t => {
  const h = harness(r => r.url.pathname.endsWith('/reschedule') ? Response.json({ ...receipt, status: 'reschedule_unknown', requestedTime: replacement, needsReconciliation: true }) : moveDefaults(r), { hash: '#booking=' + reference + '&manage=' + manage }); t.after(() => h.dom.window.close());
  await selectReplacement(h); h.$('confirm-reschedule').click(); await until(() => h.$('result-title').textContent === 'Reagendamento em verificação'); assert.match(h.$('result-time').textContent!, /Último horário confirmado/); assert.match(h.$('result-time').textContent!, /Novo horário solicitado/); assert.equal(h.$('ask-cancel').hidden, true); assert.equal(h.$('ask-reschedule').hidden, true); assert.equal(h.$('new-booking').hidden, true);
  const rejected = harness(r => r.url.pathname.endsWith('/reschedule') ? Response.json({ ...receipt, revision: 2, lastRescheduleResult: 'not_applied' }) : moveDefaults(r), { hash: '#booking=' + reference + '&manage=' + manage }); t.after(() => rejected.dom.window.close());
  await selectReplacement(rejected); rejected.$('confirm-reschedule').click(); await until(() => rejected.$('result-detail').textContent!.includes('não foi aplicado')); assert.match(rejected.$('result-time').textContent!, /09:00/);
});

test('unsupported reschedule is unavailable in management UI without breaking cancellation', async t => {
  const h = harness(r => r.url.pathname.endsWith('/manage-status') ? Response.json({ ...receipt, rescheduleAllowed: false, rescheduleUnavailableReason: 'booking_reschedule_unsupported' }) : defaults(r), { hash: '#booking=' + reference + '&manage=' + manage }); t.after(() => h.dom.window.close()); await until(() => h.$('result-title').textContent === 'Reserva confirmada');
  assert.equal(h.$('ask-reschedule').hidden, true); assert.equal(h.$('ask-cancel').hidden, false); assert.equal(h.requests.filter(r => r.init.method === 'POST').length, 0);
});

test('booking page shows host, location, custom fields, meeting link, e-mail promise, message and sends the cancellation reason', async t => {
  const rich = { ...page, hostDisplayName: 'Dra. Ana Lima', location: { kind: 'online', address: '', phone: '' }, customFields: [{ id: 'conv', label: 'Convênio', type: 'text', required: true }], confirmationMessage: 'Chegue 10 minutos antes.', allowCancel: true, allowReschedule: true };
  const done = { ...receipt, inviteeEmail: 'enabled', meetingUrl: 'https://meet.google.com/abc-defg-hij' };
  const h = harness(r => { const part = r.url.pathname.split('/').at(-1); if (part === 'page') return Response.json(rich); if (part === 'bookings' || part === 'status') return Response.json(done); if (part === 'manage-status') return Response.json({ ...done, rescheduleAllowed: true, cancelAllowed: true }); if (part === 'cancel') return Response.json({ ...done, status: 'cancelled' }); return defaults(r); });
  t.after(() => h.dom.window.close()); await selectAndFill(h);
  assert.equal(h.$('host-name').textContent, 'Dra. Ana Lima'); assert.equal(h.$('host-fact').hidden, false); assert.match(h.$('location-text').textContent!, /Reunião online/);
  h.$('visitor-c_conv').value = 'Unimed'; h.submit('booking-form'); await until(() => h.$('result-title').textContent === 'Reserva confirmada');
  assert.deepEqual(h.requests.find(r => r.url.pathname.endsWith('/bookings'))!.body.values, { name: 'Visitante de teste', email: 'visitor@example.test', c_conv: 'Unimed' });
  assert.match(h.$('result-detail').textContent!, /Você receberá a confirmação por e-mail/); assert.equal((h.$('meeting-link') as unknown as HTMLAnchorElement).href, 'https://meet.google.com/abc-defg-hij');
  assert.equal(h.$('result-meeting').hidden, false); assert.equal(h.$('result-message').textContent, 'Chegue 10 minutos antes.');
  h.$('ask-cancel').click(); (h.$('cancel-reason') as unknown as HTMLTextAreaElement).value = 'Imprevisto no trabalho'; h.$('confirm-cancel').click();
  await until(() => h.$('result-title').textContent === 'Reserva cancelada');
  assert.equal(h.requests.find(r => r.url.pathname.endsWith('/cancel'))!.body.reason, 'Imprevisto no trabalho'); assert.equal(h.$('result-meeting').hidden, true); assert.deepEqual(h.errors, []);
});

test('cancellation button is hidden when the organizer disabled it', async t => {
  const h = harness(r => r.url.pathname.endsWith('/page') ? Response.json({ ...page, allowCancel: false }) : defaults(r)); t.after(() => h.dom.window.close()); await selectAndFill(h);
  h.submit('booking-form'); await until(() => h.$('result-title').textContent === 'Reserva confirmada'); assert.equal(h.$('ask-cancel').hidden, true);
});
