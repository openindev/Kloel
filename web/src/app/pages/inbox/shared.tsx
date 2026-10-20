import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/utils'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { TooltipContent } from '@/components/ui/tooltip'

/* ------------------------------------------------------------------ */
/* Utilidades compartilhadas por Conversas e Contatos (módulo inbox-contacts) */
/* ------------------------------------------------------------------ */

/** true quando a largura da janela atende à media query. */
export function useMediaQuery(query: string) {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : true)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const on = () => setMatches(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Layout de colunas (lista + detalhe) a partir do breakpoint md (768px). */
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)')

/**
 * Largura real (px) de um elemento, atualizada por ResizeObserver antes da pintura.
 * `guess` é usado no primeiro render (antes da medição).
 */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T>, guess: () => number) {
  const [width, setWidth] = useState(guess)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/** Estimativa da largura da área de conteúdo do app (janela − barra lateral fixa a partir de md). */
export function mainWidthGuess() {
  if (typeof window === 'undefined') return 1280
  const w = window.innerWidth
  if (w < 768) return w
  const side = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-offset'), 10)
  return w - (Number.isFinite(side) ? side : 260)
}

/**
 * Rola um contêiner até o elemento ficar visível (equivalente a block: 'nearest' / 'center'),
 * descontando o cabeçalho fixo (sticky) dos grupos e sem rolar os ancestrais.
 */
export function revealInContainer(container: HTMLElement, el: HTMLElement, mode: 'nearest' | 'center' = 'nearest', stickyTop = 0) {
  const c = container.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const top = c.top + stickyTop
  if (mode === 'center') {
    if (r.top >= top && r.bottom <= c.bottom) return
    container.scrollTop += r.top - top - (c.bottom - top - r.height) / 2
    return
  }
  if (r.top < top) container.scrollTop -= top - r.top
  else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom
}

/** m:ss */
export function formatDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Apenas dígitos (para comparar telefones). Considera os 11 últimos dígitos quando houver DDI. */
export function phoneKey(v: string | undefined) {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length > 11 ? d.slice(-11) : d
}

export function isTypingTarget(el: EventTarget | null) {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/** Baixa um arquivo gerado localmente (Blob). */
export function downloadFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  downloadBlob(filename, new Blob([content], { type: mime }))
}

/** Baixa um Blob já montado (CSV, planilha .xlsx…). */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/* ------------------------------- CSV -------------------------------- */

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Gera CSV (vírgula, UTF-8 com BOM para abrir corretamente no Excel). */
export function toCsv(header: string[], rows: unknown[][]) {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Parser CSV (RFC 4180) com detecção de separador ("," ou ";"). Retorna linhas não vazias. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => {
    let n = 0
    let q = false
    for (const c of firstLine) {
      if (c === '"') q = !q
      else if (!q && c === ch) n++
    }
    return n
  }
  const sep = count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/* --------------- Dica (tooltip) de gatilhos de menu/popover --------------- */

/**
 * Ao fechar um menu/popover, o Radix devolve o foco ao gatilho e a dica abriria sozinha ("Mais", "Etiquetar").
 * Este guarda: (1) não devolve o foco quando o menu foi usado com ponteiro (clique/toque);
 * (2) ignora a abertura da dica disparada por esse foco programático (teclado mantém o foco no gatilho).
 */
export function useTriggerTooltipGuard() {
  const suppressUntil = useRef(0)
  const pointer = useRef(false)
  const contentProps = {
    onPointerDown: () => {
      pointer.current = true
    },
    onKeyDown: () => {
      pointer.current = false
    },
    onCloseAutoFocus: (e: Event) => {
      suppressUntil.current = Date.now() + 600
      if (pointer.current) e.preventDefault()
      pointer.current = false
    },
  }
  return { suppressUntil, contentProps }
}

/**
 * Dica não controlada (como SimpleTooltip); só a abertura por FOCO logo após o fechamento do menu é vetada
 * (preventDefault no onFocus impede o handler do Radix — composeEventHandlers). Passar o mouse continua abrindo a dica.
 */
export function GuardedTooltip({ label, guard, children }: { label: ReactNode; guard: ReturnType<typeof useTriggerTooltipGuard>; children: ReactNode }) {
  return (
    <TriggerTooltip
      label={label}
      onFocus={(e) => {
        if (Date.now() < guard.suppressUntil.current) e.preventDefault()
      }}
    >
      {children}
    </TriggerTooltip>
  )
}

/**
 * Dica para gatilhos de Popover/menu. Usa o Radix diretamente: o `TooltipTrigger` compartilhado (ui/tooltip.tsx) chama
 * `preventDefault()` no clique para alternar a dica em telas de toque, o que cancela o `onClick` de um `PopoverTrigger`
 * envolvido (composeEventHandlers) — o popover não abria com o mouse ("Etiquetar", "Histórico do contato").
 */
export function TriggerTooltip({ label, children, onFocus }: { label: ReactNode; children: ReactNode; onFocus?: (e: React.FocusEvent<HTMLButtonElement>) => void }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild onFocus={onFocus}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipContent>{label}</TooltipContent>
    </TooltipPrimitive.Root>
  )
}

/* ----------------------------- Etiquetas ----------------------------- */

export const TAG_COLORS: { key: string; label: string; chip: string }[] = [
  { key: 'gray', label: 'Cinza', chip: 'bg-muted text-muted-foreground' },
  { key: 'red', label: 'Vermelho', chip: 'bg-red-50 text-red-700' },
  { key: 'orange', label: 'Laranja', chip: 'bg-orange-50 text-orange-700' },
  { key: 'amber', label: 'Âmbar', chip: 'bg-amber-50 text-amber-800' },
  { key: 'green', label: 'Verde', chip: 'bg-green-50 text-green-800' },
  { key: 'teal', label: 'Turquesa', chip: 'bg-teal-50 text-teal-700' },
  { key: 'blue', label: 'Azul', chip: 'bg-blue-50 text-blue-700' },
  { key: 'brand', label: 'Índigo', chip: 'bg-brand/10 text-brand' },
  { key: 'violet', label: 'Violeta', chip: 'bg-violet-50 text-violet-700' },
  { key: 'pink', label: 'Rosa', chip: 'bg-pink-50 text-pink-700' },
]
export const tagChipClass = (color: string) => TAG_COLORS.find((c) => c.key === color)?.chip ?? TAG_COLORS[0]!.chip

export function TagChip({ label, color, className }: { label: string; color: string; className?: string }) {
  return (
    <span className={cn('inline-flex max-w-full shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide', tagChipClass(color), className)}>
      <span className="truncate">{label}</span>
    </span>
  )
}

/**
 * Chip "● Ativo" de chats em andamento (captura WA-03 da Central de ajuda: verde, mesmo formato dos chips de resultado,
 * na lista, ao lado do título e em "Status" no painel "Detalhes do chat").
 */
export function ActiveChip({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex max-w-full shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide bg-green-50 text-green-800', className)} data-testid="chat-active-chip">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
      <span className="truncate">Ativo</span>
    </span>
  )
}

/* ------------------------- Coluna redimensionável ------------------------- */

/**
 * Largura de coluna arrastável (resizer "w-px cursor-col-resize bg-border").
 * A largura é aplicada ao vivo e persistida apenas ao soltar (onCommit).
 */
export function useResizableWidth(persisted: number, onCommit: (w: number) => void, min = 260, max = 600) {
  const [width, setWidth] = useState(persisted)
  const dragging = useRef<{ startX: number; startW: number } | null>(null)
  useEffect(() => {
    if (!dragging.current) setWidth(persisted)
  }, [persisted])
  const clamp = useCallback((w: number) => Math.max(min, Math.min(max, Math.round(w))), [min, max])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragging.current = { startX: e.clientX, startW: width }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    setWidth(clamp(dragging.current.startW + e.clientX - dragging.current.startX))
  }
  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const w = clamp(dragging.current.startW + e.clientX - dragging.current.startX)
    dragging.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setWidth(w)
    onCommit(w)
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const w = clamp(width + (e.key === 'ArrowLeft' ? -16 : 16))
    setWidth(w)
    onCommit(w)
  }
  const onDoubleClick = () => {
    setWidth(340)
    onCommit(340)
  }
  return { width, handleProps: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onKeyDown, onDoubleClick }, min, max }
}

export function ColumnResizer({ handleProps, width, min, max, className }: { handleProps: ReturnType<typeof useResizableWidth>['handleProps']; width: number; min: number; max: number; className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar lista"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Arraste para redimensionar (duplo clique restaura)"
      className={cn('group relative z-10 w-px shrink-0 cursor-col-resize bg-border outline-none focus-visible:bg-primary/40 print:hidden', className)}
      {...handleProps}
    >
      <div className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-primary/10" />
    </div>
  )
}
