import { cn } from '@/lib/utils'
import { DEMO_LOGOS, type DemoLogo } from './demoContent'

function Glyph({ glyph, color, accent }: Pick<DemoLogo, 'glyph' | 'color' | 'accent'>) {
  const a = accent ?? color
  switch (glyph) {
    case 'tooth':
      return <path d="M7 3c2 0 3 1 5 1s3-1 5-1c3 0 4 3 3 6-1 4-2 12-4 12-1.5 0-1.5-5-4-5s-2.5 5-4 5c-2 0-3-8-4-12-1-3 0-6 3-6z" fill={color} />
    case 'square':
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke={color} strokeWidth="2.5" />
          <path d="M9 7v10h6" fill="none" stroke={a} strokeWidth="2.5" strokeLinecap="round" />
        </>
      )
    case 'heart':
      return (
        <>
          <path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z" fill={color} />
          <circle cx="17.5" cy="6.5" r="3" fill={a} />
        </>
      )
    case 'leaf':
      return <path d="M4 20C4 9 11 4 21 3c0 10-5 17-16 17zm0 0 9-9" fill={color} stroke="#fff" strokeWidth="1.2" />
    case 'house':
      return <path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z" fill={color} />
    case 'paw':
      return (
        <>
          <circle cx="7" cy="8" r="2.2" fill={color} />
          <circle cx="12" cy="6" r="2.2" fill={color} />
          <circle cx="17" cy="8" r="2.2" fill={color} />
          <path d="M12 11c3 0 6 4 6 6.5S15.5 20 12 20s-6-.5-6-2.5S9 11 12 11z" fill={color} />
        </>
      )
    case 'bolt':
      return <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill={color} />
    case 'cross':
      return (
        <>
          <rect x="9" y="3" width="6" height="18" rx="2" fill={color} />
          <rect x="3" y="9" width="18" height="6" rx="2" fill={a} />
        </>
      )
    case 'wave':
      return <path d="M2 14c3-4 5-4 8 0s5 4 8 0 3-3 4-2v6H2z" fill={color} />
    case 'star':
      return <path d="m12 2 3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21l1.4-7L2 9.3l7-.8z" fill={color} />
  }
}

/** Logotipo desenhado (ícone + nome). mono=true deixa em cinza. */
export function DemoLogoMark({ logo, mono, className, size = 'md' }: { logo: DemoLogo; mono?: boolean; className?: string; size?: 'md' | 'sm' }) {
  const sm = size === 'sm'
  const color = mono ? '#9CA3AF' : logo.color
  const accent = mono ? '#9CA3AF' : logo.accent
  const style = logo.style ?? 'bold'
  return (
    <span className={cn('inline-flex shrink-0 select-none items-center whitespace-nowrap', sm ? 'gap-1.5' : 'gap-2', className)} title={logo.name}>
      <svg viewBox="0 0 24 24" className={sm ? 'h-5 w-5' : 'h-7 w-7'} aria-hidden>
        <Glyph glyph={logo.glyph} color={color} accent={accent} />
      </svg>
      <span
        className={cn(
          sm ? 'text-[14px] leading-none' : 'text-[18px] leading-none',
          style === 'bold' && 'font-bold tracking-[-0.02em]',
          style === 'serif' && 'font-serif font-semibold',
          style === 'italic' && 'font-semibold italic',
          style === 'wide' && cn('font-semibold uppercase tracking-[0.08em]', sm ? 'text-[12px]' : 'text-[15px]'),
        )}
        style={{ color }}
      >
        {logo.name}
      </span>
    </span>
  )
}

/**
 * Faixa de logos de clientes em rolagem contínua (marquee) com bordas esmaecidas.
 * props: variant 'color' | 'mono' ; label? (texto acima) ; logos? (padrão: DEMO_LOGOS) ; className
 *        gap: true (padrão) mantém 31 px livres abaixo da faixa — as distâncias até a seção seguinte foram conferidas contra as
 *        referências com esse vão (antes ocupado por um selo); false = sem vão (home, onde o selo era sobreposto)
 *        edge: largura do esmaecimento das bordas (padrão '12%')
 *        labelClassName: classes do rótulo (padrão "mb-6 text-center text-[15px] text-body"; ex. "mb-[33px]" para afastar os logos)
 * Sem selos sobre a natureza dos logos (E1): a única nota sobre depoimentos e empresas ilustrativas fica na página Contato.
 */
export function LogoStrip({
  variant = 'color', label, logos = DEMO_LOGOS, className, gap = true, edge = '12%', labelClassName,
}: { variant?: 'color' | 'mono'; label?: React.ReactNode; logos?: DemoLogo[]; className?: string; gap?: boolean; edge?: string; labelClassName?: string }) {
  const row = [...logos, ...logos]
  return (
    <div className={cn('relative w-full', className)}>
      {label && <div className={cn('mb-6 text-center text-[15px] text-body', labelClassName)}>{label}</div>}
      <div className="ks-marquee-pause relative overflow-hidden" style={{ maskImage: `linear-gradient(90deg,transparent,#000 ${edge},#000 calc(100% - ${edge}),transparent)`, WebkitMaskImage: `linear-gradient(90deg,transparent,#000 ${edge},#000 calc(100% - ${edge}),transparent)` }}>
        <div className="ks-marquee flex w-max items-center gap-16 py-2 pr-16">
          {row.map((l, i) => (
            <DemoLogoMark key={`${l.name}-${i}`} logo={l} mono={variant === 'mono'} />
          ))}
        </div>
      </div>
      {gap && <div aria-hidden className="mt-3 h-[19px]" />}
    </div>
  )
}
