import { EngineError } from './http'
import type { EngineContext } from './session'

export type ConversationStatus = 'open' | 'pending' | 'closed'
export type ConversationChannel = 'webchat' | 'phone' | 'whatsapp' | 'email'
export interface EngineConversation {
  id: string; tenantId: string; subject: string; channel: ConversationChannel; status: ConversationStatus
  /** Phone calls only: the engine has a stored recording (played via /conversations/:id/recording). */
  recording?: { durationSec: number } | null
  agentId: string | null; contactId: string | null; tags: string[]; createdAt: string; updatedAt: string
  /** Ligações (motor de voz): resumo, direção, término, duração e número do outro lado, quando informados. */
  summary?: string; direction?: 'inbound' | 'outbound'; endedAt?: string | null; durationSeconds?: number | null; externalContact?: string | null
}
export interface ConversationMessage { id: string; conversationId: string; role: string; authorType?: 'visitor' | 'human' | 'ai'; content: string; createdAt: string; deliveryStatus: string; providerStatus?: 'delivered' | 'read' | 'failed'; internalNote: boolean }
export interface ConversationControl { conversation: EngineConversation; version: string }
export interface ConversationPage<T> { items: T[]; page: number; total: number; totalPages: number }
export interface ConversationFilter { page: number; q?: string; status?: ConversationStatus; channel?: ConversationChannel; agentId?: string; contactId?: string }
export const statusLabels = { open: 'Aberta', pending: 'Pendente', closed: 'Encerrada' }
export const channelLabels = { webchat: 'Chat web', phone: 'Telefone', whatsapp: 'WhatsApp', email: 'E-mail' }
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
function fail(): never { throw new EngineError(0, 'invalid_data', 'Os dados da conversa recebidos são inválidos. Atualize a tela.') }
const id = (value: string) => { if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail(); return value }
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
function parseConversation(value: unknown, tenantId: string): EngineConversation {
  if (!object(value) || value.tenantId !== tenantId || typeof value.id !== 'string' || !date(value.createdAt) || !date(value.updatedAt) || !Object.hasOwn(channelLabels, value.channel) || !Object.hasOwn(statusLabels, value.status)) fail()
  id(value.id)
  if (value.subject !== undefined && (typeof value.subject !== 'string' || value.subject.length > 300)) fail()
  const tags = value.tags ?? []
  if (!Array.isArray(tags) || tags.length > 50 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80)) fail()
  for (const key of ['agentId', 'contactId']) if (value[key] != null) { if (typeof value[key] !== 'string') fail(); id(value[key]) }
  const extra = { ...(typeof value.summary === 'string' && value.summary.trim() ? { summary: value.summary.slice(0, 5000) } : {}), ...(value.direction === 'inbound' || value.direction === 'outbound' ? { direction: value.direction as 'inbound' | 'outbound' } : {}),
    ...(date(value.endedAt) ? { endedAt: value.endedAt as string } : {}), ...(Number.isSafeInteger(value.durationSeconds) && value.durationSeconds >= 0 ? { durationSeconds: value.durationSeconds as number } : {}),
    ...(typeof value.externalContact === 'string' && /^\+?[\d\s().-]{6,40}$/.test(value.externalContact) ? { externalContact: value.externalContact } : {}) }
  return { ...extra, id: value.id, tenantId, subject: value.subject ?? '', channel: value.channel, status: value.status, agentId: value.agentId ?? null, contactId: value.contactId ?? null, tags, createdAt: value.createdAt, updatedAt: value.updatedAt, recording: value.channel === 'phone' && typeof value.recordingKey === 'string' && value.recordingKey ? { durationSec: Number.isSafeInteger(value.durationSeconds) && value.durationSeconds >= 0 ? value.durationSeconds : 0 } : null }
}
function parseMessage(value: unknown, tenantId: string, conversationId: string): ConversationMessage {
  if (!object(value) || value.tenantId !== tenantId || value.conversationId !== conversationId || typeof value.id !== 'string' || typeof value.content !== 'string' || typeof value.role !== 'string' || !date(value.createdAt) || value.authorType !== undefined && !['visitor', 'human', 'ai'].includes(value.authorType)) fail()
  id(value.id)
  const providerStatus = value.source === 'meta' && value.role === 'assistant' && value.kind !== 'internal_note' && ['delivered', 'read', 'failed'].includes(value.providerStatus) ? value.providerStatus as ConversationMessage['providerStatus'] : undefined
  return { id: value.id, conversationId, role: value.role, ...(value.authorType !== undefined ? { authorType: value.authorType } : {}), content: value.content, createdAt: value.createdAt, deliveryStatus: typeof value.deliveryStatus === 'string' ? value.deliveryStatus : 'unknown', ...(providerStatus ? { providerStatus } : {}), internalNote: value.kind === 'internal_note' }
}
function page<T>(raw: unknown, requested: number, limit: number, parse: (item: unknown) => T): ConversationPage<T> {
  if (!object(raw) || !Array.isArray(raw.items) || raw.items.length > limit || raw.page !== requested || raw.limit !== limit || !count(raw.total) || raw.totalPages !== Math.ceil(raw.total / limit)) fail()
  return { items: raw.items.map(parse), page: requested, total: raw.total, totalPages: raw.totalPages }
}
export function createConversationService(context: EngineContext) {
  const control = (value: unknown, expectedId: string): ConversationControl => {
    if (!object(value) || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.version)) fail()
    const conversation = parseConversation(value.conversation, context.tenantId)
    if (conversation.id !== expectedId) fail()
    return { conversation, version: value.version }
  }
  return {
    async list(filter: ConversationFilter, signal?: AbortSignal) {
      if (!Number.isSafeInteger(filter.page) || filter.page < 1 || (filter.q?.length ?? 0) > 300 || filter.status && !Object.hasOwn(statusLabels, filter.status) || filter.channel && !Object.hasOwn(channelLabels, filter.channel)) fail()
      const raw = await context.request('/conversations', { query: { ...filter, agentId: filter.agentId ? id(filter.agentId) : undefined, contactId: filter.contactId ? id(filter.contactId) : undefined, limit: 25, sort: 'updatedAt', order: 'desc' }, signal })
      context.assertCurrent(); return page(raw, filter.page, 25, value => parseConversation(value, context.tenantId))
    },
    async get(conversationId: string, signal?: AbortSignal) {
      const raw = await context.request(`/conversations/${id(conversationId)}/control`, { signal }); context.assertCurrent(); return control(raw, conversationId)
    },
    async messages(conversationId: string, currentPage = 1, signal?: AbortSignal) {
      if (!Number.isSafeInteger(currentPage) || currentPage < 1) fail()
      const raw = await context.request(`/conversations/${id(conversationId)}/messages`, { signal, query: { page: currentPage, limit: 50, sort: 'createdAt', order: 'desc' } })
      context.assertCurrent(); return page(raw, currentPage, 50, value => parseMessage(value, context.tenantId, conversationId))
    },
    async update(current: ConversationControl, changes: { subject?: string; status?: ConversationStatus; tags?: string[] }) {
      if (current.conversation.tenantId !== context.tenantId || !/^[a-f0-9]{64}$/.test(current.version) || !Object.keys(changes).length || Object.keys(changes).some(key => !['subject', 'status', 'tags'].includes(key))) fail()
      if (changes.subject !== undefined && (typeof changes.subject !== 'string' || changes.subject.length > 300) || changes.status && !Object.hasOwn(statusLabels, changes.status) || changes.tags && (!Array.isArray(changes.tags) || changes.tags.length > 50 || changes.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80))) fail()
      const raw = await context.request(`/conversations/${id(current.conversation.id)}/control`, { method: 'PATCH', body: { ...changes, expectedVersion: current.version } }); context.assertCurrent(); return control(raw, current.conversation.id)
    },
    async addNote(conversationId: string, content: string, operationKey: string) {
      if (typeof content !== 'string' || !content.trim() || content.length > 10000 || !/^[a-f0-9-]{36}$/i.test(operationKey)) fail()
      const raw: unknown = await context.request(`/conversations/${id(conversationId)}/notes`, { method: 'POST', body: { content: content.trim(), idempotencyKey: operationKey } }); context.assertCurrent()
      if (!object(raw) || typeof raw.replayed !== 'boolean') fail()
      const message = parseMessage(raw.message, context.tenantId, conversationId)
      if (!message.internalNote || message.role !== 'system' || message.deliveryStatus !== 'recorded') fail()
      return message
    },
  }
}
