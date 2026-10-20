import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { registerDemoBooking } from '../src/demo-booking.js';
import { demoInstant, demoSchedule, isDemoSlotBookable } from '../src/demo-schedule.js';

/** Instante a partir do relógio de São Paulo (UTC−3) — escrito à mão para o teste não depender da própria função testada. */
const sp = (iso: string) => new Date(`${iso}-03:00`);
const view = (now: Date) => demoSchedule(now).map(d => ({ date: d.date, first: d.times[0], last: d.times[d.times.length - 1], count: d.times.length }));
const FULL = { first: '09:00', last: '18:30', count: 39 }, MONDAY = { first: '13:00', last: '18:30', count: 23 }, FRIDAY = { first: '09:00', last: '12:00', count: 13 };

test('Saturday 17/10 18:02 (the operator note example) opens Monday 19 from 13:00, Tuesday 20 and Wednesday 21 from 09:00, every 15 minutes', () => {
  const s = demoSchedule(sp('2026-10-17T18:02'));
  assert.deepEqual(view(sp('2026-10-17T18:02')), [{ date: '2026-10-19', ...MONDAY }, { date: '2026-10-20', ...FULL }, { date: '2026-10-21', ...FULL }]);
  assert.deepEqual(s[0]!.times.slice(0, 4), ['13:00', '13:15', '13:30', '13:45']);
  assert.equal(demoInstant('2026-10-19', '13:00').toISOString(), '2026-10-19T16:00:00.000Z');
  // Sunday behaves the same; weekends are never bookable
  assert.deepEqual(view(sp('2026-10-18T09:00')).map(d => d.date), ['2026-10-19', '2026-10-20', '2026-10-21']);
  assert.equal(isDemoSlotBookable('2026-10-19', '09:00', sp('2026-10-17T18:02')), false);
  assert.equal(isDemoSlotBookable('2026-10-24', '10:00', sp('2026-10-23T18:00')), false);
  assert.equal(isDemoSlotBookable('2026-10-22', '09:00', sp('2026-10-17T18:02')), false, 'the 4th business day is not bookable');
  assert.equal(isDemoSlotBookable('2026-10-20', '09:10', sp('2026-10-17T18:02')), false, 'only 15-minute steps');
});

test('the visit day counts as one of the 3 business days only while it still has future slots of the rule', () => {
  // Monday morning: Monday afternoon is still bookable and Monday is day 1 of 3
  assert.deepEqual(view(sp('2026-10-19T08:00')), [{ date: '2026-10-19', ...MONDAY }, { date: '2026-10-20', ...FULL }, { date: '2026-10-21', ...FULL }]);
  // Monday 14:07: only the future slots of Monday remain
  const afternoon = demoSchedule(sp('2026-10-19T14:07'));
  assert.equal(afternoon[0]!.date, '2026-10-19');
  assert.equal(afternoon[0]!.times[0], '14:15');
  assert.equal(isDemoSlotBookable('2026-10-19', '14:00', sp('2026-10-19T14:07')), false);
  assert.equal(isDemoSlotBookable('2026-10-19', '14:15', sp('2026-10-19T14:07')), true);
  // a slot that starts exactly now is no longer bookable
  assert.equal(isDemoSlotBookable('2026-10-19', '14:15', sp('2026-10-19T14:15')), false);
  // after 18:30 the day is over and does not count
  assert.deepEqual(view(sp('2026-10-19T18:31')).map(d => d.date), ['2026-10-20', '2026-10-21', '2026-10-22']);
});

test('Friday is morning-only (09:00–12:00, last start 12:00) and a Thursday evening visit opens Fri/Mon/Tue', () => {
  assert.deepEqual(view(sp('2026-10-22T19:00')), [{ date: '2026-10-23', ...FRIDAY }, { date: '2026-10-26', ...MONDAY }, { date: '2026-10-27', ...FULL }]);
  assert.deepEqual(view(sp('2026-10-22T10:00')).map(d => d.date), ['2026-10-22', '2026-10-23', '2026-10-26']);
  assert.equal(isDemoSlotBookable('2026-10-23', '12:00', sp('2026-10-22T19:00')), true);
  assert.equal(isDemoSlotBookable('2026-10-23', '12:15', sp('2026-10-22T19:00')), false);
  assert.equal(isDemoSlotBookable('2026-10-23', '13:00', sp('2026-10-22T19:00')), false);
  // Friday 11:50: only 12:00 remains on Friday; at 12:00 Friday is over
  assert.deepEqual(demoSchedule(sp('2026-10-23T11:50'))[0], { date: '2026-10-23', times: ['12:00'] });
  assert.deepEqual(view(sp('2026-10-23T12:00')).map(d => d.date), ['2026-10-26', '2026-10-27', '2026-10-28']);
});

test('the rule is computed in America/Sao_Paulo whatever the process time zone is', t => {
  const before = process.env.TZ;
  t.after(() => { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; });
  // Monday 19/10 12:30 in São Paulo is already Tuesday 00:30 in Tokyo and Monday 08:30 in Los Angeles
  const at = new Date('2026-10-19T15:30:00Z'), cases = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'America/Sao_Paulo'];
  const results = cases.map(tz => { process.env.TZ = tz; return { tz, schedule: demoSchedule(at), first: demoInstant('2026-10-19', '13:00').toISOString(), saturday: demoSchedule(new Date('2026-10-17T21:02:00Z')).map(d => d.date) }; });
  for (const r of results) {
    assert.equal(r.schedule[0]!.date, '2026-10-19', r.tz);
    assert.equal(r.schedule[0]!.times[0], '13:00', r.tz);
    assert.equal(r.first, '2026-10-19T16:00:00.000Z', r.tz);
    assert.deepEqual(r.schedule, results[0]!.schedule, r.tz);
    assert.deepEqual(r.saturday, ['2026-10-19', '2026-10-20', '2026-10-21'], r.tz);
  }
});

type Call = { url: string; body: any };
function fakeGoogle(busy: { start: string; end: string }[] = []) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: any, init?: RequestInit) => {
    const url = String(input), raw = init?.body;
    calls.push({ url, body: typeof raw === 'string' ? (raw.startsWith('{') ? JSON.parse(raw) : raw) : raw ? String(raw) : null });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token' });
    if (url === 'https://www.googleapis.com/calendar/v3/freeBusy') return Response.json({ calendars: { primary: { busy } } });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')) return Response.json({ id: 'evt-test-1', htmlLink: 'https://calendar.example.test/evt-test-1', hangoutLink: 'https://meet.example.test/abc-defg-hij' });
    throw new Error(`unexpected network call in test: ${url}`);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function harness(t: any, now: Date, busy: { start: string; end: string }[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'kloel-demo-booking-'));
  const keys = ['DATABASE_PATH', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DEMO_CALENDAR_ID'] as const;
  const before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { DATABASE_PATH: join(dir, 'engine.sqlite'), GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-secret' });
  delete process.env.DEMO_CALENDAR_ID;
  writeFileSync(join(dir, 'google-calendar.json'), JSON.stringify({ refresh_token: 'test-refresh-token' }));
  const google = fakeGoogle(busy), app = Fastify();
  registerDemoBooking(app, { fetchImpl: google.fetchImpl, now: () => now });
  await app.ready();
  t.after(async () => { await app.close(); for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } rmSync(dir, { recursive: true, force: true }); });
  let ip = 0;
  const book = (date: string, time: string) => app.inject({ method: 'POST', url: '/api/v1/public/demo-booking', remoteAddress: `10.0.0.${++ip}`, payload: { date, time, firstName: 'Ana', lastName: 'Teste', email: 'ana@exemplo.com.br', company: 'Empresa Teste', phone: '+5511900000000' } });
  return { app, dir, google, book };
}

test('GET busy lists the 3 bookable days of the rule and maps Google busy blocks onto 15-minute slots', async t => {
  // Tuesday 20/10 10:00–10:30 in São Paulo is busy on the (fake) calendar
  const { app, google } = await harness(t, sp('2026-10-17T18:02'), [{ start: '2026-10-20T13:00:00Z', end: '2026-10-20T13:30:00Z' }]);
  const r = await app.inject({ method: 'GET', url: '/api/v1/public/demo-booking/busy' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().days, ['2026-10-19', '2026-10-20', '2026-10-21']);
  assert.deepEqual([...r.json().busy].sort(), ['2026-10-20 09:45', '2026-10-20 10:00', '2026-10-20 10:15']);
  const fb = google.calls.find(c => c.url.endsWith('/freeBusy'))!;
  assert.equal(fb.body.timeMin, '2026-10-19T03:00:00.000Z');
  assert.equal(fb.body.timeMax, '2026-10-22T03:00:00.000Z');
  assert.ok(google.calls.every(c => !c.url.includes('/events')), 'reading availability never creates an event');
});

test('POST rejects slots outside the rule before touching the calendar and books a valid one through the injected fetch', async t => {
  const { book, google, dir } = await harness(t, sp('2026-10-22T19:00'));
  for (const [date, time] of [['2026-10-23', '12:15'], ['2026-10-23', '14:00'], ['2026-10-26', '09:00'], ['2026-10-24', '10:00'], ['2026-10-28', '09:00'], ['2026-10-22', '18:30'], ['2026-10-27', '09:05']] as const) {
    const r = await book(date, time);
    assert.equal(r.statusCode, 409, `${date} ${time}`);
    assert.equal(r.json().error.code, 'slot_unavailable');
  }
  assert.equal(google.calls.length, 0, 'invalid slots never reach Google');
  const ok = await book('2026-10-23', '12:00');
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().date, '2026-10-23');
  assert.equal(ok.json().time, '12:00');
  const ev = google.calls.find(c => c.url.includes('/events'))!;
  assert.equal(ev.body.start.dateTime, '2026-10-23T15:00:00.000Z');
  assert.equal(ev.body.end.dateTime, '2026-10-23T15:30:00.000Z');
  assert.equal(ev.body.start.timeZone, 'America/Sao_Paulo');
  const saved = JSON.parse(readFileSync(join(dir, 'demo-bookings.json'), 'utf8'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].eventId, 'evt-test-1');
});

test('POST on the visit day accepts only future slots and refuses a slot that Google reports busy', async t => {
  const { book, google, dir } = await harness(t, sp('2026-10-19T14:07'), [{ start: '2026-10-19T18:00:00Z', end: '2026-10-19T18:30:00Z' }]);
  assert.equal((await book('2026-10-19', '14:00')).statusCode, 409);
  assert.equal(google.calls.length, 0);
  const busy = await book('2026-10-19', '15:00');
  assert.equal(busy.statusCode, 409);
  assert.match(busy.json().error.message, /acabou de ser reservado/);
  assert.equal(google.calls.filter(c => c.url.includes('/events')).length, 0);
  assert.equal(existsSync(join(dir, 'demo-bookings.json')), false);
  assert.equal((await book('2026-10-19', '14:15')).statusCode, 201);
});
