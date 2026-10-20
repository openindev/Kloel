import { EngineError } from './http'
import type { SheetBinding } from './sheets'

export type SheetScalarRef = { kind: 'literal'; value: string } | { kind: 'variable'; name: string }
export type SheetFilter = { column: string; op: 'eq' | 'ne' | 'gt'; value: SheetScalarRef } | { column: string; op: 'in'; values: SheetScalarRef[] } | { column: string; op: 'regex'; pattern: string; flags: '' | 'i' }
export type SheetVariable = { name: string; type: 'text'; value: string } | { name: string; type: 'number'; value: number } | { name: string; type: 'boolean'; value: boolean }
export type SheetQueryInput = { sheetTitle: string; scanRange: string; headers: boolean; filters: SheetFilter[]; variables: SheetVariable[]; maxRows: number }
export type SheetQueryResult = {
  source: 'google_sheets'; dataSource: 'untrusted_spreadsheet_content'; connectionId: string; bindingId: string; bindingRevision: number
  sheetTitle: string; scanRange: string; requestedRange: string; valueRenderOption: 'FORMATTED_VALUE'; headers: boolean; queriedAt: string
  columns: { index: number; a1: string; header: string | null }[]; rows: { rowNumber: number; cells: string[] }[]
  coverage: { scope: 'requested_range'; completeWithinRange: true; wholeSheet: 'unknown'; examinedRows: number; nonEmptyRows: number; matchedRows: number; returnedRows: number }
  limits: { maxRows: number; resultBytes: 96000 }; resultBytes: number; truncationReasons: ('max_rows' | 'result_bytes')[]
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k))
const text = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length >= min && v.length <= max
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
function invalid(): never { throw new EngineError(400, 'invalid_sheets_query', 'Confira o intervalo fechado, cabeçalhos, filtros e variáveis da consulta.') }
function invalidResult(): never { throw new EngineError(0, 'invalid_sheets_query_data', 'O resultado da consulta é incompatível. Nenhum resultado foi aplicado.') }
export function sheetQueryRange(value: unknown) {
  if (!text(value, 5, 40) || !/^[A-Za-z]{1,3}[1-9][0-9]{0,6}:[A-Za-z]{1,3}[1-9][0-9]{0,6}$/.test(value)) invalid()
  const range = value.toUpperCase(), [a, b] = range.split(':'), point = (s: string) => { const [, col, row] = /^([A-Z]+)([0-9]+)$/.exec(s)!; return { col: [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), row: Number(row) } }
  const start = point(a), end = point(b), columns = end.col - start.col + 1, rows = end.row - start.row + 1
  if (columns < 1 || columns > 50 || rows < 1 || rows > 1000 || rows * columns > 20000) invalid()
  return { range, start, end, columns, rows }
}
export function sheetQueryInput(raw: unknown): SheetQueryInput {
  if (!object(raw) || !only(raw, ['sheetTitle', 'scanRange', 'headers', 'filters', 'variables', 'maxRows']) || !text(raw.sheetTitle, 1, 100) || /[\u0000-\u001f]/.test(raw.sheetTitle) || typeof raw.headers !== 'boolean' || !Array.isArray(raw.filters) || raw.filters.length > 12 || !Array.isArray(raw.variables) || raw.variables.length > 20) invalid()
  const r = sheetQueryRange(raw.scanRange), maxRows = raw.maxRows === undefined ? 50 : raw.maxRows
  if (!natural(maxRows) || maxRows < 1 || maxRows > 1000 || raw.headers && (r.start.row !== 1 || r.rows < 2) || !raw.headers && (raw.filters.length || raw.variables.length)) invalid()
  const names = new Set<string>(), used = new Set<string>()
  for (const v of raw.variables) {
    if (!object(v) || !only(v, ['name', 'type', 'value']) || !text(v.name, 1, 64) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(v.name) || names.has(v.name)) invalid()
    if (v.type === 'text' ? !text(v.value, 0, 2000) : v.type === 'number' ? typeof v.value !== 'number' || !Number.isFinite(v.value) : v.type === 'boolean' ? typeof v.value !== 'boolean' : true) invalid()
    names.add(v.name)
  }
  function scalar(v: unknown) {
    if (!object(v)) invalid()
    if (v.kind === 'literal' && only(v, ['kind', 'value']) && text(v.value, 0, 2000)) return
    if (v.kind === 'variable' && only(v, ['kind', 'name']) && typeof v.name === 'string' && names.has(v.name)) { used.add(v.name); return }
    invalid()
  }
  let regexCount = 0
  for (const f of raw.filters) {
    if (!object(f) || !text(f.column, 1, 256) || !f.column.trim()) invalid()
    if (['eq', 'ne', 'gt'].includes(f.op) && only(f, ['column', 'op', 'value'])) scalar(f.value)
    else if (f.op === 'in' && only(f, ['column', 'op', 'values']) && Array.isArray(f.values) && f.values.length >= 1 && f.values.length <= 50) f.values.forEach(scalar)
    else if (f.op === 'regex' && only(f, ['column', 'op', 'pattern', 'flags']) && text(f.pattern, 1, 256) && ['', 'i'].includes(f.flags)) regexCount++
    else invalid()
  }
  if (regexCount > 4 || names.size !== used.size) invalid()
  const result = { sheetTitle: raw.sheetTitle, scanRange: r.range, headers: raw.headers, filters: structuredClone(raw.filters), variables: structuredClone(raw.variables), maxRows }
  if (bytes(result) > 64000) invalid()
  return result
}
export function sheetQueryBody(input: SheetQueryInput, expectedTenantId: string, expectedRevision: number) {
  const body = { expectedTenantId, expectedRevision, ...sheetQueryInput(input) }
  if (bytes(body) > 64000) invalid()
  return body
}
function columnName(index: number) { let result = ''; for (let n = index; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result }
export function parseSheetQueryResult(raw: unknown, binding: SheetBinding, input: SheetQueryInput): SheetQueryResult {
  const q = sheetQueryInput(input), r = sheetQueryRange(q.scanRange), keys = ['source', 'dataSource', 'connectionId', 'bindingId', 'bindingRevision', 'sheetTitle', 'scanRange', 'requestedRange', 'valueRenderOption', 'headers', 'queriedAt', 'columns', 'rows', 'coverage', 'limits', 'resultBytes', 'truncationReasons']
  if (!object(raw) || !only(raw, keys) || raw.source !== 'google_sheets' || raw.dataSource !== 'untrusted_spreadsheet_content' || raw.connectionId !== binding.connectionId || raw.bindingId !== binding.id || raw.bindingRevision !== binding.revision || raw.sheetTitle !== q.sheetTitle || raw.scanRange !== q.scanRange || raw.requestedRange !== `'${q.sheetTitle.replaceAll("'", "''")}'!${q.scanRange}` || raw.valueRenderOption !== 'FORMATTED_VALUE' || raw.headers !== q.headers || !text(raw.queriedAt, 20, 30) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(raw.queriedAt) || !Number.isFinite(Date.parse(raw.queriedAt)) || !Array.isArray(raw.columns) || raw.columns.length !== r.columns || !Array.isArray(raw.rows) || raw.rows.length > q.maxRows) invalidResult()
  const headers = new Set<string>()
  for (let i = 0; i < raw.columns.length; i++) {
    const c = raw.columns[i]
    if (!object(c) || !only(c, ['index', 'a1', 'header']) || c.index !== r.start.col + i || c.a1 !== columnName(c.index)) invalidResult()
    if (q.headers) { if (!text(c.header, 1, 256) || !c.header.trim() || headers.has(c.header)) invalidResult(); headers.add(c.header) }
    else if (c.header !== null) invalidResult()
  }
  if (q.filters.some(f => !headers.has(f.column))) invalidResult()
  let prior = r.start.row + (q.headers ? 1 : 0) - 1
  for (const row of raw.rows) {
    if (!object(row) || !only(row, ['rowNumber', 'cells']) || !natural(row.rowNumber) || row.rowNumber <= prior || row.rowNumber > r.end.row || !Array.isArray(row.cells) || row.cells.length !== r.columns || row.cells.some((c: unknown) => typeof c !== 'string') || row.cells.every((c: string) => c === '')) invalidResult()
    prior = row.rowNumber
  }
  const c = raw.coverage, limits = raw.limits, reasons = raw.truncationReasons
  if (!object(c) || !only(c, ['scope', 'completeWithinRange', 'wholeSheet', 'examinedRows', 'nonEmptyRows', 'matchedRows', 'returnedRows']) || c.scope !== 'requested_range' || c.completeWithinRange !== true || c.wholeSheet !== 'unknown' || c.examinedRows !== r.rows - (q.headers ? 1 : 0) || ![c.nonEmptyRows, c.matchedRows, c.returnedRows].every(natural) || c.examinedRows < c.nonEmptyRows || c.nonEmptyRows < c.matchedRows || c.matchedRows < c.returnedRows || c.returnedRows !== raw.rows.length || !object(limits) || !only(limits, ['maxRows', 'resultBytes']) || limits.maxRows !== q.maxRows || limits.resultBytes !== 96000 || !natural(raw.resultBytes) || raw.resultBytes !== bytes({ columns: raw.columns, rows: raw.rows }) || raw.resultBytes > 96000 || !Array.isArray(reasons)) invalidResult()
  const expectedReasons = [...(c.matchedRows > q.maxRows ? ['max_rows'] : []), ...(c.returnedRows < Math.min(c.matchedRows, q.maxRows) ? ['result_bytes'] : [])]
  if (JSON.stringify(reasons) !== JSON.stringify(expectedReasons) || c.matchedRows > 0 && c.returnedRows === 0 || !q.filters.length && c.matchedRows !== c.nonEmptyRows) invalidResult()
  return structuredClone(raw) as SheetQueryResult
}
