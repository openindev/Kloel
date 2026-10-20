import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronLeft, File, Globe, MessageSquare, PanelRightClose, Phone, PhoneOutgoing, Tag as TagIcon, UserSearch } from 'lucide-react'
import type { Agent, Contact, Conversation } from '@/domain/types'
import { cn } from '@/lib/utils'
import { CHANNEL_LABEL } from '@/data/catalogs/results'
import { WhatsAppIcon } from '@/components/brand/icons'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useContactSettings, useCurrentOrg } from '@/data/store'
import { Button } from '@/components/ui/button'
import '@/domain/ext/inbox-contacts'
import { TriggerTooltip, formatDuration } from './shared'
import { isChat } from './filters'
import { agentNameSnapshot } from './agentLabel'
import { AssigneeSelect, ContactLinkActions } from './ConversationPeople'

export function ChannelIcon({ conversation, className }: { conversation: Pick<Conversation, 'channel' | 'direction'>; className?: string }) {
  const c = conversation.channel
  if (c === 'web') return <Globe className={cn('h-3 w-3 shrink-0 text-blue-600', className)} />
  if (c === 'whatsapp') return <WhatsAppIcon className={cn('h-3 w-3 shrink-0 text-[#25D366]', className)} />
  if (c === 'webchat') return <MessageSquare className={cn('h-3 w-3 shrink-0 text-brand', className)} />
  if (conversation.direction === 'outbound') return <PhoneOutgoing className={cn('h-3 w-3 shrink-0 text-emerald-600', className)} />
  return <Phone className={cn('h-3 w-3 shrink-0 text-emerald-600', className)} />
}

/**
 * Ícone da linha "canal" na lista e em Contatos › Atividades: ligações telefônicas mostram a direção (↙ recebida / ↗ realizada,
 * verde) antes do número, como nas capturas da Central de ajuda (AN-01, CO-01); os demais canais usam o ícone do canal.
 */
export function ListChannelIcon({ conversation, className }: { conversation: Pick<Conversation, 'channel' | 'direction'>; className?: string }) {
  if (conversation.channel === 'phone') {
    const Icon = conversation.direction === 'unknown' ? Phone : conversation.direction === 'outbound' ? ArrowUpRight : ArrowDownLeft
    return <Icon className={cn('h-3 w-3 shrink-0 text-emerald-600', className)} aria-label={conversation.direction === 'unknown' ? 'Ligação' : conversation.direction === 'outbound' ? 'Ligação realizada' : 'Ligação recebida'} />
  }
  return <ChannelIcon conversation={conversation} className={className} />
}

/** Texto da linha "canal": número (ligação/WhatsApp) ou rótulo do canal (chamada web / Chatbot de IA). */
export function channelLineLabel(c: Pick<Conversation, 'channel' | 'callerNumber'>) {
  if ((c.channel === 'phone' || c.channel === 'whatsapp') && c.callerNumber) return c.callerNumber
  return CHANNEL_LABEL[c.channel] ?? c.channel
}

/** Término da conversa (início + duração). */
export const endedAt = (c: Pick<Conversation, 'startedAt' | 'durationSec' | 'engineConversation'>) => c.engineConversation?.closedAt ? new Date(c.engineConversation.closedAt) : c.durationSec == null ? null : new Date(new Date(c.startedAt).getTime() + c.durationSec * 1000)

/** Contexto entregue ao assistente, no formato aninhado capturado ao vivo (agent: / name: …; contact: –). */
function contextYaml(ctx: Record<string, Record<string, string | undefined> | undefined>) {
  return Object.entries(ctx)
    .map(([k, v]) => {
      const entries = Object.entries(v ?? {}).filter(([, x]) => x != null && String(x).trim() !== '')
      if (!entries.length) return `${k}: –`
      return `${k}:\n${entries.map(([kk, x]) => `  ${kk}: ${x}`).join('\n')}`
    })
    .join('\n')
}

/**
 * Linhas Agente…Duração da Fonio ao vivo (live-compare D-conversas/02): passo de 23,5px (linhas de 17,5px = 12px × 1,4583
 * + 6px; fator sem unidade para os trechos em fonte mono menor não aumentarem a linha), "Tipo" ~2,5px mais alta pelo ícone;
 * primeira linha 10px abaixo do cabeçalho. Medido: rótulos em y 77/103/126/150/173/197 e "CONTEXTO" em 239, como na Fonio.
 */
const DL = 'space-y-1.5 text-[12px] leading-[1.4583]'

function Row({ label, children, empty }: { label: string; children?: ReactNode; empty?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-[110px] shrink-0 truncate text-[11.5px] text-muted-foreground">{label}</dt>
      {/* vazio: "–" no texto normal do valor (Fonio ao vivo, live-compare D-conversas/02: Chamador/Destinatário "–" em preto) */}
      <dd className="min-w-0 break-words text-foreground">{empty ? '–' : children}</dd>
    </div>
  )
}

/** Linha "Agente": link para o assistente; excluído → "<nome> (excluído)" / "Assistente excluído", sem link. */
function AgentRow({ agent, label }: { agent?: Agent; label?: string }) {
  return (
    <Row label="Agente" empty={!agent && !label}>
      {agent ? (
        <Link to={`/app/agents/${agent.id}`} className="hover:underline">
          {agent.name}
        </Link>
      ) : (
        <span className="text-muted-foreground" data-testid="inbox-deleted-agent" title="Este assistente foi excluído; a conversa continua no histórico.">
          {label}
        </span>
      )}
    </Row>
  )
}

/** Linhas de "Detalhes do chat" observadas na captura WA-03 (Assistente, Canal, Contato, Telefone, Status, Iniciado, Última mensagem, Mensagens). */
function ChatDetailRows({ conversation, agent, agentLabel, contactName, readOnly }: { conversation: Conversation; agent?: Agent; agentLabel?: string; contactName: string; readOnly?: boolean }) {
  const msgs = conversation.transcript.filter((l) => l.speaker !== 'system')
  const last = msgs.at(-1)
  const lastAt = last ? (last.sentAt ? new Date(last.sentAt) : new Date(new Date(conversation.startedAt).getTime() + last.t * 1000)) : endedAt(conversation)
  return (
    <dl className={DL}>
      <AgentRow agent={agent} label={agentLabel} />
      <Row label="Canal">
        <span className="inline-flex items-center gap-1.5">
          <ChannelIcon conversation={conversation} />
          {CHANNEL_LABEL[conversation.channel]}
        </span>
      </Row>
      <Row label="Contato" empty={!contactName}>
        {contactName}
      </Row>
      <Row label="Telefone" empty={!conversation.callerNumber}>
        <span className="font-mono text-[11.5px] tabular-nums">{conversation.callerNumber}</span>
      </Row>
      <Row label="Iniciado">{format(new Date(conversation.startedAt), 'dd/MM/yyyy, HH:mm')}</Row>
      <Row label="Última mensagem">{lastAt ? format(lastAt, 'dd/MM/yyyy, HH:mm') : '–'}</Row>
      <Row label="Mensagens">
        <span className="tabular-nums">{msgs.length}</span>
      </Row>
      <Row label="Atendimento">
        {conversation.handover ? (
          <span title={conversation.handover.at ? `Assumida em ${format(new Date(conversation.handover.at), 'dd/MM/yyyy, HH:mm')}` : undefined}>Equipe · {conversation.handover.by}</span>
        ) : (
          <span>Assistente</span>
        )}
      </Row>
      <Row label="Responsável">
        <AssigneeSelect conversation={conversation} readOnly={readOnly} />
      </Row>
    </dl>
  )
}

function Section({ icon, title, children, defaultOpen = true }: { icon: ReactNode; title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2.5 hover:bg-muted/50">
        <span className="shrink-0 text-muted-foreground [&>svg]:h-[13px] [&>svg]:w-[13px]">{icon}</span>
        <span className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title}</span>
        <ChevronLeft className={cn('ml-auto h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && '-rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Painel "Detalhes da chamada" (w=280) da Fonio ao vivo (fonio-live2/D-conversas/12): fechado por padrão, abre pelo
 * botão panel-right-open como folha sobreposta colada à direita, com o próprio botão "Ocultar detalhes".
 * Conteúdo: Agente (link), Tipo, Chamador, Destinatário, Data, Duração; CONTEXTO; CORRESPONDÊNCIA DE CONTATO.
 */
export function DetailsPanel({
  conversation,
  agent,
  agentLabel,
  contact,
  onClose,
  className,
  readOnly,
}: {
  conversation: Conversation
  agent?: Agent
  /** Rótulo do assistente quando ele não existe mais ("<nome> (excluído)" / "Assistente excluído"). */
  agentLabel?: string
  contact?: Contact
  onClose?: () => void
  className?: string
  /** Papéis somente leitura: sem "Responsável" editável nem vínculo de contato. */
  readOnly?: boolean
}) {
  const org = useCurrentOrg()
  const settings = useContactSettings()
  const chat = isChat(conversation)
  // Contexto entregue na época: com o assistente excluído, usa o nome guardado na conversa (se houver).
  const snapshot = agent ? undefined : agentNameSnapshot(conversation)
  const contactName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : ''
  const filledFields = contact ? (settings?.smartFields ?? []).filter((f) => (contact.fields[f.id] ?? '').trim()) : []
  const extractionEntries = Object.entries(conversation.extraction ?? {}).filter(([, v]) => String(v ?? '').trim() !== '')

  return (
    <aside aria-label={chat ? 'Detalhes do chat' : 'Detalhes da chamada'} className={cn('flex w-[280px] shrink-0 flex-col overflow-y-auto border-l bg-white', className)}>
      <div className="border-b bg-white p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="text-[15px] font-semibold tracking-tight">{chat ? 'Detalhes do chat' : 'Detalhes da chamada'}</span>
          {onClose && (
            <TriggerTooltip label="Ocultar detalhes">
              <Button variant="ghost" size="icon" aria-label="Ocultar detalhes" onClick={onClose} className="-my-0.5 -mr-1.5 h-8 w-8 text-muted-foreground">
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </TriggerTooltip>
          )}
        </div>
        {chat ? (
          <ChatDetailRows conversation={conversation} agent={agent} agentLabel={agentLabel} contactName={contactName} readOnly={readOnly} />
        ) : (
        <dl className={DL}>
          <AgentRow agent={agent} label={agentLabel} />
          <Row label="Tipo">
            <span className="inline-flex items-center gap-1.5">
              <ChannelIcon conversation={conversation} />
              {CHANNEL_LABEL[conversation.channel]}
              {conversation.direction === 'outbound' && <span className="text-muted-foreground">(saída)</span>}
            </span>
          </Row>
          <Row label={chat ? 'Contato' : 'Chamador'} empty={!conversation.callerNumber && !contactName}>
            <span className="flex flex-col">
              {contactName && <span>{contactName}</span>}
              {conversation.callerNumber && <span className="tabular-nums text-muted-foreground">{conversation.callerNumber}</span>}
            </span>
          </Row>
          <Row label="Destinatário" empty={!conversation.calleeNumber}>
            <span className="tabular-nums">{conversation.calleeNumber}</span>
          </Row>
          {/* Referência ao vivo: item da lista "01:35" (início) e Data "18/10/2026, 01:38" para 3:02 → Data = término da conversa. */}
          <Row label="Data">
            <span title={`Início: ${format(new Date(conversation.startedAt), 'dd/MM/yyyy, HH:mm')}`}>{endedAt(conversation) ? format(endedAt(conversation)!, 'dd/MM/yyyy, HH:mm') : '–'}</span>
          </Row>
          <Row label="Duração">
            <span className="tabular-nums">{formatDuration(conversation.durationSec)}</span>
          </Row>
          <Row label="Responsável">
            <AssigneeSelect conversation={conversation} readOnly={readOnly} />
          </Row>
        </dl>
        )}
      </div>
      {/* corpo do painel em tom "muted" (referência ao vivo: ~#FAFAFA abaixo do bloco branco "Detalhes da chamada") */}
      <div className="grow bg-muted/50" data-testid="inbox-details-body">
      <Section icon={<File />} title="Contexto">
        <dl className="space-y-1.5 p-3 text-[12px]">
          <dt className="mb-0.5 text-[11.5px] leading-4 text-muted-foreground">kloel</dt>
          {/* entrelinha medida na captura ao vivo (app-inbox_half.jpg): ~18px por linha a 10px (leading-relaxed daria 16,25px) */}
          <dd className="whitespace-pre-wrap break-words rounded bg-muted/50 px-2.5 py-1.5 font-mono text-[10px] leading-[1.8] text-muted-foreground" data-testid="inbox-context">
            {contextYaml({
              agent: agent ? { name: agent.name } : snapshot ? { name: snapshot } : undefined,
              company: org ? { name: org.name } : undefined,
              contact: contact
                ? {
                    name: contactName || undefined,
                    phone: contact.phones[0]?.value,
                    email: contact.emails[0]?.value,
                    company: contact.company || undefined,
                    ...Object.fromEntries(filledFields.map((f) => [f.label, contact.fields[f.id]!])),
                  }
                : undefined,
            })}
          </dd>
        </dl>
      </Section>
      {extractionEntries.length > 0 && (
        <Section icon={<TagIcon />} title="Extração">
          {/* AN-08: pares chave (cinza) / valor (monoespaçado) capturados pelo assistente durante a conversa */}
          <dl className="space-y-1.5 p-3 text-[12px]" data-testid="inbox-extraction">
            {extractionEntries.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3">
                <dt className="w-[110px] shrink-0 truncate text-[11.5px] text-muted-foreground" title={k}>
                  {k}
                </dt>
                <dd className="min-w-0 break-words font-mono text-[11.5px] text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      <Section icon={<UserSearch />} title="Correspondência de contato">
        <div className="space-y-2 p-3">
          <div className="flex items-start gap-2 rounded-md border border-transparent p-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700">
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            <div className="min-w-0">
              <span className="text-[12px] font-medium">Correspondência de contatos</span>
              {contact ? (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {chat ? 'A pessoa' : 'A pessoa que ligou'} corresponde a um contato salvo; os dados dele foram adicionados ao contexto {chat ? 'do chat' : 'da chamada'}.
                </p>
              ) : (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  Nenhum contato correspondeu à pessoa que {chat ? 'escreveu' : 'ligou'}; nenhum dado foi adicionado ao contexto {chat ? 'do chat' : 'da chamada'}.
                </p>
              )}
            </div>
          </div>
          <ContactLinkActions conversation={conversation} contact={contact} readOnly={readOnly} />
          {contact && (
            <Link
              to={`/app/contacts/${contact.id}`}
              className="flex items-center gap-2 rounded-md border bg-white p-2 transition-colors hover:bg-muted/40"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {(contact.firstName[0] ?? '') + (contact.lastName[0] ?? '') || '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{contactName || 'Contato sem nome'}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{contact.phones[0]?.value ?? contact.emails[0]?.value ?? contact.company}</span>
              </span>
            </Link>
          )}
        </div>
      </Section>
      </div>
    </aside>
  )
}
