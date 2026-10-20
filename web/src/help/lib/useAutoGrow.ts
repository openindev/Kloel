import { useLayoutEffect, type RefObject } from 'react'

/**
 * Faz um <textarea> crescer com o texto (Shift+Enter) até o max-height do CSS; a partir daí ele rola.
 * A altura mínima continua vindo das classes (min-h-*), então a caixa vazia mantém a medida da referência.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const max = parseFloat(getComputedStyle(el).maxHeight)
    const h = el.scrollHeight
    el.style.height = `${h}px`
    el.style.overflowY = Number.isFinite(max) && h > max ? 'auto' : 'hidden'
  }, [ref, value])
}
