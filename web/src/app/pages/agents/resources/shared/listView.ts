import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Agent } from '@/domain/types'

export interface ResourceProps {
  agent: Agent
  open: boolean
  onOpenChange: (o: boolean) => void
}

/* ------------------------------------------------------------------ */
/* Sub-tela da folha na URL (?item=)                                   */
/* ------------------------------------------------------------------ */

/**
 * Sub-tela aberta dentro da folha de recurso, refletida no parâmetro `?item=` (junto de `?recurso=`, ResourcesGrid):
 * abrir um item empilha uma entrada no histórico (Voltar retorna à lista), voltar à lista desempilha e
 * recarregar a página reabre o mesmo item. Fora da grade (sem provedor) as folhas funcionam só com estado local.
 */
export interface ResourceRoute {
  /** valor atual de ?item= (null = tela principal da folha) */
  item: string | null
  /** abre uma sub-tela a partir da principal (push) */
  pushItem: (item: string) => void
  /** troca a sub-tela atual sem empilhar; null remove o parâmetro (replace) */
  replaceItem: (item: string | null) => void
  /** volta para a tela principal (desempilha se a sub-tela foi empilhada) */
  clearItem: () => void
}

export const ResourceRouteContext = createContext<ResourceRoute | null>(null)

export function useResourceRoute() {
  return useContext(ResourceRouteContext)
}

/**
 * Estado de sub-tela sincronizado com `?item=`.
 * - `init(item)`: tela inicial a partir do parâmetro (inválido → tela principal);
 * - `itemOf(view)`: parâmetro que representa a tela (null = não vai para a URL);
 * - `fromItem(item, cur)`: tela pedida por Voltar/Avançar/URL (`item` null = tela principal).
 * `go(make)` troca a tela e atualiza a URL (push ao sair da principal, replace entre sub-telas, pop ao voltar).
 */
export function useRoutedView<V extends { seq: number }>(opts: {
  init: (item: string | null) => V
  itemOf: (v: V) => string | null
  fromItem: (item: string | null, cur: V) => V
}) {
  const route = useResourceRoute()
  const [view, setView] = useState<V>(() => opts.init(route?.item ?? null))
  const viewRef = useRef(view)
  viewRef.current = view
  const optsRef = useRef(opts)
  optsRef.current = opts
  const routeRef = useRef(route)
  routeRef.current = route

  // parâmetro inválido/desatualizado (item excluído, editor direto sem lista) → corrige a URL sem empilhar
  useEffect(() => {
    const r = routeRef.current
    if (!r) return
    const want = optsRef.current.itemOf(viewRef.current)
    if (r.item !== want) r.replaceItem(want)
  }, [])

  // Voltar/Avançar do navegador (ou link direto) mudou ?item= → segue a URL
  const lastItem = useRef(route?.item ?? null)
  const item = route?.item ?? null
  useEffect(() => {
    if (lastItem.current === item) return
    lastItem.current = item
    const { itemOf, fromItem } = optsRef.current
    const cur = viewRef.current
    if (itemOf(cur) === item) return
    const next = fromItem(item, cur)
    viewRef.current = next
    setView(next)
    const r = routeRef.current
    const want = itemOf(next)
    if (r && want !== item) r.replaceItem(want)
  }, [item])

  const go = (make: (cur: V) => V) => {
    const cur = viewRef.current
    const next = make(cur)
    viewRef.current = next
    setView(next)
    const r = routeRef.current
    if (!r) return
    const { itemOf } = optsRef.current
    const from = r.item
    const to = itemOf(next)
    if (from === to) return
    // a URL alcança a tela nova depois (push/replace no próximo render, pop no popstate): o efeito acima vê
    // itemOf(view) === item e não reage — não antecipar lastItem, senão o render intermediário reabriria a tela antiga
    if (to === null) r.clearItem()
    else if (from === null) r.pushItem(to)
    else r.replaceItem(to)
  }
  return { view, go }
}

/* ------------------------------------------------------------------ */
/* Lista → editor                                                      */
/* ------------------------------------------------------------------ */

export type ListViewState = { mode: 'list'; seq: number } | { mode: 'edit'; id: string | null; fromList: boolean; seq: number; preset?: string }

const NEW_ITEM = 'novo'

/** `novo` / `novo-<preset>` / id do item. */
export function parseNewItem(item: string): { isNew: true; preset?: string } | { isNew: false } {
  if (item === NEW_ITEM) return { isNew: true }
  if (item.startsWith(`${NEW_ITEM}-`)) return { isNew: true, preset: item.slice(NEW_ITEM.length + 1) || undefined }
  return { isNew: false }
}
export const newItemParam = (preset?: string) => (preset ? `${NEW_ITEM}-${preset}` : NEW_ITEM)

/**
 * Navegação lista → editor dentro de uma folha de recurso.
 * Sem itens: abre direto o editor de um novo item (como nas referências); "Salvar"/"Cancelar" fecham a folha.
 * Com itens: abre a lista; o editor volta para a lista ao salvar/cancelar.
 * O editor aberto a partir da lista vai para a URL (?item=<id> ou ?item=novo[-preset]); `exists` valida o id.
 */
export function useListView(hasItems: boolean, onClose?: () => void, exists?: (id: string) => boolean) {
  const home = (seq: number): ListViewState => (hasItems ? { mode: 'list', seq } : { mode: 'edit', id: null, fromList: false, seq })
  const fromParam = (item: string | null, seq: number): ListViewState => {
    if (!item) return home(seq)
    const n = parseNewItem(item)
    if (n.isNew) return { mode: 'edit', id: null, fromList: hasItems, seq, preset: n.preset }
    if (exists && !exists(item)) return home(seq)
    return { mode: 'edit', id: item, fromList: hasItems, seq }
  }
  const { view, go } = useRoutedView<ListViewState>({
    init: (item) => fromParam(item, 0),
    itemOf: (v) => (v.mode === 'edit' && v.fromList ? (v.id ?? newItemParam(v.preset)) : null),
    fromItem: (item, cur) => fromParam(item, cur.seq + 1),
  })
  const edit = (id: string) => go((v) => ({ mode: 'edit', id, fromList: true, seq: v.seq + 1 }))
  const add = (preset?: string) => go((v) => ({ mode: 'edit', id: null, fromList: true, seq: v.seq + 1, preset }))
  const toList = () => go((v) => ({ mode: 'list', seq: v.seq + 1 }))
  const done = () => {
    if (view.mode === 'edit' && !view.fromList) onClose?.()
    else toList()
  }
  return { view, edit, add, toList, done }
}
