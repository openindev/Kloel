import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { OpStatus } from '../phone-numbers/OpStatus'
import { privateBookingStatus, type PrivateChatBooking, type PrivateBookingChoice, type PrivateBookingSlot, type PrivateBookingReference, type PrivateBookingReceipt } from '@/services/casca/private-chat-booking'
import type { BookingValues } from '@/services/engine/assistant-booking'

export function PrivateChatBookingControls({ client, choices, disabled }: { client: PrivateChatBooking; choices: PrivateBookingChoice[]; disabled: boolean }) {
  const [selected, setSelected] = useState<PrivateBookingChoice>(), [reference, setReference] = useState<PrivateBookingReference>(), [history, setHistory] = useState(false)
  let references: PrivateBookingReference[] = [], error = ''
  try { references = client.references() } catch (cause) { error = cause instanceof Error ? cause.message : 'Não foi possível consultar as reservas.' }
  return <>
    {(choices.length > 0 || references.length > 0 || error) && <div className="space-y-2 rounded-lg border p-3 text-sm">
      {choices.map(choice => <Button key={`${choice.provider}:${choice.value.choiceId}`} disabled={disabled || !!error} variant="outline" className="h-auto w-full justify-start gap-2 whitespace-normal py-2 text-left" onClick={() => setSelected(choice)}><CalendarDays className="size-4 shrink-0" />{choice.value.title}</Button>)}
      {references.length > 0 && <Button disabled={disabled || !!error} variant="ghost" size="sm" onClick={() => setHistory(true)}>Consultar reservas</Button>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>}
    {selected && <PrivateBookingChoiceDialog client={client} choice={selected} onClose={() => setSelected(undefined)} onRecorded={receipt => {
      const found = client.references().find(r => r.provider === receipt.provider && r.attempt.key === receipt.value.key)
      if (!found) throw Error('Não foi possível acompanhar a reserva.')
      setSelected(undefined); setReference(found)
    }} />}
    {reference && <PrivateBookingReceiptDialog key={`${reference.provider}:${reference.attempt.key}`} client={client} reference={reference} onClose={() => setReference(undefined)} />}
    <Dialog open={history} onOpenChange={setHistory}><DialogContent><DialogHeader><DialogTitle>Agendamentos</DialogTitle><DialogDescription>Consulte as solicitações preservadas nesta aba.</DialogDescription></DialogHeader>
      <div className="max-h-80 space-y-2 overflow-y-auto">{references.map((ref, i) => <Button key={`${ref.provider}:${ref.attempt.key}`} variant="outline" className="w-full justify-start" onClick={() => { setHistory(false); setReference(ref) }}>Consultar reserva {i + 1} · {ref.provider === 'calendly' ? 'Calendly' : 'Agendador'}</Button>)}</div>
    </DialogContent></Dialog>
  </>
}

function PrivateBookingChoiceDialog({ client, choice, onClose, onRecorded }: { client: PrivateChatBooking; choice: PrivateBookingChoice; onClose: () => void; onRecorded: (receipt: PrivateBookingReceipt) => void }) {
  const [day, setDay] = useState<Date>(), [slots, setSlots] = useState<PrivateBookingSlot[]>(() => { try { return client.initialSlots(choice) } catch { return [] } }), [selected, setSelected] = useState<PrivateBookingSlot>()
  const [values, setValues] = useState<BookingValues>({}), [acknowledged, setAcknowledged] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => () => { ++generation.current }, [])
  let pending: PrivateBookingReference | undefined
  try { pending = client.references().find(ref => ref.provider === choice.provider && ref.attempt.conversationId === choice.value.conversationId && ref.attempt.eventTypeId === choice.value.eventTypeId) } catch { /* The operation reports the storage error before any write. */ }
  const fields = choice.provider === 'kloel' ? choice.value.form : [{ field: 'name' as const, label: 'Nome', required: true }, { field: 'email' as const, label: 'E-mail', required: true }]
  const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: choice.value.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  const selectDay = async (date: Date | undefined) => {
    const ticket = ++generation.current; setDay(date); setSelected(undefined); setSlots([]); setError(''); if (!date) return
    setLoading(true)
    const stamp = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()), target = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const from = new Date(Math.max(Date.now() + 60000, stamp - 14 * 3600000)).toISOString(), to = new Date(stamp + 62 * 3600000).toISOString()
    const format = new Intl.DateTimeFormat('en-CA', { timeZone: choice.value.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const key = (value: string) => { const p = Object.fromEntries(format.formatToParts(new Date(value)).map(part => [part.type, part.value])); return `${p.year}-${p.month}-${p.day}` }
    try { const rows = await client.slots(choice, from, to); if (ticket === generation.current) setSlots(rows.filter(row => key(row.slot.startAt) === target)) }
    catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar os horários.') }
    finally { if (ticket === generation.current) setLoading(false) }
  }
  return <ConfirmDialog open contentProps={{ className: 'sm:max-w-[720px]' }} onOpenChange={open => { if (!open) onClose() }} title={choice.value.title} description={`Fuso horário: ${choice.value.timezone}`} destructive={false} confirmLabel={pending ? 'Consultar reserva' : choice.value.allowCreate ? 'Confirmar reserva' : 'Fechar'} onConfirm={async () => {
    try {
      if (pending) { onRecorded(await client.consult(pending)); return }
      if (!choice.value.allowCreate) { onClose(); return }
      if (loading || !selected) throw Error('Escolha um horário disponível antes de confirmar.')
      onRecorded(await client.create(selected, values, acknowledged))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a reserva.'); throw cause }
  }}>
    <OpStatus status={loading ? 'running' : error ? 'error' : 'idle'} progress={{ label: 'Consultando horários…', percent: 0 }} error={error} onRetry={day && !pending ? () => void selectDay(day) : undefined} />
    {pending ? <p className="text-sm text-muted-foreground">Uma solicitação anterior está em acompanhamento. Consulte o resultado antes de iniciar outra reserva.</p> : <>
      <div className="grid gap-4 sm:grid-cols-2"><Calendar mode="single" selected={day} onSelect={date => void selectDay(date)} className="rounded-md border" /><div className="max-h-64 space-y-2 overflow-y-auto">
        {!loading && !error && !slots.length && <p className="text-sm text-muted-foreground">Nenhum horário disponível. Escolha outra data.</p>}
        {slots.map(row => <Button key={row.slot.quote} disabled={loading} className="h-auto w-full whitespace-normal py-2" variant={selected?.slot.quote === row.slot.quote ? 'default' : 'outline'} onClick={() => setSelected(row)}>{dateLabel(row.slot.startAt)}</Button>)}
      </div></div>
      {choice.value.allowCreate ? <div className="space-y-3">{fields.map(field => <label key={field.field} className="block space-y-1 text-sm"><span>{field.label}{field.required ? ' *' : ''}</span><Input type={field.field === 'email' ? 'email' : field.field === 'phone' ? 'tel' : 'text'} value={values[field.field] ?? ''} onChange={event => setValues(old => ({ ...old, [field.field]: event.target.value }))} /></label>)}
        {choice.provider === 'calendly' && <label className="flex items-start gap-2 text-sm"><Checkbox checked={acknowledged} onCheckedChange={value => setAcknowledged(value === true)} /><span>Estou ciente de que o Calendly pode enviar notificações sobre esta reserva.</span></label>}
      </div> : <p className="text-sm text-muted-foreground">Este agendamento permite consultar disponibilidade. A criação de reservas não está habilitada.</p>}
    </>}
  </ConfirmDialog>
}

function PrivateBookingReceiptDialog({ client, reference, onClose }: { client: PrivateChatBooking; reference: PrivateBookingReference; onClose: () => void }) {
  const [receipt, setReceipt] = useState<PrivateBookingReceipt>(), [links, setLinks] = useState<{ label: string; url: string }[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const busy = useRef(false), mounted = useRef(true)
  const run = async (action: 'read' | 'verify' | 'management' | 'new') => {
    if (busy.current) return; busy.current = true; setLoading(true); setError('')
    try {
      if (action === 'new') { await client.releaseNotSent(reference); if (mounted.current) onClose() }
      else if (action === 'management') { const value = await client.management(reference); if (mounted.current) setLinks(value) }
      else { const value = action === 'verify' ? await client.verify(reference) : await client.consult(reference); if (mounted.current) { setReceipt(value); setLinks([]) } }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a reserva.') }
    finally { busy.current = false; if (mounted.current) setLoading(false) }
  }
  useEffect(() => { mounted.current = true; void run('read'); return () => { mounted.current = false } }, [])
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent><DialogHeader><DialogTitle>Agendamento</DialogTitle><DialogDescription>Acompanhe a solicitação original. Cancelamentos e alterações posteriores aparecem no gerenciamento da reserva.</DialogDescription></DialogHeader>
    <OpStatus status={loading ? 'running' : error ? 'error' : 'idle'} progress={{ label: 'Consultando reserva…', percent: 0 }} error={error} onRetry={() => void run('read')} />
    {receipt && <div className="space-y-3 text-sm"><p className="font-medium">{privateBookingStatus(receipt)}</p><p>Horário solicitado: {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: receipt.value.requestedTime.timezone }).format(new Date(receipt.value.requestedTime.startAt))} · {receipt.value.requestedTime.timezone}</p>
      <div className="flex flex-wrap gap-2"><Button disabled={loading} variant="outline" onClick={() => void run('read')}>Consultar</Button>{receipt.value.needsReconciliation && <Button disabled={loading} variant="outline" onClick={() => void run('verify')}>Verificar reserva</Button>}{receipt.value.status === 'confirmed' && <Button disabled={loading} onClick={() => void run('management')}>Gerenciar reserva</Button>}</div>
      {links.map(link => <Button key={link.label} asChild variant="outline" className="w-full"><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></Button>)}
      {['not_sent', 'failed'].includes(receipt.value.status) && <Button disabled={loading} variant="outline" onClick={() => void run('new')}>Escolher outro horário</Button>}
    </div>}
  </DialogContent></Dialog>
}
