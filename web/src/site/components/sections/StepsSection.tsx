import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Container, CtaLink, ReadMore, Section, SectionTitle, type ContainerSize } from './primitives'

export interface StepItem {
  title: string
  text: string
  /** ilustração/mock exibido na metade inferior do cartão (home "3 passos") */
  visual?: ReactNode
}

/**
 * Cartões de passos numerados ("01", "02"…) com título H3 e texto.
 * props:
 *  - title, subtitle?, items: { title, text, visual? }[]
 *  - numbered (padrão true) ; columns 2 | 3 (padrão 3; 5 itens → 3 + 2 centralizados)
 *  - clamp?: número de linhas antes de "Leia mais ⌄" (soluções); sem clamp mostra o texto todo
 *  - background 'white' | 'gray' ; cta?: { label, to } botão preto centralizado abaixo ; id?
 */
export function StepsSection({
  title, subtitle, items, numbered = true, columns = 3, clamp, background = 'white', cta, id, className, containerSize = 'xl', subtitleClassName, gridClassName,
}: {
  title: ReactNode; subtitle?: ReactNode; items: StepItem[]; numbered?: boolean; columns?: 2 | 3; clamp?: number; background?: 'white' | 'gray'; cta?: { label: string; to: string }; id?: string; className?: string
  /** largura do contêiner (padrão 'xl'; a home usa 'wide' como na referência) */
  containerSize?: ContainerSize
  /** classes extras do subtítulo e da grade (a home usa subtítulo de 16/24 e 63px até os cartões, medidos em 05.png) */
  subtitleClassName?: string
  gridClassName?: string
}) {
  const basis = columns === 3 ? 'lg:basis-[calc((100%-40px)/3)]' : 'lg:basis-[calc((100%-20px)/2)]'
  return (
    <Section id={id} background={background} className={className}>
      <Container size={containerSize}>
        <SectionTitle title={title} subtitle={subtitle} subtitleClassName={subtitleClassName} />
        <div className={cn('mt-12 flex flex-wrap justify-center gap-5', gridClassName)}>
          {items.map((s, i) => (
            <article
              key={s.title}
              className={cn(
                'relative flex w-full flex-col overflow-hidden rounded-2xl border border-[#E6E8EE] bg-white sm:basis-[calc((100%-20px)/2)]',
                basis,
                s.visual ? 'min-h-[460px] lg:min-h-[520px]' : '',
              )}
            >
              {/* referência 05.png (1470px): padding 28px, selo de 36px, título H3 20px/28 500 a 16px do selo, texto 16px/24 a 8px do título */}
              <div className="flex flex-col p-7">
                {numbered && <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-[#F3F4F6] text-[16px] font-medium leading-none text-heading">{String(i + 1).padStart(2, '0')}</span>}
                <h3 className="text-[20px] font-medium leading-[28px] tracking-[-0.15px] text-heading">{s.title}</h3>
                <div className="mt-2">
                  {clamp ? <ReadMore text={s.text} lines={clamp} className="text-[16px] leading-6" /> : <p className="text-[16px] leading-6 text-body">{s.text}</p>}
                </div>
              </div>
              {/* área da ilustração: o mock começa 296px acima da base do cartão (05.png: tabela, abas e celular em y≈525 com a base em 821) */}
              {s.visual && (
                <div className="relative mt-auto h-[260px] sm:h-[320px]">
                  <div aria-hidden className="absolute inset-x-0 bottom-0 h-[70%] bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,#c7cbff_45%,#6c71ff_100%)]" />
                  <div className="absolute inset-0">{s.visual}</div>
                </div>
              )}
            </article>
          ))}
        </div>
        {cta && (
          <div className="mt-10 flex justify-center">
            <CtaLink to={cta.to}>{cta.label}</CtaLink>
          </div>
        )}
      </Container>
    </Section>
  )
}
