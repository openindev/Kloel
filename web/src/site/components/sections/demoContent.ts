/**
 * Conteúdo ilustrativo do site público (módulo site-core): empresas, pessoas, depoimentos e números que preservam a composição
 * visual da referência sem atribuir à Kloel clientes ou resultados da Fonio. Nenhum selo nas páginas (E1); a nota única
 * sobre depoimentos e empresas ilustrativos fica na página Contato, coluna "Sobre a Kloel" do rodapé.
 */

export interface DemoLogo {
  name: string
  /** forma do ícone (desenho vetorial simples, sem marca real) */
  glyph: 'tooth' | 'square' | 'heart' | 'leaf' | 'house' | 'paw' | 'bolt' | 'cross' | 'wave' | 'star'
  color: string
  accent?: string
  /** estilo do texto */
  style?: 'bold' | 'serif' | 'italic' | 'wide'
}

export const DEMO_LOGOS: DemoLogo[] = [
  { name: 'Clínica Bem Viver', glyph: 'cross', color: '#0EA5E9', accent: '#22C55E', style: 'bold' },
  { name: 'Odonto Sorriso', glyph: 'tooth', color: '#2563EB', style: 'wide' },
  { name: 'Grupo Horizonte', glyph: 'wave', color: '#475569', accent: '#EAB308', style: 'bold' },
  { name: 'Lar Novo Imóveis', glyph: 'house', color: '#7C3AED', style: 'serif' },
  { name: 'Rota Sul Auto', glyph: 'heart', color: '#1D4ED8', accent: '#F59E0B', style: 'italic' },
  { name: 'Pet Amigo', glyph: 'paw', color: '#DC2626', style: 'bold' },
  { name: 'Estúdio Forma', glyph: 'bolt', color: '#0F766E', style: 'wide' },
  { name: 'Contábil Prisma', glyph: 'square', color: '#9333EA', accent: '#EC4899', style: 'bold' },
  { name: 'Verde Vale Orgânicos', glyph: 'leaf', color: '#16A34A', style: 'serif' },
  { name: 'Estrela Turismo', glyph: 'star', color: '#EA580C', style: 'italic' },
]

export interface DemoTestimonial {
  quote: string
  name: string
  role: string
  stars?: number
}

/** 4 avaliações no formato da seção "Avaliações dos nossos clientes". */
export const DEMO_TESTIMONIALS: DemoTestimonial[] = [
  {
    quote: 'Nossa assistente atende todas as ligações da recepção e manda o resumo de cada uma por e-mail. Nenhum paciente fica mais sem retorno.',
    name: 'Carla Menezes',
    role: 'Gestora, Clínica Bem Viver',
  },
  {
    quote: 'Passamos a atender 24 horas por dia sem aumentar a equipe. O custo ficou muito abaixo do que pagaríamos por um plantão.',
    name: 'Ricardo Alves',
    role: 'Sócio, Odonto Sorriso',
  },
  {
    quote: 'Agendamento, qualificação e transferência acontecem sozinhos. A integração com a nossa agenda e o CRM funcionou de primeira.',
    name: 'Fernanda Lima',
    role: 'Diretora, Lar Novo Imóveis',
  },
  {
    quote: 'Não entendo nada de programação e configurei meu assistente de voz em menos de uma hora, seguindo o passo a passo.',
    name: 'Paulo Henrique',
    role: 'Empreendedor individual, Serviços de TI',
  },
]

export interface DemoCase {
  company: string
  segment: string
  quote: string
  metric: string
  logo: DemoLogo
  /** destino do cartão: a história correspondente em /casos-de-sucesso (?historia=) ou o filtro do setor (?setor=) */
  to?: string
}

export const DEMO_CASES: DemoCase[] = [
  {
    company: 'Condomínio Gestão Fácil',
    segment: 'Administradoras de condomínios',
    quote: 'Moradores conseguem abrir chamados por telefone a qualquer hora e a equipe recebe tudo organizado de manhã.',
    metric: '−60% de ligações perdidas',
    logo: { name: 'Gestão Fácil', glyph: 'house', color: '#111827', style: 'bold' },
    to: '/casos-de-sucesso?setor=Imobili%C3%A1rio',
  },
  {
    company: 'Odonto Sorriso',
    segment: 'Odontologia',
    quote: 'A assistente confirma consultas e remarca horários sem ocupar a recepção.',
    metric: '+35% de consultas confirmadas',
    logo: { name: 'Odonto Sorriso', glyph: 'tooth', color: '#2563EB', style: 'wide' },
    to: '/casos-de-sucesso?historia=odonto-sorriso',
  },
  {
    company: 'Loja Simples Online',
    segment: 'Comércio eletrônico',
    quote: 'Status de pedido e prazo de entrega agora são respondidos na hora, por telefone e WhatsApp.',
    metric: '24/7 de atendimento',
    logo: { name: 'Simples', glyph: 'bolt', color: '#0F0F16', style: 'wide' },
    to: '/casos-de-sucesso?setor=Varejo',
  },
]
