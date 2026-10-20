import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, ChevronDown, Loader2, Phone, PhoneCall, RotateCcw, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { services } from '@/services'
import { useOperation } from '@/hooks/useOperation'
import { useStore } from '@/data/store'
import { COUNTRIES } from '@/components/app/PhoneInput'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const STEPS = ['Validando número', 'Preparando assistente', 'Iniciando a ligação']

/**
 * Regras de número por país (dígitos do número nacional, sem o DDI). `trunk`: o "0" inicial de discagem nacional é ignorado.
 * O exemplo aparece no placeholder (fora do Brasil) e na mensagem de erro.
 */
const PHONE_RULES: Record<string, { min: number; max: number; example: string; trunk?: boolean }> = {
  br: { min: 10, max: 11, example: '11 90000-0123' },
  pt: { min: 9, max: 9, example: '912 345 678' },
  us: { min: 10, max: 10, example: '201 555 0123' },
  ar: { min: 10, max: 11, example: '11 2345-6789', trunk: true },
  mx: { min: 10, max: 10, example: '55 1234 5678' },
  es: { min: 9, max: 9, example: '612 34 56 78' },
  de: { min: 10, max: 11, example: '151 23456789', trunk: true },
  gb: { min: 10, max: 10, example: '7400 123456', trunk: true },
}

/** Valida o número para o país escolhido; devolve a mensagem de erro (PT-BR) ou null. */
function callbackPhoneError(countryCode: string, countryName: string, phone: string) {
  const rule = PHONE_RULES[countryCode] ?? { min: 6, max: 14, example: '' }
  let digits = phone.replace(/\D/g, '')
  if (rule.trunk && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 0) return 'Digite o número de telefone para receber a ligação.'
  if (digits.length >= rule.min && digits.length <= rule.max) return null
  if (countryCode === 'br') return 'Digite um número de telefone válido, com DDD (ex.: 11 90000-0123).'
  const len = rule.min === rule.max ? `${rule.min} dígitos` : `${rule.min} a ${rule.max} dígitos`
  return `Digite um número válido de ${countryName}: ${len}${rule.example ? ` (ex.: ${rule.example})` : ''}.`
}

/**
 * Widget do hero "Receber ligação da IA agora" (home e soluções).
 * Fluxo completo SIMULADO via services.telephony.requestDemoCallback: validar → processar (etapas) → sucesso | erro → tentar novamente.
 * Em sucesso registra um Lead (kind 'callback') no store. Números terminados em 0000 falham (regra determinística da simulação).
 * props: source (rótulo da página, salvo no lead), demoLink? (mostra "Agendar uma demo ↗" abaixo; padrão true),
 *        demoLabel?, demoTo? (destino do link; padrão /agendar-demo), demoArrow? (seta ↗ ao lado; padrão true — as soluções
 *        não têm seta na referência), className
 */
/** Contexto enviado ao assistente que liga: página e origem do pedido, e o nome do usuário logado quando houver (o widget, como na Fonio, só pede o telefone). */
function callbackMeta(source: string) {
  const page = typeof window !== 'undefined' ? window.location.href : ''
  const title = typeof document !== 'undefined' ? document.title : ''
  const { session, users } = useStore.getState().db as unknown as { session: { userId?: string }; users?: { id: string; name?: string }[] }
  const name = session?.userId ? users?.find((u) => u.id === session.userId)?.name : undefined
  return {
    ...(name ? { name } : {}),
    notes: `Lead pediu uma ligação de demonstração pelo site da Kloel (seção: ${source}).`,
    context: `Página: ${title} — ${page}. Origem: ${source}. Idioma: pt-BR.`,
  }
}

export function CallbackWidget({
  source = 'home', demoLink = true, demoLabel = 'Agendar uma demo', demoTo = '/agendar-demo', demoArrow = true, className, linkClassName,
}: {
  source?: string; demoLink?: boolean; demoLabel?: string; demoTo?: string; demoArrow?: boolean; className?: string
  /** classes extras do link "Agendar uma demo" (ex.: a home usa 16px de distância do cartão, medidos em 01.png) */
  linkClassName?: string
}) {
  const [country, setCountry] = useState(COUNTRIES[0]!)
  const [phone, setPhone] = useState('')
  const [touched, setTouched] = useState(false)
  /** número efetivamente enviado à operação (o cartão de resultado mostra este, não o campo editável) */
  const [sentNumber, setSentNumber] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickedCountry = useRef(false)
  const insert = useStore((s) => s.insert)
  const op = useOperation((onProgress, full: string) => services.telephony.requestDemoCallback(full, onProgress, callbackMeta(source)))

  const errorMsg = callbackPhoneError(country.code, country.name, phone)
  const invalid = errorMsg !== null
  const full = `${country.dial} ${phone.trim()}`
  const rule = PHONE_RULES[country.code]

  /** Executa a ligação simulada e, em caso de sucesso (inclusive numa nova tentativa), registra o Lead. */
  const attempt = async (number: string) => {
    setSentNumber(number)
    const r = await op.run(number)
    if (r) insert('leads', { kind: 'callback', payload: { phone: number, reference: r.reference, source, simulated: services.simulated ? 'true' : 'false' } })
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (invalid) return
    await attempt(full)
  }

  const running = op.status === 'running'
  const stepIndex = Math.min(op.progress.step, STEPS.length - 1)

  return (
    <div className={cn('flex w-full max-w-[400px] flex-col items-center', className)}>
      {/* cartão observado (referência 01.png a 1460px, medido por pixels): 292px de largura, padding 8px, campo de 48px,
          8px até o botão de 46px (rótulo de 15px), bandeira de 20×15px */}
      <form onSubmit={submit} noValidate className="relative w-full max-w-[300px] overflow-hidden rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_8px_30px_-10px_rgba(15,15,22,.16)] sm:max-w-[292px]">
        <div className={cn('flex h-12 items-center rounded-[14px] bg-[#F5F6FA] pl-1.5 pr-2 ring-brand-blue/40 has-[input:focus]:ring-2', touched && invalid && 'ring-2 ring-red-400/60')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" disabled={running} className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-1 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40" aria-label={`País: ${country.name}`}>
                <span className={cn('fi rounded-[2px] text-[15px]', `fi-${country.code}`)} />
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56 font-site"
              onCloseAutoFocus={(e) => {
                // depois de escolher o país, o foco vai para o número (próximo passo), e não de volta à bandeira
                if (!pickedCountry.current) return
                pickedCountry.current = false
                e.preventDefault()
                inputRef.current?.focus()
              }}
            >
              {COUNTRIES.map((c) => (
                <DropdownMenuItem
                  key={c.code}
                  onSelect={() => {
                    pickedCountry.current = true
                    setCountry(c)
                  }}
                >
                  <span className={cn('fi rounded-[2px]', `fi-${c.code}`)} />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-muted-foreground">{c.dial}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            disabled={running}
            ref={inputRef}
            onChange={(e) => {
              setPhone(e.target.value)
              // editar depois de um resultado volta ao formulário: o cartão nunca descreve um número diferente do enviado
              if (op.status === 'error' || op.status === 'success') op.reset()
            }}
            onBlur={() => phone && setTouched(true)}
            placeholder={country.code === 'br' || !rule ? 'Digite o número de telefone' : `Ex.: ${rule.example}`}
            aria-label="Número de telefone"
            aria-invalid={touched && invalid ? true : undefined}
            className="h-full min-w-0 flex-1 bg-transparent pl-1 text-[16px] text-ink outline-none placeholder:text-[#9CA3AF] disabled:text-slate-400"
          />
        </div>
        <button
          type="submit"
          disabled={running}
          className="mt-2 flex h-[46px] w-full items-center justify-center gap-2.5 whitespace-nowrap rounded-xl bg-brand-blue px-3 text-[15px] text-white transition-colors hover:bg-[#4a4fe6] disabled:bg-[#8f93ff]"
        >
          {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Phone className="h-5 w-5 fill-white" />}
          {running ? 'Ligando…' : 'Receber ligação da IA agora'}
        </button>
        <span aria-hidden className="ks-beam absolute bottom-0 h-[2px] w-[30%] rounded-full bg-[linear-gradient(90deg,transparent,#585DFE,transparent)] blur-[0.5px]" />
        {running && (
          <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full bg-brand-blue transition-[width] duration-500" style={{ width: `${Math.max(8, op.progress.percent)}%` }} />
          </span>
        )}
      </form>

      {touched && invalid && op.status !== 'running' && (
        <p role="alert" className="mt-2 text-[14px] text-red-600">
          {errorMsg}
        </p>
      )}

      {op.status !== 'idle' && (
        <div className={cn('ks-fade-up mt-3 w-full rounded-2xl border bg-white p-4 text-left text-[14px] shadow-sm', op.status === 'error' ? 'border-red-200' : 'border-slate-200')} aria-live="polite">
          {op.status === 'running' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-heading">Ligação da IA</span>
              </div>
              {STEPS.map((s, i) => (
                <div key={s} className={cn('flex items-center gap-2', i > stepIndex ? 'text-slate-400' : 'text-ink')}>
                  {i < stepIndex ? <Check className="h-4 w-4 text-emerald-600" /> : i === stepIndex ? <Loader2 className="h-4 w-4 animate-spin text-brand-blue" /> : <span className="h-4 w-4 rounded-full border border-slate-300" />}
                  {s}
                </div>
              ))}
            </div>
          )}
          {op.status === 'success' && op.result && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <PhoneCall className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-heading">
                    Ligação solicitada para <span data-testid="callback-sent-number">{sentNumber}</span>
                  </div>
                  <p className="mt-1 text-body">
                    Em instantes a IA da Kloel liga para você. Protocolo <b className="font-medium text-ink">{op.result.reference}</b>.
                  </p>
                </div>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3 text-[13px] leading-5 text-[#3F4556]">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">O que a IA diria</div>
                “Olá! Aqui é a assistente virtual da Kloel. Posso tirar dúvidas, agendar um horário ou transferir para a equipe. Como posso ajudar?”
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => { op.reset(); setPhone(''); setTouched(false); setSentNumber(null); inputRef.current?.focus() }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[14px] text-ink hover:bg-slate-50">
                  <RotateCcw className="h-3.5 w-3.5" /> Receber outra ligação
                </button>
                <Link to="/criar-conta" className="inline-flex h-9 items-center rounded-lg bg-heading px-3 text-[14px] text-white hover:bg-heading/90">
                  Criar minha IA
                </Link>
              </div>
            </div>
          )}
          {op.status === 'error' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 text-red-700">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{op.error}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void attempt(sentNumber ?? full)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-heading px-3 text-[14px] text-white hover:bg-heading/90">
                  <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
                </button>
                <button type="button" onClick={() => { op.reset(); setPhone(''); setTouched(false); setSentNumber(null); requestAnimationFrame(() => inputRef.current?.focus()) }} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[14px] text-ink hover:bg-slate-50">
                  Alterar número
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {demoLink && (
        <Link to={demoTo} className={cn('mt-5 inline-flex items-center gap-1.5 text-[16px] font-medium text-[#3F4556] transition-colors hover:text-ink', linkClassName)}>
          {demoLabel} {demoArrow && <ArrowUpRight className="h-4 w-4" />}
        </Link>
      )}
    </div>
  )
}
