import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronLeft, Copy, ExternalLink, History, Link2, MessageCircle, MoreHorizontal, Sparkles, Tag, Trash2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useDB } from '@/data/store'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { MAX_TITLE, deleteTask, duplicateTask, formatActivityAt, mergeTags, updateTask, useKnownTags, type Member, type Task } from './model'
import { AssigneeMenu, Avatar, DescriptionEditor, DueDatePicker, PriorityMenu, SectionLabel, StatusMenu, TagAdder, TagChip } from './ui'

const CHANNEL_LABEL: Record<string, string> = { phone: 'Ligação', web: 'Chamada web', whatsapp: 'WhatsApp', webchat: 'Webchat' }

/**
 * Detalhe da tarefa (TK-V03): estado, prioridade e responsável no topo, menu "…", Título + Data de vencimento,
 * Descrição (rich text), Tags e Atividade (mais recente primeiro). Cada alteração grava no store e entra na Atividade.
 * O bloco "Origem" (conversa/contato/assistente) é INFERIDO: liga a tarefa à conversa em /app/inbox/<id>.
 */
export function TaskDetail({
  task,
  members,
  onDeleted,
  onDuplicated,
  onBack,
}: {
  task: Task
  members: Member[]
  onDeleted: () => void
  onDuplicated: (t: Task) => void
  /** volta para a lista (botão visível só no layout móvel) */
  onBack?: () => void
}) {
  const known = useKnownTags()
  const [title, setTitle] = useState(task.title)
  const [titleError, setTitleError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const conversation = useDB((db) => (task.conversationId ? db.conversations.find((c) => c.id === task.conversationId) : undefined))
  const contact = useDB((db) => (task.contactId ? db.contacts.find((c) => c.id === task.contactId) : undefined))
  const agent = useDB((db) => (task.agentId ? db.agents.find((a) => a.id === task.agentId) : undefined))
  const users = useDB((db) => db.users)

  const commitTitle = () => {
    const v = title.trim()
    setTitleError('')
    if (!v) {
      setTitle(task.title)
      toast.error('O título não pode ficar vazio. O título anterior foi mantido.')
      return
    }
    setTitle(v)
    if (v !== task.title) updateTask(task.id, { title: v })
  }

  const authorOf = (userId: Task['activity'][number]['userId']) => {
    if (userId === 'ai') return { name: agent ? `IA · ${agent.name}` : 'IA', ai: true as const }
    const m = members.find((x) => x.id === userId)
    if (m) return { name: m.name, member: m }
    const u = users.find((x) => x.id === userId)
    if (u) {
      const name = `${u.firstName} ${u.lastName}`.trim() || u.email
      return { name, member: { id: u.id, name, initials: name.slice(0, 2).toUpperCase(), email: u.email } }
    }
    return { name: userId ? 'Usuário removido' : 'Sistema' }
  }

  const copyLink = async () => {
    const url = `${window.location.origin}/app/tasks/${task.id}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link da tarefa copiado.')
    } catch {
      toast.error('Não foi possível copiar. Copie o endereço da barra do navegador.')
    }
  }

  const activity = [...task.activity].reverse()
  const hasOrigin = !!(task.conversationId || task.contactId || task.createdBy === 'ai')

  return (
    <div className="relative mx-auto w-full max-w-[860px] px-4 pb-16 pt-4 sm:px-8 lg:px-12" data-testid="task-detail">
      <div className="flex h-9 items-center justify-between">
        {onBack ? (
          <button type="button" onClick={onBack} className="-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground md:invisible" data-testid="task-back">
            <ChevronLeft className="size-4" /> Tarefas
          </button>
        ) : (
          <span />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Mais ações da tarefa" data-testid="task-more" className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem
              onSelect={() => {
                const copy = duplicateTask(task.id)
                if (copy) {
                  toast.success('Tarefa duplicada.')
                  onDuplicated(copy)
                }
              }}
            >
              <Copy /> Duplicar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={copyLink}>
              <Link2 /> Copiar link
            </DropdownMenuItem>
            {conversation && (
              <DropdownMenuItem asChild>
                <Link to={`/app/inbox/${conversation.id}`}>
                  <MessageCircle /> Abrir conversa
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmDelete(true)} data-testid="task-delete">
              <Trash2 /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusMenu value={task.status} onChange={(status) => updateTask(task.id, { status })} testId="detail-status" />
        <PriorityMenu value={task.priority} onChange={(priority) => updateTask(task.id, { priority })} testId="detail-priority" />
        <span className="flex-1" />
        <AssigneeMenu value={task.assigneeUserId} onChange={(assigneeUserId) => updateTask(task.id, { assigneeUserId })} members={members} className="h-9 max-w-[220px]" testId="detail-assignee" />
      </div>

      <div className="mt-5 grid gap-x-2 gap-y-5 sm:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="task-title">Título</Label>
          <Input
            id="task-title"
            value={title}
            maxLength={MAX_TITLE}
            aria-invalid={!!titleError || undefined}
            className={cn(titleError && 'border-destructive')}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleError(e.target.value.trim() ? '' : 'O título não pode ficar vazio.')
            }}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setTitle(task.title)
                setTitleError('')
              }
            }}
          />
          {titleError && <p className="text-xs text-destructive">{titleError}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="task-due">Data de vencimento</Label>
          <DueDatePicker id="task-due" value={task.dueAt} onChange={(dueAt) => updateTask(task.id, { dueAt })} testId="detail-due" />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <Label>Descrição</Label>
        <DescriptionEditor value={task.description} onCommit={(description) => updateTask(task.id, { description })} minHeight={150} testId="detail-description" />
      </div>

      {hasOrigin && (
        <div className="mt-5 flex flex-col gap-2" data-testid="task-origin">
          <SectionLabel icon={<ExternalLink />}>Origem</SectionLabel>
          <div className="flex flex-col divide-y rounded-lg border text-sm">
            {task.conversationId && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5">
                <MessageCircle className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">Conversa</span>
                {conversation ? (
                  <Link to={`/app/inbox/${conversation.id}`} className="min-w-0 truncate font-medium text-brand hover:underline" data-testid="task-conversation-link">
                    {conversation.title || 'Sem assunto'}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Conversa removida</span>
                )}
                {conversation && (
                  <span className="text-xs text-muted-foreground">
                    {CHANNEL_LABEL[conversation.channel] ?? conversation.channel} · {format(new Date(conversation.startedAt), 'dd/MM/yyyy, HH:mm')}
                  </span>
                )}
              </div>
            )}
            {task.contactId && (
              <div className="flex items-center gap-2 px-3 py-2.5">
                <UserRound className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">Contato</span>
                {contact ? (
                  <Link to={`/app/contacts/${contact.id}`} className="truncate font-medium text-brand hover:underline">
                    {`${contact.firstName} ${contact.lastName}`.trim()}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Contato removido</span>
                )}
              </div>
            )}
            {task.createdBy === 'ai' && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <Sparkles className="size-4 text-brand" />
                <span>
                  Criada por IA{agent ? ' via ' : ''}
                  {agent && (
                    <Link to={`/app/agents/${agent.id}/general`} className="font-medium text-brand hover:underline">
                      {agent.name}
                    </Link>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2">
        <SectionLabel icon={<Tag />}>Tags</SectionLabel>
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5" data-testid="detail-tags">
          {task.tags.map((t) => (
            <TagChip key={t} label={t} onRemove={() => updateTask(task.id, { tags: task.tags.filter((x) => x !== t) })} />
          ))}
          <TagAdder tags={task.tags} known={known} onAdd={(t) => updateTask(task.id, { tags: mergeTags(task.tags, [t]) })} testId="detail-add-tag" />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-1">
        <SectionLabel icon={<History />}>Atividade</SectionLabel>
        <ol className="mt-1 flex flex-col" data-testid="task-activity">
          {activity.map((a) => {
            const who = authorOf(a.userId)
            return (
              <li key={a.id} className="flex flex-col gap-1.5 border-b py-3 last:border-b-0">
                <div className="flex items-center gap-2">
                  <Avatar member={'member' in who ? who.member : undefined} ai={'ai' in who} size={16} />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{who.name}</span>
                  <time dateTime={a.at} className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatActivityAt(a.at)}
                  </time>
                </div>
                <p className="break-words text-[13px]">{a.change}</p>
              </li>
            )
          })}
        </ol>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir tarefa?"
        description={`“${task.title}” e todo o histórico de atividade serão excluídos. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        onConfirm={() => {
          deleteTask(task.id)
          toast.success('Tarefa excluída.')
          onDeleted()
        }}
      />
    </div>
  )
}
