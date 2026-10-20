import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import type { Entity, Store } from './store.js';
import { digest, encryptionKey, seal, unseal } from './oauth/crypto.js';
import { eventTypeConfigFromRecord, type EventTypeConfig } from './scheduling/service.js';
import { publicBookingBaseUrl } from './public-booking/origin.js';
import { publicUrl, pinnedAddress, type Address } from './ingestion/safe-url.js';
import { readBookingCalendarEvent } from './oauth/booking-calendar.js';

/**
 * Notificações reais do Agendador. Um observador compara cada reserva com o último estado notificado
 * (cursor por reserva) e enfileira e-mails (Resend) e webhooks; o worker envia cada trabalho uma única vez.
 * Nenhum caminho de reserva espera por estes envios, e nenhum envio é repetido depois de uma possível aceitação.
 */
export type WebhookTransport = (url: URL, pinned: Address, body: string, headers: Record<string, string>) => Promise<{ status: number }>;
export type NotificationOptions = { now?: () => number; fetchImpl?: typeof fetch; webhookRequest?: WebhookTransport; resolve?: (hostname: string) => Promise<Address[]>; workers?: boolean; intervalMs?: number };
export type BookingEvent = 'created' | 'rescheduled' | 'canceled' | 'reminder';
type Job = { id: string; tenant_id: string; booking_id: string; page_id: string; event: BookingEvent; audience: 'invitee' | 'team' | 'guest' | 'webhook'; channel: 'email' | 'webhook'; encrypted_payload: string | null; due_at: number; status: string; ref_start: string | null; hours_before: number | null };
const ACTIVE = new Set(['confirmed', 'conflict']);
const DAY = 86400000;
const jobContext = (id: string) => `kloel:booking-notification:${id}`;
export const manageTokenContext = (tenantId: string, reference: string) => `${tenantId}:${reference}:booking-manage`;
const visitorContext = (tenantId: string, reference: string) => `${tenantId}:${reference}:booking-visitor`;

export function initializeSchedulingNotifications(store: Store) {
  store.transaction(() => {
    store.db.exec('CREATE TABLE IF NOT EXISTS engine_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const marker = '2026-10-20-scheduling-notifications-v1';
    if (store.db.prepare('SELECT version FROM engine_migrations WHERE version=?').get(marker)) return;
    store.db.exec(`CREATE TABLE IF NOT EXISTS booking_notification_cursor (
      booking_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, observed TEXT, phase TEXT NOT NULL, notified_start TEXT, notified_end TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS booking_notification_jobs (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, booking_id TEXT NOT NULL, page_id TEXT NOT NULL, event TEXT NOT NULL, audience TEXT NOT NULL, channel TEXT NOT NULL,
      encrypted_payload TEXT, recipient_hint TEXT NOT NULL, webhook_id TEXT, due_at INTEGER NOT NULL, status TEXT NOT NULL, ref_start TEXT, hours_before INTEGER,
      created_at INTEGER NOT NULL, completed_at INTEGER, provider_id TEXT, http_status INTEGER, error_code TEXT
    );
    CREATE INDEX IF NOT EXISTS booking_notification_due ON booking_notification_jobs(status,due_at);
    CREATE INDEX IF NOT EXISTS booking_notification_page ON booking_notification_jobs(tenant_id,page_id,created_at);`);
    // Reservas anteriores a esta versão já aconteceram sem aviso: registrar o estado atual evita enviar confirmações retroativas.
    const now = Date.now();
    for (const row of store.db.prepare("SELECT tenant_id,body FROM entities WHERE collection='public-bookings'").all()) {
      const b = JSON.parse(String(row.body)) as Entity;
      store.db.prepare('INSERT OR IGNORE INTO booking_notification_cursor(booking_id,tenant_id,observed,phase,notified_start,notified_end,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(b.id, String(row.tenant_id), String(b.updatedAt), ACTIVE.has(String(b.status)) ? 'active' : b.status === 'cancelled' ? 'cancelled' : 'none', String(b.startAt ?? ''), String(b.endAt ?? ''), now);
    }
    store.db.prepare('INSERT INTO engine_migrations(version,applied_at) VALUES(?,?)').run(marker, new Date().toISOString());
  });
}

/* ----------------------------- Link de gerenciamento ----------------------------- */

/** Credencial própria das notificações: o link do e-mail não substitui o link já guardado pelo navegador do convidado. */
export function notificationManageFields(tenantId: string, reference: string) {
  const token = randomBytes(32).toString('base64url');
  return { notifyManageTokenHash: digest(token), sealedManageToken: seal(token, manageTokenContext(tenantId, reference)) };
}
export function notificationManageAccepts(booking: Entity, raw: string, origin: string, now: number) {
  if (typeof booking.notifyManageTokenHash !== 'string' || booking.notifyManageTokenHash !== digest(raw)) return false;
  let configured: string; try { configured = publicBookingBaseUrl(); } catch { return false; }
  return origin === configured && now <= Date.parse(String(booking.endAt)) + 30 * DAY;
}
function manageUrl(booking: Entity, page: Entity): string {
  if (typeof booking.sealedManageToken !== 'string' || typeof page.publicOrgSlug !== 'string' || typeof page.slug !== 'string') return '';
  try { return `${publicBookingBaseUrl()}/c/${page.publicOrgSlug}/${page.slug}#booking=${booking.id}&manage=${unseal<string>(booking.sealedManageToken, manageTokenContext(booking.tenantId, String(booking.reference)))}`; }
  catch { return ''; }
}

/* ---------------------------------- Conteúdo ---------------------------------- */

export type Visitor = { name?: string; email?: string; phone?: string; custom?: Record<string, string> };
/** Dados do convidado para o proprietário (lista de agendamentos); nunca vai para rotas públicas. */
export function bookingInvitee(booking: Entity) {
  const v = visitorOf(booking);
  return { name: v.name ?? '', email: v.email ?? '', phone: v.phone ?? '' };
}
function visitorOf(booking: Entity): Visitor {
  if (typeof booking.encryptedVisitor !== 'string') return {};
  try { return unseal<Visitor>(booking.encryptedVisitor, visitorContext(booking.tenantId, String(booking.reference))); } catch { return {}; }
}
function organizationName(store: Store, tenantId: string) {
  const settings = store.list(tenantId, 'organization-settings')[0];
  if (typeof settings?.name === 'string' && settings.name.trim()) return settings.name.trim();
  const org = store.db.prepare('SELECT name FROM organizations WHERE id=?').get(tenantId);
  return typeof org?.name === 'string' ? org.name : '';
}
function hostEmail(store: Store, booking: Entity) {
  const grant = store.get(booking.tenantId, 'booking-grants', String(booking.grantId));
  const user = grant && store.db.prepare('SELECT email FROM users WHERE id=?').get(String(grant.publisherUserId));
  return typeof user?.email === 'string' ? user.email.toLowerCase() : '';
}
function tzLabel(zone: string, at: number) {
  let offset = '';
  try { offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at).find(p => p.type === 'timeZoneName')?.value ?? ''; } catch { /* zone validated by the event type */ }
  const accents: Record<string, string> = { Sao_Paulo: 'São Paulo', Belem: 'Belém', Maceio: 'Maceió', Cuiaba: 'Cuiabá', Araguaina: 'Araguaína', Santarem: 'Santarém', Porto_Velho: 'Porto Velho', Rio_Branco: 'Rio Branco' };
  const last = zone.split('/').at(-1) ?? zone, city = accents[last] ?? last.replace(/_/g, ' ');
  return offset ? `${city} (${offset})` : city;
}
const dateText = (at: number, zone: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(at);
const timeText = (at: number, zone: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
function locationText(config: EventTypeConfig, booking: Entity, visitor: Visitor) {
  const location = config.location;
  if (location.kind === 'physical') return location.address || 'Local físico';
  if (location.kind === 'phone') return location.phone ? `Ligação telefônica: ${location.phone}` : `Ligação telefônica para ${visitor.phone || 'o telefone informado'}`;
  if (location.kind === 'online') return booking.provider === 'microsoft' ? 'Reunião online (Microsoft Teams)' : 'Reunião online (Google Meet)';
  return '';
}

export type BookingContext = { booking: Entity; page: Entity; config: EventTypeConfig; visitor: Visitor; values: Record<string, string>; orgName: string; manage: string; meeting: string; location: string };
export function bookingContext(store: Store, booking: Entity): BookingContext | undefined {
  const page = store.get(booking.tenantId, 'booking-pages', String(booking.pageId)); if (!page) return;
  let config: EventTypeConfig; try { config = eventTypeConfigFromRecord(page); } catch { return; }
  const visitor = visitorOf(booking), orgName = organizationName(store, booking.tenantId), start = Date.parse(String(booking.startAt)), zone = String(booking.timezone || config.timezone);
  const manage = manageUrl(booking, page), meeting = typeof booking.meetingUrl === 'string' ? booking.meetingUrl : '', location = locationText(config, booking, visitor);
  const values: Record<string, string> = {
    'booking.cancel_reason': typeof booking.cancelReason === 'string' ? booking.cancelReason : '',
    'booking.date': dateText(start, zone), 'booking.time': timeText(start, zone), 'booking.timezone': tzLabel(zone, start),
    'booking.duration': String(Math.round((Date.parse(String(booking.endAt)) - start) / 60000)), 'booking.title': config.name,
    'booking.location': location, 'booking.manage_url': manage, 'booking.meeting_link': meeting,
    'guest.email': visitor.email ?? '', 'guest.name': visitor.name ?? '', 'guest.phone': visitor.phone ?? '', 'company.name': orgName,
  };
  return { booking, page, config, visitor, values, orgName, manage, meeting, location };
}

const decode = (text: string) => text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** Converte o HTML simples do editor (div/br/b/i/u/h2/h3 + chips data-var ou {{chave}}) em texto. */
export function renderTemplate(html: string, values: Record<string, string>, singleLine = false) {
  const text = decode(html
    .replace(/<span[^>]*data-var="([a-z_.]+)"[^>]*>[\s\S]*?<\/span>/g, (_m, key: string) => `\u0000${key}\u0000`)
    .replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_m, key: string) => `\u0000${key}\u0000`)
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|h2|h3)>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/\u0000([a-z_.]+)\u0000/g, (_m, key: string) => values[key] ?? '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return singleLine ? text.replace(/\s+/g, ' ').trim() : text;
}
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function htmlEmail(text: string) {
  const body = escapeHtml(text).replace(/https:\/\/[^\s<]+/g, url => `<a href="${url}" style="color:#4f46e5">${url}</a>`).replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f7;font-family:Arial,Helvetica,sans-serif;color:#18181b"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:24px;font-size:15px;line-height:1.6">${body}</div><p style="max-width:560px;margin:12px auto 0;font-size:12px;color:#71717a;text-align:center">Agendamento por Kloel</p></body></html>`;
}

const DEFAULT_EMAIL: Record<'confirmation' | 'reschedule' | 'cancellation', { subject: string; body: string }> = {
  confirmation: { subject: '{{booking.title}} confirmado: {{company.name}} <> {{guest.name}}', body: 'Olá {{guest.name}}, seu compromisso foi confirmado para {{booking.date}} às {{booking.time}} ({{booking.timezone}}).\nPara reagendar ou cancelar: {{booking.manage_url}}' },
  reschedule: { subject: '{{booking.title}} reagendado: {{company.name}} <> {{guest.name}}', body: 'Olá {{guest.name}}, seu compromisso foi reagendado para {{booking.date}} às {{booking.time}} ({{booking.timezone}}).' },
  cancellation: { subject: '{{booking.title}} cancelado: {{company.name}} <> {{guest.name}}', body: 'Olá {{guest.name}}, seu compromisso foi cancelado.' },
};
const REMINDER = { subject: 'Lembrete: {{booking.title}} em {{booking.date}} às {{booking.time}}', body: 'Olá {{guest.name}}, lembrete do seu compromisso {{booking.title}} em {{booking.date}} às {{booking.time}} ({{booking.timezone}}).' };
const templateFor = (event: BookingEvent) => event === 'created' ? 'confirmation' : event === 'rescheduled' ? 'reschedule' : 'cancellation';
const mentions = (template: string, key: string) => template.includes(`data-var="${key}"`) || template.includes(`{{${key}}}`);

function detailLines(ctx: BookingContext, template: string, canceled: boolean) {
  const lines: string[] = [];
  if (!canceled && ctx.location && !mentions(template, 'booking.location') && !mentions(template, 'booking.meeting_link')) lines.push(`Local: ${ctx.location}`);
  if (!canceled && ctx.meeting && !mentions(template, 'booking.meeting_link')) lines.push(`Link da reunião: ${ctx.meeting}`);
  if (!canceled && ctx.manage && !mentions(template, 'booking.manage_url') && (ctx.config.allowCancel || ctx.config.allowReschedule)) lines.push(`Gerenciar o compromisso: ${ctx.manage}`);
  return lines;
}
function customAnswers(ctx: BookingContext) {
  return ctx.config.customFields.flatMap(field => ctx.visitor.custom?.[field.id] ? [`${field.label}: ${ctx.visitor.custom[field.id]}`] : []);
}
export function inviteeMessage(ctx: BookingContext, event: BookingEvent) {
  if (event === 'reminder') {
    const text = [renderTemplate(REMINDER.body, ctx.values), ...detailLines(ctx, REMINDER.body, false)].join('\n\n');
    return { subject: renderTemplate(REMINDER.subject, ctx.values, true), text };
  }
  const kind = templateFor(event), saved = ctx.config.notifications.email[kind];
  const subject = saved?.subject && renderTemplate(saved.subject, ctx.values, true) ? saved.subject : DEFAULT_EMAIL[kind].subject;
  const body = saved?.body && renderTemplate(saved.body, ctx.values) ? saved.body : DEFAULT_EMAIL[kind].body;
  const reason = event === 'canceled' && ctx.values['booking.cancel_reason'] && !mentions(body, 'booking.cancel_reason') ? [`Motivo: ${ctx.values['booking.cancel_reason']}`] : [];
  return { subject: renderTemplate(subject, ctx.values, true), text: [renderTemplate(body, ctx.values), ...reason, ...detailLines(ctx, body, event === 'canceled')].filter(Boolean).join('\n\n') };
}
export function teamMessage(ctx: BookingContext, event: BookingEvent) {
  const v = ctx.values, title = event === 'created' ? 'Novo agendamento' : event === 'rescheduled' ? 'Agendamento reagendado' : 'Agendamento cancelado';
  const lines = [`${title}: ${v['booking.title']}`, `Quando: ${v['booking.date']} às ${v['booking.time']} (${v['booking.timezone']})`, `Convidado: ${[v['guest.name'], v['guest.email'], v['guest.phone']].filter(Boolean).join(' · ') || '—'}`,
    ...customAnswers(ctx), ...(ctx.location ? [`Local: ${ctx.location}`] : []), ...(ctx.meeting && event !== 'canceled' ? [`Link da reunião: ${ctx.meeting}`] : []),
    ...(event === 'canceled' && v['booking.cancel_reason'] ? [`Motivo: ${v['booking.cancel_reason']}`] : []), ...(ctx.manage && event !== 'canceled' ? [`Gerenciar: ${ctx.manage}`] : [])];
  return { subject: `${title}: ${v['booking.title']} — ${v['guest.name'] || 'convidado'} (${v['booking.date']}, ${v['booking.time']})`.slice(0, 250), text: lines.join('\n') };
}

/** Título e descrição do evento criado no calendário conectado (aba Notificações › Calendário). */
export function bookingCalendarDetails(store: Store, booking: Entity, fallbackTitle: string) {
  const ctx = bookingContext(store, booking);
  if (!ctx) return { title: fallbackTitle, conference: false };
  const template = ctx.config.notifications.calendar, location = ctx.config.location;
  const title = template?.subject ? renderTemplate(template.subject, ctx.values, true).slice(0, 250) || fallbackTitle : fallbackTitle;
  const description = template ? [renderTemplate(template.body, ctx.values), ...customAnswers(ctx)].filter(Boolean).join('\n\n').slice(0, 7000) : '';
  const where = location.kind === 'physical' || location.kind === 'phone' ? ctx.location : '';
  return { title, conference: location.kind === 'online', ...(description ? { description } : {}), ...(where ? { location: where } : {}) };
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line: string) { const out: string[] = []; for (let i = 0; i < line.length; i += 73) out.push((i ? ' ' : '') + line.slice(i, i + 73)); return out.join('\r\n'); }
export function bookingIcs(ctx: BookingContext, canceled: boolean, now: number) {
  const b = ctx.booking, description = [ctx.meeting ? `Link da reunião: ${ctx.meeting}` : '', ctx.manage ? `Gerenciar: ${ctx.manage}` : ''].filter(Boolean).join('\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kloel//Agendador//PT-BR', 'CALSCALE:GREGORIAN', `METHOD:${canceled ? 'CANCEL' : 'PUBLISH'}`, 'BEGIN:VEVENT',
    `UID:${b.reference}@kloel.ai`, `DTSTAMP:${icsDate(new Date(now).toISOString())}`, `SEQUENCE:${Number(b.revision ?? 1)}`, `DTSTART:${icsDate(String(b.startAt))}`, `DTEND:${icsDate(String(b.endAt))}`,
    `SUMMARY:${icsText(`${ctx.config.name}${ctx.orgName ? ` — ${ctx.orgName}` : ''}`)}`, ...(ctx.location ? [`LOCATION:${icsText(ctx.location)}`] : []), ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    ...(ctx.meeting ? [`URL:${ctx.meeting}`] : []), `STATUS:${canceled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}

/* ------------------------------ Observação e fila ------------------------------ */

function mask(email: string) { const [user, domain] = email.split('@'); return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`; }
function insertJob(store: Store, booking: Entity, event: BookingEvent, audience: Job['audience'], channel: Job['channel'], payload: Record<string, unknown>, hint: string, dueAt: number, now: number, extra: { refStart?: string; hours?: number; webhookId?: string } = {}) {
  const id = randomUUID();
  store.db.prepare('INSERT INTO booking_notification_jobs(id,tenant_id,booking_id,page_id,event,audience,channel,encrypted_payload,recipient_hint,webhook_id,due_at,status,ref_start,hours_before,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, booking.tenantId, booking.id, String(booking.pageId), event, audience, channel, seal(payload, jobContext(id), encryptionKey()), hint, extra.webhookId ?? null, dueAt, 'queued', extra.refStart ?? null, extra.hours ?? null, now);
}
function enqueue(store: Store, booking: Entity, event: Exclude<BookingEvent, 'reminder'>, now: number) {
  if (event !== 'created') store.db.prepare("UPDATE booking_notification_jobs SET status='obsolete',completed_at=?,encrypted_payload=NULL WHERE booking_id=? AND event='reminder' AND status='queued'").run(now, booking.id);
  const ctx = bookingContext(store, booking); if (!ctx) return;
  if (event !== 'canceled' && Date.parse(String(booking.endAt)) <= now) return;
  const { config, visitor } = ctx, silent = booking.notificationsDisabled === true, invitee = !silent && typeof visitor.email === 'string' && visitor.email.includes('@') ? visitor.email : '';
  if (invitee && config.notifications.invitee) insertJob(store, booking, event, 'invitee', 'email', { to: invitee }, mask(invitee), now, now);
  const host = config.notifications.team ? hostEmail(store, booking) : '';
  if (host) insertJob(store, booking, event, 'team', 'email', { to: host }, mask(host), now, now);
  for (const guest of config.staticInvitees) if (guest !== host) insertJob(store, booking, event, 'guest', 'email', { to: guest }, mask(guest), now, now);
  for (const hook of config.webhooks.filter(h => h.events.includes(event))) insertJob(store, booking, event, 'webhook', 'webhook', { url: hook.url }, new URL(hook.url).host, now, now, { webhookId: hook.id });
  if (event !== 'canceled' && invitee) for (const reminder of config.notifications.reminders) {
    const due = Date.parse(String(booking.startAt)) - reminder.hoursBefore * 3600000;
    if (due > now + 60000) insertJob(store, booking, 'reminder', 'invitee', 'email', { to: invitee }, mask(invitee), due, now, { refStart: String(booking.startAt), hours: reminder.hoursBefore });
  }
}
function observeOne(store: Store, tenantId: string, id: string, now: number) {
  const booking = store.get(tenantId, 'public-bookings', id); if (!booking) return;
  const cursor = store.db.prepare('SELECT * FROM booking_notification_cursor WHERE booking_id=?').get(id) as { phase: string; notified_start: string | null; notified_end: string | null } | undefined;
  let phase = cursor?.phase ?? 'none', start = cursor?.notified_start ?? null, end = cursor?.notified_end ?? null;
  const status = String(booking.status);
  if (ACTIVE.has(status)) {
    if (phase === 'none') { enqueue(store, booking, 'created', now); phase = 'active'; start = String(booking.startAt); end = String(booking.endAt); }
    else if (phase === 'active' && (start !== booking.startAt || end !== booking.endAt)) { enqueue(store, booking, 'rescheduled', now); start = String(booking.startAt); end = String(booking.endAt); }
  } else if (status === 'cancelled' && phase === 'active') { enqueue(store, booking, 'canceled', now); phase = 'cancelled'; }
  store.db.prepare(`INSERT INTO booking_notification_cursor(booking_id,tenant_id,observed,phase,notified_start,notified_end,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(booking_id) DO UPDATE SET observed=excluded.observed,phase=excluded.phase,notified_start=excluded.notified_start,notified_end=excluded.notified_end,updated_at=excluded.updated_at`)
    .run(id, tenantId, String(booking.updatedAt), phase, start, end, now);
}
/** Compara reservas alteradas com o último estado notificado. Sem chamadas externas. */
export function observeBookingChanges(store: Store, now = Date.now(), limit = 200) {
  const rows = store.db.prepare(`SELECT e.tenant_id AS tenant, e.id AS id FROM entities e LEFT JOIN booking_notification_cursor c ON c.booking_id=e.id
    WHERE e.collection='public-bookings' AND (c.booking_id IS NULL OR c.observed IS NOT json_extract(e.body,'$.updatedAt')) LIMIT ?`).all(limit);
  for (const row of rows) {
    try { store.transaction(() => observeOne(store, String(row.tenant), String(row.id), now)); }
    catch { /* A reserva fica para a próxima observação; nada foi enviado. */ }
  }
  return rows.length;
}

/* ----------------------------------- Envio ----------------------------------- */

function sender(display: string) {
  const configured = process.env.RESEND_FROM ?? '', address = /<([^<>\s]+@[^<>\s]+)>/.exec(configured)?.[1] ?? configured.trim();
  const name = display.replace(/["<>\r\n\\]/g, '').trim().slice(0, 60) || 'Kloel';
  return `"${name} via Kloel" <${address}>`;
}
function stillRelevant(job: Job, booking: Entity, now: number) {
  const status = String(booking.status);
  if (job.event === 'canceled') return status === 'cancelled';
  if (!ACTIVE.has(status)) return false;
  if (job.event === 'reminder') return booking.startAt === job.ref_start && Date.parse(String(booking.startAt)) > now;
  return Date.parse(String(booking.endAt)) > now;
}
async function meetingLink(store: Store, booking: Entity, ctx: BookingContext) {
  if (ctx.config.location.kind !== 'online' || ctx.meeting || typeof booking.remoteEventId !== 'string' || ctx.booking.status === 'cancelled') return ctx;
  try {
    const remote = await readBookingCalendarEvent(store, { kind: 'grant', tenantId: booking.tenantId, grantId: String(booking.grantId), purpose: 'notify' }, booking.remoteEventId);
    if (remote?.meetingUrl) {
      store.transaction(() => { const current = store.get(booking.tenantId, 'public-bookings', booking.id); if (current && !current.meetingUrl) store.update(booking.tenantId, 'public-bookings', booking.id, { meetingUrl: remote.meetingUrl }); });
      return bookingContext(store, { ...booking, meetingUrl: remote.meetingUrl }) ?? ctx;
    }
  } catch { /* Sem link confirmado: a mensagem segue com o local, sem inventar endereço. */ }
  return ctx;
}
export function webhookPayload(ctx: BookingContext, event: string, deliveryId: string, now: number) {
  const b = ctx.booking;
  return { event: `booking.${event}`, deliveryId, createdAt: new Date(now).toISOString(), data: {
    bookingId: b.id, status: b.status, startAt: b.startAt, endAt: b.endAt, timezone: b.timezone,
    eventType: { id: ctx.page.id, name: ctx.config.name, slug: ctx.config.slug },
    invitee: { name: ctx.visitor.name ?? null, email: ctx.visitor.email ?? null, phone: ctx.visitor.phone ?? null },
    customFields: Object.fromEntries(ctx.config.customFields.map(field => [field.label, ctx.visitor.custom?.[field.id] ?? null])),
    location: { kind: ctx.config.location.kind, text: ctx.location || null }, meetingUrl: ctx.meeting || null, manageUrl: ctx.manage || null,
    cancelReason: b.status === 'cancelled' ? (b.cancelReason ?? null) : null, source: b.assistantOperationId ? 'agent' : 'booking_page' } };
}
const defaultWebhookRequest: WebhookTransport = (url, pinned, body, headers) => new Promise((resolve, reject) => {
  const request = httpsRequest(url, { method: 'POST', agent: false, headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
    lookup: ((_host: string, options: { all?: boolean }, callback: (...args: any[]) => void) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)) as any,
  }, response => { response.resume(); response.on('end', () => resolve({ status: response.statusCode ?? 502 })); response.on('error', reject); });
  request.setTimeout(10000, () => request.destroy(new Error('timeout')));
  request.on('error', reject); request.end(body);
});
/** Entrega HTTPS para destino público (DNS fixado, sem redirecionamento). */
export async function deliverWebhook(url: string, payload: unknown, options: NotificationOptions = {}) {
  const target = publicUrl(url); if (target.protocol !== 'https:') throw Object.assign(new Error('webhook_https_required'), { code: 'webhook_https_required' });
  const pinned = await pinnedAddress(target, options.resolve), body = JSON.stringify(payload), started = Date.now();
  const event = (payload as { event?: string }).event ?? 'booking.test';
  const result = await (options.webhookRequest ?? defaultWebhookRequest)(target, pinned, body, { 'Content-Type': 'application/json', 'User-Agent': 'Kloel-Agendador/1.0', 'X-Kloel-Event': event });
  return { status: result.status, durationMs: Date.now() - started };
}

async function sendJob(store: Store, job: Job, options: NotificationOptions) {
  const now = options.now ?? Date.now;
  let attempted = false;
  const finish = (status: string, extra: { providerId?: string; httpStatus?: number; errorCode?: string } = {}) => store.db.prepare('UPDATE booking_notification_jobs SET status=?,encrypted_payload=NULL,completed_at=?,provider_id=?,http_status=?,error_code=? WHERE id=?')
    .run(status, now(), extra.providerId ?? null, extra.httpStatus ?? null, extra.errorCode ?? null, job.id);
  try {
    const booking = store.get(job.tenant_id, 'public-bookings', job.booking_id);
    if (!booking || !stillRelevant(job, booking, now())) return finish('obsolete');
    let ctx = bookingContext(store, booking); if (!ctx) return finish('obsolete');
    const payload = unseal<{ to?: string; url?: string }>(job.encrypted_payload!, jobContext(job.id), encryptionKey());
    ctx = await meetingLink(store, booking, ctx);
    if (job.channel === 'webhook') {
      const hook = ctx.config.webhooks.find(h => h.url === payload.url);
      if (!hook || !hook.events.includes(job.event as 'created')) return finish('obsolete');
      attempted = true;
      const result = await deliverWebhook(hook.url, webhookPayload(ctx, job.event, job.id, now()), options);
      return finish(result.status >= 200 && result.status < 300 ? 'delivered' : 'rejected', { httpStatus: result.status });
    }
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return finish('not_sent', { errorCode: 'email_not_configured' });
    const message = job.audience === 'invitee' ? inviteeMessage(ctx, job.event) : teamMessage(ctx, job.event);
    const display = job.audience === 'invitee' ? ctx.config.notifications.senderName || ctx.orgName : 'Agendador';
    const attachments = job.event === 'reminder' ? [] : [{ filename: job.event === 'canceled' ? 'cancelamento.ics' : 'convite.ics', content: Buffer.from(bookingIcs(ctx, job.event === 'canceled', now())).toString('base64') }];
    attempted = true;
    const response = await (options.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `booking-notification-${job.id}` },
      body: JSON.stringify({ from: sender(display), to: [payload.to], subject: message.subject.slice(0, 250), text: message.text, html: htmlEmail(message.text), ...(attachments.length ? { attachments } : {}) }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) { await response.body?.cancel(); return finish(response.status >= 400 && response.status < 500 ? 'rejected' : 'uncertain', { httpStatus: response.status }); }
    const data = await response.json() as { id?: unknown };
    if (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.id)) return finish('uncertain', { errorCode: 'invalid_receipt' });
    return finish('accepted', { providerId: data.id, httpStatus: response.status });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code.slice(0, 80) : 'send_failed';
    finish(attempted ? (job.channel === 'webhook' ? 'failed' : 'uncertain') : 'not_sent', { errorCode: code });
  }
}
/** Envia os trabalhos vencidos, um por vez; cada trabalho é reservado antes de qualquer chamada externa. */
export async function processSchedulingNotifications(store: Store, options: NotificationOptions = {}, max = 20) {
  const now = options.now ?? Date.now; let sent = 0;
  for (; sent < max; sent++) {
    const job = store.transaction(() => {
      const row = store.db.prepare("SELECT * FROM booking_notification_jobs WHERE status='queued' AND due_at<=? ORDER BY due_at,rowid LIMIT 1").get(now()) as Job | undefined;
      if (row) store.db.prepare("UPDATE booking_notification_jobs SET status='pending' WHERE id=?").run(row.id);
      return row;
    });
    if (!job) break;
    await sendJob(store, job, options);
  }
  return sent;
}

export function notificationHistory(store: Store, tenantId: string, pageId: string, limit = 100) {
  return store.db.prepare('SELECT id,booking_id,event,audience,channel,recipient_hint,webhook_id,due_at,status,created_at,completed_at,http_status,error_code,hours_before FROM booking_notification_jobs WHERE tenant_id=? AND page_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?')
    .all(tenantId, pageId, limit).map(r => ({ id: String(r.id), bookingId: String(r.booking_id), event: String(r.event), audience: String(r.audience), channel: String(r.channel), recipient: String(r.recipient_hint),
      webhookId: r.webhook_id ? String(r.webhook_id) : null, dueAt: new Date(Number(r.due_at)).toISOString(), status: String(r.status), createdAt: new Date(Number(r.created_at)).toISOString(),
      completedAt: r.completed_at ? new Date(Number(r.completed_at)).toISOString() : null, httpStatus: r.http_status === null ? null : Number(r.http_status), errorCode: r.error_code ? String(r.error_code) : null, hoursBefore: r.hours_before === null ? null : Number(r.hours_before) }));
}
/** Estado do e-mail ao convidado para o recibo público (sem expor a fila). */
export function inviteeEmailState(store: Store, booking: Entity): 'enabled' | 'disabled' {
  if (booking.notificationsDisabled === true || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return 'disabled';
  const page = store.get(booking.tenantId, 'booking-pages', String(booking.pageId));
  try { if (!page || !eventTypeConfigFromRecord(page).notifications.invitee) return 'disabled'; } catch { return 'disabled'; }
  const visitor = visitorOf(booking);
  return visitor.email ? 'enabled' : 'disabled';
}

export function startSchedulingNotifications(store: Store, options: NotificationOptions = {}) {
  store.db.prepare("UPDATE booking_notification_jobs SET status='uncertain',encrypted_payload=NULL,completed_at=? WHERE status='pending'").run(Date.now());
  let active: Promise<unknown> | undefined;
  const tick = () => { if (!active) active = (async () => { observeBookingChanges(store, (options.now ?? Date.now)()); await processSchedulingNotifications(store, options); })().catch(() => {}).finally(() => { active = undefined; }); };
  const timer = setInterval(tick, options.intervalMs ?? 2000); timer.unref(); tick();
  return { stop: async () => { clearInterval(timer); await active; } };
}
