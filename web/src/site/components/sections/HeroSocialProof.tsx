import { cn } from '@/lib/utils'

/**
 * Três avatares de 38px sobrepostos pela metade (75px no total), como as fotos de [2] 01.png e [329] Footer.png.
 * Sem fotos de pessoas reais: silhuetas genéricas em círculos pastel.
 */
export function DemoAvatarStack({ className }: { className?: string }) {
  return (
    <div className={cn('flex shrink-0 -space-x-[19px]', className)} aria-hidden>
      {[
        ['bg-[#c7c9ff]', 'fill-[#3730a3]/40'],
        ['bg-[#bbf7d0]', 'fill-[#166534]/40'],
        ['bg-[#fde68a]', 'fill-[#92400e]/40'],
      ].map(([bg, fg], i) => (
        <span key={i} className={cn('flex h-[38px] w-[38px] items-end justify-center overflow-hidden rounded-full border-2 border-white', bg)}>
          <svg viewBox="0 0 24 24" className={cn('h-[30px] w-[30px] translate-y-[3px]', fg)}>
            <circle cx="12" cy="8" r="4.3" />
            <path d="M3.4 22.5c.8-4.7 4.3-7.6 8.6-7.6s7.8 2.9 8.6 7.6z" />
          </svg>
        </span>
      ))}
    </div>
  )
}

/**
 * Prova social do hero (avatares sobrepostos + "1.000+ Clientes"). Sem nota de avaliação: a Kloel não tem avaliação pública no Google.
 * props: className, align 'center' | 'left'
 */
export function HeroSocialProof({ className, align = 'center' }: { className?: string; align?: 'center' | 'left' }) {
  return (
    <div className={cn('flex items-center gap-3', align === 'center' && 'justify-center', className)}>
      <DemoAvatarStack />
      <div className="flex flex-col text-left">
        <div className="flex items-center gap-2 text-[16px] font-semibold leading-6 text-heading">
          1.000+ Clientes
        </div>
      </div>
    </div>
  )
}
