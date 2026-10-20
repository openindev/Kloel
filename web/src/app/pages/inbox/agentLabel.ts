import type { Agent, Conversation } from '@/domain/types'
// `Conversation.agentNameSnapshot` é gravado pelo módulo Assistentes ao excluir (agents/core/agentOps.ts → deleteAgentCascade).
import '@/domain/ext/agents'

/**
 * Assistente de uma conversa, inclusive depois de excluído.
 * A conversa guarda `agentId` (e, quando o módulo Assistentes registra, uma cópia do nome no momento da exclusão).
 * Assistente existente → nome atual com link; excluído → "<nome guardado> (excluído)" ou "Assistente excluído".
 * O filtro "Agente" de Conversas continua filtrando pelo `agentId` original, então as conversas de assistentes excluídos
 * seguem filtráveis (opção própria no submenu).
 */

export const DELETED_AGENT_LABEL = 'Assistente excluído'

/**
 * Nome do assistente gravado na conversa ao excluí-lo (`agentNameSnapshot`, mesmo campo lido por agentOps.conversationAgentName).
 * Leitura defensiva: o campo é opcional e falta em dados antigos ou em exclusões feitas fora da cascata → "Assistente excluído".
 */
export function agentNameSnapshot(c: Conversation): string | undefined {
  const v: unknown = c.agentNameSnapshot
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export const deletedAgentLabel = (snapshot?: string) => (snapshot ? `${snapshot} (excluído)` : DELETED_AGENT_LABEL)

export interface AgentOption {
  id: string
  /** Rótulo exibido (nome atual ou "<nome> (excluído)" / "Assistente excluído"). */
  name: string
  type: Agent['type']
  deleted: boolean
  agent?: Agent
}

/** Tipo de um assistente excluído inferido pelo canal (voz: telefone/chamada web; chat: WhatsApp/Chatbot de IA). */
const typeFromConversation = (c: Conversation): Agent['type'] => (c.channel === 'whatsapp' || c.channel === 'webchat' ? 'chat' : 'voice')

export function resolveConversationAgent(c: Conversation, agents: Agent[]): AgentOption {
  if (!c.agentId) return { id: '', name: '–', type: typeFromConversation(c), deleted: false }
  const agent = agents.find((a) => a.id === c.agentId)
  if (agent) return { id: agent.id, name: agent.name, type: agent.type, deleted: false, agent }
  return { id: c.agentId ?? '', name: deletedAgentLabel(agentNameSnapshot(c)), type: typeFromConversation(c), deleted: true }
}

/**
 * Opções do filtro "Agente": assistentes atuais (ordem da coleção) seguidos dos excluídos que ainda têm conversas,
 * um por `agentId`, com o nome guardado na conversa mais recente que o tiver. Rótulos repetidos ("Assistente excluído")
 * recebem um número para continuarem distinguíveis.
 */
export function agentFilterOptions(agents: Agent[], conversations: Conversation[]): AgentOption[] {
  const known = new Set(agents.map((a) => a.id))
  const deleted = new Map<string, { snapshot?: string; at: string; type: Agent['type'] }>()
  for (const c of conversations) {
    const id = c.agentId ?? ''
    if (!id || known.has(id)) continue
    const snap = agentNameSnapshot(c)
    const cur = deleted.get(id)
    if (!cur) deleted.set(id, { snapshot: snap, at: c.startedAt, type: typeFromConversation(c) })
    else if (snap && (!cur.snapshot || c.startedAt > cur.at)) deleted.set(id, { snapshot: snap, at: c.startedAt, type: cur.type })
  }
  const out: AgentOption[] = agents.map((a) => ({ id: a.id, name: a.name, type: a.type, deleted: false, agent: a }))
  const extra = [...deleted.entries()]
    .map(([id, d]) => ({ id, name: deletedAgentLabel(d.snapshot), type: d.type, deleted: true }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const seen = new Map<string, number>()
  for (const o of extra) {
    const n = (seen.get(o.name) ?? 0) + 1
    seen.set(o.name, n)
    out.push(n > 1 ? { ...o, name: `${o.name} ${n}` } : o)
  }
  return out
}
