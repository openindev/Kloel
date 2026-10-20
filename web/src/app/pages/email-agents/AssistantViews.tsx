import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Pencil, Sparkles, Search, BookOpen, ListChecks, TriangleAlert, ExternalLink, RefreshCw, Unplug, Check, X, Lock, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import type { EmailKnowledgeItem } from '@/domain/ext/mais-b'
import type { EmailInbox } from '@/domain/types'
import { useCurrentOrg, useStore } from '@/data/store'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { OpStatus as OperationStatusView } from '@/app/pages/phone-numbers/OpStatus'
import type { OperationStatus } from '@/hooks/useOperation'
import { SettingsCard, SettingsRow } from '@/components/app/Page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Alert } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { useOperation } from '@/hooks/useOperation'
import { services } from '@/services'
import { uid } from '@/lib/utils'
import { ProviderIcon, providerLabel } from '@/app/pages/company-settings/connections'
import { TONES } from './mailbox'
import { saveEmailInbox, disconnectEmailInbox } from '@/services/casca/email'
import { OrganizeAccessNotice } from './MailboxViews'

function Heading({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions}
    </div>
  )
}

const patchInbox = saveEmailInbox
async function emailAction(action: () => Promise<unknown>, success: string) { try { await action(); toast.success(success); return true } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.'); return false } }

/** Aviso de somente leitura (função sem permissão nesta caixa). */
function ReadOnlyNotice({ reason }: { reason: string }) {
  return (
    <Alert className="mb-6" data-testid="email-readonly-notice">
      <Lock />
      <div>{reason}</div>
    </Alert>
  )
}

/** Envolve um controle desabilitado por permissão com o tooltip explicativo. */
function Gate({ allowed, reason, children, className }: { allowed: boolean; reason: string; children: ReactNode; className?: string }) {
  if (allowed) return <>{children}</>
  return (
    <SimpleTooltip label={reason}>
      <span tabIndex={0} className={className ?? 'inline-flex'}>{children}</span>
    </SimpleTooltip>
  )
}

/* --------------------------------- Contexto -------------------------------- */

export function ContextView({ inbox, canEdit = true, readOnlyReason = '' }: { inbox: EmailInbox; canEdit?: boolean; readOnlyReason?: string }) {
  const org = useCurrentOrg()
  const [text, setText] = useState(inbox.context)
  useEffect(() => setText(inbox.context), [inbox.id, inbox.context])
  const dirty = text !== inbox.context
  const fillOp = useOperation(async (onProgress) => {
    if (!org?.website) throw new Error('Cadastre o site da empresa para preencher automaticamente.')
    if (!inbox.engineEmail) throw Error('Ative o agente desta caixa primeiro.')
    return services.ai.generateCompanyInfo(org.website, onProgress, { agentId: inbox.engineEmail.mailbox.agentId })
  })
  const MAX = 4000
  return (
    <div>
      <Heading title="Contexto" description="Explique ao agente quem é a sua empresa, o que ele deve fazer nesta caixa de correio e como as respostas devem soar." />
      {!canEdit && <ReadOnlyNotice reason={readOnlyReason} />}
      <div className="grid gap-2">
        <Label htmlFor="mail-context">Contexto do agente</Label>
        <Textarea
          id="mail-context"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          readOnly={!canEdit}
          className="min-h-[280px] leading-6 read-only:bg-muted/30"
          placeholder={`Ex.: Você responde aos e-mails da ${org?.name ?? 'empresa'}. Atendemos de segunda a sexta, das 9h às 18h. Sempre ofereça um horário para retorno e nunca prometa valores sem confirmação.`}
        />
        <div className="flex justify-end text-xs tabular-nums text-muted-foreground">{text.length} / {MAX}</div>
      </div>
      <OperationStatusView className="mt-2" status={fillOp.status} progress={fillOp.progress} error={fillOp.error} onRetry={() => void fillOp.retry()} successText="Texto sugerido inserido — revise e salve." />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Gate allowed={canEdit} reason={readOnlyReason}>
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={fillOp.isRunning || !canEdit}
            onClick={async () => {
              const r = await fillOp.run()
              if (r) setText((t) => (t.trim() ? `${t.trim()}\n\n${r}` : r).slice(0, MAX))
            }}
          >
            <Sparkles className="h-4 w-4" /> Preencher com dados da empresa
          </Button>
        </Gate>
        <div className="flex gap-2">
          {dirty && canEdit && <Button variant="ghost" onClick={() => setText(inbox.context)}>Descartar</Button>}
          <Gate allowed={canEdit} reason={readOnlyReason}>
            <Button
              disabled={!dirty || !canEdit}
              onClick={() => void emailAction(() => patchInbox(inbox.id, { context: text }), 'Contexto salvo')}
            >
              Salvar
            </Button>
          </Gate>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------- Regras --------------------------------- */

/** Validação comum de Adicionar e Editar regra (`exceptId` = regra em edição). */
function ruleError(text: string, rules: EmailInbox['rules'], exceptId?: string) {
  const t = text.trim()
  if (t.length < 5) return 'Descreva a regra com pelo menos 5 caracteres.'
  if (rules.some((r) => r.id !== exceptId && r.text.trim().toLowerCase() === t.toLowerCase())) return 'Esta regra já existe.'
  return null
}

export function RulesView({ inbox, canEdit = true, readOnlyReason = '' }: { inbox: EmailInbox; canEdit?: boolean; readOnlyReason?: string }) {
  const [draft, setDraft] = useState('')
  const [touched, setTouched] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [toDelete, setToDelete] = useState<string | null>(null)
  const err = ruleError(draft, inbox.rules)
  const editErr = editing ? ruleError(editing.text, inbox.rules, editing.id) : null
  const setRules = (fn: (r: EmailInbox['rules']) => EmailInbox['rules']) => patchInbox(inbox.id, (p) => ({ ...p, rules: fn(p.rules) }))
  return (
    <div>
      <Heading title="Regras" description="Regras que o agente sempre segue ao organizar e-mails e preparar respostas. Desative uma regra para ignorá-la temporariamente." />
      {!canEdit && <ReadOnlyNotice reason={readOnlyReason} />}
      <form
        className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!canEdit) return
          setTouched(true)
          if (err) return
          if (await emailAction(() => setRules((r) => [...r, { id: uid('rul'), active: true, text: draft.trim() }]), 'Regra adicionada')) { setDraft(''); setTouched(false) }
        }}
      >
        <div className="flex-1">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ex.: Nunca prometa prazos de entrega." aria-label="Nova regra" aria-invalid={touched && !!err} disabled={!canEdit} />
          {touched && err && <p className="mt-1.5 text-sm font-medium text-destructive">{err}</p>}
        </div>
        <Gate allowed={canEdit} reason={readOnlyReason}>
          <Button type="submit" className="gap-1.5" disabled={!canEdit}><Plus className="h-4 w-4" /> Adicionar regra</Button>
        </Gate>
      </form>
      {inbox.rules.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <ListChecks className="mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">Nenhuma regra criada ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">Adicione regras como “Responda sempre em português”.</p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border" data-testid="rules-list">
          {inbox.rules.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
              <Gate allowed={canEdit} reason={readOnlyReason} className="mt-0.5 inline-flex">
                <Switch
                  checked={r.active}
                  className={canEdit ? 'mt-0.5' : undefined}
                  disabled={!canEdit}
                  aria-label={r.active ? 'Desativar regra' : 'Ativar regra'}
                  onCheckedChange={(v) => void emailAction(() => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, active: v } : x))), 'Regra atualizada')}
                />
              </Gate>
              {editing?.id === r.id ? (
                <form
                  className="flex flex-1 flex-col gap-1.5"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (editErr) return
                    if (await emailAction(() => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, text: editing.text.trim() } : x))), 'Regra atualizada')) setEditing(null)
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Input autoFocus value={editing.text} onChange={(e) => setEditing({ id: r.id, text: e.target.value })} aria-label="Editar regra" aria-invalid={!!editErr} className="h-9" />
                    <Button type="submit" size="icon-sm" aria-label="Salvar regra" disabled={!!editErr}><Check className="h-4 w-4" /></Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
                  </div>
                  {editErr && <p className="text-sm font-medium text-destructive" data-testid="rule-edit-error">{editErr}</p>}
                </form>
              ) : (
                <>
                  <span className={r.active ? 'flex-1 text-sm' : 'flex-1 text-sm text-muted-foreground line-through decoration-muted-foreground/40'}>{r.text}</span>
                  <SimpleTooltip label={canEdit ? 'Editar regra' : readOnlyReason}>
                    <span tabIndex={canEdit ? undefined : 0} className="inline-flex">
                      <Button variant="ghost" size="icon-xs" aria-label="Editar regra" disabled={!canEdit} onClick={() => setEditing({ id: r.id, text: r.text })}><Pencil className="h-3.5 w-3.5" /></Button>
                    </span>
                  </SimpleTooltip>
                  <SimpleTooltip label={canEdit ? 'Excluir regra' : readOnlyReason}>
                    <span tabIndex={canEdit ? undefined : 0} className="inline-flex">
                      <Button variant="ghost" size="icon-xs" aria-label="Excluir regra" disabled={!canEdit} onClick={() => setToDelete(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </span>
                  </SimpleTooltip>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir regra?"
        description={inbox.rules.find((r) => r.id === toDelete)?.text}
        confirmLabel="Excluir"
        onConfirm={async () => {
          await setRules((rs) => rs.filter((x) => x.id !== toDelete))
          toast.success('Regra excluída')
        }}
      />
    </div>
  )
}

/* ------------------------------- Conhecimento ------------------------------ */

export function KnowledgeView({ inbox, canEdit = true, readOnlyReason = '' }: { inbox: EmailInbox; canEdit?: boolean; readOnlyReason?: string }) {
  const items = inbox.knowledgeItems ?? []
  const [entryAttemptId, setEntryAttemptId] = useState(() => uid('ekn'))
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<{ id?: string; title: string; content: string } | null>(null)
  const [touched, setTouched] = useState(false)
  const [toDelete, setToDelete] = useState<EmailKnowledgeItem | null>(null)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...items].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)).filter((k) => !t || `${k.title} ${k.content}`.toLowerCase().includes(t))
  }, [items, q])
  const setItems = (fn: (l: EmailKnowledgeItem[]) => EmailKnowledgeItem[]) => patchInbox(inbox.id, (p) => ({ ...p, knowledgeItems: fn(p.knowledgeItems ?? []) }))
  const errs = edit ? { title: edit.title.trim().length < 3 ? 'Informe um título (mín. 3 caracteres).' : null, content: edit.content.trim().length < 10 ? 'Escreva o conteúdo (mín. 10 caracteres).' : null } : { title: null, content: null }
  return (
    <div>
      <Heading
        title="Conhecimento"
        description="Informações que o agente usa para responder: preços, endereços, políticas, perguntas frequentes."
        actions={
          <Gate allowed={canEdit} reason={readOnlyReason}>
            <Button className="gap-1.5" disabled={!canEdit} onClick={() => { setEntryAttemptId(uid('ekn')); setEdit({ title: '', content: '' }); setTouched(false) }}><Plus className="h-4 w-4" /> Adicionar entrada</Button>
          </Gate>
        }
      />
      {!canEdit && <ReadOnlyNotice reason={readOnlyReason} />}
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" aria-label="Pesquisar conhecimento" className="pl-9" />
      </div>
      {list.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <BookOpen className="mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">{q ? 'Nenhuma entrada encontrada' : 'Nenhuma entrada de conhecimento'}</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{q ? 'Tente outro termo de busca.' : 'Adicione, por exemplo, “Formas de pagamento” ou “Endereço e estacionamento”. O agente cita as entradas relacionadas ao redigir rascunhos.'}</p>
        </div>
      ) : (
        <ul className="grid gap-3" data-testid="knowledge-list">
          {list.map((k) => (
            <li key={k.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{k.title}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">{k.content}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Atualizado em {new Date(k.updatedAt ?? k.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <SimpleTooltip label={canEdit ? 'Editar' : readOnlyReason}><span tabIndex={canEdit ? undefined : 0} className="inline-flex"><Button variant="ghost" size="icon-xs" aria-label="Editar entrada" disabled={!canEdit} onClick={() => { setEdit({ id: k.id, title: k.title, content: k.content }); setTouched(false) }}><Pencil className="h-3.5 w-3.5" /></Button></span></SimpleTooltip>
                  <SimpleTooltip label={canEdit ? 'Excluir' : readOnlyReason}><span tabIndex={canEdit ? undefined : 0} className="inline-flex"><Button variant="ghost" size="icon-xs" aria-label="Excluir entrada" disabled={!canEdit} onClick={() => setToDelete(k)}><Trash2 className="h-3.5 w-3.5" /></Button></span></SimpleTooltip>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="gap-y-4">
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setTouched(true)
              if (!edit || errs.title || errs.content) return
              const now = new Date().toISOString()
              const saved = await emailAction(() => edit.id ? setItems((l) => l.map((x) => (x.id === edit.id ? { ...x, title: edit.title.trim(), content: edit.content.trim(), updatedAt: now } : x))) : setItems((l) => [...l, { id: entryAttemptId, title: edit.title.trim(), content: edit.content.trim(), createdAt: now }]), edit.id ? 'Entrada atualizada' : 'Entrada adicionada')
              if (saved) setEdit(null)
            }}
          >
            <DialogHeader><DialogTitle>{edit?.id ? 'Editar entrada' : 'Nova entrada de conhecimento'}</DialogTitle></DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="kn-title" className={touched && errs.title ? 'text-destructive' : undefined}>Título</Label>
              <Input id="kn-title" autoFocus value={edit?.title ?? ''} onChange={(e) => edit && setEdit({ ...edit, title: e.target.value })} placeholder="Ex.: Formas de pagamento" aria-invalid={touched && !!errs.title} />
              {touched && errs.title && <p className="text-sm font-medium text-destructive">{errs.title}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kn-content" className={touched && errs.content ? 'text-destructive' : undefined}>Conteúdo</Label>
              <Textarea id="kn-content" value={edit?.content ?? ''} onChange={(e) => edit && setEdit({ ...edit, content: e.target.value })} className="min-h-[160px]" placeholder="Ex.: Aceitamos Pix, cartão de crédito em até 6x sem juros e boleto." aria-invalid={touched && !!errs.content} />
              {touched && errs.content && <p className="text-sm font-medium text-destructive">{errs.content}</p>}
            </div>
            <DialogFooter className="mt-2">
              <Button type="button" variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir entrada?"
        description={toDelete ? <>“{toDelete.title}” deixará de ser usada pelo agente.</> : null}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (!toDelete) return
          await setItems((l) => l.filter((x) => x.id !== toDelete.id))
          toast.success('Entrada excluída')
        }}
      />
    </div>
  )
}

/* ------------------------------ Configurações ------------------------------ */

/** Em telas estreitas a coluna do controle do SettingsRow podia encolher a 0 e o Switch sobrepunha a descrição. */
const SWITCH_ROW = '[&>div:last-child]:flex-none'

export interface ActivationState {
  status: OperationStatus
  progress: { label: string; percent: number }
  error?: string
  isRunning: boolean
  retry: () => void
  reset: () => void
}

export function SettingsView({
  inbox,
  canManage = true,
  readOnlyReason = '',
  activation,
  onRequestActivate,
  onDisconnected,
}: {
  inbox: EmailInbox
  canManage?: boolean
  readOnlyReason?: string
  /** ciclo da ativação simulada (mesma operação do cartão "Ativar agente de e-mail" da Caixa de entrada) */
  activation?: ActivationState
  onRequestActivate: () => void
  onDisconnected: () => void
}) {
  const [signature, setSignature] = useState(inbox.settings.signature)
  useEffect(() => setSignature(inbox.settings.signature), [inbox.id, inbox.settings.signature])
  const [autoSendWarn, setAutoSendWarn] = useState(false)
  const [disconnect, setDisconnect] = useState(false)
  const setSettings = async (p: Partial<EmailInbox['settings']>) => {
    if (!canManage) throw Error('Seu acesso não permite editar esta caixa.')
    await patchInbox(inbox.id, (prev) => ({ ...prev, settings: { ...prev.settings, ...p } }))
  }
  const activating = !!activation?.isRunning
  const conn = useStore((st) => (inbox.connectionId ? st.db.calendarConnections.find((c) => c.id === inbox.connectionId) : undefined))
  const g = (node: ReactNode, className?: string) => <Gate allowed={canManage} reason={readOnlyReason} className={className}>{node}</Gate>
  return (
    <div>
      <Heading title="Configurações" description="Defina como o agente trabalha nesta caixa de correio." />
      {!canManage && <ReadOnlyNotice reason={readOnlyReason} />}
      <SettingsCard>
        <SettingsRow
          wrapDescription
          className={SWITCH_ROW}
          label="Ativar agente de e-mail"
          description={activating ? 'Ativando o agente…' : inbox.agentEnabled ? 'O agente está ativado nesta caixa de correio.' : 'O agente está desativado nesta caixa.'}
        >
          {g(
            <Switch
              checked={inbox.agentEnabled || activating}
              disabled={!canManage || activating}
              aria-label="Ativar agente de e-mail"
              aria-busy={activating || undefined}
              onCheckedChange={async (v) => {
                if (!canManage) return
                if (v) onRequestActivate()
                else if (await emailAction(() => patchInbox(inbox.id, { agentEnabled: false }), 'Agente de e-mail desativado')) activation?.reset()
              }}
            />,
          )}
        </SettingsRow>
        <SettingsRow wrapDescription className={SWITCH_ROW} label="Rascunhos automáticos" description="Prepara um rascunho de resposta para cada e-mail novo.">
          {g(<Switch checked={inbox.settings.autoDraft} disabled={!canManage} aria-label="Rascunhos automáticos" onCheckedChange={(v) => { if (!canManage) return; void emailAction(() => setSettings({ autoDraft: v, ...(v ? {} : { autoSend: false }) }), v ? 'Rascunhos automáticos ativados' : 'Rascunhos automáticos desativados') }} />)}
        </SettingsRow>
        <SettingsRow wrapDescription className={SWITCH_ROW} label="Envio automático" description="Envia as respostas sem revisão humana.">
          {g(
            <Switch
              checked={inbox.settings.autoSend}
              disabled={!canManage}
              aria-label="Envio automático"
              onCheckedChange={(v) => {
                if (!canManage) return
                if (v) setAutoSendWarn(true)
                else {
                  void emailAction(() => setSettings({ autoSend: false }), 'Envio automático desativado')
                }
              }}
            />,
          )}
        </SettingsRow>
        <SettingsRow wrapDescription label="Tom das respostas">
          {g(
            <Select value={inbox.settings.tone} disabled={!canManage} onValueChange={(v) => void emailAction(() => setSettings({ tone: v }), 'Tom atualizado')}>
              <SelectTrigger className="w-[220px] max-w-full" aria-label="Tom das respostas"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>,
            'inline-flex max-w-full',
          )}
        </SettingsRow>
      </SettingsCard>
      {activation && (
        <OperationStatusView
          className="mt-4"
          status={activation.status}
          progress={activation.progress}
          error={activation.error}
          onRetry={canManage ? activation.retry : undefined}
          successText="Agente de e-mail ativado."
        />
      )}
      {inbox.settings.autoSend && (
        <Alert variant="warning" className="mt-4">
          <TriangleAlert />
          <div>O envio automático está ativo: novos e-mails sincronizados recebem resposta sem revisão.</div>
        </Alert>
      )}

      <div className="mt-8 grid gap-2">
        <Label htmlFor="mail-signature">Assinatura</Label>
        <Textarea id="mail-signature" value={signature} readOnly={!canManage} onChange={(e) => setSignature(e.target.value)} className="min-h-[110px] read-only:bg-muted/30" />
        <div className="flex justify-end gap-2">
          {canManage && signature !== inbox.settings.signature && <Button variant="ghost" onClick={() => setSignature(inbox.settings.signature)}>Descartar</Button>}
          {g(<Button disabled={!canManage || signature === inbox.settings.signature} onClick={() => void emailAction(() => setSettings({ signature }), 'Assinatura salva')}>Salvar assinatura</Button>)}
        </div>
      </div>

      <div className="mt-10 rounded-xl border p-5">
        <div className="flex flex-wrap items-center gap-3">
          <ProviderIcon provider={inbox.provider} className="size-6" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{inbox.address}</div>
            <div className="text-xs text-muted-foreground">
              {providerLabel(inbox.provider)} · conectada em {new Date(inbox.connectedAt).toLocaleDateString('pt-BR')}
              {inbox.lastSyncedAt && <> · última sincronização {new Date(inbox.lastSyncedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {inbox.provider === 'microsoft' ? (
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <a href="/ajuda/developers/microsoft" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Guia de conexão (Microsoft)</a>
            </Button>
          ) : (
            // Não há guia de conexão Google na Central de ajuda: leva à tela que gerencia a conexão.
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <Link to="/app/company-settings?tab=connections"><Settings2 className="h-4 w-4" /> Gerenciar conexões de contas</Link>
            </Button>
          )}
          {g(
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" disabled={!canManage} onClick={() => setDisconnect(true)}>
              <Unplug className="h-4 w-4" /> Desconectar caixa de entrada
            </Button>,
          )}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><RefreshCw className="h-3 w-3" /> Use “Sincronizar” na Caixa de entrada para buscar novos e-mails.</p>
        {canManage && <OrganizeAccessNotice inbox={inbox} className="mt-4" />}
      </div>

      <ConfirmDialog
        open={autoSendWarn}
        onOpenChange={setAutoSendWarn}
        title="Ativar envio automático?"
        description="O agente enviará respostas sem que ninguém revise. Use apenas quando o contexto, as regras e o conhecimento estiverem completos. Os rascunhos automáticos também serão ativados."
        confirmLabel="Ativar envio automático"
        destructive={false}
        onConfirm={async () => {
          await setSettings({ autoSend: true, autoDraft: true })
          toast.success('Envio automático ativado')
        }}
      >
        <Alert variant="warning"><TriangleAlert /><div>Respostas incorretas podem chegar aos seus clientes.</div></Alert>
      </ConfirmDialog>
      <ConfirmDialog
        open={disconnect}
        onOpenChange={setDisconnect}
        title="Desconectar caixa de entrada?"
        description={
          <>
            A caixa <b>{inbox.address}</b> sai do E-Mail IA: o contexto, as regras, a automação e a cópia dos e-mails sincronizados na Kloel serão removidos
            (as entradas de conhecimento continuam na base). Nada é apagado no {providerLabel(inbox.provider) === 'Google' ? 'Gmail' : 'Outlook'}.
            {conn && (conn.features.some((f) => f !== 'email') ? <> A conexão da conta continua ativa para Agenda.</> : <> A conexão da conta em Configurações da empresa também será removida.</>)}
          </>
        }
        confirmLabel="Desconectar"
        onConfirm={async () => {
          if (!canManage) return
          await disconnectEmailInbox(inbox.id)
          toast.success('Caixa de entrada desconectada', { description: inbox.address })
          onDisconnected()
        }}
      />
    </div>
  )
}
