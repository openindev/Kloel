import type { Agent } from '@/domain/types'
import { chatSettingsOf } from '@/app/pages/agents/core/chatSettings'
import { defaultTechnical } from '@/data/seed/defaults'

const extraction = (row: Agent['technical']['preciseExtraction'][number]) => ({ ...row, name: row.name.trim(), example: row.example.trim() })
const chat = (agent: Pick<Agent, 'chat'>) => {
  const value = chatSettingsOf(agent)
  return { ...value, entry: { ...value.entry, condition: value.entry.condition.trim() }, handover: { ...value.handover, custom: value.handover.custom.trim() } }
}

/**
 * Every Técnico field reaches a runtime: the phone worker (engine/src/phone-runtime.ts → voice/agent.py) and the
 * WhatsApp/webchat workers (engine/src/agent-technical.ts). A key outside that contract cannot be changed.
 */
const EXECUTABLE_TECHNICAL = new Set(Object.keys(defaultTechnical()))
const EXTRACTION_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Reject changes the current execution contract cannot apply, retaining readable legacy preferences. */
export function assertExecutableAgentSettings(base: Agent, patch: Partial<Agent>) {
  if (patch.technical) {
    const keys = new Set([...Object.keys(base.technical), ...Object.keys(patch.technical)])
    for (const key of keys) {
      if (key === 'preciseExtraction') {
        const next = patch.technical.preciseExtraction.map(extraction).filter(row => row.name || row.example)
        if (new Set(next.map(row => row.id)).size !== next.length || next.some(row => !EXTRACTION_NAME_RE.test(row.name))) throw Error('Revise as informações de processamento preciso. Nenhuma alteração foi salva.')
        continue
      }
      if (EXECUTABLE_TECHNICAL.has(key)) continue
      if (JSON.stringify(base.technical[key as keyof Agent['technical']]) !== JSON.stringify(patch.technical[key as keyof Agent['technical']])) {
        throw Error('Esta configuração técnica ainda não está disponível. Nenhuma alteração foi salva.')
      }
    }
  }
  if (patch.chat && JSON.stringify(chat(base)) !== JSON.stringify(chat({ chat: patch.chat }))) {
    throw Error('Esta configuração de gestão de conversas ainda não está disponível. Nenhuma alteração foi salva.')
  }
}

export function assertExecutableNewAgentSettings(input: Agent) {
  assertExecutableAgentSettings({ ...input, technical: { ...defaultTechnical(), preciseExtraction: [] }, chat: undefined }, { technical: input.technical, chat: input.chat })
}
