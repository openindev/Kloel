/**
 * Seções de marketing reutilizáveis do site público (módulo site-core). API estável para outros módulos (ex.: site-secondary).
 *
 * Resumo das props (detalhes no JSDoc de cada componente):
 *  - SectionTitle      { title, subtitle?, align?: 'center'|'left', size?: 'section'(38px)|'hero'(48px)|'card'(20px), as?, eyebrow? }
 *  - PillBadge         { children, icon? }                        → pílula branca com ícone verificado
 *  - AuroraBackground  { variant?: 'hero'|'soft'|'demo'|'ribbon' } → fitas animadas; 'ribbon' = caixas medidas ao vivo (pai `relative isolate overflow-hidden`)
 *  - FaqAccordion      { items: {q, a}[], variant?: 'lines'|'cards'|'plus', title?, numbered?, value?, onValueChange? }
 *  - TestimonialsSection { title?, subtitle?, items?, variant?: 'grid'|'carousel'|'wide', pills?, cta?: {label,to} }
 *  - FinalCta          { title, subtitle?, primary: {label,to}, secondary?: {label,to} }
 *  - LogoStrip         { variant?: 'color'|'mono', label?, logos? }
 *  - StatsCards        { items?: {value,label}[] }
 *  - IntegrationsShowcase { title?, subtitle?, variant?: 'orbit'|'grid', names?, cta?: {label,to}|null, ctaStyle?: 'button'|'link' }
 *  - StepsSection      { title, subtitle?, items: {title,text,visual?}[], numbered?, columns?: 2|3, clamp?, background?: 'white'|'gray', cta? }
 *  - Extras: Container, Section, CtaLink, ReadMore, VoiceOrb, Stars, InitialsAvatar, CardCarousel, CarouselArrow,
 *            PricingCards { product, interval, ctaTo?, onSelect? } (+ publicPlanPrice/publicPlanSavings), IntervalToggle,
 *            CallbackWidget { source?, demoLink?, demoLabel?, demoTo?, demoArrow? },
 *            CustomerCases, CaseCard, TestimonialCard, DemoLogoMark, SocialProof, DEMO_* (conteúdo ilustrativo)
 */
export { SectionTitle, PillBadge, AuroraBackground, Container, Section, CtaLink, ReadMore, VoiceOrb, HeroOrb, Stars, InitialsAvatar, useInView } from './primitives'
export type { ContainerSize } from './primitives'
export { FaqAccordion, type FaqItem } from './FaqAccordion'
export { TestimonialsSection, TestimonialCard } from './TestimonialsSection'
export { FinalCta } from './FinalCta'
export { LogoStrip, DemoLogoMark } from './LogoStrip'
export { StatsCards, TEMPLATE_STATS, type StatItem } from './StatsCards'
export { IntegrationsShowcase, IntegrationBubble, SHOWCASE_INTEGRATIONS } from './IntegrationsShowcase'
export { StepsSection, type StepItem } from './StepsSection'
export { CardCarousel, CarouselArrow } from './CardCarousel'
export { PricingCards, IntervalToggle, publicPlanPrice, publicPlanSavings, type BillingInterval } from './PricingCards'
export { CallbackWidget } from './CallbackWidget'
export { CustomerCases, CaseCard } from './CustomerCases'
export { DEMO_LOGOS, DEMO_TESTIMONIALS, DEMO_CASES, type DemoLogo, type DemoTestimonial, type DemoCase } from './demoContent'
export { SocialProof } from '@/site/layout/SiteFooter'
export { HeroSocialProof } from './HeroSocialProof'
