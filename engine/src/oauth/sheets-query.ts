import { z } from 'zod';
import { RE2JS } from 're2js';
import type { Store } from '../store.js';
import type { Actor } from './access.js';
import { OAuthError } from './client.js';
import { sheetRectangle, readFormattedSheetRectangle, formattedSheetRange, formattedSheetRangeCovered, type SheetGridEvidence } from './sheets.js';

export const sheetQueryBodyLimit = 64000;
const resultLimit = 96000, regexCostLimit = 2000000;
function fail(status: number, code: string): never {
  throw new OAuthError(status, code, 'A consulta da planilha não pôde ser concluída. Revise os parâmetros, limites e autorização.');
}
const variableName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
const scalar = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: z.string().max(2000) }).strict(),
  z.object({ kind: z.literal('variable'), name: variableName }).strict(),
]);
const variable = z.discriminatedUnion('type', [
  z.object({ name: variableName, type: z.literal('text'), value: z.string().max(2000) }).strict(),
  z.object({ name: variableName, type: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ name: variableName, type: z.literal('boolean'), value: z.boolean() }).strict(),
]);
const column = z.string().min(1).max(256);
const comparison = z.object({ column, op: z.enum(['eq', 'ne', 'gt']), value: scalar }).strict();
const inclusion = z.object({ column, op: z.literal('in'), values: z.array(scalar).min(1).max(50) }).strict();
const regex = z.object({ column, op: z.literal('regex'), pattern: z.string().min(1).max(256), flags: z.enum(['', 'i']) }).strict();
const requestSchema = z.object({
  expectedTenantId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), expectedRevision: z.number().int().positive().safe(),
  sheetTitle: z.string().min(1).max(100).refine(v => !/[\u0000-\u001f]/.test(v)), scanRange: z.string(), headers: z.boolean(),
  filters: z.array(z.unknown()).max(12), variables: z.array(z.unknown()).max(20), maxRows: z.number().int().min(1).max(1000).default(50),
}).strict();
type TestFilter = { column: string; regex: boolean; accepts: (value: string) => boolean };
export function prepareSheetQuery(input: unknown) {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > sheetQueryBodyLimit) fail(413, 'sheet_query_limit');
  const parsed = requestSchema.safeParse(input); if (!parsed.success) return fail(400, 'invalid_sheets_query');
  const data = parsed.data;
  if (!data.headers && (data.filters.length || data.variables.length)) fail(400, 'invalid_sheets_query');
  if (!/^[A-Za-z]{1,3}[1-9][0-9]{0,6}:[A-Za-z]{1,3}[1-9][0-9]{0,6}$/.test(data.scanRange)) fail(400, 'sheet_range_limit');
  const range = sheetRectangle({ sheetTitle: data.sheetTitle, range: data.scanRange });
  const start = /^([A-Z]+)([0-9]+):/.exec(data.scanRange.toUpperCase())!;
  const firstRow = Number(start[2]), firstColumn = [...start[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  if (data.headers && (firstRow !== 1 || range.rows < 2)) fail(400, 'sheet_range_limit');
  const variables = new Map<string, string>(), used = new Set<string>();
  for (const raw of data.variables) {
    const item = variable.safeParse(raw); if (!item.success || variables.has(item.data.name)) fail(400, 'sheet_query_variable_invalid');
    variables.set(item.data.name, String(item.data.value));
  }
  const resolve = (ref: z.infer<typeof scalar>) => {
    if (ref.kind === 'literal') return ref.value;
    if (!variables.has(ref.name)) return fail(400, 'sheet_query_variable_invalid');
    used.add(ref.name); return variables.get(ref.name)!;
  };
  let regexCount = 0;
  const filters: TestFilter[] = data.filters.map(raw => {
    if (raw && typeof raw === 'object' && 'op' in raw && raw.op === 'regex') {
      const parsed = regex.safeParse(raw); if (!parsed.success) return fail(400, 'sheet_query_regex_invalid');
      if (++regexCount > 4) fail(413, 'sheet_query_limit');
      let compiled: RE2JS;
      try { compiled = RE2JS.compile(parsed.data.pattern, parsed.data.flags === 'i' ? RE2JS.CASE_INSENSITIVE : 0); }
      catch { return fail(400, 'sheet_query_regex_invalid'); }
      if (compiled.programSize() > 1000) fail(413, 'sheet_query_limit');
      return { column: parsed.data.column, regex: true, accepts: value => compiled.test(value) };
    }
    const parsed = z.union([comparison, inclusion]).safeParse(raw); if (!parsed.success) return fail(400, 'invalid_sheets_query');
    const f = parsed.data;
    if (f.op === 'in') { const accepted = new Set(f.values.map(resolve)); return { column: f.column, regex: false, accepts: value => accepted.has(value) }; }
    const expected = resolve(f.value);
    return { column: f.column, regex: false, accepts: value => f.op === 'eq' ? value === expected : f.op === 'ne' ? value !== expected : value > expected };
  });
  if (used.size !== variables.size) fail(400, 'sheet_query_variable_invalid');
  return { data, range, filters, firstRow, firstColumn };
}
type PreparedQuery = ReturnType<typeof prepareSheetQuery>;
function columnName(index: number) { let value = ''; for (; index > 0; index = Math.floor((index - 1) / 26)) value = String.fromCharCode(65 + (index - 1) % 26) + value; return value; }
export function evaluateSheetQuery(query: PreparedQuery, response: unknown, gridEvidence?: SheetGridEvidence) {
  const parsed = z.object({ range: z.string(), majorDimension: z.literal('ROWS').optional(), values: z.array(z.array(z.string()).max(query.range.columns)).max(query.range.rows).default([]) }).safeParse(response);
  if (!parsed.success || !formattedSheetRangeCovered(query.range.a1, parsed.data.range, gridEvidence)) return fail(502, 'provider_response_invalid');
  const actual = formattedSheetRange(parsed.data.range)!;
  if (parsed.data.values.length > actual.rows || parsed.data.values.some(row => row.length > actual.columns)) return fail(502, 'provider_response_invalid');
  const { data, range, firstRow, firstColumn } = query;
  const matrix = Array.from({ length: range.rows }, (_, r) => Array.from({ length: range.columns }, (_, c) => parsed.data.values[r]?.[c] ?? ''));
  const headers = new Map<string, number>();
  if (data.headers) for (const [i, value] of matrix[0].entries()) {
    if (!value.trim() || value.length > 256 || headers.has(value)) fail(422, 'sheet_query_headers_invalid');
    headers.set(value, i);
  }
  const filters = query.filters.map(f => { const index = headers.get(f.column); if (index === undefined) return fail(422, 'sheet_query_column_not_found'); return { ...f, index }; });
  const offset = data.headers ? 1 : 0;
  let cost = 0;
  for (const f of filters) if (f.regex) for (let r = offset; r < matrix.length; r++) { cost += matrix[r][f.index].length; if (cost > regexCostLimit) fail(413, 'sheet_query_limit'); }
  const columns = Array.from({ length: range.columns }, (_, c) => ({ index: firstColumn + c, a1: columnName(firstColumn + c), header: data.headers ? matrix[0][c] : null }));
  const rows: { rowNumber: number; cells: string[] }[] = [];
  let bytes = Buffer.byteLength(JSON.stringify({ columns, rows })), nonEmptyRows = 0, matchedRows = 0, byteLimited = false;
  for (let i = offset; i < matrix.length; i++) {
    const cells = matrix[i]; if (cells.every(value => value === '')) continue;
    nonEmptyRows++; if (!filters.every(filter => filter.accepts(cells[filter.index]))) continue;
    matchedRows++; if (matchedRows > data.maxRows || byteLimited) continue;
    const row = { rowNumber: firstRow + i, cells }, addition = Buffer.byteLength(JSON.stringify(row)) + (rows.length ? 1 : 0);
    if (bytes + addition > resultLimit) { if (!rows.length) fail(413, 'sheet_query_limit'); byteLimited = true; continue; }
    rows.push(row); bytes += addition;
  }
  const truncationReasons: ('max_rows' | 'result_bytes')[] = [];
  if (matchedRows > data.maxRows) truncationReasons.push('max_rows');
  if (byteLimited) truncationReasons.push('result_bytes');
  return { columns, rows, coverage: { scope: 'requested_range' as const, completeWithinRange: true as const, wholeSheet: 'unknown' as const, examinedRows: range.rows - offset, nonEmptyRows, matchedRows, returnedRows: rows.length }, limits: { maxRows: data.maxRows, resultBytes: resultLimit }, resultBytes: bytes, truncationReasons };
}

export async function querySpreadsheet(store: Store, actor: Actor, connectionId: string, bindingId: string, query: PreparedQuery, assertAccess: () => void) {
  assertAccess(); if (query.data.expectedTenantId !== actor.tenantId) fail(409, 'tenant_mismatch');
  const read = await readFormattedSheetRectangle(store, actor, connectionId, bindingId, { sheetTitle: query.data.sheetTitle, range: query.data.scanRange }, assertAccess, query.data.expectedRevision);
  read.assertCurrent(); const result = evaluateSheetQuery(query, read.response, read.gridEvidence); read.assertCurrent();
  return { source: 'google_sheets' as const, dataSource: 'untrusted_spreadsheet_content' as const, connectionId, bindingId, bindingRevision: read.bindingRevision, sheetTitle: query.data.sheetTitle, scanRange: query.data.scanRange.toUpperCase(), requestedRange: query.range.a1, valueRenderOption: 'FORMATTED_VALUE' as const, headers: query.data.headers, queriedAt: new Date().toISOString(), ...result };
}
