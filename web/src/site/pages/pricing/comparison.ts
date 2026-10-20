import type { ProductKey } from '@/domain/types'

/**
 * Tabelas comparativas da página /planos.
 * - Assistente telefônico IA: OBSERVADO em [279]–[284] (valores demonstrativos; "fonio" → "Kloel").
 * - IA de WhatsApp e Webchat de IA: INFERIDO a partir dos cartões [291]/[292] (não há captura dessas tabelas).
 * Valor: true = ✓, false = ×, string = texto.
 */
export type Cell = boolean | string
export interface CompareRow {
  label: string
  info?: string
  values: [Cell, Cell, Cell]
}
export interface CompareGroup {
  title: string
  icon: 'gauge' | 'bot' | 'phone' | 'sparkles' | 'webhook' | 'life-buoy' | 'grid' | 'plus' | 'message' | 'palette'
  rows: CompareRow[]
}

const all = (v: Cell): [Cell, Cell, Cell] => [v, v, v]
const yes = all(true)

export const COMPARISON: Record<'voice' | 'whatsapp' | 'webchat', CompareGroup[]> = {
  voice: [
    {
      title: 'Uso',
      icon: 'gauge',
      rows: [
        { label: 'Minutos inclusos', values: ['1000', '3600', '6000+'] },
        { label: 'Contatos inclusos', values: ['1000', '3000', 'Personalizado'] },
        { label: 'Chamadas simultâneas', values: ['1', '3', 'Personalizado'] },
        { label: 'Usuários (acessos)', values: ['1', 'ilimitado', 'ilimitado'] },
        { label: 'Números de telefone inclusos', info: 'Números brasileiros fornecidos pela Kloel para receber e fazer ligações. Números extras podem ser contratados.', values: ['1', '3', 'Personalizado'] },
        { label: 'Integração de calendário', info: 'Quantidade de agendas (Google, Microsoft ou o agendador da Kloel) conectadas aos assistentes.', values: ['1', '3', 'Personalizado'] },
        { label: 'Ligações ativas e campanhas', info: 'Ligações feitas pelo assistente para a sua lista de contatos. Cobradas por minuto iniciado.', values: [false, 'Extra de R$0,24/min iniciado', 'Extra de R$0,24/min iniciado'] },
        { label: 'Integração SIP trunk', values: [false, true, true] },
      ],
    },
    {
      title: 'Assistentes',
      icon: 'bot',
      rows: [
        { label: 'Vozes', values: all('120+') },
        { label: 'Idiomas', values: all('60+') },
        { label: 'Voz personalizada', values: [false, false, true] },
        { label: 'Assistentes', values: all('ilimitado') },
      ],
    },
    {
      title: 'Telefonia',
      icon: 'phone',
      rows: [
        { label: 'Número de telefone padrão Kloel', values: yes },
        { label: 'Números outbound importados', values: [false, true, true] },
        { label: 'Transferência internacional de chamadas', values: yes },
      ],
    },
    {
      title: 'Recursos e configurações',
      icon: 'sparkles',
      rows: [
        { label: 'Dados da empresa via busca no site', info: 'Informe o endereço do seu site e o assistente aprende sobre a sua empresa automaticamente.', values: yes },
        { label: 'Base de conhecimento com aprendizado autônomo', info: 'Perguntas que o assistente não soube responder viram sugestões para completar a base de conhecimento.', values: yes },
        { label: 'Transferência de chamada', info: 'Encaminhe a ligação para uma pessoa da equipe quando necessário.', values: yes },
        { label: 'Agenda + reservas', info: 'O assistente consulta horários livres e marca compromissos durante a conversa.', values: yes },
        { label: 'Processamento preciso de informações', values: yes },
        { label: 'Termos técnicos', info: 'Cadastre palavras e nomes próprios para melhorar o reconhecimento de fala.', values: yes },
        { label: 'Busca na internet', values: yes },
        { label: 'Ajustar velocidade de fala', values: yes },
        { label: 'Ajustar sensibilidade', values: yes },
        { label: 'Ajustar criatividade', values: yes },
        { label: 'Ruídos de fundo', info: 'Som ambiente opcional (escritório, café) para deixar a ligação mais natural.', values: yes },
        { label: 'Desativar interrupção da mensagem inicial', values: yes },
        { label: 'Enviar códigos DTMF', info: 'O assistente pode “digitar” números no teclado durante a ligação (ex.: menus de URA).', values: yes },
      ],
    },
    {
      title: 'Controle de chamadas e API',
      icon: 'webhook',
      rows: [
        { label: 'Integrações nativas', info: 'Conexões prontas com agenda, CRM, planilhas e automação.', values: yes },
        { label: 'Webhook de entrada', values: yes },
        { label: 'Requisição de API durante a ligação', values: yes },
        { label: 'Requisição de API após a ligação', values: yes },
        { label: 'Extração de variáveis', info: 'Dados extraídos da conversa (nome, motivo, data) enviados para os seus sistemas.', values: yes },
      ],
    },
    {
      title: 'Operações e suporte',
      icon: 'life-buoy',
      rows: [
        { label: 'Login único (SSO)', info: 'Acesso com o provedor de identidade da sua empresa.', values: [false, false, true] },
        { label: 'Acordos contratuais personalizados', info: 'Contrato, SLA e condições de pagamento negociados individualmente.', values: [false, false, true] },
        { label: 'Academia de Integração', values: yes },
        { label: 'SLA individual', values: [false, false, true] },
        { label: 'Gerente de conta', values: [false, false, true] },
        { label: 'Acesso à comunidade', info: 'Grupo de clientes para trocar boas práticas e novidades.', values: yes },
        { label: 'Suporte', values: ['E-mail', 'Prioritário', 'Personalizado'] },
      ],
    },
    {
      title: 'Plataforma / Outros',
      icon: 'grid',
      rows: [
        { label: 'Excluir gravação automaticamente', values: yes },
        { label: 'Teste de áudio grátis', info: 'Teste o assistente no navegador sem consumir minutos.', values: yes },
        { label: 'Gravação de ligações', info: 'Gravações disponíveis em Conversas (quando ativadas e permitidas).', values: yes },
        { label: 'Modelos de prompt', values: yes },
        { label: 'Prompting avançado', values: yes },
        { label: 'Modo simplificado', info: 'Configuração guiada para quem está começando.', values: yes },
      ],
    },
    {
      title: 'Complementos',
      icon: 'plus',
      rows: [
        { label: 'Minutos extras', info: 'Compra automática ou manual de pacotes de minutos.', values: ['R$ 90 por 100 minutos', 'R$ 90 por 100 minutos', 'Personalizado'] },
        { label: 'Contatos adicionais', info: 'Pacotes adicionais de contatos armazenados.', values: ['1.000 contatos por R$120/mês', '1.000 contatos por R$120/mês', 'Personalizado'] },
        { label: 'Preço por número adicional', values: ['R$49/mês', 'R$49/mês', 'Personalizado'] },
        { label: 'Preço por conexão adicional', values: [false, 'R$ 30/ mês', 'Personalizado'] },
      ],
    },
  ],
  whatsapp: [
    {
      title: 'Uso',
      icon: 'gauge',
      rows: [
        { label: 'Conversas por mês', values: ['450', '2.000', '5.000+'] },
        { label: 'Números de WhatsApp', values: ['1', '3', 'Personalizado'] },
        { label: 'Integrações de calendário', values: ['1', '3', 'Sob medida'] },
        { label: 'Usuários (acessos)', values: ['1', 'ilimitado', 'ilimitado'] },
        { label: 'Assistentes', values: all('ilimitado') },
      ],
    },
    {
      title: 'Funcionalidades',
      icon: 'sparkles',
      rows: [
        { label: 'Transferência para humano', info: 'A conversa passa para a sua equipe na Caixa de entrada quando necessário.', values: yes },
        { label: 'Agendamento automatizado', info: 'A IA oferece horários livres e confirma o agendamento no próprio WhatsApp.', values: yes },
        { label: 'Onboarding', info: 'Sessão de configuração acompanhada pela equipe Kloel.', values: [false, true, true] },
        { label: 'Retenção zero de dados', values: [false, false, true] },
        { label: 'SLA personalizado', values: [false, false, true] },
      ],
    },
    {
      title: 'Complementos',
      icon: 'plus',
      rows: [
        { label: 'Número de WhatsApp adicional', values: ['R$114/mês', 'R$114/mês', 'Personalizado'] },
        { label: 'Integração de calendário adicional', values: ['R$36/mês', 'R$36/mês', 'Personalizado'] },
      ],
    },
  ],
  webchat: [
    {
      title: 'Uso',
      icon: 'gauge',
      rows: [
        { label: 'Conversas por mês', info: 'Uma conversa é uma sessão de chat com um visitante.', values: ['100', '400', '2.000+'] },
        { label: 'Mensagens por mês', values: ['1.000', '4.000', '20.000+'] },
        { label: 'Webchats de IA', values: all('ilimitado') },
        { label: 'Usuários (acessos)', values: ['1', 'ilimitado', 'ilimitado'] },
        { label: 'Marca no widget', values: ['Com tecnologia da kloel.ai', 'Sem marca', 'Sem marca'] },
      ],
    },
    {
      title: 'Funcionalidades',
      icon: 'sparkles',
      rows: [
        { label: '60+ idiomas', values: yes },
        { label: 'Personalização visual', values: yes },
        { label: 'Envio de PDFs e imagens', values: [false, true, true] },
        { label: 'Agendamento de compromissos', values: [false, true, true] },
        { label: 'Transferência para um humano', values: [false, true, true] },
        { label: 'Exportação de conversas', values: [false, true, true] },
        { label: 'Contexto da página', info: 'A IA sabe em qual página do site o visitante está.', values: [false, false, true] },
        { label: 'Retenção zero de dados', values: [false, false, true] },
        { label: 'Rastreamento de UTM', values: [false, false, true] },
        { label: 'SLA individual', values: [false, false, true] },
      ],
    },
  ],
}

/** Textos dos ⓘ dos cartões (INFERIDO — os tooltips não foram capturados abertos). */
export const CARD_INFO: Record<string, string> = {
  'Agenda + reservas': 'O assistente consulta horários livres e marca compromissos durante a ligação.',
  'Tronco SIP dedicado': 'Conecte sua central telefônica (PABX) existente à Kloel via SIP.',
  'Ligações ativas': 'O assistente liga para seus contatos (campanhas). Cobrança extra por minuto iniciado.',
  'A partir de 6000 minutos': 'Volume de minutos definido sob medida para a sua operação.',
  'Transferência para humano': 'A conversa passa para a sua equipe quando necessário.',
  'Agendamento automatizado': 'A IA oferece horários livres e confirma o agendamento no próprio WhatsApp.',
  Onboarding: 'Sessão de configuração acompanhada pela equipe Kloel.',
  '100 conversas': 'Uma conversa é uma sessão de chat com um visitante do seu site.',
  '400 conversas': 'Uma conversa é uma sessão de chat com um visitante do seu site.',
  '2.000+ conversas': 'Volume definido sob medida para o seu tráfego.',
}

export const PRODUCT_TABS: { key: Extract<ProductKey, 'voice' | 'whatsapp' | 'webchat'>; label: string; short: string }[] = [
  { key: 'voice', label: 'Assistente telefônico IA', short: 'Telefone' },
  { key: 'whatsapp', label: 'IA de WhatsApp', short: 'WhatsApp' },
  { key: 'webchat', label: 'Webchat de IA', short: 'Webchat' },
]

/**
 * Diferenças OBSERVADAS entre a página pública e o catálogo do app.
 * O preço anual público do Webchat (R$250/R$750 em [295], contra R$249/R$749 no app [447]/[448]) agora vem do
 * catálogo compartilhado (`PlanDef.publicAnnual`); as páginas públicas exibem `plan.publicAnnual ?? plan.annual`
 * (ver `publicPlanPrice` em PricingCards.tsx).
 * O Scale do Webchat é anunciado como "Ideal a partir de 3.000 conversas/mês" em [292] (o catálogo usa 2.000).
 */
export const PUBLIC_TAGLINE_OVERRIDE: Partial<Record<'voice' | 'whatsapp' | 'webchat', Partial<Record<'solo' | 'team' | 'scale', string>>>> = {
  webchat: { scale: 'Ideal a partir de 3.000 conversas/mês' },
}
