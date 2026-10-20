import type { Agent, Conversation } from '@/domain/types'
import '@/domain/ext/agents'
import '@/domain/ext/mais-a'
import { useStore } from '@/data/store'

/**
 * Exclusão de um assistente com tudo o que é dele: conhecimento (fontes + entradas) é removido; números de telefone e contas
 * de WhatsApp ficam sem atribuição; tipos de evento do Agendador e a central PBX deixam de apontar para ele.
 * As CONVERSAS são mantidas (histórico/relatórios): cada uma recebe o nome do assistente no momento da exclusão
 * (`agentNameSnapshot` + `agentDeletedAt`), para Conversas exibir "<nome> (excluído)" em vez de um id solto. INFERIDO.
 * Usado pela página do assistente ("…" → Excluir) e pela lista de assistentes.
 * Devolve o próximo assistente da organização (mais antigo) para navegação, se houver.
 */
export function deleteAgentCascade(agentId: string) {
  const st = useStore.getState()
  const agent = st.db.agents.find((a) => a.id === agentId)
  if (!agent) return undefined
  const now = new Date().toISOString()
  st.mutate((db) => ({
    ...db,
    conversations: db.conversations.map((c) => (c.agentId === agentId ? { ...c, agentNameSnapshot: agent.name, agentDeletedAt: now } : c)),
    phoneNumbers: db.phoneNumbers.map((n) => {
      if (n.agentId !== agentId && n.pbx?.agentId !== agentId && n.pbx?.missedAgentId !== agentId) return n
      const pbx = n.pbx
        ? {
            ...n.pbx,
            agentId: n.pbx.agentId === agentId ? undefined : n.pbx.agentId,
            missedAgentId: n.pbx.missedAgentId === agentId ? undefined : n.pbx.missedAgentId,
            missed: n.pbx.missedAgentId === agentId && n.pbx.missed === 'agent' ? ('nothing' as const) : n.pbx.missed,
          }
        : undefined
      return { ...n, agentId: n.agentId === agentId ? undefined : n.agentId, ...(pbx ? { pbx } : {}) }
    }),
    whatsappAccounts: db.whatsappAccounts.map((w) => (w.agentId === agentId ? { ...w, agentId: undefined } : w)),
    eventTypes: db.eventTypes.map((e) => (e.agentIds.includes(agentId) ? { ...e, agentIds: e.agentIds.filter((id) => id !== agentId) } : e)),
    knowledgeEntries: db.knowledgeEntries.filter((k) => k.agentId !== agentId),
    knowledgeSources: db.knowledgeSources.filter((k) => k.agentId !== agentId),
  }))
  const next = st.db.agents.filter((a) => a.orgId === agent.orgId && a.id !== agentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  st.remove('agents', agentId)
  return next
}

/**
 * Nome do assistente de uma conversa para Conversas/detalhes: o assistente atual ou, se ele foi excluído, o nome guardado
 * na exclusão com o sufixo "(excluído)". `undefined` quando não há nenhum dos dois (dados antigos).
 */
export function conversationAgentName(conversation: Pick<Conversation, 'agentId' | 'agentNameSnapshot'>, agents: Pick<Agent, 'id' | 'name'>[]) {
  const live = agents.find((a) => a.id === conversation.agentId)
  if (live) return live.name
  return conversation.agentNameSnapshot ? `${conversation.agentNameSnapshot} (excluído)` : undefined
}
