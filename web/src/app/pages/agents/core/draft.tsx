import { createContext, useContext } from 'react'
import type { Agent } from '@/domain/types'
import '@/domain/ext/agents'
import { conditionMissingValue } from './variables'
import { TIMEOUT_MAX, TIMEOUT_MIN, chatSettingsOf } from './chatSettings'

/**
 * Modelo de "alterações não salvas" das abas Geral / Regras / Prompt / Técnico:
 * as edições ficam num rascunho local; a barra "N alteração(ões)" permite Descartar ou Salvar (persistir no store).
 */
export type DraftFields = Pick<
  Agent,
  'name' | 'voiceId' | 'language' | 'formality' | 'greeting' | 'greetingPersonalized' | 'greetingMode' | 'greetingRules' | 'rules' | 'prompt' | 'technical' | 'chat'
>

export const DRAFT_KEYS: (keyof DraftFields)[] = [
  'name', 'voiceId', 'language', 'formality', 'greeting', 'greetingPersonalized', 'greetingMode', 'greetingRules', 'rules', 'prompt', 'technical', 'chat',
]
/** Chaves contadas campo a campo (um item por subcampo alterado). */
const NESTED: (keyof DraftFields)[] = ['rules', 'technical', 'chat']

export const PROMPT_LIMIT = 100_000

export function pickDraft(a: Agent): DraftFields {
  const out = {} as Record<string, unknown>
  for (const k of DRAFT_KEYS) out[k] = a[k] === undefined ? undefined : JSON.parse(JSON.stringify(a[k]))
  // campos novos com padrão materializado (dados antigos sem o campo não contam como "alteração")
  if (a.type === 'chat') out.chat = chatSettingsOf(a)
  else out.formality = a.formality ?? 'custom'
  return out as DraftFields
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function countChanges(base: DraftFields, draft: DraftFields) {
  let n = 0
  for (const k of DRAFT_KEYS) {
    if (NESTED.includes(k)) {
      const a = (base[k] ?? {}) as Record<string, unknown>
      const b = (draft[k] ?? {}) as Record<string, unknown>
      for (const sk of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[sk], b[sk])) n++
    } else if (!same(base[k], draft[k])) n++
  }
  return n
}

export type DraftTab = 'general' | 'rules' | 'prompt' | 'technical'
export interface DraftIssue {
  tab: DraftTab
  field: string
  message: string
}

export const EXTRACTION_NAME_RE = /^[a-zA-Z0-9_-]+$/

export function validateDraft(d: DraftFields, type: Agent['type']): DraftIssue[] {
  const issues: DraftIssue[] = []
  if (!d.name.trim()) issues.push({ tab: 'general', field: 'name', message: 'O nome é obrigatório.' })
  else if (d.name.trim().length > 60) issues.push({ tab: 'general', field: 'name', message: 'O nome pode ter no máximo 60 caracteres.' })
  // chat: a saudação é a "Mensagem de saudação" do Webchat (Gerenciar Webchat) e pode ficar vazia (usa o padrão do idioma — WC-09)
  if (type !== 'chat' && !d.greeting.replace(/\{\{[^}]*\}\}/g, 'x').trim()) issues.push({ tab: 'general', field: 'greeting', message: 'A mensagem inicial é obrigatória.' })
  if (type === 'chat' && d.chat) {
    const c = d.chat
    if (!Number.isInteger(c.timeoutMinutes) || c.timeoutMinutes < TIMEOUT_MIN || c.timeoutMinutes > TIMEOUT_MAX)
      issues.push({ tab: 'general', field: 'chat.timeout', message: 'O tempo limite deve ficar entre 5 minutos e 7 dias.' })
    if (c.entry.mode === 'condition' && !c.entry.condition.trim())
      issues.push({ tab: 'general', field: 'chat.entry', message: 'Descreva a condição de entrada (ou escolha outra opção).' })
    if (c.handover.enabled && c.handover.mode !== 'standard' && !c.handover.custom.trim())
      issues.push({ tab: 'general', field: 'chat.handover', message: 'Descreva as condições personalizadas de transferência.' })
    if (c.notifications.enabled && (!c.notifications.userIds.length || (!c.notifications.onTeamEntry && !c.notifications.onHandover)))
      issues.push({ tab: 'general', field: 'chat.notifications', message: 'Escolha pelo menos um aviso e uma pessoa para as notificações da equipe.' })
  }
  // regras da mensagem inicial ("Personalizar") só existem no Geral dos assistentes de voz
  if (type !== 'chat' && d.greetingMode === 'advanced' && d.greetingRules.some((r) => !r.message.trim()))
    issues.push({ tab: 'general', field: 'greetingRules', message: 'Uma regra da mensagem inicial está sem mensagem.' })
  else if (type !== 'chat' && d.greetingMode === 'advanced' && d.greetingRules.some((r) => r.conditions.some(conditionMissingValue)))
    issues.push({ tab: 'general', field: 'greetingRules', message: 'Uma condição da mensagem inicial está sem valor.' })
  if (d.prompt.length > PROMPT_LIMIT) issues.push({ tab: 'prompt', field: 'prompt', message: 'O prompt pode ter no máximo 100.000 caracteres.' })
  const t = d.technical
  // assistentes de chat não exibem os campos de ligação (duração/espera): não há como corrigi-los na tela
  if (type !== 'chat' && (!Number.isFinite(t.maxCallDuration) || t.maxCallDuration < 1 || t.maxCallDuration > 120 || !Number.isInteger(t.maxCallDuration)))
    issues.push({ tab: 'technical', field: 'maxCallDuration', message: 'A duração máxima deve ser um número inteiro entre 1 e 120 minutos.' })
  if (type !== 'chat' && (!Number.isFinite(t.silenceTimeout) || t.silenceTimeout < 5 || t.silenceTimeout > 600 || !Number.isInteger(t.silenceTimeout)))
    issues.push({ tab: 'technical', field: 'silenceTimeout', message: 'O tempo máximo de espera deve ser um número inteiro entre 5 e 600 segundos.' })
  // o Técnico só existe nos assistentes de voz (o assistente de chat da Fonio não tem a aba — WC-02/WC-03)
  if (type !== 'chat') t.preciseExtraction.forEach((row) => {
    if (!row.name.trim() && !row.example.trim()) return
    if (!row.name.trim()) issues.push({ tab: 'technical', field: `pe:${row.id}`, message: 'Informe o nome da informação.' })
    else if (!EXTRACTION_NAME_RE.test(row.name.trim())) issues.push({ tab: 'technical', field: `pe:${row.id}`, message: 'Use apenas a-z, A-Z, 0-9, - e _ no nome da informação.' })
  })
  return issues
}

/**
 * Remove linhas totalmente vazias antes de persistir. O Chatbot de IA (widget/link hospedado/personalização) não faz parte do
 * rascunho: é gravado pelo "Gerenciar Webchat" em `Agent.webchatSetup` (fonte única); a saudação padrão é `greeting`.
 */
export function normalizeDraft(d: DraftFields, _type?: Agent['type']): DraftFields {
  return {
    ...d,
    chat: d.chat ? { ...d.chat, entry: { ...d.chat.entry, condition: d.chat.entry.condition.trim() }, handover: { ...d.chat.handover, custom: d.chat.handover.custom.trim() } } : d.chat,
    name: d.name.trim(),
    technical: { ...d.technical, preciseExtraction: d.technical.preciseExtraction.filter((r) => r.name.trim() || r.example.trim()).map((r) => ({ ...r, name: r.name.trim() })) },
    rules: { ...d.rules, pronunciation: d.rules.pronunciation.filter((p) => p.term.trim() && p.pronunciation.trim()) },
  }
}

export interface AgentDraftCtx {
  /** assistente persistido (store) */
  agent: Agent
  draft: DraftFields
  update: (patch: Partial<DraftFields> | ((d: DraftFields) => Partial<DraftFields>)) => void
  changes: number
  /** problemas exibidos depois de uma tentativa de salvar */
  issues: DraftIssue[]
  issueFor: (field: string) => string | undefined
}

export const DraftContext = createContext<AgentDraftCtx | null>(null)

export function useAgentDraft() {
  const ctx = useContext(DraftContext)
  if (!ctx) throw new Error('useAgentDraft fora do AgentPage')
  return ctx
}
