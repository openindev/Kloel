import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Building, Building2, CircleCheck, Loader2, RotateCcw, Search, User, Users, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { services } from '@/services'
import type { GeneratedAssistant } from '@/services'
import { useOperation } from '@/hooks/useOperation'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { AuroraBackground } from '@/site/components/sections'
import { ChatWidget } from '@/site/components/chat/ChatWidget'
import { AssistantAvatar } from '@/site/components/webchat/AssistantAvatar'
import { CookieBanner } from '@/site/components/webchat/CookieBanner'
import { demoUrl, newDemoId, normalizeSite, speedFactor } from '@/site/components/webchat/site'
import { usePageTitle } from '@/site/components/usePageTitle'

type Phase = 'intro' | 'loading' | 'scanning' | 'preparing' | 'modal' | 'result' | 'error'

const CARDS_LEFT = ['Informações da empresa detectadas', 'Horários de funcionamento verificados', 'Informações de contato encontradas']
const CARDS_RIGHT = ['Informações de produtos coletadas', 'Identidade visual analisada', 'Tópicos de FAQ agrupados']
const TEAM = [
  { value: 'Só eu', icon: User },
  { value: 'De 2 a 10 pessoas', icon: Users },
  { value: 'De 11 a 50 pessoas', icon: Building },
  { value: 'Mais de 50 pessoas', icon: Building2 },
]
const LIMIT = 5

const PUBLIC_DEMO_UNAVAILABLE = 'A criação pública de assistentes ainda não está disponível. Crie sua conta para configurar e testar um assistente.'

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)))
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`
}

/* -------------------------------- Resultado -------------------------------- */

function ResultCard({ assistant, generic, ready, website, demoId }: { assistant: GeneratedAssistant; generic: boolean; ready: boolean; website?: string; demoId: string }) {
  const company = assistant.companyName
  // No public channel is provisioned here. Keep the existing chat error surface,
  // without passing this anonymous page to private services or acknowledging uploads.
  const messages = useMemo(() => [{ id: 'public-demo-unavailable', role: 'system' as const, text: PUBLIC_DEMO_UNAVAILABLE, at: new Date(), error: true }], [])
  const color = generic ? '#585DFE' : assistant.brandColor
  const items = generic ? ['Disponível 24/7', 'Responde perguntas', 'Agenda compromissos'] : ['Disponível 24/7', `Explica planos e preços da ${company}`, 'Recomenda serviços para cada necessidade']
  const avatar = (size: string) => (
    <span className={cn('block shrink-0 overflow-hidden rounded-full', size)}>
      <AssistantAvatar accent={generic ? '#22D3EE' : '#22C55E'} />
    </span>
  )

  return (
    <div className="grid w-full overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_30px_80px_-40px_rgba(15,15,22,.35)] md:min-h-[460px] md:grid-cols-2" data-testid="demo-result">
      {/* perfil */}
      <div className="relative flex flex-col md:border-r md:border-slate-200">
        <div
          className="h-[72px] shrink-0"
          style={
            generic || !ready
              ? { background: color }
              : { background: `repeating-linear-gradient(115deg, rgba(255,255,255,.08) 0 2px, transparent 2px 22px), linear-gradient(120deg, ${shade(color, -0.35)} 0%, ${shade(color, -0.1)} 60%, ${shade(color, 0.15)} 100%)` }
          }
        />
        {ready ? (
          <div className="flex flex-1 flex-col px-8 pb-8">
            <div className="-mt-14 h-20 w-20 rounded-full border-4 border-white shadow-md">{avatar('h-full w-full')}</div>
            {/* nome 108 px abaixo do topo do cartão, subtítulo 32 px abaixo (01b/01.png) */}
            <div className="mt-10 flex items-center gap-2 text-[30px] font-medium leading-9 tracking-[-0.5px] text-heading">
              {assistant.assistantName} <BadgeCheck className="h-7 w-7 fill-[#1D9BF0] text-white" />
            </div>
            <div className="mt-0.5 text-[16px] text-brand-blue">Pronta para entrar no ar em {generic ? 'seu site' : website}</div>
            <ul className="mt-6 flex flex-col gap-3 text-[15px] text-ink">
              {items.map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: color }}>
                    <CircleCheck className="h-4 w-4 text-white" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-2 md:mt-auto md:pt-8">
              <Link to="/criar-conta" className="inline-flex h-11 min-w-[160px] items-center justify-center gap-2 rounded-xl bg-heading px-5 text-[15px] text-white hover:bg-heading/90">
                Criar conta <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/agendar-demo" className="inline-flex h-11 items-center justify-center whitespace-nowrap rounded-xl bg-[#F1F2F4] px-3.5 text-[15px] text-ink hover:bg-slate-200">
                Agendar demonstração
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col px-8 pb-8">
            <div className="flex flex-1 items-center gap-2 text-[15px] text-body">
              <Loader2 className="h-4 w-4 animate-spin" /> Seu assistente está sendo preparado…
            </div>
            <div className="flex gap-2">
              <span className="inline-flex h-11 min-w-[160px] items-center justify-center gap-2 rounded-xl bg-heading px-5 text-[15px] text-white opacity-80">Criar conta <ArrowRight className="h-4 w-4" /></span>
              <span className="inline-flex h-11 items-center whitespace-nowrap rounded-xl bg-[#F1F2F4] px-3.5 text-[15px] text-ink">Agendar demonstração</span>
            </div>
          </div>
        )}
      </div>
      {/* chat */}
      <div className="h-[520px] border-t border-slate-200 md:h-auto md:border-t-0">
        {ready ? (
          <ChatWidget
            title={generic ? assistant.assistantName : assistant.assistantName}
            subtitle={generic ? 'Chatbot de IA' : `Chatbot de IA da ${company}`}
            avatar={avatar('h-11 w-11')}
            messages={messages}
            typing={false}
            onSend={() => false}
            onAttach={() => false}
            onReset={() => {}}
            onRetry={() => {}}
            canRetry={false}
            remaining={generic ? undefined : LIMIT}
            limit={generic ? undefined : LIMIT}
            brandColor={color}
            limitReached={
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-center text-[14px] text-body">
                Você usou as {LIMIT} mensagens da demonstração. <Link to="/criar-conta" className="font-medium text-brand-blue hover:underline">Crie sua conta</Link> para continuar conversando com {assistant.assistantName}.
              </div>
            }
            footerNote={generic ? <a href="/ajuda/legal/politica-de-privacidade" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">Política de Privacidade</a> : undefined}
          />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex h-[73px] items-center justify-end border-b border-slate-100 px-5" />
            <div className="flex flex-1 items-center justify-center gap-2 px-6 text-[15px] text-body">
              <Loader2 className="h-4 w-4 animate-spin" /> Seu assistente está sendo preparado…
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
              <span className="h-11 flex-1 rounded-xl border border-slate-200 px-3.5 py-3 text-[15px] text-slate-400">Escreva uma mensagem…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------- Página -------------------------------- */

export default function WebchatDemoPage() {
  usePageTitle('Sua IA de demonstração')
  const [params] = useSearchParams()
  const website = params.get('website') ? normalizeSite(params.get('website')!) : ''
  const id = params.get('id')
  const from = params.get('from')
  // Link direto sem "id" (ex.: /demo-ia?website=bemviver.example): gera um id e substitui a URL,
  // para que recarregar a página reabra a mesma demonstração salva.
  if (!id) {
    const next = new URLSearchParams(params)
    next.set('id', newDemoId())
    return <Navigate to={`/demo-ia?${next.toString()}`} replace />
  }
  return <DemoFlow key={`${id}|${website}`} website={website} id={id} from={from} />
}

function DemoFlow({ website, id, from }: { website: string; id: string; from: string | null }) {
  const navigate = useNavigate()
  // Browser snapshots are drafts, never proof that a public assistant exists.
  const [phase, setPhase] = useState<Phase>(() => (!website ? 'modal' : from === 'criar' ? 'intro' : 'loading'))
  const [assistant, setAssistant] = useState<GeneratedAssistant | null>(() => !website ? services.ai.generateGenericAssistant() : null)
  const [typedChars, setTypedChars] = useState(0)
  const [countdown, setCountdown] = useState(2)
  const resultReady = false
  // passagens completas da linha de varredura (vídeo "escrevi meu site": f_004 só a linha; f_005 cartões da esquerda; f_006 os da direita)
  const [sweeps, setSweeps] = useState(0)
  const generic = !website
  const op = useOperation(async (_onProgress, url: string): Promise<GeneratedAssistant> => {
    // Prévia pública: só lê nome, cor e descrição da página inicial (engine /api/v1/public/site-preview); nada é salvo.
    const res = await fetch(`/api/v1/public/site-preview?url=${encodeURIComponent(url)}`, { credentials: 'omit' })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body) throw new Error(body?.error?.message ?? 'Não conseguimos ler este site. Verifique o endereço e tente novamente.')
    const base = services.ai.generateGenericAssistant()
    const company = String(body.companyName || body.website || url)
    return {
      ...base,
      companyName: company,
      website: String(body.website || url),
      brandColor: body.brandColor || base.brandColor,
      assistantName: 'Maria',
      faviconLetter: company.charAt(0).toUpperCase() || 'K',
      greeting: `Olá! Eu sou a Maria, assistente virtual da ${company}. Como posso ajudar?`,
      companyInfo: String(body.description || ''),
      pagesAnalyzed: 1,
    }
  })
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms * speedFactor()))
  }, [])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const fullUrl = `https://${website}`

  // intro: digitação animada do endereço no pill central
  useEffect(() => {
    if (phase !== 'intro') return
    if (typedChars < fullUrl.length) {
      later(() => setTypedChars((c) => c + 1), 55)
    } else {
      later(() => setPhase('loading'), 500)
    }
  }, [phase, typedChars, fullUrl.length, later])

  const startScan = useCallback(async () => {
    setSweeps(0)
    setPhase('scanning')
    const r = await op.run(website)
    if (r) {
      setAssistant(r)
      setCountdown(2)
      setPhase('preparing')
    } else setPhase('error')
  }, [op, website])

  // loading: spinner no navegador simulado
  useEffect(() => {
    if (phase !== 'loading') return
    later(() => void startScan(), 1200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // preparing: "Faltam N segundos"
  useEffect(() => {
    if (phase !== 'preparing') return
    if (countdown > 0) later(() => setCountdown((c) => c - 1), 1000)
    else setPhase('modal')
  }, [phase, countdown, later])

  const chooseTeam = (_value: string) => { void startScan() }

  // 1ª passagem só com a linha; depois os 3 cartões da esquerda; a partir de "Extraindo perguntas frequentes" os da direita
  const visibleCards = phase === 'scanning' ? (sweeps === 0 ? 0 : op.progress.step >= 4 || sweeps >= 2 ? 5 : 3) : 6
  const showScan = phase === 'intro' || phase === 'loading' || phase === 'scanning' || phase === 'preparing' || phase === 'error'

  return (
    <div className="relative min-h-svh overflow-hidden bg-white font-site text-ink" data-engine-state={phase === 'error' ? 'error' : ['intro', 'loading', 'scanning', 'preparing'].includes(phase) ? 'loading' : 'ready'} aria-busy={['intro', 'loading', 'scanning', 'preparing'].includes(phase) || undefined}>
      <AuroraBackground variant="demo" />
      {/* a página não tem título visível (vídeo [77]/01b): o h1 fica só para leitores de tela e motores de busca */}
      <h1 className="sr-only">{generic ? 'Sua IA de demonstração' : `Sua IA de demonstração para ${website}`}</h1>

      {showScan && (
        <div className="relative mx-auto flex min-h-svh max-w-[1440px] flex-col items-center px-4 pb-40 pt-5">
          {/* pill com a URL */}
          <div
            className={cn('z-10 flex h-11 w-full max-w-[560px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-500 shadow-[0_8px_30px_-12px_rgba(15,15,22,.2)] transition-all duration-700', phase === 'intro' ? 'translate-y-[calc(50vh-42px)]' : 'translate-y-0')}
            data-testid="demo-url-pill"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">{phase === 'intro' ? fullUrl.slice(0, typedChars) : fullUrl}</span>
            {phase === 'intro' && <span className="ks-caret -ml-2 h-5 w-px bg-slate-700" />}
          </div>

          {phase !== 'intro' && (
            // vídeo [77] a 1460 px: cartões de etapas em x 50–340 e 1120–1410 (1360 px), navegador de 900×634 px
            <div className="relative mt-11 w-full max-w-[1360px]">
              {/* navegador simulado */}
              <div className="ks-fade-up relative mx-auto h-[300px] w-full max-w-[900px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_20px_60px_-30px_rgba(15,15,22,.3)] sm:h-[480px] lg:h-[634px]">
                <div className="flex h-11 items-center gap-2 border-b border-slate-200 px-4">
                  <span className="h-3 w-3 rounded-full bg-[#EF4444]" />
                  <span className="h-3 w-3 rounded-full bg-[#F59E0B]" />
                  <span className="h-3 w-3 rounded-full bg-[#22C55E]" />
                  <span className="ml-3 truncate text-[12px] text-slate-400">{website}</span>
                </div>
                {phase === 'loading' && (
                  <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
                )}
                {/* f_007: a linha de varredura some quando a preparação começa */}
                {phase === 'scanning' && (
                  <div className="absolute inset-x-0 bottom-0 top-11">
                    <div className="ks-scan absolute inset-x-0 h-[3px] bg-brand-blue shadow-[0_0_24px_6px_rgba(88,93,254,.55)]" onAnimationIteration={() => setSweeps((n) => n + 1)} />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(88,93,254,.04))]" />
                  </div>
                )}
                {phase === 'error' && (
                  <div className="absolute inset-0 flex items-center justify-center p-6" data-testid="demo-error">
                    <div className="ks-pop flex max-w-[440px] flex-col items-center gap-3 text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600"><XCircle className="h-6 w-6" /></span>
                      <div className="text-[20px] font-medium text-heading">Não foi possível gerar sua IA</div>
                      <p className="text-[15px] text-body">{op.error}</p>
                      <div className="mt-2 flex flex-wrap justify-center gap-2">
                        <button type="button" onClick={() => void startScan()} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-heading px-4 text-[14px] text-white hover:bg-heading/90">
                          <RotateCcw className="h-4 w-4" /> Tentar novamente
                        </button>
                        <Link to="/webchat/criar" className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-[14px] text-ink hover:bg-slate-50">Usar outro site</Link>
                        <button type="button" onClick={() => navigate(demoUrl())} className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-[14px] text-ink hover:bg-slate-50">Continuar sem site</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* vídeo [77], quadro f_007: "Preparando assistente" fica ABAIXO do navegador (556 px, 85 px depois da borda) */}
              {phase === 'preparing' && (
                <div className="relative z-20 mx-auto mt-6 flex w-full max-w-[556px] justify-center lg:absolute lg:left-1/2 lg:top-[719px] lg:mt-0 lg:-translate-x-1/2">
                  <div className="ks-pop w-full rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-[0_8px_30px_-12px_rgba(15,15,22,.2)]" data-testid="demo-preparing">
                    <div className="text-[17px] text-heading">Preparando assistente</div>
                    <div className="text-[15px] text-body">{countdown <= 1 ? 'Falta 1 segundo' : `Faltam ${countdown} segundos`}</div>
                  </div>
                </div>
              )}

              {/* cartões de etapas */}
              {(phase === 'scanning' || phase === 'preparing') && (
                <>
                  <div className="mt-6 flex flex-col gap-3 lg:absolute lg:left-0 lg:top-[190px] lg:mt-0 lg:w-[290px] lg:gap-8">
                    {CARDS_LEFT.map((c, i) => i < visibleCards && <StatusCard key={c} text={c} />)}
                  </div>
                  <div className="mt-3 flex flex-col gap-3 lg:absolute lg:right-0 lg:top-[190px] lg:mt-0 lg:w-[290px] lg:gap-8">
                    {CARDS_RIGHT.map((c, i) => i + 3 < visibleCards && <StatusCard key={c} text={c} />)}
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      )}

      {(phase === 'modal' || phase === 'result') && assistant && (
        // 02b/01b/01.png a 1460 px: cartão de 850 px, 277 px abaixo do topo, logo 45 px acima do cartão
        <div className="relative mx-auto flex min-h-svh max-w-[882px] flex-col items-center justify-center px-4 py-12 sm:pt-[122px]">
          <Link to="/" aria-label="kloel.ai — início"><KloelLogo className="text-[26px]" /></Link>
          <div className="mt-8 w-full sm:mt-[25px]">
            <ResultCard key={resultReady ? 'ready' : 'loading'} assistant={assistant} generic={generic} ready={resultReady} website={website} demoId={id} />
          </div>
        </div>
      )}

      {phase === 'modal' && (
        // o banner de cookies (z-50) continua por cima e utilizável; o modal reserva a altura dele na base (--cookie-banner-h),
        // então nenhuma opção fica coberta (a 390px o banner cobria "De 11 a 50" e "Mais de 50 pessoas")
        <div
          className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-slate-900/30 px-4 pt-6"
          style={{ paddingBottom: 'calc(var(--cookie-banner-h, 0px) + 24px)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-size-title"
          data-testid="demo-team-modal"
        >
          <div className="ks-pop my-auto w-full max-w-[576px] rounded-2xl bg-white px-6 py-8 text-center shadow-2xl sm:px-8">
            <div className="text-[14px] text-body">Último passo:</div>
            <h2 id="team-size-title" className="mt-2 text-[20px] font-medium tracking-[-0.2px] text-heading sm:text-[22px]">Quantas pessoas fazem parte da sua equipe?</h2>
            <div className="mt-7 grid grid-cols-2 gap-3">
              {TEAM.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => chooseTeam(t.value)}
                  className="flex h-[98px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 px-2 text-[15px] text-heading transition-colors hover:border-slate-900 hover:bg-slate-50 focus-visible:border-slate-900 focus-visible:outline-none"
                >
                  <t.icon className="h-5 w-5 text-slate-700" />
                  {t.value}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <CookieBanner />
    </div>
  )
}

function StatusCard({ text }: { text: string }) {
  return (
    <div className="ks-pop flex min-h-[64px] items-center gap-3 rounded-xl border border-white bg-white/95 px-5 py-3 text-[15px] font-medium leading-5 text-heading shadow-[0_10px_30px_-12px_rgba(15,15,22,.25)]">
      <span className="h-2 w-2 shrink-0 rounded-full bg-brand-blue" />
      {text}
    </div>
  )
}
