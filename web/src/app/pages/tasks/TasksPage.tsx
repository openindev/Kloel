import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CircleCheck, ListChecks, Plus, SearchX, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/tasks'
import { cn } from '@/lib/utils'
import { useCurrentOrg, useCurrentRole, useStore, useUi } from '@/data/store'
import { Button } from '@/components/ui/button'
import { BetaBadge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ensureTasksSeeded, setTasksBeta, useKnownTags, useMembers, useTask, useTasks, userName, type Task } from './model'
import { DEFAULT_FILTERS, applyFilters, filtersFromParams, filtersToParams, type TaskFilters } from './filters'
import { FilterBar } from './FilterBar'
import { TaskCard } from './TaskCard'
import { TaskDetail } from './TaskDetail'
import { CreateTaskDialog } from './CreateTaskDialog'

/**
 * Tarefas (BETA) — Central de ajuda products/tasks, quadros TK-V01…TK-V03.
 * Rotas: /app/tasks (lista + painel vazio) e /app/tasks/:taskId (detalhe). Busca, filtros e ordenação ficam na query
 * string e os últimos usados são lembrados (ui.tasks.query). Sem o BETA ativado mostra o cartão de ativação (INFERIDO).
 */
export default function TasksPage() {
  const org = useCurrentOrg()
  const enabled = org?.betaFeatures?.tasks === true
  const hasCollection = useStore((s) => s.db.tasks !== undefined)
  useEffect(() => {
    if (enabled && !hasCollection) ensureTasksSeeded()
  }, [enabled, hasCollection])
  if (!org) return null
  return enabled ? <TasksWorkspace /> : <BetaGate />
}

/* ------------------------------------------------------------------ */
/* Cartão de ativação (INFERIDO)                                       */
/* ------------------------------------------------------------------ */

function BetaGate() {
  const role = useCurrentRole()
  const canEnable = role === 'admin' || role === 'editor'
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-white px-4 py-10" data-testid="tasks-beta-gate">
      <div className="w-full max-w-[520px] rounded-xl border bg-white p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
          <ListChecks className="size-5 text-foreground" />
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Tarefas está em BETA</h1>
          <BetaBadge />
        </div>
        <p className="mx-auto mt-2 max-w-[400px] text-sm text-muted-foreground">
          Acompanhe os pedidos dos seus clientes como tarefas, com estado, prioridade, responsável, prazo e histórico. Assistentes de chat podem criar tarefas
          automaticamente com a habilidade “Criar tarefa”.
        </p>
        <ul className="mx-auto mt-4 flex max-w-[360px] flex-col gap-1.5 text-left text-sm">
          <li className="flex items-start gap-2">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> Lista com filtros, busca e ordenação
          </li>
          <li className="flex items-start gap-2">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> Atividade registrada a cada alteração
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" /> Tarefas criadas pela IA a partir das conversas
          </li>
        </ul>
        <Button
          className="mt-6"
          disabled={!canEnable}
          data-testid="tasks-enable"
          onClick={() => {
            setTasksBeta(true)
          }}
        >
          Ativar Tarefas (BETA)
        </Button>
        {!canEnable && <p className="mt-2 text-xs text-muted-foreground">Somente administradores e editores podem ativar recursos em BETA.</p>}
        <p className="mt-4 text-xs text-muted-foreground">
          <Link to="/ajuda/products/tasks" className="underline underline-offset-2 hover:text-foreground">
            Saiba mais na Central de ajuda
          </Link>
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Lista + detalhe                                                     */
/* ------------------------------------------------------------------ */

function TasksWorkspace() {
  const { taskId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tasks = useTasks()
  const members = useMembers()
  const knownTags = useKnownTags()
  const selected = useTask(taskId)
  const userId = useStore((s) => s.db.session.userId)
  const db = useStore((s) => s.db)
  const savedQuery = useUi().tasks?.query
  const [creating, setCreating] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // últimos filtros: ao chegar sem query string (ex.: pela barra lateral), restaura os filtros usados por último
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (!location.search && savedQuery) navigate({ pathname: location.pathname, search: `?${savedQuery}` }, { replace: true })
  }, [location.pathname, location.search, navigate, savedQuery])

  const filters = useMemo(() => filtersFromParams(params), [params])
  const query = params.toString()
  const suffix = query ? `?${query}` : ''

  const setFilters = useCallback(
    (f: TaskFilters) => {
      const next = filtersToParams(f)
      setParams(next, { replace: true })
      const { setUi, db: cur } = useStore.getState()
      setUi({ tasks: { ...(cur.ui.tasks ?? {}), query: next.toString() } })
    },
    [setParams],
  )

  const visible = useMemo(() => applyFilters(tasks, filters, { userId, nameOf: (id) => userName(db, id) }), [tasks, filters, userId, db])
  const hiddenByFilters = tasks.length > 0 && visible.length === 0

  const open = (t: Task) => navigate(`/app/tasks/${t.id}${suffix}`)
  const closeDetail = () => navigate(`/app/tasks${suffix}`)

  // mantém o cartão selecionado visível ao navegar por URL
  useEffect(() => {
    if (!taskId) return
    const el = listRef.current?.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ block: 'nearest' })
  }, [taskId])

  const onCreated = (t: Task) => {
    setCreating(false)
    navigate(`/app/tasks/${t.id}${suffix}`)
    const shown = applyFilters([t], filters, { userId, nameOf: (id) => userName(useStore.getState().db, id) }).length > 0
    if (!shown)
      toast('A nova tarefa não aparece na lista por causa dos filtros atuais.', {
        action: { label: 'Limpar filtros', onClick: () => setFilters({ ...DEFAULT_FILTERS, categories: [], mine: false }) },
      })
  }

  return (
    <div className="flex min-h-0 flex-1 bg-white" data-testid="tasks-page">
      {/* coluna "Tarefas" */}
      <section className={cn('flex min-h-0 w-full shrink-0 flex-col border-r md:w-[360px]', taskId && 'max-md:hidden')} aria-label="Lista de tarefas">
        <div className="flex flex-col gap-3 border-b px-3 pb-3 pt-4">
          <div className="flex items-center justify-between px-1">
            <h1 className="text-[18px] font-semibold tracking-tight">Tarefas</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Criar tarefa"
                  data-testid="tasks-new"
                  onClick={() => setCreating(true)}
                  className="inline-flex size-8 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-800"
                >
                  <Plus className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Criar tarefa</TooltipContent>
            </Tooltip>
          </div>
          <FilterBar filters={filters} onChange={setFilters} members={members} tags={knownTags} />
        </div>
        <div ref={listRef} role="listbox" aria-label="Tarefas" className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="tasks-list">
          {visible.length === 0 ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center">
              {hiddenByFilters && <SearchX className="size-5 text-muted-foreground" />}
              <p className="text-xs text-muted-foreground">Nenhuma tarefa encontrada.</p>
              {hiddenByFilters && (
                <Button variant="outline" size="xs" onClick={() => setFilters({ ...DEFAULT_FILTERS, categories: [], mine: false })}>
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((t) => (
                <TaskCard key={t.id} task={t} selected={t.id === taskId} members={members} onSelect={() => open(t)} />
              ))}
            </div>
          )}
        </div>
        <div className="flex h-9 shrink-0 items-center border-t px-4 text-[11.5px] text-muted-foreground" data-testid="tasks-count">
          <span className="font-medium tabular-nums text-foreground">{visible.length}</span>&nbsp;de {tasks.length} tarefas
        </div>
      </section>

      {/* painel direito */}
      <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto', !taskId && 'max-md:hidden')} aria-label="Detalhe da tarefa">
        {taskId && selected ? (
          <TaskDetail
            key={selected.id}
            task={selected}
            members={members}
            onDeleted={() => navigate(`/app/tasks${suffix}`, { replace: true })}
            onDuplicated={(copy) => open(copy)}
            onBack={closeDetail}
          />
        ) : taskId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center" data-testid="task-not-found">
            <SearchX className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Tarefa não encontrada</p>
            <p className="max-w-xs text-xs text-muted-foreground">Ela pode ter sido excluída ou pertencer a outra organização.</p>
            <Button variant="outline" size="xs" className="mt-2" onClick={() => navigate(`/app/tasks${suffix}`, { replace: true })}>
              Voltar para a lista
            </Button>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="flex w-full max-w-[560px] flex-col items-center rounded-xl border px-6 py-10 text-center" data-testid="tasks-empty-panel">
              <CircleCheck className="size-5 text-muted-foreground" />
              <p className="mt-3 text-base font-semibold">Selecione uma tarefa</p>
              <p className="mt-1 text-sm text-muted-foreground">Escolha uma tarefa na lista à esquerda ou crie uma nova.</p>
              <Button className="mt-4" size="sm" onClick={() => setCreating(true)} data-testid="tasks-empty-create">
                Criar tarefa
              </Button>
            </div>
          </div>
        )}
      </section>

      <CreateTaskDialog open={creating} onOpenChange={setCreating} members={members} onCreated={onCreated} />
    </div>
  )
}
