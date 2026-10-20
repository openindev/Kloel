import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer, XAxis } from 'recharts'
import {
  ArrowLeft, BookOpen, Calendar, Camera, Check, ChevronDown, Clock, CreditCard, Handshake, Home, KeyRound, Menu, Phone, PhoneCall, Quote, Sparkles, Users, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { Stars, InitialsAvatar } from '@/site/components/sections'

/*
 * Peças da landing de campanha (/lp). Medidas e cores conferidas nas capturas "1. Externo/Landing Page/01–11" a 1470 px:
 * texto #0F0F16, secundário #6B6D80, bordas #E1E3F3, marca #585DFE, títulos em Roboto bold com tracking −0,025 em.
 */

export const LP_NAV = [
  { id: 'como-funciona', label: 'Como funciona' },
  { id: 'planos', label: 'Planos' },
  { id: 'depoimentos', label: 'Depoimentos' },
  { id: 'duvidas', label: 'Dúvidas' },
]

/** Rola até a seção e grava a âncora no endereço (replaceState: recarregar mantém a seção; não polui o histórico). */
export function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  try {
    window.history.replaceState(window.history.state, '', id === 'topo' ? window.location.pathname + window.location.search : `${window.location.pathname}${window.location.search}#${id}`)
  } catch {
    /* ignora */
  }
}

/**
 * Header flutuante da landing ([423]): âncoras para as seções. Fica fixo e visível durante toda a rolagem — OBSERVADO em
 * [424]–[431] e [433] (spec 01: "o header flutuante continua fixo no topo"); a única captura sem ele ([432]) é da janela do navegador.
 */
export function LpHeader() {
  const [open, setOpen] = useState(false)
  const go = (id: string) => {
    setOpen(false)
    scrollToId(id)
  }
  return (
    <div className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4" data-testid="lp-header">
      <header className="mx-auto max-w-[1022px] rounded-xl border border-[#E1E3F3] bg-white/95 shadow-[0_6px_24px_-14px_rgba(15,15,22,.18)] backdrop-blur">
        <div className="flex h-[52px] items-center px-4 sm:px-[17px]">
          <button type="button" onClick={() => go('topo')} aria-label="kloel.ai — voltar ao topo"><KloelLogo className="text-[24px] sm:text-[26px]" /></button>
          <nav className="ml-9 hidden items-center gap-[30px] md:flex" aria-label="Seções da página">
            {LP_NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={(e) => { e.preventDefault(); go(n.id) }} className="text-[15px] tracking-[-0.01em] text-[#706F73] transition-colors hover:text-ink">{n.label}</a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a href="#agendar" onClick={(e) => { e.preventDefault(); go('agendar') }} className="inline-flex h-8 items-center rounded-lg bg-brand-blue px-[11px] text-[16px] font-medium tracking-[-0.03em] text-white hover:bg-[#4a4fe6]">Agendar demo</a>
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg md:hidden" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Fechar menu' : 'Abrir menu'} aria-expanded={open}>
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="flex flex-col border-t border-[#E1E3F3] px-4 py-2 md:hidden" aria-label="Seções da página">
            {LP_NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={(e) => { e.preventDefault(); go(n.id) }} className="py-2.5 text-[16px] text-ink">{n.label}</a>
            ))}
          </nav>
        )}
      </header>
    </div>
  )
}

/** Footer mínimo da landing ([433]). */
export function LpFooter() {
  const link = 'text-[16px] tracking-[-0.01em] text-[#6B6D80] hover:text-ink'
  return (
    <footer className="mx-auto max-w-[1066px] px-5 pb-10 pt-10 sm:pt-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <button type="button" onClick={() => scrollToId('topo')} aria-label="kloel.ai — voltar ao topo"><KloelLogo className="text-[26px]" /></button>
          <p className="mt-2 text-[16px] tracking-[-0.01em] text-[#6B6D80]">O assistente de IA de voz para PMEs.</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Rodapé">
          <a href="#como-funciona" onClick={(e) => { e.preventDefault(); scrollToId('como-funciona') }} className={link}>Como funciona</a>
          <a href="#planos" onClick={(e) => { e.preventDefault(); scrollToId('planos') }} className={link}>Planos</a>
          <a href="#agendar" onClick={(e) => { e.preventDefault(); scrollToId('agendar') }} className={link}>Agendar demo</a>
          <a href="/ajuda/legal/politica-de-privacidade" target="_blank" rel="noreferrer" className={link}>Privacidade</a>
          <a href="/ajuda/legal/termos-e-condicoes" target="_blank" rel="noreferrer" className={link}>Termos</a>
        </nav>
      </div>
      <div className="mt-6 flex flex-col gap-2 border-t border-[#E1E3F3] pt-6 text-[14px] text-[#6B6D80] sm:flex-row sm:justify-between">
        <span>Feito com 🤍 para <span className="fi fi-br rounded-[2px]" role="img" aria-label="Brasil" /></span>
        <span>© {new Date().getFullYear()} kloel.ai. Todos os direitos reservados. · <Link to="/" className="hover:text-ink">Site institucional</Link></span>
      </div>
    </footer>
  )
}

/* ------------------------------ Mock do painel ------------------------------ */

const CHART = [12, 9, 14, 22, 18, 9, 7, 16, 24, 21, 13, 11, 19, 27, 23, 15, 10, 14, 20, 26, 18, 12, 9, 17, 22, 16, 19].map((v, i) => ({ d: `${i + 3} de out.`, v }))

/** Painel Kloel desenhado (substitui o screenshot da app Fonio em [423]/[424]). Dados ilustrativos. */
export function DashboardMock() {
  const groups: { label?: string; items: { icon: React.ComponentType<{ className?: string }>; label: string; active?: boolean; muted?: boolean }[] }[] = [
    { items: [{ icon: Home, label: 'Início', active: true }] },
    { label: 'Conteúdos', items: [{ icon: Users, label: 'Assistentes' }, { icon: BookOpen, label: 'Base de conhecimento' }, { icon: Phone, label: 'Números de telefone' }, { icon: PhoneCall, label: 'Histórico de ligações' }, { icon: Calendar, label: 'Agendador' }] },
    { label: 'Parceiro', items: [{ icon: Handshake, label: 'Portal de parceiros' }] },
    { label: 'Admin', items: [{ icon: CreditCard, label: 'Assinatura e faturas' }, { icon: KeyRound, label: 'Chaves de API', muted: true }] },
  ]
  const usage = [
    { l: 'Minutos de ligação', v: '372 / 1.000 (37%)', p: 37, c: 'bg-[#0F0F16]' },
    { l: 'Minutos outbound', v: '0 / 0 (0%)', p: 0, c: 'bg-[#0F0F16]' },
    { l: 'SMS', v: '0 / 0 (0%)', p: 0, c: 'bg-[#0F0F16]' },
    { l: 'Números de telefone (cobrados mensalmente)', v: '1 / 1 (100%)', p: 100, c: 'bg-red-500' },
    { l: 'Usuários', v: '1 / 1 (100%)', p: 100, c: 'bg-red-500' },
    { l: 'Conexões de workspace', v: '0 / 1 (0%)', p: 0, c: 'bg-[#0F0F16]' },
  ]
  return (
    <div className="relative mx-auto max-w-[1104px] overflow-hidden rounded-2xl border border-[#E1E3F3] bg-white font-sans shadow-[0_30px_80px_-40px_rgba(15,15,22,.35)]" aria-label="Painel da Kloel" role="img">
      <div className="flex [mask-image:linear-gradient(180deg,rgba(0,0,0,.3)_0%,#000_10%)]">
        <aside className="hidden w-[218px] shrink-0 flex-col gap-1 border-r border-slate-100 p-3 text-[13px] sm:flex">
          <KloelLogo className="mb-4 ml-2 mt-1 text-[20px] opacity-50" />
          {groups.map((g, i) => (
            <div key={i} className="mb-2">
              {g.label && <div className="px-2 pb-1 pt-2 text-[12px] text-slate-500">{g.label}</div>}
              {g.items.map((it) => (
                <div key={it.label} className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-slate-800', it.active && 'bg-slate-100 font-medium', it.muted && 'text-slate-300')}>
                  <it.icon className="h-4 w-4" /> {it.label}
                </div>
              ))}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1">
          <div className="flex h-10 items-center justify-between border-b border-slate-100 px-4 text-[12px] text-slate-300">
            <span>Início</span>
            <span className="flex items-center gap-2"><span className="h-5 w-32 rounded bg-slate-100" /><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[9px] text-slate-500">CB</span></span>
          </div>
          <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div className="text-[24px] font-semibold text-slate-900">Início</div>
              <span className="flex items-center gap-6 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] text-slate-700">Outubro 2026 <ChevronDown className="h-3.5 w-3.5" /></span>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex border-b border-slate-100">
                  <div className="flex-1 p-4">
                    <div className="text-[17px] font-semibold text-slate-900">Histórico de ligações</div>
                    <div className="text-[12px] text-slate-500">outubro de 2026</div>
                  </div>
                  <div className="border-l border-slate-100 px-6 py-3">
                    <div className="text-[11px] text-slate-500">Ligações</div>
                    <div className="text-[26px] font-semibold text-slate-900">262</div>
                  </div>
                </div>
                <div className="h-[190px] px-2 pt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={CHART} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="lpArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6d8cf5" stopOpacity={0.55} />
                          <stop offset="100%" stopColor="#6d8cf5" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={4} padding={{ left: 18, right: 18 }} />
                      <Area type="monotone" dataKey="v" stroke="#4f7cf0" strokeWidth={2} fill="url(#lpArea)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-[17px] font-semibold text-slate-900">Uso</div>
                <div className="text-[12px] text-slate-500">O uso é reiniciado em <b className="font-medium text-slate-700">2 de nov. de 2026</b></div>
                <div className="mt-3 flex flex-col gap-3">
                  {usage.map((u) => (
                    <div key={u.l}>
                      <div className="flex justify-between gap-3 text-[12px]"><span className="text-slate-800">{u.l}</span><span className="shrink-0 text-slate-500">{u.v}</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className={cn('h-full rounded-full', u.c)} style={{ width: `${u.p}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ Contador ------------------------------ */

const DEADLINE_KEY = 'kloel-site:lp-offer-deadline'
const WINDOW_MS = 24 * 3600 * 1000 - 8 * 60 * 1000

function newDeadline() {
  const d = Date.now() + WINDOW_MS
  try {
    window.localStorage.setItem(DEADLINE_KEY, String(d))
  } catch {
    /* armazenamento indisponível: o contador funciona só nesta visita */
  }
  return d
}

/** Contador regressivo da oferta (~24 h por visitante, persistido no navegador; reinicia sozinho ao expirar — INFERIDO). */
export function useOfferCountdown() {
  const [now, setNow] = useState(() => Date.now())
  const [deadline, setDeadline] = useState(() => {
    try {
      const v = Number(window.localStorage.getItem(DEADLINE_KEY))
      if (v && v > Date.now()) return v
    } catch {
      /* ignora */
    }
    return newDeadline()
  })
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    if (now >= deadline) setDeadline(newDeadline())
  }, [now, deadline])
  const left = Math.max(0, deadline - now)
  const h = Math.floor(left / 3600000)
  const m = Math.floor((left % 3600000) / 60000)
  const s = Math.floor((left % 60000) / 1000)
  return { h, m, s, expired: left === 0 }
}

/** Faixa "Oferta de lançamento" com contador ([426]/[427]). */
export function OfferBar() {
  const { h, m, s } = useOfferCountdown()
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#0F0F16] [background-image:radial-gradient(rgba(255,255,255,.07)_1px,transparent_1px)] [background-size:14px_14px]">
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-6 sm:py-[12px]">
        <span className="w-fit rounded-md bg-brand-blue px-2.5 py-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-white">Oferta de lançamento</span>
        <span className="text-[16px] tracking-[-0.01em] text-white sm:text-[17px]"><b className="font-semibold">30% de desconto por 3 meses</b> <span className="text-[#A1A1AA]">em qualquer plano</span></span>
        <span className="flex items-center gap-2 font-mono text-[15px] tabular-nums text-[#E5484D] sm:ml-auto" role="timer" aria-label={`Oferta termina em ${h} horas, ${m} minutos e ${s} segundos`} data-testid="lp-countdown">
          <Clock className="h-4 w-4" /> {p(h)} : {p(m)} : {p(s)}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------ Planos ------------------------------ */

interface LpPlan { name: string; tagline: string; old: number; price: number; popular?: boolean; included: { t: string; extra?: string; neg?: boolean }[]; features: { t: string; chip?: string }[] }

export const LP_PLANS: LpPlan[] = [
  {
    name: 'Solo', tagline: 'Ideal para 1-20 ligações/dia', old: 719, price: 503,
    included: [{ t: '1000 minutos', extra: '+R$0,90/min extra' }, { t: 'Sem chamadas simultâneas', neg: true }, { t: '1 número de tel.', extra: '+R$39/mês por extra' }, { t: '1 calendário integrado' }, { t: '∞ Assistentes' }, { t: '1 Usuário' }],
    features: [{ t: '20+ vozes' }, { t: '25+ idiomas' }, { t: 'Acesso à Academia Onboarding' }],
  },
  {
    name: 'Team', tagline: 'Ideal para 20-100 ligações/dia', old: 2159, price: 1511, popular: true,
    included: [{ t: '3000 minutos', extra: '+R$0,72/min extra' }, { t: '3 chamadas simultâneas' }, { t: '3 números de tel.', extra: '+R$39/mês por extra' }, { t: '3 calendários integrados' }, { t: '∞ Assistentes' }, { t: '∞ Usuários' }],
    features: [{ t: 'Tudo do plano', chip: 'Solo' }, { t: 'Conexão SIP própria' }, { t: 'Ligações ativas e campanhas' }],
  },
  {
    name: 'Scale', tagline: 'Ideal para + de 100 ligações/dia', old: 3599, price: 2519,
    included: [{ t: 'A partir de 5000 minutos' }, { t: 'Chamadas simultâneas ilimitadas' }, { t: 'Números de tel. sob medida' }, { t: 'Qtd. de calendários customizado' }, { t: '∞ Assistentes' }, { t: '∞ Usuários' }],
    features: [{ t: 'Tudo do plano', chip: 'Team' }, { t: 'Voz personalizada' }, { t: 'Sem retenção de dados' }, { t: 'SLA personalizado' }],
  },
]

/**
 * Cartões de plano ([427]): "Quero o …" não compra — leva ao agendamento (nota [440]).
 * Medidas conferidas pixel a pixel em "Landing Page/05.png" e "06.png" (2× de 1470 px): nome 18 px semibold, faixa 14 px,
 * selo 12 px com tracking 0,06 em, preço 36 px bold (+ antigo 16 px riscado, "R$" 16 px bold, "/ mês" 14 px), botão 40 px
 * com rótulo 14 px medium, rótulos de grupo 12 px com tracking 0,1 em, itens 14 px a cada 27 px, observações 12 px na mesma linha,
 * cartão de ~594 px de altura; o Popular é o mesmo cartão em escala 1,02 (308 → 314 px de largura na referência).
 */
export function LpPricing({ onChoose, chosen }: { onChoose: (plan: string) => void; chosen?: string | null }) {
  const group = 'text-[12px] font-semibold uppercase leading-4 tracking-[0.1em] text-ink'
  const item = 'flex items-start gap-2 text-[14px] leading-[21px] text-ink'
  const icon = 'mt-[3px] h-4 w-4 shrink-0'
  return (
    <div className="grid gap-5 lg:grid-cols-3 lg:items-start lg:gap-[26px]">
      {LP_PLANS.map((p) => (
        <article key={p.name} className={cn('relative flex flex-col rounded-2xl border bg-white px-6 pb-[21px] pt-[25px]', p.popular ? 'border-brand-blue shadow-[0_18px_44px_-24px_rgba(88,93,254,.55)] lg:z-[1] lg:scale-[1.02]' : 'border-[#E1E3F3]')} data-testid={`lp-plan-${p.name}`}>
          {p.popular && <span className="absolute -top-[11px] left-1/2 -translate-x-1/2 rounded-full bg-brand-blue px-2.5 py-0.5 text-[13px] font-medium leading-[18px] text-white">Popular</span>}
          <h3 className="text-[18px] font-semibold leading-[26px] text-ink">{p.name}</h3>
          <p className="mt-[5px] text-[14px] leading-5 text-[#6B6D80]">{p.tagline}</p>
          <div className="mt-[27px] flex items-center gap-2 text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-brand-blue"><Sparkles className="h-[13px] w-[13px]" /> 30% de desconto por 3 meses</div>
          <div className="mt-[13px] flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[16px] text-[#6B6D80] line-through">{p.old.toLocaleString('pt-BR')}</span>
            <span className="text-[36px] font-bold leading-10 text-ink">{p.price.toLocaleString('pt-BR')}</span>
            <span className="text-[16px] font-bold text-ink">R$</span>
            <span className="text-[14px] text-[#6B6D80]">/ mês</span>
          </div>
          <button
            type="button"
            onClick={() => onChoose(p.name)}
            aria-pressed={chosen === p.name}
            className={cn('mt-[25px] h-10 rounded-md text-[14px] font-medium text-white transition-colors', p.popular ? 'bg-brand-blue hover:bg-[#4a4fe6]' : 'bg-ink hover:bg-ink/90')}
          >
            Quero o {p.name}
          </button>
          <div className={cn('mt-[25px]', group)}>Incluso</div>
          <ul className="mt-[11px] flex flex-col gap-1.5">
            {p.included.map((i) => (
              <li key={i.t} className={item}>
                {i.neg ? <X className={cn(icon, 'text-[#6B6D80]')} /> : <Check className={cn(icon, 'text-brand-blue')} />}
                <span className={cn(i.neg && 'text-[#6B6D80] line-through')}>{i.t} {i.extra && <span className="whitespace-nowrap text-[12px] text-[#6B6D80]">{i.extra}</span>}</span>
              </li>
            ))}
          </ul>
          <div className={cn('mt-[23px]', group)}>Funcionalidades</div>
          <ul className="mt-[11px] flex flex-col gap-1.5">
            {p.features.map((f) => (
              <li key={f.t} className={item}>
                {f.chip ? <ArrowLeft className={cn(icon, 'text-brand-blue')} /> : <Check className={cn(icon, 'text-brand-blue')} />}
                <span>{f.t} {f.chip && <b className="ml-1 font-semibold">{f.chip}</b>}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}

/* ------------------------------ Depoimentos ------------------------------ */

type ChatT = { kind: 'chat'; name: string; company: string; msgs: { t: string; time: string; out?: boolean }[] }
type QuoteT = { kind: 'quote'; text: string; metric?: string; name: string; role: string; segment: string }

const ROW1: (ChatT | QuoteT)[] = [
  { kind: 'quote', text: 'Recebíamos mais de cem ligações por dia. A Kloel resolve as dúvidas simples e a equipe foca no que importa.', name: 'Bianca F.', role: 'Gestora', segment: 'Clínica de saúde' },
  { kind: 'chat', name: 'Juliana Costa', company: 'Imobiliária Horizonte', msgs: [{ t: 'Honestamente não esperava muito de um agente de IA.', time: '14:22' }, { t: 'Mas nossos agendamentos aumentaram bastante em poucas semanas 🤯', time: '14:22' }, { t: 'Que incrível ouvir isso, Juliana!', time: '14:24', out: true }, { t: "Minha equipe tá chamando de 'a melhor contratação do ano'", time: '14:25' }] },
  { kind: 'quote', text: 'A Kloel atende em segundos, mesmo às 23h. Paramos de perder leads para a concorrência.', metric: '+38% test drives agendados', name: 'Rafael Moura', role: 'Auto Center Rota Sul', segment: 'Concessionária' },
  { kind: 'chat', name: 'Paula Souza', company: 'Estética Bem-Estar', msgs: [{ t: 'Pessoal, preciso compartilhar 👇', time: '09:12' }, { t: 'A Kloel fechou 7 agendamentos enquanto eu dormia', time: '09:12' }, { t: 'SETE. Em uma noite.', time: '09:13' }] },
  { kind: 'quote', text: 'Se paga logo no primeiro mês. Atendimento que antes ficava sem resposta virou venda.', metric: '11x retorno no trimestre', name: 'Eduardo P.', role: 'Grupo Norte Veículos', segment: 'Concessionária' },
]
const ROW2: QuoteT[] = [
  { kind: 'quote', text: 'O melhor é poder escolher a voz de acordo com o público: mais simpática ou mais formal.', name: 'Marina L.', role: 'Diretora', segment: 'Rede de clínicas' },
  { kind: 'quote', text: 'A Kloel alivia muito a carga da nossa equipe. A IA responde dúvidas comuns sobre horários e serviços, as linhas ficam livres para o que é urgente e a gente volta a cuidar dos pacientes.', name: 'Helena R.', role: 'Recepcionista', segment: 'Clínica médica' },
  { kind: 'quote', text: 'Nossos hóspedes costumam ligar à noite, quando a equipe é menor. Agora estamos disponíveis 24/7 e não perdemos mais reservas.', name: 'Lourenço S.', role: 'Gerente geral', segment: 'Hotelaria' },
  { kind: 'quote', text: 'Recomendamos a Kloel para as empresas do nosso portfólio. A configuração é simples e o resultado aparece rápido.', name: 'Miguel R.', role: 'Sócio', segment: 'Fundo de investimento' },
  { kind: 'quote', text: 'Antes, metade das ligações caía na caixa postal. Hoje cada chamada vira um registro com resumo.', name: 'Ana V.', role: 'Coordenadora', segment: 'Advocacia' },
]

/** Aspas de abertura (“), como na referência — o ícone Quote do lucide é a aspa de fechamento. */
export function OpenQuote({ className }: { className?: string }) {
  return <Quote className={cn('rotate-180 fill-[#C9CBFB] text-[#C9CBFB]', className)} aria-hidden />
}

function ChatCard({ c }: { c: ChatT }) {
  return (
    <div className="flex w-[330px] shrink-0 flex-col self-stretch overflow-hidden rounded-2xl border border-[#E1E3F3] bg-white sm:w-[382px]">
      <div className="flex items-center gap-3 bg-[#0F0F16] px-4 py-3 text-white">
        <InitialsAvatar name={c.name} className="h-10 w-10 text-[13px]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-medium">{c.name}</div>
          <div className="flex items-center gap-1.5 truncate text-[13px] text-white/70"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {c.company}</div>
        </div>
        <Camera className="h-[18px] w-[18px] text-white/85" />
        <Phone className="h-[18px] w-[18px] text-white/85" />
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        {c.msgs.map((m, i) => (
          <div key={i} className={cn('max-w-[84%] rounded-xl px-3 py-2 text-[15px] leading-[21px] text-ink shadow-[0_2px_6px_rgba(15,15,22,.08)]', m.out ? 'ml-auto bg-[#E6E7FF]' : 'bg-white')}>
            {m.t}
            <span className="mt-0.5 block text-right text-[11px] text-[#6B6D80]">{m.time}{m.out && <span className="ml-1 text-brand-blue">✓✓</span>}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuoteCard({ q }: { q: QuoteT }) {
  const [num, ...rest] = (q.metric ?? '').split(' ')
  return (
    <div className="flex w-[330px] shrink-0 flex-col self-stretch rounded-2xl border border-[#E1E3F3] bg-white p-6 sm:w-[382px]">
      <div className="flex items-center justify-between">
        <OpenQuote className="h-6 w-6" />
        <Stars />
      </div>
      <p className="mt-5 text-[16px] leading-[23px] tracking-[-0.01em] text-ink">{q.text}</p>
      <div className="min-h-6 flex-1" aria-hidden />
      {q.metric && <span className="w-fit rounded-lg border border-[#E1E3F3] px-3 py-1.5 text-[14px] text-[#6B6D80]"><b className="mr-1 font-semibold text-ink">{num}</b>{rest.join(' ')}</span>}
      <div className={cn('flex items-center gap-3 border-t border-[#E1E3F3] pt-4', q.metric && 'mt-4')}>
        <InitialsAvatar name={q.name} className="h-11 w-11 text-[14px]" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[16px] font-medium text-ink">{q.name}</div>
          <div className="mt-0.5 text-[14px] text-[#6B6D80]">{q.role}</div>
        </div>
        <span className="text-right text-[12px] font-medium uppercase tracking-[0.08em] text-[#6B6D80]">{q.segment}</span>
      </div>
    </div>
  )
}

/** Duas fileiras de depoimentos em rolagem contínua, em sentidos opostos (INFERIDO de [428]/[429]); pausam ao passar o mouse. */
export function LpTestimonials() {
  return (
    <div className="flex flex-col gap-6">
      {[ROW1, ROW2].map((row, r) => (
        <div key={r} className="ks-marquee-pause overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_5%,#000_95%,transparent)]">
          <div className={cn('flex w-max items-stretch gap-[22px] pr-[22px]', r === 0 ? 'ks-marquee-slow' : 'ks-marquee-rev')}>
            {[...row, ...row].map((c, i) => (c.kind === 'chat' ? <ChatCard key={i} c={c} /> : <QuoteCard key={i} q={c} />))}
          </div>
        </div>
      ))}
    </div>
  )
}
