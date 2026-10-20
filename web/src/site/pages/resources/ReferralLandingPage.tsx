import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Check, Copy, Gift, MessageSquareText, PhoneCall, Rocket, Settings2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { WhatsAppIcon } from '@/components/brand/icons'
import { Chip, GradientHero, siteButton } from '../company/kit'
import { useReferral } from '@/services/casca/referrals'

/** Public invitation entry. Only the engine's public confirmation of the code is shown; nothing is read from this browser. */
export default function ReferralLandingPage() {
  const { code = '' } = useParams()
  const signup = `/criar-conta?ref=${encodeURIComponent(code)}`
  const [copied, setCopied] = useState(false)
  const referral = useReferral(code)
  const confirmed = referral.status === 'done' && referral.valid ? referral : undefined

  return (
    <div className="min-h-svh bg-white font-site text-ink">
      <header className="relative z-10 mx-auto flex h-[72px] max-w-[1240px] items-center justify-between px-5 lg:px-8">
        <Link to="/" aria-label="kloel.ai — início">
          <KloelLogo className="text-[23px]" />
        </Link>
        <div className="flex items-center gap-2">
          {/* "Entrar" visível também no celular: quem já tem conta precisa conseguir entrar a partir do convite. */}
          <Link to="/login" className="inline-flex h-[38px] items-center rounded-[10px] px-2.5 text-[14px] text-ink hover:bg-slate-50 sm:px-3.5">
            Entrar
          </Link>
          <Link to={signup} className={siteButton('dark', 'md')}>
            Criar conta
          </Link>
        </div>
      </header>

      <GradientHero>
        <div className="mx-auto flex max-w-[820px] flex-col items-center gap-6 px-5 pb-32 pt-16 text-center sm:pb-40 sm:pt-24">
          <Chip icon={<Gift className="h-[18px] w-[18px] text-brand-blue" />}>Convite especial</Chip>
          <h1 className="text-balance text-[36px] font-medium leading-[42px] tracking-[-0.7px] text-heading sm:text-[52px] sm:leading-[58px] sm:tracking-[-1px]" data-testid="referral-title">
            Você recebeu um convite para a Kloel
          </h1>
          <p className="max-w-[620px] text-[17px] leading-[27px] text-body sm:text-[18px]">
            Crie sua conta e conheça os planos para um assistente de IA para telefone, WhatsApp ou chat. <b className="font-medium text-ink">Benefícios de indicação</b> dependem de confirmação.
          </p>
          {confirmed && (
            <div className="flex max-w-[560px] items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left text-[14px] text-emerald-900" role="status" data-testid="referral-valid">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Convite de <b className="font-medium">{confirmed.referrerName}</b>. A indicação fica registrada quando você cria a conta por este convite.</span>
            </div>
          )}
          {(referral.status === 'error' || (referral.status === 'done' && !referral.valid)) && (
            <div className="flex max-w-[560px] items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-[14px] text-amber-900" role="status" data-testid="referral-invalid">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Não foi possível validar o código “{code}”. Você pode criar sua conta normalmente; nenhum benefício de indicação foi confirmado.</span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <Link to={signup} className={siteButton('dark')}>
              Criar minha conta <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/agendar-demo?source=indicacao" className={siteButton('white')}>
              Agendar uma demo
            </Link>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code)
                setCopied(true)
                toast.success('Código copiado.')
                setTimeout(() => setCopied(false), 2500)
              } catch {
                toast.error('Não foi possível copiar automaticamente. Selecione o código e copie.')
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-white/70 px-3 py-1.5 text-[14px] text-ink backdrop-blur hover:bg-white"
            data-testid="referral-copy"
          >
            Código de indicação: <b className="select-all font-medium">{code}</b>
            {copied ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check className="h-3.5 w-3.5" /> copiado
              </span>
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </GradientHero>

      <section className="mx-auto max-w-[1180px] px-5 py-20 sm:py-28">
        <h2 className="text-center text-[30px] font-medium leading-9 tracking-[-0.3px] text-heading sm:text-[38px] sm:leading-[45.6px]">Comece em 3 passos</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            { icon: UserPlus, title: '1. Crie sua conta', text: 'Informe o nome da empresa, e-mail e senha. No primeiro acesso, você escolhe o plano e conclui a assinatura.' },
            { icon: Settings2, title: '2. Configure seu assistente', text: 'Informe o site da empresa e a Kloel prepara as respostas. Ajuste a voz e o tom.' },
            { icon: Rocket, title: '3. Assine e ative', text: 'Conclua a assinatura do plano no primeiro acesso e ative seu assistente.' },
          ].map((s) => (
            <div key={s.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F1FE] text-brand-blue">
                <s.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-6 text-[20px] font-medium text-heading">{s.title}</h3>
              <p className="mt-2 text-[16px] leading-[26px] text-body">{s.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 grid gap-4 md:grid-cols-3">
          {[
            { icon: <PhoneCall className="h-5 w-5" />, name: 'Assistente telefônico IA', to: '/produtos/assistente-telefonico-ia', text: 'Atende ligações 24h, agenda e transfere quando necessário.' },
            { icon: <WhatsAppIcon className="h-5 w-5" />, name: 'IA de WhatsApp', to: '/produtos/ia-whatsapp', text: 'Responde e qualifica contatos direto no WhatsApp.' },
            { icon: <MessageSquareText className="h-5 w-5" />, name: 'Webchat de IA', to: '/produtos/webchat-ia', text: 'Conversa com os visitantes do seu site e marca horários.' },
          ].map((p) => (
            <Link key={p.name} to={p.to} className="group flex items-start gap-4 rounded-2xl border border-slate-200 p-5 transition-colors hover:border-brand-blue/40 hover:bg-[#FAFAFF]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-ink">{p.icon}</span>
              <span>
                <span className="flex items-center gap-1.5 text-[17px] font-medium text-heading">
                  {p.name} <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="mt-1 block text-[15px] leading-6 text-body">{p.text}</span>
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-10 text-center text-[14px] text-body">
          Quer comparar os planos antes?{' '}
          <Link to="/planos" className="text-brand-blue hover:underline">
            Ver planos e preços
          </Link>
          <span className="mx-2 text-slate-300">·</span>
          Já tem uma conta?{' '}
          <Link to="/login" className="text-brand-blue hover:underline">
            Entrar
          </Link>
        </p>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-[13px] text-body">
        © kloel.ai ·{' '}
        <a href="/ajuda/legal/termos-e-condicoes" className="hover:underline">
          Termos e condições
        </a>{' '}
        ·{' '}
        <a href="/ajuda/legal/politica-de-privacidade" className="hover:underline">
          Política de privacidade
        </a>
      </footer>
    </div>
  )
}
