import { EngineError } from '../engine/http'
import type { EngineContext } from '../engine/session'
const invalid = () => new EngineError(0, 'invalid_search', 'Não foi possível confirmar os resultados da busca. Tente novamente.')
export async function searchConversations(context: EngineContext, query: string, signal?: AbortSignal): Promise<Set<string>> {
  const q = query.trim()
  if (!q || q.length > 300) throw new EngineError(0, 'invalid_search', 'A busca deve ter de 1 a 300 caracteres.')
  const ids = new Set<string>(); let total: number | undefined
  for (let page = 1; page <= 1000; page++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const raw = await context.request<unknown>('/conversation-search', { query: { q, page, limit: 100 }, signal })
    context.assertCurrent()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid()
    const result = raw as Record<string, unknown>
    if (!Array.isArray(result.items) || result.items.length > 100 || result.page !== page || result.limit !== 100 || !Number.isSafeInteger(result.total) || Number(result.total) < 0 || result.totalPages !== Math.ceil(Number(result.total) / 100)) throw invalid()
    if (total !== undefined && result.total !== total) throw invalid()
    total = Number(result.total)
    for (const item of result.items) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || Object.keys(item).length !== 1 || ids.has(item.id)) throw invalid()
      ids.add(item.id)
    }
    if (page >= Number(result.totalPages)) { if (ids.size !== total) throw invalid(); return ids }
    if (page === 1000) throw new EngineError(0, 'search_limit', 'A busca retornou muitos resultados. Refine o termo.')
    await new Promise(resolve => setTimeout(resolve, 650))
  }
  throw invalid()
}
