import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { DEMO_TZ as SP, demoInstant, demoSchedule, isDemoSlotBookable, type DemoDay } from './demo-schedule.js';

/**
 * Agendamento público de demonstração (/agendar-demo): valida o horário pela regra única do funil (src/demo-schedule.ts: 3 próximos dias
 * úteis, 15 min, seg 13:00–18:30, ter–qui 09:00–18:30, sex 09:00–12:00, America/Sao_Paulo, só horários futuros), confere a agenda do Google
 * conectada pelo dono (google-calendar.json no volume), cria o evento com Google Meet e convida o lead (o Google envia o convite).
 */
export const DEMO_BOOKING_PATHS = ['/api/v1/public/demo-booking', '/api/v1/public/demo-booking/busy'];
const dataDir = () => dirname(process.env.DATABASE_PATH || 'data/engine.sqlite');
const store = () => resolve(dataDir(), 'demo-bookings.json');
type Booking = { id: string; date: string; time: string; timezone: string; size: string; firstName: string; lastName: string; email: string; company: string; phone: string; channels: string[]; guests: string[]; eventId?: string; meetUrl?: string; htmlLink?: string; createdAt: string; status: 'scheduled' };
const load = (): Booking[] => { try { return existsSync(store()) ? JSON.parse(readFileSync(store(), 'utf8')) : []; } catch { return []; } };
const save = (rows: Booking[]) => { mkdirSync(dataDir(), { recursive: true }); const tmp = store() + '.tmp'; writeFileSync(tmp, JSON.stringify(rows), { mode: 0o600 }); renameSync(tmp, store()); };

async function accessToken(fetchImpl: typeof fetch): Promise<string | null> {
  const f = resolve(dataDir(), 'google-calendar.json');
  if (!existsSync(f) || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  const { refresh_token } = JSON.parse(readFileSync(f, 'utf8')) as { refresh_token?: string };
  if (!refresh_token) return null;
  const r = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json() as { access_token?: string };
  return r.ok && j.access_token ? j.access_token : null;
}
const calendarId = () => encodeURIComponent(process.env.DEMO_CALENDAR_ID || 'primary');

async function busySlots(days: DemoDay[], fetchImpl: typeof fetch): Promise<Set<string>> {
  const taken = new Set(load().filter(b => b.status === 'scheduled').map(b => `${b.date} ${b.time}`));
  const token = await accessToken(fetchImpl).catch(() => null);
  if (!token || !days.length) return taken;
  const r = await fetchImpl('https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ timeMin: demoInstant(days[0]!.date, '00:00').toISOString(), timeMax: new Date(demoInstant(days[days.length - 1]!.date, '23:59').getTime() + 60_000).toISOString(), timeZone: SP, items: [{ id: process.env.DEMO_CALENDAR_ID || 'primary' }] }) }).catch(() => null);
  const j = r && r.ok ? await r.json() as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> } : {};
  const busy = Object.values(j.calendars ?? {}).flatMap(c => c.busy ?? []);
  for (const d of days) for (const t of d.times) { const s = demoInstant(d.date, t).getTime(), e = s + 30 * 60_000; if (busy.some(b => Date.parse(b.start) < e && Date.parse(b.end) > s)) taken.add(`${d.date} ${t}`); }
  return taken;
}

const body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().max(64).default(SP), size: z.string().max(20).default(''),
  firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), email: z.string().trim().toLowerCase().email().max(254), company: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(8).max(32), channels: z.array(z.string().max(80)).max(10).default([]), guests: z.array(z.string().trim().toLowerCase().email()).max(10).default([]),
  productType: z.string().max(40).optional(), source: z.string().max(80).optional(),
}).strict();
const hits = new Map<string, number[]>();
const limited = (ip: string) => { const now = Date.now(), arr = (hits.get(ip) ?? []).filter(t => now - t < 3_600_000); arr.push(now); hits.set(ip, arr); return arr.length > 8; };
const view = (b: Booking) => ({ id: b.id, date: b.date, time: b.time, timezone: b.timezone, size: b.size, name: `${b.firstName} ${b.lastName}`, email: b.email, company: b.company, guests: b.guests, meetUrl: b.meetUrl ?? null, calendarLink: b.htmlLink ?? null, status: b.status });

/** `fetchImpl`/`now` existem para teste (Google e relógio injetados); em produção valem o fetch global e o relógio real. */
export function registerDemoBooking(app: FastifyInstance, opts: { fetchImpl?: typeof fetch; now?: () => Date } = {}) {
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init)), now = opts.now ?? (() => new Date());
  app.get('/api/v1/public/demo-booking/busy', async () => { const days = demoSchedule(now()); return { days: days.map(d => d.date), busy: [...await busySlots(days, fetchImpl)] }; });
  app.get('/api/v1/public/demo-booking/:id', async (req, reply) => {
    const id = String((req.params as { id: string }).id); const b = /^[a-f0-9]{24}$/.test(id) ? load().find(r => r.id === id) : undefined;
    return b ? view(b) : reply.code(404).send({ error: { code: 'not_found', message: 'Reunião não encontrada.' } });
  });
  app.post('/api/v1/public/demo-booking', async (req, reply) => {
    if (limited(req.ip)) return reply.code(429).send({ error: { code: 'too_many', message: 'Muitas tentativas. Tente novamente mais tarde.' } });
    const p = body.safeParse(req.body); if (!p.success) return reply.code(400).send({ error: { code: 'invalid', message: 'Revise os dados do agendamento.' } });
    const d = p.data;
    if (!isDemoSlotBookable(d.date, d.time, now())) return reply.code(409).send({ error: { code: 'slot_unavailable', message: 'Este horário não está mais disponível. Escolha outro.' } });
    const token = await accessToken(fetchImpl).catch(() => null);
    if (!token) return reply.code(503).send({ error: { code: 'calendar_not_connected', message: 'A agenda de demonstrações está temporariamente indisponível. Fale com a gente pelo WhatsApp.' } });
    if ((await busySlots([{ date: d.date, times: [d.time] }], fetchImpl)).has(`${d.date} ${d.time}`)) return reply.code(409).send({ error: { code: 'slot_unavailable', message: 'Este horário acabou de ser reservado. Escolha outro.' } });
    const id = randomBytes(12).toString('hex'), start = demoInstant(d.date, d.time), end = new Date(start.getTime() + 30 * 60_000);
    const description = [`Demonstração Kloel AI agendada pelo site.`, `Nome: ${d.firstName} ${d.lastName}`, `Empresa: ${d.company}`, `Telefone: ${d.phone}`, `E-mail: ${d.email}`, d.size ? `Pessoas na equipe: ${d.size}` : '', d.channels.length ? `Canais: ${d.channels.join(', ')}` : '', d.productType ? `Produto: ${d.productType}` : '', d.source ? `Origem: ${d.source}` : ''].filter(Boolean).join('\n');
    const ev = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${calendarId()}/events?conferenceDataVersion=1&sendUpdates=all`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({
      summary: `Demonstração Kloel AI — ${d.company}`, description, start: { dateTime: start.toISOString(), timeZone: SP }, end: { dateTime: end.toISOString(), timeZone: SP },
      attendees: [{ email: d.email, displayName: `${d.firstName} ${d.lastName}` }, ...d.guests.map(email => ({ email }))],
      conferenceData: { createRequest: { requestId: id, conferenceSolutionKey: { type: 'hangoutsMeet' } } }, reminders: { useDefault: true }, extendedProperties: { private: { kloelDemoBooking: id } },
    }) });
    const j = await ev.json().catch(() => ({})) as { id?: string; htmlLink?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } };
    if (!ev.ok || !j.id) { req.log.error({ status: ev.status }, 'demo_booking_calendar_failed'); return reply.code(502).send({ error: { code: 'calendar_failed', message: 'Não foi possível confirmar na agenda. Tente novamente.' } }); }
    const meetUrl = j.hangoutLink || j.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;
    const row: Booking = { id, date: d.date, time: d.time, timezone: d.timezone, size: d.size, firstName: d.firstName, lastName: d.lastName, email: d.email, company: d.company, phone: d.phone, channels: d.channels, guests: d.guests, eventId: j.id, meetUrl, htmlLink: j.htmlLink, createdAt: new Date().toISOString(), status: 'scheduled' };
    save([...load(), row]);
    req.log.info({ id, date: d.date, time: d.time }, 'demo_booking_created');
    return reply.code(201).send(view(row));
  });
}
