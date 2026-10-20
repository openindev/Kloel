import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { KloelLogo } from '@/components/brand/KloelLogo'

export interface AuthQuote {
  before: string
  strong: string
  after: string
  lead?: string
  name: string
  role: string
}

/** Depoimentos ilustrativos do painel lateral (a referência [13] usa um cliente real da Fonio — substituído). */
export const AUTH_QUOTES: Record<'signup' | 'login' | 'recover', AuthQuote> = {
  signup: {
    lead: 'Com a alta demanda, nossas linhas de atendimento ficavam ocupadas com frequência, o que gerava pacientes frustrados — e às vezes perdidos.',
    before: 'A Kloel atende ',
    strong: 'todas as ligações',
    after: ' da recepção para nós — sem pacientes perdidos e sem agenda vazia.',
    name: 'Carla Menezes',
    role: 'Gestora da Clínica Bem Viver',
  },
  login: {
    lead: 'Antes, metade das ligações fora do horário caía na caixa postal.',
    before: 'Hoje a assistente da Kloel agenda ',
    strong: 'visitas 24 horas por dia',
    after: ' e a equipe começa o dia com tudo organizado.',
    name: 'Fernanda Lima',
    role: 'Diretora da Lar Novo Imóveis',
  },
  recover: {
    lead: 'Configurei o meu assistente em uma tarde, sem precisar de programador.',
    before: 'Agora ele responde ',
    strong: 'as perguntas frequentes',
    after: ' e me avisa quando alguém precisa de atenção.',
    name: 'Paulo Henrique',
    role: 'Empreendedor individual',
  },
}

/** Tela dividida 50/50 das páginas de conta (OBSERVADO em [13] "Crie sua conta"; login e recuperação seguem o mesmo layout — INFERIDO). */
export function AuthShell({ children, quote }: { children: ReactNode; quote: AuthQuote }) {
  return (
    <div className="grid min-h-svh bg-white font-sans text-foreground lg:grid-cols-2">
      {/* Medidas de [13]: logo a 26px da borda, formulário de 356px um pouco abaixo do centro, texto legal 11px. */}
      <div className="relative flex flex-col px-6 pb-8 pt-6 sm:px-[26px]">
        <Link to="/" aria-label="kloel.ai — início" className="w-fit">
          <KloelLogo className="text-[26px]" />
        </Link>
        <div className="flex flex-1 items-center justify-center pb-6 pt-10 lg:pb-10 lg:pt-[88px]">
          <div className="w-full max-w-[356px]">{children}</div>
        </div>
      </div>
      {/* [13]: citação ~16px acima do centro */}
      <aside className="relative hidden items-center bg-brand px-12 text-white lg:flex lg:pb-8 xl:px-[90px]">
        <figure className="max-w-[540px]">
          <blockquote className="flex flex-col gap-7 text-[20px] leading-7">
            {quote.lead && <p>&quot;{quote.lead}</p>}
            <p>
              {quote.before}
              <b className="font-semibold">{quote.strong}</b>
              {quote.after}&quot;
            </p>
          </blockquote>
          <figcaption className="mt-5 pl-[51px] text-[14px] leading-5">
            <div className="font-semibold">{quote.name}</div>
            <div className="text-white/90">{quote.role}</div>
          </figcaption>
        </figure>
      </aside>
    </div>
  )
}

export function LegalNote({ text = 'Ao criar uma conta, você concorda com nossos' }: { text?: string }) {
  return (
    <p className="mx-auto mt-3 max-w-[305px] text-center text-[11px] leading-5 text-muted-foreground">
      {text}{' '}
      <a href="/ajuda/legal/termos-e-condicoes" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
        Termos e condições
      </a>{' '}
      e confirma que leu nossa{' '}
      <a href="/ajuda/legal/politica-de-privacidade" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
        Política de privacidade
      </a>{' '}
      .
    </p>
  )
}

export function FieldError({ children }: { children?: string }) {
  if (!children) return null
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {children}
    </p>
  )
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_indisponivel: 'O login com Google está indisponível no momento.',
  google_estado: 'Não foi possível validar o login com Google. Tente novamente.',
  google_expirado: 'O login com Google expirou. Tente novamente.',
  google_token: 'O Google não confirmou o login. Tente novamente.',
  google_email: 'Sua conta Google precisa de um e-mail verificado.',
}
export const googleErrorMessage = (code: string | null) => (code && GOOGLE_ERRORS[code]) || null

/** "Entrar com Google" (OIDC no servidor: GET /api/v1/auth/google → callback cria/entra na conta). */
export function GoogleSignInButton({ label = 'Entrar com Google', next }: { label?: string; next?: string }) {
  const href = `/api/v1/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`
  return (
    <div className="mt-6 grid gap-3">
      <a href={href} data-testid="google-signin" className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4"><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.1A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28v-3.1H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.38l4.01-3.1Z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.26 6.62l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z"/></svg>
        {label}
      </a>
      <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" /></div>
    </div>
  )
}
