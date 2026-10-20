import { useEffect, useState } from 'react'
import { Building2, CalendarDays, Mail, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import type { CalendarConnection, EmailInbox, ID } from '@/domain/types'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { GoogleIcon, MicrosoftIcon } from '@/components/brand/icons'
import { OperationStatusView } from '@/components/app/misc'
import { useOperation } from '@/hooks/useOperation'
import { useStore } from '@/data/store'
import { connect as connectAccount } from '@/services/casca/oauth'
import { captureEngineContext, engineSession } from '@/services/engine/session'
import { accountClient } from '@/services/engine/account'

export type Provider = 'google' | 'microsoft'
export type Feature = 'calendar' | 'email'

export function ProviderIcon({ provider, className }: { provider: Provider; className?: string }) {
  return provider === 'google' ? <GoogleIcon className={className} /> : <MicrosoftIcon className={className} />
}
export const providerLabel = (p: Provider) => (p === 'google' ? 'Google' : 'Microsoft')
export const featureLabel = (f: Feature) => (f === 'calendar' ? 'Agenda' : 'IA de e-mail')

/**
 * Diálogo "Como você quer usar esta conta?" (capturado em Configurações da empresa → Conexões de contas).
 * Mantém o diálogo original e aguarda a confirmação da conta pelo servidor.
 */
export function ConnectAccountDialog({
  open,
  onOpenChange,
  scope,
  defaultFeatures = ['calendar'],
  onConnected,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  scope: 'personal' | 'shared'
  defaultFeatures?: Feature[]
  onConnected?: (conn: CalendarConnection, inbox?: EmailInbox) => void
}) {
  const [provider, setProvider] = useState<Provider>('google')
  const [features, setFeatures] = useState<Feature[]>(defaultFeatures)
  const op = useOperation(async (onProgress, p: Provider, feats: Feature[]) => {
    const context = captureEngineContext('integrations:execute')
    const { connection: conn } = await connectAccount(p, 'account', onProgress, { scope, features: feats })
    context.assertCurrent()
    const st = useStore.getState()
    st.mutate(db => ({ ...db, calendarConnections: [...db.calendarConnections.filter(row => row.id !== conn.id), conn] }))
    return { conn, inbox: undefined }
  })

  useEffect(() => {
    if (open) {
      setProvider('google')
      setFeatures(defaultFeatures)
      op.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (f: Feature, on: boolean) => setFeatures((prev) => (on ? [...new Set([...prev, f])] : prev.filter((x) => x !== f)))

  const submit = async () => {
    const r = await op.run(provider, features)
    if (r) {
      toast.success('Conta conectada', { description: `${r.conn.email} · ${r.conn.features.map(featureLabel).join(' + ')}` })
      onConnected?.(r.conn, r.inbox)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !op.isRunning && onOpenChange(o)}>
      {/* [501] (2a. Pessoal/1.png): 16 px entre cabeçalho, aviso e provedores; título→descrição ≈6 px; 20 px antes dos recursos e do rodapé */}
      <DialogContent className="gap-y-4">
        <DialogHeader>
          <DialogTitle>Como você quer usar esta conta?</DialogTitle>
          <DialogDescription>Escolha os recursos da Kloel que você quer usar. Em seguida, seu provedor mostrará a solicitação de acesso correspondente.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (features.length && !op.isRunning) void submit()
          }}
        >
          <Alert>
            {scope === 'shared' ? <Building2 /> : <UserRound />}
            <div className="whitespace-pre-line text-sm">
              {scope === 'shared' ? (
                <>
                  <span>Exemplo: info@exemplo.com.br</span>
                  {'\n'}Você está conectando uma conta usada por várias pessoas. Você pode conectar várias contas compartilhadas. Elas podem ser gerenciadas por: Admin e Editor.
                </>
              ) : (
                <>
                  <span>Exemplo: ana@exemplo.com.br</span>
                  {'\n'}Você está conectando sua conta pessoal. Você pode conectar apenas uma conta pessoal.
                </>
              )}
            </div>
          </Alert>
          <RadioGroup value={provider} onValueChange={(v) => setProvider(v as Provider)} className="grid-cols-2 gap-3" aria-label="Provedor">
            {(['google', 'microsoft'] as const).map((p) => (
              <label key={p} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary">
                <RadioGroupItem value={p} aria-label={providerLabel(p)} />
                <ProviderIcon provider={p} className="size-5" />
                <span className="text-sm font-medium">{providerLabel(p)}</span>
              </label>
            ))}
          </RadioGroup>
          <div className="mt-1 space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3.5">
              <Checkbox checked={features.includes('calendar')} onCheckedChange={(v) => toggle('calendar', v === true)} className="mt-0.5" aria-label="Agenda" />
              <CalendarDays className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Agenda</span>
                <span className="text-sm text-muted-foreground">Gerencie disponibilidade, reservas e reuniões online.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3.5">
              <Checkbox checked={features.includes('email')} onCheckedChange={(v) => toggle('email', v === true)} className="mt-0.5" aria-label="IA de e-mail" />
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">IA de e-mail</span>
                <span className="text-sm text-muted-foreground">Organize os e-mails recebidos e prepare rascunhos de resposta com o agente de e-mail.</span>
              </span>
            </label>
            {features.length === 0 && <p className="text-sm font-medium text-destructive">Selecione pelo menos um recurso.</p>}
          </div>
          <OperationStatusView status={op.status} progress={op.progress} error={op.error} onRetry={() => void submit()} successText="Conta conectada." />
          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" disabled={op.isRunning} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!features.length || op.isRunning}>
              {op.isRunning ? 'Conectando…' : 'Continuar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Remove uma conexão (e a caixa de e-mail ligada a ela). Tipos de evento que usavam a agenda ficam sem calendário. */
export async function removeConnection(id: ID) {
  const context = captureEngineContext('integrations:execute')
  await accountClient(context, engineSession.getSnapshot().data!.identity.userId).disconnect(id)
  context.assertCurrent()
  useStore.getState().mutate((d) => {
    const inboxIds = new Set(d.emailInboxes.filter((i) => i.connectionId === id).map((i) => i.id))
    return {
      ...d,
      calendarConnections: d.calendarConnections.filter((c) => c.id !== id),
      emailInboxes: d.emailInboxes.filter((i) => !inboxIds.has(i.id)),
      emailMessages: d.emailMessages.filter((m) => !inboxIds.has(m.inboxId)),
    }
  })
}

export function connectionImpact(id: ID) {
  const db = useStore.getState().db
  const inboxes = db.emailInboxes.filter((i) => i.connectionId === id)
  const events = db.eventTypes.filter((e) => e.calendarId === id)
  return { inboxes, events }
}
