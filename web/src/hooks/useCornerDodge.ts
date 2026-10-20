import { useEffect, useState, type RefObject } from 'react'

const INTERACTIVE =
  'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[role="combobox"],img,svg,video,canvas'

/** Elemento "de primeiro plano": controle, mídia ou bloco curto com texto próprio (não um fundo de seção). */
function foregroundRect(el: Element): DOMRect | null {
  const target = el.closest(INTERACTIVE) ?? ([...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) ? el : null)
  if (!target) return null
  const r = target.getBoundingClientRect()
  return r.height > 0 && r.height <= 120 ? r : null
}

/** O conteúdo sob o ponto não pode mais rolar para longe (fim do documento e de cada área rolável ancestral). */
function scrolledToEnd(el: Element) {
  for (let p: Element | null = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1 && p.scrollTop + p.clientHeight < p.scrollHeight - 4) return false
  }
  const se = document.scrollingElement ?? document.documentElement
  return se.scrollTop + window.innerHeight >= se.scrollHeight - 4
}

/**
 * Mantém um elemento FIXO de canto (selo "Demonstração local") livre de colisões, subindo-o acima de:
 * - barras e botões fixos/sticky na base da tela (banner de cookies, lançador de chat, barras de ação);
 * - conteúdo no fim da página que não pode mais rolar para longe (ex.: links e botões do rodapé do site).
 * Conteúdo que ainda pode rolar passa por baixo normalmente (não fica pulando durante a rolagem).
 * Retorna a distância `bottom` (px) a aplicar. `ignore` = seletor de elementos próprios (ex.: o popover do selo).
 */
export function useCornerDodge(ref: RefObject<HTMLElement>, { base = 12, gap = 8, ignore }: { base?: number; gap?: number; ignore?: string } = {}) {
  const [bottom, setBottom] = useState(base)
  useEffect(() => {
    let raf = 0
    let current = base
    const obstacleTop = (x: number, y: number, self: HTMLElement): number | null => {
      const vh = window.innerHeight
      const hit = document.elementsFromPoint(x, y).find((e) => !self.contains(e) && !(ignore && e.closest(ignore)))
      if (!hit || hit === document.documentElement || hit === document.body) return null
      for (let el: Element | null = hit; el && el !== document.body; el = el.parentElement) {
        const pos = getComputedStyle(el).position
        if (pos === 'fixed' || pos === 'sticky') {
          const r = el.getBoundingClientRect()
          // só barras/botões ancorados na base (não um layout fixo de tela cheia nem um painel alto)
          return r.top > vh * 0.4 ? r.top : null
        }
      }
      if (!scrolledToEnd(hit)) return null
      const r = foregroundRect(hit)
      return r && r.top > vh * 0.4 ? r.top : null
    }
    const compute = () => {
      raf = 0
      const self = ref.current
      if (!self) return
      const rect = self.getBoundingClientRect()
      const h = rect.height
      const vh = window.innerHeight
      let b = base
      for (let i = 0; i < 6; i++) {
        const top = vh - b - h
        const bot = vh - b
        const xs = [rect.left + 2, rect.left + rect.width * 0.25, (rect.left + rect.right) / 2, rect.left + rect.width * 0.75, rect.right - 2]
        const ys = [top + 2, (top + bot) / 2, bot - 2]
        let need = 0
        for (const x of xs) for (const y of ys) {
          const t = obstacleTop(x, y, self)
          if (t !== null) need = Math.max(need, Math.ceil(vh - t + gap))
        }
        if (need <= b) break
        b = need
      }
      if (b > vh * 0.6) b = base
      if (b !== current) {
        current = b
        setBottom(b)
      }
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(compute)
    }
    schedule()
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    // banners, barras e diálogos aparecem/somem sem rolagem: reavaliação leve e periódica
    const t = window.setInterval(schedule, 500)
    return () => {
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      window.clearInterval(t)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ref, base, gap, ignore])
  return bottom
}
