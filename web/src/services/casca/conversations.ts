import type { Conversation, Tag } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import '@/domain/ext/engine-conversations'
import { useStore } from '@/data/store'
import { EngineError } from '../engine/http'
import { captureEngineContext, type EngineContext } from '../engine/session'
import { createConversationService, type ConversationControl, type ConversationMessage, type EngineConversation } from '../engine/conversations'
import { createAfterConversationService, type AnalysisView } from '../engine/after-conversation'
import { createConversationEditorService, type ConversationEditorState } from './conversation-editor'

import { projectConversation, projectConversationRecord, internalTags, conversationTagId } from './conversation-projection'
export { projectConversation, projectConversationRecord } from './conversation-projection'

export async function loadConversation(context: EngineContext, conversationId: string): Promise<Conversation> {
  const service = createConversationService(context), control = await service.get(conversationId)
  const messages: ConversationMessage[] = [], messageIds = new Set<string>()
  for (let page = 1; page <= 1000; page++) {
    const result = await service.messages(conversationId, page)
    for (const item of result.items) {
      if (messageIds.has(item.id)) throw new EngineError(0, 'conversation_changed', 'As mensagens mudaram. Atualize a conversa.')
      messageIds.add(item.id); messages.push(item)
    }
    if (page >= result.totalPages) {
      if (messages.length !== result.total) throw new EngineError(0, 'conversation_changed', 'As mensagens mudaram. Atualize a conversa.')
      break
    }
    if (page === 1000) throw new EngineError(0, 'conversation_page_limit', 'Não foi possível carregar todas as mensagens.')
  }
  const analyses: AnalysisView[] = [], seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 1000; page++) {
    const result = await createAfterConversationService(context).analyses(conversationId, cursor)
    for (const item of result.items) { if (seen.has(item.id)) throw new EngineError(0, 'analysis_changed', 'Atualize a análise da conversa.'); seen.add(item.id); analyses.push(item) }
    if (!result.hasMore) break
    if (!result.cursor || page === 999) throw new EngineError(0, 'analysis_page_limit', 'Não foi possível carregar todas as análises.')
    cursor = result.cursor
  }
  context.assertCurrent()
  const editor = await createConversationEditorService(context).get(conversationId)
  context.assertCurrent()
  return projectConversation(control, messages, analyses, editor)
}

export async function loadConversations(context: EngineContext): Promise<{ conversations: Conversation[]; tags: Tag[] }> {
  const service = createConversationService(context), editorService = createConversationEditorService(context)
  const conversations: Conversation[] = [], labels = new Set<string>(), seen = new Set<string>()
  let total = 0
  for (let page = 1; page <= 1000; page++) {
    const result = await service.list({ page }); total = result.total
    const eligible = result.items.filter(item => item.channel !== 'email')
    const editors = eligible.length ? await editorService.batch(eligible.map(item => item.id)) : []
    for (const item of result.items) {
      if (seen.has(item.id)) throw new EngineError(0, 'conversation_changed', 'A lista mudou. Atualize as conversas.')
      seen.add(item.id)
      if (item.channel === 'email') continue
      const editor = editors.find(e => e.conversationId === item.id)
      if (!editor) throw new EngineError(0, 'invalid_data', 'Não foi possível carregar a conversa.')
      conversations.push(projectConversationRecord(item, null, [], [], editor))
      for (const label of item.tags) if (!internalTags.has(label.toLowerCase())) labels.add(label)
    }
    if (page >= result.totalPages) break
    if (page === 1000) throw new EngineError(0, 'conversation_page_limit', 'Não foi possível carregar todas as conversas.')
  }
  if (seen.size !== total) throw new EngineError(0, 'conversation_changed', 'A lista mudou. Atualize as conversas.')
  const tags = [...labels].sort().map(label => ({ id: conversationTagId(label), orgId: context.tenantId, label, color: 'gray', autoAdd: false }))
  const catalog = await editorService.catalog()
  context.assertCurrent(); return { conversations, tags: [...catalog.tags, ...tags] }
}

export function publishConversation(context: EngineContext, conversation: Conversation) {
  context.assertCurrent()
  useStore.getState().mutate(db => ({ ...db, conversations: db.conversations.some(c => c.id === conversation.id && c.orgId === context.tenantId) ? db.conversations.map(c => c.id === conversation.id && c.orgId === context.tenantId ? conversation : c) : [...db.conversations, conversation] }))
}
const detailReads = new Map<string, Promise<Conversation>>()
export async function refreshConversation(conversationId: string) {
  const context = captureEngineContext(), key = `${context.generation}:${context.tenantId}:${conversationId}`
  const existing = detailReads.get(key)
  if (existing) return existing
  const read = loadConversation(context, conversationId).then(conversation => { publishConversation(context, conversation); return conversation })
  detailReads.set(key, read)
  try { return await read } finally { if (detailReads.get(key) === read) detailReads.delete(key) }
}
export async function updateConversationEditor(conversation: Conversation, changes: Partial<Pick<ConversationEditorState, 'read' | 'starred' | 'archived' | 'tagIds'>> & { assigneeUserId?: string | null }) {
  const context = captureEngineContext(), current = conversation.engineConversation?.editor
  if (!current || current.tenantId !== context.tenantId) throw new EngineError(0, 'conversation_not_loaded', 'Atualize a conversa antes de salvar.')
  const editor = await createConversationEditorService(context).patch(current, changes)
  // Merge only the editorial fields: an operation must not overwrite messages loaded concurrently.
  context.assertCurrent()
  const latest = useStore.getState().db.conversations.find(c => c.id === conversation.id && c.orgId === context.tenantId)
  if (!latest?.engineConversation) throw new EngineError(0, 'conversation_not_loaded', 'Atualize a conversa.')
  const { assigneeUserId: _previous, ...rest } = latest
  const updated = { ...rest, ...(editor.assigneeUserId ? { assigneeUserId: editor.assigneeUserId } : {}), read: editor.read, starred: editor.starred, archived: editor.archived, tagIds: [...editor.tagIds, ...latest.tagIds.filter(id => id.startsWith('engine-tag:'))], engineConversation: { ...latest.engineConversation, editor } }
  publishConversation(context, updated); return updated
}
export async function updateConversationTags(conversation: Conversation, tagIds: string[]) {
  return updateConversationEditor(conversation, { tagIds: tagIds.filter(id => !id.startsWith('engine-tag:')) })
}
export async function deleteConversation(conversation: Conversation) {
  const context = captureEngineContext()
  if (conversation.orgId !== context.tenantId) throw new EngineError(0, 'context_mismatch', 'Atualize a conversa.')
  await context.request(`/conversations/${encodeURIComponent(conversation.id)}`, { method: 'DELETE' })
  context.assertCurrent(); useStore.getState().mutate(db => ({ ...db, conversations: db.conversations.filter(c => c.id !== conversation.id || c.orgId !== context.tenantId) }))
}

/** "Marcar como resolvida" / "Reabrir conversa": muda a situação pelo controle versionado do motor (encerrar dispara a análise pós-conversa). */
export async function setConversationStatus(conversation: Conversation, status: 'open' | 'closed') {
  const context = captureEngineContext('conversations:write')
  if (conversation.orgId !== context.tenantId) throw new EngineError(0, 'context_mismatch', 'Atualize a conversa.')
  if (conversation.channel !== 'webchat' && conversation.channel !== 'whatsapp') throw new EngineError(0, 'unsupported_channel', 'Ligações são encerradas pelo próprio atendimento de voz; não é possível reabri-las.')
  const service = createConversationService(context), current = await service.get(conversation.id)
  if (current.conversation.status === status) return refreshConversation(conversation.id)
  await service.update(current, { status })
  context.assertCurrent()
  return refreshConversation(conversation.id)
}

export type AutoTagRun = { id: string; conversationId: string; status: 'applied' | 'no_match' | 'skipped' | 'failed'; reasonCode: string | null; trigger: 'automatic' | 'manual'; appliedTagIds: string[]; matches: { tagId: string; reason: string; messageIds: string[] }[]; model: string | null; completedAt: string | null }
export type AutoTagAutomation = { available: boolean; reasonCode: string | null; schedulerRunning: boolean; rules: number; dailyLimit: number; usedToday: number; idleMinutes: number; lookbackDays: number }
const autoTagReasons: Record<string, string> = {
  provider_not_configured: 'o serviço de IA não está configurado neste servidor', provider_not_enabled_for_organization: 'o serviço de IA não está liberado para esta organização',
  no_rules: 'nenhuma etiqueta tem “Adicionar automaticamente” com condição', no_content: 'a conversa ainda não tem mensagens do cliente', quota_exceeded: 'o limite diário de análises foi atingido',
  provider_unavailable: 'o serviço de IA não respondeu', provider_rejected: 'o serviço de IA recusou a análise', provider_output_invalid: 'a resposta da IA veio em formato inválido',
}
export const autoTagReasonText = (code: string | null | undefined) => (code && autoTagReasons[code]) || 'motivo não informado'
export async function loadAutoTagAutomation(): Promise<AutoTagAutomation> {
  const context = captureEngineContext('conversations:read')
  const raw = await context.request<AutoTagAutomation>('/conversation-tags/automation'); context.assertCurrent()
  if (!raw || typeof raw.available !== 'boolean' || typeof raw.schedulerRunning !== 'boolean') throw new EngineError(0, 'invalid_data', 'Não foi possível consultar as etiquetas automáticas.')
  return raw
}
/** "Aplicar etiquetas automáticas": avalia as condições agora e recarrega a conversa com as etiquetas adicionadas. */
export async function runConversationAutoTags(conversation: Conversation) {
  const context = captureEngineContext('conversations:write')
  const raw = await context.request<{ run: AutoTagRun }>(`/conversations/${encodeURIComponent(conversation.id)}/auto-tags/run`, { method: 'POST', body: {} }); context.assertCurrent()
  await refreshConversation(conversation.id)
  return raw.run
}
export async function lastConversationAutoTags(conversationId: string) {
  const context = captureEngineContext('conversations:read')
  const raw = await context.request<{ run: AutoTagRun | null }>(`/conversations/${encodeURIComponent(conversationId)}/auto-tags`); context.assertCurrent()
  return raw.run
}
