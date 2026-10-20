import { EngineError } from './http'
import type { EngineContext } from './session'

export interface WhatsAppChannel { id: string; tenantId: string; name: string; enabled: boolean; agentId: string | null; externalId: string | null; address: string | null; createdAt: string; updatedAt: string; verificationStatus: 'unverified' }
export interface WhatsAppAgent { id: string; name: string; status: 'active' | 'draft' | 'paused' }
export interface WhatsAppStatus { tenantBound: boolean; phoneNumberId: string | null; verifiedLive: false; configuration: Record<'send' | 'templates' | 'webhook' | 'ai', { configured: boolean; missing: string[] }>; autoreply: { enabled: boolean; schedulerRunning: boolean } }
export interface WhatsAppTemplate { id: string; name: string; language: string; status: string; category: string; body: string; bodyParameterCount: number; supported: boolean; sendable: boolean }
export type WhatsAppDelivery = 'accepted' | 'sent' | 'delivered' | 'read' | 'failed'
export interface WhatsAppAccepted { messageId: string; conversationId?: string; status: 'accepted' }
export interface WhatsAppOperation { status: 'pending' | 'succeeded' | 'failed' | 'unknown'; result?: WhatsAppAccepted; errorCode?: string; graphCode?: number; graphSubcode?: number; deliveryStatus?: WhatsAppDelivery; automaticRetry: false }
export function whatsappFailureMessage(code?: string): string {
  switch (code) {
    case 'provider_recipient_not_allowed': return 'A Meta recusou o destinatário: confira a lista de destinatários permitidos do número de teste.'
    case 'provider_template_required': return 'A Meta exige um template aprovado porque a janela de atendimento está encerrada. Nenhuma mensagem foi repetida.'
    case 'provider_token_invalid': return 'A Meta recusou o token de acesso. Confira a validade da credencial no servidor.'
    case 'provider_permission_denied': return 'A Meta recusou a autorização do envio. Confira as permissões do aplicativo e do número.'
    case 'provider_rejected': return 'A Meta recusou a mensagem. Consulte o código numérico do recibo, quando disponível.'
    default: return 'A operação falhou. Consulte a configuração e o recibo antes de iniciar outra mensagem.'
  }
}
export const jobLabels = { queued: 'Na fila', ready_to_send: 'Preparada para envio', generating: 'Gerando resposta', preparing_send: 'Preparando envio', sending: 'Enviando · sem confirmação', sent: 'Aceita pela Meta', paused: 'Pausada', failed: 'Falha', requires_reconciliation: 'Resultado incerto', superseded: 'Substituída por nova entrada ou configuração', unsupported_media: 'Mídia não suportada', missing_timestamp: 'Horário de entrada ausente' }
export const deliveryLabels: Record<WhatsAppDelivery, string> = { accepted: 'Aceita pela Meta · entrega não confirmada', sent: 'Enviada pela Meta · entrega não confirmada', delivered: 'Entregue', read: 'Lida', failed: 'Entrega falhou' }
export interface WhatsAppJob { id: string; channelId: string; conversationId: string; agentId: string; status: keyof typeof jobLabels; attempts: number; createdAt: string; updatedAt: string; version: string; errorCode?: string; deliveryStatus?: WhatsAppDelivery }
export type WhatsAppSend = { to: string; channelId: string; conversationId?: string } & ({ kind: 'text'; text: string } | { kind: 'template'; name: string; language: string; bodyParameters: string[] })
export class WhatsAppWriteUncertain extends EngineError { constructor() { super(0, 'whatsapp_write_uncertain', 'A alteração tem resultado incerto. Consulte o estado atual, sem repetir a operação.') } }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(v)
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const e164 = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9]\d{7,14}$/.test(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
function invalid(message = 'Os dados recebidos do WhatsApp são inválidos. Atualize a página.'): never { throw new EngineError(0, 'invalid_data', message) }
function id(v: string) { if (!identifier(v)) invalid(); return v }
function key(v: string) { if (!/^[A-Za-z0-9_-]{8,128}$/.test(v)) invalid(); return v }
function channel(raw: unknown, tenant: string): WhatsAppChannel {
  if (!object(raw) || raw.tenantId !== tenant || !identifier(raw.id) || raw.type !== 'whatsapp' || raw.provider !== 'meta' || !text(raw.name, 200) || typeof raw.enabled !== 'boolean' || raw.agentId != null && !identifier(raw.agentId) || !date(raw.createdAt) || !date(raw.updatedAt) || raw.verificationStatus !== 'unverified' || !object(raw.configuration)) invalid()
  // Never retain arbitrary configuration fields (tokens, URLs, greetings, etc.) in page state.
  const externalId = typeof raw.configuration.externalId === 'string' && /^\d{1,40}$/.test(raw.configuration.externalId) ? raw.configuration.externalId : null
  const address = e164(raw.configuration.address) ? raw.configuration.address : null
  return { id: raw.id, tenantId: tenant, name: raw.name, enabled: raw.enabled, agentId: raw.agentId ?? null, externalId, address, createdAt: raw.createdAt, updatedAt: raw.updatedAt, verificationStatus: 'unverified' }
}
function status(raw: unknown): WhatsAppStatus {
  if (!object(raw) || !['single-tenant-pilot', 'kloel-official', 'embedded-signup'].includes(raw.scope) || typeof raw.tenantBound !== 'boolean' || raw.verifiedLive !== false || raw.phoneNumberId !== null && (typeof raw.phoneNumberId !== 'string' || !/^\d{1,40}$/.test(raw.phoneNumberId)) || !object(raw.configuration) || !object(raw.autoreply) || typeof raw.autoreply.enabled !== 'boolean' || typeof raw.autoreply.schedulerRunning !== 'boolean') invalid()
  const configuration = {} as WhatsAppStatus['configuration']
  const allowed = new Set(['PROVIDER_TENANT_ID', 'META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_GRAPH_VERSION', 'META_WABA_ID', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'OPENAI_API_KEY', 'OPENAI_MODEL'])
  for (const name of ['send', 'templates', 'webhook', 'ai'] as const) {
    const value = raw.configuration[name]
    if (!object(value) || typeof value.configured !== 'boolean' || !Array.isArray(value.missing) || value.missing.some(v => typeof v !== 'string' || !allowed.has(v)) || value.configured && value.missing.length) invalid()
    configuration[name] = { configured: value.configured, missing: [...value.missing] }
  }
  if (!raw.tenantBound && (raw.phoneNumberId !== null || raw.autoreply.enabled || raw.autoreply.schedulerRunning || Object.values(configuration).some(v => v.configured))) invalid()
  return { tenantBound: raw.tenantBound, phoneNumberId: raw.phoneNumberId, verifiedLive: false, configuration, autoreply: { enabled: raw.autoreply.enabled, schedulerRunning: raw.autoreply.schedulerRunning } }
}
function template(raw: unknown): WhatsAppTemplate {
  if (!object(raw) || typeof raw.id !== 'string' || !/^\d{1,100}$/.test(raw.id) || !/^[a-z0-9_]{1,512}$/.test(raw.name) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(raw.language) || !/^[A-Z_]{1,50}$/.test(raw.status) || !['MARKETING', 'UTILITY', 'AUTHENTICATION', 'UNKNOWN'].includes(raw.category) || !text(raw.body, 10000) || !Number.isSafeInteger(raw.bodyParameterCount) || raw.bodyParameterCount < 0 || raw.bodyParameterCount > 30 || typeof raw.supported !== 'boolean' || raw.sendable !== (raw.supported && raw.status === 'APPROVED')) invalid()
  return { id: raw.id, name: raw.name, language: raw.language, status: raw.status, category: raw.category, body: raw.body, bodyParameterCount: raw.bodyParameterCount, supported: raw.supported, sendable: raw.sendable }
}
function accepted(raw: unknown): WhatsAppAccepted {
  if (!object(raw) || typeof raw.messageId !== 'string' || !/^wamid\.[A-Za-z0-9_+=/.-]{1,480}$/.test(raw.messageId) || raw.status !== 'accepted' || raw.conversationId !== undefined && !identifier(raw.conversationId)) invalid()
  return { messageId: raw.messageId, status: 'accepted', ...(raw.conversationId ? { conversationId: raw.conversationId } : {}) }
}
function operation(raw: unknown): WhatsAppOperation {
  if (!object(raw) || !['pending', 'succeeded', 'failed', 'unknown'].includes(raw.status) || raw.automaticRetry !== false || raw.errorCode !== undefined && (typeof raw.errorCode !== 'string' || !/^[a-z0-9_]{1,100}$/.test(raw.errorCode)) || raw.deliveryStatus !== undefined && !Object.hasOwn(deliveryLabels, raw.deliveryStatus)) invalid()
  if (raw.status !== 'succeeded' && raw.result !== undefined) invalid()
  for (const field of ['graphCode', 'graphSubcode'] as const) if (raw[field] !== undefined && (raw.status !== 'failed' || !Number.isInteger(raw[field]) || raw[field] < 0 || raw[field] > 2147483647)) invalid()
  return { status: raw.status, automaticRetry: false, ...(raw.status === 'succeeded' ? { result: accepted(raw.result), deliveryStatus: raw.deliveryStatus ?? 'accepted' } : {}), ...(raw.errorCode ? { errorCode: raw.errorCode } : {}), ...(raw.graphCode !== undefined ? { graphCode: raw.graphCode } : {}), ...(raw.graphSubcode !== undefined ? { graphSubcode: raw.graphSubcode } : {}) }
}
function job(raw: unknown): WhatsAppJob {
  if (!object(raw) || !identifier(raw.id) || !identifier(raw.channelId) || !identifier(raw.conversationId) || !identifier(raw.agentId) || !Object.hasOwn(jobLabels, raw.status) || !Number.isSafeInteger(raw.attempts) || raw.attempts < 0 || !date(raw.createdAt) || !date(raw.updatedAt) || typeof raw.version !== 'string' || !/^[a-f0-9]{64}$/.test(raw.version) || raw.deliveryStatus !== undefined && !Object.hasOwn(deliveryLabels, raw.deliveryStatus)) invalid()
  return { id: raw.id, channelId: raw.channelId, conversationId: raw.conversationId, agentId: raw.agentId, status: raw.status, attempts: raw.attempts, createdAt: raw.createdAt, updatedAt: raw.updatedAt, version: raw.version, ...(typeof raw.errorCode === 'string' && /^[a-z0-9_]{1,100}$/.test(raw.errorCode) ? { errorCode: raw.errorCode } : {}), ...(raw.deliveryStatus ? { deliveryStatus: raw.deliveryStatus } : {}) }
}
export function createWhatsAppService(context: EngineContext) {
  async function get<T = unknown>(path: string, options?: Parameters<EngineContext['request']>[1]): Promise<T> { const result = await context.request<T>(path, options); context.assertCurrent(); return result }
  async function all(path: string) {
    const items: unknown[] = [], seen = new Set<string>()
    for (let page = 1; page <= 1000; page++) {
      const raw = await get(path, { query: { page, limit: 100, sort: 'name', order: 'asc' } })
      if (!object(raw) || !Array.isArray(raw.items) || raw.page !== page || raw.limit !== 100 || !Number.isSafeInteger(raw.total) || raw.total < 0 || raw.totalPages !== Math.ceil(raw.total / 100)) invalid()
      for (const item of raw.items) { if (!object(item) || item.tenantId !== context.tenantId || !identifier(item.id) || seen.has(item.id)) invalid(); seen.add(item.id); items.push(item) }
      if (page >= raw.totalPages) { if (items.length !== raw.total) invalid(); return items }
    }
    invalid('Lista grande demais. Nenhuma lista parcial foi exibida.')
  }
  const listChannels = async () => (await all('/channels')).filter(row => object(row) && row.type === 'whatsapp' && row.provider === 'meta').map(row => channel(row, context.tenantId))
  const getChannel = async (channelId: string) => { const row = channel(await get(`/channels/${id(channelId)}`), context.tenantId); if (row.id !== channelId) invalid(); return row }
  const getStatus = async () => status(await get('/whatsapp/status'))
  const listAgents = async () => (await all('/agents')).map(row => {
    if (!object(row) || !identifier(row.id) || !text(row.name, 200) || !['active', 'draft', 'paused'].includes(row.status)) invalid()
    return { id: row.id, name: row.name, status: row.status } as WhatsAppAgent
  })
  async function write<T>(fn: () => Promise<T>) { try { return await fn() } catch (error) { if (error instanceof EngineError && (error.code === 'superseded' || error.status >= 400 && error.status < 500)) throw error; throw new WhatsAppWriteUncertain() } }
  return {
    listChannels, getChannel, listAgents, status: getStatus,
    async templates(after?: string) {
      if (after !== undefined && (!after || after.length > 500)) invalid()
      const raw = await get('/whatsapp/templates', { query: { after }, timeoutMs: 35000 })
      if (!object(raw) || raw.source !== 'meta' || !Array.isArray(raw.items) || raw.items.length > 100 || raw.nextCursor !== null && (!text(raw.nextCursor, 500) || !raw.nextCursor)) invalid()
      return { items: raw.items.map(template), nextCursor: raw.nextCursor as string | null }
    },
    async send(input: WhatsAppSend, operationKey: string) {
      if (!e164(input.to) || !identifier(input.channelId) || input.conversationId !== undefined && !identifier(input.conversationId)) invalid('Confira destinatário e canal.')
      const { kind, ...fields } = input
      if (kind === 'text' ? !text(input.text, 4096) || !input.text.trim() : kind !== 'template' || !/^[a-z0-9_]{1,512}$/.test(input.name) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(input.language) || !Array.isArray(input.bodyParameters) || input.bodyParameters.length > 30 || input.bodyParameters.some(p => !text(p, 2000))) invalid('Confira o conteúdo da mensagem.')
      return accepted(await get(kind === 'text' ? '/whatsapp/send' : '/whatsapp/templates/send', { method: 'POST', body: { ...fields, idempotencyKey: key(operationKey) }, timeoutMs: 60000 }))
    },
    async operation(operationKey: string) { return operation(await get(`/whatsapp/operations/${key(operationKey)}`)) },
    async jobs(page = 1) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) invalid()
      const raw = await get('/whatsapp/jobs', { query: { page } })
      if (!object(raw) || !Array.isArray(raw.items) || raw.items.length > 25 || raw.page !== page || !Number.isSafeInteger(raw.total) || raw.total < 0 || raw.totalPages !== Math.ceil(raw.total / 25)) invalid()
      return { items: raw.items.map(job), page, totalPages: raw.totalPages as number, total: raw.total as number }
    },
    async resumeJob(previous: WhatsAppJob) {
      if (previous.status !== 'paused' || !/^[a-f0-9]{64}$/.test(previous.version)) invalid('Somente respostas pausadas podem ser retomadas.')
      return write(async () => { const row = job(await get(`/whatsapp/jobs/${id(previous.id)}/resume`, { method: 'POST', body: { expectedVersion: previous.version } })); if (row.id !== previous.id) invalid(); return row })
    },
  }
}
export type WhatsAppService = ReturnType<typeof createWhatsAppService>
