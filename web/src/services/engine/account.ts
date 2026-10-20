import { EngineError } from './http'
import type { EngineContext } from './session'
import type { Profile } from './types'

export const capabilities = ['calendar', 'calendar_write', 'email', 'email_send', 'sheets_read', 'sheets_append'] as const
export type Capability = typeof capabilities[number]
export type Provider = 'google' | 'microsoft'
export type Connection = { id: string; provider: Provider; email: string; displayName: string; visibility: 'personal' | 'shared'; capabilities: Capability[]; status: 'connected' | 'disconnected'; authorizationGeneration: number; /** Whether the signed-in user authorized it (only that person can reconnect it); absent from older engines. */ owned?: boolean; createdAt: string; updatedAt: string }
export type ProviderState = { provider: Provider; configured: boolean; connectedAccounts: number; status: 'not_configured' | 'connected' | 'disconnected'; liveValidated: boolean }
export type ProfileDraft = Pick<Profile, 'firstName' | 'lastName' | 'language' | 'phone'>
function invalid(message: string): never { throw new EngineError(0, 'invalid_response', message) }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: string) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) invalid('Identificador inválido.'); return v }
function profile(raw: unknown, userId: string): Profile {
  if (!object(raw) || raw.id !== userId || typeof raw.email !== 'string' || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0 || ['firstName', 'lastName', 'language'].some(k => typeof raw[k] !== 'string') || (raw.phone !== null && typeof raw.phone !== 'string')) invalid('Os dados do perfil recebidos são inválidos.')
  return { id: userId, email: raw.email, revision: Number(raw.revision), firstName: String(raw.firstName), lastName: String(raw.lastName), language: String(raw.language), phone: raw.phone as string | null, profileCreatedAt: typeof raw.profileCreatedAt === 'string' ? raw.profileCreatedAt : null, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null }
}
function connection(raw: unknown): Connection {
  if (!object(raw) || typeof raw.id !== 'string' || !['google', 'microsoft'].includes(String(raw.provider)) || typeof raw.email !== 'string' || !['personal', 'shared'].includes(String(raw.visibility)) || !['connected', 'disconnected'].includes(String(raw.status)) || !Array.isArray(raw.capabilities) || raw.capabilities.some(c => !capabilities.includes(c)) || !Number.isSafeInteger(raw.authorizationGeneration) || Number(raw.authorizationGeneration) < 0) invalid('Os dados da conexão recebidos são inválidos.')
  return { id: uuid(raw.id), provider: raw.provider as Provider, email: raw.email, displayName: typeof raw.displayName === 'string' ? raw.displayName : raw.email, visibility: raw.visibility as Connection['visibility'], status: raw.status as Connection['status'], capabilities: [...raw.capabilities] as Capability[], authorizationGeneration: Number(raw.authorizationGeneration), ...(typeof raw.owned === 'boolean' ? { owned: raw.owned } : {}), createdAt: String(raw.createdAt), updatedAt: String(raw.updatedAt) }
}
export function authorizationUrl(value: unknown, provider: Provider) {
  if (typeof value !== 'string') invalid('O provedor não retornou uma URL de autorização.')
  let url: URL; try { url = new URL(value) } catch { invalid('URL de autorização inválida.') }
  const valid = provider === 'google' ? url.origin === 'https://accounts.google.com' && url.pathname === '/o/oauth2/v2/auth' : url.origin === 'https://login.microsoftonline.com' && /^\/[a-zA-Z0-9.-]+\/oauth2\/v2\.0\/authorize$/.test(url.pathname)
  if (!valid || url.username || url.password || url.hash) invalid('Destino de autorização não reconhecido.')
  return url.toString()
}
export function accountClient(context: EngineContext, userId: string) {
  return {
    async profile(signal?: AbortSignal) { return profile(await context.request('/account/profile', { signal }), userId) },
    async saveProfile(previous: Profile, draft: ProfileDraft) {
      if (previous.id !== userId) invalid('A conta mudou. Atualize a página.')
      const result = profile(await context.request('/account/profile', { method: 'PATCH', body: { revision: previous.revision, firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), language: draft.language, phone: draft.phone?.trim() || null } }), userId)
      context.assertCurrent(); return result
    },
    async connections(signal?: AbortSignal) {
      const result = await context.request<{ items: unknown[] }>('/oauth/connections', { signal })
      if (!Array.isArray(result.items)) invalid('Lista de conexões inválida.')
      return result.items.map(connection)
    },
    async status(signal?: AbortSignal) {
      const result = await context.request<{ providers: unknown[] }>('/oauth/status', { signal })
      if (!Array.isArray(result.providers)) invalid('Estado de provedores inválido.')
      return result.providers.map(item => {
        if (!object(item) || !['google', 'microsoft'].includes(String(item.provider)) || typeof item.configured !== 'boolean' || !Number.isSafeInteger(item.connectedAccounts) || Number(item.connectedAccounts) < 0 || !['not_configured', 'connected', 'disconnected'].includes(String(item.status)) || typeof item.liveValidated !== 'boolean') invalid('Estado de provedor inválido.')
        return { provider: item.provider, configured: item.configured, connectedAccounts: item.connectedAccounts, status: item.status, liveValidated: item.liveValidated } as ProviderState
      })
    },
    async start(provider: Provider, selected: Capability[]) {
      if (!['google', 'microsoft'].includes(provider) || !selected.length || selected.some(c => !capabilities.includes(c) || (provider === 'microsoft' && c.startsWith('sheets_')))) invalid('Escolha permissões compatíveis com o provedor.')
      const result = await context.request<{ authorizationUrl: string }>(`/oauth/${provider}/start`, { method: 'POST', body: { capabilities: [...new Set(selected)], visibility: 'personal' } })
      context.assertCurrent(); return authorizationUrl(result.authorizationUrl, provider)
    },
    async disconnect(id: string) {
      const result = await context.request<{ id: string; status: string; revokedAtProvider: boolean }>(`/oauth/connections/${uuid(id)}`, { method: 'DELETE' })
      if (result.id !== id || result.status !== 'disconnected' || result.revokedAtProvider !== false) invalid('Não foi possível confirmar a desconexão local.')
      context.assertCurrent(); return result
    },
  }
}
