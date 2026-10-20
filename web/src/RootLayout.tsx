import { useEffect } from 'react'
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { CircleCheck, CircleX, Info, TriangleAlert, Loader2 } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Toasts no padrão observado na Fonio (fonio-live2/A-sidebar/10, 2026-10-18): Sonner tema escuro, topo central da área de
 * conteúdo, fundo #171717, texto #FAFAFA, raio 12px, padding 12px (`cn-toast !p-3`), sombra 0 4px 12px rgba(0,0,0,.1),
 * largura 356px (caixa 356×42), ícone lucide `circle-check size-4` e título `!text-xs !font-semibold !leading-4`.
 */
const TITLES: [RegExp, string][] = [
  [/^\/planos/, 'Planos'], [/^\/agendar-demo/, 'Agendar demonstração'], [/^\/criar-conta/, 'Crie sua conta'], [/^\/login/, 'Entrar'],
  [/^\/recuperar-senha/, 'Recuperar senha'], [/^\/r\//, 'Convite'], [/^\/register/, 'Crie sua conta'], [/^\/c\//, 'Agendar horário'], [/^\/w\//, 'Chatbot'],
  [/^\/app\/onboarding/, 'Primeiro acesso'], [/^\/app\/agents/, 'Assistentes'], [/^\/app\/inbox/, 'Conversas'], [/^\/app\/tasks/, 'Tarefas'], [/^\/app\/phone-numbers/, 'Números de telefone'],
  [/^\/app\/whatsapp/, 'WhatsApp Business'], [/^\/app\/scheduling/, 'Agendador'], [/^\/app\/email-agents/, 'E-Mail IA'], [/^\/app\/contacts/, 'Contatos'],
  [/^\/app\/integrations/, 'Integrações'], [/^\/app\/campaigns/, 'Campanhas outbound'], [/^\/app\/billing\/portal/, 'Portal financeiro'], [/^\/app\/billing\/identity/, 'Verificação de identidade'],
  [/^\/app\/billing/, 'Assinatura e faturamento'], [/^\/app\/change-plan/, 'Alterar plano'], [/^\/app\/add-product/, 'Adicionar assinatura'], [/^\/app\/checkout/, 'Pagamento'],
  [/^\/app\/free-credits/, 'Bônus grátis'], [/^\/app\/api-keys/, 'Chaves de API'], [/^\/app\/company-settings/, 'Configurações da empresa'], [/^\/app\/users/, 'Usuários'],
  [/^\/app\/account/, 'Conta'], [/^\/app\/?$/, 'Visão geral'],
]

/** Títulos de aba para rotas que não definem o próprio título (site e ajuda definem os seus). */
function useRouteTitle() {
  const loc = useLocation()
  useEffect(() => {
    const hit = TITLES.find(([re]) => re.test(loc.pathname))
    if (hit) document.title = `${hit[1]} | Kloel AI`
  }, [loc.pathname])
}

function setHead(selector: string, create: () => HTMLElement, attr: string, value: string | null) {
  let el = document.head.querySelector<HTMLElement>(selector)
  if (value === null) { el?.remove(); return }
  if (!el) { el = create(); document.head.appendChild(el) }
  el.setAttribute(attr, value)
}
const meta = (key: 'name' | 'property', name: string) => () => { const el = document.createElement('meta'); el.setAttribute(key, name); return el }

/**
 * SEO por rota: o index.html é único, então canonical/og:url apontariam todas as páginas para a home. Cada rota declara o
 * próprio endereço (sem consulta), og:title acompanha o título da aba e as áreas logadas/transacionais ficam fora do índice.
 */
function useRouteSeo() {
  const loc = useLocation()
  useEffect(() => {
    const path = loc.pathname.length > 1 ? loc.pathname.replace(/\/+$/, '') : '/'
    const url = `${window.location.origin}${path}`
    setHead('link[rel="canonical"]', () => { const el = document.createElement('link'); el.setAttribute('rel', 'canonical'); return el }, 'href', url)
    setHead('meta[property="og:url"]', meta('property', 'og:url'), 'content', url)
    const privatePath = /^\/(app|login|criar-conta|register|recuperar-senha|reset-password|forgot-password|accept-invite|r\/|w\/)/.test(path)
    // robots com data-noindex pertence à página 404 montada (src/lib/useNoIndex.ts): não é da rota, fica com ela
    setHead('meta[name="robots"]:not([data-noindex])', meta('name', 'robots'), 'content', privatePath ? 'noindex, nofollow' : null)
    const syncTitle = () => setHead('meta[property="og:title"]', meta('property', 'og:title'), 'content', document.title)
    syncTitle()
    const title = document.head.querySelector('title')
    const observer = title ? new MutationObserver(syncTitle) : undefined
    if (title) observer!.observe(title, { childList: true, characterData: true, subtree: true })
    return () => observer?.disconnect()
  }, [loc.pathname])
}

export function RootLayout() {
  useRouteTitle()
  useRouteSeo()
  return (
    <TooltipProvider delayDuration={200}>
      <Outlet />
      <ScrollRestoration />
      <Toaster
        position="top-center"
        offset={24}
        closeButton={false}
        icons={{
          success: <CircleCheck className="h-4 w-4" />,
          error: <CircleX className="h-4 w-4" />,
          info: <Info className="h-4 w-4" />,
          warning: <TriangleAlert className="h-4 w-4" />,
          loading: <Loader2 className="h-4 w-4 animate-spin" />,
        }}
        toastOptions={{
          unstyled: false,
          classNames: {
            toast: 'cn-toast !p-3 !bg-[#171717] !text-[#fafafa] !text-[13px] !rounded-xl !border !border-zinc-200 !shadow-[0_4px_12px_rgba(0,0,0,0.1)] !w-[356px] font-sans',
            title: '!text-primary-foreground !text-xs !font-semibold !leading-4',
            icon: '!mr-0.5',
            description: '!text-[#fafafa]/70 !text-xs',
            actionButton: '!bg-white !text-[#171717] !text-xs',
            cancelButton: '!bg-white/10 !text-white !text-xs',
          },
        }}
      />
    </TooltipProvider>
  )
}
