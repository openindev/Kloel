import { EngineError } from './http'
import type { EngineContext } from './session'

export const baserowRoles = ['owner', 'admin', 'editor', 'builder', 'member', 'viewer'] as const
export type BaserowConfiguration = { name: string; instanceUrl: string; tableId: number; token?: string; allowedRoles: string[]; agentIds: string[]; allowCreate: boolean; enabled: boolean }
export type BaserowBinding = Omit<BaserowConfiguration, 'token'> & { id: string; revision: number; status: 'disabled' | 'read_verified' | 'configured_unverified'; lastReadAt: string | null; nativeConnector: true; implementation: 'native_partial'; liveValidation: 'not_inferred'; createdAt: string; updatedAt: string }
export type BaserowField = { id: number; name: string; type: string; primary?: boolean; read_only?: boolean; number_decimal_places?: number; select_options?: Array<{ id: number; value: string }> }
export const baserowFilterOperators = ['equal', 'not_equal', 'contains', 'contains_not', 'higher_than', 'lower_than', 'boolean', 'empty', 'not_empty', 'single_select_equal'] as const
export type BaserowQuery = { page: number; size: number; search?: string; filters: Array<{ fieldId: number; operator: typeof baserowFilterOperators[number]; value: string | number | boolean }>; filterType: 'AND' | 'OR'; orderBy: Array<{ fieldId: number; descending: boolean }> }
export type BaserowRows = { items: Array<Record<string, unknown> & { id: number }>; count: number; page: number; size: number; nextPage: number | null }
export type BaserowAttempt = { key: string; kind: 'binding.create' } | { key: string; kind: 'binding.update' | 'row.create'; bindingId: string; expectedRevision: number } | { key: string; kind: 'binding.set_enabled'; bindingId: string; expectedRevision: number; enabled: boolean }
export type BaserowOperation = { key: string; kind: BaserowAttempt['kind']; status: 'succeeded' | 'pending' | 'created' | 'not_sent' | 'uncertain'; bindingId: string; revision: number; nativeOperationId: string | null; rowId: number | null; errorCode: string | null; requiresReconciliation: boolean; automaticRetry: false; createdAt: string; updatedAt: string }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length >= min && v.length <= max
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
const only = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k))
const unique = (values: string[]) => [...new Set(values)].sort()
function invalid(message = 'Os dados recebidos do Baserow são incompatíveis.'): never { throw new EngineError(0, 'invalid_baserow_data', message) }
function instanceOrigin(raw: unknown): string {
  if (!text(raw, 1, 2000) || raw !== raw.trim()) invalid('Informe somente a origem HTTPS da instância Baserow.')
  let url: URL; try { url = new URL(raw) } catch { return invalid('A origem da instância é inválida.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) invalid('Informe somente a origem HTTPS da instância Baserow.')
  return url.origin
}
const configKeys = ['name', 'instanceUrl', 'tableId', 'token', 'allowedRoles', 'agentIds', 'allowCreate', 'enabled'] as const
export function baserowConfiguration(raw: unknown): BaserowConfiguration {
  if (!object(raw) || !only(raw, configKeys) || !text(raw.name, 1, 120) || !raw.name.trim() || !positive(raw.tableId) || !Array.isArray(raw.allowedRoles) || !raw.allowedRoles.length || raw.allowedRoles.length > 6 || raw.allowedRoles.some(v => !baserowRoles.includes(v)) || !Array.isArray(raw.agentIds) || raw.agentIds.length > 50 || raw.agentIds.some(v => !uuid(v)) || typeof raw.allowCreate !== 'boolean' || typeof raw.enabled !== 'boolean') invalid('Confira nome, tabela, papéis e assistentes da configuração.')
  if (raw.token !== undefined && (!text(raw.token, 8, 2000) || !/^[A-Za-z0-9._~+\/-]+$/.test(raw.token))) invalid('O formato do token de banco de dados não é aceito pelo conector.')
  return { name: raw.name.trim(), instanceUrl: instanceOrigin(raw.instanceUrl), tableId: raw.tableId, allowedRoles: unique(raw.allowedRoles), agentIds: unique(raw.agentIds), allowCreate: raw.allowCreate, enabled: raw.enabled, ...(raw.token === undefined ? {} : { token: raw.token }) }
}
export function bindingConfiguration(b: BaserowBinding): BaserowConfiguration {
  return baserowConfiguration({ name: b.name, instanceUrl: b.instanceUrl, tableId: b.tableId, allowedRoles: b.allowedRoles, agentIds: b.agentIds, allowCreate: b.allowCreate, enabled: b.enabled })
}
export function parseBaserowBinding(raw: unknown, id?: string): BaserowBinding {
  if (!object(raw) || !only(raw, [...configKeys.filter(k => k !== 'token'), 'id', 'revision', 'status', 'lastReadAt', 'nativeConnector', 'implementation', 'liveValidation', 'createdAt', 'updatedAt']) || !uuid(raw.id) || id !== undefined && raw.id !== id || !positive(raw.revision) || raw.nativeConnector !== true || raw.implementation !== 'native_partial' || raw.liveValidation !== 'not_inferred' || !['disabled', 'read_verified', 'configured_unverified'].includes(raw.status) || raw.lastReadAt !== null && !date(raw.lastReadAt) || !date(raw.createdAt) || !date(raw.updatedAt)) invalid()
  const config = bindingConfiguration(raw as BaserowBinding)
  if (raw.instanceUrl !== config.instanceUrl || config.enabled === (raw.status === 'disabled') || raw.status === 'read_verified' && raw.lastReadAt === null) invalid()
  return { ...config, id: raw.id, revision: raw.revision, status: raw.status, lastReadAt: raw.lastReadAt, nativeConnector: true, implementation: 'native_partial', liveValidation: 'not_inferred', createdAt: raw.createdAt, updatedAt: raw.updatedAt }
}
export function validBaserowAttempt(raw: unknown): raw is BaserowAttempt {
  if (!object(raw) || !text(raw.key, 8, 128) || !/^[A-Za-z0-9_-]+$/.test(raw.key)) return false
  if (raw.kind === 'binding.create') return only(raw, ['kind', 'key'])
  return ['binding.update', 'binding.set_enabled', 'row.create'].includes(raw.kind) && uuid(raw.bindingId) && positive(raw.expectedRevision) && only(raw, ['kind', 'key', 'bindingId', 'expectedRevision', ...(raw.kind === 'binding.set_enabled' ? ['enabled'] : [])]) && (raw.kind !== 'binding.set_enabled' || typeof raw.enabled === 'boolean')
}
export function baserowAttempt(kind: BaserowAttempt['kind'], binding?: BaserowBinding, key: string = crypto.randomUUID(), enabled?: boolean): BaserowAttempt {
  const attempt = kind === 'binding.create' ? { kind, key } : { kind, key, bindingId: binding?.id, expectedRevision: binding?.revision, ...(kind === 'binding.set_enabled' ? { enabled } : {}) }
  if (!validBaserowAttempt(attempt)) invalid('A referência da operação é inválida.')
  return Object.freeze(attempt)
}
export function parseBaserowOperation(raw: unknown, attempt: BaserowAttempt): BaserowOperation {
  if (!validBaserowAttempt(attempt) || !object(raw) || !only(raw, ['key', 'kind', 'status', 'bindingId', 'revision', 'nativeOperationId', 'rowId', 'errorCode', 'requiresReconciliation', 'automaticRetry', 'createdAt', 'updatedAt']) || raw.key !== attempt.key || raw.kind !== attempt.kind || !uuid(raw.bindingId) || !positive(raw.revision) || raw.automaticRetry !== false || !date(raw.createdAt) || !date(raw.updatedAt) || raw.errorCode !== null && !(typeof raw.errorCode === 'string' && /^[A-Za-z0-9_:-]{1,100}$/.test(raw.errorCode)) || raw.nativeOperationId !== null && !uuid(raw.nativeOperationId)) invalid()
  if (attempt.kind === 'binding.create' ? raw.revision !== 1 : raw.bindingId !== attempt.bindingId || raw.revision !== attempt.expectedRevision + (attempt.kind === 'row.create' ? 0 : 1)) invalid()
  if (attempt.kind === 'row.create') {
    if (!['pending', 'created', 'not_sent', 'uncertain'].includes(raw.status) || (raw.status === 'created' ? !positive(raw.rowId) || raw.nativeOperationId === null || raw.errorCode !== null : raw.rowId !== null) || raw.status === 'uncertain' && raw.nativeOperationId === null) invalid()
  } else if (raw.status !== 'succeeded' || raw.nativeOperationId !== null || raw.rowId !== null || raw.errorCode !== null) invalid()
  if (raw.requiresReconciliation !== ['pending', 'uncertain'].includes(raw.status)) invalid()
  return { key: raw.key, kind: raw.kind, status: raw.status, bindingId: raw.bindingId, revision: raw.revision, nativeOperationId: raw.nativeOperationId, rowId: raw.rowId, errorCode: raw.errorCode, requiresReconciliation: raw.requiresReconciliation, automaticRetry: false, createdAt: raw.createdAt, updatedAt: raw.updatedAt }
}
export function parseBaserowFields(raw: unknown, binding: BaserowBinding): BaserowField[] {
  if (!object(raw) || raw.tableId !== binding.tableId || raw.source !== 'baserow' || raw.dataSource !== 'untrusted_external_content' || raw.providerVerified !== true || !Array.isArray(raw.items) || raw.items.length > 500) invalid()
  const items = raw.items.map((f: unknown): BaserowField => {
    if (!object(f) || !positive(f.id) || !text(f.name, 0, 1000) || !text(f.type, 0, 100) || f.primary !== undefined && typeof f.primary !== 'boolean' || f.read_only !== undefined && typeof f.read_only !== 'boolean' || f.number_decimal_places !== undefined && !nonnegative(f.number_decimal_places)) invalid()
    let choices: BaserowField['select_options']
    if (f.select_options !== undefined) {
      if (!Array.isArray(f.select_options) || f.select_options.length > 1000) invalid()
      choices = f.select_options.map((c: unknown) => { if (!object(c) || !positive(c.id) || !text(c.value, 0, 2000)) invalid(); return { id: c.id, value: c.value } })
      if (new Set(choices.map(c => c.id)).size !== choices.length) invalid()
    }
    return { id: f.id, name: f.name, type: f.type, ...(f.primary === undefined ? {} : { primary: f.primary }), ...(f.read_only === undefined ? {} : { read_only: f.read_only }), ...(f.number_decimal_places === undefined ? {} : { number_decimal_places: f.number_decimal_places }), ...(choices === undefined ? {} : { select_options: choices }) }
  })
  if (new Set(items.map(f => f.id)).size !== items.length) invalid()
  return items
}
export const writableBaserowTypes = ['text', 'long_text', 'url', 'email', 'number', 'boolean', 'date', 'single_select', 'multiple_select'] as const
export function baserowValues(raw: unknown, fields: BaserowField[]): Record<string, unknown> {
  if (!object(raw) || !Object.keys(raw).length || Object.keys(raw).length > 100) invalid('Selecione de 1 a 100 campos.')
  for (const [key, v] of Object.entries(raw)) {
    const f = fields.find(field => `field_${field.id}` === key)
    if (!/^field_[1-9][0-9]*$/.test(key) || !f || f.read_only || !writableBaserowTypes.includes(f.type as any)) invalid('Campo ausente, somente leitura ou tipo não suportado.')
    let ok = false
    if (['text', 'long_text', 'url'].includes(f.type)) ok = v === null || text(v, 0, 10000)
    if (f.type === 'email') ok = v === null || v === '' || text(v, 1, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
    if (f.type === 'number') ok = v === null || typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' && /^-?\d{1,30}(\.\d{1,20})?$/.test(v)
    if (f.type === 'boolean') ok = typeof v === 'boolean'
    if (f.type === 'date') ok = v === null || date(v) || typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
    if (f.type === 'single_select') ok = v === null || positive(v) && !!f.select_options?.some(c => c.id === v)
    if (f.type === 'multiple_select') ok = Array.isArray(v) && v.length <= 100 && v.every(id => positive(id) && f.select_options?.some(c => c.id === id))
    if (!ok) invalid(`Valor incompatível no campo ${f.name}.`)
  }
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 32000) invalid('Os valores excedem o limite de 32000 bytes.')
  return structuredClone(raw)
}
export function baserowQuery(raw: unknown): BaserowQuery {
  if (!object(raw) || !only(raw, ['page', 'size', 'search', 'filters', 'filterType', 'orderBy']) || !positive(raw.page) || raw.page > 100000 || !positive(raw.size) || raw.size > 100 || raw.search !== undefined && !text(raw.search, 0, 1000) || !['AND', 'OR'].includes(raw.filterType) || !Array.isArray(raw.filters) || raw.filters.length > 20 || !Array.isArray(raw.orderBy) || raw.orderBy.length > 5) invalid('Consulta inválida.')
  const filters = raw.filters.map((f: unknown) => { if (!object(f) || !only(f, ['fieldId', 'operator', 'value']) || !positive(f.fieldId) || !baserowFilterOperators.includes(f.operator) || !(text(f.value, 0, 2000) || typeof f.value === 'boolean' || typeof f.value === 'number' && Number.isFinite(f.value))) invalid('Filtro inválido.'); return { fieldId: f.fieldId, operator: f.operator, value: f.value } })
  const orderBy = raw.orderBy.map((s: unknown) => { if (!object(s) || !only(s, ['fieldId', 'descending']) || !positive(s.fieldId) || typeof s.descending !== 'boolean') invalid('Ordenação inválida.'); return { fieldId: s.fieldId, descending: s.descending } })
  return { page: raw.page, size: raw.size, ...(raw.search === undefined ? {} : { search: raw.search }), filters, filterType: raw.filterType, orderBy }
}
export function parseBaserowRows(raw: unknown, binding: BaserowBinding, query: BaserowQuery): BaserowRows {
  if (!object(raw) || raw.source !== 'baserow' || raw.dataSource !== 'untrusted_external_content' || raw.providerVerified !== true || raw.tableId !== binding.tableId || raw.page !== query.page || raw.size !== query.size || !nonnegative(raw.count) || !Array.isArray(raw.items) || raw.items.length > query.size || raw.nextPage !== null && raw.nextPage !== query.page + 1) invalid()
  const items = raw.items.map((row: unknown) => { if (!object(row) || !positive(row.id)) invalid(); return structuredClone(row) as Record<string, unknown> & { id: number } })
  if (new Set(items.map(row => row.id)).size !== items.length) invalid()
  return { items, count: raw.count, page: raw.page, size: raw.size, nextPage: query.page === 100000 ? null : raw.nextPage }
}
export function createBaserowService(context: EngineContext) {
  const prefix = '/integrations/baserow'
  async function get(id: string, signal?: AbortSignal) { context.assertCurrent(); if (!uuid(id)) invalid(); const raw = await context.request(`${prefix}/tables/${id}`, { signal }); context.assertCurrent(); return parseBaserowBinding(raw, id) }
  async function unchanged(binding: BaserowBinding, signal?: AbortSignal) { const current = await get(binding.id, signal); if (current.revision !== binding.revision) throw new EngineError(409, 'baserow_configuration_changed', 'A configuração mudou. Os dados desta consulta foram descartados; revise o vínculo explicitamente.') }
  async function fields(binding: BaserowBinding, signal?: AbortSignal) { context.assertCurrent(); parseBaserowBinding(binding); const raw = await context.request(`${prefix}/tables/${binding.id}/fields`, { signal }); await unchanged(binding, signal); context.assertCurrent(); return parseBaserowFields(raw, binding) }
  function envelope(raw: unknown, attempt: BaserowAttempt) { context.assertCurrent(); if (!object(raw) || typeof raw.replayed !== 'boolean') invalid(); return parseBaserowOperation(raw.operation, attempt) }
  return {
    get, fields, schema: fields,
    async list(signal?: AbortSignal) { context.assertCurrent(); const raw = await context.request<any>(`${prefix}/tables`, { signal }); context.assertCurrent(); if (!object(raw) || !Array.isArray(raw.items)) invalid(); const items = raw.items.map((item: unknown) => parseBaserowBinding(item)); if (new Set(items.map(b => b.id)).size !== items.length) invalid(); return items },
    async query(binding: BaserowBinding, input: BaserowQuery, signal?: AbortSignal) { context.assertCurrent(); parseBaserowBinding(binding); const q = baserowQuery(input), raw = await context.request(`${prefix}/tables/${binding.id}/query`, { method: 'POST', body: q, signal }); await unchanged(binding, signal); context.assertCurrent(); return parseBaserowRows(raw, binding, q) },
    async configure(attempt: BaserowAttempt, input: BaserowConfiguration) {
      context.assertCurrent(); if (!validBaserowAttempt(attempt) || !['binding.create', 'binding.update'].includes(attempt.kind)) invalid()
      const configuration = baserowConfiguration(input); if (attempt.kind === 'binding.create' && !configuration.token) invalid('Informe o token de banco de dados para cadastrar o vínculo.')
      const update = attempt.kind === 'binding.update'
      return envelope(await context.request(`${prefix}/tables${update ? `/${attempt.bindingId}` : ''}`, { method: update ? 'PUT' : 'POST', idempotencyKey: attempt.key, body: { expectedTenantId: context.tenantId, ...(update ? { expectedRevision: attempt.expectedRevision } : {}), configuration } }), attempt)
    },
    async setEnabled(attempt: BaserowAttempt) { context.assertCurrent(); if (!validBaserowAttempt(attempt) || attempt.kind !== 'binding.set_enabled') invalid(); return envelope(await context.request(`${prefix}/tables/${attempt.bindingId}`, { method: 'PATCH', idempotencyKey: attempt.key, body: { expectedTenantId: context.tenantId, expectedRevision: attempt.expectedRevision, enabled: attempt.enabled } }), attempt) },
    async create(attempt: BaserowAttempt, values: Record<string, unknown>, fields: BaserowField[]) { context.assertCurrent(); if (!validBaserowAttempt(attempt) || attempt.kind !== 'row.create') invalid(); return envelope(await context.request(`${prefix}/tables/${attempt.bindingId}/rows`, { method: 'POST', idempotencyKey: attempt.key, body: { expectedTenantId: context.tenantId, expectedRevision: attempt.expectedRevision, values: baserowValues(values, fields) } }), attempt) },
    async operation(attempt: BaserowAttempt) { context.assertCurrent(); if (!validBaserowAttempt(attempt)) invalid(); const raw = await context.request(`${prefix}/operations/${attempt.key}`); context.assertCurrent(); return parseBaserowOperation(raw, attempt) },
  }
}
