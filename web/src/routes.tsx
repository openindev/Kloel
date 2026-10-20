import { Suspense, isValidElement, lazy, type ComponentType, type ReactNode } from 'react'
import { Navigate, createBrowserRouter, useLocation, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { PageSkeleton } from './components/app/PageLoad'
import { RootLayout } from './RootLayout'
import { SiteLayout } from './site/layout/SiteLayout'
import { AppShell, RequireAuth } from './app/layout/AppShell'
import NotFoundPage from './NotFoundPage'
import { useStore } from './data/store'
import { orgByReferralCode } from './app/pages/billing/referral'

import HomePage from './site/pages/home/HomePage'
import WhatsAppProductPage from './site/pages/products/WhatsAppProductPage'
import WebchatProductPage from './site/pages/products/WebchatProductPage'
import WebchatCreatePage from './site/pages/products/WebchatCreatePage'
import WebchatDemoPage from './site/pages/products/WebchatDemoPage'
import ComingSoonPage from './site/pages/products/ComingSoonPage'
import SolutionPage from './site/pages/solutions/SolutionPage'
import CampaignLandingPage from './site/pages/landing/CampaignLandingPage'
import PricingPage from './site/pages/pricing/PricingPage'
import DemoBookingPage from './site/pages/demo/DemoBookingPage'
import SignupPage from './site/pages/auth/SignupPage'
import LoginPage from './site/pages/auth/LoginPage'
import ForgotPasswordPage from './site/pages/auth/ForgotPasswordPage'
import PartnersPage from './site/pages/partners/PartnersPage'
import PartnerBookingPage from './site/pages/partners/PartnerBookingPage'
import ContactPage from './site/pages/company/ContactPage'
import CareersPage from './site/pages/company/CareersPage'
import PressPage from './site/pages/company/PressPage'
import CustomerStoriesPage from './site/pages/company/CustomerStoriesPage'
import WebinarsPage from './site/pages/resources/WebinarsPage'
import IntegrationsDirectoryPage from './site/pages/resources/IntegrationsDirectoryPage'
import ReferralLandingPage from './site/pages/resources/ReferralLandingPage'
import BookingPublicPage from './app/pages/scheduling/BookingPublicPage'

/*
 * Divisão de código por rota: o site público acima (inclusive /lp e a reserva pública /c/**) vai no bundle inicial; o app logado
 * (/app/**, destino dos atalhos legados) e a Central de ajuda (/ajuda/**, 100+ artigos) viram chunks baixados só quando a rota abre.
 * tests/routes-code-splitting.test.ts falha se um import estático trouxer essas páginas de volta ao bundle inicial.
 */
type PageModule<P> = Promise<{ default: ComponentType<P> }>
const CHUNK_RELOAD = 'kloel:chunk-reload'

/**
 * Página sob demanda com o próprio <Suspense> (a tabela de rotas mantém os mesmos elementos) e `preload` para o download começar
 * quando a rota casa. Um deploy remove os chunks antigos: se o import falhar, recarrega uma vez (index.html novo) em vez de exibir erro.
 */
function lazyPage<P extends object>(load: () => PageModule<P>, fallback: ReactNode) {
  let pending: PageModule<P> | undefined
  const preload = () => (pending ??= load().catch((e: unknown): PageModule<P> => {
    pending = undefined
    let last = 0
    try { last = Number(sessionStorage.getItem(CHUNK_RELOAD)) || 0; sessionStorage.setItem(CHUNK_RELOAD, String(Date.now())) } catch { last = Date.now() }
    if (Date.now() - last < 30_000) throw e
    window.location.reload()
    return new Promise(() => {})
  }))
  const Page = lazy(preload) as unknown as ComponentType<P>
  return Object.assign((props: P) => <Suspense fallback={fallback}><Page {...props} /></Suspense>, { preload })
}
/** Dentro da casca do app: o mesmo PageSkeleton que as páginas mostram enquanto os dados carregam (ex.: Visão geral). */
const appPage = <P extends object>(load: () => PageModule<P>) => lazyPage(load, (
  <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8"><div className="mx-auto w-full max-w-[1200px]"><PageSkeleton rows={6} /></div></div>
))
/** Tela cheia (fora da casca, ajuda): o mesmo indicador de carregamento do ConnectedSession. */
const screenPage = <P extends object>(load: () => PageModule<P>) => lazyPage(load, (
  <div data-engine-state="loading" role="status" aria-label="Carregando" className="flex min-h-[50vh] items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
))

const HelpHomePage = screenPage(() => import('./help/pages/HelpHomePage'))
const HelpArticlePage = screenPage(() => import('./help/pages/HelpArticlePage'))

const OverviewPage = appPage(() => import('./app/pages/overview/OverviewPage'))
const AgentsIndexPage = appPage(() => import('./app/pages/agents/AgentsIndexPage'))
const AgentPage = appPage(() => import('./app/pages/agents/AgentPage'))
const InboxPage = appPage(() => import('./app/pages/inbox/InboxPage'))
const PhoneNumbersPage = appPage(() => import('./app/pages/phone-numbers/PhoneNumbersPage'))
const WhatsAppPage = appPage(() => import('./app/pages/whatsapp/WhatsAppPage'))
const SchedulingPage = appPage(() => import('./app/pages/scheduling/SchedulingPage'))
const EmailAgentsPage = appPage(() => import('./app/pages/email-agents/EmailAgentsPage'))
const ContactsPage = appPage(() => import('./app/pages/contacts/ContactsPage'))
const IntegrationsPage = appPage(() => import('./app/pages/integrations/IntegrationsPage'))
const BillingPage = appPage(() => import('./app/pages/billing/BillingPage'))
const FreeCreditsPage = appPage(() => import('./app/pages/free-credits/FreeCreditsPage'))
const ApiKeysPage = appPage(() => import('./app/pages/api-keys/ApiKeysPage'))
const CompanySettingsPage = appPage(() => import('./app/pages/company-settings/CompanySettingsPage'))
const UsersPage = appPage(() => import('./app/pages/users/UsersPage'))
const AccountPage = appPage(() => import('./app/pages/account/AccountPage'))
const BillingPortalPage = screenPage(() => import('./app/pages/billing/BillingPortalPage'))
const IdentityVerificationPage = screenPage(() => import('./app/pages/billing/IdentityVerificationPage'))
const ChangePlanPage = screenPage(() => import('./app/pages/billing/ChangePlanPage'))
const AddProductPage = screenPage(() => import('./app/pages/billing/AddProductPage'))
const CheckoutPage = screenPage(() => import('./app/pages/billing/CheckoutPage'))
const OnboardingPage = screenPage(() => import('./app/pages/onboarding/OnboardingPage'))

// Páginas carregadas sob demanda (módulos novos: um erro de compilação neles não derruba as demais rotas).
const HostedWebchatPage = lazy(() => import('./app/pages/whatsapp/webchat/HostedWebchatPage'))
const TasksPage = appPage(() => import('./app/pages/tasks/TasksPage'))

/** Baixa o código das páginas sob demanda da rota que casou já na navegação, em paralelo com a sessão/dados que o RequireAuth espera. */
function preloadIn(node: ReactNode): void {
  if (Array.isArray(node)) { node.forEach(preloadIn); return }
  if (!isValidElement(node)) return
  ;(node.type as { preload?: () => Promise<unknown> }).preload?.().catch(() => {})
  preloadIn((node.props as { children?: ReactNode }).children)
}

/** Fundo neutro enquanto o código de uma página sob demanda carrega (sem texto: dura só alguns milissegundos). */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-svh w-full bg-background" aria-busy="true" />}>{children}</Suspense>
}

/**
 * /register?ref=<código> (formato do link "Indique um amigo" da Fonio): resolve o código (UUID de referralCodeOf ou slug) para a
 * organização que indicou e segue para o cadastro /criar-conta?ref=<slug>, que registra a indicação. Demais parâmetros são mantidos.
 */
function RegisterRedirect() {
  const loc = useLocation()
  const orgs = useStore((s) => s.db.organizations)
  const params = new URLSearchParams(loc.search)
  const code = params.get('ref')
  if (code) {
    const org = orgByReferralCode(orgs, code)
    params.set('ref', org ? org.slug : code)
  }
  const qs = params.toString()
  return <Navigate to={`/criar-conta${qs ? `?${qs}` : ''}`} replace />
}

function LegacyAppRedirect() {
  const params = useParams()
  return <Navigate to={`/app/${params['*'] ?? ''}`} replace />
}

/**
 * Mapa de rotas.
 * - Site público na raiz (/). Aplicativo autenticado sob /app (a "/" da Fonio vira "/app").
 * - Rotas internas da Fonio mapeadas: /agents → /app/agents, /inbox → /app/inbox, /tasks → /app/tasks, /phone-numbers → /app/phone-numbers,
 *   /whatsapp → /app/whatsapp, /scheduling → /app/scheduling, /email-agents → /app/email-agents, /contacts → /app/contacts,
 *   /integrations → /app/integrations, /billing → /app/billing (+ /free-credits, /api-keys, /company-settings, /users, /account,
 *   /change-plan/:x, /add-product).
 * - Públicas sem login: /c/:org[/:evento] (página de reserva) e /w/:org/:assistente[/:sessão] (chatbot hospedado).
 */
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: <SiteLayout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/produtos/assistente-telefonico-ia', element: <HomePage /> },
          { path: '/produtos/ia-whatsapp', element: <WhatsAppProductPage /> },
          { path: '/produtos/webchat-ia', element: <WebchatProductPage /> },
          { path: '/produtos/assistente-email-ia', element: <ComingSoonPage /> },
          { path: '/produtos/central-telefonica-ia', element: <ComingSoonPage /> },
          { path: '/solucoes/:slug', element: <SolutionPage /> },
          { path: '/planos', element: <PricingPage /> },
          { path: '/parceiros', element: <PartnersPage /> },
          { path: '/contato', element: <ContactPage /> },
          { path: '/carreiras', element: <CareersPage /> },
          { path: '/imprensa', element: <PressPage /> },
          { path: '/casos-de-sucesso', element: <CustomerStoriesPage /> },
          { path: '/webinars', element: <WebinarsPage /> },
          { path: '/integracoes', element: <IntegrationsDirectoryPage /> },
        ],
      },
      // Páginas públicas com layout próprio (sem header/footer completos)
      { path: '/webchat/criar', element: <WebchatCreatePage /> },
      { path: '/demo-ia', element: <WebchatDemoPage /> },
      { path: '/lp', element: <CampaignLandingPage /> },
      { path: '/agendar-demo', element: <DemoBookingPage /> },
      { path: '/parceiros/agendar', element: <PartnerBookingPage /> },
      { path: '/criar-conta', element: <SignupPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/accept-invite', element: <LoginPage invitation /> },
      { path: '/recuperar-senha', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ForgotPasswordPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/r/:code', element: <ReferralLandingPage /> },
      // Link de indicação no formato da Fonio (A-sidebar/10): /register?ref=<uuid> → cadastro com a indicação aplicada.
      { path: '/register', element: <RegisterRedirect /> },
      { path: '/signup', element: <RegisterRedirect /> },
      { path: '/c/:orgSlug', element: <BookingPublicPage /> },
      { path: '/c/:orgSlug/:eventSlug', element: <BookingPublicPage /> },
      // Chatbot hospedado (link público do Webchat, central de ajuda WC-13): sem login.
      { path: '/w/:orgSlug/:assistantSlug', element: <Lazy><HostedWebchatPage /></Lazy> },
      { path: '/w/:orgSlug/:assistantSlug/:sessionId', element: <Lazy><HostedWebchatPage /></Lazy> },

      // Central de ajuda (layout próprio)
      { path: '/ajuda', element: <HelpHomePage /> },
      { path: '/ajuda/:section', element: <HelpArticlePage /> },
      { path: '/ajuda/:section/:slug', element: <HelpArticlePage /> },

      // Aplicativo
      { path: '/app/onboarding', element: <RequireAuth allowOnboarding><OnboardingPage /></RequireAuth> },
      { path: '/app/change-plan/:product', element: <RequireAuth><ChangePlanPage /></RequireAuth> },
      { path: '/app/add-product', element: <RequireAuth><AddProductPage /></RequireAuth> },
      { path: '/app/add-product/:product', element: <RequireAuth><AddProductPage /></RequireAuth> },
      { path: '/app/checkout', element: <RequireAuth allowOnboarding><CheckoutPage /></RequireAuth> },
      { path: '/app/billing/portal', element: <RequireAuth><BillingPortalPage /></RequireAuth> },
      { path: '/app/billing/identity', element: <RequireAuth><IdentityVerificationPage /></RequireAuth> },
      {
        path: '/app',
        element: <RequireAuth><AppShell /></RequireAuth>,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'agents', element: <AgentsIndexPage /> },
          { path: 'agents/:agentId', element: <AgentPage /> },
          { path: 'agents/:agentId/:tab', element: <AgentPage /> },
          { path: 'inbox', element: <InboxPage /> },
          { path: 'inbox/:conversationId', element: <InboxPage /> },
          // Tarefas (BETA, central de ajuda products/tasks TK-V01…): item da barra lateral só com org.betaFeatures.tasks.
          { path: 'tasks', element: <Lazy><TasksPage /></Lazy> },
          { path: 'tasks/:taskId', element: <Lazy><TasksPage /></Lazy> },
          { path: 'phone-numbers', element: <PhoneNumbersPage /> },
          { path: 'whatsapp', element: <WhatsAppPage /> },
          { path: 'scheduling', element: <SchedulingPage /> },
          { path: 'scheduling/:eventTypeId', element: <SchedulingPage /> },
          { path: 'scheduling/:eventTypeId/:tab', element: <SchedulingPage /> },
          { path: 'email-agents', element: <EmailAgentsPage /> },
          { path: 'email-agents/:inboxId', element: <EmailAgentsPage /> },
          { path: 'email-agents/:inboxId/:view', element: <EmailAgentsPage /> },
          { path: 'contacts', element: <ContactsPage /> },
          { path: 'contacts/:contactId', element: <ContactsPage /> },
          { path: 'integrations', element: <IntegrationsPage /> },
          // Campanhas outbound não existe no original (Problemas/2. Internos/3. Mais): rota antiga volta à visão geral.
          { path: 'campaigns', element: <Navigate to="/app" replace /> },
          { path: 'billing', element: <BillingPage /> },
          { path: 'free-credits', element: <FreeCreditsPage /> },
          { path: 'api-keys', element: <ApiKeysPage /> },
          { path: 'company-settings', element: <CompanySettingsPage /> },
          { path: 'users', element: <UsersPage /> },
          { path: 'account', element: <AccountPage /> },
        ],
      },
      // Atalhos com as rotas originais da Fonio (sem prefixo /app)
      ...['agents', 'inbox', 'tasks', 'phone-numbers', 'whatsapp', 'scheduling', 'email-agents', 'contacts', 'integrations', 'campaigns', 'billing', 'free-credits', 'api-keys', 'company-settings', 'users', 'account', 'change-plan', 'add-product', 'checkout', 'onboarding'].map((p) => ({
        path: `/${p}/*`,
        element: <LegacyAppRedirectFor prefix={p} />,
      })),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
], {
  // Comportamentos da v7 adotados já (silencia os avisos "React Router Future Flag" do console).
  // Nenhuma rota usa loaders/actions/fetchers; as únicas rotas splat (/agents/* …) redirecionam com caminhos absolutos.
  // O sinalizador de renderização v7_startTransition pertence ao <RouterProvider future={...}> de src/main.tsx.
  future: {
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
})

const preloadMatches = ({ matches }: { matches: { route: object }[] }) => matches.forEach((m) => preloadIn((m.route as { element?: ReactNode }).element))
preloadMatches(router.state)
router.subscribe(preloadMatches)

/** Sinalizadores de renderização do roteador para o <RouterProvider future={routerRenderFuture}> (src/main.tsx). */
export const routerRenderFuture = { v7_startTransition: true } as const

function LegacyAppRedirectFor({ prefix }: { prefix: string }) {
  const params = useParams()
  const loc = useLocation()
  const rest = params['*'] ? `/${params['*']}` : ''
  // preserva query string e âncora (ex.: /inbox?id=… da Fonio)
  return <Navigate to={`/app/${prefix}${rest}${loc.search}${loc.hash}`} replace />
}
export { LegacyAppRedirect }
