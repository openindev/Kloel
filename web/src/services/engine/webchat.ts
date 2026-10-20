import { EngineError } from './http'
import type { EngineContext } from './session'

export type WebchatReason = 'agent_missing' | 'agent_inactive' | 'origins_missing' | 'origins_invalid' | 'provider_unsupported' | 'provider_not_configured' | 'tenant_not_bound' | 'installation_unavailable'
export type WebchatFields = { name: string; configuration: { allowedOrigins: string[]; greeting: string } }
export type WebchatChannel = WebchatFields & { id: string; tenantId: string; agentId: string | null; type: 'webchat'; provider: string; enabled: boolean; revision: number; version: string; createdAt: string; updatedAt: string; readiness: { canEnable: boolean; available: boolean; reasons: WebchatReason[] }; installation: null | { scriptUrl: string; tenantId: string; channelId: string; snippet: string } }
export type WebchatKind = 'create' | 'update' | 'enable' | 'disable'
export type WebchatAttempt = { key: string; kind: WebchatKind; channelId?: string; expectedVersion?: string }
export type WebchatReceipt = { key: string; tenantId: string; channelId: string; kind: WebchatKind; status: 'succeeded'; automaticRetry: false; result: { channelId: string; version: string; revision: number; enabled: boolean }; createdAt: string }
export type WebchatPage = { items: WebchatChannel[]; nextCursor: string | null; limit: number }
const reasons: WebchatReason[] = ['agent_missing', 'agent_inactive', 'origins_missing', 'origins_invalid', 'provider_unsupported', 'provider_not_configured', 'tenant_not_bound', 'installation_unavailable']
const kinds: WebchatKind[] = ['create', 'update', 'enable', 'disable']
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
function invalid(message = 'A configuração de webchat recebida é inválida.'): never { throw new EngineError(0, 'invalid_webchat', message) }
function id(value: string) { if (!identifier(value)) invalid(); return value }
function key(value: string) { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value)) invalid(); return value }
function safeOrigin(value: string): string {
  try {
    const url = new URL(value.trim())
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || value.includes('*') || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) invalid('Use uma origem HTTPS sem caminho, consulta ou fragmento. HTTP é permitido apenas no localhost.')
    return url.origin
  } catch (error) { if (error instanceof EngineError) throw error; invalid('Informe uma origem válida, como https://exemplo.com.br.') }
}
export function webchatFields(input: WebchatFields): WebchatFields {
  if (!object(input) || !text(input.name, 200) || !input.name.trim() || !object(input.configuration) || !Array.isArray(input.configuration.allowedOrigins) || input.configuration.allowedOrigins.length > 50 || input.configuration.allowedOrigins.some((origin: unknown) => !text(origin, 2048)) || !text(input.configuration.greeting, 1000)) invalid('Confira nome, origens permitidas e saudação do webchat.')
  return { name: input.name.trim(), configuration: { allowedOrigins: [...new Set(input.configuration.allowedOrigins.filter(origin => origin.trim()).map(safeOrigin))].sort(), greeting: input.configuration.greeting } }
}
export function editableWebchat(channel: WebchatChannel): WebchatFields { return { name: channel.name, configuration: { allowedOrigins: [...channel.configuration.allowedOrigins], greeting: channel.configuration.greeting } } }
export function parseWebchatChannel(raw: unknown, tenantId: string, agentId: string | null): WebchatChannel {
  if (agentId !== null && !identifier(agentId)) invalid()
  if (!object(raw) || !identifier(raw.id) || raw.tenantId !== tenantId || raw.agentId !== agentId || raw.type !== 'webchat' || !text(raw.provider, 100) || !raw.provider || typeof raw.enabled !== 'boolean' || !revision(raw.revision) || !version(raw.version) || !date(raw.createdAt) || !date(raw.updatedAt) || !text(raw.name, 200) || !raw.name || !object(raw.configuration) || !Array.isArray(raw.configuration.allowedOrigins) || raw.configuration.allowedOrigins.length > 50 || raw.configuration.allowedOrigins.some((origin: unknown) => !text(origin, 4000)) || !text(raw.configuration.greeting, 5000)) invalid()
  const ready = raw.readiness
  if (!object(ready) || typeof ready.canEnable !== 'boolean' || typeof ready.available !== 'boolean' || !Array.isArray(ready.reasons) || ready.reasons.some((reason: unknown) => !reasons.includes(reason as WebchatReason)) || ready.available && (!raw.enabled || !ready.canEnable)) invalid()
  let installation: WebchatChannel['installation'] = null
  if (raw.installation !== null) {
    const value = raw.installation
    if (!object(value) || typeof value.scriptUrl !== 'string' || value.tenantId !== tenantId || value.channelId !== raw.id) invalid()
    let url: URL
    try { url = new URL(value.scriptUrl) } catch { invalid() }
    if (url!.pathname !== '/widget/kloel.js' || url!.search || url!.hash || url!.username || url!.password || safeOrigin(url!.origin) !== url!.origin || url!.href !== value.scriptUrl) invalid()
    const snippet = `<script src="${url!.href}" data-kloel-tenant="${tenantId}" data-kloel-channel="${raw.id}" async></script>`
    installation = { scriptUrl: url!.href, tenantId, channelId: raw.id, snippet }
  }
  return { id: raw.id, tenantId, agentId, name: raw.name, type: 'webchat', provider: raw.provider, enabled: raw.enabled, configuration: { allowedOrigins: [...raw.configuration.allowedOrigins], greeting: raw.configuration.greeting }, revision: raw.revision, version: raw.version, createdAt: raw.createdAt, updatedAt: raw.updatedAt, readiness: { canEnable: ready.canEnable, available: ready.available, reasons: [...ready.reasons] }, installation }
}
function parseReceipt(raw: unknown, tenantId: string, attempt: WebchatAttempt): WebchatReceipt {
  if (!object(raw) || raw.key !== attempt.key || raw.tenantId !== tenantId || raw.kind !== attempt.kind || !kinds.includes(raw.kind) || !identifier(raw.channelId) || attempt.channelId !== undefined && raw.channelId !== attempt.channelId || raw.status !== 'succeeded' || raw.automaticRetry !== false || !date(raw.createdAt) || !object(raw.result) || raw.result.channelId !== raw.channelId || !version(raw.result.version) || !revision(raw.result.revision) || typeof raw.result.enabled !== 'boolean' || (raw.kind === 'disable' || raw.kind === 'create') && raw.result.enabled || raw.kind === 'enable' && !raw.result.enabled) invalid('O recibo não corresponde à operação de webchat solicitada.')
  return { key: raw.key, tenantId, channelId: raw.channelId, kind: raw.kind, status: 'succeeded', automaticRetry: false, result: { channelId: raw.result.channelId, version: raw.result.version, revision: raw.result.revision, enabled: raw.result.enabled }, createdAt: raw.createdAt }
}
export function createWebchatService(context: EngineContext, agentId: string) {
  id(agentId)
  const get = async <T,>(path: string, options?: Parameters<EngineContext['request']>[1]) => { const value = await context.request<T>(path, options); context.assertCurrent(); return value }
  const read = async (channelId: string, signal?: AbortSignal) => { const channel = parseWebchatChannel(await get(`/webchat/channels/${id(channelId)}`, { signal }), context.tenantId, agentId); if (channel.id !== channelId) invalid(); return channel }
  async function write(attempt: WebchatAttempt, fields?: WebchatFields) {
    key(attempt.key)
    if (!kinds.includes(attempt.kind) || attempt.kind !== 'create' && (!attempt.channelId || !version(attempt.expectedVersion))) invalid()
    const base = { expectedTenantId: context.tenantId, idempotencyKey: attempt.key }
    const path = attempt.kind === 'create' ? '/webchat/channels' : `/webchat/channels/${id(attempt.channelId!)}${attempt.kind === 'update' ? '' : '/' + attempt.kind}`
    const body = attempt.kind === 'create' ? { ...base, agentId, ...webchatFields(fields!) } : { ...base, expectedVersion: attempt.expectedVersion, ...(attempt.kind === 'update' ? webchatFields(fields!) : {}) }
    const raw = await get<unknown>(path, { method: attempt.kind === 'update' ? 'PATCH' : 'POST', body })
    if (!object(raw) || typeof raw.replayed !== 'boolean') invalid()
    const operation = parseReceipt(raw.operation, context.tenantId, attempt), channel = parseWebchatChannel(raw.channel, context.tenantId, agentId)
    if (channel.id !== operation.channelId || !raw.replayed && (channel.version !== operation.result.version || channel.revision !== operation.result.revision || channel.enabled !== operation.result.enabled)) invalid()
    return { channel, operation, replayed: raw.replayed }
  }
  return {
    async list(cursor?: string, signal?: AbortSignal): Promise<WebchatPage> {
      if (cursor !== undefined && (!cursor || cursor.length > 4096)) invalid()
      const raw = await get<unknown>('/webchat/channels', { query: { agentId, limit: 25, cursor }, signal })
      if (!object(raw) || raw.limit !== 25 || !Array.isArray(raw.items) || raw.items.length > 25 || raw.nextCursor !== null && (!text(raw.nextCursor, 4096) || !raw.nextCursor)) invalid()
      const items = raw.items.map((item: unknown) => parseWebchatChannel(item, context.tenantId, agentId))
      if (new Set(items.map((item: WebchatChannel) => item.id)).size !== items.length) invalid()
      return { items, nextCursor: raw.nextCursor, limit: 25 }
    }, read, write,
    async operation(attempt: WebchatAttempt) { return parseReceipt(await get(`/webchat/operations/${key(attempt.key)}`), context.tenantId, attempt) },
  }
}
export const webchatReasonText: Record<WebchatReason, string> = { agent_missing: 'Vincule um assistente existente.', agent_inactive: 'Ative o assistente para disponibilizar o chat.', origins_missing: 'Adicione ao menos uma origem permitida.', origins_invalid: 'Corrija as origens permitidas.', provider_unsupported: 'Este cadastro antigo usa um provedor incompatível.', provider_not_configured: 'A configuração da IA está indisponível.', tenant_not_bound: 'Esta organização ainda não está vinculada ao serviço de IA.', installation_unavailable: 'O endereço de instalação ainda não está disponível.' }
