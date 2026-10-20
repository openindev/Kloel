import { toast } from 'sonner'
/**
 * Modelo do módulo Tarefas (BETA) — leitura/escrita no store e simulação da habilidade "Criar tarefa".
 *
 * As tarefas vivem em `db.tasks` (declarado em src/domain/ext/tasks.ts). Bancos gravados antes deste módulo não têm a
 * coleção: toda leitura usa `db.tasks ?? []` e `ensureTasksSeeded()` semeia as tarefas de demonstração ao ativar o BETA.
 * Toda mudança registra uma entrada em "Atividade" (autor, instante e a mudança), como em TK-V03.
 */
import { useMemo } from 'react'
import { format } from 'date-fns'
import type { Agent, Conversation, DemoDB, ID, Organization, TranscriptLine, User } from '@/domain/types'
import '@/domain/ext/tasks'
import {
  TASK_PRIORITY_LABEL, TASK_PRIORITY_RANK, TASK_STATUS_LABEL, DEFAULT_TASK_INSTRUCTIONS,
  type Task, type TaskAbilityConfig, type TaskAbilityRule, type TaskActivity, type TaskPriority, type TaskStatus,
} from '@/domain/ext/tasks'
import { useStore } from '@/data/store'
import { buildTaskSeed } from '@/data/seed/modules/tasks'
import { initials, uid } from '@/lib/utils'

export { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, TASK_PRIORITY_RANK }
export type { Task, TaskStatus, TaskPriority, TaskActivity, TaskAbilityConfig, TaskAbilityRule }

/** Limite de tags distintas por tarefa (TK-V04: "mantendo até 50 tags distintas"). */
export const MAX_TASK_TAGS = 50
export const MAX_TITLE = 200
/** Tag aplicada pela regra padrão da habilidade (TK-V04: "Created by AI"). */
export const AI_TAG = 'Criada por IA'

export const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done', 'canceled']
export const PRIORITY_ORDER: TaskPriority[] = ['none', 'low', 'medium', 'high']
export const ACTIVE_STATUSES: TaskStatus[] = ['todo', 'in_progress']

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

const EMPTY: Task[] = []

/** Tarefas da organização atual. */
export function useTasks(): Task[] { return EMPTY }

export function useTask(id: ID | undefined): Task | undefined { return undefined }

/** Tarefas ligadas a uma conversa (para outros módulos, ex.: detalhe da conversa). */
export function useTasksForConversation(conversationId: ID | undefined): Task[] {
  const tasks = useTasks()
  return useMemo(() => (conversationId ? tasks.filter((t) => t.conversationId === conversationId) : EMPTY), [tasks, conversationId])
}

export interface Member {
  id: ID
  name: string
  initials: string
  email: string
}

function memberOf(u: User): Member {
  const name = `${u.firstName} ${u.lastName}`.trim() || u.email
  return { id: u.id, name, initials: initials(name) || u.email.slice(0, 2).toUpperCase(), email: u.email }
}

/** Membros da organização atual (responsáveis possíveis). */
export function useMembers(): Member[] {
  const users = useStore((s) => s.db.users)
  const memberships = useStore((s) => s.db.memberships)
  const orgId = useStore((s) => s.db.session.orgId)
  return useMemo(
    () =>
      memberships
        .filter((m) => m.orgId === orgId)
        .map((m) => users.find((u) => u.id === m.userId))
        .filter((u): u is User => !!u)
        .map(memberOf)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [users, memberships, orgId],
  )
}

export function userName(db: DemoDB, id: ID | undefined): string {
  if (!id) return 'Sem responsável'
  const u = db.users.find((x) => x.id === id)
  return u ? `${u.firstName} ${u.lastName}`.trim() || u.email : 'Usuário removido'
}

/** Todas as tags já usadas nas tarefas da organização (sugestões do campo "Tags"), por frequência. */
export function useKnownTags(): string[] {
  const tasks = useTasks()
  return useMemo(() => {
    const count = new Map<string, number>()
    for (const t of tasks) for (const tag of t.tags) count.set(tag, (count.get(tag) ?? 0) + 1)
    if (!count.has(AI_TAG)) count.set(AI_TAG, 0)
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([t]) => t)
  }, [tasks])
}

/* ------------------------------------------------------------------ */
/* Formatação                                                          */
/* ------------------------------------------------------------------ */

/** "03/10/2026, 09:00" (TK-V03, em pt-BR). */
export const formatDue = (iso: string) => format(new Date(iso), 'dd/MM/yyyy, HH:mm')
/** "01/10/2026, 17:21:48" (TK-V03, Atividade). */
export const formatActivityAt = (iso: string) => format(new Date(iso), 'dd/MM/yyyy, HH:mm:ss')

export function isOverdue(t: Pick<Task, 'dueAt' | 'status'>, now = Date.now()) {
  return !!t.dueAt && ACTIVE_STATUSES.includes(t.status) && new Date(t.dueAt).getTime() < now
}

/** Texto puro de uma descrição em HTML (busca e validação). */
export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(div|p|h2|h3|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeTag(v: string) {
  return v.replace(/\s+/g, ' ').trim().slice(0, 40)
}

/** Acrescenta tags distintas (sem diferenciar maiúsculas), mantendo a ordem e o limite de 50. */
export function mergeTags(current: string[], add: string[]) {
  const out = [...current]
  for (const raw of add) {
    const t = normalizeTag(raw)
    if (!t || out.length >= MAX_TASK_TAGS) continue
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

type Author = ID | 'ai'

const nowIso = () => new Date().toISOString()
const activity = (userId: Author | undefined, change: string, at = nowIso()): TaskActivity => ({ id: uid('tka'), at, userId, change })

function setTasks(fn: (tasks: Task[]) => Task[]) {
  useStore.getState().mutate((db) => ({ ...db, tasks: fn(db.tasks ?? []) }))
}

/** Usuário atual (autor das mudanças feitas na interface). */
export function currentAuthor(): Author | undefined {
  return useStore.getState().db.session.userId ?? undefined
}

/**
 * Semeia as tarefas de demonstração quando o banco salvo não tem a coleção (anterior ao módulo).
 * As tarefas de exemplo só entram na organização de demonstração ("Clínica Bem Viver").
 */
export function ensureTasksSeeded() { /* No task provider exists. Never seed private runtime data. */ }

/** Liga/desliga Tarefas (BETA) na organização atual. Ao ligar, garante a coleção. */
export function setTasksBeta(on: boolean) { toast.error('Tarefas ainda não está disponível nesta configuração.') }

function currentOrg(): Organization | undefined {
  const db = useStore.getState().db
  return db.organizations.find((o) => o.id === db.session.orgId)
}

export interface TaskDraft {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  assigneeUserId?: ID
  dueAt?: string
  tags?: string[]
  createdBy?: 'ai' | 'user'
  agentId?: ID
  conversationId?: ID
  contactId?: ID
  simulated?: boolean
}

export function createTask(draft: TaskDraft, by: Author | undefined = currentAuthor(), orgId?: ID): Task { throw Error('A criação de tarefas ainda não está disponível.') }

export type TaskPatch = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'assigneeUserId' | 'dueAt' | 'tags'>>

/** Descreve as mudanças de um patch (uma entrada de Atividade por campo alterado). */
function describeChanges(db: DemoDB, prev: Task, patch: TaskPatch): string[] {
  const out: string[] = []
  if ('title' in patch && patch.title !== undefined && patch.title !== prev.title) out.push(`Título: ${prev.title} → ${patch.title}`)
  if (patch.status && patch.status !== prev.status) out.push(`Estado: ${TASK_STATUS_LABEL[prev.status]} → ${TASK_STATUS_LABEL[patch.status]}`)
  if (patch.priority && patch.priority !== prev.priority) out.push(`Prioridade: ${TASK_PRIORITY_LABEL[prev.priority]} → ${TASK_PRIORITY_LABEL[patch.priority]}`)
  if ('assigneeUserId' in patch && patch.assigneeUserId !== prev.assigneeUserId)
    out.push(`Responsável: ${userName(db, prev.assigneeUserId)} → ${userName(db, patch.assigneeUserId)}`)
  if ('dueAt' in patch && patch.dueAt !== prev.dueAt)
    out.push(`Data de vencimento: ${prev.dueAt ? formatDue(prev.dueAt) : 'Sem data'} → ${patch.dueAt ? formatDue(patch.dueAt) : 'Sem data'}`)
  if ('description' in patch && patch.description !== undefined && htmlToText(patch.description) !== htmlToText(prev.description))
    out.push(htmlToText(patch.description) ? 'Atualizou a descrição' : 'Removeu a descrição')
  else if ('description' in patch && patch.description !== undefined && patch.description !== prev.description) out.push('Formatou a descrição')
  if (patch.tags) {
    const added = patch.tags.filter((t) => !prev.tags.includes(t))
    const removed = prev.tags.filter((t) => !patch.tags!.includes(t))
    if (added.length) out.push(`Tags adicionadas: ${added.join(', ')}`)
    if (removed.length) out.push(`Tags removidas: ${removed.join(', ')}`)
  }
  return out
}

/** Aplica um patch e registra cada mudança na Atividade. Retorna as mudanças registradas. */
export function updateTask(id: ID, patch: TaskPatch, by: Author | undefined = currentAuthor()): string[] { toast.error('A atualização de tarefas ainda não está disponível.'); return [] }

export function duplicateTask(id: ID, by: Author | undefined = currentAuthor()): Task | undefined { toast.error('A duplicação de tarefas ainda não está disponível.'); return undefined }

export function deleteTask(id: ID) { throw Error('A exclusão de tarefas ainda não está disponível.') }

/* ------------------------------------------------------------------ */
/* Habilidade "Criar tarefa" (simulada)                                */
/* ------------------------------------------------------------------ */

export function defaultTaskAbility(): TaskAbilityConfig {
  return {
    enabled: false,
    instructions: DEFAULT_TASK_INSTRUCTIONS,
    initialStatus: 'in_progress',
    rulesEnabled: false,
    rules: [],
  }
}

const STOPWORDS = new Set(
  (
    'a o as os um uma uns umas de da do das dos em na no nas nos por para pra com sem sobre entre ate que se ou e eh ser esta este esse essa isso ' +
    'quando qual quais como mais menos muito pouco ja nao sim seu sua seus suas meu minha ele ela eles elas voce voces cliente clientes contato ' +
    'chamador pessoa usuario conversa ligacao mensagem pede pedir pediu solicita solicitar solicitou quer querem deseja desejar gostaria precisa ' +
    'the and for asks wants caller customer'
  ).split(/\s+/),
)

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Palavras significativas de uma condição "Somente se…" (minúsculas, sem acento, sem palavras vazias). */
export function conditionKeywords(condition: string): string[] {
  const words = fold(condition).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  return [...new Set(words)]
}

/**
 * Simulação da decisão da IA para "Somente se…": a condição corresponde quando alguma palavra significativa
 * (comparada pelo radical de até 5 letras, ex.: "retorno" ≈ "retornar") aparece no texto da conversa.
 */
export function conditionMatches(condition: string, conversationText: string): { matched: boolean; hits: string[] } {
  const keys = conditionKeywords(condition)
  if (!keys.length) return { matched: false, hits: [] }
  const words = new Set(fold(conversationText).split(/[^a-z0-9]+/).filter((w) => w.length >= 4))
  const stems = new Set([...words].map((w) => w.slice(0, 5)))
  const hits = keys.filter((k) => words.has(k) || stems.has(k.slice(0, 5)))
  return { matched: hits.length > 0, hits }
}

export interface RuleOutcome {
  tags: string[]
  assigneeUserId?: ID
  priority: TaskPriority
  /** índice das regras aplicadas (ordem da folha) */
  applied: number[]
}

/**
 * Regras da habilidade (TK-V04): tags correspondentes são combinadas (até 50 distintas, na ordem das regras);
 * o primeiro responsável correspondente é usado; a maior prioridade correspondente é usada.
 */
export function evaluateTaskRules(config: Pick<TaskAbilityConfig, 'rulesEnabled' | 'rules'>, conversationText: string): RuleOutcome {
  const out: RuleOutcome = { tags: [], priority: 'none', applied: [] }
  if (!config.rulesEnabled) return out
  config.rules.forEach((r, i) => {
    const ok = r.when === 'always' || (!!r.condition?.trim() && conditionMatches(r.condition, conversationText).matched)
    if (!ok) return
    out.applied.push(i)
    out.tags = mergeTags(out.tags, r.tags)
    if (!out.assigneeUserId && r.assigneeUserId) out.assigneeUserId = r.assigneeUserId
    if (r.priority && TASK_PRIORITY_RANK[r.priority] > TASK_PRIORITY_RANK[out.priority]) out.priority = r.priority
  })
  return out
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function conversationText(conv: Pick<Conversation, 'title' | 'summary' | 'transcript'>) {
  return [conv.title, conv.summary, ...conv.transcript.filter((l) => l.speaker !== 'system').map((l) => l.text)].join(' ')
}

/**
 * Monta (sem gravar) a tarefa que a habilidade criaria para a conversa — título e descrição seguem as instruções padrão
 * ("Resuma a solicitação e os próximos passos. Inclua os dados de contato quando disponíveis.") de forma simulada.
 */
export function draftFromConversation(db: DemoDB, conv: Conversation, agent: Agent, config: TaskAbilityConfig): TaskDraft & { outcome: RuleOutcome } {
  const callerLines = conv.transcript.filter((l) => l.speaker === 'caller').map((l) => l.text.trim()).filter(Boolean)
  const ask = callerLines.find((l) => l.length > 18) ?? callerLines[0] ?? ''
  const rawTitle = conv.title && conv.title !== 'Sem assunto' ? conv.title : ask || 'Acompanhar conversa'
  const title = `${rawTitle.replace(/[.!?]+$/, '')}`.slice(0, 90)
  const contact = conv.contactId ? db.contacts.find((c) => c.id === conv.contactId) : undefined
  const contactBits = [
    contact ? `${contact.firstName} ${contact.lastName}`.trim() : '',
    contact?.phones[0]?.value ?? conv.callerNumber ?? '',
    contact?.emails[0]?.value ?? '',
  ].filter(Boolean)
  const sentence = (l: string) => (/[.!?…]$/.test(l) ? l : `${l}.`)
  const request = conv.summary || (callerLines.length ? callerLines.slice(-2).map(sentence).join(' ') : 'Conversa sem mensagens do contato.')
  const parts = [
    `<div><b>Solicitação:</b> ${escapeHtml(request)}</div>`,
    `<div><b>Próximos passos:</b> retornar ao contato pelo mesmo canal e concluir o atendimento.</div>`,
    contactBits.length ? `<div><b>Contato:</b> ${escapeHtml(contactBits.join(' · '))}</div>` : '',
    `<div><i>Gerada pela habilidade “Criar tarefa” de ${escapeHtml(agent.name)}.</i></div>`,
  ]
  const outcome = evaluateTaskRules(config, conversationText(conv))
  return {
    title,
    description: parts.filter(Boolean).join(''),
    status: config.initialStatus,
    priority: outcome.priority,
    assigneeUserId: outcome.assigneeUserId,
    tags: outcome.tags,
    createdBy: 'ai',
    agentId: agent.id,
    conversationId: conv.id,
    contactId: conv.contactId,
    simulated: true,
    outcome,
  }
}

export interface CreateFromConversationOptions {
  /** usa esta configuração em vez da salva no assistente (ex.: rascunho da folha, para simular antes de salvar) */
  config?: TaskAbilityConfig
  /** conversa ainda não gravada (ex.: chat de teste): título/resumo/transcrição usados no lugar da conversa do store */
  conversation?: Partial<Pick<Conversation, 'title' | 'summary' | 'contactId' | 'callerNumber'>> & { transcript?: TranscriptLine[] }
  /** cria outra tarefa mesmo que a conversa já tenha uma criada pela IA */
  allowDuplicate?: boolean
}

/**
 * Simula a habilidade "Criar tarefa" ao fim de uma conversa: aplica instruções, status inicial e regras (Sempre / Somente se…,
 * condição avaliada por palavras-chave) e grava a tarefa marcada como simulada, com autor "IA".
 * Retorna `null` quando não se aplica: assistente inexistente ou de voz, Tarefas (BETA) desligado, habilidade desativada
 * ou conversa inexistente. Se a conversa já tem tarefa criada pela IA deste assistente, devolve a existente (idempotente).
 */
export function createTaskFromConversation(conversationId: ID, agentId: ID, opts: CreateFromConversationOptions = {}): Task | null { toast.error('A criação automática de tarefas ainda não está disponível.'); return null }
