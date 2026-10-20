import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Palco de tamanho fixo (ex.: 960×540) escalado para caber na largura do contêiner, mantendo a proporção. */
export function ScaledStage({ width = 960, height = 540, children, className, stageClassName }: { width?: number; height?: number; children: ReactNode; className?: string; stageClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / width))
    ro.observe(el)
    setScale(el.clientWidth / width)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={ref} className={cn('relative w-full overflow-hidden', className)} style={{ height: height * scale }}>
      <div className={cn('absolute left-0 top-0 origin-top-left', stageClassName)} style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}
