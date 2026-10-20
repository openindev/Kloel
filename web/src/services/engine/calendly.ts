import { EngineError } from './http'
import type { EngineContext } from './session'

export type CalendlyConnection = { id: string; provider: 'calendly'; revision: number; authorizationGeneration: number; status: 'connected' | 'scope_unverified' | 'reauthorization_required' | 'disconnected'; displayName: string; timezone: string; scopes: string[]; createdAt: string; updatedAt: string }
export type CalendlyEventType = { id: string; name: string; durationMinutes: number | null; timezone: string; supported: boolean; unavailableReason: string | null; schedulingUrl: string | null }
export type CalendlyAction = { id: string; agentId: string; connectionId: string; eventTypeId: string; audience: 'private' | 'webchat'; channelId: string | null; revision: number; enabled: boolean; allowCreate: boolean; expiresAt: string; maxBookingsPerDay: number; available: boolean; unavailableReason: string | null }
export type CalendlyPolicy = { enabled: boolean; allowCreate: boolean; expiresInDays: number; maxBookingsPerDay: number }
export type CalendlyConfigAttempt = { key: string; kind: 'calendly.action.create'; agentId: string; connectionId: string; eventTypeId: string; audience: 'private' | 'webchat'; channelId: string | null } | { key: string; kind: 'calendly.action.update'; agentId: string; resourceId: string; expectedRevision: number } | { key: string; kind: 'calendly.connection.disconnect'; agentId: null; resourceId: string; expectedRevision: number }
export type CalendlyConfigReceipt = { key: string; kind: CalendlyConfigAttempt['kind']; tenantId: string; resourceId: string; agentId: string | null; revision: number; status: 'succeeded'; automaticRetry: false; createdAt: string }
export type CalendlyChoice = { provider: 'calendly'; choiceId: string; conversationId: string; chatOperationKey: string; actionId: string; actionRevision: number; eventTypeId: string; title: string; timezone: string; durationMinutes: number; form: { name: { required: true; maxLength: 120 }; email: { required: true; maxLength: 254 }; timezone: { required: true } }; allowCreate: boolean; slots: { startAt: string; endAt: string; quote: string; expiresAt: string }[]; complete: boolean; nextFrom: string | null; reservationsGuaranteed: false; notifications: 'provider_managed_unknown' }
export type CalendlyAttempt = { key: string; conversationId: string; actionId: string; actionRevision: number; eventTypeId: string; chatOperationKey: string }
export type CalendlyReceipt = { key: string; kind: 'calendly.invitee.create'; tenantId: string; conversationId: string; actionId: string; actionRevision: number; eventTypeId: string; bookingRef: string; requestedTime: { startAt: string; endAt: string; timezone: string }; status: 'pending' | 'unknown' | 'accepted' | 'confirmed' | 'conflict' | 'not_sent' | 'failed'; effect: 'unconfirmed' | 'http_accepted' | 'event_verified' | 'not_sent' | 'provider_rejected'; needsReconciliation: boolean; automaticRetry: false; notifications: 'provider_managed_unknown'; reasonCode: string | null; createdAt: string; updatedAt: string }
export type CalendlyCancellationAttempt = { key: string; creationKey: string; bookingRef: string; previousNotSentKey?: string }
export type CalendlyCancellationReason = 'authority_changed' | 'verification_unavailable' | 'verification_conflict' | 'already_canceled' | 'provider_rejected' | 'provider_response_invalid' | 'outcome_unknown'
export type CalendlyCancellationReceipt = { key: string; kind: 'calendly.event.cancel'; tenantId: string; creationKey: string; bookingRef: string; status: 'pending' | 'unknown' | 'accepted' | 'confirmed' | 'conflict' | 'not_sent' | 'failed'; effect: 'unconfirmed' | 'http_accepted' | 'cancellation_verified' | 'verification_conflict' | 'not_sent' | 'provider_rejected'; needsReconciliation: boolean; automaticRetry: false; notifications: 'provider_managed_unknown'; reasonCode: CalendlyCancellationReason | null; attemptedAt: string | null; acceptedAt: string | null; verifiedAt: string | null; createdAt: string; updatedAt: string }

export type CalendlyOAuth = { operationKey: string; status: 'pending' | 'connected' | 'unknown' | 'expired'; authorizationUrl: string | null; expiresAt: string; connectionId: string | null }
export type CalendlyValues = { name: string; email: string; timezone: string }

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
function invalid(): never { throw new EngineError(0, 'invalid_calendly_response', 'Os dados recebidos do Calendly são inválidos. Consulte a referência original antes de outra ação.') }
export function calendlyId(v: unknown): string { if (typeof v !== 'string' || !uuid.test(v)) invalid(); return v }
export function calendlyChatKey(v: unknown): string { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(v)) invalid(); return v }
function text(v: unknown, max = 200): string { if (typeof v !== 'string' || !v.trim() || v.length > max) invalid(); return v }
function integer(v: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) invalid(); return v as number }
function bool(v: unknown): boolean { if (typeof v !== 'boolean') invalid(); return v }
function date(v: unknown): string { const s = text(v, 40); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s) || !Number.isFinite(Date.parse(s))) invalid(); return s }
export function calendlyTimezone(v: unknown): string { const s = text(v, 100); try { new Intl.DateTimeFormat('en', { timeZone: s }) } catch { invalid() } return s }
function record(v: unknown, fields: string[]): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== fields.length || Object.keys(v).some(k => !fields.includes(k))) invalid(); return v as Record<string, unknown> }
function list<T>(v: unknown, parser: (x: unknown) => T, max = 100): T[] { if (!Array.isArray(v) || v.length > max) invalid(); return v.map(parser) }
function unique<T>(rows: T[], key: (v: T) => string): T[] { if (new Set(rows.map(key)).size !== rows.length) invalid(); return rows }
function reason(v: unknown): string | null { if (v === null) return null; const s = text(v, 100); if (!/^[a-z][a-z0-9_]*$/.test(s)) invalid(); return s }
function nullableId(v: unknown): string | null { return v === null ? null : calendlyId(v) }
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T => { if (typeof v !== 'string' || !values.includes(v as T)) invalid(); return v as T }
export function calendlyUrl(v: unknown, mode: 'authorization' | 'scheduling' | 'cancel' | 'reschedule'): string {
  const s = text(v, 2048); let u: URL; try { u = new URL(s) } catch { invalid() }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) invalid()
  if (mode === 'authorization') {
    if (u.hostname !== 'auth.calendly.com' || u.pathname !== '/oauth/authorize' || [...u.searchParams.keys()].some(k => !['client_id', 'response_type', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method'].includes(k)) || u.searchParams.get('response_type') !== 'code' || !u.searchParams.get('state')) invalid()
  } else if (u.hostname !== 'calendly.com' || u.search || mode === 'scheduling' && !/^\/[A-Za-z0-9_/-]+$/.test(u.pathname) || mode !== 'scheduling' && !new RegExp(`^/${mode === 'cancel' ? 'cancellations' : 'reschedulings'}/[a-f0-9-]{36}$`, 'i').test(u.pathname)) invalid()
  return s
}
export function parseCalendlyConnection(v: unknown): CalendlyConnection {
  const r = record(v, ['id', 'provider', 'revision', 'authorizationGeneration', 'status', 'displayName', 'timezone', 'scopes', 'createdAt', 'updatedAt']); if (r.provider !== 'calendly') invalid()
  return { id: calendlyId(r.id), provider: 'calendly', revision: integer(r.revision), authorizationGeneration: integer(r.authorizationGeneration), status: oneOf(r.status, ['connected', 'scope_unverified', 'reauthorization_required', 'disconnected']), displayName: text(r.displayName, 200), timezone: calendlyTimezone(r.timezone), scopes: unique(list(r.scopes, s => text(s, 100), 50), s => s), createdAt: date(r.createdAt), updatedAt: date(r.updatedAt) }
}
export function parseCalendlyEventType(v: unknown): CalendlyEventType {
  const r = record(v, ['id', 'name', 'durationMinutes', 'timezone', 'supported', 'unavailableReason', 'schedulingUrl']), supported = bool(r.supported)
  const unavailableReason = r.unavailableReason === null ? null : oneOf(r.unavailableReason, ['inactive', 'owner_mismatch', 'unsupported_booking_method', 'unsupported_kind', 'unsupported_duration', 'unsupported_payment', 'unsupported_questions', 'unsupported_location', 'snapshot_incomplete'])
  if (supported !== (unavailableReason === null) || supported && r.durationMinutes === null) invalid()
  return { id: calendlyId(r.id), name: text(r.name, 160), durationMinutes: r.durationMinutes === null ? null : integer(r.durationMinutes), timezone: calendlyTimezone(r.timezone), supported, unavailableReason, schedulingUrl: r.schedulingUrl === null ? null : calendlyUrl(r.schedulingUrl, 'scheduling') }
}
export function parseCalendlyAction(v: unknown, agentId?: string): CalendlyAction {
  const r = record(v, ['id', 'agentId', 'connectionId', 'eventTypeId', 'audience', 'channelId', 'revision', 'enabled', 'allowCreate', 'expiresAt', 'maxBookingsPerDay', 'available', 'unavailableReason']), audience = oneOf(r.audience, ['private', 'webchat']), channelId = nullableId(r.channelId)
  if (agentId && r.agentId !== agentId || (audience === 'private') !== (channelId === null)) invalid()
  return { id: calendlyId(r.id), agentId: calendlyId(r.agentId), connectionId: calendlyId(r.connectionId), eventTypeId: calendlyId(r.eventTypeId), audience, channelId, revision: integer(r.revision), enabled: bool(r.enabled), allowCreate: bool(r.allowCreate), expiresAt: date(r.expiresAt), maxBookingsPerDay: integer(r.maxBookingsPerDay, 1, 100), available: bool(r.available), unavailableReason: reason(r.unavailableReason) }
}
export function validCalendlyConfigAttempt(v: unknown): v is CalendlyConfigAttempt {
  try {
    if (!v || typeof v !== 'object') return false
    const a = v as CalendlyConfigAttempt
    if (a.kind === 'calendly.action.create') { record(v, ['key', 'kind', 'agentId', 'connectionId', 'eventTypeId', 'audience', 'channelId']); calendlyId(a.agentId); calendlyId(a.connectionId); calendlyId(a.eventTypeId); if (a.audience === 'private' ? a.channelId !== null : a.audience !== 'webchat' || !uuid.test(a.channelId ?? '')) invalid() }
    else { record(v, ['key', 'kind', 'agentId', 'resourceId', 'expectedRevision']); if (a.kind === 'calendly.connection.disconnect') { if (a.agentId !== null) invalid() } else { if (a.kind !== 'calendly.action.update') invalid(); calendlyId(a.agentId) } calendlyId(a.resourceId); integer(a.expectedRevision) }
    calendlyId(a.key); return true
  } catch { return false }
}
export function parseCalendlyConfigReceipt(v: unknown, attempt?: CalendlyConfigAttempt, tenantId?: string | null): CalendlyConfigReceipt {
  const r = record(v, ['key', 'kind', 'tenantId', 'resourceId', 'agentId', 'revision', 'status', 'automaticRetry', 'createdAt'])
  const kind = oneOf(r.kind, ['calendly.action.create', 'calendly.action.update', 'calendly.connection.disconnect'])
  if (r.status !== 'succeeded' || r.automaticRetry !== false || tenantId && r.tenantId !== tenantId || (kind === 'calendly.connection.disconnect') !== (r.agentId === null)) invalid()
  const result: CalendlyConfigReceipt = { key: calendlyId(r.key), kind, tenantId: text(r.tenantId, 200), resourceId: calendlyId(r.resourceId), agentId: nullableId(r.agentId), revision: integer(r.revision), status: 'succeeded', automaticRetry: false, createdAt: date(r.createdAt) }
  if (attempt && (!validCalendlyConfigAttempt(attempt) || attempt.key !== result.key || attempt.kind !== kind || attempt.agentId !== result.agentId || attempt.kind !== 'calendly.action.create' && (attempt.resourceId !== result.resourceId || result.revision !== attempt.expectedRevision + 1) || attempt.kind === 'calendly.action.create' && result.revision !== 1)) invalid()
  return result
}
export function parseCalendlyChoice(v: unknown, expected?: { conversationId: string; chatOperationKey: string }): CalendlyChoice {
  const r = record(v, ['provider', 'choiceId', 'conversationId', 'chatOperationKey', 'actionId', 'actionRevision', 'eventTypeId', 'title', 'timezone', 'durationMinutes', 'form', 'allowCreate', 'slots', 'complete', 'nextFrom', 'reservationsGuaranteed', 'notifications']), form = record(r.form, ['name', 'email', 'timezone']), name = record(form.name, ['required', 'maxLength']), email = record(form.email, ['required', 'maxLength']), zone = record(form.timezone, ['required'])
  if (r.provider !== 'calendly' || r.reservationsGuaranteed !== false || r.notifications !== 'provider_managed_unknown' || name.required !== true || name.maxLength !== 120 || email.required !== true || email.maxLength !== 254 || zone.required !== true || expected && (r.conversationId !== expected.conversationId || r.chatOperationKey !== expected.chatOperationKey)) invalid()
  const durationMinutes = integer(r.durationMinutes)
  const slots = unique(list(r.slots, item => { const s = record(item, ['startAt', 'endAt', 'quote', 'expiresAt']), startAt = date(s.startAt), endAt = date(s.endAt); if (Date.parse(endAt) - Date.parse(startAt) !== durationMinutes * 60000 || typeof s.quote !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s.quote)) invalid(); return { startAt, endAt, quote: s.quote, expiresAt: date(s.expiresAt) } }, 200), s => s.quote)
  return { provider: 'calendly', choiceId: calendlyId(r.choiceId), conversationId: calendlyId(r.conversationId), chatOperationKey: calendlyChatKey(r.chatOperationKey), actionId: calendlyId(r.actionId), actionRevision: integer(r.actionRevision), eventTypeId: calendlyId(r.eventTypeId), title: text(r.title, 160), timezone: calendlyTimezone(r.timezone), durationMinutes, form: { name: { required: true, maxLength: 120 }, email: { required: true, maxLength: 254 }, timezone: { required: true } }, allowCreate: bool(r.allowCreate), slots, complete: bool(r.complete), nextFrom: r.nextFrom === null ? null : date(r.nextFrom), reservationsGuaranteed: false, notifications: 'provider_managed_unknown' }
}
export function parseCalendlyChoices(v: unknown, expected?: { conversationId: string; chatOperationKey: string }): CalendlyChoice[] { return v === undefined ? [] : unique(list(v, x => parseCalendlyChoice(x, expected), 20), c => c.choiceId) }
export function validCalendlyAttempt(v: unknown): v is CalendlyAttempt { try { const r = record(v, ['key', 'conversationId', 'actionId', 'actionRevision', 'eventTypeId', 'chatOperationKey']); for (const k of ['key', 'conversationId', 'actionId', 'eventTypeId']) calendlyId(r[k]); integer(r.actionRevision); calendlyChatKey(r.chatOperationKey); return true } catch { return false } }
export function parseCalendlyReceipt(v: unknown, attempt?: CalendlyAttempt, tenantId?: string | null): CalendlyReceipt {
  const r = record(v, ['key', 'kind', 'tenantId', 'conversationId', 'actionId', 'actionRevision', 'eventTypeId', 'bookingRef', 'requestedTime', 'status', 'effect', 'needsReconciliation', 'automaticRetry', 'notifications', 'reasonCode', 'createdAt', 'updatedAt']), time = record(r.requestedTime, ['startAt', 'endAt', 'timezone'])
  const status = oneOf(r.status, ['pending', 'unknown', 'accepted', 'confirmed', 'conflict', 'not_sent', 'failed']), effects = { pending: 'unconfirmed', unknown: 'unconfirmed', accepted: 'http_accepted', confirmed: 'event_verified', conflict: 'event_verified', not_sent: 'not_sent', failed: 'provider_rejected' } as const
  if (r.kind !== 'calendly.invitee.create' || r.effect !== effects[status] || r.needsReconciliation !== ['pending', 'unknown', 'accepted', 'conflict'].includes(status) || r.automaticRetry !== false || r.notifications !== 'provider_managed_unknown' || tenantId && r.tenantId !== tenantId) invalid()
  const startAt = date(time.startAt), endAt = date(time.endAt); if (Date.parse(endAt) <= Date.parse(startAt)) invalid()
  const result: CalendlyReceipt = { key: calendlyId(r.key), kind: 'calendly.invitee.create', tenantId: text(r.tenantId, 200), conversationId: calendlyId(r.conversationId), actionId: calendlyId(r.actionId), actionRevision: integer(r.actionRevision), eventTypeId: calendlyId(r.eventTypeId), bookingRef: calendlyId(r.bookingRef), requestedTime: { startAt, endAt, timezone: calendlyTimezone(time.timezone) }, status, effect: effects[status], needsReconciliation: bool(r.needsReconciliation), automaticRetry: false, notifications: 'provider_managed_unknown', reasonCode: r.reasonCode === null ? null : oneOf(r.reasonCode, ['slot_unavailable', 'provider_rejected', 'provider_response_invalid', 'outcome_unknown', 'action_changed', 'verification_conflict']), createdAt: date(r.createdAt), updatedAt: date(r.updatedAt) }
  if (attempt && (!validCalendlyAttempt(attempt) || ['key', 'conversationId', 'actionId', 'actionRevision', 'eventTypeId'].some(k => result[k as keyof CalendlyReceipt] !== attempt[k as keyof CalendlyAttempt]))) invalid()
  return result
}
export function calendlyValues(v: CalendlyValues): CalendlyValues { const name = text(v.name.trim(), 120), email = text(v.email.trim(), 254), timezone = calendlyTimezone(v.timezone); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EngineError(400, 'invalid_input', 'Informe nome, e-mail válido e fuso horário.'); return { name, email, timezone } }
function oauth(v: unknown, key: string): CalendlyOAuth { const r = record(v, ['operationKey', 'status', 'authorizationUrl', 'expiresAt', 'connectionId']), status = oneOf(r.status, ['pending', 'connected', 'unknown', 'expired']); if (r.operationKey !== key || status !== 'pending' && r.authorizationUrl !== null || (status === 'connected') !== (r.connectionId !== null)) invalid(); return { operationKey: calendlyId(r.operationKey), status, authorizationUrl: r.authorizationUrl === null ? null : calendlyUrl(r.authorizationUrl, 'authorization'), expiresAt: date(r.expiresAt), connectionId: nullableId(r.connectionId) } }

export function validCalendlyCancellationAttempt(v: unknown): v is CalendlyCancellationAttempt {
  try {
    if (!v || typeof v !== 'object') return false
    const r = record(v, ['key', 'creationKey', 'bookingRef', ...(Object.hasOwn(v, 'previousNotSentKey') ? ['previousNotSentKey'] : [])])
    for (const k of ['key', 'creationKey', 'bookingRef']) calendlyId(r[k])
    if (Object.hasOwn(r, 'previousNotSentKey') && calendlyId(r.previousNotSentKey) === r.key) invalid()
    return true
  } catch { return false }
}
export function parseCalendlyCancellationReceipt(v: unknown, expected?: Pick<CalendlyCancellationAttempt, 'creationKey' | 'bookingRef'> & { key?: string }, tenantId?: string | null): CalendlyCancellationReceipt {
  const r = record(v, ['key', 'kind', 'tenantId', 'creationKey', 'bookingRef', 'status', 'effect', 'needsReconciliation', 'automaticRetry', 'notifications', 'reasonCode', 'attemptedAt', 'acceptedAt', 'verifiedAt', 'createdAt', 'updatedAt'])
  const status = oneOf(r.status, ['pending', 'unknown', 'accepted', 'confirmed', 'conflict', 'not_sent', 'failed']), effects = { pending: 'unconfirmed', unknown: 'unconfirmed', accepted: 'http_accepted', confirmed: 'cancellation_verified', conflict: 'verification_conflict', not_sent: 'not_sent', failed: 'provider_rejected' } as const
  if (r.kind !== 'calendly.event.cancel' || r.effect !== effects[status] || r.needsReconciliation !== ['pending', 'unknown', 'accepted', 'conflict'].includes(status) || r.automaticRetry !== false || r.notifications !== 'provider_managed_unknown' || tenantId && r.tenantId !== tenantId) invalid()
  const reasonCode = r.reasonCode === null ? null : oneOf(r.reasonCode, ['authority_changed', 'verification_unavailable', 'verification_conflict', 'already_canceled', 'provider_rejected', 'provider_response_invalid', 'outcome_unknown'])
  const result: CalendlyCancellationReceipt = { key: calendlyId(r.key), kind: 'calendly.event.cancel', tenantId: text(r.tenantId, 200), creationKey: calendlyId(r.creationKey), bookingRef: calendlyId(r.bookingRef), status, effect: effects[status], needsReconciliation: bool(r.needsReconciliation), automaticRetry: false, notifications: 'provider_managed_unknown', reasonCode, attemptedAt: r.attemptedAt === null ? null : date(r.attemptedAt), acceptedAt: r.acceptedAt === null ? null : date(r.acceptedAt), verifiedAt: r.verifiedAt === null ? null : date(r.verifiedAt), createdAt: date(r.createdAt), updatedAt: date(r.updatedAt) }
  if (expected && (result.creationKey !== calendlyId(expected.creationKey) || result.bookingRef !== calendlyId(expected.bookingRef) || expected.key !== undefined && result.key !== calendlyId(expected.key))) invalid()
  if (status === 'not_sent' && (result.attemptedAt !== null || result.acceptedAt !== null) || status === 'accepted' && (!result.attemptedAt || !result.acceptedAt) || reasonCode === 'already_canceled' && status !== 'confirmed') invalid()
  return result
}

export function createCalendlyService(context: EngineContext) {
  const base = '/calendly'
  async function request(path: string, options?: Parameters<EngineContext['request']>[1]): Promise<unknown> { context.assertCurrent(); const v: unknown = await context.request(base + path, options); context.assertCurrent(); return v }
  async function configResult(v: unknown, a: CalendlyConfigAttempt) { const r = record(v, ['operation', 'replayed']); bool(r.replayed); return parseCalendlyConfigReceipt(r.operation, a, context.tenantId) }
  return {
    async status() { const r = record(await request('/status'), ['provider', 'configured', 'callbackUrl', 'requestedScopes', 'schedulingRequiresPaidPlan', 'realAccountVerified']); if (r.provider !== 'calendly' || r.schedulingRequiresPaidPlan !== true || r.realAccountVerified !== false) invalid(); return { configured: bool(r.configured), callbackUrl: r.callbackUrl === null ? null : text(r.callbackUrl, 2048), requestedScopes: unique(list(r.requestedScopes, x => text(x, 100), 50), x => x) } },
    async connections() { const r = record(await request('/connections'), ['items']); return unique(list(r.items, parseCalendlyConnection), x => x.id) },
    async start(key: string) { calendlyId(key); const r = record(await request('/oauth/start', { method: 'POST', body: { expectedTenantId: context.tenantId, idempotencyKey: key } }), ['authorizationUrl', 'expiresAt', 'operationKey']); if (r.operationKey !== key) invalid(); return { operationKey: key, authorizationUrl: calendlyUrl(r.authorizationUrl, 'authorization'), expiresAt: date(r.expiresAt) } },
    async oauthOperation(key: string) { return oauth(await request('/oauth/operations/' + calendlyId(key)), key) },
    async eventTypes(connection: CalendlyConnection, cursor?: string) { const snapshot = parseCalendlyConnection(connection); if (cursor !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(cursor)) invalid(); const r = record(await request(`/connections/${snapshot.id}/event-types${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`), ['items', 'nextCursor']); if (r.nextCursor !== null && (typeof r.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(r.nextCursor))) invalid(); return { items: unique(list(r.items, parseCalendlyEventType), x => x.id), nextCursor: r.nextCursor as string | null } },
    async actions(agentId: string) { const r = record(await request(`/agents/${calendlyId(agentId)}/actions`), ['items']); return unique(list(r.items, x => parseCalendlyAction(x, agentId)), x => x.id) },
    async options(agentId: string) { const r = record(await request(`/agents/${calendlyId(agentId)}/actions/options`), ['connections', 'channels']); return { connections: unique(list(r.connections, parseCalendlyConnection), x => x.id), channels: unique(list(r.channels, v => { const c = record(v, ['id', 'name']); return { id: calendlyId(c.id), name: text(c.name, 160) } }), x => x.id) } },
    async configure(a: CalendlyConfigAttempt, policy?: CalendlyPolicy) {
      if (!validCalendlyConfigAttempt(a)) invalid(); const common = { expectedTenantId: context.tenantId, idempotencyKey: a.key }
      if (a.kind === 'calendly.connection.disconnect') return configResult(await request(`/connections/${a.resourceId}/disconnect`, { method: 'POST', body: { ...common, expectedRevision: a.expectedRevision, confirm: true } }), a)
      if (a.kind === 'calendly.action.create') return configResult(await request(`/agents/${a.agentId}/actions`, { method: 'POST', body: { ...common, connectionId: a.connectionId, eventTypeId: a.eventTypeId, audience: a.audience, channelId: a.channelId } }), a)
      if (!policy) invalid(); const p = { enabled: bool(policy.enabled), allowCreate: bool(policy.allowCreate), expiresInDays: integer(policy.expiresInDays, 1, 30), maxBookingsPerDay: integer(policy.maxBookingsPerDay, 1, 100) }
      return configResult(await request(`/agents/${a.agentId}/actions/${a.resourceId}`, { method: 'PUT', body: { ...common, expectedRevision: a.expectedRevision, ...p } }), a)
    },
    async configurationOperation(a: CalendlyConfigAttempt) { if (!validCalendlyConfigAttempt(a)) invalid(); return parseCalendlyConfigReceipt(await request('/configuration-operations/' + a.key), a, context.tenantId) },
    async slots(choice: CalendlyChoice, from: string, to: string) { const c = parseCalendlyChoice(choice); date(from); date(to); if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 7 * 86400000) throw new EngineError(400, 'invalid_input', 'Escolha um intervalo futuro de até sete dias.'); const result = parseCalendlyChoice(await request(`/conversations/${c.conversationId}/slots`, { method: 'POST', body: { expectedTenantId: context.tenantId, actionId: c.actionId, expectedRevision: c.actionRevision, from, to } }), c); if (result.actionId !== c.actionId || result.actionRevision !== c.actionRevision || result.eventTypeId !== c.eventTypeId) invalid(); return result },
    async create(a: CalendlyAttempt, choice: CalendlyChoice, quote: string, values: CalendlyValues) { if (!validCalendlyAttempt(a)) invalid(); const c = parseCalendlyChoice(choice), slot = c.slots.find(s => s.quote === quote); if (!slot || !c.allowCreate || Date.parse(slot.expiresAt) <= Date.now() || ['conversationId', 'actionId', 'actionRevision', 'eventTypeId', 'chatOperationKey'].some(k => c[k as keyof CalendlyChoice] !== a[k as keyof CalendlyAttempt])) invalid(); const r = record(await request(`/conversations/${a.conversationId}/bookings`, { method: 'POST', body: { expectedTenantId: context.tenantId, idempotencyKey: a.key, actionId: a.actionId, expectedRevision: a.actionRevision, choiceId: c.choiceId, quote, values: calendlyValues(values), confirm: true, acknowledgeNotifications: true }, timeoutMs: 30000 }), ['operation', 'replayed']); bool(r.replayed); return parseCalendlyReceipt(r.operation, a, context.tenantId) },
    async operation(a: CalendlyAttempt) { if (!validCalendlyAttempt(a)) invalid(); return parseCalendlyReceipt(await request('/operations/' + a.key), a, context.tenantId) },
    async verify(a: CalendlyAttempt) { if (!validCalendlyAttempt(a)) invalid(); return parseCalendlyReceipt(await request('/operations/' + a.key + '/verify', { method: 'POST', body: { expectedTenantId: context.tenantId }, timeoutMs: 30000 }), a, context.tenantId) },
    async chatOperations(key: string) { const r = record(await request('/chat-operations/' + encodeURIComponent(calendlyChatKey(key))), ['calendlyChoices', 'calendlyOperations']); const choices = parseCalendlyChoices(r.calendlyChoices); if (choices.some(c => c.chatOperationKey !== key)) invalid(); return { calendlyChoices: choices, calendlyOperations: unique(list(r.calendlyOperations, x => parseCalendlyReceipt(x, undefined, context.tenantId), 100), x => x.key) } },
    async cancellations(creationKey: string, bookingRef: string) {
      const expected = { creationKey: calendlyId(creationKey), bookingRef: calendlyId(bookingRef) }
      const r = record(await request(`/operations/${expected.creationKey}/cancellations`), ['items'])
      return unique(list(r.items, item => parseCalendlyCancellationReceipt(item, expected, context.tenantId)), item => item.key)
    },
    async cancel(attempt: CalendlyCancellationAttempt) {
      if (!validCalendlyCancellationAttempt(attempt)) invalid()
      const a = structuredClone(attempt)
      const r = record(await request(`/operations/${a.creationKey}/cancellations`, { method: 'POST', body: { expectedTenantId: context.tenantId, idempotencyKey: a.key, bookingRef: a.bookingRef, confirm: true, acknowledgeNotifications: true, ...(a.previousNotSentKey ? { previousNotSentKey: a.previousNotSentKey } : {}) }, timeoutMs: 30000 }), ['operation', 'replayed'])
      bool(r.replayed); return parseCalendlyCancellationReceipt(r.operation, a, context.tenantId)
    },
    async cancellation(attempt: CalendlyCancellationAttempt) {
      if (!validCalendlyCancellationAttempt(attempt)) invalid()
      const a = structuredClone(attempt)
      return parseCalendlyCancellationReceipt(await request('/cancellation-operations/' + a.key), a, context.tenantId)
    },
    async verifyCancellation(attempt: CalendlyCancellationAttempt) {
      if (!validCalendlyCancellationAttempt(attempt)) invalid()
      const a = structuredClone(attempt)
      return parseCalendlyCancellationReceipt(await request(`/cancellation-operations/${a.key}/verify`, { method: 'POST', body: { expectedTenantId: context.tenantId }, timeoutMs: 30000 }), a, context.tenantId)
    },
    async management(a: CalendlyAttempt, receipt: CalendlyReceipt) { parseCalendlyReceipt(receipt, a, context.tenantId); const r = record(await request(`/operations/${a.key}/management-links`), ['bookingRef', 'cancelUrl', 'rescheduleUrl']); if (r.bookingRef !== receipt.bookingRef) invalid(); return { bookingRef: receipt.bookingRef, cancelUrl: r.cancelUrl === null ? null : calendlyUrl(r.cancelUrl, 'cancel'), rescheduleUrl: r.rescheduleUrl === null ? null : calendlyUrl(r.rescheduleUrl, 'reschedule') } },
  }
}
