import type { Tag } from '@/domain/types'
import { EngineError } from '../engine/http'
import type { EngineContext } from '../engine/session'

export interface ConversationEditorState { conversationId: string; tenantId: string; version: string; read: boolean; starred: boolean; archived: boolean; tagIds: string[]; assigneeUserId?: string }
declare module '@/domain/types' { interface Conversation { /** "Responsável" (pessoa da equipe) — estado compartilhado da organização. */ assigneeUserId?: string } }
export interface ConversationTagCatalog { revision: string; tags: Tag[] }
export const tagColors: Record<string, string> = { gray: '#71717A', red: '#B91C1C', orange: '#C2410C', amber: '#92400E', green: '#166534', teal: '#0F766E', blue: '#1D4ED8', brand: '#585DF5', violet: '#6D28D9', pink: '#BE185D' }
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function fail(): never { throw new EngineError(0, 'invalid_data', 'Não foi possível confirmar os dados da conversa.') }
function parseEditor(raw: unknown, context: EngineContext, id: string): ConversationEditorState {
  if (!object(raw) || raw.tenantId !== context.tenantId || raw.conversationId !== id || !hash(raw.version) || !['read','starred','archived'].every(k => typeof raw[k] === 'boolean') || !Array.isArray(raw.tagIds) || raw.tagIds.some(t => !uuid(t)) || new Set(raw.tagIds).size !== raw.tagIds.length || raw.assigneeUserId !== undefined && (typeof raw.assigneeUserId !== 'string' || !raw.assigneeUserId || raw.assigneeUserId.length > 128)) fail()
  return raw as unknown as ConversationEditorState
}
function parseCatalog(raw: unknown, context: EngineContext): ConversationTagCatalog {
  if (!object(raw) || !hash(raw.revision) || !Array.isArray(raw.tags)) fail()
  const tags = raw.tags.map(t => {
    if (!object(t) || !uuid(t.id) || typeof t.label !== 'string' || !t.label.trim() || t.label.length > 80 || typeof t.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(t.color) || typeof t.autoAdd !== 'boolean' || t.condition !== undefined && (typeof t.condition !== 'string' || t.condition.length > 2000)) fail()
    const color = Object.keys(tagColors).find(k => tagColors[k].toLowerCase() === (t.color as string).toLowerCase()) ?? t.color as string
    return { id: t.id, orgId: context.tenantId, label: t.label, color, autoAdd: t.autoAdd, ...(t.condition !== undefined ? { condition: t.condition } : {}) } as Tag
  })
  if (new Set(tags.map(t => t.id)).size !== tags.length) fail()
  return { revision: raw.revision, tags }
}
export function createConversationEditorService(context: EngineContext) {
  return {
    async batch(ids: string[]) {
      if (!ids.length || ids.length > 100 || ids.some(id => !uuid(id)) || new Set(ids).size !== ids.length) fail()
      const raw = await context.request('/conversation-editor-states', { query: { ids: ids.join(',') } })
      context.assertCurrent()
      if (!object(raw) || !Array.isArray(raw.items) || raw.items.length !== ids.length) fail()
      const items = raw.items.map(item => { if (!object(item) || typeof item.conversationId !== 'string' || !ids.includes(item.conversationId)) fail(); return parseEditor(item, context, item.conversationId) })
      if (new Set(items.map(item => item.conversationId)).size !== ids.length) fail()
      return items
    },
    async get(id: string) { const raw = await context.request(`/conversations/${encodeURIComponent(id)}/editor-state`); context.assertCurrent(); return parseEditor(raw, context, id) },
    async patch(current: ConversationEditorState, changes: Partial<Pick<ConversationEditorState, 'read' | 'starred' | 'archived' | 'tagIds'>> & { assigneeUserId?: string | null }) {
      if (current.tenantId !== context.tenantId || !hash(current.version) || !Object.keys(changes).length || Object.keys(changes).some(k => !['read','starred','archived','tagIds','assigneeUserId'].includes(k))) fail()
      const raw = await context.request(`/conversations/${encodeURIComponent(current.conversationId)}/editor-state`, { method: 'PATCH', etag: `"conversation-editor:${current.conversationId}:${current.version}"`, body: changes })
      context.assertCurrent(); return parseEditor(raw, context, current.conversationId)
    },
    async catalog() { const raw = await context.request('/conversation-tags'); context.assertCurrent(); return parseCatalog(raw, context) },
    async saveCatalog(current: ConversationTagCatalog, tags: Tag[]) {
      if (!hash(current.revision)) fail()
      const body = { tags: tags.map(t => ({ id: t.id, label: t.label, color: tagColors[t.color] ?? t.color, autoAdd: t.autoAdd, ...(t.condition ? { condition: t.condition } : {}) })) }
      const raw = await context.request('/conversation-tags', { method: 'PUT', etag: `"conversation-tags:${current.revision}"`, body })
      context.assertCurrent(); return parseCatalog(raw, context)
    },
  }
}
