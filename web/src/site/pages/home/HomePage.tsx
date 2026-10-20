import { Link, useLocation } from 'react-router-dom'
import { ArrowUpRight, Briefcase, CalendarDays, Check, Headset, Layers, Share2 } from 'lucide-react'
import {
  AuroraBackground, CallbackWidget, Container, CtaLink, CustomerCases, FaqAccordion, FinalCta, HeroSocialProof, IntegrationsShowcase, LogoStrip, PillBadge, Section, SectionTitle,
  StepsSection, TestimonialsSection, HeroOrb,
} from '@/site/components/sections'
import { ProductVideo } from '@/site/components/tour/ProductVideo'
import { VOICE_TOUR } from '@/site/components/tour/scenes'
import { AbilityRow, AssistantsTableMock, PhoneCallMock } from '@/site/components/mocks/AppMocks'
import { usePageTitle } from '@/site/components/usePageTitle'
import { CircleHelp, Mail, PhoneForwarded, Sparkles } from 'lucide-react'

const USE_CASES = [
  { icon: Briefcase, title: 'Recepção', text: 'O assistente de IA atende as ligações recebidas e as transfere, quando necessário, para a pessoa responsável.', to: '/solucoes/recepcionista-virtual-com-ia' },
  { icon: Headset, title: 'Atendimento ao cliente', text: 'Deixe nossa IA cuidar das solicitações dos seus clientes de maneira autônoma. Pela nossa plataforma, você define com precisão o comportamento dela, inclusive em situações especiais.', to: '/solucoes/agente-de-suporte-com-ia' },
  { icon: CalendarDays, title: 'Agendamento', text: 'Nossa IA pode agendar compromissos durante a conversa.', to: '/solucoes/agendamentos-e-perguntas-frequentes' },
  { icon: Check, title: 'Recebimento de pedidos', text: 'Ofereça atendimento ágil com processamento automatizado de solicitações 24h por dia, 7 dias por semana.', to: '/solucoes/atendedor-automatico-por-ia' },
  { icon: Share2, title: 'Transcrição', text: 'A IA recebe as solicitações dos seus clientes, transcreve e envia por e-mail quando você não está disponível.' },
  { icon: Layers, title: 'Mais de 100 possibilidades', text: '' },
] as { icon: React.ComponentType<{ className?: string }>; title: string; text: string; to?: string }[]

const FAQ = [
  {
    q: 'Vocês são mesmo o melhor assistente de voz com IA?',
    a: 'Preferimos que você tire a prova: digite seu número no topo da página e receba uma ligação de demonstração, ou agende uma conversa com nosso time. A Kloel foi pensada para pequenas e médias empresas brasileiras, com voz natural em português e configuração sem código.',
  },
  {
    q: 'Onde os dados são armazenados? A Kloel segue a LGPD?',
    a: (
      <>
        A Kloel trata dados pessoais conforme a LGPD. Os detalhes de hospedagem, retenção e subprocessadores ficam em{' '}
        <a href="/ajuda/legal/protecao-de-dados" target="_blank" rel="noreferrer" className="text-brand-blue underline underline-offset-2">Proteção de dados</a>.
      </>
    ),
  },
  {
    q: 'Onde e como a Kloel é desenvolvida?',
    a: 'A Kloel é construída por brasileiros, para o Brasil: produto em português, suporte local e um time que acompanha de perto as necessidades das empresas brasileiras.',
  },
  {
    q: 'Em quanto tempo posso ter o assistente telefônico pronto para uso?',
    a: 'Você cria e testa seu assistente em poucos minutos. Para atender ligações reais, basta ativar um número ou configurar o encaminhamento do número que você já usa.',
  },
  {
    q: 'E se a IA cometer erros?',
    a: 'A IA responde com base nas informações que você cadastra, o que reduz erros. Quando não souber como seguir, ela pode transferir a ligação para alguém da equipe ou registrar o pedido para retorno — você define as regras.',
  },
]

function StepVisualAssistants() {
  return (
    <div className="absolute left-7 right-0 top-6 overflow-hidden rounded-tl-xl border border-r-0 border-slate-200 bg-white shadow-sm sm:left-8">
      <AssistantsTableMock />
    </div>
  )
}

function StepVisualBehaviour() {
  return (
    <div className="absolute left-7 right-0 top-6 overflow-hidden rounded-tl-xl border border-r-0 border-slate-200 bg-white p-4 font-sans shadow-sm sm:left-8">
      <div className="flex gap-4 border-b border-slate-100 text-[12px]">
        <span className="border-b-2 border-slate-900 pb-1.5 font-medium text-slate-900">Comportamento</span>
        <span className="pb-1.5 text-slate-500">Técnico</span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <AbilityRow icon={Sparkles} title="Essenciais" state="chevron" chip="Roberta" />
        <AbilityRow icon={CircleHelp} title="Responder perguntas" state="chevron" chip="Informações da empresa adicionadas" />
        <AbilityRow icon={PhoneForwarded} title="Transferir ligações" desc="Encaminhe para sua equipe." />
        <AbilityRow icon={Mail} title="Enviar e-mail" desc="E-mails com os dados da ligação." />
      </div>
    </div>
  )
}

function StepVisualPhone() {
  return (
    <div className="absolute inset-x-0 top-6 flex justify-center">
      {/* 05.png: celular de 183px de largura, cortado logo abaixo dos botões pela base do cartão */}
      <div className="h-[320px]">
        <PhoneCallMock seconds={16} name="Assistente IA" className="w-[183px]" />
      </div>
    </div>
  )
}

export default function HomePage() {
  const loc = useLocation()
  const isProduct = loc.pathname.startsWith('/produtos')
  usePageTitle(isProduct ? 'Assistente telefônico IA' : 'Kloel AI — Assistente telefônico com IA', { full: !isProduct })

  return (
    <main className="font-site">
      {/* HERO */}
      {/* medidas da referência 01.png (janela útil de 1460×917, medidas por pixels): selo 150–184, H1 a partir de 200,
          orbe de ~156px a partir de 377, cartão 583–703, "Agendar uma demo" 724–738, avatares 808–845 */}
      <section className="relative isolate overflow-hidden pb-12 pt-14 sm:pb-16 sm:pt-[78px]">
        <AuroraBackground variant="ribbon" />
        <Container className="relative flex flex-col items-center text-center">
          <PillBadge>Assistentes de IA por Voz e WhatsApp para PMEs</PillBadge>
          <SectionTitle as="h1" size="hero" title="Nunca mais perca uma ligação de um cliente" className="mt-5 max-w-[660px] sm:mt-4" />
          {/* caixa do vídeo da esfera (200 px, -my-6) com a esfera de 164 px centrada no mesmo ponto da referência */}
          <HeroOrb className="my-9 sm:mb-[54px] sm:mt-[67px]" />
          <CallbackWidget source={isProduct ? 'produto-assistente-telefonico' : 'home'} linkClassName="sm:mt-4" />
          <HeroSocialProof className="mt-8 sm:mt-[60px]" />
        </Container>
      </section>

      {/* LOGOS — referência 02.png: faixa na largura da caixa do vídeo (x 154–1305 a 1460px), centro dos logos 185px acima do vídeo */}
      <section className="pb-6 pt-4">
        <Container size="lg" className="max-w-[1216px]">
          <LogoStrip gap={false} edge="5%" />
        </Container>
      </section>

      {/* VÍDEO / TOUR — caixa de 1152×648 (02.png / Video Play.png), botões 33px abaixo */}
      <section className="py-10 sm:pb-16 sm:pt-[139px]" id="tour">
        <Container size="lg" className="max-w-[1216px]">
          <ProductVideo scenes={VOICE_TOUR} variant="voice" tourTitle="Tour pela plataforma" />
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <CtaLink to="/criar-conta">Comece agora</CtaLink>
            <CtaLink to="/agendar-demo" variant="outline">Agendar demo</CtaLink>
          </div>
        </Container>
      </section>

      {/* AVALIAÇÕES */}
      {/* referência 04.png (1460px): 4 cartões entre x≈70 e x≈1390 (≈1320px úteis), espaço de 16px, topo dos cartões 50px abaixo do
          título, 320px de altura, texto 16/24 */}
      <TestimonialsSection id="depoimentos" containerClassName="max-w-[1384px]" listClassName="xl:mt-[47px]" cardClassName="xl:min-h-[320px] [&_blockquote]:leading-6" />

      {/* 3 PASSOS */}
      {/* 04.png → 05.png: base dos cartões de avaliação → topo do título dos passos = 220px */}
      <StepsSection
        className="sm:pt-[116px]"
        containerSize="wide"
        subtitleClassName="sm:text-[16px] sm:leading-6"
        gridClassName="sm:mt-[63px]"
        title={<>Seu assistente, pronto para<br className="hidden sm:block" /> ser testado em 30 segundos</>}
        subtitle="Configuração simples, sem precisar de TI ou conhecimentos técnicos."
        items={[
          { title: 'Crie seu assistente', text: 'Escolha o nome, a voz e o idioma. Configure em minutos, sem precisar de códigos.', visual: <StepVisualAssistants /> },
          { title: 'Defina o que ele faz', text: 'Atendimento, agendamento, qualificação, transferência... Você decide o fluxo.', visual: <StepVisualBehaviour /> },
          { title: 'Ative o número e pronto', text: 'Seu assistente no ar, já pronto para atender todas as ligações pelo número da Kloel.', visual: <StepVisualPhone /> },
        ]}
      />

      {/* CASOS DE USO */}
      {/* 06.png (1460px): conteúdo em x 70–1390 (1320px), subtítulo 16/24, botão 44px abaixo do topo do título, colunas a cada 451px */}
      <Section background="gray" id="casos-de-uso" className="sm:pb-20">
        <Container className="max-w-[1384px]">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <SectionTitle
              align="left"
              title="Casos de uso"
              subtitle="Nosso assistente de voz com IA se adapta com flexibilidade às suas necessidades e se integra perfeitamente a sistemas como agendas e CRM. Coloque sua operação telefônica no piloto automático!"
              subtitleClassName="max-w-[560px] text-[16px] leading-6 sm:text-[16px] sm:leading-6"
            />
            <CtaLink to="/criar-conta" className="shrink-0 md:mt-[44px]">Crie sua conta</CtaLink>
          </div>
          <div className="mt-14 grid gap-x-[33px] gap-y-12 sm:mt-12 sm:grid-cols-2 sm:gap-y-[38px] lg:grid-cols-3">
            {USE_CASES.map((u) => {
              const head = (
                <span className="flex items-center gap-2.5 text-[18px] font-medium leading-7 tracking-[-0.15px] text-heading">
                  <u.icon className="h-5 w-5 shrink-0" />
                  {u.title}
                  {u.to && <ArrowUpRight className="h-4 w-4 text-ink transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />}
                </span>
              )
              return (
                <div key={u.title} className="flex flex-col gap-3">
                  {u.to ? (
                    <Link to={u.to} className="group w-fit hover:text-brand-blue">
                      {head}
                    </Link>
                  ) : (
                    head
                  )}
                  {u.text && <p className="max-w-[345px] text-[16px] leading-6 text-body">{u.text}</p>}
                </div>
              )
            })}
          </div>
        </Container>
      </Section>

      {/* INTEGRAÇÕES */}
      <IntegrationsShowcase
        title="Integra-se às suas ferramentas"
        subtitle="Explore mais de 100 integrações da Kloel que conectam seus assistentes de IA às suas ferramentas favoritas, sem precisar programar."
      />

      {/* HISTÓRIAS */}
      {/* 7.png: título 166px abaixo da base do botão "Ver todas as integrações" */}
      <CustomerCases containerSize="wide" className="sm:pt-[112px]" />

      {/* FAQ */}
      {/* 8.png: 1ª pergunta 90px abaixo do topo do título; última pergunta → título do CTA: 216px */}
      <Section id="perguntas-frequentes" className="sm:pb-[79px]">
        <Container size="md">
          <FaqAccordion title="Perguntas frequentes" items={FAQ} className="mx-auto max-w-[640px]" titleClassName="sm:mb-8 sm:[&_h2]:text-[35px] sm:[&_h2]:leading-[42px] sm:[&_h2]:tracking-[-0.35px]" />
        </Container>
      </Section>

      <FinalCta
        title={<>Atendimento por voz<br className="hidden sm:block" /> reinventado, com a Kloel</>}
        subtitle="Teste a Kloel e veja como nosso assistente de IA por voz automatiza suas ligações e libera sua equipe. Simples, eficiente e 24 horas por dia."
        primary={{ label: 'Criar minha própria IA agora', to: '/criar-conta' }}
      />
    </main>
  )
}
