import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle, ArrowLeft, Ban, ChevronRight, Copy, History, Pencil, Sparkles, Timer, Trash2 } from 'lucide-react'
import type { Contact, Conversation, SmartFieldDef } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DarkBarButton, DarkBarPrimary } from '@/components/app/ActionBar'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { ListChannelIcon, channelLineLabel } from '../inbox/DetailsPanel'
import { ActiveChip, TriggerTooltip, formatDuration } from '../inbox/shared'
import { FIELD_TYPE_LABEL, HISTORY_LABEL, SOURCE_LABEL, contactHistory, displayName, formatInt, isFieldValueCompatible, labelText } from './lib'
import { ContactConsent } from './ContactConsent'

/** Rótulo de seção no padrão capturado ("Campos inteligentes": px-3 text-xs font-medium muted). */
function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2 px-3">
      <p className="text-xs font-medium text-muted-foreground">{children}</p>
      {action}
    </div>
  )
}

/** Linha de cartão no padrão capturado ("flex h-[52px] items-center gap-4 border-b py-4 pl-5 pr-6"). */
function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-[52px] items-center gap-4 border-b py-3 pl-5 pr-6 last:border-b-0 max-md:pl-4 max-md:pr-4', className)}>
      <span className="shrink-0 text-sm font-medium">{label}</span>
      <div className="min-w-0 flex-1 text-right text-sm">{children}</div>
    </div>
  )
}

/**
 * Detalhe do contato em modo leitura — captura CO-01/CO-05 da Central de ajuda (Contatos): título + ícone de histórico,
 * "Detalhes do contato" (só os campos preenchidos; ✦ nos valores capturados pela IA), "Configurações de comunicação" com
 * interruptores "Bloquear contato" e "WhatsApp IA", "Campos inteligentes" (rótulos em cinza + "Definir campos gerenciados
 * por IA"), "Atividades" e a barra flutuante escura "Copiar | Editar". Bloqueio e WhatsApp IA são aplicados na hora.
 */
export function ContactView({
  contact,
  members,
  smartFields,
  conversations,
  onEdit,
  onDelete,
  onBack,
  onPatch,
  onOpenSettings,
  showBack,
  barLeft = '0px',
}: {
  contact: Contact
  members: { id: string; name: string }[]
  smartFields: SmartFieldDef[]
  conversations: Conversation[]
  onEdit: () => void
  onDelete: () => void
  onBack: () => void
  onPatch: (p: Partial<Contact>, message: string) => void
  onOpenSettings: () => void
  /** Seta "Voltar para a lista" (coluna única: celular e larguras intermediárias). */
  showBack?: boolean
  /** Deslocamento à esquerda da barra flutuante (centralizada na coluna do detalhe, como a do formulário). */
  barLeft?: string
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const title = displayName(contact)
  const owner = members.find((m) => m.id === contact.ownerId)
  const blocked = !!contact.blocked
  const whatsappAi = contact.whatsappAi === true
  const name = [contact.firstName, contact.lastName].filter((x) => x.trim()).join(' ')
  // ✦ nos valores capturados automaticamente pela IA (origem "Conversa"), como o telefone da captura CO-01.
  const aiCaptured = contact.source === 'conversation'

  const copyContact = async () => {
    const lines = [
      name,
      ...contact.phones.map((p) => p.value),
      ...contact.emails.map((e) => e.value),
      contact.company,
    ].filter((x) => x && x.trim())
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Contato copiado', { description: lines.join(' · ') })
    } catch {
      toast.error('Não foi possível acessar a área de transferência.', { description: text })
    }
  }

  const rows: { label: string; value: ReactNode }[] = []
  if (name) rows.push({ label: 'Nome', value: name })
  if (contact.phones.length)
    rows.push({
      label: contact.phones.length > 1 ? 'Telefones' : 'Telefone',
      value: (
        <ul className="space-y-0.5">
          {contact.phones.map((p) => (
            <li key={p.value} className="inline-flex items-center gap-1.5 tabular-nums">
              {aiCaptured && <Sparkles className="h-3 w-3 shrink-0 text-brand" aria-label="Capturado pela Kloel" />}
              {p.value}
              {p.label && <span className="text-xs text-muted-foreground">{labelText(p.label)}</span>}
            </li>
          ))}
        </ul>
      ),
    })
  if (contact.emails.length)
    rows.push({
      label: contact.emails.length > 1 ? 'E-mails' : 'E-mail',
      value: (
        <ul className="space-y-0.5">
          {contact.emails.map((e) => (
            <li key={e.value} className="truncate" title={e.value}>
              {e.value}
              {e.label && <span className="ml-1.5 text-xs text-muted-foreground">{labelText(e.label)}</span>}
            </li>
          ))}
        </ul>
      ),
    })
  if (contact.company) rows.push({ label: 'Empresa', value: contact.company })
  if (contact.ownerId) rows.push({ label: 'Responsável', value: owner?.name ?? 'Membro removido' })
  if (contact.notes) rows.push({ label: 'Notas', value: <span className="whitespace-pre-line break-words">{contact.notes}</span> })

  return (
    <div className="mx-auto max-w-[440px] space-y-8" data-testid="contact-view">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Voltar para a lista" onClick={onBack} className={cn('-ml-2 h-8 w-8 shrink-0 text-muted-foreground', showBack === undefined ? 'md:hidden' : !showBack && 'hidden')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-[30px] font-semibold leading-tight tracking-tight max-md:text-2xl">{title}</h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <ContactHistoryButton contact={contact} />
          <SimpleTooltip label="Excluir contato">
            <Button variant="ghost" size="icon" aria-label="Excluir contato" onClick={() => setConfirmDelete(true)} className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </SimpleTooltip>
        </div>
      </div>

      <section aria-label="Detalhes do contato">
        <SectionLabel>Detalhes do contato</SectionLabel>
        <div className="overflow-hidden rounded-lg border bg-white">
          {rows.map((r) => (
            <Row key={r.label} label={r.label}>
              {r.value}
            </Row>
          ))}
        </div>
      </section>

      <section aria-label="Configurações de comunicação">
        <SectionLabel>Configurações de comunicação</SectionLabel>
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="flex min-h-[52px] items-center gap-4 border-b py-3 pl-5 pr-4 max-md:pl-4">
            <Label htmlFor="contact-block" className="flex-1 text-sm font-medium">
              Bloquear contato
            </Label>
            <Switch
              id="contact-block"
              aria-label="Bloquear contato"
              checked={blocked}
              onCheckedChange={(v) => (v ? setConfirmBlock(true) : onPatch({ blocked: false }, 'Contato desbloqueado'))}
            />
          </div>
          <div className="flex min-h-[52px] items-center gap-4 py-3 pl-5 pr-4 max-md:pl-4">
            <Label htmlFor="contact-wa" className="flex-1 text-sm font-medium">
              WhatsApp IA
            </Label>
            <Switch
              id="contact-wa"
              aria-label="WhatsApp IA"
              checked={whatsappAi && !blocked}
              disabled={blocked}
              onCheckedChange={(v) => onPatch({ whatsappAi: v }, v ? 'WhatsApp IA ativado para este contato' : 'WhatsApp IA desativado para este contato')}
            />
          </div>
        </div>
        {blocked && (
          <p className="mt-2 flex items-start gap-1.5 px-3 text-[11.5px] text-red-700">
            <Ban className="mt-px h-3 w-3 shrink-0" />
            <span>
              <span className="font-medium">Contato bloqueado:</span> as ligações não são atendidas pelo assistente e o WhatsApp IA fica indisponível.
            </span>
          </p>
        )}
      </section>

      <ContactConsent contact={contact} />

      <section aria-label="Campos inteligentes">
        <SectionLabel>Campos inteligentes</SectionLabel>
        <div className="overflow-hidden rounded-lg border bg-white">
          {smartFields.map((f) => {
            const v = (contact.fields[f.id] ?? '').trim()
            const incompatible = !isFieldValueCompatible(f, v)
            return (
              <div key={f.id} className="flex min-h-[52px] items-center gap-4 border-b py-3 pl-5 pr-6 max-md:pl-4 max-md:pr-4" data-field-id={f.id}>
                <span className="flex-1 text-sm text-muted-foreground" title={f.description || undefined}>
                  {f.label}
                </span>
                <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-right text-sm', v ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
                  {f.aiFill && <Sparkles className="h-3 w-3 shrink-0" aria-label="Preenchido pela Kloel" />}
                  <span className="break-words">{v || 'não informado'}</span>
                  {incompatible && (
                    <SimpleTooltip label={`Valor salvo antes de o campo virar “${FIELD_TYPE_LABEL[f.type]}”. Edite o contato para corrigir ou apagar.`}>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        <AlertTriangle className="h-2.5 w-2.5" /> incompatível com {FIELD_TYPE_LABEL[f.type]}
                      </span>
                    </SimpleTooltip>
                  )}
                </span>
              </div>
            )
          })}
          <div className="flex p-2">
            <button type="button" onClick={onOpenSettings} className="flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium text-brand hover:bg-muted/40">
              <Sparkles className="h-4 w-4" /> Definir campos gerenciados por IA
            </button>
          </div>
        </div>
      </section>

      <section aria-label="Atividades">
        <SectionLabel>Atividades ({formatInt(conversations.length)})</SectionLabel>
        {conversations.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-3 text-center text-xs text-muted-foreground">Nenhuma conversa com este contato ainda.</p>
        ) : (
          <ul className="space-y-2">
            {conversations.slice(0, 20).map((c) => (
              <li key={c.id}>
                {/* CO-01: título + data/hora à direita + ›; abaixo ↙ número e ⏱ duração */}
                <Link to={`/app/inbox?id=${encodeURIComponent(c.id)}`} className="flex items-center gap-3 rounded-lg border bg-white py-3 pl-4 pr-3 transition-colors hover:bg-muted/40">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13px] font-medium">{c.title}</span>
                      <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">{format(new Date(c.startedAt), 'dd/MM/yy  HH:mm')}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-3 text-[10.5px] tabular-nums text-muted-foreground">
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <ListChannelIcon conversation={c} className="h-2.5 w-2.5" />
                        <span className="truncate">{channelLineLabel(c)}</span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <Timer className="h-2.5 w-2.5" /> {formatDuration(c.durationSec)} min
                      </span>
                      {c.chatActive && <ActiveChip className="ml-auto" />}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {conversations.length > 20 && <p className="mt-2 px-3 text-xs text-muted-foreground">Mostrando as 20 mais recentes de {formatInt(conversations.length)}.</p>}
      </section>

      {/* Barra flutuante escura "Copiar | Editar" (CO-01/CO-05), centralizada na coluna do detalhe */}
      {createPortal(
        <div className="pointer-events-none fixed bottom-5 right-0 z-40 flex justify-center px-4 print:hidden" style={{ left: barLeft }} data-testid="contact-actionbar">
          <div className="pointer-events-auto inline-flex items-center gap-1 rounded-2xl border border-brand/40 bg-[#16171B] p-1 shadow-[0px_6px_18px_rgba(15,18,28,0.35)]">
            <DarkBarButton onClick={copyContact} aria-label="Copiar dados do contato" className="gap-1.5">
              <Copy className="h-4 w-4" /> Copiar
            </DarkBarButton>
            <DarkBarPrimary onClick={onEdit}>
              <Pencil className="h-4 w-4" /> Editar
            </DarkBarPrimary>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir contato?"
        description={`${title} será removido permanentemente. As conversas continuam em Conversas, mas sem correspondência com este contato.`}
        confirmLabel="Excluir contato"
        onConfirm={onDelete}
      />
      <ConfirmDialog
        open={confirmBlock}
        onOpenChange={setConfirmBlock}
        title="Bloquear contato?"
        description={`As ligações de ${title} não serão mais atendidas pelo seu assistente e o WhatsApp IA fica indisponível para ele. Você pode desbloquear a qualquer momento.`}
        confirmLabel="Bloquear contato"
        onConfirm={() => onPatch({ blocked: true }, 'Contato bloqueado')}
      />
    </div>
  )
}

/** Botão "histórico" ao lado do título (CO-01): abre a origem do contato e as alterações registradas. */
function ContactHistoryButton({ contact }: { contact: Contact }) {
  const events = contactHistory(contact)
  return (
    <Popover>
      <TriggerTooltip label="Histórico do contato">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Histórico do contato" className="h-8 w-8 text-foreground data-[state=open]:bg-accent">
            <History className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
      </TriggerTooltip>
      <PopoverContent align="end" className="w-80 p-0" data-testid="contact-history">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Histórico do contato</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Origem: {SOURCE_LABEL[contact.source]} · Criado em {format(new Date(contact.createdAt), 'dd/MM/yyyy')} · Atualizado{' '}
            {formatDistanceToNow(new Date(contact.updatedAt ?? contact.createdAt), { addSuffix: true, locale: ptBR })}
          </p>
        </div>
        <ol className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-2.5 text-xs">
              <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', e.kind === 'blocked' ? 'bg-red-500' : e.kind === 'created' || e.kind === 'imported' ? 'bg-brand' : 'bg-muted-foreground/60')} />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{HISTORY_LABEL[e.kind]}</span>
                {e.fields?.length ? <span className="text-muted-foreground"> · {e.fields.join(', ')}</span> : null}
                <span className="block text-[11px] text-muted-foreground">
                  {format(new Date(e.at), 'dd/MM/yyyy, HH:mm')} · {e.by}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  )
}
