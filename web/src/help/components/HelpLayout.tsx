import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Rocket, Box, Plug, Handshake, Search, Sparkles, ChevronRight, Menu, Ellipsis, Check, LifeBuoy, Languages } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HELP_TABS, articleHref, firstArticleOfTab, sidebarLabel, type HelpTab, type HelpTabId } from '../content'
import { useHelpUi } from '../lib/ui'
import { HelpSidebar } from './HelpSidebar'
import { SearchDialog } from './SearchDialog'
import { AskPanel } from './AskPanel'
import { SupportDialog } from './SupportDialog'

const TAB_ICONS = { rocket: Rocket, box: Box, plug: Plug, handshake: Handshake }

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const MOD = IS_MAC ? '⌘' : 'Ctrl '

const LANGUAGES = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
]

function languageNotice(label: string) {
  toast(`${label} indisponível`, {
    description: 'A Central de ajuda da Kloel está disponível somente em Português (Brasil).',
  })
}

function KbdHint({ children }: { children: ReactNode }) {
  return <kbd className="ml-auto hidden h-5 items-center rounded-md bg-zinc-100 px-1.5 font-sans text-[11px] font-medium text-zinc-500 sm:inline-flex">{children}</kbd>
}

/* ------------------------- Rolagem da sidebar ------------------------- */

/** Posição de rolagem da sidebar por aba: o layout é remontado a cada artigo, então ela fica fora do componente. */
const SIDEBAR_SCROLL = new Map<string, number>()

/** Se o item ativo estiver fora da área visível do contêiner, centraliza-o (sem animação). */
function revealActive(container: HTMLElement, margin = 12) {
  const active = container.querySelector<HTMLElement>('[aria-current="page"]')
  if (!active) return
  const c = container.getBoundingClientRect()
  const r = active.getBoundingClientRect()
  if (r.top >= c.top + margin && r.bottom <= c.bottom - margin) return
  container.scrollTop += r.top - c.top - (c.height - r.height) / 2
}

/** Sidebar desktop: mantém a rolagem entre artigos da mesma aba e traz o item ativo para a vista (deep link). */
function useSidebarScroll(tabId: string, activeKey?: string) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = SIDEBAR_SCROLL.get(tabId) ?? 0
    revealActive(el)
    SIDEBAR_SCROLL.set(tabId, el.scrollTop)
  }, [tabId, activeKey])
  const onScroll = useCallback(() => {
    if (ref.current) SIDEBAR_SCROLL.set(tabId, ref.current.scrollTop)
  }, [tabId])
  return { ref, onScroll }
}

/** Atalhos globais: ⌘K / Ctrl+K busca, ⌘I / Ctrl+I assistente. */
function useHelpShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        const s = useHelpUi.getState()
        s.setSearchOpen(!s.searchOpen)
      } else if (k === 'i') {
        e.preventDefault()
        const s = useHelpUi.getState()
        if (s.askOpen) s.setAskOpen(false)
        else s.openAsk()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function LanguageMenu({ compact }: { compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-zinc-950 hover:bg-zinc-50', compact && 'font-normal')}>
          {compact && <Languages className="size-4" />}
          Português (Brasil)
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Idioma da central</DropdownMenuLabel>
        {LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.code} onSelect={() => (l.code === 'pt-BR' ? undefined : languageNotice(l.label))} className="justify-between">
            {l.label}
            {l.code === 'pt-BR' && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HelpHeader({ activeTab, activeKey, onOpenNav, showActiveTab }: { activeTab: HelpTabId; activeKey?: string; onOpenNav: () => void; showActiveTab: boolean }) {
  const openSearch = useHelpUi((s) => s.openSearch)
  const openAsk = useHelpUi((s) => s.openAsk)
  const openSupport = useHelpUi((s) => s.openSupport)
  const tab = HELP_TABS.find((t) => t.id === activeTab)!
  const group = activeKey ? tab.groups.find((g) => g.items.includes(activeKey)) : undefined
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-2 px-4 lg:px-10">
        <Link to="/ajuda" aria-label="Central de ajuda da Kloel — início" className="flex shrink-0 items-center lg:mr-2 xl:mr-0 xl:w-[252px]">
          <KloelLogo className="text-[23px]" />
        </Link>
        {/* busca e assistente (desktop) */}
        <button
          type="button"
          onClick={openSearch}
          className="hidden h-9 w-[320px] min-w-[150px] shrink items-center gap-2 whitespace-nowrap rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 text-left text-sm text-zinc-500 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:border-zinc-300 md:flex"
        >
          <Search className="size-4 text-zinc-500" />
          <span>Buscar…</span>
          <KbdHint>{MOD}K</KbdHint>
        </button>
        <button
          type="button"
          onClick={() => openAsk()}
          className="hidden h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 text-sm text-zinc-500 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:border-zinc-300 md:flex"
        >
          <Sparkles className="size-4 text-brand" />
          <span>Perguntar ao assistente</span>
          <KbdHint>{MOD}I</KbdHint>
        </button>
        <div className="flex-1" />
        <div className="hidden shrink-0 items-center gap-3 whitespace-nowrap lg:flex">
          <button type="button" onClick={() => openSupport()} className="inline-flex h-9 items-center rounded-lg px-2 text-sm font-medium text-zinc-950 hover:bg-zinc-50">
            Suporte
          </button>
          <LanguageMenu />
          <Link to="/app" className="ml-2 inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-950 pl-3 pr-3 text-sm font-medium text-white transition-colors hover:bg-slate-800">
            Abrir app
            <ChevronRight className="size-4" />
          </Link>
        </div>
        {/* ações compactas (tablet/celular) */}
        <div className="flex items-center gap-0.5 lg:hidden">
          <button type="button" aria-label="Buscar" onClick={openSearch} className="flex size-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 md:hidden">
            <Search className="size-[18px]" />
          </button>
          <button type="button" aria-label="Perguntar ao assistente" onClick={() => openAsk()} className="flex size-9 items-center justify-center rounded-lg text-brand hover:bg-zinc-100 md:hidden">
            <Sparkles className="size-[18px]" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Mais opções" className="flex size-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100">
                <Ellipsis className="size-[18px]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => openSupport()}>
                <LifeBuoy className="size-4" /> Suporte
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Idioma</DropdownMenuLabel>
              {LANGUAGES.map((l) => (
                <DropdownMenuItem key={l.code} onSelect={() => (l.code === 'pt-BR' ? undefined : languageNotice(l.label))} className="justify-between">
                  {l.label}
                  {l.code === 'pt-BR' && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/app" className="justify-between font-medium">
                  Abrir app <ChevronRight className="size-4" />
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* abas de seção (desktop) */}
      <nav aria-label="Seções da central" className="mx-auto hidden h-12 max-w-[90rem] items-stretch gap-8 px-4 lg:flex lg:pl-[44px] lg:pr-10">
        {HELP_TABS.map((t) => {
          const Icon = TAB_ICONS[t.icon]
          const active = showActiveTab && t.id === activeTab
          return (
            <Link
              key={t.id}
              to={articleHref(firstArticleOfTab(t))}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group/tab relative flex items-center gap-2 text-sm transition-colors',
                active ? 'font-medium text-zinc-900' : 'text-zinc-600 hover:text-zinc-900',
              )}
            >
              <Icon className={cn('size-4', !active && 'text-zinc-500 group-hover/tab:text-zinc-900')} />
              {t.label}
              {active && <span className="absolute inset-x-0 -bottom-px h-[1.5px] rounded-full bg-zinc-900" />}
            </Link>
          )
        })}
      </nav>
      {/* barra de navegação (celular/tablet) */}
      <button type="button" onClick={onOpenNav} className="flex h-11 w-full items-center gap-2 border-t border-zinc-100 px-4 text-left text-sm text-zinc-600 lg:hidden" aria-label="Abrir navegação">
        <Menu className="size-4 shrink-0 text-zinc-500" />
        <span className="shrink-0">{tab.label}</span>
        {group && (
          <>
            <ChevronRight className="size-3.5 shrink-0 text-zinc-400" />
            <span className="truncate font-medium text-zinc-900">{activeKey ? sidebarLabel(activeKey) : group.label}</span>
          </>
        )}
      </button>
    </header>
  )
}

function MobileNav({ open, onOpenChange, activeTab, activeKey }: { open: boolean; onOpenChange: (o: boolean) => void; activeTab: HelpTabId; activeKey?: string }) {
  const [tabId, setTabId] = useState<HelpTabId>(activeTab)
  useEffect(() => {
    if (open) setTabId(activeTab)
  }, [open, activeTab])
  const tab = HELP_TABS.find((t) => t.id === tabId) as HelpTab
  // ao abrir a gaveta, o item ativo aparece centralizado (árvores longas de Integrações/Parceiros)
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    if (node) requestAnimationFrame(() => revealActive(node, 24))
  }, [])
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-[86vw] max-w-[340px] flex-col gap-0 p-0">
        <SheetTitle className="sr-only">Navegação da central de ajuda</SheetTitle>
        <div className="flex h-14 shrink-0 items-center border-b px-5">
          <KloelLogo size="sm" />
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-4" data-help-drawer-scroll>
          <div className="mb-6 space-y-0.5 px-1">
            {HELP_TABS.map((t) => {
              const Icon = TAB_ICONS[t.icon]
              const active = t.id === tabId
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTabId(t.id)}
                  aria-pressed={active}
                  className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm', active ? 'bg-brand/10 font-medium text-brand' : 'text-zinc-700 hover:bg-zinc-50')}
                >
                  <span className={cn('flex size-6 items-center justify-center rounded-md border', active ? 'border-brand/30 bg-white' : 'border-zinc-200')}>
                    <Icon className="size-3.5" />
                  </span>
                  {t.label}
                </button>
              )
            })}
          </div>
          <HelpSidebar tab={tab} activeKey={activeKey} onNavigate={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function HelpLayout({
  activeTab,
  activeKey,
  children,
  showSidebar = true,
  showActiveTab = true,
}: {
  activeTab: HelpTabId
  activeKey?: string
  children: ReactNode
  showSidebar?: boolean
  /** na home da central nenhuma aba aparece ativa (referência [218]) */
  showActiveTab?: boolean
}) {
  useHelpShortcuts()
  const [navOpen, setNavOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setNavOpen(false), [loc.pathname])
  const tab = HELP_TABS.find((t) => t.id === activeTab)!
  const askOpen = useHelpUi((s) => s.askOpen)
  const sidebar = useSidebarScroll(tab.id, activeKey)
  return (
    <div className="group/help min-h-svh bg-white font-sans text-[#09090b] antialiased" data-help-root data-ask={askOpen ? 'open' : 'closed'}>
      <HelpHeader activeTab={activeTab} activeKey={activeKey} onOpenNav={() => setNavOpen(true)} showActiveTab={showActiveTab} />
      <div className="mx-auto flex max-w-[90rem] transition-[padding] duration-300 ease-out lg:group-data-[ask=open]/help:pr-[420px]">
        {showSidebar && (
          <aside ref={sidebar.ref} onScroll={sidebar.onScroll} className="sticky top-[113px] hidden h-[calc(100svh-113px)] w-[18rem] shrink-0 overflow-y-auto pl-[32px] pr-3 pt-9 lg:block" aria-label="Navegação lateral">
            <HelpSidebar tab={tab} activeKey={activeKey} />
          </aside>
        )}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <MobileNav open={navOpen} onOpenChange={setNavOpen} activeTab={activeTab} activeKey={activeKey} />
      <SearchDialog />
      <AskPanel />
      <SupportDialog />
    </div>
  )
}
