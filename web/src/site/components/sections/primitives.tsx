import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import './site-sections.css'

/* -------------------------------------------------------------------------- */
/*  Primitivas visuais do site público (tokens de www.fonio.ai → Kloel)        */
/*  Fonte: font-site (Roboto). Títulos: hero 48px/55.2 500 -0.96px ;           */
/*  seção 38px/45.6 500 -0.38px ; H3 20px/28 500 -0.15px.                      */
/* -------------------------------------------------------------------------- */

/** Contêiner padrão das seções (largura útil observada ≈ 1320px a 1470px de viewport). */
export type ContainerSize = 'md' | 'lg' | 'xl' | 'wide' | 'full'
/** size 'wide' = 1376px úteis (cartões de "3 passos" e cases da home na referência a 1470px). */
export function Container({ children, className, size = 'xl' }: { children: ReactNode; className?: string; size?: ContainerSize }) {
  const max = size === 'md' ? 'max-w-[900px]' : size === 'lg' ? 'max-w-[1180px]' : size === 'full' ? 'max-w-[1400px]' : size === 'wide' ? 'max-w-[1440px]' : 'max-w-[1320px]'
  return <div className={cn('mx-auto w-full px-5 lg:px-8', max, className)}>{children}</div>
}

/**
 * Título de seção.
 * props: title (texto/nó), subtitle?, align 'center'|'left', size 'section' (38px) | 'hero' (48px) | 'card' (20px), as? (h1|h2|h3), eyebrow?
 *        subtitleSize 'lg' (padrão: 16/26 no celular, 18/28 a partir de sm — home, ex. "Integra-se às suas ferramentas" em 7.png)
 *                     | 'md' (16/24 a partir de sm — páginas de produto e depoimentos: WhatsApp 03.png, Webchat 03.png/5.png/7.png, soluções 06.png)
 */
export function SectionTitle({
  title, subtitle, align = 'center', size = 'section', as, eyebrow, className, subtitleClassName, titleClassName, subtitleSize = 'lg',
}: {
  title: ReactNode; subtitle?: ReactNode; align?: 'center' | 'left'; size?: 'section' | 'hero' | 'card'; as?: 'h1' | 'h2' | 'h3'; eyebrow?: ReactNode; className?: string; subtitleClassName?: string
  subtitleSize?: 'lg' | 'md'
  /** classes extras do título (ex.: "[text-wrap:wrap]" para quebrar como na referência em vez de balancear) */
  titleClassName?: string
}) {
  const Tag = as ?? (size === 'hero' ? 'h1' : size === 'card' ? 'h3' : 'h2')
  const sizeCls =
    size === 'hero'
      ? 'text-[34px] leading-[40px] tracking-[-0.68px] sm:text-[48px] sm:leading-[55.2px] sm:tracking-[-0.96px]'
      : size === 'card'
        ? 'text-[20px] leading-[28px] tracking-[-0.15px]'
        : 'text-[30px] leading-[36px] tracking-[-0.3px] sm:text-[38px] sm:leading-[45.6px] sm:tracking-[-0.38px]'
  return (
    <div className={cn('flex flex-col gap-4', align === 'center' ? 'items-center text-center' : 'items-start text-left', className)}>
      {eyebrow}
      <Tag className={cn('text-balance font-medium text-heading', sizeCls, titleClassName)}>{title}</Tag>
      {subtitle && <p className={cn('max-w-[760px] text-pretty text-[16px] leading-[26px] text-body', subtitleSize === 'md' ? 'sm:text-[16px] sm:leading-6' : 'sm:text-[18px] sm:leading-[28px]', subtitleClassName)}>{subtitle}</p>}
    </div>
  )
}

/** Selo em pílula branca com ícone verificado da marca (ex.: "Assistentes de IA por Voz e WhatsApp para PMEs"). */
export function PillBadge({ children, icon, className }: { children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex min-h-[34px] items-center gap-2 rounded-[10px] border border-slate-200 bg-white py-2 pl-[9.6px] pr-3 text-[14px] leading-4 text-neutral-950 shadow-[0_1px_2px_rgba(15,15,22,.04)] sm:text-[16px]', className)}>
      {/* ícone de 16px: pílula com 34px de altura (token ao vivo "h 34px"; referência 01.png: borda 150–184 a 1460px) */}
      {icon ?? <BadgeCheck className="h-4 w-4 shrink-0 fill-brand-blue text-white" />}
      <span>{children}</span>
    </span>
  )
}

/**
 * Link com aparência de botão do site.
 * variant: 'dark' (slate-950) | 'brand' (#585DFE) | 'outline' (branco + borda) | 'white' ; size: 'md' (h38) | 'lg' (h48)
 * `to` aceita rota local ou âncora ("#agendar"). onClick opcional.
 */
export function CtaLink({
  to, children, variant = 'dark', size = 'lg', className, icon, onClick,
}: { to: string; children: ReactNode; variant?: 'dark' | 'brand' | 'outline' | 'white'; size?: 'md' | 'lg'; className?: string; icon?: ReactNode; onClick?: () => void }) {
  const cls = cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-site transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40',
    // lg: 48 px de altura, rótulo de 15 px e px-5, como os botões do site medidos em [233], [257] e nas soluções ([124])
    size === 'lg' ? 'h-12 rounded-xl px-5 text-[15px]' : 'h-[38px] rounded-[10px] px-3.5 text-[14px]',
    variant === 'dark' && 'bg-heading text-white hover:bg-heading/90',
    variant === 'brand' && 'bg-brand-blue text-white hover:bg-[#4a4fe6]',
    variant === 'outline' && 'border border-line bg-white text-neutral-950 hover:bg-slate-50',
    variant === 'white' && 'bg-white text-ink hover:bg-slate-50',
    className,
  )
  if (to.startsWith('#')) {
    return (
      <a href={to} className={cls} onClick={onClick}>
        {children}
        {icon}
      </a>
    )
  }
  return (
    <Link to={to} className={cls} onClick={onClick}>
      {children}
      {icon}
    </Link>
  )
}

/**
 * Fitas de aurora desfocadas (lilás / azul / verde-água) nas laterais do hero, animadas lentamente.
 * Posicione dentro de um pai `relative overflow-hidden`.
 */
export function AuroraBackground({ className, variant = 'hero' }: { className?: string; variant?: 'hero' | 'soft' | 'demo' | 'ribbon' }) {
  const id = useId().replace(/:/g, '')
  if (variant === 'ribbon') return <RibbonAurora className={className} id={id} />
  const op = variant === 'soft' ? 0.3 : 0.42
  // viewBox com folga de 200px em volta das fitas + overflow visível: o desfoque nunca é cortado pela caixa do SVG
  // (o recorte acontece apenas na borda do contêiner pai, que ocupa a largura toda).
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <svg className="ks-aurora-a absolute -left-[460px] top-[calc(34%-200px)] h-[1160px] w-[1020px] overflow-visible sm:-left-[400px]" viewBox="-200 -200 1020 1160" fill="none">
        <defs>
          <linearGradient id={`${id}-l`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#C7F0E0" />
            <stop offset="45%" stopColor="#A9B4FF" />
            <stop offset="100%" stopColor="#6D72FF" />
          </linearGradient>
          <filter id={`${id}-bl`} x="-60%" y="-60%" width="220%" height="220%" filterUnits="objectBoundingBox">
            <feGaussianBlur stdDeviation="26" />
          </filter>
        </defs>
        <path d="M120 60 C 470 140, 560 430, 300 560 C 160 630, 120 700, 260 740" stroke={`url(#${id}-l)`} strokeWidth="110" strokeLinecap="round" opacity={op} filter={`url(#${id}-bl)`} />
        <path d="M60 220 C 330 260, 430 470, 240 640" stroke={`url(#${id}-l)`} strokeWidth="26" strokeLinecap="round" opacity={op * 0.8} filter={`url(#${id}-bl)`} />
      </svg>
      <svg className="ks-aurora-b absolute -right-[500px] -top-[260px] h-[1160px] w-[1020px] overflow-visible sm:-right-[420px]" viewBox="-200 -200 1020 1160" fill="none">
        <defs>
          <linearGradient id={`${id}-r`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D6F5EA" />
            <stop offset="50%" stopColor="#B9C2FF" />
            <stop offset="100%" stopColor="#7C80FF" />
          </linearGradient>
          <filter id={`${id}-br`} x="-60%" y="-60%" width="220%" height="220%" filterUnits="objectBoundingBox">
            <feGaussianBlur stdDeviation="26" />
          </filter>
        </defs>
        <path d="M520 40 C 220 160, 180 420, 420 560 C 520 620, 560 690, 440 740" stroke={`url(#${id}-r)`} strokeWidth="120" strokeLinecap="round" opacity={op} filter={`url(#${id}-br)`} />
        <path d="M600 260 C 380 300, 330 470, 470 620" stroke={`url(#${id}-r)`} strokeWidth="30" strokeLinecap="round" opacity={op * 0.8} filter={`url(#${id}-br)`} />
      </svg>
      {variant !== 'demo' && <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-white" />}
      {variant === 'demo' && (
        <div className="absolute inset-x-0 -bottom-40 flex justify-center">
          <div className="ks-swoosh h-[360px] w-[1100px] shrink-0 rounded-[50%] bg-[radial-gradient(closest-side,rgba(110,231,183,.25),rgba(129,140,248,.18),transparent)] blur-2xl" />
        </div>
      )}
    </div>
  )
}

/**
 * Variante "ribbon" das fitas (hero da home, dos produtos e das soluções). Recriação própria da Kloel em SVG — a Fonio usa dois
 * vídeos (arte proprietária, não copiada). As CAIXAS seguem as medidas ao vivo de www.fonio.ai/pt-br a 1512 px:
 *  - pai: `pointer-events-none absolute inset-0 -z-10 overflow-hidden` (a seção do hero precisa de `relative isolate`);
 *  - fita 1 (laço à esquerda): 800×800 em bottom −100 / left −520; a partir de `md` 680×680 em bottom −10 / left −250;
 *    opacidade 80%, deriva `drift-1` (14 s, até translate(24px, 32px));
 *  - fita 2 (fita em C no canto superior direito): 500×500 em top −122 / right −352; a partir de `md` top 70 / right −300;
 *    opacidade 80%, deriva `drift-2` (18 s, até translate(−28px, −24px)).
 * Sem animação com `prefers-reduced-motion`. As cores foram amostradas nas referências do operador (01.png da home, das
 * soluções e dos produtos): laço com face larga verde-água → azul-céu à esquerda, dobra azul-violeta na base e borda fina
 * lilás na lateral direita; fita em C com dorso verde-água, reflexo claro e miolo azul profundo.
 * Coordenadas: viewBox 680×680 (laço) e 500×500 (C) = pixels da caixa a partir de `md`.
 */
function RibbonAurora({ className, id }: { className?: string; id: string }) {
  const u = (s: string) => `url(#${id}-${s})`
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)}>
      <div className="ks-drift-1 absolute bottom-[-100px] left-[-520px] h-[800px] w-[800px] max-w-none opacity-80 md:bottom-[-10px] md:left-[-250px] md:h-[680px] md:w-[680px]">
        <svg className="h-full w-full overflow-visible" viewBox="0 0 680 680" fill="none">
          <defs>
            {/* face larga: verde-água no alto, azul-céu, faixa clara e azul-violeta na dobra da base */}
            <linearGradient id={`${id}-lf`} gradientUnits="userSpaceOnUse" x1="0" y1="206" x2="0" y2="612">
              <stop offset="0" stopColor="#9CE6C9" stopOpacity="0.2" />
              <stop offset="0.1" stopColor="#95E0C8" stopOpacity="0.26" />
              <stop offset="0.21" stopColor="#8CCFE0" stopOpacity="0.32" />
              <stop offset="0.34" stopColor="#6E9EF3" stopOpacity="0.6" />
              <stop offset="0.45" stopColor="#8FB6F5" stopOpacity="0.33" />
              <stop offset="0.58" stopColor="#B7CDF7" stopOpacity="0.18" />
              <stop offset="0.68" stopColor="#A9BDF6" stopOpacity="0.22" />
              <stop offset="0.77" stopColor="#5F6EF0" stopOpacity="0.62" />
              <stop offset="0.87" stopColor="#6F7DF1" stopOpacity="0.56" />
              <stop offset="0.95" stopColor="#A3AEF5" stopOpacity="0.25" />
              <stop offset="1" stopColor="#B5BDF7" stopOpacity="0.1" />
            </linearGradient>
            {/* borda fina: some no alto da lateral direita */}
            <linearGradient id={`${id}-le`} gradientUnits="userSpaceOnUse" x1="0" y1="318" x2="0" y2="548">
              <stop offset="0" stopColor="#7C80EE" stopOpacity="0" />
              <stop offset="0.27" stopColor="#7176EC" stopOpacity="0.5" />
              <stop offset="0.45" stopColor="#7176EC" stopOpacity="0.42" />
              <stop offset="0.53" stopColor="#8A8EF0" stopOpacity="0.12" />
              <stop offset="0.72" stopColor="#8A8EF0" stopOpacity="0.12" />
              <stop offset="0.79" stopColor="#6A6FEA" stopOpacity="0.3" />
              <stop offset="0.9" stopColor="#6A6FEA" stopOpacity="0.45" />
              <stop offset="1" stopColor="#6A6FEA" stopOpacity="0.62" />
            </linearGradient>
            <linearGradient id={`${id}-lv`} gradientUnits="userSpaceOnUse" x1="0" y1="220" x2="0" y2="560">
              <stop offset="0" stopColor="#B9BCF7" stopOpacity="0" />
              <stop offset="0.5" stopColor="#ABAEF4" stopOpacity="0.16" />
              <stop offset="1" stopColor="#9A9EF2" stopOpacity="0.26" />
            </linearGradient>
            <filter id={`${id}-b16`} filterUnits="userSpaceOnUse" x="-160" y="-160" width="1000" height="1000"><feGaussianBlur stdDeviation="16" /></filter>
            <filter id={`${id}-b9`} filterUnits="userSpaceOnUse" x="-160" y="-160" width="1000" height="1000"><feGaussianBlur stdDeviation="9" /></filter>
            <filter id={`${id}-b6`} filterUnits="userSpaceOnUse" x="-160" y="-160" width="1000" height="1000"><feGaussianBlur stdDeviation="6" /></filter>
            <filter id={`${id}-b1`} filterUnits="userSpaceOnUse" x="-160" y="-160" width="1000" height="1000"><feGaussianBlur stdDeviation="0.9" /></filter>
          </defs>
          {/* halo difuso, mais visível em volta da base */}
          <path d="M300 236 C 404 226, 492 318, 532 400 C 556 452, 566 504, 532 530 C 480 556, 380 560, 300 558 C 224 556, 190 478, 194 390 C 198 306, 232 240, 300 236 Z" stroke="#A3AAF5" strokeWidth="40" opacity="0.12" filter={u('b16')} />
          {/* véu lilás translúcido: face da fita vista de lado, por dentro da borda direita e da base */}
          <path d="M306 226 C 420 220, 502 316, 546 398 C 570 452, 578 506, 550 532 C 518 556, 470 556, 420 552 L 424 534 C 470 532, 510 522, 524 500 C 538 470, 528 432, 508 394 C 474 324, 400 258, 318 252 Z" fill={u('lv')} filter={u('b9')} />
          {/* face larga à esquerda + dobra da base (afina até virar a borda fina) */}
          <path d="M318 214 C 256 210, 206 250, 194 326 C 182 402, 190 470, 212 528 C 232 582, 290 612, 362 602 C 398 596, 416 588, 426 580 C 410 566, 390 554, 362 542 C 322 526, 297 500, 291 460 C 284 406, 287 338, 300 300 C 308 274, 318 254, 336 236 Z" fill={u('lf')} filter={u('b6')} />
          {/* brilho lilás difuso por baixo da faixa da base */}
          <ellipse cx="300" cy="598" rx="120" ry="28" fill="#9FA8F5" opacity="0.2" filter={u('b16')} />
          {/* dobra azul-violeta mais intensa no alto da faixa da base */}
          <path d="M262 528 C 294 536, 330 546, 372 554" stroke="#5462EB" strokeWidth="22" strokeLinecap="round" opacity="0.32" filter={u('b9')} />
          {/* borda fina: base → canto inferior direito → lateral direita (fio duplo, como o vidro da referência) */}
          <path d="M392 548 C 448 549, 500 541, 524 526 C 548 511, 552 488, 542 466 C 532 446, 518 434, 508 416 C 500 392, 490 374, 470 352 C 450 330, 430 306, 400 280" stroke={u('le')} strokeWidth="2.2" strokeLinecap="round" filter={u('b1')} />
          <path d="M404 541 C 452 541, 494 534, 516 520 C 536 506, 542 488, 536 470" stroke="#A3A7F3" strokeWidth="1.1" strokeLinecap="round" opacity="0.35" filter={u('b1')} />
        </svg>
      </div>
      <div className="ks-drift-2 absolute right-[-352px] top-[-122px] h-[500px] w-[500px] max-w-none opacity-80 md:right-[-300px] md:top-[70px]">
        <svg className="h-full w-full overflow-visible" viewBox="0 0 500 500" fill="none">
          <defs>
            <filter id={`${id}-c16`} filterUnits="userSpaceOnUse" x="-160" y="-160" width="820" height="820"><feGaussianBlur stdDeviation="16" /></filter>
            <filter id={`${id}-c9`} filterUnits="userSpaceOnUse" x="-160" y="-160" width="820" height="820"><feGaussianBlur stdDeviation="9" /></filter>
            <filter id={`${id}-c1`} filterUnits="userSpaceOnUse" x="-160" y="-160" width="820" height="820"><feGaussianBlur stdDeviation="0.8" /></filter>
          </defs>
          {/* véu ciano em volta da fita e lóbulo lilás embaixo à esquerda */}
          <path d="M262 40 C 196 100, 140 160, 126 226 C 116 276, 150 304, 200 306 C 226 307, 248 300, 270 290" stroke="#CDEFF0" strokeWidth="118" strokeLinecap="round" opacity="0.26" filter={u('c16')} />
          <ellipse cx="96" cy="282" rx="66" ry="50" transform="rotate(-25 96 282)" fill="#C2CDF6" opacity="0.3" filter={u('c16')} />
          {/* braço de cima descendo da direita: face azul-céu */}
          <path d="M268 38 C 228 72, 194 112, 166 158" stroke="#7AA6F2" strokeWidth="50" strokeLinecap="round" opacity="0.5" filter={u('c9')} />
          {/* dorso da fita, a outra face: verde-água / ciano */}
          <path d="M196 112 C 160 150, 134 190, 128 230 C 124 262, 136 284, 160 296" stroke="#8FDBC2" strokeWidth="54" strokeLinecap="round" opacity="0.46" filter={u('c9')} />
          {/* braço de baixo voltando para a direita: azul profundo junto da borda da tela */}
          <path d="M156 288 C 186 302, 222 302, 266 284" stroke="#3A4EE8" strokeWidth="36" strokeLinecap="round" opacity="0.72" filter={u('c9')} />
          {/* fio claro de vidro ao longo do dorso */}
          <path d="M236 44 C 196 86, 160 134, 142 186 C 130 222, 130 258, 156 286" stroke="#F0FFF9" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" filter={u('c1')} />
        </svg>
      </div>
    </div>
  )
}

/** Orbe translúcida azul/lilás/menta (a "voz da IA"), com flutuação e brilho animados. */
export function VoiceOrb({ size = 220, className, active }: { size?: number | 'fill'; className?: string; active?: boolean }) {
  return (
    <div className={cn('ks-orb relative', className)} style={size === 'fill' ? undefined : { width: size, height: size }} aria-hidden>
      {/* vidro azul-pervinca (referência 01.png): corpo #8EA6F2, borda superior lilás clara, base clara e difusa */}
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_46%_34%,#c4dcff_0%,#a3baf8_30%,#8ea6f2_58%,#9fb6f4_76%,#dcecfb_100%)] blur-[1.5px]" />
      <div className="absolute inset-0 rounded-full bg-[linear-gradient(180deg,rgba(243,238,255,.65)_0%,rgba(255,255,255,0)_22%,rgba(255,255,255,0)_52%,rgba(222,242,255,.9)_92%)]" />
      <div className="absolute inset-0 overflow-hidden rounded-full">
        {/* facetas: faixa clara diagonal no quadrante inferior esquerdo e dobra mais escura à direita */}
        <div className="absolute -left-[18%] top-[56%] h-[60%] w-[90%] -rotate-[30deg] bg-white/40 blur-[3px]" />
        <div className="absolute right-[15%] top-[8%] h-[62%] w-[4%] rounded-full bg-[#6f86ea]/30 blur-[4px]" />
        <div className="ks-orb-spin absolute inset-[8%] rounded-full bg-[conic-gradient(from_0deg,rgba(255,255,255,0),rgba(186,230,253,.45),rgba(129,140,248,.25),rgba(186,230,253,.35),rgba(255,255,255,0))] blur-md" />
      </div>
      {/* reflexo ciano vertical perto do topo */}
      <div className="absolute left-[30%] top-[10%] h-[34%] w-[13%] rounded-full bg-[#c8f3ff]/80 blur-[6px]" />
      {active && <div className="absolute -inset-4 animate-call-pulse rounded-full border-2 border-brand-blue/40" />}
    </div>
  )
}

/**
 * Orbe do hero na mesma caixa do vídeo "hero-sphere" da Fonio (medida ao vivo a 1512 px):
 * `-my-6 h-[120px] w-[120px] sm:h-[200px] sm:w-[200px]` — a margem negativa faz a caixa ocupar 72/152 px no fluxo.
 * A esfera ocupa 82% da caixa (≈164 px a partir de `sm`, como a esfera de ≈164 px medida em 01.png a 1460 px).
 * Margens externas (posição vertical) vêm do `className` do wrapper.
 */
export function HeroOrb({ className }: { className?: string }) {
  return (
    <div className={cn('flex shrink-0 justify-center', className)}>
      <div className="relative -my-6 h-[120px] w-[120px] max-w-none sm:h-[200px] sm:w-[200px]" data-testid="hero-orb">
        <VoiceOrb size="fill" className="absolute inset-[9%]" />
      </div>
    </div>
  )
}

/**
 * Texto truncado com "Leia mais ⌄" / "Mostrar menos ⌃". O controle só aparece quando o texto realmente transborda.
 * props: text, lines (2 por padrão), className, center?
 */
export function ReadMore({ text, lines = 2, className, center, toggleClassName }: { text: ReactNode; lines?: number; className?: string; center?: boolean; toggleClassName?: string }) {
  const [open, setOpen] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setOverflow(el.scrollHeight - el.clientHeight > 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, text])
  return (
    <div className={cn('flex flex-col gap-2', center ? 'items-center' : 'items-start')}>
      <p
        ref={ref}
        className={cn('text-body', className)}
        style={open ? undefined : { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      >
        {text}
      </p>
      {(overflow || open) && (
        // rótulo de 14 px: "Leia mais" com ≈58 px nas soluções ([103] 03.png, [121] 01.png), única página com ReadMore
        <button type="button" onClick={() => setOpen((v) => !v)} className={cn('inline-flex items-center gap-1 text-[14px] font-normal text-[#90A1B9] transition-colors hover:text-[#45556C]', toggleClassName)} aria-expanded={open}>
          {open ? 'Mostrar menos' : 'Leia mais'}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      )}
    </div>
  )
}

/** Seção com espaçamento vertical padrão. background: 'white' | 'gray' (#F7F8FC, amostrado em 06.png "Casos de uso") */
export function Section({ id, children, className, background = 'white' }: { id?: string; children: ReactNode; className?: string; background?: 'white' | 'gray' }) {
  return (
    <section id={id} className={cn('relative scroll-mt-24 py-16 sm:py-24', background === 'gray' && 'bg-[#F7F8FC]', className)}>
      {children}
    </section>
  )
}

/** Hook: true quando o elemento entra na viewport (usado para animações de entrada). */
export function useInView<T extends Element>(opts: IntersectionObserverInit = { threshold: 0.2 }) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setInView(true)
        io.disconnect()
      }
    }, opts)
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView])
  return { ref, inView }
}

/** Estrelas de avaliação (cor da marca). */
export function Stars({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex gap-1', className)} aria-label={`${count} de 5 estrelas`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} viewBox="0 0 20 20" className={cn('h-[18px] w-[18px]', i < count ? 'fill-brand-blue' : 'fill-slate-200')} aria-hidden>
          <path d="M10 1.5l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L10 14.8 4.7 17.7l1.2-5.9L1.4 7.7l6-.7z" />
        </svg>
      ))}
    </div>
  )
}

/** Avatar de iniciais em círculo pastel (substitui fotos de pessoas reais). */
export function InitialsAvatar({ name, className, tone }: { name: string; className?: string; tone?: number }) {
  const tones = ['bg-[#E0E7FF] text-[#3730A3]', 'bg-[#DCFCE7] text-[#166534]', 'bg-[#FCE7F3] text-[#9D174D]', 'bg-[#FEF3C7] text-[#92400E]', 'bg-[#E0F2FE] text-[#075985]', 'bg-[#EDE9FE] text-[#5B21B6]']
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const initials = name.replace(/^(Dr\.|Dra\.)\s*/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return <span className={cn('inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[15px] font-medium', tones[(tone ?? h) % tones.length], className)}>{initials}</span>
}
