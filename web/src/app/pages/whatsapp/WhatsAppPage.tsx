import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Ellipsis, Loader2, Send, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import type { WhatsAppAccount } from '@/domain/types'
import '@/domain/ext/mais-a'
import { cn, formatNumber } from '@/lib/utils'
import { useCollection, useCurrentOrg, useStore } from '@/data/store'
import { services } from '@/services'
import { whatsappCommands, whatsappEmbeddedStatus, retryWhatsAppRegistration, type EmbeddedStatus } from '@/services/casca/whatsapp'
import { useOperation } from '@/hooks/useOperation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { PhoneInput } from '@/components/app/PhoneInput'
import { WhatsAppIcon } from '@/components/brand/icons'
import { useWhatsAppQuota } from '../overview/plan-usage'
import { Field, eligibleAgents, focusPhoneCountryOnOpen } from '../phone-numbers/NumberDialogs'
import { OpStatus } from '../phone-numbers/OpStatus'
import { startMetaSignup, useMetaSignup } from './metaSignup'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'
import { AssistantWhatsAppDialog } from './AssistantWhatsAppDialog'

const QUALITY: Record<WhatsAppAccount['qualityRating'], { label: string; dot: string }> = {
  high: { label: 'Alta', dot: 'bg-emerald-500' },
  medium: { label: 'Média', dot: 'bg-amber-500' },
  low: { label: 'Baixa', dot: 'bg-red-500' },
  unknown: { label: '—', dot: 'bg-muted-foreground/40' },
}
const STATUS: Record<WhatsAppAccount['status'], { label: string; cls: string }> = {
  connected: { label: 'Conectado', cls: 'bg-emerald-500/10 text-emerald-700' },
  pending: { label: 'Pendente', cls: 'bg-amber-500/10 text-amber-700' },
  error: { label: 'Erro', cls: 'bg-red-500/10 text-red-700' },
}
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/* ------------------------------ Mensagem de teste ------------------------------ */

function TestMessageDialog({ account, onOpenChange }: { account?: WhatsAppAccount; onOpenChange: (o: boolean) => void }) {
  const [to, setTo] = useState('+55 ')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string>()
  const op = useOperation(async (_onProgress, a: WhatsAppAccount, phone: string, text: string) => {
    return services.messaging.sendTestMessage('whatsapp', phone, text, { channelId: a.id })
  })

  useEffect(() => {
    if (account) {
      setTo('+55 ')
      setBody(`Olá! Esta é uma mensagem de teste de ${account.businessName}.`)
      setError(undefined)
      op.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  async function send() {
    if (!account) return
    if (to.replace(/\D/g, '').length < 10) return setError('Digite um número de telefone válido.')
    if (!body.trim()) return setError('Escreva a mensagem.')
    setError(undefined)
    await op.run(account, '+' + to.replace(/\D/g, ''), body.trim())
  }

  return (
    <Dialog open={!!account} onOpenChange={(o) => !op.isRunning && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={focusPhoneCountryOnOpen}>
        <DialogHeader className="gap-y-2">
          <DialogTitle>Enviar mensagem de teste</DialogTitle>
          <DialogDescription>
            De {account?.businessName} · {account?.number}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Para" htmlFor="wa-test-to" error={error && error.includes('telefone') ? error : undefined}>
            <PhoneInput id="wa-test-to" value={to} onChange={setTo} invalid={!!error && error.includes('telefone')} />
          </Field>
          <Field label="Mensagem" htmlFor="wa-test-body" error={error && error.includes('mensagem') ? error : undefined}>
            <Textarea id="wa-test-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <OpStatus
            status={op.status}
            progress={op.progress}
            error={op.error}
            onRetry={send}
            successText="Mensagem aceita para envio."
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={op.isRunning}>
            {op.status === 'success' ? 'Fechar' : 'Cancelar'}
          </Button>
          <Button onClick={send} disabled={op.isRunning} className="gap-2">
            {op.isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {op.status === 'success' ? 'Enviar outra' : 'Enviar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ----------------------------------- Página ----------------------------------- */

function AccountCard({ account, onTest, onDisconnect }: { account: WhatsAppAccount; onTest: () => void; onDisconnect: () => void }) {
  const agents = eligibleAgents(useCollection('agents'), true)
  const [saving, setSaving] = useState(false)
  const last = account.testMessages?.[0]
  return (
    <div className="rounded-xl border bg-card shadow" data-testid="wa-account">
      <div className="flex items-start gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
          <WhatsAppIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{account.businessName}</span>
            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', STATUS[account.status].cls)}>{STATUS[account.status].label}</span>
          </div>
          <p className="text-sm tabular-nums text-muted-foreground">{account.number}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${account.businessName}`}>
              <Ellipsis className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={onTest}>
              <Send className="text-muted-foreground" />
              Enviar mensagem de teste
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDisconnect}>
              <Unplug />
              Desconectar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t px-5 py-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Qualidade</dt>
          <dd className="mt-1 flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', QUALITY[account.qualityRating].dot)} />
            {QUALITY[account.qualityRating].label}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Mensagens neste mês</dt>
          <dd className="mt-1 tabular-nums">{account.messagesThisMonth === null ? '—' : formatNumber(account.messagesThisMonth)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Conectado em</dt>
          <dd className="mt-1">{account.connectedAt ? dateFmt.format(new Date(account.connectedAt)) : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Último teste</dt>
          <dd className="mt-1 truncate">{last ? `${timeFmt.format(new Date(last.at))} · ${last.to}` : '—'}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-sm font-medium">Assistente</span>
          <Select
            value={account.agentId ?? 'none'}
            disabled={saving}
            onValueChange={async (v) => {
              const agentId = v === 'none' ? null : v
              setSaving(true)
              try { await whatsappCommands().assign(account, agentId); toast.success(agentId ? 'Assistente vinculado' : 'Assistente desvinculado') }
              catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o assistente.') }
              finally { setSaving(false) }
            }}
          >
            <SelectTrigger aria-label="Assistente vinculado" className="h-8 w-56 rounded-lg text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum assistente</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={onTest}>
          <Send className="h-4 w-4" />
          Enviar mensagem de teste
        </Button>
      </div>
    </div>
  )
}

export default function WhatsAppPage() {
  const load = usePageLoad('whatsapp')
  const accounts = useCollection('whatsappAccounts')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const org = useCurrentOrg()
  const quota = useWhatsAppQuota()
  const connecting = useMetaSignup((s) => s.connecting)
  /** ?assistant=<id>: "Números de WhatsApp deste assistente" (WA-02), aberto a partir da página do assistente */
  const assistantId = params.get('assistant') ?? undefined
  const agents = useCollection('agents')
  const assistantKnown = !!assistantId && agents.some((a) => a.id === assistantId)
  const [testing, setTesting] = useState<WhatsAppAccount>()
  const closeAssistant = () => {
    const next = new URLSearchParams(window.location.search)
    next.delete('assistant')
    setParams(next, { replace: true })
  }
  // link com um assistente inexistente (excluído ou de outra empresa): avisa e limpa o parâmetro em vez de abrir nada
  useEffect(() => {
    if (load.isLoading || load.isError || !assistantId || assistantKnown) return
    toast.error('Assistente não encontrado', { description: 'O assistente deste link não existe nesta empresa.' })
    closeAssistant()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantId, assistantKnown, load.isLoading, load.isError])
  const [disconnecting, setDisconnecting] = useState<WhatsAppAccount>()
  const [embedded, setEmbedded] = useState<EmbeddedStatus>()
  const [retrying, setRetrying] = useState(false)
  useEffect(() => { if (!load.isLoading && !load.isError) whatsappEmbeddedStatus().then(setEmbedded).catch(() => undefined) }, [load.isLoading, load.isError, connecting])
  const retry = async () => {
    setRetrying(true)
    try { const r = await retryWhatsAppRegistration(); setEmbedded(r); r.needsAttention ? toast.error('O número ainda precisa de atenção', { description: r.lastError ?? undefined }) : toast.success('Número registrado com sucesso') }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível tentar novamente.') }
    finally { setRetrying(false) }
  }

  /** Sem diálogo intermediário (fonio-live2/F-whatsapp/02): abre direto a janela do cadastro e o botão vira "Conectando...". */
  const connect = () => {
    // com a janela aberta, um novo clique só a traz para frente (o botão continua no mesmo estilo, como na Fonio)
    if (connecting) return startMetaSignup(org?.name ?? '')
    if (!quota.sub || quota.reached) {
      toast.error(!quota.sub ? 'Você ainda não tem um plano de WhatsApp ativo' : `Todos os números de WhatsApp do plano estão em uso (${quota.used} de ${quota.limit})`, {
        description: !quota.sub ? 'Assine o plano de WhatsApp para conectar uma conta.' : 'Adicione um número extra ou faça upgrade do seu plano.',
        action: { label: !quota.sub ? 'Assinar' : 'Ver planos', onClick: () => navigate(!quota.sub ? '/app/add-product/whatsapp' : '/app/change-plan/whatsapp') },
      })
      return
    }
    startMetaSignup(org?.name ?? '')
  }
  // ?connect=1 (links de outras telas): inicia o cadastro uma vez e limpa a URL
  useEffect(() => {
    if (params.get('connect') !== '1' || load.isLoading) return
    const next = new URLSearchParams(params)
    next.delete('connect')
    setParams(next, { replace: true })
    connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, load.isLoading])

  if (load.isLoading || load.isError) {
    return (
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[1200px]">{load.isError ? <PageLoadError onRetry={load.retry} /> : <PageSkeleton rows={2} />}</div>
      </div>
    )
  }

  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <div className="mx-auto w-full max-w-[1200px]">
        <h1 className="mb-4 md:mb-8">
          <span className="text-2xl xl:text-3xl font-semibold tracking-tight">WhatsApp Business</span>
        </h1>
        <div className="w-full">
          <div className="flex items-center py-4 gap-2 justify-end">
            <Button className="h-10 px-4 max-sm:w-full" onClick={connect} aria-busy={connecting || undefined} data-connecting={connecting || undefined}>
              {connecting ? 'Conectando...' : 'Conectar conta do WhatsApp Business'}
            </Button>
          </div>
          <div className="space-y-4">
            {embedded?.needsAttention && (
              <div role="alert" data-testid="wa-needs-attention" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-amber-900">Precisa de atenção · {embedded.verifiedName ?? 'WhatsApp Business'} {embedded.displayPhoneNumber ? `· ${embedded.displayPhoneNumber}` : ''}</p>
                  <p className="mt-1 break-words text-amber-800">A conta foi conectada, mas o registro do número na API do WhatsApp falhou{embedded.lastError ? `: ${embedded.lastError}` : '.'}</p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0 gap-2" onClick={retry} disabled={retrying}>
                  {retrying && <Loader2 className="h-4 w-4 animate-spin" />}Tentar novamente
                </Button>
              </div>
            )}
            {accounts.length === 0 ? (
              <div className="border bg-card rounded-xl p-8 text-center text-sm text-muted-foreground shadow">Nenhuma conta do WhatsApp Business conectada</div>
            ) : (
              accounts.map((a) => <AccountCard key={a.id} account={a} onTest={() => setTesting(a)} onDisconnect={() => setDisconnecting(a)} />)
            )}
          </div>
        </div>
      </div>
      <AssistantWhatsAppDialog
        agentId={assistantKnown ? assistantId : undefined}
        open={assistantKnown}
        onOpenChange={(o) => {
          if (!o) closeAssistant()
        }}
      />
      <TestMessageDialog account={testing} onOpenChange={(o) => !o && setTesting(undefined)} />
      <ConfirmDialog
        open={!!disconnecting}
        onOpenChange={(o) => !o && setDisconnecting(undefined)}
        title="Desconectar conta do WhatsApp Business?"
        description={`O número ${disconnecting?.number ?? ''} deixará de receber e enviar mensagens pela Kloel e será removido de Números de telefone.`}
        confirmLabel="Desconectar"
        onConfirm={async () => {
          if (!disconnecting) return
          await whatsappCommands().disconnect(disconnecting)
          toast.success('Conta desconectada', { description: disconnecting.businessName })
        }}
      />
    </div>
  )
}
