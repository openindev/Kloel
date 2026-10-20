/**
 * Integrações do diálogo "Adicionar integração" do assistente (fonio-live2 C-assistentes/55 + data/resources.json — 11 itens,
 * ordem alfabética). Só a folha do Make foi aberta no levantamento (C-56): título = nome da integração, descrição em inglês,
 * abas "Geral" | "Settings", Geral = Execução (2 seletores) · Conexão [Conectar] · Name ("New Make integration") · Team.
 * As demais seguem a mesma moldura (INFERIDO): campos próprios em inglês, como na Fonio, conexão OAuth/chave de API/URL.
 */
export type IntegrationAuth = 'oauth' | 'apikey' | 'webhook'

export interface IntegrationField {
  key: string
  label: string
  type: 'text' | 'url' | 'password' | 'select' | 'textarea'
  placeholder?: string
  options?: string[]
  required?: boolean
  help?: string
  /** opções só aparecem após conectar (ex.: times do Make, bases do Airtable) */
  afterConnect?: boolean
  /** aba onde o campo aparece (padrão: Geral) */
  tab?: 'general' | 'settings'
}

export interface IntegrationSchema {
  slug: string
  name: string
  auth: IntegrationAuth
  fields: IntegrationField[]
  defaultTiming: 'before' | 'during' | 'after'
  /** descrição da folha (C-56: a do Make é em inglês, com link para os modelos de cenário) */
  description?: string
  descriptionLink?: { label: string; href: string }
}

const ACTION = (opts: string[]): IntegrationField => ({ key: 'action', label: 'Action', type: 'select', options: opts, required: true, tab: 'settings' })

export const AGENT_INTEGRATIONS: IntegrationSchema[] = [
  {
    slug: 'airtable',
    name: 'Airtable',
    auth: 'oauth',
    defaultTiming: 'during',
    fields: [
      { key: 'base', label: 'Base', type: 'select', options: ['Clínica — Pacientes', 'Clínica — Agendamentos'], required: true, afterConnect: true },
      { key: 'table', label: 'Table', type: 'text', placeholder: 'Pacientes', required: true, tab: 'settings' },
      ACTION(['Search records', 'Create record', 'Update record']),
    ],
  },
  {
    slug: 'baserow',
    name: 'Baserow',
    auth: 'apikey',
    defaultTiming: 'during',
    fields: [
      { key: 'tableId', label: 'Table ID', type: 'text', placeholder: '123456', required: true },
      ACTION(['Search rows', 'Add row']),
    ],
  },
  {
    slug: 'gohighlevel',
    name: 'GoHighLevel',
    auth: 'oauth',
    defaultTiming: 'during',
    fields: [
      { key: 'subaccount', label: 'Sub-account', type: 'select', options: ['Clínica Bem Viver', 'Unidade Centro'], required: true, afterConnect: true },
      ACTION(['Identify caller and update contact', 'Book, reschedule and cancel', 'Save call notes']),
    ],
  },
  {
    slug: 'google-sheets',
    name: 'Google Sheets',
    auth: 'oauth',
    defaultTiming: 'after',
    fields: [
      { key: 'sheetUrl', label: 'Spreadsheet URL', type: 'url', placeholder: 'https://docs.google.com/spreadsheets/d/…', required: true },
      { key: 'tab', label: 'Sheet', type: 'text', placeholder: 'Sheet1', required: true, tab: 'settings' },
      ACTION(['Read rows', 'Add row']),
    ],
  },
  {
    slug: 'make',
    name: 'Make',
    // Conexão real pelo gatilho "Custom webhook" do cenário (a API OAuth do Make não é usada); o motor só executa durante/após a conversa.
    auth: 'webhook',
    defaultTiming: 'after',
    description:
      'Trigger a Make.com scenario during or after a conversation by calling its Custom webhook trigger. Build automations across thousands of apps and have your agent run them at the right moment.',
    descriptionLink: { label: 'Browse Make scenario templates', href: 'https://www.make.com/en/templates' },
    fields: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'url', placeholder: 'https://hook.us1.make.com/…', required: true, help: 'Copy the address of the scenario\'s Custom webhook trigger.' }],
  },
  {
    slug: 'n8n',
    name: 'n8n',
    auth: 'webhook',
    defaultTiming: 'after',
    fields: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'url', placeholder: 'https://n8n.example.com/webhook/…', required: true }],
  },
  {
    slug: 'notion',
    name: 'Notion',
    auth: 'oauth',
    defaultTiming: 'before',
    fields: [{ key: 'pages', label: 'Pages', type: 'textarea', placeholder: 'https://www.notion.so/…', required: true, help: 'One link per line.' }],
  },
  {
    slug: 'slack',
    name: 'Slack',
    auth: 'oauth',
    defaultTiming: 'after',
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', options: ['#recepcao', '#geral', '#alertas'], required: true, afterConnect: true },
      { key: 'template', label: 'Message', type: 'textarea', placeholder: '{{conversation.summary}}', required: true, tab: 'settings' },
    ],
  },
  {
    slug: 'stora',
    name: 'Stora',
    auth: 'apikey',
    defaultTiming: 'during',
    fields: [{ key: 'siteId', label: 'Site ID', type: 'text', placeholder: 'site_123', required: true }],
  },
  {
    slug: 'wincasa',
    name: 'WinCasa',
    auth: 'apikey',
    defaultTiming: 'during',
    fields: [{ key: 'tenant', label: 'Tenant', type: 'text', placeholder: '001', required: true }],
  },
  {
    slug: 'zapier',
    name: 'Zapier',
    auth: 'webhook',
    defaultTiming: 'after',
    fields: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'url', placeholder: 'https://hooks.zapier.com/hooks/catch/…', required: true }],
  },
]

export const schemaBySlug = (slug: string) => AGENT_INTEGRATIONS.find((s) => s.slug === slug)
