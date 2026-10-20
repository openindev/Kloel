import type { ImportBundle, ImportData, ImportDefinition } from './crm-import'

export const CRM_IMPORT_MAX_BYTES = 2 * 1024 * 1024
export class CRMImportFileError extends Error {
  constructor(readonly code: string, message: string, readonly details?: { fields?: string[]; line?: number; column?: number }) { super(message) }
  get line() { return this.details?.line }
}
function fail(message: string, code = 'invalid_import_file', details?: ConstructorParameters<typeof CRMImportFileError>[2]): never { throw new CRMImportFileError(code, message, details) }
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x)
const id = (x: unknown) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x)
const keys = (x: Record<string, unknown>, allowed: string[]) => { if (Object.keys(x).some(key => !allowed.includes(key))) fail('O arquivo contém campos não reconhecidos pelo formato de importação.') }
const text = (x: unknown, max: number, min = 0) => typeof x === 'string' && x.length >= min && x.length <= max
const revision = (x: unknown) => Number.isSafeInteger(x) && Number(x) > 0
const choices = <T>(x: T, allowed: readonly T[]) => allowed.includes(x)
export function assertImportBytes(value: string) {
  if (new TextEncoder().encode(value).byteLength > CRM_IMPORT_MAX_BYTES) fail('O arquivo excede o limite de 2 MiB.', 'import_too_large')
  if (value.includes('\0')) fail('O arquivo contém caracteres nulos. Use texto UTF-8.')
}
export function decodeText(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  if (bytes.byteLength > CRM_IMPORT_MAX_BYTES) fail('O arquivo excede o limite de 2 MiB.', 'import_too_large')
  let decoded: string
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return fail('Não foi possível ler o arquivo como UTF-8.', 'invalid_encoding') }
  assertImportBytes(decoded); return decoded.replace(/^\uFEFF/, '')
}
function definition(raw: unknown): asserts raw is ImportDefinition {
  if (!object(raw)) fail('Definição de campo inválida.')
  keys(raw, ['id', 'revision', 'key', 'label', 'type', 'description', 'status', 'aiFill', 'options', 'example', 'showInList', 'findHint', 'keepUpdated', 'updateWhen'])
  if (raw.id !== undefined && !id(raw.id) || raw.revision !== undefined && !revision(raw.revision)
    || !text(raw.key, 80, 1) || !/^[a-z][a-z0-9_]*$/.test(raw.key) || ['__proto__', 'constructor', 'prototype'].includes(raw.key)
    || !text(raw.label, 100, 1) || !raw.label.trim() || !choices(raw.type, ['text', 'number', 'boolean', 'choice'])
    || raw.description !== undefined && !text(raw.description, 2000) || raw.status !== undefined && !choices(raw.status, ['active', 'archived'])
    || raw.aiFill !== undefined && typeof raw.aiFill !== 'boolean' || raw.example !== undefined && !text(raw.example, 1000)
    || raw.showInList !== undefined && typeof raw.showInList !== 'boolean'
    || raw.findHint !== undefined && !text(raw.findHint, 2000) || raw.keepUpdated !== undefined && typeof raw.keepUpdated !== 'boolean' || raw.updateWhen !== undefined && !text(raw.updateWhen, 500)) fail('Definição de campo inválida.')
  if (raw.options !== undefined && (!Array.isArray(raw.options) || raw.options.length > 100)) fail('Opções do campo inválidas.')
  for (const option of raw.options ?? []) {
    if (!object(option)) fail('Opção de campo inválida.')
    keys(option, ['id', 'label', 'status'])
    if (option.id !== undefined && !id(option.id) || !text(option.label, 100, 1) || !option.label.trim() || option.status !== undefined && !choices(option.status, ['active', 'archived'])) fail('Opção de campo inválida.')
  }
}
function data(raw: unknown): asserts raw is ImportData {
  if (!object(raw)) fail('Dados de contato inválidos.')
  keys(raw, ['firstName', 'lastName', 'displayName', 'nameMode', 'phones', 'emails', 'primaryPhoneId', 'primaryEmailId', 'company', 'notes', 'tags', 'timezone', 'ownerMembershipId', 'fieldValues'])
  for (const [field, max] of Object.entries({ firstName: 200, lastName: 200, displayName: 400, company: 200, notes: 20000, timezone: 100 })) if (raw[field] !== undefined && !text(raw[field], max)) fail(`O campo ${field} é inválido.`)
  if (raw.nameMode !== undefined && !choices(raw.nameMode, ['structured', 'custom'])) fail('Modo do nome inválido.')
  for (const field of ['primaryPhoneId', 'primaryEmailId', 'ownerMembershipId']) if (raw[field] !== undefined && raw[field] !== null && !id(raw[field])) fail('Identificador de contato inválido.')
  for (const field of ['phones', 'emails']) {
    if (raw[field] !== undefined && (!Array.isArray(raw[field]) || raw[field].length > 20)) fail('Use no máximo 20 telefones ou e-mails por contato.')
    for (const entry of raw[field] ?? []) {
      if (!object(entry)) fail('Telefone ou e-mail inválido.')
      keys(entry, ['id', 'value', 'label'])
      if (!text(entry.value, 254, 1) || entry.id !== undefined && !id(entry.id) || entry.label !== undefined && !choices(entry.label, ['', 'HOME', 'WORK', 'OTHER'])) fail('Telefone ou e-mail inválido.')
    }
  }
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.length > 50 || raw.tags.some((tag: unknown) => !text(tag, 80, 1)))) fail('Marcadores inválidos.')
  if (raw.fieldValues !== undefined && (!object(raw.fieldValues) || Object.keys(raw.fieldValues).length > 100 || Object.entries(raw.fieldValues).some(([key, value]) => ['__proto__', 'constructor', 'prototype'].includes(key) || value !== null && typeof value !== 'boolean' && !text(value, 10000)))) fail('Valores de campos inteligentes inválidos.')
}
/** Preserve exact property presence. Defaults belong to the server, not the file reader. */
export function validateImportBundle(raw: unknown): ImportBundle {
  if (!object(raw)) fail('Use um arquivo kloel.contacts na versão 2.')
  keys(raw, ['format', 'version', 'definitions', 'contacts'])
  if (raw.format !== 'kloel.contacts' || raw.version !== 2 || !Array.isArray(raw.definitions) || raw.definitions.length > 100 || !Array.isArray(raw.contacts) || raw.contacts.length > 2000) fail('Use o formato kloel.contacts v2, com até 100 definições e 2.000 contatos.')
  raw.definitions.forEach(definition)
  for (const row of raw.contacts) {
    if (!object(row)) fail('Linha de contato inválida.')
    keys(row, ['sourceId', 'revision', 'data', 'legacyData'])
    if (row.sourceId !== undefined && !id(row.sourceId) || row.revision !== undefined && !revision(row.revision) || row.legacyData !== undefined && !object(row.legacyData)) fail('Referência de contato inválida.')
    data(row.data)
  }
  assertImportBytes(JSON.stringify(raw)); return raw as ImportBundle
}
export function parseJSON(source: string, options: { disableAiFill?: boolean } = {}): { bundle: ImportBundle; disabledAiFill: string[] } {
  assertImportBytes(source); let raw: unknown
  try { raw = JSON.parse(source.replace(/^\uFEFF/, '')) } catch { return fail('O arquivo não contém JSON válido.', 'invalid_json') }
  const bundle = validateImportBundle(raw), fields = bundle.definitions.filter(field => field.aiFill === true).map(field => field.label)
  if (fields.length && !options.disableAiFill) fail('Confirme a importação dessas definições com o preenchimento por IA desativado.', 'ai_fill_confirmation_required', { fields })
  if (fields.length) bundle.definitions = bundle.definitions.map(field => field.aiFill === true ? { ...field, aiFill: false } : field)
  return { bundle, disabledAiFill: fields }
}
export type CSVDelimiter = ',' | ';' | '\t'
export type CSVTable = { headers: string[]; rows: string[][] }
export type CSVTarget = 'firstName' | 'lastName' | 'displayName' | 'company' | 'notes' | 'timezone' | 'email' | 'phone'
export type CsvMapping = Array<{ column: number; target: CSVTarget } | { column: number; target: 'field'; definition: ImportDefinition }>
export function parseCSV(source: string, delimiter: CSVDelimiter = ','): CSVTable {
  assertImportBytes(source); if (![',', ';', '\t'].includes(delimiter)) fail('Separador CSV inválido.')
  source = source.replace(/^\uFEFF/, ''); const all: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false
  const pushCell = () => { row.push(cell); cell = ''; closed = false; if (row.length > 100) fail('Use até 100 colunas no CSV.') }
  const pushRow = () => { pushCell(); all.push(row); row = []; if (all.length > 2001) fail('Use até 2.000 contatos no CSV.', 'import_too_large') }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) { if (char === '"') { if (source[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } } else cell += char; continue }
    if (char === delimiter) { pushCell(); continue }
    if (char === '\n' || char === '\r') { if (char === '\r' && source[i + 1] === '\n') i++; pushRow(); continue }
    if (closed) fail('Há texto fora das aspas de uma célula CSV.', 'invalid_csv', { line: all.length + 1, column: row.length + 1 })
    if (char === '"') { if (cell) fail('Aspas inválidas em uma célula CSV.', 'invalid_csv', { line: all.length + 1, column: row.length + 1 }); quoted = true } else cell += char
  }
  if (quoted) fail('Há uma célula CSV com aspas não fechadas.', 'invalid_csv')
  if (cell || row.length || closed) pushRow()
  if (!all.length || all[0].every(value => !value.trim())) fail('O CSV precisa de uma linha de cabeçalhos.', 'invalid_csv')
  const [headers, ...rows] = all
  rows.forEach((values, index) => { if (values.length !== headers.length) fail('A quantidade de colunas não corresponde aos cabeçalhos.', 'invalid_csv', { line: index + 2 }) })
  return { headers, rows }
}
export function mapCSV(table: CSVTable, mapping: CsvMapping): ImportBundle {
  if (!Array.isArray(mapping) || !mapping.length || mapping.length > 100 || !Array.isArray(table.headers) || table.headers.length > 100 || !Array.isArray(table.rows) || table.rows.length > 2000) fail('Revise o mapeamento das colunas CSV.')
  const columns = new Set<number>(), targets = new Set<string>(), definitions: ImportDefinition[] = []
  for (const item of mapping) {
    if (!Number.isSafeInteger(item.column) || item.column < 0 || item.column >= table.headers.length || columns.has(item.column)) fail('Cada coluna só pode ser mapeada uma vez.')
    columns.add(item.column)
    const target = item.target === 'field' ? `field:${item.definition?.key}` : item.target
    if (targets.has(target) && !['phone', 'email'].includes(target)) fail('Não mapeie duas colunas para o mesmo campo.')
    targets.add(target)
    if (item.target === 'field') { definition(item.definition); if (item.definition.id && ['__proto__', 'constructor', 'prototype'].includes(item.definition.id)) fail('Identificador de campo inválido.'); if (item.definition.aiFill || item.definition.status === 'archived') fail('Mapeie somente campos ativos com IA desativada.'); definitions.push(structuredClone({ ...item.definition, aiFill: false })) }
    else if (!['firstName', 'lastName', 'displayName', 'company', 'notes', 'timezone', 'email', 'phone'].includes(item.target)) fail('Destino de coluna inválido.')
  }
  const contacts: ImportBundle['contacts'] = []
  table.rows.forEach((values, index) => {
    if (!Array.isArray(values) || values.length !== table.headers.length || values.some(value => typeof value !== 'string')) fail('Quantidade de colunas inválida.', 'invalid_csv', { line: index + 2 })
    const record: ImportData = {}
    for (const item of mapping) {
      const raw = values[item.column], trimmed = raw.trim(); if (!trimmed) continue
      if (item.target === 'phone' || item.target === 'email') { const field = item.target === 'phone' ? 'phones' : 'emails'; (record[field] ??= []).push({ value: trimmed }); continue }
      if (item.target !== 'field') { (record as Record<string, unknown>)[item.target] = item.target === 'notes' ? raw : trimmed; continue }
      const field = item.definition; let value: string | boolean = trimmed
      const invalid = () => fail(`Valor incompatível com o campo ${field.label}.`, 'invalid_csv_field', { line: index + 2, column: item.column + 1 })
      if (field.type === 'boolean') { const normalized = trimmed.toLocaleLowerCase('pt-BR'); if (['true', 'sim'].includes(normalized)) value = true; else if (['false', 'não', 'nao'].includes(normalized)) value = false; else invalid() }
      else if (field.type === 'number') { if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(trimmed) || trimmed.replace(/\D/g, '').length > 38) invalid() }
      else if (field.type === 'choice') { const matches = (field.options ?? []).filter(option => option.status !== 'archived' && (option.label === trimmed || option.id === trimmed)); if (matches.length !== 1 || !matches[0].id) invalid(); value = matches[0].id! }
      ;(record.fieldValues ??= {})[field.id ?? field.key] = value
    }
    if (Object.keys(record).length) contacts.push({ data: record })
  })
  return validateImportBundle({ format: 'kloel.contacts', version: 2, definitions, contacts })
}
