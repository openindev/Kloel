import { canActivateAgent } from './billing/activation-gate.js';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { MembershipError } from './memberships/service.js';
import { capabilitiesFor, type Permission } from './memberships/permissions.js';
import { currentRequestActor, requireRequestPermission } from './memberships/access.js';
import { legacyContactSchema } from './crm/schema.js';
import { registerLegacyContacts } from './crm.js';
import { chatGeneration } from './conversation-replies-shared.js';
import { genericStatusRequiresControl } from './conversation-analysis/service.js';
import { updateLegacyContact } from './crm/service.js';

import { appointmentBlocks as appointmentOverlaps } from './appointment-blocking.js';
type Data = Record<string, unknown>;
type Resource = {
  collection: string;
  schema: z.ZodObject<any>;
  searchable: string[];
  validate?: (data: Data, store: Store, tenantId: string, id?: string) => void;
  derive?: (data: Data, previous?: Entity) => Data;
};

export class DomainError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(1).max(200);
const text = z.string().max(100_000);
const nullableId = identifier.nullable().optional();
const timezone = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Use a valid IANA time zone');
const language = z.string().max(50).refine(value => {
  try { new Intl.Locale(value); return true; } catch { return false; }
}, 'Use a valid language tag');
const isoDate = z.string().datetime({ offset: true });
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use E.164 format, for example +5511999999999');
const email = z.string().trim().toLowerCase().email().max(254);
const channel = z.enum(['webchat', 'phone', 'whatsapp', 'email']);
const labels = z.array(z.string().trim().min(1).max(80)).max(50).default([]);
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const httpUrl = z.string().url().max(4000).refine(value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}, 'Only HTTP(S) URLs are accepted');

export const agentSchema = z.object({
  name,
  description: z.string().max(2000).default(''),
  status: z.enum(['draft', 'active', 'paused']).default('draft'),
  prompt: text.default(''),
  initialMessage: z.string().max(5000).default(''),
  language: language.default('pt-BR'),
  supportedLanguages: z.array(language).min(1).max(20).default(['pt-BR']),
  voice: z.string().trim().min(1).max(100).default('alloy'),
  model: z.string().trim().min(1).max(150).optional(),
  tools: z.array(z.enum(['transfer_call', 'send_email', 'send_whatsapp', 'schedule_appointment', 'search_web', 'webhook', 'search_knowledge', 'lookup_contact'])).max(20).default([]),
  settings: z.object({
    temperature: z.number().min(0).max(2).default(0.7),
    maxResponseTokens: z.number().int().min(32).max(32768).default(1024),
    timezone: timezone.default('America/Sao_Paulo'),
    recordingEnabled: z.boolean().default(false),
    humanHandoffEnabled: z.boolean().default(true),
  }).strict().default({ temperature: 0.7, maxResponseTokens: 1024, timezone: 'America/Sao_Paulo', recordingEnabled: false, humanHandoffEnabled: true }),
  rules: z.array(z.object({
    name,
    instruction: z.string().trim().min(1).max(5000),
    enabled: z.boolean().default(true),
  }).strict()).max(100).default([]),
}).strict();


/** Regras padrão (presets) — espelho de web compileAgentRules(defaultRules()); usadas quando o agente é criado sem regras. */
export const DEFAULT_AGENT_RULES = [
  { name: 'Comunicação', instruction: 'Responda de forma curta e clara. Faça uma pergunta por vez. Peça esclarecimento quando necessário. Não peça novamente uma informação já fornecida. Seja educado e calmo.', enabled: true },
  { name: 'Identificação da IA', instruction: 'Informe que é uma IA se a pessoa perguntar.', enabled: true },
  { name: 'Estilo de resposta', instruction: 'Use linguagem clara e natural.', enabled: true },
  { name: 'Assuntos fora do escopo', instruction: 'Explique que o assunto está fora da sua responsabilidade. Ofereça registrar e encaminhar a solicitação, sem afirmar ações não confirmadas. Responda brevemente às conversas informais e volte ao assunto.', enabled: false },
  { name: 'Pessoas insatisfeitas', instruction: 'Mantenha a calma e escute sem interromper. Ofereça contato com uma pessoa. Transfira somente se houver ferramenta autorizada disponível e confirmação real.', enabled: false },
  { name: 'Abordagens comerciais', instruction: 'Recuse ofertas comerciais com educação. Após recusar, proponha encerrar educadamente. Não afirme ter desligado sem confirmação. Mantenha neutralidade ao falar sobre concorrentes.', enabled: false },
];
export const contactSchema = legacyContactSchema;

const knowledgeSchema = z.object({
  title: name,
  type: z.enum(['text', 'url', 'document']),
  content: text.default(''),
  url: httpUrl.nullable().optional(),
  document: z.object({
    filename: name,
    mimeType: z.string().min(1).max(150),
    sizeBytes: z.number().int().min(0).max(100_000_000),
    storageKey: z.string().min(1).max(1000),
  }).strict().nullable().optional(),
  agentId: nullableId,
  tags: labels,
}).strict();

const conversationSchema = z.object({
  subject: z.string().trim().max(300).default(''),
  channel: channel.default('webchat'),
  status: z.enum(['open', 'pending', 'closed']).default('open'),
  agentId: nullableId,
  contactId: nullableId,
  externalId: z.string().max(300).nullable().optional(),
  tags: labels,
}).strict();

const channelSchema = z.object({
  name,
  type: channel,
  enabled: z.boolean().default(false),
  agentId: nullableId,
  provider: z.enum(['openai', 'twilio', 'meta', 'resend', 'google', 'microsoft', 'local']),
  configuration: z.object({
    externalId: z.string().max(300).nullable().optional(),
    address: z.string().max(320).nullable().optional(),
    allowedOrigins: z.array(httpUrl).max(50).default([]),
    greeting: z.string().max(5000).default(''),
  }).strict().default({ allowedOrigins: [], greeting: '' }),
}).strict();

const phoneNumberSchema = z.object({
  name,
  number: phone,
  provider: z.enum(['twilio']).default('twilio'),
  providerNumberId: z.string().max(150).nullable().optional(),
  agentId: nullableId,
  channelId: nullableId,
  capabilities: z.array(z.enum(['voice', 'sms', 'whatsapp'])).max(3).default(['voice']),
}).strict();

const calendarSchema = z.object({
  name,
  timezone: timezone.default('America/Sao_Paulo'),
  provider: z.enum(['local', 'google', 'microsoft']).default('local'),
  externalCalendarId: z.string().max(500).nullable().optional(),
  connectionId: nullableId,
  agentId: nullableId,
  enabled: z.boolean().default(true),
  appointmentDurationMinutes: z.number().int().min(5).max(1440).default(30),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  availability: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    start: timeOfDay,
    end: timeOfDay,
  }).strict()).max(50).default([]),
}).strict();

const appointmentSchema = z.object({
  title: name,
  calendarId: identifier,
  contactId: nullableId,
  agentId: nullableId,
  startAt: isoDate,
  endAt: isoDate,
  timezone: timezone.default('America/Sao_Paulo'),
  status: z.enum(['scheduled', 'cancelled', 'completed']).default('scheduled'),
  description: z.string().max(10_000).default(''),
  attendeeEmails: z.array(email).max(100).default([]),
  location: z.string().max(1000).default(''),
}).strict();

const campaignSchema = z.object({
  name,
  channel: z.enum(['phone', 'whatsapp', 'email']),
  agentId: nullableId,
  contactIds: z.array(identifier).max(10_000).default([]),
  messageTemplate: z.string().max(20_000).default(''),
  scheduledAt: isoDate.nullable().optional(),
  status: z.literal('draft').default('draft'),
}).strict();

const referralSchema = z.object({
  name,
  email,
  notes: z.string().max(2000).default(''),
}).strict();

const settingsSchema = z.object({
  name,
  legalName: z.string().max(300).default(''),
  country: z.string().regex(/^[A-Z]{2}$/).default('BR'),
  locale: language.default('pt-BR'),
  timezone: timezone.default('America/Sao_Paulo'),
  website: httpUrl.nullable().default(null),
  supportEmail: email.nullable().default(null),
  currency: z.literal('BRL').default('BRL'),
  notifications: z.object({
    newConversation: z.boolean().default(true),
    appointmentCreated: z.boolean().default(true),
    usageWarnings: z.boolean().default(true),
  }).strict().default({ newConversation: true, appointmentCreated: true, usageWarnings: true }),
}).strict();

const settingsUpdateSchema = settingsSchema.extend({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) });
function organizationSettings(store: Store, tenantId: string, row = store.list(tenantId, 'organization-settings')[0]) {
  const organization = store.db.prepare('SELECT name FROM organizations WHERE id=?').get(tenantId);
  const values = Object.fromEntries(Object.keys(settingsSchema.shape).filter(key => row?.[key] !== undefined).map(key => [key, row![key]]));
  const settings = settingsSchema.parse({ name: String(organization?.name ?? 'Kloel AI'), ...values });
  // The monotonic revision distinguishes edits that restore the same content (ABA), even within one millisecond.
  const revision = Number.isSafeInteger(row?.revision) && Number(row?.revision) >= 0 ? Number(row?.revision) : 0;
  const version = createHash('sha256').update(JSON.stringify([tenantId, row?.id ?? null, row?.createdAt ?? null, revision, settings])).digest('hex');
  return { id: row?.id ?? null, tenantId, version, ...settings };
}

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().trim().min(1).max(100_000),
}).strict();

const listSchema = z.object({
  q: z.string().max(300).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().max(100).optional(),
  agentId: identifier.optional(),
  contactId: identifier.optional(),
  calendarId: identifier.optional(),
  channel: channel.optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'name', 'startAt']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
}).strict();

function requirePermission(store: Store, request: FastifyRequest, permission: string): void {
  requireRequestPermission(store, request, permission as Permission);
}

const resourcePermission = (collection: string, operation: 'read' | 'write' | 'delete') => {
  const prefix = collection === 'phone-numbers' ? 'phones' : collection;
  if (operation === 'delete' && prefix === 'contacts') return 'contacts:delete';
  return `${prefix}:${operation === 'delete' ? 'write' : operation}`;
};

function handler(fn: (request: FastifyRequest, reply: FastifyReply) => unknown) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await fn(request, reply); }
    catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Invalid request', details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) } });
      throw error;
    }
  };
}

function requireActivationPlan(store: Store, tenantId: string) {
  if (!canActivateAgent(store, tenantId)) throw new DomainError(402, 'plan_required', 'Assine um plano para ativar o assistente.');
}

function getId(request: FastifyRequest): string {
  return z.object({ id: identifier }).strict().parse(request.params).id;
}

function requireEntity(store: Store, tenantId: string, collection: string, id: string): Entity {
  const entity = store.get(tenantId, collection, id);
  if (!entity) throw new DomainError(404, 'not_found', 'Resource not found');
  return entity;
}

function relation(store: Store, tenantId: string, collection: string, id: unknown): Entity | undefined {
  if (typeof id !== 'string') return undefined;
  const entity = store.get(tenantId, collection, id);
  if (!entity) throw new DomainError(400, 'invalid_reference', `Referenced ${collection} resource is unavailable`);
  return entity;
}

function commonRelations(data: Data, store: Store, tenantId: string): void {
  relation(store, tenantId, 'agents', data.agentId);
  relation(store, tenantId, 'contacts', data.contactId);
}

function paginate(items: Entity[], input: unknown, searchable: string[]) {
  const query = listSchema.parse(input);
  let filtered = items;
  if (query.q) {
    const needle = query.q.toLocaleLowerCase('pt-BR');
    filtered = filtered.filter(item => searchable.some(key => {
      const value = item[key];
      return typeof value === 'string' ? value.toLocaleLowerCase('pt-BR').includes(needle) : Array.isArray(value) && value.some(part => typeof part === 'string' && part.toLocaleLowerCase('pt-BR').includes(needle));
    }));
  }
  for (const key of ['status', 'agentId', 'contactId', 'calendarId', 'channel'] as const) {
    if (query[key]) filtered = filtered.filter(item => item[key] === query[key]);
  }
  filtered.sort((a, b) => {
    const compared = String(a[query.sort] ?? '').localeCompare(String(b[query.sort] ?? '')) || a.id.localeCompare(b.id);
    return query.order === 'asc' ? compared : -compared;
  });
  const total = filtered.length;
  return { items: filtered.slice((query.page - 1) * query.limit, query.page * query.limit), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
}

function validateAppointment(data: Data, store: Store, tenantId: string, id?: string): void {
  commonRelations(data, store, tenantId);
  const calendar = relation(store, tenantId, 'calendars', data.calendarId)!;
  const start = Date.parse(String(data.startAt));
  const end = Date.parse(String(data.endAt));
  if (end <= start || end - start > 86_400_000) throw new DomainError(400, 'invalid_interval', 'An appointment must end after it starts and last no more than 24 hours');
  if (data.status !== 'scheduled') return;
  if (!calendar.enabled) throw new DomainError(409, 'calendar_disabled', 'The calendar is disabled');
  if (!withinAvailability(calendar, start, end)) throw new DomainError(409, 'outside_availability', 'The appointment is outside the calendar availability');
  const buffer = Number(calendar.bufferMinutes ?? 0) * 60_000;
  const collision = store.list(tenantId, 'appointments').some(item => item.id !== id && item.calendarId === data.calendarId && item.status === 'scheduled' && appointmentOverlaps(item, start, end, buffer));
  if (collision) throw new DomainError(409, 'appointment_overlap', 'The calendar already has an appointment in this interval');
}

type Availability = { weekday: number; start: string; end: string };
const clockFormatters = new Map<string, Intl.DateTimeFormat>();
function localClock(timestamp: number, zone: string) {
  if (!clockFormatters.has(zone)) clockFormatters.set(zone, new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  const parts = clockFormatters.get(zone)!.formatToParts(timestamp);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday), minutes: Number(values.hour) * 60 + Number(values.minute) + Number(values.second) / 60 };
}
function minutes(value: string): number { const [hours, mins] = value.split(':').map(Number); return hours * 60 + mins; }
function withinAvailability(calendar: Entity, start: number, end: number): boolean {
  const availability = (calendar.availability ?? []) as Availability[];
  if (!availability.length) return true;
  const from = localClock(start, String(calendar.timezone));
  const to = localClock(end, String(calendar.timezone));
  return from.date === to.date && availability.some(slot => slot.weekday === from.weekday && from.minutes >= minutes(slot.start) && to.minutes <= minutes(slot.end));
}

const slotsSchema = z.object({ calendarId: identifier, from: isoDate, to: isoDate, stepMinutes: z.coerce.number().int().min(5).max(240).optional() }).strict();
export function listCalendarSlots(store: Store, tenantId: string, input: unknown) {
  const query = slotsSchema.parse(input);
  const calendar = requireEntity(store, tenantId, 'calendars', query.calendarId);
  const from = Date.parse(query.from);
  const to = Date.parse(query.to);
  if (to <= from || to - from > 7 * 86_400_000) throw new DomainError(400, 'invalid_interval', 'Availability queries must cover a positive interval no longer than 7 days');
  const slots: { startAt: string; endAt: string }[] = [];
  if (!calendar.enabled) return { calendarId: calendar.id, timezone: calendar.timezone, slots, source: 'local_calendar' as const };
  const duration = Number(calendar.appointmentDurationMinutes) * 60_000;
  const step = query.stepMinutes ?? Number(calendar.appointmentDurationMinutes);
  const buffer = Number(calendar.bufferMinutes ?? 0) * 60_000;
  const appointments = store.list(tenantId, 'appointments').filter(item => item.calendarId === calendar.id && item.status === 'scheduled');
  const availability = (calendar.availability ?? []) as Availability[];
  for (let start = Math.ceil(from / 60_000) * 60_000; start + duration <= to; start += 60_000) {
    const local = localClock(start, String(calendar.timezone));
    const ranges = availability.length ? availability.filter(slot => slot.weekday === local.weekday) : [{ start: '00:00', end: '23:59', weekday: local.weekday }];
    if (!ranges.some(slot => local.minutes >= minutes(slot.start) && (local.minutes - minutes(slot.start)) % step === 0)) continue;
    const end = start + duration;
    if (!withinAvailability(calendar, start, end)) continue;
    if (appointments.some(item => appointmentOverlaps(item, start, end, buffer))) continue;
    slots.push({ startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() });
  }
  return { calendarId: calendar.id, timezone: calendar.timezone, slots, source: 'local_calendar' as const };
}

export function createDomainAppointment(store: Store, tenantId: string, input: unknown, assertAccess?: () => void): Entity {
  const data = appointmentSchema.parse(input);
  return store.transaction(() => {
    assertAccess?.();
    validateAppointment(data, store, tenantId);
    return store.create(tenantId, 'appointments', { ...data, startAt: new Date(data.startAt).toISOString(), endAt: new Date(data.endAt).toISOString(), syncStatus: 'local_only' });
  });
}

export function updateDomainAppointment(store: Store, tenantId: string, id: string, input: unknown, assertAccess?: () => void): Entity {
  const patch = validatePatch(appointmentSchema, input);
  return store.transaction(() => {
    assertAccess?.();
    const previous = requireEntity(store, tenantId, 'appointments', id);
    if (typeof previous.bookingId === 'string') throw new DomainError(409, 'external_appointment_requires_sync', 'Use the public-booking operation to change this reservation or its hold');
    const data = appointmentSchema.parse(mergePatch(editableData(appointmentSchema, previous), patch));
    validateAppointment(data, store, tenantId, id);
    return store.update(tenantId, 'appointments', id, { ...data, startAt: new Date(data.startAt).toISOString(), endAt: new Date(data.endAt).toISOString() })!;
  });
}

export function mergePatch(previous: Data, patch: Data): Data {
  const result = Object.fromEntries(Object.entries(previous));
  for (const [key, value] of Object.entries(patch)) {
    const old = Object.hasOwn(previous, key) ? previous[key] : undefined;
    const merged = value && typeof value === 'object' && !Array.isArray(value) && old && typeof old === 'object' && !Array.isArray(old) ? mergePatch(old as Data, value as Data) : value;
    Object.defineProperty(result, key, { value: merged, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function validatePatch(schema: Resource['schema'], input: unknown): Data {
  const patch = z.record(z.string(), z.unknown()).parse(input);
  const allowed = new Set(Object.keys(schema.shape));
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !allowed.has(key))) throw new DomainError(400, 'invalid_patch', 'Provide at least one editable field; identifiers and system fields cannot be changed');
  return patch;
}

export function updateDomainContact(store: Store, tenantId: string, id: string, input: unknown, expectedRevision: number, actorId = 'internal'): Entity {
  return updateLegacyContact(store, tenantId, id, input, expectedRevision, actorId);
}

const resources: Resource[] = [
  { collection: 'agents', schema: agentSchema, searchable: ['name', 'description'] },
  { collection: 'knowledge', schema: knowledgeSchema, searchable: ['title', 'content', 'tags'], validate(data, store, tenantId) {
    commonRelations(data, store, tenantId);
    if (data.type === 'text' && !String(data.content).trim()) throw new DomainError(400, 'content_required', 'Text knowledge requires content');
    if (data.type === 'url' && !data.url) throw new DomainError(400, 'url_required', 'URL knowledge requires a URL');
    if (data.type === 'document' && !data.document) throw new DomainError(400, 'document_required', 'Document knowledge requires document metadata');
  }, derive: (data, previous) => ({ ...data, ingestionStatus: data.type === 'text' ? 'stored_text' : 'pending', indexed: false, embeddingModel: null, chunkCount: 0, sourceHash: null, indexedAt: null, extraction: previous && ['type', 'content', 'url', 'document'].every(key => JSON.stringify(data[key]) === JSON.stringify(previous[key])) ? previous.extraction ?? null : null }) },
  { collection: 'conversations', schema: conversationSchema, searchable: ['subject', 'tags'], validate: commonRelations },
  { collection: 'channels', schema: channelSchema, searchable: ['name', 'type', 'provider'], validate: commonRelations, derive: data => ({ ...data, verificationStatus: 'unverified' }) },
  { collection: 'phone-numbers', schema: phoneNumberSchema, searchable: ['name', 'number'], validate(data, store, tenantId, id) {
    commonRelations(data, store, tenantId);
    const linked = relation(store, tenantId, 'channels', data.channelId);
    if (linked && linked.type !== 'phone') throw new DomainError(400, 'invalid_channel', 'A phone number requires a phone channel');
    if (store.list(tenantId, 'phone-numbers').some(item => item.id !== id && item.number === data.number)) throw new DomainError(409, 'duplicate_number', 'This number is already registered');
  }, derive: data => ({ ...data, provisioningStatus: 'unverified' }) },
  { collection: 'calendars', schema: calendarSchema, searchable: ['name'], validate(data, store, tenantId) {
    commonRelations(data, store, tenantId);
    const connection = relation(store, tenantId, 'oauth-connections', data.connectionId);
    if (connection && connection.provider !== data.provider) throw new DomainError(400, 'invalid_connection', 'The calendar provider must match its OAuth connection');
    const slots = data.availability as { weekday: number; start: string; end: string }[];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].end <= slots[i].start) throw new DomainError(400, 'invalid_availability', 'Availability must end after it starts on the same day');
      if (slots.slice(i + 1).some(other => other.weekday === slots[i].weekday && slots[i].start < other.end && slots[i].end > other.start)) throw new DomainError(400, 'overlapping_availability', 'Availability intervals must not overlap');
    }
  }, derive: data => ({ ...data, syncStatus: data.provider === 'local' ? 'local_only' : 'not_connected' }) },
  { collection: 'appointments', schema: appointmentSchema, searchable: ['title', 'description', 'location'], validate: validateAppointment, derive: data => ({ ...data, startAt: new Date(String(data.startAt)).toISOString(), endAt: new Date(String(data.endAt)).toISOString(), syncStatus: 'local_only' }) },
  { collection: 'campaigns', schema: campaignSchema, searchable: ['name', 'messageTemplate'], validate(data, store, tenantId) {
    commonRelations(data, store, tenantId);
    for (const contactId of data.contactIds as string[]) relation(store, tenantId, 'contacts', contactId);
    if (new Set(data.contactIds as string[]).size !== (data.contactIds as string[]).length) throw new DomainError(400, 'duplicate_recipient', 'A contact may appear only once in a campaign');
  }, derive: data => ({ ...data, sentCount: 0, executionEnabled: false }) },
  { collection: 'referrals', schema: referralSchema, searchable: ['name', 'email'], derive: data => ({ ...data, status: 'recorded', rewardStatus: 'not_earned', invitationSent: false }) },
];

function preventReferencedDeletion(store: Store, tenantId: string, collection: string, id: string): void {
  const references: Record<string, [string, string][]> = {
    agents: [['knowledge', 'agentId'], ['conversations', 'agentId'], ['channels', 'agentId'], ['phone-numbers', 'agentId'], ['calendars', 'agentId'], ['appointments', 'agentId'], ['campaigns', 'agentId']],
    contacts: [['conversations', 'contactId'], ['appointments', 'contactId'], ['campaigns', 'contactIds']],
    channels: [['phone-numbers', 'channelId']],
    calendars: [['appointments', 'calendarId']],
  };
  for (const [otherCollection, field] of references[collection] ?? []) {
    if (store.list(tenantId, otherCollection).some(item => item[field] === id || Array.isArray(item[field]) && (item[field] as unknown[]).includes(id))) throw new DomainError(409, 'resource_in_use', `Remove references from ${otherCollection} before deleting this resource`);
  }
}

function editableData(schema: Resource['schema'], entity: Entity): Data {
  const keys = Object.keys(schema.shape);
  return Object.fromEntries(keys.filter(key => entity[key] !== undefined).map(key => [key, entity[key]]));
}

function requireLocalAppointmentMutation(entity: Entity, deleting = false): void {
  const managed = typeof entity.bookingId === 'string' || typeof entity.externalEventId === 'string' || typeof entity.connectionId === 'string' || ['pending', 'synced', 'pending_reconciliation'].includes(String(entity.syncStatus));
  const remotelyCancelled = entity.status === 'cancelled' && entity.syncStatus === 'synced';
  if (managed && !(deleting && remotelyCancelled)) throw new DomainError(409, 'external_appointment_requires_sync', 'Use the connected-calendar operation to change this appointment; local edits would leave its remote event unchanged');
}
function requirePrivateWebchatChannelMutation(collection: string, previous?: Data, next?: Data): void {
  if (collection === 'channels' && (previous?.type === 'whatsapp' || next?.type === 'whatsapp')) throw new DomainError(409, 'whatsapp_private_route_required', 'Gerencie WhatsApp em /api/v1/whatsapp/channels para preservar versões e recuperação.');
  if (collection === 'phone-numbers') throw new DomainError(409, 'phone_private_route_required', 'Gerencie números em /api/v1/phone-config/numbers para preservar versões e recuperação.');
  if (collection === 'channels' && (previous?.type === 'webchat' || next?.type === 'webchat')) throw new DomainError(409, 'webchat_private_route_required', 'Gerencie o chat do site em /api/v1/webchat/channels para preservar versões e recuperação.');
}


export function requireRecordingPermission(store: Store, request: FastifyRequest, collection: string, data: Data, previous?: Entity) {
  if (collection !== 'agents') return;
  const enabled = (data.settings as Data | undefined)?.recordingEnabled ?? false;
  const previousEnabled = (previous?.settings as Data | undefined)?.recordingEnabled ?? false;
  if (enabled !== previousEnabled) requirePermission(store, request, 'recordings:manage');
}

export async function registerDomains(app: FastifyInstance, store: Store): Promise<void> {
  await registerLegacyContacts(app, store);
  for (const resource of resources) {
    const base = `/api/v1/${resource.collection}`;
    app.get(base, handler(request => {
      const current = currentRequestActor(store, request);
      requirePermission(store, request, resourcePermission(resource.collection, 'read'));
      return paginate(store.list(current.tenantId, resource.collection), request.query, resource.searchable);
    }));
    app.get(`${base}/:id`, handler(request => {
      const current = currentRequestActor(store, request);
      requirePermission(store, request, resourcePermission(resource.collection, 'read'));
      return requireEntity(store, current.tenantId, resource.collection, getId(request));
    }));
    app.post(base, handler((request, reply) => {
      const current = currentRequestActor(store, request);
      requirePermission(store, request, resourcePermission(resource.collection, 'write'));
      const data = resource.schema.parse(request.body) as Data;
      if (resource.collection === 'agents') {
        const raw = request.body as Data | undefined;
        if (!raw || !Array.isArray(raw.rules)) data.rules = DEFAULT_AGENT_RULES.map(r => ({ ...r }));
        if (data.status === 'active') requireActivationPlan(store, current.tenantId);
      }
      requireRecordingPermission(store, request, resource.collection, data);
      const entity = store.transaction(() => {
        requirePrivateWebchatChannelMutation(resource.collection, undefined, data);
        resource.validate?.(data, store, current.tenantId);
        return store.create(current.tenantId, resource.collection, resource.derive?.(data) ?? data);
      });
      return reply.code(201).send(entity);
    }));
    app.patch(`${base}/:id`, handler(request => {
      const current = currentRequestActor(store, request);
      requirePermission(store, request, resourcePermission(resource.collection, 'write'));
      const id = getId(request);
      const patch = validatePatch(resource.schema, request.body);
      return store.transaction(() => {
        if (resource.collection === 'conversations') requirePermission(store, request, 'conversations:write');
        const previous = requireEntity(store, current.tenantId, resource.collection, id);
        if (resource.collection === 'conversations' && patch.status !== undefined && patch.status !== previous.status && genericStatusRequiresControl(store, previous)) throw new DomainError(409, 'conversation_control_required', 'Use o controle ou fechamento da conversa com a versão atual.');
        if (resource.collection === 'appointments') requireLocalAppointmentMutation(previous);
        const data = resource.schema.parse(mergePatch(editableData(resource.schema, previous), patch)) as Data;
        requirePrivateWebchatChannelMutation(resource.collection, previous, data);
        requireRecordingPermission(store, request, resource.collection, data, previous);
        resource.validate?.(data, store, current.tenantId, id);
        if (resource.collection === 'knowledge') for (const chunk of store.list(current.tenantId, 'knowledge-chunks').filter(item => item.knowledgeId === id)) store.remove(current.tenantId, 'knowledge-chunks', chunk.id);
        const derived = resource.derive?.(data, previous) ?? data;
        if (resource.collection === 'agents') {
          if (derived.status === 'active' && previous.status !== 'active') requireActivationPlan(store, current.tenantId);
          const generation = previous.delegationGeneration ?? 0;
          if (!Number.isSafeInteger(generation) || Number(generation) < 0 || Number(generation) >= Number.MAX_SAFE_INTEGER) throw new DomainError(409, 'agent_delegation_version_invalid', 'A versão de delegação do assistente não permite alteração.');
          return store.update(current.tenantId, resource.collection, id, { ...derived, delegationGeneration: Number(generation) + 1 });
        }
        return store.update(current.tenantId, resource.collection, id, resource.collection === 'conversations' ? { ...derived, replyRevision: chatGeneration(previous) + 1 } : derived);
      });
    }));
    app.delete(`${base}/:id`, handler((request, reply) => {
      const current = currentRequestActor(store, request);
      requirePermission(store, request, resourcePermission(resource.collection, 'delete'));
      const id = getId(request);
      store.transaction(() => {
        const previous = requireEntity(store, current.tenantId, resource.collection, id);
        requirePrivateWebchatChannelMutation(resource.collection, previous);
        if (resource.collection === 'appointments') requireLocalAppointmentMutation(previous, true);
        preventReferencedDeletion(store, current.tenantId, resource.collection, id);
        if (resource.collection === 'conversations') {
          for (const message of store.list(current.tenantId, 'messages').filter(item => item.conversationId === id)) store.remove(current.tenantId, 'messages', message.id);
        }
        if (resource.collection === 'knowledge') for (const chunk of store.list(current.tenantId, 'knowledge-chunks').filter(item => item.knowledgeId === id)) store.remove(current.tenantId, 'knowledge-chunks', chunk.id);
        store.remove(current.tenantId, resource.collection, id);
      });
      return reply.code(204).send();
    }));
  }

  app.get('/api/v1/calendars/:id/slots', handler(request => {
    const current = currentRequestActor(store, request);
    requirePermission(store, request, 'calendars:read');
    return listCalendarSlots(store, current.tenantId, { ...(request.query as Data), calendarId: getId(request) });
  }));

  app.get('/api/v1/conversations/:id/messages', handler(request => {
    const current = currentRequestActor(store, request);
    requirePermission(store, request, 'conversations:read');
    const id = getId(request);
    requireEntity(store, current.tenantId, 'conversations', id);
    return paginate(store.list(current.tenantId, 'messages').filter(item => item.conversationId === id), { sort: 'createdAt', order: 'asc', ...(request.query as Data) }, ['content']);
  }));
  app.post('/api/v1/conversations/:id/messages', handler((request, reply) => {
    const current = currentRequestActor(store, request);
    requirePermission(store, request, 'conversations:write');
    const id = getId(request);
    const data = messageSchema.parse(request.body);
    const result = store.transaction(() => {
      const conversation = requireEntity(store, current.tenantId, 'conversations', id);
      if (conversation.status === 'closed') throw new DomainError(409, 'conversation_closed', 'Reopen the conversation before adding a message');
      const message = store.create(current.tenantId, 'messages', { ...data, conversationId: id, authorUserId: current.userId, source: 'manual', deliveryStatus: 'recorded' });
      store.update(current.tenantId, 'conversations', id, { lastMessageAt: message.createdAt });
      return message;
    });
    return reply.code(201).send(result);
  }));

  app.get('/api/v1/organization-settings', handler(request => {
    const current = currentRequestActor(store, request);
    requirePermission(store, request, 'organization:read');
    return organizationSettings(store, current.tenantId);
  }));
  app.put('/api/v1/organization-settings', handler(request => {
    const current = currentRequestActor(store, request);
    requirePermission(store, request, 'organization:write');
    const { expectedVersion, ...data } = settingsUpdateSchema.parse(request.body);
    return store.transaction(() => {
      const fresh = currentRequestActor(store, request);
      requirePermission(store, request, 'organization:write');
      const previous = store.list(fresh.tenantId, 'organization-settings')[0];
      if (organizationSettings(store, fresh.tenantId, previous).version !== expectedVersion) {
        throw new DomainError(409, 'organization_settings_conflict', 'As configurações mudaram. Recarregue e revise antes de salvar.');
      }
      const revision = (Number.isSafeInteger(previous?.revision) && Number(previous?.revision) >= 0 ? Number(previous?.revision) : 0) + 1;
      if (!Number.isSafeInteger(revision)) throw new DomainError(409, 'organization_settings_conflict', 'O limite de revisões foi alcançado.');
      const updated = previous
        ? store.update(fresh.tenantId, 'organization-settings', previous.id, { ...data, revision })!
        : store.create(fresh.tenantId, 'organization-settings', { ...data, revision });
      store.db.prepare('UPDATE organizations SET name=? WHERE id=?').run(data.name, fresh.tenantId);
      return organizationSettings(store, fresh.tenantId, updated);
    });
  }));

  app.get('/api/v1/overview', handler(request => {
    const current = currentRequestActor(store, request);
    const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30), agentId: identifier.optional() }).strict().parse(request.query);
    if (query.agentId) relation(store, current.tenantId, 'agents', query.agentId);
    const now = new Date();
    const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - query.days + 1));
    const conversations = store.list(current.tenantId, 'conversations').filter(item => !query.agentId || item.agentId === query.agentId);
    const conversationIds = new Set(conversations.map(item => item.id));
    const messages = store.list(current.tenantId, 'messages').filter(item => conversationIds.has(String(item.conversationId)));
    const appointments = store.list(current.tenantId, 'appointments').filter(item => !query.agentId || item.agentId === query.agentId);
    const inPeriod = (item: Entity) => Date.parse(item.createdAt) >= firstDay.getTime() && Date.parse(item.createdAt) <= now.getTime();
    const daily = Array.from({ length: query.days }, (_, index) => ({ date: new Date(firstDay.getTime() + index * 86_400_000).toISOString().slice(0, 10), conversations: 0, messages: 0 }));
    const buckets = new Map(daily.map(item => [item.date, item]));
    for (const conversation of conversations.filter(inPeriod)) { const bucket = buckets.get(conversation.createdAt.slice(0, 10)); if (bucket) bucket.conversations++; }
    for (const message of messages.filter(inPeriod)) { const bucket = buckets.get(message.createdAt.slice(0, 10)); if (bucket) bucket.messages++; }
    return {
      period: { from: firstDay.toISOString(), to: now.toISOString(), timezone: 'UTC' },
      counts: {
        agents: store.list(current.tenantId, 'agents').filter(item => !query.agentId || item.id === query.agentId).length,
        contacts: store.list(current.tenantId, 'contacts').length,
        conversations: conversations.length,
        openConversations: conversations.filter(item => item.status === 'open').length,
        messages: messages.length,
        appointments: appointments.length,
        upcomingAppointments: appointments.filter(item => item.status === 'scheduled' && Date.parse(String(item.startAt)) >= now.getTime()).length,
        knowledgeEntries: store.list(current.tenantId, 'knowledge').filter(item => !query.agentId || item.agentId === query.agentId).length,
      },
      periodCounts: { conversations: conversations.filter(inPeriod).length, messages: messages.filter(inPeriod).length },
      daily,
      usage: { cost: null, callMinutes: null, tokenCount: null, status: 'not_aggregated', explanation: 'Provider billing and usage must be reconciled before financial or duration metrics can be reported.' },
      source: 'stored_tenant_records',
    };
  }));

  app.get('/api/v1/capabilities', handler(request => {
    const current = currentRequestActor(store, request);
    return { role: current.role, permissions: capabilitiesFor(current.role), items: [
      { name: 'domain_crud', status: 'implemented_local', detail: 'Tenant-scoped agents, contacts, knowledge metadata/text, conversations, channels, calendars and appointments.' },
      { name: 'appointment_conflicts', status: 'implemented_local', detail: 'Local calendars prevent overlapping scheduled appointments, including buffers.' },
      { name: 'provider_operations', status: 'requires_configuration_and_validation', detail: 'See /api/v1/providers/status. Credentials and real provider validation are required; saving metadata does not connect a provider.' },
      { name: 'knowledge_ingestion', status: 'requires_openai_configuration', detail: 'Text, UTF-8 documents, PDF text and public HTTP(S) sources can be imported then indexed via /knowledge/:id/ingest, with scoped vector retrieval at /knowledge/search. PDF extraction runs in a bounded worker; URL import pins public DNS resolutions. OCR and JavaScript-rendered pages are not supported.' },
      { name: 'calendar_sync', status: 'not_implemented', detail: 'Appointments are local; external Google/Microsoft sync is not performed by this module.' },
      { name: 'campaign_execution', status: 'not_implemented', detail: 'Campaign drafts only; no messages or calls are scheduled or dispatched.' },
      { name: 'referral_rewards', status: 'not_implemented', detail: 'Referral records only; no invitations sent and no rewards credited.' },
      { name: 'billing_analytics', status: 'not_aggregated', detail: 'No estimated or invented provider spend or call duration.' },
    ] };
  }));
}
