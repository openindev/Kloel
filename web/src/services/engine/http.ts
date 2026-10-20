import type { ExpectedContext } from './types'

export class EngineError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly rawStatus?: number) { super(message); this.name = 'EngineError' }
}
export type RequestOptions = { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal; etag?: string; query?: Record<string, string | number | undefined>; idempotencyKey?: string; timeoutMs?: number; expectedContext?: ExpectedContext }
export type EngineRequest = <T>(path: string, options?: RequestOptions) => Promise<T>

export function parseExpectedContext(value: unknown): ExpectedContext {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  const identifier = (item: unknown): item is string => typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item)
  if (!object || !identifier(object.userId) || object.tenantId !== null && !identifier(object.tenantId) || object.membershipId !== null && !identifier(object.membershipId) || (object.tenantId === null) !== (object.membershipId === null) || typeof object.authorityVersion !== 'string' || !/^[a-f0-9]{64}$/.test(object.authorityVersion)) throw new EngineError(0, 'invalid_context', 'Os dados de acesso recebidos não possuem um contexto válido.')
  return Object.freeze({ userId: object.userId, tenantId: object.tenantId, membershipId: object.membershipId, authorityVersion: object.authorityVersion }) as ExpectedContext
}

/** Cookie-only, same-origin client. Never retry mutations after an ambiguous network result. */
export function createEngineClient(fetcher: typeof fetch = globalThis.fetch.bind(globalThis), timeoutMs = 15000): EngineRequest {
  return async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    // Durable voice keys may contain dots/colons. Only this parameterized route
    // admits them, with colon encoded and no path separators or dot segments.
    const voiceOperationPath = /^\/ai\/realtime\/operations\/[a-z0-9](?:[a-z0-9._-]|%3a){7,127}(?:\/(?:cancel|heartbeat))?$/i.test(path)
    if (!/^\/[a-z0-9][a-z0-9/_-]*(?:\?[^#\\\s]*)?$/i.test(path) && !voiceOperationPath) throw new EngineError(0, 'invalid_path', 'O endereço solicitado é inválido.')
    if (options.idempotencyKey && !/^[a-zA-Z0-9._:-]{8,128}$/.test(options.idempotencyKey)) throw new EngineError(0, 'invalid_key', 'Chave de operação inválida.')
    const expected = options.expectedContext === undefined ? undefined : parseExpectedContext(options.expectedContext)
    const contextHeaders: Record<string, string> = expected ? { 'X-Kloel-Expected-User': expected.userId, 'X-Kloel-Expected-Tenant': expected.tenantId ?? '-', 'X-Kloel-Expected-Membership': expected.membershipId ?? '-', 'X-Kloel-Expected-Authority': expected.authorityVersion } : {}
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) query.set(key, String(value))
    const url = `/api/v1${path}${query.size ? `${path.includes('?') ? '&' : '?'}${query}` : ''}`
    const abort = new AbortController()
    const cancel = () => abort.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    const timer = setTimeout(() => abort.abort(), options.timeoutMs === undefined ? timeoutMs : Math.max(1000, Math.min(60000, options.timeoutMs)))
    try {
      const response = await fetcher(url, {
        method: options.method ?? 'GET', credentials: 'include', redirect: 'error', signal: abort.signal,
        cache: 'no-store', headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.etag ? { 'If-Match': options.etag } : {}), ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}), ...contextHeaders },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      if (response.status === 204) return undefined as T
      const result = await response.json().catch(() => null)
      if (!response.ok) throw new EngineError(response.status === 409 && result?.error?.code === 'context_changed_in_flight' ? 0 : response.status, result?.error?.code ?? 'request_failed', result?.error?.message ?? `Não foi possível concluir a operação (${response.status}).`, response.status)
      if (result === null) throw new EngineError(response.status, 'invalid_response', 'Recebemos uma resposta inválida. Tente novamente.')
      return result as T
    } catch (error) {
      if (error instanceof EngineError) throw error
      if (options.signal?.aborted) throw new EngineError(0, 'superseded', 'Operação substituída por uma sessão mais recente.')
      throw new EngineError(0, 'network_error', options.method && options.method !== 'GET'
        ? 'Não foi possível confirmar a operação. Atualize a sessão antes de tentar novamente.'
        : 'Não foi possível conectar. Verifique a conexão e tente novamente.')
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', cancel)
    }
  }
}

export function safeNext(next: string | null) {
  if (!next || /[\\\u0000-\u0020\u007f]/.test(next) || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(next)) return '/app'
  let url: URL
  try { url = new URL(next, 'https://kloel.invalid') } catch { return '/app' }
  return url.origin === 'https://kloel.invalid' && (url.pathname === '/app' || url.pathname.startsWith('/app/')) ? url.pathname + url.search + url.hash : '/app'
}
