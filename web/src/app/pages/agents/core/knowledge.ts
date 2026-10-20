import type { KnowledgeEntry, KnowledgeSource } from '@/domain/types'
import '@/domain/ext/agents'

/** Entradas que pertencem a uma fonte (por sourceId ou, no seed base, pelo rótulo do site). */
export function entriesOfSource(entries: KnowledgeEntry[], src: KnowledgeSource) {
  return entries.filter(
    (e) => e.agentId === src.agentId && (e.sourceId === src.id || (!e.sourceId && e.sourceLabel === src.label && ((src.type === 'website' && e.source === 'website') || (src.type === 'document' && e.source === 'document')))),
  )
}

/**
 * Entradas que o assistente pode usar nas respostas: base de conhecimento ligada e fonte de origem com o interruptor ligado
 * (FS-06/KB-03: "cada fonte tem um interruptor para habilitar o acesso do assistente"). Entradas manuais/automáticas sempre valem.
 */
export function usableKnowledge(entries: KnowledgeEntry[], sources: KnowledgeSource[], agentId: string, kbEnabled: boolean) {
  if (!kbEnabled) return []
  const own = entries.filter((e) => e.agentId === agentId)
  const off = new Set(sources.filter((s) => s.agentId === agentId && s.enabled === false).flatMap((s) => entriesOfSource(own, s).map((e) => e.id)))
  return own.filter((e) => !off.has(e.id))
}
