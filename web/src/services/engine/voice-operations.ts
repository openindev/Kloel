import { EngineError } from './http'
import type { EngineContext } from './session'
import { parseBeforeVoiceMetadata, type BeforeVoiceMetadata } from './before-voice'

export interface VoiceOperationFilters { agentId?: string; conversationId?: string }
export interface RecoveredVoiceOperation {
  operationKey: string; agentId: string; status: 'pending' | 'succeeded' | 'failed' | 'unknown'
  callId?: string; conversationId?: string; cancelRequested: boolean
  hangupStatus: 'not_requested' | 'pending' | 'accepted' | 'rejected' | 'unknown'
  stopReason?: string; errorCode?: string; leaseExpiresAt: string; heartbeatIntervalMs: number
  createdAt: string; updatedAt: string; beforeContext?: BeforeVoiceMetadata
}
export interface VoiceOperationsPage { items: RecoveredVoiceOperation[]; nextCursor: string | null; limit: number }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function invalid(): never { throw new EngineError(0, 'invalid_voice_operation', 'O registro da chamada recebido é inválido. Nenhuma chamada será repetida.') }
function identifier(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) invalid(); return value }
function date(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) invalid(); return value }
function cursor(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{1,4096}$/.test(value)) invalid(); return value }
function parse(raw: unknown, filters: Readonly<VoiceOperationFilters>, previous?: RecoveredVoiceOperation): RecoveredVoiceOperation {
  if (!object(raw) || typeof raw.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(raw.operationKey)
    || typeof raw.status !== 'string' || !['pending', 'succeeded', 'failed', 'unknown'].includes(raw.status) || typeof raw.cancelRequested !== 'boolean'
    || typeof raw.hangupStatus !== 'string' || !['not_requested', 'pending', 'accepted', 'rejected', 'unknown'].includes(raw.hangupStatus)
    || !Number.isSafeInteger(raw.heartbeatIntervalMs) || Number(raw.heartbeatIntervalMs) < 1 || Number(raw.heartbeatIntervalMs) > 60000) invalid()
  const result: RecoveredVoiceOperation = { operationKey: raw.operationKey, agentId: identifier(raw.agentId), status: raw.status as RecoveredVoiceOperation['status'],
    cancelRequested: raw.cancelRequested, hangupStatus: raw.hangupStatus as RecoveredVoiceOperation['hangupStatus'],
    leaseExpiresAt: date(raw.leaseExpiresAt), heartbeatIntervalMs: Number(raw.heartbeatIntervalMs), createdAt: date(raw.createdAt), updatedAt: date(raw.updatedAt) }
  for (const name of ['callId', 'conversationId'] as const) if (raw[name] !== undefined) result[name] = identifier(raw[name])
  for (const name of ['stopReason', 'errorCode'] as const) if (raw[name] !== undefined) {
    if (typeof raw[name] !== 'string' || !/^[a-z0-9_]{1,80}$/.test(raw[name])) invalid()
    result[name] = raw[name]
  }
  if (filters.agentId && result.agentId !== filters.agentId || filters.conversationId && result.conversationId !== filters.conversationId) invalid()
  if (previous && (result.operationKey !== previous.operationKey || result.agentId !== previous.agentId || result.createdAt !== previous.createdAt
    || previous.callId && result.callId !== previous.callId || previous.conversationId && result.conversationId !== previous.conversationId
    || previous.cancelRequested && !result.cancelRequested || previous.hangupStatus === 'accepted' && result.hangupStatus !== 'accepted')) invalid()
  if (raw.beforeContext !== undefined) result.beforeContext = parseBeforeVoiceMetadata(raw.beforeContext, previous?.beforeContext)
  else if (previous?.beforeContext) invalid()
  return result
}

/** Recovery has no start or heartbeat method: it cannot create media or extend a lease. */
export function createVoiceOperationsService(context: EngineContext, filters: VoiceOperationFilters = {}) {
  const scope = Object.freeze({ ...(filters.agentId !== undefined ? { agentId: identifier(filters.agentId) } : {}), ...(filters.conversationId !== undefined ? { conversationId: identifier(filters.conversationId) } : {}) })
  const path = (operation: RecoveredVoiceOperation) => {
    parse(operation, scope)
    return '/ai/realtime/operations/' + encodeURIComponent(operation.operationKey)
  }
  return {
    async list(options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<VoiceOperationsPage> {
      const limit = options.limit ?? 20
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid()
      const raw: unknown = await context.request('/ai/realtime/operations', { query: { ...scope, limit, ...(options.cursor ? { cursor: cursor(options.cursor) } : {}) }, signal: options.signal })
      context.assertCurrent()
      if (!object(raw) || !Array.isArray(raw.items) || raw.items.length > limit || raw.limit !== limit || raw.nextCursor !== null && typeof raw.nextCursor !== 'string') invalid()
      const items = raw.items.map(item => parse(item, scope)), keys = new Set(items.map(item => item.operationKey))
      if (keys.size !== items.length) invalid()
      const nextCursor = raw.nextCursor === null ? null : cursor(raw.nextCursor)
      if (options.cursor && nextCursor === options.cursor) invalid()
      return { items, nextCursor, limit }
    },
    async get(operation: RecoveredVoiceOperation): Promise<RecoveredVoiceOperation> {
      const raw = await context.request(path(operation)); context.assertCurrent(); return parse(raw, scope, operation)
    },
    async cancel(operation: RecoveredVoiceOperation): Promise<RecoveredVoiceOperation> {
      const target = path(operation)
      if (operation.cancelRequested || operation.hangupStatus !== 'not_requested' || operation.status === 'failed' && !operation.callId) throw new EngineError(0, 'voice_cancel_not_needed', 'Consulte o estado desta operação; nenhum novo pedido de encerramento é necessário.')
      const raw = await context.request(target + '/cancel', { method: 'POST', body: {}, timeoutMs: 30000 })
      context.assertCurrent(); return parse(raw, scope, operation)
    },
  }
}
