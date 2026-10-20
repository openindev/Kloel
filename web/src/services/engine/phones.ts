import { EngineError } from './http'
import type { EngineContext } from './session'

export type PhoneCapability = 'voice' | 'sms' | 'whatsapp'
export interface LocalPhone {
  id: string; tenantId: string; createdAt: string; updatedAt: string; name: string; number: string
  provider: 'twilio'; providerNumberId: string | null; agentId: string | null; channelId: string | null
  capabilities: PhoneCapability[]; provisioningStatus: 'unverified'
}
export interface OwnedPhone { sid: string; phoneNumber: string; friendlyName: string; capabilities: Record<string, boolean>; status: string | null; configuredVoiceWebhook: boolean }
export interface CallerId { sid: string; phoneNumber: string; friendlyName: string; verified: true; outboundOnly: true; inboundRoutingConfigured: false }
export interface AvailablePhone { phoneNumber: string; friendlyName: string; country: string; capabilities: Record<string, boolean>; addressRequirements: string | null; locality: string | null; region: string | null }
export interface ProviderPage<T> { items: T[]; page: number; nextPage: number | null }
export interface PhoneChannel { id: string; tenantId: string; name: string; type: string; provider: string; agentId: string | null; enabled: boolean }
export interface PhoneAgent { id: string; tenantId: string; name: string; status: 'draft' | 'active' | 'paused' }
export type ValidationStatus = 'requesting' | 'unknown' | 'awaiting_confirmation' | 'callback_confirmation_pending' | 'verified' | 'failed' | 'rejected'
export interface CallerValidation {
  id: string; phoneNumber: string; friendlyName: string; status: ValidationStatus; verified: boolean
  providerCallSid: string | null; callerIdSid: string | null; callbackStatus: string | null; confirmationSource: string | null
  errorCode: string | null; requiresReconciliation: boolean; automaticRetry: false; createdAt: string; updatedAt: string
  validationCode?: string; codeExpiresAt?: number; found?: boolean; providerVerified?: boolean
}
export interface PhonePatch { name?: string; agentId?: string | null; channelId?: string | null }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 300) => typeof v === 'string' && v.length <= max
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(v)
const e164 = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9]\d{7,14}$/.test(v)
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const nullable = (v: unknown, max = 300): v is string | null => v === null || text(v, max)
function invalid(message = 'Não foi possível confirmar os dados de telefonia. Atualize antes de continuar.'): never { throw new EngineError(0, 'invalid_phone_data', message) }
function id(v: string) { if (!identifier(v)) invalid(); return v }
function capabilities(v: unknown): Record<string, boolean> {
  if (!object(v) || Object.values(v).some(value => typeof value !== 'boolean')) invalid()
  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(v)) {
    const normalized = key.toLowerCase(); if (!['voice', 'sms', 'mms', 'fax'].includes(normalized)) continue
    if (normalized in result && result[normalized] !== value) invalid()
    result[normalized] = value as boolean
  }
  return result
}
function phoneRecord(raw: unknown, tenantId: string): LocalPhone {
  if (!object(raw) || raw.tenantId !== tenantId || !identifier(raw.id) || !date(raw.createdAt) || !date(raw.updatedAt) || !text(raw.name, 200) || !String(raw.name).trim() || !e164(raw.number) || !['twilio', 'didlogic'].includes(String(raw.provider)) || raw.provisioningStatus !== 'unverified'
    || !Array.isArray(raw.capabilities) || raw.capabilities.length > 3 || raw.capabilities.some(v => !['voice', 'sms', 'whatsapp'].includes(String(v)))) invalid()
  for (const key of ['agentId', 'channelId']) if (raw[key] != null && !identifier(raw[key])) invalid()
  if (raw.providerNumberId != null && !text(raw.providerNumberId, 150)) invalid()
  return { id: raw.id, tenantId, createdAt: raw.createdAt, updatedAt: raw.updatedAt, name: raw.name as string, number: raw.number, provider: raw.provider as 'twilio', providerNumberId: raw.providerNumberId as string ?? null, agentId: raw.agentId as string ?? null, channelId: raw.channelId as string ?? null, capabilities: raw.capabilities as PhoneCapability[], provisioningStatus: 'unverified' }
}
function owned(raw: unknown): OwnedPhone {
  if (!object(raw) || typeof raw.sid !== 'string' || !/^PN[\da-fA-F]{32}$/.test(raw.sid) || !e164(raw.phoneNumber) || !text(raw.friendlyName, 256) || !nullable(raw.status, 80) || typeof raw.configuredVoiceWebhook !== 'boolean') invalid()
  return { sid: raw.sid, phoneNumber: raw.phoneNumber, friendlyName: raw.friendlyName as string, capabilities: capabilities(raw.capabilities), status: raw.status, configuredVoiceWebhook: raw.configuredVoiceWebhook }
}
function caller(raw: unknown): CallerId {
  if (!object(raw) || typeof raw.sid !== 'string' || !/^PN[\da-fA-F]{32}$/.test(raw.sid) || !e164(raw.phoneNumber) || !text(raw.friendlyName, 256) || raw.verified !== true || raw.outboundOnly !== true || raw.inboundRoutingConfigured !== false) invalid()
  return { sid: raw.sid, phoneNumber: raw.phoneNumber, friendlyName: raw.friendlyName as string, verified: true, outboundOnly: true, inboundRoutingConfigured: false }
}
function providerPage<T>(raw: unknown, page: number, parse: (value: unknown) => T): ProviderPage<T> {
  if (!object(raw) || raw.source !== 'twilio' || raw.providerVerified !== true || !Array.isArray(raw.items) || raw.items.length > 100 || raw.page !== page || raw.nextPage !== null && raw.nextPage !== page + 1) invalid()
  return { items: raw.items.map(parse), page, nextPage: raw.nextPage as number | null }
}
function validation(raw: unknown, allowCode = false): CallerValidation {
  const states: ValidationStatus[] = ['requesting', 'unknown', 'awaiting_confirmation', 'callback_confirmation_pending', 'verified', 'failed', 'rejected']
  if (!object(raw) || !identifier(raw.id) || !e164(raw.phoneNumber) || !text(raw.friendlyName, 256) || !states.includes(raw.status as ValidationStatus) || raw.verified !== (raw.status === 'verified') || typeof raw.requiresReconciliation !== 'boolean' || raw.automaticRetry !== false || !date(raw.createdAt) || !date(raw.updatedAt)) invalid()
  for (const key of ['providerCallSid', 'callerIdSid', 'callbackStatus', 'confirmationSource', 'errorCode']) if (!nullable(raw[key])) invalid()
  if (raw.verified && (typeof raw.callerIdSid !== 'string' || !/^PN[\da-fA-F]{32}$/.test(raw.callerIdSid))) invalid()
  const result: CallerValidation = { id: raw.id, phoneNumber: raw.phoneNumber, friendlyName: raw.friendlyName as string, status: raw.status as ValidationStatus, verified: raw.verified as boolean, providerCallSid: raw.providerCallSid as string | null, callerIdSid: raw.callerIdSid as string | null, callbackStatus: raw.callbackStatus as string | null, confirmationSource: raw.confirmationSource as string | null, errorCode: raw.errorCode as string | null, requiresReconciliation: raw.requiresReconciliation, automaticRetry: false, createdAt: raw.createdAt, updatedAt: raw.updatedAt }
  if (allowCode && raw.validationCode !== undefined) {
    if (raw.status !== 'awaiting_confirmation' || typeof raw.validationCode !== 'string' || !/^\d{6}$/.test(raw.validationCode) || typeof raw.codeExpiresAt !== 'number' || !Number.isFinite(raw.codeExpiresAt)) invalid()
    if (raw.codeExpiresAt > Date.now()) { result.validationCode = raw.validationCode; result.codeExpiresAt = raw.codeExpiresAt }
  }
  for (const key of ['found', 'providerVerified'] as const) if (raw[key] !== undefined) { if (typeof raw[key] !== 'boolean') invalid(); result[key] = raw[key] }
  return result
}
function phoneAgent(raw: unknown, tenantId: string): PhoneAgent {
  if (!object(raw) || raw.tenantId !== tenantId || !identifier(raw.id) || !text(raw.name, 200) || !['active', 'draft', 'paused'].includes(String(raw.status))) invalid()
  return { id: raw.id, tenantId, name: raw.name as string, status: raw.status as PhoneAgent['status'] }
}
function phoneChannel(raw: unknown, tenantId: string): PhoneChannel {
  if (!object(raw) || raw.tenantId !== tenantId || !identifier(raw.id) || !text(raw.name, 200) || !text(raw.type, 40) || !text(raw.provider, 40) || typeof raw.enabled !== 'boolean' || raw.agentId != null && !identifier(raw.agentId)) invalid()
  return { id: raw.id, tenantId, name: raw.name as string, type: raw.type as string, provider: raw.provider as string, enabled: raw.enabled, agentId: raw.agentId as string ?? null }
}
export function createPhonesService(context: EngineContext) {
  const get = async <T>(path: string, options?: Parameters<EngineContext['request']>[1]): Promise<T> => { const value = await context.request<T>(path, options); context.assertCurrent(); return value }
  async function all<T>(path: string, parse: (raw: unknown) => T): Promise<T[]> {
    const items: T[] = [], seen = new Set<string>()
    for (let page = 1; page <= 1000; page++) {
      const raw = await get<unknown>(path, { query: { page, limit: 100, sort: 'name', order: 'asc' } })
      if (!object(raw) || !Array.isArray(raw.items) || raw.page !== page || raw.limit !== 100 || !Number.isSafeInteger(raw.totalPages) || Number(raw.totalPages) < 0 || !Number.isSafeInteger(raw.total) || Number(raw.total) < 0) invalid()
      for (const value of raw.items) { const item = parse(value); const itemId = (item as { id: string }).id; if (seen.has(itemId)) invalid('A lista mudou durante a consulta. Atualize os números.'); seen.add(itemId); items.push(item) }
      if (page >= Number(raw.totalPages)) { if (items.length !== raw.total) invalid('A lista mudou durante a consulta. Atualize os números.'); return items }
    }
    invalid('A lista excedeu o limite desta tela. Nenhuma lista parcial foi exibida.')
  }
  const local = async (phoneId: string) => { const item = phoneRecord(await get(`/phone-numbers/${id(phoneId)}`), context.tenantId); if (item.id !== phoneId) invalid(); return item }
  const listOwned = async (page = 0, phoneNumber?: string) => {
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000 || phoneNumber !== undefined && !e164(phoneNumber)) invalid()
    return providerPage(await get('/voice/numbers/owned', { query: { page, pageSize: 50, phoneNumber } }), page, owned)
  }
  return {
    async availability() {
      const raw = await get<unknown>('/providers/status')
      if (!object(raw) || raw.scope !== 'single-tenant-pilot' || typeof raw.tenantBound !== 'boolean' || !object(raw.providers) || !object(raw.providers.twilioCatalog)) invalid()
      const catalog = raw.providers.twilioCatalog
      if (typeof catalog.configured !== 'boolean' || catalog.verifiedLive !== false || !Array.isArray(catalog.missing) || catalog.missing.some(value => typeof value !== 'string') || !raw.tenantBound && catalog.configured) invalid()
      return { tenantBound: raw.tenantBound, catalogConfigured: catalog.configured }
    },
    listLocal: () => all('/phone-numbers', raw => phoneRecord(raw, context.tenantId)), getLocal: local,
    listAgents: () => all('/agents', raw => phoneAgent(raw, context.tenantId)), listChannels: () => all('/channels', raw => phoneChannel(raw, context.tenantId)),
    listOwned,
    async listCallerIds(page = 0): Promise<ProviderPage<CallerId>> {
      if (!Number.isSafeInteger(page) || page < 0 || page > 10000) invalid()
      return providerPage(await get('/voice/caller-ids', { query: { page, pageSize: 50 } }), page, caller)
    },
    async available(input: { country: string; type: 'local' | 'mobile' | 'tollFree'; contains?: string; areaCode?: string }): Promise<AvailablePhone[]> {
      if (!/^[A-Z]{2}$/.test(input.country) || !['local', 'mobile', 'tollFree'].includes(input.type) || input.contains && !/^[+0-9*]{1,16}$/.test(input.contains) || input.areaCode && !/^\d{1,5}$/.test(input.areaCode)) invalid('Confira país, tipo e filtro do catálogo.')
      const raw = await get<unknown>('/voice/numbers/available', { query: { ...input, contains: input.contains || undefined, areaCode: input.areaCode || undefined, limit: 20 } })
      if (!object(raw) || raw.source !== 'twilio' || raw.providerVerified !== true || raw.purchasePerformed !== false || raw.priceVerified !== false || !Array.isArray(raw.items) || raw.items.length > 20) invalid()
      return raw.items.map(row => {
        if (!object(row) || !e164(row.phoneNumber) || !text(row.friendlyName, 256) || row.country !== input.country || !nullable(row.addressRequirements, 100) || !nullable(row.locality) || !nullable(row.region)) invalid()
        return { phoneNumber: row.phoneNumber, friendlyName: row.friendlyName as string, country: row.country as string, capabilities: capabilities(row.capabilities), addressRequirements: row.addressRequirements, locality: row.locality, region: row.region }
      })
    },
    async validations() {
      const raw = await get<unknown>('/voice/caller-ids/validation-requests')
      if (!object(raw) || !Array.isArray(raw.items)) invalid()
      return raw.items.map(row => validation(row))
    },
    async requestValidation(input: { phoneNumber: string; friendlyName?: string; confirmCall: boolean }, key: string) {
      if (!e164(input.phoneNumber) || input.confirmCall !== true || !/^[A-Za-z0-9_-]{8,128}$/.test(key) || input.friendlyName !== undefined && (!input.friendlyName.trim() || input.friendlyName.trim().length > 64)) invalid('Informe o número internacional e confirme a ligação de verificação.')
      const result = validation(await get('/voice/caller-ids/validation-requests', { method: 'POST', body: { phoneNumber: input.phoneNumber, ...(input.friendlyName ? { friendlyName: input.friendlyName.trim() } : {}), confirmCall: true, idempotencyKey: key }, timeoutMs: 30000 }), true)
      if (result.phoneNumber !== input.phoneNumber) invalid()
      return result
    },
    async reconcileValidation(previous: CallerValidation) {
      const result = validation(await get(`/voice/caller-ids/validation-requests/${id(previous.id)}/reconcile`, { method: 'POST', body: {}, timeoutMs: 30000 }))
      if (result.id !== previous.id || result.phoneNumber !== previous.phoneNumber) invalid()
      return result
    },
  }
}
export type PhonesService = ReturnType<typeof createPhonesService>
