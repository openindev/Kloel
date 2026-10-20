import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Lock, ScanFace, IdCard, CircleCheck, CircleX, RotateCcw } from 'lucide-react'
import { useCurrentOrg, useCurrentUser } from '@/data/store'
import { captureEngineContext, useEngineSession } from '@/services/engine/session'
import { createIdentityJournal, createIdentityService, prepareIdentity, type IdentityState } from '@/services/casca/stripe-identity'
import { KloelMark } from '@/components/brand/KloelLogo'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { fmtDateLong } from './lib'

const BRAND_FULL = 'inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-md bg-brand text-base font-medium text-white transition-colors hover:bg-[#464ac4] disabled:opacity-50'
const OUTLINE_FULL = 'inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-md border border-[#d5dbe1] bg-white text-base font-medium text-[#1a1f36] transition-colors hover:bg-accent disabled:opacity-50'
function InlineInfo({ label, children }: { label: string; children: ReactNode }) {
  return <Popover><PopoverTrigger className="underline underline-offset-2 hover:text-brand">{label}</PopoverTrigger><PopoverContent className="w-72 text-sm">{children}</PopoverContent></Popover>
}

/** Original shell frame and consent layout; Stripe collects the document and selfie. */
export default function IdentityVerificationPage() {
  const session = useEngineSession()
  const scope = `${session.generation}:${session.data?.identity.userId ?? ''}:${session.data?.identity.tenantId ?? ''}`
  return <IdentityVerificationSession key={scope} />
}

function IdentityVerificationSession() {
  const navigate = useNavigate(), session = useEngineSession(), org = useCurrentOrg(), user = useCurrentUser()
  const [state, setState] = useState<IdentityState>()
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string>()
  const locked = useRef(false), popup = useRef<Window | null>(null), mounted = useRef(true)
  const allowed = session.data?.identity.permissions.includes('billing:manage') === true
  const name = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.email || 'representante'
  const refresh = useCallback(async (remote = false) => {
    if (!allowed || session.phase !== 'authenticated' || session.validation !== 'ready') return
    const context = captureEngineContext('billing:manage'), api = createIdentityService(context)
    try {
      let current = await api.state()
      if (remote && current.verification) current = { ...current, verification: await api.reconcile(current.verification.id) }
      context.assertCurrent()
      if (mounted.current) { setState(current); setError(undefined) }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a verificação.')
    } finally { if (mounted.current) setLoading(false) }
  }, [allowed, session.phase, session.validation, session.generation])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; popup.current?.close() } }, [])
  useEffect(() => { void refresh(); const onFocus = () => { if (!locked.current) void refresh(true) }; window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus) }, [refresh])
  async function begin() {
    if (locked.current) return
    locked.current = true
    setBusy(true); setError(undefined)
    const windowHandle = window.open('about:blank', '_blank', 'popup,width=640,height=760')
    popup.current = windowHandle
    try {
      if (!windowHandle) throw new Error('Permita a abertura da janela para continuar na Stripe.')
      const context = captureEngineContext('billing:manage')
      const journal = createIdentityJournal(window.sessionStorage, { userId: session.data!.identity.userId, tenantId: context.tenantId })
      const result = await prepareIdentity(createIdentityService(context), journal)
      context.assertCurrent()
      if (!mounted.current) { windowHandle.close(); return }
      setState({ configured: true, mode: result.verification.mode, verification: result.verification })
      if (result.url) {
        if (windowHandle.closed) throw new Error('A janela foi fechada. Continue a verificação para abrir novamente.')
        windowHandle.location.href = result.url
      } else windowHandle.close()
    } catch (cause) {
      windowHandle?.close()
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a verificação.')
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  const verification = state?.verification
  const exit = () => navigate('/app/billing')
  let body: ReactNode
  if (!allowed) {
    body = <div className="flex flex-col items-center gap-4 text-center" data-testid="identity-admin-only">
      <Lock className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-2xl font-bold text-[#1a1f36]">Somente administradores</h1>
      <p className="text-[15px] text-[#3c4257]">A verificação de identidade do representante da {org?.name ?? 'organização'} é feita por um administrador.</p>
      <button type="button" className={BRAND_FULL} onClick={exit}>Voltar para Assinatura e faturamento</button>
    </div>
  } else if (loading || busy) {
    body = <div className="flex flex-col items-center gap-5 text-center" data-testid="identity-analysis" data-identity-state="loading">
      <ScanFace className="h-12 w-12 animate-pulse text-brand" />
      <h1 className="text-2xl font-bold text-[#1a1f36]">Verificando sua identidade…</h1>
      <p className="text-sm text-muted-foreground">{busy ? 'Abrindo a verificação na Stripe' : 'Consultando a verificação'}</p>
      <Progress value={0} className="w-full" />
    </div>
  } else if (error) {
    body = <div className="flex flex-col items-center gap-5 text-center" data-testid="identity-failed" data-identity-state="error">
      <CircleX className="h-12 w-12 text-destructive" />
      <h1 className="text-2xl font-bold text-[#1a1f36]">Não foi possível concluir a verificação</h1>
      <p role="alert" className="text-sm text-muted-foreground">{error}</p>
      <button type="button" className={BRAND_FULL} onClick={() => void refresh(true)}><RotateCcw className="h-4 w-4" /> Tentar novamente</button>
      <button type="button" className={OUTLINE_FULL} onClick={exit}>Voltar para Assinatura e faturamento</button>
    </div>
  } else if (verification?.verified === true) {
    body = <div className="flex flex-col items-center gap-4 text-center" data-testid="identity-verified">
      <CircleCheck className="h-12 w-12 text-emerald-600" />
      <h1 className="text-2xl font-bold text-[#1a1f36]">Identidade verificada</h1>
      <p className="text-[15px] text-[#3c4257]">{name} ({org?.name}) foi verificado{verification.confirmedAt ? ` em ${fmtDateLong(verification.confirmedAt)}` : ''}.</p>
      <div className="mt-2 flex w-full flex-col gap-2"><button type="button" className={BRAND_FULL} onClick={exit}>Voltar para Assinatura e faturamento</button></div>
    </div>
  } else if (verification && ['processing', 'pending', 'unknown', 'verified'].includes(verification.state)) {
    body = <div className="flex flex-col items-center gap-5 text-center" data-testid="identity-analysis">
      <ScanFace className="h-12 w-12 text-brand" />
      <h1 className="text-2xl font-bold text-[#1a1f36]">Verificando sua identidade…</h1>
      <p className="text-sm text-muted-foreground">{verification.mode === 'test' && verification.state === 'verified'
        ? 'O ambiente de testes não conclui uma verificação de identidade real.' : 'Aguardando a confirmação da Stripe.'}</p>
      <button type="button" className={BRAND_FULL} onClick={() => void refresh(true)}>Consultar resultado</button>
      <button type="button" className={OUTLINE_FULL} onClick={exit}>Voltar para Assinatura e faturamento</button>
    </div>
  } else {
    body = <div className="flex flex-col gap-6" data-testid="identity-consent">
      <div className="flex items-center justify-center gap-2">
        <KloelMark className="h-14 w-14" />
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white"><IdCard className="h-7 w-7" /></span>
      </div>
      <h1 className="text-center text-[28px] font-bold leading-9 text-[#1a1f36]">A Kloel AI trabalha com a Stripe para verificar sua identidade</h1>
      <ul className="flex flex-col gap-4 text-[15px] leading-5 text-[#3c4257]">
        <li className="flex gap-3"><Camera className="h-5 w-5 shrink-0" /><span>Você precisa tirar uma foto de um{' '}<InlineInfo label="Documento com foto">A Stripe informa os documentos aceitos durante a verificação.</InlineInfo> válido e tirar uma selfie para confirmar que é seu.</span></li>
        <li className="flex gap-3"><Lock className="h-5 w-5 shrink-0" /><span>A Kloel AI só terá acesso a estes <InlineInfo label="dados de verificação">O resultado e a referência da verificação. A captura do documento e da selfie acontece na Stripe.</InlineInfo>.</span></li>
        <li className="flex gap-3"><ScanFace className="h-5 w-5 shrink-0" /><span>A Stripe fará a coleta e a verificação na próxima janela.</span></li>
      </ul>
      <p className="text-center text-xs leading-5 text-[#3c4257]"><a href="/ajuda/legal/politica-de-privacidade" target="_blank" rel="noreferrer" className="underline underline-offset-2">Política de Privacidade da Kloel AI</a> • <span className="underline underline-offset-2">Português (Brasil)</span></p>
      <div className="flex flex-col gap-2.5">
        <button type="button" className={BRAND_FULL} onClick={() => void begin()}>{verification?.canResume ? 'Continuar verificação' : 'Concordar e continuar'}</button>
        <button type="button" className={OUTLINE_FULL} onClick={exit}>Recusar</button>
      </div>
    </div>
  }
  return <main className="relative flex min-h-svh w-full items-center justify-center overflow-hidden bg-white px-4 pb-[72px] pt-10">
    <div aria-hidden className="pointer-events-none absolute inset-0 bg-[#EFEFFD]" style={{ clipPath: 'polygon(0 77%, 100% 34%, 100% 100%, 0 100%)' }} />
    <div className="relative w-full max-w-[400px] rounded-lg bg-white px-6 pb-6 pt-[46px] shadow-[0_2px_5px_rgba(60,66,87,0.08),0_15px_35px_rgba(60,66,87,0.12)]">{body}</div>
  </main>
}
