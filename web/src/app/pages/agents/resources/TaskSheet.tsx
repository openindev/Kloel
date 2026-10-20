import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Check, ChevronsUpDown, FlaskConical, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/tasks'
import { DEFAULT_TASK_INSTRUCTIONS, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, type TaskAbilityConfig, type TaskAbilityRule, type TaskPriority, type TaskStatus } from '@/domain/ext/tasks'
import { cn, uid } from '@/lib/utils'
import { useCollection, useStore } from '@/data/store'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  AI_TAG, MAX_TASK_TAGS, PRIORITY_ORDER, STATUS_ORDER, createTaskFromConversation, defaultTaskAbility, draftFromConversation, mergeTags, normalizeTag,
  useKnownTags, useMembers,
} from '@/app/pages/tasks/model'
import { ComboSelect, EditableTitle, Field, SectionCaps, SheetFooter, SheetSegmented } from './shared/ui'
import { saveAgent } from './shared/hooks'
import type { ResourceProps } from './shared/listView'

const MAX_RULES = 20
const DEFAULT_NAME = 'Criar tarefa'

type RuleErrors = Record<string, string | undefined>

/** Seletor múltiplo de tags (TK-V04 "Adicionar tags ⇕"): escolhe entre as tags existentes ou cria uma nova. */
function TagsSelect({ value, onChange, known, id, invalid }: { value: string[]; onChange: (v: string[]) => void; known: string[]; id?: string; invalid?: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const typed = normalizeTag(q)
  const all = useMemo(() => mergeTags(value, known), [value, known])
  const canCreate = !!typed && !all.some((t) => t.toLowerCase() === typed.toLowerCase())
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : mergeTags(value, [t]))
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o || setQ(''))}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm focus:outline-none focus:ring-1 focus:ring-ring',
            !value.length && 'text-muted-foreground',
            invalid && 'border-destructive',
          )}
        >
          <span className="truncate">{value.length ? value.join(', ') : 'Selecionar...'}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput
            placeholder="Buscar ou criar tag…"
            value={q}
            onValueChange={setQ}
            maxLength={40}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) {
                e.preventDefault()
                onChange(mergeTags(value, [typed]))
                setQ('')
              }
            }}
          />
          <CommandList>
            <CommandEmpty className="py-5 text-center text-xs text-muted-foreground">{typed ? 'Pressione Enter para criar a tag.' : 'Nenhuma tag.'}</CommandEmpty>
            {canCreate && (
              <CommandGroup>
                <CommandItem
                  value={`__criar ${typed}`}
                  disabled={value.length >= MAX_TASK_TAGS}
                  onSelect={() => {
                    onChange(mergeTags(value, [typed]))
                    setQ('')
                  }}
                >
                  <Plus className="size-4" /> Criar “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {all.map((t) => (
                <CommandItem key={t} value={t} onSelect={() => toggle(t)}>
                  <span className="flex-1 truncate">{t}</span>
                  {value.includes(t) && <Check className="size-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Habilidade "Criar tarefa" dos assistentes de chat (Central de ajuda TK-V04/TK-V05): "CONFIGURAÇÕES DA TAREFA" com
 * Instruções da tarefa, Status inicial e o switch "Adicionar atribuições, tags ou prioridades" com blocos de regra
 * (Adicionar tags, Atribuir a, Definir prioridade, Quando: Sempre | Somente se…). Salvar grava `agent.taskActions`
 * e ativa o cartão; a lixeira do rodapé remove a habilidade (com confirmação).
 * A seção "Simular" (INFERIDO) cria uma tarefa de teste a partir de uma conversa deste assistente com o rascunho atual.
 */
export function TaskResource({ agent, open, onOpenChange }: ResourceProps) {
  const saved = agent.taskActions
  const initial = saved ?? defaultTaskAbility()
  const members = useMembers()
  const known = useKnownTags()
  const conversations = useCollection('conversations')
  const [name, setName] = useState(initial.name ?? DEFAULT_NAME)
  const [instructions, setInstructions] = useState(initial.instructions || DEFAULT_TASK_INSTRUCTIONS)
  const [initialStatus, setInitialStatus] = useState<TaskStatus>(initial.initialStatus)
  const [rulesEnabled, setRulesEnabled] = useState(initial.rulesEnabled)
  const [rules, setRules] = useState<TaskAbilityRule[]>(initial.rules)
  const [errors, setErrors] = useState<RuleErrors>({})
  const [confirmRemove, setConfirmRemove] = useState(false)
  const agentConvs = useMemo(
    () => conversations.filter((c) => c.agentId === agent.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 25),
    [conversations, agent.id],
  )
  const [simConv, setSimConv] = useState<string>(agentConvs[0]?.id ?? '')
  /** última tarefa de teste criada nesta sessão da folha (o toast fica sob o painel modal; o link fica aqui) */
  const [simulated, setSimulated] = useState<{ id: string; title: string } | null>(null)

  const draft = (): TaskAbilityConfig => ({
    enabled: true,
    name: name.trim() || DEFAULT_NAME,
    instructions: instructions.trim(),
    initialStatus,
    rulesEnabled,
    rules: rules.map((r) => ({ ...r, condition: r.when === 'only_if' ? r.condition?.trim() ?? '' : undefined })),
    updatedAt: new Date().toISOString(),
  })

  const setRule = (id: string, patch: Partial<TaskAbilityRule>) => {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setErrors((e) => ({ ...e, [id]: undefined, [`${id}:cond`]: undefined }))
  }
  const addRule = (preset?: Partial<TaskAbilityRule>) => setRules((rs) => [...rs, { id: uid('tkr'), tags: [], when: 'always', ...preset }])

  const validate = () => {
    const e: RuleErrors = {}
    if (!instructions.trim()) e.instructions = 'Descreva o que o título e a descrição da tarefa devem conter.'
    if (rulesEnabled) {
      if (!rules.length) e.rules = 'Adicione pelo menos uma regra ou desligue esta opção.'
      for (const r of rules) {
        if (!r.tags.length && !r.assigneeUserId && (!r.priority || r.priority === 'none')) e[r.id] = 'Defina tags, um responsável ou uma prioridade nesta regra.'
        if (r.when === 'only_if' && !r.condition?.trim()) e[`${r.id}:cond`] = 'Descreva quando a regra se aplica.'
      }
    }
    setErrors(e)
    return !Object.values(e).some(Boolean)
  }

  const save = async () => {
    try {
    if (!validate()) {
      toast.error('Corrija os campos destacados.')
      return
    }
    toast.error('A criação automática de tarefas ainda não está disponível.')
      } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
  }

  const simConversation = agentConvs.find((c) => c.id === simConv)
  const preview = useMemo<ReturnType<typeof draftFromConversation> | null>(() => null, [])

  const simulate = () => {
    if (!simConversation) return
    if (!validate()) {
      toast.error('Corrija os campos destacados antes de simular.')
      return
    }
    toast.error('O teste de criação de tarefas ainda não está disponível.')
  }

  // valor vazio mostra o placeholder "Selecionar..." (TK-V04); a opção NONE limpa a escolha
  const NONE = '__nenhum'
  const memberOptions = [{ value: NONE, label: 'Ninguém' }, ...members.map((m) => ({ value: m.id, label: m.name }))]
  const priorityOptions = [{ value: NONE, label: 'Não alterar' }, ...[...PRIORITY_ORDER].filter((p) => p !== 'none').reverse().map((p) => ({ value: p, label: TASK_PRIORITY_LABEL[p] }))]

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={<EditableTitle value={name} onChange={setName} />}
      footer={
        <SheetFooter
          onSave={save}
          onCancel={() => onOpenChange(false)}
          left={
            saved?.enabled && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover habilidade" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmRemove(true)}>
                <Trash2 className="size-4" />
              </Button>
            )
          }
        />
      }
    >
      <div className="flex flex-col gap-6" data-testid="task-sheet">
        <SectionCaps className="pt-0 text-xs">Configurações da tarefa</SectionCaps>
        <Field label="Instruções da tarefa" htmlFor="task-instructions" hint="Descreva o que o título e a descrição da tarefa devem conter." error={errors.instructions}>
          <Textarea
            id="task-instructions"
            value={instructions}
            onChange={(e) => (setInstructions(e.target.value), setErrors((x) => ({ ...x, instructions: undefined })))}
            aria-invalid={!!errors.instructions || undefined}
            className="min-h-20"
            maxLength={2000}
          />
        </Field>
        <Field label="Status inicial" htmlFor="task-initial-status">
          <ComboSelect<TaskStatus>
            id="task-initial-status"
            value={initialStatus}
            onChange={setInitialStatus}
            options={STATUS_ORDER.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s] }))}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex min-h-6 items-center justify-between gap-4">
            <label htmlFor="task-rules-switch" className="text-sm font-medium leading-none">
              Adicionar atribuições, tags ou prioridades
            </label>
            <Switch
              id="task-rules-switch"
              checked={rulesEnabled}
              onCheckedChange={(on) => {
                setRulesEnabled(on)
                setErrors((x) => ({ ...x, rules: undefined }))
                // TK-V04: a primeira regra observada aplica "Criada por IA" sempre
                if (on && !rules.length) addRule({ tags: [AI_TAG], when: 'always' })
              }}
            />
          </div>
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <p>
              Use regras para atribuir tarefas, adicionar tags ou definir prioridades. Uma regra pode valer sempre que uma tarefa for criada ou somente quando a IA
              concluir que a conversa atende à condição.
            </p>
            <div>
              <p>Quando várias regras se aplicam:</p>
              <ul className="list-disc pl-4">
                <li>As tags correspondentes são combinadas, mantendo até 50 tags distintas na ordem das regras.</li>
                <li>O primeiro responsável correspondente é usado.</li>
                <li>A maior prioridade correspondente é usada.</li>
              </ul>
            </div>
          </div>
        </div>

        {rulesEnabled && (
          <div className="flex flex-col gap-6" data-testid="task-rules">
            {rules.map((r, i) => (
              <div key={r.id} className="flex gap-3 border-l pl-4" data-testid="task-rule">
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  <Field label="Adicionar tags" htmlFor={`${r.id}-tags`}>
                    <TagsSelect id={`${r.id}-tags`} value={r.tags} onChange={(tags) => setRule(r.id, { tags })} known={known} invalid={!!errors[r.id]} />
                  </Field>
                  <Field label="Atribuir a" htmlFor={`${r.id}-assignee`}>
                    <ComboSelect<string>
                      id={`${r.id}-assignee`}
                      value={r.assigneeUserId ?? ''}
                      onChange={(v) => setRule(r.id, { assigneeUserId: v === NONE ? undefined : v })}
                      options={memberOptions}
                      placeholder="Selecionar..."
                    />
                  </Field>
                  <Field label="Definir prioridade" htmlFor={`${r.id}-priority`}>
                    <ComboSelect<string>
                      id={`${r.id}-priority`}
                      value={r.priority && r.priority !== 'none' ? r.priority : ''}
                      onChange={(v) => setRule(r.id, { priority: v === NONE ? undefined : (v as TaskPriority) })}
                      options={priorityOptions}
                      placeholder="Selecionar..."
                    />
                  </Field>
                  <Field
                    label="Quando"
                    aside={
                      <SheetSegmented<TaskAbilityRule['when']>
                        ariaLabel={`Quando aplicar a regra ${i + 1}`}
                        value={r.when}
                        onChange={(when) => setRule(r.id, { when })}
                        options={[
                          { value: 'always', label: 'Sempre' },
                          { value: 'only_if', label: 'Somente se...' },
                        ]}
                      />
                    }
                    error={errors[`${r.id}:cond`] ?? errors[r.id]}
                  >
                    {r.when === 'only_if' && (
                      <Textarea
                        aria-label={`Condição da regra ${i + 1}`}
                        value={r.condition ?? ''}
                        onChange={(e) => setRule(r.id, { condition: e.target.value })}
                        placeholder="O cliente pede um retorno."
                        aria-invalid={!!errors[`${r.id}:cond`] || undefined}
                        className="min-h-16"
                        maxLength={500}
                      />
                    )}
                  </Field>
                </div>
                <button
                  type="button"
                  aria-label={`Remover regra ${i + 1}`}
                  onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}
                  className="mt-7 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {errors.rules && <p className="text-sm font-medium text-destructive">{errors.rules}</p>}
            <button
              type="button"
              onClick={() => addRule()}
              disabled={rules.length >= MAX_RULES}
              className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              data-testid="task-add-rule"
            >
              <Plus className="size-4" /> Adicionar regra
            </button>
          </div>
        )}

        {/* INFERIDO: teste local das regras com uma conversa deste assistente */}
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4" data-testid="task-simulate">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Simular com uma conversa</span>
          </div>
          {agentConvs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Este assistente ainda não tem conversas para simular.</p>
          ) : (
            <>
              <ComboSelect<string>
                ariaLabel="Conversa para simular"
                value={simConv}
                onChange={setSimConv}
                options={agentConvs.map((c) => ({ value: c.id, label: `${c.title || 'Sem assunto'} · ${format(new Date(c.startedAt), 'dd/MM HH:mm')}` }))}
              />
              {preview && (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Título</dt>
                  <dd className="truncate">{preview.title}</dd>
                  <dt className="text-muted-foreground">Estado</dt>
                  <dd>{TASK_STATUS_LABEL[preview.status ?? initialStatus]}</dd>
                  <dt className="text-muted-foreground">Regras aplicadas</dt>
                  <dd>{rulesEnabled ? (preview.outcome.applied.length ? preview.outcome.applied.map((n) => `#${n + 1}`).join(', ') : 'nenhuma') : 'desligadas'}</dd>
                  <dt className="text-muted-foreground">Tags</dt>
                  <dd className="truncate">{preview.outcome.tags.join(', ') || '—'}</dd>
                  <dt className="text-muted-foreground">Responsável</dt>
                  <dd>{members.find((m) => m.id === preview.outcome.assigneeUserId)?.name ?? '—'}</dd>
                  <dt className="text-muted-foreground">Prioridade</dt>
                  <dd>{TASK_PRIORITY_LABEL[preview.outcome.priority]}</dd>
                </dl>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button type="button" variant="outline" size="xs" className="w-fit" onClick={simulate} data-testid="task-simulate-run">
                  Criar tarefa de teste
                </Button>
                {simulated && (
                  <span className="min-w-0 text-xs" data-testid="task-simulate-result">
                    Criada:{' '}
                    <Link to={`/app/tasks/${simulated.id}?minhas=0&cat=`} className="font-medium text-brand hover:underline">
                      {simulated.title}
                    </Link>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remover a habilidade “Criar tarefa”?"
        description="O assistente deixa de criar tarefas a partir das conversas. As tarefas já criadas continuam em Tarefas."
        confirmLabel="Remover"
        onConfirm={async () => {
          await saveAgent(agent, (a) => ({ taskActions: { ...(a.taskActions ?? defaultTaskAbility()), enabled: false } }))
          toast.success('Habilidade “Criar tarefa” removida.')
          onOpenChange(false)
        }}
      />
    </SideSheet>
  )
}
