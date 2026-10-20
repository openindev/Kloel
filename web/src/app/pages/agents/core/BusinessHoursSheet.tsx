import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CirclePlus, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { BusinessHours } from '@/domain/types'
import { cn } from '@/lib/utils'
import { SideSheet } from '@/components/app/SideSheet'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { FieldError, LEFT_CHECK_ITEM } from './ui'

export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABEL: Record<number, string> = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' }
export const DAY_SHORT = DAY_LABEL
const DAY_FULL: Record<number, string> = { 0: 'Domingo', 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira', 5: 'Sexta-feira', 6: 'Sábado' }

/** Horário de um dia ("08:00 — 18:00", vários intervalos separados por vírgula) ou "Fechado". */
export function dayHoursLabel(bh: BusinessHours, day: number, sep = ' — ') {
  const d = bh.enabled ? bh.days.find((x) => x.day === day) : undefined
  if (!d?.enabled || !d.ranges.length) return 'Fechado'
  return d.ranges.map((r) => `${r.from}${sep}${r.to}`).join(', ')
}
const TIMEZONES: [string, string][] = [
  ['America/Sao_Paulo', 'Brasília (GMT-3)'],
  ['America/Manaus', 'Manaus (GMT-4)'],
  ['America/Cuiaba', 'Cuiabá (GMT-4)'],
  ['America/Rio_Branco', 'Rio Branco (GMT-5)'],
  ['America/Noronha', 'Fernando de Noronha (GMT-2)'],
]

interface Group {
  days: number[]
  ranges: { from: string; to: string }[]
}

function toGroups(bh: BusinessHours): Group[] {
  if (!bh.enabled) return []
  const map = new Map<string, Group>()
  for (const d of DAY_ORDER) {
    const day = bh.days.find((x) => x.day === d)
    if (!day?.enabled || !day.ranges.length) continue
    const key = JSON.stringify(day.ranges)
    if (!map.has(key)) map.set(key, { days: [], ranges: day.ranges.map((r) => ({ ...r })) })
    map.get(key)!.days.push(d)
  }
  return [...map.values()]
}

const blankGroup = (): Group => ({ days: [], ranges: [{ from: '08:00', to: '18:00' }] })

function toHours(base: BusinessHours, groups: Group[], timezone: string): BusinessHours {
  return {
    ...base,
    timezone,
    enabled: groups.some((g) => g.days.length),
    days: [0, 1, 2, 3, 4, 5, 6].map((day) => {
      const g = groups.find((x) => x.days.includes(day))
      return { day, enabled: !!g, ranges: g ? g.ranges.map((r) => ({ ...r })) : [{ from: '09:00', to: '18:00' }] }
    }),
  }
}

/** Resumo legível ("Seg–Sex 09:00–18:00"). */
export function summarizeHours(bh: BusinessHours) {
  const groups = toGroups(bh)
  if (!groups.length) return 'Não configurado'
  return groups.map((g) => `${g.days.map((d) => DAY_LABEL[d]).join(', ')} ${g.ranges.map((r) => `${r.from}–${r.to}`).join(', ')}`).join(' · ')
}

/**
 * Folha "Horário de funcionamento" (OBSERVADO: fonio-live2/C-assistentes/90–91 + data/knowledge.json): w-[384px], 7 círculos
 * Seg…Dom (ativo `border-2 border-brand text-brand`), 08:00 — 18:00 + lixeira, "Adicionar intervalo de horário +",
 * "⊕ Adicionar horários" e rodapé Cancelar + botão preto ✓. Com horário já configurado abre na lista por dia (Central de ajuda FS-08).
 */
export function BusinessHoursSheet({ open, onOpenChange, value, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; value: BusinessHours; onSave: (bh: BusinessHours) => void | Promise<void> }) {
  // sem horário configurado a folha abre com um grupo em branco (08:00–18:00, nenhum dia), como em [528]/[536]
  const initial = useMemo(() => {
    const g = toGroups(value)
    return g.length ? g : [blankGroup()]
  }, [value])
  const [groups, setGroups] = useState<Group[]>(initial)
  const [tz, setTz] = useState(value.timezone)
  const [showErrors, setShowErrors] = useState(false)
  // FS-08: com horário configurado a folha abre na lista Segunda…Domingo (somente leitura) com "Editar todos" e ✓
  const configured = toGroups(value).length > 0
  const [mode, setMode] = useState<'view' | 'edit'>(configured ? 'view' : 'edit')

  useEffect(() => {
    if (open) {
      setGroups(JSON.parse(JSON.stringify(initial)) as Group[])
      setTz(value.timezone)
      setShowErrors(false)
      setMode(configured ? 'view' : 'edit')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const dirty = JSON.stringify(groups) !== JSON.stringify(initial) || tz !== value.timezone

  const errors = groups.map((g) => {
    if (!g.days.length) return 'Selecione pelo menos um dia.'
    if (!g.ranges.length) return 'Adicione pelo menos um intervalo de horário.'
    if (g.ranges.some((r) => !r.from || !r.to || r.from >= r.to)) return 'O horário final deve ser depois do inicial.'
    const sorted = [...g.ranges].sort((a, b) => a.from.localeCompare(b.from))
    if (sorted.some((r, i) => i > 0 && r.from < sorted[i - 1]!.to)) return 'Os intervalos não podem se sobrepor.'
    return undefined
  })

  const toggleDay = (gi: number, day: number) =>
    setGroups((gs) =>
      gs.map((g, i) => {
        if (i === gi) return { ...g, days: g.days.includes(day) ? g.days.filter((d) => d !== day) : [...g.days, day].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)) }
        return { ...g, days: g.days.filter((d) => d !== day) } // um dia pertence a um único grupo
      }),
    )
  const patchRange = (gi: number, ri: number, patch: Partial<{ from: string; to: string }>) =>
    setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, ranges: g.ranges.map((r, j) => (j === ri ? { ...r, ...patch } : r)) } : g)))

  const saving = useRef(false)
  const [busy, setBusy] = useState(false)
  async function confirm() {
    if (saving.current) return
    if (!dirty) return onOpenChange(false) // ✓ sem alterações apenas fecha
    if (errors.some(Boolean)) {
      setShowErrors(true)
      toast.error('Corrija o horário de funcionamento antes de salvar.')
      return
    }
    saving.current = true; setBusy(true)
    try { await onSave(toHours(value, groups, tz)); onOpenChange(false) }
    catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
    finally { saving.current = false; setBusy(false) }
  }

  /** Lixeira do intervalo: remove o intervalo; se for o único do grupo, remove o grupo inteiro (como na referência, sem link "Remover horário"). */
  const removeRange = (gi: number, ri: number) =>
    setGroups((gs) => {
      const g = gs[gi]!
      if (g.ranges.length > 1) return gs.map((x, i) => (i === gi ? { ...x, ranges: x.ranges.filter((_, j) => j !== ri) } : x))
      return gs.filter((_, i) => i !== gi)
    })
  const addRange = (gi: number) =>
    setGroups((gs) =>
      gs.map((g, i) => {
        if (i !== gi) return g
        const last = g.ranges[g.ranges.length - 1]
        const from = last?.to ?? '08:00'
        const h = Math.min(23, Number(from.slice(0, 2)) + 2)
        const to = `${String(h).padStart(2, '0')}:00`
        return { ...g, ranges: [...g.ranges, { from, to: to > from ? to : '23:59' }] }
      }),
    )

  const TIME = 'h-9 w-[67px] rounded-md border border-input bg-background px-2 text-center text-sm tabular-nums outline-none [&::-webkit-calendar-picker-indicator]:hidden focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive'

  const resetEdit = () => {
    setGroups(JSON.parse(JSON.stringify(initial)) as Group[])
    setTz(value.timezone)
    setShowErrors(false)
  }

  if (mode === 'view')
    return (
      // FS-08: lista dos dias com o horário à direita e divisórias; rodapé "Editar todos" (sliders) + ✓ preto
      <SideSheet
        open={open}
        onOpenChange={(value) => !saving.current && onOpenChange(value)}
        width={384}
        title="Horário de funcionamento"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setMode('edit')}>
              <SlidersHorizontal className="size-4" />
              Editar todos
            </Button>
            <Button size="icon" aria-label="Fechar horário" onClick={() => onOpenChange(false)}>
              <Check className="size-5" />
            </Button>
          </div>
        }
      >
        <dl className="divide-y" aria-label="Horário por dia">
          {DAY_ORDER.map((d) => {
            const label = dayHoursLabel(value, d)
            return (
              <div key={d} className="flex items-center justify-between gap-3 py-3 text-sm">
                <dt>{DAY_FULL[d]}</dt>
                <dd className={cn('tabular-nums', label === 'Fechado' && 'text-muted-foreground')}>{label}</dd>
              </div>
            )
          })}
        </dl>
      </SideSheet>
    )

  return (
    // sub-painel da captura [496]: ~400px, dias em círculos, intervalos alinhados à direita, rodapé Cancelar | Redefinir ✓
    <SideSheet
      open={open}
      onOpenChange={(value) => !saving.current && onOpenChange(value)}
      width={384}
      title="Horário de funcionamento"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // aberto pela lista (FS-08): Cancelar volta à lista sem aplicar; senão fecha
              if (configured) {
                resetEdit()
                setMode('view')
              } else onOpenChange(false)
            }}
          >
            Cancelar
          </Button>
          <Button size="icon" aria-label="Confirmar horário" className="size-9" disabled={busy} onClick={() => void confirm()}>
            <Check className="size-5" />
          </Button>
        </div>
      }
    >
      <div className="-mt-2 flex flex-col gap-6">
        {groups.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-3 border-b pb-6">
            <div className="flex flex-wrap justify-between gap-1.5" role="group" aria-label="Dias da semana">
              {DAY_ORDER.map((d) => {
                const sel = g.days.includes(d)
                const other = !sel && groups.some((x, xi) => xi !== gi && x.days.includes(d))
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={sel}
                    title={other ? 'Já usado em outro horário — clique para mover para este' : undefined}
                    onClick={() => toggleDay(gi, d)}
                    className={cn(
                      'flex size-10 items-center justify-center rounded-full text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      sel ? 'border-2 border-brand font-bold text-brand' : 'border border-border bg-background font-semibold text-foreground hover:border-foreground/40',
                      other && 'text-muted-foreground/60',
                    )}
                  >
                    {DAY_LABEL[d]}
                  </button>
                )
              })}
            </div>
            {/* referência (live-compare/C-assistentes/20): linha `flex items-center gap-2` > `flex items-center gap-1` (08:00 — 18:00) + lixeira;
                "Adicionar intervalo de horário +" `flex items-center gap-1.5 text-xs hover:text-brand` 12px abaixo */}
            <div className="flex flex-col items-end gap-3">
              <div className="flex flex-col items-end gap-2">
                {g.ranges.map((r, ri) => (
                  <div key={ri} className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <input type="time" aria-label="Início" value={r.from} aria-invalid={(showErrors && !!errors[gi]) || undefined} onChange={(e) => patchRange(gi, ri, { from: e.target.value })} className={TIME} />
                      <span className="text-muted-foreground">—</span>
                      <input type="time" aria-label="Fim" value={r.to} aria-invalid={(showErrors && !!errors[gi]) || undefined} onChange={(e) => patchRange(gi, ri, { to: e.target.value })} className={TIME} />
                    </div>
                    <button type="button" aria-label="Remover intervalo" onClick={() => removeRange(gi, ri)} className="inline-flex items-center justify-center text-foreground hover:text-destructive">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => addRange(gi)} className="flex items-center gap-1.5 whitespace-nowrap text-xs text-foreground hover:text-brand">
                Adicionar intervalo de horário <Plus className="size-4" />
              </button>
            </div>
            {showErrors && <FieldError>{errors[gi]}</FieldError>}
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" className="gap-2 self-start" onClick={() => setGroups((gs) => [...gs, blankGroup()])}>
          <CirclePlus className="size-4" />
          Adicionar horários
        </Button>
      </div>
    </SideSheet>
  )
}
