import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ArrowUpRight } from 'lucide-react'
import { Container, Section, SectionTitle, type ContainerSize } from './primitives'
import { DEMO_CASES, type DemoCase } from './demoContent'
import { DemoLogoMark } from './LogoStrip'

/** Cartão de case (logo + segmento em caixa alta + citação + métrica). Clique leva a /casos-de-sucesso. */
export function CaseCard({ c, to = c.to ?? '/casos-de-sucesso' }: { c: DemoCase; to?: string }) {
  return (
    <Link to={to} className="group flex h-full flex-col gap-6 rounded-2xl border border-[#E6E8EE] bg-white p-6 transition-shadow hover:shadow-[0_12px_40px_-18px_rgba(15,15,22,.25)]">
      <div className="flex items-center justify-between gap-3">
        <DemoLogoMark logo={c.logo} />
        <span className="rounded-md bg-[#F3F4F6] px-2 py-1 text-right text-[11px] font-medium uppercase tracking-[0.06em] text-[#4B5263]">{c.segment}</span>
      </div>
      <p className="flex-1 text-[16px] leading-[25px] text-[#3F4556]">“{c.quote}”</p>
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-[#DDF5DD] px-3 py-1 text-[13px] font-medium text-[#14532D]">{c.metric}</span>
        <span className="inline-flex items-center gap-1 text-[14px] text-body group-hover:text-ink">
          Ler história <ArrowUpRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  )
}

/**
 * Seção "Veja como outras empresas usam a Kloel" com link "Ver todas as histórias de clientes ↗" (→ /casos-de-sucesso) e 3 cases ilustrativos.
 * props: title?, cases? (padrão DEMO_CASES), id?
 */
export function CustomerCases({
  title = 'Veja como outras empresas usam a Kloel', cases = DEMO_CASES, id, containerSize = 'xl', className,
}: { title?: string; cases?: DemoCase[]; id?: string; containerSize?: ContainerSize; className?: string }) {
  // 7.png (1460px): link 53px abaixo do topo do título, cartões 48px abaixo do topo do link
  return (
    <Section id={id} className={cn('pt-8 sm:pt-12', className)}>
      <Container size={containerSize}>
        {/* 7.png: título de 32px (largura 579px para "…usam a fonio"), não 38px */}
        <SectionTitle title={title} titleClassName="sm:text-[32px] sm:leading-[38px] sm:tracking-[-0.32px]" />
        <div className="mt-4 flex flex-col items-center">
          <Link to="/casos-de-sucesso" className="inline-flex items-center gap-1 text-[16px] font-medium text-[#3F4556] hover:text-ink">
            Ver todas as histórias de clientes <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="relative mt-10 grid gap-5 md:grid-cols-3">
          {cases.map((c) => (
            <CaseCard key={c.company} c={c} to={c.to} />
          ))}
        </div>
      </Container>
    </Section>
  )
}
