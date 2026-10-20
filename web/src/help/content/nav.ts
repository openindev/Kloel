import type { HelpTab, HelpNavGroup } from './types'

/**
 * Árvore de navegação da Central de ajuda — mesma estrutura da captura ao vivo
 * (docs/reference/fonio-capture/help-01-central-de-ajuda.txt). Rótulos que a Fonio exibe em inglês
 * na versão pt-BR foram traduzidos (registrado em docs/coverage/help.md).
 */

export const LEGAL_GROUP: HelpNavGroup = {
  label: 'Legal',
  external: true,
  items: ['legal/politica-de-privacidade', 'legal/protecao-de-dados', 'legal/termos-e-condicoes'],
}

export const HELP_TABS: HelpTab[] = [
  {
    id: 'get-started',
    label: 'Começar',
    observedLabel: 'Get Started',
    icon: 'rocket',
    groups: [
      {
        label: 'Começar',
        items: [
          'get-started/first-steps',
          'get-started/connect-your-number',
          'get-started/write-a-great-prompt',
          'get-started/knowledge-base',
          'get-started/languages',
          'get-started/technical',
          'get-started/contacts',
          'get-started/analytics',
          'get-started/troubleshooting',
        ],
      },
      LEGAL_GROUP,
    ],
  },
  {
    id: 'product',
    label: 'Produto',
    observedLabel: 'Product',
    icon: 'box',
    groups: [
      {
        label: 'Ações',
        items: ['actions/sms', 'actions/websearch', 'actions/whatsapp-messages', 'actions/call-transfer', 'actions/appointments', 'actions/email'],
      },
      { label: 'Produtos', items: ['products/tasks', 'products/webchat', 'products/whatsapp'] },
      { label: 'Números de telefone', items: ['phone-numbers/import-number', 'phone-numbers/pbx'] },
      LEGAL_GROUP,
    ],
  },
  {
    id: 'integrations',
    label: 'Integrações',
    observedLabel: 'Integrations',
    icon: 'plug',
    groups: [
      {
        label: 'Desenvolvedores',
        items: [
          'developers/http-request',
          'developers/microsoft',
          'developers/test-context',
          'developers/inbound-webhook',
          'developers/outbound-calls',
          'developers/outbound-api',
        ],
      },
      { label: 'Sistemas telefônicos', items: ['phone-systems/sip-numbers'] },
      {
        label: 'Integrações',
        items: [
          'integrations/airtable',
          'integrations/baselinker',
          'integrations/bexio',
          'integrations/gohighlevel',
          'integrations/google-address-validation',
          'integrations/google-sheets',
          'integrations/hostaway',
          'integrations/idobooking',
          'integrations/idosell',
          'integrations/livespace',
          'integrations/magicline',
          'integrations/makecom',
          'integrations/n8n',
          'integrations/notion',
          'integrations/odoo',
          'integrations/onoffice',
          'integrations/pipedrive',
          'integrations/servicetitan',
          'integrations/shopify',
          'integrations/simplybook',
          'integrations/slack',
          'integrations/stora',
          'integrations/teamleader',
          'integrations/thefork',
          'integrations/wincasa',
          'integrations/woocommerce',
          'integrations/xero',
          'integrations/zapier',
        ],
      },
      LEGAL_GROUP,
    ],
  },
  {
    id: 'partner',
    label: 'Parceiros',
    observedLabel: 'Partner',
    icon: 'handshake',
    groups: [
      { label: 'Início', items: ['home/partner-hub', 'home/partner-academy'] },
      {
        label: 'Programa de parceiros',
        items: [
          'partner-program/become-a-partner',
          'partner-program/refer-or-resell',
          'partner-program/requirements',
          'partner-program/white-label',
          'partner-program/refer-without-implementing',
          'partner-program/release-updates',
        ],
      },
      {
        label: 'Onboarding',
        items: [
          'onboarding/welcome',
          'onboarding/test-with-partner-account',
          'onboarding/where-to-find-resources',
          'onboarding/who-helps-with-what',
          'onboarding/supporting-customers',
        ],
      },
      {
        label: 'Acompanhamento no portal',
        items: ['portal-tracking/customer-not-showing', 'portal-tracking/account-activation', 'portal-tracking/account-transfer'],
      },
      {
        label: 'Recursos de vendas',
        items: [
          'sales-resources/first-phone-contact',
          'sales-resources/qualifying-before-demo',
          'sales-resources/seven-wow-moments',
          'sales-resources/demo-that-closes',
          'sales-resources/build-customer-demo',
          'sales-resources/discovery-questions',
          'sales-resources/objection-library',
          'sales-resources/presentations',
          'sales-resources/pricing-setups',
          'sales-resources/proposal-template',
          'sales-resources/upsell-playbook',
          'sales-resources/sell-with-phone-system',
        ],
      },
      {
        label: 'Clientes',
        items: [
          'customers/who-buys',
          'customers/use-cases-by-industry',
          'customers/questions-before-buying',
          'customers/first-30-days',
          'customers/why-customers-stay-or-leave',
        ],
      },
      {
        label: 'Jurídico do parceiro',
        items: ['partner-legal/dpa-lgpd', 'partner-legal/templates-and-documents', 'partner-legal/hosting-retention-health-data'],
      },
      {
        label: 'Preços e cobrança',
        items: [
          'pricing-billing/prepaid-to-subscription',
          'pricing-billing/invoices-and-billing',
          'pricing-billing/refunds-and-cancellations',
          'pricing-billing/setup-and-care-packages',
          'pricing-billing/test-calls-and-credits',
        ],
      },
      {
        label: 'Configuração',
        items: ['setup/integrations-status', 'setup/post-call-webhook', 'setup/common-support-issues'],
      },
      {
        label: 'Recursos de marketing',
        items: ['marketing-resources/marketing-material', 'marketing-resources/media-templates', 'marketing-resources/flyer-templates'],
      },
      LEGAL_GROUP,
    ],
  },
]

/** Slugs antigos/alternativos → chave canônica (links observados nas notas de referência). */
export const HELP_ALIASES: Record<string, string> = {
  'integrations/oddo': 'integrations/odoo',
  'integrations/make': 'integrations/makecom',
  'integrations/simplybook-me': 'integrations/simplybook',
  'legal/termos': 'legal/termos-e-condicoes',
  'legal/privacidade': 'legal/politica-de-privacidade',
  'legal/terms-and-conditions': 'legal/termos-e-condicoes',
  'legal/privacy-policy': 'legal/politica-de-privacidade',
  'legal/dpa': 'legal/protecao-de-dados',
  'legal/imprint': 'legal/aviso-legal',
  'assistant/contacts': 'get-started/contacts',
  'assistant/knowledge-base': 'get-started/knowledge-base',
  'channels/whatsapp': 'products/whatsapp',
  'actions/outbound-calls': 'developers/outbound-calls',
  'actions/email-sms': 'actions/email',
  'troubleshooting/integrations': 'get-started/troubleshooting',
  'troubleshooting/sms': 'get-started/troubleshooting',
}
