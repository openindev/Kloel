import type { BusinessHours } from '@/domain/types'
import type { ActiveWindow, ExecutionTiming } from '@/domain/ext/agents-resources'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'

export const EXECUTION_LABEL: Record<ExecutionTiming, string> = {
  before: 'Antes da conversa',
  during: 'Durante a conversa',
  after: 'Após a conversa',
}

export const WINDOW_LABEL: Record<ActiveWindow, string> = {
  any: 'A qualquer momento',
  during: 'Durante o horário de funcionamento',
  outside: 'Fora do horário de funcionamento',
}

export const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
/** Ordem de exibição (segunda → domingo), como na referência. */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function ExecutionSelect({ value, onChange, id }: { value: ExecutionTiming; onChange: (v: ExecutionTiming) => void; id?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ExecutionTiming)}>
      <SelectTrigger id={id} aria-label="Momento de execução">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(EXECUTION_LABEL) as ExecutionTiming[]).map((k) => (
          <SelectItem key={k} value={k} className="pl-8 pr-2 [&>span:first-child]:left-2 [&>span:first-child]:right-auto">
            {EXECUTION_LABEL[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Seletor "Ativo"/janela: "A qualquer momento" | "Durante…" | "Fora…" (desabilitados até existir horário) |
 * "Configurar horário de funcionamento…" (abre o sub-painel empilhado).
 */
export function WindowSelect({
  value,
  onChange,
  hoursConfigured,
  onConfigure,
  id,
}: {
  value: ActiveWindow
  onChange: (v: ActiveWindow) => void
  hoursConfigured: boolean
  onConfigure: () => void
  id?: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === '__configure') onConfigure()
        else onChange(v as ActiveWindow)
      }}
    >
      <SelectTrigger id={id} aria-label="Janela de execução">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(WINDOW_LABEL) as ActiveWindow[]).map((k) => (
          <SelectItem
            key={k}
            value={k}
            disabled={k !== 'any' && !hoursConfigured}
            className="pl-8 pr-2 [&>span:first-child]:left-2 [&>span:first-child]:right-auto"
          >
            {WINDOW_LABEL[k]}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value="__configure" className="pl-8 pr-2">
          Configurar horário de funcionamento…
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

/** "Ativo": só o seletor de janela (fonio-live2 C-31/41/54: sem botão ao lado). */
export function WindowControl(props: { value: ActiveWindow; onChange: (v: ActiveWindow) => void; hoursConfigured: boolean; onConfigure: () => void; id?: string; className?: string }) {
  const { className, ...rest } = props
  return (
    <div className={cn('min-w-0', className)}>
      <WindowSelect {...rest} />
    </div>
  )
}

/**
 * "Execução": momento (antes/durante/depois) + janela, dois seletores de mesma largura lado a lado com 8px entre eles
 * (fonio-live2 C-38 e-mail, C-56 Make, C-63 Requisição HTTP). No celular ficam empilhados.
 */
export function ExecutionControl(props: {
  timing: ExecutionTiming
  onTimingChange: (v: ExecutionTiming) => void
  win: ActiveWindow
  onWinChange: (v: ActiveWindow) => void
  hoursConfigured: boolean
  onConfigure: () => void
  timingId?: string
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="min-w-0">
        <ExecutionSelect id={props.timingId} value={props.timing} onChange={props.onTimingChange} />
      </div>
      <div className="min-w-0">
        <WindowSelect value={props.win} onChange={props.onWinChange} hoursConfigured={props.hoursConfigured} onConfigure={props.onConfigure} />
      </div>
    </div>
  )
}

/** Resumo legível do horário ("Seg–Sex 08:00–18:00 · Sáb 08:00–12:00"). */
export function summarizeHours(bh: BusinessHours | undefined) {
  if (!bh?.enabled) return 'Horário de funcionamento não configurado'
  const groups = new Map<string, number[]>()
  for (const d of DAY_ORDER) {
    const day = bh.days.find((x) => x.day === d)
    if (!day?.enabled || !day.ranges.length) continue
    const k = day.ranges.map((r) => `${r.from}–${r.to}`).join(', ')
    groups.set(k, [...(groups.get(k) ?? []), d])
  }
  if (!groups.size) return 'Nenhum dia configurado'
  return [...groups.entries()]
    .map(([k, days]) => {
      const idx = days.map((d) => DAY_ORDER.indexOf(d))
      const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1)
      const label = days.length > 2 && contiguous ? `${DAY_SHORT[days[0]!]}–${DAY_SHORT[days[days.length - 1]!]}` : days.map((d) => DAY_SHORT[d]).join(', ')
      return `${label} ${k}`
    })
    .join(' · ')
}

export const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' },
  { value: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { value: 'America/Recife', label: 'Recife (GMT-3)' },
  { value: 'America/Belem', label: 'Belém (GMT-3)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (GMT-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (GMT-5)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (GMT-2)' },
  { value: 'Europe/Lisbon', label: 'Lisboa (GMT+0)' },
  { value: 'America/New_York', label: 'Nova York (GMT-5)' },
  { value: 'Europe/Vienna', label: 'Viena (GMT+1)' },
  { value: 'UTC', label: 'UTC' },
]

/** Lista de fusos incluindo o valor atual (caso venha de outra tela com um fuso fora da lista). */
export const tzOptions = (current?: string) => (current && !TIMEZONES.some((t) => t.value === current) ? [...TIMEZONES, { value: current, label: current }] : TIMEZONES)
