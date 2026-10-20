import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { addDays, format, startOfDay } from 'date-fns'
import { ArrowLeft, CalendarCheck2, CalendarDays, CalendarX2, CheckCircle2, Clock, Copy, Globe, History, Link2, Mail, MessageSquare, UserRound, Users, Video } from 'lucide-react'
import { toast } from 'sonner'
import type { Booking, EventType } from '@/domain/types'
import '@/domain/ext/mais-a'
import '@/domain/ext/scheduling'
import { createPublicBookingClient, loadPublicCompany, publicBooking, publicEvent, type PublicPage, type PublicReceipt, type PublicSlot } from '@/services/casca/public-booking'
import { cn, uid } from '@/lib/utils'
import { useStore } from '@/data/store'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { KloelLogo, Monogram } from '@/components/brand/KloelLogo'
import { fmtLongDay, fmtTime, noticeLabel, tzLabel, viewerTimezone } from './slots'
import { LOCATION_KIND_ICON, LOCATION_KIND_LABEL, hoursLabel, locationKindOf, locationText, normalizeEventType } from './model'

/**
 * Página pública existente, alimentada por disponibilidade e recibos confirmados pela API.
 */

function PublicFrame({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.title
    document.title = 'Agendamento · kloel.ai'
    return () => {
      document.title = prev
    }
  }, [])
  return (
    <div className="flex min-h-svh flex-col bg-muted/40 font-sans">
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:py-14">{children}</main>
      <footer className="flex items-center justify-center gap-2 pb-8 text-xs text-muted-foreground">
        Agendamento por{' '}
        <Link to="/" aria-label="kloel.ai">
          <KloelLogo size="sm" />
        </Link>
      </footer>
    </div>
  )
}

function Message({ title, children, state }: { title: string; children?: React.ReactNode; state?: 'loading' | 'error' }) {
  return (
    <div className="w-full max-w-md rounded-xl border bg-background px-8 py-12 text-center shadow-sm" data-engine-state={state} aria-busy={state === 'loading' || undefined}>
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <CalendarDays className="size-5 text-muted-foreground" />
      </div>
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      {children && <div className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{children}</div>}
    </div>
  )
}

interface FormField {
  id: string
  label: string
  required: boolean
  type: 'text' | 'phone' | 'email'
}

export const NAME_FIELD_ID = '__name'
export const EMAIL_FIELD_ID = '__email'
export const PHONE_FIELD_ID = '__phone'

/**
 * Campos do formulário (AP-06, "Agendamento web"): Nome e E-mail sempre coletados e obrigatórios; Telefone conforme
 * "Obrigatório / Opcional / Não solicitado"; depois os campos personalizados da Coleta de dados.
 */
export function formFields(et: EventType): { fields: FormField[]; nameId: string } {
  const n = et.customFieldsV2 ? et : normalizeEventType(et)
  const phone = n.webPhone ?? 'required'
  const fixed: FormField[] = [
    { id: NAME_FIELD_ID, label: 'Nome', required: true, type: 'text' },
    { id: EMAIL_FIELD_ID, label: 'E-mail', required: true, type: 'email' },
    ...(phone === 'hidden' ? [] : [{ id: PHONE_FIELD_ID, label: 'Telefone', required: phone === 'required', type: 'phone' as const }]),
  ]
  return { fields: [...fixed, ...n.dataCollection], nameId: NAME_FIELD_ID }
}

export default function BookingPublicPage() {
  const { orgSlug = '', eventSlug } = useParams()
  const [params, setParams] = useSearchParams()
  const [company, setCompany] = useState<Awaited<ReturnType<typeof loadPublicCompany>>>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const abort = new AbortController(); setCompany(undefined); setError('')
    loadPublicCompany(orgSlug, abort.signal).then(setCompany).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Não foi possível carregar.') })
    return () => abort.abort()
  }, [orgSlug, retry])
  if ((error || company && !company.items.some(e => e.eventSlug === eventSlug)) && eventSlug && /^o-[a-f0-9]{24}$/.test(orgSlug) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventSlug)) {
    const fallback: PublicPage = { unavailable: true, orgSlug, eventSlug, name: 'Agendamento', description: '', timezone: 'UTC', durationMinutes: 0, horizonDays: 365, minimumNoticeMinutes: 0, form: [] }
    return <Booker key={`${orgSlug}/${eventSlug}`} page={fallback} et={publicEvent(fallback)} orgName={company?.name ?? '—'} orgSlug={orgSlug} params={params} setParams={setParams} />
  }
  if (!company) return <PublicFrame><Message title={error ? 'Página de reserva indisponível' : 'Carregando...'} state={error ? 'error' : 'loading'}>
    {error && <><p>{error}</p><Button variant="outline" onClick={() => setRetry(v => v + 1)}>Tentar novamente</Button></>}
  </Message></PublicFrame>
  if (!eventSlug) return (
    <PublicFrame>
      <div className="w-full max-w-2xl rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <Monogram name={company.name} className="h-10 w-10 text-sm" />
          <div><h1 className="text-xl font-semibold tracking-tight">{company.name}</h1><p className="text-sm text-muted-foreground">Escolha o tipo de compromisso</p></div>
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {company.items.filter(e => e.listed !== false).length === 0 && <li className="text-sm text-muted-foreground">Nenhum horário disponível no momento.</li>}
          {company.items.filter(e => e.listed !== false).map(e => <li key={e.eventSlug}>
            <Link to={`/c/${company.orgSlug}/${e.eventSlug}`} className="flex h-full flex-col gap-1 rounded-lg border p-4 transition-colors hover:border-brand hover:bg-brand/5">
              <span className="font-medium">{e.name}</span>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="size-3.5" /> {e.durationMinutes} min · {LOCATION_KIND_LABEL[e.location?.kind ?? 'none']}</span>
              {e.description && <span className="line-clamp-2 text-sm text-muted-foreground">{e.description}</span>}
            </Link>
          </li>)}
        </ul>
      </div>
    </PublicFrame>
  )
  const page = company.items.find(e => e.eventSlug === eventSlug)
  if (!page) return <PublicFrame><Message title="Este tipo de evento não está disponível"><Link to={`/c/${orgSlug}`} className="underline underline-offset-4">Ver outros horários de {company.name}</Link></Message></PublicFrame>
  return <Booker key={`${orgSlug}/${eventSlug}`} page={page} et={publicEvent(page)} orgName={company.name} orgSlug={orgSlug} params={params} setParams={setParams} />
}

function Booker({
  et,
  orgName,
  orgSlug,
  page,
  params,
  setParams,
}: {
  et: EventType
  orgName: string
  orgSlug: string
  page: PublicPage
  params: URLSearchParams
  setParams: ReturnType<typeof useSearchParams>[1]
}) {
  const now = new Date()
  const today = startOfDay(now)
  const lastDay = addDays(today, et.maxDaysAhead)
  const teamEmail = undefined
  const provider = undefined
  const kind = locationKindOf(et)
  const where = locationText(et, provider)
  const calendarOk = !page.unavailable
  const client = useMemo(() => createPublicBookingClient(page, sessionStorage), [page.orgSlug, page.eventSlug])
  const [receipt, setReceipt] = useState<PublicReceipt>()
  const [initializing, setInitializing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [stateError, setStateError] = useState('')
  const [serverSlots, setServerSlots] = useState<PublicSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState('')
  const [slotRetry, setSlotRetry] = useState(0)
  useEffect(() => {
    let active = true
    client.restore(window.location.hash).then(value => { if (active) { setReceipt(value); if (value && window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search) } })
      .catch(e => { if (active) setStateError(e instanceof Error ? e.message : 'Não foi possível consultar.') })
      .finally(() => { if (active) setInitializing(false) })
    return () => { active = false }
  }, [client])
  const doneId = receipt?.bookingRef
  const done = receipt ? publicBooking(receipt, et) : undefined
  const rescheduling = done && params.get('remarcar') === '1' && done.status === 'confirmed' && receipt?.rescheduleAllowed === true ? done.id : undefined
  const slotsOf = (d: Date) => serverSlots.filter(s => format(new Date(s.startAt), 'yyyy-MM-dd') === format(d, 'yyyy-MM-dd')).map(s => new Date(s.startAt))

  // ?date= só vale dentro da janela de agendamento (de hoje até hoje + janela); fora dela é ignorado e removido
  const paramDate = params.get('date')
  const parsedRaw = paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate) ? new Date(`${paramDate}T00:00:00`) : undefined
  const parsed = parsedRaw && !Number.isNaN(parsedRaw.getTime()) && format(parsedRaw, 'yyyy-MM-dd') === paramDate && parsedRaw >= today && parsedRaw <= lastDay ? parsedRaw : undefined
  // o dia escolhido vive na URL (?date=): recarregar, voltar e avançar mantêm calendário e horários coerentes
  const date = parsed
  const [slot, setSlot] = useState<Date>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const moving = rescheduling ? done : undefined

  useEffect(() => {
    if (paramDate && !parsed) {
      const next = new URLSearchParams(params)
      next.delete('date')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramDate])

  /** Troca de "tela" pela URL (confirmação / remarcação / novo agendamento), preservando o histórico. */
  const goTo = (p: Record<string, string>, replace = false) => setParams(new URLSearchParams(p), { replace })
  const fields = et.dataCollection
  const nameId = NAME_FIELD_ID
  useEffect(() => {
    setServerSlots([]); setSlotsError('')
    if (!date || !calendarOk || done && !rescheduling) return
    const abort = new AbortController(); setSlotsLoading(true)
    client.slots(startOfDay(date).toISOString(), addDays(startOfDay(date), 1).toISOString(), !!rescheduling, abort.signal)
      .then(rows => { if (!abort.signal.aborted) setServerSlots(rows) })
      .catch(e => { if (!abort.signal.aborted) setSlotsError(e instanceof Error ? e.message : 'Não foi possível consultar os horários.') })
      .finally(() => { if (!abort.signal.aborted) setSlotsLoading(false) })
    return () => abort.abort()
  }, [paramDate, rescheduling, doneId, client, slotRetry])
  const slots = date ? slotsOf(date) : []
  const LocIcon = LOCATION_KIND_ICON[kind]
  const end = (d: Date) => receipt && receipt.startAt === d.toISOString() ? new Date(receipt.endAt) : new Date(d.getTime() + et.durationMin * 60000)
  const when = (d: Date) => { const t = `${fmtLongDay(d)}, ${fmtTime(d)}–${fmtTime(end(d))}`; return t.charAt(0).toUpperCase() + t.slice(1) }

  const pickDate = (d?: Date) => {
    setSlot(undefined)
    const next = new URLSearchParams(params)
    if (d) next.set('date', format(d, 'yyyy-MM-dd'))
    else next.delete('date')
    setParams(next, { replace: true })
  }

  const stillFree = (s: Date) => slotsOf(s).some((x) => x.getTime() === s.getTime())

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !slot && !client.pending()) return
    const errs: Record<string, string> = {}
    for (const f of client.pending() ? [] : fields) {
      const v = (values[f.id] ?? '').trim()
      if (f.required && !v) errs[f.id] = 'Este campo é obrigatório.'
      else if (v && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errs[f.id] = 'Digite um e-mail válido.'
      else if (v && f.type === 'phone' && v.replace(/\D/g, '').length < 10) errs[f.id] = 'Digite um telefone válido com DDD.'
    }
    // horário pode ter sido ocupado enquanto o formulário era preenchido
    if (!client.pending() && slot && !stillFree(slot)) errs.__slot = 'Este horário acabou de ser reservado. Escolha outro.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true); setStateError('')
    try {
      const result = await client.create(slot ? serverSlots.find(s => s.startAt === slot.toISOString()) : undefined, values)
      setReceipt(result); setSlot(undefined); setValues({}); goTo({ booking: result.bookingRef })
    } catch (error) { setErrors({ __slot: error instanceof Error ? error.message : 'Não foi possível confirmar.' }) }
    finally { setBusy(false) }
  }
  async function confirmReschedule() {
    if (busy || !slot && !client.pending() || !moving) return
    setBusy(true)
    try {
      const result = await client.reschedule(slot ? serverSlots.find(s => s.startAt === slot.toISOString()) : undefined)
      setReceipt(result); setSlot(undefined); setErrors({}); goTo({ booking: result.bookingRef }, true)
    } catch (error) { setErrors({ __slot: error instanceof Error ? error.message : 'Não foi possível remarcar.' }) }
    finally { setBusy(false) }
  }
  async function cancelBooking() {
    const result = await client.cancel(cancelReason); setReceipt(result)
    if (result.status !== 'cancelled') throw Error('O cancelamento ainda não foi confirmado. Consulte a tentativa novamente.')
  }
  function restart() {
    try { client.restart(); setReceipt(undefined); setSlot(undefined); setValues({}); setErrors({}); goTo({}) }
    catch (e) { setStateError(e instanceof Error ? e.message : 'Consulte a tentativa pendente.') }
  }
  const confirmationUrl = (_id: string) => client.managementLink(window.location.origin)
  const refreshStatus = async () => {
    setBusy(true); setStateError('')
    try { setReceipt(await client.status()) }
    catch (e) { setStateError(e instanceof Error ? e.message : 'Não foi possível consultar.') }
    finally { setBusy(false) }
  }
  if (initializing) return <PublicFrame><Message title="Carregando..." state="loading" /></PublicFrame>
  if (page.unavailable && !receipt) return <PublicFrame><Message title="Página de reserva indisponível" state="error">{stateError || 'Confira o link com a empresa.'}</Message></PublicFrame>

  const info = (
    <div className="flex flex-col gap-4 border-b p-6 lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r">
      <Link to={`/c/${orgSlug}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <Monogram name={orgName} className="h-6 w-6 text-[10px]" />
        {orgName}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{et.name}</h1>
      <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Clock className="size-4 shrink-0" /> {et.durationMin || (receipt ? (Date.parse(receipt.endAt) - Date.parse(receipt.startAt)) / 60000 : '—')} min
        </li>
        {kind !== 'none' && (
          <li className="flex items-center gap-2" data-testid="booking-location">
            <LocIcon className="size-4 shrink-0" /> {where}
          </li>
        )}
        <li className="flex items-center gap-2" data-testid="booking-host">
          <UserRound className="size-4 shrink-0" /> <span className="truncate">{et.hostDisplayName?.trim() || teamEmail || orgName}</span>
        </li>
        <li className="flex items-center gap-2">
          <Globe className="size-4 shrink-0" /> Horários em {tzLabel(viewerTimezone())}
        </li>
        {moving && (
          <li className="flex items-start gap-2 text-foreground">
            <History className="mt-0.5 size-4 shrink-0" />
            <span>
              Remarcando: <span className="line-through first-letter:uppercase">{when(new Date(moving.startsAt))}</span>
            </span>
          </li>
        )}
        {slot && (
          <li className="flex items-start gap-2 font-medium text-foreground">
            <CalendarCheck2 className="mt-0.5 size-4 shrink-0" />
            <span className="first-letter:uppercase">{when(slot)}</span>
          </li>
        )}
      </ul>
      {et.description && <p className="text-sm leading-6 text-muted-foreground">{et.description}</p>}
    </div>
  )

  if (doneId && !done) {
    return (
      <PublicFrame>
        <Message title="Agendamento não encontrado">
          O link da confirmação não corresponde a nenhum agendamento de {et.name}.{' '}
          <button type="button" className="underline underline-offset-4" onClick={restart}>
            Agendar um horário
          </button>
        </Message>
      </PublicFrame>
    )
  }

  if (done && !rescheduling) {
    const canceled = done.status === 'canceled'
    const confirmed = done.status === 'confirmed'
    const start = new Date(done.startsAt)
    const notices = done.notices ?? []
    const past = start.getTime() < now.getTime()
    return (
      <PublicFrame>
        <div className="w-full max-w-lg rounded-xl border bg-background p-8 text-center shadow-sm" data-testid="booking-confirmed">
          {!confirmed ? <CalendarX2 className="mx-auto size-10 text-muted-foreground" /> : <CheckCircle2 className="mx-auto size-10 text-emerald-600" />}
          <h1 className="mt-4 text-xl font-semibold">{canceled ? 'Agendamento cancelado' : confirmed ? 'Agendamento confirmado' : 'Agendamento a confirmar'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canceled
              ? receipt?.inviteeEmail === 'enabled' ? 'O horário foi liberado na agenda. Você receberá o aviso de cancelamento por e-mail.' : 'O horário foi liberado na agenda.'
              : receipt?.inviteeEmail === 'enabled'
                ? 'Você receberá a confirmação por e-mail, com o convite para o seu calendário.'
                : 'Os detalhes ficam registrados com a empresa.'}
          </p>
          <dl className={cn('mt-6 grid gap-3 rounded-lg border p-4 text-left text-sm', canceled && 'opacity-60')}>
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <dt className="text-muted-foreground">O quê</dt>
              <dd className="font-medium">
                {et.name} · {orgName}
              </dd>
            </div>
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <dt className="text-muted-foreground">Quando</dt>
              <dd className={cn('font-medium first-letter:uppercase', canceled && 'line-through')}>{when(start)}</dd>
            </div>
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <dt className="text-muted-foreground">Onde</dt>
              <dd className="min-w-0 font-medium">
                {where || LOCATION_KIND_LABEL.none}
                {done.meetingLink && !canceled && (
                  <a href={done.meetingLink} target="_blank" rel="noreferrer" className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-brand underline-offset-4 hover:underline" data-testid="meeting-link">
                    <Video className="size-3.5 shrink-0" />
                    <span className="min-w-0 break-all">{done.meetingLink}</span>
                  </a>
                )}
              </dd>
            </div>
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <dt className="text-muted-foreground">Quem</dt>
              <dd className="font-medium">{done.name || '—'}</dd>
            </div>
          </dl>
          {!canceled && et.confirmationMessage && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-left text-sm">{et.confirmationMessage}</p>}
          {notices.length > 0 && (
            <div className="mt-4 rounded-lg border border-dashed p-3 text-left" data-testid="booking-notices">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Avisos enviados</div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {notices.map((n, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {n.channel === 'sms' ? <MessageSquare className="size-3.5 shrink-0" /> : n.channel === 'team' ? <Users className="size-3.5 shrink-0" /> : <Mail className="size-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1" title={n.body}>
                      <span className="block truncate">
                        {noticeLabel(n)}
                        {n.to ? ` · ${n.to}` : ''}
                      </span>
                      {(n.subject || (n.channel === 'sms' && n.body)) && <span className="block truncate text-muted-foreground/80" data-testid="notice-subject">“{n.subject || n.body}”</span>}
                    </span>
                    {n.kind === 'reminder' && <span className="shrink-0 tabular-nums">{`${hoursLabel(n.hoursBefore ?? et.notifications.reminderHours)} antes`}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/30 p-2 pl-3 text-left" data-testid="confirmation-link">
            <Link2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">Link da confirmação</span>
              <span className="block truncate text-xs text-muted-foreground">{confirmationUrl(done.id) || 'Link indisponível'}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 gap-1"
              disabled={!confirmationUrl(done.id)}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(confirmationUrl(done.id))
                } catch {
                  /* sem acesso à área de transferência: o link continua visível */
                }
                toast.success('Link copiado', { description: !canceled && (et.advanced.allowReschedule || et.advanced.allowCancel) ? 'Use-o para remarcar ou cancelar.' : 'Use-o para rever este agendamento.' })
              }}
            >
              <Copy className="size-3.5" /> Copiar
            </Button>
          </div>
          <div className="mt-6 flex flex-col items-center gap-3">
            {stateError && <p role="alert" className="text-sm text-destructive">{stateError}</p>}
            {(!confirmed && !canceled || client.pending()) && <Button disabled={busy} variant="outline" onClick={refreshStatus}>Consultar tentativa</Button>}
            {confirmed && !past && (et.advanced.allowReschedule || et.advanced.allowCancel) && (
              <div className="flex flex-wrap justify-center gap-2">
                {receipt?.rescheduleAllowed === true && calendarOk && (
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setSlot(undefined)
                      setErrors({})
                      const d = startOfDay(new Date(done.startsAt))
                      goTo({ booking: done.id, remarcar: '1', ...(d >= today && d <= lastDay ? { date: format(d, 'yyyy-MM-dd') } : {}) })
                    }}
                  >
                    <History className="size-4" /> Remarcar
                  </Button>
                )}
                {et.advanced.allowCancel && receipt?.cancelAllowed !== false && (
                  <Button
                    variant="outline"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => {
                      setCancelReason('')
                      setConfirmCancel(true)
                    }}
                  >
                    <CalendarX2 className="size-4" /> Cancelar agendamento
                  </Button>
                )}
              </div>
            )}
            <Button variant={canceled ? 'default' : 'ghost'} onClick={restart}>
              Agendar outro horário
            </Button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmCancel}
          onOpenChange={setConfirmCancel}
          title="Cancelar este agendamento?"
          description={`${et.name} · ${when(start)}. O horário volta a ficar disponível.`}
          confirmLabel="Cancelar agendamento"
          onConfirm={cancelBooking}
        >
          <div className="space-y-2 text-left">
            <Label htmlFor="cancel-reason">Motivo (opcional)</Label>
            <Textarea id="cancel-reason" rows={2} maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Ex.: Surgiu um imprevisto." />
          </div>
        </ConfirmDialog>
      </PublicFrame>
    )
  }

  return (
    <PublicFrame>
      <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-sm lg:flex-row">
        {info}
        {!slot && !client.pending() ? (
          <div className="flex min-w-0 flex-1 flex-col md:flex-row">
            <div className="flex-1 p-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{moving ? 'Escolha o novo horário' : 'Selecione data e horário'}</h2>
                {moving && (
                  <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => goTo({ booking: moving.id }, true)}>
                    Desistir da remarcação
                  </button>
                )}
              </div>
              <Calendar
                mode="single"
                selected={calendarOk ? date : undefined}
                onSelect={pickDate}
                defaultMonth={date ?? today}
                fromDate={today}
                toDate={lastDay}
                disabled={(d) => d < today || d > lastDay || busy}
                modifiers={{ available: (d) => d >= today && d <= lastDay && slotsOf(d).length > 0 }}
                modifiersClassNames={{ available: 'font-semibold text-brand bg-brand/10 hover:bg-brand/20 aria-selected:bg-primary aria-selected:text-primary-foreground' }}
                className="p-0"
              />
            </div>
            <div className="border-t p-6 md:w-64 md:border-l md:border-t-0">
              {date && calendarOk ? (
                <>
                  <h3 className="mb-3 text-sm font-semibold first-letter:uppercase">{fmtLongDay(date)}</h3>
                  {slotsLoading ? <p className="text-sm text-muted-foreground" data-engine-state="loading" aria-busy="true">Consultando horários...</p> : slotsError ? <div><p role="alert" className="text-sm text-destructive" data-engine-state="error">{slotsError}</p><Button variant="outline" onClick={() => setSlotRetry(v => v + 1)}>Tentar novamente</Button></div> : slots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum horário livre neste dia.</p>
                  ) : (
                    <ul className="flex max-h-[22rem] flex-col gap-2 overflow-y-auto pr-1">
                      {slots.map((s) => (
                        <li key={s.toISOString()}>
                          <button
                            type="button"
                            onClick={() => {
                              setSlot(s)
                              setErrors({})
                            }}
                            className="h-10 w-full rounded-md border border-brand/40 text-sm font-semibold text-brand tabular-nums transition-colors hover:border-brand hover:bg-brand/5"
                          >
                            {fmtTime(s)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : !calendarOk ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900" data-testid="booking-unavailable">
                  <p className="font-medium">Agenda indisponível no momento</p>
                  <p className="mt-1 text-amber-800">
                    {orgName} ainda não conectou um calendário a este compromisso.{' '}
                    <Link to={`/c/${orgSlug}`} className="underline underline-offset-4">
                      Ver outros horários
                    </Link>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Escolha um dia no calendário para consultar os horários livres.</p>
              )}
            </div>
          </div>
        ) : moving ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
            <button type="button" onClick={() => setSlot(undefined)} className="-ml-1 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> Voltar
            </button>
            <h2 className="text-base font-semibold">Remarcar agendamento</h2>
            <dl className="grid gap-3 rounded-lg border p-4 text-sm">
              <div className="grid grid-cols-[4rem_1fr] gap-2">
                <dt className="text-muted-foreground">De</dt>
                <dd className="line-through first-letter:uppercase">{when(new Date(moving.startsAt))}</dd>
              </div>
              <div className="grid grid-cols-[4rem_1fr] gap-2">
                <dt className="text-muted-foreground">Para</dt>
                <dd className="font-medium first-letter:uppercase">{slot ? when(slot) : '—'}</dd>
              </div>
            </dl>
            {errors.__slot && <p className="text-sm font-medium text-destructive">{errors.__slot}</p>}
            <div>
              <Button disabled={busy} onClick={confirmReschedule}>{client.pending() ? 'Consultar tentativa' : 'Confirmar remarcação'}</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={confirm} className="flex min-w-0 flex-1 flex-col gap-4 p-6" noValidate>
            <button type="button" onClick={() => setSlot(undefined)} className="-ml-1 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> Voltar
            </button>
            <h2 className="text-base font-semibold">Seus dados</h2>
            {fields.map((f) => (
              <div key={f.id} className="space-y-2">
                <Label htmlFor={`f-${f.id}`} className={cn(errors[f.id] && 'text-destructive')}>
                  {f.label}
                  {f.required && <span className="text-destructive"> *</span>}
                </Label>
                <Input
                  id={`f-${f.id}`}
                  type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                  placeholder={f.type === 'phone' ? '+55 11 90000-0000' : f.type === 'email' ? 'nome@exemplo.com.br' : undefined}
                  value={values[f.id] ?? ''}
                  aria-invalid={!!errors[f.id] || undefined}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [f.id]: e.target.value }))
                    setErrors((er) => ({ ...er, [f.id]: '' }))
                  }}
                />
                {errors[f.id] && <p className="text-sm font-medium text-destructive">{errors[f.id]}</p>}
              </div>
            ))}
            {errors.__slot && <p className="text-sm font-medium text-destructive">{errors.__slot}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>{client.pending() ? 'Consultar tentativa' : 'Confirmar agendamento'}</Button>
              <span className="text-xs text-muted-foreground">Seus dados são usados apenas para este agendamento.</span>
            </div>
          </form>
        )}
      </div>
    </PublicFrame>
  )
}
