import { EngineError } from './http'
import type { EngineContext } from './session'
import { accountClient } from './account'
import { sheetRange } from './sheets'
import { sheetQueryInput, sheetQueryRange, type SheetFilter } from './sheets-query'

export type ActionInput = { name: string; type: 'text' | 'number' | 'boolean' }
export type ActionCell = { kind: 'literal'; value: string | number | boolean } | { kind: 'variable'; name: string }
export type ActionQuery = { sheetTitle: string; inputDefinitions: ActionInput[]; scanRange: string; headers: true; filters: SheetFilter[]; expectedHeaders: string[]; returnColumns: string[]; maxRows: number }
export type ActionAppend = { sheetTitle: string; inputDefinitions: ActionInput[]; range: string; row: ActionCell[] }
export type ActionConfiguration = ActionQuery | ActionAppend
export type SheetAction = { id: string; agentId: string; connectionId: string; bindingId: string; bindingRevision: number; kind: 'query' | 'append'; name: string; description: string; enabled: boolean; revision: number; configuration: ActionConfiguration; readiness: { available: boolean; reasonCode: string | null }; createdAt: string; updatedAt: string }
export type ActionPolicy = { expiresInDays: number; maxCallsPerConversation: number; maxCallsPerDay: number; acknowledgePublicDisclosure: true; authorizeDelegatedAppend?: true }
export type ActionGrant = { id: string; actionId: string; channelId: string; revision: number; status: 'active' | 'revoked' | 'expired' | 'needs_reauthorization'; expiresAt: number; mode: 'disclose_query' | 'delegated_append'; policy: ActionPolicy }
export type ActionKind = 'action.create' | 'action.update' | 'action.set_enabled' | 'grant.create' | 'grant.revoke'
export type ActionAttempt = { key: string; kind: ActionKind; agentId: string; actionId?: string; expectedRevision?: number; connectionId?: string; bindingId?: string; expectedBindingRevision?: number; actionKind?: 'query' | 'append'; enabled?: boolean; channelId?: string; expectedChannelVersion?: string; previousGrant?: { id: string; revision: number } | null; grantId?: string }
export type ActionReceipt = { key: string; kind: ActionKind; status: 'succeeded'; actionId: string; grantId: string | null; resultRevision: number; replayed: boolean; automaticRetry: false }
export type ActionPreview = { ok: true; kind: 'query'; actionId: string; actionRevision: number; columns: { index: number; a1: string; header: string }[]; rows: { rowNumber: number; cells: string[] }[]; coverage: { scope: 'requested_range'; completeWithinRange: true; wholeSheet: 'unknown'; examinedRows: number; nonEmptyRows: number; matchedRows: number; returnedRows: number }; truncationReasons: ('max_rows' | 'result_bytes')[]; queriedAt: string; source: 'untrusted_spreadsheet_content' }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k))
const text = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length >= min && v.length <= max
export const actionId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const revision = (v: unknown): v is number => natural(v) && v > 0 && v < Number.MAX_SAFE_INTEGER
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))
export const actionColumnIndex = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
export function actionColumnName(n: number) { let s = ''; for (; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s }
function invalid(message = 'A ação de planilha retornou dados incompatíveis.'): never { throw new EngineError(0, 'invalid_sheet_action_data', message) }
export function actionConfiguration(kind: SheetAction['kind'], raw: unknown): ActionConfiguration {
  if (!object(raw) || !Array.isArray(raw.inputDefinitions) || raw.inputDefinitions.length > 20 || !text(raw.sheetTitle, 1, 100) || /[\u0000-\u001f]/.test(raw.sheetTitle)) invalid('Confira a aba, variáveis e configuração da ação.')
  const names = new Set<string>()
  for (const v of raw.inputDefinitions) { if (!object(v) || !only(v, ['name', 'type']) || !text(v.name, 1, 64) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(v.name) || names.has(v.name) || !['text', 'number', 'boolean'].includes(v.type)) invalid('Use nomes únicos de variáveis e tipos válidos.'); names.add(v.name) }
  if (kind === 'query') {
    if (!only(raw, ['sheetTitle', 'inputDefinitions', 'scanRange', 'headers', 'filters', 'expectedHeaders', 'returnColumns', 'maxRows']) || raw.headers !== true || !revision(raw.maxRows) || raw.maxRows > 50) invalid()
    const q = sheetQueryInput({ sheetTitle: raw.sheetTitle, scanRange: raw.scanRange, headers: true, filters: raw.filters, maxRows: raw.maxRows, variables: raw.inputDefinitions.map((v: ActionInput) => ({ ...v, value: v.type === 'text' ? '' : v.type === 'number' ? 0 : false })) }), r = sheetQueryRange(q.scanRange)
    if (!Array.isArray(raw.expectedHeaders) || raw.expectedHeaders.length !== r.columns || raw.expectedHeaders.some((h: unknown) => !text(h, 1, 256) || !h.trim()) || new Set(raw.expectedHeaders).size !== r.columns || !Array.isArray(raw.returnColumns) || !raw.returnColumns.length || raw.returnColumns.length > r.columns || new Set(raw.returnColumns).size !== raw.returnColumns.length || raw.returnColumns.some((c: unknown) => !text(c, 1, 3) || !/^[A-Z]+$/.test(c) || actionColumnIndex(c) < r.start.col || actionColumnIndex(c) > r.end.col) || q.filters.some(f => !raw.expectedHeaders.includes(f.column))) invalid('Informe todos os cabeçalhos exatos e selecione somente as colunas que podem ser divulgadas.')
    return { sheetTitle: q.sheetTitle, inputDefinitions: structuredClone(raw.inputDefinitions), scanRange: q.scanRange, headers: true, filters: q.filters, expectedHeaders: [...raw.expectedHeaders], returnColumns: [...raw.returnColumns], maxRows: q.maxRows }
  }
  if (kind !== 'append' || !only(raw, ['sheetTitle', 'inputDefinitions', 'range', 'row']) || !Array.isArray(raw.row)) invalid()
  const r = sheetRange({ sheetTitle: raw.sheetTitle, range: raw.range }), used = new Set<string>()
  if (raw.row.length !== r.columns) invalid('A linha deve preencher exatamente a largura configurada.')
  for (const c of raw.row) {
    if (!object(c)) invalid()
    if (c.kind === 'variable' && only(c, ['kind', 'name']) && names.has(c.name)) used.add(c.name)
    else if (!(c.kind === 'literal' && only(c, ['kind', 'value']) && (text(c.value, 0, 2000) || typeof c.value === 'boolean' || typeof c.value === 'number' && Number.isFinite(c.value)))) invalid('Confira os valores da linha e suas variáveis.')
  }
  if (used.size !== names.size) invalid('Cada variável declarada deve ser usada na linha.')
  return { sheetTitle: r.sheetTitle, range: r.range, inputDefinitions: structuredClone(raw.inputDefinitions), row: structuredClone(raw.row) }
}
export function actionVariables(config: ActionConfiguration, raw: unknown): Record<string, string | number | boolean> {
  if (!object(raw) || Object.keys(raw).length !== config.inputDefinitions.length) invalid('Preencha todas as variáveis de teste.')
  const result = Object.create(null) as Record<string, string | number | boolean>
  for (const v of config.inputDefinitions) { const value = Object.hasOwn(raw, v.name) ? raw[v.name] : undefined; if (v.type === 'text' ? !text(value, 0, 2000) : v.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'boolean') invalid('Confira os tipos das variáveis.'); result[v.name] = value }
  return result
}
export function parseSheetAction(raw: unknown, agentId: string): SheetAction {
  if (!object(raw) || !only(raw, ['id', 'agentId', 'connectionId', 'bindingId', 'bindingRevision', 'kind', 'name', 'description', 'enabled', 'revision', 'configuration', 'readiness', 'createdAt', 'updatedAt']) || !actionId(raw.id) || raw.agentId !== agentId || !actionId(raw.connectionId) || !actionId(raw.bindingId) || !revision(raw.bindingRevision) || !['query', 'append'].includes(raw.kind) || !text(raw.name, 1, 120) || !text(raw.description, 1, 1000) || typeof raw.enabled !== 'boolean' || !revision(raw.revision) || !date(raw.createdAt) || !date(raw.updatedAt) || !object(raw.readiness) || !only(raw.readiness, ['available', 'reasonCode']) || typeof raw.readiness.available !== 'boolean' || raw.readiness.reasonCode !== null && !(typeof raw.readiness.reasonCode === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(raw.readiness.reasonCode)) || raw.readiness.available && (!raw.enabled || raw.readiness.reasonCode !== null)) invalid()
  return { id: raw.id, agentId, connectionId: raw.connectionId, bindingId: raw.bindingId, bindingRevision: raw.bindingRevision, kind: raw.kind, name: raw.name, description: raw.description, enabled: raw.enabled, revision: raw.revision, configuration: actionConfiguration(raw.kind, raw.configuration), readiness: { available: raw.readiness.available, reasonCode: raw.readiness.reasonCode }, createdAt: raw.createdAt, updatedAt: raw.updatedAt }
}
export function actionPolicy(raw: unknown, kind: SheetAction['kind']): ActionPolicy {
  if (!object(raw) || !only(raw, ['expiresInDays', 'maxCallsPerConversation', 'maxCallsPerDay', 'acknowledgePublicDisclosure', 'authorizeDelegatedAppend']) || !revision(raw.expiresInDays) || raw.expiresInDays > 30 || !revision(raw.maxCallsPerConversation) || raw.maxCallsPerConversation > 20 || !revision(raw.maxCallsPerDay) || raw.maxCallsPerDay > 100 || raw.acknowledgePublicDisclosure !== true || raw.authorizeDelegatedAppend !== undefined && raw.authorizeDelegatedAppend !== true || kind === 'append' && (raw.maxCallsPerConversation !== 1 || raw.authorizeDelegatedAppend !== true)) invalid('Confirme a divulgação, os limites e a autorização de registro quando aplicável.')
  return { expiresInDays: raw.expiresInDays, maxCallsPerConversation: raw.maxCallsPerConversation, maxCallsPerDay: raw.maxCallsPerDay, acknowledgePublicDisclosure: true, ...(raw.authorizeDelegatedAppend === true ? { authorizeDelegatedAppend: true as const } : {}) }
}
export function parseActionGrant(raw: unknown, action: SheetAction): ActionGrant {
  if (!object(raw) || !only(raw, ['id', 'actionId', 'channelId', 'revision', 'status', 'expiresAt', 'mode', 'policy']) || !actionId(raw.id) || raw.actionId !== action.id || !actionId(raw.channelId) || !revision(raw.revision) || !['active', 'revoked', 'expired', 'needs_reauthorization'].includes(raw.status) || !natural(raw.expiresAt) || !Number.isFinite(new Date(raw.expiresAt).getTime()) || raw.mode !== (action.kind === 'query' ? 'disclose_query' : 'delegated_append')) invalid()
  return { id: raw.id, actionId: raw.actionId, channelId: raw.channelId, revision: raw.revision, status: raw.status, expiresAt: raw.expiresAt, mode: raw.mode, policy: actionPolicy(raw.policy, action.kind) }
}
export function validActionAttempt(raw: unknown): raw is ActionAttempt {
  if (!object(raw) || !text(raw.key, 8, 128) || !/^[A-Za-z0-9_-]+$/.test(raw.key) || !actionId(raw.agentId)) return false
  const common = ['key', 'kind', 'agentId'], withAction = [...common, 'actionId', 'expectedRevision']
  if (raw.kind === 'action.create') return only(raw, [...common, 'connectionId', 'bindingId', 'expectedBindingRevision', 'actionKind']) && ['query', 'append'].includes(raw.actionKind) && actionId(raw.connectionId) && actionId(raw.bindingId) && revision(raw.expectedBindingRevision)
  if (!actionId(raw.actionId) || !revision(raw.expectedRevision)) return false
  if (raw.kind === 'action.update') return only(raw, [...withAction, 'expectedBindingRevision', 'actionKind']) && ['query', 'append'].includes(raw.actionKind) && revision(raw.expectedBindingRevision)
  if (raw.kind === 'action.set_enabled') return only(raw, [...withAction, 'enabled']) && typeof raw.enabled === 'boolean'
  if (raw.kind === 'grant.revoke') return only(raw, [...withAction, 'grantId']) && actionId(raw.grantId)
  return raw.kind === 'grant.create' && only(raw, [...withAction, 'channelId', 'expectedChannelVersion', 'previousGrant']) && actionId(raw.channelId) && typeof raw.expectedChannelVersion === 'string' && /^[a-f0-9]{64}$/.test(raw.expectedChannelVersion) && (raw.previousGrant === null || object(raw.previousGrant) && only(raw.previousGrant, ['id', 'revision']) && actionId(raw.previousGrant.id) && revision(raw.previousGrant.revision))
}
export function parseActionReceipt(raw: unknown, a: ActionAttempt): ActionReceipt {
  if (!validActionAttempt(a) || !object(raw) || !only(raw, ['key', 'kind', 'status', 'actionId', 'grantId', 'resultRevision', 'replayed', 'automaticRetry']) || raw.key !== a.key || raw.kind !== a.kind || raw.status !== 'succeeded' || !actionId(raw.actionId) || a.actionId !== undefined && raw.actionId !== a.actionId || !revision(raw.resultRevision) || typeof raw.replayed !== 'boolean' || raw.automaticRetry !== false || (a.kind === 'grant.create' ? !actionId(raw.grantId) : a.kind === 'grant.revoke' ? raw.grantId !== a.grantId : raw.grantId !== null) || raw.resultRevision !== (['action.create', 'grant.create'].includes(a.kind) ? 1 : a.expectedRevision! + 1)) invalid('O recibo não corresponde à intenção original.')
  return { key: raw.key, kind: raw.kind, status: 'succeeded', actionId: raw.actionId, grantId: raw.grantId, resultRevision: raw.resultRevision, replayed: raw.replayed, automaticRetry: false }
}
export function parseActionPreview(raw: unknown, action: SheetAction): ActionPreview {
  if (action.kind !== 'query') invalid()
  const q = action.configuration as ActionQuery, range = sheetQueryRange(q.scanRange)
  if (!object(raw) || !only(raw, ['ok', 'kind', 'actionId', 'actionRevision', 'columns', 'rows', 'coverage', 'truncationReasons', 'queriedAt', 'source']) || raw.ok !== true || raw.kind !== 'query' || raw.actionId !== action.id || raw.actionRevision !== action.revision || raw.source !== 'untrusted_spreadsheet_content' || !date(raw.queriedAt) || !Array.isArray(raw.columns) || raw.columns.length !== q.returnColumns.length || !Array.isArray(raw.rows) || raw.rows.length > q.maxRows) invalid()
  for (const [i, c] of raw.columns.entries()) if (!object(c) || !only(c, ['index', 'a1', 'header']) || c.a1 !== q.returnColumns[i] || c.index !== actionColumnIndex(c.a1) || c.header !== q.expectedHeaders[c.index - range.start.col]) invalid()
  let prior = 1
  for (const row of raw.rows) { if (!object(row) || !only(row, ['rowNumber', 'cells']) || !natural(row.rowNumber) || row.rowNumber <= prior || row.rowNumber > range.end.row || !Array.isArray(row.cells) || row.cells.length !== q.returnColumns.length || row.cells.some((c: unknown) => typeof c !== 'string')) invalid(); prior = row.rowNumber }
  const c = raw.coverage
  if (!object(c) || !only(c, ['scope', 'completeWithinRange', 'wholeSheet', 'examinedRows', 'nonEmptyRows', 'matchedRows', 'returnedRows']) || c.scope !== 'requested_range' || c.completeWithinRange !== true || c.wholeSheet !== 'unknown' || c.examinedRows !== range.rows - 1 || ![c.nonEmptyRows, c.matchedRows, c.returnedRows].every(natural) || c.nonEmptyRows > c.examinedRows || c.matchedRows > c.nonEmptyRows || c.returnedRows > c.matchedRows || c.returnedRows !== raw.rows.length || new TextEncoder().encode(JSON.stringify({ columns: raw.columns, rows: raw.rows })).length > 96000 || !Array.isArray(raw.truncationReasons) || JSON.stringify(raw.truncationReasons) !== JSON.stringify([...(c.matchedRows > q.maxRows ? ['max_rows'] : []), ...(c.returnedRows < Math.min(c.matchedRows, q.maxRows) ? ['result_bytes'] : [])])) invalid()
  return structuredClone(raw) as ActionPreview
}
export function createSheetActionsService(context: EngineContext, agentId: string, userId: string) {
  if (!actionId(agentId)) invalid()
  const base = `/agents/${agentId}/sheets-actions`, account = accountClient(context, userId)
  async function list(signal?: AbortSignal) { context.assertCurrent(); const raw = await context.request<any>(base, { signal }); context.assertCurrent(); signal?.throwIfAborted(); if (!object(raw) || !only(raw, ['items']) || !Array.isArray(raw.items)) invalid(); const rows = raw.items.map((r: unknown) => parseSheetAction(r, agentId)); if (new Set(rows.map(r => r.id)).size !== rows.length) invalid(); return rows }
  function attempt(a: ActionAttempt) { context.assertCurrent(); if (!validActionAttempt(a) || a.agentId !== agentId) invalid() }
  async function send(a: ActionAttempt, method: 'POST' | 'PUT' | 'PATCH', path: string, body: object) { attempt(a); const raw = await context.request(path, { method, idempotencyKey: a.key, body: { expectedTenantId: context.tenantId, ...body } }); context.assertCurrent(); return parseActionReceipt(raw, a) }
  return {
    list,
    async grants(action: SheetAction, signal?: AbortSignal) { context.assertCurrent(); const snapshot = parseSheetAction(action, agentId), raw = await context.request<any>(`${base}/${snapshot.id}/grants`, { signal }); context.assertCurrent(); signal?.throwIfAborted(); if (!object(raw) || !only(raw, ['items']) || !Array.isArray(raw.items)) invalid(); const result = raw.items.map((g: unknown) => parseActionGrant(g, snapshot)); if (new Set(result.map(g => g.id)).size !== result.length) invalid(); return result },
    configure(a: ActionAttempt, kind: SheetAction['kind'], name: string, description: string, config: ActionConfiguration) { attempt(a); if (!['action.create', 'action.update'].includes(a.kind) || a.actionKind !== kind || !name.trim() || name.length > 120 || !description.trim() || description.length > 1000) invalid('Informe nome e descrição para o assistente.'); const configuration = { name: name.trim(), description: description.trim(), ...actionConfiguration(kind, config) }; return send(a, a.kind === 'action.create' ? 'POST' : 'PUT', base + (a.actionId ? `/${a.actionId}` : ''), { expectedBindingRevision: a.expectedBindingRevision, ...(a.kind === 'action.create' ? { configuration: { ...configuration, kind, connectionId: a.connectionId, bindingId: a.bindingId } } : { expectedRevision: a.expectedRevision, configuration }) }) },
    setEnabled(a: ActionAttempt) { attempt(a); if (a.kind !== 'action.set_enabled') invalid(); return send(a, 'PATCH', `${base}/${a.actionId}`, { expectedRevision: a.expectedRevision, enabled: a.enabled }) },
    grant(a: ActionAttempt, policy: ActionPolicy, kind: SheetAction['kind']) { attempt(a); if (a.kind !== 'grant.create') invalid(); return send(a, 'POST', `${base}/${a.actionId}/grants`, { expectedActionRevision: a.expectedRevision, expectedChannelVersion: a.expectedChannelVersion, channelId: a.channelId, previousGrant: a.previousGrant, policy: actionPolicy(policy, kind) }) },
    revoke(a: ActionAttempt) { attempt(a); if (a.kind !== 'grant.revoke') invalid(); return send(a, 'POST', `${base}/${a.actionId}/grants/${a.grantId}/revoke`, { expectedRevision: a.expectedRevision }) },
    async operation(a: ActionAttempt) { attempt(a); const raw = await context.request(`/oauth/sheets/action-operations/${a.key}`); context.assertCurrent(); return parseActionReceipt(raw, a) },
    async preview(action: SheetAction, variables: unknown, signal?: AbortSignal) {
      context.assertCurrent(); signal?.throwIfAborted(); const snapshot = parseSheetAction(action, agentId); if (snapshot.kind !== 'query') invalid()
      const values = actionVariables(snapshot.configuration, variables), before = (await account.connections(signal)).find(c => c.id === snapshot.connectionId)
      if (!before || before.provider !== 'google' || before.status !== 'connected' || !before.capabilities.includes('sheets_read')) invalid('A conexão não permite consulta.')
      context.assertCurrent(); signal?.throwIfAborted()
      const raw = await context.request(`${base}/${snapshot.id}/preview`, { method: 'POST', body: { expectedTenantId: context.tenantId, expectedRevision: snapshot.revision, variables: values }, signal })
      signal?.throwIfAborted(); const current = (await list(signal)).find(a => a.id === snapshot.id), after = (await account.connections(signal)).find(c => c.id === snapshot.connectionId)
      context.assertCurrent(); signal?.throwIfAborted()
      if (JSON.stringify(current) !== JSON.stringify(snapshot) || JSON.stringify(after) !== JSON.stringify(before)) throw new EngineError(409, 'sheet_action_changed', 'A ação ou autorização mudou. O resultado foi descartado; revise a configuração explicitamente.')
      return parseActionPreview(raw, snapshot)
    },
  }
}
