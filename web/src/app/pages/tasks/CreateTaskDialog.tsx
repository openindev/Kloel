import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/data/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  MAX_TITLE, PRIORITY_ORDER, STATUS_ORDER, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, createTask, mergeTags, useKnownTags,
  type Member, type Task, type TaskPriority, type TaskStatus,
} from './model'
import { AssigneeMenu, DescriptionEditor, DueDatePicker, StatusDot, TagAdder, TagChip } from './ui'

/**
 * Modal "Criar tarefa" (TK-V01/TK-V02): Título ("O que precisa ser feito?") + Responsável (usuário atual por padrão);
 * Descrição (rich text); Estado ("Selecione um estado" → A fazer quando vazio) + Prioridade ("Sem prioridade");
 * Data de vencimento ("Selecione a data..."); Tags ("+ Adicionar tags"); rodapé Cancelar + Criar tarefa.
 */
export function CreateTaskDialog({
  open,
  onOpenChange,
  members,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  members: Member[]
  onCreated: (t: Task) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-y-5 sm:max-w-[520px]" data-testid="create-task-dialog">
        {/* formulário remontado a cada abertura: rascunho descartado ao cancelar */}
        {open && <CreateTaskForm members={members} onCancel={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateTaskForm({ members, onCancel, onCreated }: { members: Member[]; onCancel: () => void; onCreated: (t: Task) => void }) {
  const me = useCurrentUser()
  const known = useKnownTags()
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState<string | undefined>(members.some((m) => m.id === me?.id) ? me?.id : undefined)
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskStatus | ''>('')
  const [priority, setPriority] = useState<TaskPriority>('none')
  const [dueAt, setDueAt] = useState<string | undefined>()
  const [tags, setTags] = useState<string[]>([])
  const [error, setError] = useState('')

  const submit = () => {
    const t = title.trim()
    if (!t) {
      setError('Informe o título da tarefa.')
      document.getElementById('new-task-title')?.focus()
      return
    }
    try {
      const task = createTask({ title: t, description, status: status || 'todo', priority, assigneeUserId: assignee, dueAt, tags, createdBy: 'user' })
      toast.success('Tarefa criada.'); onCreated(task)
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível criar a tarefa.') }
  }

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>Criar tarefa</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-task-title">Título</Label>
            <Input
              id="new-task-title"
              autoFocus
              value={title}
              maxLength={MAX_TITLE}
              placeholder="O que precisa ser feito?"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'new-task-title-error' : undefined}
              className={cn(error && 'border-destructive')}
              onChange={(e) => (setTitle(e.target.value), error && setError(''))}
            />
            {error && (
              <p id="new-task-title-error" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="new-task-assignee">Responsável</Label>
            <AssigneeMenu id="new-task-assignee" value={assignee} onChange={setAssignee} members={members} className="w-full" testId="new-task-assignee" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Descrição</Label>
          <DescriptionEditor value={description} onChange={setDescription} minHeight={84} testId="new-task-description" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-task-status">Estado</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
              <SelectTrigger id="new-task-status" data-testid="new-task-status">
                <SelectValue placeholder="Selecione um estado" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="inline-flex items-center gap-2">
                      <StatusDot status={s} className="size-2" />
                      {TASK_STATUS_LABEL[s]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-task-priority">Prioridade</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger id="new-task-priority" data-testid="new-task-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_ORDER.map((p) => (
                  <SelectItem key={p} value={p}>
                    {TASK_PRIORITY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-task-due">Data de vencimento</Label>
          <DueDatePicker id="new-task-due" value={dueAt} onChange={setDueAt} testId="new-task-due" />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Tags</Label>
          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5" data-testid="new-task-tags">
            {tags.map((t) => (
              <TagChip key={t} label={t} onRemove={() => setTags(tags.filter((x) => x !== t))} />
            ))}
            <TagAdder tags={tags} known={known} onAdd={(t) => setTags(mergeTags(tags, [t]))} label="Adicionar tags" testId="new-task-add-tag" />
          </div>
        </div>
      </div>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" data-testid="new-task-submit">
          Criar tarefa
        </Button>
      </DialogFooter>
    </form>
  )
}
