import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, MessageSquareText, MousePointer2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AuroraBackground, CardCarousel, Container, CtaLink, FaqAccordion, FinalCta, HeroSocialProof, IntegrationsShowcase, IntervalToggle, LogoStrip, PillBadge, PricingCards, Section,
  SectionTitle, TestimonialsSection, type BillingInterval, type DemoTestimonial,
} from '@/site/components/sections'
import { ProductVideo } from '@/site/components/tour/ProductVideo'
import { AbilitiesList, FloatingTestBar, InstallCodeMock, MockWindow } from '@/site/components/mocks/AppMocks'
import { SiteFavicon, demoUrl, siteValidationMessage, speedFactor } from '@/site/components/webchat/site'
import { usePageTitle } from '@/site/components/usePageTitle'
import { WC_BENEFIT_ILLUS } from './wcParts'

/* ------------------------------- Hero ------------------------------- */

/**
 * Balão de vidro do hero (01.png a 1460 px): ≈146×136 px, quadrado arredondado com rabicho para baixo à esquerda,
 * gradiente lilás/azul com reflexo verde-água no canto superior direito, bordas foscas e duas barras brancas.
 */
export function GlassChatIcon({ size = 146 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <div className="ks-orb relative" style={{ width: size, height: size * (140 / 150) }} aria-hidden>
      <svg viewBox="0 0 150 140" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#E3E8FF" />
            <stop offset="45%" stopColor="#AEB9FC" />
            <stop offset="100%" stopColor="#8C9CF6" />
          </linearGradient>
          <radialGradient id={`${id}-t`} cx="0.92" cy="0.12" r="0.45">
            <stop offset="0%" stopColor="#B8F5E2" stopOpacity=".95" />
            <stop offset="100%" stopColor="#B8F5E2" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-f`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6" /></filter>
          <filter id={`${id}-b`} x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation=".7" /></filter>
          <filter id={`${id}-s`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9" /></filter>
        </defs>
        <path d="M32 4h86a26 26 0 0 1 26 26v58a26 26 0 0 1-26 26H50c-8 10-22 20-40 25 7-9 11-17 12-26A26 26 0 0 1 6 88V30A26 26 0 0 1 32 4z" fill="#A5B4FC" opacity=".45" filter={`url(#${id}-s)`} transform="translate(0 6)" />
        <g filter={`url(#${id}-f)`}>
          <path d="M32 4h86a26 26 0 0 1 26 26v58a26 26 0 0 1-26 26H50c-8 10-22 20-40 25 7-9 11-17 12-26A26 26 0 0 1 6 88V30A26 26 0 0 1 32 4z" fill={`url(#${id}-g)`} opacity=".92" />
          <path d="M32 4h86a26 26 0 0 1 26 26v58a26 26 0 0 1-26 26H50c-8 10-22 20-40 25 7-9 11-17 12-26A26 26 0 0 1 6 88V30A26 26 0 0 1 32 4z" fill={`url(#${id}-t)`} />
        </g>
        <g filter={`url(#${id}-b)`} fill="#fff" opacity=".95">
          <rect x="26" y="39" width="92" height="16" rx="8" />
          <rect x="26" y="69" width="65" height="17" rx="8.5" />
        </g>
      </svg>
    </div>
  )
}

function UrlHero() {
  const navigate = useNavigate()
  const [site, setSite] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval>>()
  useEffect(() => () => clearInterval(timer.current), [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const msg = siteValidationMessage(site)
    setError(msg)
    if (msg) return
    const to = demoUrl(site)
    setProgress(0)
    const step = 40 * speedFactor()
    // o progresso é controlado por uma variável local: navegar dentro do "updater" do setState rodava duas vezes
    // no StrictMode e empilhava a mesma URL duas vezes no histórico (o "Voltar" parecia não funcionar).
    let p = 0
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      p = Math.min(100, p + 6)
      setProgress(p)
      if (p >= 100) {
        clearInterval(timer.current)
        setTimeout(() => navigate(to), 120 * speedFactor())
      }
    }, step)
  }
  const generating = progress !== null

  return (
    // data-chat-launcher-avoid: o lançador flutuante do chat nunca fica por cima deste formulário (celular)
    <form onSubmit={submit} noValidate className="flex w-full max-w-[420px] flex-col items-center" data-chat-launcher-avoid="">
      {/* campo observado: ~400px × 58px, borda índigo 2px, botão interno de 48px (01.png e 01a/01.png) */}
      <div className={cn('flex h-[58px] w-full items-center gap-2.5 rounded-2xl border-2 bg-white pl-4 pr-[4px] shadow-[0_8px_30px_-14px_rgba(88,93,254,.25)] transition-colors sm:w-[400px]', generating ? 'border-slate-200' : error ? 'border-red-400' : 'border-brand-blue')}>
        <SiteFavicon site={site} />
        <input
          value={site}
          onChange={(e) => { setSite(e.target.value); if (error) setError(null) }}
          disabled={generating}
          placeholder="Digite seu site"
          aria-label="Endereço do seu site"
          aria-invalid={!!error || undefined}
          inputMode="url"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-slate-400 disabled:text-slate-400"
        />
        <button type="submit" disabled={generating} className="flex h-12 shrink-0 items-center gap-2 rounded-xl bg-brand-blue px-4 text-[16px] text-white transition-colors hover:bg-[#4a4fe6] disabled:bg-[#7d81ff] sm:px-5">
          {generating ? 'Gerando' : <>Gerar minha IA <ArrowRight className="h-4 w-4" /></>}
        </button>
      </div>
      {generating && (
        <div className="mt-2 h-[3px] w-[92%] overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Gerando sua IA">
          <div className="h-full bg-brand-blue transition-[width] duration-100" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-600">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-4 text-[16px] text-body">
        <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> IA personalizada grátis</span>
        <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> Sem cadastro</span>
      </div>
    </form>
  )
}

/* ---------------------------- Benefícios (5) ---------------------------- */

// ilustrações medidas em 03.png / 03a.png (wcParts.tsx)
const BENEFITS: { title: string; text: string }[] = [
  { title: 'Responde a cada pergunta', text: 'A Kloel economiza seu tempo cuidando das perguntas rotineiras dos seus clientes.' },
  { title: 'Atende pedidos', text: 'A Kloel pode enviar e-mails, agendar compromissos e usa integrações com as ferramentas que você já utiliza.' },
  { title: 'Adicione conhecimento', text: 'Seu webchat responde com base no seu site, documentos e listas de preços. Sem árvores de decisões rígidas, botões fixos ou respostas genéricas.' },
  { title: 'Transfere para o seu time', text: 'Quando uma conversa precisar de um humano, a Kloel transfere e alerta sua equipe.' },
  { title: 'Conhece o contexto da página', text: 'A Kloel reconhece qual página o visitante está vendo e usa o contexto dela para responder.' },
]

/* ------------------------ Configurada em 10 minutos ------------------------ */

function ConfigPanel({ step }: { step: string }) {
  const install = step === '' || step === '2'
  return (
    <MockWindow className="relative h-[340px]">
      <div className="absolute inset-0 overflow-hidden">
        {install && (
          // referência 04.png: o painel "Instalação" é um modal sobre a tela (esmaecida) do assistente; a barra flutuante fica
          // ABAIXO do modal e as ações "Remover widget / Cancelar / Salvar" ficam inteiras
          <>
            <div aria-hidden className="absolute inset-0 bg-[#F7F8FA] p-4 opacity-70">
              <AbilitiesList kind="chat" name="Lorena" added={[1, 2]} compact />
            </div>
            <div aria-hidden className="absolute inset-0 bg-slate-900/15" />
            <div key={`i${step}`} className="ks-fade-up absolute left-3 right-3 top-0 z-10 overflow-hidden rounded-b-xl border border-t-0 border-slate-200 bg-white shadow-[0_24px_50px_-20px_rgba(15,15,22,.5)] sm:left-5 sm:right-[22%]" data-testid="install-modal">
              <InstallCodeMock copied={step === '2'} />
            </div>
          </>
        )}
        {(step === '0' || step === '1') && (
          // 04a.png (01): folha "Widget no site" sobre o assistente esmaecido, em "Sites permitidos";
          // 04b.png (02): a mesma folha rolada até o rodapé, com "Cancelar" e "Criar script de instalação" (cursor no botão)
          <>
            <div aria-hidden className="absolute inset-0 bg-[#F7F8FA] p-4 opacity-70">
              <AbilitiesList kind="chat" name="Lorena" added={[1, 2]} compact />
            </div>
            <div aria-hidden className="absolute inset-0 bg-slate-900/15" />
            <div key={step} className="ks-fade-up absolute bottom-0 left-[10%] right-[23%] top-0 z-10 overflow-hidden bg-white font-sans text-[9px] leading-[13px] text-slate-500 shadow-[0_24px_50px_-20px_rgba(15,15,22,.45)]">
              <div className={cn('px-[14px] transition-transform duration-500', step === '1' && '-translate-y-[56px]')}>
                <p className="pt-[2px]">Controle quais sites podem incorporar este assistente.</p>
                <div className="mt-[3px] grid grid-cols-2 rounded-[7px] bg-[#F3F4F6] p-[2px] text-center text-[10px] leading-[21px]">
                  <span className="rounded-[5px] bg-white font-medium text-slate-900 shadow-sm">Widget no site</span>
                  <span className="text-slate-500">Personalizar</span>
                </div>
                <div className="mt-[14px] flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-900">Sites permitidos</div>
                    <p className="mt-0.5 max-w-[240px]">Adicione a origem exata de cada site que pode incorporar o widget, por exemplo https://exemplo.com.br.</p>
                  </div>
                  <span className="flex h-[24px] shrink-0 items-center gap-1 rounded-[6px] border border-slate-200 px-2 text-[9.5px] font-medium text-slate-900"><Plus className="h-2.5 w-2.5" /> Adicionar site</span>
                </div>
                <div className="mt-[8px] flex items-center gap-3">
                  <span className="flex h-[25px] flex-1 items-center rounded-[6px] border border-slate-300 px-2 text-[9.5px] text-slate-900 shadow-[0_0_0_2px_rgba(15,15,22,.04)]">https://minhaempresa.com.br</span>
                  <Trash2 className="h-3 w-3 text-slate-400" />
                </div>
                <div className="mt-[16px] border-t border-slate-100" />
                <div className="mt-[16px] text-[10px] font-semibold text-slate-900">Mensagem de boas-vindas</div>
                <p className="mt-0.5">Exibida como a primeira mensagem do assistente em cada nova conversa do widget. Deixe em branco para usar o padrão do idioma do assistente.</p>
                <div className="mt-[7px] h-[55px] rounded-[6px] border border-slate-200 px-2 py-1.5 text-[9.5px] text-slate-400">Olá! Como posso ajudar você hoje?</div>
                <div className="flex items-center justify-between rounded-b-[6px] border border-t-0 border-slate-200 px-2 py-1.5 text-[8.5px] text-slate-700"><span>Regras de saudação</span><span>0/500</span></div>
              </div>
              {step === '1' && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-[14px] py-[9px]">
                  <span className="rounded-[6px] px-2 py-1 text-[9.5px] font-medium text-slate-900">Cancelar</span>
                  <span className="relative rounded-[6px] bg-slate-900 px-2.5 py-1 text-[9.5px] font-medium text-white">
                    Criar script de instalação
                    <MousePointer2 aria-hidden className="absolute -bottom-2.5 right-6 h-3.5 w-3.5 fill-slate-900 text-white" />
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <FloatingTestBar className="absolute bottom-3 right-3 z-[5]" items={['Ativar WhatsApp', 'Gerenciar webchat']} primary="Testar chat" />
    </MockWindow>
  )
}

const CONFIG = [
  { q: 'Conecte seu site', a: 'Cole a URL do seu site e importamos a informação dele de forma automática.' },
  { q: 'Defina dados e ações', a: 'Suba documentos, listas de preço e decida quais pedidos a Kloel deve gerenciar.' },
  { q: 'Adicione o widget', a: 'Cole um script no seu site, customize o design e rode ao vivo.' },
]

const WC_TESTIMONIALS: DemoTestimonial[] = [
  { quote: 'Horário de abertura, valor do estacionamento, se tem plano mensal... O chatbot responde as perguntas que a gente recebe cem vezes por dia. Minha equipe entra só quando é realmente necessário.', name: 'Tomás Herrera', role: 'Parque Aventura Sul' },
  { quote: 'Qual é o tamanho, quais são os acabamentos, quanto custa...? O chatbot responde a partir do nosso catálogo e lista de preços. Os pedidos já chegam redondos na equipe.', name: 'Renata Martins', role: 'Gráfica Ponto Certo' },
  { quote: 'As perguntas sobre frete, prazo de entrega e nota fiscal agora têm resposta automática na nossa loja. Quando alguém precisa de atendimento, a Kloel sinaliza e ligamos de volta.', name: 'Davi Antunes', role: 'Loja Simples Online' },
  { quote: 'Colocamos o widget no site numa tarde. Hoje ele responde dúvidas de matrícula até de madrugada.', name: 'Luciana Prado', role: 'Escola de idiomas' },
]

export default function WebchatProductPage() {
  usePageTitle('Webchat de IA')
  const [step, setStep] = useState('')
  const [interval, setInterval_] = useState<BillingInterval>('monthly')
  return (
    <main className="font-site">
      {/* 01.png a 1460 px: selo 80 px abaixo do header, título→balão 74 px, balão→campo 72 px, campo→marcações 23 px,
          marcações→prova social 73 px, prova social→logos 91 px */}
      <section className="relative isolate overflow-hidden pb-12 pt-16 sm:pb-[74px] sm:pt-20">
        <AuroraBackground variant="ribbon" />
        <Container className="relative flex flex-col items-center text-center">
          <PillBadge className="py-[7px]" icon={<MessageSquareText className="h-[18px] w-[18px] text-ink" />}>Webchat de IA para o seu site</PillBadge>
          <SectionTitle as="h1" size="hero" title="Responda todas as mensagens, mesmo com seu time ocupado." className="mt-6 max-w-[680px]" />
          <div className="my-10 sm:mb-[70px] sm:mt-[70px]"><GlassChatIcon size={146} /></div>
          <UrlHero />
          {/* 01.png: título da prova social em y 765 a 1460 px (5 px acima); o pb compensa e a faixa de logos não se move */}
          <HeroSocialProof className="mt-10 sm:mt-[62px]" />
        </Container>
      </section>

      <section className="pb-6 pt-2">
        <Container size="full"><LogoStrip /></Container>
      </section>

      {/* 02.png: vídeo com 1152 px de largura (max-w-6xl) */}
      <section className="py-10 sm:py-16">
        <Container size="lg" className="max-w-[1216px]">
          <ProductVideo variant="webchat" noTour />
          <div className="mt-8 flex justify-center">
            <CtaLink to="/webchat/criar">Tenha seu Webchat de IA</CtaLink>
          </div>
        </Container>
      </section>

      <Section id="beneficios">
        {/* 03.png / 03a.png: cartões de 374×395 px com 16 px entre eles, quadro de 214 px, subtítulo de 16 px, setas de 48 px */}
        <Container size="lg" className="max-w-[1216px]">
          <SectionTitle title="Benefícios e Habilidades" subtitle="A Kloel cuida do atendimento ao seu cliente no seu site igual a um funcionário de verdade." subtitleClassName="sm:text-[16px] sm:leading-6" />
          <CardCarousel
            className="mt-10"
            label="Benefícios"
            gap={16}
            cardClassName="w-[86vw] sm:w-[374px] lg:w-[calc((100%-32px)/3)]"
            items={BENEFITS.map((b, i) => (
              <article key={b.title} className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-white">
                {WC_BENEFIT_ILLUS[i]}
                <div className="flex flex-col gap-2 p-6">
                  <h3 className="text-[20px] font-medium leading-7 tracking-[-0.15px] text-heading">{b.title}</h3>
                  <p className="text-[16px] leading-6 text-body">{b.text}</p>
                </div>
              </article>
            ))}
          />
        </Container>
      </Section>

      {/* 04.png: 212 px entre o botão "Tenha seu Webchat de IA" e o centro de "Planos & Preços" */}
      <Section id="configuracao" className="sm:pb-16">
        {/* 04.png–4c.png: colunas de 544 px (1152 px), painel de 340 px alinhado ao topo, subtítulo 16/24 até 480 px,
            linhas de 67 px e resposta sem recuo até 448 px */}
        <Container size="lg" className="max-w-[1216px]">
          <div className="grid items-start gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
            <div>
              <SectionTitle align="left" title="Configurada em 10 minutos" subtitle="Suba seu conteúdo, decida o que a Kloel deveria fazer e adicione o widget ao seu site." className="gap-3" subtitleClassName="max-w-[480px] sm:text-[16px] sm:leading-6" />
              <FaqAccordion className="mt-4 [&_h3>button]:py-[21px] [&_[role=region]>div]:max-w-[448px] [&_[role=region]>div]:px-0" numbered items={CONFIG} value={step} onValueChange={setStep} />
            </div>
            <ConfigPanel step={step} />
          </div>
          <div className="mt-12 flex justify-center">
            <CtaLink to="/webchat/criar">Tenha seu Webchat de IA</CtaLink>
          </div>
        </Container>
      </Section>

      <Section id="planos">
        <Container>
          {/* 5.png: subtítulo de 16 px, subtítulo→selo 12 px */}
          <SectionTitle title="Planos & Preços" size="hero" as="h2" subtitle="Comece com o plano que se adapta ao seu volume de conversas." subtitleClassName="sm:text-[16px] sm:leading-6" />
          <div className="mt-3 flex flex-col items-center gap-6">
            <PillBadge>
              Garantia Risco Zero: Teste por 30 dias ou receba seu dinheiro de volta
            </PillBadge>
            <IntervalToggle value={interval} onChange={setInterval_} annualHint="-20%" />
          </div>
          <PricingCards className="mt-12" product="webchat" interval={interval} />
        </Container>
      </Section>

      <IntegrationsShowcase
        variant="grid"
        // 6.png: subtítulo de 16/24 numa linha (≈785 px), grade de 447 px com 16 px entre os blocos, 182 px até o próximo título
        className="sm:pb-[63px] sm:[&_h2+p]:max-w-[820px]"
        title="Integrações"
        subtitle="Conecte a Kloel aos sistemas que você já usa para fazer agendamentos, mandar e-mails e disparar workflows."
        names={['Airtable', 'Google Sheets', 'Make', 'n8n', 'Notion', 'Odoo', 'Shopify', 'Slack', 'WooCommerce']}
        cta={null}
      />

      <TestimonialsSection
        variant="wide"
        containerSize="wide"
        // 7.png: cartões 50 px abaixo das pílulas, setas de 48 px
        listClassName="mt-[50px]"
        title={<>Por que nossos clientes<br />confiam na gente</>}
        subtitle="A Kloel trata os dados dos seus visitantes conforme a LGPD."
        pills={[<>Suporte em português</>, <>Em conformidade com a LGPD</>]}
        items={WC_TESTIMONIALS}
        cta={{ label: 'Tenha seu Webchat de IA', to: '/webchat/criar' }}
      />

      <FinalCta
        // 8.png: título em 2 linhas e 80 px entre os botões e a base do gradiente
        className="sm:pb-20"
        title={<span className="mx-auto block max-w-[400px]">Transforme os visitantes do seu site em clientes</span>}
        subtitle="Deixe a Kloel responder perguntas, gerenciar pedidos e agendar compromissos 24h, 7 dias por semana."
        primary={{ label: 'Comece agora', to: '/criar-conta' }}
        secondary={{ label: 'Agende uma demo', to: '/agendar-demo' }}
      />

    </main>
  )
}
