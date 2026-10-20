import type { ReactNode } from 'react'
import { ArrowDownWideNarrow, Filter, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PRIORITY_ORDER, TASK_PRIORITY_LABEL, type Member } from './model'
import {
  CATEGORY_LABEL, DUE_LABEL, ORIGIN_LABEL, SORT_LABEL, activeFilterCount,
  type Category, type DueFilter, type SortKey, type TaskFilters,
} from './filters'

type Field = 'categories' | 'priorities' | 'assignees' | 'tags' | 'origin' | 'due'

const FIELD_LABEL: Record<Field, string> = {
  categories: 'Categorias',
  priorities: 'Prioridade',
  assignees: 'Responsável',
  tags: 'Tags',
  origin: 'Origem',
  due: 'Vencimento',
}

interface Option {
  value: string
  label: string
}

function fieldOptions(field: Field, members: Member[], tags: string[]): Option[] {
  switch (field) {
    case 'categories':
      return (Object.keys(CATEGORY_LABEL) as Category[]).map((v) => ({ value: v, label: CATEGORY_LABEL[v] }))
    case 'priorities':
      return [...PRIORITY_ORDER].reverse().map((v) => ({ value: v, label: TASK_PRIORITY_LABEL[v] }))
    case 'assignees':
      return [{ value: 'none', label: 'Sem responsável' }, ...members.map((m) => ({ value: m.id, label: m.name }))]
    case 'tags':
      return tags.map((t) => ({ value: t, label: t }))
    case 'origin':
      return (['ai', 'user'] as const).map((v) => ({ value: v, label: ORIGIN_LABEL[v] }))
    case 'due':
      return (Object.keys(DUE_LABEL) as DueFilter[]).map((v) => ({ value: v, label: DUE_LABEL[v] }))
  }
}

const FIELDS: Field[] = ['categories', 'priorities', 'assignees', 'tags', 'origin', 'due']

/** Opções de um campo como itens de checkbox (o menu continua aberto para marcar vários). */
function FieldItems({ field, filters, onChange, members, tags }: { field: Field; filters: TaskFilters; onChange: (f: TaskFilters) => void; members: Member[]; tags: string[] }) {
  const selected = filters[field] as string[]
  const options = fieldOptions(field, members, tags)
  if (!options.length) return <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma opção.</div>
  return (
    <>
      {options.map((o) => (
        <DropdownMenuCheckboxItem
          key={o.value}
          checked={selected.includes(o.value)}
          onSelect={(e) => e.preventDefault()}
          onCheckedChange={(c) => onChange({ ...filters, [field]: c ? [...selected, o.value] : selected.filter((v) => v !== o.value) })}
        >
          {o.label}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  )
}

/** Menu completo de filtros (botão funil e "+"): "Minhas tarefas" + um submenu por campo. */
function FilterMenu({ trigger, filters, onChange, members, tags }: { trigger: ReactNode; filters: TaskFilters; onChange: (f: TaskFilters) => void; members: Member[]; tags: string[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel>Filtrar por</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={filters.mine} onSelect={(e) => e.preventDefault()} onCheckedChange={(c) => onChange({ ...filters, mine: !!c })}>
          Minhas tarefas
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {FIELDS.map((f) => (
          <DropdownMenuSub key={f}>
            <DropdownMenuSubTrigger>
              <span className="flex-1">{FIELD_LABEL[f]}</span>
              {(filters[f] as string[]).length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{(filters[f] as string[]).length}</span>}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 min-w-48 overflow-y-auto">
              <FieldItems field={f} filters={filters} onChange={onChange} members={members} tags={tags} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const CHIP = 'inline-flex h-6 items-center rounded-md border bg-white text-[11px] text-muted-foreground'

/** Chip "Categorias | Ativas ×" (TK-V01): o corpo abre as opções do campo; × remove o filtro. */
function FieldChip({ field, filters, onChange, members, tags }: { field: Field; filters: TaskFilters; onChange: (f: TaskFilters) => void; members: Member[]; tags: string[] }) {
  const selected = filters[field] as string[]
  const options = fieldOptions(field, members, tags)
  const labels = selected.map((v) => options.find((o) => o.value === v)?.label ?? v)
  return (
    <span className={CHIP} data-testid={`chip-${field}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex h-full max-w-[220px] items-center gap-1.5 rounded-l-md pl-2 pr-1.5 hover:bg-accent">
            <span>{FIELD_LABEL[field]}</span>
            <span className="h-3 w-px bg-border" />
            <span className="truncate font-medium text-foreground">{labels.join(', ')}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto">
          <FieldItems field={field} filters={filters} onChange={onChange} members={members} tags={tags} />
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={`Remover filtro ${FIELD_LABEL[field]}`}
        onClick={() => onChange({ ...filters, [field]: [] })}
        className="inline-flex h-full items-center rounded-r-md border-l px-1 hover:bg-accent hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

/** Busca "Buscar tarefas" + botão de filtro + botão de ordenação + linha de chips (TK-V01). */
export function FilterBar({
  filters,
  onChange,
  members,
  tags,
}: {
  filters: TaskFilters
  onChange: (f: TaskFilters, opts?: { typing?: boolean }) => void
  members: Member[]
  tags: string[]
}) {
  const active = activeFilterCount(filters)
  const set = (f: TaskFilters) => onChange(f)
  const iconBtn = 'relative inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-white text-muted-foreground hover:bg-accent hover:text-foreground'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={filters.q}
            onChange={(e) => onChange({ ...filters, q: e.target.value }, { typing: true })}
            placeholder="Buscar tarefas"
            aria-label="Buscar tarefas"
            data-testid="tasks-search"
            className="h-9 w-full rounded-md border bg-white pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
        </div>
        <FilterMenu
          filters={filters}
          onChange={set}
          members={members}
          tags={tags}
          trigger={
            <button type="button" aria-label={active ? `Filtrar tarefas (${active} filtros ativos)` : 'Filtrar tarefas'} title="Filtrar" className={iconBtn} data-testid="tasks-filter">
              <Filter className="size-4" />
            </button>
          }
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Ordenar: ${SORT_LABEL[filters.sort]}`} title="Ordenar" className={iconBtn} data-testid="tasks-sort">
              <ArrowDownWideNarrow className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filters.sort} onValueChange={(v) => set({ ...filters, sort: v as SortKey })}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <DropdownMenuRadioItem key={k} value={k}>
                  {SORT_LABEL[k]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" data-testid="tasks-chips">
        {filters.categories.length > 0 && <FieldChip field="categories" filters={filters} onChange={set} members={members} tags={tags} />}
        {filters.mine && (
          <span className={CHIP} data-testid="chip-mine">
            <span className="pl-2 pr-1.5 font-medium text-foreground">Minhas tarefas</span>
            <button
              type="button"
              aria-label="Remover filtro Minhas tarefas"
              onClick={() => set({ ...filters, mine: false })}
              className="inline-flex h-full items-center rounded-r-md border-l px-1 hover:bg-accent hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        )}
        {FIELDS.filter((f) => f !== 'categories' && (filters[f] as string[]).length > 0).map((f) => (
          <FieldChip key={f} field={f} filters={filters} onChange={set} members={members} tags={tags} />
        ))}
        <FilterMenu
          filters={filters}
          onChange={set}
          members={members}
          tags={tags}
          trigger={
            <button type="button" aria-label="Adicionar filtro" className={cn('inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground')} data-testid="tasks-add-filter">
              <Plus className="size-3.5" />
            </button>
          }
        />
      </div>
    </div>
  )
}
