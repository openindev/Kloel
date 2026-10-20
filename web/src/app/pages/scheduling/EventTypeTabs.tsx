import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronsUpDown, CircleCheck, CirclePlus, CircleX, Copy, ExternalLink, ListEnd, Lock, Pencil, Phone, Plus, SlidersHorizontal, SquarePen, Trash2, UserPen, Webhook, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Agent, EventType } from '@/domain/types'
import type { ActiveWindow } from '@/domain/ext/agents-resources'
import type { BookingEvent, EventWebhook, WebPhoneMode } from '@/domain/ext/scheduling'
import '@/domain/ext/mais-a'
import '@/domain/ext/agents-resources'
import '@/domain/ext/scheduling'
import { cn, uid } from '@/lib/utils'
import { useCollection, useCurrentOrg, useStore } from '@/data/store'
import { useOperation } from '@/hooks/useOperation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { OpStatus as OperationStatusView } from '../phone-numbers/OpStatus'
import { GoogleIcon, MicrosoftIcon } from '@/components/brand/icons'
import { useSchedulingCalendars, eventPublicPath, loadNotificationHistory, testEventWebhook, e164, NOTIFICATION_EVENT_LABEL, NOTIFICATION_STATUS_LABEL } from '@/services/casca/scheduling'
import type { NotificationRecord } from '@/services/engine/scheduling'
import { PROVIDER_LABEL } from './SchedulingDialogs'
import { DAY_LABEL, NO_LIMIT_DAYS, TIMEZONES, WEEK_ORDER, tzLabel } from './slots'
import { BOOKING_EVENT_LABEL, LOCATION_KINDS, LOCATION_KIND_ICON, LOCATION_KIND_LABEL, WEB_PHONE_LABEL, hoursLabel, isEmail, minutesLabel, windowLabel } from './model'

export type Draft = EventType
export type SetDraft = (fn: (d: Draft) => Draft) => void
export type Errors = Partial<Record<string, string>>

/** Seletor compacto das "Regras de agendamento" (texto + chevron, borda fina — AP-03). */
const COMPACT_SELECT = 'h-8 w-auto min-w-0 gap-1.5 rounded-lg px-2.5 text-[13px] font-medium shadow-none'
const FIELD_INPUT = 'h-10 rounded-lg shadow-none'

function Err({ children, className }: { children?: string; className?: string }) {
  if (!children) return null
  return <p className={cn('mt-1.5 text-sm font-medium text-destructive', className)}>{children}</p>
}

function FieldLabel({ children, htmlFor, action }: { children: ReactNode; htmlFor?: string; action?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-5 items-center justify-between gap-3">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {children}
      </Label>
      {action}
    </div>
  )
}

function BlockTitle({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/** Estado vazio pequeno dentro das seções (Lembretes, Campos, Webhooks, Agentes). */
export function MiniEmpty({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center px-6 pb-8 pt-10 text-center">
      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground [&>svg]:size-4">{icon}</div>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">{description}</p>}
    </div>
  )
}

export function CompactSelect<T extends string | number>({ value, onChange, options, label, render }: { value: T; onChange: (v: T) => void; options: T[]; label: string; render: (v: T) => string }) {
  const all = [...new Set([...options, value])]
  if (typeof value === 'number') (all as number[]).sort((a, b) => a - b)
  return (
    <Select value={String(value)} onValueChange={(v) => onChange((typeof value === 'number' ? Number(v) : v) as T)}>
      <SelectTrigger aria-label={label} className={COMPACT_SELECT}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {all.map((n) => (
          <SelectItem key={String(n)} value={String(n)}>
            {render(n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

async function copy(text: string, title = 'Link copiado') {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* sem permissão: o link ainda aparece no toast */
  }
  toast.success(title, { description: text })
}

/* ---------------------------------- Geral ---------------------------------- */

function CalendarSettings({ draft, set }: { draft: Draft; set: SetDraft }) {
  const calendars = useSchedulingCalendars()
  const extra = draft.conflictCalendarIds ?? []
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Calendários verificados para conflitos" className="shrink-0 text-muted-foreground">
          <SlidersHorizontal className="size-4" />
          {extra.length > 0 && <span className="absolute -mt-5 ml-5 size-1.5 rounded-full bg-brand" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Verificar conflitos</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Compromissos destes calendários também bloqueiam horários deste tipo de evento.</p>
        </div>
        <ul className="flex flex-col gap-1 p-2">
          {calendars.map((c) => {
            const own = c.id === draft.calendarId
            const checked = own || extra.includes(c.id)
            return (
              <li key={c.id}>
                <label className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm', !own && 'cursor-pointer hover:bg-accent')}>
                  <Checkbox
                    checked={checked}
                    disabled={own}
                    aria-label={`Verificar conflitos em ${c.email}`}
                    onCheckedChange={(v) => set((d) => ({ ...d, conflictCalendarIds: v ? [...(d.conflictCalendarIds ?? []), c.id] : (d.conflictCalendarIds ?? []).filter((x) => x !== c.id) }))}
                  />
                  {c.provider === 'google' ? <GoogleIcon className="size-4 shrink-0" /> : c.provider === 'microsoft' ? <MicrosoftIcon className="size-4 shrink-0" /> : null}
                  <span className="min-w-0 flex-1 truncate">{c.email}</span>
                  {own && <span className="shrink-0 text-[11px] text-muted-foreground">deste evento</span>}
                </label>
              </li>
            )
          })}
          {calendars.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">Nenhum calendário conectado.</li>}
        </ul>
        <div className="border-t px-4 py-2.5">
          <Link to="/app/company-settings?tab=connections" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Gerenciar calendários
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function InviteesInput({ draft, set }: { draft: Draft; set: SetDraft }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const list = draft.staticInvitees ?? []
  const add = () => {
    const parts = text.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    if (!parts.length) return
    const bad = parts.find((p) => !isEmail(p))
    if (bad) return setError(`"${bad}" não é um e-mail válido.`)
    const dup = parts.find((p) => list.includes(p))
    if (dup) return setError(`${dup} já está na lista.`)
    if (list.length + parts.length > 10) return setError('Adicione no máximo 10 convidados fixos.')
    set((d) => ({ ...d, staticInvitees: [...(d.staticInvitees ?? []), ...new Set(parts)] }))
    setText('')
    setError(undefined)
  }
  return (
    <div>
      <div
        className={cn(
          'flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring',
          error && 'border-destructive',
        )}
      >
        {list.map((e) => (
          <span key={e} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[13px]" data-testid="invitee-chip">
            <span className="truncate">{e}</span>
            <button type="button" aria-label={`Remover ${e}`} className="text-muted-foreground hover:text-foreground" onClick={() => set((d) => ({ ...d, staticInvitees: (d.staticInvitees ?? []).filter((x) => x !== e) }))}>
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id="et-invitees"
          aria-label="Convidados fixos"
          aria-invalid={!!error || undefined}
          className="h-7 min-w-40 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
          placeholder={list.length ? 'Adicionar outro e-mail' : 'exemplo@exemplo.com.br'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(undefined)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            } else if (e.key === 'Backspace' && !text && list.length) set((d) => ({ ...d, staticInvitees: (d.staticInvitees ?? []).slice(0, -1) }))
          }}
          onBlur={add}
        />
      </div>
      <Err>{error}</Err>
    </div>
  )
}

export function GeneralTab({ draft, set, errors, saved, onAddCalendar }: { draft: Draft; set: SetDraft; errors: Errors; saved: EventType; onAddCalendar: () => void }) {
  const calendars = useSchedulingCalendars()
  const org = useCurrentOrg()
  const prefix = eventPublicPath(saved) ? `${window.location.origin}${eventPublicPath(saved)!.slice(0, eventPublicPath(saved)!.lastIndexOf('/') + 1)}` : ''
  const url = prefix ? `${prefix}${saved.slug}` : ''
  const kind = draft.locationKind ?? 'none'
  const cal = calendars.find((c) => c.id === draft.calendarId)
  return (
    <div className="flex w-full flex-col gap-7">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor="et-title">Título</FieldLabel>
          <Input id="et-title" className={FIELD_INPUT} value={draft.name} aria-invalid={!!errors.name || undefined} onChange={(e) => set((d) => ({ ...d, name: e.target.value }))} />
          <Err>{errors.name}</Err>
        </div>
        <div className="w-24 shrink-0">
          <FieldLabel htmlFor="et-duration">Duração</FieldLabel>
          <div className="relative">
            <Input
              id="et-duration"
              type="number"
              inputMode="numeric"
              min={5}
              max={720}
              step={5}
              className={cn(FIELD_INPUT, 'pr-11 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none')}
              value={Number.isFinite(draft.durationMin) ? draft.durationMin : ''}
              aria-invalid={!!errors.durationMin || undefined}
              onChange={(e) => set((d) => ({ ...d, durationMin: e.target.value === '' ? Number.NaN : Number(e.target.value) }))}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">Min.</span>
          </div>
        </div>
      </div>
      {errors.durationMin && <Err className="-mt-5">{errors.durationMin}</Err>}

      <div>
        <FieldLabel htmlFor="et-description">Descrição</FieldLabel>
        <Textarea id="et-description" rows={3} className="min-h-20 rounded-lg shadow-none" value={draft.description} onChange={(e) => set((d) => ({ ...d, description: e.target.value }))} placeholder="Ex.: Primeira avaliação gratuita para novos pacientes." />
      </div>

      <div>
        <FieldLabel
          action={
            <Button type="button" variant="outline" size="xs" className="h-7 gap-1 rounded-md px-2 text-[13px] font-normal text-muted-foreground shadow-none" onClick={onAddCalendar}>
              <Plus className="size-3.5" /> Adicionar calendário
            </Button>
          }
        >
          Calendário
        </FieldLabel>
        <div className="flex items-center gap-2">
          {/* calendário removido em Configurações da empresa: o rascunho guarda o id antigo, mas o seletor volta ao placeholder */}
          <Select value={cal ? draft.calendarId : ''} onValueChange={(v) => set((d) => ({ ...d, calendarId: v, conflictCalendarIds: (d.conflictCalendarIds ?? []).filter((x) => x !== v) }))}>
            <SelectTrigger aria-label="Calendário" className={cn(FIELD_INPUT, 'min-w-0 flex-1')}>
              <SelectValue placeholder="Selecione um calendário" />
            </SelectTrigger>
            <SelectContent>
              {calendars.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    {c.provider === 'google' ? <GoogleIcon className="size-4 shrink-0" /> : c.provider === 'microsoft' ? <MicrosoftIcon className="size-4 shrink-0" /> : null}
                    <span className="truncate">{c.email}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CalendarSettings draft={draft} set={set} />
        </div>
      </div>

      <div>
        <FieldLabel>Local</FieldLabel>
        <div role="radiogroup" aria-label="Local" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {LOCATION_KINDS.map((k) => {
            const Icon = LOCATION_KIND_ICON[k]
            const on = kind === k
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set((d) => ({ ...d, locationKind: k }))}
                className={cn(
                  'flex min-h-[3.75rem] flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-center text-[13px] font-medium leading-4 transition-colors',
                  on ? 'border-foreground/70 bg-muted' : 'border-border bg-background hover:bg-accent',
                )}
              >
                <Icon className="size-4" />
                {LOCATION_KIND_LABEL[k]}
              </button>
            )
          })}
        </div>
        {kind === 'online' && (
          <p className="mt-2 text-xs text-muted-foreground">
            Adiciona automaticamente um link do {cal?.provider === 'microsoft' ? 'Microsoft Teams' : cal?.provider === 'google' ? 'Google Meet' : 'Google Meet ou do Microsoft Teams'} a cada agendamento, quando o calendário conectado permite videoconferência. O link vai no e-mail de confirmação e na página de reserva.
          </p>
        )}
        {kind === 'phone' && (
          <div className="mt-2">
            <Input
              aria-label="Telefone para a ligação"
              className={FIELD_INPUT}
              inputMode="tel"
              maxLength={24}
              value={draft.locationPhone ?? ''}
              placeholder="Opcional: número que o convidado deve ligar, ex.: +55 11 3000-0000"
              aria-invalid={!!errors.locationPhone || undefined}
              onChange={(e) => set((d) => ({ ...d, locationPhone: e.target.value }))}
            />
            <Err>{errors.locationPhone}</Err>
            <p className="mt-2 text-xs text-muted-foreground">
              {(draft.locationPhone ?? '').trim() && e164(draft.locationPhone) ? 'O convidado liga para este número no horário marcado.' : 'Sem número, a sua equipe liga para o telefone informado na reserva (o telefone passa a ser obrigatório).'}
            </p>
          </div>
        )}
        {kind === 'physical' && (
          <div className="mt-2">
            <Input
              aria-label="Endereço do local"
              className={FIELD_INPUT}
              maxLength={160}
              value={draft.locationAddress ?? ''}
              placeholder="Endereço, ex.: Rua Exemplo, 100 — São Paulo"
              onChange={(e) => set((d) => ({ ...d, locationAddress: e.target.value }))}
            />
            <p className="mt-2 text-xs text-muted-foreground">Exibido na página de reserva e nas notificações. Sem endereço, aparece só “Local físico”.</p>
          </div>
        )}
      </div>

      <div>
        <FieldLabel
          htmlFor="et-slug"
          action={
            <Button type="button" variant="ghost" size="xs" className="h-7 gap-1.5 px-2 text-[13px] font-normal text-muted-foreground" disabled={!url} onClick={() => copy(url)}>
              <Copy className="size-3.5" /> Copiar
            </Button>
          }
        >
          Página de reserva do evento
        </FieldLabel>
        <div className={cn('flex h-10 min-w-0 items-center rounded-lg border border-input bg-background text-sm focus-within:ring-1 focus-within:ring-ring', errors.slug && 'border-destructive')}>
          <span className="min-w-0 shrink truncate pl-3 text-muted-foreground" title={prefix}>
            {prefix}
          </span>
          <input
            id="et-slug"
            aria-label="Endereço da página de reserva"
            className="h-full min-w-16 flex-1 rounded-r-lg bg-transparent pr-3 font-semibold outline-none"
            style={{ width: `${Math.max(4, draft.slug.length + 1)}ch` }}
            value={draft.slug}
            onChange={(e) => set((d) => ({ ...d, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }))}
          />
        </div>
        <Err>{errors.slug}</Err>
      </div>

      <div>
        <Label htmlFor="et-invitees" className="text-sm font-medium">
          Convidados fixos
        </Label>
        <p className="mb-2 mt-1 text-sm text-muted-foreground">E-mails convidados para todo agendamento. A disponibilidade deles não é verificada ao buscar horários livres.</p>
        <InviteesInput draft={draft} set={set} />
      </div>
    </div>
  )
}

/* ------------------------------ Disponibilidade ------------------------------ */

const fmtRange = (a: { from: string; to: string }) => `${a.from} — ${a.to}`

type Day = EventType['availability'][number]

/** Editor da agenda semanal (botão "Editar" — a agenda fica somente leitura na aba, como na referência). */
function ScheduleDialog({ open, onOpenChange, value, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; value: Day[]; onApply: (v: Day[]) => void }) {
  const [days, setDays] = useState<Day[]>(value)
  const [tried, setTried] = useState(false)
  const errs = useMemo(() => {
    const e: Record<string, string> = {}
    days.forEach((a) => {
      if (a.enabled && (!a.from || !a.to || a.from >= a.to)) e[`day-${a.day}`] = 'O horário final deve ser depois do inicial.'
    })
    if (!days.some((a) => a.enabled)) e.all = 'Ative pelo menos um dia da semana.'
    return e
  }, [days])
  const setDay = (day: number, p: Partial<Day>) => setDays((list) => (list.some((a) => a.day === day) ? list.map((a) => (a.day === day ? { ...a, ...p } : a)) : [...list, { day, enabled: false, from: '09:00', to: '18:00', ...p }]))
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setDays(value)
          setTried(false)
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader className="gap-y-2">
          <DialogTitle>Editar disponibilidade</DialogTitle>
          <DialogDescription>Defina os dias e horários em que os compromissos podem ser agendados.</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-[60vh] divide-y overflow-y-auto px-1">
          {WEEK_ORDER.map((day) => {
            const a = days.find((x) => x.day === day) ?? { day, enabled: false, from: '09:00', to: '18:00' }
            const err = tried ? errs[`day-${day}`] : undefined
            return (
              <div key={day} className="py-2.5">
                <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex w-44 shrink-0 items-center gap-3 text-sm font-medium">
                    <Switch checked={a.enabled} onCheckedChange={(v) => setDay(day, { enabled: v })} aria-label={DAY_LABEL[day]} />
                    {DAY_LABEL[day]}
                  </label>
                  <div className="flex flex-1 items-center justify-end gap-2">
                    {a.enabled ? (
                      <>
                        <Input type="time" aria-label={`${DAY_LABEL[day]} início`} className="h-8 w-28 rounded-lg px-3 text-[13px] shadow-none" value={a.from} aria-invalid={!!err || undefined} onChange={(e) => setDay(day, { from: e.target.value })} />
                        <span className="text-muted-foreground">—</span>
                        <Input type="time" aria-label={`${DAY_LABEL[day]} fim`} className="h-8 w-28 rounded-lg px-3 text-[13px] shadow-none" value={a.to} aria-invalid={!!err || undefined} onChange={(e) => setDay(day, { to: e.target.value })} />
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">fechado</span>
                    )}
                  </div>
                </div>
                <Err className="mt-1">{err}</Err>
              </div>
            )
          })}
        </div>
        {tried && <Err className="mt-0">{errs.all}</Err>}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              setTried(true)
              if (Object.keys(errs).length) return
              onApply([...days].sort((x, y) => x.day - y.day))
              onOpenChange(false)
            }}
          >
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AvailabilityTab({ draft, set, errors }: { draft: Draft; set: SetDraft; errors: Errors }) {
  const [editing, setEditing] = useState(false)
  const tz = draft.timezone ?? 'America/Sao_Paulo'
  const tzOptions = TIMEZONES.some((t) => t.id === tz) ? TIMEZONES : [...TIMEZONES, { id: tz, label: tzLabel(tz) }]
  const setA = (p: Partial<EventType['advanced']>) => set((d) => ({ ...d, advanced: { ...d.advanced, ...p } }))
  return (
    <div className="flex w-full flex-col gap-7">
      <div>
        <FieldLabel>Fuso horário</FieldLabel>
        <Select value={tz} onValueChange={(v) => set((d) => ({ ...d, timezone: v }))}>
          <SelectTrigger aria-label="Fuso horário" className={cn(FIELD_INPUT, '[&>svg:last-child]:hidden')}>
            <SelectValue />
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </SelectTrigger>
          <SelectContent>
            {tzOptions.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <BlockTitle
          title={<span className="font-medium">Agenda de disponibilidade</span>}
          description="Defina quando os compromissos podem ser agendados"
          action={
            <Button type="button" variant="outline" size="xs" className="h-8 shrink-0 gap-1.5 rounded-md px-2.5 text-[13px] shadow-none" onClick={() => setEditing(true)}>
              <SquarePen className="size-3.5" /> Editar
            </Button>
          }
        />
        <ul className="mt-1 divide-y" aria-label="Agenda de disponibilidade" data-testid="weekly-schedule">
          {WEEK_ORDER.map((day) => {
            const a = draft.availability.find((x) => x.day === day)
            const on = !!a?.enabled
            return (
              <li key={day} className="flex h-[52px] items-center justify-between gap-3 text-sm">
                <span className={on ? 'font-medium' : 'text-muted-foreground'}>{DAY_LABEL[day]}</span>
                <span className={cn('tabular-nums', on ? 'font-medium' : 'text-muted-foreground')}>{on && a ? fmtRange(a) : 'fechado'}</span>
              </li>
            )
          })}
        </ul>
        <Err>{errors.availability}</Err>
      </div>

      <div className="border-t pt-7">
        <p className="mb-3 text-sm font-semibold">Regras de agendamento</p>
        <div className="flex flex-col">
          {(
            [
              ['Antecedência mínima', <CompactSelect key="n" label="Antecedência mínima" value={draft.minNoticeHours} options={[0, 1, 2, 4, 8, 12, 24, 48]} render={hoursLabel} onChange={(v) => set((d) => ({ ...d, minNoticeHours: v }))} />],
              ['Intervalo entre compromissos', <CompactSelect key="b" label="Intervalo entre compromissos" value={draft.bufferMin} options={[0, 5, 10, 15, 30, 60]} render={minutesLabel} onChange={(v) => set((d) => ({ ...d, bufferMin: v }))} />],
              ['Janela máxima de agendamento', <CompactSelect key="w" label="Janela máxima de agendamento" value={draft.maxDaysAhead} options={[7, 14, 30, 60, 90, 180, NO_LIMIT_DAYS]} render={(n) => (n === NO_LIMIT_DAYS ? 'Sem limite' : windowLabel(n))} onChange={(v) => set((d) => ({ ...d, maxDaysAhead: v }))} />],
              ['Intervalo dos horários', <CompactSelect key="s" label="Intervalo dos horários" value={draft.advanced.slotIntervalMin} options={[10, 15, 20, 30, 45, 60]} render={(n) => `A cada ${n} min`} onChange={(v) => setA({ slotIntervalMin: v })} />],
              ['Máximo de agendamentos por dia', <CompactSelect key="m" label="Máximo de agendamentos por dia" value={draft.advanced.maxPerDay} options={[0, 1, 2, 4, 6, 8, 10, 12, 16, 20]} render={(n) => (n > 0 ? String(n) : 'Sem limite')} onChange={(v) => setA({ maxPerDay: v })} />],
            ] as const
          ).map(([label, control]) => (
            <div key={label} className="flex min-h-10 items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{label}</span>
              {control}
            </div>
          ))}
        </div>
      </div>

      <ScheduleDialog open={editing} onOpenChange={setEditing} value={draft.availability} onApply={(availability) => set((d) => ({ ...d, availability }))} />
    </div>
  )
}

/* ------------------------------- Coleta de dados ------------------------------- */

const FIELD_TYPE: Record<EventType['dataCollection'][number]['type'], string> = { text: 'Texto', phone: 'Telefone', email: 'E-mail' }

function LockedRow({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2 text-sm">
      <span className="text-muted-foreground [&>svg]:size-3.5">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}

export function DataCollectionTab({ draft, set, errors }: { draft: Draft; set: SetDraft; errors: Errors }) {
  const setF = (id: string, p: Partial<EventType['dataCollection'][number]>) => set((d) => ({ ...d, dataCollection: d.dataCollection.map((f) => (f.id === id ? { ...f, ...p } : f)) }))
  const phone = draft.webPhone ?? 'required'
  return (
    <div className="flex w-full flex-col gap-7">
      <p className="-mt-4 text-sm text-muted-foreground">Escolha quais informações coletar quando este evento for agendado por um agente ou pela página de reserva.</p>

      <div>
        <p className="text-sm font-semibold">Campos sempre coletados</p>
        <p className="mb-2 mt-3 text-xs text-muted-foreground">SMS / Agente</p>
        <div className="flex flex-col gap-1 rounded-xl border bg-muted/30 px-3 py-2.5" data-testid="dc-agent-fields">
          <LockedRow icon={<Lock />}>Nome</LockedRow>
          <LockedRow icon={<Lock />}>Telefone</LockedRow>
        </div>
        <p className="mb-2 mt-5 text-xs text-muted-foreground">Agendamento web</p>
        <div className="flex flex-col gap-1 rounded-xl border bg-muted/30 px-3 py-2.5" data-testid="dc-web-fields">
          <LockedRow icon={<Lock />}>Nome</LockedRow>
          <LockedRow icon={<Lock />}>E-mail</LockedRow>
          <LockedRow
            icon={<Phone />}
            action={
              <Select value={phone} onValueChange={(v) => set((d) => ({ ...d, webPhone: v as WebPhoneMode }))}>
                <SelectTrigger aria-label="Telefone no agendamento web" className="h-8 w-40 gap-1.5 rounded-lg bg-background px-2.5 text-[13px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {(Object.keys(WEB_PHONE_LABEL) as WebPhoneMode[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {WEB_PHONE_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            Telefone
          </LockedRow>
          <p className="pl-[1.375rem] text-xs leading-5 text-muted-foreground">Recomendamos sempre coletar o telefone. Assim, quem liga pode consultar e gerenciar seus próximos compromissos!</p>
        </div>
      </div>

      <div>
        <BlockTitle
          title="Campos"
          action={
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="h-8 shrink-0 gap-1 rounded-md px-2.5 text-[13px] shadow-none"
              onClick={() => set((d) => ({ ...d, dataCollection: [...d.dataCollection, { id: uid('dc'), label: '', required: false, type: 'text' }] }))}
            >
              <Plus className="size-3.5" /> Adicionar campo
            </Button>
          }
        />
        {draft.dataCollection.length === 0 ? (
          <MiniEmpty icon={<ListEnd />} title="Nenhum campo personalizado ainda" description="Adicione um campo para coletar mais informações dos convidados ao agendar." />
        ) : (
          <div className="mt-3 divide-y rounded-xl border">
            {draft.dataCollection.map((f) => (
              <div key={f.id}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="dc-row">
                  <Input aria-label="Nome do campo" className="h-8 min-w-40 flex-1 rounded-lg px-3 text-[13px] shadow-none" value={f.label} placeholder="Nome do campo" aria-invalid={!!errors[`dc-${f.id}`] || undefined} onChange={(e) => setF(f.id, { label: e.target.value })} />
                  <Select value={f.type} onValueChange={(v) => setF(f.id, { type: v as typeof f.type })}>
                    <SelectTrigger aria-label="Tipo do campo" className="h-8 w-auto min-w-28 gap-1.5 rounded-lg text-[13px] shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FIELD_TYPE) as (typeof f.type)[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {FIELD_TYPE[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <Switch checked={f.required} onCheckedChange={(v) => setF(f.id, { required: v })} aria-label={`${f.label || 'Campo'} obrigatório`} />
                    Obrigatório
                  </label>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remover ${f.label || 'campo'}`} className="text-muted-foreground hover:text-destructive" onClick={() => set((d) => ({ ...d, dataCollection: d.dataCollection.filter((x) => x.id !== f.id) }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Err className="mt-0 px-4 pb-3">{errors[`dc-${f.id}`]}</Err>
              </div>
            ))}
          </div>
        )}
        {draft.dataCollection.length > 0 && <p className="mt-2 px-1 text-xs text-muted-foreground">Os campos personalizados aparecem no formulário da página de reserva e são pedidos pelo agente durante a conversa.</p>}
      </div>
    </div>
  )
}

/* ---------------------------------- Agentes ---------------------------------- */

const WINDOW_LABEL: Record<ActiveWindow, string> = { any: 'A qualquer momento', during: 'Durante o horário de funcionamento', outside: 'Fora do horário de funcionamento' }

/** Menu "Adicionar ao agente" (rodapé da tabela e barra escura). */
export function AddToAgentMenu({ connected, onAdd, trigger, side = 'bottom' }: { connected: string[]; onAdd: (agentId: string) => void; trigger: ReactNode; side?: 'top' | 'bottom' }) {
  const agents = useCollection('agents')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" className="w-60">
        <DropdownMenuLabel>Adicionar a um assistente</DropdownMenuLabel>
        {agents.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Nenhum assistente</div>}
        {agents.map((a) => {
          const added = connected.includes(a.id)
          return (
            <DropdownMenuItem key={a.id} disabled={added} onSelect={() => onAdd(a.id)}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand">{a.name[0]}</span>
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {added && <span className="text-xs text-muted-foreground">Adicionado</span>}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AgentsTab({ et, onAdd, onRemove }: { et: EventType; onAdd: (agentId: string) => void; onRemove: (agentId: string) => void }) {
  const agents = useCollection('agents')
  const patch = useStore((s) => s.patch)
  const [removing, setRemoving] = useState<Agent>()
  const rows = agents.filter((a) => et.agentIds.includes(a.id)).map((a) => ({ agent: a, action: a.scheduling.find((s) => s.eventTypeId === et.id) }))
  return (
    <div className="flex w-full flex-col gap-6">
      <p className="-mt-4 text-sm text-muted-foreground">Todos os agentes conectados a este evento.</p>
      <div className="overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Agentes conectados">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-normal sm:w-[34%]">Nome</th>
                <th className="px-4 py-2.5 font-normal max-sm:hidden">Ferramenta</th>
                <th className="px-4 py-2.5 font-normal sm:w-[34%]">Ativo</th>
                <th className="w-10 px-2 py-2.5">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <MiniEmpty icon={<UserPen />} title="Nenhum agente conectado" />
                  </td>
                </tr>
              )}
              {rows.map(({ agent: a, action }) => (
                <tr key={a.id} data-testid="agent-row">
                  <td className="px-4 py-2.5">
                    <Link to={`/app/agents/${a.id}/general`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand">{a.name[0]}</span>
                      <span className="truncate">{a.name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 max-sm:hidden">
                    {action ? (
                      <Link to={`/app/agents/${a.id}/general?recurso=agendamento&item=${action.id}`} className="block truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" title="Abrir a ferramenta no assistente">
                        {action.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pl-4 pr-2 sm:px-4">
                    {action ? (
                      <Select
                        value={action.activeWindow ?? 'any'}
                        onValueChange={(v) => {
                          patch('agents', a.id, { scheduling: a.scheduling.map((s) => (s.id === action.id ? { ...s, activeWindow: v as ActiveWindow } : s)), updatedAt: new Date().toISOString() })
                          toast.success('Ferramenta atualizada', { description: `${a.name}: ${WINDOW_LABEL[v as ActiveWindow]}` })
                        }}
                      >
                        <SelectTrigger aria-label={`Ativo — ${a.name}`} className="h-8 w-full max-w-56 gap-1.5 rounded-lg px-2.5 text-[13px] shadow-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(WINDOW_LABEL) as ActiveWindow[]).map((k) => (
                            <SelectItem key={k} value={k}>
                              {WINDOW_LABEL[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button variant="ghost" size="icon-sm" aria-label={`Remover ${a.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => setRemoving(a)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-center border-t py-2">
          <AddToAgentMenu
            connected={et.agentIds}
            onAdd={onAdd}
            trigger={
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-brand hover:bg-brand/5">
                <CirclePlus className="size-4" /> Adicionar ao agente
              </button>
            }
          />
        </div>
      </div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(undefined)}
        title="Remover do agente?"
        description={removing ? `${removing.name} deixa de consultar horários e marcar compromissos de ${et.name}. A ferramenta "Agendar compromissos" correspondente é removida do assistente.` : undefined}
        confirmLabel="Remover"
        onConfirm={() => removing && onRemove(removing.id)}
      />
    </div>
  )
}

/* ---------------------------------- Avançado ---------------------------------- */

const EVENTS: BookingEvent[] = ['created', 'rescheduled', 'canceled']

function WebhookDialog({ open, onOpenChange, initial, others, onSave, eventTypeId }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: EventWebhook; others: EventWebhook[]; onSave: (w: EventWebhook) => void; eventTypeId: string }) {
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<BookingEvent[]>(EVENTS)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const op = useOperation((onProgress, u: string) => { onProgress?.({ step: 1, total: 1, label: 'Enviando requisição de teste…', percent: 50 }); return testEventWebhook(eventTypeId, u) })
  const validate = () => {
    const e: Record<string, string> = {}
    const u = url.trim()
    if (!/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(u)) e.url = 'Use uma URL completa começando com https://.'
    else if (others.some((o) => o.id !== initial?.id && o.url === u)) e.url = 'Este endereço já recebe os eventos deste tipo de evento.'
    if (!events.length) e.events = 'Escolha pelo menos um evento.'
    setErrors(e)
    return !Object.keys(e).length
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setUrl(initial?.url ?? '')
          setEvents(initial?.events ?? EVENTS)
          setErrors({})
          op.reset()
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader className="gap-y-2">
          <DialogTitle>{initial ? 'Editar webhook' : 'Adicionar webhook'}</DialogTitle>
          <DialogDescription>A Kloel envia um POST (JSON) com os dados do agendamento para esta URL, sem repetir em caso de falha.</DialogDescription>
        </DialogHeader>
        <form
          id="et-webhook"
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!validate()) return
            onSave({ id: initial?.id ?? uid('wh'), url: url.trim(), events, createdAt: initial?.createdAt ?? new Date().toISOString() })
            onOpenChange(false)
          }}
        >
          <div>
            <Label htmlFor="et-webhook-url">URL</Label>
            <Input
              id="et-webhook-url"
              className="mt-2"
              placeholder="https://exemplo.com.br/webhooks/agendamentos"
              value={url}
              aria-invalid={!!errors.url || undefined}
              onChange={(e) => {
                setUrl(e.target.value)
                setErrors((x) => ({ ...x, url: '' }))
                op.reset()
              }}
            />
            <Err>{errors.url}</Err>
          </div>
          <div>
            <Label>Eventos</Label>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={events.includes(ev)}
                    aria-label={`Agendamento ${BOOKING_EVENT_LABEL[ev].toLowerCase()}`}
                    onCheckedChange={(v) => {
                      setEvents((list) => (v ? [...list, ev].sort((a, b) => EVENTS.indexOf(a) - EVENTS.indexOf(b)) : list.filter((x) => x !== ev)))
                      setErrors((x) => ({ ...x, events: '' }))
                    }}
                  />
                  Agendamento {BOOKING_EVENT_LABEL[ev].toLowerCase()}
                </label>
              ))}
            </div>
            <Err>{errors.events}</Err>
          </div>
          <div className="space-y-2">
            <Button type="button" variant="outline" size="sm" disabled={op.isRunning} onClick={() => validate() && op.run(url.trim())}>
              Enviar teste
            </Button>
            <OperationStatusView status={op.status} progress={op.progress} error={op.error} onRetry={() => op.run(url.trim())} successText={op.result?.status === 'success' ? `Teste entregue: HTTP ${op.result.code} em ${op.result.ms} ms` : undefined} />
            {op.status === 'success' && op.result?.status === 'error' && <p className="text-sm font-medium text-destructive">O endereço respondeu HTTP {op.result.code}. Confira a URL antes de salvar.</p>}
          </div>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="et-webhook">
            {initial ? 'Salvar webhook' : 'Adicionar webhook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdvancedTab({ draft, set, errors, saved }: { draft: Draft; set: SetDraft; errors: Errors; saved: EventType }) {
  const [dialog, setDialog] = useState<{ open: boolean; edit?: EventWebhook }>({ open: false })
  const [deleting, setDeleting] = useState<EventWebhook>()
  // Página da empresa: mesmo prefixo público da página do evento (/c/o-…); sem publicação ainda não existe link.
  const path = eventPublicPath(saved)
  const companyUrl = path ? `${window.location.origin}${path.slice(0, path.lastIndexOf('/'))}` : ''
  const adv = draft.advanced
  const setA = (p: Partial<EventType['advanced']>) => set((d) => ({ ...d, advanced: { ...d.advanced, ...p } }))
  const hooks = draft.webhooks ?? []
  const [history, setHistory] = useState<NotificationRecord[]>([])
  useEffect(() => {
    if (!saved.engineEvent) return
    const abort = new AbortController()
    loadNotificationHistory(saved.id, abort.signal).then((r) => setHistory(r.items)).catch(() => setHistory([]))
    return () => abort.abort()
  }, [saved.id, saved.engineEvent])
  const deliveries = useMemo(() => history.filter((h) => h.channel === 'webhook').map((h) => ({ webhookId: h.webhookId ?? '', at: h.completedAt ?? h.createdAt, ok: h.status === 'delivered', code: h.httpStatus ?? 0, status: h.status })), [history])
  return (
    <div className="flex w-full flex-col gap-7">
      <div>
        <BlockTitle
          title="Página de reserva da empresa"
          description="Permita que os convidados escolham entre os tipos de compromisso disponíveis da sua empresa em uma única página."
          action={
            <div className="flex shrink-0 items-center">
              <Button type="button" variant="ghost" size="xs" className="h-7 gap-1.5 px-2 text-[13px] font-normal text-muted-foreground" disabled={!companyUrl} onClick={() => copy(companyUrl)}>
                <Copy className="size-3.5" /> Copiar link
              </Button>
              <Button type="button" variant="ghost" size="xs" className="h-7 gap-1.5 px-2 text-[13px] font-normal text-muted-foreground" disabled={!companyUrl} onClick={() => companyUrl && window.open(companyUrl, '_blank', 'noopener')}>
                <ExternalLink className="size-3.5" /> Abrir página
              </Button>
            </div>
          }
        />
        <label className="mt-3 flex min-h-8 items-center justify-between gap-3 text-sm">
          Ocultar da página de reserva da empresa
          <Switch aria-label="Ocultar da página de reserva da empresa" checked={!!draft.hideFromCompanyPage} onCheckedChange={(v) => set((d) => ({ ...d, hideFromCompanyPage: v }))} />
        </label>
        {draft.hideFromCompanyPage && <p className="mt-1 text-xs text-muted-foreground">Oculto da lista da empresa — o link direto da página de reserva do evento continua funcionando.</p>}
      </div>

      <div>
        <BlockTitle title="Nome de exibição na página de reserva" description="Exibido como anfitrião na página de reserva no lugar do e-mail do calendário. Se ficar vazio, o e-mail é exibido." />
        <Input
          aria-label="Nome de exibição na página de reserva"
          className={cn(FIELD_INPUT, 'mt-3')}
          placeholder="ex.: Sua empresa"
          maxLength={60}
          value={draft.hostDisplayName ?? ''}
          aria-invalid={!!errors.hostDisplayName || undefined}
          onChange={(e) => set((d) => ({ ...d, hostDisplayName: e.target.value }))}
        />
        <Err>{errors.hostDisplayName}</Err>
      </div>

      <div>
        <BlockTitle title="Recursos da página de gerenciamento" description="Configure o que o convidado pode fazer na página de gerenciamento do compromisso." />
        <div className="mt-3 flex flex-col gap-1">
          <label className="flex min-h-8 items-center justify-between gap-3 text-sm">
            Reagendar
            <Switch aria-label="Reagendar" checked={adv.allowReschedule} onCheckedChange={(v) => setA({ allowReschedule: v })} />
          </label>
          <label className="flex min-h-8 items-center justify-between gap-3 text-sm">
            Cancelar
            <Switch aria-label="Cancelar" checked={adv.allowCancel} onCheckedChange={(v) => setA({ allowCancel: v })} />
          </label>
        </div>
      </div>

      <div>
        <BlockTitle
          title="Webhooks"
          description="Envie requisições HTTP quando agendamentos forem criados, reagendados ou cancelados"
          action={
            <Button type="button" variant="outline" size="xs" className="h-8 shrink-0 gap-1 rounded-md px-2.5 text-[13px] shadow-none" onClick={() => setDialog({ open: true })}>
              <Plus className="size-3.5" /> Adicionar webhook
            </Button>
          }
        />
        {hooks.length === 0 ? (
          <MiniEmpty icon={<Webhook />} title="Nenhum webhook configurado" description="Adicione um webhook para avisar outro sistema quando um agendamento mudar." />
        ) : (
          <ul className="mt-3 divide-y rounded-xl border">
            {hooks.map((w) => {
              const mine = deliveries.filter((x) => x.webhookId === w.id).sort((a, b) => b.at.localeCompare(a.at))
              const last = mine[0]
              const unsaved = !(saved.webhooks ?? []).some((x) => x.id === w.id)
              return (
                <li key={w.id} className="flex items-center gap-3 px-4 py-3" data-testid="webhook-row">
                  <Webhook className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{w.url}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {w.events.map((ev) => (
                        <span key={ev} className="rounded border px-1.5 py-px">
                          {BOOKING_EVENT_LABEL[ev]}
                        </span>
                      ))}
                      {unsaved ? (
                        <span>Salve para ativar</span>
                      ) : last ? (
                        <span className={cn('inline-flex items-center gap-1', last.ok ? 'text-emerald-700' : 'text-destructive')} data-testid="webhook-last">
                          {last.ok ? <CircleCheck className="size-3" /> : <CircleX className="size-3" />}
                          {mine.length} {mine.length === 1 ? 'entrega' : 'entregas'} · última {last.code ? `HTTP ${last.code}` : NOTIFICATION_STATUS_LABEL[last.status] ?? last.status}
                        </span>
                      ) : (
                        <span>Nenhuma entrega ainda</span>
                      )}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Editar ${w.url}`} className="text-muted-foreground" onClick={() => setDialog({ open: true, edit: w })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remover ${w.url}`} className="text-muted-foreground hover:text-destructive" onClick={() => setDeleting(w)}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="border-t pt-7">
        <BlockTitle title="Mensagem após o agendamento" description="Exibida na tela de confirmação da página de reserva." />
        <Textarea
          aria-label="Mensagem após o agendamento"
          maxLength={1000}
          rows={3}
          className="mt-3 rounded-lg shadow-none"
          value={draft.confirmationMessage ?? ''}
          onChange={(e) => set((d) => ({ ...d, confirmationMessage: e.target.value }))}
          placeholder="Ex.: Chegue 10 minutos antes e traga um documento com foto."
        />
      </div>

      <WebhookDialog
        eventTypeId={saved.id}
        open={dialog.open}
        onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))}
        initial={dialog.edit}
        others={hooks}
        onSave={(w) => set((d) => ({ ...d, webhooks: (d.webhooks ?? []).some((x) => x.id === w.id) ? (d.webhooks ?? []).map((x) => (x.id === w.id ? w : x)) : [...(d.webhooks ?? []), w] }))}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Remover webhook?"
        description={deleting ? `${deleting.url} deixa de receber os eventos deste tipo de evento depois de salvar.` : undefined}
        confirmLabel="Remover"
        onConfirm={() => deleting && set((d) => ({ ...d, webhooks: (d.webhooks ?? []).filter((x) => x.id !== deleting.id) }))}
      />
    </div>
  )
}


