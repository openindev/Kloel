import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../domains.js';

/**
 * Clientes HTTP dos agendadores externos do recurso "Agendar compromissos" (Cal.com API v2 e eTermin API).
 * Hosts e caminhos são fixos; a chave do cliente só sai em cabeçalho. O transporte é injetável para testes.
 */
export type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;
let injected: ProviderFetch | undefined;
export function setBookingProviderFetch(next?: ProviderFetch) { injected = next; }
const transport = (): ProviderFetch => injected ?? ((input, init) => globalThis.fetch(input, init));

export const providerNames = { calcom: 'Cal.com', etermin: 'eTermin' } as const;
export type ProviderKind = keyof typeof providerNames;
export const CAL_REGIONS = { com: 'https://api.cal.com', eu: 'https://api.cal.eu' } as const;
/** Versões datadas da API v2 do Cal.com (cada rota tem a sua; versões antigas continuam aceitas pelo provedor). */
export const CAL_VERSIONS = { eventTypes: '2024-06-14', slots: '2024-09-04', bookings: '2024-08-13' } as const;
const ETERMIN = 'https://www.etermin.net';
const hosts = new Set([...Object.values(CAL_REGIONS), ETERMIN]);

export type CalCredentials = { kind: 'calcom'; apiKey: string; region: keyof typeof CAL_REGIONS };
export type EterminCredentials = { kind: 'etermin'; publicKey: string; privateKey: string };
export type ProviderCredentials = CalCredentials | EterminCredentials;
export const calApiKey = z.string().trim().regex(/^cal_[A-Za-z0-9_-]{8,256}$/, 'Use a chave de API do Cal.com (começa com cal_).');
export const eterminPublicKey = z.string().trim().regex(/^[A-Za-z0-9-]{8,128}$/, 'Use a Public API Key do eTermin.');
export const eterminPrivateKey = z.string().trim().regex(/^[\x21-\x7e]{4,256}$/, 'Use a Private API Key do eTermin.');

export type CatalogItem = { id: string; name: string; durationMinutes: number | null; bookingUrl: string | null };
export type Slot = { startAt: string; endAt: string };
export type BookingInput = { eventTypeId: string; startAt: string; endAt: string; name: string; email: string | null; phone: string | null; timezone: string; notes: string };
export type BookingResult = { remoteId: string; startAt: string; endAt: string; status: string };

const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message); };
/** Recusa definitiva do provedor (o pedido foi lido e não executado) versus resultado desconhecido (nunca reenviado). */
export class ProviderHttpError extends DomainError { constructor(status: number, code: string, message: string, readonly outcomeUnknown: boolean, readonly httpStatus?: number) { super(status, code, message); } }

async function request(url: string, init: RequestInit & { headers: Record<string, string> }, provider: ProviderKind, timeoutMs = 15000): Promise<unknown> {
  const parsed = new URL(url);
  if (!hosts.has(parsed.origin) || parsed.username || parsed.password || parsed.hash) fail(400, 'provider_destination_invalid', 'Destino do provedor não permitido.');
  const label = providerNames[provider], write = (init.method ?? 'GET') !== 'GET';
  let response: Response;
  try { response = await transport()(parsed.href, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new ProviderHttpError(502, write ? 'provider_outcome_unknown' : 'provider_unavailable', `Não foi possível falar com o ${label}. ${write ? 'Confira a agenda antes de tentar de novo.' : 'Tente novamente.'}`, write); }
  const text = await response.text().catch(() => '');
  if (text.length > 1_000_000) throw new ProviderHttpError(502, 'provider_response_invalid', `Resposta do ${label} acima do limite.`, write, response.status);
  let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (response.status === 401 || response.status === 403) throw new ProviderHttpError(400, 'provider_credentials_rejected', `O ${label} recusou a chave de API. Confira a chave e conecte novamente.`, false, response.status);
  if (response.status === 404) throw new ProviderHttpError(404, 'provider_resource_not_found', `O ${label} não encontrou este item. Confira a seleção.`, false, response.status);
  if (response.status === 429) throw new ProviderHttpError(429, 'provider_rate_limited', `O ${label} limitou as consultas. Tente novamente em instantes.`, false, response.status);
  if (response.status >= 400 && response.status < 500) throw new ProviderHttpError(409, 'provider_rejected', `O ${label} recusou a operação. Confira o horário e os dados informados.`, false, response.status);
  if (!response.ok) throw new ProviderHttpError(502, write ? 'provider_outcome_unknown' : 'provider_unavailable', `O ${label} não respondeu como esperado (${response.status}).`, write, response.status);
  return data;
}
const invalid = (provider: ProviderKind): never => { throw new ProviderHttpError(502, 'provider_response_invalid', `Resposta inesperada do ${providerNames[provider]}.`, false); };
const httpsUrl = (v: unknown) => { if (typeof v !== 'string' || v.length > 2048) return null; try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } };

/* ---------------- Fuso horário (eTermin trabalha com horário local do calendário) ---------------- */
const clocks = new Map<string, Intl.DateTimeFormat>();
function clock(zone: string) { let f = clocks.get(zone); if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); clocks.set(zone, f); } return f; }
/** Data/hora local "YYYY-MM-DD HH:MM" no fuso informado. */
export function localWallTime(iso: string | number, zone: string) {
  const p = Object.fromEntries(clock(zone).formatToParts(typeof iso === 'number' ? iso : Date.parse(iso)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, text: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` };
}
const offsetAt = (ms: number, zone: string) => { const p = Object.fromEntries(clock(zone).formatToParts(ms).map(x => [x.type, Number(x.value)])); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
/** "2024-09-24T15:30:00" no fuso do calendário → instante UTC (duas passadas cobrem a troca de horário de verão). */
export function wallTimeToUtc(local: string, zone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local); if (!m) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const first = guess - offsetAt(guess, zone); return guess - offsetAt(first, zone);
}
/** Instante com o deslocamento do fuso (ex.: 2026-10-21T14:30:00-03:00), mais natural para o assistente falar. */
export function zonedIso(ms: number, zone: string) {
  const off = offsetAt(ms, zone) / 60000, sign = off < 0 ? '-' : '+', abs = Math.abs(off), w = localWallTime(ms, zone);
  return `${w.date}T${w.time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/* ---------------- Cal.com API v2 ---------------- */
export function calcomClient(c: CalCredentials) {
  const base = CAL_REGIONS[c.region];
  const call = (path: string, version?: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}) => request(`${base}${path}`, {
    method: init.method ?? 'GET', ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: { accept: 'application/json', authorization: `Bearer ${c.apiKey}`, ...(version ? { 'cal-api-version': version } : {}), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
  }, 'calcom');
  const envelope = (raw: unknown) => { const r = z.object({ status: z.literal('success'), data: z.unknown() }).passthrough().safeParse(raw); return r.success ? r.data.data : invalid('calcom'); };
  return {
    async account() {
      const me = z.object({ id: z.number(), username: z.string().nullable().optional(), email: z.string().max(320).optional(), name: z.string().max(200).nullable().optional(), timeZone: z.string().max(100).optional() }).passthrough().safeParse(envelope(await call('/v2/me')));
      if (!me.success) return invalid('calcom');
      return { displayName: (me.data.name || me.data.email || me.data.username || 'Cal.com').slice(0, 160), username: me.data.username ?? null, timezone: me.data.timeZone ?? null };
    },
    async catalog(username: string | null): Promise<CatalogItem[]> {
      const rows = z.array(z.object({ id: z.number().int().positive(), title: z.string().min(1).max(300), slug: z.string().max(300).optional(), lengthInMinutes: z.number().int().positive().max(1440).optional(), length: z.number().int().positive().max(1440).optional(), hidden: z.boolean().optional(), bookingUrl: z.string().optional() }).passthrough()).max(500).safeParse(envelope(await call('/v2/event-types', CAL_VERSIONS.eventTypes)));
      if (!rows.success) return invalid('calcom');
      const site = c.region === 'eu' ? 'https://cal.eu' : 'https://cal.com';
      return rows.data.filter(r => r.hidden !== true).map(r => ({ id: String(r.id), name: r.title, durationMinutes: r.lengthInMinutes ?? r.length ?? null, bookingUrl: httpsUrl(r.bookingUrl) ?? (username && r.slug ? `${site}/${encodeURIComponent(username)}/${encodeURIComponent(r.slug)}` : null) }));
    },
    async slots(eventTypeId: string, from: number, to: number, durationMinutes: number): Promise<Slot[]> {
      const q = new URLSearchParams({ eventTypeId, start: new Date(from).toISOString(), end: new Date(to).toISOString(), timeZone: 'UTC', format: 'range' });
      const days = z.record(z.array(z.union([z.string(), z.object({ start: z.string(), end: z.string().optional() }).passthrough()])).max(2000)).safeParse(envelope(await call(`/v2/slots?${q}`, CAL_VERSIONS.slots)));
      if (!days.success) return invalid('calcom');
      return Object.values(days.data).flat().map(s => { const start = Date.parse(typeof s === 'string' ? s : s.start), end = typeof s === 'string' || !s.end ? start + durationMinutes * 60000 : Date.parse(s.end); return Number.isFinite(start) && Number.isFinite(end) && end > start ? { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() } : invalid('calcom'); });
    },
    async book(b: BookingInput): Promise<BookingResult> {
      const attendee = { name: b.name, email: b.email, timeZone: b.timezone, language: 'pt', ...(b.phone ? { phoneNumber: b.phone } : {}) };
      const data = z.object({ uid: z.string().min(1).max(200), start: z.string(), end: z.string().optional(), status: z.string().max(40).optional() }).passthrough().safeParse(envelope(await call('/v2/bookings', CAL_VERSIONS.bookings, { method: 'POST', body: { start: b.startAt, eventTypeId: Number(b.eventTypeId), attendee, metadata: { origem: 'kloel', observacoes: b.notes.slice(0, 450) } } })));
      if (!data.success) throw new ProviderHttpError(502, 'provider_response_invalid', 'O Cal.com aceitou o pedido sem confirmar a reserva. Confira a agenda antes de tentar de novo.', true);
      return { remoteId: data.data.uid, startAt: new Date(Date.parse(data.data.start)).toISOString(), endAt: data.data.end ? new Date(Date.parse(data.data.end)).toISOString() : b.endAt, status: data.data.status ?? 'accepted' };
    },
  };
}

/* ---------------- eTermin API ---------------- */
/** Assinatura da documentação eTermin: salt aleatório por pedido; signature = base64(HMAC-SHA256(chave privada, salt)). */
export function eterminHeaders(c: EterminCredentials, salt = randomBytes(16).toString('hex')) {
  return { publickey: c.publicKey, salt, signature: createHmac('sha256', c.privateKey).update(salt).digest('base64') };
}
export function eterminClient(c: EterminCredentials) {
  const call = (path: string, init: { method?: 'GET' | 'POST'; form?: Record<string, string> } = {}) => request(`${ETERMIN}${path}`, {
    method: init.method ?? 'GET', ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
    headers: { accept: 'application/json', ...eterminHeaders(c), ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
  }, 'etermin');
  return {
    async catalog(): Promise<CatalogItem[]> {
      const rows = z.array(z.object({ ServiceID: z.number().int().positive(), Service: z.string().max(300).nullable().optional(), TimeSlotMinutes: z.number().nonnegative().max(1440).nullable().optional() }).passthrough()).max(1000).safeParse(await call('/api/service'));
      if (!rows.success) return invalid('etermin');
      return rows.data.map(r => ({ id: String(r.ServiceID), name: (r.Service || `Serviço ${r.ServiceID}`).slice(0, 300), durationMinutes: r.TimeSlotMinutes ? Math.round(r.TimeSlotMinutes) : null, bookingUrl: null }));
    },
    /** Horários de um dia local do calendário (rangesearch=0); horários sem deslocamento vêm no fuso da conta. */
    async slots(serviceId: string, date: string, zone: string, durationMinutes: number): Promise<(Slot & { calendarId: string })[]> {
      const rows = z.array(z.object({ start: z.string(), end: z.string().optional(), calendarid: z.union([z.number(), z.string()]) }).passthrough()).max(5000).safeParse(await call(`/api/timeslots?${new URLSearchParams({ date, serviceid: serviceId, rangesearch: '0' })}`));
      if (!rows.success) return invalid('etermin');
      return rows.data.map(r => { const start = wallTimeToUtc(r.start, zone), end = r.end ? wallTimeToUtc(r.end, zone) : start + durationMinutes * 60000; return Number.isFinite(start) && Number.isFinite(end) && end > start && /^\d{1,12}$/.test(String(r.calendarid)) ? { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), calendarId: String(r.calendarid) } : invalid('etermin'); });
    },
    async book(b: BookingInput & { calendarId: string }): Promise<BookingResult> {
      const [first, ...rest] = b.name.trim().split(/\s+/), start = localWallTime(b.startAt, b.timezone).text, end = localWallTime(b.endAt, b.timezone).text;
      const form: Record<string, string> = { start, end, calendarid: b.calendarId, services: b.eventTypeId, firstname: first ?? '', lastname: rest.join(' '), checkexist: '1', sendemail: b.email ? '1' : '0', notes: b.notes.slice(0, 1000), bookingtype: 'Kloel AI', ...(b.email ? { email: b.email } : {}), ...(b.phone ? { phone: b.phone } : {}) };
      const raw = await call('/api/appointment', { method: 'POST', form });
      const r = z.object({ ID: z.union([z.string(), z.number()]).optional(), Status: z.number().optional(), StatusMsg: z.string().optional() }).passthrough().safeParse(raw);
      if (!r.success || r.data.Status !== undefined && r.data.Status !== 200) throw new ProviderHttpError(409, 'provider_rejected', 'O eTermin recusou o horário. Consulte os horários de novo e ofereça outro.', false);
      if (r.data.ID === undefined || String(r.data.ID).length > 200) throw new ProviderHttpError(502, 'provider_response_invalid', 'O eTermin respondeu sem confirmar a reserva. Confira a agenda antes de tentar de novo.', true);
      return { remoteId: String(r.data.ID), startAt: b.startAt, endAt: b.endAt, status: 'accepted' };
    },
  };
}
