import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, CheckCircle2, ChevronDown, Clock, Loader2, RotateCcw, Video, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/site-secondary'
import type { DemoBooking } from '@/domain/types'
import { cn } from '@/lib/utils'
import { useDB, useStore } from '@/data/store'
import { runSteps } from '@/services'
import { KloelLogo, KloelMark } from '@/components/brand/KloelLogo'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { usePageTitle } from '@/site/components/usePageTitle'
import { SiteField, SiteInput, isEmail, phoneDigits, siteButton } from '../company/kit'
import { demoDays, downloadIcs, fakeMeetLink, instantOf, longDate, partnerSlots, shortDate, type DayKey } from '../demo/schedule'

const CLIENT_RANGES = ['0', '1–10', '11–50', '51–100', '101–300', '301–1.000', '1.000+']
/** Faixas na URL (?clientes=): sem travessão, ponto ou "+", que o navegador trocaria por espaço. */
const RANGE_SLUGS = ['0', '1-10', '11-50', '51-100', '101-300', '301-1000', '1000-mais']
const rangeOfSlug = (slug: string | null) => (slug ? CLIENT_RANGES[RANGE_SLUGS.indexOf(slug)] ?? null : null)
const slugOfRange = (r: string) => RANGE_SLUGS[CLIENT_RANGES.indexOf(r)] ?? r
const STARTING = ['0', '1–2', '3–5', '6–10', 'Mais de 10']
const HOST = 'Time de Parcerias Kloel'

type Step = 1 | 2 | 3
type Slot = { day: DayKey; time: string }
/** Horário na URL (?horario=AAAA-MM-DD_10h30). */
const slotParam = (s: Slot) => `${s.day}_${s.time.replace(':', 'h')}`
function parseSlot(v: string | null): Slot | null {
  const m = v?.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})h(\d{2})$/)
  return m ? { day: m[1]!, time: `${m[2]}:${m[3]}` } : null
}

/** Rascunho dos dados do passo 3 (por aba): recarregar a página não apaga o que já foi digitado. */
const DRAFT_KEY = 'kloel-site:partner-booking-draft'
type Draft = { firstName: string; lastName: string; email: string; phone: string; company: string; starting: string }
const EMPTY_DRAFT: Draft = { firstName: '', lastName: '', email: '', phone: '', company: '', starting: '' }
function readDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY_DRAFT
  } catch {
    return EMPTY_DRAFT
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* armazenamento indisponível: o rascunho vale só enquanto a página estiver aberta */
  }
}

/** Cabeçalho de [240]: só o logo centralizado (sem menu nem link de volta). */
function TopBar() {
  return (
    <header className="relative z-10 flex h-[96px] items-center justify-center px-5 sm:h-[184px]">
      <Link to="/" aria-label="kloel.ai — início" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
        <KloelLogo className="text-[30px] sm:text-[34px]" />
      </Link>
    </header>
  )
}

/**
 * /parceiros/agendar — conversa de parceria em 4 passos (OBSERVADO [240]–[243]; confirmação = passo 4 INFERIDO).
 * O passo, a faixa de clientes e o horário ficam na URL (?passo=2&clientes=11-50&horario=…): voltar/avançar do navegador
 * percorrem os passos e recarregar restaura o ponto do fluxo. Os dados digitados no passo 3 ficam num rascunho da aba.
 */
export default function PartnerBookingPage() {
  usePageTitle('Agendar conversa de parceria')
  const [params, setParams] = useSearchParams()
  const confirmedId = params.get('confirmado')
  const setConfirmed = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams()
        const source = p.get('source')
        if (source) n.set('source', source)
        if (id) n.set('confirmado', id)
        return n
      },
      // confirmar substitui o passo 3 no histórico (voltar não reabre um formulário já enviado)
      { replace: !!id },
    )
  return (
    <div className="relative min-h-svh overflow-x-hidden bg-white font-site text-ink">
      <TopBar />
      <main className="relative z-10 mx-auto w-full max-w-[800px] px-5 pb-20 sm:pt-[80px]">
        {confirmedId ? <Confirmation id={confirmedId} onNew={() => setConfirmed(null)} /> : <Flow source={params.get('source') ?? undefined} onConfirmed={(id) => setConfirmed(id)} />}
      </main>
    </div>
  )
}

function Progress({ step }: { step: number }) {
  return (
    <div className="mx-auto mb-6 grid grid-cols-4 gap-1.5 px-2.5" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-label={`Passo ${step} de 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('h-[3px] rounded-full transition-colors', i <= step ? 'bg-brand-blue' : 'bg-slate-200')} />
      ))}
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_6px_24px_rgba(15,15,22,.04)] sm:p-8">{children}</div>
}

function HostStrip({ detail, onChange }: { detail: ReactNode; onChange?: () => void }) {
  return (
    // [241]/[242]: faixa do anfitrião com 71px (nome e detalhe com 20px de linha, 4px entre eles)
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-[#F6F7FB] p-3 sm:px-4 sm:py-[13px]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
        <KloelMark className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium leading-5 text-heading">{HOST}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-5 text-body">{detail}</div>
      </div>
      {onChange && (
        <button type="button" onClick={onChange} className="text-[14px] text-brand-blue hover:underline">
          Alterar
        </button>
      )}
    </div>
  )
}

function Flow({ source, onConfirmed }: { source?: string; onConfirmed: (id: string) => void }) {
  const bookings = useMemo<DemoBooking[]>(() => [], [])
  // Mesma regra da demonstração (schedule.ts › demoSchedule): 3 próximos dias úteis, 15 min, seg só à tarde, sex só de manhã, America/Sao_Paulo.
  const days = useMemo(() => demoDays(), [])
  const taken = useMemo(() => new Set(bookings.filter((b) => b.kind === 'partner' && b.status === 'scheduled').map((b) => `${b.date} ${b.time}`)), [bookings])
  const [params, setParams] = useSearchParams()
  const loc = useLocation()
  const navigate = useNavigate()
  const clients = rangeOfSlug(params.get('clientes'))
  const rawSlot = parseSlot(params.get('horario'))
  // Durante a confirmação o horário passa a constar como reservado (pela própria reserva): não pode invalidar o passo 3.
  const confirming = useRef(false)
  // horário da URL só vale se ainda estiver na agenda e livre
  const slot = rawSlot && days.includes(rawSlot.day) && (confirming.current || partnerSlots(rawSlot.day, taken).includes(rawSlot.time)) ? rawSlot : null
  const requested = Math.min(3, Math.max(1, Number(params.get('passo')) || 1)) as Step
  const step: Step = requested >= 2 && !clients ? 1 : requested === 3 && !slot ? 2 : requested
  const fromStep = (loc.state as { wizardFrom?: number } | null)?.wizardFrom

  /** Atualiza a URL do fluxo. `push` cria uma entrada no histórico (mudança de passo); `replace` não (escolha do horário). */
  const update = (patch: Record<string, string | null>, mode: 'push' | 'replace', from?: number) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) n.delete(k)
          else n.set(k, v)
        }
        return n
      },
      { replace: mode === 'replace', preventScrollReset: mode === 'replace', state: from ? { wizardFrom: from } : loc.state },
    )
  const goToStep = (target: Step) => {
    // voltar um passo que foi aberto a partir dele mesmo = voltar no histórico (sem duplicar entradas)
    if (target === step - 1 && fromStep === target) navigate(-1)
    else update({ passo: target === 1 ? null : String(target) }, 'push', step)
  }

  // URL inconsistente (ex.: ?passo=3 sem horário, horário já ocupado) → corrige para o passo possível
  useEffect(() => {
    if (confirming.current) return
    if (params.has('passo') && requested !== step) update({ passo: step === 1 ? null : String(step) }, 'replace')
    else if (params.has('horario') && !slot && step !== 3) update({ horario: null }, 'replace')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, step, slot])

  const [f, setF] = useState<Draft>(readDraft)
  useEffect(() => writeDraft(f), [f])
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const errors = {
    firstName: f.firstName.trim() ? '' : 'Informe seu nome.',
    lastName: f.lastName.trim() ? '' : 'Informe seu sobrenome.',
    email: isEmail(f.email) ? '' : f.email.trim() ? 'Informe um e-mail válido.' : 'Informe seu e-mail corporativo.',
    phone: phoneDigits(f.phone) >= 10 ? '' : 'Informe um telefone válido com DDD.',
    company: f.company.trim() ? '' : 'Informe o nome da empresa.',
    starting: f.starting ? '' : 'Selecione uma opção.',
  }
  const valid = Object.values(errors).every((e) => !e)
  const show = (k: keyof typeof errors) => (touched[k] ? errors[k] : '')
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const blur = (k: string) => setTouched((t) => ({ ...t, [k]: true }))

  const confirm = async () => {
    if (!valid || !slot || !clients) return
    setBusy(null)
    setErr('O agendamento de parcerias ainda não está disponível. Nenhuma reserva ou envio de convite foi confirmado.')
  }

  return (
    <>
      <Progress step={step} />
      {step === 1 && (
        <Card>
          <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.2px] text-heading sm:text-[26px]">Quantos clientes ativos você atende atualmente?</h1>
          <p className="mt-1 text-[14px] text-[#3F4454]">Ativo = cliente para quem você emitiu pelo menos uma fatura nos últimos 6 meses.</p>
          <div className="mt-[25px] grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Clientes ativos">
            {CLIENT_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={clients === r}
                onClick={() => update({ clientes: slugOfRange(r), passo: '2' }, 'push', 1)}
                className={cn('h-[62px] rounded-xl border text-[16px] text-ink transition-colors hover:border-brand-blue/60 hover:bg-[#F8F8FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30', clients === r ? 'border-brand-blue bg-[#F5F5FF] text-brand-blue' : 'border-slate-200')}
              >
                {r}
              </button>
            ))}
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.2px] text-heading sm:text-[26px]">Conheça a Kloel | Parcerias</h1>
          <p className="mt-1 text-[14px] text-[#3F4454]">Escolha um horário. Vamos analisar sua configuração juntos e montar seu plano.</p>
          <div className="mt-6">
            <HostStrip
              detail={
                <>
                  <Video className="h-4 w-4 text-emerald-600" /> Google Meet · <Clock className="h-3.5 w-3.5" /> 30 min
                </>
              }
            />
          </div>
          {/* [241]: cabeçalho dos dias a 45px da faixa do anfitrião; horários de 38px com 8px entre eles */}
          <div className="mt-[31px] flex max-h-[358px] overflow-auto" data-testid="partner-slots">
            {days.map((d) => {
              const slots = partnerSlots(d, taken)
              return (
                <div key={d} className="w-[136px] shrink-0 border-r border-slate-100 px-[10px] last:border-r-0">
                  <div className="sticky top-0 z-10 bg-white pb-3 pt-1 text-center text-[12px] font-medium uppercase tracking-[0.06em] text-slate-400">{shortDate(d)}</div>
                  <div className="flex flex-col gap-2">
                    {slots.map((t) => {
                      const sel = slot?.day === d && slot.time === t
                      return (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={sel}
                          onClick={() => update({ horario: slotParam({ day: d, time: t }) }, 'replace')}
                          className={cn('h-[38px] rounded-lg border text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30', sel ? 'border-brand-blue bg-brand-blue text-white' : 'border-slate-200 text-ink hover:border-brand-blue/60')}
                        >
                          {t}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-8 flex items-center justify-between">
            <button type="button" onClick={() => goToStep(1)} className="inline-flex items-center gap-1.5 text-[15px] text-body hover:text-ink">
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
            <button type="button" disabled={!slot} onClick={() => update({ passo: '3' }, 'push', 2)} className={siteButton('brand', 'md')}>
              Continuar
            </button>
          </div>
        </Card>
      )}

      {step === 3 && slot && (
        <Card>
          <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.2px] text-heading sm:text-[26px]">Seus dados de contato</h1>
          <p className="mt-1 text-[14px] text-[#3F4454]">Só mais algumas informações e confirmamos seu horário.</p>
          <div className="mt-6">
            <HostStrip
              onChange={() => goToStep(2)}
              detail={
                <>
                  <Video className="h-4 w-4 text-emerald-600" /> {shortDate(slot.day)} às {slot.time}
                </>
              }
            />
          </div>
          {/* [242]/[243]: campos de 46px, 91px entre as linhas de rótulos, telefone em campo simples ("+55 11 91234 5678") */}
          <form
            noValidate
            className="mt-6 grid gap-x-5 gap-y-[17px] sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              setTouched({ firstName: true, lastName: true, email: true, phone: true, company: true, starting: true })
              void confirm()
            }}
          >
            <SiteField label="Nome" htmlFor="p-first" error={show('firstName')}>
              <SiteInput id="p-first" className="h-[46px] text-[15px]" autoComplete="given-name" value={f.firstName} invalid={!!show('firstName')} onBlur={() => blur('firstName')} onChange={(e) => set('firstName', e.target.value)} />
            </SiteField>
            <SiteField label="Sobrenome" htmlFor="p-last" error={show('lastName')}>
              <SiteInput id="p-last" className="h-[46px] text-[15px]" autoComplete="family-name" value={f.lastName} invalid={!!show('lastName')} onBlur={() => blur('lastName')} onChange={(e) => set('lastName', e.target.value)} />
            </SiteField>
            <SiteField label="E-mail corporativo" htmlFor="p-email" error={show('email')}>
              <SiteInput id="p-email" className="h-[46px] text-[15px]" type="email" autoComplete="email" value={f.email} invalid={!!show('email')} onBlur={() => blur('email')} onChange={(e) => set('email', e.target.value)} />
            </SiteField>
            <SiteField label="Telefone" htmlFor="p-phone" error={show('phone')}>
              <SiteInput
                id="p-phone"
                className="h-[46px] text-[15px]"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+55 11 91234 5678"
                value={f.phone}
                invalid={!!show('phone')}
                onBlur={() => blur('phone')}
                onChange={(e) => set('phone', e.target.value)}
              />
            </SiteField>
            <SiteField label="Nome da empresa" htmlFor="p-company" error={show('company')} className="sm:col-span-2">
              <SiteInput id="p-company" className="h-[46px] text-[15px]" autoComplete="organization" value={f.company} invalid={!!show('company')} onBlur={() => blur('company')} onChange={(e) => set('company', e.target.value)} />
            </SiteField>
            <SiteField label="Quantos dos seus clientes provavelmente começariam nas próximas 3 semanas?" htmlFor="p-starting" error={show('starting')} className="sm:col-span-2">
              <div className="relative">
                <select
                  id="p-starting"
                  value={f.starting}
                  aria-invalid={!!show('starting') || undefined}
                  onBlur={() => blur('starting')}
                  onChange={(e) => set('starting', e.target.value)}
                  className="h-[46px] w-full appearance-none rounded-[10px] border border-slate-200 bg-[#F9FAFB] px-4 text-[15px] text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15 aria-[invalid=true]:border-red-400"
                >
                  <option value="">Selecione</option>
                  {STARTING.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink" />
              </div>
            </SiteField>
            {err && (
              <div role="alert" data-engine-state="error" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[14px] text-red-700 sm:col-span-2">
                <XCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{err}</span>
                <button type="button" onClick={() => void confirm()} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[13px]">
                  <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
                </button>
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-3 sm:col-span-2">
              {busy && (
                <span className="flex items-center gap-2 text-[14px] text-body">
                  <Loader2 className="h-4 w-4 animate-spin" /> {busy}…
                </span>
              )}
              <button type="submit" disabled={!valid || !!busy} className={cn(siteButton('brand', 'md'), 'px-5 text-[15px]')}>
                Confirmar horário
              </button>
            </div>
          </form>
        </Card>
      )}
    </>
  )
}

function Confirmation({ onNew }: { id: string; onNew: () => void }) {
  return (
    <>
      <Progress step={4} />
      <Card>
        <h1 className="text-[24px] font-medium text-heading">Não foi possível confirmar o agendamento</h1>
        <p role="alert" data-engine-state="error" className="mt-2 text-[15px] text-body">A consulta de agendamentos de parcerias ainda não está disponível. Nenhuma reserva ou envio de convite foi confirmado.</p>
        <button type="button" onClick={onNew} className={cn(siteButton('brand', 'md'), 'mt-6')}>
          Escolher um horário
        </button>
      </Card>
    </>
  )
}
