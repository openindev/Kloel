import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Container, CtaLink, InitialsAvatar, PillBadge, Section, SectionTitle, Stars, type ContainerSize } from './primitives'
import { CardCarousel } from './CardCarousel'
import { DEMO_TESTIMONIALS, DEMO_LOGOS, type DemoTestimonial } from './demoContent'
import { DemoLogoMark } from './LogoStrip'

/** Cartão de avaliação: estrelas, citação, avatar de iniciais, nome e cargo. */
export function TestimonialCard({ t, stars = true, avatar = true, logoIndex, className }: { t: DemoTestimonial; stars?: boolean; avatar?: boolean; logoIndex?: number; className?: string }) {
  return (
    <figure className={cn('flex h-full flex-col justify-between gap-8 rounded-2xl border border-[#E6E8EE] bg-white p-7', className)}>
      <div className="flex flex-col gap-5">
        {stars && <Stars count={t.stars ?? 5} />}
        <blockquote className="text-[16px] leading-6 text-[#3F4556]">{t.quote}</blockquote>
      </div>
      <figcaption className="flex items-center gap-3">
        {avatar && <InitialsAvatar name={t.name} className="h-11 w-11 text-[14px]" />}
        <div className="min-w-0 flex-1">
          <div className={cn('text-[16px] font-medium text-heading', logoIndex !== undefined && 'truncate')}>{t.name}</div>
          <div className="text-[13px] leading-[18px] text-body">{t.role}</div>
        </div>
        {/* logo compacto (como os logos de ~120px da referência 7.png): nome e cargo cabem em uma linha ao lado */}
        {logoIndex !== undefined && <DemoLogoMark logo={DEMO_LOGOS[logoIndex % DEMO_LOGOS.length]!} size="sm" className="hidden md:inline-flex" />}
      </figcaption>
    </figure>
  )
}

/**
 * Seção de depoimentos.
 * props:
 *  - title (padrão "Avaliações dos nossos clientes"), subtitle?, id?
 *  - items? (padrão: DEMO_TESTIMONIALS)
 *  - variant: 'grid' (4 colunas, estrelas — home/soluções) | 'carousel' (setas, estrelas — WhatsApp) | 'wide' (3 cartões largos sem estrelas, com logo — Webchat)
 *  - pills?: rótulos com ícone verificado abaixo do título ; cta?: { label, to } botão preto abaixo ; background? 'white' | 'gray'
 */
export function TestimonialsSection({
  title = 'Avaliações dos nossos clientes', subtitle, items = DEMO_TESTIMONIALS, variant = 'grid', pills, cta, id, background = 'white', className, containerSize = 'xl', containerClassName,
  cardClassName, listClassName,
}: {
  title?: ReactNode; subtitle?: ReactNode; items?: DemoTestimonial[]; variant?: 'grid' | 'carousel' | 'wide'; pills?: ReactNode[]; cta?: { label: string; to: string }; id?: string; background?: 'white' | 'gray'; className?: string
  /** largura do contêiner: WhatsApp/Webchat usam 'wide' (≈1376px úteis a 1470px, referências 07.png / 7.png) */
  containerSize?: ContainerSize
  /** classes extras do contêiner (ex.: largura máxima própria da home, ≈1320px úteis — referência 04.png) */
  containerClassName?: string
  /** classes extras de cada cartão na variante 'grid' (a home usa altura mínima de 320px, medida em 04.png) */
  cardClassName?: string
  /** classes extras do bloco de cartões (ex.: distância do título; a home usa 47px, medidos em 04.png) */
  listClassName?: string
}) {
  return (
    <Section id={id} background={background} className={className}>
      <Container size={containerSize} className={containerClassName}>
        {/* subtítulo 16/24 nas referências com subtítulo (3. Webchat/7.png; soluções 06.png, ex. Recepcionista Virtual) */}
        <SectionTitle title={title} subtitle={subtitle} subtitleSize="md" />
        {pills && pills.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {pills.map((p, i) => (
              <PillBadge key={i}>{p}</PillBadge>
            ))}
          </div>
        )}
        <div className={cn('relative mt-10', listClassName)}>
          {variant === 'grid' && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {items.map((t) => (
                <TestimonialCard key={t.name} t={t} className={cardClassName} />
              ))}
            </div>
          )}
          {variant === 'carousel' && (
            <CardCarousel label="Depoimentos" gap={16} cardClassName="w-[85vw] sm:w-[360px] lg:w-[calc((100%-48px)/4)]" items={items.map((t) => <TestimonialCard key={t.name} t={t} avatar={false} />)} />
          )}
          {variant === 'wide' && (
            <CardCarousel
              label="Depoimentos"
              gap={16}
              cardClassName="w-[88vw] sm:w-[480px] lg:w-[calc((100%-32px)/3)]"
              items={items.map((t, i) => <TestimonialCard key={t.name} t={t} stars={false} logoIndex={i + 1} className="min-h-[230px]" />)}
            />
          )}
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
