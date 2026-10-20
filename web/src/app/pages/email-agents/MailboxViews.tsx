import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Inbox, Send, Sparkles, Reply, RotateCcw, RefreshCw, MailOpen, Mail, Archive, Trash2, X, CheckCircle2, Bot, BookOpen, ListChecks, FileText, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import type { CalendarConnection, EmailInbox, EmailMessage, EventType } from '@/domain/types'
import type { CalendarOption } from '@/domain/ext/engine-scheduling'
import { useCurrentOrg, useCurrentUser, useStore } from '@/data/store'
import { OpStatus as OperationStatusView } from '@/app/pages/phone-numbers/OpStatus'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { useOperation } from '@/hooks/useOperation'
import { generateMailDraft, sendMailReply, syncMailbox, editMailDraft, setMailRead, archiveMail, trashMail, discardMailDraft, organizeBlockedReason, refreshEmail } from '@/services/casca/email'
import { providerLabel } from '@/app/pages/company-settings/connections'
import { connect as connectOAuth } from '@/services/casca/oauth'
import type { ProgressFn } from '@/services/runtime'
import { cn, initials } from '@/lib/utils'
import { draftContent, formatMailDate, toneLabel, useInboxAccess } from './mailbox'

export type MailFilter = 'unread' | 'draft' | 'replied'
export const FILTER_LABEL: Record<MailFilter, string> = { unread: 'Não lidos', draft: 'Com rascunho da IA', replied: 'Respondidos' }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function filterMessages(msgs: EmailMessage[], q: string, filters: MailFilter[]) {
  const t = norm(q.trim())
  return msgs.filter((m) => {
    if (filters.includes('unread') && m.read) return false
    if (filters.includes('draft') && (m.status !== 'draft_ready' || m.draftSource === 'manual')) return false
    if (filters.includes('replied') && m.status !== 'replied') return false
    if (!t) return true
    return norm(`${m.fromName ?? ''} ${m.from} ${m.toName ?? ''} ${m.to} ${m.subject} ${m.body}`).includes(t)
  })
}

async function draftFor(inbox: EmailInbox, msg: EmailMessage, onProgress?: ProgressFn) { return generateMailDraft(inbox, msg, onProgress) }

/** O que segue funcionando quando a mesma conta é reautorizada: o motor religa agendamentos e automações à nova autorização. */
function reconnectKeeps(inbox: EmailInbox, conn: CalendarConnection, eventTypes: EventType[], calendars: CalendarOption[]) {
  const own = new Set(calendars.filter((c) => c.calendar?.connectionId === conn.id || c.remote?.connection.id === conn.id).map((c) => c.id))
  const pages = eventTypes.filter((e) => e.engineEvent?.publicationStatus === 'published' && !!e.calendarId && (own.has(e.calendarId) || e.calendarId === conn.id)).map((e) => e.name)
  const grant = inbox.engineEmail?.automation.grant
  return [
    `Leitura e envio de e-mails de ${inbox.address}`,
    ...(conn.features.includes('calendar') ? [pages.length ? `Agenda e ${pages.length === 1 ? 'a página de agendamento publicada' : `as ${pages.length} páginas de agendamento publicadas`}: ${pages.join(', ')}` : 'Agenda desta conta'] : []),
    ...(grant && ['active', 'baselining'].includes(grant.status) ? ['Automação de e-mail desta caixa'] : []),
  ]
}

/** Reautoriza a mesma conexão (mesmo provedor e visibilidade, tudo o que ela já tem + e-mail) e atualiza a caixa. */
async function reconnectInbox(conn: CalendarConnection, onProgress?: ProgressFn) {
  const { connection } = await connectOAuth(conn.provider, 'account', onProgress, { scope: conn.scope, features: [...new Set([...conn.features, 'email' as const])], reauthorize: conn.id })
  useStore.getState().mutate((db) => ({ ...db, calendarConnections: [...db.calendarConnections.filter((row) => row.id !== connection.id), connection] }))
  toast.success('Caixa reconectada')
  await refreshEmail().catch((error) => toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar a caixa.'))
}

/**
 * Caixa conectada antes da permissão de organizar (gmail.modify / Mail.ReadWrite): leitura e envio seguem funcionando;
 * marcar como não lido, arquivar e excluir pedem uma nova autorização da mesma conta. A reconexão é confirmada antes e
 * não desconecta nada: agenda, páginas de agendamento publicadas (também pelo assistente) e automação da mesma conta
 * continuam funcionando; outra conta, ou a mesma conta com outro endereço principal, é recusada pelo motor sem alterar nada.
 * Só quem autorizou a conta pode reconectá-la.
 */
export function OrganizeAccessNotice({ inbox, className }: { inbox: EmailInbox; className?: string }) {
  const access = useInboxAccess(inbox)
  const me = useCurrentUser()
  const conn = useStore((st) => (inbox.connectionId ? st.db.calendarConnections.find((c) => c.id === inbox.connectionId) : undefined))
  const eventTypes = useStore((st) => st.db.eventTypes)
  const calendars = useStore((st) => st.db.engineScheduling?.calendars)
  const [open, setOpen] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const reason = inbox.engineEmail ? organizeBlockedReason(inbox) : null
  if (!reason) return null
  const onReconnect = !!inbox.engineEmail?.mailbox.organizeOnReconnect
  // O motor só aceita a reautorização de quem autorizou a conta (dono da conexão pessoal ou compartilhada).
  const canReconnect = access.canManage && !!conn && onReconnect && !!me?.id && conn.ownerUserId === me.id
  const text = canReconnect ? `${reason} Escolha a mesma conta ${providerLabel(inbox.provider)} (${inbox.address}).`
    : onReconnect ? `Esta caixa foi conectada só com permissão de leitura e envio. Para marcar como não lido, arquivar e mover para a lixeira, quem conectou ${inbox.address} precisa usar "Reconectar caixa" aqui no E-Mail IA.` : reason
  return (
    <Alert className={className} data-testid="email-organize-notice">
      <ShieldAlert />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 flex-1 basis-[260px]">{text}</span>
        {canReconnect && <Button size="sm" variant="outline" onClick={() => { setProgress(null); setOpen(true) }}>Reconectar caixa</Button>}
      </div>
      {canReconnect && conn && (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Reconectar caixa?"
          description={`O ${providerLabel(conn.provider)} vai pedir de novo a autorização de ${conn.email}, com todas as permissões que ela já tem e a de organizar e-mails. Escolha essa mesma conta.`}
          confirmLabel="Reconectar"
          destructive={false}
          onConfirm={() => reconnectInbox(conn, (p) => setProgress(p.label))}
        >
          <div className="space-y-2 text-sm" data-testid="email-reconnect-keeps">
            <p className="font-medium">Nada é desconectado. Continuam funcionando, sem republicar nem reativar:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {reconnectKeeps(inbox, conn, eventTypes, calendars ?? []).map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="text-muted-foreground">Se você escolher outra conta, a reconexão é recusada e nada é alterado. O mesmo vale se o endereço desta conta mudou no {providerLabel(conn.provider)}: a reconexão é recusada sem alterar nada, e a janela de autorização explica como passar a usar o novo endereço.</p>
            {progress && <p role="status" className="text-muted-foreground">{progress}</p>}
          </div>
        </ConfirmDialog>
      )}
    </Alert>
  )
}

/* ---------------------------------- Lista --------------------------------- */

export function FolderList({
  inbox,
  folder,
  messages,
  q,
  filters,
  onFiltersChange,
  onClearSearch,
  onOpen,
}: {
  inbox: EmailInbox
  folder: 'inbox' | 'sent'
  messages: EmailMessage[]
  q: string
  filters: MailFilter[]
  onFiltersChange: (f: MailFilter[]) => void
  onClearSearch: () => void
  onOpen: (id: string) => void
}) {
  const org = useCurrentOrg()
  const list = useMemo(() => filterMessages(messages, q, filters).sort((a, b) => b.date.localeCompare(a.date)), [messages, q, filters])
  const unread = messages.filter((m) => !m.read).length
  const syncOp = useOperation(async (onProgress) => syncMailbox(inbox, onProgress))
  const r = syncOp.result

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{folder === 'inbox' ? 'Caixa de entrada' : 'Enviados'}</h1>
          {folder === 'inbox' && unread > 0 && <Badge variant="brand" className="font-medium">{unread} não {unread === 1 ? 'lido' : 'lidos'}</Badge>}
        </div>
        {folder === 'inbox' && (
          <Button variant="outline" size="sm" className="gap-1.5" disabled={syncOp.isRunning} onClick={() => void syncOp.run()}>
            <RefreshCw className={cn('h-4 w-4', syncOp.isRunning && 'animate-spin')} /> Sincronizar
          </Button>
        )}
      </div>
      {folder === 'inbox' && (
        <OperationStatusView
          className="mb-4"
          status={syncOp.status}
          progress={syncOp.progress}
          error={syncOp.error}
          onRetry={() => void syncOp.retry()}
          successText={
            r && r.count > 0
              ? <>{r.count} novo e-mail sincronizado{r.drafted ? ` · ${r.drafted} rascunho automático criado` : ''}{r.sent ? ' · resposta enviada automaticamente' : ''}.</>
              : <>Nenhum e-mail novo.</>
          }
        />
      )}
      {folder === 'inbox' && <OrganizeAccessNotice inbox={inbox} className="mb-4" />}
      {(filters.length > 0 || q) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {q && (
            <button type="button" onClick={onClearSearch} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs font-medium hover:bg-muted">
              Busca: “{q}” <X className="h-3 w-3" />
            </button>
          )}
          {filters.map((f) => (
            <button key={f} type="button" onClick={() => onFiltersChange(filters.filter((x) => x !== f))} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs font-medium hover:bg-muted">
              {FILTER_LABEL[f]} <X className="h-3 w-3" />
            </button>
          ))}
          <span className="text-xs text-muted-foreground">{list.length} {list.length === 1 ? 'resultado' : 'resultados'}</span>
        </div>
      )}
      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            {folder === 'inbox' ? <Inbox className="h-5 w-5 text-muted-foreground" /> : <Send className="h-5 w-5 text-muted-foreground" />}
          </div>
          <p className="text-sm font-medium">{q || filters.length ? 'Nenhum e-mail encontrado' : folder === 'inbox' ? 'Caixa de entrada vazia' : 'Nenhum e-mail enviado ainda'}</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            {q || filters.length ? 'Ajuste a busca ou remova os filtros.' : folder === 'inbox' ? 'Use “Sincronizar” para buscar novos e-mails.' : 'As respostas enviadas pelo agente aparecem aqui.'}
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border divide-y" data-testid="mail-list">
          {list.map((m) => {
            const who = folder === 'sent' ? m.toName || m.to : m.fromName || m.from
            return (
              <li key={m.id}>
                <button type="button" onClick={() => onOpen(m.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50">
                  <span className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', !m.read ? 'bg-brand' : 'bg-transparent')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={cn('truncate text-sm', !m.read ? 'font-semibold' : 'font-medium')}>{folder === 'sent' ? `Para: ${who}` : who}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatMailDate(m.date)}</span>
                    </span>
                    <span className={cn('mt-0.5 block truncate text-sm', !m.read ? 'text-foreground' : 'text-foreground/90')}>{m.subject}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{m.body.replace(/\s+/g, ' ')}</span>
                    {(m.status !== 'new' || m.autoSent) && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {folder === 'inbox' && m.status === 'draft_ready' && m.draftSource !== 'manual' && <Badge variant="brand" className="gap-1 font-medium"><Sparkles className="h-3 w-3" /> Rascunho pronto</Badge>}
                        {folder === 'inbox' && m.status === 'draft_ready' && m.draftSource === 'manual' && <Badge variant="secondary" className="gap-1 font-medium"><Reply className="h-3 w-3" /> Rascunho</Badge>}
                        {folder === 'inbox' && m.status === 'replied' && <Badge variant="success" className="font-medium">Respondido</Badge>}
                        {m.autoSent && <Badge variant="secondary" className="gap-1 font-medium"><Bot className="h-3 w-3" /> Enviado automaticamente</Badge>}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* -------------------------------- Detalhe -------------------------------- */

export function MessageDetail({
  inbox,
  message,
  onBack,
  onOpen,
  canDraft,
  canReply = true,
  readOnlyReason,
}: {
  inbox: EmailInbox
  message: EmailMessage
  onBack: () => void
  onOpen: (id: string) => void
  canDraft: boolean
  /** função do usuário permite responder/excluir nesta caixa (ver inboxAccess) */
  canReply?: boolean
  readOnlyReason?: string
}) {
  const st = useStore.getState
  const [composer, setComposer] = useState<string | null>(message.aiDraft ?? null)
  const [fromAi, setFromAi] = useState(!!message.aiDraft && message.status !== 'replied' && message.draftSource !== 'manual')
  const [toDelete, setToDelete] = useState(false)
  const [sendTouched, setSendTouched] = useState(false)
  const [busy, setBusy] = useState<null | 'read' | 'archive' | 'discard'>(null)
  const organizeReason = !canReply ? readOnlyReason ?? 'Sem permissão para organizar e-mails nesta caixa.' : organizeBlockedReason(inbox)
  const canOrganize = !organizeReason
  const run = async (kind: 'read' | 'archive' | 'discard', action: () => Promise<unknown>, success?: string) => {
    if (busy) return false
    setBusy(kind)
    try { await action(); if (success) toast.success(success); return true }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a operação.'); return false }
    finally { setBusy(null) }
  }
  // Abrir um e-mail não lido marca como lido no provedor (como no Gmail/Outlook), uma vez por abertura.
  const autoRead = useRef<string | null>(null)
  useEffect(() => {
    if (message.folder !== 'inbox' || message.read || !canOrganize || autoRead.current === message.id) return
    autoRead.current = message.id
    void setMailRead(inbox, message, true).catch((error) => toast.error(error instanceof Error ? error.message : 'Não foi possível marcar o e-mail como lido.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id])
  const allMessages = useStore((s) => s.db.emailMessages)
  const replyMsg = useMemo(() => allMessages.find((m) => m.inReplyTo === message.id && m.folder === 'sent'), [allMessages, message.id])
  const original = useMemo(() => (message.inReplyTo ? allMessages.find((m) => m.id === message.inReplyTo) : undefined), [allMessages, message.inReplyTo])

  useEffect(() => {
    setComposer(message.aiDraft ?? null)
    setFromAi(!!message.aiDraft && message.draftSource !== 'manual')
    setSendTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id])

  const draftOp = useOperation(async (onProgress) => {
    const text = await draftFor(inbox, message, onProgress)
    setComposer(text)
    setFromAi(true)
    return text
  })
  const sendOp = useOperation(async (onProgress, body: string) => sendMailReply(inbox, message, body, onProgress))
  const knowledge = inbox.knowledgeItems ?? []
  const activeRules = inbox.rules.filter((r) => r.active).length
  const persistDraft = (text: string) => {
    if (text === message.aiDraft || !draftContent(text, inbox.settings.signature)) return
    if (!message.engineEmail?.draft) return
    void editMailDraft(inbox, message, text).catch(error => toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o rascunho.'))
  }
  const bodyErr = composer !== null && !draftContent(composer, inbox.settings.signature) ? 'Escreva a resposta antes de enviar.' : null

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-3 gap-1.5" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> {message.folder === 'inbox' ? 'Caixa de entrada' : 'Enviados'}
        </Button>
        <div className="flex items-center gap-1">
          {message.folder === 'inbox' && (
            <SimpleTooltip label={organizeReason ?? (message.read ? 'Marcar como não lido' : 'Marcar como lido')}>
              <span tabIndex={canOrganize ? undefined : 0} className="inline-flex">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={message.read ? 'Marcar como não lido' : 'Marcar como lido'}
                  aria-busy={busy === 'read' || undefined}
                  disabled={!canOrganize || !!busy}
                  onClick={async () => {
                    const unread = message.read
                    if (await run('read', () => setMailRead(inbox, message, !unread), unread ? 'Marcado como não lido' : 'Marcado como lido') && unread) onBack()
                  }}
                >
                  {message.read ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                </Button>
              </span>
            </SimpleTooltip>
          )}
          {message.folder === 'inbox' && (
            <SimpleTooltip label={organizeReason ?? 'Arquivar'}>
              <span tabIndex={canOrganize ? undefined : 0} className="inline-flex">
                <Button variant="ghost" size="icon-sm" aria-label="Arquivar e-mail" aria-busy={busy === 'archive' || undefined} disabled={!canOrganize || !!busy} onClick={async () => { if (await run('archive', () => archiveMail(inbox, message), 'E-mail arquivado')) onBack() }}>
                  <Archive className="h-4 w-4" />
                </Button>
              </span>
            </SimpleTooltip>
          )}
          <SimpleTooltip label={organizeReason ?? 'Excluir e-mail'}>
            <span tabIndex={canOrganize ? undefined : 0} className="inline-flex">
              <Button variant="ghost" size="icon-sm" aria-label="Excluir e-mail" disabled={!canOrganize || !!busy} onClick={() => setToDelete(true)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </span>
          </SimpleTooltip>
        </div>
      </div>

      {canReply && <OrganizeAccessNotice inbox={inbox} className="mb-6" />}
      <h1 className="text-xl font-semibold tracking-tight" data-testid="mail-subject">{message.subject}</h1>
      <div className="mt-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {initials(message.folder === 'sent' ? message.fromName || inbox.address : message.fromName || message.from) || '@'}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{message.fromName || message.from}</span>
            {message.fromName && <span className="truncate text-muted-foreground">&lt;{message.from}&gt;</span>}
          </div>
          <div className="truncate text-xs text-muted-foreground">Para: {message.toName ? `${message.toName} <${message.to}>` : message.to}</div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          {new Date(message.date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      <div className="mt-6 whitespace-pre-wrap rounded-xl border bg-background p-5 text-sm leading-6" data-testid="mail-body">{message.body}</div>

      {message.folder === 'sent' && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {message.autoSent ? <Badge variant="secondary" className="gap-1 font-medium"><Bot className="h-3 w-3" /> Enviado automaticamente pelo agente</Badge> : null}
          {original && <Button variant="link" className="h-auto p-0" onClick={() => onOpen(original.id)}>Ver e-mail original</Button>}
        </div>
      )}

      {message.folder === 'inbox' && (
        <section className="mt-8" aria-label="Resposta">
          {message.status === 'replied' ? (
            <Alert variant="success">
              <CheckCircle2 />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Respondido{replyMsg ? ` em ${new Date(replyMsg.date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}{replyMsg?.autoSent ? ' automaticamente pelo agente' : ''}.</span>
                {replyMsg && <Button size="xs" variant="outline" onClick={() => onOpen(replyMsg.id)}>Ver resposta</Button>}
              </div>
            </Alert>
          ) : !canReply ? (
            <Alert data-testid="mail-readonly">
              <Reply />
              <div>{message.status === 'draft_ready' && message.aiDraft ? 'Há um rascunho de resposta salvo para este e-mail. ' : ''}{readOnlyReason ?? 'Sua função não permite responder e-mails nesta caixa.'}</div>
            </Alert>
          ) : (
            <>
              {composer === null && (
                <div className="flex flex-wrap gap-2">
                  {canDraft ? (
                    <Button className="gap-1.5" onClick={() => void draftOp.run()} disabled={draftOp.isRunning}>
                      <Sparkles className="h-4 w-4" /> Gerar rascunho com IA
                    </Button>
                  ) : (
                    <SimpleTooltip label="Ative o agente de e-mail para gerar rascunhos.">
                      <span tabIndex={0}><Button className="gap-1.5" disabled><Sparkles className="h-4 w-4" /> Gerar rascunho com IA</Button></span>
                    </SimpleTooltip>
                  )}
                  <Button variant="outline" className="gap-1.5" disabled={draftOp.isRunning} onClick={() => { setComposer(`\n\n${inbox.settings.signature}`); setFromAi(false) }}>
                    <Reply className="h-4 w-4" /> Responder manualmente
                  </Button>
                </div>
              )}
              <OperationStatusView className="mt-3" status={draftOp.status === 'success' ? 'idle' : draftOp.status} progress={draftOp.progress} error={draftOp.error} onRetry={() => void draftOp.retry()} />
              {composer !== null && (
                <div className="mt-2 rounded-xl border p-4" data-testid="composer">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Resposta para {message.fromName || message.from}</span>
                    {fromAi && <Badge variant="brand" className="gap-1 font-medium"><Sparkles className="h-3 w-3" /> Rascunho da IA</Badge>}
                  </div>
                  {fromAi && (
                    <div className="mb-3 flex flex-wrap gap-1.5 text-xs text-muted-foreground" aria-label="Contexto aplicado">
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5"><FileText className="h-3 w-3" /> Contexto {inbox.context.trim() ? 'aplicado' : 'vazio'}</span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5"><ListChecks className="h-3 w-3" /> {activeRules} {activeRules === 1 ? 'regra ativa' : 'regras ativas'}</span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5" title={knowledge.map((k) => k.title).join(', ')}>
                        <BookOpen className="h-3 w-3" /> {knowledge.length ? `Conhecimento: ${knowledge.map((k) => k.title).join(', ')}` : 'Nenhum conhecimento relacionado'}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">Tom: {toneLabel(inbox.settings.tone)}</span>
                    </div>
                  )}
                  <Textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    onBlur={() => persistDraft(composer)}
                    className="min-h-[220px] text-sm leading-6"
                    aria-label="Texto da resposta"
                    aria-invalid={sendTouched && !!bodyErr}
                    disabled={sendOp.isRunning}
                  />
                  {sendTouched && bodyErr && <p className="mt-2 text-sm font-medium text-destructive">{bodyErr}</p>}
                  {inbox.settings.autoSend && <p className="mt-2 text-xs text-amber-700">Envio automático está ativo nesta caixa: novos e-mails são respondidos sem revisão.</p>}
                  <OperationStatusView className="mt-3" status={sendOp.status} progress={sendOp.progress} error={sendOp.error} onRetry={() => void sendOp.retry()} successText="Resposta aceita pelo provedor." />
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      disabled={sendOp.isRunning || draftOp.isRunning || busy === 'discard'}
                      onClick={async () => {
                        // Rascunho salvo no motor é descartado lá (some também após recarregar); texto só local é apenas limpo.
                        if (message.engineEmail?.draft && !(await run('discard', () => discardMailDraft(inbox, message)))) return
                        setComposer(null)
                        setFromAi(false)
                        draftOp.reset()
                        sendOp.reset()
                        toast.success('Rascunho descartado')
                      }}
                    >
                      Descartar
                    </Button>
                    {canDraft && (
                      <Button variant="outline" className="gap-1.5" disabled={sendOp.isRunning || draftOp.isRunning} onClick={() => void draftOp.run()}>
                        <RotateCcw className="h-4 w-4" /> Gerar novamente
                      </Button>
                    )}
                    <Button
                      className="gap-1.5"
                      disabled={sendOp.isRunning || draftOp.isRunning}
                      onClick={async () => {
                        setSendTouched(true)
                        if (!composer || bodyErr) return
                        const sent = await sendOp.run(composer.trim())
                        if (sent) toast.success('Resposta aceita pelo provedor', { description: `Para ${message.from}` })
                      }}
                    >
                      <Send className="h-4 w-4" /> Enviar
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <ConfirmDialog
        open={toDelete}
        onOpenChange={setToDelete}
        title="Excluir e-mail?"
        description={`O e-mail será movido para a lixeira ${inbox.provider === 'google' ? 'do Gmail' : 'do Outlook (Itens excluídos)'}, onde pode ser recuperado. Ele também sai da caixa na Kloel.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          await trashMail(inbox, message)
          toast.success('E-mail movido para a lixeira', { description: message.subject })
          onBack()
        }}
      />
    </div>
  )
}
