import { usePageTitle } from '@/site/components/usePageTitle'
import { Chip, FinalCtaBand, SiteHeading, SoftAurora } from '../company/kit'

/**
 * /webinars — "Sessões ao vivo" (OBSERVADO [160]: estado vazio).
 * Fidelidade final: a referência mostra só o cartão de estado vazio entre o subtítulo e a faixa de CTA; o formulário
 * "avise-me" (INFERIDO) foi retirado porque inseria um bloco ausente na referência e empurrava a faixa final ~150 px.
 * Medidas (1470 px): cartão 74 px de altura a 68 px do subtítulo; 214 px do cartão ao título da faixa de CTA.
 */
export default function WebinarsPage() {
  usePageTitle('Webinars')
  return (
    <main className="font-site">
      <section className="relative overflow-hidden">
        <SoftAurora intensity={0.55} fade />
        <div className="relative mx-auto flex max-w-[1000px] flex-col items-center px-5 pb-20 pt-16 text-center sm:pb-[109px] sm:pt-20">
          <Chip>Webinars</Chip>
          <SiteHeading as="h1" size="hero" className="mt-3">Sessões ao vivo</SiteHeading>
          <p className="mt-4 text-[16px] leading-6 text-neutral-900">Aqui você encontra todos os webinars futuros e passados da Kloel.</p>
          <div className="mt-[63px] w-full rounded-2xl border border-line bg-white px-6 py-6 text-[16px] leading-6 text-body" data-testid="webinars-empty">
            Infelizmente, não haverá webinars nos próximos dias.
          </div>
        </div>
      </section>
      <FinalCtaBand />
    </main>
  )
}
