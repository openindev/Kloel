import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { CalendarDays, Check, CirclePlus, Clock, GripVertical, Info, List, Plus, ToggleLeft, Trash2, Type, X } from 'lucide-react'
import { toast } from 'sonner'
import type { GreetingRule } from '@/domain/types'
import { cn, uid } from '@/lib/utils'
import { SideSheet } from '@/components/app/SideSheet'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRestoreFocus } from '@/hooks/useRestoreFocus'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { GreetingEditor } from './GreetingEditor'
import { VarText } from './ui'
import {
  CONDITION_FIELDS,
  CONDITION_VALUES,
  OPERATORS,
  OPERATOR_LABEL,
  autoRuleMessage,
  conditionField,
  conditionKind,
  conditionMissingValue,
  conditionValueLabel,
  defaultCondition,
  needsValue,
  normalizeCondition,
  valueForOperator,
  type ConditionKind,
  type ConditionOperator,
} from './variables'

const KIND_ICON: Record<ConditionKind, typeof Type> = { text: Type, list: Type, boolean: ToggleLeft, direction: List, time: Clock, period: CalendarDays }

type Condition = GreetingRule['conditions'][number]

/** Editor do valor dentro do menu da pílula (texto, hora, intervalo de horas, período De/Até). */
function ValueEditor({ cond, onChange, invalid, autoFocus }: { cond: Condition; onChange: (c: Condition) => void; invalid?: boolean; autoFocus?: boolean }) {
  const kind = conditionKind(cond.field)
  const cls = 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive'
  if (kind === 'period') {
    const [from = '', to = ''] = cond.value.split('|')
    return (
      <div className="space-y-2 p-2">
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>De</span>
          <input type="datetime-local" aria-label="De" className={cls} aria-invalid={(invalid && !from) || undefined} value={from} onChange={(e) => onChange({ ...cond, value: `${e.target.value}|${to}` })} />
        </label>
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>Até</span>
          <input type="datetime-local" aria-label="Até" className={cls} aria-invalid={(invalid && !to) || undefined} value={to} onChange={(e) => onChange({ ...cond, value: `${from}|${e.target.value}` })} />
        </label>
      </div>
    )
  }
  if (kind === 'time' && cond.operator === 'within') {
    const [from = '', to = ''] = cond.value.split('-')
    return (
      <div className="flex items-center gap-2 p-2">
        <input type="time" aria-label="De" className={cls} value={from} onChange={(e) => onChange({ ...cond, value: `${e.target.value}-${to}` })} />
        <span className="text-muted-foreground">–</span>
        <input type="time" aria-label="Até" className={cls} value={to} onChange={(e) => onChange({ ...cond, value: `${from}-${e.target.value}` })} />
      </div>
    )
  }
  return (
    <div className="p-2">
      <input
        type={kind === 'time' ? 'time' : 'text'}
        aria-label="Valor da condição"
        autoFocus={autoFocus}
        className={cls}
        aria-invalid={(invalid && !cond.value.trim()) || undefined}
        value={cond.value}
        onChange={(e) => onChange({ ...cond, value: e.target.value })}
      />
    </div>
  )
}

const MENU_ITEM = 'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent'

/**
 * Pílula de condição (OBSERVADO: fonio-live2/C-assistentes/23–25): `[ícone campo] | operador | valor (font-medium) | ×`,
 * rounded-md border text-xs. Clicar no corpo abre um menu único com os operadores, um separador e os valores (✓ no atual).
 */
function ConditionChip({
  cond: raw,
  readOnly,
  invalid,
  defaultOpen,
  active,
  onChange,
  onRemove,
}: {
  cond: Condition
  readOnly?: boolean
  invalid?: boolean
  defaultOpen?: boolean
  /** regra em edição: o × fica visível (nas demais aparece ao passar o mouse/focar) */
  active?: boolean
  onChange: (c: Condition) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const cond = normalizeCondition(raw)
  const f = conditionField(cond.field)
  const kind = conditionKind(cond.field)
  const Icon = KIND_ICON[kind]
  const op = cond.operator as ConditionOperator
  const valueLabel = conditionValueLabel(cond)
  const missing = conditionMissingValue(cond)
  const values = CONDITION_VALUES[kind]
  const body = (
    <>
      <span className="flex items-center gap-1.5 px-2">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{f?.shortLabel ?? cond.field}</span>
      </span>
      <span className="border-l px-2">{OPERATOR_LABEL[op] ?? op}</span>
      {needsValue(op) && <span className={cn('truncate border-l px-2 font-medium text-foreground', missing && 'font-normal text-muted-foreground/70')}>{valueLabel || '…'}</span>}
    </>
  )
  const shell = cn('inline-flex h-6 max-w-full items-stretch rounded-md border bg-background text-xs leading-[22px] text-muted-foreground', invalid && 'border-destructive')
  if (readOnly) return <span className={shell}>{body}</span>
  return (
    <span className={shell}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-invalid={invalid || undefined}
            aria-label={`Condição: ${f?.shortLabel ?? cond.field} ${OPERATOR_LABEL[op] ?? op}${valueLabel ? ` ${valueLabel}` : ''}`}
            className="inline-flex min-w-0 items-stretch rounded-l-md outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring"
          >
            {body}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" onCloseAutoFocus={(e) => e.preventDefault()} className="w-56 p-1">
          {OPERATORS[kind].map((o) => (
            <button
              key={o}
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                onChange({ ...cond, operator: o, value: valueForOperator(cond.field, o, cond) })
                if (!needsValue(o) || (values && o !== 'is_any_of')) setOpen(false)
              }}
            >
              {OPERATOR_LABEL[o]}
              {o === op && <Check className="absolute right-2 size-4" />}
            </button>
          ))}
          {needsValue(op) && (
            <>
              <div className="-mx-1 my-1 h-px bg-muted" role="separator" />
              {values ? (
                values.map((v) => {
                  const selected = cond.value.split(',').includes(v.value)
                  return (
                    <button
                      key={v.value}
                      type="button"
                      className={MENU_ITEM}
                      onClick={() => {
                        if (op === 'is_any_of') {
                          const cur = cond.value.split(',').filter(Boolean)
                          const next = selected ? cur.filter((x) => x !== v.value) : [...cur, v.value]
                          onChange({ ...cond, value: values.filter((x) => next.includes(x.value)).map((x) => x.value).join(',') })
                        } else {
                          onChange({ ...cond, value: v.value })
                          setOpen(false)
                        }
                      }}
                    >
                      {v.label}
                      {selected && <Check className="absolute right-2 size-4" />}
                    </button>
                  )
                })
              ) : (
                <ValueEditor cond={cond} onChange={onChange} invalid={invalid} autoFocus={defaultOpen} />
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label="Remover condição"
        onClick={onRemove}
        className={cn(
          'flex items-center rounded-r-md border-l px-1.5 hover:bg-muted/50 hover:text-foreground focus-visible:flex',
          !active && 'md:hidden md:group-focus-within/rule:flex md:group-hover/rule:flex',
        )}
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

/** Pílula tracejada "+ Adicionar condição" com o menu dos 10 campos ("?" = pode estar vazio, ⓘ = descrição) — OBSERVADO (22). */
function AddConditionButton({ onAdd, subtle, onOpen }: { onAdd: (field: string) => void; subtle?: boolean; onOpen?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) onOpen?.()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground transition-opacity hover:border-foreground/30 hover:text-foreground',
            subtle && 'md:hidden md:group-focus-within/rule:inline-flex md:group-hover/rule:inline-flex md:data-[state=open]:inline-flex',
          )}
        >
          <Plus className="size-3" />
          Adicionar condição
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" onCloseAutoFocus={(e) => e.preventDefault()} className="max-h-80 w-[368px] max-w-[calc(100vw-2rem)] overflow-y-auto p-1">
        {CONDITION_FIELDS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setOpen(false)
              onAdd(f.key)
            }}
            className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
          >
            <span className="truncate">{f.label}</span>
            <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
              {f.optional && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] font-semibold">?</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[300px]">{f.optional}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="size-4" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[300px]">{f.description}</TooltipContent>
              </Tooltip>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Mensagem de uma regra no modo Avançado: texto com chips (clicar para editar) ou o editor com "Adicionar variável"
 * quando está vazia ou em edição — como em [489] (regra existente em texto; regra nova com editor).
 */
function RuleMessage({ value, onChange, index, invalid }: { value: string; onChange: (v: string) => void; index: number; invalid: boolean }) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isEmpty = !value.replace(/\{\{[^}]*\}\}/g, 'x').trim()
  useEffect(() => {
    if (!editing) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (ref.current?.contains(t) || t.closest('[data-greeting-popover]') || t.closest('[role="tooltip"]')) return
      setEditing(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editing])
  if (!editing && !isEmpty)
    return (
      <button
        type="button"
        aria-label={`Editar a mensagem da regra ${index + 1}`}
        onClick={() => setEditing(true)}
        className="-mr-2 ml-[18px] block w-[calc(100%-10px)] rounded-md px-2 py-1 text-left text-sm leading-5 transition-colors hover:bg-muted/60"
      >
        <VarText text={value} />
      </button>
    )
  // focar o editor (inclusive o de uma regra vazia) entra em edição: digitar o 1º caractere não troca o editor pelo texto
  return (
    <div
      ref={ref}
      // só o foco DENTRO do editor entra em edição: o foco no menu "Adicionar variável" (portal) também chega aqui pelo React
      // e, ao re-focar o editor, fechava o menu no 1º clique de uma regra nova
      onFocusCapture={(e) => {
        if (e.currentTarget.contains(e.target as Node)) setEditing(true)
      }}
    >
      <GreetingEditor value={value} onChange={onChange} autoFocus={editing} ariaLabel={`Mensagem da regra ${index + 1}`} invalid={invalid} placeholder="" />
    </div>
  )
}

const managedRule = (greeting: string): GreetingRule => ({
  id: uid('gr'),
  conditions: [{ field: 'contact.firstName', operator: 'is_set', value: '' }],
  message: autoRuleMessage(greeting),
})
const emptyRule = (): GreetingRule => ({ id: uid('gr'), conditions: [], message: '' })

/** Folha "Regras da mensagem inicial" (Automático / Avançado) — OBSERVADO: fonio-live2/C-assistentes/18–25 + data/initial-message.json. */
export function GreetingRulesSheet({
  open,
  onOpenChange,
  greeting,
  mode: initialMode,
  rules: initialRules,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  greeting: string
  mode: 'auto' | 'advanced'
  rules: GreetingRule[]
  onDone: (v: { mode: 'auto' | 'advanced'; rules: GreetingRule[] }) => void
}) {
  const [mode, setMode] = useState(initialMode)
  const [rules, setRules] = useState<GreetingRule[]>(initialRules)
  const [confirm, setConfirm] = useState<null | 'switch' | 'add'>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  /** "regra:índice" da condição recém-adicionada (abre o editor de valor) */
  const [justAdded, setJustAdded] = useState<string | null>(null)
  /** regra em edição (nova ou com condição recém-adicionada): mostra "Adicionar condição", × e lixeira sem depender do hover */
  const [activeRule, setActiveRule] = useState<string | null>(null)
  const restoreFocus = useRestoreFocus(confirm !== null)

  useEffect(() => {
    if (open) {
      setMode(initialMode)
      setRules(JSON.parse(JSON.stringify(initialRules)) as GreetingRule[])
      setShowErrors(false)
      setJustAdded(null)
      setActiveRule(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const dirty = useMemo(() => mode !== initialMode || JSON.stringify(rules) !== JSON.stringify(initialRules), [mode, rules, initialMode, initialRules])
  const auto = managedRule(greeting)

  const enterAdvanced = (addEmpty: boolean) => {
    setMode('advanced')
    setRules((r) => {
      const base = r.length ? r : [managedRule(greeting)]
      return addEmpty ? [...base, emptyRule()] : base
    })
  }

  const patchRule = (id: string, patch: Partial<GreetingRule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const move = (from: number, to: number) =>
    setRules((rs) => {
      if (to < 0 || to >= rs.length || from === to) return rs
      const next = [...rs]
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it!)
      return next
    })

  function done() {
    if (mode === 'advanced' && rules.some((r) => !r.message.replace(/\{\{[^}]*\}\}/g, 'x').trim())) {
      setShowErrors(true)
      toast.error('Preencha a mensagem de todas as regras.')
      return
    }
    if (mode === 'advanced' && rules.some((r) => r.conditions.some(conditionMissingValue))) {
      setShowErrors(true)
      toast.error('Preencha o valor de todas as condições.')
      return
    }
    onDone({ mode, rules })
    onOpenChange(false)
  }

  return (
    <>
      <SideSheet
        open={open}
        onOpenChange={onOpenChange}
        width={600}
        title="Regras da mensagem inicial"
        description={
          // a descrição ocupa toda a largura do painel (só o título reserva espaço para o X), como em [486]
          <span className="-mr-10 block">
            Mensagens com condições são reproduzidas quando as condições correspondem. Avaliadas de cima para baixo; a primeira correspondência vence, caso contrário, a mensagem padrão abaixo é usada.
          </span>
        }
        onSave={done}
        saveLabel="Pronto"
        saveDisabled={!dirty}
      >
        {/* -mt-2 compensa o pt-2 da área rolável do SideSheet: abas a 32px da descrição, como em [486] */}
        <div className="-mt-2 flex flex-col gap-2">
          <div role="radiogroup" aria-label="Modo" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(['auto', 'advanced'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => {
                  if (m === mode) return
                  if (m === 'advanced') setConfirm('switch')
                  else setMode('auto')
                }}
                className={cn('h-8 rounded-md text-sm font-medium transition-colors', mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {m === 'auto' ? 'Automático' : 'Avançado'}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === 'auto'
              ? 'A Kloel gerencia esta saudação personalizada e a mantém sincronizada com a saudação padrão.'
              : 'Você gerencia cada mensagem inicial e decide exatamente quando ela será reproduzida.'}
          </p>

          <div className="mt-2 divide-y rounded-xl border">
            {mode === 'auto' ? (
              <div className="group/rule space-y-2 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="-mr-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground/60">
                    <GripVertical className="size-4" />
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">Quando</span>
                  {auto.conditions.map((c, i) => (
                    <ConditionChip key={i} cond={c} readOnly onChange={() => undefined} onRemove={() => undefined} />
                  ))}
                  <span className="rounded-full bg-muted px-2.5 py-[3px] text-[11px] font-medium leading-4 text-foreground">Gerenciado pela Kloel</span>
                  <button
                    type="button"
                    aria-label="Excluir esta mensagem"
                    onClick={() => setConfirm('switch')}
                    className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:text-destructive focus-visible:opacity-100 md:opacity-0 md:group-focus-within/rule:opacity-100 md:group-hover/rule:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="ml-[26px] py-1 text-sm leading-5">
                  <VarText text={auto.message} />
                </div>
              </div>
            ) : (
              rules.map((r, idx) => {
                const invalid = showErrors && !r.message.replace(/\{\{[^}]*\}\}/g, 'x').trim()
                return (
                  <div
                    key={r.id}
                    draggable={dragIndex === idx}
                    onDragStart={(e: DragEvent) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(idx))
                    }}
                    onDragOver={(e) => {
                      if (dragIndex === null) return
                      e.preventDefault()
                      setOverIndex(idx)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragIndex !== null) move(dragIndex, idx)
                      setDragIndex(null)
                      setOverIndex(null)
                    }}
                    onDragEnd={() => {
                      setDragIndex(null)
                      setOverIndex(null)
                    }}
                    className={cn('group/rule space-y-2 px-5 py-3 transition-colors', overIndex === idx && dragIndex !== idx && 'bg-brand/5', dragIndex === idx && 'opacity-60')}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        aria-label="Arrastar para reordenar"
                        className="-mr-0.5 flex size-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
                        onMouseDown={() => setDragIndex(idx)}
                        onMouseUp={() => setDragIndex(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            move(idx, idx - 1)
                          }
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            move(idx, idx + 1)
                          }
                        }}
                      >
                        <GripVertical className="size-4" />
                      </button>
                      <span className="text-xs font-medium text-muted-foreground">Quando</span>
                      {r.conditions.map((c, ci) => (
                        <ConditionChip
                          key={ci}
                          cond={c}
                          invalid={showErrors && conditionMissingValue(c)}
                          defaultOpen={justAdded === `${r.id}:${ci}`}
                          active={activeRule === r.id}
                          onChange={(nc) => patchRule(r.id, { conditions: r.conditions.map((x, i) => (i === ci ? nc : x)) })}
                          onRemove={() => patchRule(r.id, { conditions: r.conditions.filter((_, i) => i !== ci) })}
                        />
                      ))}
                      <AddConditionButton
                        subtle={r.conditions.length > 0 && activeRule !== r.id}
                        onOpen={() => setActiveRule(r.id)}
                        onAdd={(field) => {
                          const c = defaultCondition(field)
                          if (conditionMissingValue(c)) setJustAdded(`${r.id}:${r.conditions.length}`)
                          patchRule(r.id, { conditions: [...r.conditions, c] })
                        }}
                      />
                      <button
                        type="button"
                        aria-label="Excluir esta mensagem"
                        onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}
                        // [489]/[490]: no modo Avançado a lixeira aparece na regra sob o mouse/foco (sempre visível em telas de toque)
                        className={cn(
                          'ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:text-destructive focus-visible:opacity-100',
                          activeRule !== r.id && 'md:opacity-0 md:group-focus-within/rule:opacity-100 md:group-hover/rule:opacity-100',
                        )}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    {showErrors && r.conditions.some(conditionMissingValue) && (
                      <p className="ml-[26px] text-xs font-medium text-destructive">Informe o valor de todas as condições desta regra.</p>
                    )}
                    <div>
                      <RuleMessage value={r.message} onChange={(v) => patchRule(r.id, { message: v })} index={idx} invalid={invalid} />
                      {!r.message.replace(/\{\{[^}]*\}\}/g, 'x').trim() && <p className={cn('mt-2 text-xs text-destructive', invalid && 'font-medium')}>A mensagem é obrigatória</p>}
                    </div>
                  </div>
                )
              })
            )}
            <div className="space-y-2 px-5 py-3">
              <p className="ml-[26px] text-xs font-medium text-muted-foreground">Padrão</p>
              <p className="ml-[26px] py-1 text-sm leading-5">
                <VarText text={greeting} />
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (mode === 'auto') return setConfirm('add')
                const r = emptyRule()
                setRules((rs) => [...rs, r])
                setActiveRule(r.id)
              }}
              className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-brand hover:bg-gray-50"
            >
              <CirclePlus className="size-4" />
              Adicionar mensagem
            </button>
          </div>
        </div>
      </SideSheet>
      {/* [487]: diálogo compacto (título + descrição a 6px, botões a 16px, "Cancelar" contornado e X) — difere do ConfirmDialog padrão */}
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="z-[70] gap-y-4" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Sair do modo automático?</DialogTitle>
            <DialogDescription>
              Quer cumprimentar seus contatos VIP de forma diferente? Ou clientes de uma empresa ou país específico? O modo avançado oferece criatividade e controle totais. Você
              gerenciará essas mensagens no lugar da Kloel e poderá voltar a qualquer momento.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                enterAdvanced(confirm === 'add')
                setConfirm(null)
              }}
            >
              Sair do modo automático
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
