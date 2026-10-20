/**
 * Modelo de domínio da casca Kloel AI.
 * Todas as entidades pertencem a uma organização (orgId) e são persistidas localmente
 * (ver src/data/storage.ts). Nenhuma operação aqui toca serviços externos.
 */

export type ID = string
export type ISODate = string

export type Role = 'admin' | 'editor' | 'builder' | 'viewer'
export type ProductKey = 'voice' | 'whatsapp' | 'webchat' | 'email' | 'care'
export type PlanTier = 'solo' | 'team' | 'scale' | 'essential' | 'pro' | 'premium' | 'standard'
export type BillingInterval = 'monthly' | 'annual'

export interface Organization {
  id: ID
  name: string
  slug: string
  timezone: string
  website?: string
  sector?: string
  size?: string
  referralSource?: string
  /** código de indicação (UUID) usado em /register?ref=; ausente = derivado do id (billing/referral.ts#referralCodeOf) */
  referralCode?: string
  onboardingCompleted: boolean
  /** Explicit editorial requirement/completion; the legacy boolean also represents not_required. */
  onboardingRequired?: boolean
  onboardingCompletionConfirmed?: boolean
  onboardingStep?: string
  createdAt: ISODate
}

export interface User {
  id: ID
  firstName: string
  lastName: string
  email: string
  password: string // demonstrativo, armazenado localmente
  phone?: string
  language: string
  createdAt: ISODate
}

export interface Membership {
  id: ID
  orgId: ID
  userId: ID
  role: Role
  joinedAt: ISODate
}

export interface Invite {
  id: ID
  orgId: ID
  email: string
  firstName?: string
  lastName?: string
  role: Role
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  createdAt: ISODate
  lastSentAt: ISODate
  expiresAt: ISODate
}

export interface Session {
  userId: ID | null
  orgId: ID | null
}

/* ----------------------------- Assistentes ----------------------------- */

export type AgentType = 'voice' | 'chat' | 'omni'

export interface GreetingRule {
  id: ID
  /** condições (todas precisam valer) */
  conditions: { field: string; operator: string; value: string }[]
  message: string
}

export interface BusinessHours {
  enabled: boolean
  timezone: string
  days: { day: number; enabled: boolean; ranges: { from: string; to: string }[] }[]
  outsideBehavior?: string
}

export interface TransferTarget {
  id: ID
  mode: 'phone' | 'member' | 'sip'
  label: string
  destination: string
  memberId?: ID
  description: string
  checkAvailability: boolean
  calendarConnectionId?: ID
  emailOnFailure: boolean
  failureEmail?: string
  businessHours?: BusinessHours
  whisper?: string
}

export interface EmailAction {
  id: ID
  name: string
  timing: 'during' | 'after'
  when: 'always' | 'only_if'
  condition?: string
  recipientsMode: 'fixed' | 'ai'
  recipients: string[]
  recipientsInstruction?: string
  messageMode: 'manual' | 'ai'
  subject: string
  body: string
  aiInstruction?: string
  businessHours?: BusinessHours
}

export interface WhatsAppAction {
  id: ID
  name: string
  senderNumberId?: ID
  timing: 'during' | 'after'
  when: 'always' | 'only_if'
  condition?: string
  recipientsMode: 'caller' | 'fixed'
  recipients: string[]
  message: string
}

export interface SchedulingAction {
  id: ID
  provider: 'kloel' | 'calendly' | 'calcom' | 'google' | 'microsoft' | 'etermin'
  name: string
  eventTypeId?: ID
  url?: string
  settings: Record<string, unknown>
}

export interface WebSearchAction {
  enabled: boolean
  instruction: string
  allowedDomains: string[]
  businessHours?: BusinessHours
}

export interface IntegrationAction {
  id: ID
  integration: string
  name: string
  timing: 'before' | 'during' | 'after'
  config: Record<string, string>
  connected: boolean
}

export interface WebhookConfig {
  id: ID
  kind: 'inbound' | 'outbound_api' | 'test_context' | 'http_request'
  name: string
  url?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: { key: string; value: string }[]
  body?: string
  timing?: 'before' | 'during' | 'after'
  description?: string
  secret?: string
  enabled: boolean
  lastTest?: { at: ISODate; status: 'success' | 'error'; code: number; ms: number; response: string }
}

export interface CustomRule {
  id: ID
  active: boolean
  title: string
  condition: string
  instruction: string
}

export interface AgentRules {
  aiDisclosure: 'never' | 'if_asked' | 'start' | 'start_consent'
  style: 'default' | 'professional' | 'casual' | 'formal' | 'empathetic'
  offTopic: { active: boolean; behavior: string; noteAndOffer: boolean; smallTalk: string }
  angry: { active: boolean; behavior: string; offerTransfer: boolean }
  sales: { active: boolean; reaction: string; hangUp: boolean; handleCompetitors: boolean; competitorBehavior: string }
  pronunciation: { id: ID; term: string; pronunciation: string }[]
  custom: CustomRule[]
}

export interface AgentTechnical {
  maxCallDuration: number
  silenceTimeout: number
  recordAudio: boolean
  autoDeleteOnRefusal: boolean
  ambientSound: '' | 'office' | 'keyboard_typing'
  ambientVolume: number
  technicalTerms: string[]
  speechSpeed: number
  sensitivity: number
  temperature: number
  preciseExtraction: { id: ID; name: string; example: string }[]
  freeTransfer: boolean
  dtmf: boolean
  protectGreeting: boolean
  noInterruptions: boolean
  responseSpeed: 'normal' | 'patient'
}

export interface Agent {
  id: ID
  orgId: ID
  name: string
  type: AgentType
  channels: ('phone' | 'whatsapp' | 'webchat')[]
  voiceId: string
  language: string
  greeting: string
  greetingPersonalized: boolean
  greetingMode: 'auto' | 'advanced'
  greetingRules: GreetingRule[]
  contactsEnabled: boolean
  transfers: TransferTarget[]
  emails: EmailAction[]
  whatsapps: WhatsAppAction[]
  scheduling: SchedulingAction[]
  webSearch: WebSearchAction
  integrations: IntegrationAction[]
  webhooks: WebhookConfig[]
  rules: AgentRules
  knowledgeBaseEnabled: boolean
  companyInfo: string
  businessHours: BusinessHours
  prompt: string
  technical: AgentTechnical
  webchat?: { color: string; position: 'right' | 'left'; title: string; welcome: string; website?: string }
  createdAt: ISODate
  updatedAt: ISODate
}

export interface KnowledgeEntry {
  id: ID
  orgId: ID
  agentId: ID
  question: string
  answer: string
  source: 'manual' | 'website' | 'auto' | 'document'
  sourceLabel?: string
  usageCount: number
  createdAt: ISODate
}

export interface KnowledgeSource {
  id: ID
  orgId: ID
  agentId: ID
  type: 'website' | 'document'
  label: string
  pages?: number
  sizeBytes?: number
  status: 'processing' | 'ready' | 'error'
  error?: string
  enabled: boolean
  updatedAt: ISODate
}

/* ------------------------------ Conversas ------------------------------ */

export type ConversationChannel = 'phone' | 'web' | 'whatsapp' | 'webchat'
export type ConversationResult =
  | 'unknown'
  | 'resolved'
  | 'transferred'
  | 'missed'
  | 'appointment'
  | 'abandoned'
  | 'no_interaction'
  | 'spam'
  | 'voicemail'
  | 'outbound_no_answer'
  | 'inactivity'
  | 'time_limit'
  | 'recording_refused'

export interface TranscriptLine {
  t: number // segundos desde o início
  speaker: 'assistant' | 'caller' | 'system'
  text: string
}

export interface Conversation {
  id: ID
  orgId: ID
  agentId: ID
  channel: ConversationChannel
  direction: 'inbound' | 'outbound' | 'unknown'
  title: string
  summary: string
  result: ConversationResult
  startedAt: ISODate
  durationSec: number | null
  callerNumber?: string
  calleeNumber?: string
  contactId?: ID
  transcript: TranscriptLine[]
  endedBy: 'assistant' | 'caller' | 'system' | 'unknown'
  starred: boolean
  archived: boolean
  read: boolean
  tagIds: ID[]
  simulated: boolean
  campaignId?: ID
}

export interface Tag {
  id: ID
  orgId: ID
  label: string
  color: string
  autoAdd: boolean
  condition?: string
}

/* ------------------------------- Contatos ------------------------------ */

export interface SmartFieldDef {
  id: ID
  label: string
  type: 'text' | 'number' | 'boolean' | 'enum'
  description: string
  aiFill: boolean
  options?: string[]
}

export interface Contact {
  id: ID
  orgId: ID
  firstName: string
  lastName: string
  phones: { value: string; label: '' | 'HOME' | 'WORK' | 'OTHER' }[]
  emails: { value: string; label: '' | 'HOME' | 'WORK' | 'OTHER' }[]
  company: string
  ownerId?: ID
  notes: string
  fields: Record<string, string>
  source: 'manual' | 'import' | 'conversation' | 'legacy'
  createdAt: ISODate
  updatedAt: ISODate
}

export interface ContactSettings {
  orgId: ID
  autoCapture: boolean
  creationGate: string
  smartFields: SmartFieldDef[]
}

/* ---------------------------- Canais / Mais ---------------------------- */

export interface PhoneNumber {
  id: ID
  orgId: ID
  name: string
  number: string
  country: string
  kind: 'purchased' | 'sip' | 'imported'
  capabilities: ('inbound' | 'outbound' | 'whatsapp')[]
  agentId?: ID
  minutesUsed: number | null
  sip?: { terminationUrl?: string; username?: string; password?: string }
  verified: boolean
  createdAt: ISODate | null
}

export interface WhatsAppAccount {
  id: ID
  orgId: ID
  businessName: string
  number: string
  status: 'connected' | 'pending' | 'error'
  agentId?: ID
  qualityRating: 'high' | 'medium' | 'low' | 'unknown'
  messagesThisMonth: number | null
  connectedAt: ISODate | null
}

export interface CalendarConnection {
  id: ID
  orgId: ID
  provider: 'google' | 'microsoft'
  email: string
  scope: 'personal' | 'shared'
  features: ('calendar' | 'email')[]
  ownerUserId: ID
  connectedAt: ISODate
}

export interface EventType {
  id: ID
  orgId: ID
  name: string
  slug: string
  durationMin: number
  description: string
  calendarId?: ID
  location: 'phone' | 'video' | 'in_person'
  availability: { day: number; enabled: boolean; from: string; to: string }[]
  bufferMin: number
  minNoticeHours: number
  maxDaysAhead: number
  notifications: { confirmationEmail: boolean; reminderEmail: boolean; reminderHours: number; smsReminder: boolean; notifyTeam: boolean }
  dataCollection: { id: ID; label: string; required: boolean; type: 'text' | 'phone' | 'email' }[]
  agentIds: ID[]
  advanced: { allowReschedule: boolean; allowCancel: boolean; slotIntervalMin: number; maxPerDay: number }
  createdAt: ISODate
}

export interface Booking {
  id: ID
  orgId: ID
  eventTypeId: ID
  name: string
  email?: string
  phone?: string
  startsAt: ISODate
  status: 'confirmed' | 'canceled' | 'pending' | 'unknown' | 'failed' | 'conflict' | 'cancel_pending' | 'reschedule_pending' | 'reschedule_unknown' | 'reschedule_conflict'
  source: 'agent' | 'booking_page' | 'unknown'
  conversationId?: ID
}

export interface EmailInbox {
  id: ID
  orgId: ID
  address: string
  provider: 'google' | 'microsoft'
  agentEnabled: boolean
  context: string
  rules: { id: ID; active: boolean; text: string }[]
  knowledge: string
  settings: { autoDraft: boolean; autoSend: boolean; signature: string; tone: string }
  connectedAt: ISODate
}

export interface EmailMessage {
  id: ID
  orgId: ID
  inboxId: ID
  folder: 'inbox' | 'sent'
  from: string
  to: string
  subject: string
  body: string
  date: ISODate
  read: boolean
  aiDraft?: string
  status: 'new' | 'draft_ready' | 'replied'
}

export interface ApiKey {
  id: ID
  orgId: ID
  name: string
  prefix: string
  secret: string
  createdAt: ISODate
  lastUsedAt?: ISODate
}

export interface IntegrationRequest {
  id: ID
  orgId: ID
  integration: string
  requestedAt: ISODate
}

export interface Campaign {
  id: ID
  orgId: ID
  name: string
  agentId: ID
  phoneNumberId?: ID
  contactIds: ID[]
  status: 'draft' | 'scheduled' | 'running' | 'completed' | 'paused'
  scheduledAt?: ISODate
  stats: { called: number; reached: number; resolved: number }
  createdAt: ISODate
}

/* ------------------------------- Cobrança ------------------------------ */

export interface Subscription {
  id: ID
  orgId: ID
  product: ProductKey
  plan: PlanTier
  interval: BillingInterval
  status: 'active' | 'trialing' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused'
  priceMonthly: number
  startedAt: ISODate | null
  renewsAt: ISODate | null
}

export interface Invoice {
  id: ID
  orgId: ID
  number: string
  date: ISODate
  amount: number
  status: 'paid' | 'open' | 'void'
  description: string
}

export interface BillingProfile {
  orgId: ID
  organizationName: string
  country: string
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  taxId: string
  email: string
  card?: { brand: string; last4: string; expMonth: number; expYear: number; holder: string }
  addOns: Record<string, number>
  autoBuyAddOns: boolean
  identity: 'not_started' | 'pending' | 'verified' | 'action_required'
  credits: number
}

/* ----------------------- Site público / formulários -------------------- */

export interface DemoBooking {
  id: ID
  date: string
  time: string
  companySize: string
  firstName: string
  lastName: string
  email: string
  phone: string
  company: string
  callsPerDay?: string
  message?: string
  kind: 'customer' | 'partner'
  productType?: string
  createdAt: ISODate
  status: 'scheduled' | 'canceled'
}

export interface Lead {
  id: ID
  kind: 'callback' | 'contact' | 'partner' | 'newsletter' | 'webchat_trial' | 'career'
  payload: Record<string, string>
  createdAt: ISODate
}

export interface Referral {
  id: ID
  orgId: ID
  name: string
  email: string
  status: 'invited' | 'signed_up' | 'active' | 'credited'
  credit: number
  createdAt: ISODate
}

export interface UiPrefs {
  sidebarCollapsed: boolean
  dismissed: Record<string, boolean>
  overview: { period: string; agentId: string; metric: 'calls' | 'minutes'; customFrom?: string; customTo?: string }
  inbox: { listWidth: number; detailsOpen: boolean }
  failNextOperation: boolean
  /** demonstração: a próxima página com carregamento de dados exibe o estado de erro */
  failNextPageLoad?: boolean
}

export interface DemoDB {
  schemaVersion: number
  seededAt: ISODate
  session: Session
  organizations: Organization[]
  users: User[]
  memberships: Membership[]
  invites: Invite[]
  agents: Agent[]
  knowledgeEntries: KnowledgeEntry[]
  knowledgeSources: KnowledgeSource[]
  conversations: Conversation[]
  tags: Tag[]
  contacts: Contact[]
  contactSettings: ContactSettings[]
  phoneNumbers: PhoneNumber[]
  whatsappAccounts: WhatsAppAccount[]
  calendarConnections: CalendarConnection[]
  eventTypes: EventType[]
  bookings: Booking[]
  emailInboxes: EmailInbox[]
  emailMessages: EmailMessage[]
  apiKeys: ApiKey[]
  integrationRequests: IntegrationRequest[]
  campaigns: Campaign[]
  subscriptions: Subscription[]
  invoices: Invoice[]
  billingProfiles: BillingProfile[]
  referrals: Referral[]
  demoBookings: DemoBooking[]
  leads: Lead[]
  ui: UiPrefs
}

/** Coleções com array de entidades identificadas por `id`. */
export type CollectionKey = {
  [K in keyof DemoDB]-?: DemoDB[K] extends Array<{ id: ID }> ? K : never
}[keyof DemoDB]

export type EntityOf<K extends CollectionKey> = DemoDB[K] extends Array<infer T> ? T : never
