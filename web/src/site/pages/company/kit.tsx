import { forwardRef, useState, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { InitialsAvatar } from '@/site/components/sections/primitives'
import { Link } from 'react-router-dom'
import { FaqAccordion as CoreFaqAccordion, type FaqItem } from '@/site/components/sections/FaqAccordion'

/* -------------------------------------------------------------------------- */
/*  Kit visual do módulo site-secondary (páginas públicas secundárias).        */
/*  Tokens do site público (www.fonio.ai → Kloel): Roboto, ink #0F0F16,        */
/*  body #555B6E, brand #585DFE, heading #020618, borda botões #E1E3F4.        */
/* -------------------------------------------------------------------------- */

/** Selo/etiqueta em pílula (ex.: "Webinars", "Contato", "Área de imprensa"). Ícone opcional. */
export function Chip({ children, icon, className }: { children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex min-h-[34px] items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 py-1.5 text-[15px] leading-5 text-neutral-950 sm:text-[16px]', icon ? 'pl-[9.6px]' : '', className)}>
      {icon}
      <span>{children}</span>
    </span>
  )
}

/** Título de página/seção no padrão do site (hero 48px, seção 38px). */
export function SiteHeading({ children, size = 'section', as: Tag = 'h2', className, id }: { children: ReactNode; size?: 'hero' | 'section' | 'card'; as?: 'h1' | 'h2' | 'h3'; className?: string; id?: string }) {
  const cls =
    size === 'hero'
      ? 'text-[34px] leading-[40px] tracking-[-0.68px] sm:text-[48px] sm:leading-[55.2px] sm:tracking-[-0.96px]'
      : size === 'card'
        ? 'text-[20px] leading-[28px] tracking-[-0.15px]'
        : 'text-[30px] leading-[36px] tracking-[-0.3px] sm:text-[38px] sm:leading-[45.6px] sm:tracking-[-0.38px]'
  return (
    <Tag id={id} className={cn('text-balance font-medium text-heading', cls, className)}>
      {children}
    </Tag>
  )
}

export interface PillOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
}

/** Controle segmentado em pílula do site (abas de produto, Mensal/Anual, Indicar/Revender, abas do FAQ). */
export function SitePills<T extends string>({
  value, onChange, options, ariaLabel, className, itemClassName,
}: { value: T; onChange: (v: T) => void; options: PillOption<T>[]; ariaLabel: string; className?: string; itemClassName?: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-slate-100/90 p-1 no-scrollbar', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-state={active ? 'active' : 'inactive'}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/50',
              active ? 'bg-white text-ink shadow-[0_1px_3px_rgba(15,15,22,.08)]' : 'text-body hover:text-ink',
              itemClassName,
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Fundo em gradiente branco → lavanda → índigo (#6366F1) com elipse branca central — usado nos CTAs finais e heros. */
export const indigoGlowStyle: CSSProperties = {
  // [257]/[16]: topo branco, laterais em azul-claro → azul na altura do título, elipse branca central e base índigo (#6366F1).
  backgroundImage: [
    'radial-gradient(60% 50% at 50% 40%, #ffffff 0%, rgba(255,255,255,.97) 45%, rgba(255,255,255,0) 100%)',
    'linear-gradient(180deg, #ffffff 0%, #ffffff 15%, #c6dcfd 36%, #91a8fb 58%, #7177f6 79%, #6366f1 100%)',
  ].join(','),
}

/**
 * Faixa de CTA final (antes do rodapé): "Atendimento por voz reinventado, com a Kloel" + botão escuro.
 * Observada em Planos [285], Webinars [160], Imprensa [235], Contato [246], Integrações [24] e Parceiros [256].
 * Mesmas camadas do FinalCta compartilhado (gradiente branco → índigo #6366F1, brilho elíptico branco, quarto inferior índigo),
 * com a tipografia medida nas referências [160]/[256] a 1460 px: título 32px/40px, texto 16px/24px, botão 15px.
 * O botão é um link (`to`) ou abre um diálogo (`onClick`).
 */
export function FinalCtaBand({
  title = (
    <>
      Atendimento por voz
      <br />
      reinventado, com a Kloel
    </>
  ),
  text = 'Teste a kloel.ai e veja como nosso assistente de IA por voz automatiza suas ligações e libera sua equipe. Simples, eficiente e 24 horas por dia.',
  cta = 'Criar minha própria IA agora',
  to = '/criar-conta',
  secondary,
  onClick,
  className,
}: { title?: ReactNode; text?: ReactNode; cta?: string; to?: string; secondary?: { label: string; to: string }; onClick?: () => void; className?: string }) {
  const btn = cn(siteButton('dark'), 'whitespace-normal text-center')
  return (
    <section data-testid="final-cta" className={cn('relative overflow-hidden rounded-b-[24px] pb-28 pt-20 sm:pb-32 sm:pt-24', className)}>
      {/*
        topo branco puro: a faixa emenda sem costura na seção branca acima ([160]/[246]).
        Fidelidade final — cores amostradas na borda esquerda de [24]/[160]/[246] a 1470 px: as laterais passam por
        ciano-claro (#E2F5F8 → #C1E2F3) antes do azul-lavanda e só chegam ao índigo (#666DF5) na base da faixa;
        no centro, a elipse branca cobre até ~72% da altura (logo abaixo do botão).
      */}
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,#ffffff_0%,#ffffff_10%,#f9fefe_14%,#f1fbfc_19%,#e2f5f8_26%,#cfecf4_33%,#c1e2f3_39%,#b4d3f2_47%,#a9c5f2_53%,#a1baf1_59%,#96aef2_64%,#8ca0ef_71%,#8291f3_77%,#7a87f3_83%,#727cf4_88%,#666df5_96%,#6366F1_100%)]" />
      <div aria-hidden className="absolute inset-x-0 -top-[30%] flex h-[130%] justify-center">
        <div className="h-full w-[min(1320px,118%)] shrink-0 rounded-[50%] bg-[radial-gradient(closest-side,#ffffff_0%,#ffffff_52%,rgba(255,255,255,.6)_67%,rgba(255,255,255,0)_82%)]" />
      </div>
      <div className="relative mx-auto flex max-w-[900px] flex-col items-center gap-4 px-5 text-center sm:gap-[14px]">
        <h2 className="text-balance text-[28px] font-medium leading-[34px] tracking-[-0.28px] text-heading sm:text-[32px] sm:leading-[38px] sm:tracking-[-0.32px]">{title}</h2>
        {text && <p className="max-w-[640px] text-pretty text-[16px] leading-6 text-[#2B3040]">{text}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-3 sm:mt-[18px]">
          {onClick ? (
            <button type="button" onClick={onClick} className={btn}>
              {cta}
            </button>
          ) : (
            <Link to={to} className={btn}>
              {cta}
            </Link>
          )}
          {secondary && (
            <Link to={secondary.to} className={siteButton('outline')}>
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

/** Hero com o mesmo gradiente índigo na base (parceiros, integrações). */
export function GradientHero({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section className={cn('relative w-full overflow-hidden rounded-b-[28px]', className)} style={style ?? indigoGlowStyle}>
      {children}
    </section>
  )
}

export type { FaqItem }

/**
 * Acordeão do site (abertura única, como observado em [258]→[259]) — envolve o FaqAccordion compartilhado (site-core).
 * `compact`: perguntas em 16px (medidas nas referências [258] e [246]), como nas páginas de Parceiros e Contato.
 */
export function FaqAccordion({ items, defaultOpen, className, compact }: { items: FaqItem[]; defaultOpen?: number; className?: string; idPrefix?: string; compact?: boolean }) {
  const [value, setValue] = useState(defaultOpen !== undefined ? String(defaultOpen) : '')
  return <CoreFaqAccordion items={items} value={value} onValueChange={setValue} size={compact ? 'sm' : 'md'} className={className} />
}

/** Avatares sobrepostos (iniciais em tons pastel — substituem fotos de pessoas reais). */
export function AvatarStack({ names, size = 'md', className }: { names: string[]; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = size === 'sm' ? 'h-7 w-7 text-[11px]' : size === 'lg' ? 'h-14 w-14 text-[17px]' : 'h-9 w-9 text-[13px]'
  return (
    <span className={cn('flex -space-x-2', size === 'lg' && '-space-x-3', className)}>
      {names.map((n, i) => (
        <InitialsAvatar key={n} name={n} tone={i + 1} className={cn('border-2 border-white', s)} />
      ))}
    </span>
  )
}

/** Campo com rótulo (asterisco cinza nos obrigatórios) e mensagem de erro em PT. */
export function SiteField({
  label, htmlFor, required, error, hint, children, className,
}: { label: ReactNode; htmlFor?: string; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <label htmlFor={htmlFor} className="text-[15px] leading-5 text-ink">
        {label}
        {required && <span className="ml-0.5 text-slate-300">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[13px] text-body">{hint}</p>}
      {error && (
        <p role="alert" className="text-[13px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export const siteInputCls =
  'h-11 w-full rounded-[10px] border border-slate-200 bg-[#F9FAFB] px-4 text-[16px] text-ink transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue/15 aria-[invalid=true]:border-red-400 aria-[invalid=true]:bg-red-50/30 disabled:opacity-60'

export const SiteInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...props }, ref) => (
  <input ref={ref} aria-invalid={invalid || undefined} className={cn(siteInputCls, className)} {...props} />
))
SiteInput.displayName = 'SiteInput'

export const SiteTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(({ className, invalid, ...props }, ref) => (
  <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(siteInputCls, 'h-auto min-h-[110px] py-3 leading-6', className)} {...props} />
))
SiteTextarea.displayName = 'SiteTextarea'

/** Botões do site. */
export function siteButton(variant: 'dark' | 'brand' | 'outline' | 'white' = 'dark', size: 'md' | 'lg' = 'lg') {
  return cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-site transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 disabled:cursor-not-allowed',
    size === 'lg' ? 'h-12 rounded-xl px-5 text-[15px]' : 'h-[38px] rounded-[10px] px-3.5 text-[14px]',
    variant === 'dark' && 'bg-heading text-white hover:bg-heading/90 disabled:bg-slate-300',
    variant === 'brand' && 'bg-brand-blue text-white hover:bg-[#4a4fe6] disabled:bg-[#B9BBFC] disabled:hover:bg-[#B9BBFC]',
    variant === 'outline' && 'border border-line bg-white text-neutral-950 hover:bg-slate-50',
    variant === 'white' && 'bg-white text-ink hover:bg-slate-50',
  )
}

/** Valida e-mail (formato simples). */
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
/** Conta dígitos de um telefone. */
export const phoneDigits = (v: string) => v.replace(/\D/g, '').length

const FADE_BOTTOM = 'linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%)'

/**
 * Manchas de aurora suaves (lilás / azul / verde-água) nas laterais — fundo das páginas de agendamento e heros claros.
 * `fade`: as manchas desaparecem até a base da seção, em vez de serem cortadas pelo `overflow-hidden` (sem costura com a seção seguinte).
 */
export function SoftAurora({ className, intensity = 1, fade }: { className?: string; intensity?: number; fade?: boolean }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} style={{ opacity: intensity, ...(fade ? { maskImage: FADE_BOTTOM, WebkitMaskImage: FADE_BOTTOM } : {}) }}>
      <div className="absolute -left-[300px] top-[28%] h-[780px] w-[640px] bg-[radial-gradient(closest-side,rgba(129,140,248,.34),rgba(165,180,252,.20)_45%,rgba(167,243,208,.10)_70%,rgba(255,255,255,0))]" />
      <div className="absolute -right-[280px] -top-[40px] h-[720px] w-[600px] bg-[radial-gradient(closest-side,rgba(129,140,248,.30),rgba(186,230,253,.18)_50%,rgba(167,243,208,.10)_72%,rgba(255,255,255,0))]" />
    </div>
  )
}
