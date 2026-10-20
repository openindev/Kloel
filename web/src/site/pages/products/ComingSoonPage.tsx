import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowUpRight, BellRing, CheckCircle2, Clock3, Mail, MessageSquareText, PhoneCall, RotateCcw, Router } from 'lucide-react'
import { WhatsAppIcon } from '@/components/brand/icons'
import { AuroraBackground, Container, Section, SectionTitle } from '@/site/components/sections'
import { SiteField, SiteInput, SiteTextarea, validateEmail } from '@/site/components/forms'
import { usePageTitle } from '@/site/components/usePageTitle'

const PRODUCTS = {
  'assistente-email-ia': {
    name: 'Assistente de e-mail IA',
    /** artigo do nome do produto (concordância: "o Assistente…", "a Central…") */
    article: 'o',
    icon: Mail,
    tagline: 'Um agente de IA que lê, organiza e responde os e-mails da sua empresa com o cuidado da sua equipe.',
    features: ['Rascunhos de resposta no tom da sua marca', 'Classificação automática da caixa de entrada', 'Conexão com Google e Microsoft', 'Encaminhamento para a pessoa certa da equipe'],
    placeholder: 'Ex.: responder pedidos de orçamento e dúvidas sobre entrega',
  },
  'central-telefonica-ia': {
    name: 'Central telefônica IA (PABX)',
    article: 'a',
    icon: Router,
    tagline: 'Uma central telefônica na nuvem com IA: ramais, filas e atendimento eletrônico inteligente, integrados aos seus assistentes de voz.',
    features: ['Ramais e filas com distribuição inteligente', 'Atendimento eletrônico conversacional com IA', 'Gravação e transcrição das chamadas', 'Transferência entre a IA e a equipe'],
    placeholder: 'Ex.: 12 ramais, fila de suporte e atendimento fora do horário',
  },
} as const

type Slug = keyof typeof PRODUCTS

const AVAILABLE = [
  { name: 'Assistente telefônico IA', text: 'Atende, agenda e transfere ligações 24/7.', to: '/', icon: PhoneCall },
  { name: 'IA de WhatsApp', text: 'Responde todas as mensagens do WhatsApp Business.', to: '/produtos/ia-whatsapp', icon: WhatsAppIcon },
  { name: 'Webchat de IA', text: 'Um chatbot treinado com o conteúdo do seu site.', to: '/produtos/webchat-ia', icon: MessageSquareText },
]

/** Página "Em breve"; cadastro depende de captura pública confirmada. */
export default function ComingSoonPage() {
  const loc = useLocation()
  const slug = (loc.pathname.split('/').pop() ?? 'assistente-email-ia') as Slug
  const product = PRODUCTS[slug] ?? PRODUCTS['assistente-email-ia']
  usePageTitle(`${product.name} — em breve`)

  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' })
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [done, setDone] = useState<{ position: number; already: boolean } | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (errors[k]) setErrors((x) => ({ ...x, [k]: null }))
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string | null> = {
      name: form.name.trim().length < 2 ? 'Informe seu nome.' : null,
      email: validateEmail(form.email),
      consent: consent ? null : 'Confirme que deseja receber o aviso de lançamento.',
    }
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    setErrors({ submit: 'A inscrição para receber novidades ainda não está disponível. Seu cadastro não foi enviado.' })
  }

  const reset = () => {
    setDone(null)
    setForm({ name: '', email: '', company: '', message: '' })
    setConsent(false)
  }

  return (
    <main className="font-site">
      <section className="relative isolate overflow-hidden pb-16 pt-16 sm:pt-24">
        <AuroraBackground variant="ribbon" />
        <Container className="relative grid items-start gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col items-start">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-[14px] text-body">
              <Clock3 className="h-4 w-4" /> Em breve
            </span>
            <div className="mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-blue/10 text-brand-blue">
              <product.icon className="h-7 w-7" />
            </div>
            <SectionTitle as="h1" size="hero" align="left" title={product.name} subtitle={product.tagline} className="mt-5" />
            <ul className="mt-8 flex flex-col gap-3">
              {product.features.map((f) => (
                <li key={f} className="flex items-center gap-3 text-[16px] text-ink">
                  <CheckCircle2 className="h-5 w-5 text-brand-blue" /> {f}
                </li>
              ))}
            </ul>
            <p className="mt-8 text-[14px] text-body">Receba novidades sobre o lançamento.</p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,15,22,.3)] sm:p-8" id="lista-de-espera">
            {done ? (
              <div className="ks-fade-up flex flex-col items-center gap-4 py-6 text-center" data-testid="waitlist-success">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><BellRing className="h-6 w-6" /></span>
                <h2 className="text-[24px] font-medium tracking-[-0.3px] text-heading">{done.already ? 'Você já está na lista de espera' : 'Você está na lista de espera!'}</h2>
                <p className="max-w-[360px] text-[16px] text-body">
                  Avisaremos {form.email.trim().toLowerCase()} assim que {product.article} {product.name} estiver disponível. Sua posição: <b className="font-medium text-heading">#{done.position}</b>.
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={reset} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-4 text-[15px] text-ink hover:bg-slate-50"><RotateCcw className="h-4 w-4" /> Inscrever outro e-mail</button>
                  <Link to="/agendar-demo" className="inline-flex h-11 items-center rounded-xl bg-heading px-4 text-[15px] text-white hover:bg-heading/90">Agendar uma demo</Link>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                <div>
                  <h2 className="text-[22px] font-medium tracking-[-0.3px] text-heading">Entre na lista de espera</h2>
                  <p className="mt-1 text-[15px] text-body">Receba o aviso de lançamento e acesso antecipado.</p>
                </div>
                <SiteField label="Nome" required error={errors.name} htmlFor="ws-name">
                  <SiteInput id="ws-name" value={form.name} onChange={set('name')} placeholder="Maria Silva" invalid={!!errors.name} autoComplete="name" />
                </SiteField>
                <SiteField label="E-mail profissional" required error={errors.email} htmlFor="ws-email">
                  <SiteInput id="ws-email" type="email" value={form.email} onChange={set('email')} placeholder="maria@empresa.com.br" invalid={!!errors.email} autoComplete="email" />
                </SiteField>
                <SiteField label="Empresa" htmlFor="ws-company">
                  <SiteInput id="ws-company" value={form.company} onChange={set('company')} placeholder="Acme Ltda." autoComplete="organization" />
                </SiteField>
                <SiteField label="O que você gostaria de automatizar?" htmlFor="ws-msg">
                  <SiteTextarea id="ws-msg" value={form.message} onChange={set('message')} placeholder={product.placeholder} />
                </SiteField>
                <label className="flex items-start gap-2.5 text-[14px] text-body">
                  <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors((x) => ({ ...x, consent: null })) }} className="mt-0.5 h-4 w-4 accent-[#585DFE]" />
                  <span>
                    Quero receber o aviso de lançamento por e-mail. Li a{' '}
                    <a href="/ajuda/legal/politica-de-privacidade" target="_blank" rel="noreferrer" className="text-brand-blue underline underline-offset-2">Política de privacidade</a>.
                  </span>
                </label>
                {(errors.consent || errors.submit) && <span role="alert" data-engine-state={errors.submit ? 'error' : undefined} className="-mt-2 text-[13px] text-red-600">{errors.consent || errors.submit}</span>}
                <button type="submit" className="mt-1 h-12 rounded-xl bg-brand-blue text-[16px] text-white hover:bg-[#4a4fe6]">Avise-me no lançamento</button>
              </form>
            )}
          </div>
        </Container>
      </section>

      <Section background="gray">
        <Container>
          <SectionTitle title="Enquanto isso, conheça o que já está disponível" />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {AVAILABLE.map((p) => (
              <Link key={p.name} to={p.to} className="group flex flex-col gap-3 rounded-2xl border border-[#E6E8EE] bg-white p-7 transition-shadow hover:shadow-lg">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F3F4F8] text-ink"><p.icon className="h-5 w-5" /></span>
                <span className="flex items-center gap-1.5 text-[20px] font-medium tracking-[-0.15px] text-heading">{p.name} <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></span>
                <span className="text-[16px] text-body">{p.text}</span>
              </Link>
            ))}
          </div>
        </Container>
      </Section>
    </main>
  )
}
