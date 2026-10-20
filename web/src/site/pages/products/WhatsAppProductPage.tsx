import { useState } from 'react'
import { Link } from 'react-router-dom'
import { QrCode } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WhatsAppIcon } from '@/components/brand/icons'
import {
  AuroraBackground, CardCarousel, Container, CtaLink, FaqAccordion, FinalCta, HeroSocialProof, IntegrationsShowcase, IntervalToggle, LogoStrip, PillBadge, PricingCards, Section,
  SectionTitle, TestimonialsSection, type BillingInterval, type DemoTestimonial,
} from '@/site/components/sections'
import { ProductVideo } from '@/site/components/tour/ProductVideo'
import { WHATSAPP_TOUR } from '@/site/components/tour/scenes'
import { HeroPhone, WA_BENEFIT_ILLUS } from './waParts'
import { AbilitiesList, EditAssistantHeader, FloatingTestBar, KnowledgeMock, MockSidebar, MockWindow, AssistantsTableMock } from '@/site/components/mocks/AppMocks'
import { KLOEL_WHATSAPP_TEST_URL } from '@/site/layout/nav'
import { usePageTitle } from '@/site/components/usePageTitle'

/* ---------------------------- Benefícios (7) ---------------------------- */

// ilustrações medidas em 03.png / 03b.png / 03c.png (waParts.tsx)
const BENEFITS: { title: string; text: string }[] = [
  { title: 'Responde em segundos', text: 'Sempre acessível e disponível para todos os seus clientes.' },
  { title: 'Agenda compromissos pelo chat', text: 'Com integração de calendário incorporada, a IA consegue gerenciar agendamentos de forma independente.' },
  { title: 'Conhece sua empresa de cabo a rabo', text: 'Depois de adicionar informações sobre seus serviços e ofertas, a IA responde exatamente como um dos seus funcionários.' },
  { title: 'Entende documentos e mensagens de voz', text: 'Entende informações de mensagens de voz ou PDFs e consegue responder a elas.' },
  { title: 'Envia resumos para sua equipe', text: 'Após cada conversa, a IA pode enviar uma transcrição ou resumo para o membro certo da equipe.' },
  { title: 'Entende e fala qualquer idioma', text: 'Reconhece e responde automaticamente no idioma do seu cliente.' },
  { title: 'Permite que você assuma o controle', text: 'Se necessário, sua equipe pode assumir a conversa e devolvê-la à IA depois.' },
]

/* ------------------------ Veja como funciona (sync) ------------------------ */

function HowPanel({ step }: { step: string }) {
  return (
    <MockWindow className="flex h-[340px]">
      <MockSidebar active={step === '1' ? 'Conhecimento' : 'Assistentes'} className="hidden sm:flex" />
      <div className="relative min-w-0 flex-1 overflow-hidden p-4">
        {step === '' && <AssistantsTableMock className="p-0" rows={[{ name: 'Marina', type: 'WhatsApp', conn: '+55 11 90000-0102' }, { name: 'Roberta', type: 'Voz', conn: '+55 11 90000-0101' }]} />}
        {step === '0' && (
          <div key="0" className="ks-fade-up">
            <EditAssistantHeader name="Marina" />
            <div className="mt-3 origin-top-left scale-[.92]"><AbilitiesList highlight={1} added={[1, 3]} name="Marina" compact kind="chat" /></div>
            <div className="absolute inset-x-0 top-3 flex justify-center"><div className="ks-pop rounded-md bg-slate-900 px-3 py-1.5 font-sans text-[11px] text-white">Assistente de chat criado</div></div>
          </div>
        )}
        {step === '1' && <KnowledgeMock key="1" className="ks-fade-up p-0" url="minhaempresa.com.br" progress={1} entries={5} />}
        {step === '2' && (
          <div key="2" className="ks-fade-up flex h-full flex-col items-center justify-center gap-4 font-sans">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900"><WhatsAppIcon className="h-5 w-5 text-[#25D366]" /> Compartilhe seu WhatsApp</div>
            <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-4">
              <QrCode className="h-20 w-20 text-slate-800" />
              <div className="text-[12px] text-slate-600">
                <div className="font-medium text-slate-900">wa.me/seu-numero</div>
                <div className="mt-1">Botão no site, Instagram ou cartão de visita</div>
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#25D366] px-2.5 py-1 text-[11px] font-medium text-white"><WhatsAppIcon className="h-3 w-3" /> Fale conosco</span>
              </div>
            </div>
          </div>
        )}
        <FloatingTestBar className="absolute bottom-3 left-1/2 -translate-x-1/2" items={['Ativar WhatsApp']} primary="Testar chat" />
      </div>
    </MockWindow>
  )
}

const HOW = [
  { q: 'Conecte o WhatsApp Business', a: 'Vincule sua conta existente do WhatsApp Business ou crie uma diretamente com seu número Kloel.' },
  { q: 'Adicione informações sobre seu negócio', a: 'Forneça à Kloel todas as informações sobre sua empresa automaticamente pela URL do seu site ou por PDFs enviados.' },
  { q: 'Ative seu chatbot', a: 'Compartilhe o número do WhatsApp com seus clientes, por exemplo, por um botão vinculado no seu site ou perfil de redes sociais.' },
]

const FAQ = [
  { q: 'Já uso o WhatsApp Business. Isso não basta?', a: 'O WhatsApp Business é apenas o aplicativo pelo qual sua equipe precisa responder manualmente a cada mensagem. O chatbot de WhatsApp da Kloel é uma IA que tira esse trabalho manual das mãos da sua equipe. Ele responde automaticamente a cada cliente.' },
  { q: 'Preciso de um novo número de WhatsApp?', a: 'A forma mais rápida e fácil é usar um número da Kloel. Você pode transferir seu número atual para a Kloel se desvinculá-lo do seu Perfil Comercial da Meta.' },
  { q: 'Quanto custa o chatbot com IA da Kloel para WhatsApp?', a: 'A partir de R$499/mês.' },
  { q: 'O chatbot com IA está em conformidade com a LGPD? Onde os dados são armazenados?', a: <>A Kloel trata dados conforme a LGPD. Informações sobre hospedagem e retenção ficam em <a className="text-brand-blue underline underline-offset-2" href="/ajuda/legal/protecao-de-dados" target="_blank" rel="noreferrer">Proteção de dados</a>.</> },
  { q: 'A IA consegue responder a todas as perguntas dos meus clientes?', a: 'O chatbot com IA responde com base nas informações que você forneceu, como PDFs ou seu site. Sua equipe pode assumir a conversa a qualquer momento, ou a IA pode transferir o chat automaticamente se não souber como continuar e depois retomá-lo.' },
  { q: 'É legal usar um chatbot com IA para responder minhas mensagens no WhatsApp?', a: 'Não há proibição de usar respostas automatizadas no WhatsApp, desde que você siga as políticas da Meta para contas comerciais e a LGPD no tratamento dos dados dos seus clientes.' },
  { q: 'Quanto tempo leva para configurar o chatbot com IA?', a: 'Leva apenas cerca de 5 minutos para configurar e ativar o chatbot com IA.' },
]

const WA_TESTIMONIALS: DemoTestimonial[] = [
  { quote: 'A configuração foi rápida e fácil. O que mais me surpreendeu foi que a IA responde às mensagens de forma muito natural, como se uma pessoa de verdade estivesse escrevendo do outro lado.', name: 'Bruno P.', role: 'Consultor autônomo, TI' },
  { quote: 'Administramos dezenas de imóveis. Antes, nosso WhatsApp era um caos de mensagens de inquilinos e proprietários. Agora a IA organiza tudo e só somos avisados quando necessário.', name: 'Aline B.', role: 'Administração de imóveis' },
  { quote: 'Nossas assistentes passavam metade do expediente respondendo às mesmas perguntas no WhatsApp. Agora o chatbot cuida disso.', name: 'Dra. Sandra M.', role: 'Dentista' },
  { quote: 'Perdíamos clientes porque não respondíamos rápido o suficiente no WhatsApp. Agora o assistente de IA resolve isso e as reservas aumentaram.', name: 'Marcos R.', role: 'Diretor, serviços residenciais' },
  { quote: 'Os pedidos chegam organizados e a equipe só entra quando o cliente precisa de algo especial.', name: 'Juliana T.', role: 'Gerente, confeitaria' },
  { quote: 'Os pacientes recebem resposta mesmo de madrugada. A agenda da semana fica cheia sem esforço.', name: 'Rafael C.', role: 'Sócio, clínica de fisioterapia' },
]

export default function WhatsAppProductPage() {
  usePageTitle('IA de WhatsApp')
  const [how, setHow] = useState('')
  const [interval, setInterval_] = useState<BillingInterval>('monthly')

  return (
    <main className="font-site">
      {/* HERO */}
      {/* 01.png a 1460 px: selo 80 px abaixo do header (34 px de altura), selo→título 31 px, subtítulo 16 px,
          subtítulo→botões 43 px, botões de 50 px, botões→celular 56 px, celular→prova social 285 px */}
      <section className="relative isolate overflow-hidden pb-12 pt-16 sm:pb-[51px] sm:pt-20">
        <AuroraBackground variant="ribbon" />
        <Container className="relative flex flex-col items-center text-center">
          <PillBadge className="py-[7px]" icon={<WhatsAppIcon className="h-[18px] w-[18px] text-[#25D366]" />}>Assistente de IA para o WhatsApp Business</PillBadge>
          <SectionTitle as="h1" size="hero" title="Responda a todo WhatsApp, mesmo quando sua equipe estiver ocupada." className="mt-6 max-w-[712px]" titleClassName="sm:[text-wrap:wrap]" subtitle="A IA gerencia seus chats do WhatsApp." subtitleClassName="sm:text-[16px] sm:leading-6" />
          <div className="mt-8 flex flex-wrap justify-center gap-3 sm:mt-10">
            {/* E4: abre a conversa real com o WhatsApp da Kloel, (11) 5286-3804, em nova aba (como o click-to-chat da Fonio, nota [37]) */}
            <a href={KLOEL_WHATSAPP_TEST_URL} target="_blank" rel="noopener noreferrer" className="inline-flex h-[50px] items-center rounded-xl bg-brand-blue px-[21px] text-[16px] text-white hover:bg-[#4a4fe6]" data-testid="wa-live-test">
              Teste em tempo real no WhatsApp
            </a>
            <CtaLink to="/agendar-demo" variant="outline" className="h-[50px] text-[16px]">Agende uma demonstração</CtaLink>
          </div>
          <div className="mt-14">
            <HeroPhone />
          </div>
          {/* prova social 3 px mais acima (01.png: título da prova social em y 848 a 1460 px); o pb compensa e a faixa de logos não se move */}
          <HeroSocialProof className="mt-[15px] sm:mt-3" />
        </Container>
      </section>

      <section className="pb-6 pt-2">
        <Container size="full"><LogoStrip /></Container>
      </section>

      {/* VÍDEO */}
      {/* 02.png: vídeo com 1152 px de largura (max-w-6xl), 166 px abaixo da faixa de logos; 03.png: botão de 48 px, rótulo de 15 px */}
      <section className="py-10 sm:pb-16 sm:pt-[100px]">
        <Container size="lg" className="max-w-[1216px]">
          <ProductVideo scenes={WHATSAPP_TOUR} variant="whatsapp" pillTitle="O chatbot com IA da Kloel para o WhatsApp" tourTitle="Chatbot de IA para WhatsApp" />
          <div className="mt-8 flex justify-center">
            <a href={KLOEL_WHATSAPP_TEST_URL} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center rounded-xl bg-heading px-[22px] text-[15px] text-white hover:bg-heading/90" data-testid="wa-start">
              Comece com o WhatsApp
            </a>
          </div>
        </Container>
      </section>

      {/* BENEFÍCIOS */}
      <Section id="beneficios">
        {/* 03.png / 03b.png / 03c.png: 3 cartões de 374 px com 16 px entre eles (1152 px), subtítulo de 16 px, ilustração sem caixa
            (o padrão de rabiscos some na base), conteúdo com 24 px de margem, título 20/28 e texto 16/24 a 8 px do título */}
        <Container size="lg" className="max-w-[1216px]">
          <SectionTitle title="Benefícios e funcionalidades" subtitle="Cuida do seu atendimento ao cliente no WhatsApp como um funcionário de verdade." subtitleClassName="sm:text-[16px] sm:leading-6" />
          <CardCarousel
            // setas de 48 px, 8 px entre elas, 25 px abaixo dos cartões (03b.png) — padrão do CardCarousel
            className="mt-10"
            label="Benefícios"
            gap={16}
            cardClassName="w-[86vw] sm:w-[374px] lg:w-[calc((100%-32px)/3)]"
            items={BENEFITS.map((b, i) => (
              <article key={b.title} className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-white">
                {WA_BENEFIT_ILLUS[i]}
                <div className="flex flex-col gap-2 p-6">
                  <h3 className="text-[20px] font-medium leading-7 tracking-[-0.15px] text-heading">{b.title}</h3>
                  <p className="text-[16px] leading-6 text-body">{b.text}</p>
                </div>
              </article>
            ))}
          />
        </Container>
      </Section>

      {/* VEJA COMO FUNCIONA */}
      {/* 04.png: 235 px entre a base do painel e o centro de "Planos & Preços" */}
      <Section id="como-funciona" className="sm:pb-[111px]">
        {/* 04.png–04c.png: colunas de 544 px com 64 px entre elas (1152 px), linhas de 67 px, resposta alinhada ao número */}
        <Container size="lg" className="max-w-[1216px]">
          <div className="grid items-start gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
            <div>
              <SectionTitle align="left" title="Veja como funciona" />
              <FaqAccordion className="mt-4 [&_h3>button]:py-[21px] [&_[role=region]>div]:px-0" numbered items={HOW} value={how} onValueChange={setHow} />
            </div>
            <HowPanel step={how} />
          </div>
        </Container>
      </Section>

      {/* PLANOS */}
      {/* 06.png: 160 px entre a nota de preços e o centro de "Integrações" */}
      <Section id="planos" className="sm:pb-[31px]">
        <Container>
          <SectionTitle title="Planos & Preços" size="hero" as="h2" />
          {/* 05.png: título→selo 14 px */}
          <div className="mt-[14px] flex flex-col items-center gap-6">
            <PillBadge>
              Garantia Risco Zero: Teste por 30 dias ou receba seu dinheiro de volta
            </PillBadge>
            <IntervalToggle value={interval} onChange={setInterval_} annualHint="Economize no anual" />
          </div>
          <PricingCards className="mt-12" product="whatsapp" interval={interval} />
          <div className="mt-10 flex flex-col items-center gap-4">
            <Link to="/agendar-demo" className="inline-flex h-12 items-center gap-3 rounded-xl border border-line bg-white px-5 text-[16px] text-ink hover:bg-slate-50">
              Fale com um especialista
              <span className="flex -space-x-2">
                {['bg-[#c7c9ff]', 'bg-[#bbf7d0]', 'bg-[#fde68a]'].map((c, i) => <span key={i} className={cn('h-7 w-7 rounded-full border-2 border-white', c)} />)}
              </span>
            </Link>
            <p className="text-[14px] text-slate-400">Preços netos, IVA não incluído</p>
          </div>
        </Container>
      </Section>

      <IntegrationsShowcase
        variant="grid"
        // 06.png: subtítulo de 16/24, grade de 447 px com 16 px entre os blocos (137×85), 32 px abaixo do subtítulo
        title="Integrações"
        subtitle={<>Conecte seu chatbot às suas ferramentas existentes.<br />Rápido, fácil e diretamente na Kloel.</>}
        names={['Stora', 'Baserow', 'Cal.com', 'Make', 'Airtable', 'eTermin', 'Slack', 'Google Sheets', 'n8n']}
      />

      <TestimonialsSection
        variant="carousel"
        containerSize="wide"
        // 07.png: cartões 50 px abaixo das pílulas, setas de 48 px
        listClassName="mt-[50px]"
        title={<>Por que as empresas<br />confiam em nós</>}
        pills={[<>Suporte em português</>, <>Conforme a LGPD</>]}
        items={WA_TESTIMONIALS}
      />

      {/* 08.png: 222 px entre a última pergunta e o título do CTA final */}
      <Section id="perguntas-frequentes" className="sm:pb-[78px]">
        <Container size="md">
          {/* coluna de 640px, como na home (referência 08.png: x 416–1055 a 1470px) */}
          {/* 08.png: título de 36 px (−0,9 px), 30 px acima da primeira pergunta */}
          <h2 className="mb-[30px] text-center text-[30px] font-medium leading-9 tracking-[-0.3px] text-heading sm:text-[36px] sm:leading-10 sm:tracking-[-0.9px]">Perguntas frequentes</h2>
          <FaqAccordion items={FAQ} className="mx-auto max-w-[640px]" />
        </Container>
      </Section>

      <FinalCta
        title="Nunca mais perca uma mensagem de cliente."
        subtitle={<span className="mx-auto block max-w-[600px]">Muitos clientes preferem mandar mensagem a ligar. A Kloel responde instantaneamente, entende áudios, lê documentos e nunca deixa uma mensagem sem resposta.</span>}
        primary={{ label: 'Automatize o WhatsApp agora', to: '/criar-conta' }}
      />
    </main>
  )
}
