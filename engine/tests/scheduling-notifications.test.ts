import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { seedMember } from './fixtures/membership.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { tokenContext } from '../src/oauth/access.js';
import { PublicBookingService } from '../src/public-booking/service.js';
import { validateEventTypeConfig, validateBookingForm, eventTypeConfigFromRecord } from '../src/scheduling/service.js';
import { initializeSchedulingNotifications, observeBookingChanges, processSchedulingNotifications, renderTemplate, notificationHistory } from '../src/scheduling-notifications.js';
import { assistantBookingFixture } from './fixtures/assistant-booking.js';
import { bookingOperatorFixture } from './fixtures/booking-operator.js';
import { bookingToolActive, withinBusinessHours } from '../src/public-booking/tool-settings.js';
import { buildApp } from '../src/app.js';

const origin = 'http://127.0.0.1:4310';
const saved = { fetch: globalThis.fetch, key: process.env.OAUTH_ENCRYPTION_KEY, resend: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM, base: process.env.PUBLIC_BASE_URL };
afterEach(() => {
  globalThis.fetch = saved.fetch;
  for (const [name, value] of [['OAUTH_ENCRYPTION_KEY', saved.key], ['RESEND_API_KEY', saved.resend], ['RESEND_FROM', saved.from], ['PUBLIC_BASE_URL', saved.base]] as const) if (value === undefined) delete process.env[name]; else process.env[name] = value;
});
const chip = (key: string) => `<span data-var="${key}" contenteditable="false" class="kv-chip">${key}</span>`;

async function fixture(settings: Record<string, unknown> = {}, options: { provider?: 'google' | 'microsoft'; meet?: boolean; mail?: boolean; form?: unknown[] } = {}) {
  const provider = options.provider ?? 'google';
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64'); process.env.PUBLIC_BASE_URL = origin;
  if (options.mail === false) { delete process.env.RESEND_API_KEY; delete process.env.RESEND_FROM; } else { process.env.RESEND_API_KEY = 're_test_fixture'; process.env.RESEND_FROM = 'Kloel <noreply@kloel.test>'; }
  const store = new Store(), actor = { userId: 'owner-n', tenantId: 'tenant-n', role: 'owner' as const }; seedMember(store, actor);
  initializeSchedulingNotifications(store);
  const sessionHash = digest('owner-cookie-n'); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, actor.tenantId, Date.now() + 86400000);
  let now = Date.now(); const service = new PublicBookingService(store, () => now);
  const scopes = provider === 'google' ? 'https://www.googleapis.com/auth/calendar' : 'Calendars.ReadWrite';
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider, userId: actor.userId, status: 'connected', remoteId: 'remote-owner-n', visibility: 'personal', capabilities: ['calendar', 'calendar_write'], scopes });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'synthetic-n', scope: scopes, expiresAt: now + 86400000 }, tokenContext(connection)) });
  const calendar = store.create(actor.tenantId, 'calendars', { provider, enabled: true, connectionId: connection.id, externalCalendarId: 'primary', timezone: 'UTC' });
  const config = validateEventTypeConfig({ name: 'Consulta', slug: 'consulta', calendarId: calendar.id, enabled: true, timezone: 'America/Sao_Paulo', durationMinutes: 30, minimumNoticeMinutes: 0, horizonDays: 30, slotIntervalMinutes: 30,
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' })), form: options.form ?? [{ field: 'name', label: 'Nome', required: true }, { field: 'email', label: 'E-mail', required: true }, { field: 'phone', label: 'Telefone', required: false }], ...settings });
  const page = store.create(actor.tenantId, 'booking-pages', { ...config, revision: 1, publicationStatus: 'draft' });
  const target = { tenantId: actor.tenantId, pageId: page.id }, events = new Map<string, any>(), calls: { url: URL; method: string; body: any }[] = [];
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    assert.match(url.hostname, /^(www\.googleapis\.com|graph\.microsoft\.com)$/); calls.push({ url, method, body });
    const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
    if (method === 'GET' && !/\/(events|calendarView)(\/|$)/.test(url.pathname)) return Response.json({ id: 'canonical-n', primary: true, accessRole: 'owner', canEdit: true, ...(options.meet ? { conferenceProperties: { allowedConferenceSolutionTypes: ['hangoutsMeet'] } } : {}), allowedOnlineMeetingProviders: ['teamsForBusiness'], defaultOnlineMeetingProvider: 'teamsForBusiness' });
    if (method === 'POST') {
      const e = { ...body, id: body.id ?? `graph-${events.size + 1}`, etag: '"v1"', ...(body.conferenceData ? { hangoutLink: 'https://meet.google.com/abc-defg-hij' } : {}), ...(body.isOnlineMeeting ? { onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' } } : {}) };
      events.set(e.id, e); return Response.json(e, { status: 201 });
    }
    if (method === 'PATCH') { const old = events.get(id); const e = { ...old, ...body, etag: `"v${calls.length}"` }; events.set(id, e); return Response.json(e); }
    if (method === 'DELETE') { events.delete(id); return new Response(null, { status: 204 }); }
    if (id === 'events' || id === 'calendarView') return Response.json(provider === 'google' ? { items: [...events.values()], timeZone: 'UTC' } : { value: [...events.values()] });
    return events.has(id) ? Response.json(events.get(id)) : Response.json({}, { status: 404 });
  }) as typeof fetch;
  await service.publish(actor, sessionHash, page.id, 1);
  const from = new Date(now + 2 * 86400000).toISOString().slice(0, 10) + 'T12:00:00.000Z', to = new Date(Date.parse(from) + 6 * 3600000).toISOString();
  const emails: any[] = [];
  const fetchImpl = (async (url: any, init: RequestInit = {}) => { assert.equal(String(url), 'https://api.resend.com/emails'); emails.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) }); return Response.json({ id: `email_${emails.length}` }); }) as typeof fetch;
  const hooks: { url: string; body: any; headers: Record<string, string> }[] = [];
  const notify = { now: () => now, fetchImpl, resolve: async () => [{ address: '93.184.216.34', family: 4 }], webhookRequest: async (url: URL, _pinned: unknown, body: string, headers: Record<string, string>) => { hooks.push({ url: url.toString(), body: JSON.parse(body), headers }); return { status: 200 }; } };
  const run = async () => { observeBookingChanges(store, now); await processSchedulingNotifications(store, notify); };
  const book = async (values: Record<string, string> = { name: 'Ana Souza', email: 'ana@cliente.test', phone: '+5511999990000' }) => {
    const visitor = service.createSession(target, origin).token, quote = (await service.slots(target, visitor, origin, { from, to })).slots[0];
    const receipt = await service.book(target, visitor, origin, { quote: quote.quote, values, idempotencyKey: randomUUID() });
    return { visitor, receipt, record: () => store.get(actor.tenantId, 'public-bookings', receipt.bookingRef)! };
  };
  return { store, actor, sessionHash, service, page, target, calendar, events, calls, emails, hooks, run, book, notify, from, to, advance: (ms: number) => { now += ms; }, now: () => now };
}
const manageOf = (text: string) => { const m = /#booking=([0-9a-f-]{36})&manage=([A-Za-z0-9_-]{43})/.exec(text); assert.ok(m, 'manage link in e-mail'); return { bookingRef: m[1], token: m[2] }; };

test('confirmation e-mail renders saved template, reaches invitee, team and fixed guests with .ics; seeded bookings never get retroactive mail', async t => {
  const f = await fixture({ staticInvitees: ['socio@empresa.test'], notifications: { invitee: true, team: true, senderName: 'Clínica Bem Viver', email: { confirmation: { subject: `${chip('booking.title')} com ${chip('guest.name')}`, body: `<div>Olá ${chip('guest.name')}, até ${chip('booking.date')} às ${chip('booking.time')}.</div><div>Gerencie: ${chip('booking.manage_url')}</div>` } }, reminders: [] } });
  t.after(() => f.store.close());
  const { receipt } = await f.book(); assert.equal(receipt.status, 'confirmed'); assert.equal(receipt.inviteeEmail, 'enabled');
  await f.run();
  assert.equal(f.emails.length, 3);
  const invitee = f.emails.find(e => e.body.to[0] === 'ana@cliente.test')!; assert.equal(invitee.body.subject, 'Consulta com Ana Souza');
  assert.match(invitee.body.from, /^"Clínica Bem Viver via Kloel" <noreply@kloel\.test>$/); assert.match(invitee.body.text, /^Olá Ana Souza, até .+ às \d\d:\d\d\./);
  assert.ok(invitee.headers.get('idempotency-key')?.startsWith('booking-notification-')); assert.equal(invitee.body.attachments[0].filename, 'convite.ics');
  const ics = Buffer.from(invitee.body.attachments[0].content, 'base64').toString(); assert.match(ics, /METHOD:PUBLISH/); assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
  const team = f.emails.find(e => e.body.to[0] === 'owner-n@example.test')!; assert.match(team.body.subject, /^Novo agendamento: Consulta — Ana Souza/); assert.match(team.body.text, /ana@cliente\.test/);
  assert.ok(f.emails.some(e => e.body.to[0] === 'socio@empresa.test'));
  await f.run(); assert.equal(f.emails.length, 3, 'one e-mail per transition');
  const history = notificationHistory(f.store, f.actor.tenantId, f.page.id); assert.equal(history.length, 3); assert.ok(history.every(h => h.status === 'accepted')); assert.ok(!JSON.stringify(history).includes('ana@cliente.test'));
  // Bookings that already existed when the feature was deployed are recorded as notified.
  const legacy = new Store(); t.after(() => legacy.close()); seedMember(legacy, f.actor);
  legacy.create(f.actor.tenantId, 'public-bookings', { status: 'confirmed', startAt: new Date(f.now() + 86400000).toISOString(), endAt: new Date(f.now() + 88200000).toISOString(), pageId: f.page.id });
  initializeSchedulingNotifications(legacy); assert.equal(observeBookingChanges(legacy, f.now()), 0); assert.equal(legacy.db.prepare('SELECT COUNT(*) AS n FROM booking_notification_jobs').get()!.n, 0);
});

test('e-mail link manages the booking without replacing the browser link; cancellation with reason is announced once', async t => {
  const f = await fixture({ notifications: { invitee: true, team: true, email: {}, reminders: [{ id: 'r1', hoursBefore: 2 }] } });
  t.after(() => f.store.close());
  const booked = await f.book(); const browser = f.service.managementToken(f.target, booked.visitor, origin, booked.receipt.bookingRef).token;
  await f.run(); const confirmation = f.emails.find(e => e.body.to[0] === 'ana@cliente.test')!;
  assert.match(confirmation.body.subject, /Consulta confirmado/); const link = manageOf(confirmation.body.text); assert.equal(link.bookingRef, booked.receipt.bookingRef);
  const status = f.service.rescheduling.status(f.target, link.token, origin, link.bookingRef); assert.equal(status.status, 'confirmed'); assert.equal(status.cancelAllowed, true);
  assert.equal(f.service.rescheduling.status(f.target, browser, origin, link.bookingRef).status, 'confirmed', 'browser link still valid');
  assert.throws(() => f.service.rescheduling.status(f.target, link.token, 'https://evil.test', link.bookingRef), (e: any) => e.code === 'booking_not_found');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM booking_notification_jobs WHERE event='reminder' AND status='queued'").get()!.n, 1);
  const cancelled = await f.service.cancel(f.target, link.token, origin, { bookingRef: link.bookingRef, idempotencyKey: randomUUID(), reason: 'Viagem de última hora' });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(f.events.size, 0);
  await f.run();
  const notice = f.emails.find(e => e.body.to[0] === 'ana@cliente.test' && /cancelado/.test(e.body.subject))!; assert.match(notice.body.text, /Motivo: Viagem de última hora/); assert.equal(notice.body.attachments[0].filename, 'cancelamento.ics');
  assert.match(Buffer.from(notice.body.attachments[0].content, 'base64').toString(), /METHOD:CANCEL/);
  assert.match(f.emails.find(e => e.body.to[0] === 'owner-n@example.test' && /cancelado/.test(e.body.subject))!.body.text, /Motivo: Viagem de última hora/);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM booking_notification_jobs WHERE event='reminder' AND status='obsolete'").get()!.n, 1);
  const count = f.emails.length; await f.run(); assert.equal(f.emails.length, count);
});

test('reschedule by e-mail link sends the new time and moves reminders; reminder goes out when due', async t => {
  const f = await fixture({ notifications: { invitee: true, team: false, email: {}, reminders: [{ id: 'r1', hoursBefore: 1 }] } });
  t.after(() => f.store.close());
  const booked = await f.book(); await f.run(); const link = manageOf(f.emails[0].body.text);
  const slots = await f.service.rescheduling.slots(f.target, link.token, origin, { bookingRef: link.bookingRef, from: f.from, to: f.to });
  const moved = await f.service.rescheduling.reschedule(f.target, link.token, origin, { bookingRef: link.bookingRef, expectedRevision: 1, quote: slots.slots[1].quote, idempotencyKey: randomUUID() });
  assert.equal(moved.status, 'confirmed'); assert.notEqual(moved.startAt, booked.receipt.startAt);
  await f.run(); const notice = f.emails.at(-1)!; assert.match(notice.body.subject, /reagendado/);
  const reminders = f.store.db.prepare("SELECT status,ref_start FROM booking_notification_jobs WHERE event='reminder' ORDER BY created_at").all();
  assert.deepEqual(reminders.map(r => r.status), ['obsolete', 'queued']); assert.equal(reminders[1].ref_start, moved.startAt);
  const sent = f.emails.length; f.advance(Date.parse(moved.startAt) - f.now() - 3500000); await f.run();
  assert.equal(f.emails.length, sent + 1); assert.match(f.emails.at(-1)!.body.subject, /^Lembrete: Consulta/); assert.equal(f.emails.at(-1)!.body.attachments, undefined);
});

test('Google Meet location creates conference data and the link reaches receipt and e-mail; address and phone go to the event', async t => {
  const f = await fixture({ location: { kind: 'online' } }, { meet: true }); t.after(() => f.store.close());
  const booked = await f.book(); const post = f.calls.find(c => c.method === 'POST')!;
  assert.equal(post.url.searchParams.get('conferenceDataVersion'), '1'); assert.equal(post.body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet'); assert.deepEqual(post.body.attendees, []);
  assert.equal(booked.receipt.meetingUrl, 'https://meet.google.com/abc-defg-hij');
  await f.run(); assert.match(f.emails[0].body.text, /Link da reunião: https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.match(Buffer.from(f.emails[0].body.attachments[0].content, 'base64').toString(), /URL:https:\/\/meet\.google\.com/);
  const page = f.service.page(f.target); assert.equal(page.location.kind, 'online');

  const g = await fixture({ location: { kind: 'online' } }, { meet: false }); t.after(() => g.store.close());
  await g.book(); const plain = g.calls.find(c => c.method === 'POST')!; assert.equal(plain.body.conferenceData, undefined, 'never asks Meet where the calendar does not allow it');

  const h = await fixture({ location: { kind: 'physical', address: 'Rua das Flores, 100 — São Paulo' }, notifications: { invitee: true, email: {}, calendar: { subject: `${chip('booking.title')} — ${chip('guest.name')}`, body: 'Telefone: {{guest.phone}}' }, reminders: [] } }); t.after(() => h.store.close());
  await h.book(); const event = h.calls.find(c => c.method === 'POST')!.body;
  assert.equal(event.location, 'Rua das Flores, 100 — São Paulo'); assert.equal(event.summary, 'Consulta — Ana Souza'); assert.equal(event.description, 'Telefone: +5511999990000');
  assert.equal(h.service.page(h.target).location.address, 'Rua das Flores, 100 — São Paulo');

  const m = await fixture({ location: { kind: 'online' } }, { provider: 'microsoft' }); t.after(() => m.store.close());
  const ms = await m.book(); const graph = m.calls.find(c => c.method === 'POST')!.body; assert.equal(graph.isOnlineMeeting, true); assert.equal(graph.onlineMeetingProvider, 'teamsForBusiness');
  assert.equal(ms.receipt.meetingUrl, 'https://teams.microsoft.com/l/meetup-join/abc');

  assert.throws(() => validateEventTypeConfig({ name: 'Ligação', slug: 'x', calendarId: f.calendar.id, timezone: 'UTC', durationMinutes: 30, availability: [{ weekday: 1, start: '09:00', end: '10:00' }], form: [], location: { kind: 'phone' } }), /telefone/);
  const phone = await fixture({ location: { kind: 'phone', phone: '+551130000000' } }); t.after(() => phone.store.close());
  await phone.book(); assert.equal(phone.calls.find(c => c.method === 'POST')!.body.location, 'Ligação telefônica: +551130000000');
});

test('cancel and reschedule switches are enforced by the engine', async t => {
  const f = await fixture({ allowCancel: false, allowReschedule: false, notifications: { invitee: true, email: {}, reminders: [] } }); t.after(() => f.store.close());
  const booked = await f.book(); const token = f.service.managementToken(f.target, booked.visitor, origin, booked.receipt.bookingRef).token;
  const status = f.service.rescheduling.status(f.target, token, origin, booked.receipt.bookingRef);
  assert.equal(status.rescheduleAllowed, false); assert.equal(status.rescheduleUnavailableReason, 'booking_reschedule_disabled'); assert.equal(status.cancelAllowed, false);
  await assert.rejects(f.service.cancel(f.target, token, origin, { bookingRef: booked.receipt.bookingRef, idempotencyKey: randomUUID() }), (e: any) => e.code === 'booking_cancel_disabled');
  await assert.rejects(f.service.rescheduling.slots(f.target, token, origin, { bookingRef: booked.receipt.bookingRef, from: f.from, to: f.to }), (e: any) => e.code === 'booking_reschedule_disabled');
  assert.equal(f.events.size, 1);
});

test('webhooks receive created and canceled events from a pinned public address; unsafe destinations are refused', async t => {
  const f = await fixture({ customFields: [{ id: 'conv', label: 'Convênio', type: 'text', required: true }], webhooks: [{ id: 'w1', url: 'https://hooks.cliente.com.br/kloel', events: ['created', 'canceled'] }], notifications: { invitee: false, email: {}, reminders: [] } });
  await assert.rejects(f.book(), (e: any) => e.code === 'booking_form_required');
  const booked = await f.book({ name: 'Ana', email: 'ana@cliente.test', c_conv: 'Unimed' }); await f.run();
  assert.equal(f.emails.length, 0, 'invitee e-mail disabled'); assert.equal(f.hooks.length, 1);
  assert.equal(f.hooks[0].url, 'https://hooks.cliente.com.br/kloel'); assert.equal(f.hooks[0].body.event, 'booking.created'); assert.equal(f.hooks[0].body.data.customFields['Convênio'], 'Unimed'); assert.equal(f.hooks[0].headers['X-Kloel-Event'], 'booking.created');
  const token = f.service.managementToken(f.target, booked.visitor, origin, booked.receipt.bookingRef).token;
  await f.service.cancel(f.target, token, origin, { bookingRef: booked.receipt.bookingRef, idempotencyKey: randomUUID() }); await f.run();
  assert.equal(f.hooks.length, 2); assert.equal(f.hooks[1].body.event, 'booking.canceled');
  assert.deepEqual(notificationHistory(f.store, f.actor.tenantId, f.page.id).map(h => h.status), ['delivered', 'delivered']);

  const app = await buildApp(f.store); t.after(() => app.close());
  const cookies = { kloel_session: 'owner-cookie-n' };
  const unsafe = await app.inject({ method: 'POST', url: `/api/v1/scheduling/event-types/${f.page.id}/webhooks/test`, cookies, payload: { url: 'https://127.0.0.1/hook' } });
  assert.equal(unsafe.statusCode, 422, unsafe.body); assert.match(unsafe.json().error.message, /URL https pública/);
  const insecure = await app.inject({ method: 'POST', url: `/api/v1/scheduling/event-types/${f.page.id}/webhooks/test`, cookies, payload: { url: 'http://hooks.cliente.com.br/x' } });
  assert.equal(insecure.statusCode, 400);
  const history = await app.inject({ method: 'GET', url: `/api/v1/scheduling/event-types/${f.page.id}/notifications`, cookies });
  assert.equal(history.statusCode, 200, history.body); assert.equal(history.json().items.length, 2); assert.equal(history.json().items[0].channel, 'webhook'); assert.equal(history.json().emailConfigured, true);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/scheduling/event-types/${f.page.id}/notifications` })).statusCode, 401);
});

test('without Resend configured nothing is faked: jobs end as not_sent and the receipt does not promise e-mail', async t => {
  const f = await fixture({}, { mail: false }); t.after(() => f.store.close());
  const booked = await f.book(); assert.equal(booked.receipt.inviteeEmail, 'disabled'); assert.equal(f.service.page(f.target).emailNotifications, 'disabled');
  await f.run(); const rows = notificationHistory(f.store, f.actor.tenantId, f.page.id);
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'not_sent'); assert.equal(rows[0].errorCode, 'email_not_configured'); assert.equal(f.emails.length, 0);
});

test('template rendering, custom field validation and assistant tool settings', async t => {
  assert.equal(renderTemplate(`<div>Oi ${chip('guest.name')} &amp; <b>bem-vindo</b></div><div>{{company.name}}</div>`, { 'guest.name': 'Ana', 'company.name': 'ACME' }), 'Oi Ana & bem-vindo\nACME');
  assert.equal(renderTemplate('<script>x</script>{{booking.title}}', { 'booking.title': 'T' }, true), 'xT');
  const f = await fixture({ customFields: [{ id: 'mail2', label: 'E-mail alternativo', type: 'email', required: false }] }); t.after(() => f.store.close());
  const config = eventTypeConfigFromRecord(f.store.get(f.actor.tenantId, 'booking-pages', f.page.id)!);
  assert.throws(() => validateBookingForm(config, { name: 'A', email: 'a@b.test', c_mail2: 'not-an-email' }), (e: any) => e.code === 'booking_form_invalid');
  assert.deepEqual(validateBookingForm(config, { name: 'A', email: 'a@b.test', c_mail2: 'x@y.test' }).custom, { mail2: 'x@y.test' });
  assert.throws(() => validateBookingForm(config, { name: 'A', other: 'x' }));

  const monday10 = new Date('2026-10-19T13:00:00Z'), sunday = new Date('2026-10-18T13:00:00Z');
  const hours = { enabled: true, timezone: 'America/Sao_Paulo', days: [{ day: 1, enabled: true, ranges: [{ from: '09:00', to: '18:00' }] }] };
  assert.equal(withinBusinessHours(hours, monday10), true); assert.equal(withinBusinessHours(hours, sunday), false);
  assert.equal(bookingToolActive({ name: '', description: '', activeWindow: 'during', allowBookingLinks: false, disableNotifications: false, businessHours: hours }, sunday), false);
  assert.equal(bookingToolActive({ name: '', description: '', activeWindow: 'outside', allowBookingLinks: false, disableNotifications: false, businessHours: hours }, sunday), true);

});

test('assistant tool honors description, booking link, active window and disabled notifications from the agent editor state', async t => {
  const f = await assistantBookingFixture(t); const action = await f.create();
  const state = (scheduling: Record<string, unknown>, businessHours?: unknown) => {
    const old = f.store.list(f.actor.tenantId, 'agent-editor-states').find(r => r.agentId === f.agent.id);
    const value = { state: { scheduling: [{ provider: 'kloel', eventTypeId: f.page.id, name: 'Agendar avaliação', ...scheduling }], ...(businessHours ? { businessHours } : {}) } };
    if (old) f.store.update(f.actor.tenantId, 'agent-editor-states', old.id, value); else f.store.create(f.actor.tenantId, 'agent-editor-states', { agentId: f.agent.id, ...value });
  };
  state({ description: 'a pessoa pedir uma avaliação gratuita', activeWindow: 'any', settings: { allowBookingLinks: true, disableNotifications: true } });
  const linkTool = `booking_link_${action.id.replaceAll('-', '')}`;
  f.aiHooks.openAI = body => body.input.some((i: any) => i.type === 'function_call_output') ? Response.json({ id: 'r2', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Pronto.' }] }] }) : Response.json({ id: 'r1', output: [{ type: 'function_call', call_id: 'link_call', name: linkTool, arguments: '{}' }] });
  const chat = await f.askPrivate(); assert.equal(chat.statusCode, 200, chat.body);
  const tools = f.openAI[0].tools.map((tool: any) => tool.name), slots = f.openAI[0].tools.find((tool: any) => tool.name.startsWith('booking_slots_'));
  assert.ok(tools.includes(linkTool)); assert.match(slots.description, /Use quando: a pessoa pedir uma avaliação gratuita/); assert.match(slots.description, /Agendar avaliação/);
  const output = JSON.parse(f.openAI[1].input.find((i: any) => i.type === 'function_call_output').output);
  assert.equal(output.ok, true); assert.match(output.url, /\/c\/o-[a-f0-9]{24}\/[a-z0-9-]+$/);
  // Disabled notifications are recorded on bookings created through this assistant.
  f.toolRound(action); const choice = (await f.askPrivate()).json().bookingChoices[0];
  const booked = await f.book(choice); assert.equal(booked.statusCode, 200, booked.body);
  assert.equal(f.store.get(f.actor.tenantId, 'public-bookings', booked.json().operation.bookingRef)!.notificationsDisabled, true);
  // Outside the configured window the tools are not offered at all.
  state({ activeWindow: 'during', settings: {} }, { enabled: true, timezone: 'UTC', days: [] });
  f.openAI.length = 0; f.toolRound(action); await f.askPrivate();
  assert.ok(!(f.openAI[0].tools ?? []).some((tool: any) => tool.name.startsWith('booking_')));
});

test('team cancellation records the typed reason and the cancellation notice carries it', async t => {
  const f = await bookingOperatorFixture(t); initializeSchedulingNotifications(f.store);
  f.store.update(f.actor.tenantId, 'booking-pages', f.page.id, { notifications: { invitee: true, team: true, email: {}, reminders: [] } });
  process.env.RESEND_API_KEY = 're_test_fixture'; process.env.RESEND_FROM = 'noreply@kloel.test';
  const emails: any[] = [], fetchImpl = (async (_url: any, init: RequestInit = {}) => { emails.push(JSON.parse(String(init.body))); return Response.json({ id: `e${emails.length}` }); }) as typeof fetch;
  observeBookingChanges(f.store); await processSchedulingNotifications(f.store, { fetchImpl });
  assert.equal(emails.length, 0, 'booking created before the feature is seeded, not re-announced');
  const key = randomUUID();
  const result = await f.request(`/api/v1/scheduling/bookings/${f.booked.bookingRef}/cancel`, { expectedTenantId: f.actor.tenantId, expectedRevision: 1, confirm: true, reason: 'Profissional indisponível' }, f.headers, key);
  assert.equal(result.statusCode, 200, result.body); assert.equal(f.record().cancelReason, 'Profissional indisponível'); assert.equal(f.record().cancelledBy, 'team');
  assert.equal((await f.reconcile()).json().status, 'cancelled');
  observeBookingChanges(f.store); await processSchedulingNotifications(f.store, { fetchImpl });
  assert.equal(emails.length, 1); assert.match(emails[0].subject, /^Agendamento cancelado/); assert.match(emails[0].text, /Motivo: Profissional indisponível/);
});
