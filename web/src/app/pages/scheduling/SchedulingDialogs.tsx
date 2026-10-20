import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CalendarOption } from '@/domain/ext/engine-scheduling'
import { createEvent, discoverCalendars, registerSelectedCalendar, useSchedulingCalendars } from '@/services/casca/scheduling'
import type { CalendarConnection } from '@/domain/types'
import type { LocationKind } from '@/domain/ext/scheduling'
import '@/domain/ext/mais-a'
import '@/domain/ext/scheduling'
import { useCollection, useCurrentOrg, useCurrentUser, useStore } from '@/data/store'
import { cn } from '@/lib/utils'
import { services } from '@/services'
import { useOperation } from '@/hooks/useOperation'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GoogleIcon, MicrosoftIcon } from '@/components/brand/icons'
import { Field } from '../phone-numbers/NumberDialogs'
import { OpStatus } from '../phone-numbers/OpStatus'
import { defaultEventType, uniqueSlug } from './slots'
import { LOCATION_KINDS, LOCATION_KIND_LABEL } from './model'

export const DURATIONS = [15, 20, 30, 45, 60, 90, 120]
export const PROVIDER_LABEL: Record<CalendarOption['provider'], string> = { google: 'Google Agenda', microsoft: 'Microsoft Outlook', local: 'Calendário local' }

/** Formulário compartilhado de novo tipo de evento. */
function EventTypeForm({
  name,
  setName,
  duration,
  setDuration,
  calendarId,
  setCalendarId,
  location,
  setLocation,
  calendars,
  error,
  formId,
  onSubmit,
}: {
  name: string
  setName: (v: string) => void
  duration: number
  setDuration: (v: number) => void
  calendarId: string
  setCalendarId: (v: string) => void
  location: LocationKind
  setLocation: (v: LocationKind) => void
  calendars: CalendarOption[]
  error?: string
  formId: string
  onSubmit: () => void
}) {
  return (
    <form
      id={formId}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <Field label="Nome do tipo de evento" htmlFor={`${formId}-name`} error={error}>
        <Input id={`${formId}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Avaliação inicial" aria-invalid={!!error || undefined} autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Duração" htmlFor={`${formId}-dur`}>
          <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
            <SelectTrigger id={`${formId}-dur`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d} min
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Local" htmlFor={`${formId}-loc`}>
          <Select value={location} onValueChange={(v) => setLocation(v as LocationKind)}>
            <SelectTrigger id={`${formId}-loc`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCATION_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {LOCATION_KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Calendário" htmlFor={`${formId}-cal`}>
        <Select value={calendarId} onValueChange={setCalendarId}>
          <SelectTrigger id={`${formId}-cal`}>
            <SelectValue placeholder="Selecione um calendário" />
          </SelectTrigger>
          <SelectContent>
            {calendars.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.email} · {PROVIDER_LABEL[c.provider]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </form>
  )
}

function useCreateEventType() {
  return (input: { name: string; durationMin: number; calendarId?: string; location: LocationKind }) => {
    const slug = uniqueSlug(input.name, useStore.getState().db.eventTypes.map(e => e.slug))
    return createEvent(input, slug)
  }
}

export function CreateEventTypeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  // Booking pages read availability from and write events to Google/Microsoft; local calendars cannot back a page.
  const calendars = useSchedulingCalendars().filter(c => c.provider !== 'local')
  const navigate = useNavigate()
  const create = useCreateEventType()
  const [name, setName] = useState('')
  const [duration, setDuration] = useState(30)
  const [calendarId, setCalendarId] = useState('')
  const [location, setLocation] = useState<LocationKind>('none')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setName('')
      setDuration(30)
      setCalendarId(calendars[0]?.id ?? '')
      setLocation('none')
      setError(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const submit = async () => {
    if (saving) return
    if (name.trim().length < 2) return setError('O nome deve ter pelo menos 2 caracteres.')
    setSaving(true); setError(undefined)
    try {
      const et = await create({ name: name.trim(), durationMin: duration, calendarId: calendarId || undefined, location })
      toast.success('Tipo de evento criado', { description: et.name }); onOpenChange(false)
      navigate(`/app/scheduling/${et.id}/general`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível criar o tipo de evento.') }
    finally { setSaving(false) }
  }

  if (open && calendars.length === 0) return <ConnectCalendarDialog open={open} onOpenChange={onOpenChange} />
  return (
    <Dialog open={open} onOpenChange={value => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader className="gap-y-2">
          <DialogTitle>Criar tipo de evento</DialogTitle>
          <DialogDescription>Defina o compromisso que seus assistentes e a página de reserva vão oferecer.</DialogDescription>
        </DialogHeader>
        <EventTypeForm
          formId="new-et"
          {...{ name, setName, duration, setDuration, calendarId, setCalendarId, location, setLocation, calendars, error }}
          onSubmit={submit}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="new-et" disabled={saving}>
            Criar tipo de evento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Conectar calendário": OAuth simulado (Google/Microsoft) → cria a conexão → cria o primeiro tipo de evento.
 * Com `onConnected` (botão "+ Adicionar calendário" da aba Geral) só conecta e devolve a conexão criada.
 */
export function ConnectCalendarDialog({ open, onOpenChange, onConnected }: { open: boolean; onOpenChange: (o: boolean) => void; onConnected?: (c: CalendarOption) => void }) {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const create = useCreateEventType()
  const calendars = useSchedulingCalendars()
  const [step, setStep] = useState<'start' | 'provider' | 'oauth' | 'event'>('start')
  const [provider, setProvider] = useState<CalendarConnection['provider']>('google')
  const [conn, setConn] = useState<CalendarConnection>()
  const [name, setName] = useState('Consulta')
  const [duration, setDuration] = useState(30)
  const [calendarId, setCalendarId] = useState('')
  const [location, setLocation] = useState<LocationKind>('none')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [choices, setChoices] = useState<CalendarOption[]>([])
  const op = useOperation(async (onProgress, p: CalendarConnection['provider']) => {
    const connected = useStore.getState().db.calendarConnections.filter(c => c.provider === p && c.features.includes('calendar'))
    if (connected.length) {
      const options = (await Promise.all(connected.map(c => discoverCalendars(c.id)))).flat()
      if (!options.length) throw Error('A conta não possui um calendário com permissão de edição.')
      return { connection: connected[0], options }
    }
    const result = await services.oauth.connect(p, 'agenda', onProgress)
    if (!result.connection) throw Error('Não foi possível confirmar a conexão.')
    const options = await discoverCalendars(result.connection.id)
    if (!options.length) throw Error('A conta não possui um calendário com permissão de edição.')
    return { connection: result.connection, options }
  })

  useEffect(() => {
    if (open) {
      setStep('start')
      setConn(undefined)
      setName('Consulta')
      setDuration(30)
      setLocation('none')
      setError(undefined)
      op.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function connect(p: CalendarConnection['provider']) {
    setProvider(p)
    setStep('oauth')
    const r = await op.run(p)
    if (!r) return
    setConn(r.connection); setChoices(r.options)
    setCalendarId(''); setStep('event')
  }

  async function finish() {
    if (saving) return
    if (!onConnected && name.trim().length < 2) return setError('O nome deve ter pelo menos 2 caracteres.')
    const selected = choices.find(c => c.id === calendarId)
    if (!selected) return setError('Selecione um calendário.')
    setSaving(true); setError(undefined)
    try {
      const calendar = await registerSelectedCalendar(selected)
      if (onConnected) { onConnected(calendar); toast.success('Calendário conectado'); onOpenChange(false); return }
      const et = await create({ name: name.trim(), durationMin: duration, calendarId: calendar.id, location })
      toast.success('Calendário conectado e tipo de evento criado', { description: et.name })
      onOpenChange(false); navigate(`/app/scheduling/${et.id}/general`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.') }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !op.isRunning && !saving && onOpenChange(o)}>
      <DialogContent className={cn('sm:max-w-[520px]', step === 'start' && 'gap-y-0')}>
        <DialogHeader>
          <DialogTitle>{step === 'event' ? onConnected ? 'Selecione um calendário' : 'Crie um tipo de evento' : 'Conectar calendário'}</DialogTitle>
        </DialogHeader>

        {/* OBSERVADO (fonio-live2/G-agendador/03): diálogo central com logos Google (G) + Microsoft, texto, botão preto de
            largura total, link "Ver todos os calendários nas configurações da empresa" e rodapé só com "Cancelar". */}
        {step === 'start' && (
          <div className="flex flex-col">
            {/* espaçamentos medidos na captura (1355×661): logos +101, texto +163, botão +209, link +275, rodapé +314 */}
            <div className="mt-[37px] flex items-center justify-center gap-3.5">
              <GoogleIcon className="size-10" />
              <MicrosoftIcon className="size-11" />
            </div>
            <p className="mt-[30px] text-sm text-muted-foreground">Conecte um calendário do Google ou da Microsoft para usar nos seus agendamentos.</p>
            <Button className="mt-4 w-full" onClick={() => setStep('provider')}>
              Conectar calendário
            </Button>
            <Button variant="link" asChild className="mt-1.5 h-auto py-2.5 font-medium text-foreground hover:no-underline">
              <Link to="/app/company-settings?tab=connections" onClick={() => onOpenChange(false)}>
                Ver todos os calendários nas configurações da empresa
              </Link>
            </Button>
          </div>
        )}

        {step === 'provider' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Escolha o provedor do calendário.</p>
            {(['google', 'microsoft'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => connect(p)}
                className="flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent"
              >
                {p === 'google' ? <GoogleIcon className="size-6" /> : <MicrosoftIcon className="size-6" />}
                <span className="flex-1">Continuar com {p === 'google' ? 'Google' : 'Microsoft'}</span>
                <span className="text-xs text-muted-foreground">{PROVIDER_LABEL[p]}</span>
              </button>
            ))}
            {calendars.length > 0 && <p className="text-xs text-muted-foreground">Você já tem {calendars.length} calendário(s) conectado(s).</p>}
          </div>
        )}

        {step === 'oauth' && <OpStatus status={op.status} progress={op.progress} error={op.error} onRetry={() => connect(provider)} />}

        {step === 'event' && conn && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate">
                {PROVIDER_LABEL[conn.provider]} conectado: {conn.email}
              </span>
            </div>
            <EventTypeForm
              formId="first-et"
              {...{ name, setName, duration, setDuration, calendarId, setCalendarId, location, setLocation, error }}
              calendars={choices}
              onSubmit={finish}
            />
          </div>
        )}

        <DialogFooter className={cn(step === 'start' && 'mt-[19px]')}>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={op.isRunning}>
            Cancelar
          </Button>
          {step === 'oauth' && op.isRunning && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Conectando…
            </Button>
          )}
          {step === 'event' && (
            <Button type="submit" form="first-et" disabled={saving}>
              {onConnected ? 'Conectar calendário' : 'Criar tipo de evento'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
