import { EngineError } from './http'
import type { EngineContext } from './session'
import type { LocalPhone, PhonePatch } from './phones'

export interface ConfiguredPhone extends LocalPhone {
  revision: number; version: string
  ownership: null | { source: 'twilio'; checkedAt: string; scope: 'registration' | 'routing' }
}
export type PhoneAttempt = { key: string; kind: 'create' } | { key: string; kind: 'update' | 'delete'; numberId: string; expectedVersion: string; expectedRevision: number }
export interface PhoneOperation {
  key: string; tenantId: string; kind: PhoneAttempt['kind']; numberId: string; status: 'succeeded'
  result: { numberId: string; revision: number; version: string; deleted: boolean }; automaticRetry: false; createdAt: string
}
export type PhoneCreate = { name: string; number: string; providerNumberId: string; agentId?: string | null; channelId?: string | null }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)
const version = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const key = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v)
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) < Number.MAX_SAFE_INTEGER
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
function fail(): never { throw new EngineError(0, 'invalid_phone_configuration', 'Dados de cadastro ou recibo inválidos. Consulte o estado antes de continuar.') }
export function validPhoneAttempt(v: unknown): v is PhoneAttempt {
  return object(v) && key(v.key) && (v.kind === 'create' ? Object.keys(v).sort().join() === 'key,kind' : ['update', 'delete'].includes(v.kind) && id(v.numberId) && version(v.expectedVersion) && revision(v.expectedRevision) && Object.keys(v).sort().join() === 'expectedRevision,expectedVersion,key,kind,numberId')
}
export function phonePatch(input: PhonePatch): PhonePatch {
  if (!object(input) || !Object.keys(input).length || Object.keys(input).some(k => !['name', 'agentId', 'channelId'].includes(k))) fail()
  const out: PhonePatch = {}
  if (input.name !== undefined) { if (!text(input.name, 200) || !input.name.trim()) fail(); out.name = input.name.trim() }
  for (const k of ['agentId', 'channelId'] as const) if (input[k] !== undefined) { if (input[k] !== null && !id(input[k])) fail(); out[k] = input[k] }
  if (!Object.keys(out).length) fail()
  return out
}
export function phoneCreate(input: PhoneCreate): PhoneCreate {
  const { name, agentId, channelId } = phonePatch({ name: input.name, agentId: input.agentId, channelId: input.channelId })
  if (!name || !/^\+[1-9]\d{7,14}$/.test(input.number) || !/^PN[\da-fA-F]{32}$/.test(input.providerNumberId)) fail()
  return { name, number: input.number, providerNumberId: input.providerNumberId, agentId: agentId ?? null, channelId: channelId ?? null }
}
export function phoneAttempt(kind: 'create', row?: undefined): PhoneAttempt
export function phoneAttempt(kind: 'update' | 'delete', row: ConfiguredPhone): PhoneAttempt
export function phoneAttempt(kind: PhoneAttempt['kind'], row?: ConfiguredPhone): PhoneAttempt {
  const attempt: PhoneAttempt = kind === 'create' ? { key: crypto.randomUUID(), kind } : { key: crypto.randomUUID(), kind, numberId: row!.id, expectedVersion: row!.version, expectedRevision: row!.revision }
  if (!validPhoneAttempt(attempt)) fail()
  return attempt
}
export const phoneRefusal = (error: unknown, attempt: PhoneAttempt) => attempt.kind !== 'create' && error instanceof EngineError && error.status === 409 && error.code === 'phone_configuration_changed'
export function createPhoneConfigService(context: EngineContext) {
  async function request(path: string, options?: Parameters<EngineContext['request']>[1]) { context.assertCurrent(); const raw = await context.request<unknown>(path, options); context.assertCurrent(); return raw }
  function phone(raw: unknown): ConfiguredPhone {
    if (!object(raw) || !id(raw.id) || raw.tenantId !== context.tenantId || !['twilio', 'didlogic'].includes(String(raw.provider)) || raw.provisioningStatus !== 'unverified' || !revision(raw.revision) || !version(raw.version) || !text(raw.name, 200) || !/^\+[1-9]\d{7,14}$/.test(raw.number) || !date(raw.createdAt) || !date(raw.updatedAt)) fail()
    if (raw.providerNumberId !== null && !text(raw.providerNumberId, 150)) fail()
    for (const k of ['agentId', 'channelId']) if (raw[k] !== null && !id(raw[k])) fail()
    if (!Array.isArray(raw.capabilities) || raw.capabilities.length > 3 || new Set(raw.capabilities).size !== raw.capabilities.length || raw.capabilities.some((c: unknown) => !['voice', 'sms', 'whatsapp'].includes(String(c)))) fail()
    const proof = raw.ownership
    if (proof !== null && (!object(proof) || proof.source !== 'twilio' || !date(proof.checkedAt) || !['registration', 'routing'].includes(proof.scope))) fail()
    return { id: raw.id, tenantId: raw.tenantId, name: raw.name, number: raw.number, provider: raw.provider as 'twilio', providerNumberId: raw.providerNumberId, agentId: raw.agentId, channelId: raw.channelId, capabilities: [...raw.capabilities], provisioningStatus: 'unverified', createdAt: raw.createdAt, updatedAt: raw.updatedAt, revision: raw.revision, version: raw.version, ownership: proof === null ? null : { source: 'twilio', checkedAt: proof.checkedAt, scope: proof.scope } }
  }
  function operation(raw: unknown, a: PhoneAttempt): PhoneOperation {
    if (!validPhoneAttempt(a) || !object(raw) || raw.key !== a.key || raw.kind !== a.kind || raw.tenantId !== context.tenantId || !id(raw.numberId) || raw.status !== 'succeeded' || raw.automaticRetry !== false || !date(raw.createdAt)) fail()
    const r = raw.result
    if (!object(r) || r.numberId !== raw.numberId || !version(r.version) || r.deleted !== (a.kind === 'delete') || r.revision !== (a.kind === 'create' ? 1 : a.expectedRevision + 1) || a.kind !== 'create' && (raw.numberId !== a.numberId || r.version === a.expectedVersion)) fail()
    return { key: raw.key, kind: raw.kind, tenantId: raw.tenantId, numberId: raw.numberId, status: 'succeeded', automaticRetry: false, createdAt: raw.createdAt, result: { numberId: r.numberId, revision: r.revision, version: r.version, deleted: r.deleted } }
  }
  async function mutate(a: PhoneAttempt, body: unknown) {
    if (!validPhoneAttempt(a)) fail()
    const method = a.kind === 'create' ? 'POST' : a.kind === 'update' ? 'PATCH' : 'DELETE'
    const raw = await request('/phone-config/numbers' + (a.kind === 'create' ? '' : '/' + a.numberId), { method, idempotencyKey: a.key, body: { ...body as object, expectedTenantId: context.tenantId, ...(a.kind === 'create' ? {} : { expectedVersion: a.expectedVersion }) }, timeoutMs: 30000 })
    if (!object(raw) || typeof raw.replayed !== 'boolean') fail()
    return { operation: operation(raw.operation, a), replayed: raw.replayed }
  }
  return {
    async list() {
      const rows: ConfiguredPhone[] = [], ids = new Set<string>(), cursors = new Set<string>(); let cursor: string | undefined
      for (let page = 0; page < 1000; page++) {
        const raw = await request('/phone-config/numbers', { query: { limit: 100, cursor } })
        if (!object(raw) || !Array.isArray(raw.items) || raw.items.length > 100 || raw.limit !== 100 || raw.nextCursor !== null && (!text(raw.nextCursor, 1024) || !raw.nextCursor)) fail()
        for (const item of raw.items) { const row = phone(item); if (ids.has(row.id)) fail(); ids.add(row.id); rows.push(row) }
        if (raw.nextCursor === null) return rows
        if (cursors.has(raw.nextCursor)) fail(); cursors.add(raw.nextCursor); cursor = raw.nextCursor
      }
      return fail()
    },
    async get(numberId: string) { if (!id(numberId)) fail(); const row = phone(await request('/phone-config/numbers/' + numberId)); if (row.id !== numberId) fail(); return row },
    async create(a: PhoneAttempt, input: PhoneCreate) { if (a.kind !== 'create') fail(); return mutate(a, phoneCreate(input)) },
    async update(a: PhoneAttempt, input: PhonePatch) { if (a.kind !== 'update') fail(); return mutate(a, phonePatch(input)) },
    async remove(a: PhoneAttempt) { if (a.kind !== 'delete') fail(); return mutate(a, {}) },
    async operation(a: PhoneAttempt) { if (!validPhoneAttempt(a)) fail(); return operation(await request('/phone-config/operations/' + a.key), a) },
  }
}
