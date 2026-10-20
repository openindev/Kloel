import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  ChevronDown, ChevronUp, PhoneCall, MessageSquareText, Mail, Router, Headset, CalendarCheck, ClipboardList, Voicemail, Truck, Video, Blocks,
  LifeBuoy, Briefcase, Megaphone, MessagesSquare, Menu, X, ArrowRight, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { WhatsAppIcon } from '@/components/brand/icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PRODUCTS_MENU, SOLUTIONS_MENU, RESOURCES_MENU, LANGUAGES_SITE, type NavGroup, type NavLinkItem } from './nav'
import { useSession } from '@/data/store'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'phone-call': PhoneCall, whatsapp: WhatsAppIcon, 'message-square-text': MessageSquareText, mail: Mail, router: Router, headset: Headset,
  'calendar-check': CalendarCheck, 'clipboard-list': ClipboardList, voicemail: Voicemail, truck: Truck, video: Video, blocks: Blocks,
  'life-buoy': LifeBuoy, briefcase: Briefcase, megaphone: Megaphone, 'messages-square': MessagesSquare,
}

/** Selo dos itens de menu (captura ao vivo: "rounded-full text-[11px]"; "Novo"/"Contratando" com borda e texto da marca, "Em breve" cinza). */
function MenuBadge({ badge }: { badge: NonNullable<NavLinkItem['badge']> }) {
  return (
    <span className={cn('ml-1.5 rounded-full border px-1.5 py-0.5 text-[11px] leading-none', badge === 'Em breve' ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-brand-blue/40 text-brand-blue')}>{badge}</span>
  )
}

function MenuLink({ item, onClick }: { item: NavLinkItem; onClick?: () => void }) {
  const Icon = ICONS[item.icon] ?? ArrowRight
  const content = (
    <>
      <Icon className={cn('h-4 w-4 shrink-0', item.muted ? 'text-slate-400' : 'text-[#555B6E]')} />
      <span>{item.label}</span>
      {item.badge && <MenuBadge badge={item.badge} />}
    </>
  )
  const cls = cn(
    'group flex items-center gap-2 whitespace-nowrap rounded-[10px] px-2 py-1.5 text-nav font-normal outline-none transition-colors duration-100 ease-out hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-blue/30',
    item.muted ? 'text-slate-400 hover:text-slate-500' : 'text-ink',
  )
  if (item.newTab)
    return (
      <a href={item.to} target="_blank" rel="noreferrer" className={cls} onClick={onClick}>
        {content}
      </a>
    )
  return (
    <Link to={item.to} className={cls} onClick={onClick} title={item.muted ? 'Em breve — entre na lista de espera' : undefined}>
      {content}
    </Link>
  )
}

function MegaPanel({ groups, highlight, onNavigate }: { groups: NavGroup[]; highlight?: boolean; onNavigate: () => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-7 shadow-lg shadow-slate-900/5">
      <div className="flex gap-0">
        {groups.map((g, i) => (
          <div key={g.label} className={cn('min-w-[230px] pr-6', i > 0 && 'border-l border-slate-200/80 pl-6')}>
            <div className="px-2 pb-3 text-xs font-medium uppercase tracking-wide text-slate-400">{g.label}</div>
            <div className="flex flex-col gap-0.5">
              {g.items.map((it) => (
                <MenuLink key={it.label} item={it} onClick={onNavigate} />
              ))}
            </div>
          </div>
        ))}
        {highlight && (
          <div className="border-l border-slate-200/80 pl-6">
            <div className="px-2 pb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Destaque</div>
            <Link to="/carreiras" onClick={onNavigate} className="group block w-[230px] rounded-[10px] px-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
              <div className="flex h-[128px] items-end overflow-hidden rounded-lg bg-[radial-gradient(120%_120%_at_0%_0%,#c7c9ff_0%,#585dfe_45%,#0f0f16_100%)] p-3 shadow-sm">
              </div>
              <div className="mt-3 text-[15px] font-medium text-ink">Estamos contratando</div>
              <div className="mt-1 flex items-center gap-1 text-sm text-body group-hover:text-ink">
                Junte-se ao time <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Item com mega-menu (OBSERVADO ao vivo: abre no hover; chevron-down → chevron-up; fundo slate-100 quando aberto).
 * Também abre por clique/teclado; fecha ao sair com o mouse, com Esc, ao clicar fora ou ao navegar.
 */
function DesktopMenu({ label, groups, highlight }: { label: string; groups: NavGroup[]; highlight?: boolean }) {
  const [open, setOpen] = useState(false)
  // Como o painel abre no hover, o clique logo em seguida não pode fechá-lo: o clique "fixa" o painel aberto
  // e só um segundo clique (ou Esc / clique fora / sair com o mouse) o fecha.
  const openedBy = useRef<'hover' | 'click' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Clique em área não focável do painel (rótulo, divisória, padding) tira o foco do botão com relatedTarget = null:
  // isso não pode fechar o painel enquanto o ponteiro está dentro dele.
  const pointerInside = useRef(false)
  // Deslocamento horizontal para o painel não ultrapassar a borda direita da janela (evita rolagem horizontal).
  const [shift, setShift] = useState(0)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname, loc.search])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setOpen(false)
        btn.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    if (!open) {
      setShift(0)
      return
    }
    const fit = () => {
      const el = panel.current
      const trigger = root.current
      if (!el || !trigger) return
      const left = trigger.getBoundingClientRect().left
      const width = el.offsetWidth
      const max = document.documentElement.clientWidth - 16
      setShift(Math.min(0, max - (left + width)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open])
  const panelId = `mega-${label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}`
  return (
    <div
      ref={root}
      className="relative"
      onMouseEnter={() => {
        clearTimeout(timer.current)
        if (!open) openedBy.current = 'hover'
        setOpen(true)
      }}
      onMouseLeave={() => {
        pointerInside.current = false
        timer.current = setTimeout(() => setOpen(false), 120)
      }}
      onPointerDown={() => {
        pointerInside.current = true
      }}
      onPointerUp={() => {
        // libera no próximo ciclo: o blur do botão acontece entre pointerdown e pointerup
        setTimeout(() => (pointerInside.current = false), 0)
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null
        if (!next && pointerInside.current) return
        if (!e.currentTarget.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (open && openedBy.current === 'hover') {
            openedBy.current = 'click'
            return
          }
          openedBy.current = open ? null : 'click'
          setOpen(!open)
        }}
        className={cn('flex items-center gap-0 whitespace-nowrap rounded-[10px] px-3 py-1.5 text-nav text-neutral-900 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-blue/30', open && 'bg-slate-100')}
      >
        {label}
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div ref={panel} id={panelId} style={{ left: shift }} className="absolute left-0 top-full z-50 pt-3 animate-in fade-in-0 zoom-in-95 slide-in-from-top-1">
          <MegaPanel groups={groups} highlight={highlight} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

/** Seletor de idioma (bandeira + chevron). Só Português (BR) existe na demonstração: os demais idiomas aparecem desabilitados ("Em breve"). */
function LanguageSelect({ mobile }: { mobile?: boolean }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn('flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-nav text-neutral-900 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-blue/30 data-[state=open]:bg-slate-100', mobile && 'w-full justify-between px-0 py-0 hover:bg-transparent data-[state=open]:bg-transparent')}
          aria-label="Idioma: Português (BR)"
        >
          <span className="flex items-center gap-2">
            {/* [1] Header.png (1460px): bandeira de ≈17×13px */}
            <span className={cn('fi fi-br rounded-[2px]', !mobile && 'text-[13px]')} />
            {mobile && 'Português (BR)'}
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={mobile ? 'start' : 'end'} className="w-56 font-site">
        {LANGUAGES_SITE.map((l) => (
          <DropdownMenuItem key={l.code} disabled={!l.active} className="gap-2.5 py-2 text-[14px]">
            <span className={cn('fi rounded-[2px]', `fi-${l.code}`)} />
            <span className="flex-1">{l.label}</span>
            {l.active ? <Check className="h-4 w-4 text-brand-blue" /> : <span className="text-[11px] text-slate-500">Em breve</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MobileSection({ label, groups, onNavigate }: { label: string; groups: NavGroup[]; onNavigate: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-200">
      <button type="button" className="flex w-full items-center justify-between py-3.5 text-[16px] text-ink" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {label}
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="flex flex-col gap-1 pb-3">
          {groups.map((g) => (
            <div key={g.label}>
              {groups.length > 1 || g.label !== 'Produtos' ? <div className="px-0 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{g.label}</div> : null}
              {g.items.map((it) => (
                <MenuLink key={it.label} item={it} onClick={onNavigate} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Página atual sem destaque visual (a referência [257] mostra "Torne-se um parceiro" sem fundo na própria página); NavLink só marca aria-current.
const navLinkCls = 'whitespace-nowrap rounded-[10px] px-3 py-1.5 text-nav text-neutral-900 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-blue/30'

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const loc = useLocation()
  const session = useSession()
  useEffect(() => setMobileOpen(false), [loc.pathname, loc.search])
  // Menu móvel: Esc fecha; a página por trás não rola enquanto o painel está aberto.
  useEffect(() => {
    if (!mobileOpen) return
    // Esc dentro de um menu Radix aberto (ex.: idioma) já é tratado por ele (defaultPrevented): fecha só o menu interno.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && setMobileOpen(false)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [mobileOpen])
  // Ao crescer para desktop (xl, 1280 px: abaixo disso o menu completo não cabe em uma linha) com o painel aberto, fecha
  // (evita a página travada sem rolagem).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const onChange = () => mq.matches && setMobileOpen(false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const startHref = session.userId ? '/app' : '/criar-conta'
  const close = () => setMobileOpen(false)
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white font-site">
      {/* Medido nas comparações a 1470 px ([244] Contato/01, [160] Webinars/01, [16] Integrações/01, 0. Header.png; a moldura verde
          da gravação cobre os 5 px das bordas da página — mesma escala que dá a barra lateral de 260 px do app): cabeçalho com
          ≈70,5 px (borda inferior em y≈70), tinta do logo em x=47, "Produtos" em x=182 (o logo "kloel.ai" é ≈3 px mais estreito que
          "fonio.ai", daí 53 px de gap) e "Agendar uma demo" terminando em x≈1292 (49 px de margem direita). */}
      <div className="mx-auto flex h-[70px] items-center justify-between px-5 lg:pl-[45px] lg:pr-[49px]">
        <div className="flex items-center gap-12 xl:gap-[53px]">
          <Link to="/" aria-label="kloel.ai — início" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
            <KloelLogo className="text-[23px] lg:text-[25px]" />
          </Link>
          <nav aria-label="Navegação principal" className="hidden items-center gap-0.5 xl:flex">
            <DesktopMenu label="Produtos" groups={PRODUCTS_MENU} />
            <DesktopMenu label="Soluções" groups={SOLUTIONS_MENU} />
            <DesktopMenu label="Recursos" groups={RESOURCES_MENU} highlight />
            <NavLink to="/parceiros" end className={navLinkCls}>Torne-se um parceiro</NavLink>
            <NavLink to="/casos-de-sucesso" className={navLinkCls}>Histórias de clientes</NavLink>
            <NavLink to="/planos" className={navLinkCls}>Planos</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden xl:block">
            <LanguageSelect />
          </div>
          <Link to="/agendar-demo" className="hidden h-[38px] items-center whitespace-nowrap rounded-[10px] border border-line bg-white px-3.5 text-sm text-neutral-950 hover:bg-slate-50 xl:inline-flex">
            Agendar uma demo
          </Link>
          <Link to="/agendar-demo" className="inline-flex h-[38px] items-center whitespace-nowrap rounded-[10px] bg-heading px-3.5 text-sm text-white xl:hidden">
            Agendar uma demo
          </Link>
          <Link to={startHref} className="hidden h-[38px] items-center whitespace-nowrap rounded-[10px] border border-heading bg-heading px-3.5 text-sm text-white hover:bg-heading/90 xl:inline-flex">
            Comece agora
          </Link>
          <button
            type="button"
            className="-mr-2 ml-1 inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-ink xl:hidden"
            aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={mobileOpen}
            aria-controls="site-mobile-menu"
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <>
          <button type="button" aria-label="Fechar menu" tabIndex={-1} className="fixed inset-x-0 bottom-0 top-[71px] -z-10 bg-slate-900/10 xl:hidden" onClick={close} />
          <nav id="site-mobile-menu" aria-label="Menu" className="absolute inset-x-0 top-full max-h-[calc(100svh-71px)] overflow-y-auto overscroll-contain border-b bg-white px-5 pb-5 shadow-lg lg:px-[42px] xl:hidden">
            <MobileSection label="Produtos" groups={PRODUCTS_MENU} onNavigate={close} />
            <MobileSection label="Soluções" groups={SOLUTIONS_MENU} onNavigate={close} />
            <MobileSection label="Recursos" groups={RESOURCES_MENU} onNavigate={close} />
            <Link to="/parceiros" onClick={close} className="block border-b border-slate-200 py-3.5 text-[16px] text-ink">Torne-se um parceiro</Link>
            <Link to="/casos-de-sucesso" onClick={close} className="block border-b border-slate-200 py-3.5 text-[16px] text-ink">Histórias de clientes</Link>
            <Link to="/planos" onClick={close} className="block border-b border-slate-200 py-3.5 text-[16px] text-ink">Planos</Link>
            <div className="border-b border-slate-200 py-3.5 text-[16px] text-ink">
              <LanguageSelect mobile />
            </div>
            <Link to={startHref} onClick={close} className="mt-4 flex h-12 items-center justify-center rounded-xl border border-line text-[16px] text-ink">
              Comece agora
            </Link>
          </nav>
        </>
      )}
    </header>
  )
}
