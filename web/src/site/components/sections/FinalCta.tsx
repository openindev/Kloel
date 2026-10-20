import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CtaLink } from './primitives'

/**
 * CTA final em largura total: gradiente branco → índigo (#6366F1) com brilho elíptico branco e cantos inferiores arredondados.
 * props: title, subtitle?, primary { label, to } (botão preto), secondary? { label, to } (botão branco), className
 */
export function FinalCta({
  title, subtitle, primary, secondary, className, id,
}: { title: ReactNode; subtitle?: ReactNode; primary: { label: string; to: string }; secondary?: { label: string; to: string }; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('relative overflow-hidden rounded-b-[24px] pb-28 pt-20 sm:pb-32 sm:pt-24', className)}>
      {/* referência [27]/[24]/[285] (8.png/9.png): o gradiente nasce BRANCO (sem emenda com a página), ganha lilás nas laterais e
          termina índigo; brilho branco elíptico só na parte superior; quarto inferior índigo sólido */}
      {/* cores amostradas em 9.png (1460px) nas laterais: 23% #F0F9FC, 41% #C4E0F2 (azul-céu), 57% #A5BFF1, 73% #8597F1, 91% #6C76F4,
          base #5F65F2; no centro o brilho branco vai até ~60% da altura e ainda clareia a 73% (#E3E5FD) */}
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,#ffffff_0%,#fbfefe_12%,#f0f9fc_23%,#c4e0f2_41%,#a5bff1_57%,#8597f1_73%,#6c76f4_88%,#5f65f2_100%)]" />
      <div aria-hidden className="absolute inset-x-0 -top-[14%] flex h-full justify-center">
        <div className="h-full w-[min(1320px,118%)] shrink-0 rounded-[50%] bg-[radial-gradient(closest-side,#ffffff_0%,#ffffff_60%,rgba(255,255,255,.9)_78%,rgba(255,255,255,0)_100%)]" />
      </div>
      {/* referência 8.png/9.png: título→subtítulo ≈12px, subtítulo 16/24 (linha de ≈620px), subtítulo→botão ≈32px, botão→base ≈128px */}
      <div className="relative mx-auto flex max-w-[900px] flex-col items-center gap-3 px-5 text-center">
        {/* título da referência: ≈32px / 39px (linha "reinventado, com a fonio" ≈345px a 1470px) */}
        <h2 className="text-balance text-[28px] font-medium leading-[34px] tracking-[-0.28px] text-heading sm:text-[32px] sm:leading-[39px] sm:tracking-[-0.32px]">{title}</h2>
        {subtitle && <p className="max-w-[640px] text-pretty text-[16px] leading-6 text-[#2B3040]">{subtitle}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <CtaLink to={primary.to}>{primary.label}</CtaLink>
          {secondary && (
            <CtaLink to={secondary.to} variant="outline">
              {secondary.label}
            </CtaLink>
          )}
        </div>
      </div>
    </section>
  )
}
