import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { DomainError } from '../domains.js';
import { hasPermission } from '../memberships/permissions.js';
import { MembershipError, resolveMembershipActor, type MembershipActor } from '../memberships/service.js';
import { authorizedOAuthConnection } from '../oauth/authorization.js';
import { publicBookingBaseUrl } from '../public-booking/origin.js';

export const bookingPagesCollection = 'booking-pages';
const minute = 60_000;
const uuid = z.string().uuid();
const shortText = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const endClock = z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/);
const timezone = z.string().trim().min(1).max(100).refine(value => {
  try { if (/^[+-]/.test(value)) return false; new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Use um fuso horário IANA válido.');
const clockMinutes = (value: string) => { const [hour, min] = value.split(':').map(Number); return hour * 60 + min; };
const publication = z.enum(['draft', 'unpublished']);
const plain = (max: number) => z.string().max(max).transform(value => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim());
const template = z.object({ subject: plain(2000).default(''), body: plain(8000).default('') }).strict();
const itemId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export type BookingLocation = { kind: 'none' | 'online' | 'phone' | 'physical'; address: string; phone: string };
/** Settings added after the first schema: every field has a default so older records keep parsing unchanged. */
export const eventSettingsShape = {
  location: z.object({ kind: z.enum(['none', 'online', 'phone', 'physical']).default('none'), address: plain(300).default(''), phone: z.union([z.literal(''), z.string().regex(/^\+[1-9]\d{7,14}$/)]).default('') }).strict().default({ kind: 'none', address: '', phone: '' }),
  customFields: z.array(z.object({ id: itemId, label: shortText, type: z.enum(['text', 'phone', 'email']), required: z.boolean().default(false) }).strict()).max(10).default([]),
  staticInvitees: z.array(z.string().trim().toLowerCase().email().max(254)).max(10).default([]),
  conflictCalendarIds: z.array(uuid).max(10).default([]),
  notifications: z.object({
    invitee: z.boolean().default(true), team: z.boolean().default(false), senderName: plain(60).default(''),
    email: z.object({ confirmation: template.optional(), reschedule: template.optional(), cancellation: template.optional() }).strict().default({}),
    calendar: template.optional(),
    reminders: z.array(z.object({ id: itemId, hoursBefore: z.number().int().min(1).max(168) }).strict()).max(5).default([]),
  }).strict().default({ invitee: true, team: false, senderName: '', email: {}, reminders: [] }),
  confirmationMessage: plain(1000).default(''),
  hideFromCompanyPage: z.boolean().default(false),
  hostDisplayName: plain(60).default(''),
  allowCancel: z.boolean().default(true),
  allowReschedule: z.boolean().default(true),
  webhooks: z.array(z.object({ id: itemId, url: z.string().trim().max(500).url().refine(value => value.startsWith('https://'), 'Use https.'), events: z.array(z.enum(['created', 'rescheduled', 'canceled'])).min(1).max(3), createdAt: z.string().max(40).optional() }).strict()).max(5).default([]),
};
const configObject = z.object({
  name: shortText,
  description: z.string().trim().max(5000).default(''),
  slug: z.string().trim().toLowerCase().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  calendarId: uuid,
  timezone,
  durationMinutes: z.number().int().min(5).max(480),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  minimumNoticeMinutes: z.number().int().min(0).max(525600).default(60),
  horizonDays: z.number().int().min(1).max(365).default(30),
  dailyLimit: z.number().int().min(1).max(1000).default(20),
  slotIntervalMinutes: z.number().int().min(5).max(240).default(15),
  availability: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: clock, end: endClock }).strict()).min(1).max(50),
  form: z.array(z.object({ field: z.enum(['name', 'email', 'phone']), label: shortText, required: z.boolean().default(false) }).strict()).max(3).default([]),
  agentIds: z.array(uuid).max(50).default([]),
  enabled: z.boolean().default(true),
  ...eventSettingsShape,
}).strict();

export const eventTypeConfigSchema = configObject.superRefine((value, context) => {
  value.availability.forEach((period, index) => {
    if (clockMinutes(period.end) <= clockMinutes(period.start)) context.addIssue({ code: 'custom', path: ['availability', index], message: 'O fim deve ser posterior ao início no mesmo dia.' });
    if (value.availability.slice(0, index).some(previous => previous.weekday === period.weekday && clockMinutes(previous.start) < clockMinutes(period.end) && clockMinutes(period.start) < clockMinutes(previous.end))) context.addIssue({ code: 'custom', path: ['availability', index], message: 'Os horários da semana não podem se sobrepor.' });
  });
  if (new Set(value.form.map(field => field.field)).size !== value.form.length) context.addIssue({ code: 'custom', path: ['form'], message: 'Cada campo do formulário só pode aparecer uma vez.' });
  if (new Set(value.agentIds).size !== value.agentIds.length) context.addIssue({ code: 'custom', path: ['agentIds'], message: 'Não repita assistentes.' });
  if (value.minimumNoticeMinutes > value.horizonDays * 1440) context.addIssue({ code: 'custom', path: ['minimumNoticeMinutes'], message: 'A antecedência não pode exceder o horizonte de reservas.' });
  if (new Set(value.customFields.map(field => field.id)).size !== value.customFields.length || new Set(value.customFields.map(field => field.label.toLowerCase())).size !== value.customFields.length) context.addIssue({ code: 'custom', path: ['customFields'], message: 'Não repita campos personalizados.' });
  if (new Set(value.staticInvitees).size !== value.staticInvitees.length) context.addIssue({ code: 'custom', path: ['staticInvitees'], message: 'Não repita convidados.' });
  if (new Set(value.conflictCalendarIds).size !== value.conflictCalendarIds.length || value.conflictCalendarIds.includes(value.calendarId)) context.addIssue({ code: 'custom', path: ['conflictCalendarIds'], message: 'Escolha calendários adicionais diferentes do calendário do evento.' });
  if (new Set(value.notifications.reminders.map(r => r.hoursBefore)).size !== value.notifications.reminders.length) context.addIssue({ code: 'custom', path: ['notifications', 'reminders'], message: 'Já existe um lembrete com esta antecedência.' });
  if (new Set(value.webhooks.map(w => w.url)).size !== value.webhooks.length) context.addIssue({ code: 'custom', path: ['webhooks'], message: 'Não repita endereços de webhook.' });
  if (value.location.kind === 'phone' && !value.location.phone && !value.form.some(field => field.field === 'phone' && field.required)) context.addIssue({ code: 'custom', path: ['location', 'phone'], message: 'Para ligar para o convidado, peça o telefone como obrigatório ou informe o número a ser chamado.' });
});
export type EventTypeConfig = z.infer<typeof eventTypeConfigSchema>;
export type BookingPage = Entity & EventTypeConfig & { revision: number; publicationStatus: 'draft' | 'unpublished' | 'published'; publicOrgSlug?: string; publicPath?: string };
const createSchema = configObject.extend({ publicationStatus: publication.default('draft') }).strict();
const patchSchema = configObject.partial().extend({ revision: z.number().int().positive(), publicationStatus: publication.optional() }).strict().refine(value => Object.keys(value).length > 1, 'Informe ao menos uma alteração.');

/** Validate configuration only; no remote request or proof of calendar availability. */
export function validateEventTypeConfig(input: unknown): EventTypeConfig { return eventTypeConfigSchema.parse(input); }
export function eventTypeConfigFromRecord(record: Record<string, unknown>): EventTypeConfig {
  return validateEventTypeConfig(Object.fromEntries(Object.keys(configObject.shape).map(key => [key, record[key]])));
}
function pageView(record: Entity): BookingPage {
  const config = eventTypeConfigFromRecord(record);
  const publicOrgSlug = typeof record.publicOrgSlug === 'string' && /^o-[a-f0-9]{24}$/.test(record.publicOrgSlug) ? record.publicOrgSlug : undefined;
  return { ...config, id: record.id, tenantId: record.tenantId, revision: z.number().int().positive().parse(record.revision), publicationStatus: z.enum(['draft', 'unpublished', 'published']).parse(record.publicationStatus), createdAt: record.createdAt, updatedAt: record.updatedAt, ...(publicOrgSlug ? { publicOrgSlug, publicPath: `/c/${publicOrgSlug}/${config.slug}` } : {}) };
}
function actorFor(store: Store, actor: MembershipActor, write: boolean) {
  const fresh = resolveMembershipActor(store, actor.userId, actor.tenantId);
  if (!fresh) throw new MembershipError(401, 'unauthorized', 'Vínculo da organização indisponível.');
  if (!hasPermission(fresh.role, write ? 'calendars:write' : 'calendars:read') || write && !hasPermission(fresh.role, 'integrations:manage')) throw new MembershipError(403, 'forbidden', 'Seu papel não permite esta operação de agendamento.');
  return fresh;
}
export function getSchedulingConfiguration(store: Store, actor: MembershipActor) {
  actorFor(store, actor, false);
  return { publicBaseUrl: publicBookingBaseUrl() };
}
function page(store: Store, tenantId: string, id: string) {
  const record = store.get(tenantId, bookingPagesCollection, uuid.parse(id));
  if (!record) throw new DomainError(404, 'event_type_not_found', 'Tipo de evento não encontrado.');
  return record;
}
function relations(store: Store, actor: MembershipActor, config: EventTypeConfig) {
  const calendar = store.get(actor.tenantId, 'calendars', config.calendarId);
  if (!calendar) throw new DomainError(404, 'calendar_not_found', 'Calendário não encontrado nesta organização.');
  if (!['google', 'microsoft'].includes(String(calendar.provider)) || typeof calendar.connectionId !== 'string' || typeof calendar.externalCalendarId !== 'string' || !calendar.externalCalendarId.trim()) throw new DomainError(400, 'external_calendar_required', 'Selecione um calendário externo conectado.');
  if (!calendar.enabled) throw new DomainError(409, 'calendar_disabled', 'O calendário está desabilitado.');
  const connection = authorizedOAuthConnection(store, actor, calendar.connectionId, 'calendar');
  if (connection.provider !== calendar.provider) throw new DomainError(409, 'calendar_connection_mismatch', 'O calendário e a conexão usam provedores diferentes.');
  // Creating a draft validates persisted references; canonical remote IDs and live
  // permissions must still be verified by publication under its own grant.
  for (const id of config.agentIds) if (!store.get(actor.tenantId, 'agents', id)) throw new DomainError(404, 'agent_not_found', 'Assistente não encontrado nesta organização.');
  for (const id of config.conflictCalendarIds) {
    const extra = store.get(actor.tenantId, 'calendars', id);
    if (!extra || !['google', 'microsoft'].includes(String(extra.provider)) || typeof extra.connectionId !== 'string' || !extra.externalCalendarId) throw new DomainError(404, 'conflict_calendar_not_found', 'Um dos calendários de conflito não está conectado nesta organização.');
  }
}
function uniqueSlug(store: Store, tenantId: string, slug: string, id?: string) {
  if (store.list(tenantId, bookingPagesCollection).some(row => row.id !== id && String(row.slug).toLowerCase() === slug)) throw new DomainError(409, 'event_type_slug_exists', 'Este endereço já está em uso na organização.');
}
function mutable(record: Entity, revision: number) {
  if (record.revision !== revision) throw new DomainError(409, 'event_type_revision_conflict', 'O tipo de evento mudou. Atualize antes de salvar.');
  if (record.publicationStatus === 'published') throw new DomainError(409, 'event_type_published', 'Despublique o tipo de evento antes de alterar sua configuração.');
}
function hasBookingReferences(store: Store, tenantId: string, id: string) {
  return ['booking-grants', 'public-bookings', 'appointments'].some(collection => store.list(tenantId, collection).some(row => row.pageId === id || row.bookingPageId === id || row.eventTypeId === id));
}
export function listEventTypes(store: Store, actor: MembershipActor, query: unknown = {}) {
  actor = actorFor(store, actor, false);
  const { page: currentPage, limit } = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict().parse(query);
  const all = store.list(actor.tenantId, bookingPagesCollection).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return { items: all.slice((currentPage - 1) * limit, currentPage * limit).map(pageView), page: currentPage, limit, total: all.length, totalPages: Math.ceil(all.length / limit) };
}
export function getEventType(store: Store, actor: MembershipActor, id: string): BookingPage {
  actor = actorFor(store, actor, false); return pageView(page(store, actor.tenantId, id));
}
export function createEventType(store: Store, actor: MembershipActor, input: unknown, assertAccess?: () => void): BookingPage {
  const { publicationStatus, ...raw } = createSchema.parse(input), config = validateEventTypeConfig(raw);
  return store.transaction(() => {
    assertAccess?.(); actor = actorFor(store, actor, true); relations(store, actor, config); uniqueSlug(store, actor.tenantId, config.slug);
    return pageView(store.create(actor.tenantId, bookingPagesCollection, { ...config, revision: 1, publicationStatus }));
  });
}
export function updateEventType(store: Store, actor: MembershipActor, id: string, input: unknown, assertAccess?: () => void): BookingPage {
  const { revision, publicationStatus, ...patch } = patchSchema.parse(input);
  return store.transaction(() => {
    assertAccess?.();
    actor = actorFor(store, actor, true); const current = page(store, actor.tenantId, id); mutable(current, revision);
    const config = validateEventTypeConfig({ ...eventTypeConfigFromRecord(current), ...patch });
    if (config.slug !== current.slug && (current.publicOrgSlug || current.grantId || hasBookingReferences(store, actor.tenantId, id))) throw new DomainError(409, 'event_type_slug_locked', 'O endereço de um tipo de evento já publicado não pode mudar.');
    relations(store, actor, config); uniqueSlug(store, actor.tenantId, config.slug, id);
    return pageView(store.update(actor.tenantId, bookingPagesCollection, id, { ...config, revision: revision + 1, publicationStatus: publicationStatus ?? current.publicationStatus })!);
  });
}
export function deleteEventType(store: Store, actor: MembershipActor, id: string, revision: number, assertAccess?: () => void) {
  z.number().int().positive().parse(revision);
  return store.transaction(() => {
    assertAccess?.();
    actor = actorFor(store, actor, true); const current = page(store, actor.tenantId, id); mutable(current, revision);
    if (hasBookingReferences(store, actor.tenantId, id)) throw new DomainError(409, 'event_type_in_use', 'O tipo de evento possui concessões ou reservas vinculadas.');
    store.remove(actor.tenantId, bookingPagesCollection, id);
  });
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function localClock(timestamp: number, zone: string) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }));
  const p = Object.fromEntries(formatters.get(zone)!.formatToParts(timestamp).map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export function bookingLocalDate(timestamp: string | number, zone: string): string {
  timezone.parse(zone); const value = typeof timestamp === 'number' ? timestamp : Date.parse(z.string().datetime({ offset: true }).parse(timestamp));
  if (!Number.isFinite(value)) throw new DomainError(400, 'invalid_booking_window', 'Data inválida.');
  return localClock(value, zone).date;
}
export type BookingWindow = { startAt: string; endAt: string; bufferStartAt: string; bufferEndAt: string; localDate: string; timezone: string; dailyLimit: number };
/** Configured window only: caller must separately check calendar restrictions,
 * local/remote busy time, grants and CAS. No availability or notification is implied.
 * Horizon is inclusive in local calendar days; buffer applies before AND after.
 */
export function validateBookingWindow(configuration: EventTypeConfig, input: unknown, options: { now?: number; bookingsOnLocalDate?: number } = {}): BookingWindow {
  const config = validateEventTypeConfig(configuration);
  const request = z.object({ startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }).optional() }).strict().parse(input);
  const now = z.number().finite().parse(options.now ?? Date.now());
  const start = Date.parse(request.startAt), end = start + config.durationMinutes * minute;
  if (start % minute !== 0 || request.endAt && Date.parse(request.endAt) !== end) throw new DomainError(400, 'invalid_booking_window', 'O horário deve usar minutos completos e a duração configurada.');
  if (!config.enabled) throw new DomainError(409, 'event_type_disabled', 'Este tipo de evento está desabilitado.');
  if (start < now + config.minimumNoticeMinutes * minute) throw new DomainError(409, 'booking_notice_required', 'O horário não respeita a antecedência mínima.');
  const local = localClock(start, config.timezone), today = localClock(now, config.timezone).date;
  if (Date.parse(`${local.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) > config.horizonDays * 86400000) throw new DomainError(409, 'booking_horizon_exceeded', 'O horário está além do horizonte permitido.');
  if (!config.availability.some(period => period.weekday === local.weekday && local.minutes >= clockMinutes(period.start) && local.minutes < clockMinutes(period.end) && (local.minutes - clockMinutes(period.start)) % config.slotIntervalMinutes === 0)) throw new DomainError(409, 'booking_outside_schedule', 'O início não corresponde aos horários e à grade configurados.');
  const bufferStart = start - config.bufferMinutes * minute, bufferEnd = end + config.bufferMinutes * minute;
  // Check each actual minute rather than assuming UTC offsets are constant across
  // DST gaps/folds. Bounds cap this loop at 960 minutes; end is exclusive.
  for (let timestamp = bufferStart; timestamp < bufferEnd; timestamp += minute) {
    const point = localClock(timestamp, config.timezone);
    if (!config.availability.some(period => period.weekday === point.weekday && point.minutes >= clockMinutes(period.start) && point.minutes < clockMinutes(period.end))) throw new DomainError(409, 'booking_outside_schedule', 'A duração e os intervalos precisam caber nos horários configurados.');
  }
  if (options.bookingsOnLocalDate !== undefined && z.number().int().nonnegative().parse(options.bookingsOnLocalDate) >= config.dailyLimit) throw new DomainError(409, 'booking_daily_limit', 'O limite de reservas deste dia foi atingido.');
  return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), bufferStartAt: new Date(bufferStart).toISOString(), bufferEndAt: new Date(bufferEnd).toISOString(), localDate: local.date, timezone: config.timezone, dailyLimit: config.dailyLimit };
}

/** Only configured fields are accepted; never writes CRM or sends notifications. */
export type BookingFormValues = Partial<Record<'name' | 'email' | 'phone', string>> & { custom?: Record<string, string> };
export function validateBookingForm(configuration: EventTypeConfig, input: unknown): BookingFormValues {
  const config = validateEventTypeConfig(configuration);
  const raw = z.record(z.string().max(500)).parse(input);
  const customKeys = new Map(config.customFields.map(field => [`c_${field.id}`, field]));
  const fields = z.object({ name: z.string().trim().max(120).optional(), email: z.string().trim().max(254).optional(), phone: z.string().trim().max(20).optional() }).strict().parse(Object.fromEntries(Object.entries(raw).filter(([key]) => !customKeys.has(key))));
  const selected = new Set(config.form.map(field => field.field));
  if (Object.keys(fields).some(field => !selected.has(field as 'name' | 'email' | 'phone'))) throw new DomainError(400, 'booking_form_invalid', 'O formulário contém um campo não solicitado.');
  const result: BookingFormValues = {};
  const custom: Record<string, string> = {};
  for (const [key, field] of customKeys) {
    const value = (raw[key] ?? '').trim();
    if (!value) { if (field.required) throw new DomainError(400, 'booking_form_required', 'Preencha os campos obrigatórios.'); continue; }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new DomainError(400, 'booking_form_invalid', 'Confira os campos do formulário.');
    if (field.type === 'email' && !z.string().email().max(254).safeParse(value).success) throw new DomainError(400, 'booking_form_invalid', 'Confira os campos do formulário.');
    if (field.type === 'phone' && !/^\+?[\d\s().-]{8,20}$/.test(value)) throw new DomainError(400, 'booking_form_invalid', 'Confira os campos do formulário.');
    custom[field.id] = value;
  }
  if (Object.keys(custom).length) result.custom = custom;
  for (const field of config.form) {
    const value = fields[field.field];
    if (!value) { if (field.required) throw new DomainError(400, 'booking_form_required', 'Preencha os campos obrigatórios.'); continue; }
    if (field.field === 'email') result.email = z.string().email().parse(value).toLowerCase();
    else if (field.field === 'phone') result.phone = z.string().regex(/^\+[1-9]\d{7,14}$/).parse(value);
    else result.name = z.string().refine(text => !/[\u0000-\u001f\u007f]/.test(text)).parse(value);
  }
  return result;
}
