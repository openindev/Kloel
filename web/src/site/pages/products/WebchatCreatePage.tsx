import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BadgeCheck, CornerLeftDown, CreditCard, PhoneCall } from 'lucide-react'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { AuroraBackground, DemoLogoMark, DEMO_LOGOS } from '@/site/components/sections'
import { SiteFavicon, demoUrl, siteValidationMessage } from '@/site/components/webchat/site'
import { usePageTitle } from '@/site/components/usePageTitle'
import { cn } from '@/lib/utils'

/** /webchat/criar — "Tenha seu Chatbot de IA em 30 segundos" (página standalone, sem header/footer do site). */
export default function WebchatCreatePage() {
  usePageTitle('Tenha seu Chatbot de IA')
  const navigate = useNavigate()
  const [site, setSite] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const msg = siteValidationMessage(site)
    setError(msg)
    if (!msg) navigate(demoUrl(site, { from: 'criar' }))
  }

  return (
    <div className="relative min-h-svh overflow-hidden bg-white font-site text-ink">
      <AuroraBackground variant="soft" />
      {/* 02b/01.png a 1460 px: bloco 20 px abaixo do centro, logo→cartão 36 px, cartão de 1022 px (coluna esquerda de 492 px) */}
      <div className="relative mx-auto flex min-h-svh max-w-[1060px] flex-col items-center justify-center px-4 py-10 sm:pt-20">
        <Link to="/" aria-label="kloel.ai — início"><KloelLogo className="text-[28px]" /></Link>
        <div className="mt-8 grid w-full overflow-hidden rounded-[24px] border border-slate-200 bg-white p-2 shadow-[0_20px_60px_-30px_rgba(15,15,22,.25)] sm:mt-[22px] md:min-h-[515px] md:grid-cols-2 lg:grid-cols-[492px_1fr]">
          <div className="flex flex-col rounded-[18px] border border-slate-200 p-7 sm:p-10 sm:pt-[33px]">
            <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.5px] text-heading sm:text-[32px] sm:leading-[35px]">Tenha seu Chatbot de IA em 30 segundos</h1>
            <ul className="mt-7 flex flex-col gap-5 text-[17px] text-ink">
              <li className="flex items-center gap-3"><BadgeCheck className="h-5 w-5 text-slate-400" /> Grátis</li>
              <li className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-slate-400" /> Sem cartão de crédito</li>
              <li className="flex items-center gap-3"><PhoneCall className="h-5 w-5 text-slate-400" /> Personalizada para sua empresa</li>
            </ul>
            <div className="mt-12 flex flex-col items-center gap-4 md:mt-auto md:pt-16">
              <div className="flex items-center gap-2 text-[15px] font-medium text-heading">Mais de 1.000 clientes</div>
              {/* referência: 3 logos numa única linha sob "Mais de … clientes" */}
              <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3 opacity-80 lg:flex-nowrap">
                {[DEMO_LOGOS[5]!, DEMO_LOGOS[4]!, DEMO_LOGOS[6]!].map((l) => <DemoLogoMark key={l.name} logo={l} mono className="[&>span]:text-[15px] [&>svg]:h-5 [&>svg]:w-5" />)}
              </div>
            </div>
          </div>
          {/* formulário de 398 px (65 px à esquerda, 49 px à direita), 17 px abaixo do centro; título semibold de 24 px,
              campo de 48 px, botão de 44 px com rótulo médio de 16 px, link de 13 px */}
          <form onSubmit={submit} noValidate className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:pb-10 lg:pl-[65px] lg:pr-[49px] lg:pt-[74px]">
            <div className="flex items-center gap-3">
              <CornerLeftDown className="h-4 w-4 text-slate-500" />
              <h2 className="text-[22px] font-semibold text-heading sm:text-[24px]">Insira o link do seu site</h2>
            </div>
            <label className={cn('mt-[18px] flex h-12 items-center gap-2.5 rounded-xl border px-4 focus-within:border-brand-blue', error ? 'border-red-400' : 'border-slate-200')}>
              {site && <SiteFavicon site={site} />}
              <input
                value={site}
                onChange={(e) => { setSite(e.target.value); if (error) setError(null) }}
                placeholder="minha-empresa.com.br"
                aria-label="Link do seu site"
                aria-invalid={!!error || undefined}
                inputMode="url"
                className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-slate-500"
              />
            </label>
            {error && <p role="alert" className="mt-2 text-[14px] text-red-600">{error}</p>}
            <button type="submit" className="mt-5 flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-blue text-[16px] font-medium text-white hover:bg-[#4a4fe6]">
              Criar IA <ArrowRight className="h-4 w-4" />
            </button>
            <Link to={demoUrl(undefined, { from: 'criar' })} className="mx-auto mt-3.5 text-[13px] text-body hover:text-ink hover:underline">
              Continuar sem site
            </Link>
          </form>
        </div>
        <p className="mt-6 text-[16px] text-body">
          Já é cliente? <Link to="/login" className="text-brand-blue hover:underline">Entrar</Link>
        </p>
      </div>
    </div>
  )
}
