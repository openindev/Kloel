/** Estrutura de navegação do site público (mega-menus observados em www.fonio.ai, adaptados para Kloel). */
/**
 * Item de menu. `muted`: exibido em cinza como na referência (produto "Em breve"), mas navegável até a página
 * de lista de espera local (/produtos/...), para não deixar controle sem efeito. `newTab`: abre em nova aba
 * (Central de ajuda — na Fonio aponta para outro domínio).
 */
export interface NavLinkItem { label: string; to: string; icon: string; badge?: 'Novo' | 'Em breve' | 'Contratando'; muted?: boolean; newTab?: boolean }
export interface NavGroup { label: string; items: NavLinkItem[] }

export const PRODUCTS_MENU: NavGroup[] = [
  {
    label: 'Produtos',
    items: [
      { label: 'Assistente telefônico IA', to: '/', icon: 'phone-call' },
      { label: 'IA de WhatsApp', to: '/produtos/ia-whatsapp', icon: 'whatsapp' },
      { label: 'Webchat de IA', to: '/produtos/webchat-ia', icon: 'message-square-text', badge: 'Novo' },
      { label: 'Assistente de e-mail IA', to: '/produtos/assistente-email-ia', icon: 'mail', badge: 'Em breve', muted: true },
      { label: 'Central telefônica IA (PABX)', to: '/produtos/central-telefonica-ia', icon: 'router', badge: 'Em breve', muted: true },
    ],
  },
]

export const SOLUTIONS_MENU: NavGroup[] = [
  {
    label: 'Casos de uso',
    items: [
      { label: 'Agente de suporte com IA', to: '/solucoes/agente-de-suporte-com-ia', icon: 'headset' },
      { label: 'Agendamentos e perguntas frequentes', to: '/solucoes/agendamentos-e-perguntas-frequentes', icon: 'calendar-check' },
      { label: 'Recepcionista virtual com IA', to: '/solucoes/recepcionista-virtual-com-ia', icon: 'clipboard-list' },
      { label: 'Atendedor automático por IA', to: '/solucoes/atendedor-automatico-por-ia', icon: 'voicemail' },
      { label: 'Assistente de IA para equipe externa', to: '/solucoes/assistente-de-ia-para-equipe-externa', icon: 'truck' },
    ],
  },
]

export const RESOURCES_MENU: NavGroup[] = [
  {
    label: 'Conhecimento',
    items: [
      { label: 'Webinars', to: '/webinars', icon: 'video' },
      { label: 'Integrações', to: '/integracoes', icon: 'blocks', badge: 'Novo' },
      { label: 'Central de ajuda', to: '/ajuda', icon: 'life-buoy', newTab: true },
    ],
  },
  {
    label: 'Empresa',
    items: [
      { label: 'Carreiras', to: '/carreiras', icon: 'briefcase', badge: 'Contratando' },
      { label: 'Imprensa', to: '/imprensa', icon: 'megaphone' },
      { label: 'Contato', to: '/contato', icon: 'messages-square' },
    ],
  },
]

/** Idiomas do seletor (OBSERVADO ao vivo). Nesta demonstração só PT-BR existe; os demais aparecem desabilitados como "Em breve". */
export const LANGUAGES_SITE: { code: string; label: string; active?: boolean }[] = [
  { code: 'br', label: 'Português (BR)', active: true },
  { code: 'gb', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'it', label: 'Italiano' },
]

/** WhatsApp oficial da Kloel informado pelo operador (E3): (11) 5286-3804 → https://wa.me/551152863804. */
export const KLOEL_WHATSAPP_NUMBER = '5564993128506'
export const KLOEL_WHATSAPP_URL = `https://wa.me/${KLOEL_WHATSAPP_NUMBER}`
/**
 * Conversa com a IA da Kloel no WhatsApp com a mensagem inicial pré-preenchida, como os botões "Teste em tempo real no WhatsApp"
 * e "Comece com o WhatsApp" da Fonio (nota [37] da spec 02: click-to-chat com "O que você consegue fazer pela minha empresa?").
 */
/** Problemas/IA de WhatsApp (Daniel): "Teste em tempo real" e "Comece com o WhatsApp" abrem conversa com (64) 99312-8506. */
export const KLOEL_WHATSAPP_TEST_NUMBER = '5564993128506'
export const KLOEL_WHATSAPP_TEST_URL = `https://wa.me/${KLOEL_WHATSAPP_TEST_NUMBER}?text=${encodeURIComponent('O que você consegue fazer pela minha empresa?')}`

export const SITE_CONTACT = {
  email: 'contato@kloel.ai',
  phoneLabel: '(64) 99312-8506',
  whatsappUrl: KLOEL_WHATSAPP_URL,
  tagline: 'Assistentes de IA por Voz para PMEs.',
}

/** Dados cadastrais reais da empresa (os mesmos das páginas legais), usados em Contato ([245]) e Imprensa ([234]). */
export const SITE_COMPANY = {
  legalName: 'Kloel Tecnologia Ltda.',
  hq: 'Caldas Novas (GO)',
  addressLines: ['Alameda Carajás, s/n, Quadra 5, Lote 11', 'Residencial Aldeia das Thermas, Caldas Novas – GO, 75694-720'],
  cnpj: '66.303.607/0001-59',
} as const

/**
 * Redes sociais do rodapé: os perfis da Kloel ainda não foram informados pelo operador, então cada ícone abre um aviso com
 * alternativas reais (WhatsApp da Kloel e página Contato) em vez de apontar para um perfil que pode não ser da Kloel.
 */
export const SITE_EXTERNAL = {
  instagram: { title: 'Instagram da Kloel', text: 'O perfil da Kloel no Instagram estará disponível em breve.' },
  linkedin: { title: 'LinkedIn da Kloel', text: 'A página da Kloel no LinkedIn estará disponível em breve.' },
  youtube: { title: 'Canal da Kloel no YouTube', text: 'O canal da Kloel no YouTube estará disponível em breve.' },
} as const
export type SiteExternalKey = keyof typeof SITE_EXTERNAL
