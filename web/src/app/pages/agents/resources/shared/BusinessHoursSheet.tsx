import { useEffect, useMemo, useState } from 'react'
import { Check, CirclePlus, Plus, Trash2 } from 'lucide-react'
import type { BusinessHours } from '@/domain/types'
import { cn, uid } from '@/lib/utils'
import { SideSheet } from '@/components/app/SideSheet'
import { Button } from '@/components/ui/button'
import { DAY_ORDER, DAY_SHORT } from './timing'
import { FieldError } from './ui'

interface Range {
  id: string
  from: string
  to: string
}
interface Group {
  id: string
  days: number[]
  ranges: Range[]
}

const newRange = (from = '08:00', to = '18:00'): Range => ({ id: uid('rg'), from, to })
const newGroup = (days: number[] = []): Group => ({ id: uid('grp'), days, ranges: [newRange()] })

/** BusinessHours (por dia) → grupos de dias com os mesmos intervalos (como o editor da referência). */
function toGroups(bh: BusinessHours): Group[] {
  if (!bh.enabled) return [newGroup()]
  const map = new Map<string, Group>()
  for (const d of DAY_ORDER) {
    const day = bh.days.find((x) => x.day === d)
    if (!day?.enabled || !day.ranges.length) continue
    const key = JSON.stringify(day.ranges)
    const g = map.get(key)
    if (g) g.days.push(d)
    else map.set(key, { id: uid('grp'), days: [d], ranges: day.ranges.map((r) => newRange(r.from, r.to)) })
  }
  return map.size ? [...map.values()] : [newGroup()]
}

function fromGroups(groups: Group[], timezone: string, outsideBehavior: string): BusinessHours {
  return {
    enabled: true,
    timezone,
    outsideBehavior,
    days: [0, 1, 2, 3, 4, 5, 6].map((day) => {
      const g = groups.find((x) => x.days.includes(day))
      return { day, enabled: !!g, ranges: g ? g.ranges.map(({ from, to }) => ({ from, to })) : [] }
    }),
  }
}

function sig(groups: Group[], tz: string, outside: string) {
  return JSON.stringify({ g: groups.map((g) => ({ d: [...g.days].sort(), r: g.ranges.map((r) => [r.from, r.to]) })), tz, outside })
}

/**
 * Sub-painel "Horário de funcionamento" empilhado sobre o painel do recurso (refs. 496/528/536):
 * dias em círculos, intervalos com lixeira, "Adicionar intervalo de horário +", "⊕ Adicionar horários",
 * rodapé Cancelar · Redefinir · ✓ (índigo quando há alteração) — fonio-live2 C-90. Fuso e comportamento fora do horário
 * vêm do registro e são preservados (a Fonio não mostra esses campos no sub-painel).
 */
export function BusinessHoursSheet({
  open,
  onOpenChange,
  value,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  value: BusinessHours
  onConfirm: (bh: BusinessHours) => void
}) {
  const [groups, setGroups] = useState<Group[]>(() => toGroups(value))
  const [tz, setTz] = useState(value.timezone || 'America/Sao_Paulo')
  const [outside, setOutside] = useState(value.outsideBehavior ?? '')
  const [initialSig, setInitialSig] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string>()

  useEffect(() => {
    if (open) {
      const g = toGroups(value)
      setGroups(g)
      setTz(value.timezone || 'America/Sao_Paulo')
      setOutside(value.outsideBehavior ?? '')
      setInitialSig(sig(g, value.timezone || 'America/Sao_Paulo', value.outsideBehavior ?? ''))
      setErrors({})
      setFormError(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const dirty = useMemo(() => sig(groups, tz, outside) !== initialSig, [groups, tz, outside, initialSig])

  const toggleDay = (gid: string, day: number) => {
    setFormError(undefined)
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id === gid) return { ...g, days: g.days.includes(day) ? g.days.filter((d) => d !== day) : [...g.days, day] }
        // um dia pertence a um único grupo
        return { ...g, days: g.days.filter((d) => d !== day) }
      }),
    )
  }
  const patchRange = (gid: string, rid: string, patch: Partial<Range>) =>
    setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, ranges: g.ranges.map((r) => (r.id === rid ? { ...r, ...patch } : r)) } : g)))
  const removeRange = (gid: string, rid: string) =>
    setGroups((prev) => {
      const g = prev.find((x) => x.id === gid)!
      if (g.ranges.length > 1) return prev.map((x) => (x.id === gid ? { ...x, ranges: x.ranges.filter((r) => r.id !== rid) } : x))
      if (prev.length > 1) return prev.filter((x) => x.id !== gid)
      // único grupo e único intervalo: a lixeira (sempre ativa na ref. 496) esvazia os intervalos
      return prev.map((x) => (x.id === gid ? { ...x, ranges: [] } : x))
    })
  const addRange = (gid: string) =>
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== gid) return g
        const last = g.ranges[g.ranges.length - 1]
        const from = last ? last.to : '08:00'
        const [h] = from.split(':').map(Number)
        const to = `${String(Math.min(23, (h ?? 8) + 2)).padStart(2, '0')}:00`
        return { ...g, ranges: [...g.ranges, newRange(from, to > from ? to : '23:59')] }
      }),
    )
  const reset = () => {
    const g = toGroups(value)
    setGroups(g)
    setTz(value.timezone || 'America/Sao_Paulo')
    setOutside(value.outsideBehavior ?? '')
    setErrors({})
    setFormError(undefined)
  }

  const confirm = () => {
    const errs: Record<string, string> = {}
    for (const g of groups) {
      const sorted = [...g.ranges].sort((a, b) => a.from.localeCompare(b.from))
      sorted.forEach((r, i) => {
        if (!r.from || !r.to) errs[r.id] = 'Informe o horário inicial e o final.'
        else if (r.to <= r.from) errs[r.id] = 'O horário final deve ser depois do inicial.'
        else if (i > 0 && r.from < sorted[i - 1]!.to) errs[r.id] = 'Os intervalos não podem se sobrepor.'
      })
    }
    setErrors(errs)
    const used = groups.filter((g) => g.days.length)
    if (!used.length) {
      setFormError('Selecione pelo menos um dia.')
      return
    }
    if (used.some((g) => !g.ranges.length)) {
      setFormError('Adicione pelo menos um intervalo de horário para os dias selecionados.')
      return
    }
    if (Object.keys(errs).length) return
    onConfirm(fromGroups(used, tz, outside.trim()))
    onOpenChange(false)
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      width={384}
      title="Horário de funcionamento"
      footer={
        <div className="flex items-center justify-between gap-2">
          {/* ref. 496: botões do rodapé e "Adicionar horários" com 36px de altura e 12px de respiro lateral */}
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button type="button" variant="ghost" onClick={reset}>
                Redefinir
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              aria-label="Confirmar horário de funcionamento"
              onClick={confirm}
              className={cn('size-9 rounded-lg', dirty ? 'bg-brand text-white hover:bg-[#464ac4]' : '')}
            >
              <Check className="size-5" />
            </Button>
          </div>
        </div>
      }
    >
      <div className="-mt-2 flex flex-col gap-6" data-testid="business-hours-sheet">
        {groups.map((g, gi) => (
          <div key={g.id} className={cn('flex flex-col gap-3', gi > 0 && 'border-t pt-6')}>
            <div className="flex flex-wrap justify-between gap-1.5" role="group" aria-label="Dias da semana">
              {DAY_ORDER.map((d) => {
                const on = g.days.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(g.id, d)}
                    className={cn(
                      'flex size-10 items-center justify-center rounded-full border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      // ref. 496: círculos de 40px; selecionado = borda de 2px e texto índigo sobre branco; hover = fundo lilás
                      on ? 'border-2 border-brand bg-background text-brand hover:bg-brand/10' : 'border-border bg-background text-foreground hover:border-foreground/40',
                    )}
                  >
                    {DAY_SHORT[d]}
                  </button>
                )
              })}
            </div>
            <div className="flex flex-col items-end gap-2">
              {g.ranges.map((r) => (
                <div key={r.id} className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                    <input
                      type="time"
                      aria-label="Início"
                      value={r.from}
                      onChange={(e) => patchRange(g.id, r.id, { from: e.target.value })}
                      aria-invalid={!!errors[r.id] || undefined}
                      className="h-9 w-[67px] rounded-md border border-input bg-background px-1 text-center text-sm tabular-nums aria-[invalid=true]:border-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-datetime-edit]:mx-auto"
                    />
                    <span className="text-muted-foreground">—</span>
                    <input
                      type="time"
                      aria-label="Fim"
                      value={r.to}
                      onChange={(e) => patchRange(g.id, r.id, { to: e.target.value })}
                      aria-invalid={!!errors[r.id] || undefined}
                      className="h-9 w-[67px] rounded-md border border-input bg-background px-1 text-center text-sm tabular-nums aria-[invalid=true]:border-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-datetime-edit]:mx-auto"
                    />
                    </div>
                    <button
                      type="button"
                      aria-label="Remover intervalo"
                      onClick={() => removeRange(g.id, r.id)}
                      className="inline-flex size-4 items-center justify-center rounded-sm text-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <FieldError>{errors[r.id]}</FieldError>
                </div>
              ))}
              {/* ref. 496: texto 12px regular, 12px abaixo do intervalo, "+" 16px a 9px do texto */}
              <button type="button" onClick={() => addRange(g.id)} className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-xs leading-4 text-foreground hover:text-brand">
                Adicionar intervalo de horário <Plus className="size-4" />
              </button>
            </div>
          </div>
        ))}
        <div className="border-t pt-6">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setGroups((prev) => [...prev, newGroup()])}
            disabled={groups.reduce((n, g) => n + g.days.length, 0) >= 7 && groups.every((g) => g.days.length > 0)}
            className="gap-2"
          >
            <CirclePlus className="size-4" /> Adicionar horários
          </Button>
        </div>
        <FieldError>{formError}</FieldError>
      </div>
    </SideSheet>
  )
}
