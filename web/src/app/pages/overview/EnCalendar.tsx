import type * as React from 'react'
import { DayPicker } from 'react-day-picker'
import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type EnCalendarProps = React.ComponentProps<typeof DayPicker>

/**
 * Calendário igual ao da Fonio ao vivo (shadcn Calendar sobre react-day-picker SEM locale → inglês):
 * "September 2026", cabeçalho "Su Mo Tu We Th Fr Sa" (semana começa no domingo), `--cell-size: 2rem` (células de 32px,
 * linhas com mt-2), navegação "Go to the Previous Month" / "Go to the Next Month", início/fim do intervalo bg-primary,
 * meio do intervalo bg-accent sem arredondamento, hoje bg-accent, dias desabilitados opacity-50.
 * Referências: fonio-live2/B-visao-geral/05-personalizado-calendario.{jpg,txt} (2 meses, ~488px) e
 * fonio-live2/D-conversas/07-filtro-data.jpg (1 mês no filtro "Data" de Conversas).
 */
export function EnCalendar({ className, classNames, ...props }: EnCalendarProps) {
  return (
    <DayPicker
      locale={enUS}
      showOutsideDays
      weekStartsOn={0}
      className={cn('w-fit bg-background p-3', className)}
      labels={{
        labelPrevious: () => 'Go to the Previous Month',
        labelNext: () => 'Go to the Next Month',
        labelDay: (day, mods) => `${mods.today ? 'Today, ' : ''}${format(day, 'EEEE, MMMM do, yyyy', { locale: enUS })}${mods.selected ? ', selected' : ''}`,
      }}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'flex flex-col gap-4',
        caption: 'relative flex h-8 w-full items-center justify-center',
        caption_label: 'select-none text-sm font-medium',
        nav: 'flex items-center',
        nav_button:
          'inline-flex size-8 items-center justify-center rounded-md p-0 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        nav_button_previous: 'absolute left-0',
        nav_button_next: 'absolute right-0',
        table: 'w-full border-collapse',
        head_row: 'flex',
        head_cell: 'w-8 flex-1 select-none rounded-md text-[0.8rem] font-normal text-muted-foreground',
        row: 'mt-2 flex w-full',
        cell: 'relative size-8 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md [&:has(.day-range-start)]:rounded-l-md [&:has(.day-range-end)]:rounded-r-md',
        day: 'inline-flex size-8 items-center justify-center rounded-md p-0 text-sm font-normal hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-selected:opacity-100',
        day_selected: '',
        day_range_start: 'day-range-start !bg-primary !text-primary-foreground',
        day_range_end: 'day-range-end !bg-primary !text-primary-foreground',
        // a faixa do intervalo vem da célula (cantos arredondados no começo/fim de cada semana, como na Fonio)
        day_range_middle: 'rounded-none aria-selected:bg-transparent aria-selected:text-accent-foreground',
        day_today: 'bg-accent text-accent-foreground',
        day_outside: 'day-outside text-muted-foreground',
        day_disabled: 'text-muted-foreground opacity-50',
        day_hidden: 'invisible',
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="size-4" />,
        IconRight: () => <ChevronRight className="size-4" />,
      }}
      {...props}
    />
  )
}
