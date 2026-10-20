import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Paginação local (tabelas do app). Rodapé no padrão shadcn DataTable:
 * "Mostrando a–b de N" + Anterior/Próxima. INFERIDO (a Fonio não exibe paginação com os dados da conta capturada).
 */
/** Chave de reinício comparada por valor (objetos/arrays não reiniciam a cada renderização). */
function keyOf(resetKey: unknown) {
  if (resetKey === null || typeof resetKey !== 'object') return resetKey
  try {
    return JSON.stringify(resetKey)
  } catch {
    return String(resetKey)
  }
}

export function usePagination<T>(items: T[], pageSize = 10, resetKey?: unknown) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const key = keyOf(resetKey)
  useEffect(() => setPage(0), [key])
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])
  const pageItems = useMemo(() => items.slice(page * pageSize, page * pageSize + pageSize), [items, page, pageSize])
  return { page, setPage, pageCount, pageItems, total: items.length, pageSize }
}

/**
 * compact: para colunas estreitas (~260–340px) — só "a–b de N" e botões de ícone.
 * Em telas pequenas o contador encurta para "a–b de N" e nunca quebra linha.
 */
export function PaginationBar({ page, pageCount, total, pageSize, setPage, className, hideWhenSingle = true, compact = false }: { page: number; pageCount: number; total: number; pageSize: number; setPage: (p: number) => void; className?: string; hideWhenSingle?: boolean; compact?: boolean }) {
  if (hideWhenSingle && pageCount <= 1) return null
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className={cn('flex items-center justify-between gap-3 px-1 py-3 text-sm', compact && 'gap-2 py-2 text-xs', className)} role="navigation" aria-label="Paginação">
      <span className="min-w-0 truncate whitespace-nowrap text-muted-foreground tabular-nums">
        <span className={cn(compact ? 'hidden' : 'hidden sm:inline')}>Mostrando </span>
        {from}–{to} de {total}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {!compact && (
          <span className="hidden whitespace-nowrap text-muted-foreground tabular-nums md:inline">
            Página {page + 1} de {pageCount}
          </span>
        )}
        <Button variant="outline" size="sm" className={cn('h-8 gap-1 px-2.5', compact && 'size-7 p-0')} disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
          {!compact && 'Anterior'}
        </Button>
        <Button variant="outline" size="sm" className={cn('h-8 gap-1 px-2.5', compact && 'size-7 p-0')} disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} aria-label="Próxima página">
          {!compact && 'Próxima'}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/** Lista incremental ("Carregar mais") para listas longas em colunas (Conversas, Contatos). */
export function useIncremental<T>(items: T[], step = 30, resetKey?: unknown) {
  const [count, setCount] = useState(step)
  const key = keyOf(resetKey)
  useEffect(() => setCount(step), [key, step])
  const visible = useMemo(() => items.slice(0, count), [items, count])
  const loadMore = useCallback(() => setCount((c) => c + step), [step])
  /** Garante que o item de índice `index` esteja carregado (links diretos para um item além da primeira página). */
  const ensureVisible = useCallback((index: number) => {
    if (index < 0) return
    setCount((c) => (index < c ? c : Math.ceil((index + 1) / step) * step))
  }, [step])
  return { visible, hasMore: count < items.length, loadMore, ensureVisible, remaining: Math.max(0, items.length - count) }
}

export function LoadMoreButton({ onClick, remaining, className }: { onClick: () => void; remaining: number; className?: string }) {
  if (remaining <= 0) return null
  return (
    <div className={cn('flex justify-center py-3', className)}>
      <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={onClick}>
        Carregar mais ({remaining})
      </Button>
    </div>
  )
}
