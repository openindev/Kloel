import { EngineError } from './http'
import type { EngineContext } from './session'
import type { ConfiguredWhatsAppChannel } from './whatsapp-channels'

const phoneEnums = {
  status: ['CONNECTED','DISCONNECTED','PENDING','FLAGGED','RESTRICTED','RATE_LIMITED','MIGRATED','BANNED','DELETED','UNVERIFIED','LINKED','UNKNOWN'],
  qualityRating: ['GREEN','YELLOW','RED','NA','UNKNOWN'],
  codeVerificationStatus: ['VERIFIED','UNVERIFIED','NOT_VERIFIED','EXPIRED'],
  nameStatus: ['APPROVED','AVAILABLE_WITHOUT_REVIEW','DECLINED','EXPIRED','PENDING_REVIEW','NONE'],
  accountMode: ['LIVE','SANDBOX'],
} as const
const scopeNames = ['whatsapp_business_management','whatsapp_business_messaging','business_management'] as const
export interface WhatsAppConnectionVerification {
  channelId: string; tenantId: string; version: string; checkedAt: string; status: 'metadata_verified'
  appId: string; wabaId: string; phoneId: string
  token: { valid: true; expiresAt: number | null; dataAccessExpiresAt: number | null; scopes: string[] }
  phone: { status: string | null; qualityRating: string | null; codeVerificationStatus: string | null; nameStatus: string | null; accountMode: string | null }
  proof: { webhookDelivery: false; messageSending: false }
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown) => typeof v === 'string' && /^\d{1,40}$/.test(v)
const expiry = (v: unknown) => v === null || Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 253402300799
function invalid(): never { throw new EngineError(0, 'invalid_meta_verification', 'A resposta de verificação é inválida. Nenhuma configuração foi alterada.') }
export function parseWhatsAppConnection(raw: unknown, row: ConfiguredWhatsAppChannel): WhatsAppConnectionVerification {
  if (!object(raw) || raw.channelId !== row.id || raw.tenantId !== row.tenantId || raw.version !== row.version || raw.phoneId !== row.externalId || !id(raw.appId) || !id(raw.wabaId) || !id(raw.phoneId) || raw.status !== 'metadata_verified' || typeof raw.checkedAt !== 'string' || !Number.isFinite(Date.parse(raw.checkedAt))) invalid()
  const t = raw.token, p = raw.phone
  if (!object(t) || t.valid !== true || !expiry(t.expiresAt) || !expiry(t.dataAccessExpiresAt) || !Array.isArray(t.scopes) || t.scopes.length > 3 || new Set(t.scopes).size !== t.scopes.length || t.scopes.some((s: any) => !scopeNames.includes(s)) || !t.scopes.includes('whatsapp_business_management')) invalid()
  if (!object(p) || Object.entries(phoneEnums).some(([key, allowed]) => p[key] !== null && !(allowed as readonly unknown[]).includes(p[key]))) invalid()
  if (!object(raw.proof) || raw.proof.webhookDelivery !== false || raw.proof.messageSending !== false) invalid()
  return { channelId: raw.channelId, tenantId: raw.tenantId, version: raw.version, checkedAt: raw.checkedAt, status: 'metadata_verified', appId: raw.appId, wabaId: raw.wabaId, phoneId: raw.phoneId,
    token: { valid: true, expiresAt: t.expiresAt, dataAccessExpiresAt: t.dataAccessExpiresAt, scopes: [...t.scopes] }, phone: { status: p.status, qualityRating: p.qualityRating, codeVerificationStatus: p.codeVerificationStatus, nameStatus: p.nameStatus, accountMode: p.accountMode }, proof: { webhookDelivery: false, messageSending: false } }
}
export function createWhatsAppConnectionService(context: EngineContext) {
  return { async verify(row: ConfiguredWhatsAppChannel, signal?: AbortSignal) {
    context.assertCurrent()
    if (row.tenantId !== context.tenantId || row.provider !== 'meta' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(row.id) || !/^[a-f0-9]{64}$/.test(row.version) || !id(row.externalId)) invalid()
    const raw = await context.request<unknown>(`/whatsapp/channels/${row.id}/verify-connection`, { method: 'POST', signal, body: { expectedTenantId: context.tenantId, expectedVersion: row.version } })
    context.assertCurrent(); return parseWhatsAppConnection(raw, row)
  } }
}
export function metaVerificationMessage(error: unknown): string {
  const messages: Record<string, string> = {
    meta_verification_not_configured: 'Configure App ID, WABA, número e credencial no servidor antes de verificar.', meta_tenant_not_bound: 'Esta organização não está vinculada à conexão do servidor.',
    meta_phone_configuration_mismatch: 'Este canal usa um número diferente da conexão do servidor.', meta_app_mismatch: 'A credencial pertence a outro aplicativo Meta.',
    meta_token_invalid: 'A Meta informou que a credencial não é válida.', meta_token_expired: 'A credencial ou o acesso aos dados expirou.', meta_management_scope_missing: 'A credencial não informa permissão para gerenciar a conta WhatsApp.',
    meta_phone_not_in_waba: 'O número não foi encontrado na conta WhatsApp configurada.', meta_phone_listing_incomplete: 'A listagem limitada não confirmou o número. A consulta ficou inconclusiva.',
    meta_verification_timeout: 'A consulta excedeu o tempo limite. Nenhuma configuração foi alterada.', meta_rate_limited: 'A Meta limitou a consulta. Tente novamente mais tarde.', meta_verification_busy: 'Já existe uma verificação em andamento nesta organização.',
    meta_provider_rejected: 'A Meta recusou a consulta. Confira a credencial e suas permissões.', meta_verification_configuration_changed: 'A conexão mudou durante a consulta. Verifique a configuração atual.', whatsapp_channel_configuration_changed: 'O canal mudou. Atualize os cadastros antes de verificar novamente.',
  }
  return error instanceof EngineError && messages[error.code] || 'Não foi possível confirmar a conexão. Nenhuma configuração foi alterada.'
}
