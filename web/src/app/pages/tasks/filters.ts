/**
 * Busca, filtros e ordenação da lista de Tarefas — estado na query string (sobrevive a recarregar e é compartilhável).
 *
 * Padrão (TK-V01): chips "Categorias | Ativas" e "Minhas tarefas". Remover um chip grava o "desligado" na URL
 * (`cat=` vazio / `minhas=0`) para que a remoção persista; sem parâmetros = padrão.
 */
import type { ID } from '@/domain/types'
import { ACTIVE_STATUSES, PRIORITY_ORDER, TASK_PRIORITY_RANK, htmlToText, isOverdue, type Task, type TaskPriority, type TaskStatus } from './model'

export type Category = 'active' | 'done' | 'canceled'
export type DueFilter = 'overdue' | 'today' | 'week' | 'none'
export type SortKey = 'recent' | 'oldest' | 'due' | 'priority' | 'updated' | 'title'

export const CATEGORY_LABEL: Record<Category, string> = { active: 'Ativas', done: 'Concluídas', canceled: 'Canceladas' }
export const CATEGORY_STATUSES: Record<Category, TaskStatus[]> = { active: ACTIVE_STATUSES, done: ['done'], canceled: ['canceled'] }
export const DUE_LABEL: Record<DueFilter, string> = { overdue: 'Atrasadas', today: 'Vencem hoje', week: 'Próximos 7 dias', none: 'Sem data' }
export const SORT_LABEL: Record<SortKey, string> = {
  recent: 'Mais recentes',
  oldest: 'Mais antigas',
  due: 'Data de vencimento',
  priority: 'Prioridade',
  updated: 'Última atualização',
  title: 'Título (A–Z)',
}
export const ORIGIN_LABEL = { ai: 'Criadas pela IA', user: 'Criadas por pessoas' } as const

export interface TaskFilters {
  q: string
  categories: Category[]
  mine: boolean
  priorities: TaskPriority[]
  /** ids de usuário; 'none' = sem responsável */
  assignees: (ID | 'none')[]
  tags: string[]
  origin: ('ai' | 'user')[]
  due: DueFilter[]
  sort: SortKey
}

export const DEFAULT_FILTERS: TaskFilters = {
  q: '', categories: ['active'], mine: true, priorities: [], assignees: [], tags: [], origin: [], due: [], sort: 'recent',
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
const list = (v: string | null) => (v ? v.split(',').map(safeDecode).filter(Boolean) : [])
const pickValid = <T extends string>(vals: string[], valid: readonly T[]) => vals.filter((v): v is T => (valid as readonly string[]).includes(v))

const CAT_PARAM: Record<Category, string> = { active: 'ativas', done: 'concluidas', canceled: 'canceladas' }
const PRIO_PARAM: Record<TaskPriority, string> = { none: 'sem', low: 'baixa', medium: 'media', high: 'alta' }
const DUE_PARAM: Record<DueFilter, string> = { overdue: 'atrasadas', today: 'hoje', week: 'semana', none: 'sem-data' }
const SORT_PARAM: Record<SortKey, string> = { recent: 'recentes', oldest: 'antigas', due: 'vencimento', priority: 'prioridade', updated: 'atualizadas', title: 'titulo' }
const ORIGIN_PARAM = { ai: 'ia', user: 'pessoas' } as const
const inv = <K extends string>(m: Record<K, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, K>

export function filtersFromParams(p: URLSearchParams): TaskFilters {
  const cat = p.get('cat')
  const catInv = inv(CAT_PARAM)
  const prioInv = inv(PRIO_PARAM)
  const dueInv = inv(DUE_PARAM)
  const originInv = inv(ORIGIN_PARAM)
  return {
    q: p.get('q') ?? '',
    categories: cat === null ? DEFAULT_FILTERS.categories : list(cat).map((c) => catInv[c]!).filter(Boolean),
    mine: p.get('minhas') === null ? DEFAULT_FILTERS.mine : p.get('minhas') === '1',
    priorities: pickValid(list(p.get('prioridade')).map((v) => prioInv[v] ?? ''), PRIORITY_ORDER),
    assignees: list(p.get('responsavel')),
    tags: list(p.get('tag')),
    origin: pickValid(list(p.get('origem')).map((v) => originInv[v] ?? ''), ['ai', 'user'] as const),
    due: pickValid(list(p.get('venc')).map((v) => dueInv[v] ?? ''), ['overdue', 'today', 'week', 'none'] as const),
    sort: inv(SORT_PARAM)[p.get('ordem') ?? ''] ?? DEFAULT_FILTERS.sort,
  }
}

/** Serializa somente o que difere do padrão (URL curta). */
export function filtersToParams(f: TaskFilters): URLSearchParams {
  const p = new URLSearchParams()
  const enc = (vals: string[]) => vals.map((v) => encodeURIComponent(v)).join(',')
  if (f.q.trim()) p.set('q', f.q)
  const sameCats = f.categories.length === DEFAULT_FILTERS.categories.length && f.categories.every((c) => DEFAULT_FILTERS.categories.includes(c))
  if (!sameCats) p.set('cat', f.categories.map((c) => CAT_PARAM[c]).join(','))
  if (f.mine !== DEFAULT_FILTERS.mine) p.set('minhas', f.mine ? '1' : '0')
  if (f.priorities.length) p.set('prioridade', f.priorities.map((v) => PRIO_PARAM[v]).join(','))
  if (f.assignees.length) p.set('responsavel', enc(f.assignees))
  if (f.tags.length) p.set('tag', enc(f.tags))
  if (f.origin.length) p.set('origem', f.origin.map((v) => ORIGIN_PARAM[v]).join(','))
  if (f.due.length) p.set('venc', f.due.map((v) => DUE_PARAM[v]).join(','))
  if (f.sort !== DEFAULT_FILTERS.sort) p.set('ordem', SORT_PARAM[f.sort])
  return p
}

function dueMatches(t: Task, due: DueFilter[], now: Date) {
  if (!due.length) return true
  const startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  const endToday = startToday.getTime() + 86400000
  const ms = t.dueAt ? new Date(t.dueAt).getTime() : null
  return due.some((d) => {
    if (d === 'none') return ms === null
    if (ms === null) return false
    if (d === 'overdue') return isOverdue(t, now.getTime())
    if (d === 'today') return ms >= startToday.getTime() && ms < endToday
    return ms >= now.getTime() && ms < now.getTime() + 7 * 86400000
  })
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function applyFilters(tasks: Task[], f: TaskFilters, ctx: { userId: ID | null; nameOf: (id?: ID) => string }, now = new Date()): Task[] {
  const q = fold(f.q.trim())
  const statuses = new Set(f.categories.flatMap((c) => CATEGORY_STATUSES[c]))
  const out = tasks.filter((t) => {
    if (f.categories.length && !statuses.has(t.status)) return false
    if (f.mine && t.assigneeUserId !== ctx.userId) return false
    if (f.priorities.length && !f.priorities.includes(t.priority)) return false
    if (f.assignees.length && !f.assignees.includes(t.assigneeUserId ?? 'none')) return false
    if (f.tags.length && !f.tags.some((tag) => t.tags.includes(tag))) return false
    if (f.origin.length && !f.origin.includes(t.createdBy)) return false
    if (!dueMatches(t, f.due, now)) return false
    if (q) {
      const hay = fold([t.title, htmlToText(t.description), t.tags.join(' '), t.assigneeUserId ? ctx.nameOf(t.assigneeUserId) : ''].join(' '))
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false
    }
    return true
  })
  const byDate = (a?: string, b?: string) => (a ?? '').localeCompare(b ?? '')
  const cmp: Record<SortKey, (a: Task, b: Task) => number> = {
    recent: (a, b) => byDate(b.createdAt, a.createdAt),
    oldest: (a, b) => byDate(a.createdAt, b.createdAt),
    // sem data por último
    due: (a, b) => (a.dueAt ? (b.dueAt ? byDate(a.dueAt, b.dueAt) : -1) : b.dueAt ? 1 : byDate(b.createdAt, a.createdAt)),
    priority: (a, b) => TASK_PRIORITY_RANK[b.priority] - TASK_PRIORITY_RANK[a.priority] || byDate(b.createdAt, a.createdAt),
    updated: (a, b) => byDate(b.updatedAt, a.updatedAt),
    title: (a, b) => a.title.localeCompare(b.title, 'pt-BR'),
  }
  return out.sort(cmp[f.sort])
}

export function activeFilterCount(f: TaskFilters) {
  return (
    (f.categories.length ? 1 : 0) + (f.mine ? 1 : 0) + (f.priorities.length ? 1 : 0) + (f.assignees.length ? 1 : 0) + (f.tags.length ? 1 : 0) + (f.origin.length ? 1 : 0) + (f.due.length ? 1 : 0)
  )
}
