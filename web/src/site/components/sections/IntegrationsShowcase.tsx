import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IntegrationLogo, publicAsset } from '@/components/brand/IntegrationLogo'
import { SITE_WORDMARKS } from '@/data/catalogs/integration-logos'
import { DIRECTORY } from '@/site/pages/resources/integrations-directory'
import { Container, CtaLink, Section, SectionTitle } from './primitives'

/** Destino de um tile: o diretório já filtrado pela integração quando ela existe no catálogo local; senão, o diretório completo. */
const directoryHref = (name: string) => (DIRECTORY.some((i) => i.name.toLowerCase() === name.toLowerCase()) ? `/integracoes?busca=${encodeURIComponent(name)}` : '/integracoes')

/** Nomes do catálogo local (logos originais servidos de public/integrations — ver IntegrationLogo). */
export const SHOWCASE_INTEGRATIONS = ['Google Agenda', 'WhatsApp Business', 'Slack', 'Google Sheets', 'Notion', 'n8n', 'Make', 'Pipedrive', 'Calendly', 'Cal.com', 'Airtable', 'HubSpot', 'WooCommerce', 'Shopify']

/** Ícone redondo de integração (logo original da integração — ver IntegrationLogo; monograma só sem arquivo). */
export function IntegrationBubble({ name, className, size = 56 }: { name: string; className?: string; size?: number }) {
  const small = size < 40
  const icon: ReactNode = <IntegrationLogo name={name} surface="site" decorative className={small ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-[12px]'} logoClassName={small ? 'h-5 w-5' : 'h-7 w-7'} />
  return (
    <span title={name} className={cn('flex items-center justify-center rounded-full border border-slate-100 bg-white shadow-[0_6px_18px_-6px_rgba(15,15,22,.18)]', className)} style={{ width: size, height: size }}>
      {icon}
    </span>
  )
}

/**
 * Órbita com ícones girando. `angles` = posições dos ícones em graus (0 = topo); a referência 06.png/7.png mostra os ícones em
 * grupos (dois a 30° um do outro perto do topo num quadro, nenhum no topo no outro), não distribuídos por igual.
 */
function Orbit({ names, radius, duration, reverse, highlight, angles, stretch = 1 }: { names: string[]; radius: number; duration: string; reverse?: boolean; highlight: number; angles?: number[]; stretch?: number }) {
  const circ = 2 * Math.PI * radius
  return (
    <div className={cn('absolute left-1/2 top-full', reverse ? 'ks-orbit-rev' : 'ks-orbit')} style={{ width: radius * 2, height: radius * 2, marginLeft: -radius, marginTop: -radius, animationDuration: duration }}>
      <svg className="absolute inset-0 overflow-visible" viewBox={`0 0 ${radius * 2} ${radius * 2}`} aria-hidden>
        <circle cx={radius} cy={radius} r={radius} fill="none" stroke="#E2E4F2" strokeWidth="1.5" />
        <circle cx={radius} cy={radius} r={radius} fill="none" stroke="#4F54F5" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${circ * 0.02} ${circ}`} strokeDashoffset={-circ * highlight} />
      </svg>
      {names.map((n, i) => {
        // ângulo a partir do topo (sentido horário) → rotação a partir do eixo x
        const a = (angles?.[i] ?? (360 / names.length) * i) - 90
        return (
          <div key={n} className="absolute left-1/2 top-1/2 h-0 w-0" style={{ transformOrigin: '0 0', transform: `rotate(${a}deg) translate(${radius}px) rotate(${-a}deg)` }}>
            <div className={cn('absolute -left-7 -top-7 h-14 w-14', reverse ? 'ks-orbit-counter-rev' : 'ks-orbit-counter')} style={{ animationDuration: duration }}>
              {/* desfaz o achatamento horizontal do palco (stretch) para o ícone continuar redondo */}
              <div style={{ transform: `scaleX(${1 / stretch})` }}>
                <IntegrationBubble name={n} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Seção de integrações.
 * props:
 *  - title (padrão "Integra-se às suas ferramentas"), subtitle?
 *  - variant: 'orbit' (dois arcos concêntricos com ícones girando — home) | 'grid' (grade 3×3 de tiles — WhatsApp/Webchat)
 *  - names? (padrão SHOWCASE_INTEGRATIONS) ; cta? { label, to } (padrão "Ver todas as integrações" → /integracoes); ctaStyle 'button' | 'link'
 */
export function IntegrationsShowcase({
  title = 'Integra-se às suas ferramentas', subtitle, variant = 'orbit', names = SHOWCASE_INTEGRATIONS, cta = { label: 'Ver todas as integrações', to: '/integracoes' }, ctaStyle, id, className,
}: {
  title?: ReactNode; subtitle?: ReactNode; variant?: 'orbit' | 'grid'; names?: string[]; cta?: { label: string; to: string } | null; ctaStyle?: 'button' | 'link'; id?: string; className?: string
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = stageRef.current
    if (!el || variant !== 'orbit') return
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / 1400)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [variant])

  if (variant === 'grid') {
    return (
      <Section id={id} className={className}>
        <Container size="lg">
          {/* 2. IA de WhatsApp/06.png e 3. Webchat/6.png: subtítulo 16/24, grade de 447 px com 16 px entre os blocos (137×85), 32 px abaixo */}
          <SectionTitle title={title} subtitle={subtitle} subtitleSize="md" />
          <div className="mx-auto mt-8 grid grid-cols-3 gap-3 sm:max-w-[28rem] sm:gap-4">
            {names.slice(0, 9).map((n) => {
              const wordmark = SITE_WORDMARKS[n]
              // Fonio (www.fonio.ai/pt-br/whatsapp|webchat/chatbot-ia): cartão "flex aspect-[130/80] … p-4 sm:p-6" só com o logo
              // horizontal original "max-h-[min(100%,2.5rem)] w-auto max-w-full object-contain" (scripts/fetch-integration-logos.mjs).
              return wordmark ? (
                <Link
                  key={n}
                  to={directoryHref(n)}
                  title={`${n} — ver no diretório de integrações`}
                  className="flex aspect-[130/80] min-h-0 items-center justify-center rounded-2xl border border-[#E6E8EE] bg-white p-4 sm:p-6"
                >
                  <img src={publicAsset(wordmark)} alt={n} loading="lazy" decoding="async" className="max-h-[min(100%,2.5rem)] w-auto max-w-full object-contain" />
                </Link>
              ) : (
                <Link
                  key={n}
                  to={directoryHref(n)}
                  title={`${n} — ver no diretório de integrações`}
                  className="flex aspect-[130/80] min-h-0 items-center justify-center gap-2 rounded-2xl border border-[#E6E8EE] bg-white px-2 text-center"
                >
                  <IntegrationLogo name={n} surface="site" decorative className="h-7 w-7 text-[11px]" logoClassName="h-6 w-6 sm:h-7 sm:w-7" />
                  <span className="text-[12px] font-semibold leading-tight tracking-[-0.01em] text-heading sm:text-[16px]">{n}</span>
                </Link>
              )
            })}
          </div>
          {cta && (
            <div className="mt-8 flex justify-center">
              {ctaStyle === 'button' ? (
                <CtaLink to={cta.to} variant="outline">{cta.label}</CtaLink>
              ) : (
                <Link to={cta.to} className="inline-flex items-center gap-1 text-[16px] font-medium text-[#3F4556] hover:text-ink">
                  {cta.label} <ArrowUpRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          )}
        </Container>
      </Section>
    )
  }

  // Medidas da referência 7.png / 06.png (1460px), a partir do topo T da seção: arco externo (r≈626) com topo em T+135, arco
  // interno (r≈536) com topo em T+225, centro dos círculos em T+761; título com topo do texto em T+341; arcos em cinza-lavanda
  // muito claro que somem em direção à base; ícones só no arco externo.
  const outer = names.slice(0, 6)
  const STAGE_W = 1400
  const STAGE_H = 721
  const ARC_STRETCH = 1.12
  return (
    <section id={id} className={cn('relative overflow-hidden pt-10', className)}>
      <div ref={stageRef} className="relative mx-auto w-full max-w-[1400px]">
        <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: STAGE_H * scale }} aria-hidden>
          <div className="absolute left-1/2 top-0 origin-top" style={{ width: STAGE_W, height: STAGE_H, transform: `translateX(-50%) scale(${scale})` }}>
            {/* os arcos da referência são elipses (≈1,12× mais largas que altas: em x=400 o arco externo está em T+206, em x=200 em T+350) */}
            <div className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(180deg,#000_0%,#000_42%,transparent_68%)]">
              <div className="absolute inset-0" style={{ transform: `scaleX(${ARC_STRETCH})` }}>
                <Orbit names={outer} radius={626} duration="90s" highlight={0.745} angles={[0, 30, 62, 170, 205, 240]} stretch={ARC_STRETCH} />
                <Orbit names={[]} radius={536} duration="70s" reverse highlight={0.12} />
              </div>
            </div>
          </div>
        </div>
        <div className="relative flex flex-col items-center px-5 pb-6 text-center sm:pb-12" style={{ paddingTop: Math.max(120, Math.round(295 * scale)) }}>
          <div className="max-w-[640px]">
            <SectionTitle title={title} subtitle={subtitle} />
            {cta && (
              <div className="mt-[25px] flex justify-center">
                <CtaLink to={cta.to} variant="outline" className="text-[16px]">{cta.label}</CtaLink>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
