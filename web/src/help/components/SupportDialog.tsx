import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CheckCircle2, LifeBuoy, Loader2, Inbox } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { OperationStatusView } from '@/components/app/misc'
import { useCurrentUser, useDB, useStore } from '@/data/store'
import { useOperation } from '@/hooks/useOperation'
import { runSteps, type ProgressFn } from '@/services/runtime'
import { useHelpUi } from '../lib/ui'

const TOPICS = ['Dúvida sobre o produto', 'Problema técnico', 'Faturamento e planos', 'Integrações', 'Programa de parceiros', 'Outro']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SOURCE = 'central-de-ajuda'

interface Errors {
  name?: string
  email?: string
  message?: string
}

interface SupportPayload {
  name: string
  email: string
  topic: string
  message: string
  page: string
}

/**
 * Envio SIMULADO ao suporte: validação → registro → confirmação. Pode falhar pelo painel
 * "Simular falha na próxima operação" e ser repetido. O resultado fica salvo como Lead local
 * (`kind: contact`, `payload.source: central-de-ajuda`) com protocolo; nenhum e-mail é enviado.
 */
async function sendSupportRequest(onProgress: ProgressFn, data: SupportPayload) {
  await runSteps(
    [
      { label: 'Validando a mensagem…', ms: 300 },
      { label: 'Registrando a solicitação…', ms: 450 },
      { label: 'Enviando confirmação por e-mail…', ms: 400 },
    ],
    onProgress,
    { failAtStep: 1 },
  )
  const protocol = `KL-${Date.now().toString(36).slice(-6).toUpperCase()}`
  const lead = useStore.getState().insert('leads', {
    kind: 'contact',
    payload: { source: SOURCE, ...data, protocol, status: 'registrada', simulated: 'true' },
  })
  return { protocol, id: lead.id }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

/** Formulário de suporte da central (rótulos "Suporte" e "Mandar e-mail ao time" da referência). */
export function SupportDialog() {
  const open = useHelpUi((s) => s.supportOpen)
  const setOpen = useHelpUi((s) => s.setSupportOpen)
  const presetTopic = useHelpUi((s) => s.supportTopic)
  const user = useCurrentUser()
  const loc = useLocation()
  const leads = useDB((db) => db.leads)
  const history = useMemo(
    () => leads.filter((l) => l.kind === 'contact' && l.payload.source === SOURCE).slice().reverse(),
    [leads],
  )
  // rascunho no estado da central (localStorage): sobrevive a fechar o diálogo, trocar de artigo e recarregar;
  // só é limpo depois do envio bem-sucedido ou por "Descartar rascunho"
  const draft = useHelpUi((s) => s.supportDraft)
  const setDraft = useHelpUi((s) => s.setSupportDraft)
  const { name, email, message } = draft
  const topic = TOPICS.includes(draft.topic) ? draft.topic : TOPICS[0]!
  const setName = (v: string) => setDraft({ name: v })
  const setEmail = (v: string) => setDraft({ email: v })
  const setTopic = (v: string) => setDraft({ topic: v })
  const setMessage = (v: string) => setDraft({ message: v })
  const [errors, setErrors] = useState<Errors>({})
  const op = useOperation(sendSupportRequest)
  const { reset } = op

  useEffect(() => {
    if (!open) return
    reset()
    setErrors({})
    const d = useHelpUi.getState().supportDraft
    const patch: Partial<typeof d> = {}
    if (!d.name.trim() && user) patch.name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
    if (!d.email.trim() && user?.email) patch.email = user.email
    if (presetTopic) {
      const line = `Minha dúvida: ${presetTopic}`
      // não apaga o que já foi escrito: a dúvida vinda do assistente é acrescentada ao rascunho
      if (!d.message.trim()) patch.message = `${line}\n\n`
      else if (!d.message.includes(presetTopic)) patch.message = `${d.message.trimEnd()}\n\n${line}\n`
    }
    if (Object.keys(patch).length) setDraft(patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const page = useMemo(() => loc.pathname + loc.hash, [loc])
  const busy = op.status === 'running'

  const validate = (): Errors => {
    const e: Errors = {}
    if (name.trim().length < 2) e.name = 'Informe seu nome.'
    if (!email.trim()) e.email = 'Informe seu e-mail.'
    else if (!EMAIL_RE.test(email.trim())) e.email = 'Digite um e-mail válido.'
    if (message.trim().length < 10) e.message = 'Descreva sua dúvida com pelo menos 10 caracteres.'
    return e
  }

  /** Envio e nova tentativa usam o mesmo caminho: validam e enviam os valores ATUAIS do formulário. */
  const send = async () => {
    if (busy) return
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    const r = await op.run({ name: name.trim(), email: email.trim(), topic, message: message.trim(), page })
    if (r) setDraft({ message: '', topic: '' })
  }

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    void send()
  }

  const discardDraft = () => {
    setDraft({ message: '', topic: '' })
    setErrors((e) => ({ ...e, message: undefined }))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!busy || !o) && setOpen(o)}>
      <DialogContent className="max-h-[calc(100svh-24px)] max-w-md gap-y-5 overflow-y-auto font-sans" data-help-support>
        {op.status === 'success' && op.result ? (
          <div className="py-2 text-center">
            <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
            <DialogTitle className="mt-3 text-lg">Mensagem registrada</DialogTitle>
            <DialogDescription className="mx-auto mt-2 max-w-sm">
              Protocolo <span className="font-mono font-semibold text-foreground" data-protocol>{op.result.protocol}</span>. Você receberá a resposta pelo e-mail informado.
            </DialogDescription>
            <div className="mt-6 flex justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setErrors({})
                  reset()
                }}
              >
                Enviar outra mensagem
              </Button>
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <LifeBuoy className="size-5 text-brand" /> Fale com o suporte
              </DialogTitle>
              <DialogDescription>
                Conte o que você precisa e o time da Kloel responde pelo e-mail informado.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} noValidate className="space-y-4">
              <fieldset disabled={busy} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-name">Nome</Label>
                    <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} placeholder="Seu nome" className="h-9" />
                    {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sup-email">E-mail</Label>
                    <Input id="sup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} placeholder="voce@exemplo.com.br" className="h-9" />
                    {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sup-topic">Assunto</Label>
                  <select id="sup-topic" value={topic} onChange={(e) => setTopic(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    {TOPICS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sup-msg">Mensagem</Label>
                  <Textarea id="sup-msg" value={message} onChange={(e) => setMessage(e.target.value)} aria-invalid={!!errors.message} rows={5} placeholder="Descreva sua dúvida ou o problema que está enfrentando…" />
                  {errors.message && <p className="text-xs text-destructive">{errors.message}</p>}
                  {message.trim() && (
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-support-draft>
                      Rascunho guardado neste navegador até o envio.
                      <button type="button" onClick={discardDraft} className="font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline">
                        Descartar rascunho
                      </button>
                    </p>
                  )}
                </div>
              </fieldset>
              <OperationStatusView status={op.status} progress={op.progress} error={op.error && `Não foi possível enviar: ${op.error}`} onRetry={() => void send()} />
              <p className="text-xs text-muted-foreground">
                Página de origem: <span className="break-all font-mono">{page}</span>
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy} className="min-w-28">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : op.status === 'error' ? 'Tentar enviar de novo' : 'Enviar mensagem'}
                </Button>
              </div>
            </form>
            {history.length > 0 && (
              <details className="group rounded-xl border border-zinc-200 text-sm" data-support-history>
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-zinc-700 [&::-webkit-details-marker]:hidden">
                  <Inbox className="size-4 text-zinc-400" />
                  <span className="flex-1">
                    {history.length} {history.length === 1 ? 'mensagem enviada' : 'mensagens enviadas'}
                  </span>
                  <span className="text-xs text-zinc-400 group-open:hidden">Ver</span>
                  <span className="hidden text-xs text-zinc-400 group-open:inline">Ocultar</span>
                </summary>
                <ul className="max-h-48 divide-y divide-zinc-100 overflow-y-auto border-t border-zinc-100">
                  {history.slice(0, 10).map((l) => (
                    <li key={l.id} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-zinc-900">{l.payload.protocol ?? `KL-${l.id.slice(-6).toUpperCase()}`}</span>
                        <span className="truncate text-xs text-zinc-500">{l.payload.topic}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-zinc-400">{formatDate(l.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-zinc-600">{l.payload.message}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
