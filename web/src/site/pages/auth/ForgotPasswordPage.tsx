import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, KeyRound, Loader2, MailCheck, RotateCcw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { engineRequest } from '@/services/engine/session'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AuthShell, AUTH_QUOTES, FieldError } from './AuthShell'
import { isEmail } from '../company/kit'

type Stage = 'request' | 'sent' | 'reset'

/**
 * /recuperar-senha — INFERIDO (sem referência visual).
 * Pedido → envio SIMULADO do e-mail → "Verifique seu e-mail" → abrir o e-mail simulado → definir nova senha (salva no store local).
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '')
  const [stage, setStage] = useState<Stage>(token ? 'reset' : 'request')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [sending, setSending] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string>()
  const [cooldown, setCooldown] = useState(0)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwErr, setPwErr] = useState<{ pw?: string; pw2?: string }>({})
  useEffect(() => { if (token) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search) }, [token])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const send = async () => {
    if (!email.trim()) return setError('Informe seu e-mail.')
    if (!isEmail(email)) return setError('Informe um e-mail válido.')
    setError(undefined)
    setSendError(undefined)
    setSending('Gerando link de redefinição')
    try {
      const result = await engineRequest<{ accepted: boolean }>('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } })
      if (!result.accepted) throw new Error('Não foi possível solicitar a recuperação.')
      setSending(null)
      setStage('sent')
      setCooldown(30)
    } catch (e) {
      setSending(null)
      setSendError(e instanceof Error ? e.message : 'Não foi possível enviar o e-mail.')
    }
  }

  const savePassword = async () => {
    const e: typeof pwErr = {}
    if (pw.length < 12) e.pw = 'A nova senha deve ter pelo menos 12 caracteres.'
    if (pw2 !== pw) e.pw2 = 'As senhas não coincidem.'
    setPwErr(e)
    if (e.pw || e.pw2 || !token || sending) return
    setSending('Salvando')
    try {
      const result = await engineRequest<{ reset: boolean }>('/auth/reset-password', { method: 'POST', body: { token, password: pw, confirmation: pw2 } })
      if (!result.reset) throw new Error('Não foi possível redefinir a senha.')
      toast.success('Senha alterada. Entre com a nova senha.')
      navigate('/login', { state: { email } })
    } catch (error) { setPwErr({ pw: error instanceof Error ? error.message : 'Não foi possível alterar a senha.' }) }
    finally { setSending(null) }
  }

  return (
    <AuthShell quote={AUTH_QUOTES.recover}>
      {stage === 'request' && (
        <>
          <h1 className="text-2xl font-semibold">Recuperar senha</h1>
          <p className="mt-2 text-sm text-muted-foreground">Informe o e-mail da sua conta e enviaremos um link para você criar uma nova senha.</p>
          <form
            noValidate
            className="mt-[28px] flex flex-col gap-[18px]"
            onSubmit={(ev) => {
              ev.preventDefault()
              void send()
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-email">E-mail</Label>
              <Input id="fp-email" type="email" autoComplete="email" placeholder="joao@acme.com.br" value={email} aria-invalid={!!error || undefined} onChange={(ev) => { setEmail(ev.target.value); setError(undefined) }} />
              <FieldError>{error}</FieldError>
            </div>
            {sendError && (
              <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
                <XCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{sendError}</span>
                <Button type="button" size="xs" variant="outline" onClick={() => void send()} className="gap-1">
                  <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
                </Button>
              </div>
            )}
            <Button type="submit" variant="brand" className="mt-1.5 h-9 w-full" disabled={!!sending}>
              {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {sending ? `${sending}…` : 'Enviar link de redefinição'}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Lembrou a senha?{' '}
            <Link to="/login" className="font-medium text-foreground hover:underline">
              Entrar
            </Link>
          </p>
        </>
      )}

      {stage === 'sent' && (
        <div data-testid="forgot-sent">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/10 text-brand">
            <MailCheck className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold">Verifique seu e-mail</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Se existir uma conta para <b className="font-medium text-foreground">{email.trim()}</b>, você receberá em instantes um link para criar uma nova senha.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button variant="outline" className="h-9 w-full" disabled={cooldown > 0 || !!sending} onClick={() => void send()}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {cooldown > 0 ? `Reenviar e-mail (${cooldown}s)` : 'Reenviar e-mail'}
            </Button>
            <Button variant="ghost" className="h-9 w-full" onClick={() => { setStage('request'); setCooldown(0) }}>
              Usar outro e-mail
            </Button>
          </div>
          <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Voltar para o login
          </Link>
        </div>
      )}

      {stage === 'reset' && token && (
        <div data-testid="forgot-reset">
          <h1 className="text-2xl font-semibold">Crie uma nova senha</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Escolha uma senha com pelo menos 12 caracteres.
          </p>
          <form
            noValidate
            className="mt-[28px] flex flex-col gap-[18px]"
            onSubmit={(ev) => {
              ev.preventDefault()
              void savePassword()
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-pw">Nova senha</Label>
              <Input id="fp-pw" type="password" autoComplete="new-password" value={pw} aria-invalid={!!pwErr.pw || undefined} onChange={(ev) => { setPw(ev.target.value); setPwErr({}) }} />
              <FieldError>{pwErr.pw}</FieldError>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-pw2">Confirmar nova senha</Label>
              <Input id="fp-pw2" type="password" autoComplete="new-password" value={pw2} aria-invalid={!!pwErr.pw2 || undefined} onChange={(ev) => { setPw2(ev.target.value); setPwErr({}) }} />
              <FieldError>{pwErr.pw2}</FieldError>
            </div>
            <Button type="submit" variant="brand" className="mt-1.5 h-9 w-full" disabled={!!sending}>
              Salvar nova senha
            </Button>
          </form>
          <button type="button" onClick={() => setStage('sent')} className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
        </div>
      )}
    </AuthShell>
  )
}
