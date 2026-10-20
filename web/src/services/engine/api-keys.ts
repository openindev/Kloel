import { EngineError } from './http'
import type { EngineContext } from './session'

export type ApiKeyView = { id: string; name: string; prefix: string; last4: string; secret: string; scopes: string[]; permissions: string[]; createdAt: string; expiresAt: string; lastUsedAt: string | null; status: 'active' | 'expired' | 'revoked' | 'unavailable' }
type Context = Pick<EngineContext, 'request'>
const route = (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new EngineError(0, 'invalid_key_id', 'Identificador de chave inválido.')
  return `/api-keys/${id}`
}
/** Public metadata never retains a full secret, even if an upstream response includes one. */
export function apiKeyView(value: ApiKeyView): ApiKeyView {
  if (!value || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.last4 !== 'string' || value.last4.length !== 4 || !Array.isArray(value.scopes) || !Array.isArray(value.permissions)) throw new EngineError(0, 'invalid_response', 'Os dados da chave de API recebidos são inválidos.')
  route(value.id)
  return { id: value.id, name: value.name, prefix: 'klo_key_', last4: value.last4, secret: `klo_key_••••••••••••${value.last4}`, scopes: value.scopes, permissions: value.permissions, createdAt: value.createdAt, expiresAt: value.expiresAt, lastUsedAt: value.lastUsedAt, status: value.status }
}
export function apiKeyCommands(context: Context) {
  return {
    async list() {
      const value = await context.request<{ items: ApiKeyView[]; availableScopes: string[] }>('/api-keys')
      if (!Array.isArray(value.items) || !Array.isArray(value.availableScopes)) throw new EngineError(0, 'invalid_response', 'Não foi possível ler as chaves.')
      return { items: value.items.map(apiKeyView), availableScopes: value.availableScopes }
    },
    async create(name: string, scopes: string[]) {
      const value = await context.request<ApiKeyView & { secretDisplayedOnce: boolean }>('/api-keys', { method: 'POST', body: { name: name.trim(), scopes: [...new Set(scopes)] } })
      if (value.secretDisplayedOnce !== true || !/^klo_key_[A-Za-z0-9_-]{43}$/.test(value.secret)) throw new EngineError(0, 'invalid_response', 'A criação não retornou uma chave utilizável. Atualize a lista antes de tentar novamente.')
      return { key: apiKeyView(value), secret: value.secret }
    },
    async rename(id: string, name: string) { return apiKeyView(await context.request<ApiKeyView>(route(id), { method: 'PATCH', body: { name: name.trim() } })) },
    async revoke(id: string) { await context.request<void>(route(id), { method: 'DELETE' }) },
  }
}
