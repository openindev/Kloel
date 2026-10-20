import { EngineError } from './http'
import type { EngineContext } from './session'

export const whatsappReadinessReasons = ['provider_unsupported', 'external_id_invalid', 'duplicate_external_id', 'agent_missing', 'agent_inactive', 'tenant_not_bound', 'phone_id_mismatch', 'send_not_configured', 'webhook_not_configured', 'ai_not_configured'] as const
export type WhatsAppReadinessReason = typeof whatsappReadinessReasons[number]
export interface ConfiguredWhatsAppChannel {
  id: string; tenantId: string; name: string; type: 'whatsapp'; provider: string; enabled: boolean
  agentId: string | null; externalId: string | null; address: string | null; verificationStatus: 'unverified'
  revision: number; version: string; createdAt: string; updatedAt: string
  readiness: { canEnable: boolean; reasons: WhatsAppReadinessReason[] }
}
export type WhatsAppChannelFields = { name: string; externalId: string; address: string | null; agentId: string | null }
export type WhatsAppChannelPatch = Partial<WhatsAppChannelFields>
export type WhatsAppChannelAttempt = { key: string; kind: 'create' } | {
  key: string; kind: 'update' | 'enable' | 'disable' | 'delete'; channelId: string
  expectedVersion: string; expectedRevision: number; expectedEnabled: boolean
}
export interface WhatsAppChannelOperation {
  key: string; tenantId: string; channelId: string; kind: WhatsAppChannelAttempt['kind']; status: 'succeeded'
  result: { channelId: string; revision: number; version: string; enabled: boolean; deleted: boolean }
  automaticRetry: false; createdAt: string
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)
const version = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const key = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v)
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) < Number.MAX_SAFE_INTEGER
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const externalId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,40}$/.test(v)
const address = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9]\d{7,14}$/.test(v)
function fail(): never { throw new EngineError(0, 'invalid_whatsapp_configuration', 'Dados do canal ou recibo inválidos. Consulte o estado antes de continuar.') }
export function validWhatsAppChannelAttempt(v: unknown): v is WhatsAppChannelAttempt {
  return object(v) && key(v.key) && (v.kind === 'create' ? Object.keys(v).sort().join() === 'key,kind' :
    ['update', 'enable', 'disable', 'delete'].includes(v.kind) && id(v.channelId) && version(v.expectedVersion) && revision(v.expectedRevision) && typeof v.expectedEnabled === 'boolean' && Object.keys(v).sort().join() === 'channelId,expectedEnabled,expectedRevision,expectedVersion,key,kind')
}
export function whatsappChannelPatch(input: WhatsAppChannelPatch): WhatsAppChannelPatch {
  if (!object(input) || !Object.keys(input).length || Object.keys(input).some(k => !['name', 'externalId', 'address', 'agentId'].includes(k))) fail()
  const out: WhatsAppChannelPatch = {}
  if (input.name !== undefined) { if (!text(input.name, 200) || !input.name.trim()) fail(); out.name = input.name.trim() }
  if (input.externalId !== undefined) { if (!externalId(input.externalId)) fail(); out.externalId = input.externalId }
  if (input.address !== undefined) { if (input.address !== null && !address(input.address)) fail(); out.address = input.address }
  if (input.agentId !== undefined) { if (input.agentId !== null && !id(input.agentId)) fail(); out.agentId = input.agentId }
  if (!Object.keys(out).length) fail()
  return out
}
export function whatsappChannelFields(input: WhatsAppChannelFields): WhatsAppChannelFields {
  const out = whatsappChannelPatch(input)
  if (!out.name || !out.externalId) fail()
  return { name: out.name, externalId: out.externalId, address: out.address ?? null, agentId: out.agentId ?? null }
}
export function whatsappChannelAttempt(kind: 'create', row?: undefined): WhatsAppChannelAttempt
export function whatsappChannelAttempt(kind: Exclude<WhatsAppChannelAttempt['kind'], 'create'>, row: ConfiguredWhatsAppChannel): WhatsAppChannelAttempt
export function whatsappChannelAttempt(kind: WhatsAppChannelAttempt['kind'], row?: ConfiguredWhatsAppChannel): WhatsAppChannelAttempt {
  const a: WhatsAppChannelAttempt = kind === 'create' ? { key: crypto.randomUUID(), kind } : { key: crypto.randomUUID(), kind, channelId: row!.id, expectedVersion: row!.version, expectedRevision: row!.revision, expectedEnabled: row!.enabled }
  if (!validWhatsAppChannelAttempt(a)) fail()
  return a
}
export const whatsappChannelRefusal = (error: unknown, a: WhatsAppChannelAttempt) => a.kind !== 'create' && error instanceof EngineError && error.status === 409 && error.code === 'whatsapp_channel_configuration_changed'
export function createWhatsAppChannelsService(context: EngineContext) {
  async function request(path: string, options?: Parameters<EngineContext['request']>[1]) { context.assertCurrent(); const raw = await context.request<unknown>(path, options); context.assertCurrent(); return raw }
  function channel(raw: unknown): ConfiguredWhatsAppChannel {
    if (!object(raw) || !id(raw.id) || raw.tenantId !== context.tenantId || raw.type !== 'whatsapp' || !text(raw.provider, 100) || !raw.provider || !text(raw.name, 200) || typeof raw.enabled !== 'boolean' || raw.verificationStatus !== 'unverified' || !revision(raw.revision) || !version(raw.version) || !date(raw.createdAt) || !date(raw.updatedAt)) fail()
    if (raw.agentId !== null && !id(raw.agentId) || raw.externalId !== null && !externalId(raw.externalId) || raw.address !== null && !address(raw.address)) fail()
    const r = raw.readiness
    if (!object(r) || typeof r.canEnable !== 'boolean' || !Array.isArray(r.reasons) || new Set(r.reasons).size !== r.reasons.length || r.reasons.some((v: unknown) => !whatsappReadinessReasons.includes(v as any)) || r.canEnable !== (r.reasons.length === 0)) fail()
    return { id: raw.id, tenantId: raw.tenantId, name: raw.name, type: 'whatsapp', provider: raw.provider, enabled: raw.enabled, agentId: raw.agentId, externalId: raw.externalId, address: raw.address, verificationStatus: 'unverified', revision: raw.revision, version: raw.version, createdAt: raw.createdAt, updatedAt: raw.updatedAt, readiness: { canEnable: r.canEnable, reasons: [...r.reasons] } }
  }
  function operation(raw: unknown, a: WhatsAppChannelAttempt): WhatsAppChannelOperation {
    if (!validWhatsAppChannelAttempt(a) || !object(raw) || raw.key !== a.key || raw.kind !== a.kind || raw.tenantId !== context.tenantId || !id(raw.channelId) || raw.status !== 'succeeded' || raw.automaticRetry !== false || !date(raw.createdAt)) fail()
    const r = raw.result, enabled = a.kind === 'enable' || a.kind === 'update' && a.expectedEnabled
    if (!object(r) || r.channelId !== raw.channelId || !version(r.version) || r.deleted !== (a.kind === 'delete') || r.enabled !== enabled || r.revision !== (a.kind === 'create' ? 1 : a.expectedRevision + 1) || a.kind !== 'create' && (raw.channelId !== a.channelId || r.version === a.expectedVersion)) fail()
    return { key: raw.key, kind: raw.kind, tenantId: raw.tenantId, channelId: raw.channelId, status: 'succeeded', automaticRetry: false, createdAt: raw.createdAt, result: { channelId: r.channelId, revision: r.revision, version: r.version, deleted: r.deleted, enabled: r.enabled } }
  }
  async function mutate(a: WhatsAppChannelAttempt, body: unknown) {
    if (!validWhatsAppChannelAttempt(a)) fail()
    const method = a.kind === 'update' ? 'PATCH' : a.kind === 'delete' ? 'DELETE' : 'POST'
    const suffix = a.kind === 'enable' || a.kind === 'disable' ? '/' + a.kind : ''
    const raw = await request('/whatsapp/channels' + (a.kind === 'create' ? '' : '/' + a.channelId + suffix), { method, idempotencyKey: a.key, body: { ...body as object, expectedTenantId: context.tenantId, ...(a.kind === 'create' ? {} : { expectedVersion: a.expectedVersion }) } })
    if (!object(raw) || typeof raw.replayed !== 'boolean') fail()
    return { operation: operation(raw.operation, a), replayed: raw.replayed }
  }
  return {
    async list(options: { agentId?: string; limit?: number; cursor?: string; signal?: AbortSignal } = {}) {
      const { agentId, limit = 25, cursor, signal } = options
      if (agentId !== undefined && !id(agentId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor !== undefined && (!text(cursor, 1024) || !/^[A-Za-z0-9_-]{40,1024}$/.test(cursor))) fail()
      const raw = await request('/whatsapp/channels', { query: { agentId, limit, cursor }, signal })
      if (!object(raw) || !Array.isArray(raw.items) || raw.items.length > limit || raw.limit !== limit || raw.nextCursor !== null && (!text(raw.nextCursor, 1024) || !/^[A-Za-z0-9_-]{40,1024}$/.test(raw.nextCursor) || raw.nextCursor === cursor)) fail()
      const items = raw.items.map(channel)
      if (new Set(items.map(v => v.id)).size !== items.length || agentId && items.some(v => v.agentId !== agentId)) fail()
      return { items, nextCursor: raw.nextCursor as string | null, limit }
    },
    async get(channelId: string) { if (!id(channelId)) fail(); const row = channel(await request('/whatsapp/channels/' + channelId)); if (row.id !== channelId) fail(); return row },
    async create(a: WhatsAppChannelAttempt, input: WhatsAppChannelFields) { if (a.kind !== 'create') fail(); return mutate(a, whatsappChannelFields(input)) },
    async update(a: WhatsAppChannelAttempt, input: WhatsAppChannelPatch) { if (a.kind !== 'update') fail(); return mutate(a, whatsappChannelPatch(input)) },
    async setEnabled(a: WhatsAppChannelAttempt) { if (a.kind !== 'enable' && a.kind !== 'disable') fail(); return mutate(a, {}) },
    async remove(a: WhatsAppChannelAttempt) { if (a.kind !== 'delete') fail(); return mutate(a, {}) },
    async operation(a: WhatsAppChannelAttempt) { if (!validWhatsAppChannelAttempt(a)) fail(); return operation(await request('/whatsapp/channel-operations/' + a.key), a) },
  }
}

