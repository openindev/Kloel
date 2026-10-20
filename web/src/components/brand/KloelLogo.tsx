import { cn } from '@/lib/utils'

/**
 * Wordmark "kloel.ai" no mesmo tratamento do logotipo de referência: nome em quase-preto
 * e sufixo ".ai" na cor da marca, peso alto e tracking negativo.
 */
export function KloelLogo({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'sm' ? 'text-[17px]' : size === 'lg' ? 'text-[28px]' : 'text-[21px]'
  return (
    <span className={cn('inline-flex select-none items-baseline font-semibold leading-none tracking-[-0.045em] text-[#0f0f14]', cls, className)} aria-label="kloel.ai">
      kloel<span className="text-brand">.ai</span>
    </span>
  )
}

export function KloelMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-6 w-6', className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="hsl(var(--brand))" />
      <path d="M21 14h7v19.5L38.6 22h8.6L35.6 34.1 48 50h-8.5l-9.1-11.8-2.4 2.5V50h-7z" fill="#fff" />
    </svg>
  )
}

/** Monograma usado no lugar de logos de terceiros (integrações, provedores). */
export function Monogram({ name, className }: { name: string; className?: string }) {
  const colors = ['bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700', 'bg-indigo-100 text-indigo-700', 'bg-teal-100 text-teal-700', 'bg-orange-100 text-orange-700']
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const letters = name.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || name.slice(0, 2)
  return <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-semibold', colors[h % colors.length], className)}>{letters}</span>
}
