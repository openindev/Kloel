import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { SITE_COMPANY, SITE_CONTACT } from '@/site/layout/nav'
import { usePageTitle } from '@/site/components/usePageTitle'
import { AvatarStack, Chip, FaqAccordion, FinalCtaBand, SiteHeading } from './kit'

const FAQ = [
  {
    q: 'Por que escolher a Kloel como assistente de voz com IA?',
    a: 'A Kloel foi pensada para pequenas e médias empresas brasileiras: configuração em minutos, vozes naturais em português, integração com agenda, WhatsApp e CRM e preços previsíveis. Você testa grátis antes de decidir.',
  },
  {
    q: 'Onde os dados são armazenados?',
    a: 'Os dados das conversas são tratados conforme a LGPD, com criptografia em trânsito e em repouso. Você define por quanto tempo as gravações e transcrições ficam guardadas e pode excluí-las a qualquer momento.',
  },
  {
    q: 'Onde e como a Kloel é desenvolvida?',
    a: 'A plataforma é desenvolvida por um time de produto e engenharia focado no mercado brasileiro, com ciclos curtos de entrega e melhorias contínuas a partir do retorno dos clientes.',
  },
  {
    q: 'Em quanto tempo posso ter o assistente telefônico pronto para uso?',
    a: 'Em poucos minutos: informe o site da sua empresa, revise as informações geradas, escolha uma voz e conecte um número. Configurações avançadas (integrações, transferências, campanhas) podem ser feitas depois, no seu ritmo.',
  },
  {
    q: 'E se a IA cometer erros?',
    a: 'Cada conversa fica registrada com resumo e transcrição para você revisar. Você pode corrigir respostas na base de conhecimento, ajustar o prompt e definir quando a ligação deve ser transferida para uma pessoa.',
  },
]

/** /contato — "Vamos conversar!" (OBSERVADO [244]–[246]; o topo de [244] é branco liso, sem manchas de aurora). */
export default function ContactPage() {
  usePageTitle('Contato')
  return (
    <main className="font-site">
      <section className="relative overflow-hidden">
        <div className="relative mx-auto flex max-w-[760px] flex-col items-center px-5 pb-24 pt-16 text-center sm:pb-32 sm:pt-20">
          <Chip>Contato</Chip>
          <SiteHeading as="h1" size="hero" className="mt-3 sm:mt-[14px]">Vamos conversar!</SiteHeading>
          <p className="mt-4 text-[18px] leading-7 text-neutral-900 sm:mt-[11px]">Como podemos te ajudar?</p>
          <AvatarStack names={['Ana Atendimento', 'Bruno Vendas', 'Carla Parcerias']} size="lg" className="mt-9 -space-x-2" />
          <div className="mt-9 flex w-full max-w-[448px] flex-col gap-3 sm:gap-2.5">
            <Link
              to="/agendar-demo?source=contact&productType=voice"
              className="group flex h-16 items-center justify-center gap-2.5 rounded-xl border border-line bg-white shadow-[0_1px_3px_rgba(15,15,22,.06)] text-[18px] text-ink transition-colors hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 sm:text-[20px]"
            >
              <span aria-hidden>💻</span>
              <span>
                Quero ser <b className="font-medium">cliente</b>
              </span>
            </Link>
            <Link
              to="/parceiros/agendar?source=contact"
              className="group flex h-16 items-center justify-center gap-2.5 rounded-xl border border-line bg-white shadow-[0_1px_3px_rgba(15,15,22,.06)] text-[18px] text-ink transition-colors hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 sm:text-[20px]"
            >
              <span aria-hidden>🤝</span>
              <span>
                Quero ser <b className="font-medium">parceiro</b>
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#F7F8FB] py-20 sm:pb-28 sm:pt-32">
        <div className="mx-auto max-w-[1360px] px-5">
          <SiteHeading className="text-center">Atuação nacional, com sede em {SITE_COMPANY.hq}</SiteHeading>
          <div className="mt-14 grid items-center gap-10 sm:mt-[65px] lg:grid-cols-[minmax(0,856px)_1fr]">
            <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-[radial-gradient(90%_90%_at_20%_20%,#E8E9FF_0%,#C7C9FF_35%,#8E92FF_70%,#585DFE_100%)]">
              <div className="absolute inset-0 bg-[repeating-linear-gradient(115deg,rgba(255,255,255,.12)_0_2px,transparent_2px_26px)]" />
              <div className="absolute bottom-6 left-6 rounded-xl bg-white/85 px-4 py-3 text-[15px] text-ink shadow backdrop-blur">
                <MapPin className="mr-1.5 inline h-4 w-4 text-brand-blue" /> Sede Kloel · {SITE_COMPANY.hq}
              </div>
            </div>
            <div className="relative flex flex-col gap-4 text-[17px] leading-6 text-body" data-testid="contact-company">
              <div className="text-[20px] font-medium leading-7 text-heading">{SITE_COMPANY.legalName}</div>
              <p>
                {SITE_COMPANY.addressLines[0]}
                <br />
                {SITE_COMPANY.addressLines[1]}
              </p>
              <p>
                CNPJ: {SITE_COMPANY.cnpj}
                <br />
                <a href={`mailto:${SITE_CONTACT.email}`} className="underline underline-offset-4 hover:text-brand-blue">{SITE_CONTACT.email}</a>
              </p>
              {/* E1: a única nota do site sobre depoimentos e empresas ilustrativos (página da coluna "Sobre a Kloel" do rodapé);
                  fora do fluxo no desktop para o bloco de texto continuar centrado na imagem como em [245] */}
              <p className="text-[13px] leading-5 text-slate-500 lg:absolute lg:left-0 lg:top-full lg:mt-6 lg:max-w-[420px]" data-testid="site-illustrative-note">
                Alguns depoimentos e empresas apresentados podem ser fictícios, para fins ilustrativos, ou reais, para demonstração de resultados.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[680px] px-5 py-20 sm:pb-20 sm:pt-28">
        {/* [246]: título do FAQ mais pesado que os H2 de seção (36 px/600, tracking-tight) e linhas de 59 px */}
        <h2 className="text-balance text-center text-[30px] font-semibold leading-9 tracking-[-0.75px] text-heading sm:text-[36px] sm:leading-10 sm:tracking-[-0.9px]">Perguntas frequentes</h2>
        <div className="mt-8 sm:mt-[33px]">
          <FaqAccordion items={FAQ} idPrefix="contato" className="[&_h3>button>svg]:h-3.5 [&_h3>button>svg]:w-3.5 [&_h3>button>svg]:-translate-y-1 [&_h3>button>svg]:text-slate-400" />
        </div>
      </section>

      <FinalCtaBand />
    </main>
  )
}
