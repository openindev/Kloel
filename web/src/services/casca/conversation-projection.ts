import type { Conversation } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import '@/domain/ext/engine-conversations'
import { EngineError } from '../engine/http'
import type { ConversationControl, ConversationMessage, EngineConversation } from '../engine/conversations'
import type { AnalysisView } from '../engine/after-conversation'
import type { ConversationEditorState } from './conversation-editor'

export const internalTags = new Set(['human_handoff', 'no_ai', 'manual_only', 'requires_review'])
export const conversationTagId = (label: string) => `engine-tag:${encodeURIComponent(label)}`
export function projectConversation(control: ConversationControl, messages: ConversationMessage[], analyses: AnalysisView[], editor: ConversationEditorState): Conversation {
  return projectConversationRecord(control.conversation, control, messages, analyses, editor)
}
export function projectConversationRecord(c: EngineConversation, control: ConversationControl | null, messages: ConversationMessage[], analyses: AnalysisView[], editor: ConversationEditorState): Conversation {
  if (c.channel === 'email') throw new EngineError(0, 'email_inbox_separate', 'Esta conversa está em E-Mail IA.')
  const analysis = analyses.find(item => item.status === 'succeeded' && item.applicable && item.result)
  const closedAt = c.status === 'closed' ? analyses.find(item => item.closedAt)?.closedAt ?? c.endedAt ?? null : null
  const handover = c.status === 'pending' || c.tags.includes('human_handoff')
  // Ligações: duração informada pelo motor de voz; sem ela, término − início quando a ligação já terminou.
  const elapsed = c.endedAt ? Math.round((Date.parse(c.endedAt) - Date.parse(c.createdAt)) / 1000) : NaN
  const durationSec = c.channel === 'phone' ? c.durationSeconds ?? (Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null) : null
  const party = c.channel === 'phone' || c.channel === 'whatsapp' ? c.externalContact ?? undefined : undefined
  return {
    id: c.id, orgId: c.tenantId, agentId: c.agentId ?? '', channel: c.channel,
    direction: c.direction ?? 'unknown', title: c.subject || 'Sem assunto', summary: analysis?.result?.summary.text ?? c.summary ?? '',
    result: 'unknown', startedAt: c.createdAt, durationSec, endedBy: 'unknown',
    ...(party ? c.direction === 'outbound' ? { calleeNumber: party } : { callerNumber: party } : {}),
    ...(editor.assigneeUserId ? { assigneeUserId: editor.assigneeUserId } : {}),
    contactId: c.contactId ?? undefined,
    ...(c.recording ? { recording: { durationSec: c.recording.durationSec, url: `/api/v1/conversations/${encodeURIComponent(c.id)}/recording` } } : {}),
    transcript: [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(message => ({
      t: Math.max(0, (Date.parse(message.createdAt) - Date.parse(c.createdAt)) / 1000),
      speaker: message.role === 'user' ? 'caller' : message.role === 'assistant' ? 'assistant' : 'system',
      text: message.content, sentAt: message.createdAt,
      ...(message.authorType === 'human' ? { author: 'team' as const } : {}), simulated: false,
    })),
    starred: editor.starred, archived: editor.archived, read: editor.read, tagIds: [...editor.tagIds, ...c.tags.filter(t => !internalTags.has(t.toLowerCase())).map(conversationTagId)],
    simulated: false, chatActive: c.status !== 'closed',
    ...(handover ? { handover: { by: 'Equipe', at: null } } : {}),
    engineConversation: { control, editor, closedAt, analysisId: analysis?.id ?? null, loaded: !!control },
  }
}

