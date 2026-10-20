import { INTEGRATIONS, type CatalogIntegration, type IntegrationCategory } from '@/data/catalogs/integrations'

/**
 * Diretório público de integrações (/integracoes) — OBSERVADO [16]–[24]: 9 categorias, 34 cartões, textos literais
 * ("fonio" → "Kloel"). Cada cartão é cruzado com o catálogo do app (src/data/catalogs/integrations.ts, 113 itens)
 * pelo `catalogSlug`, para oferecer o próximo passo real (configurar no app, ler o guia ou pedir acesso antecipado).
 */
export const DIRECTORY_CATEGORIES = [
  { id: 'agenda-e-reservas', label: 'Agenda e reservas', icon: 'calendar' },
  { id: 'comunicacao-e-mensagens', label: 'Comunicação e mensagens', icon: 'message' },
  { id: 'crm-e-vendas', label: 'CRM e vendas', icon: 'contact' },
  { id: 'e-commerce', label: 'E-commerce', icon: 'bag' },
  { id: 'imoveis', label: 'Imóveis', icon: 'building' },
  { id: 'produtividade-e-conhecimento', label: 'Produtividade e conhecimento', icon: 'sparkles' },
  { id: 'restaurantes-e-hotelaria', label: 'Restaurantes e hotelaria', icon: 'utensils' },
  { id: 'saude-e-farmacia', label: 'Saúde e farmácia', icon: 'stethoscope' },
  { id: 'saude-e-fitness', label: 'Saúde e fitness', icon: 'heart' },
] as const

export type DirectoryCategoryId = (typeof DIRECTORY_CATEGORIES)[number]['id']

export interface DirectoryItem {
  name: string
  category: DirectoryCategoryId
  soon?: boolean
  description: string
  catalogSlug?: string
  /** Item vindo do catálogo do app (não aparece no diretório público da referência): fica atrás de "Carregar mais". */
  extra?: boolean
  /** Status "acesso antecipado" do catálogo do app (só para itens `extra`). */
  earlyAccess?: boolean
}

export const DIRECTORY: DirectoryItem[] = [
  { name: 'SimplyBook.me', category: 'agenda-e-reservas', catalogSlug: 'simplybook-me', description: 'Verificar a disponibilidade e agendar compromissos no SimplyBook.me enquanto o cliente está na linha.' },
  { name: 'Google Calendar', category: 'agenda-e-reservas', catalogSlug: 'google-calendar', description: 'Verificar a disponibilidade, agendar o compromisso e enviar a confirmação, tudo durante a ligação.' },
  { name: 'Calendly', category: 'agenda-e-reservas', catalogSlug: 'calendly', description: 'Agendar compromissos durante a ligação, verificando a disponibilidade e enviando links de confirmação.' },
  { name: 'Cal.com', category: 'agenda-e-reservas', catalogSlug: 'cal-com', description: 'Marcar reuniões na hora, com horários disponíveis em tempo real durante a conversa.' },
  { name: 'eTermin', category: 'agenda-e-reservas', catalogSlug: 'etermin', description: 'Agendar e gerenciar compromissos pelo sistema de agendamento online do eTermin.' },
  { name: 'WhatsApp Business', category: 'comunicacao-e-mensagens', catalogSlug: 'whatsapp-business', description: 'Responder mensagens no WhatsApp, qualificar contatos e agendar compromissos na mesma conversa.' },
  { name: 'Slack', category: 'comunicacao-e-mensagens', catalogSlug: 'slack', description: 'Enviar resumos de ligações, alertas e tarefas de acompanhamento para os canais da equipe em tempo real.' },
  { name: 'Teamleader', category: 'crm-e-vendas', catalogSlug: 'teamleader', description: 'Consultar e atualizar contatos no Teamleader e registrar a ligação no cadastro.' },
  { name: 'Pipedrive', category: 'crm-e-vendas', catalogSlug: 'pipedrive', description: 'Encontrar e atualizar contatos e negócios no Pipedrive, com o resumo da ligação salvo no registro.' },
  { name: 'GoHighLevel', category: 'crm-e-vendas', catalogSlug: 'gohighlevel', description: 'Consultar e atualizar dados de contatos no meio da ligação e salvar o resumo no registro.' },
  { name: 'Odoo', category: 'crm-e-vendas', catalogSlug: 'odoo', description: 'Ler e atualizar dados de clientes no seu ERP Odoo durante a ligação e salvar o resumo no registro.' },
  { name: 'Livespace', category: 'crm-e-vendas', catalogSlug: 'livespace', description: 'Criar e atualizar leads no Livespace, com o resumo da ligação salvo no registro.' },
  { name: 'HubSpot', category: 'crm-e-vendas', soon: true, catalogSlug: 'hubspot', description: 'Consultar contatos no HubSpot durante a ligação e salvar o resumo no registro.' },
  { name: 'BaseLinker', category: 'e-commerce', catalogSlug: 'baselinker', description: 'Verificar o status de pedidos e envios no BaseLinker enquanto o cliente está na linha.' },
  { name: 'WooCommerce', category: 'e-commerce', catalogSlug: 'woocommerce', description: 'Consultar pedidos e dados de clientes da sua loja WooCommerce no meio da ligação.' },
  { name: 'Wix', category: 'e-commerce', soon: true, description: 'Verificar reservas e o status de pedidos do seu site Wix enquanto o cliente está na linha.' },
  { name: 'IdoSell', category: 'e-commerce', soon: true, catalogSlug: 'idosell', description: 'Informar o status de pedidos e entregas de lojas IdoSell sem que ninguém precise atender.' },
  { name: 'Stora', category: 'imoveis', catalogSlug: 'stora', description: 'Tirar dúvidas sobre boxes de armazenagem e registrar pedidos de locação no Stora durante a ligação.' },
  { name: 'onOffice', category: 'imoveis', catalogSlug: 'onoffice', description: 'Consultar imóveis e registrar novos interessados no onOffice direto da ligação.' },
  { name: 'Win-CASA', category: 'imoveis', catalogSlug: 'wincasa', description: 'Consultar dados de imóveis e inquilinos no meio da ligação, direto do seu sistema Win-CASA.' },
  { name: 'Hostaway', category: 'imoveis', catalogSlug: 'hostaway', description: 'Responder dúvidas sobre reservas e atualizá-las no Hostaway durante a ligação.' },
  { name: 'Xero', category: 'produtividade-e-conhecimento', catalogSlug: 'xero', description: 'Consultar dados de clientes e faturas no Xero enquanto o cliente está na linha.' },
  { name: 'Notion', category: 'produtividade-e-conhecimento', catalogSlug: 'notion', description: 'Consultar informações no Notion ou salvar anotações da ligação em um banco de dados durante a conversa.' },
  { name: 'Make', category: 'produtividade-e-conhecimento', catalogSlug: 'make', description: 'Disparar cenários do Make a partir das suas ligações e conectar a Kloel a milhares de apps.' },
  { name: 'Google Maps', category: 'produtividade-e-conhecimento', catalogSlug: 'google-address-validation', description: 'Confirmar o endereço de quem liga no Google Maps enquanto a ligação acontece.' },
  { name: 'Airtable', category: 'produtividade-e-conhecimento', catalogSlug: 'airtable', description: 'Consultar registros ou adicionar novas linhas a uma base do Airtable durante a ligação.' },
  { name: 'n8n', category: 'produtividade-e-conhecimento', catalogSlug: 'n8n', description: 'Disparar fluxos automatizados e conectar centenas de serviços via n8n.' },
  { name: 'Google Sheets', category: 'produtividade-e-conhecimento', catalogSlug: 'google-sheets', description: 'Ler linhas de uma planilha ou adicionar novas linhas antes, durante ou depois da ligação.' },
  { name: 'Baserow', category: 'produtividade-e-conhecimento', catalogSlug: 'baserow', description: 'Consultar registros de clientes ou adicionar linhas a uma tabela do Baserow durante as conversas.' },
  { name: 'TheFork', category: 'restaurantes-e-hotelaria', catalogSlug: 'thefork', description: 'Fazer, remarcar e cancelar reservas de restaurante pelo TheFork, 24 horas por dia.' },
  { name: 'Topchef', category: 'restaurantes-e-hotelaria', description: 'Registrar e atualizar pedidos do restaurante no Topchef enquanto a ligação acontece.' },
  { name: 'Oracle OPERA', category: 'restaurantes-e-hotelaria', soon: true, description: 'Consultar reservas e dados de hóspedes no Oracle OPERA sem sobrecarregar a recepção.' },
  { name: 'mydr EDM', category: 'saude-e-farmacia', soon: true, description: 'Agendar e remarcar consultas de pacientes no mydr EDM sem sobrecarregar a recepção.' },
  { name: 'Magicline', category: 'saude-e-fitness', catalogSlug: 'magicline', description: 'Consultar dados de alunos e agendar aulas experimentais no Magicline durante a ligação.' },
]

/**
 * Categoria do catálogo do app → categoria do diretório público (INFERIDO: o app usa 11 categorias, o site 9).
 * PABX entra em "Comunicação e mensagens"; Automação e Ofícios em "Produtividade e conhecimento".
 */
const CATALOG_TO_DIRECTORY: Record<IntegrationCategory, DirectoryCategoryId> = {
  Comunicação: 'comunicacao-e-mensagens',
  PABX: 'comunicacao-e-mensagens',
  CRM: 'crm-e-vendas',
  Agenda: 'agenda-e-reservas',
  Automação: 'produtividade-e-conhecimento',
  Ofícios: 'produtividade-e-conhecimento',
  'E-commerce': 'e-commerce',
  'Gestão de imóveis': 'imoveis',
  Hotelaria: 'restaurantes-e-hotelaria',
  Saúde: 'saude-e-farmacia',
  'Beleza & Fitness': 'saude-e-fitness',
}

/**
 * Demais integrações do catálogo do app (113 no total) que o diretório público da referência não mostra.
 * Ficam em cada categoria atrás de "Carregar mais" e entram na busca — INFERIDO (a referência lista só 34 cartões).
 */
export const CATALOG_EXTRAS: DirectoryItem[] = INTEGRATIONS.filter((i) => !DIRECTORY.some((d) => d.catalogSlug === i.slug)).map((i) => ({
  name: i.name,
  category: CATALOG_TO_DIRECTORY[i.category],
  description: i.description,
  catalogSlug: i.slug,
  extra: true,
  earlyAccess: i.status === 'early_access',
  soon: i.status === 'coming_soon',
}))

/** Tudo o que a busca pública cobre: os cartões da referência primeiro, depois o restante do catálogo. */
export const ALL_DIRECTORY_ITEMS: DirectoryItem[] = [...DIRECTORY, ...CATALOG_EXTRAS]

/** Integrações extras exibidas por clique em "Carregar mais" (por categoria). */
export const EXTRA_STEP = 6

export function catalogEntry(item: DirectoryItem): CatalogIntegration | undefined {
  return item.catalogSlug ? INTEGRATIONS.find((i) => i.slug === item.catalogSlug) : undefined
}

/**
 * Ícones flutuantes do hero (OBSERVADO [16]). Fidelidade final: centros e diâmetros medidos na referência a 1470 px
 * (hero de 450 px sob o header): círculos de 40–64 px com ícone de ~45% do diâmetro. `x` em % da largura (lado indicado),
 * `top` em px a partir do topo do hero.
 */
export const HERO_ICONS: { name: string; side: 'left' | 'right'; x: string; top: number; size: number }[] = [
  { name: 'n8n', side: 'left', x: '10.8%', top: 94, size: 64 },
  { name: 'Cal.com', side: 'left', x: '23.3%', top: 180, size: 40 },
  { name: 'Slack', side: 'left', x: '17.8%', top: 253, size: 56 },
  { name: 'Google Sheets', side: 'left', x: '13.1%', top: 300, size: 48 },
  { name: 'Google Calendar', side: 'right', x: '11.6%', top: 107, size: 64 },
  { name: 'WhatsApp', side: 'right', x: '20.2%', top: 266, size: 56 },
  { name: 'Notion', side: 'right', x: '13.9%', top: 306, size: 48 },
]
