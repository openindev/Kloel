import type { ReactNode } from 'react'

/**
 * Conteúdo da página "Torne-se um parceiro" (/parceiros), adaptado de [251]–[273].
 * Percentuais e faixas reproduzem a ESTRUTURA observada (valores ilustrativos, sem selos na página — E1).
 * Depoimentos, nomes e empresas ilustrativos.
 */

/** "\n" = quebra de linha da referência [251] (aplicada só no desktop, com os 5 cartões lado a lado). */
export const ADVANTAGES = [
  'Receba até 35% de\ncomissão sobre\nas vendas',
  'Ganhe para sempre',
  'Você ou a Kloel emite\na fatura',
  'Co-branding possível\n(powered by Kloel)',
  'Minutos gratuitos de\ndemonstração incluídos\n(ampliáveis)',
]

export interface Tier {
  name: string
  revenue: string
  pct: string
  cap: string
  details: string[]
}

export const TIERS_REFER: Tier[] = [
  { name: 'Bronze', revenue: 'Entrada', pct: '15%', cap: 'R$ 5.999', details: ['15% de comissão sobre cada fatura paga pelos clientes indicados', 'Conta de parceiro gratuita com minutos de demonstração', 'Acesso aos materiais de venda na Central de Ajuda'] },
  { name: 'Silver', revenue: 'R$ 30.000+', pct: '20%', cap: 'R$ 11.999', details: ['20% de comissão recorrente', 'Materiais de co-branding (powered by Kloel)', 'Suporte por e-mail prioritário para parceiros'] },
  { name: 'Gold', revenue: 'R$ 60.000+', pct: '25%', cap: 'R$ 59.999', details: ['25% de comissão recorrente', 'Gerente de parceria dedicado', 'Treinamento técnico para a sua equipe'] },
  { name: 'Platinum', revenue: 'R$ 240.000+', pct: '30%', cap: 'R$ 269.999', details: ['30% de comissão recorrente', 'Leads compartilhados por região ou segmento', 'Acesso antecipado a novos produtos'] },
  { name: 'Diamond', revenue: 'R$ 780.000+', pct: '35%', cap: 'Ilimitado', details: ['35% de comissão vitalícia', 'Condições enterprise e contratos personalizados', 'Planejamento comercial conjunto com a Kloel'] },
]

export const TIERS_RESELL: Tier[] = TIERS_REFER.slice(1).map((t) => ({
  ...t,
  details: [t.details[0]!.replace('de comissão recorrente', 'de desconto na compra das licenças').replace('de comissão vitalícia', 'de desconto na compra das licenças'), 'Você define o preço final e emite a nota fiscal', ...t.details.slice(1)],
}))

export interface FakeTestimonial {
  quote: string
  name: string
  company: string
}

export const PARTNER_TESTIMONIALS: FakeTestimonial[] = [
  {
    quote: 'Trabalhamos com automação de atendimento há anos, e a Kloel virou o centro da nossa oferta. Configuramos assistentes para clínicas e escritórios em poucos dias e a receita recorrente cresce todo mês.',
    name: 'Rafael Moura',
    company: 'Agência Conecta IA',
  },
  {
    quote: 'As indicações viraram uma fonte de renda regular sem nenhum esforço extra. Apresento a Kloel aos meus clientes de consultoria e a equipe da Kloel cuida do resto.',
    name: 'Juliana Prado',
    company: 'Prado Consultoria Digital',
  },
  {
    quote: 'Para nós não é um programa de parceiros clássico: é uma colaboração de igual para igual. Revendemos com a nossa marca, o suporte é rápido e no fim quem ganha são os nossos clientes.',
    name: 'Marcos Vieira',
    company: 'Atende+ Telecom',
  },
  {
    quote: 'Essa base me permitiu ampliar bastante a oferta para os meus clientes.',
    name: 'Beatriz Nunes',
    company: 'Nunes Automação',
  },
]

export type FaqTab = 'geral' | 'indicar' | 'revender'

export function partnerFaq(openCustom: () => void): Record<FaqTab, { q: string; a: ReactNode }[]> {
  const ownServices = {
    q: 'Posso vender meus próprios serviços em paralelo?',
    a: 'Sim. Consultoria, implementação e integrações são cobradas por você, à parte. A Kloel cuida apenas do produto e do suporte. Se preferir faturar tudo em uma única nota, escolha a opção Revender.',
  }
  return {
    geral: [
      {
        q: 'Indicar e revender — qual é a diferença?',
        a: (
          <>
            <b className="font-medium text-ink">Indicar:</b> você indica o cliente e a Kloel cuida da cobrança, do onboarding e do suporte. Você recebe de 15 a 35% de comissão.
            <br />
            <b className="font-medium text-ink">Revender:</b> você compra a Kloel com 20 a 35% de desconto, define o seu próprio preço e emite a nota fiscal.
          </>
        ),
      },
      {
        q: 'E se nenhuma opção servir?',
        a: (
          <>
            Deixe os seus dados no formulário de parceria personalizada e combinamos um acordo sob medida.{' '}
            <button type="button" onClick={openCustom} className="text-brand-blue underline underline-offset-2">
              Abrir formulário
            </button>
          </>
        ),
      },
      {
        q: 'Quando e como recebo minha comissão?',
        a: (
          <>
            A partir de um saldo de R$ 600 em comissões você pode solicitar o pagamento a qualquer momento: basta escrever para{' '}
            <a href="mailto:parceiros@kloel.ai" className="text-brand-blue underline underline-offset-2">
              parceiros@kloel.ai
            </a>{' '}
            e fazemos a transferência.
          </>
        ),
      },
      ownServices,
      { q: 'Como funciona a conta de parceiro gratuita?', a: 'Você começa sem custo e já pode conquistar clientes. Trazendo pelo menos um cliente nos três primeiros meses, a conta continua gratuita.' },
      { q: 'A conta de parceiro gratuita inclui minutos?', a: 'Sim. Ela inclui um volume mensal de minutos gratuitos para demonstrações. Se precisar de mais, é possível adicionar minutos pagos a qualquer momento.' },
      {
        q: 'Existem treinamentos ou materiais de venda?',
        a: (
          <>
            Sim. Todos os materiais e treinamentos ficam na{' '}
            <a href="/ajuda/home/partner-academy" target="_blank" rel="noreferrer" className="text-brand-blue underline underline-offset-2">
              Central de Ajuda
            </a>
            , dentro da plataforma.
          </>
        ),
      },
    ],
    indicar: [
      ownServices,
      { q: 'A comissão é vitalícia?', a: 'Sim. Você recebe a comissão enquanto o cliente indicado continuar usando a Kloel.' },
      { q: 'Como funcionam os níveis de parceiro?', a: 'Você começa com 15% de comissão e pode chegar a 35%. Quanto maior o faturamento gerado pelos seus clientes, maior a comissão.' },
    ],
    revender: [
      {
        q: 'Posso obter diretamente um desconto maior na compra?',
        a: (
          <>
            Sim, com um volume mensal ou anual fixo.{' '}
            <button type="button" onClick={openCustom} className="text-brand-blue underline underline-offset-2">
              Deixe seu contato
            </button>{' '}
            e conversamos individualmente.
          </>
        ),
      },
      { q: 'Cada cliente precisa ter sua própria conta?', a: 'Sim. Cada cliente recebe uma conta própria na Kloel, com a assinatura fornecida por você.' },
      { q: 'Quais são minhas responsabilidades como revendedor?', a: 'Você emite a fatura e oferece o suporte de primeiro nível. Se quiser, assume toda a comunicação com o cliente — e, se o cliente nos procurar diretamente, ajudamos do mesmo jeito.' },
      { q: 'Como funcionam os níveis de parceiro?', a: 'Você começa com 20% de desconto e pode chegar a 35%. Quanto mais licenças vender, maior o desconto.' },
    ],
  }
}
