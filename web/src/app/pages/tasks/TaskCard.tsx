import type { KeyboardEvent } from 'react'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDue, isOverdue, updateTask, type Member, type Task } from './model'
import { AssigneeMenu, PriorityMenu, StatusMenu, TagChip } from './ui'

/**
 * Cartão da lista (TK-V03): "● Em andamento ⌄" + chip de prioridade ⌄ + avatar do responsável ⌄; título; chips de tag;
 * vencimento com ícone de calendário à direita. Selecionado = borda escura. Os menus alteram a tarefa sem abri-la.
 */
export function TaskCard({ task, selected, members, onSelect }: { task: Task; selected: boolean; members: Member[]; onSelect: () => void }) {
  const overdue = isOverdue(task)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      data-task-id={task.id}
      data-testid="task-card"
      onClick={onSelect}
      onKeyDown={onKey}
      className={cn(
        'cursor-pointer rounded-xl border bg-white px-3 pb-3 pt-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-neutral-800 ring-1 ring-neutral-800' : 'border-border hover:border-neutral-300',
      )}
    >
      <div className="flex items-center gap-1">
        <StatusMenu value={task.status} onChange={(status) => updateTask(task.id, { status })} className="-ml-1.5" testId="card-status" />
        <PriorityMenu value={task.priority} onChange={(priority) => updateTask(task.id, { priority })} testId="card-priority" />
        <span className="flex-1" />
        <AssigneeMenu variant="compact" value={task.assigneeUserId} onChange={(assigneeUserId) => updateTask(task.id, { assigneeUserId })} members={members} testId="card-assignee" />
      </div>
      <p className={cn('mt-2 line-clamp-2 text-[13px] font-medium leading-snug', task.status === 'canceled' && 'text-muted-foreground line-through')}>{task.title}</p>
      {(task.tags.length > 0 || task.dueAt) && (
        <div className="mt-2.5 flex flex-wrap items-end gap-1.5">
          {task.tags.slice(0, 6).map((t) => (
            <TagChip key={t} label={t} />
          ))}
          {task.tags.length > 6 && <span className="inline-flex h-6 items-center px-1 text-[11px] text-muted-foreground">+{task.tags.length - 6}</span>}
          {task.dueAt && (
            <span
              className={cn('ml-auto inline-flex h-6 items-center gap-1 whitespace-nowrap text-[11px] tabular-nums', overdue ? 'font-medium text-red-600' : 'text-muted-foreground')}
              title={overdue ? 'Vencida' : 'Data de vencimento'}
            >
              <CalendarDays className="size-3" />
              {formatDue(task.dueAt)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
