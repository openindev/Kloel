import { useRef, useState } from 'react'
import { initializeOnboarding } from '@/services/casca/onboarding'
import { useReferral } from '@/services/casca/referrals'
import { engineSession } from '@/services/engine/session'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Gift, Loader2, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/site-secondary'
import type { Organization, ProductKey } from '@/domain/types'
import { register, emailExists } from '@/lib/auth'
import { sleep } from '@/lib/utils'
import { useSession, useStore, useCurrentUser } from '@/data/store'
import { productByKey } from '@/data/catalogs/plans'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AuthShell, AUTH_QUOTES, FieldError, LegalNote, GoogleSignInButton } from './AuthShell'
import { isEmail } from '../company/kit'

const PRODUCTS_OK = ['voice', 'whatsapp', 'webchat'] as const
const TIERS_OK = ['solo', 'team', 'scale'] as const

/** /criar-conta — "Crie sua conta" (OBSERVADO [13]/[301]): Empresa, E-mail, Senha → sem confirmação de e-mail → primeiro acesso (/app/onboarding). */
export default function SignupPage() {
  const created = useRef<{userId:string;orgId:string;email:string}|null>(null)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const session = useSession()
  const currentUser = useCurrentUser()
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ company?: string; email?: string; password?: string; duplicate?: boolean }>({})
  const [busy, setBusy] = useState(false)

  const product = PRODUCTS_OK.find((p) => p === params.get('produto'))
  const tier = TIERS_OK.find((t) => t === params.get('plano'))
  const cycle = params.get('ciclo') === 'anual' ? 'anual' : 'mensal'
  const refCode = params.get('ref') ?? undefined
  // The engine confirms the code; nothing about other organizations is read from this browser.
  const referral = useReferral(refCode)
  const referrer = referral.status === 'done' && referral.valid ? { name: referral.referrerName } : undefined
  const planName = product && tier ? productByKey(product).plans.find((p) => p.tier === tier)?.name : undefined

  const validate = () => {
    const e: typeof errors = {}
    if (company.trim().length < 2) e.company = 'Informe o nome da empresa.'
    if (!email.trim()) e.email = 'Informe seu e-mail.'
    else if (!isEmail(email)) e.email = 'Informe um e-mail válido.'
    else if (emailExists(email) && created.current?.email !== email.trim().toLowerCase()) {
      e.email = 'Já existe uma conta com este e-mail.'
      e.duplicate = true
    }
    if (!password) e.password = 'Crie uma senha.'
    else if (password.length < 12) e.password = 'A senha deve ter pelo menos 12 caracteres.'
    setErrors(e)
    return !e.company && !e.email && !e.password
  }

  const submit = async () => {
    if (busy || !validate()) return
    setBusy(true)
    try {
    if(created.current && created.current.email!==email.trim().toLowerCase())throw new Error('Sua conta já foi criada. Conclua a configuração dessa conta antes de usar outro e-mail.')
    const registration=created.current ?? await register({ company: company.trim(), email: email.trim(), password, referralCode: referrer ? refCode : undefined })
    created.current={...registration,email:email.trim().toLowerCase()}
    const { orgId }=registration,identity=engineSession.getSnapshot().data?.identity
    if(identity?.userId!==registration.userId || identity.tenantId!==orgId)throw new Error('Confirme sua sessão para concluir a configuração da conta criada.')
    await initializeOnboarding()
    const st = useStore.getState()
    const orgPatch: Partial<Organization> = {
      signupIntent: { product, plan: tier, cycle: product ? cycle : undefined, referralCode: referrer ? refCode : undefined },
    }
    if (product) {
      orgPatch.onboardingTab = product as ProductKey
      orgPatch.onboardingAnnual = cycle === 'anual'
    }
    if (referrer) orgPatch.referralSource = `Indicação de ${referrer.name}`
    st.patchOrg(orgPatch, orgId)
    toast.success('Conta criada! Vamos configurar a sua Kloel.')
    navigate('/app/onboarding')
    } catch (error) {
      setErrors({ email: error instanceof Error ? error.message : 'Não foi possível criar a conta.' })
    } finally { setBusy(false) }
  }

  return (
    <AuthShell quote={AUTH_QUOTES.signup}>
      {session.userId && currentUser && (
        <div className="mb-6 rounded-lg border bg-muted/40 p-3 text-sm">
          Você já está conectado como <b className="font-medium">{currentUser.email}</b>.{' '}
          <Link to="/app" className="font-medium text-brand hover:underline">
            Ir para o app
          </Link>{' '}
          ou crie uma nova conta abaixo.
        </div>
      )}
      {planName && product && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-brand/30 bg-brand/5 p-3 text-sm" data-testid="signup-plan">
          <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div>
            Plano escolhido: <b className="font-medium">{planName}</b> · {productByKey(product).name} · {cycle === 'anual' ? 'Anual' : 'Mensal'}.
            <span className="block text-muted-foreground">
              Você confirma o plano no primeiro acesso.{' '}
              <Link to={`/planos?produto=${product}${cycle === 'anual' ? '&ciclo=anual' : ''}`} className="text-brand hover:underline">
                Alterar
              </Link>
            </span>
          </div>
        </div>
      )}
      {refCode && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="signup-referral">
          <Gift className="mt-0.5 h-4 w-4 shrink-0" />
          {referral.status === 'loading' ? (
            <span>Conferindo o código de indicação…</span>
          ) : referrer && referral.status === 'done' && referral.valid ? (
            <span>
              Você foi indicado por <b className="font-medium">{referrer.name}</b>. A indicação fica registrada na sua conta, e o benefício de {referral.benefit.percentOff}% de desconto por {referral.benefit.months} meses é confirmado pela equipe Kloel na sua primeira assinatura.
            </span>
          ) : (
            <span>O código de indicação “{refCode}” não foi encontrado. Você ainda pode criar a sua conta normalmente.</span>
          )}
        </div>
      )}
      <h1 className="text-2xl font-semibold">Crie sua conta</h1>
      <GoogleSignInButton label="Criar conta com Google" />
      <form
        noValidate
        className="mt-[28px] flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="su-company">Empresa</Label>
          <Input id="su-company" autoComplete="organization" placeholder="Acme" value={company} aria-invalid={!!errors.company || undefined} onChange={(e) => { setCompany(e.target.value); setErrors((x) => ({ ...x, company: undefined })) }} />
          <FieldError>{errors.company}</FieldError>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="su-email">E-mail</Label>
          <Input id="su-email" type="email" autoComplete="email" placeholder="joao@acme.com.br" value={email} aria-invalid={!!errors.email || undefined} onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined, duplicate: false })) }} />
          {errors.email && (
            <p role="alert" className="text-[13px] text-destructive">
              {errors.email}
              {errors.duplicate && ' '}
              {errors.duplicate && (
                <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} state={{ email: email.trim() }} className="font-medium underline">
                  Entrar
                </Link>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="su-password">Senha</Label>
          <Input id="su-password" type="password" autoComplete="new-password" value={password} aria-invalid={!!errors.password || undefined} onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })) }} />
          <FieldError>{errors.password}</FieldError>
        </div>
        <Button type="submit" variant="brand" className="mt-1.5 h-9 w-full" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Próximo
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Já tem uma conta?{' '}
        <Link to="/login" className="font-medium text-foreground hover:underline">
          Entrar
        </Link>
      </p>
      <LegalNote />
    </AuthShell>
  )
}
