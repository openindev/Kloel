import { parseHttpAvailability, parseHttpMetadata, type HttpAvailability, type HttpMetadata } from './before-http'
import { EngineError } from './http'
import type { EngineContext } from './session'

export type BeforeScalar = string | number | boolean
export type BeforeVariable = { name: string; type: 'text' | 'number' | 'boolean'; defaultValue: BeforeScalar }
export type BeforeCondition = { field: string; operator: 'is_set' | 'is_empty' | 'equals' | 'contains' | 'starts_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'time_between'; value?: BeforeScalar | { start: string; end: string; overnight: boolean } }
export type BeforeConfiguration = { enabled: boolean; timezone: string; variables: BeforeVariable[]; defaultGreeting: string; greetingRules: { conditions: BeforeCondition[]; greeting: string }[]; testContext: Record<string, BeforeScalar> }
export type BeforeConfig = { agentId: string; revision: number; configuration: BeforeConfiguration }
export type BeforeAvailability = { agentId: string; enabled: boolean; revision: number; httpSource?: HttpAvailability; supportedSurfaces: Array<'private' | 'webchat' | 'voice_private' | 'voice_incoming'> }
export type BeforeFacts = { startedAt?: string; direction?: 'incoming' | 'outgoing' | 'unknown'; phone?: string }
export type BeforeConfigAttempt = { key: string; agentId: string; expectedRevision: number }
export type BeforeOpeningAttempt = { key: string; agentId: string; expectedConfigRevision: number; expectedHttpRevision?: number; mode: 'live' | 'test' }
export type BeforeConfigOperation = { key: string; kind: 'before_context.configure'; tenantId: string; agentId: string; expectedRevision: number; revision: number; status: 'succeeded'; automaticRetry: false; createdAt: string }
export type BeforeOpening = { key: string; openingId: string; tenantId: string; agentId: string; conversationId: string; configRevision: number; mode: 'live' | 'test'; surface: 'private'; status: 'ready' | 'pending' | 'blocked' | 'unknown'; source: 'defaults' | 'test' | 'external'; reasonCode: HttpMetadata['reasonCode']; httpSource?: HttpMetadata; startedAt: string; resolvedAt: string | null; automaticRetry: false }
export type BeforeHistory = { openingId: string; conversationId: string; items: { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }[]; cursor: string | null; hasMore: boolean }
export type BeforePreview = { mode: 'test'; ruleIndex: number | null; greeting: string; values: Record<string, BeforeScalar>; provenance: { name: string; source: 'default' | 'test'; reason: 'default_value' | 'test_value' }[]; facts: { agentName: string; companyName: string; surface: 'private'; direction: 'incoming' | 'outgoing' | 'unknown'; phone: string | null; localTime: string; weekday: number; startedAt: string }; externalSources: false }
export const beforeId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, any>, keys: string[], optional: string[] = []) => Object.keys(v).every(k => keys.includes(k) || optional.includes(k)) && keys.every(k => Object.hasOwn(v, k))
const revision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER
const text = (v: unknown, max = 1000): v is string => typeof v === 'string' && v.length <= max
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
const scalar = (v: unknown): v is BeforeScalar => text(v) || typeof v === 'number' && Number.isFinite(v) || typeof v === 'boolean'
const typeOf = (v: BeforeScalar) => typeof v === 'string' ? 'text' : typeof v
const name = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(v) && !['constructor', 'prototype', '__proto__'].includes(v)
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
const time = (v: unknown): v is string => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)
export const beforeSystemFields = { agentName: 'text', companyName: 'text', surface: 'text', direction: 'text', phone: 'text', localTime: 'time', weekday: 'number', startedAt: 'text' } as const
function invalid(message = 'Confira os campos e tipos do contexto inicial.'): never { throw new EngineError(0, 'invalid_before_context', message) }
function safeKeys(v: unknown) { if (v && typeof v === 'object') for (const [k, value] of Object.entries(v)) { if (['constructor', 'prototype', '__proto__'].includes(k)) invalid(); safeKeys(value) } }
export const defaultBeforeConfiguration = (): BeforeConfiguration => ({ enabled: false, timezone: 'America/Sao_Paulo', variables: [], defaultGreeting: '', greetingRules: [], testContext: {} })
export function parseBeforeConfiguration(raw: unknown): BeforeConfiguration {
  safeKeys(raw)
  if (!object(raw) || !exact(raw, ['enabled', 'timezone', 'variables', 'defaultGreeting', 'greetingRules', 'testContext']) || typeof raw.enabled !== 'boolean' || !text(raw.timezone, 100) || !raw.timezone || !text(raw.defaultGreeting) || !Array.isArray(raw.variables) || raw.variables.length > 50 || !Array.isArray(raw.greetingRules) || raw.greetingRules.length > 32 || !object(raw.testContext) || bytes(raw) > 32768) invalid()
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: raw.timezone }) } catch { invalid('Informe um fuso horário IANA válido.') }
  const fields = new Map<string, string>(Object.entries(beforeSystemFields).map(([k, type]) => [`system.${k}`, type]))
  for (const v of raw.variables) { if (!object(v) || !exact(v, ['name', 'type', 'defaultValue']) || !name(v.name) || fields.has(`vars.${v.name}`) || !scalar(v.defaultValue) || typeOf(v.defaultValue) !== v.type) invalid(); fields.set(`vars.${v.name}`, v.type) }
  for (const [k, value] of Object.entries(raw.testContext)) if (!name(k) || !scalar(value) || fields.get(`vars.${k}`) !== typeOf(value)) invalid('Os exemplos devem usar variáveis declaradas e seus tipos exatos.')
  for (const rule of raw.greetingRules) {
    if (!object(rule) || !exact(rule, ['conditions', 'greeting']) || !text(rule.greeting) || !Array.isArray(rule.conditions) || !rule.conditions.length || rule.conditions.length > 8) invalid()
    for (const c of rule.conditions) {
      if (!object(c) || !exact(c, ['field', 'operator'], ['value']) || !text(c.field, 80) || c.field === 'system.startedAt') invalid()
      const type = fields.get(c.field); if (!type) invalid('Uma condição referencia uma variável inexistente.')
      if (['is_set', 'is_empty'].includes(c.operator)) { if (type !== 'text' || Object.hasOwn(c, 'value')) invalid(); continue }
      if (type === 'time') { const v = c.value; if (c.operator !== 'time_between' || !object(v) || !exact(v, ['start', 'end', 'overnight']) || !time(v.start) || !time(v.end) || v.start === v.end || v.overnight !== (v.start > v.end)) invalid('Confira o intervalo e a indicação de travessia da meia-noite.') }
      else if (!scalar(c.value) || typeOf(c.value) !== type || !(type === 'text' ? ['equals', 'contains', 'starts_with'] : type === 'number' ? ['equals', 'gt', 'gte', 'lt', 'lte'] : ['equals']).includes(c.operator) || c.field === 'system.weekday' && (typeof c.value !== 'number' || !Number.isInteger(c.value) || c.value < 0 || c.value > 6)) invalid()
    }
  }
  for (const greeting of [raw.defaultGreeting, ...raw.greetingRules.map((r: any) => r.greeting)]) { const rest = greeting.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g, (_: string, field: string) => { if (!fields.has(field)) invalid('Uma saudação referencia uma variável inexistente.'); return '' }); if (rest.includes('{{') || rest.includes('}}')) invalid('Confira os marcadores {{vars.nome}} da saudação.') }
  return structuredClone(raw) as BeforeConfiguration
}
export function parseBeforeFacts(raw: unknown): BeforeFacts {
  if (!object(raw) || !exact(raw, [], ['startedAt', 'direction', 'phone']) || raw.startedAt !== undefined && !date(raw.startedAt) || raw.direction !== undefined && !['incoming', 'outgoing', 'unknown'].includes(raw.direction) || raw.phone !== undefined && !(typeof raw.phone === 'string' && /^\+[1-9]\d{7,14}$/.test(raw.phone))) invalid('Confira os fatos sintéticos: data ISO, direção e telefone E.164.')
  return structuredClone(raw)
}
export function validBeforeConfigAttempt(v: unknown): v is BeforeConfigAttempt { return object(v) && exact(v, ['key', 'agentId', 'expectedRevision']) && beforeId(v.key) && beforeId(v.agentId) && revision(v.expectedRevision) && v.expectedRevision < Number.MAX_SAFE_INTEGER }
export function validBeforeOpeningAttempt(v: unknown): v is BeforeOpeningAttempt { return object(v) && exact(v, ['key', 'agentId', 'expectedConfigRevision', 'mode'], ['expectedHttpRevision']) && beforeId(v.key) && beforeId(v.agentId) && revision(v.expectedConfigRevision) && (v.expectedHttpRevision === undefined || revision(v.expectedHttpRevision) && v.expectedHttpRevision > 0) && ['live', 'test'].includes(v.mode) }
export function parseBeforeConfigOperation(raw: unknown, a: BeforeConfigAttempt, tenantId: string): BeforeConfigOperation {
  if (!validBeforeConfigAttempt(a) || !object(raw) || !exact(raw, ['key', 'kind', 'tenantId', 'agentId', 'expectedRevision', 'revision', 'status', 'automaticRetry', 'createdAt']) || raw.key !== a.key || raw.agentId !== a.agentId || raw.tenantId !== tenantId || raw.expectedRevision !== a.expectedRevision || !revision(raw.revision) || raw.revision !== a.expectedRevision + 1 || raw.kind !== 'before_context.configure' || raw.status !== 'succeeded' || raw.automaticRetry !== false || !date(raw.createdAt)) invalid('Recibo de configuração incompatível; preserve a referência.')
  return structuredClone(raw) as BeforeConfigOperation
}
export function parseBeforeOpening(raw: unknown, a: BeforeOpeningAttempt, tenantId: string): BeforeOpening {
  if (!validBeforeOpeningAttempt(a) || !object(raw) || !exact(raw, ['key', 'openingId', 'tenantId', 'agentId', 'conversationId', 'configRevision', 'mode', 'surface', 'status', 'source', 'reasonCode', 'startedAt', 'resolvedAt', 'automaticRetry'], ['httpSource']) || raw.key !== a.key || raw.agentId !== a.agentId || raw.tenantId !== tenantId || raw.configRevision !== a.expectedConfigRevision || raw.mode !== a.mode || !beforeId(raw.openingId) || !beforeId(raw.conversationId) || raw.surface !== 'private' || raw.automaticRetry !== false || !date(raw.startedAt) || raw.resolvedAt !== null && (!date(raw.resolvedAt) || Date.parse(raw.resolvedAt) < Date.parse(raw.startedAt))) invalid('Recibo de abertura incompatível; preserve a referência.')
  if (a.expectedHttpRevision === undefined) { if (raw.httpSource !== undefined || raw.status !== 'ready' || raw.reasonCode !== null || raw.resolvedAt === null || raw.source !== (a.mode === 'test' ? 'test' : 'defaults')) invalid() }
  else {
    const h = parseHttpMetadata(raw.httpSource, a.expectedHttpRevision)
    if (!['ready','pending','blocked','unknown'].includes(raw.status) || raw.source !== (a.mode === 'test' ? 'test' : h.resolution === 'external' ? 'external' : 'defaults') || raw.reasonCode !== h.reasonCode || raw.status === 'ready' && (!['external','defaults'].includes(h.resolution) || raw.resolvedAt === null) || raw.status !== 'ready' && raw.status !== h.resolution || a.mode === 'test' && raw.status === 'ready' && (h.reasonCode !== 'test_no_io' || h.resolution !== 'defaults')) invalid()
  }
  return structuredClone(raw) as BeforeOpening
}
export function beforeOpeningAvailable(a: BeforeAvailability, op: BeforeOpening): boolean {
  return a.enabled && a.revision === op.configRevision && op.status === 'ready' && (op.httpSource ? a.httpSource?.state === 'enabled' && a.httpSource.revision === op.httpSource.sourceRevision : a.httpSource === undefined)
}
export function parseBeforeHistory(raw: unknown, opening: BeforeOpening): BeforeHistory {
  if (!object(raw) || !exact(raw, ['openingId', 'conversationId', 'items', 'cursor', 'hasMore']) || raw.openingId !== opening.openingId || raw.conversationId !== opening.conversationId || !Array.isArray(raw.items) || raw.items.length > 80 || typeof raw.hasMore !== 'boolean' || raw.cursor !== null && !beforeId(raw.cursor) || raw.items.length > 0 && raw.cursor !== raw.items.at(-1)?.id || raw.hasMore && (!raw.items.length || !beforeId(raw.cursor))) invalid()
  const ids = new Set<string>(); for (const m of raw.items) { if (!object(m) || !exact(m, ['id', 'role', 'content', 'createdAt']) || !beforeId(m.id) || ids.has(m.id) || !['user', 'assistant'].includes(m.role) || !text(m.content, 100000) || !date(m.createdAt)) invalid(); ids.add(m.id) }
  return structuredClone(raw) as BeforeHistory
}
export function createBeforeContextService(context: EngineContext, agentId: string) {
  if (!beforeId(agentId)) invalid(); const base = `/agents/${agentId}/before-context`
  async function request(path: string, options?: Parameters<EngineContext['request']>[1]): Promise<any> { context.assertCurrent(); const value = await context.request(path, options); context.assertCurrent(); options?.signal?.throwIfAborted(); return value }
  const configAttempt = (a: BeforeConfigAttempt) => { if (!validBeforeConfigAttempt(a) || a.agentId !== agentId) invalid() }
  const openingAttempt = (a: BeforeOpeningAttempt) => { if (!validBeforeOpeningAttempt(a) || a.agentId !== agentId) invalid() }
  return {
    async read(signal?: AbortSignal): Promise<BeforeConfig> { const raw = await request(base, { signal }); if (!object(raw) || !exact(raw, ['agentId', 'revision', 'configuration']) || raw.agentId !== agentId || !revision(raw.revision)) invalid(); return { agentId, revision: raw.revision, configuration: parseBeforeConfiguration(raw.configuration) } },
    async availability(signal?: AbortSignal): Promise<BeforeAvailability> { const raw = await request(`${base}/availability`, { signal }); if (!object(raw) || !exact(raw, ['agentId', 'enabled', 'revision', 'supportedSurfaces'], ['httpSource']) || raw.agentId !== agentId || typeof raw.enabled !== 'boolean' || !revision(raw.revision) || !['["private","webchat"]','["private","webchat","voice_private","voice_incoming"]'].includes(JSON.stringify(raw.supportedSurfaces))) invalid(); if (raw.httpSource !== undefined) parseHttpAvailability(raw.httpSource); return structuredClone(raw) as BeforeAvailability },
    async configure(a: BeforeConfigAttempt, configuration: BeforeConfiguration) { configAttempt(a); const raw = await request(base, { method: 'PUT', body: { expectedTenantId: context.tenantId, expectedRevision: a.expectedRevision, idempotencyKey: a.key, configuration: parseBeforeConfiguration(configuration) } }); if (!object(raw) || !exact(raw, ['operation', 'replayed']) || typeof raw.replayed !== 'boolean') invalid(); return parseBeforeConfigOperation(raw.operation, a, context.tenantId) },
    async configOperation(a: BeforeConfigAttempt) { configAttempt(a); return parseBeforeConfigOperation(await request(`/before-context/config-operations/${a.key}`), a, context.tenantId) },
    async preview(configuration: BeforeConfiguration, testFacts: BeforeFacts = {}, signal?: AbortSignal): Promise<BeforePreview> { const c = parseBeforeConfiguration(configuration), raw = await request(`${base}/preview`, { method: 'POST', body: { configuration: c, testFacts: parseBeforeFacts(testFacts) }, signal }); safeKeys(raw); if (!object(raw) || !exact(raw, ['mode', 'ruleIndex', 'greeting', 'values', 'provenance', 'facts', 'externalSources']) || raw.mode !== 'test' || raw.externalSources !== false || raw.ruleIndex !== null && (!revision(raw.ruleIndex) || raw.ruleIndex >= c.greetingRules.length) || !text(raw.greeting) || !object(raw.values) || bytes(raw.values) > 16384 || Object.keys(raw.values).length !== c.variables.length || !c.variables.every(v => Object.hasOwn(raw.values, v.name) && scalar(raw.values[v.name]) && typeOf(raw.values[v.name]) === v.type) || !Array.isArray(raw.provenance) || raw.provenance.length !== c.variables.length) invalid(); const seen = new Set(); for (const p of raw.provenance) { if (!object(p) || !exact(p, ['name', 'source', 'reason']) || !c.variables.some(v => v.name === p.name) || seen.has(p.name) || !['default', 'test'].includes(p.source) || p.reason !== (p.source === 'test' ? 'test_value' : 'default_value')) invalid(); seen.add(p.name) } const f = raw.facts; if (!object(f) || !exact(f, ['agentName', 'companyName', 'surface', 'direction', 'phone', 'localTime', 'weekday', 'startedAt']) || !text(f.agentName, 1000) || !text(f.companyName, 1000) || f.surface !== 'private' || !['incoming', 'outgoing', 'unknown'].includes(f.direction) || f.phone !== null && !(typeof f.phone === 'string' && /^\+[1-9]\d{7,14}$/.test(f.phone)) || !time(f.localTime) || !Number.isInteger(f.weekday) || f.weekday < 0 || f.weekday > 6 || !date(f.startedAt)) invalid(); return structuredClone(raw) as BeforePreview },
    async open(a: BeforeOpeningAttempt, testFacts?: BeforeFacts) { openingAttempt(a); if (a.mode === 'live' && testFacts !== undefined) invalid(); const raw = await request('/ai/conversations/open', { method: 'POST', body: { expectedTenantId: context.tenantId, agentId, expectedConfigRevision: a.expectedConfigRevision, idempotencyKey: a.key, mode: a.mode, ...(a.expectedHttpRevision === undefined ? {} : { expectedHttpRevision: a.expectedHttpRevision }), ...(testFacts === undefined ? {} : { testFacts: parseBeforeFacts(testFacts) }) } }); if (!object(raw) || !exact(raw, ['operation', 'replayed']) || typeof raw.replayed !== 'boolean') invalid(); return parseBeforeOpening(raw.operation, a, context.tenantId) },
    async opening(a: BeforeOpeningAttempt) { openingAttempt(a); return parseBeforeOpening(await request(`/ai/conversation-openings/${a.key}`), a, context.tenantId) },
    async history(a: BeforeOpeningAttempt, o: BeforeOpening, after?: string, signal?: AbortSignal) { openingAttempt(a); parseBeforeOpening(o, a, context.tenantId); if (o.status !== 'ready') invalid(); if (after !== undefined && !beforeId(after)) invalid(); return parseBeforeHistory(await request(`/ai/conversation-openings/${a.key}/history${after ? `?after=${after}` : ''}`, { signal }), o) },
  }
}
