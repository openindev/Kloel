import type { ApiKey } from '@/domain/types'
import { useStore } from '@/data/store'
import { apiKeyCommands, type ApiKeyView } from '../engine/api-keys'
import { captureEngineContext, type EngineContext } from '../engine/session'
import { publishSlice } from './data'

export function projectApiKey(value: ApiKeyView, tenantId: string): ApiKey {
  return { id: value.id, orgId: tenantId, name: value.name, prefix: value.prefix,
    secret: `${value.prefix}••••••••••••${value.last4}`, last4: value.last4,
    createdAt: value.createdAt, lastUsedAt: value.lastUsedAt ?? undefined }
}
export async function loadApiKeys(context: EngineContext) {
  const list = await apiKeyCommands(context).list(); context.assertCurrent()
  return { apiKeys: list.items.filter(row => row.status !== 'revoked').map(row => projectApiKey(row, context.tenantId)) }
}
export function createApiKeyCommands(context: EngineContext) {
  const api = apiKeyCommands(context)
  let busy = false
  const confirmed = (row: ApiKeyView) => {
    context.assertCurrent()
    const keys = useStore.getState().db.apiKeys.filter(key => key.id !== row.id)
    publishSlice(context, { apiKeys: [...keys, projectApiKey(row, context.tenantId)] })
  }
  return {
    async create(name: string) {
      context.assertCurrent()
      if (busy) throw new Error('Aguarde a confirmação da chave.')
      busy = true
      try {
        const { availableScopes } = await api.list(); context.assertCurrent()
        const scopes = availableScopes.filter(scope => scope.endsWith(':read'))
        if (!scopes.length) throw new Error('Sua conta não pode criar chaves de API.')
        const result = await api.create(name, scopes)
        confirmed(result.key)
        // The one-time secret is returned only to the current dialog, never to the projection.
        return { name: result.key.name, secret: result.secret }
      } catch (error) {
        // A failed response may follow a successful creation. Refresh metadata, never replay creation.
        try { publishSlice(context, await loadApiKeys(context)) } catch { /* preserve original uncertainty */ }
        throw error
      } finally { busy = false }
    },
    async rename(id: string, name: string) { context.assertCurrent(); confirmed(await api.rename(id, name)) },
    async revoke(id: string) {
      context.assertCurrent(); await api.revoke(id); context.assertCurrent()
      publishSlice(context, { apiKeys: useStore.getState().db.apiKeys.filter(row => row.id !== id) })
    },
  }
}
export const currentApiKeyCommands = () => createApiKeyCommands(captureEngineContext('api_keys:manage'))
