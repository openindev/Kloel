import { parseCalendlyChoices, type CalendlyChoice } from './calendly'
import { EngineError } from './http'
import type { EngineContext } from './session'
import { parseBookingChoices, type BookingChoice } from './assistant-booking'
import { parseBeforeVoiceIntent, parseBeforeVoiceMetadata, type BeforeVoiceIntent, type BeforeVoiceMetadata } from './before-voice'

export interface SheetAppendOperation { kind: 'append'; operationRef: string; status: 'pending' | 'appended' | 'not_sent' | 'uncertain'; rowsAppended: 1 | null; requiresReconciliation: boolean; automaticRetry: false }
export interface AgentChatResult { conversationId: string; responseId: string; text: string; usage: Record<string, unknown>; sheetOperations: SheetAppendOperation[]; bookingChoices: BookingChoice[]; calendlyChoices?: CalendlyChoice[] }
export type OperationStatus = 'pending' | 'succeeded' | 'failed' | 'unknown'
export interface ChatOperation { status: OperationStatus; errorCode?: string; result?: AgentChatResult; sheetOperations: SheetAppendOperation[] }
export interface VoiceOperation { status: OperationStatus; operationKey: string; callId?: string; conversationId?: string; cancelRequested?: boolean; hangupStatus?: 'not_requested' | 'pending' | 'accepted' | 'rejected' | 'unknown'; leaseExpiresAt?: string; requiresRecovery?: boolean; beforeContext?: BeforeVoiceMetadata }
export interface VoiceStart extends VoiceOperation { sdp: string; callId: string; conversationId: string; toolsEnabled: string[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function invalid(): never { throw new EngineError(0, 'invalid_response', 'O resultado do teste recebido é inválido. Consulte o estado antes de repetir.') }
const identifier = (value: string) => { if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) invalid(); return value }
// The browser creates UUIDs; deliberately keep keys safe for the shared HTTP path allowlist.
const operationKey = (value: string) => { if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) invalid(); return value }
export function parseSheetAppendOperation(raw: unknown, expectedRef?: string): SheetAppendOperation {
  if (!object(raw) || Object.keys(raw).some(k => !['kind', 'operationRef', 'status', 'rowsAppended', 'requiresReconciliation', 'automaticRetry'].includes(k)) || raw.kind !== 'append' || typeof raw.operationRef !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw.operationRef) || expectedRef && raw.operationRef !== expectedRef || !['pending', 'appended', 'not_sent', 'uncertain'].includes(String(raw.status)) || raw.automaticRetry !== false) invalid()
  const appended = raw.status === 'appended', unresolved = raw.status === 'pending' || raw.status === 'uncertain'
  if (raw.rowsAppended !== (appended ? 1 : null) || raw.requiresReconciliation !== unresolved) invalid()
  return { kind: 'append', operationRef: raw.operationRef, status: raw.status as SheetAppendOperation['status'], rowsAppended: appended ? 1 : null, requiresReconciliation: unresolved, automaticRetry: false }
}
function sheetOperations(raw: unknown): SheetAppendOperation[] {
  if (raw === undefined) return [] // Older chat results have no Sheets actions.
  if (!Array.isArray(raw) || raw.length > 20) invalid()
  const result = raw.map(value => parseSheetAppendOperation(value))
  if (new Set(result.map(item => item.operationRef)).size !== result.length) invalid()
  return result
}
function chatResult(raw: unknown, key: string): AgentChatResult {
  if (!object(raw) || typeof raw.conversationId !== 'string' || typeof raw.responseId !== 'string' || !raw.responseId.length || raw.responseId.length > 200 || typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 200000 || !object(raw.usage)) invalid()
  return { conversationId: identifier(raw.conversationId), responseId: raw.responseId, text: raw.text, usage: raw.usage, sheetOperations: sheetOperations(raw.sheetOperations), bookingChoices: parseBookingChoices(raw.bookingChoices, { conversationId: raw.conversationId, chatOperationKey: key }), ...(raw.calendlyChoices === undefined ? {} : { calendlyChoices: parseCalendlyChoices(raw.calendlyChoices, { conversationId: raw.conversationId, chatOperationKey: key }) }) }
}
function status(raw: unknown): OperationStatus {
  if (typeof raw !== 'string' || !['pending', 'succeeded', 'failed', 'unknown'].includes(raw)) invalid()
  return raw as OperationStatus
}
function voiceOperation(raw: unknown, key: string): VoiceOperation {
  if (!object(raw) || raw.operationKey !== key) invalid()
  const result: VoiceOperation = { status: status(raw.status), operationKey: key }
  for (const name of ['callId', 'conversationId'] as const) if (raw[name] !== undefined) { if (typeof raw[name] !== 'string') invalid(); result[name] = identifier(raw[name]) }
  if (raw.cancelRequested !== undefined) { if (typeof raw.cancelRequested !== 'boolean') invalid(); result.cancelRequested = raw.cancelRequested }
  if (raw.requiresRecovery !== undefined) { if (typeof raw.requiresRecovery !== 'boolean') invalid(); result.requiresRecovery = raw.requiresRecovery }
  if (raw.hangupStatus !== undefined) { if (!['not_requested', 'pending', 'accepted', 'rejected', 'unknown'].includes(String(raw.hangupStatus))) invalid(); result.hangupStatus = raw.hangupStatus as VoiceOperation['hangupStatus'] }
  if (raw.leaseExpiresAt !== undefined) { if (typeof raw.leaseExpiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(raw.leaseExpiresAt) || !Number.isFinite(Date.parse(raw.leaseExpiresAt))) invalid(); result.leaseExpiresAt = raw.leaseExpiresAt }
  if (raw.beforeContext !== undefined) result.beforeContext = parseBeforeVoiceMetadata(raw.beforeContext)
  return result
}
export function createAgentTestService(context: EngineContext, agentId: string) {
  identifier(agentId)
  return {
    async chat(message: string, key: string, conversationId?: string, options?: { webSearch?: boolean }) {
      if (!message.trim() || message.length > 20000) throw new EngineError(0, 'invalid_input', 'Escreva uma mensagem de até 20 mil caracteres.')
      const raw = await context.request('/ai/chat', { method: 'POST', body: { agentId, preview: true, message: message.trim(), idempotencyKey: operationKey(key), ...(options?.webSearch === undefined ? {} : { webSearch: options.webSearch }), ...(conversationId ? { conversationId: identifier(conversationId) } : {}) }, timeoutMs: 60000 })
      context.assertCurrent(); const result = chatResult(raw, key)
      if (conversationId && result.conversationId !== conversationId) invalid()
      return result
    },
    async chatOperation(key: string, conversationId?: string): Promise<ChatOperation> {
      if (conversationId) identifier(conversationId)
      const raw: unknown = await context.request('/ai/chat/operations/' + encodeURIComponent(operationKey(key)))
      context.assertCurrent(); if (!object(raw)) invalid()
      const state = status(raw.status)
      if (raw.errorCode !== undefined && typeof raw.errorCode !== 'string') invalid()
      const result = state === 'succeeded' ? chatResult(raw.result, key) : undefined
      if (conversationId && result && result.conversationId !== conversationId) invalid()
      return { status: state, sheetOperations: result?.sheetOperations ?? sheetOperations(raw.sheetOperations), ...(typeof raw.errorCode === 'string' ? { errorCode: raw.errorCode } : {}), ...(result ? { result } : {}) }
    },
    async chatSheetOperations(key: string): Promise<SheetAppendOperation[]> {
      const raw: unknown = await context.request('/oauth/sheets/chat-operations/' + encodeURIComponent(operationKey(key)))
      context.assertCurrent(); if (!object(raw) || Object.keys(raw).some(k => k !== 'sheetOperations') || !Array.isArray(raw.sheetOperations)) invalid()
      return sheetOperations(raw.sheetOperations)
    },
    async sheetOperation(reference: string): Promise<SheetAppendOperation> {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reference)) invalid()
      const raw = await context.request('/oauth/sheets/action-executions/' + reference)
      context.assertCurrent(); return parseSheetAppendOperation(raw, reference)
    },
    async startVoice(sdp: string, key: string, before?: BeforeVoiceIntent): Promise<VoiceStart | VoiceOperation> {
      if (!sdp.startsWith('v=0') || sdp.length < 10 || sdp.length > 100000) invalid()
      const beforeContext = before === undefined ? undefined : parseBeforeVoiceIntent(before)
      context.assertCurrent()
      const raw: unknown = await context.request('/ai/realtime/session', { method: 'POST', body: { agentId, preview: true, sdp, idempotencyKey: operationKey(key), ...(beforeContext ? { beforeContext } : {}) }, timeoutMs: 60000 })
      context.assertCurrent(); const operation = voiceOperation(raw, key)
      if (beforeContext) parseBeforeVoiceMetadata(operation.beforeContext, undefined, beforeContext)
      if (operation.requiresRecovery) return operation
      if (operation.status !== 'succeeded' || !object(raw) || typeof raw.sdp !== 'string' || !raw.sdp.startsWith('v=0') || raw.sdp.length > 100000 || !operation.callId || !operation.conversationId || !Array.isArray(raw.toolsEnabled) || raw.toolsEnabled.some(tool => typeof tool !== 'string')) invalid()
      return { ...operation, callId: operation.callId, conversationId: operation.conversationId, sdp: raw.sdp, toolsEnabled: raw.toolsEnabled as string[] }
    },
    async activateVoice(key: string, openingId: string) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(openingId)) invalid()
      context.assertCurrent()
      const raw = await context.request('/ai/realtime/operations/' + encodeURIComponent(operationKey(key)) + '/activate', { method: 'POST', body: { expectedTenantId: context.tenantId, openingId, confirm: true }, timeoutMs: 30000 })
      context.assertCurrent(); const operation = voiceOperation(raw, key)
      if (operation.beforeContext?.openingId !== openingId) invalid()
      return operation
    },
    async voiceOperation(key: string) {
      const raw = await context.request('/ai/realtime/operations/' + encodeURIComponent(operationKey(key))); context.assertCurrent(); return voiceOperation(raw, key)
    },
    async cancelVoice(key: string) {
      const raw = await context.request('/ai/realtime/operations/' + encodeURIComponent(operationKey(key)) + '/cancel', { method: 'POST', body: {}, timeoutMs: 30000 }); context.assertCurrent(); return voiceOperation(raw, key)
    },
    async heartbeatVoice(key: string) {
      const raw = await context.request('/ai/realtime/operations/' + encodeURIComponent(operationKey(key)) + '/heartbeat', { method: 'POST', body: {}, timeoutMs: 15000 }); context.assertCurrent(); return voiceOperation(raw, key)
    },
  }
}
export type AgentTestService = ReturnType<typeof createAgentTestService>
