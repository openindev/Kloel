import { useCallback, useLayoutEffect, useRef } from 'react'

const visible = (el: HTMLElement | null): el is HTMLElement => !!el && el.isConnected && el.getClientRects().length > 0

/**
 * Devolução de foco para diálogos CONTROLADOS (abertos por estado, sem `DialogTrigger`).
 * O Radix devolve o foco ao `DialogTrigger`; sem ele, o foco cai no `<body>` ao fechar (Esc, ×, Cancelar, Confirmar).
 * Guarda o elemento focado no instante em que `open` vira `true` — inclusive dentro de outro diálogo/painel lateral
 * (ex.: botão "Excluir" de um SideSheet) — e o devolve em `onCloseAutoFocus`. Se o diálogo foi aberto por um item de
 * menu suspenso (que some ao fechar), devolve ao botão que abriu o menu. Se nenhum dos dois existir mais (o item foi
 * excluído, a página mudou), mantém o comportamento padrão do Radix.
 * Uso: `const onCloseAutoFocus = useRestoreFocus(open)` e `<DialogContent onCloseAutoFocus={onCloseAutoFocus}>`.
 */
export function useRestoreFocus(open: boolean) {
  const target = useRef<HTMLElement | null>(null)
  const menuTrigger = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const a = document.activeElement
    target.current = a instanceof HTMLElement && a !== document.body ? a : null
    const menu = target.current?.closest<HTMLElement>('[role="menu"]')
    const triggerId = menu?.getAttribute('aria-labelledby')
    menuTrigger.current = triggerId ? document.getElementById(triggerId) : null
  }, [open])
  return useCallback((e: Event) => {
    const el = [target.current, menuTrigger.current].find(visible)
    if (!el) return
    e.preventDefault()
    el.focus({ preventScroll: true })
  }, [])
}
