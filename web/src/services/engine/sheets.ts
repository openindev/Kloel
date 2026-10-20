import { EngineError } from './http'
import { accountClient } from './account'
import type { EngineContext } from './session'
import { sheetQueryBody, sheetQueryInput, parseSheetQueryResult, type SheetQueryInput } from './sheets-query'

export type SheetCell = string | number | boolean
export type SheetConfiguration = { spreadsheetId: string; name: string; allowAppend: boolean; enabled: boolean }
export type SheetBinding = SheetConfiguration & { id: string; connectionId: string; revision: number; lastVerifiedAt: string | null; lastVerifiedRevision: number | null; status: 'disabled' | 'configured_unverified' | 'read_verified'; createdAt: string; updatedAt: string }
export type SheetRange = { sheetTitle: string; range: string }
export type SheetAppend = SheetRange & { rows: SheetCell[][] }
export type SheetTab = { sheetId: number; title: string; index?: number; sheetType?: string; gridProperties?: { rowCount?: number; columnCount?: number } }
export type SheetValues = { range: string; requestedRange: string; values: SheetCell[][] }
export type SheetAttempt = { key: string; connectionId: string; kind: 'binding.create' } | { key: string; connectionId: string; kind: 'binding.update' | 'rows.append'; bindingId: string; expectedRevision: number } | { key: string; connectionId: string; kind: 'binding.set_enabled'; bindingId: string; expectedRevision: number; enabled: boolean }
export type SheetOperation = { key: string; kind: SheetAttempt['kind']; connectionId: string; bindingId: string; revision: number; status: 'succeeded' | 'pending' | 'not_sent' | 'uncertain' | 'appended'; nativeOperationId: string | null; result: null | { updatedRange: string; updatedRows: number; updatedColumns: number; updatedCells: number; valueInputOption: 'RAW' }; errorCode: string | null; requiresReconciliation: boolean; automaticRetry: false; createdAt: string; updatedAt: string }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length >= min && v.length <= max
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const positive = (v: unknown): v is number => natural(v) && v > 0
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k))
function invalid(message = 'Os dados de planilha recebidos são incompatíveis.'): never { throw new EngineError(0, 'invalid_sheets_data', message) }
const sheetId = (v: unknown): v is string => text(v, 10, 200) && /^[a-zA-Z0-9_-]+$/.test(v)
const cell = (v: unknown): v is SheetCell => text(v, 0, 50000) || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)
export function sheetConfiguration(raw: unknown): SheetConfiguration {
  if (!object(raw) || !only(raw, ['spreadsheetId', 'name', 'allowAppend', 'enabled']) || !sheetId(raw.spreadsheetId) || !text(raw.name, 1, 120) || !raw.name.trim() || typeof raw.allowAppend !== 'boolean' || typeof raw.enabled !== 'boolean') invalid('Confira o ID da planilha, nome e permissões.')
  return { spreadsheetId: raw.spreadsheetId, name: raw.name.trim(), allowAppend: raw.allowAppend, enabled: raw.enabled }
}
export function parseSheetBinding(raw: unknown, connectionId?: string, id?: string): SheetBinding {
  if (!object(raw) || !only(raw, ['id', 'connectionId', 'spreadsheetId', 'name', 'allowAppend', 'enabled', 'revision', 'lastVerifiedAt', 'lastVerifiedRevision', 'status', 'createdAt', 'updatedAt']) || !uuid(raw.id) || !uuid(raw.connectionId) || connectionId !== undefined && raw.connectionId !== connectionId || id !== undefined && raw.id !== id || !positive(raw.revision) || !date(raw.createdAt) || !date(raw.updatedAt) || raw.lastVerifiedAt !== null && !date(raw.lastVerifiedAt) || raw.lastVerifiedRevision !== null && !positive(raw.lastVerifiedRevision)) invalid()
  const config = sheetConfiguration({ spreadsheetId: raw.spreadsheetId, name: raw.name, allowAppend: raw.allowAppend, enabled: raw.enabled })
  const status = !config.enabled ? 'disabled' : raw.lastVerifiedRevision === raw.revision ? 'read_verified' : 'configured_unverified'
  if (raw.status !== status || status === 'read_verified' && raw.lastVerifiedAt === null) invalid()
  return { ...config, id: raw.id, connectionId: raw.connectionId, revision: raw.revision, lastVerifiedAt: raw.lastVerifiedAt, lastVerifiedRevision: raw.lastVerifiedRevision, status, createdAt: raw.createdAt, updatedAt: raw.updatedAt }
}
export function sheetRange(raw: unknown) {
  if (!object(raw) || !only(raw, ['sheetTitle', 'range']) || !text(raw.sheetTitle, 1, 100) || /[\u0000-\u001f]/.test(raw.sheetTitle) || !text(raw.range, 2, 40) || !/^[A-Za-z]{1,3}[1-9][0-9]{0,6}(?::[A-Za-z]{1,3}[1-9][0-9]{0,6})?$/.test(raw.range)) invalid('Informe título da aba e intervalo A1, por exemplo A1:C20.')
  const range = raw.range.toUpperCase(), parts = range.split(':'), point = (s: string) => { const [, col, row] = /^([A-Z]+)([0-9]+)$/.exec(s)!; return { col: [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), row: Number(row) } }
  const start = point(parts[0]), end = point(parts[1] ?? parts[0]), columns = end.col - start.col + 1, rows = end.row - start.row + 1
  if (columns < 1 || columns > 50 || rows < 1 || rows > 1000 || rows * columns > 20000) invalid('Use até 1000 linhas, 50 colunas e 20000 células em ordem crescente.')
  return { sheetTitle: raw.sheetTitle, range, columns, rows, a1: `'${raw.sheetTitle.replaceAll("'", "''")}'!${range}` }
}
export function sheetAppend(raw: unknown): SheetAppend {
  if (!object(raw) || !only(raw, ['sheetTitle', 'range', 'rows'])) invalid('Linhas inválidas.')
  const range = sheetRange({ sheetTitle: raw.sheetTitle, range: raw.range })
  if (!Array.isArray(raw.rows) || !raw.rows.length || raw.rows.length > 100 || raw.rows.some((r: unknown) => !Array.isArray(r) || !r.length || r.length > range.columns || r.some(v => !cell(v))) || raw.rows.flat().length > 5000 || new TextEncoder().encode(JSON.stringify(raw.rows)).length > 256000) invalid('Envie até 100 linhas e 5000 células (256000 bytes), usando texto, números finitos ou booleanos, dentro da largura do intervalo.')
  return { sheetTitle: range.sheetTitle, range: range.range, rows: structuredClone(raw.rows) }
}
export function validSheetAttempt(raw: unknown): raw is SheetAttempt {
  if (!object(raw) || !text(raw.key, 8, 128) || !/^[A-Za-z0-9_-]+$/.test(raw.key) || !uuid(raw.connectionId)) return false
  if (raw.kind === 'binding.create') return only(raw, ['key', 'kind', 'connectionId'])
  return ['binding.update', 'binding.set_enabled', 'rows.append'].includes(raw.kind) && uuid(raw.bindingId) && positive(raw.expectedRevision) && raw.expectedRevision < Number.MAX_SAFE_INTEGER && only(raw, ['key', 'kind', 'connectionId', 'bindingId', 'expectedRevision', ...(raw.kind === 'binding.set_enabled' ? ['enabled'] : [])]) && (raw.kind !== 'binding.set_enabled' || typeof raw.enabled === 'boolean')
}
export function sheetAttempt(kind: SheetAttempt['kind'], connectionId: string, binding?: SheetBinding, enabled?: boolean, key = crypto.randomUUID()): SheetAttempt {
  const value = { key, kind, connectionId, ...(kind === 'binding.create' ? {} : { bindingId: binding?.id, expectedRevision: binding?.revision }), ...(kind === 'binding.set_enabled' ? { enabled } : {}) }
  if (!validSheetAttempt(value) || binding && binding.connectionId !== connectionId) invalid('Referência da operação inválida.')
  return Object.freeze(value)
}
export function parseSheetOperation(raw: unknown, attempt: SheetAttempt): SheetOperation {
  if (!validSheetAttempt(attempt) || !object(raw) || !only(raw, ['key', 'kind', 'connectionId', 'bindingId', 'revision', 'status', 'nativeOperationId', 'result', 'errorCode', 'requiresReconciliation', 'automaticRetry', 'createdAt', 'updatedAt']) || raw.key !== attempt.key || raw.kind !== attempt.kind || raw.connectionId !== attempt.connectionId || !uuid(raw.bindingId) || !positive(raw.revision) || raw.automaticRetry !== false || !date(raw.createdAt) || !date(raw.updatedAt) || raw.errorCode !== null && !(typeof raw.errorCode === 'string' && /^[A-Za-z0-9_:-]{1,100}$/.test(raw.errorCode)) || raw.nativeOperationId !== null && !uuid(raw.nativeOperationId)) invalid()
  if (attempt.kind === 'binding.create' ? raw.revision !== 1 : raw.bindingId !== attempt.bindingId || raw.revision !== attempt.expectedRevision + (attempt.kind === 'rows.append' ? 0 : 1)) invalid()
  let result: SheetOperation['result'] = null
  if (attempt.kind === 'rows.append') {
    if (!['pending', 'not_sent', 'uncertain', 'appended'].includes(raw.status) || raw.status === 'uncertain' && raw.nativeOperationId === null) invalid()
    if (raw.status === 'appended') {
      const r = raw.result
      if (!object(r) || !only(r, ['updatedRange', 'updatedRows', 'updatedColumns', 'updatedCells', 'valueInputOption']) || !text(r.updatedRange, 1, 4096) || /[\u0000-\u001f]/.test(r.updatedRange) || !positive(r.updatedRows) || r.updatedRows > 100 || !positive(r.updatedColumns) || r.updatedColumns > 50 || !positive(r.updatedCells) || r.updatedCells > 5000 || r.updatedCells > r.updatedRows * r.updatedColumns || r.valueInputOption !== 'RAW' || raw.nativeOperationId === null || raw.errorCode !== null) invalid()
      result = { updatedRange: r.updatedRange, updatedRows: r.updatedRows, updatedColumns: r.updatedColumns, updatedCells: r.updatedCells, valueInputOption: 'RAW' }
    } else if (raw.result !== null) invalid()
  } else if (raw.status !== 'succeeded' || raw.result !== null || raw.nativeOperationId !== null || raw.errorCode !== null) invalid()
  if (raw.requiresReconciliation !== ['pending', 'uncertain'].includes(raw.status)) invalid()
  return { key: raw.key, kind: raw.kind, connectionId: raw.connectionId, bindingId: raw.bindingId, revision: raw.revision, status: raw.status, nativeOperationId: raw.nativeOperationId, result, errorCode: raw.errorCode, requiresReconciliation: raw.requiresReconciliation, automaticRetry: false, createdAt: raw.createdAt, updatedAt: raw.updatedAt }
}
function readIdentity(raw: unknown, b: SheetBinding): asserts raw is Record<string, any> {
  if (!object(raw) || raw.bindingId !== b.id || raw.bindingRevision !== b.revision || raw.spreadsheetId !== b.spreadsheetId || raw.source !== 'google_sheets' || raw.providerVerified !== true) invalid()
}
export function parseSheetTabs(raw: unknown, binding: SheetBinding): SheetTab[] {
  readIdentity(raw, binding)
  if (!text(raw.title, 0, 50000) || !Array.isArray(raw.items) || raw.items.length > 1000) invalid()
  const items = raw.items.map((t: unknown): SheetTab => {
    if (!object(t) || !natural(t.sheetId) || !text(t.title, 1, 100) || /[\u0000-\u001f]/.test(t.title) || t.index !== undefined && !natural(t.index) || t.sheetType !== undefined && !text(t.sheetType, 0, 100) || t.gridProperties !== undefined && (!object(t.gridProperties) || ['rowCount', 'columnCount'].some(k => t.gridProperties[k] !== undefined && !natural(t.gridProperties[k])))) invalid()
    return { sheetId: t.sheetId, title: t.title, ...(t.index === undefined ? {} : { index: t.index }), ...(t.sheetType === undefined ? {} : { sheetType: t.sheetType }), ...(t.gridProperties === undefined ? {} : { gridProperties: { ...t.gridProperties } }) }
  })
  if (new Set(items.map(t => t.sheetId)).size !== items.length || new Set(items.map(t => t.title)).size !== items.length) invalid()
  return items
}
export function parseSheetValues(raw: unknown, binding: SheetBinding, input: SheetRange): SheetValues {
  readIdentity(raw, binding); const r = sheetRange(input)
  if (raw.requestedRange !== r.a1 || raw.dataSource !== 'untrusted_spreadsheet_content' || raw.majorDimension !== 'ROWS' || !text(raw.range, 1, 4096) || !Array.isArray(raw.values) || raw.values.length > r.rows || raw.values.some((row: unknown) => !Array.isArray(row) || row.length > r.columns || row.some(c => !cell(c)))) invalid()
  return { range: raw.range, requestedRange: raw.requestedRange, values: structuredClone(raw.values) }
}
export function createSheetsService(context: EngineContext, userId: string) {
  const account = accountClient(context, userId)
  const prefix = (id: string) => { if (!uuid(id)) invalid(); return `/oauth/connections/${id}/spreadsheets` }
  async function get(connectionId: string, id: string, signal?: AbortSignal) { context.assertCurrent(); if (!uuid(id)) invalid(); const raw = await context.request(`${prefix(connectionId)}/${id}`, { signal }); context.assertCurrent(); return parseSheetBinding(raw, connectionId, id) }
  async function connectionIdentity(b: SheetBinding, signal?: AbortSignal) {
    const connections = await account.connections(signal); context.assertCurrent(); const c = connections.find(item => item.id === b.connectionId)
    if (!c || c.provider !== 'google' || c.status !== 'connected' || !c.capabilities.includes('sheets_read')) throw new EngineError(409, 'oauth_connection_changed', 'A autorização da conta mudou. A resposta foi descartada.')
    return JSON.stringify({ id: c.id, visibility: c.visibility, generation: c.authorizationGeneration, capabilities: [...c.capabilities].sort() })
  }
  async function unchanged(b: SheetBinding, identity: string, signal?: AbortSignal) {
    const latest = await get(b.connectionId, b.id, signal)
    if (latest.revision !== b.revision || latest.spreadsheetId !== b.spreadsheetId) throw new EngineError(409, 'spreadsheet_configuration_changed', 'A configuração mudou. A resposta foi descartada; revise o vínculo explicitamente.')
    if (await connectionIdentity(b, signal) !== identity) throw new EngineError(409, 'oauth_connection_changed', 'A autorização da conta mudou. A resposta foi descartada.')
  }
  function envelope(raw: unknown, attempt: SheetAttempt) { context.assertCurrent(); if (!object(raw) || typeof raw.replayed !== 'boolean') invalid(); return parseSheetOperation(raw.operation, attempt) }
  return {
    get,
    async accounts(signal?: AbortSignal) { context.assertCurrent(); const accounts = await account.connections(signal); context.assertCurrent(); const google = accounts.filter(a => a.provider === 'google'); if (new Set(google.map(a => a.id)).size !== google.length) invalid(); return google },
    async list(connectionId: string, signal?: AbortSignal) { context.assertCurrent(); const raw = await context.request<any>(prefix(connectionId), { signal }); context.assertCurrent(); if (!object(raw) || raw.source !== 'local_configured_bindings' || raw.driveListing !== false || !Array.isArray(raw.items)) invalid(); const result = raw.items.map((b: unknown) => parseSheetBinding(b, connectionId)); if (new Set(result.map(b => b.id)).size !== result.length) invalid(); return result },
    async configure(attempt: SheetAttempt, input: SheetConfiguration) { context.assertCurrent(); if (!validSheetAttempt(attempt) || !['binding.create', 'binding.update'].includes(attempt.kind)) invalid(); const c = sheetConfiguration(input), update = attempt.kind === 'binding.update'; return envelope(await context.request(`${prefix(attempt.connectionId)}${update ? `/${attempt.bindingId}` : ''}`, { method: update ? 'PUT' : 'POST', idempotencyKey: attempt.key, body: { expectedTenantId: context.tenantId, ...(update ? { expectedRevision: attempt.expectedRevision } : {}), configuration: update ? { name: c.name, allowAppend: c.allowAppend } : c } }), attempt) },
    async setEnabled(attempt: SheetAttempt) { context.assertCurrent(); if (!validSheetAttempt(attempt) || attempt.kind !== 'binding.set_enabled') invalid(); return envelope(await context.request(`${prefix(attempt.connectionId)}/${attempt.bindingId}`, { method: 'PATCH', idempotencyKey: attempt.key, body: { expectedTenantId: context.tenantId, expectedRevision: attempt.expectedRevision, enabled: attempt.enabled } }), attempt) },
    async tabs(binding: SheetBinding, signal?: AbortSignal) { context.assertCurrent(); parseSheetBinding(binding); const identity = await connectionIdentity(binding, signal), raw = await context.request(`${prefix(binding.connectionId)}/${binding.id}/tabs?expectedRevision=${binding.revision}`, { signal }); await unchanged(binding, identity, signal); context.assertCurrent(); return parseSheetTabs(raw, binding) },
    async values(binding: SheetBinding, input: SheetRange, signal?: AbortSignal) { context.assertCurrent(); parseSheetBinding(binding); const identity = await connectionIdentity(binding, signal), r = sheetRange(input), query = new URLSearchParams({ expectedRevision: String(binding.revision), sheetTitle: r.sheetTitle, range: r.range }); const raw = await context.request(`${prefix(binding.connectionId)}/${binding.id}/values?${query}`, { signal }); await unchanged(binding, identity, signal); context.assertCurrent(); return parseSheetValues(raw, binding, input) },
    async query(binding: SheetBinding, input: SheetQueryInput, signal?: AbortSignal) {
      context.assertCurrent(); signal?.throwIfAborted(); const bound = parseSheetBinding(binding)
      const query = sheetQueryInput(input), body = sheetQueryBody(query, context.tenantId, bound.revision), identity = await connectionIdentity(bound, signal)
      context.assertCurrent(); signal?.throwIfAborted()
      const raw = await context.request(`${prefix(bound.connectionId)}/${bound.id}/query`, { method: 'POST', body, signal })
      signal?.throwIfAborted(); await unchanged(bound, identity, signal); context.assertCurrent(); signal?.throwIfAborted()
      return parseSheetQueryResult(raw, bound, query)
    },
    async append(attempt: SheetAttempt, input: SheetAppend) { context.assertCurrent(); if (!validSheetAttempt(attempt) || attempt.kind !== 'rows.append') invalid(); const body = sheetAppend(input); return envelope(await context.request(`${prefix(attempt.connectionId)}/${attempt.bindingId}/append`, { method: 'POST', idempotencyKey: attempt.key, body: { expectedTenantId: context.tenantId, expectedRevision: attempt.expectedRevision, ...body } }), attempt) },
    async operation(attempt: SheetAttempt) { context.assertCurrent(); if (!validSheetAttempt(attempt)) invalid(); const raw = await context.request(`/oauth/sheets/operations/${attempt.key}`); context.assertCurrent(); return parseSheetOperation(raw, attempt) },
  }
}
