import { EngineError } from './http'
import type { EngineContext } from './session'

export const airtableRoles = ['owner', 'admin', 'editor', 'builder', 'member', 'viewer'] as const
export type AirtableConfiguration = { name: string; baseId: string; tableId: string; fieldIds: string[]; token?: string; allowedRoles: string[]; agentIds: string[]; allowCreate: boolean; enabled: boolean }
export type AirtableBinding = Omit<AirtableConfiguration, 'token'> & { id: string; revision: number; status: 'disabled' | 'read_verified' | 'configured_unverified'; lastReadAt: string | null; createdAt: string; updatedAt: string; implementation: 'native_partial' }
export type AirtableField = { id: string; name: string; type: string; options?: { choices?: Array<{ id: string; name: string }> } }
export type AirtableQuery = { size: number; cursor?: string; filters: Array<{ fieldId: string; operator: 'equal' | 'not_equal' | 'contains' | 'greater' | 'less'; value: string | number | boolean }>; sort: Array<{ fieldId: string; direction: 'asc' | 'desc' }> }
export type AirtableRows = { items: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }>; nextCursor: string | null }
export type AirtableAttempt = { key: string; kind: 'binding.create' } | { key: string; kind: 'binding.update' | 'record.create'; bindingId: string; expectedRevision: number }
export type AirtableOperation = { key: string; kind: AirtableAttempt['kind']; status: 'succeeded' | 'pending' | 'created' | 'rejected' | 'not_sent' | 'uncertain'; bindingId: string; revision: number; nativeOperationId: string | null; recordId: string | null; errorCode: string | null; requiresReconciliation: boolean; automaticRetry: false; createdAt: string; updatedAt: string }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length >= min && v.length <= max
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const remote = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}[A-Za-z0-9]{14}$`).test(v)
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
function invalid(message = 'Os dados recebidos do Airtable são incompatíveis.'): never { throw new EngineError(0, 'invalid_airtable_data', message) }
const unique = (values: string[]) => [...new Set(values)].sort()
export function airtableConfiguration(raw: unknown): AirtableConfiguration {
  if (!object(raw) || !text(raw.name, 1, 120) || !raw.name.trim() || !remote(raw.baseId, 'app') || !remote(raw.tableId, 'tbl') || !Array.isArray(raw.fieldIds) || !raw.fieldIds.length || raw.fieldIds.length > 100 || raw.fieldIds.some(v => !remote(v, 'fld')) || !Array.isArray(raw.allowedRoles) || !raw.allowedRoles.length || raw.allowedRoles.length > 6 || raw.allowedRoles.some(v => !airtableRoles.includes(v)) || !Array.isArray(raw.agentIds) || raw.agentIds.length > 50 || raw.agentIds.some(v => !uuid(v)) || typeof raw.allowCreate !== 'boolean' || typeof raw.enabled !== 'boolean') invalid('Confira nome, IDs, campos, papéis e assistentes da configuração.')
  if (raw.token !== undefined && (!text(raw.token, 8, 2000) || !/^[A-Za-z0-9._~-]+$/.test(raw.token))) invalid('O formato do PAT não é aceito pelo conector.')
  return { name: raw.name.trim(), baseId: raw.baseId, tableId: raw.tableId, fieldIds: unique(raw.fieldIds), allowedRoles: unique(raw.allowedRoles), agentIds: unique(raw.agentIds), allowCreate: raw.allowCreate, enabled: raw.enabled, ...(raw.token === undefined ? {} : { token: raw.token }) }
}
export function bindingConfiguration(b: AirtableBinding): AirtableConfiguration { return airtableConfiguration({ ...b, token: undefined }) }
export function parseAirtableBinding(raw: unknown, id?: string): AirtableBinding {
  if (!object(raw) || !uuid(raw.id) || id && raw.id !== id || !positive(raw.revision) || raw.implementation !== 'native_partial' || !['disabled', 'read_verified', 'configured_unverified'].includes(raw.status) || raw.lastReadAt !== null && !date(raw.lastReadAt) || !date(raw.createdAt) || !date(raw.updatedAt)) invalid()
  const config = airtableConfiguration({ ...raw, token: undefined })
  if (config.enabled === (raw.status === 'disabled') || raw.status === 'read_verified' && raw.lastReadAt === null) invalid()
  return { ...config, id: raw.id, revision: raw.revision, status: raw.status, lastReadAt: raw.lastReadAt, createdAt: raw.createdAt, updatedAt: raw.updatedAt, implementation: 'native_partial' }
}
export function validAirtableAttempt(raw: unknown): raw is AirtableAttempt {
  return object(raw) && text(raw.key, 8, 128) && /^[A-Za-z0-9_-]+$/.test(raw.key) && (raw.kind === 'binding.create' || ['binding.update', 'record.create'].includes(raw.kind) && uuid(raw.bindingId) && positive(raw.expectedRevision))
}
export function airtableAttempt(kind: AirtableAttempt['kind'], binding?: AirtableBinding, key: string = crypto.randomUUID()): AirtableAttempt {
  const attempt = kind === 'binding.create' ? { kind, key } : { kind, key, bindingId: binding?.id, expectedRevision: binding?.revision }
  if (!validAirtableAttempt(attempt)) invalid('A referência da operação é inválida.')
  return Object.freeze(attempt)
}
export function parseAirtableOperation(raw: unknown, attempt: AirtableAttempt): AirtableOperation {
  if (!object(raw) || raw.key !== attempt.key || raw.kind !== attempt.kind || !uuid(raw.bindingId) || !positive(raw.revision) || raw.automaticRetry !== false || !date(raw.createdAt) || !date(raw.updatedAt) || raw.errorCode !== null && !/^[A-Za-z0-9_:-]{1,100}$/.test(raw.errorCode) || raw.nativeOperationId !== null && !uuid(raw.nativeOperationId)) invalid()
  if (attempt.kind !== 'binding.create' && (raw.bindingId !== attempt.bindingId || raw.revision !== attempt.expectedRevision + (attempt.kind === 'binding.update' ? 1 : 0)) || attempt.kind === 'binding.create' && raw.revision !== 1) invalid()
  if (attempt.kind === 'record.create') {
    if (!['pending', 'created', 'rejected', 'not_sent', 'uncertain'].includes(raw.status) || (raw.status === 'created' ? !remote(raw.recordId, 'rec') || raw.nativeOperationId === null : raw.recordId !== null)) invalid()
  } else if (raw.status !== 'succeeded' || raw.nativeOperationId !== null || raw.recordId !== null) invalid()
  if (raw.requiresReconciliation !== ['pending', 'uncertain'].includes(raw.status)) invalid()
  return { key: raw.key, kind: raw.kind, status: raw.status, bindingId: raw.bindingId, revision: raw.revision, nativeOperationId: raw.nativeOperationId, recordId: raw.recordId, errorCode: raw.errorCode, requiresReconciliation: raw.requiresReconciliation, automaticRetry: false, createdAt: raw.createdAt, updatedAt: raw.updatedAt }
}
export function parseAirtableFields(raw: unknown, binding: AirtableBinding): AirtableField[] {
  if (!object(raw) || raw.source !== 'airtable' || raw.dataSource !== 'untrusted_external_content' || !Array.isArray(raw.items) || raw.items.length > 100) invalid()
  const result: AirtableField[] = raw.items.map((f: unknown) => {
    if (!object(f) || !remote(f.id, 'fld') || !binding.fieldIds.includes(f.id) || !text(f.name, 0, 1000) || !text(f.type, 0, 100)) invalid()
    let options: AirtableField['options']
    if (f.options !== undefined) {
      if (!object(f.options) || f.options.choices !== undefined && (!Array.isArray(f.options.choices) || f.options.choices.length > 1000 || f.options.choices.some((c: unknown) => !object(c) || !text(c.id, 0, 1000) || !text(c.name, 0, 1000)))) invalid()
      options = f.options.choices ? { choices: f.options.choices.map((c: any) => ({ id: c.id, name: c.name })) } : {}
    }
    return { id: f.id, name: f.name, type: f.type, ...(options ? { options } : {}) }
  })
  if (new Set(result.map(f => f.id)).size !== result.length || binding.fieldIds.some(id => !result.some(f => f.id === id))) invalid()
  return result
}
export const writableAirtableTypes = ['singleLineText', 'multilineText', 'richText', 'phoneNumber', 'url', 'email', 'number', 'currency', 'percent', 'checkbox', 'date', 'dateTime', 'singleSelect', 'multipleSelects'] as const
export function airtableValues(raw: unknown, fields: AirtableField[]): Record<string, unknown> {
  if (!object(raw) || !Object.keys(raw).length || Object.keys(raw).length > 100 || new TextEncoder().encode(JSON.stringify(raw)).length > 30000) invalid('Selecione de 1 a 100 campos e respeite o limite de tamanho.')
  for (const [id, v] of Object.entries(raw)) {
    const f = fields.find(item => item.id === id); if (!f || !writableAirtableTypes.includes(f.type as any)) invalid('Campo sem autorização de escrita ou tipo não suportado.')
    let ok = false
    if (['singleLineText', 'multilineText', 'richText', 'phoneNumber', 'url'].includes(f.type)) ok = v === null || text(v, 0, 10000)
    if (f.type === 'email') ok = v === null || v === '' || text(v, 1, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
    if (['number', 'currency', 'percent'].includes(f.type)) ok = v === null || typeof v === 'number' && Number.isFinite(v)
    if (f.type === 'checkbox') ok = typeof v === 'boolean'
    if (f.type === 'date') ok = v === null || typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
    if (f.type === 'dateTime') ok = v === null || typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
    if (f.type === 'singleSelect') ok = v === null || typeof v === 'string' && !!f.options?.choices?.some(c => c.name === v)
    if (f.type === 'multipleSelects') ok = Array.isArray(v) && v.length <= 100 && v.every(value => typeof value === 'string' && f.options?.choices?.some(c => c.name === value))
    if (!ok) invalid(`Valor incompatível no campo ${f.name}.`)
  }
  return structuredClone(raw)
}
export function airtableQuery(raw: AirtableQuery, binding: AirtableBinding): AirtableQuery {
  if (!Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size > 100 || raw.cursor !== undefined && !text(raw.cursor, 1, 10000) || !Array.isArray(raw.filters) || raw.filters.length > 10 || !Array.isArray(raw.sort) || raw.sort.length > 5) invalid('Consulta inválida.')
  if (raw.filters.some(f => !binding.fieldIds.includes(f.fieldId) || !['equal', 'not_equal', 'contains', 'greater', 'less'].includes(f.operator) || !(text(f.value, 0, 1000) || typeof f.value === 'boolean' || typeof f.value === 'number' && Number.isFinite(f.value))) || raw.sort.some(s => !binding.fieldIds.includes(s.fieldId) || !['asc', 'desc'].includes(s.direction))) invalid('Filtros ou ordenação fora do escopo autorizado.')
  return { size: raw.size, ...(raw.cursor ? { cursor: raw.cursor } : {}), filters: raw.filters.map(f => ({ fieldId: f.fieldId, operator: f.operator, value: f.value })), sort: raw.sort.map(s => ({ fieldId: s.fieldId, direction: s.direction })) }
}
export function createAirtableService(context: EngineContext) {
  const prefix = '/integrations/airtable'
  async function get(id: string, signal?: AbortSignal) { if (!uuid(id)) invalid(); const result = parseAirtableBinding(await context.request(`${prefix}/tables/${id}`, { signal }), id); context.assertCurrent(); return result }
  async function unchanged(binding: AirtableBinding, signal?: AbortSignal) { const current = await get(binding.id, signal); if (current.revision !== binding.revision) throw new EngineError(409, 'airtable_configuration_changed', 'A configuração mudou. Os dados desta consulta foram descartados; revise o vínculo explicitamente.') }
  return {
    get,
    async list(signal?: AbortSignal) { const raw = await context.request<any>(`${prefix}/tables`, { signal }); context.assertCurrent(); if (!object(raw) || !Array.isArray(raw.items)) invalid(); const items: AirtableBinding[] = raw.items.map((item: unknown) => parseAirtableBinding(item)); if (new Set(items.map(b => b.id)).size !== items.length) invalid(); return items },
    async fields(binding: AirtableBinding, signal?: AbortSignal) { const raw = await context.request(`${prefix}/tables/${binding.id}/fields`, { signal }); await unchanged(binding, signal); return parseAirtableFields(raw, binding) },
    async query(binding: AirtableBinding, input: AirtableQuery, signal?: AbortSignal): Promise<AirtableRows> {
      const q = airtableQuery(input, binding), raw = await context.request<any>(`${prefix}/tables/${binding.id}/query`, { method: 'POST', body: q, signal }); await unchanged(binding, signal)
      if (!object(raw) || raw.source !== 'airtable' || raw.dataSource !== 'untrusted_external_content' || raw.emptyFieldsOmittedByProvider !== true || !Array.isArray(raw.items) || raw.items.length > q.size || raw.nextCursor !== null && !text(raw.nextCursor, 1, 10000)) invalid()
      const items = raw.items.map((r: unknown) => { if (!object(r) || !remote(r.id, 'rec') || !date(r.createdTime) || !object(r.fields) || Object.keys(r.fields).some(id => !binding.fieldIds.includes(id))) invalid(); return { id: r.id, createdTime: r.createdTime, fields: structuredClone(r.fields) } })
      return { items, nextCursor: raw.nextCursor }
    },
    async configure(attempt: AirtableAttempt, input: AirtableConfiguration) {
      if (!validAirtableAttempt(attempt) || attempt.kind === 'record.create') invalid()
      const configuration = airtableConfiguration(input); if (attempt.kind === 'binding.create' && !configuration.token) invalid('Informe o PAT para cadastrar o vínculo.')
      const raw = await context.request<any>(`${prefix}/tables${attempt.kind === 'binding.update' ? `/${attempt.bindingId}` : ''}`, { method: attempt.kind === 'binding.create' ? 'POST' : 'PUT', idempotencyKey: attempt.key, body: { expectedTenantId: context.tenantId, ...(attempt.kind === 'binding.update' ? { expectedRevision: attempt.expectedRevision } : {}), configuration } }); context.assertCurrent()
      if (!object(raw) || typeof raw.replayed !== 'boolean') invalid(); return parseAirtableOperation(raw.operation, attempt)
    },
    async create(attempt: AirtableAttempt, values: Record<string, unknown>, fields: AirtableField[]) {
      if (!validAirtableAttempt(attempt) || attempt.kind !== 'record.create') invalid()
      const raw = await context.request<any>(`${prefix}/tables/${attempt.bindingId}/records`, { method: 'POST', idempotencyKey: attempt.key, body: { expectedTenantId: context.tenantId, expectedRevision: attempt.expectedRevision, values: airtableValues(values, fields) } }); context.assertCurrent()
      if (!object(raw) || typeof raw.replayed !== 'boolean') invalid(); return parseAirtableOperation(raw.operation, attempt)
    },
    async operation(attempt: AirtableAttempt) { if (!validAirtableAttempt(attempt)) invalid(); const raw = await context.request(`${prefix}/operations/${attempt.key}`); context.assertCurrent(); return parseAirtableOperation(raw, attempt) },
  }
}
