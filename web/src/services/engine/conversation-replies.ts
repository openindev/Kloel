import { EngineError } from './http'
import type { EngineContext } from './session'
import type { ConversationChannel } from './conversations'

export type ReplyMode = 'ai' | 'human' | 'closed'
export type ReplyKind = 'takeover' | 'release' | 'reply'
export type ReplyReason = 'unsupported_channel' | 'conversation_closed' | 'channel_unavailable' | 'session_unavailable' | 'agent_paused' | 'no_ai' | 'forbidden' | null
export interface ReplyContext {
  conversationId: string; tenantId: string; channel: ConversationChannel; version: string; mode: ReplyMode
  capabilities: { takeover: boolean; release: boolean; reply: boolean }; reasonCode: ReplyReason
  delivery: 'available_in_chat'; maxLength: number
}
export interface ReplyOperation {
  key: string; conversationId: string; tenantId: string; kind: ReplyKind
  status: 'pending' | 'succeeded' | 'failed' | 'unknown'; automaticRetry: false
  result?: { version: string; mode: ReplyMode; messageId?: string; delivery?: 'available_in_chat' }
}
export interface ReplyReference { key: string; conversationId: string; kind: ReplyKind; expectedVersion: string }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const kinds: ReplyKind[] = ['takeover', 'release', 'reply']
const modes: ReplyMode[] = ['ai', 'human', 'closed']
const reasons: ReplyReason[] = ['unsupported_channel', 'conversation_closed', 'channel_unavailable', 'session_unavailable', 'agent_paused', 'no_ai', 'forbidden', null]
function invalid(): never { throw new EngineError(0, 'invalid_reply_response', 'Não foi possível confirmar o atendimento desta conversa.') }
function id(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid(); return value }
function key(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) invalid(); return value }
function version(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(); return value }
function mode(value: unknown): ReplyMode { if (!modes.includes(value as ReplyMode)) invalid(); return value as ReplyMode }
function kind(value: unknown): ReplyKind { if (!kinds.includes(value as ReplyKind)) invalid(); return value as ReplyKind }
function parseContext(raw: unknown, tenantId: string, conversationId: string): ReplyContext {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || !['webchat', 'whatsapp', 'phone', 'email'].includes(String(raw.channel)) || !object(raw.capabilities) || !reasons.includes(raw.reasonCode as ReplyReason) || raw.delivery !== 'available_in_chat' || !Number.isSafeInteger(raw.maxLength) || Number(raw.maxLength) < 1 || Number(raw.maxLength) > 4000) invalid()
  const capabilities = { takeover: raw.capabilities.takeover, release: raw.capabilities.release, reply: raw.capabilities.reply }
  if (Object.values(capabilities).some(value => typeof value !== 'boolean') || raw.channel !== 'webchat' && Object.values(capabilities).some(Boolean) || raw.mode === 'closed' && Object.values(capabilities).some(Boolean)) invalid()
  return { conversationId, tenantId, channel: raw.channel as ConversationChannel, version: version(raw.version), mode: mode(raw.mode), capabilities: capabilities as ReplyContext['capabilities'], reasonCode: raw.reasonCode as ReplyReason, delivery: 'available_in_chat', maxLength: raw.maxLength as number }
}
function parseOperation(raw: unknown, tenantId: string, conversationId: string, operationKey: string, expectedKind?: ReplyKind): ReplyOperation {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || raw.key !== operationKey || !['pending', 'succeeded', 'failed', 'unknown'].includes(String(raw.status)) || raw.automaticRetry !== false) invalid()
  const operationKind = kind(raw.kind)
  if (expectedKind && operationKind !== expectedKind) invalid()
  let result: ReplyOperation['result']
  if (raw.result !== undefined) {
    if (!object(raw.result) || raw.status !== 'succeeded') invalid()
    result = { version: version(raw.result.version), mode: mode(raw.result.mode) }
    if (operationKind === 'reply') { if (raw.result.delivery !== 'available_in_chat') invalid(); result.messageId = id(raw.result.messageId); result.delivery = 'available_in_chat' }
    else if (raw.result.messageId !== undefined || raw.result.delivery !== undefined) invalid()
  }
  if (raw.status === 'succeeded' && !result) invalid()
  return { tenantId, conversationId, key: operationKey, kind: operationKind, status: raw.status as ReplyOperation['status'], automaticRetry: false, ...(result ? { result } : {}) }
}
export class ReplyWriteUncertain extends EngineError { constructor() { super(0, 'reply_outcome_unknown', 'O resultado não foi confirmado. Consulte a operação original antes de continuar.') } }
export function replyErrorMessage(error: unknown): string {
  const messages: Record<string, string> = {
    conversation_changed: 'A conversa mudou. Atualize o atendimento antes de preparar outra alteração.',
    tenant_mismatch: 'Sua sessão mudou de organização. Atualize a página antes de continuar.',
    conversation_closed: 'Esta conversa foi encerrada. Não é possível responder ao visitante.',
    human_handoff_required: 'Assuma o atendimento antes de responder ao visitante.',
    chat_unavailable: 'O chat não está disponível para este atendimento.', session_unavailable: 'A sessão do visitante não está mais disponível.',
    forbidden: 'Seu papel não permite esta ação.', idempotency_conflict: 'Esta chave já está vinculada a outros dados. Consulte a operação original.',
    reply_outcome_unknown: 'O resultado não foi confirmado. A solicitação não será repetida automaticamente.',
    reply_storage_unavailable: 'Não foi possível guardar o identificador nesta aba. Nenhuma nova solicitação foi enviada.',
  }
  if (error instanceof EngineError && messages[error.code]) return messages[error.code]
  if (error instanceof EngineError && error.status === 404) return 'A operação não está disponível para esta autorização. Nenhuma repetição foi realizada.'
  if (error instanceof EngineError && error.status === 401) return 'Entre novamente na sua conta para consultar o resultado.'
  return 'Não foi possível confirmar o atendimento. Atualize o estado antes de continuar.'
}
export function createConversationReplyService(context: EngineContext) {
  return {
    async context(conversationId: string, signal?: AbortSignal) {
      context.assertCurrent(); const raw = await context.request(`/conversations/${id(conversationId)}/reply-context`, { signal }); context.assertCurrent()
      return parseContext(raw, context.tenantId, conversationId)
    },
    async command(reference: ReplyReference, content?: string) {
      const operationKind = kind(reference.kind), conversationId = id(reference.conversationId), operationKey = key(reference.key), expectedVersion = version(reference.expectedVersion)
      if (operationKind === 'reply' && (typeof content !== 'string' || !content.trim() || content.trim().length > 4000) || operationKind !== 'reply' && content !== undefined) invalid()
      context.assertCurrent()
      try {
        const raw = await context.request(`/conversations/${conversationId}/${operationKind === 'reply' ? 'replies' : operationKind}`, { method: 'POST', body: { expectedTenantId: context.tenantId, expectedVersion, idempotencyKey: operationKey, ...(operationKind === 'reply' ? { content: content!.trim() } : {}) } })
        context.assertCurrent(); return parseOperation(raw, context.tenantId, conversationId, operationKey, operationKind)
      } catch (error) { if (error instanceof EngineError && error.status > 0 && error.status < 500) throw error; throw new ReplyWriteUncertain() }
    },
    async operation(reference: ReplyReference) {
      context.assertCurrent(); const raw = await context.request(`/conversations/${id(reference.conversationId)}/reply-operations/${key(reference.key)}`); context.assertCurrent()
      return parseOperation(raw, context.tenantId, reference.conversationId, reference.key, reference.kind)
    },
  }
}
export function createReplyOperationStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: { userId: string; tenantId: string; conversationId: string }) {
  const storageKey = `kloel:conversation-reply:v1:${id(scope.userId)}:${id(scope.tenantId)}:${id(scope.conversationId)}`, historyKey = storageKey + ':history'
  const parse = (raw: unknown): ReplyReference => { if (!object(raw) || raw.conversationId !== scope.conversationId) invalid(); return { key: key(raw.key), conversationId: scope.conversationId, kind: kind(raw.kind), expectedVersion: version(raw.expectedVersion) } }
  const failed = (): never => { throw new EngineError(0, 'reply_storage_unavailable', '') }
  const persist = (target: string, value: unknown) => { const raw = JSON.stringify(value); storage.setItem(target, raw); if (storage.getItem(target) !== raw) failed() }
  const readHistory = (): ReplyReference[] => {
    try { const raw = storage.getItem(historyKey); if (!raw) return []; if (raw.length > 1048576) failed(); const values: unknown = JSON.parse(raw); if (!Array.isArray(values)) return failed(); return values.map(parse) } catch { return failed() }
  }
  return {
    read(): ReplyReference | undefined { try { const raw = storage.getItem(storageKey); if (!raw) return; if (raw.length > 2048) invalid(); return parse(JSON.parse(raw)) } catch { return failed() } },
    write(reference: ReplyReference) { try { persist(storageKey, parse(reference)) } catch { failed() } },
    clear() { try { storage.removeItem(storageKey); if (storage.getItem(storageKey) !== null) failed() } catch { failed() } },
    history: readHistory,
    archive(reference: ReplyReference): ReplyReference[] {
      try {
        const safe = parse(reference), current = storage.getItem(storageKey)
        if (!current || JSON.stringify(parse(JSON.parse(current))) !== JSON.stringify(safe)) failed()
        const history = readHistory(), existing = history.find(item => item.key === safe.key)
        if (existing && JSON.stringify(existing) !== JSON.stringify(safe)) failed()
        const next = existing ? history : [...history, safe]
        if (JSON.stringify(next).length > 1048576) failed()
        persist(historyKey, next)
        storage.removeItem(storageKey)
        if (storage.getItem(storageKey) !== null) failed()
        return next
      } catch { return failed() }
    },
  }
}
