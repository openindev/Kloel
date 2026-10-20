import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

const LOGO_PATH =
  'M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.55-3.7 8.24-8.24 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z'

// viewBox com folga (29 unidades em vez de 24): o logo da Fonio ocupa ~13px dos 18px da máscara (live-compare 10, ampliado)
const MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2.5 -2.5 29 29"><path d="${LOGO_PATH}"/></svg>`)}")`

const MASK_STYLE: CSSProperties = {
  WebkitMaskImage: MASK,
  maskImage: MASK,
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
}

/**
 * Ícone do cartão "Enviar WhatsApp" na grade de Recursos como na Fonio ao vivo (fonio-live2 C-assistentes/01-geral.txt e
 * data/resources.json › grid.order[4]): logo em máscara num `span{inline-block bg-current h-[18px] w-[18px]}` — não um <svg>.
 * Por ser inline-block na linha de 24px do cartão (e não svg block), a primeira linha do cartão mede ~25px e os cartões da
 * 2ª linha da grade ficam 5px mais altos (103px × 98px), exatamente como na referência.
 */
export function WhatsAppMaskIcon({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block h-[18px] w-[18px] bg-current', className)} style={MASK_STYLE} />
}
