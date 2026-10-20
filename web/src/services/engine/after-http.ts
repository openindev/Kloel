import { EngineError } from './http'
import type { EngineContext } from './session'

export type AfterHttpConfiguration = { enabled: boolean; actionId: string | null }
export type AfterHttpAction = { id: string; name: string; template: 'custom_http' | 'n8n' | 'make' | 'zapier'; targetOrigin: string; method: 'POST'; revision: number }
export type AfterHttpConfig = { agentId: string; revision: number; configuration: AfterHttpConfiguration; authorization: { state: 'disabled' | 'active' | 'revoked'; reasonCode: string | null }; action: AfterHttpAction | null; eligibleActions: AfterHttpAction[] }
export type AfterHttpAttempt = { kind: 'after_http.configure'; key: string; agentId: string; expectedRevision: number }
export type AfterHttpConfigOperation = { key: string; kind: 'after_http.configure'; tenantId: string; agentId: string; expectedRevision: number; revision: number; status: 'succeeded'; createdAt: string; automaticRetry: false }
export type AfterHttpJob = { id: string; conversationId: string; agentId: string; closureId: string; epoch: number; configRevision: number; actionId: string; actionRevision: number; status: 'queued' | 'running' | 'skipped' | 'not_sent' | 'unknown' | 'endpoint_acknowledged'; reasonCode: string | null; closedAt: string; messageCount: number; startedAt: string | null; attemptedAt: string | null; completedAt: string | null; httpStatus: number | null; integrationOperationId: string | null; dispatchCount: 0 | 1; automaticRetry: false; workflowCompletion: 'not_verified' }
export type AfterHttpPage = { items: AfterHttpJob[]; cursor: string | null; hasMore: boolean }
export type AfterHttpDetail = { operation: AfterHttpJob; integrationOperation: null | { id: string; actionId: string; revision: number; status: 'pending' | 'not_sent' | 'uncertain' | 'endpoint_acknowledged'; httpStatus: number | null; errorCode: string | null; attempts: number; createdAt: string; updatedAt: string; requiresReconciliation: boolean; automaticRetry: false } }

export const afterHttpId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, any>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const integer = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v))
const code = (v: unknown) => v === null || typeof v === 'string' && /^[a-z][a-z0-9_]{0,99}$/.test(v)
const httpStatus = (v: unknown) => v === null || integer(v, 100) && v <= 599
const acknowledged = (v: number | null) => v !== null && v >= 200 && v <= 299
function invalid(message = 'Resposta de HTTP pós-conversa incompatível. Preserve a referência e consulte novamente.'): never { throw new EngineError(0, 'invalid_after_http', message) }
export function parseAfterHttpConfiguration(raw: unknown): AfterHttpConfiguration {
  if (!object(raw) || !exact(raw, ['enabled', 'actionId']) || typeof raw.enabled !== 'boolean' || raw.actionId !== null && !afterHttpId(raw.actionId) || raw.enabled && raw.actionId === null) invalid('Selecione uma ação válida para habilitar o envio HTTP.')
  return structuredClone(raw) as AfterHttpConfiguration
}
export function validAfterHttpAttempt(a: unknown): a is AfterHttpAttempt {
  return object(a) && exact(a, ['kind', 'key', 'agentId', 'expectedRevision']) && a.kind === 'after_http.configure' && afterHttpId(a.key) && afterHttpId(a.agentId) && integer(a.expectedRevision) && a.expectedRevision < Number.MAX_SAFE_INTEGER
}
function parseAction(a: unknown): AfterHttpAction {
  if (!object(a) || !exact(a, ['id', 'name', 'template', 'targetOrigin', 'method', 'revision']) || !afterHttpId(a.id) || typeof a.name !== 'string' || !a.name.trim() || !['custom_http', 'n8n', 'make', 'zapier'].includes(a.template) || a.method !== 'POST' || !integer(a.revision, 1) || typeof a.targetOrigin !== 'string') invalid()
  try { const url = new URL(a.targetOrigin); if (url.protocol !== 'https:' || url.origin !== a.targetOrigin || url.username || url.password) invalid() } catch { invalid() }
  return structuredClone(a) as AfterHttpAction
}
export function parseAfterHttpConfig(raw: unknown, agentId: string): AfterHttpConfig {
  if (!afterHttpId(agentId) || !object(raw) || !exact(raw, ['agentId', 'revision', 'configuration', 'authorization', 'action', 'eligibleActions']) || raw.agentId !== agentId || !integer(raw.revision) || !object(raw.authorization) || !exact(raw.authorization, ['state', 'reasonCode']) || !['disabled', 'active', 'revoked'].includes(raw.authorization.state) || !code(raw.authorization.reasonCode) || !Array.isArray(raw.eligibleActions)) invalid()
  const configuration = parseAfterHttpConfiguration(raw.configuration), action = raw.action === null ? null : parseAction(raw.action), eligibleActions = raw.eligibleActions.map(parseAction)
  if (new Set(eligibleActions.map(a => a.id)).size !== eligibleActions.length || action && action.id !== configuration.actionId || !configuration.enabled && raw.authorization.state !== 'disabled' || configuration.enabled && raw.authorization.state === 'disabled') invalid()
  return { agentId, revision: raw.revision, configuration, authorization: structuredClone(raw.authorization), action, eligibleActions } as AfterHttpConfig
}
export function parseAfterHttpConfigOperation(raw: unknown, a: AfterHttpAttempt, tenantId: string): AfterHttpConfigOperation {
  if (!validAfterHttpAttempt(a) || (typeof tenantId !== 'string' || !tenantId) || !object(raw) || !exact(raw, ['key', 'kind', 'tenantId', 'agentId', 'expectedRevision', 'revision', 'status', 'createdAt', 'automaticRetry']) || raw.kind !== a.kind || raw.key !== a.key || raw.tenantId !== tenantId || raw.agentId !== a.agentId || raw.expectedRevision !== a.expectedRevision || !integer(raw.revision, 1) || raw.revision !== a.expectedRevision + 1 || raw.status !== 'succeeded' || !date(raw.createdAt) || raw.automaticRetry !== false) invalid()
  return structuredClone(raw) as AfterHttpConfigOperation
}
export function parseAfterHttpJob(raw: unknown, conversationId: string): AfterHttpJob {
  if (!afterHttpId(conversationId) || !object(raw) || !exact(raw, ['id', 'conversationId', 'agentId', 'closureId', 'epoch', 'configRevision', 'actionId', 'actionRevision', 'status', 'reasonCode', 'closedAt', 'messageCount', 'startedAt', 'attemptedAt', 'completedAt', 'httpStatus', 'integrationOperationId', 'dispatchCount', 'automaticRetry', 'workflowCompletion']) || !['id', 'agentId', 'closureId', 'actionId'].every(k => afterHttpId(raw[k])) || raw.conversationId !== conversationId || !['epoch', 'configRevision', 'actionRevision'].every(k => integer(raw[k], 1)) || !integer(raw.messageCount) || !['queued', 'running', 'skipped', 'not_sent', 'unknown', 'endpoint_acknowledged'].includes(raw.status) || !code(raw.reasonCode) || !date(raw.closedAt) || !['startedAt', 'attemptedAt', 'completedAt'].every(k => raw[k] === null || date(raw[k])) || !httpStatus(raw.httpStatus) || raw.integrationOperationId !== null && !afterHttpId(raw.integrationOperationId) || ![0, 1].includes(raw.dispatchCount) || raw.automaticRetry !== false || raw.workflowCompletion !== 'not_verified' || raw.status === 'endpoint_acknowledged' && !acknowledged(raw.httpStatus)) invalid()
  return structuredClone(raw) as AfterHttpJob
}
export function parseAfterHttpPage(raw: unknown, conversationId: string, requestedCursor: string | null = null): AfterHttpPage {
  if (!object(raw) || !exact(raw, ['items', 'cursor', 'hasMore']) || !Array.isArray(raw.items) || raw.items.length > 20 || typeof raw.hasMore !== 'boolean' || raw.cursor !== null && !afterHttpId(raw.cursor) || raw.hasMore && !raw.items.length) invalid()
  const items = raw.items.map(v => parseAfterHttpJob(v, conversationId)); let previous = Infinity
  for (const item of items) { if (item.epoch >= previous || item.id === requestedCursor) invalid(); previous = item.epoch }
  if (new Set(items.map(v => v.id)).size !== items.length || raw.cursor !== (items.at(-1)?.id ?? requestedCursor)) invalid()
  return { items, cursor: raw.cursor, hasMore: raw.hasMore }
}
export function parseAfterHttpDetail(raw: unknown, expected: Pick<AfterHttpJob, 'id' | 'conversationId' | 'agentId' | 'closureId' | 'epoch' | 'configRevision' | 'actionId' | 'actionRevision'>): AfterHttpDetail {
  if (!object(raw) || !exact(raw, ['operation', 'integrationOperation'])) invalid()
  const operation = parseAfterHttpJob(raw.operation, expected.conversationId)
  for (const k of ['id', 'agentId', 'closureId', 'epoch', 'configRevision', 'actionId', 'actionRevision'] as const) if (operation[k] !== expected[k]) invalid()
  const r = raw.integrationOperation
  if (r === null) { if (operation.integrationOperationId !== null) invalid() }
  else if (!object(r) || !exact(r, ['id', 'actionId', 'revision', 'status', 'httpStatus', 'errorCode', 'attempts', 'createdAt', 'updatedAt', 'requiresReconciliation', 'automaticRetry']) || r.id !== operation.integrationOperationId || r.actionId !== operation.actionId || r.revision !== operation.actionRevision || !['pending', 'not_sent', 'uncertain', 'endpoint_acknowledged'].includes(r.status) || !httpStatus(r.httpStatus) || !code(r.errorCode) || !integer(r.attempts) || !date(r.createdAt) || !date(r.updatedAt) || typeof r.requiresReconciliation !== 'boolean' || r.automaticRetry !== false || r.status === 'endpoint_acknowledged' && !acknowledged(r.httpStatus)) invalid()
  return { operation, integrationOperation: structuredClone(r) } as AfterHttpDetail
}
export function createAfterHttpService(context: EngineContext) {
  async function request(path: string, options?: Parameters<EngineContext['request']>[1]): Promise<any> { context.assertCurrent(); const r = await context.request(path, options); context.assertCurrent(); options?.signal?.throwIfAborted(); return r }
  return {
    async config(agentId: string, signal?: AbortSignal) { if (!afterHttpId(agentId)) invalid(); return parseAfterHttpConfig(await request(`/agents/${agentId}/after-http`, { signal }), agentId) },
    async configure(a: AfterHttpAttempt, input: AfterHttpConfiguration, expectedActionRevision: number | null, externalSendAcknowledged: boolean) {
      if (!validAfterHttpAttempt(a)) invalid()
      const configuration = parseAfterHttpConfiguration(input)
      if (configuration.enabled ? !integer(expectedActionRevision, 1) || externalSendAcknowledged !== true : expectedActionRevision !== null || externalSendAcknowledged !== false) invalid('Revise a ação e confirme o envio externo antes de habilitar.')
      const raw = await request(`/agents/${a.agentId}/after-http`, { method: 'PUT', body: { expectedTenantId: context.tenantId, expectedRevision: a.expectedRevision, idempotencyKey: a.key, configuration, expectedActionRevision, externalSendAcknowledged } })
      if (!object(raw) || !exact(raw, ['operation', 'replayed']) || typeof raw.replayed !== 'boolean') invalid()
      return parseAfterHttpConfigOperation(raw.operation, a, context.tenantId)
    },
    async operation(a: AfterHttpAttempt) { if (!validAfterHttpAttempt(a)) invalid(); return parseAfterHttpConfigOperation(await request(`/after-http/config-operations/${a.key}`), a, context.tenantId) },
    async history(conversationId: string, cursor?: string, signal?: AbortSignal) { if (!afterHttpId(conversationId) || cursor !== undefined && !afterHttpId(cursor)) invalid(); return parseAfterHttpPage(await request(`/conversations/${conversationId}/after-http-operations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }), conversationId, cursor ?? null) },
    async detail(expected: AfterHttpJob, signal?: AbortSignal) { parseAfterHttpJob(expected, expected.conversationId); return parseAfterHttpDetail(await request(`/after-http/operations/${expected.id}`, { signal }), expected) },
  }
}
