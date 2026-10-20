import { useEffect, useMemo, useState } from 'react'
import { CalendarX2, Video } from 'lucide-react'
import { toast } from 'sonner'
import type { Booking, EventType } from '@/domain/types'
import '@/domain/ext/mais-a'
import '@/domain/ext/scheduling'
import { cn } from '@/lib/utils'
import { useCollection, useStore } from '@/data/store'
import { cancelBooking, consultBooking } from '@/services/casca/scheduling-actions'
import { loadNotificationHistory, refreshScheduling, NOTIFICATION_EVENT_LABEL, NOTIFICATION_STATUS_LABEL } from '@/services/casca/scheduling'
import type { NotificationRecord } from '@/services/engine/scheduling'
import { captureEngineContext } from '@/services/engine/session'
import { loadConversationBookings } from '@/services/casca/conversation-bookings'
import { BookingRescheduleDialog } from './BookingRescheduleDialog'
import { OpStatus } from '../phone-numbers/OpStatus'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { SideSheet } from '@/components/app/SideSheet'
import { fmtTime, fmtWeekday, noticeLabel } from './slots'

/**
 * "Ver agendamentos" (menu "…" da aba Geral): próximos agendamentos do tipo de evento, anteriores/cancelados e
 * cancelamento pela equipe (com motivo opcional → variável "Agendamento: Motivo do cancelamento"). INFERIDO — a
 * referência não mostra agendamentos dentro do Agendador; a lista ficou num painel para manter a aba Geral igual à captura.
 */
export function BookingsSheet({ et, conversationId, open, onOpenChange }: { et?: EventType; conversationId?: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const bookings = useCollection('bookings')
  const readable = useStore(s => s.db.engineScheduling?.bookingsReadable !== false)
  const calendars = useCollection('calendarConnections')
  const patch = useStore((s) => s.patch)
  const [showPast, setShowPast] = useState(false)
  const [canceling, setCanceling] = useState<Booking>()
  const [moving, setMoving] = useState<Booking>()
  const [linked, setLinked] = useState<Awaited<ReturnType<typeof loadConversationBookings>>>()
  const [loading, setLoading] = useState(false)
  const [reason, setReason] = useState('')
  const now = Date.now()
  const [loadError, setLoadError] = useState('')
  const [history, setHistory] = useState<NotificationRecord[]>([])
  const load = async () => {
    setLoading(true); setLoadError('')
    try {
      if (conversationId) setLinked(await loadConversationBookings(captureEngineContext('conversations:read'), conversationId))
      else {
        await refreshScheduling()
        if (et?.engineEvent) setHistory(await loadNotificationHistory(et.id).then(r => r.items).catch(() => []))
      }
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar.'); throw cause }
    finally { setLoading(false) }
  }
  useEffect(() => { if (open) void load().catch(() => {}) }, [open, conversationId])
  const list = useMemo(
    () =>
      (conversationId ? linked?.bookings ?? [] : bookings)
        .filter((b) => conversationId || b.eventTypeId === et?.id)
        .filter((b) => (showPast ? true : b.status !== 'canceled' && new Date(b.startsAt).getTime() >= now))
        .sort((a, b) => (showPast ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookings, et?.id, showPast, conversationId, linked],
  )
  return (
    <SideSheet open={open} onOpenChange={onOpenChange} title="Agendamentos" description={readable && !loading && !loadError ? `${et?.name ?? 'Desta conversa'} · ${list.length} ${showPast ? 'no total' : list.length === 1 ? 'próximo' : 'próximos'}` : et?.name ?? 'Desta conversa'} hideFooter>
      <div className="flex flex-col gap-3 pb-8">
        <OpStatus status={loading ? 'running' : loadError ? 'error' : 'idle'} progress={{ label: 'Consultando agendamentos…', percent: 0 }} error={loadError} onRetry={() => void load().catch(() => {})} />
        {!readable && <p role="alert" className="text-sm text-destructive">A consulta de reservas exige o proprietário da organização.</p>}
        {linked?.operations.map(operation => <p key={operation.key} className="text-sm text-muted-foreground">Reserva de {new Date(operation.requestedTime.startAt).toLocaleString('pt-BR', { timeZone: operation.requestedTime.timezone })}: {operation.status === 'not_sent' ? 'não enviada' : operation.status === 'conflict' ? 'horário indisponível' : 'aguardando confirmação'}.</p>)}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">{showPast ? 'Todos os agendamentos' : 'Próximos agendamentos'}</p>
          <button type="button" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Mostrar só os próximos' : 'Mostrar anteriores e cancelados'}
          </button>
        </div>
        <div className="divide-y rounded-xl border">
          {readable && !loading && !loadError && list.length === 0 && !linked?.operations.length && (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-sm text-muted-foreground">
              <CalendarX2 className="size-5" />
              {showPast ? 'Nenhum agendamento ainda.' : 'Nenhum agendamento futuro.'}
            </div>
          )}
          {list.map((b) => {
            const start = new Date(b.startsAt)
            const end = new Date(b.engineBooking?.endAt ?? start.getTime() + (et?.durationMin ?? 0) * 60000)
            const past = start.getTime() < now
            return (
              <div key={b.id} className={cn('flex items-center gap-4 px-4 py-3', (b.status === 'canceled' || past) && 'opacity-60')} data-testid="booking-row">
                <div className="flex w-11 shrink-0 flex-col items-center rounded-lg border py-1 leading-none">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">{start.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</span>
                  <span className="text-base font-semibold tabular-nums">{start.getDate()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('truncate text-sm font-medium', b.status === 'canceled' && 'line-through')}>{b.name || '—'}</span>
                    <span className="rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{b.source === 'unknown' ? '—' : b.source === 'agent' ? 'Agente' : 'Página de reserva'}</span>
                    {b.status !== 'confirmed' && <span className="rounded bg-red-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-red-700">{b.status === 'canceled' ? 'Cancelado' : 'A confirmar'}</span>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground tabular-nums">
                    {fmtWeekday(start)} · {fmtTime(start)}–{fmtTime(end)}
                    {b.phone ? ` · ${b.phone}` : ''}
                    {b.email ? ` · ${b.email}` : ''}
                  </p>
                  {b.meetingLink && (
                    <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground/80">
                      <Video className="size-3 shrink-0" /> {b.meetingLink}
                    </p>
                  )}
                  {!!b.notices?.length && (
                    <p className="truncate text-[11px] text-muted-foreground/80" data-testid="booking-notices-summary">
                      Avisos: {[...new Set(b.notices.map(noticeLabel))].join(' · ')}
                    </p>
                  )}
                  {b.cancelReason && <p className="truncate text-[11px] text-muted-foreground/80">Motivo: {b.cancelReason}</p>}
                  {history.some(h => h.bookingId === b.id) && (
                    <p className="truncate text-[11px] text-muted-foreground/80" data-testid="booking-deliveries" title={history.filter(h => h.bookingId === b.id).map(h => `${NOTIFICATION_EVENT_LABEL[h.event] ?? h.event} → ${h.recipient}: ${NOTIFICATION_STATUS_LABEL[h.status] ?? h.status}`).join('\n')}>
                      Avisos: {[...new Set(history.filter(h => h.bookingId === b.id && h.channel === 'email').map(h => `${NOTIFICATION_EVENT_LABEL[h.event] ?? h.event} ${NOTIFICATION_STATUS_LABEL[h.status] ?? h.status}`))].join(' · ') || 'webhook'}
                    </p>
                  )}
                </div>
                {(b.engineBooking?.needsReconciliation || b.engineBooking?.adminCancellation.eligible && !past) && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      if (b.engineBooking?.needsReconciliation) {
                        try { await consultBooking(b); await load() } catch (e) { setLoadError(e instanceof Error ? e.message : 'Não foi possível consultar.') }
                        return
                      }
                      setReason('')
                      setCanceling(b)
                    }}
                  >
                    {b.engineBooking?.needsReconciliation ? 'Consultar tentativa' : 'Cancelar'}
                  </Button>
                )}
                {b.engineBooking?.adminRescheduling?.supported && b.status !== 'canceled' && !past && <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" onClick={() => setMoving(b)}>Reagendar</Button>}
              </div>
            )
          })}
        </div>
      </div>
      <ConfirmDialog
        open={!!canceling}
        onOpenChange={(o) => !o && setCanceling(undefined)}
        title="Cancelar agendamento?"
        description={canceling ? `${canceling.name} · ${fmtWeekday(new Date(canceling.startsAt))} às ${fmtTime(new Date(canceling.startsAt))}. O horário volta a ficar disponível.` : undefined}
        confirmLabel="Cancelar agendamento"
        onConfirm={async () => {
          if (!canceling) return
          await cancelBooking(canceling, reason)
          await load()
          toast.success('Agendamento cancelado')
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="cancel-reason-staff">Motivo (opcional)</Label>
          <Textarea id="cancel-reason-staff" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Profissional indisponível neste dia." />
        </div>
      </ConfirmDialog>
      {moving?.engineBooking && <BookingRescheduleDialog key={moving.id} booking={moving} onClose={() => setMoving(undefined)} onChanged={load} />}
    </SideSheet>
  )
}
