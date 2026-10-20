import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Carrossel horizontal com setas circulares ← → (desloca 1 cartão por clique; seta desabilitada nas pontas — OBSERVADO).
 * props: items (nós), cardClassName (largura do cartão, ex. "w-[400px]"), gap (px, padrão 20), arrows 'below' | 'none', className, label (aria)
 */
export function CardCarousel({
  items, cardClassName = 'w-[85vw] sm:w-[400px]', gap = 20, arrows = 'below', className, label = 'Carrossel', trackClassName,
}: { items: ReactNode[]; cardClassName?: string; gap?: number; arrows?: 'below' | 'none'; className?: string; label?: string; trackClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(true)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanPrev(el.scrollLeft > 4)
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [update, items.length])

  const step = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const first = el.querySelector<HTMLElement>('[data-carousel-card]')
    const w = first ? first.offsetWidth + gap : el.clientWidth * 0.8
    el.scrollBy({ left: dir * w, behavior: 'smooth' })
  }

  return (
    <div className={cn('w-full', className)} role="region" aria-roledescription="carrossel" aria-label={label}>
      <div ref={ref} onScroll={update} className={cn('no-scrollbar flex snap-x snap-mandatory overflow-x-auto scroll-smooth pb-2', trackClassName)} style={{ gap }}>
        {items.map((it, i) => (
          <div key={i} data-carousel-card className={cn('shrink-0 snap-start', cardClassName)}>
            {it}
          </div>
        ))}
      </div>
      {/* setas de 48 px, 8 px entre elas, ≈25 px abaixo dos cartões (2. IA de WhatsApp/03b.png, 07.png; 3. Webchat/03a.png, 7.png) */}
      {arrows === 'below' && (
        <div className="mt-[18px] flex justify-center gap-2">
          <CarouselArrow dir="prev" disabled={!canPrev} onClick={() => step(-1)} />
          <CarouselArrow dir="next" disabled={!canNext} onClick={() => step(1)} />
        </div>
      )}
    </div>
  )
}

export function CarouselArrow({ dir, disabled, onClick, className }: { dir: 'prev' | 'next'; disabled?: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'prev' ? 'Anterior' : 'Próximo'}
      className={cn('flex h-12 w-12 items-center justify-center rounded-full border border-line bg-white text-ink transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white', className)}
    >
      {dir === 'prev' ? <ArrowLeft className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
    </button>
  )
}
