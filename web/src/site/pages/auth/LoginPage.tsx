import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { login, logout } from '@/lib/auth'
import { safeNext } from '@/services/engine/http'
import { useCurrentUser, useSession } from '@/data/store'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AuthShell, AUTH_QUOTES, FieldError, GoogleSignInButton, googleErrorMessage } from './AuthShell'
import { isEmail } from '../company/kit'
import { createInvitationAcceptance, invitationFragment } from '@/services/engine/team'
import { engineRequest, engineSession } from '@/services/engine/session'

/** /login — INFERIDO (não há captura da tela de login; segue o layout de "Crie sua conta"). */
export default function LoginPage({ invitation = false }: { invitation?: boolean }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const session = useSession()
  const currentUser = useCurrentUser()
  const location = useLocation()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; auth?: string }>({})
  const [busy, setBusy] = useState(false)
  const [token] = useState(() => invitation ? invitationFragment(window.location.hash) : undefined)
  const inviteAttempt = useRef<ReturnType<typeof createInvitationAcceptance>>()
  const [recovering, setRecovering] = useState(false)
  const pending = useRef(false)
  useLayoutEffect(() => {
    if (invitation && window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [invitation])
  useEffect(() => {
    if (!invitation || !recovering && !busy) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [invitation, recovering, busy])

  const submit = async () => {
    if (pending.current) return
    const e: typeof errors = {}
    if (!email.trim()) e.email = 'Informe seu e-mail.'
    else if (!isEmail(email)) e.email = 'Informe um e-mail válido.'
    if (!password) e.password = 'Informe sua senha.'
    else if (invitation && password.length < 12) e.password = 'Use uma senha de pelo menos 12 caracteres.'
    setErrors(e)
    if (e.email || e.password) return
    setBusy(true)
    pending.current = true
    try {
      if (invitation) {
        if (!token && !inviteAttempt.current) throw new Error('Abra o link completo do convite recebido por e-mail.')
        const recover = !!inviteAttempt.current
        const attempt = inviteAttempt.current ?? createInvitationAcceptance(engineRequest)
        inviteAttempt.current = attempt
        setRecovering(true)
        let result: Awaited<ReturnType<typeof attempt.accept>> | undefined
        await engineSession.acceptInvitation(async () => {
          result = recover ? await attempt.recover(password) : await attempt.accept({ token: token!, email, password })
        })
        const identity = engineSession.getSnapshot().data?.identity
        if (!result || identity?.userId !== result.userId || identity.tenantId !== result.tenantId) throw new Error('Confirme o acesso à organização antes de continuar.')
        setRecovering(false)
        toast.success('Convite aceito')
        navigate('/app', { replace: true })
        return
      }
      await login(email, password)
      toast.success('Bem-vindo de volta!')
      navigate(next, { replace: true })
    } catch (error) {
      setErrors({ auth: error instanceof Error ? error.message : 'Não foi possível entrar. Tente novamente.' })
    } finally { pending.current = false; setBusy(false) }
  }

  return (
    <AuthShell quote={AUTH_QUOTES.login}>
      {session.userId && currentUser && (
        <div className="mb-6 rounded-lg border bg-muted/40 p-3 text-sm" data-testid="login-already">
          Você já está conectado como <b className="font-medium">{currentUser.email}</b>.
          <div className="mt-2 flex gap-2">
            <Button size="xs" variant="brand" onClick={() => navigate(next)}>
              Ir para o app
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                void logout().then(() => toast.info('Você saiu da conta.'), error => toast.error(error instanceof Error ? error.message : 'Não foi possível sair.'))
              }}
            >
              Sair
            </Button>
          </div>
        </div>
      )}
      {params.get('next') && !session.userId && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> Entre na sua conta para continuar.
        </div>
      )}
      <h1 className="text-2xl font-semibold">{invitation ? 'Aceite seu convite' : 'Entre na sua conta'}</h1>
      {!invitation && <GoogleSignInButton next={next} />}
      {googleErrorMessage(params.get('erro')) && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive" data-testid="google-error">{googleErrorMessage(params.get('erro'))}</div>
      )}
      <form
        noValidate
        className="mt-[28px] flex flex-col gap-[18px]"
        onSubmit={(ev) => {
          ev.preventDefault()
          void submit()
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="li-email">E-mail</Label>
          <Input id="li-email" type="email" autoComplete="email" placeholder="joao@acme.com.br" value={email} disabled={invitation && (busy || recovering)} aria-invalid={!!errors.email || !!errors.auth || undefined} onChange={(ev) => { setEmail(ev.target.value); setErrors({}) }} />
          <FieldError>{errors.email}</FieldError>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="li-password">Senha</Label>
            <Link to="/recuperar-senha" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              Esqueceu a senha?
            </Link>
          </div>
          <Input id="li-password" type="password" autoComplete="current-password" value={password} aria-invalid={!!errors.password || !!errors.auth || undefined} onChange={(ev) => { setPassword(ev.target.value); setErrors({}) }} />
          <FieldError>{errors.password}</FieldError>
        </div>
        {errors.auth && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive" data-testid="login-error">
            {errors.auth}
          </div>
        )}
        <Button type="submit" variant="brand" className="mt-1.5 h-9 w-full" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {invitation ? recovering ? 'Consultar convite' : 'Aceitar convite' : 'Entrar'}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Ainda não tem uma conta?{' '}
        <Link to="/criar-conta" className="font-medium text-foreground hover:underline">
          Criar conta
        </Link>
      </p>
    </AuthShell>
  )
}
