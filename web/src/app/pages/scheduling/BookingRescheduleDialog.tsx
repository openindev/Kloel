import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Booking } from '@/domain/types'
import { captureEngineContext, engineSession } from '@/services/engine/session'
import { createBookingRescheduling } from '@/services/casca/conversation-bookings'
import type { RescheduleSlot } from '@/services/engine/booking-reschedule'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { OpStatus } from '../phone-numbers/OpStatus'

export function BookingRescheduleDialog({ booking, onClose, onChanged }: { booking: Booking; onClose: () => void; onChanged: () => Promise<void> }) {
  const [date, setDate] = useState<Date>(), [slots, setSlots] = useState<RescheduleSlot[]>([]), [selected, setSelected] = useState<RescheduleSlot>()
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  const client = useMemo(() => {
    const context = captureEngineContext('calendars:write'), identity = engineSession.getSnapshot().data!.identity
    if (identity.role !== 'owner') throw Error('Esta ação exige o proprietário da organização.')
    return createBookingRescheduling(context, identity.context, sessionStorage)
  }, [])
  const current = booking.engineBooking!
  let pending = false
  try { pending = client.pending(booking.id) } catch { pending = true }
  const selectDay = async (day: Date | undefined) => {
    const ticket = ++generation.current; setDate(day); setSelected(undefined); setSlots([]); setError('')
    if (!day) return
    setLoading(true)
    const target = [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-')
    const dayStamp = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())
    // Fetch an enclosing UTC range; filter actual quotes by the reservation's IANA timezone, including DST.
    const from = new Date(dayStamp - 14 * 3600000).toISOString(), to = new Date(dayStamp + 62 * 3600000).toISOString()
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: current.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const dayOf = (value: string) => { const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(p => [p.type, p.value])); return `${parts.year}-${parts.month}-${parts.day}` }
    try { const choices = await client.slots(current, from, to); if (ticket === generation.current) setSlots(choices.filter(slot => dayOf(slot.startAt) === target)) }
    catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar os horários.') }
    finally { if (ticket === generation.current) setLoading(false) }
  }
  return <ConfirmDialog open contentProps={{ className: 'sm:max-w-[720px] max-h-[90dvh] overflow-y-auto' }} onOpenChange={open => { if (!open) { ++generation.current; onClose() } }} title="Reagendar compromisso" description={`Fuso horário: ${current.timezone}`} destructive={false} confirmLabel={pending ? 'Consultar tentativa' : 'Confirmar novo horário'} onConfirm={async () => {
    if (loading) throw Error('Aguarde os horários.')
    if (!pending && !selected) throw Error('Escolha um horário disponível.')
    await client.change(current, selected); await onChanged(); toast.success('Novo horário confirmado')
  }}>
    {pending ? <p className="text-sm text-muted-foreground">Uma solicitação anterior ainda está em acompanhamento. Consulte seu resultado antes de escolher outro horário.</p> : <div className="grid gap-4 sm:grid-cols-2">
      <Calendar mode="single" selected={date} onSelect={day => void selectDay(day)} className="rounded-md border" />
      <div className="max-h-72 space-y-2 overflow-y-auto">
        <OpStatus status={loading ? 'running' : error ? 'error' : 'idle'} progress={{ label: 'Consultando horários…', percent: 0 }} error={error} onRetry={() => void selectDay(date)} />
        {!date && <p className="text-sm text-muted-foreground">Escolha uma data.</p>}
        {date && !loading && !error && !slots.length && <p className="text-sm text-muted-foreground">Nenhum horário disponível nesta data.</p>}
        {slots.map(slot => <Button key={slot.quote} className="w-full" variant={selected?.quote === slot.quote ? 'default' : 'outline'} onClick={() => setSelected(slot)}>{new Intl.DateTimeFormat('pt-BR', { timeZone: current.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(slot.startAt))}</Button>)}
      </div>
    </div>}
  </ConfirmDialog>
}
