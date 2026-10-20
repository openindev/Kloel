import { EngineError } from './http'
import { captureEngineContext, type EngineContext } from './session'
import { assertImportBytes, validateImportBundle } from './crm-import-file'

export type ImportDefinition = { id?: string; revision?: number; key: string; label: string; type: 'text' | 'number' | 'boolean' | 'choice'; description?: string; status?: 'active' | 'archived'; aiFill?: boolean; options?: { id?: string; label: string; status?: 'active' | 'archived' }[]; example?: string; showInList?: boolean }
export type ImportData = { firstName?: string; lastName?: string; displayName?: string; nameMode?: 'structured' | 'custom'; company?: string; notes?: string; timezone?: string; phones?: { id?: string; value: string; label?: '' | 'HOME' | 'WORK' | 'OTHER' }[]; emails?: { id?: string; value: string; label?: '' | 'HOME' | 'WORK' | 'OTHER' }[]; primaryPhoneId?: string | null; primaryEmailId?: string | null; ownerMembershipId?: string | null; tags?: string[]; fieldValues?: Record<string, string | boolean | null> }
export type ImportBundle = { format: 'kloel.contacts'; version: 2; definitions: ImportDefinition[]; contacts: { sourceId?: string; revision?: number; data: ImportData; legacyData?: Record<string, unknown> }[] }
export type ImportOptions = { bundle: ImportBundle; mode?: 'create' | 'merge' | 'update_by_id'; mergePolicy?: 'fill_empty' | 'overwrite_supplied'; ownerMapping?: Record<string, string | null> }
export type ImportSummary = { total: number; create: number; merge: number; error: number }
export type ImportPreview = { fingerprint: string; canCommit: boolean; summary: ImportSummary; rows: { line: number; action: 'create' | 'merge' | 'error'; targetId?: string; expectedRevision?: number; data?: ImportData; errors: { code: string; message: string }[] }[]; definitionsToCreate: string[] }
export type ImportOperation = { key: string; kind: 'import.commit'; status: 'succeeded'; result: { committed: true; summary: ImportSummary; changes: { line: number; sourceId?: string; action: 'create' | 'merge'; id: string; revision: number }[]; definitionMappings: { sourceId?: string; key: string; id: string; options: { sourceId?: string; id: string }[] }[] }; createdAt: string; automaticRetry: false }
export type ImportAttempt = { key: string; optionsDigest: string; previewFingerprint: string }
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x)
const validId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x)
const validKey = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(x)
const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)
const number = (x: unknown, min = 0, max = 2000): x is number => Number.isSafeInteger(x) && Number(x) >= min && Number(x) <= max
function invalid(): never { throw new EngineError(0, 'invalid_import_response', 'O resultado da importação recebido é inválido. Consulte a referência antes de tentar novamente.') }
function inputError(): never { throw new EngineError(400, 'invalid_import_input', 'Revise o arquivo e a referência da importação.') }
export function validImportAttempt(x: unknown): x is ImportAttempt { return object(x) && Object.keys(x).sort().join() === 'key,optionsDigest,previewFingerprint' && validKey(x.key) && hash(x.optionsDigest) && hash(x.previewFingerprint) }

function canonical(value: unknown, depth = 0): string {
  if (depth > 64) inputError()
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) { if (Object.keys(value).length !== value.length) inputError(); return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']' }
  if (object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}'
  return inputError()
}
export function validateImportOptions(raw: unknown): ImportOptions {
  const serialized = canonical(raw); assertImportBytes(serialized); const input = JSON.parse(serialized)
  if (!object(input) || Object.keys(input).some(key => !['bundle', 'mode', 'mergePolicy', 'ownerMapping'].includes(key))) inputError()
  validateImportBundle(input.bundle)
  if (input.mode !== undefined && !['create', 'merge', 'update_by_id'].includes(input.mode) || input.mergePolicy !== undefined && !['fill_empty', 'overwrite_supplied'].includes(input.mergePolicy)) inputError()
  if (input.ownerMapping !== undefined && (!object(input.ownerMapping) || Object.entries(input.ownerMapping).some(([key, value]) => !validId(key) || value !== null && !validId(value)))) inputError()
  return input as ImportOptions
}
export async function digestImportOptions(options: ImportOptions): Promise<string> {
  const serialized = canonical(validateImportOptions(options)), digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
function summary(raw: unknown): ImportSummary {
  if (!object(raw) || !['total', 'create', 'merge', 'error'].every(key => number(raw[key])) || raw.total !== raw.create + raw.merge + raw.error) invalid()
  return { total: raw.total, create: raw.create, merge: raw.merge, error: raw.error }
}
export function parseImportPreview(raw: unknown): ImportPreview {
  if (!object(raw) || !hash(raw.fingerprint) || typeof raw.canCommit !== 'boolean' || !Array.isArray(raw.rows) || raw.rows.length > 2000 || !Array.isArray(raw.definitionsToCreate) || raw.definitionsToCreate.length > 100 || raw.definitionsToCreate.some((key: unknown) => !validId(key))) invalid()
  const counts = summary(raw.summary)
  const rows: ImportPreview['rows'] = raw.rows.map((row: unknown, i: number) => {
    if (!object(row) || row.line !== i + 1 || !['create', 'merge', 'error'].includes(row.action) || !Array.isArray(row.errors) || row.errors.length > 100) invalid()
    const errors = row.errors.map((error: unknown) => { if (!object(error) || typeof error.code !== 'string' || error.code.length > 128 || typeof error.message !== 'string' || error.message.length > 5000) invalid(); return { code: error.code, message: error.message } })
    if ((row.action === 'error') !== !!errors.length) invalid()
    if (row.action === 'error') return { line: row.line, action: 'error', errors }
    if (row.action === 'merge' && (!validId(row.targetId) || !number(row.expectedRevision, 1, Number.MAX_SAFE_INTEGER))) invalid()
    try { validateImportBundle({ format: 'kloel.contacts', version: 2, definitions: [], contacts: [{ data: row.data }] }) } catch { invalid() }
    return { line: row.line, action: row.action, ...(row.action === 'merge' ? { targetId: row.targetId, expectedRevision: row.expectedRevision } : {}), data: row.data, errors }
  })
  if (rows.length !== counts.total || rows.filter(row => row.action === 'create').length !== counts.create || rows.filter(row => row.action === 'merge').length !== counts.merge || rows.filter(row => row.action === 'error').length !== counts.error || raw.canCommit !== (counts.error === 0)) invalid()
  return { fingerprint: raw.fingerprint, canCommit: raw.canCommit, summary: counts, rows, definitionsToCreate: [...raw.definitionsToCreate] }
}
export function parseImportOperation(raw: unknown, expectedKey: string): ImportOperation {
  if (!object(raw) || raw.key !== expectedKey || !validKey(raw.key) || raw.kind !== 'import.commit' || raw.status !== 'succeeded' || raw.automaticRetry !== false || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt)) || !object(raw.result) || raw.result.committed !== true || !Array.isArray(raw.result.changes) || raw.result.changes.length > 2000 || !Array.isArray(raw.result.definitionMappings) || raw.result.definitionMappings.length > 100) invalid()
  const counts = summary(raw.result.summary)
  const changes: ImportOperation['result']['changes'] = raw.result.changes.map((change: unknown, i: number) => {
    if (!object(change) || change.line !== i + 1 || !validId(change.id) || !number(change.revision, 1, Number.MAX_SAFE_INTEGER) || !['create', 'merge'].includes(change.action) || change.sourceId !== undefined && !validId(change.sourceId)) invalid()
    return { line: change.line, id: change.id, revision: change.revision, action: change.action, ...(change.sourceId === undefined ? {} : { sourceId: change.sourceId }) }
  })
  if (counts.error !== 0 || changes.length !== counts.total || changes.filter(change => change.action === 'create').length !== counts.create || new Set(changes.map(change => change.id)).size !== changes.length) invalid()
  const definitionMappings = raw.result.definitionMappings.map((mapping: unknown) => {
    if (!object(mapping) || !validId(mapping.key) || !validId(mapping.id) || mapping.sourceId !== undefined && !validId(mapping.sourceId) || !Array.isArray(mapping.options) || mapping.options.length > 100) invalid()
    const options = mapping.options.map((option: unknown) => { if (!object(option) || !validId(option.id) || option.sourceId !== undefined && !validId(option.sourceId)) invalid(); return { id: option.id, ...(option.sourceId === undefined ? {} : { sourceId: option.sourceId }) } })
    return { key: mapping.key, id: mapping.id, options, ...(mapping.sourceId === undefined ? {} : { sourceId: mapping.sourceId }) }
  })
  return { key: raw.key, kind: 'import.commit', status: 'succeeded', automaticRetry: false, createdAt: raw.createdAt, result: { committed: true, summary: counts, changes, definitionMappings } }
}
export function createCRMImportClient(context: EngineContext) {
  const request = context.request.bind(context)
  return {
    context,
    async preview(options: ImportOptions, signal?: AbortSignal) { context.assertCurrent(); const input = validateImportOptions(options); const value = await request<unknown>('/crm/import/preview', { method: 'POST', body: { expectedTenantId: context.tenantId, options: input }, signal }); context.assertCurrent(); return parseImportPreview(value) },
    async commit(options: ImportOptions, previewFingerprint: string, key: string): Promise<{ operation: ImportOperation; replayed: boolean }> {
      context.assertCurrent(); if (!hash(previewFingerprint) || !validKey(key)) inputError(); const input = validateImportOptions(options)
      const value = await request<unknown>('/crm/import/commit', { method: 'POST', idempotencyKey: key, body: { expectedTenantId: context.tenantId, options: input, previewFingerprint } }); context.assertCurrent()
      if (!object(value) || typeof value.replayed !== 'boolean') invalid()
      return { operation: parseImportOperation(value.operation, key), replayed: value.replayed }
    },
    async operation(key: string, signal?: AbortSignal) { context.assertCurrent(); if (!validKey(key)) inputError(); const value = await request<unknown>(`/crm/import/operations/${encodeURIComponent(key)}`, { signal }); context.assertCurrent(); return parseImportOperation(value, key) },
    async export(signal?: AbortSignal): Promise<ImportBundle> { context.assertCurrent(); const value = await request<unknown>('/crm/export', { signal }); context.assertCurrent(); try { return validateImportBundle(value) } catch { return invalid() } },
  }
}
export const crmImportClient = () => createCRMImportClient(captureEngineContext('contacts:bulk'))
