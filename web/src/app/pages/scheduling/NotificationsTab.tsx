import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bell, Calendar, Check, Mail, MessageSquare, Plus, RotateCcw, SlidersHorizontal, SquarePen, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { EventReminder, MessageTemplate, NotificationTemplates, TemplateKind } from '@/domain/ext/scheduling'
import '@/domain/ext/scheduling'
import { cn, uid } from '@/lib/utils'
import { useCurrentOrg, useStore } from '@/data/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { REMINDER_TEMPLATE, TEMPLATE_KINDS, TEMPLATE_KIND_LABEL, defaultTemplates, hoursLabel, smsSenderOf } from './model'
import { smsQuotaOf } from './slots'
import { TemplateEditor, TemplatePreview } from './TemplateEditor'
import { CompactSelect, MiniEmpty, type Draft, type Errors, type SetDraft } from './EventTypeTabs'
import { loadNotificationHistory, NOTIFICATION_EVENT_LABEL, NOTIFICATION_STATUS_LABEL } from '@/services/casca/scheduling'
import type { NotificationRecord } from '@/services/engine/scheduling'

/**
 * Aba Notificações (AP-04/AP-05): canais E-mails / Calendário, remetente, "Notificações padrão"
 * (Confirmação / Reagendamento / Cancelamento) com prévia e edição com variáveis, e lembretes. O motor envia os
 * e-mails pela Resend (scheduling-notifications.ts) e usa o modelo do Calendário no evento criado no calendário conectado.
 */

type Channel = 'email' | 'sms' | 'calendar'
const CHANNELS: { id: Channel; slug: string; label: string; short?: string; icon: typeof Mail }[] = [
  { id: 'email', slug: 'email', label: 'E-mails', icon: Mail },
  { id: 'calendar', slug: 'calendario', label: 'Calendário', icon: Calendar },
]
const REMINDER_HOURS = [1, 2, 4, 12, 24, 48, 72]
const MAX_REMINDERS = 5

/** Erros da aba (as chaves começam com tpl-/rem-/sender-, ver `validate` em SchedulingPage). */
export function notificationErrors(d: Draft): Errors {
  const e: Errors = {}
  const t = d.templates
  if (!t) return e
  const empty = (html: string) => !html.replace(/<br>|<\/?div>|&nbsp;|\s/g, '')
  // Vazio = nome da empresa (o motor usa o nome da organização).
  if (t.emailSenderName.trim().length > 60) e['sender-email'] = 'Use no máximo 60 caracteres.'
  for (const k of TEMPLATE_KINDS) {
    if (empty(t.email[k].subject)) e[`tpl-email-${k}-subject`] = 'O assunto não pode ficar vazio.'
    else if (t.email[k].subject.length > 2000) e[`tpl-email-${k}-subject`] = 'O assunto ficou longo demais.'
    if (empty(t.email[k].body)) e[`tpl-email-${k}-body`] = 'A mensagem não pode ficar vazia.'
    else if (t.email[k].body.length > 8000) e[`tpl-email-${k}-body`] = 'A mensagem ficou longa demais.'
  }
  if (empty(t.calendar.subject)) e['tpl-calendar-subject'] = 'O título não pode ficar vazio.'
  const seen = new Set<string>()
  for (const r of d.reminders ?? []) {
    const key = `${r.channel}-${r.hoursBefore}`
    if (seen.has(key)) e[`rem-${r.id}`] = 'Já existe um lembrete com esta antecedência.'
    seen.add(key)
  }
  return e
}

/** Botão de ajustes do cabeçalho (ícone sliders-horizontal da referência). */
export function NotificationPrefs({ draft, set }: { draft: Draft; set: SetDraft }) {
  const n = draft.notifications
  const setN = (p: Partial<Draft['notifications']>) => set((d) => ({ ...d, notifications: { ...d.notifications, ...p } }))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Preferências de notificação">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">Preferências de notificação</p>
        <div className="flex flex-col divide-y">
          <label className="flex items-start justify-between gap-3 px-4 py-3">
            <span>
              <span className="block text-sm font-medium">Notificações padrão ao convidado</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Confirmação, reagendamento e cancelamento.</span>
            </span>
            <Switch aria-label="Notificações padrão ao convidado" checked={n.confirmationEmail} onCheckedChange={(v) => setN({ confirmationEmail: v })} />
          </label>
          <label className="flex items-start justify-between gap-3 px-4 py-3">
            <span>
              <span className="block text-sm font-medium">Notificar a equipe</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Avisa por e-mail o dono do calendário a cada novo agendamento, reagendamento ou cancelamento.</span>
            </span>
            <Switch aria-label="Notificar a equipe" checked={n.notifyTeam} onCheckedChange={(v) => setN({ notifyTeam: v })} />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SubTabs<T extends string>({ value, onChange, options, ariaLabel, dots }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode }[]; ariaLabel: string; dots?: Partial<Record<T, boolean>> }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'relative inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition-colors',
            value === o.id ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
          {dots?.[o.id] && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-destructive" aria-label="com erro" />}
        </button>
      ))}
    </div>
  )
}

function SenderAvatar({ name }: { name: string }) {
  return <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-medium uppercase text-background">{(name.trim()[0] ?? 'K').toUpperCase()}</span>
}

function TemplateCard({
  title,
  channel,
  templates,
  onChange,
  onReset,
  sender,
  errors,
  disabledNote,
}: {
  title: string
  channel: 'email' | 'sms'
  templates: Record<TemplateKind, MessageTemplate>
  onChange: (k: TemplateKind, t: MessageTemplate) => void
  onReset: () => void
  sender: string
  errors: Errors
  disabledNote?: ReactNode
}) {
  const [kind, setKind] = useState<TemplateKind>('confirmation')
  const [editing, setEditing] = useState(false)
  const tpl = templates[kind]
  const err = (f: 'subject' | 'body') => errors[`tpl-${channel}-${kind}-${f}`]
  const dots = Object.fromEntries(TEMPLATE_KINDS.map((k) => [k, !!(errors[`tpl-${channel}-${k}-subject`] || errors[`tpl-${channel}-${k}-body`])])) as Record<TemplateKind, boolean>
  return (
    <div className="rounded-xl border" data-testid={`templates-${channel}`}>
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
        <p className="text-sm font-medium">{title}</p>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Restaurar modelos padrão" className="text-muted-foreground" onClick={onReset}>
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      <div className="px-4">
        <SubTabs ariaLabel="Notificação" value={kind} onChange={setKind} dots={dots} options={TEMPLATE_KINDS.map((k) => ({ id: k, label: TEMPLATE_KIND_LABEL[k] }))} />
      </div>
      {disabledNote && <p className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900">{disabledNote}</p>}
      <div className="px-4 pb-4 pt-4">
        {!editing ? (
          <div className="flex flex-col gap-3 text-sm" data-testid="template-preview">
            <div className="flex items-center gap-2">
              <SenderAvatar name={sender} />
              <span className="text-[15px]">{channel === 'email' ? `${sender} via Kloel` : sender}</span>
            </div>
            {channel === 'email' && (
              <div>
                <p className="text-muted-foreground">Assunto:</p>
                <TemplatePreview html={tpl.subject} inline className="leading-7" />
              </div>
            )}
            <div>
              <p className="text-muted-foreground">Mensagem:</p>
              <TemplatePreview html={tpl.body} className="leading-7" />
            </div>
            {(err('subject') || err('body')) && <p className="text-sm font-medium text-destructive">{err('subject') ?? err('body')}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {channel === 'email' && (
              <div>
                <p className="mb-2 text-sm font-medium">Assunto</p>
                <TemplateEditor key={`${kind}-s`} singleLine ariaLabel="Assunto" value={tpl.subject} invalid={!!err('subject')} onChange={(html) => onChange(kind, { ...tpl, subject: html })} />
                {err('subject') && <p className="mt-1.5 text-sm font-medium text-destructive">{err('subject')}</p>}
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-medium">Mensagem</p>
              <TemplateEditor key={`${kind}-b`} ariaLabel="Mensagem" value={tpl.body} invalid={!!err('body')} onChange={(html) => onChange(kind, { ...tpl, body: html })} />
              {err('body') && <p className="mt-1.5 text-sm font-medium text-destructive">{err('body')}</p>}
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-center border-t py-1.5">
        <Button type="button" variant="ghost" size="xs" className="gap-1.5 text-sm font-normal text-brand hover:text-brand" onClick={() => setEditing((v) => !v)}>
          {editing ? <Check className="size-4" /> : <SquarePen className="size-4" />}
          {editing ? 'Concluir' : 'Editar'}
        </Button>
      </div>
    </div>
  )
}

function CalendarCard({ value, onChange, onReset, errors }: { value: MessageTemplate; onChange: (t: MessageTemplate) => void; onReset: () => void; errors: Errors }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="rounded-xl border" data-testid="templates-calendar">
      <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-4">
        <p className="text-sm font-medium">Convite do calendário</p>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Restaurar convite padrão" className="text-muted-foreground" onClick={onReset}>
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      <p className="px-4 text-xs text-muted-foreground">Título e descrição do evento criado no calendário conectado. O convidado e os convidados fixos recebem o convite (.ics) por e-mail.</p>
      <div className="px-4 pb-4 pt-4">
        {!editing ? (
          <div className="flex flex-col gap-3 text-sm" data-testid="template-preview">
            <div>
              <p className="text-muted-foreground">Título do evento:</p>
              <TemplatePreview html={value.subject} inline className="leading-7" />
            </div>
            <div>
              <p className="text-muted-foreground">Descrição:</p>
              <TemplatePreview html={value.body} className="leading-7" />
            </div>
            {errors['tpl-calendar-subject'] && <p className="text-sm font-medium text-destructive">{errors['tpl-calendar-subject']}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-sm font-medium">Título do evento</p>
              <TemplateEditor singleLine ariaLabel="Título do evento" value={value.subject} invalid={!!errors['tpl-calendar-subject']} onChange={(html) => onChange({ ...value, subject: html })} />
              {errors['tpl-calendar-subject'] && <p className="mt-1.5 text-sm font-medium text-destructive">{errors['tpl-calendar-subject']}</p>}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Descrição</p>
              <TemplateEditor ariaLabel="Descrição do convite" value={value.body} onChange={(html) => onChange({ ...value, body: html })} />
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-center border-t py-1.5">
        <Button type="button" variant="ghost" size="xs" className="gap-1.5 text-sm font-normal text-brand hover:text-brand" onClick={() => setEditing((v) => !v)}>
          {editing ? <Check className="size-4" /> : <SquarePen className="size-4" />}
          {editing ? 'Concluir' : 'Editar'}
        </Button>
      </div>
    </div>
  )
}

function Reminders({ draft, set, channel, errors, blocked }: { draft: Draft; set: SetDraft; channel: 'email' | 'sms'; errors: Errors; blocked?: ReactNode }) {
  const all = draft.reminders ?? []
  const list = all.filter((r) => r.channel === channel)
  const setR = (id: string, p: Partial<EventReminder>) => set((d) => ({ ...d, reminders: (d.reminders ?? []).map((r) => (r.id === id ? { ...r, ...p } : r)) }))
  const add = () => {
    const used = new Set(list.map((r) => r.hoursBefore))
    const hoursBefore = [24, 2, 1, 48, 4, 12, 72].find((h) => !used.has(h)) ?? 24
    set((d) => ({ ...d, reminders: [...(d.reminders ?? []), { id: uid('rem'), channel, hoursBefore }] }))
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Lembretes</p>
        <Button type="button" variant="outline" size="xs" className="h-8 gap-1 rounded-md px-2.5 text-[13px] shadow-none" disabled={!!blocked || list.length >= MAX_REMINDERS} onClick={add}>
          <Plus className="size-3.5" /> Adicionar lembrete
        </Button>
      </div>
      {list.length === 0 ? (
        <MiniEmpty icon={<Bell />} title="Nenhum lembrete ainda" description={channel === 'email' ? 'Adicione um lembrete para enviar e-mail aos convidados antes do compromisso.' : 'Adicione um lembrete para enviar SMS aos convidados antes do compromisso.'} />
      ) : (
        <ul className="mt-3 divide-y rounded-xl border">
          {list.map((r) => (
            <li key={r.id} className="px-4 py-3" data-testid="reminder-row">
              <div className="flex items-center gap-3">
                <Bell className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-sm font-medium">{channel === 'email' ? 'Lembrete por e-mail' : 'Lembrete por SMS'}</span>
                <CompactSelect label="Antecedência do lembrete" value={r.hoursBefore} options={REMINDER_HOURS} render={(h) => `${hoursLabel(h)} antes`} onChange={(v) => setR(r.id, { hoursBefore: v })} />
                <Button variant="ghost" size="icon-sm" aria-label="Remover lembrete" className="text-muted-foreground hover:text-destructive" onClick={() => set((d) => ({ ...d, reminders: (d.reminders ?? []).filter((x) => x.id !== r.id) }))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <TemplatePreview html={REMINDER_TEMPLATE.body} className="mt-1 pl-7 text-xs leading-6 text-muted-foreground" />
              {errors[`rem-${r.id}`] && <p className="mt-1 pl-7 text-sm font-medium text-destructive">{errors[`rem-${r.id}`]}</p>}
            </li>
          ))}
        </ul>
      )}
      {blocked}
    </div>
  )
}

/** Últimos envios reais (motor): e-mails ao convidado, à equipe e aos convidados fixos, lembretes e webhooks. */
function DeliveryHistory({ draft }: { draft: Draft }) {
  const [state, setState] = useState<{ items: NotificationRecord[]; emailConfigured: boolean } | 'error'>()
  useEffect(() => {
    if (!draft.engineEvent) return
    const abort = new AbortController()
    loadNotificationHistory(draft.id, abort.signal).then(setState).catch(() => { if (!abort.signal.aborted) setState('error') })
    return () => abort.abort()
  }, [draft.id, draft.engineEvent])
  if (!state) return null
  if (state === 'error') return <p className="-mt-3 text-xs text-muted-foreground">Não foi possível consultar os últimos envios.</p>
  const recent = state.items.filter((h) => h.channel === 'email').slice(0, 5)
  return (
    <div className="-mt-2 flex flex-col gap-2" data-testid="notification-history">
      {!state.emailConfigured && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-900">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span>O envio de e-mails não está configurado neste servidor: os avisos ficam registrados como “não enviado”.</span>
        </p>
      )}
      {recent.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="mb-1.5 font-medium text-foreground">Últimos envios</p>
          <ul className="space-y-1">
            {recent.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{NOTIFICATION_EVENT_LABEL[h.event] ?? h.event} · {h.audience === 'invitee' ? 'convidado' : h.audience === 'team' ? 'equipe' : 'convidado fixo'} · {h.recipient}</span>
                <span className={cn('shrink-0', ['accepted', 'delivered'].includes(h.status) ? 'text-emerald-700' : ['rejected', 'failed', 'not_sent', 'uncertain'].includes(h.status) ? 'text-destructive' : '')}>
                  {NOTIFICATION_STATUS_LABEL[h.status] ?? h.status}{h.status === 'queued' ? ` p/ ${new Date(h.dueAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function NotificationsTab({ draft, set, errors }: { draft: Draft; set: SetDraft; errors: Errors }) {
  const org = useCurrentOrg()
  const [params, setParams] = useSearchParams()
  const channel = CHANNELS.find((c) => c.slug === params.get('canal'))?.id ?? 'email'
  const setChannel = (c: Channel) => {
    const next = new URLSearchParams(params)
    if (c === 'email') next.delete('canal')
    else next.set('canal', CHANNELS.find((x) => x.id === c)!.slug)
    setParams(next, { replace: true })
  }
  const t = draft.templates ?? defaultTemplates(org?.name)
  const defs = defaultTemplates(org?.name)
  const setT = (fn: (t: NotificationTemplates) => NotificationTemplates) => set((d) => ({ ...d, templates: fn(d.templates ?? defs) }))
  const db = useStore((s) => s.db)
  const sms = useMemo(() => smsQuotaOf(db, draft.orgId), [db, draft.orgId])
  const n = draft.notifications
  const off = !n.confirmationEmail ? (
    <>
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600" />
      <span>Notificações padrão desativadas nas preferências (ícone de ajustes no topo): o convidado não recebe confirmação, reagendamento nem cancelamento por e-mail.</span>
    </>
  ) : undefined
  const channelDots: Partial<Record<Channel, boolean>> = {
    email: Object.keys(errors).some((k) => k.startsWith('tpl-email') || k === 'sender-email' || (k.startsWith('rem-') && (draft.reminders ?? []).find((r) => `rem-${r.id}` === k)?.channel === 'email')),
    sms: Object.keys(errors).some((k) => k.startsWith('tpl-sms') || k === 'sender-sms' || (k.startsWith('rem-') && (draft.reminders ?? []).find((r) => `rem-${r.id}` === k)?.channel === 'sms')),
    calendar: !!errors['tpl-calendar-subject'],
  }
  const smsBlocked =
    sms.quota === 0 ? (
      <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-900" data-testid="sms-blocked">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
        <span>
          Seu plano não inclui SMS (0 de 0 SMS neste ciclo).{' '}
          <Link to="/app/billing" className="font-medium underline underline-offset-4">
            Adicione créditos de SMS
          </Link>{' '}
          em Assinatura e faturamento para enviar mensagens de texto{(draft.reminders ?? []).some((r) => r.channel === 'sms') ? ' — até lá, nenhum SMS é registrado.' : '.'}
        </span>
      </p>
    ) : undefined

  return (
    <div className="flex w-full flex-col gap-6">
      <p className="-mt-4 text-sm leading-6 text-muted-foreground">
        Os e-mails saem como “{t.emailSenderName.trim() || org?.name || 'sua empresa'} via Kloel”, com o convite (.ics) em anexo. Convidados fixos e a equipe recebem um aviso a cada mudança. Alterações valem depois de salvar.
      </p>
      <DeliveryHistory draft={draft} />
      <SubTabs
        ariaLabel="Canal"
        value={channel}
        onChange={setChannel}
        dots={channelDots}
        options={CHANNELS.map((c) => ({
          id: c.id,
          label: (
            <>
              <c.icon className="size-4 shrink-0 max-sm:hidden" />
              {/* 390 px: rótulo curto para caber nas 3 abas */}
              <span className={cn('truncate', c.short && 'max-sm:hidden')}>{c.label}</span>
              {c.short && <span className="truncate sm:hidden">{c.short}</span>}
            </>
          ),
        }))}
      />

      {channel === 'email' && (
        <>
          <div>
            <Label htmlFor="sender-email" className="text-sm font-medium">
              Nome do remetente do e-mail
            </Label>
            <div className={cn('mt-2 flex h-10 items-center rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring', errors['sender-email'] && 'border-destructive')}>
              <input id="sender-email" className="h-full min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-sm outline-none" value={t.emailSenderName} placeholder={org?.name || 'Nome da empresa'} maxLength={60} onChange={(e) => setT((x) => ({ ...x, emailSenderName: e.target.value }))} />
              <span className="shrink-0 pr-2 text-sm text-muted-foreground">via Kloel</span>
              <button type="button" aria-label="Restaurar nome do remetente" className="mr-2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setT((x) => ({ ...x, emailSenderName: org?.name ?? '' }))}>
                <RotateCcw className="size-3.5" />
              </button>
            </div>
            {errors['sender-email'] && <p className="mt-1.5 text-sm font-medium text-destructive">{errors['sender-email']}</p>}
          </div>
          <TemplateCard
            title="Notificações padrão"
            channel="email"
            templates={t.email}
            sender={t.emailSenderName || org?.name || 'Kloel'}
            errors={errors}
            disabledNote={off}
            onChange={(k, v) => setT((x) => ({ ...x, email: { ...x.email, [k]: v } }))}
            onReset={() => {
              setT((x) => ({ ...x, email: defs.email }))
              toast.success('Modelos de e-mail restaurados', { description: 'Salve para aplicar.' })
            }}
          />
          <Reminders draft={draft} set={set} channel="email" errors={errors} />
        </>
      )}

      {channel === 'sms' && (
        <>
          <div>
            <Label htmlFor="sender-sms" className="text-sm font-medium">
              Nome do remetente do SMS
            </Label>
            <div className={cn('mt-2 flex h-10 items-center rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring', errors['sender-sms'] && 'border-destructive')}>
              <input id="sender-sms" className="h-full min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-sm outline-none" value={t.smsSenderName} maxLength={11} onChange={(e) => setT((x) => ({ ...x, smsSenderName: e.target.value }))} />
              <button type="button" aria-label="Restaurar remetente do SMS" className="mr-2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setT((x) => ({ ...x, smsSenderName: smsSenderOf(org?.name ?? '') }))}>
                <RotateCcw className="size-3.5" />
              </button>
            </div>
            {errors['sender-sms'] ? <p className="mt-1.5 text-sm font-medium text-destructive">{errors['sender-sms']}</p> : <p className="mt-1.5 text-xs text-muted-foreground">De 3 a 11 letras ou números. Aparece como remetente no celular do convidado.</p>}
          </div>
          {sms.quota > 0 && (
            <p className={cn('-mt-2 rounded-lg border p-3 text-xs leading-5', sms.left === 0 ? 'border-amber-200 bg-amber-50/70 text-amber-900' : 'bg-muted/40 text-muted-foreground')}>
              <span data-testid="sms-usage">
                {sms.used} de {sms.quota} SMS usados neste ciclo.
              </span>{' '}
              {sms.left === 0 ? 'Créditos esgotados: as mensagens de texto voltam a ser registradas na renovação ou com mais créditos.' : 'Cada mensagem de texto registrada consome 1 crédito.'}
            </p>
          )}
          <TemplateCard
            title="Notificações padrão"
            channel="sms"
            templates={t.sms}
            sender={t.smsSenderName}
            errors={errors}
            disabledNote={off}
            onChange={(k, v) => setT((x) => ({ ...x, sms: { ...x.sms, [k]: v } }))}
            onReset={() => {
              setT((x) => ({ ...x, sms: defs.sms }))
              toast.success('Modelos de mensagem restaurados', { description: 'Salve para aplicar.' })
            }}
          />
          <p className="-mt-3 px-1 text-xs text-muted-foreground">Usadas quando o contato não tem e-mail — por exemplo, agendamentos feitos por um agente durante a ligação.</p>
          <Reminders draft={draft} set={set} channel="sms" errors={errors} blocked={smsBlocked} />
        </>
      )}

      {channel === 'calendar' && (
        <CalendarCard
          value={t.calendar}
          errors={errors}
          onChange={(v) => setT((x) => ({ ...x, calendar: v }))}
          onReset={() => {
            setT((x) => ({ ...x, calendar: defs.calendar }))
            toast.success('Convite padrão restaurado', { description: 'Salve para aplicar.' })
          }}
        />
      )}

    </div>
  )
}
