import { forwardRef, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, CalendarCheck, CheckCircle2, ChevronDown, Clock, Loader2, RotateCcw, Video, X, XCircle } from 'lucide-react'
import '@/domain/ext/site-secondary'
import type { DemoBooking } from '@/domain/types'
import { cn } from '@/lib/utils'
import { useDB, useStore } from '@/data/store'
import { runSteps } from '@/services'
import { validateEmail, validatePhoneBR } from '@/site/components/forms'
import { SP_TZ, demoDays, demoSlots, keyNoon, longDate, type DayKey } from '@/site/pages/demo/schedule'

export const CALLS_OPTIONS = ['Até 10 ligações', '10 a 50 ligações', '50 a 100 ligações', '100 a 300 ligações', 'Mais de 300 ligações']

/**
 * Janela de agenda (nota "Agendamento de Demo"): a MESMA regra de /agendar-demo (src/site/pages/demo/schedule.ts › demoSchedule):
 * 3 próximos dias úteis, slots de 15 min, segunda 13:00–18:30, terça a quinta 09:00–18:30, sexta 09:00–12:00, America/Sao_Paulo,
 * só horários futuros. Sem horários "ocupados" simulados. Horários já reservados aparecem riscados e desabilitados.
 */
export function lpSlots(k: DayKey, now: Date = new Date()) {
  return demoSlots(k, new Set(), now)
}

const dayFmt = (k: DayKey, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...o }).format(keyNoon(k))

type Form = { firstName: string; lastName: string; email: string; phone: string; company: string; calls: string }
const EMPTY: Form = { firstName: '', lastName: '', email: '', phone: '', company: '', calls: '' }

/* Campos compactos da referência [431]: rótulo 16 px, caixa de 32 px, borda #E1E3F3, placeholder #6B6D80. */
function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string | null; children: ReactNode }) {
  return (
    // [431]: rótulos de 14 px a 6 px do campo; 74 px entre o topo de um rótulo e o do próximo
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[14px] font-medium leading-5 tracking-[-0.01em] text-ink">{label}</label>
      {children}
      {error && <span role="alert" className="text-[13px] text-red-600">{error}</span>}
    </div>
  )
}

const inputCls = (invalid?: boolean) =>
  cn(
    'h-10 w-full rounded-md border border-[#E1E3F3] bg-white px-3.5 text-[16px] tracking-[-0.01em] text-ink outline-none transition-shadow placeholder:text-[#6B6D80] focus:border-brand-blue focus:ring-[3px] focus:ring-brand-blue/15 sm:h-8',
    invalid && 'border-red-400 focus:border-red-400 focus:ring-red-100',
  )

const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ invalid, className, ...p }, ref) => (
  <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputCls(invalid), className)} {...p} />
))
Input.displayName = 'LpInput'

/**
 * Formulário de demonstração da landing (seção 6): dados → horários disponíveis → reservando (simulado) → confirmação | erro → tentar novamente.
 * Salva DemoBooking (source "landing-campanha") + Lead no store. A confirmação fica no endereço (?agendado=<id>#agendar): recarregar mantém o
 * resultado e "Ver ou cancelar" abre a mesma reserva em /agendar-demo?confirmado=<id>.
 */
export function LpBookingForm({ plan, onClearPlan }: { plan: string | null; onClearPlan: () => void }) {
  const bookings = useMemo<DemoBooking[]>(() => [], [])
  const location = useLocation()
  const navigate = useNavigate()
  const confirmedId = new URLSearchParams(location.search).get('agendado')
  const confirmed = confirmedId ? bookings.find((b) => b.id === confirmedId) : undefined

  const [step, setStep] = useState<'form' | 'slots'>('form')
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string | null>>>({})
  const days = useMemo(() => demoDays(), [])
  const [day, setDay] = useState(0)
  const [time, setTime] = useState<string | null>(null)
  const [saving, setSaving] = useState<{ label: string; percent: number } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const taken = useMemo(() => new Set(bookings.filter((b) => b.kind === 'customer' && b.status === 'scheduled').map((b) => `${b.date} ${b.time}`)), [bookings])
  const dayKey = days[day]!

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (errors[k]) setErrors((x) => ({ ...x, [k]: null }))
  }

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Partial<Record<keyof Form, string | null>> = {
      firstName: form.firstName.trim() ? null : 'Informe seu nome.',
      lastName: form.lastName.trim() ? null : 'Informe seu sobrenome.',
      email: validateEmail(form.email),
      phone: validatePhoneBR(form.phone),
      company: form.company.trim() ? null : 'Informe o nome da empresa.',
      calls: form.calls ? null : 'Selecione uma opção.',
    }
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) {
      const first = (Object.keys(errs) as (keyof Form)[]).find((k) => errs[k])
      if (first) document.getElementById(`lp-${first}`)?.focus()
      return
    }
    setStep('slots')
  }

  const confirm = async () => {
    if (!time || saving) return
    if (taken.has(`${dayKey} ${time}`)) {
      setSaveError('Este horário acabou de ser reservado. Escolha outro horário.')
      setTime(null)
      return
    }
    setSaving(null)
    setSaveError('O agendamento de demonstrações ainda não está disponível. Nenhuma reserva ou envio de convite foi confirmado.')
  }

  const startOver = () => {
    setStep('form')
    setTime(null)
    setSaveError(null)
    setForm(EMPTY)
    setErrors({})
    navigate({ pathname: location.pathname, search: '', hash: '#agendar' }, { replace: true })
  }

  const card = 'rounded-3xl border border-[#E1E3F3] bg-white p-6 shadow-[0_24px_60px_-34px_rgba(15,15,22,.28)] sm:px-[37px] sm:pb-[35px] sm:pt-[36px]'

  if (confirmedId) {
    if (!confirmed) {
      return (
        <div className={cn(card, 'flex flex-col items-start gap-4')} data-testid="lp-booking">
          <XCircle className="h-8 w-8 text-slate-400" />
          <div className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Não foi possível confirmar o agendamento</div>
          <p role="alert" data-engine-state="error" className="text-[16px] text-[#6B6D80]">A consulta de demonstrações ainda não está disponível. Nenhuma reserva ou envio de convite foi confirmado.</p>
          <button type="button" onClick={startOver} className="inline-flex h-10 items-center rounded-md bg-brand-blue px-4 text-[16px] font-medium text-white hover:bg-[#4a4fe6]">Escolher um horário</button>
        </div>
      )
    }
    const canceled = confirmed.status === 'canceled'
    return (
      <div className={cn(card, 'ks-fade-up flex flex-col items-center gap-4 py-10 text-center')} data-testid="lp-booking-done">
        <span className={cn('flex h-14 w-14 items-center justify-center rounded-full', canceled ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600')}>
          {canceled ? <XCircle className="h-7 w-7" /> : <CheckCircle2 className="h-7 w-7" />}
        </span>
        <div className="text-[24px] font-semibold tracking-[-0.03em] text-ink">{canceled ? 'Demonstração cancelada' : 'Demonstração agendada!'}</div>
        <p className="max-w-[400px] text-[16px] text-[#6B6D80]">
          {canceled ? (
            <>A reserva de {longDate(confirmed.date)} às {confirmed.time} foi cancelada e o horário voltou a ficar disponível.</>
          ) : (
            <>
              {longDate(confirmed.date)} às {confirmed.time} (30 min, horário de Brasília). Enviamos o convite para <b className="font-medium text-ink">{confirmed.email}</b>.
            </>
          )}
        </p>
        {confirmed.message && confirmed.message.startsWith('Plano de interesse') && <div className="text-[14px] text-[#6B6D80]">{confirmed.message.replace(' (landing de campanha)', '')}</div>}
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-[#6B6D80]">
          <CalendarCheck className="h-4 w-4" /> Reserva #{confirmed.id.slice(-6)}
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {!canceled && (
            <Link to={`/agendar-demo?confirmado=${confirmed.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-[#E1E3F3] px-4 text-[15px] text-ink hover:bg-slate-50">
              Ver ou cancelar agendamento <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
          <button type="button" onClick={startOver} className="inline-flex h-10 items-center rounded-md bg-brand-blue px-4 text-[15px] font-medium text-white hover:bg-[#4a4fe6]">Agendar outro horário</button>
        </div>
      </div>
    )
  }

  return (
    <div className={card} data-testid="lp-booking">
      {plan && (
        <div className="mb-5 flex items-center justify-between gap-2 rounded-xl bg-indigo-50 px-3.5 py-2.5 text-[14px] text-indigo-900" data-testid="lp-plan-note">
          <span>Plano de interesse: <b className="font-semibold">{plan}</b> — a contratação é feita após a demonstração.</span>
          <button type="button" onClick={onClearPlan} aria-label="Remover plano de interesse" className="rounded p-1 hover:bg-indigo-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {step === 'form' && (
        <form onSubmit={submitForm} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="lp-firstName" error={errors.firstName}><Input id="lp-firstName" value={form.firstName} onChange={set('firstName')} placeholder="João" invalid={!!errors.firstName} autoComplete="given-name" /></Field>
            <Field label="Sobrenome" htmlFor="lp-lastName" error={errors.lastName}><Input id="lp-lastName" value={form.lastName} onChange={set('lastName')} placeholder="Silva" invalid={!!errors.lastName} autoComplete="family-name" /></Field>
          </div>
          <Field label="Email corporativo" htmlFor="lp-email" error={errors.email}><Input id="lp-email" type="email" value={form.email} onChange={set('email')} placeholder="joao@empresa.com.br" invalid={!!errors.email} autoComplete="email" /></Field>
          <Field label="Telefone" htmlFor="lp-phone" error={errors.phone}><Input id="lp-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="(11) 90000-0000" invalid={!!errors.phone} autoComplete="tel" /></Field>
          <Field label="Nome da empresa" htmlFor="lp-company" error={errors.company}><Input id="lp-company" value={form.company} onChange={set('company')} placeholder="Minha Empresa Ltda" invalid={!!errors.company} autoComplete="organization" /></Field>
          <Field label="Qts ligações sua empresa recebe por dia?" htmlFor="lp-calls" error={errors.calls}>
            <div className="relative">
              <select id="lp-calls" value={form.calls} onChange={set('calls')} aria-invalid={!!errors.calls || undefined} className={cn(inputCls(!!errors.calls), 'appearance-none pr-9', form.calls ? 'text-ink' : 'text-[#6B6D80]')}>
                <option value="" disabled>Selecione uma opção</option>
                {CALLS_OPTIONS.map((o) => <option key={o} value={o} className="text-ink">{o}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B6D80]" aria-hidden />
            </div>
          </Field>
          <button type="submit" className="mt-[9px] h-12 rounded-md bg-brand-blue text-[18px] font-medium tracking-[-0.01em] text-white hover:bg-[#4a4fe6]">Ver horários disponíveis</button>
        </form>
      )}

      {step === 'slots' && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setStep('form'); setSaveError(null) }} disabled={!!saving} className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-40" aria-label="Voltar aos dados"><ArrowLeft className="h-4 w-4" /></button>
            <div>
              <div className="text-[18px] font-semibold tracking-[-0.02em] text-ink">Escolha a data e o horário</div>
              <div className="flex gap-4 text-[13px] text-[#6B6D80]"><span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> 30 minutos</span><span className="flex items-center gap-1"><Video className="h-3.5 w-3.5" /> Videochamada</span></div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Dia">
            {days.map((d, i) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={i === day}
                disabled={!!saving}
                onClick={() => { setDay(i); setTime(null); setSaveError(null) }}
                className={cn('flex flex-col items-center rounded-xl border py-2.5', i === day ? 'border-brand-blue bg-indigo-50 text-brand-blue' : 'border-[#E1E3F3] text-ink hover:border-slate-300')}
              >
                <span className="text-[11px] font-medium uppercase tracking-wide">{dayFmt(d, { weekday: 'short' }).replace('.', '')}</span>
                <span className="text-[22px] font-medium leading-7">{dayFmt(d, { day: '2-digit' })}</span>
                <span className="text-[11px] text-[#6B6D80]">{dayFmt(d, { month: 'short' }).replace('.', '')}</span>
              </button>
            ))}
          </div>
          <div className="text-[13px] text-[#6B6D80]">Fuso horário: America/Sao_Paulo (horário de Brasília)</div>
          <div className="grid max-h-[220px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="radiogroup" aria-label="Horário">
            {lpSlots(dayKey).map((t) => {
              const busy = taken.has(`${dayKey} ${t}`)
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={time === t}
                  disabled={busy || !!saving}
                  onClick={() => { setTime(t); setSaveError(null) }}
                  className={cn('h-10 rounded-lg border text-[14px] tabular-nums transition-colors', time === t ? 'border-brand-blue bg-brand-blue text-white' : 'border-[#E1E3F3] text-ink hover:border-brand-blue/60', busy && 'cursor-not-allowed border-dashed text-slate-300 line-through hover:border-[#E1E3F3]')}
                  title={busy ? 'Horário já reservado' : undefined}
                >
                  {t}
                </button>
              )
            })}
          </div>
          {saveError && (
            <div role="alert" data-engine-state="error" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[14px] text-red-700" data-testid="lp-booking-error">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{saveError}</span>
              {time && <button type="button" onClick={confirm} className="inline-flex shrink-0 items-center gap-1 font-medium underline underline-offset-2"><RotateCcw className="h-3.5 w-3.5" /> Tentar novamente</button>}
            </div>
          )}
          <button type="button" disabled={!time || !!saving} onClick={confirm} className="flex h-12 items-center justify-center gap-2 rounded-md bg-brand-blue px-3 text-[16px] font-medium text-white hover:bg-[#4a4fe6] disabled:bg-[#A9AAF7] sm:text-[17px]">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? `${saving.label}…` : time ? `Confirmar ${longDate(dayKey)} às ${time}` : 'Escolha um horário'}
          </button>
        </div>
      )}
    </div>
  )
}
