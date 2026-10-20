import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Building,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  Mail,
  Phone,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  User,
  UserPlus,
  Users,
  Video,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/site-secondary'
import '@/domain/ext/site-pricing-demo-auth'
import type { DemoBooking } from '@/domain/types'
import { cn } from '@/lib/utils'
import { useDB } from '@/data/store'
import { WhatsAppIcon } from '@/components/brand/icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LogoStrip } from '@/site/components/sections/LogoStrip'
import { Chip, SoftAurora, isEmail, phoneDigits, siteButton } from '../company/kit'
import { brl, scaleFromLead } from '../pricing/scale'
import { BookingTopBar, DemoField as SiteField, DemoInput as SiteInput, PhoneField } from './booking-kit'
import { SP_TZ, TIMEZONES, addDays, demoSchedule, longDate, monthLabel, timeIn, todayKey, weekdayShort, type DayKey } from './schedule'

const PRODUCT_LABEL: Record<string, string> = {
  voice: 'Assistente telefônico IA',
  whatsapp: 'IA de WhatsApp',
  webchat: 'Webchat de IA',
  email: 'Assistente de e-mail IA',
}

const SIZES = [
  { value: '1', label: '1', icon: User },
  { value: '2–10', label: '2–10', icon: Users },
  { value: '11–50', label: '11–50', icon: Building },
  { value: '50+', label: '50+', icon: Building2 },
]

/** "1 pessoa" / "2–10 pessoas"; vazio quando o porte não foi informado (ex.: reservas feitas pela landing /lp). */
function companySizeText(size: string) {
  const v = size.trim()
  return v === '1' ? '1 pessoa' : `${v} pessoas`
}

const CHANNELS = [
  { value: 'Telefone', icon: Phone },
  { value: 'Site', icon: Globe },
  { value: 'WhatsApp', icon: WhatsAppIcon },
  { value: 'E-mail', icon: Mail },
] as const

/**
 * Passos do cartão refletidos na URL (sub-estado por query, como pede o guia):
 * `?data=AAAA-MM-DD&hora=HH:MM[&fuso=…]` (seleção), `&step=porte` (tamanho da empresa), `&step=dados&porte=…` (formulário).
 * Avançar de passo cria uma entrada no histórico (Voltar/Avançar navegam entre passos); escolher dia/horário/fuso substitui
 * a entrada atual. Outros parâmetros: `reagendar=<id>` (reagendamento), `lead=<id>` (configuração do Scale), `confirmado=<id>`.
 */
type Step = 'date' | 'size' | 'form'
type ParamPatch = Record<string, string | null>
type UpdateParams = (patch: ParamPatch, opts?: { push?: boolean }) => void

interface FormState {
  firstName: string
  lastName: string
  email: string
  company: string
  phone: string
  channels: string[]
  other: boolean
  otherChannel: string
  guests: string[]
}
/** Celular salvo sempre com o código do país (o campo começa vazio, com o Brasil selecionado). */
const normalizePhone = (v: string) => {
  const t = v.trim()
  return t.startsWith('+') ? t : `+55 ${t}`
}

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  company: '',
  phone: '',
  channels: [],
  other: false,
  otherChannel: '',
  guests: [],
}

const formFromBooking = (b: DemoBooking): FormState => ({
  firstName: b.firstName ?? '',
  lastName: b.lastName ?? '',
  email: b.email ?? '',
  company: b.company ?? '',
  phone: b.phone ?? '',
  channels: (b.channels ?? []).filter((c) => c !== 'Outro'),
  other: (b.channels ?? []).includes('Outro'),
  otherChannel: b.otherChannel ?? '',
  guests: [...(b.guests ?? [])],
})

/* Rascunho do formulário (conveniência por visitante): sobrevive ao recarregar a página; apagado ao agendar. */
const DRAFT_KEY = 'kloel-demo:agendar-demo:rascunho'
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
function readDraft(): { forId: string | null; form: FormState } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as { forId?: unknown; form?: Record<string, unknown> } | null
    if (!d || typeof d !== 'object' || !d.form || typeof d.form !== 'object') return null
    const f = d.form
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    return {
      forId: typeof d.forId === 'string' ? d.forId : null,
      form: {
        firstName: str(f.firstName),
        lastName: str(f.lastName),
        email: str(f.email),
        company: str(f.company),
        phone: str(f.phone),
        channels: strList(f.channels),
        other: f.other === true,
        otherChannel: str(f.otherChannel),
        guests: strList(f.guests).slice(0, 5),
      },
    }
  } catch {
    return null
  }
}
function writeDraft(forId: string | null, form: FormState) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ forId, form }))
  } catch {
    /* armazenamento indisponível: o formulário continua funcionando, só não sobrevive ao recarregar */
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* idem */
  }
}

/** Erros dos convidados: vazio, inválido, repetido ou igual ao e-mail do organizador. */
function guestErrors(guests: string[], organizerEmail: string) {
  const out: Record<number, string> = {}
  const organizer = organizerEmail.trim().toLowerCase()
  const seen = new Set<string>()
  guests.forEach((g, i) => {
    const v = g.trim().toLowerCase()
    if (!v) out[i] = 'Informe o e-mail do convidado ou remova o campo.'
    else if (!isEmail(v)) out[i] = 'E-mail de convidado inválido.'
    else if (organizer && v === organizer) out[i] = 'Convidado repetido: este já é o seu e-mail.'
    else if (seen.has(v)) out[i] = 'Convidado repetido.'
    if (v) seen.add(v)
  })
  return out
}

/**
 * Ao mudar de passo (ou confirmar), traz o cartão para a tela — e não o topo da página: no celular o cartão fica abaixo
 * do título e da lista de benefícios. Se o topo do cartão já está visível, não rola.
 */
function useScrollCardIntoView(ref: RefObject<HTMLElement>, key: string) {
  const prev = useRef(key)
  useEffect(() => {
    if (prev.current === key) return
    prev.current = key
    const raf = requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      if (top >= 0 && top <= window.innerHeight * 0.35) return
      // 64px de folga: o título do cartão fica abaixo do toast (topo central) exibido ao confirmar.
      window.scrollTo({ top: Math.max(0, top + window.scrollY - 64), behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [key, ref])
}

const FLOW_RESET: ParamPatch = { step: null, data: null, hora: null, porte: null, fuso: null }

export default function DemoBookingPage() {
  const [params, setParams] = useSearchParams()
  const confirmedId = params.get('confirmado')
  const rescheduleId = params.get('reagendar')
  const cardRef = useRef<HTMLDivElement>(null)
  useScrollCardIntoView(cardRef, `${confirmedId ?? ''}|${params.get('step') ?? ''}|${rescheduleId ?? ''}`)

  const update: UpdateParams = (patch, opts) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) n.delete(k)
          else n.set(k, v)
        }
        return n
      },
      { replace: !opts?.push, preventScrollReset: true },
    )

  return (
    <div className="relative min-h-svh overflow-hidden bg-white font-site text-ink">
      <SoftAurora />
      {/* A referência [7]–[9] não mostra a navegação global; o logo e "Voltar ao site" ficam sobrepostos no topo (sem empurrar o conteúdo). */}
      <BookingTopBar overlay />
      <main className="relative z-10 mx-auto grid w-full max-w-[1180px] gap-10 px-4 pb-16 pt-4 sm:px-5 lg:grid-cols-[1fr_586px] lg:gap-10 lg:px-4 lg:pb-[80px] lg:pt-[79px]">
        <IntroColumn />
        <div ref={cardRef} className="min-w-0">
          {confirmedId ? (
            <Confirmation
              id={confirmedId}
              onNew={() => update({ ...FLOW_RESET, confirmado: null, reagendar: null, lead: null }, { push: true })}
              onReschedule={(id) => update({ ...FLOW_RESET, confirmado: null, reagendar: id, lead: null }, { push: true })}
            />
          ) : (
            <BookingCard
              key={rescheduleId ?? 'novo'}
              params={params}
              update={update}
              onConfirmed={(id) => update({ ...FLOW_RESET, confirmado: id, reagendar: null, lead: null }, { push: true })}
              onKeepOriginal={(id) => update({ ...FLOW_RESET, confirmado: id, reagendar: null }, { push: true })}
            />
          )}
        </div>
      </main>
      <section className="relative z-10 pb-16">
        <LogoStrip
          // [7]/[290]: logos ≈66px abaixo do centro do rótulo (o padrão do LogoStrip é 24px + 8px; aqui 33px + 8px)
          labelClassName="mb-[33px]"
          label={
            <span className="inline-flex items-center gap-2 text-[14px] font-medium text-ink">
              Mais de 1.000 clientes confiam em nós
            </span>
          }
        />
      </section>
    </div>
  )
}

function IntroColumn() {
  return (
    <div className="flex flex-col items-start gap-5 lg:pt-8">
      <Chip icon={<BadgeCheck className="h-[18px] w-[18px] fill-brand-blue text-white" />}>Agendar uma demo</Chip>
      <h1 className="text-[38px] font-medium leading-[44px] tracking-[-0.76px] text-heading sm:text-[48px] sm:leading-[55.2px] sm:tracking-[-0.96px]">
        Veja, ao vivo, como
        <br />a Kloel atende
        <br />
        seus clientes
      </h1>
      <p className="max-w-[460px] text-[16px] leading-6 text-body">
        Nada de demo genérica. Entendemos a comunicação atual da sua empresa com os clientes e mostramos a solução da Kloel personalizada para o seu caso de uso.
      </p>
      <ul className="mt-3 flex max-w-[480px] flex-col gap-3 text-[16px] leading-6 text-body">
        {[
          'Uma apresentação individual da plataforma, sob medida para sua empresa',
          'Uma visão detalhada das funcionalidades avançadas',
          'Respostas diretas para todas as suas dúvidas sobre a Kloel',
        ].map((t) => (
          <li key={t} className="flex gap-2">
            <Check className="mt-1 h-4 w-4 shrink-0 text-brand-blue" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(15,15,22,.06)] sm:p-8', className)}>{children}</div>
}

/** Título dos passos do cartão (20px/28px, como em [7]–[9]). */
function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[20px] font-medium leading-7 tracking-[-0.15px] text-heading">{children}</h2>
}

function SummaryLine({ day, time, tz, onChange }: { day: DayKey; time: string; tz: string; onChange?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-5 text-body">
      <Calendar className="h-[15px] w-[15px] text-body" />
      <span>
        {longDate(day)} às {timeIn(day, time, tz)}
        {tz !== SP_TZ && <span className="text-slate-400"> ({TIMEZONES.find((t) => t.id === tz)?.label})</span>}
      </span>
      {onChange && (
        <button type="button" onClick={onChange} className="ml-0.5 text-brand-blue hover:underline">
          Alterar
        </button>
      )}
    </div>
  )
}

type ScaleInfo = NonNullable<ReturnType<typeof scaleFromLead>>

/** Resumo da configuração do Scale feita na calculadora (lead salvo), exibido no agendamento. */
function ScaleNote({ scale, className }: { scale: ScaleInfo; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-[#FAFAFE] p-3 text-[14px] leading-5', className)} data-testid="scale-summary">
      <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
        <SlidersHorizontal className="h-4 w-4 text-brand-blue" /> Sua configuração do plano Scale
      </div>
      <p className="mt-1 text-body">
        {scale.productName} · {scale.annual ? 'anual' : 'mensal'} · {scale.short}
      </p>
      <p className="mt-0.5 text-ink">
        Estimativa: <b className="font-medium">{brl(scale.total)}/mês</b> <span className="text-slate-400">(a proposta final vem do time comercial)</span>
      </p>
    </div>
  )
}

/** Relógio da página (30 s): mantém a agenda coerente com a hora atual de São Paulo enquanto a página fica aberta. */
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function BookingCard({ params, update, onConfirmed, onKeepOriginal }: { params: URLSearchParams; update: UpdateParams; onConfirmed: (id: string) => void; onKeepOriginal: (id: string) => void }) {
  // Old local reservations are not authoritative availability or confirmed bookings.
  const bookings = useMemo<DemoBooking[]>(() => [], [])
  const leads = useDB((db) => db.leads)
  // Regra única da agenda (schedule.ts › demoSchedule): 3 próximos dias úteis em America/Sao_Paulo, só horários futuros.
  // O relógio avança a cada 30 s para tirar da grade os horários de hoje que já começaram.
  const now = useClock()
  const today = todayKey(now)
  const schedule = useMemo(() => demoSchedule(now), [now])
  const available = useMemo(() => schedule.map((d) => d.day), [schedule])

  const productType = params.get('productType') ?? undefined
  const source = params.get('source') ?? undefined
  const leadId = params.get('lead')
  const lead = leadId ? leads.find((l) => l.id === leadId) : undefined
  const scale = scaleFromLead(lead?.payload)
  const rescheduleId = params.get('reagendar')
  const original = useMemo<DemoBooking | undefined>(() => undefined, [rescheduleId])

  // Seleção e passo derivados da URL (Voltar/Avançar e recarregar preservam o passo e o horário escolhido).
  const [remoteBusy, setRemoteBusy] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    fetch('/api/v1/public/demo-booking/busy', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { busy: [] }))
      .then((j: { busy?: string[] }) => { if (alive) setRemoteBusy(Array.isArray(j.busy) ? j.busy : []) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const taken = useMemo(() => new Set([...bookings.filter((b) => b.kind === 'customer' && b.status === 'scheduled').map((b) => `${b.date} ${b.time}`), ...remoteBusy]), [bookings, remoteBusy])
  const dayParam = params.get('data')
  const timeParam = params.get('hora')
  const fusoParam = params.get('fuso')
  const tz = fusoParam && TIMEZONES.some((t) => t.id === fusoParam) ? fusoParam : SP_TZ
  const day: DayKey = dayParam && available.includes(dayParam) ? dayParam : available[0]!
  const slots = useMemo(() => (schedule.find((d) => d.day === day)?.times ?? []).filter((t) => !taken.has(`${day} ${t}`)), [schedule, day, taken])
  const time = timeParam && dayParam === day && slots.includes(timeParam) ? timeParam : null
  const slotLost = !!timeParam && !time
  const sizeParam = params.get('porte')
  const size = sizeParam && SIZES.some((s) => s.value === sizeParam) ? sizeParam : null
  const stepParam = params.get('step')
  const step: Step = !time ? 'date' : stepParam === 'dados' ? (size ? 'form' : 'size') : stepParam === 'porte' ? 'size' : 'date'

  const [weekStart, setWeekStart] = useState<DayKey>(today)
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const [form, setForm] = useState<FormState>(() => {
    const draft = readDraft()
    const forId = original?.id ?? null
    if (draft && draft.forId === forId) return draft.form
    return original ? formFromBooking(original) : EMPTY_FORM
  })
  const draftFor = original?.id ?? null
  useEffect(() => {
    writeDraft(draftFor, form)
  }, [draftFor, form])

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<{
    label: string
    percent: number
  } | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: '' }))
  }

  const removeGuest = (i: number) => {
    const next = form.guests.filter((_, j) => j !== i)
    setForm((f) => ({ ...f, guests: next }))
    // Os erros seguem o convidado (não a posição): reindexa e mantém só os que ainda valem para a nova lista.
    const still = guestErrors(next, form.email)
    setErrors((er) => {
      const n: Record<string, string> = {}
      for (const [k, v] of Object.entries(er)) {
        const m = /^guest(\d+)$/.exec(k)
        if (!m) {
          n[k] = v
          continue
        }
        const j = Number(m[1])
        if (j === i || !v) continue
        const to = j > i ? j - 1 : j
        if (still[to]) n[`guest${to}`] = still[to]!
      }
      return n
    })
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.firstName.trim()) e.firstName = 'Informe seu nome.'
    if (!form.lastName.trim()) e.lastName = 'Informe seu sobrenome.'
    if (!isEmail(form.email)) e.email = form.email.trim() ? 'Informe um e-mail válido.' : 'Informe seu e-mail profissional.'
    if (!form.company.trim()) e.company = 'Informe o nome da empresa.'
    if (phoneDigits(form.phone) < 10) e.phone = 'Informe um celular válido com DDD.'
    if (form.channels.length === 0 && !form.other && !form.otherChannel.trim()) e.channels = 'Selecione pelo menos um canal.'
    if (form.other && !form.otherChannel.trim()) e.otherChannel = 'Informe qual é o outro canal.'
    for (const [i, msg] of Object.entries(guestErrors(form.guests, form.email))) e[`guest${i}`] = msg
    setErrors(e)
    return Object.values(e).every((v) => !v)
  }

  const submit = async () => {
    if (!time || !size) return
    if (!validate()) {
      toast.error('Revise os campos destacados.')
      return
    }
    setSubmitError(null)
    setSubmitting({ label: 'Confirmando na agenda', percent: 50 })
    try {
      const res = await fetch('/api/v1/public/demo-booking', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date: day, time, timezone: tz, size,
          firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), company: form.company.trim(),
          phone: normalizePhone(form.phone), channels: [...form.channels, ...(form.other && form.otherChannel.trim() ? [form.otherChannel.trim()] : [])],
          guests: form.guests.map((g) => g.trim()).filter(Boolean),
          ...(productType ? { productType } : {}), ...(source ? { source } : {}),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
      if (!res.ok || !body.id) throw new Error(body.error?.message || 'Não foi possível confirmar o agendamento. Tente novamente.')
      clearDraft()
      setSubmitting(null)
      onConfirmed(body.id)
    } catch (err) {
      setSubmitting(null)
      setSubmitError(err instanceof Error ? err.message : 'Não foi possível confirmar o agendamento.')
    }
  }

  const toDate = () => update({ step: null }, { push: true })

  const rescheduleBanner = rescheduleId ? (
    original ? (
      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-brand-blue/30 bg-[#F5F5FF] p-3 text-[14px] leading-5 text-ink" data-testid="reschedule-banner">
        <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" />
        <div className="min-w-0">
          <b className="font-medium">Reagendando a sua reunião.</b> O horário atual ({longDate(original.date)} às {timeIn(original.date, original.time, original.timezone ?? SP_TZ)}) continua reservado até você confirmar o novo.{' '}
          <button type="button" onClick={() => onKeepOriginal(original.id)} className="text-brand-blue hover:underline">
            Manter horário atual
          </button>
        </div>
      </div>
    ) : (
      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[14px] leading-5 text-amber-900" role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Esta reunião não pode ser reagendada (foi cancelada ou não existe). Escolha um horário para uma nova reunião.</span>
      </div>
    )
  ) : null

  if (step === 'date') {
    const canPrev = weekStart > today
    const weekHasDays = week.some((k) => available.includes(k))
    const dayVisible = week.includes(day)
    return (
      <Card>
        {rescheduleBanner}
        <CardTitle>{original ? 'Escolha o novo horário' : 'Escolha a data e o horário'}</CardTitle>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] leading-5 text-body">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> 30 minutos
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Video className="h-4 w-4" /> Google Meet
          </span>
          {/* [290]: vindo de /planos o cartão mostra só duração e sala; o produto (productType) é salvo e aparece na confirmação ("Interesse"). */}
        </div>
        {scale && <ScaleNote scale={scale} className="mt-3" />}
        <div className="mt-4 h-px bg-slate-200" />
        {slotLost && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[14px] leading-5 text-amber-900" role="status" data-testid="slot-lost">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>O horário escolhido não está mais disponível. Escolha outro horário.</span>
          </div>
        )}
        {/* [7]/[290]: mês a 32px do divisor e dias 12px abaixo da linha do mês; setas cinza (#9A9BA2) */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-[16px] leading-6 text-ink">{monthLabel(week[3]!)}</div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Semana anterior"
              disabled={!canPrev}
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-[#9A9BA2] hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:text-slate-200 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Próxima semana"
              disabled={weekStart > addDays(today, 6)}
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-[#9A9BA2] hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:text-slate-200 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1 sm:gap-2" role="radiogroup" aria-label="Dia">
          {week.map((k) => {
            const enabled = available.includes(k)
            const selected = k === day
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!enabled}
                onClick={() => update({ data: k, hora: null, step: null })}
                className={cn(
                  'flex h-[60px] flex-col items-center justify-center gap-[3px] rounded-[10px] border text-center transition-colors',
                  !enabled && 'cursor-not-allowed border-transparent bg-[#F7F8FC] text-[#A4A6B5]',
                  enabled && !selected && 'border-slate-200 bg-white text-heading hover:border-brand-blue/50',
                  selected && 'border-brand-blue bg-[#F7F7FE] text-brand-blue',
                )}
              >
                <span className={cn('text-[10px] uppercase leading-4 sm:text-[12px]', enabled && !selected && 'text-body')}>{weekdayShort(k)}</span>
                <span className="text-[16px] leading-[22px]">{Number(k.slice(8))}</span>
              </button>
            )
          })}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="mt-6 inline-flex items-center gap-2 text-[16px] leading-6 text-ink hover:text-brand-blue" aria-label="Fuso horário">
              {TIMEZONES.find((t) => t.id === tz)?.label}
              <ChevronDown className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60 font-site">
            {TIMEZONES.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => update({ fuso: t.id === SP_TZ ? null : t.id })}>
                <span className="flex-1">{t.label}</span>
                {t.id === tz && <Check className="h-4 w-4 text-brand-blue" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="mt-3 max-h-[189px] overflow-y-auto pr-1.5 [scrollbar-color:#94A3B8_transparent] [scrollbar-width:thin]" role="radiogroup" aria-label="Horário" data-testid="slot-grid">
          {!weekHasDays ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-[15px] text-body" data-testid="week-empty">
              Sem horários disponíveis nesta semana. A agenda abre somente os 3 próximos dias úteis.{' '}
              <button type="button" onClick={() => setWeekStart(today)} className="text-brand-blue hover:underline">
                Ver semana atual
              </button>
            </div>
          ) : !available.includes(day) ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-[15px] text-body">Sem horários disponíveis neste dia. Escolha um dos próximos dias úteis destacados.</p>
          ) : slots.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-[15px] text-body">Todos os horários deste dia já foram reservados. Escolha outro dia.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-[13px]">
              {slots.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={t === time}
                  onClick={() => update({ data: day, hora: t, step: null })}
                  className={cn(
                    'h-[43px] rounded-[10px] border text-[16px] transition-colors',
                    t === time ? 'border-brand-blue bg-[#F5F5FF] text-brand-blue' : 'border-slate-200 bg-white text-body hover:border-brand-blue/50',
                  )}
                >
                  {timeIn(day, t, tz)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-8 flex justify-end">
          <button type="button" disabled={!time || !dayVisible} onClick={() => update({ data: day, hora: time, step: 'porte' }, { push: true })} className={cn(siteButton('brand'), 'gap-2')}>
            Continuar <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </Card>
    )
  }

  if (step === 'size') {
    const current = size ?? original?.companySize ?? null
    return (
      <Card>
        {rescheduleBanner}
        <CardTitle>Quantas pessoas trabalham na sua empresa?</CardTitle>
        <div className="mt-2">
          <SummaryLine day={day} time={time!} tz={tz} onChange={toDate} />
        </div>
        {scale && <ScaleNote scale={scale} className="mt-3" />}
        <div className="mt-4 h-px bg-slate-200" />
        <div className="mt-[26px] flex flex-col gap-3">
          {SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => update({ porte: s.value, step: 'dados' }, { push: true })}
              className={cn(
                'flex h-[46px] items-center gap-3 rounded-[10px] border pl-[18px] pr-4 text-left text-[16px] text-ink transition-colors hover:border-brand-blue/60 hover:bg-[#F8F8FF]',
                current === s.value ? 'border-brand-blue' : 'border-slate-200',
              )}
            >
              <s.icon className="h-[18px] w-[18px] text-body" />
              <span className="flex-1">{s.label}</span>
              <ChevronRight className="h-4 w-4 text-ink" />
            </button>
          ))}
        </div>
      </Card>
    )
  }

  // step === 'form'
  return (
    <Card>
      {rescheduleBanner}
      <CardTitle>Seus dados</CardTitle>
      <div className="mt-2">
        <SummaryLine day={day} time={time!} tz={tz} onChange={toDate} />
      </div>
      {scale && <ScaleNote scale={scale} className="mt-3" />}
      <div className="mb-6 mt-4 h-px bg-slate-200" />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        // [277]: 19 px entre os campos (rótulo 20 + 9 + campo 44 + 19 = 92 px por linha); antes 93 px, deriva de até 7 px no fim do cartão
        className="flex flex-col gap-[19px]"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <SiteField label="Nome" required htmlFor="d-first" error={errors.firstName}>
            <SiteInput id="d-first" autoComplete="given-name" placeholder="Maria" value={form.firstName} invalid={!!errors.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </SiteField>
          <SiteField label="Sobrenome" required htmlFor="d-last" error={errors.lastName}>
            <SiteInput id="d-last" autoComplete="family-name" placeholder="Silva" value={form.lastName} invalid={!!errors.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </SiteField>
        </div>
        <SiteField label="E-mail profissional" required htmlFor="d-email" error={errors.email}>
          <SiteInput id="d-email" type="email" autoComplete="email" placeholder="maria@empresa.com.br" value={form.email} invalid={!!errors.email} onChange={(e) => set('email', e.target.value)} />
        </SiteField>
        {form.guests.map((g, i) => (
          <SiteField key={i} label={`Convidado ${i + 1}`} htmlFor={`d-guest-${i}`} error={errors[`guest${i}`]}>
            <div className="flex gap-2">
              <SiteInput
                id={`d-guest-${i}`}
                type="email"
                placeholder="colega@empresa.com.br"
                value={g}
                invalid={!!errors[`guest${i}`]}
                onChange={(e) => {
                  const next = [...form.guests]
                  next[i] = e.target.value
                  set('guests', next)
                  setErrors((er) => ({ ...er, [`guest${i}`]: '' }))
                }}
              />
              <button
                type="button"
                aria-label={`Remover convidado ${i + 1}`}
                onClick={() => removeGuest(i)}
                className="flex h-[43px] w-[43px] shrink-0 items-center justify-center rounded-[10px] border border-slate-200 text-body hover:bg-slate-50 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </SiteField>
        ))}
        {form.guests.length < 5 && (
          <button type="button" onClick={() => set('guests', [...form.guests, ''])} className="-mb-[2px] -mt-[11px] inline-flex h-6 w-fit items-center gap-2 text-[14px] text-brand-blue hover:underline">
            <UserPlus className="h-4 w-4" /> Adicionar convidados
          </button>
        )}
        <SiteField label="Empresa" required htmlFor="d-company" error={errors.company}>
          <SiteInput id="d-company" autoComplete="organization" placeholder="Acme Ltda." value={form.company} invalid={!!errors.company} onChange={(e) => set('company', e.target.value)} />
        </SiteField>
        <SiteField label="Celular" required htmlFor="d-phone" error={errors.phone}>
          <PhoneField id="d-phone" value={form.phone} invalid={!!errors.phone} onChange={(v) => set('phone', v)} className="h-[44px] text-[15px]" inputClassName="text-[15px]" />
        </SiteField>
        <SiteField label="Por onde seus clientes costumam entrar em contato com você?" required error={errors.channels}>
          <div className="flex flex-wrap gap-x-2.5 gap-y-2.5" role="group" aria-label="Canais de contato">
            {CHANNELS.map((c) => {
              const on = form.channels.includes(c.value)
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('channels', on ? form.channels.filter((x) => x !== c.value) : [...form.channels, c.value])}
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-[10px] border px-3.5 text-[15px] transition-colors',
                    on ? 'border-brand-blue bg-[#EEEFFF] font-medium text-brand-blue' : 'border-brand-blue/80 bg-white text-brand-blue hover:bg-[#F5F5FF]',
                  )}
                >
                  <c.icon className="h-4 w-4" />
                  {c.value}
                </button>
              )
            })}
            <button
              type="button"
              aria-pressed={form.other}
              onClick={() => {
                set('other', !form.other)
                if (!form.other) setTimeout(() => document.getElementById('d-other')?.focus(), 0)
                setErrors((er) => ({ ...er, channels: '' }))
              }}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-[10px] border px-3.5 text-[15px] transition-colors',
                form.other ? 'border-brand-blue bg-[#EEEFFF] font-medium text-brand-blue' : 'border-brand-blue/80 bg-white text-brand-blue hover:bg-[#F5F5FF]',
              )}
            >
              <Plus className="h-4 w-4" /> Outro
            </button>
          </div>
        </SiteField>
        {/* Em [9] o campo aparece com o formulário vazio: fica sempre visível; preenchê-lo marca "Outro". */}
        <SiteField label="Qual outro canal?" required={form.other} htmlFor="d-other" error={errors.otherChannel}>
          <SiteInput
            id="d-other"
            placeholder="ex.: Instagram"
            value={form.otherChannel}
            invalid={!!errors.otherChannel}
            onChange={(e) => {
              set('otherChannel', e.target.value)
              if (e.target.value.trim()) setErrors((er) => ({ ...er, channels: '' }))
            }}
          />
        </SiteField>

        {submitError && (
          <div role="alert" data-engine-state="error" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[14px] text-red-700">
            <XCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{submitError}</span>
            <button type="button" onClick={() => void submit()} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[13px] hover:bg-red-50">
              <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
            </button>
          </div>
        )}
        {submitting && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-[14px] text-body" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" /> {submitting.label}…
          </div>
        )}

        <div className="mt-3 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[275px] text-[13px] leading-5 text-slate-400">
            Ao agendar, você concorda com nossa{' '}
            <a href="/ajuda/legal/politica-de-privacidade" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
              política de privacidade
            </a>
            .
          </p>
          <button type="submit" disabled={!!submitting} className={cn(siteButton('brand'), 'gap-2 sm:h-[50px]')}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {original ? 'Confirmar novo horário' : 'Agendar reunião'} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </form>
    </Card>
  )
}

type ConfirmedView = { id: string; date: string; time: string; timezone: string; name: string; email: string; company: string; guests: string[]; meetUrl: string | null }

function Confirmation({ id, onNew }: { id: string; onNew: () => void; onReschedule: (id: string) => void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ok'; b: ConfirmedView } | { status: 'error' }>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    fetch(`/api/v1/public/demo-booking/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
      .then(async (r) => { if (!r.ok) throw new Error(); return (await r.json()) as ConfirmedView })
      .then((b) => alive && setState({ status: 'ok', b }))
      .catch(() => alive && setState({ status: 'error' }))
    return () => { alive = false }
  }, [id])
  if (state.status === 'loading') return <Card className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin" /> Carregando sua reunião…</Card>
  if (state.status === 'ok') {
    const b = state.b
    return (
      <Card className="flex flex-col items-start gap-4">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <CardTitle>Reunião agendada!</CardTitle>
        <p className="text-[15px] leading-6 text-body">Enviamos o convite da agenda para <b className="font-medium text-ink">{b.email}</b>{b.guests.length ? ` e ${b.guests.length} convidado(s)` : ''}. Confira sua caixa de entrada.</p>
        <dl className="grid w-full gap-2 text-[15px]">
          <Row label="Quando">{longDate(b.date)} às {timeIn(b.date, b.time, b.timezone || SP_TZ)}</Row>
          <Row label="Empresa">{b.company}</Row>
          <Row label="Participante">{b.name}</Row>
          {b.meetUrl && <Row label="Google Meet"><a href={b.meetUrl} target="_blank" rel="noopener noreferrer" className="break-all text-brand-blue hover:underline">{b.meetUrl}</a></Row>}
        </dl>
        <button type="button" onClick={onNew} className={siteButton('outline')}>Agendar outra reunião</button>
      </Card>
    )
  }
  return (
    <Card className="flex flex-col items-start gap-4">
      <XCircle className="h-8 w-8 text-slate-400" />
      <CardTitle>Não foi possível confirmar o agendamento</CardTitle>
      <p role="alert" data-engine-state="error" className="text-[15px] leading-6 text-body">A consulta de demonstrações ainda não está disponível. Nenhuma reserva ou envio de convite foi confirmado.</p>
      <button type="button" onClick={onNew} className={siteButton('brand')}>
        Escolher um horário
      </button>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <dt className="text-body">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  )
}
