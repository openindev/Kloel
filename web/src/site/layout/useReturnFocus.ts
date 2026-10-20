import { useCallback, useLayoutEffect, useRef } from 'react'

/** Último gatilho fora de qualquer diálogo: usado quando um diálogo abre outro (vaga → candidatura, detalhe → lista de espera). */
let lastOutside: HTMLElement | null = null

const inDialog = (el: Element) => !!el.closest('[role="dialog"],[role="alertdialog"]')

/**
 * Devolução de foco para diálogos abertos por estado/URL (sem `DialogTrigger`).
 * O Radix devolve o foco ao `DialogTrigger`; sem ele, o foco cai no `<body>` ao fechar (Esc, ×, Cancelar).
 * O hook guarda o elemento focado no instante em que `open` vira `true` e o retorna em `onCloseAutoFocus`:
 * - se o diálogo foi aberto de dentro de outro diálogo (ou enquanto outro fecha), usa o último gatilho fora de diálogos;
 * - não devolve o foco se outro diálogo continuar aberto, se a página mudou (link dentro do diálogo) ou se o gatilho sumiu;
 * - `preventScroll`: o foco volta sem mexer na rolagem.
 * Uso: `const onCloseAutoFocus = useReturnFocus(open)` e `<DialogContent onCloseAutoFocus={onCloseAutoFocus}>`.
 */
export function useReturnFocus(open: boolean) {
  const trigger = useRef<HTMLElement | null>(null)
  const path = useRef('')
  useLayoutEffect(() => {
    if (!open) return
    path.current = window.location.pathname
    const a = document.activeElement
    // outro diálogo fechando no mesmo instante (o conteúdo dele pode já ter saído do DOM e levado o foco para o <body>)
    const chained = !!document.querySelector('[role="dialog"][data-state="closed"],[role="alertdialog"][data-state="closed"]')
    if (a instanceof HTMLElement && a !== document.body && !inDialog(a)) {
      trigger.current = a
      lastOutside = a
    } else if ((a instanceof HTMLElement && a !== document.body) || chained) {
      trigger.current = lastOutside?.isConnected ? lastOutside : null
    } else trigger.current = null
  }, [open])
  return useCallback((e: Event) => {
    e.preventDefault()
    const el = trigger.current
    if (!el || !el.isConnected) return
    if (window.location.pathname !== path.current) return
    if (document.querySelector('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]')) return
    el.focus({ preventScroll: true })
  }, [])
}
