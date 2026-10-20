import type { Agent, AgentRules, AgentTechnical, BusinessHours, ContactSettings, BillingProfile, UiPrefs, AgentType } from '@/domain/types'
import { uid } from '@/lib/utils'

export const defaultBusinessHours = (): BusinessHours => ({
  enabled: false,
  timezone: 'America/Sao_Paulo',
  days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day >= 1 && day <= 5, ranges: [{ from: '09:00', to: '18:00' }] })),
  outsideBehavior: '',
})

export const defaultRules = (): AgentRules => ({
  aiDisclosure: 'if_asked',
  style: 'default',
  offTopic: { active: false, behavior: 'POINT_OUT_NOT_RESPONSIBLE', noteAndOffer: true, smallTalk: 'ENGAGE_BRIEFLY' },
  angry: { active: false, behavior: 'STAY_CALM_AND_LISTEN', offerTransfer: true },
  sales: { active: false, reaction: 'DECLINE_FRIENDLY', hangUp: true, handleCompetitors: true, competitorBehavior: 'STAY_NEUTRAL' },
  pronunciation: [],
  custom: [],
})

export const defaultTechnical = (): AgentTechnical => ({
  maxCallDuration: 20,
  silenceTimeout: 10,
  recordAudio: false,
  autoDeleteOnRefusal: false,
  ambientSound: '',
  ambientVolume: 1,
  technicalTerms: [],
  speechSpeed: 1.35,
  sensitivity: 0.5,
  temperature: 0.1,
  preciseExtraction: [
    // OBSERVADO ao vivo (fonio-live2/data/technical-and-prompt.json, captura 99): valores padrão da Fonio, literais
    { id: uid('pe'), name: 'Email', example: 'max.mustermann@example.com' },
    { id: uid('pe'), name: 'Adresse', example: 'Musterstraße 1, 12345 Musterstadt' },
  ],
  freeTransfer: false,
  dtmf: false,
  protectGreeting: true,
  noInterruptions: false,
  responseSpeed: 'normal',
})

export function makeAgent(orgId: string, name: string, type: AgentType, companyName: string, overrides: Partial<Agent> = {}): Agent {
  const now = new Date().toISOString()
  return {
    id: uid('agt'),
    orgId,
    name,
    type,
    channels: type === 'voice' ? ['phone'] : type === 'omni' ? ['phone', 'whatsapp', 'webchat'] : ['whatsapp', 'webchat'],
    voiceId: 'camila',
    language: 'pt-BR',
    greeting: `Olá, aqui é a ${name} da ${companyName}. Como posso te ajudar?`,
    greetingPersonalized: true,
    greetingMode: 'auto',
    greetingRules: [],
    contactsEnabled: true,
    transfers: [],
    emails: [],
    whatsapps: [],
    scheduling: [],
    webSearch: { enabled: false, instruction: '', allowedDomains: [] },
    integrations: [],
    webhooks: [],
    rules: defaultRules(),
    knowledgeBaseEnabled: true,
    companyInfo: '',
    businessHours: defaultBusinessHours(),
    prompt: type === 'voice'
      ? `Você é a ${name} – uma assistente telefônica que responde às perguntas de forma amigável.`
      : type === 'omni'
        ? `Você é a ${name} – a mesma assistente no chat e na ligação, com a mesma memória e o mesmo tom.`
        : `Você é a ${name} – uma assistente de chat que responde às perguntas de forma amigável.`,
    technical: defaultTechnical(),
    webchat: type === 'voice' ? undefined : { color: '#585DF5', position: 'right', title: name, welcome: `Olá! Eu sou a ${name}. Como posso ajudar?` },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export const defaultContactSettings = (orgId: string): ContactSettings => ({
  orgId,
  autoCapture: true,
  creationGate: '',
  smartFields: [],
})

export const defaultBillingProfile = (orgId: string, organizationName: string): BillingProfile => ({
  orgId,
  organizationName,
  country: 'Brasil',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  taxId: '',
  email: '',
  addOns: {},
  autoBuyAddOns: true,
  identity: 'not_started',
  credits: 0,
})

export const defaultUi = (): UiPrefs => ({
  sidebarCollapsed: false,
  dismissed: {},
  overview: { period: '30d', agentId: 'all', metric: 'calls' },
  inbox: { listWidth: 340, detailsOpen: false },
  failNextOperation: false,
})
