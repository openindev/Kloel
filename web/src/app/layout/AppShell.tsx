import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom'
import {
  House, UserRoundPen, MessageCircle, Menu, ChevronsLeft, ChevronsRight, Gift, Copy, ChevronDown, CreditCard, PartyPopper, KeyRound, Settings,
  Users, User, FileText, BadgeInfo, LogOut, Check, LibraryBig,
} from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-a'
import '@/domain/ext/tasks'
import { cn, initials } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { BetaBadge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useStore, useCurrentOrg, useCurrentUser, useUi, useCollection } from '@/data/store'
import { logout } from '@/lib/auth'
import { ConnectedSession } from '@/components/app/ConnectedSession'
import { referralLinkOf } from '@/app/pages/billing/referral'

/*
 * Casca do app — sidebar shadcn "collapsible=icon" igual à conta Fonio ao vivo (docs/reference/fonio-live2/A-sidebar/01–10):
 * largura 260px / 62px recolhida; cabeçalho com logo + "Recolher barra lateral"; navegação dentro de uma ScrollArea Radix
 * (a 1355×661 "Campanhas outbound" e "Central de ajuda" ficam abaixo da dobra até rolar; barra fina ao rolar/hover);
 * grupo "Mais" recolhível (estado lembrado) — na barra recolhida vira DropdownMenu à direita; rodapé com "Indique um amigo"
 * e o menu da organização (Admin · Conta, sem separadores). Em < md vira cabeçalho fixo (h-14) + Sheet com a mesma navegação.
 */

const MENU_BTN =
  'peer/menu-button flex w-full items-center overflow-hidden rounded-md p-2 text-left outline-none ring-ring transition-[width,height,padding] focus-visible:ring-2 active:bg-accent active:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-accent data-[active=true]:font-medium data-[active=true]:text-accent-foreground data-[state=open]:hover:bg-accent data-[state=open]:hover:text-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 hover:bg-accent hover:text-accent-foreground text-sm h-auto gap-2 px-3 py-2.5 group-data-[collapsible=icon]:!w-fit group-data-[collapsible=icon]:!mx-0'
const SUB_BTN =
  'flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md p-2 text-foreground outline-none ring-ring hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 active:bg-accent active:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground text-sm group-data-[collapsible=icon]:hidden'
/** Item do DropdownMenu "Mais" da barra recolhida (A-sidebar/07: px-2 py-1.5 text-sm, sem ícones). */
const MAIS_MENU_ITEM = 'px-2 py-1.5 text-sm'

export const MAIS_ITEMS = [
  { to: '/app/phone-numbers', label: 'Números de telefone' },
  { to: '/app/whatsapp', label: 'WhatsApp' },
  { to: '/app/scheduling', label: 'Agendador' },
  { to: '/app/email-agents', label: 'E-Mail IA', beta: true },
  { to: '/app/contacts', label: 'Contatos' },
  { to: '/app/integrations', label: 'Integrações' },
]
const CAMPAIGNS_ROUTE = '/app/campaigns'
/** "Mudar de plano aqui" (A-sidebar/03): a Fonio abre /change-plan/sub-solo (alias aceito por ChangePlanPage). */
const CAMPAIGNS_UPGRADE_ROUTE = '/app/change-plan/sub-solo'
const HELP_CENTER_URL = '/ajuda'
/** Rotas filhas do grupo "Mais" (subitens + Campanhas outbound). */
const MAIS_ROUTES = [...MAIS_ITEMS.map((it) => it.to), CAMPAIGNS_ROUTE]

/** Caminho sem barra final ("/app/" → "/app"), para comparar rotas abertas por URL direta. */
const normPath = (p: string) => p.replace(/\/+$/, '') || '/'
/** true quando `path` é a rota `base` ou uma sub-rota dela (sem casar prefixos parciais como /app/agents-x). */
const underRoute = (path: string, base: string) => path === base || path.startsWith(base + '/')

/**
 * Variante pré-pagamento (ref. [441]–[448]): durante o primeiro acesso, antes da primeira assinatura, a navegação
 * mostra "Conhecimento", o grupo "Mais" começa recolhido e o cartão de indicação não aparece.
 * Uma organização que já concluiu o primeiro acesso mantém a casca completa mesmo sem assinatura ativa
 * (para continuar alcançando Assinatura e faturamento, Usuários e Sair).
 */
export function usePrePayment() {
  const subs = useCollection('subscriptions')
  const org = useCurrentOrg()
  return !org?.onboardingCompleted && !subs.some((s) => s.status === 'active')
}

/**
 * Tarefas (BETA): o item só aparece quando a organização ativou o recurso (`betaFeatures.tasks`, declarado em
 * src/domain/ext/tasks.ts). Padrão desligado — a conta Fonio ao vivo não mostra "Tarefas".
 */
export function useTasksBeta() {
  const org = useCurrentOrg()
  return org?.betaFeatures?.tasks === true
}

function useCampaignsUnlocked() {
  const subs = useCollection('subscriptions')
  return subs.some((s) => s.product === 'voice' && s.status === 'active' && (s.plan === 'team' || s.plan === 'scale'))
}

/** Copia para a área de transferência; retorna false quando o navegador não permite (sem anunciar sucesso falso). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* tenta o método alternativo abaixo */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function openHelpCenter() {
  window.open(HELP_CENTER_URL, '_blank', 'noopener,noreferrer')
}

function CollapsedTooltip({ collapsed, label, children }: { collapsed: boolean; label: ReactNode; children: ReactNode }) {
  if (!collapsed) return <>{children}</>
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function NavItem({ to, icon, label, end, collapsed, onNavigate, forceActive, neverActive, badge }: { to: string; icon: ReactNode; label: string; end?: boolean; collapsed: boolean; onNavigate?: () => void; forceActive?: boolean; neverActive?: boolean; badge?: ReactNode }) {
  const loc = useLocation()
  const path = normPath(loc.pathname)
  const active = !neverActive && (forceActive || (end ? path === to : underRoute(path, to)))
  return (
    <li className="group/menu-item relative">
      <CollapsedTooltip collapsed={collapsed} label={label}>
        <Link
          to={to}
          data-active={active}
          aria-current={active ? 'page' : undefined}
          aria-label={collapsed ? label : undefined}
          className={cn(MENU_BTN, collapsed && 'mx-auto justify-center')}
          onClick={onNavigate}
        >
          <span className="relative my-0.5 flex size-4 shrink-0 items-center justify-center">{icon}</span>
          <span className="contents group-data-[collapsible=icon]:hidden">
            <span className="truncate">{label}</span>
            {badge && !collapsed && badge}
          </span>
        </Link>
      </CollapsedTooltip>
    </li>
  )
}

/** Aviso de "Campanhas outbound" bloqueado (A-sidebar/03): "Disponível a partir do plano Voice Team. Mudar de plano aqui". */
function PlanUpgradeHint({ onGo }: { onGo: () => void }) {
  return (
    <>
      Disponível a partir do plano Voice Team.{' '}
      <a
        href={CAMPAIGNS_UPGRADE_ROUTE}
        className="rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/70"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          onGo()
        }}
      >
        Mudar de plano aqui
      </a>
    </>
  )
}

/** Classes do popover escuro de Campanhas outbound (Fonio: px-3 py-1.5 text-xs bg-primary z-[60] w-fit max-w-xs border-0). */
const UPGRADE_POPOVER = 'z-[60] w-fit max-w-xs rounded-md border-0 bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md'

/**
 * "Campanhas outbound" bloqueado pelo plano (submenu Mais expandido): passar o mouse/focar mostra o aviso escuro à direita
 * (Fonio: Popover aberto no hover, w-fit max-w-xs). Clique, toque ou Enter/Espaço abre o mesmo aviso como popover com foco
 * gerenciado — o foco vai para "Mudar de plano aqui" (Enter aciona; Esc fecha), então a ação também é alcançável pelo teclado.
 */
function LockedCampaignsItem({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()
  const [tipOpen, setTipOpen] = useState(false)
  const [popOpen, setPopOpen] = useState(false)
  const side = onNavigate ? 'bottom' : 'right'
  const go = () => {
    setTipOpen(false)
    setPopOpen(false)
    onNavigate?.()
    navigate(CAMPAIGNS_UPGRADE_ROUTE)
  }
  return (
    <Popover open={popOpen} onOpenChange={setPopOpen}>
      <Tooltip delayDuration={0} open={tipOpen && !popOpen} onOpenChange={setTipOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <span
              role="group"
              aria-label="Disponível a partir do plano Voice Team."
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setTipOpen(false)
                  setPopOpen(true)
                }
              }}
              className="flex w-full cursor-not-allowed rounded-md outline-none ring-ring focus-visible:ring-2 [&>*]:pointer-events-none"
            >
              <span aria-disabled="true" className={cn(SUB_BTN, 'pointer-events-none w-full opacity-50')}>
                <span className="truncate">Campanhas outbound</span>
              </span>
            </span>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={1} collisionPadding={8} arrow={false} className={UPGRADE_POPOVER}>
          <PlanUpgradeHint onGo={go} />
        </TooltipContent>
      </Tooltip>
      <PopoverContent side={side} sideOffset={1} collisionPadding={8} aria-label="Campanhas outbound indisponível no plano atual" className={UPGRADE_POPOVER}>
        <PlanUpgradeHint onGo={go} />
      </PopoverContent>
    </Popover>
  )
}

/** Barra recolhida: "Mais" abre um DropdownMenu à direita (rótulo "Mais" + 8 itens) sem expandir a barra (A-sidebar/07). */
function CollapsedMaisMenu({ inMais }: { inMais: boolean }) {
  const navigate = useNavigate()
  const unlocked = useCampaignsUnlocked()
  const [open, setOpen] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  return (
    <li className="group/menu-item relative">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <Tooltip delayDuration={100} open={tipOpen && !open} onOpenChange={setTipOpen}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Mais" data-active={inMais} className={cn(MENU_BTN, '[&>svg]:my-0.5 mx-auto justify-center')}>
                <Menu />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Mais</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" className="min-w-44">
          <DropdownMenuLabel className="pb-0.5">Mais</DropdownMenuLabel>
          {MAIS_ITEMS.map((it) => (
            <DropdownMenuItem key={it.to} asChild className={cn(MAIS_MENU_ITEM, it.beta && 'gap-0')}>
              <Link to={it.to}>
                {it.label}
                {it.beta && <BetaBadge />}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const loc = useLocation()
  const unlocked = useCampaignsUnlocked()
  const prePayment = usePrePayment()
  const agents = useCollection('agents')
  const ui = useUi()
  const setUi = useStore((s) => s.setUi)
  // O grupo "Mais" começa recolhido no primeiro acesso ([441]–[448]) e logo após o pagamento ([453], [462], [464]).
  // Depois, abrir/recolher grava ui.sidebarMoreOpen — o estado lembrado (a conta Fonio ao vivo mostra o grupo aberto).
  const [preOpen, setPreOpen] = useState(false)
  // Numa rota filha de "Mais" o grupo aparece aberto com o subitem destacado. Abrir/recolher ali vale só enquanto se está
  // naquele subitem: não grava ui.sidebarMoreOpen, que continua valendo para as demais rotas.
  const [childOpen, setChildOpen] = useState<{ route: string; open: boolean } | null>(null)
  const path = normPath(loc.pathname)
  const tasksBeta = useTasksBeta()
  const mirrorOrgRef = useCurrentOrg()
  // Configuração do primeiro acesso depois do pagamento ([453]–[458]): "Assistentes" ativo e "Mais" recolhido (estado local).
  const onboardingSetup = path === '/app/onboarding' && !prePayment
  const localMais = prePayment || onboardingSetup
  // "Mais" também fica ativo (bg-accent) quando a rota atual é um subitem — inclusive recolhido ou no modo de ícones.
  const maisRoute = MAIS_ROUTES.find((r) => underRoute(path, r))
  const inMais = !!maisRoute
  const [prevMaisRoute, setPrevMaisRoute] = useState(maisRoute)
  if (prevMaisRoute !== maisRoute) {
    setPrevMaisRoute(maisRoute)
    setChildOpen(null)
  }
  const childOverride = maisRoute && childOpen?.route === maisRoute ? childOpen.open : undefined
  const mirrorOrg = !!mirrorOrgRef?.mirrorSeedVersion
  const maisOpen = localMais ? preOpen : maisRoute ? childOverride ?? true : ui.sidebarMoreOpen ?? mirrorOrg
  const setMaisOpen = (open: boolean) => {
    if (localMais) setPreOpen(open)
    else if (maisRoute) setChildOpen({ route: maisRoute, open })
    else setUi({ sidebarMoreOpen: open })
  }
  return (
    <ul className="flex w-full min-w-0 flex-col gap-1 px-0.5">
      <NavItem to="/app" end icon={<House className="size-4" />} label="Visão geral" collapsed={collapsed} onNavigate={onNavigate} />
      <NavItem to="/app/agents" icon={<UserRoundPen className="size-4" />} label="Assistentes" collapsed={collapsed} onNavigate={onNavigate} forceActive={onboardingSetup} />
      <NavItem to="/app/inbox" icon={<MessageCircle className="size-4" />} label="Conversas" collapsed={collapsed} onNavigate={onNavigate} />
      {tasksBeta && (
        <NavItem to="/app/tasks" icon={<Check className="size-4" />} label="Tarefas" badge={<BetaBadge />} collapsed={collapsed} onNavigate={onNavigate} />
      )}
      {prePayment && (
        <NavItem
          to={agents[0] ? `/app/agents/${agents[0].id}/knowledge` : '/app/agents'}
          icon={<LibraryBig className="size-4" />}
          label="Conhecimento"
          neverActive={!agents[0]}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      )}
      {collapsed ? (
        <CollapsedMaisMenu inMais={inMais} />
      ) : (
        <Collapsible asChild open={maisOpen} onOpenChange={setMaisOpen}>
          <li className="group/menu-item relative group/collapsible">
            <CollapsibleTrigger asChild>
              <button type="button" data-active={inMais} className={cn(MENU_BTN, '[&>svg]:my-0.5')}>
                <Menu />
                <span className="group-data-[collapsible=icon]:hidden">Mais</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              <ul className="mx-3.5 ml-[19px] flex min-w-0 translate-x-px flex-col gap-1 border-l border-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden">
                {MAIS_ITEMS.map((it) => (
                  <li key={it.to}>
                    <NavLink to={it.to} data-active={underRoute(path, it.to)} className={SUB_BTN} onClick={onNavigate}>
                      <span className="truncate">{it.label}</span>
                      {it.beta && <BetaBadge />}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </li>
        </Collapsible>
      )}
    </ul>
  )
}

function ReferralButton({ collapsed }: { collapsed: boolean }) {
  const org = useCurrentOrg()
  const [manualOpen, setManualOpen] = useState(false)
  const link = referralLinkOf(org)
  const btn = (
    <button
      type="button"
      aria-label="Indique um amigo"
      onClick={async () => {
        if (!org?.referralCode) { toast.error('O link de indicação ainda não está disponível para esta organização.'); return }
        // Fonio (A-sidebar/10): copia `<origem>/register?ref=<uuid>` e mostra só o toast "Link copiado para a área de transferência".
        if (await copyText(link)) toast.success('Link copiado para a área de transferência')
        else setManualOpen(true)
      }}
      className={cn(
        'peer/menu-button flex w-full overflow-hidden rounded-md p-2 text-left outline-none ring-ring transition-[width,height,padding] focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 text-sm h-auto items-start gap-2 bg-brand px-3 py-2.5 text-white hover:bg-brand/90 hover:text-white active:bg-brand/90 active:text-white',
        collapsed && '!mx-0 !w-fit',
      )}
    >
      <Gift className="mt-0.5 size-4 shrink-0" />
      {!collapsed && (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">Indique um amigo</span>
          <span className="whitespace-normal text-xs leading-snug text-white/80">Você ganha R$ 1.800 e seu contato ganha até 50% de desconto.</span>
        </span>
      )}
      {!collapsed && <Copy className="mt-0.5 size-4 shrink-0" />}
    </button>
  )
  return (
    <>
      <CollapsedTooltip collapsed={collapsed} label="Indique um amigo">
        {btn}
      </CollapsedTooltip>
      {/* Só quando o navegador bloqueia a área de transferência: o link aparece para cópia manual. */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Indique um amigo</DialogTitle>
            <DialogDescription>Não foi possível copiar automaticamente. Selecione o link abaixo e copie.</DialogDescription>
          </DialogHeader>
          <Input readOnly value={link} aria-label="Link de indicação" onFocus={(e) => e.currentTarget.select()} autoFocus />
          <DialogFooter>
            <Button onClick={() => setManualOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Menu da organização (A-sidebar/09 · print do operador "Ficar 100% igual perfil original"): rótulos Admin e Conta, sem separadores. */
const ADMIN_LINKS: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/app/billing', label: 'Assinatura e faturamento', icon: <CreditCard className="text-muted-foreground" /> },
  { to: '/app/free-credits', label: 'Bônus grátis', icon: <PartyPopper className="text-muted-foreground" /> },
  { to: '/app/api-keys', label: 'Chaves de API', icon: <KeyRound className="text-muted-foreground" /> },
  { to: '/app/company-settings', label: 'Configurações da empresa', icon: <Settings className="text-muted-foreground" /> },
  { to: '/app/users', label: 'Usuários', icon: <Users className="text-muted-foreground" /> },
]

function OrgMenu({ collapsed, prePayment }: { collapsed: boolean; prePayment: boolean }) {
  const org = useCurrentOrg()
  const user = useCurrentUser()
  const navigate = useNavigate()
  const ini = initials(`${user?.firstName ?? ''} ${user?.lastName ?? ''}`) || initials(org?.name ?? '') || 'K'
  return (
    <DropdownMenu>
      <CollapsedTooltip collapsed={collapsed} label={org?.name}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={collapsed ? org?.name : undefined}
            className={cn(
              'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left outline-none ring-ring transition-[width,height,padding] focus-visible:ring-2 active:bg-accent active:text-accent-foreground hover:bg-accent hover:text-accent-foreground h-12 text-sm data-[state=open]:bg-accent px-3 border border-transparent',
              collapsed && '!p-0 justify-center',
            )}
          >
            <span className="relative flex h-7 w-7 shrink-0 overflow-hidden rounded-full">
              <span className="flex h-full w-full items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{ini}</span>
            </span>
            {!collapsed && <span className="flex-1 truncate text-left text-sm font-medium">{org?.name}</span>}
            {!collapsed && <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" />}
          </button>
        </DropdownMenuTrigger>
      </CollapsedTooltip>
      <DropdownMenuContent side={collapsed ? 'right' : 'top'} align={collapsed ? 'end' : 'start'} className="w-[max(14rem,var(--radix-dropdown-menu-trigger-width))]">
        {!prePayment && (
          <>
            <DropdownMenuLabel className="pb-0.5">Admin</DropdownMenuLabel>
            {ADMIN_LINKS.map((it) => (
              <DropdownMenuItem key={it.to} asChild>
                <Link to={it.to}>
                  {it.icon}
                  {it.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuLabel className="pb-0.5">Conta</DropdownMenuLabel>
        {!prePayment && (
          <DropdownMenuItem asChild>
            <Link to="/app/account"><User className="text-muted-foreground" />Conta</Link>
          </DropdownMenuItem>
        )}
        {/* Fonio: os documentos legais abrem em nova aba — aqui, nos artigos da Central de ajuda (seção Legal). */}
        <DropdownMenuItem onSelect={() => window.open('/ajuda/legal/termos-e-condicoes', '_blank', 'noopener,noreferrer')}>
          <FileText className="text-muted-foreground" />Termos e Condições
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.open('/ajuda/legal/politica-de-privacidade', '_blank', 'noopener,noreferrer')}>
          <BadgeInfo className="text-muted-foreground" />Política de Privacidade
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void logout().then(() => navigate('/login', { replace: true }), error => toast.error(error instanceof Error ? error.message : 'Não foi possível sair.'))
          }}
        >
          <LogOut className="text-muted-foreground" />Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarBody({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const setUi = useStore((s) => s.setUi)
  const prePayment = usePrePayment()
  // Antes do pagamento a referência ([441]) não mostra "Indique um amigo"; o menu da organização continua no rodapé, em versão
  // mínima (Conta: termos, privacidade e Sair), para nunca prender o usuário no primeiro acesso sem uma forma de sair da conta.
  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="relative flex flex-col gap-2 p-2 px-0 py-6">
        {!collapsed ? (
          <Link to="/app" aria-label="kloel.ai — Início" className="flex h-7 items-center px-6" onClick={onNavigate}>
            <KloelLogo className="text-[26px]" />
          </Link>
        ) : (
          // Recolhida: só a letra inicial da marca, sem fundo (Fonio mostra só "f" — A-sidebar/05).
          <Link to="/app" aria-label="kloel.ai — Início" className="flex h-7 items-center justify-center">
            <span aria-hidden className="select-none text-[26px] font-semibold leading-none tracking-[-0.045em] text-[#0f0f14]">k</span>
          </Link>
        )}
        {!onNavigate && (
          <button
            type="button"
            aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            title={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            onClick={() => setUi({ sidebarCollapsed: !collapsed })}
            className="absolute right-0 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background text-sm font-medium shadow-sm ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:hidden"
          >
            {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden py-10">
        {/* ScrollArea Radix como na Fonio (A-sidebar/01: "relative overflow-hidden min-h-0 flex-1" > viewport "h-full w-full"). */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2">
            <nav aria-label="Navegação principal" className="relative flex w-full min-w-0 flex-col p-2">
              <SidebarNav collapsed={collapsed} onNavigate={onNavigate} />
            </nav>
          </div>
        </ScrollArea>
      </div>
      <div className="flex flex-col gap-2 p-2 py-4">
        {!prePayment && (
          <ul className="flex w-full min-w-0 flex-col gap-1">
            <li className="group/menu-item relative"><ReferralButton collapsed={collapsed} /></li>
          </ul>
        )}
        <ul className="flex w-full min-w-0 flex-col gap-1">
          <li className="group/menu-item relative"><OrgMenu collapsed={collapsed} prePayment={prePayment} /></li>
        </ul>
      </div>
    </div>
  )
}

export function AppShell() {
  const ui = useUi()
  const collapsed = ui.sidebarCollapsed
  const loc = useLocation()
  const splitLayout = /^\/app\/agents\/[^/]+/.test(loc.pathname)
  const [mobileOpen, setMobileOpen] = useState(false)
  const firstLoc = useRef(true)

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-offset', collapsed ? '62px' : '260px')
    return () => document.documentElement.style.setProperty('--sidebar-offset', '0px')
  }, [collapsed])

  // Navegar por qualquer controle (inclusive itens do menu da organização) fecha a navegação móvel.
  useEffect(() => {
    if (firstLoc.current) {
      firstLoc.current = false
      return
    }
    setMobileOpen(false)
  }, [loc.pathname, loc.search])

  // Atalho do Sidebar shadcn (Ctrl/⌘ + B) para recolher/expandir — ignorado durante a digitação.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'b' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      e.preventDefault()
      const st = useStore.getState()
      st.setUi({ sidebarCollapsed: !st.db.ui.sidebarCollapsed })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="group/sidebar-wrapper flex min-h-svh w-full" style={{ ['--sidebar-width' as string]: '260px', ['--sidebar-width-icon' as string]: '62px' }}>
      {/* Na Fonio os toasts do app ficam centralizados na área de conteúdo (A-sidebar/10: left: calc(50% + var(--sidebar-offset)/2)). */}
      <style>{`@media (min-width: 768px) { [data-sonner-toaster][data-x-position="center"] { left: calc(50% + var(--sidebar-offset, 0px) / 2); } }`}</style>
      <div className="group peer hidden text-foreground md:block" data-state={collapsed ? 'collapsed' : 'expanded'} data-collapsible={collapsed ? 'icon' : ''} data-side="left">
        <div className={cn('relative bg-transparent transition-[width] duration-200 ease-linear', collapsed ? 'w-[62px]' : 'w-[260px]')} />
        <aside
          aria-label="Barra lateral"
          className={cn('fixed inset-y-0 left-0 z-10 hidden h-svh border-r transition-[left,right,width] duration-200 ease-linear md:flex', collapsed ? 'w-[62px]' : 'w-[260px]')}
        >
          <SidebarBody collapsed={collapsed} />
        </aside>
      </div>
      {/* Páginas de assistente (/agents/:id/*): na Fonio a <main> externa é "overflow-hidden" (fonio-live2/C-assistentes/01-geral.txt);
          só a coluna de conteúdo rola e a rolagem nunca encadeia para a casca (live-compare/C-assistentes/24). Mantém flex-col: aqui a
          <main> da página é o único filho de layout (com o cabeçalho móvel acima) e estica na largura sem estourar em telas md. */}
      <main
        className={cn(
          'relative flex h-svh w-full min-w-0 flex-1 flex-col bg-background print:h-auto print:overflow-visible',
          splitLayout ? 'overflow-hidden' : 'overflow-auto',
        )}
      >
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background px-2 md:hidden">
          <button
            type="button"
            aria-label="Abrir navegação"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
            className="inline-flex size-10 shrink-0 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium text-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Menu className="size-5" />
          </button>
          <Link to="/app" aria-label="kloel.ai — Início" className="flex h-7 items-center">
            <KloelLogo className="text-[26px]" />
          </Link>
        </header>
        <Outlet />
      </main>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[18rem] max-w-[85vw] p-0 sm:max-w-[18rem]" hideClose>
          <SheetTitle className="sr-only">Navegação</SheetTitle>
          <SidebarBody collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** Protege rotas do app: exige sessão e primeiro acesso concluído. */
export function RequireAuth({ children, allowOnboarding }: { children: ReactNode; allowOnboarding?: boolean }) {
  return <ConnectedSession>{children}</ConnectedSession>
}
